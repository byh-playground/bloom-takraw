/**
 * 쇼크웨이브 왜곡(표시 전용). 장면은 평소처럼 화면(canvas)에 직접 그리고, 파동이 있을 때만 그 결과(톤 매핑·색 공간·안티에일리어싱이
 * 끝난 픽셀)를 텍스처로 복사해 풀스크린 패스 하나에서 파동 띠 안의 좌표를 방사 방향으로 밀고 띠를 밝게·어둡게 해 다시 그린다. 그려 넣는 것이 없어 공·선수·코트 선을 가리지 않는다.
 * 띠 밖 픽셀은 복사한 값을 그대로 다시 쓰므로 파동이 시작·끝나는 프레임에서 색·가장자리·반투명 합성이 바뀌지 않는다(렌더 타깃에 따로 그리면 선형 합성·MSAA 해소 순서가 달라져 달라졌다).
 * 파동이 하나도 없으면 아무것도 더하지 않는다(비용 0). 방사형 변위로 화면을 굴절시키는 방식은 일반적인 쇼크웨이브 셰이더(화면 텍스처를 파동 중심에서의 거리로 샘플링)와 같다.
 */
const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// wave[i] = (중심 u, 중심 v, 반지름, 띠 폭), 단위는 화면 높이. uDistort[i] = 밀림(화면 높이 비율), uShade[i] = 명암 세기.
const FRAGMENT = (max) => /* glsl */ `
uniform sampler2D tScene;
uniform vec4 uWave[${max}];
uniform float uDistort[${max}];
uniform float uShade[${max}];
uniform int uCount;
uniform float uAspect;
uniform float uFront;
uniform vec2 uLevel;
uniform vec3 uKeep;
uniform vec4 uTint;
uniform vec4 uSpot;
varying vec2 vUv;
void main() {
    vec2 scale = vec2(uAspect, 1.0);
    vec2 offset = vec2(0.0);
    float shade = 0.0;
    for (int i = 0; i < ${max}; i++) {
        if (i >= uCount) break;
        vec4 w = uWave[i];
        vec2 p = (vUv - w.xy) * scale;
        float d = length(p);
        // t: 0이 띠 앞 가장자리, 1이 띠 뒤 가장자리(안쪽). 앞은 날카롭고 뒤는 완만하게 줄어든다.
        float t = (w.z - d) / w.w;
        float m = smoothstep(-uFront, 0.0, t) * (1.0 - smoothstep(0.0, 1.0, t));
        offset += (p / max(d, 1e-5)) / scale * (m * uDistort[i]);
        // 명암: 띠 앞쪽은 밝게, 바로 뒤는 어둡게. 원래 픽셀에 곱하므로 무늬는 그대로 남는다. uLevel = (밝아짐, 어두워짐) 비율.
        shade += uShade[i] * (uLevel.x * exp(-pow(t / 0.3, 2.0)) - uLevel.y * exp(-pow((t - 0.7) / 0.35, 2.0)));
    }
    // 공과 그 후광 둘레(uKeep = 중심 u, v와 반지름, 화면 높이 단위)는 밀지 않는다: 얇은 후광 선이 밀려 거칠게 깨져 보이던 문제.
    offset *= smoothstep(uKeep.z, uKeep.z * 1.5, length((vUv - uKeep.xy) * scale));
    vec3 color = texture2D(tScene, vUv - offset).rgb;
    color *= 1.0 + shade;
    // 득점 순간 곱셈 보정(그리는 것 없이 원래 픽셀에 곱한다): 팀 색 스침(가장 큰 채널을 1로 맞춘 색이라 밝아지지 않는다), 착지점 둘레만 남기는 가장자리 어두워짐.
    color *= mix(vec3(1.0), uTint.rgb, uTint.a);
    color *= 1.0 - uSpot.w * smoothstep(uSpot.z, uSpot.z * 2.2, length((vUv - uSpot.xy) * scale));
    gl_FragColor = vec4(color, 1.0);
}`;

