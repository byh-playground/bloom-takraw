/**
 * 선수 6명 전부를 본체 드로우 한 번과 등번호 드로우 한 번으로 그린다(DEV-034: 드로우콜이 선수 수·부위 수·장식 수가 아니라 렌더 상태 묶음 수로 정해진다).
 * 그리기는 three-kit의 RigidBatch(three.js 기본 SkinnedMesh)에 맡긴다: 물리 부위마다 뼈 하나, 장식은 붙은 부위의 뼈, 등번호 판은 같은 뼈대에 묶인 두 번째 메시다.
 * 부위 뼈가 곧 view.meshes의 표시 포즈다(position·quaternion·userData.halfHeight). 자세를 굽지 않는다(물리가 매 순간 정한다).
 * 그림자 깊이는 three 기본 깊이 재질의 skinning이 그리고, 직접 넣는 셰이더 코드는 RigidBatch의 부위별 반짝임(emissive 가산)뿐이다.
 *
 * 다리 늘어남: 다리 캡슐(과 양말)을 뼈 3개로 나눈다. 부위 반길이 H, 바인드 반길이 rest일 때 원래 식(캡슐 반길이 k·H, 중심 o·H, 기준 반길이 base = k·rest)은
 *   몸통(|y| ≤ base): 부위 뼈에 y 배율 H/rest(굽힌 중심 o·rest까지 포함해 같은 식이 된다)
 *   윗캡(y > base): 부위 뼈 + y 평행이동 (k + o)(H - rest), 아랫캡(y < -base): (o - k)(H - rest)
 * 와 같다. 몸통 법선은 수평(y 성분 0)이라 y 배율에 그대로이고, 캡은 평행이동뿐이라 법선은 부위 회전만 받는다. 다리는 k 1·o 0, 양말은 k 0.3·o -0.6이다.
 */
import { takrawSlotOf } from '../simulation/roster.js';
import { PartList, RigidBatch } from '@bloom-gamekit/three-kit';

const SKIN = Object.freeze([0xe9c49e, 0xd0a77f, 0xf1d2ac, 0xe1b88e, 0xb98a65, 0xf0c6a1]);
// 등번호 아틀라스: 선수마다 64px 칸을 128px 셀 가운데에 둔다. 셀 사이 여백이 밉맵에서 옆 번호가 번지지 않게 한다.
const NUMBER = Object.freeze({ cell: 128, tile: 64, plate: 0.19 });
// 늘어나는 캡슐: 다리 본체와 아랫다리 양말.
const LEG = Object.freeze({ k: 1, o: 0 });
const SOCK = Object.freeze({ k: 0.3, o: -0.6 });

