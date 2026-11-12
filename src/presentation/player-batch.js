/**
 * 선수 6명 전부를 본체 드로우 한 번과 등번호 드로우 한 번으로 그린다(DEV-034: 드로우콜이 선수 수·부위 수·장식 수가 아니라 렌더 상태 묶음 수로 정해진다).
 * 모든 선수의 모든 부위·장식 정점을 geometry 하나에 이어 붙이고 정점마다 부위 번호(takrawPart = 선수 × 물리 부위, 장식은 붙은 부위의 번호)를 단다.
 * 매 프레임 부위마다 위치·회전 행렬만 자세 텍스처에 쓰고, 정점 셰이더가 자기 부위 번호의 행렬을 읽어 위치·법선에 곱한다. 자세를 굽지 않는다(물리가 매 순간 정한다).
 *
 * 자세 텍스처: RGBA float DataTexture, 너비 4(부위 행렬의 열 4개) × 높이 부위 수(90). 열 0의 w는 부위의 현재 반길이(다리 늘어남), 열 1의 w는 접촉 반짝임 세기다.
 * uniform 배열이 아니라 텍스처인 이유: 90부위 × 행렬 4벡터 = 360벡터로 WebGL2가 보장하는 정점 uniform 최소치(256벡터)를 넘는다.
 * three.js r180은 WebGL2만 지원하고 WebGL2는 float 텍스처의 NEAREST 표본·정점 셰이더 텍스처 읽기(16장 이상)를 보장하므로 확장이 필요 없다(SkinnedMesh의 뼈 텍스처와 같은 방식).
 *
 * 다리 늘어남: 캡슐 정점마다 (원래 y, 기준 반길이, 반길이 배율 k, 위치 배율 o)를 takrawStretch로 단다. k가 0이면 늘지 않는 정점이다.
 * 셰이더가 캡은 평행이동하고 몸통은 y로 늘린다(부위 반길이 H일 때 캡슐 반길이 k·H, 중심 o·H). 양말은 k 0.3·o -0.6이다.
 */
import { takrawSlotOf } from '../simulation/roster.js';
import { PartList, mergeColored } from './merge-geometry.js';

const SKIN = Object.freeze([0xe9c49e, 0xd0a77f, 0xf1d2ac, 0xe1b88e, 0xb98a65, 0xf0c6a1]);
// 등번호 아틀라스: 선수마다 64px 칸을 128px 셀 가운데에 둔다. 셀 사이 여백이 밉맵에서 옆 번호가 번지지 않게 한다.
const NUMBER = Object.freeze({ cell: 128, tile: 64, plate: 0.19 });

/** 부위 번호·늘어남 정보를 정점마다 붙이는 PartList. slot을 바꾼 뒤 add하면 그 부위의 정점이 된다. */
class PlayerParts extends PartList {
    constructor(THREE) {
        super(THREE);
        this.slot = 0;
    }

    /** options.stretch = { base, k, o }(다리 캡슐), options.uvRect = [u0, v0, du, dv](등번호 아틀라스 칸). */
    add(geometry, color, options = {}) {
        super.add(geometry, color, options);
        Object.assign(this.parts[this.parts.length - 1], {
            slot: this.slot,
            stretch: options.stretch ?? null,
            uvRect: options.uvRect ?? null,
        });
    }

    build() {
        const T = this.THREE,
            merged = mergeColored(T, this.parts),
            count = merged.getAttribute('position').count,
            part = new Float32Array(count),
            stretch = new Float32Array(count * 4),
            uv = this.parts.some((entry) => entry.uvRect) ? new Float32Array(count * 2) : null;
        let offset = 0;
        for (const { geometry, slot, stretch: s, uvRect } of this.parts) {
            const position = geometry.getAttribute('position'),
                source = geometry.getAttribute('uv');
            for (let i = 0; i < position.count; i++) {
                const at = offset + i;
                part[at] = slot;
                if (s) {
                    stretch[at * 4] = position.getY(i);
                    stretch[at * 4 + 1] = s.base;
                    stretch[at * 4 + 2] = s.k;
                    stretch[at * 4 + 3] = s.o;
                }
                if (uv && uvRect) {
                    uv[at * 2] = uvRect[0] + source.getX(i) * uvRect[2];
                    uv[at * 2 + 1] = uvRect[1] + source.getY(i) * uvRect[3];
                }
            }
            offset += position.count;
        }
        merged.setAttribute('takrawPart', new T.BufferAttribute(part, 1));
        merged.setAttribute('takrawStretch', new T.BufferAttribute(stretch, 4));
        if (uv) {
            merged.setAttribute('uv', new T.BufferAttribute(uv, 2));
            merged.deleteAttribute('color');
        }
        for (const geometry of this.cache.values()) geometry.dispose();
        this.cache.clear();
        this.parts.length = 0;
        return merged;
    }
}