class TakrawShockWave {
    constructor({ THREE, renderer, config }) {
        this.THREE = THREE;
        this.renderer = renderer;
        this.shape = config.visual.impact.wave;
        const max = this.shape.max;
        this.slots = Array.from({ length: max }, () => ({
            x: 0,
            y: 0,
            z: 0,
            radius: 0,
            width: 0,
            distort: 0,
            shade: 0,
            maxScreen: 0,
        }));
        this.grading = {
            tintHex: 0,
            tintAmount: 0,
            spot: new THREE.Vector3(),
            spotAmount: 0,
            spotRadius: 0,
        };
        this.spotPoint = new THREE.Vector3();
        this.copy = null;
        this.size = new THREE.Vector2();
        this.point = new THREE.Vector3();
        this.uniforms = {
            tScene: { value: null },
            uWave: { value: Array.from({ length: max }, () => new THREE.Vector4()) },
            uDistort: { value: new Array(max).fill(0) },
            uShade: { value: new Array(max).fill(0) },
            uCount: { value: 0 },
            uAspect: { value: 1 },
            uFront: { value: this.shape.front },
            uLevel: { value: new THREE.Vector2(this.shape.shade.light, this.shape.shade.dark) },
            uKeep: { value: new THREE.Vector3(0, 0, 0) },
            // 득점 순간 색 곱셈: uTint = (곱할 색 rgb, 세기), uSpot = (착지점 u, v, 밝게 둘 반지름, 가장자리 어두워짐 세기)
            uTint: { value: new THREE.Vector4(1, 1, 1, 0) },
            uSpot: { value: new THREE.Vector4(0, 0, 1, 0) },
        };
        this.material = new THREE.ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT(max),
            uniforms: this.uniforms,
            depthTest: false,
            depthWrite: false,
        });
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
        this.quad.frustumCulled = false;
        this.pass = new THREE.Scene();
        this.pass.add(this.quad);
        this.passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }

    /** 밀지 않을 공 둘레를 정한다(화면 uv 중심과 화면 높이 비율 반지름). 반지름 0이면 없다. */
    setKeepOut(u, v, radius) {
        this.uniforms.uKeep.value.set(u, v, radius);
    }

    /** impacts.waves가 채운 slots를 화면 좌표 uniform으로 바꾸고 화면 안에 보이는 개수를 돌려준다. */
    project(count, camera) {
        const { slots, uniforms, point, shape } = this;
        const focal = 1 / Math.tan((camera.fov * Math.PI) / 360); // 깊이 1에서 화면 높이의 절반이 tan(fov/2)
        // 반지름 상한: 화면 짧은 변의 maxScreen 배(세로 화면에서 파동이 화면 폭을 덮지 않게). 파동마다 따로 정할 수 있다(slot.maxScreen).
        const shortSide = Math.min(this.size.x / this.size.y, 1);
        let used = 0;
        for (let i = 0; i < count; i++) {
            const slot = slots[i];
            point.set(slot.x, slot.y, slot.z).applyMatrix4(camera.matrixWorldInverse);
            const depth = -point.z;
            if (depth < camera.near) continue;
            point.set(slot.x, slot.y, slot.z).project(camera);
            if (Math.abs(point.x) > 1.5 || Math.abs(point.y) > 1.5) continue;
            // 월드 길이 → 화면 높이 비율: 깊이에서 화면 높이가 2·depth·tan(fov/2) m
            const perHeight = focal / (2 * depth);
            // 상한에 걸리면 반지름을 줄이되 시작 반지름 아래로는 줄이지 않는다(가까운 화면에서 띠가 공 위로 들어가 공 둘레가 깨져 보이던 문제). 띠 폭은 같은 비율로 줄인다.
            const limit = (slot.maxScreen || shape.maxScreen) * shortSide;
            const full = slot.radius * perHeight,
                radius = Math.min(full, Math.max(limit, shape.radius * shape.start * perHeight));
            const width = Math.max(
                slot.width * perHeight * (radius / full),
                shape.minPixels / this.size.y,
            );
            uniforms.uWave.value[used].set((point.x + 1) / 2, (point.y + 1) / 2, radius, width);
            // 밀림은 띠 폭의 maxSlope 배를 넘지 않는다: 좁아진 띠에서 같은 밀림이면 화면이 접혀 거칠어진다.
            uniforms.uDistort.value[used] = Math.min(slot.distort, width * shape.maxSlope);
            uniforms.uShade.value[used] = slot.shade;
            used++;
        }
        uniforms.uCount.value = used;
        return used;
    }

    /** 장면을 직접 그리고, 퍼지는 파동이 화면 안에 있으면 그 위에 왜곡 패스를 더한다. */
    render(scene, camera, impacts, moment = null) {
        const renderer = this.renderer;
        camera.updateMatrixWorld();
        renderer.getDrawingBufferSize(this.size);
        renderer.render(scene, camera);
        const count = impacts.waves(this.slots);
        const waves = count > 0 ? this.project(count, camera) : 0;
        const graded = moment ? this.setGrading(moment, camera) : false;
        if (!(waves > 0 || graded)) return;
        if (waves === 0) this.uniforms.uCount.value = 0;
        this.composite();
    }

    /** 득점 순간 곱셈 보정 값을 uniform에 옮긴다. 보정이 없으면 false(없는 동안은 패스를 더하지 않는다). */
    setGrading(moment, camera) {
        const grading = this.grading,
            { uTint, uSpot } = this.uniforms;
        moment.grade(grading);
        if (grading.tintAmount > 0) {
            // 화면은 이미 sRGB로 인코딩된 픽셀이라 팀 색도 hex의 sRGB 값 그대로 곱한다.
            const hex = grading.tintHex,
                r = ((hex >> 16) & 255) / 255,
                g = ((hex >> 8) & 255) / 255,
                b = (hex & 255) / 255,
                top = Math.max(r, g, b, 1e-4);
            uTint.value.set(r / top, g / top, b / top, grading.tintAmount);
        } else uTint.value.w = 0;
        if (grading.spotAmount > 0) {
            this.spotPoint.copy(grading.spot).project(camera);
            uSpot.value.set(
                (this.spotPoint.x + 1) / 2,
                (this.spotPoint.y + 1) / 2,
                grading.spotRadius,
                grading.spotAmount,
            );
        } else uSpot.value.w = 0;
        return grading.tintAmount > 0 || grading.spotAmount > 0;
    }

    /** 화면을 복사 텍스처에 옮기고 왜곡 패스를 그린다. 복사 텍스처는 화면 크기가 바뀔 때만 다시 만든다. */
    composite() {
        const renderer = this.renderer;
        if (
            !this.copy ||
            this.copy.image.width !== this.size.x ||
            this.copy.image.height !== this.size.y
        ) {
            this.copy?.dispose();
            this.copy = new this.THREE.FramebufferTexture(this.size.x, this.size.y);
        }
        renderer.copyFramebufferToTexture(this.copy);
        this.uniforms.tScene.value = this.copy;
        this.uniforms.uAspect.value = this.size.x / this.size.y;
        renderer.render(this.pass, this.passCamera);
    }

    /**
     * 로딩 단계에서 한 번: 첫 접촉 때 일어날 일(왜곡 패스 셰이더 컴파일, 복사 텍스처 할당)을 미리 한다.
     * 파동 0개로 그려 패스는 복사한 화면을 그대로 다시 쓰므로 화면이 바뀌지 않는다. DEV-032.
     */
    warm(scene, camera) {
        camera.updateMatrixWorld();
        this.renderer.getDrawingBufferSize(this.size);
        this.renderer.render(scene, camera);
        this.uniforms.uCount.value = 0;
        this.composite();
    }

    dispose() {
        this.copy?.dispose();
        this.quad.geometry.dispose();
        this.material.dispose();
    }
}

export { TakrawShockWave };
