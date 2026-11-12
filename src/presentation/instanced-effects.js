/**
 * 접촉 속성 구름·착지 먼지·득점 색종이를 InstancedMesh로 그린다(DEV-034: 드로우콜이 입자 수나 모양·속성 종류가 아니라 렌더 상태 묶음 수로 정해진다).
 * 효과 노드(object-pool)는 시간에 따른 입자 값만 가지고, 프레임마다 view가 draw()로 살아 있는 노드의 입자를 레이어의 미리 만든 버퍼에 쓴다.
 * 색은 instanceColor, 투명도는 instanceOpacity, 모양은 instanceShape, 위치·회전·크기는 instanceMatrix다.
 * 모양이 여럿이면 한 geometry에 모양을 모두 합쳐 두고, 정점 셰이더가 인스턴스의 모양이 아닌 정점을 한 점으로 접어 그리지 않는다.
 */

// 입자(속성 구름) 조각 셰이더에 끼우는 공 가림 방지: 화면에서 공 원판 안은 그리지 않는다(uBallMask = 중심 x·y, 반지름, 그리는 버퍼 픽셀).
// 어느 카메라에서도 공이 구름에 가려지지 않는다. 깊이·그리는 순서와 무관하다.
function injectBallMask(shader, mask) {
    shader.uniforms.uBallMask = mask;
    shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform vec3 uBallMask;\nvoid main() {')
        .replace(
            '#include <clipping_planes_fragment>',
            '#include <clipping_planes_fragment>\n    if (distance(gl_FragCoord.xy, uBallMask.xy) < uBallMask.z) discard;',
        );
}

// 인스턴스마다 다른 투명도(instanceOpacity)를 알파에 곱하고, 모양 합본이면 인스턴스의 모양(instanceShape)이 아닌 정점을 접는다.
function injectInstanceData(shader, shaped) {
    shader.vertexShader = shader.vertexShader
        .replace(
            'void main() {',
            `attribute float instanceOpacity;\nvarying float vInstanceOpacity;\n${
                shaped ? 'attribute float aShape;\nattribute float instanceShape;\n' : ''
            }void main() {`,
        )
        .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>\n    vInstanceOpacity = instanceOpacity;${
                shaped
                    ? '\n    if (abs(aShape - instanceShape) > 0.5) transformed = vec3(0.0);'
                    : ''
            }`,
        );
    shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'varying float vInstanceOpacity;\nvoid main() {')
        .replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            'vec4 diffuseColor = vec4( diffuse, opacity * vInstanceOpacity );',
        );
}

/**
 * 인스턴스 재질 하나: 색·투명도·(모양)은 인스턴스 데이터이고 재질은 레이어들이 공유한다.
 * 프로그램 변종은 side·모양 합본 여부·공 가림 여부로만 갈라지고 모든 변종은 로딩 때 컴파일된다(DEV-032).
 */
function createInstanceMaterial(THREE, { side = THREE.FrontSide, shaped = false, mask = null }) {
    const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        side,
    });
    // 앞·뒷면이 둘 다 보이는 평면 입자는 한 번에 그린다(그리는 순서는 인스턴스 순서).
    material.forceSinglePass = true;
    material.onBeforeCompile = (shader) => {
        injectInstanceData(shader, shaped);
        if (mask) injectBallMask(shader, mask);
    };
    material.customProgramCacheKey = () =>
        `instance-${shaped ? 'shaped' : 'plain'}-${mask ? 'mask' : 'open'}`;
    return material;
}

/**
 * 모양 여러 개를 한 geometry로 합친다(위치만). 정점마다 모양 번호(aShape)를 붙인다.
 * 반환한 shapes[이름]은 instanceShape에 쓰는 번호다.
 */
function mergeShapes(THREE, geometries) {
    const names = Object.keys(geometries);
    const positions = [],
        indices = [],
        shapeOf = [],
        shapes = {};
    names.forEach((name, shape) => {
        const geometry = geometries[name],
            position = geometry.getAttribute('position'),
            base = positions.length / 3;
        shapes[name] = shape;
        for (let i = 0; i < position.count; i++) {
            positions.push(position.getX(i), position.getY(i), position.getZ(i));
            shapeOf.push(shape);
        }
        if (geometry.index)
            for (let i = 0; i < geometry.index.count; i++)
                indices.push(base + geometry.index.getX(i));
        else for (let i = 0; i < position.count; i++) indices.push(base + i);
    });
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute('aShape', new THREE.Float32BufferAttribute(shapeOf, 1));
    merged.setIndex(indices);
    return { geometry: merged, shapes };
}

/** 인스턴스 버퍼 한 벌: 행렬 + 색 + 투명도(+ 모양). 프레임마다 begin → add… → end. 버퍼는 만들 때 한 번만 할당한다. */
class InstanceLayer {
    constructor(THREE, source, material, capacity, { shaped = false, order = 0 } = {}) {
        // 정적 속성은 source와 공유하고, 인스턴스 속성은 레이어마다 따로 가진다.
        const geometry = new THREE.BufferGeometry();
        for (const [name, attribute] of Object.entries(source.attributes))
            geometry.setAttribute(name, attribute);
        if (source.index) geometry.setIndex(source.index);
        this.capacity = capacity;
        this.geometry = geometry;
        this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(capacity * 3),
            3,
        );
        this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
        geometry.setAttribute('instanceOpacity', this.opacity);
        this.shape = shaped
            ? new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
            : null;
        if (this.shape) geometry.setAttribute('instanceShape', this.shape);
        this.mesh.count = 0;
        this.mesh.visible = false;
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = order;
        this.matrices = this.mesh.instanceMatrix.array;
        this.colors = this.mesh.instanceColor.array;
        this.fades = this.opacity.array;
        this.shapes = this.shape?.array ?? null;
        this.count = 0;
    }

    begin() {
        this.count = 0;
    }

    /** 입자 하나를 쓴다. 칸이 가득 차면 넘치는 입자는 그리지 않는다. matrix는 THREE.Matrix4, color는 THREE.Color. */
    add(matrix, color, opacity, shape = 0) {
        const i = this.count;
        if (i >= this.capacity) return;
        this.count = i + 1;
        matrix.toArray(this.matrices, i * 16);
        this.colors[i * 3] = color.r;
        this.colors[i * 3 + 1] = color.g;
        this.colors[i * 3 + 2] = color.b;
        this.fades[i] = opacity;
        if (this.shapes) this.shapes[i] = shape;
    }

    /** 쓴 칸까지만 GPU로 올린다. 비어 있으면 그리지 않는다. */
    end() {
        const mesh = this.mesh,
            count = this.count;
        mesh.count = count;
        mesh.visible = count > 0;
        if (count === 0) return;
        const upload = (attribute) => {
            attribute.clearUpdateRanges();
            attribute.addUpdateRange(0, count * attribute.itemSize);
            attribute.needsUpdate = true;
        };
        upload(mesh.instanceMatrix);
        upload(mesh.instanceColor);
        upload(this.opacity);
        if (this.shape) upload(this.shape);
    }

    /** 로딩 때 컴파일·그리기가 되도록 1칸을 켜 둔다(DEV-032). 끝나면 end()가 실제 상태로 되돌린다. */
    warm() {
        this.mesh.count = 1;
        this.mesh.visible = true;
    }

    dispose() {
        this.mesh.dispose();
        this.geometry.dispose();
    }
}

/**
 * 속성 구름: 모양과 속성 종류와 무관하게 고정 2 draw(테두리 → 본체). 모양은 합친 geometry 하나의 instanceShape로 고른다.
 * 테두리는 본체와 같은 위치에서 조금 크게 먼저 깔아 어두운 윤곽으로 보이게 한다.
 */
class TakrawParticleCloud {
    constructor({ THREE, scene, geometries, mask, capacity }) {
        const merged = mergeShapes(THREE, geometries);
        this.shapes = merged.shapes;
        this.source = merged.geometry;
        this.material = createInstanceMaterial(THREE, {
            side: THREE.DoubleSide,
            shaped: true,
            mask,
        });
        // 테두리(order 1)를 본체(order 2)보다 먼저 그린다.
        this.rim = new InstanceLayer(THREE, this.source, this.material, capacity, {
            shaped: true,
            order: 1,
        });
        this.body = new InstanceLayer(THREE, this.source, this.material, capacity, {
            shaped: true,
            order: 2,
        });
        this.scene = scene;
        scene.add(this.rim.mesh, this.body.mesh);
    }

    begin() {
        this.rim.begin();
        this.body.begin();
    }

    /** 입자 하나: 본체와 테두리를 쓴다. 모양 이름은 geometries의 키. */
    add(shape, bodyMatrix, rimMatrix, color, edge, rimOpacity) {
        const id = this.shapes[shape];
        this.body.add(bodyMatrix, color, 1, id);
        this.rim.add(rimMatrix, edge, rimOpacity, id);
    }

    end() {
        this.rim.end();
        this.body.end();
    }

    warm() {
        this.rim.warm();
        this.body.warm();
    }

    dispose() {
        this.scene.remove(this.rim.mesh, this.body.mesh);
        this.rim.dispose();
        this.body.dispose();
        this.source.dispose();
        this.material.dispose();
    }
}

export { InstanceLayer, TakrawParticleCloud, createInstanceMaterial };