class TakrawPlayerBatch {
    /**
     * @param {object} options
     * @param {object} options.THREE three.js 네임스페이스
     * @param {object} options.scene 그릴 장면
     * @param {(entity: object) => object} options.shapeGeometry 물리 부위 모양의 geometry(view.bodyGeometry, 공유 캐시라 여기서 해제하지 않는다)
     * @param {number} options.glow 접촉 반짝임의 emissive 세기(config.visual.impact.flash.glow)
     */
    constructor({ THREE, scene, shapeGeometry, glow }) {
        const T = THREE;
        this.THREE = T;
        this.scene = scene;
        this.shapeGeometry = shapeGeometry;
        this.glow = glow;
        this.parts = [];
        this.stretching = [];
        this.byId = new Map();
        this.bodies = null;
        this.batch = new RigidBatch(T);
        scene.add(this.batch.root);
        this.offset = new T.Vector3();
        // 본체: 지금까지 부위 재질과 같은 MeshStandardMaterial(roughness 0.85)에 색만 정점 색으로 옮긴다.
        this.material = this.batch.glowMaterial(
            new T.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 0.85,
                metalness: 0,
                vertexColors: true,
            }),
        );
        // 등번호: 6명 번호를 한 장 아틀라스에 그리고 판 6장을 메시 하나로(투명, 그림자 없음).
        const canvas = document.createElement('canvas');
        canvas.width = NUMBER.cell * 6;
        canvas.height = NUMBER.cell;
        this.numberCanvas = canvas;
        this.numberTexture = new T.CanvasTexture(canvas);
        this.numberTexture.colorSpace = T.SRGBColorSpace;
        this.numberMaterial = new T.MeshBasicMaterial({
            map: this.numberTexture,
            transparent: true,
            depthWrite: false,
        });
        this.body = null;
        this.numbers = null;
    }

    /**
     * 물리 부위 개체(kind 'body') 목록으로 부위 뼈를 만든다. 한 번만 부른다.
     * 돌려준 [id, bone]의 bone이 그 부위의 표시 포즈다: position·quaternion과 userData.halfHeight(다리 반길이)를 view가 쓴다.
     */
    build(bodies, schools) {
        const batch = this.batch;
        this.bodies = bodies.map(
            ({ id, part, team, shape, radius, halfHeight, halfExtents, restHalfHeight }) => ({
                id,
                part,
                team,
                shape,
                radius,
                halfHeight,
                halfExtents,
                restHalfHeight,
            }),
        );
        this.parts = this.bodies.map((entity) => {
            const index = batch.add(),
                bone = batch.bone(index),
                valid = Number.isFinite(entity.halfHeight) && entity.halfHeight > 0,
                part = entity.part || '',
                stretch = [];
            bone.userData.halfHeight = valid ? entity.halfHeight : entity.restHalfHeight;
            if (/^(upperLeg|lowerLeg)/.test(part)) stretch.push(this.capBones(LEG));
            if (part.startsWith('lowerLeg')) stretch.push(this.capBones(SOCK));
            const record = { id: entity.id, index, bone, rest: entity.restHalfHeight, stretch };
            this.byId.set(entity.id, record);
            if (stretch.length) this.stretching.push(record);
            return record;
        });
        this.paint(schools);
        return this.parts.map(({ id, bone }) => [id, bone]);
    }

    /** 늘어나는 캡슐 하나의 윗캡·아랫캡 뼈. */
    capBones({ k, o }) {
        return { k, o, top: this.batch.add(), bottom: this.batch.add() };
    }

    /** 늘어나는 캡슐(바인드 반길이 base = k·rest)의 정점을 위치로 윗캡·몸통·아랫캡 뼈에 나눈다. */
    stretchBody(record, { k, top, bottom }) {
        const base = k * record.rest,
            trunk = record.index;
        return (point) => (point.y > base ? top : point.y < -base ? bottom : trunk);
    }

    /** 학교(유니폼·피부·머리 모양·등번호)에 맞춰 정점 배열과 번호 아틀라스를 다시 만든다. 경기 밖 설정 시점에만 부른다. */
    paint(schools) {
        if (!this.bodies) return;
        const T = this.THREE,
            body = new PartList(T),
            plates = new PartList(T),
            ctx = this.numberCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.numberCanvas.width, this.numberCanvas.height);
        let plateIndex = 0;
        this.bodies.forEach((entity, slot) => {
            const school = schools[entity.team === 1 ? 1 : 0],
                { uniform, hair: hairstyle } = school,
                color = uniform.primary,
                playerId = Number((entity.id.match(/^p(\d+):/) || [0, 0])[1]),
                skin = SKIN[playerId % 6],
                part = entity.part || '',
                record = this.parts[slot];
            body.body = plates.body = record.index;
            let surface = skin;
            if (part === 'torso' || part.startsWith('upperArm')) surface = color;
            if (part === 'pelvis' || part.startsWith('upperLeg')) surface = uniform.stripe;
            if (part.startsWith('foot')) surface = 0xfcf4d9;
            if (/^(upperLeg|lowerLeg)/.test(part)) {
                body.add(this.shapeGeometry({ ...entity, halfHeight: record.rest }), surface, {
                    body: this.stretchBody(record, record.stretch[0]),
                });
            } else body.add(this.shapeGeometry(entity), surface);
            if (part === 'head') {
                const r = entity.radius,
                    shape = hairstyle.shape;
                const hair = body.geometry(
                    `hair:${r}:${shape}`,
                    () =>
                        new T.SphereGeometry(
                            r * 1.025,
                            14,
                            8,
                            0,
                            Math.PI * 2,
                            0,
                            Math.PI * (shape === 'bob' ? 0.61 : 0.45),
                        ),
                );
                body.add(hair, hairstyle.color);
                if (shape === 'crest')
                    body.box(r * 0.55, r * 0.65, r * 1.3, hairstyle.color, 0, r * 0.85, 0);
                for (const side of [-1, 1])
                    body.sphere(r * 0.105, 0x2d3c33, side * r * 0.38, r * 0.05, r * 0.93, {
                        segments: 8,
                    });
                body.sphere(r * 0.14, skin, 0, -r * 0.1, r * 0.99, {
                    segments: 8,
                    scale: [1, 0.8, 1],
                });
                body.box(r * 0.24, r * 0.035, r * 0.025, 0x9d7054, 0, -r * 0.34, r * 0.93);
            }
            if (part === 'torso') {
                const { x, y, z } = entity.halfExtents;
                for (const side of [-1, 1])
                    body.box(
                        x * 1.85,
                        y * 0.22,
                        0.014,
                        uniform.secondary,
                        0,
                        -y * 0.72,
                        side * (z + 0.005),
                    );
                this.drawNumber(
                    ctx,
                    plateIndex,
                    school.backnumber[takrawSlotOf(playerId)],
                    uniform.secondary,
                );
                plates.add(
                    plates.geometry(
                        'backnumber',
                        () => new T.PlaneGeometry(NUMBER.plate, NUMBER.plate),
                    ),
                    0xffffff,
                    {
                        position: [0, y * 0.12, -z - 0.015],
                        rotation: [0, Math.PI, 0],
                        uvRect: this.numberRect(plateIndex),
                    },
                );
                plateIndex++;
            }
            if (part.startsWith('lowerLeg')) {
                const rest = record.rest;
                body.add(
                    body.geometry(
                        `sock:${entity.radius}:${rest}`,
                        () => new T.CapsuleGeometry(entity.radius * 1.025, rest * 0.6, 3, 10),
                    ),
                    uniform.sock,
                    {
                        position: [0, SOCK.o * rest, 0],
                        body: this.stretchBody(record, record.stretch[1]),
                    },
                );
            }
            if (part.startsWith('foot')) {
                const { x, y, z } = entity.halfExtents;
                body.box(x * 1.94, y * 0.28, z * 1.92, uniform.stripe, 0, -y * 0.78, 0);
                body.box(x * 1.76, y * 0.8, z * 0.22, color, 0, y * 0.12, -z * 0.77);
                for (let i = 0; i < 2; i++)
                    body.box(x * 0.9, 0.006, 0.009, 0xbcc2ac, 0, y + 0.002, z * (0.05 + i * 0.26));
            }
        });
        this.numberTexture.needsUpdate = true;
        const bodyGeometry = body.build(),
            plateGeometry = plates.build();
        if (this.body) {
            this.batch.setGeometry(this.body, bodyGeometry);
            this.batch.setGeometry(this.numbers, plateGeometry);
            return;
        }
        this.body = this.batch.mesh(bodyGeometry, this.material);
        this.body.castShadow = this.body.receiveShadow = true;
        this.numbers = this.batch.mesh(plateGeometry, this.numberMaterial);
    }

    /** 아틀라스 칸 index의 uv 사각형 [u0, v0, du, dv]. */
    numberRect(index) {
        const { cell, tile } = NUMBER,
            pad = (cell - tile) / 2,
            width = cell * 6;
        return [(index * cell + pad) / width, pad / cell, tile / width, tile / cell];
    }

    /** 이전 선수별 64px 캔버스와 같은 글자를 아틀라스 칸에 그린다(칸 밖으로 넘치는 글자는 잘린다). */
    drawNumber(ctx, index, number, color) {
        const { cell, tile } = NUMBER,
            pad = (cell - tile) / 2;
        ctx.save();
        ctx.translate(index * cell + pad, pad);
        ctx.beginPath();
        ctx.rect(0, 0, tile, tile);
        ctx.clip();
        ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        ctx.font = 'bold 52px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(number), 32, 34);
        ctx.restore();
    }

    /** 접촉 반짝임 켜기·끄기(부위 id). 부위 뼈와 그 캡 뼈 모두에 같은 값을 준다. */
    setGlow(id, on) {
        const record = this.byId.get(id);
        if (!record) return;
        const value = on ? this.glow : 0;
        this.batch.setGlow(record.index, value);
        for (const { top, bottom } of record.stretch) {
            this.batch.setGlow(top, value);
            this.batch.setGlow(bottom, value);
        }
    }

    has(id) {
        return this.byId.has(id);
    }

    /** 다리 부위의 반길이를 몸통 뼈 y 배율과 캡 뼈 위치로 옮긴다. 프레임마다 부르고 객체를 만들지 않는다. */
    update() {
        for (const { bone, rest, stretch } of this.stretching) {
            const half = bone.userData.halfHeight,
                grow = half - rest;
            bone.scale.y = half / rest;
            for (const { k, o, top, bottom } of stretch) {
                this.placeCap(this.batch.bone(top), bone, (k + o) * grow);
                this.placeCap(this.batch.bone(bottom), bone, (o - k) * grow);
            }
        }
    }

    /** 캡 뼈 = 부위 뼈를 부위 y축으로 dy만큼 옮긴 것(배율 없음). */
    placeCap(cap, bone, dy) {
        cap.quaternion.copy(bone.quaternion);
        cap.position
            .copy(this.offset.set(0, dy, 0).applyQuaternion(bone.quaternion))
            .add(bone.position);
    }

    dispose() {
        this.batch.dispose();
        this.material.dispose();
        this.numberMaterial.dispose();
        this.numberTexture.dispose();
    }
}

export { TakrawPlayerBatch };
