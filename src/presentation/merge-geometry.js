/**
 * 같은 재질로 그릴 도형 여럿을 정점 색을 가진 geometry 하나로 합친다(DEV-034: 드로우콜이 도형 수나 색 종류가 아니라 렌더 상태 묶음 수로 정해진다).
 * 도형마다 변환(위치·회전·크기·부모 행렬)과 색을 받아 정점에 굽는다. 색은 정점 색(color 속성)이므로 재질은 vertexColors 하나면 된다.
 * 정점 색은 재질 색과 같은 작업 색 공간(선형) 값이라 같은 hex를 재질 색으로 쓸 때와 화면이 같다.
 * three.js addon(BufferGeometryUtils)을 쓰지 않고 position·normal·color·index만 직접 합친다.
 * 선택 속성: 도형에 body(물체 번호)가 있으면 skinIndex·skinWeight를 달아 SkinnedMesh 뼈 하나에 묶고(rigid-batch.js),
 * uvRect가 있으면 원래 uv를 그 사각형(아틀라스 칸)으로 옮겨 uv를 만든다. 한 도형이라도 쓰면 모든 도형이 가져야 한다.
 */

/**
 * parts를 geometry 하나로 합친다.
 * @param {object} THREE three.js 네임스페이스
 * @param {{ geometry: object, color?: number|object, matrix?: object, body?: number|Function, uvRect?: number[] }[]} parts
 *   geometry는 position(+normal)을 가진 BufferGeometry, color는 hex 또는 THREE.Color(기본 흰색), matrix는 THREE.Matrix4(기본 단위 행렬),
 *   body는 물체 번호 또는 (변환 전 도형 좌표 Vector3) => 물체 번호(정점마다 다른 뼈), uvRect는 [u0, v0, du, dv]
 * @returns {object} position·normal·color(+skinIndex·skinWeight, +uv) 속성과 index를 가진 BufferGeometry. 입력 geometry는 바꾸지도 해제하지도 않는다.
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
        indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount),
        skinned = optional(parts, 'body'),
        skinIndex = skinned ? new Uint16Array(vertexCount * 4) : null,
        skinWeight = skinned ? new Float32Array(vertexCount * 4) : null,
        uvs = optional(parts, 'uvRect') ? new Float32Array(vertexCount * 2) : null;
    const point = new THREE.Vector3(),
        normalMatrix = new THREE.Matrix3(),
        paint = new THREE.Color();
    let vertexOffset = 0,
        indexOffset = 0;
    for (const { geometry, color = 0xffffff, matrix, body, uvRect } of parts) {
        const position = geometry.getAttribute('position'),
            normal = geometry.getAttribute('normal'),
            uv = geometry.getAttribute('uv'),
            count = position.count;
        paint.set(color);
        if (matrix) normalMatrix.getNormalMatrix(matrix);
        for (let i = 0; i < count; i++) {
            const at = (vertexOffset + i) * 3;
            point.fromBufferAttribute(position, i);
            if (skinned) {
                skinIndex[(vertexOffset + i) * 4] = typeof body === 'function' ? body(point) : body;
                skinWeight[(vertexOffset + i) * 4] = 1;
            }
            if (uvs) {
                uvs[(vertexOffset + i) * 2] = uvRect[0] + uv.getX(i) * uvRect[2];
                uvs[(vertexOffset + i) * 2 + 1] = uvRect[1] + uv.getY(i) * uvRect[3];
            }
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
    if (skinned) {
        merged.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
        merged.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    }
    if (uvs) merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    merged.setIndex(new THREE.BufferAttribute(indices, 1));
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
}

/** 선택 속성 key를 쓰는 도형이 있는지. 일부만 쓰면 빠진 정점이 엉뚱한 값을 갖게 되므로 오류를 낸다. */
function optional(parts, key) {
    const count = parts.filter((part) => part[key] !== undefined).length;
    if (count > 0 && count < parts.length)
        throw new Error(`mergeColored: ${key}가 일부 도형에만 있다(${count}/${parts.length})`);
    return count > 0;
}

/**
 * 합칠 도형을 view의 box·cylinder·sphere와 같은 인자 순서로 모아 두었다가 build()에서 mergeColored로 합친다.
 * 같은 치수의 기본 geometry는 한 번만 만들고, build()가 임시 geometry를 해제한다. 만들 때만 쓰고 프레임마다 부르지 않는다.
 * 변환 옵션: position은 x·y·z 인자, rotation은 [x, y, z] 라디안(오일러 XYZ), scale은 [x, y, z], parent는 부모 THREE.Matrix4.
 * 선택 옵션 body·uvRect는 mergeColored와 같다. body를 옵션으로 주지 않으면 목록의 body 필드(지금 더하는 물체 번호)를 쓴다.
 */
class PartList {
    constructor(THREE) {
        this.THREE = THREE;
        this.parts = [];
        this.cache = new Map();
        this.object = new THREE.Object3D();
        /** 이후 add하는 도형의 기본 물체 번호(SkinnedMesh 뼈). 쓰지 않으면 undefined. */
        this.body = undefined;
    }

    /** 같은 key의 geometry는 한 번만 만든다. 이 목록이 소유하며 build()에서 해제한다. */
    geometry(key, factory) {
        if (!this.cache.has(key)) this.cache.set(key, factory());
        return this.cache.get(key);
    }

    /** geometry 하나를 변환과 색을 붙여 추가한다. */
    add(geometry, color, { position, rotation, scale, parent, body = this.body, uvRect } = {}) {
        const object = this.object;
        object.position.set(...(position ?? [0, 0, 0]));
        object.rotation.set(...(rotation ?? [0, 0, 0]));
        object.scale.set(...(scale ?? [1, 1, 1]));
        object.updateMatrix();
        const matrix = parent
            ? new this.THREE.Matrix4().multiplyMatrices(parent, object.matrix)
            : object.matrix.clone();
        this.parts.push({ geometry, color, matrix, body, uvRect });
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
