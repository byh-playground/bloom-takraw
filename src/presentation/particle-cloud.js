import { InstanceLayer, mergeShapes, replaceShaderChunk } from '@bloom-gamekit/three-kit';

/**
 * 접촉 속성 구름을 three-kit의 InstanceLayer로 그린다(DEV-034: 드로우콜이 입자 수나 모양·속성 종류가 아니라 렌더 상태 묶음 수로 정해진다).
 * 효과 노드(object-pool)는 시간에 따른 입자 값만 가지고, 프레임마다 view가 draw()로 살아 있는 노드의 입자를 레이어의 미리 만든 버퍼에 쓴다.
 * 모양이 여럿이라 한 geometry에 합쳐 두고(mergeShapes) 인스턴스가 모양을 고른다. 게임 고유인 것은 공 가림 하나뿐이다.
 */

// 입자(속성 구름) 조각 셰이더에 끼우는 공 가림 방지: 화면에서 공 원판 안은 그리지 않는다(uBallMask = 중심 x·y, 반지름, 그리는 버퍼 픽셀).
// 어느 카메라에서도 공이 구름에 가려지지 않는다. 깊이·그리는 순서와 무관하다.
function ballMaskExtension(mask) {
    return {
        key: 'ball-mask',
        inject(shader) {
            shader.uniforms.uBallMask = mask;
            shader.fragmentShader = replaceShaderChunk(
                shader.fragmentShader,
                'void main() {',
                'uniform vec3 uBallMask;\nvoid main() {',
            );
            shader.fragmentShader = replaceShaderChunk(
                shader.fragmentShader,
                '#include <clipping_planes_fragment>',
                '#include <clipping_planes_fragment>\n    if (distance(gl_FragCoord.xy, uBallMask.xy) < uBallMask.z) discard;',
            );
        },
    };
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
        const layer = (order) =>
            new InstanceLayer(THREE, {
                geometry: this.source,
                capacity,
                side: THREE.DoubleSide,
                order,
                extend: ballMaskExtension(mask),
            });
        // 테두리(order 1)를 본체(order 2)보다 먼저 그린다.
        this.rim = layer(1);
        this.body = layer(2);
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

    dispose() {
        this.scene.remove(this.rim.mesh, this.body.mesh);
        this.rim.dispose();
        this.body.dispose();
        this.source.dispose();
    }
}

export { TakrawParticleCloud };