/**
 * 표준 재질(조명·그림자·안개·톤 매핑 그대로)의 셰이더에 부위 자세를 끼운다. normals면 법선도 부위 회전으로 돌리고, glow면 반짝임을 emissive에 더한다.
 * 프로그램 변종은 재질마다 하나(본체·그림자 깊이·등번호)이고 모두 로딩 때 컴파일된다(DEV-032). 반짝임·늘어남은 텍스처 값이라 define을 바꾸지 않는다.
 */
function injectPose(shader, poses, { normals = false, glow = false } = {}) {
    shader.uniforms.takrawPoses = poses;
    shader.vertexShader = shader.vertexShader
        .replace(
            'void main() {',
            `attribute float takrawPart;
attribute vec4 takrawStretch;
uniform highp sampler2D takrawPoses;
${glow ? 'varying float vTakrawGlow;\n' : ''}void main() {
    int takrawRow = int(takrawPart + 0.5);
    vec4 takrawC0 = texelFetch(takrawPoses, ivec2(0, takrawRow), 0);
    vec4 takrawC1 = texelFetch(takrawPoses, ivec2(1, takrawRow), 0);
    vec4 takrawC2 = texelFetch(takrawPoses, ivec2(2, takrawRow), 0);
    vec4 takrawC3 = texelFetch(takrawPoses, ivec2(3, takrawRow), 0);
    mat4 takrawPose = mat4(vec4(takrawC0.xyz, 0.0), vec4(takrawC1.xyz, 0.0), vec4(takrawC2.xyz, 0.0), vec4(takrawC3.xyz, 1.0));${
        glow ? '\n    vTakrawGlow = takrawC1.w;' : ''
    }`,
        )
        .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
    if (takrawStretch.z > 0.0) {
        float takrawHalf = takrawStretch.z * takrawC0.w, takrawBase = takrawStretch.y, takrawY = takrawStretch.x;
        transformed.y = (takrawY > takrawBase ? takrawY + takrawHalf - takrawBase
            : takrawY < -takrawBase ? takrawY - takrawHalf + takrawBase
            : takrawY * takrawHalf / takrawBase) + takrawStretch.w * takrawC0.w;
    }
    transformed = (takrawPose * vec4(transformed, 1.0)).xyz;`,
        );
    if (normals)
        shader.vertexShader = shader.vertexShader.replace(
            '#include <beginnormal_vertex>',
            '#include <beginnormal_vertex>\n    objectNormal = mat3(takrawPose) * objectNormal;',
        );
    if (glow)
        shader.fragmentShader = shader.fragmentShader
            .replace('void main() {', 'varying float vTakrawGlow;\nvoid main() {')
            .replace(
                'vec3 totalEmissiveRadiance = emissive;',
                'vec3 totalEmissiveRadiance = emissive + vec3(vTakrawGlow);',
            );
}

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
        this.byId = new Map();
        this.bodies = null;
        this.poses = { value: null };
        this.matrix = new T.Matrix4();
        this.unit = new T.Vector3(1, 1, 1);
        // 본체: 지금까지 부위 재질과 같은 MeshStandardMaterial(roughness 0.85)에 색만 정점 색으로 옮긴다.
        this.material = new T.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.85,
            metalness: 0,
            vertexColors: true,
        });
        this.material.onBeforeCompile = (shader) =>
            injectPose(shader, this.poses, { normals: true, glow: true });
        this.material.customProgramCacheKey = () => 'takraw-player-body';
        // 그림자 깊이: three 기본 깊이 재질과 같은 RGBA 깊이 포장에 같은 자세 주입.
        this.depthMaterial = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
        this.depthMaterial.onBeforeCompile = (shader) => injectPose(shader, this.poses);
        this.depthMaterial.customProgramCacheKey = () => 'takraw-player-depth';
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
        this.numberMaterial.onBeforeCompile = (shader) => injectPose(shader, this.poses);
        this.numberMaterial.customProgramCacheKey = () => 'takraw-player-number';
        this.body = null;
        this.numbers = null;
    }

    /**
     * 물리 부위 개체(kind 'body') 목록으로 부위 자리와 자세 보관 객체를 만든다. 한 번만 부른다.
     * 돌려준 [id, holder]의 holder(Object3D, 장면에 넣지 않음)가 그 부위의 표시 포즈다: position·quaternion과 userData.halfHeight(다리 반길이)를 view가 쓴다.
     */
    build(bodies, schools) {
        const T = this.THREE;
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
        this.parts = this.bodies.map((entity, slot) => {
            const holder = new T.Object3D(),
                valid = Number.isFinite(entity.halfHeight) && entity.halfHeight > 0;
            holder.userData.halfHeight = valid ? entity.halfHeight : entity.restHalfHeight;
            const record = { id: entity.id, slot, holder, lit: false };
            this.byId.set(entity.id, record);
            return record;
        });
        const texture = new T.DataTexture(
            new Float32Array(this.parts.length * 16),
            4,
            this.parts.length,
            T.RGBAFormat,
            T.FloatType,
        );
        this.poses.value = texture;
        this.paint(schools);
        return this.parts.map(({ id, holder }) => [id, holder]);
    }

    /** 학교(유니폼·피부·머리 모양·등번호)에 맞춰 정점 배열과 번호 아틀라스를 다시 만든다. 경기 밖 설정 시점에만 부른다. */
    paint(schools) {
        if (!this.bodies) return;
        const T = this.THREE,
            body = new PlayerParts(T),
            plates = new PlayerParts(T),
            ctx = this.numberCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.numberCanvas.width, this.numberCanvas.height);
        let plateIndex = 0;
        this.bodies.forEach((entity, slot) => {
            const school = schools[entity.team === 1 ? 1 : 0],
                { uniform, hair: hairstyle } = school,
                color = uniform.primary,
                playerId = Number((entity.id.match(/^p(\d+):/) || [0, 0])[1]),
                skin = SKIN[playerId % 6],
                part = entity.part || '';
            body.slot = plates.slot = slot;
            let surface = skin;
            if (part === 'torso' || part.startsWith('upperArm')) surface = color;
            if (part === 'pelvis' || part.startsWith('upperLeg')) surface = uniform.stripe;
            if (part.startsWith('foot')) surface = 0xfcf4d9;
            if (/^(upperLeg|lowerLeg)/.test(part)) {
                const rest = entity.restHalfHeight;
                body.add(this.shapeGeometry({ ...entity, halfHeight: rest }), surface, {
                    stretch: { base: rest, k: 1, o: 0 },
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
                const rest = entity.restHalfHeight;
                body.add(
                    body.geometry(
                        `sock:${entity.radius}:${rest}`,
                        () => new T.CapsuleGeometry(entity.radius * 1.025, rest * 0.6, 3, 10),
                    ),
                    uniform.sock,
                    {
                        position: [0, -rest * 0.6, 0],
                        stretch: { base: rest * 0.3, k: 0.3, o: -0.6 },
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
        this.body = this.replace(this.body, body.build(), this.material, true);
        this.numbers = this.replace(this.numbers, plates.build(), this.numberMaterial, false);
    }

    /** 메시의 geometry를 바꾼다(처음이면 만든다). 바인드 자세 경계는 실제 위치와 무관하므로 컬링하지 않는다. */
    replace(mesh, geometry, material, shadow) {
        if (mesh) {
            mesh.geometry.dispose();
            mesh.geometry = geometry;
            return mesh;
        }
        const created = new this.THREE.Mesh(geometry, material);
        created.frustumCulled = false;
        created.castShadow = created.receiveShadow = shadow;
        if (shadow) created.customDepthMaterial = this.depthMaterial;
        this.scene.add(created);
        return created;
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

    /** 접촉 반짝임 켜기·끄기(부위 id). 값은 다음 update()에서 자세 텍스처에 들어간다. */
    setGlow(id, on) {
        const record = this.byId.get(id);
        if (record) record.lit = on;
    }

    has(id) {
        return this.byId.has(id);
    }

    /** 부위마다 holder의 위치·회전과 다리 반길이·반짝임을 자세 텍스처에 쓴다. 프레임마다 부르고 객체를 만들지 않는다. */
    update() {
        const texture = this.poses.value;
        if (!texture) return;
        const data = texture.image.data,
            matrix = this.matrix;
        for (const { slot, holder, lit } of this.parts) {
            const at = slot * 16;
            matrix.compose(holder.position, holder.quaternion, this.unit);
            data.set(matrix.elements, at);
            data[at + 3] = holder.userData.halfHeight;
            data[at + 7] = lit ? this.glow : 0;
        }
        texture.needsUpdate = true;
    }

    dispose() {
        for (const mesh of [this.body, this.numbers]) {
            if (!mesh) continue;
            mesh.removeFromParent();
            mesh.geometry.dispose();
        }
        this.material.dispose();
        this.depthMaterial.dispose();
        this.numberMaterial.dispose();
        this.numberTexture.dispose();
        this.poses.value?.dispose();
    }
}

export { TakrawPlayerBatch };
