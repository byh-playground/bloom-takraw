/**
 * 모양이 다른 딱딱한 물체 여러 개를 three.js `SkinnedMesh` 한 번으로 그린다(DEV-034: 드로우콜이 물체 수가 아니라 렌더 상태 묶음 수로 정해진다).
 * 물체마다 `Bone` 하나를 계층 없이 평평하게 두고, 병합 geometry의 정점마다 자기 물체 번호를 skinIndex로, 가중치 (1, 0, 0, 0)을 skinWeight로 단다.
 * 뼈는 Object3D라 위치·회전·크기를 그대로 넣으면 되고, 뼈 행렬 전달(float 텍스처라 뼈 수 한도가 없다)·조명·그림자 깊이·안개는 three.js 기본 처리다.
 * WEBGL_multi_draw 같은 확장에 기대지 않으므로 어느 WebGL2 기기에서도 메시 하나가 1 draw다.
 *
 * 좌표: 뼈의 바인드 자세는 단위 행렬이므로 정점은 root 공간 좌표로 두고, 뼈 변환이 곧 그 물체의 root 공간 변환이다(root가 움직여도 맞다).
 * 컬링: SkinnedMesh의 경계는 바인드 자세 기준이라 실제 위치를 따르지 않으므로 메시는 frustumCulled를 끈다.
 * 물체별 emissive 가산(glowMaterial·setGlow)만 기본 기능에 없어 표준 재질 셰이더에 짧게 주입한다. 주입 대상 문자열이 없으면(three 버전 변경) 오류를 낸다.
 * 게임 내용에 의존하지 않는다: three.js는 인자로 받고, 물체의 뜻(이름·설정)은 소비자가 번호로 관리한다.
 *
 * 사용 예:
 *   const batch = new RigidBatch(THREE);
 *   scene.add(batch.root);
 *   const a = batch.add(), b = batch.add();
 *   const parts = new PartList(THREE);
 *   parts.body = a; parts.box(1, 1, 1, 0xff0000);
 *   parts.body = b; parts.sphere(0.5, 0x00ff00);
 *   const material = batch.glowMaterial(new THREE.MeshStandardMaterial({ vertexColors: true }));
 *   const mesh = batch.mesh(parts.build(), material); // 몇 물체든 1 draw, 그림자는 three 기본 깊이 재질
 *   batch.bone(a).position.set(0, 1, 0); // 프레임마다 뼈를 움직이면 렌더러가 한 번에 올린다
 *   batch.setGlow(b, 0.4); // glowMaterial로 감싼 재질에서 물체 b만 밝게
 */

const GLOW_VERTEX = 'void main() {';
const GLOW_SKIN = '#include <skinbase_vertex>';
const GLOW_EMISSIVE = 'vec3 totalEmissiveRadiance = emissive;';

/** source의 target을 replacement로 바꾼다. target이 없으면 조용히 넘어가지 않고 오류를 낸다. */
function replaceRequired(source, target, replacement) {
    if (!source.includes(target))
        throw new Error(`RigidBatch: 셰이더에 주입 대상 "${target}"이 없다(three.js 버전 확인)`);
    return source.replace(target, replacement);
}

class RigidBatch {
    /** @param {object} THREE three.js 네임스페이스 */
    constructor(THREE) {
        this.THREE = THREE;
        /** 뼈와 메시를 담는 묶음. 소비자가 장면에 넣는다. */
        this.root = new THREE.Group();
        this.bones = [];
        this.skeleton = null;
        this.glowValues = null;
    }

    /** 물체 하나를 더하고 번호를 돌려준다. 뼈 수는 첫 mesh()에서 정해지므로 그 전에만 부른다. */
    add() {
        if (this.skeleton) throw new Error('RigidBatch: mesh()를 만든 뒤에는 물체를 더할 수 없다');
        const bone = new this.THREE.Bone();
        this.root.add(bone);
        this.bones.push(bone);
        return this.bones.length - 1;
    }

