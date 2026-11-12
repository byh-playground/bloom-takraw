/**
 * 같은 재질로 그릴 도형 여럿을 정점 색을 가진 geometry 하나로 합친다(DEV-034: 드로우콜이 도형 수나 색 종류가 아니라 렌더 상태 묶음 수로 정해진다).
 * 도형마다 변환(위치·회전·크기·부모 행렬)과 색을 받아 정점에 굽는다. 색은 정점 색(color 속성)이므로 재질은 vertexColors 하나면 된다.
 * 정점 색은 재질 색과 같은 작업 색 공간(선형) 값이라 같은 hex를 재질 색으로 쓸 때와 화면이 같다.
 * three.js addon(BufferGeometryUtils)을 쓰지 않고 position·normal·color·index만 직접 합친다. uv는 만들지 않으므로 텍스처를 쓰는 재질에는 쓰지 않는다.
 */

/**
 * parts를 geometry 하나로 합친다.
 * @param {object} THREE three.js 네임스페이스
 * @param {{ geometry: object, color?: number|object, matrix?: object }[]} parts
 *   geometry는 position(+normal)을 가진 BufferGeometry, color는 hex 또는 THREE.Color(기본 흰색), matrix는 THREE.Matrix4(기본 단위 행렬)
 * @returns {object} position·normal·color 속성과 index를 가진 BufferGeometry. 입력 geometry는 바꾸지도 해제하지도 않는다.
 */
function mergeColored(THREE, parts) {
    let vertexCount = 0,
        indexCount = 0;
    for (const { geometry } of parts) {
        const count = geometry.getAttribute('position').count;
        vertexCount += count;
        indexCount += geometry.index ? geometry.index.count : count;
    }
    const positions = new Float32Array(vertexCount * 3),
        normals = new Float32Array(vertexCount * 3),
        colors = new Float32Array(vertexCount * 3),
        indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    const point = new THREE.Vector3(),
        normalMatrix = new THREE.Matrix3(),
        paint = new THREE.Color();
    let vertexOffset = 0,
        indexOffset = 0;
    for (const { geometry, color = 0xffffff, matrix } of parts) {
        const position = geometry.getAttribute('position'),
            normal = geometry.getAttribute('normal'),
            count = position.count;
        paint.set(color);
        if (matrix) normalMatrix.getNormalMatrix(matrix);
        for (let i = 0; i < count; i++) {
            const at = (vertexOffset + i) * 3;
            point.fromBufferAttribute(position, i);
            if (matrix) point.applyMatrix4(matrix);
            positions[at] = point.x;
            positions[at + 1] = point.y;
            positions[at + 2] = point.z;
            if (normal) {
                point.fromBufferAttribute(normal, i);
                if (matrix) point.applyMatrix3(normalMatrix).normalize();
                normals[at] = point.x;
                normals[at + 1] = point.y;
                normals[at + 2] = point.z;
            }
            colors[at] = paint.r;
            colors[at + 1] = paint.g;
            colors[at + 2] = paint.b;
        }
        // 거울 변환(행렬식 < 0)은 삼각형 감김이 뒤집히므로 두 꼭짓점을 맞바꿔 앞면을 지킨다.
        const mirrored = matrix ? matrix.determinant() < 0 : false,
            total = geometry.index ? geometry.index.count : count;
        for (let i = 0; i < total; i += 3) {
            const a = geometry.index ? geometry.index.getX(i) : i,
                b = geometry.index ? geometry.index.getX(i + 1) : i + 1,
                c = geometry.index ? geometry.index.getX(i + 2) : i + 2;
            indices[indexOffset + i] = vertexOffset + a;
            indices[indexOffset + i + 1] = vertexOffset + (mirrored ? c : b);
            indices[indexOffset + i + 2] = vertexOffset + (mirrored ? b : c);
        }
        vertexOffset += count;
        indexOffset += total;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    merged.setIndex(new THREE.BufferAttribute(indices, 1));
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
}

/**
 * 합칠 도형을 view의 box·cylinder·sphere와 같은 인자 순서로 모아 두었다가 build()에서 mergeColored로 합친다.
 * 같은 치수의 기본 geometry는 한 번만 만들고, build()가 임시 geometry를 해제한다. 만들 때만 쓰고 프레임마다 부르지 않는다.
 * 변환 옵션: position은 x·y·z 인자, rotation은 [x, y, z] 라디안(오일러 XYZ), scale은 [x, y, z], parent는 부모 THREE.Matrix4.
 */
class PartList {
    constructor(THREE) {
        this.THREE = THREE;
        this.parts = [];
        this.cache = new Map();
        this.object = new THREE.Object3D();
    }

    /** 같은 key의 geometry는 한 번만 만든다. 이 목록이 소유하며 build()에서 해제한다. */
    geometry(key, factory) {
        if (!this.cache.has(key)) this.cache.set(key, factory());
        return this.cache.get(key);
    }

    /** geometry 하나를 변환과 색을 붙여 추가한다. */
    add(geometry, color, { position, rotation, scale, parent } = {}) {
        const object = this.object;
        object.position.set(...(position ?? [0, 0, 0]));
        object.rotation.set(...(rotation ?? [0, 0, 0]));
        object.scale.set(...(scale ?? [1, 1, 1]));
        object.updateMatrix();
        const matrix = parent
            ? new this.THREE.Matrix4().multiplyMatrices(parent, object.matrix)
            : object.matrix.clone();
        this.parts.push({ geometry, color, matrix });
    }

    box(width, height, depth, color, x = 0, y = 0, z = 0, options) {
        const geometry = this.geometry(
            `box:${width}:${height}:${depth}`,
            () => new this.THREE.BoxGeometry(width, height, depth),
        );
        this.add(geometry, color, { ...options, position: [x, y, z] });
    }

    cylinder(radius, height, color, x, y, z, options = {}) {
        const top = options.top ?? radius,
            geometry = this.geometry(
                `cylinder:${radius}:${top}:${height}`,
                () => new this.THREE.CylinderGeometry(top, radius, height, 12),
            );
        this.add(geometry, color, { ...options, position: [x, y, z] });
    }

    sphere(radius, color, x = 0, y = 0, z = 0, options = {}) {
        const segments = options.segments ?? 12,
            geometry = this.geometry(
                `sphere:${radius}:${segments}`,
                () => new this.THREE.SphereGeometry(radius, segments, 10),
            );
        this.add(geometry, color, { ...options, position: [x, y, z] });
    }

    /** 합친 geometry를 돌려주고 임시 geometry를 해제한다. 목록은 비워 다시 쓸 수 있다. */
    build() {
        const merged = mergeColored(this.THREE, this.parts);
        for (const geometry of this.cache.values()) geometry.dispose();
        this.cache.clear();
        this.parts.length = 0;
        return merged;
    }
}

export { PartList, mergeColored };
