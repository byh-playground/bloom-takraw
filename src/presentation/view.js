import { TAKRAW_SCHOOLS } from '../config/schools.js';
import { takrawHumanPlayerIds } from '../simulation/roster.js';
import { TAKRAW_MODE_POLICY } from '../config/runtime.js';
import { takrawNetShape } from '../config/physics.js';
import { LOCALE } from '../i18n/locale.js';
import { TakrawImpactEffects } from './impact.js';
import { TakrawReplayImpacts } from './replay-impact.js';
import { TakrawFieldEffects } from './field-effects.js';
import { TakrawScoreMotion } from './score-motion.js';
import { TakrawShockWave } from './shock-wave.js';
import { PartList, RenderStats, warmUp } from '@bloom-gamekit/three-kit';
import { TakrawMarkers } from './markers.js';
import { TakrawPlayerBatch } from './player-batch.js';

const NO_DEFORM = Object.freeze({ axis: null, amount: 0 });

class TakrawView {
    constructor({ THREE, canvas, config }) {
        this.THREE = THREE;
        this.canvas = canvas;
        this.config = config;
        this.schools = [TAKRAW_SCHOOLS[0], TAKRAW_SCHOOLS[1]];
        // 경기장 꾸밈(현수막·바닥·관중 색)은 보는 사람의 상대 학교 기준이다. 1P는 팀 1의 학교, 2P는 팀 0의 학교.
        this.venueIndex = 1;
        this.textures = new Map();
        this.meshes = new Map();
        this.geometries = new Map();
        this.materials = new Map();
        this.venueMaterials = new Map();
        this.quality = 'high';
        this.lastMs = 0;
        this.scoreMotion = new TakrawScoreMotion();
        this.motionQuery =
            typeof matchMedia === 'function'
                ? matchMedia('(prefers-reduced-motion: reduce)')
                : null;
        this.shakeOffset = { x: 0, y: 0 };
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xe8eee3);
        this.scene.fog = new THREE.Fog(0xe8eee3, 32, 68);
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.13;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        const camera = config.visual.camera;
        this.camera = new THREE.PerspectiveCamera(camera.fov, 1, camera.near, camera.far);
        this.cameraRig = {
            focus: new THREE.Vector3(0, camera.focusHeight, 0),
            target: new THREE.Vector3(),
            offset: new THREE.Vector3(),
            right: new THREE.Vector3(),
            up: new THREE.Vector3(),
            relative: new THREE.Vector3(),
            distance: Math.hypot(camera.distance, camera.elevation),
            team: 0,
            mode: null,
            phase: null,
            orbit: { yaw: 0, pitch: Math.atan2(camera.elevation, camera.distance) },
            initialized: false,
        };
        this.camera.position.set(-camera.distance, camera.focusHeight + camera.elevation, 0);
        this.camera.lookAt(this.cameraRig.focus);
        this.temp = {
            vector: new THREE.Vector3(),
            scale: new THREE.Vector3(),
            object: new THREE.Object3D(),
            quaternion: new THREE.Quaternion(),
            right: new THREE.Vector3(),
            up: new THREE.Vector3(),
        };
        // 표시 속도(보간 포즈의 프레임 간 위치 차를 평활): 공 늘어남의 방향·크기. 끊긴 장면(준비·득점·순간이동)에서는 지운다.
        this.ballMotion = {
            last: new THREE.Vector3(),
            sample: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            lastMs: null,
        };
        // 공 변형 행렬(프레임마다 재사용): 접촉 눌림 · 비행 늘어남 · 물리 회전.
        this.ballTransform = {
            squash: new THREE.Matrix4(),
            stretch: new THREE.Matrix4(),
            rotation: new THREE.Matrix4(),
            direction: new THREE.Vector3(),
        };
        // 화면에서 본 늘어남(공 후광이 공과 같이 늘어나게): along 배율과 화면 각도(rad).
        this.ballScreenStretch = { along: 1, angle: 0 };
        this.ballExtent = 1;
        this.poseHoldValue = 0;
        // 공·닿은 부위 반짝임(표시 전용): 밝아진 물체 이름과 공 재질 복제본. 선수 부위는 부위 뼈의 반짝임 값이다.
        this.lit = new Set();
        this.litKeys = new Set();
        this.litMaterials = new Map();
        // 네트·기둥의 경계. 물리 충돌체와 같은 값에서 파생한다.
        this.netShape = takrawNetShape(config.court, config.physics);
        this.makeLights();
        this.makeCourt();
        this.makeSurroundings();
        this.makeVenueBanners();
        this.applyVenue();
        this.makeMarkers();
        // 선수 6명 전체: 본체 1 draw + 등번호 1 draw(그림자 패스는 본체 1). 부위 자세는 view.meshes에 등록한 부위 뼈(SkinnedMesh)다.
        this.players = new TakrawPlayerBatch({
            THREE,
            scene: this.scene,
            shapeGeometry: (entity) => this.bodyGeometry(entity),
            glow: config.visual.impact.flash.glow,
        });
        this.impacts = new TakrawImpactEffects({
            THREE,
            scene: this.scene,
            config,
            reducedMotion: () => this.reducedMotion(),
        });
        this.impacts.camera = this.camera;
        this.replayImpacts = new TakrawReplayImpacts({ impacts: this.impacts, config });
        this.impacts.setElements(this.schools.map((school) => school.element));
        this.shockWave = new TakrawShockWave({ THREE, renderer: this.renderer, config });
        this.renderStats = new RenderStats(this.renderer);
        this.field = new TakrawFieldEffects({
            THREE,
            scene: this.scene,
            config,
            reducedMotion: () => this.reducedMotion(),
        });
        this.resize();
    }

    material(color, options = {}) {
        const key = `${color}:${options.roughness ?? 0.85}:${options.metalness ?? 0}:${options.opacity ?? 1}:${options.basic ?? false}:${options.vertexColors ?? false}`;
        if (!this.materials.has(key)) {
            const properties = {
                color,
                roughness: options.roughness ?? 0.85,
                metalness: options.metalness ?? 0,
                vertexColors: options.vertexColors ?? false,
            };
            if (options.opacity !== undefined) {
                properties.transparent = true;
                properties.opacity = options.opacity;
                properties.depthWrite = false;
            }
            if (options.basic) {
                delete properties.roughness;
                delete properties.metalness;
            }
            this.materials.set(
                key,
                options.basic
                    ? new this.THREE.MeshBasicMaterial(properties)
                    : new this.THREE.MeshStandardMaterial(properties),
            );
        }
        return this.materials.get(key);
    }

    get venueSchool() {
        return this.schools[this.venueIndex];
    }

    /** 보는 팀에 맞춰 경기장 꾸밈을 상대 쪽으로 옮긴다. 2P 카메라는 +x 쪽에서 -x를 보므로 현수막이 상대 코트 뒤(-x)에 와야 시야를 가리지 않는다. */
    setViewTeam(team) {
        const index = team === 1 ? 0 : 1;
        if (index === this.venueIndex) return;
        this.venueIndex = index;
        this.bannerRig.rotation.y = team === 1 ? Math.PI : 0;
        this.applyVenue();
    }

    venueMaterial(channel) {
        if (!this.venueMaterials.has(channel)) {
            const material = new this.THREE.MeshStandardMaterial({
                color: this.venueSchool.venue[channel],
                roughness: 0.85,
            });
            this.venueMaterials.set(channel, material);
            this.materials.set(`venue:${channel}`, material);
        }
        return this.venueMaterials.get(channel);
    }

    makeVenueBanners() {
        this.bannerRig = new this.THREE.Group();
        this.scene.add(this.bannerRig);
        this.venueBanners = [-3.7, 0, 3.7].map((z, index) => {
            const banner = this.mesh(
                this.geometry('venue-banner', () => new this.THREE.PlaneGeometry(3.4, 0.72)),
                this.bannerMaterial(index),
                this.bannerRig,
            );
            banner.position.set(7.8, 2.65, z);
            banner.rotation.y = -Math.PI / 2;
            banner.castShadow = false;
            banner.receiveShadow = false;
            return banner;
        });
    }

    bannerMaterial(index) {
        const school = this.venueSchool,
            key = `venue-banner:${school.id}:${index}`;
        if (!this.materials.has(key)) {
            const canvas = document.createElement('canvas');
            canvas.width = 640;
            canvas.height = 136;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = `#${school.uniform.primary.toString(16).padStart(6, '0')}`;
            ctx.fillRect(0, 0, 640, 136);
            ctx.fillStyle = `#${school.venue.line.toString(16).padStart(6, '0')}`;
            ctx.font = 'bold 43px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(LOCALE.text(school.venue.banners[index]), 320, 68, 600);
            const texture = new this.THREE.CanvasTexture(canvas);
            texture.colorSpace = this.THREE.SRGBColorSpace;
            this.textures.set(key, texture);
            this.materials.set(
                key,
                new this.THREE.MeshBasicMaterial({ map: texture, side: this.THREE.DoubleSide }),
            );
        }
        return this.materials.get(key);
    }

    applyVenue() {
        const venue = this.venueSchool.venue,
            color = new this.THREE.Color();
        for (const [channel, material] of this.venueMaterials) material.color.set(venue[channel]);
        this.scene.background.set(venue.fog.color);
        this.groundMaterial?.color.set(venue.fog.color); // 바닥도 안개색과 같아야 먼 곳에서 이음매가 안 보인다.
        this.scene.fog.color.set(venue.fog.color);
        this.scene.fog.near = venue.fog.near;
        this.scene.fog.far = venue.fog.far;
        const bodies = this.crowd[0];
        for (let i = 0; i < bodies.count; i++)
            bodies.setColorAt(i, color.set(venue.shirts[i % venue.shirts.length]));
        bodies.instanceColor.needsUpdate = true;
        this.venueBanners.forEach((banner, index) => {
            banner.material = this.bannerMaterial(index);
        });
    }

    geometry(key, factory) {
        if (!this.geometries.has(key)) this.geometries.set(key, factory());
        return this.geometries.get(key);
    }

    mesh(geometry, material, parent = this.scene) {
        const mesh = new this.THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        return mesh;
    }

    box(width, height, depth, color, x = 0, y = 0, z = 0, parent = this.scene) {
        const geometry = this.geometry(
            `box:${width}:${height}:${depth}`,
            () => new this.THREE.BoxGeometry(width, height, depth),
        );
        const mesh = this.mesh(
            geometry,
            typeof color === 'object' ? color : this.material(color),
            parent,
        );
        mesh.position.set(x, y, z);
        return mesh;
    }

    makeLights() {
        const THREE = this.THREE;
        this.scene.add(new THREE.HemisphereLight(0xfffcf0, 0x91a586, 2.05));
        this.sun = new THREE.DirectionalLight(0xfff4dc, 3.05);
        this.sun.position.set(-8, 17, 8);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024);
        Object.assign(this.sun.shadow.camera, {
            left: -14,
            right: 14,
            top: 13,
            bottom: -13,
            near: 0.5,
            far: 42,
        });
        this.sun.shadow.bias = -0.0003;
        this.sun.shadow.normalBias = 0.025;
        this.sun.shadow.radius = 3;
        this.scene.add(this.sun);
        const fill = new THREE.DirectionalLight(0xe4f6ed, 0.65);
        fill.position.set(8, 9, -6);
        this.scene.add(fill);
    }

    makeCourt() {
        const T = this.THREE,
            { halfLength: x, halfWidth: z } = this.config.court;
        // 정적 구조물은 같은 렌더 상태끼리 정점 색 geometry 하나로 합친다(DEV-034). 학교에 따라 색이 바뀌는 코트·코트 안쪽·선은 색 채널 재질을 그대로 두고 채널마다 하나로 합친다.
        const scenery = (this.scenery = new PartList(T)),
            lines = new PartList(T),
            rings = new PartList(T);
        this.groundMaterial = this.material(0xe8eee3);
        const ground = this.mesh(new T.PlaneGeometry(160, 160), this.groundMaterial);
        this.geometries.set('ground', ground.geometry);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.26;
        ground.castShadow = false;
        scenery.box(17.6, 0.22, 10.0, 0xd7d6bc, 0, -0.145, 0);
        scenery.box(17.45, 0.055, 9.85, 0xece7d4, 0, -0.02, 0);
        scenery.box(x * 2 + 0.28, 0.018, z * 2 + 0.28, 0x2f6257, 0, 0.016, 0);
        this.box(x, 0.018, z * 2, this.venueMaterial('court'), -x / 2, 0.028, 0);
        this.box(x, 0.018, z * 2, this.venueMaterial('courtInset'), x / 2, 0.028, 0);
        for (const side of [-1, 1]) {
            lines.box(0.035, 0.007, z * 2, 0xffffff, side * x, 0.043, 0);
            lines.box(x * 2, 0.007, 0.035, 0xffffff, 0, 0.043, side * z);
            rings.add(
                rings.geometry('serve-ring', () => new T.RingGeometry(0.27, 0.3, 48)),
                0xffffff,
                { position: [side * 4.25, 0.047, 0], rotation: [-Math.PI / 2, 0, 0] },
            );
            for (const corner of [-1, 1]) {
                const start =
                    side < 0
                        ? corner < 0
                            ? Math.PI
                            : Math.PI * 0.5
                        : corner < 0
                          ? Math.PI * 1.5
                          : 0;
                rings.add(
                    rings.geometry(
                        `quarter:${side}:${corner}`,
                        () => new T.RingGeometry(0.87, 0.9, 30, 1, start, Math.PI * 0.5),
                    ),
                    0xffffff,
                    { position: [0, 0.046, corner * z], rotation: [-Math.PI / 2, 0, 0] },
                );
            }
        }
        lines.box(0.025, 0.006, z * 2, 0xffffff, 0, 0.044, 0);
        // 선 상자는 그림자를 드리우고 서브 원·모서리 호는 드리우지 않아(받기만 한다) 두 묶음으로 나눈다.
        const lineMaterial = this.venueMaterial('line');
        for (const [name, list, cast] of [
            ['court-lines', lines, true],
            ['court-rings', rings, false],
        ]) {
            const geometry = list.build();
            this.geometries.set(name, geometry);
            this.mesh(geometry, lineMaterial).castShadow = cast;
        }
        // 그물·테이프·기둥의 경계는 물리 충돌체와 같은 값(takrawNetShape)에서 파생한다. 그물로 보이는 면이 공이 막히는 면이다.
        const { net, post } = this.netShape;
        const netPositions = [];
        for (let i = 0; i <= 50; i++) {
            const depth = -net.halfWidth + (net.halfWidth * 2 * i) / 50;
            netPositions.push(0, net.bottomY, depth, 0, net.topY, depth);
        }
        for (let i = 0; i <= 7; i++) {
            const y = net.bottomY + ((net.topY - net.bottomY) * i) / 7;
            netPositions.push(0, y, -net.halfWidth, 0, y, net.halfWidth);
        }
        const netGeometry = new T.BufferGeometry();
        netGeometry.setAttribute('position', new T.Float32BufferAttribute(netPositions, 3));
        const netMaterial = new T.LineBasicMaterial({
            color: 0x28433e,
            transparent: true,
            opacity: 0.32,
        });
        this.geometries.set('net', netGeometry);
        this.materials.set('net', netMaterial);
        this.scene.add(new T.LineSegments(netGeometry, netMaterial));
        // 위·아래 테이프는 그물 경계 안쪽에 앉고, 좌우로는 기둥 면까지 이어진다(그물 끝과 기둥 사이 틈은 공이 지나가지 못할 만큼 좁다).
        const tapeWidth = (post.z - post.radius) * 2,
            topTape = { thickness: 0.035, height: 0.045 },
            bottomTape = { thickness: 0.018, height: 0.014 };
        scenery.box(
            topTape.thickness,
            topTape.height,
            tapeWidth,
            0xffffef,
            0,
            net.topY - topTape.height / 2,
            0,
        );
        scenery.box(
            bottomTape.thickness,
            bottomTape.height,
            tapeWidth,
            0xe7e8d8,
            0,
            net.bottomY + bottomTape.height / 2,
            0,
        );
        for (const side of [-1, 1]) {
            // 기둥은 물리 캡슐(반지름·길이·높이)과 같은 치수다. 위 끝은 캡슐의 둥근 끝을 구로 그린다.
            scenery.cylinder(
                post.radius,
                post.halfLength * 2,
                0xfaf4de,
                0,
                post.centerY,
                side * post.z,
            );
            scenery.cylinder(post.radius * 1.1, 0.36, 0x276e60, 0, 0.18, side * post.z);
            scenery.sphere(post.radius, 0xf7f2dc, 0, post.centerY + post.halfLength, side * post.z);
            scenery.box(0.035, 0.26, 0.035, 0xe69569, 0, net.topY + 0.085, side * net.halfWidth);
        }
        for (const side of [-1, 1]) {
            scenery.box(15.2, 0.018, 0.065, 0xc1c7ae, 0, 0.014, side * 4.3);
            for (let i = 0; i < 6; i++)
                scenery.box(0.18, 0.015, 0.05, 0xc1c7ae, -6.8 + i * 2.7, 0.012, side * 4.55);
        }
    }

    makeSurroundings() {
        const T = this.THREE,
            scenery = this.scenery;
        // Small bleachers leave the court and ball as the strongest shapes.
        for (let row = 0; row < 3; row++) {
            const z = -5.0 - row * 0.58,
                y = 0.12 + row * 0.25;
            scenery.box(10.4, 0.18, 0.48, row === 0 ? 0xd4d1b9 : 0xdad8c2, -0.3, y, z);
            scenery.box(
                10.3,
                0.04,
                0.35,
                row === 0 ? 0x92b4a2 : 0xa1baaa,
                -0.3,
                y + 0.115,
                z - 0.04,
            );
            for (const x of [-4.4, 3.8])
                scenery.box(0.12, y + 0.25, 0.16, 0xc2c6ad, x, (y + 0.25) / 2 - 0.1, z);
        }
        const bodyGeometry = this.geometry(
            'crowd-body',
            () => new T.CapsuleGeometry(0.1, 0.18, 3, 6),
        );
        const headGeometry = this.geometry('crowd-head', () => new T.SphereGeometry(0.103, 8, 6));
        const crowdMaterial = this.material(0xffffff);
        const count = 25;
        const bodies = new T.InstancedMesh(bodyGeometry, crowdMaterial, count);
        const heads = new T.InstancedMesh(headGeometry, crowdMaterial, count);
        bodies.castShadow = true;
        heads.castShadow = true;
        const object = new T.Object3D(),
            color = new T.Color();
        const shirts = this.venueSchool.venue.shirts;
        for (let i = 0; i < count; i++) {
            const row = Math.floor(i / 9);
            const x = -4.6 + (i % 9) * 1.05 + (row === 1 ? 0.22 : 0);
            const z = -5.08 - row * 0.58;
            const y = 0.46 + row * 0.25;
            object.position.set(x, y, z);
            object.rotation.set(0.06, ((i % 3) - 1) * 0.25, 0);
            object.scale.set(1, 1, 1);
            object.updateMatrix();
            bodies.setMatrixAt(i, object.matrix);
            bodies.setColorAt(i, color.set(shirts[i % shirts.length]));
            object.position.y += 0.21;
            object.updateMatrix();
            heads.setMatrixAt(i, object.matrix);
            heads.setColorAt(i, color.set(i % 4 ? 0xd4b695 : 0xa88061));
        }
        this.scene.add(bodies, heads);
        this.crowd = [bodies, heads];
        this.crowdBase = this.crowd.map((mesh) => mesh.instanceMatrix.array.slice());
        this.crowdCheerAt = null;
        // Far-side rail and the low entrance opening.
        for (let i = -5; i <= 5; i++)
            scenery.cylinder(0.025, 0.95, 0xb4c3ad, i * 1.05, 0.25, -7.05);
        for (const height of [0.18, 0.68]) {
            scenery.cylinder(0.021, 10.5, 0xb4c3ad, 0, height, -7.05, {
                rotation: [0, 0, Math.PI / 2],
            });
        }
        for (const side of [-1, 1]) {
            const x = side * 8.7;
            scenery.box(1.02, 0.34, 0.38, 0x5b8471, x, 0.03, -3.2);
            scenery.box(0.92, 0.03, 0.3, 0xb4c3a9, x, 0.215, -3.2);
            scenery.box(0.06, 0.34, 0.06, 0xaebaa0, x - 0.35, -0.06, -3.2);
            scenery.box(0.06, 0.34, 0.06, 0xaebaa0, x + 0.35, -0.06, -3.2);
            scenery.cylinder(0.035, 3.3, 0xc7cdb6, x, 1.4, -5.5);
            scenery.box(0.7, 0.08, 0.25, 0xe5e8d2, x, 3.04, -5.5);
            scenery.box(0.63, 0.02, 0.21, 0xffffe6, x, 2.99, -5.5);
        }
        const trees = [
            [-10, -7, 1.0],
            [9.8, -8, 1.2],
            [-11, 3, 1.15],
            [11.6, 2.4, 0.92],
            [-7.7, -10.5, 0.87],
            [7.7, -11, 0.82],
        ];
        for (let index = 0; index < trees.length; index++) {
            const [x, z, s] = trees[index];
            scenery.cylinder(0.11 * s, 1.6 * s, 0xb1a17d, x, 0.45 * s, z);
            scenery.sphere(0.78 * s, index % 2 ? 0x9bb792 : 0xa9bd91, x, 1.5 * s, z, {
                segments: 9,
            });
            scenery.sphere(0.57 * s, 0xb4c69d, x + 0.4 * s, 1.9 * s, z - 0.1 * s, { segments: 9 });
            scenery.sphere(0.53 * s, 0x98b28c, x - 0.38 * s, 1.68 * s, z + 0.17 * s, {
                segments: 9,
            });
        }
        for (const side of [-1, 1]) {
            const sign = new T.Object3D();
            sign.position.set(side * 7.8, 0.2, -5.0);
            sign.rotation.y = side * 0.12;
            sign.updateMatrix();
            const parent = { parent: sign.matrix };
            scenery.box(1.1, 0.55, 0.08, 0xe3dfc8, 0, 0.2, 0, parent);
            scenery.box(0.86, 0.36, 0.015, side < 0 ? 0x5b8e78 : 0xb98e70, 0, 0.21, 0.05, parent);
            for (let i = 0; i < 3; i++)
                scenery.box(0.12, 0.035, 0.01, 0xf5f0d9, -0.24 + i * 0.24, 0.21, 0.061, parent);
            scenery.box(0.055, 0.6, 0.055, 0xacb39b, -0.35, -0.05, 0, parent);
            scenery.box(0.055, 0.6, 0.055, 0xacb39b, 0.35, -0.05, 0, parent);
        }
        // 위 구조물 전체(코트 바닥 단·테이프·기둥·관중석·난간·출입구·가로등·나무·안내판)가 정점 색 재질 하나, 드로우콜 하나다.
        const geometry = scenery.build();
        this.geometries.set('scenery', geometry);
        this.mesh(geometry, this.material(0xffffff, { vertexColors: true }));
    }

    makeMarkers() {
        const T = this.THREE;
        // 선수·공 표시와 받기·공격 안내는 인스턴스 레이어 셋이다(markers.js). 여기에는 선·궤적만 남는다.
        const heightMaterial = new T.LineDashedMaterial({
            color: 0xffefba,
            transparent: true,
            opacity: 0.62,
            dashSize: 0.12,
            gapSize: 0.09,
            depthWrite: false,
            depthTest: false,
        });
        this.materials.set('ballHeight', heightMaterial);
        this.heightData = new Float32Array(6);
        this.heightDistances = new Float32Array(2);
        this.heightGeometry = new T.BufferGeometry();
        this.heightGeometry.setAttribute('position', new T.BufferAttribute(this.heightData, 3));
        this.heightGeometry.setAttribute(
            'lineDistance',
            new T.BufferAttribute(this.heightDistances, 1),
        );
        this.geometries.set('ballHeight', this.heightGeometry);
        this.ballHeight = new T.Line(this.heightGeometry, heightMaterial);
        this.ballHeight.frustumCulled = false;
        this.ballHeight.renderOrder = 3;
        this.scene.add(this.ballHeight);
        this.heightTickData = new Float32Array(16 * 6);
        this.heightTickGeometry = new T.BufferGeometry();
        this.heightTickGeometry.setAttribute(
            'position',
            new T.BufferAttribute(this.heightTickData, 3),
        );
        this.heightTickGeometry.setDrawRange(0, 0);
        this.geometries.set('ballHeightTicks', this.heightTickGeometry);
        const tickMaterial = new T.LineBasicMaterial({
            color: 0xffefba,
            transparent: true,
            opacity: 0.75,
            depthWrite: false,
            depthTest: false,
        });
        this.materials.set('ballHeightTicks', tickMaterial);
        this.ballHeightTicks = new T.LineSegments(this.heightTickGeometry, tickMaterial);
        this.ballHeightTicks.frustumCulled = false;
        this.ballHeightTicks.renderOrder = 3;
        this.scene.add(this.ballHeightTicks);
        this.trailData = new Float32Array(20 * 3);
        this.trailGeometry = new T.BufferGeometry();
        this.trailGeometry.setAttribute('position', new T.BufferAttribute(this.trailData, 3));
        this.trailGeometry.setDrawRange(0, 0);
        this.geometries.set('ballTrail', this.trailGeometry);
        this.trailMaterial = new T.LineBasicMaterial({
            color: 0xffdf92,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
        });
        this.materials.set('ballTrail', this.trailMaterial);
        this.trail = new T.Line(this.trailGeometry, this.trailMaterial);
        this.trail.frustumCulled = false;
        this.scene.add(this.trail);
        this.trailCount = 0;
        this.trailLast = new T.Vector3();
        this.markers = new TakrawMarkers({
            THREE: T,
            scene: this.scene,
            config: this.config,
            view: this,
        });
    }

    bodyGeometry(entity) {
        const T = this.THREE;
        if (entity.shape === 'sphere')
            return this.geometry(
                `entitySphere:${entity.radius}`,
                () => new T.SphereGeometry(entity.radius, 16, 12),
            );
        if (entity.shape === 'capsule')
            return this.geometry(
                `entityCapsule:${entity.radius}:${entity.halfHeight}`,
                () => new T.CapsuleGeometry(entity.radius, entity.halfHeight * 2, 4, 10),
            );
        const size = entity.halfExtents;
        return this.geometry(`entityBox:${size.x}:${size.y}:${size.z}`, () => {
            const radius = Math.min(size.x, size.y, size.z) * 0.28;
            const w = size.x * 2 - radius,
                h = size.y * 2 - radius,
                d = size.z * 2 - radius;
            const shape = new T.Shape();
            const r = radius,
                l = -w / 2,
                b = -h / 2;
            shape.moveTo(l + r, b);
            shape.lineTo(l + w - r, b);
            shape.quadraticCurveTo(l + w, b, l + w, b + r);
            shape.lineTo(l + w, b + h - r);
            shape.quadraticCurveTo(l + w, b + h, l + w - r, b + h);
            shape.lineTo(l + r, b + h);
            shape.quadraticCurveTo(l, b + h, l, b + h - r);
            shape.lineTo(l, b + r);
            shape.quadraticCurveTo(l, b, l + r, b);
            const geometry = new T.ExtrudeGeometry(shape, {
                depth: d,
                bevelEnabled: true,
                bevelSegments: 2,
                steps: 1,
                bevelSize: radius / 2,
                bevelThickness: radius / 2,
                curveSegments: 3,
            });
            geometry.center();
            return geometry;
        });
    }

    /** 공 본체(구)와 줄무늬 토러스 6개를 정점 색 geometry 하나로 합친다. */
    ballGeometry(entity) {
        const T = this.THREE,
            radius = entity.radius,
            parts = new PartList(T);
        parts.add(this.bodyGeometry(entity), 0xffe3a0);
        const ribbon = parts.geometry(
            'ribbon',
            () => new T.TorusGeometry(radius * 0.995, radius * 0.036, 4, 36),
        );
        for (let i = 0; i < 6; i++)
            parts.add(ribbon, 0xb78d44, {
                rotation: [(i * Math.PI) / 6, (i * Math.PI) / 3, (i * Math.PI) / 5],
            });
        return parts.build();
    }

    /** 부위의 표시 반길이(다리 늘어남)를 부위 뼈에 적는다. 값이 없거나 0 이하이면 이전 값을 둔다. 다리가 아닌 부위의 값은 쓰지 않는다. */
    stretchPart(holder, halfHeight) {
        if (Number.isFinite(halfHeight) && halfHeight > 0) holder.userData.halfHeight = halfHeight;
    }

    setSchools(schools) {
        if (schools.every((school, i) => school === this.schools[i])) return;
        this.schools = schools;
        this.impacts?.setElements(schools.map((school) => school.element));
        this.applyVenue();
        // 정점 색·머리 모양·등번호 아틀라스를 새 학교로 다시 쓴다. 부위 뼈(포즈)는 그대로다.
        this.players.paint(schools);
    }

    /** 처음 보는 물리 부위가 있으면 선수 6명 전부를 한 번에 만들고 부위 뼈를 meshes에 등록한다. */
    addPlayers(entities) {
        const bodies = entities.filter((entity) => entity.kind === 'body');
        for (const [id, bone] of this.players.build(bodies, this.schools))
            this.meshes.set(id, bone);
    }

    createBall(entity) {
        const group = new this.THREE.Group();
        this.scene.add(group);
        group.userData.entity = entity;
        // 본체와 줄무늬 6개는 정점 색 geometry 하나다(드로우콜 1). 줄무늬도 본체 재질(roughness 0.66)로 그린다.
        this.mesh(
            this.geometry(`ball:${entity.radius}`, () => this.ballGeometry(entity)),
            this.material(0xffffff, { roughness: 0.66, vertexColors: true }),
            group,
        );
        this.meshes.set(entity.id, group);
        return group;
    }

    /** 시스템의 동작 줄이기 설정. 켜져 있으면 정지·진동 효과를 쓰지 않는다. */
    reducedMotion() {
        return !!this.motionQuery?.matches;
    }

    orbitBy(deltaX, deltaY) {
        if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
        const s = this.config.visual.camera.orbit,
            orbit = this.cameraRig.orbit;
        const yaw = orbit.yaw - deltaX * s.sensitivity;
        orbit.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
        orbit.pitch = Math.max(
            s.minPitch,
            Math.min(s.maxPitch, orbit.pitch + deltaY * s.sensitivity),
        );
    }

    resetCamera() {
        const s = this.config.visual.camera;
        this.cameraRig.orbit.yaw = 0;
        this.cameraRig.orbit.pitch = Math.atan2(s.elevation, s.distance);
    }

    /** 다음 렌더에서 카메라가 시간 보간 없이 현재 대상 위치로 곧장 간다. 확인용 장면이 같은 틱에서 같은 구도를 얻게 한다. */
    snapCamera() {
        this.cameraRig.initialized = false;
    }

    screenMovement(right, back, team = this.cameraRig.team) {
        const toward = team === 1 ? -1 : 1,
            yaw = this.cameraRig.orbit.yaw;
        const length = Math.max(1, Math.hypot(right, back));
        const cosine = Math.cos(yaw),
            sine = Math.sin(yaw);
        // The local camera turns only the submitted input. World-space movement
        // remains the shared simulation/network contract for both players.
        return {
            x: ((right * sine - back * cosine) * toward) / length,
            z: ((right * cosine + back * sine) * toward) / length,
        };
    }

    updateCamera(viewData, context, dt) {
        const s = this.config.visual.camera,
            rig = this.cameraRig;
        const mode = context.mode ?? viewData.state?.mode;
        const team = context.team === 1 ? 1 : 0;
        this.setViewTeam(team);
        const toward = team === 0 ? 1 : -1;
        const selected = viewData.state?.selected || takrawHumanPlayerIds();
        const player = this.meshes.get(`p${selected[team]}:pelvis`);
        if (!player) return;
        const ball = this.meshes.get('ball');
        rig.target.copy(player.position);
        rig.target.x += toward * s.focusAhead;
        if (ball) {
            rig.target.x += Math.max(
                -s.maxLateral,
                Math.min(s.maxLateral, (ball.position.x - rig.target.x) * s.ballWeight),
            );
            rig.target.z += Math.max(
                -s.maxLateral,
                Math.min(s.maxLateral, (ball.position.z - rig.target.z) * s.ballWeight),
            );
        }
        // Jump height stays visible against the court: never follow the pelvis or
        // ball vertically. User orbit survives framing, rallies, and viewport changes.
        rig.target.y = s.focusHeight;
        const phase = viewData.state?.phase;
        const snap =
            !rig.initialized ||
            rig.team !== team ||
            rig.mode !== mode ||
            (phase === 'ready' && rig.phase !== 'ready');
        const blend = snap ? 1 : 1 - Math.exp(-s.follow * dt);
        rig.focus.lerp(rig.target, blend);
        // 리플레이는 사용자 시점을 바꾸지 않고 그 동안만 중계 각도로 본다.
        const orbit = context.replay?.orbit || rig.orbit;
        const cosine = Math.cos(orbit.yaw),
            sine = Math.sin(orbit.yaw);
        const pitchCosine = Math.cos(orbit.pitch);
        rig.offset.set(
            -toward * cosine * pitchCosine,
            Math.sin(orbit.pitch),
            toward * sine * pitchCosine,
        );
        rig.right.set(toward * sine, 0, toward * cosine);
        rig.up.crossVectors(rig.offset, rig.right);
        const tangent = Math.tan((this.camera.fov * Math.PI) / 360);
        const topInset = this.width < s.narrowWidth ? s.narrowTopInset : s.topInset;
        const topMargin = Math.max(0.2, Math.min(s.frameMargin, 1 - (2 * topInset) / this.height));
        let distance = Math.hypot(s.distance, s.elevation);
        const include = (point, radius = 0) => {
            rig.relative.copy(point).sub(rig.focus);
            const depthOffset = rig.relative.dot(rig.offset);
            const horizontal =
                (Math.abs(rig.relative.dot(rig.right)) + radius) /
                (tangent * this.camera.aspect * s.frameMargin);
            const projectedHeight = rig.relative.dot(rig.up);
            // Preserve room below the scoreboard and rally notice, especially on
            // short landscape screens, without reducing the lower play area.
            const verticalMargin = projectedHeight > 0 ? topMargin : s.frameMargin;
            const vertical = (Math.abs(projectedHeight) + radius) / (tangent * verticalMargin);
            distance = Math.max(distance, depthOffset + Math.max(horizontal, vertical));
        };
        for (const id of pair ? selected : [selected[team]]) {
            const body = this.meshes.get(`p${id}:pelvis`);
            if (body) {
                rig.target.set(body.position.x, 0.04, body.position.z);
                include(rig.target, 0.38);
            }
            for (const part of ['head', 'footL', 'footR']) {
                const mesh = this.meshes.get(`p${id}:${part}`);
                if (mesh) include(mesh.position, 0.23);
            }
        }
        if (ball) include(ball.position, 0.28);
        for (const side of [-1, 1]) {
            rig.target.set(0, this.config.court.netHeight, side * this.netShape.post.z);
            include(rig.target, 0.1);
        }
        distance = Math.min(s.maxDistance, distance);
        // Move out promptly to keep incoming balls visible; move back in gently.
        const zoomBlend = snap || distance > rig.distance ? 1 : blend;
        rig.distance += (distance - rig.distance) * zoomBlend;
        this.camera.position.copy(rig.focus).addScaledVector(rig.offset, rig.distance);
        this.camera.lookAt(rig.focus);
        this.camera.updateMatrixWorld();
        rig.initialized = true;
        rig.team = team;
        rig.mode = mode;
        rig.phase = phase;
    }

    startCheer(now) {
        if (!this.reducedMotion()) this.crowdCheerAt = now;
    }

    resetCheer() {
        this.crowd.forEach((mesh, group) => {
            mesh.instanceMatrix.array.set(this.crowdBase[group]);
            mesh.instanceMatrix.needsUpdate = true;
        });
        this.crowdCheerAt = null;
    }

    updateCrowd(now) {
        if (this.crowdCheerAt === null) return;
        const age = Math.max(0, now - this.crowdCheerAt);
        if (age >= 500 || this.reducedMotion()) {
            this.resetCheer();
            return;
        }
        this.crowd.forEach((mesh, group) => {
            const array = mesh.instanceMatrix.array,
                base = this.crowdBase[group];
            for (let i = 0; i < mesh.count; i++) {
                const phase = Math.max(0, Math.min(1, (age - (i % 5) * 18) / 360));
                array[i * 16 + 13] = base[i * 16 + 13] + Math.sin(Math.PI * phase) * 0.15;
            }
            mesh.instanceMatrix.needsUpdate = true;
        });
    }

    render(presentationFrame, viewData, nowMs, context = {}) {
        if (!viewData) return;
        this.renderStats.begin();
        const dt = Math.min(0.05, Math.max(0, (nowMs - this.lastMs) / 1000));
        this.lastMs = nowMs;
        for (const entity of viewData.entities)
            if (!this.meshes.has(entity.id)) {
                if (entity.kind === 'ball') this.createBall(entity);
                else this.addPlayers(viewData.entities);
            }
        // 득점 리플레이 중이면 재생 시각으로 접촉 화면 이펙트를 진행하고, 재생이 아니면 남은 것을 거둔다.
        this.replayImpacts.sync(viewData.state?.replay ?? null);
        // 표시 전용 히트스톱: 1이면 멈춘 포즈 그대로, 0~1이면 멈춘 포즈에서 지금 포즈로 따라잡는다. 멈추기 시작한 프레임에 지금 포즈를 잡아 둔다.
        const hold = this.reducedMotion() ? 0 : this.impacts.poseHold(),
            snapshot = hold > 0 && this.poseHoldValue === 0;
        this.poseHoldValue = hold;
        const apply = (model, id) => {
            const mesh = this.meshes.get(id);
            if (!mesh) return;
            if (hold > 0) {
                this.holdPose(mesh, model, hold, snapshot);
                return;
            }
            mesh.position.set(model.x, model.y, model.z);
            mesh.quaternion.set(model.qx, model.qy, model.qz, model.qw).normalize();
            this.stretchPart(mesh, model.halfHeight);
        };
        if (presentationFrame)
            this.scoreMotion.apply(
                presentationFrame,
                nowMs,
                apply,
                Boolean(TAKRAW_MODE_POLICY[context.mode]?.scoreMotion) &&
                    !context.replay &&
                    !this.reducedMotion(),
            );
        else for (const entity of viewData.entities) apply(entity, entity.id);
        if (this.width !== this.canvas.clientWidth || this.height !== this.canvas.clientHeight)
            this.resize();
        this.updateCamera(viewData, context, dt);
        this.applyShake();
        this.squashBall(viewData.state?.phase, nowMs);
        const ball = this.meshes.get('ball');
        this.markers.draw(viewData, context, ball);
        if (ball) {
            const height = Math.max(0, ball.position.y);
            this.ballHeight.visible = this.ballHeightTicks.visible = height > 0.3;
            this.heightData.set([
                ball.position.x,
                0.057,
                ball.position.z,
                ball.position.x,
                Math.max(0.057, height - 0.13),
                ball.position.z,
            ]);
            this.heightDistances[1] = Math.max(0, height - 0.187);
            this.heightGeometry.attributes.position.needsUpdate = true;
            this.heightGeometry.attributes.lineDistance.needsUpdate = true;
            const ticks = Math.min(16, Math.floor((height - 0.2) / 0.5));
            for (let i = 0; i < ticks; i++) {
                const y = (i + 1) * 0.5,
                    offset = i * 6;
                this.heightTickData.set(
                    [
                        ball.position.x,
                        y,
                        ball.position.z - 0.075,
                        ball.position.x,
                        y,
                        ball.position.z + 0.075,
                    ],
                    offset,
                );
            }
            this.heightTickGeometry.attributes.position.needsUpdate = true;
            this.heightTickGeometry.setDrawRange(0, Math.max(0, ticks) * 2);
            const distance = ball.position.distanceTo(this.trailLast);
            if (distance > 0.055) {
                if (
                    distance > 2 ||
                    viewData.state?.phase === 'ready' ||
                    viewData.state?.phase === 'point'
                )
                    this.trailCount = 0;
                this.trailData.copyWithin(3, 0, this.trailData.length - 3);
                this.trailData[0] = ball.position.x;
                this.trailData[1] = ball.position.y;
                this.trailData[2] = ball.position.z;
                this.trailCount = Math.min(20, this.trailCount + 1);
                this.trailLast.copy(ball.position);
                this.trailGeometry.attributes.position.needsUpdate = true;
                this.trailGeometry.setDrawRange(0, this.trailCount);
            }
            this.trail.visible = (viewData.state?.ballSpeed || 0) > 4 && this.trailCount > 1;
        }
        this.updateCrowd(nowMs);
        this.applyHitFlash();
        this.players.update();
        if (ball) this.updateBallMask(ball);
        this.impacts.drawCloud();
        this.field.draw();
        this.shockWave.render(this.scene, this.camera, this.impacts);
        this.renderStats.end();
    }

    /**
     * 접촉 순간 공과 닿은 부위를 잠깐 밝게. 덧그림이 아니라 물체가 밝아진다.
     * 선수 부위는 부위 뼈의 반짝임 값(RigidBatch가 emissive에 더함)이고, 공은 emissive를 켠 재질 복제본을 한 번 만들어 바꿔 끼우고 끝나면 되돌린다.
     */
    applyHitFlash() {
        const keys = this.litKeys;
        keys.clear();
        if (!this.reducedMotion()) this.impacts.collectFlash(keys);
        for (const id of this.lit)
            if (!keys.has(id)) {
                this.lit.delete(id);
                this.setLit(id, false);
            }
        for (const id of keys)
            if (!this.lit.has(id) && this.meshes.has(id)) {
                this.lit.add(id);
                this.setLit(id, true);
            }
    }

    setLit(id, on) {
        if (this.players.has(id)) {
            this.players.setGlow(id, on);
            return;
        }
        const group = this.meshes.get(id);
        if (!group) return;
        group.traverse((child) => {
            if (!child.isMesh) return;
            if (on) {
                if (!child.material.emissive) return;
                child.userData.plainMaterial = child.material;
                if (!this.litMaterials.has(child.material)) {
                    const lit = child.material.clone();
                    lit.emissive.setHex(0xffffff);
                    lit.emissiveIntensity = this.config.visual.impact.flash.glow;
                    this.litMaterials.set(child.material, lit);
                }
                child.material = this.litMaterials.get(child.material);
            } else if (child.userData.plainMaterial) {
                child.material = child.userData.plainMaterial;
                child.userData.plainMaterial = null;
            }
        });
    }

    /**
     * 공의 화면 원판을 입자 구름에 알린다(그리는 버퍼 픽셀). 구름은 이 원판 안을 그리지 않으므로 어느 카메라에서도 공이 가려지지 않는다.
     * 반지름은 공 반지름(눌림·늘어남의 가장 긴 축 포함)의 impactElements.ballMask배다. 카메라 뒤이면 0이다.
     * 같은 자리에서 쇼크웨이브가 공 후광 둘레를 밀지 않게 알린다.
     */
    updateBallMask(ball) {
        const camera = this.camera,
            point = this.temp.vector.copy(ball.position).applyMatrix4(camera.matrixWorldInverse),
            depth = -point.z;
        if (depth < camera.near) {
            this.impacts.setBallMask(0, 0, 0);
            this.shockWave.setKeepOut(0, 0, 0);
            return;
        }
        const ratio = this.renderer.getPixelRatio(),
            radius = ball.userData.entity?.radius ?? 0.095,
            pixels =
                ((radius * this.config.visual.impactElements.ballMask * this.ballExtent) /
                    (2 * depth * Math.tan((camera.fov * Math.PI) / 360))) *
                this.height *
                ratio;
        point.copy(ball.position).project(camera);
        // 쇼크웨이브가 밀지 않을 둘레: 공 후광(바깥 반지름 0.14m 또는 7px 중 큰 쪽, 늘어남 포함)에 여유를 더한다.
        const upp = (2 * Math.max(1, depth) * Math.tan((camera.fov * Math.PI) / 360)) / this.height,
            keep =
                (Math.max(0.14 / upp, 7) * this.ballScreenStretch.along * 1.25 + 3) / this.height;
        this.shockWave.setKeepOut((point.x + 1) / 2, (point.y + 1) / 2, keep);
        this.impacts.setBallMask(
            ((point.x + 1) / 2) * this.width * ratio,
            ((point.y + 1) / 2) * this.height * ratio,
            pixels,
        );
    }

    /**
     * 확인용 장면이 방금 그린 장면을 고정 카메라로 다시 그린다. 다음 render()는 평소 카메라로 돌아간다.
     * 공 테두리·높이선·받기/공격 안내·선택 표시는 경기 카메라를 향해 놓인 안내라 다른 각도에서는 어긋나 보이므로 이 그림에서만 뺀다.
     */
    renderFrom({ position, target, fov }) {
        const guides = [this.ballHeight, this.ballHeightTicks];
        const shown = guides.map((guide) => guide.visible);
        for (const guide of guides) guide.visible = false;
        this.camera.position.set(position.x, position.y, position.z);
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
        this.camera.lookAt(target.x, target.y, target.z);
        this.camera.updateMatrixWorld();
        const ball = this.meshes.get('ball');
        if (ball) this.updateBallMask(ball);
        this.impacts.drawCloud();
        this.field.draw();
        this.markers.withoutGuides(() =>
            this.shockWave.render(this.scene, this.camera, this.impacts),
        );
        guides.forEach((guide, index) => {
            guide.visible = shown[index];
        });
    }

    /** 마지막으로 그린 카메라에서 공의 화면 위치(CSS px). 확인용 장면이 캡처를 자를 때 읽는다. */
    ballScreen() {
        const ball = this.meshes.get('ball');
        if (!ball) return null;
        const point = ball.position.clone().project(this.camera);
        return {
            x: Math.round(((point.x + 1) / 2) * this.width),
            y: Math.round(((1 - point.y) / 2) * this.height),
        };
    }

    /** 화면에 그려진 공의 위치(월드 좌표). 확인용 장면이 카메라를 맞출 때 읽는다. */
    ballPosition() {
        const ball = this.meshes.get('ball');
        return ball ? { x: ball.position.x, y: ball.position.y, z: ball.position.z } : null;
    }

    /** 히트스톱 중 한 물체의 포즈: 잡아 둔 포즈와 지금 포즈를 1-hold 비율로 섞는다(hold 1이면 그대로 멈춤). */
    holdPose(mesh, model, hold, snapshot) {
        let held = mesh.userData.heldPose;
        if (!held) {
            held = mesh.userData.heldPose = {
                position: mesh.position.clone(),
                quaternion: mesh.quaternion.clone(),
            };
        } else if (snapshot) {
            held.position.copy(mesh.position);
            held.quaternion.copy(mesh.quaternion);
        }
        const follow = 1 - hold,
            target = this.temp.quaternion.set(model.qx, model.qy, model.qz, model.qw).normalize();
        mesh.position.set(model.x, model.y, model.z);
        mesh.position.lerpVectors(held.position, mesh.position, follow);
        mesh.quaternion.slerpQuaternions(held.quaternion, target, follow);
        if (follow > 0) this.stretchPart(mesh, model.halfHeight);
    }

    /** 공의 표시 속도를 갱신한다. 준비·득점 단계나 한 프레임에 resetDistance보다 멀리 가면(순간이동·롤백·리플레이 시작) 속도를 지운다. */
    updateBallMotion(ball, phase, nowMs) {
        const motion = this.ballMotion,
            s = this.config.visual.ball.stretch;
        const dt = motion.lastMs === null ? 0 : (nowMs - motion.lastMs) / 1000;
        if (
            motion.lastMs === null ||
            phase === 'ready' ||
            phase === 'point' ||
            ball.position.distanceTo(motion.last) > s.resetDistance
        )
            motion.velocity.set(0, 0, 0);
        else if (dt > 0) {
            motion.sample.subVectors(ball.position, motion.last).divideScalar(dt);
            motion.velocity.lerp(motion.sample, 1 - Math.exp(-dt / s.smoothing));
        }
        motion.last.copy(ball.position);
        motion.lastMs = nowMs;
    }

    /** 부피 보존 축 스케일: axis 방향 along배, 수직 방향 1/sqrt(along)배. S = across·I + (along - across)·a·aᵀ. */
    axisScale(out, axis, along) {
        const across = 1 / Math.sqrt(along),
            k = along - across;
        const { x, y, z } = axis;
        return out.set(
            across + k * x * x,
            k * x * y,
            k * x * z,
            0,
            k * x * y,
            across + k * y * y,
            k * y * z,
            0,
            k * x * z,
            k * y * z,
            across + k * z * z,
            0,
            0,
            0,
            0,
            1,
        );
    }

    /**
     * 공의 외형 변형: 맞은 방향으로 눌렸다 되돌아오고(접촉 눌림), 빠르게 날 때 진행 방향으로 늘어난다(비행 늘어남, visual.ball.stretch).
     * 위치·회전은 물리 값 그대로 두고 월드 축 기준 비균일 스케일만 행렬에 곱한다. 두 변형 모두 부피를 보존하며 collider·판정은 그대로다.
     */
    squashBall(phase, nowMs) {
        const ball = this.meshes.get('ball');
        if (!ball) return;
        this.updateBallMotion(ball, phase, nowMs);
        const reduced = this.reducedMotion();
        const { axis, amount } = reduced ? NO_DEFORM : this.impacts.deform();
        const s = this.config.visual.ball.stretch,
            velocity = this.ballMotion.velocity;
        const fast = reduced
            ? 0
            : Math.min(
                  1,
                  Math.max(0, (velocity.length() - s.minSpeed) / (s.maxSpeed - s.minSpeed)),
              );
        const along = 1 + (s.max - 1) * fast,
            squashAlong = amount ? Math.max(0.55, 1 - amount) : 1;
        // 공 원판의 가장 큰 배율(눌림·늘어남의 가장 긴 축): 입자 구름 가림 방지 원판이 쓴다.
        this.ballExtent = Math.max(squashAlong, 1 / Math.sqrt(squashAlong)) * along;
        // 화면 평면에 비친 늘어남: 카메라 쪽으로 날아오면 원근상 덜 늘어나 보인다.
        const screen = this.ballScreenStretch;
        screen.along = 1;
        if (along !== 1) {
            const right = this.temp.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion),
                up = this.temp.up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
            const x = velocity.dot(right),
                y = velocity.dot(up),
                share = Math.hypot(x, y) / Math.max(1e-6, velocity.length());
            screen.along = 1 + (along - 1) * share;
            screen.angle = Math.atan2(y, x);
        }
        if (!amount && along === 1) {
            if (!ball.matrixAutoUpdate) {
                ball.matrixAutoUpdate = true;
                ball.matrixWorldNeedsUpdate = true;
            }
            return;
        }
        const transform = this.ballTransform;
        if (amount) this.axisScale(transform.squash, axis, squashAlong);
        else transform.squash.identity();
        if (along !== 1)
            this.axisScale(
                transform.stretch,
                transform.direction.copy(velocity).normalize(),
                along,
            );
        else transform.stretch.identity();
        transform.rotation.makeRotationFromQuaternion(ball.quaternion);
        ball.matrixAutoUpdate = false;
        ball.matrix
            .copy(transform.squash)
            .multiply(transform.stretch)
            .multiply(transform.rotation)
            .setPosition(ball.position);
        ball.matrixWorldNeedsUpdate = true;
    }

    /** 카메라를 화면 평면에서 짧게 흔든다. 위치만 바꾸므로 조준·입력·시뮬레이션에 영향이 없다. */
    applyShake() {
        // 화면 펀치: 시야각을 잠깐 줄여 확대한다. 기준 시야각은 resize가 정한다.
        const fov = this.baseFov * (1 - (this.reducedMotion() ? 0 : this.impacts.punch()));
        if (Math.abs(fov - this.camera.fov) > 1e-4) {
            this.camera.fov = fov;
            this.camera.updateProjectionMatrix();
        }
        const { x: pixelX, y: pixelY } = this.impacts.shake(this.shakeOffset),
            rig = this.cameraRig;
        if ((!pixelX && !pixelY) || this.reducedMotion()) return;
        // px → 월드: 초점 거리에서 한 픽셀이 차지하는 길이. 화면이 달라도 같은 크기로 흔들린다.
        const unitsPerPixel =
            (2 * rig.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / this.height;
        this.camera.position
            .addScaledVector(rig.right, pixelX * unitsPerPixel)
            .addScaledVector(rig.up, pixelY * unitsPerPixel);
        this.camera.updateMatrixWorld();
    }

    resize() {
        const width = Math.max(1, this.canvas.clientWidth || window.innerWidth),
            height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
        this.width = width;
        this.height = height;
        this.renderer.setPixelRatio(
            Math.min(window.devicePixelRatio || 1, this.quality === 'low' ? 1 : 1.5),
        );
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        // A narrow viewport keeps the same horizontal view instead of cutting off
        // the court or backing the camera through the sideline scenery.
        const verticalFov = (this.config.visual.camera.fov * Math.PI) / 180;
        this.baseFov =
            (2 * Math.atan(Math.tan(verticalFov / 2) / Math.min(1, this.camera.aspect)) * 180) /
            Math.PI;
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
    }

    setQuality(quality) {
        this.quality = quality === 'low' ? 'low' : 'high';
        this.renderer.shadowMap.enabled = this.quality === 'high';
        this.sun.castShadow = this.quality === 'high';
        this.resize();
        // 품질을 바꾸면 그림자 유무가 프로그램 변종 키에 들어가 다시 컴파일되므로, 경기 밖인 이 설정 순간에 미리 해 둔다.
        if (this.warmed) this.warmUp();
    }

    /**
     * 경기 중 처음 쓰는 순간에 일어날 GPU 일을 로딩 단계에서 미리 한다(DEV-032).
     * 효과 노드를 미리 만들고, three-kit의 warmUp이 숨겨 둔 것(접촉 입자·색종이·먼지·안내 표시)까지 보이게 한 장면을
     * 실제 경기와 같은 카메라·조명·그림자·안개·톤 매핑으로 컴파일한다. 쇼크웨이브 패스의 셰이더와 복사 텍스처도 이때 만든다.
     * 장면 크기(화면 크기)가 바뀌면 복사 텍스처만 다시 만들어진다(경기 밖 동작).
     */
    warmUp() {
        const warm = this.config.visual.warm;
        this.impacts.warm(warm.impacts);
        this.field.warm(warm);
        warmUp(this.renderer, this.scene, this.camera);
        this.shockWave.warm(this.scene, this.camera);
        this.warmed = true;
    }

    dispose() {
        this.impacts.dispose();
        this.shockWave.dispose();
        for (const material of this.litMaterials.values()) material.dispose();
        this.field.dispose();
        this.markers.dispose();
        this.players.dispose();
        for (const geometry of this.geometries.values()) geometry.dispose();
        for (const material of this.materials.values()) material.dispose();
        for (const texture of this.textures.values()) texture.dispose();
        this.renderer.dispose();
        this.meshes.clear();
    }
}

export { TakrawView };