    /** 물체 번호의 뼈(Object3D). position·quaternion·scale에 그 물체의 변환을 쓴다. 장면 갱신 때 렌더러가 모든 뼈를 한 번에 올린다. */
    bone(index) {
        return this.bones[index];
    }

    /**
     * 물체 번호가 붙은 geometry(skinIndex·skinWeight, PartList의 body 옵션으로 만든다)를 이 묶음의 뼈대에 묶은 SkinnedMesh로 만든다.
     * 메시는 몇 개든 같은 뼈대를 쓴다(재질이 다른 층마다 하나). 첫 호출에서 뼈대를 만든다.
     */
    mesh(geometry, material) {
        const T = this.THREE;
        this.requireSkin(geometry);
        if (!this.skeleton) {
            this.skeleton = new T.Skeleton(
                this.bones,
                this.bones.map(() => new T.Matrix4()),
            );
            this.glowValues = new Float32Array(Math.ceil(this.bones.length / 4) * 4);
        }
        const mesh = new T.SkinnedMesh(geometry, material);
        mesh.bind(this.skeleton, new T.Matrix4());
        mesh.frustumCulled = false;
        this.root.add(mesh);
        return mesh;
    }

    /** 메시의 geometry를 바꾼다(이전 것은 해제). 뼈와 재질은 그대로다. */
    setGeometry(mesh, geometry) {
        this.requireSkin(geometry);
        mesh.geometry.dispose();
        mesh.geometry = geometry;
        mesh.boundingBox = mesh.boundingSphere = null;
    }

    requireSkin(geometry) {
        if (!geometry.getAttribute('skinIndex') || !geometry.getAttribute('skinWeight'))
            throw new Error('RigidBatch: geometry에 물체 번호(skinIndex·skinWeight)가 없다');
    }

    /**
     * 표준 계열 재질(MeshStandardMaterial·MeshPhysicalMaterial)이 물체별 setGlow 값을 emissive에 더하게 한다. mesh() 전에 불러도 된다.
     * 값은 uniform vec4 배열(물체 4개당 1벡터)이고 바꿔도 재컴파일이 없다. 재질 하나는 한 묶음에만 쓴다.
     */
    glowMaterial(material) {
        material.onBeforeCompile = (shader) => {
            if (!this.glowValues)
                throw new Error('RigidBatch: mesh()를 만들기 전에는 그릴 수 없다');
            shader.uniforms.rigidGlow = { value: this.glowValues };
            shader.vertexShader = replaceRequired(
                replaceRequired(
                    shader.vertexShader,
                    GLOW_VERTEX,
                    `uniform vec4 rigidGlow[${this.glowValues.length / 4}];\nvarying float vRigidGlow;\n${GLOW_VERTEX}`,
                ),
                GLOW_SKIN,
                `${GLOW_SKIN}\n\tint rigidBody = int(skinIndex.x);\n\tvRigidGlow = rigidGlow[rigidBody / 4][rigidBody % 4];`,
            );
            shader.fragmentShader = replaceRequired(
                replaceRequired(
                    shader.fragmentShader,
                    GLOW_VERTEX,
                    `varying float vRigidGlow;\n${GLOW_VERTEX}`,
                ),
                GLOW_EMISSIVE,
                'vec3 totalEmissiveRadiance = emissive + vec3(vRigidGlow);',
            );
        };
        material.customProgramCacheKey = () => `rigid-glow:${this.glowValues?.length ?? 0}`;
        return material;
    }

    /** 물체 번호의 emissive 가산 값(0이면 끔). glowMaterial 재질에만 보인다. */
    setGlow(index, value) {
        this.glowValues[index] = value;
    }

    /** 메시 geometry와 뼈 텍스처를 해제하고 장면에서 뺀다. 재질은 소비자가 소유한다. */
    dispose() {
        for (const child of this.root.children) if (child.isSkinnedMesh) child.geometry.dispose();
        this.skeleton?.dispose();
        this.root.removeFromParent();
    }
}

export { RigidBatch };
