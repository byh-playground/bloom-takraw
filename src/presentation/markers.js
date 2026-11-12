import { TAKRAW_MODES } from '../simulation/modes.js';
import { takrawHumanPlayerIds, takrawTeamOf } from '../simulation/roster.js';
import { InstanceLayer, createInstanceMaterial, mergeShapes } from './instanced-effects.js';

const FLAT = -Math.PI / 2;
const GROUND_CAPACITY = 48;
const OVERLAY_CAPACITY = 32;
const ARROW_CAPACITY = 6;

/**
 * 선수·공 표시와 받기·공격 안내를 인스턴스 레이어 셋으로 그린다(DEV-034: 드로우콜이 표시 수와 안내 막대 수가 아니라 렌더 상태 묶음 수로 정해진다).
 *   ground  : 바닥에 깔리는 반투명 표시. 접촉 그림자·공 그림자 → 선택 링·착지 표시 → 받기·공격 안내 순으로 쓴다(깊이 테스트).
 *   overlay : 깊이 테스트 없이 위에 겹쳐 그리는 표시. 안내 접점 막대·테두리·킥 링·공 후광(깊이 테스트 끔).
 *   arrows  : 선택 선수 머리 위 화살표(불투명).
 * 모양이 여럿이라 레이어마다 모양을 한 geometry에 합치고(mergeShapes), 색·투명도·위치·크기는 인스턴스 데이터다. 모든 변종은 view.warmUp()에서 컴파일된다(DEV-032).
 * 앞·뒷면이 모두 보이던 반투명 평면은 한 번에 그린다(createInstanceMaterial의 forceSinglePass). 위에서 내려다보는 평면이라 화면은 같다.
 * 매 프레임 begin → 표시를 쓰는 draw → end이고, 버퍼·행렬·색은 만들 때 한 번만 할당한다.
 */
class TakrawMarkers {
    constructor({ THREE, scene, config, view }) {
        const T = THREE,
            { receiveGuide: receive, attackGuide: attack } = config.visual,
            radius = config.ai.toss.attack.positionRadius;
        this.THREE = T;
        this.scene = scene;
        this.view = view;
        this.receive = receive;
        this.attack = attack;
        const ground = mergeShapes(T, {
            contactShadow: new T.CircleGeometry(0.4, 32),
            ballShadow: new T.CircleGeometry(0.16, 28),
            selectRing: new T.RingGeometry(0.3, 0.34, 40),
            locator: new T.RingGeometry(0.24, 0.29, 40),
            receiveActor: new T.PlaneGeometry(receive.actorWidth * 0.42, 0.028),
            attackArc: new T.RingGeometry(radius - 0.018, radius, 16, 1, 0.18, Math.PI / 2 - 0.36),
            attackFoot: new T.BoxGeometry(attack.foot.length, 0.005, attack.foot.width),
            attackToe: new T.CircleGeometry(attack.foot.width * 0.5, 12, -Math.PI / 2, Math.PI),
            attackReady: new T.RingGeometry(radius - 0.04, radius - 0.022, 48),
        });
        const overlay = mergeShapes(T, {
            halo: new T.RingGeometry(0.118, 0.14, 40),
            receiveContact: new T.PlaneGeometry(
                receive.contactRadius * 1.25,
                receive.contactRadius * 0.19,
            ),
            attackTarget: new T.PlaneGeometry(
                attack.contactRadius * 0.32,
                attack.contactRadius * 0.65,
            ),
            attackKick: new T.RingGeometry(
                attack.contactRadius * 1.05,
                attack.contactRadius * 1.19,
                40,
            ),
        });
        this.groundShapes = ground.shapes;
        this.overlayShapes = overlay.shapes;
        this.sources = [ground.geometry, overlay.geometry];
        this.materials = [
            createInstanceMaterial(T, { side: T.DoubleSide, shaped: true }),
            createInstanceMaterial(T, { side: T.DoubleSide, shaped: true, depthTest: false }),
            createInstanceMaterial(T, { opaque: true }),
        ];
        this.ground = new InstanceLayer(T, ground.geometry, this.materials[0], GROUND_CAPACITY, {
            shaped: true,
        });
        // 안내 접점·후광은 높은 renderOrder로 선·눈금 같은 다른 겹쳐 그림 위에 그린다.
        this.overlay = new InstanceLayer(T, overlay.geometry, this.materials[1], OVERLAY_CAPACITY, {
            shaped: true,
            order: 4,
        });
        this.arrowGeometry = new T.ConeGeometry(0.075, 0.15, 3);
        this.arrows = new InstanceLayer(T, this.arrowGeometry, this.materials[2], ARROW_CAPACITY);
        this.layers = [this.ground, this.overlay, this.arrows];
        scene.add(this.ground.mesh, this.overlay.mesh, this.arrows.mesh);
        // 그림자만 그리는 그림(renderFrom)을 위해, 앞에서부터 이 개수까지가 그림자다.
        this.shadowCount = 0;
        this.object = new T.Object3D();
        this.parent = new T.Matrix4();
        this.matrix = new T.Matrix4();
        this.color = new T.Color();
        this.shadowColor = new T.Color(0x163d2b);
        this.ballShadowColor = new T.Color(0x263f27);
        this.locatorColor = new T.Color(0xffe8a7);
        this.haloColor = new T.Color(0x213f37);
        this.outlineColor = new T.Color(0x213f37);
        this.ringColors = [new T.Color(0xd9f1b5), new T.Color(0xffddba)];
        this.arrowColors = [new T.Color(0xe2f7b3), new T.Color(0xffd6af)];
        // 안내 막대의 그룹 안 위치는 고정이라 한 번만 만든다. 프레임마다 그룹 행렬과 곱해 쓴다.
        const local = (x, y, z, rx, ry, rz, sx = 1, sy = 1, sz = 1) => {
            const o = this.object;
            o.position.set(x, y, z);
            o.rotation.set(rx, ry, rz);
            o.scale.set(sx, sy, sz);
            o.updateMatrix();
            return o.matrix.clone();
        };
        this.receiveActorBars = [];
        for (const side of [-1, 1])
            for (const arm of [-1, 1])
                this.receiveActorBars.push(
                    local(
                        side * receive.actorWidth,
                        arm * receive.actorWidth * 0.13,
                        0,
                        0,
                        0,
                        (-side * arm * Math.PI) / 4,
                    ),
                );
        this.receiveContactBars = [];
        for (let i = 0; i < 4; i++) {
            const angle = Math.PI / 4 + (i * Math.PI) / 2;
            this.receiveContactBars.push(
                local(
                    Math.cos(angle) * receive.contactRadius * 0.5,
                    Math.sin(angle) * receive.contactRadius * 0.5,
                    0,
                    0,
                    0,
                    angle + Math.PI / 2,
                ),
            );
        }
        this.attackArcs = [];
        this.attackTargets = [];
        this.attackOutlines = [];
        for (let i = 0; i < 4; i++) {
            const angle = (i * Math.PI) / 2,
                x = Math.sin(angle) * attack.contactRadius * 0.72,
                y = Math.cos(angle) * attack.contactRadius * 0.72;
            this.attackArcs.push(local(0, 0, 0, FLAT, 0, angle));
            this.attackTargets.push(local(x, y, 0, 0, 0, -angle));
            this.attackOutlines.push(local(x, y, 0, 0, 0, -angle, 1.7, 1.3, 1));
        }
        this.attackFeet = [];
        this.attackToes = [];
        for (const side of [-1, 1]) {
            this.attackFeet.push(local(0, 0, side * attack.foot.spacing * 0.5, 0, 0, 0));
            this.attackToes.push(
                local(
                    attack.foot.length * 0.5,
                    0.003,
                    side * attack.foot.spacing * 0.5,
                    FLAT,
                    0,
                    0,
                ),
            );
        }
        this.attackReady = local(0, 0, 0, FLAT, 0, 0);
        this.attackKick = local(0, 0, 0, 0, 0, 0);
    }

    begin() {
        for (const layer of this.layers) layer.begin();
    }

    end() {
        for (const layer of this.layers) layer.end();
    }

    /** 로딩 때 모든 레이어를 한 칸씩 켜 컴파일·그리기를 해 둔다(DEV-032). 끝나면 clear()로 비운다. */
    warm() {
        for (const layer of this.layers) layer.warm();
    }

    clear() {
        this.begin();
        this.end();
    }

    /** 그림자만 남기고 그리는 동안 callback을 부른다. 확인용 고정 카메라 그림은 경기 카메라용 안내·링·후광을 뺀다. */
    withoutGuides(callback) {
        const { ground, overlay, arrows } = this,
            count = ground.mesh.count,
            visible = [ground.mesh.visible, overlay.mesh.visible, arrows.mesh.visible];
        ground.mesh.count = this.shadowCount;
        ground.mesh.visible = visible[0] && this.shadowCount > 0;
        overlay.mesh.visible = arrows.mesh.visible = false;
        try {
            callback();
        } finally {
            ground.mesh.count = count;
            [ground.mesh.visible, overlay.mesh.visible, arrows.mesh.visible] = visible;
        }
    }

    /** 이 프레임의 모든 표시를 쓴다. 공(ball)·카메라·선수 포즈는 view가 이미 갱신한 값을 읽는다. */
    draw(viewData, context, ball) {
        const view = this.view;
        this.begin();
        const selected = viewData.state?.selected || takrawHumanPlayerIds(),
            pair = Boolean(TAKRAW_MODES[viewData.state?.mode]?.secondaryInput);
        for (let i = 0; i < 6; i++) this.contactShadow(view.meshes.get(`p${i}:pelvis`));
        if (ball) this.ballShadow(ball);
        this.shadowCount = this.ground.count;
        for (let i = 0; i < 6; i++) {
            const body = view.meshes.get(`p${i}:pelvis`);
            if (body && (pair || takrawTeamOf(i) === view.cameraRig.team))
                if (selected[takrawTeamOf(i)] === i) this.selection(i, body);
        }
        if (ball && ball.position.y > 0.3) this.locator(ball);
        this.guides(viewData, context);
        if (ball) this.halo(ball);
        this.end();
    }

    /** 위치·x축 회전(기본은 바닥에 눕힘)·z축 회전·균일 크기의 행렬. 공용 임시 행렬이라 바로 쓰고 보관하지 않는다. */
    flat(x, y, z, scale, rotationX = FLAT, rotationZ = 0) {
        const o = this.object;
        o.position.set(x, y, z);
        o.rotation.set(rotationX, 0, rotationZ);
        o.scale.setScalar(scale);
        o.updateMatrix();
        return o.matrix;
    }

    contactShadow(body) {
        if (!body) return;
        const height = Math.max(0, body.position.y - 0.95);
        this.ground.add(
            this.flat(body.position.x, 0.048, body.position.z, 1 + Math.min(1.4, height * 0.15)),
            this.shadowColor,
            0.13 / (1 + height * 0.3),
            this.groundShapes.contactShadow,
        );
    }

    ballShadow(ball) {
        const view = this.view,
            height = Math.max(0, ball.position.y),
            pulse = view.impacts.shadowPulse(),
            shadow = view.config.visual.impact.shadow;
        this.ground.add(
            this.flat(
                ball.position.x,
                0.053,
                ball.position.z,
                (1 + Math.min(1, height * 0.1)) * (1 + shadow.scale * pulse),
            ),
            this.ballShadowColor,
            (0.3 / (1 + height * 0.12)) * (1 + shadow.opacity * pulse),
            this.groundShapes.ballShadow,
        );
    }

    /** 선택한 선수의 발밑 링과 머리 위 화살표. */
    selection(player, body) {
        const team = takrawTeamOf(player),
            head = this.view.meshes.get(`p${player}:head`);
        this.ground.add(
            this.flat(body.position.x, 0.052, body.position.z, 1),
            this.ringColors[team],
            0.96,
            this.groundShapes.selectRing,
        );
        if (!head) return;
        this.arrows.add(
            this.flat(head.position.x, head.position.y + 0.3, head.position.z, 1, 0, Math.PI),
            this.arrowColors[team],
            1,
        );
    }

    /** 공이 떠 있을 때 바닥에 비친 공 위치 링. */
    locator(ball) {
        this.ground.add(
            this.flat(ball.position.x, 0.056, ball.position.z, 1),
            this.locatorColor,
            0.9,
            this.groundShapes.locator,
        );
    }

    /** 공 후광: 카메라를 향한 링이고 공이 늘어난 만큼 화면에서 같이 늘어난다. 깊이 테스트 없이 위에 그린다. */
    halo(ball) {
        const view = this.view,
            stretch = view.ballScreenStretch,
            size = Math.max(1, (7 * this.pixelSize(ball.position)) / 0.14),
            o = this.object;
        o.position.copy(ball.position);
        o.quaternion.copy(view.camera.quaternion);
        o.scale.set(size * stretch.along, size, size);
        if (stretch.along !== 1) o.rotateZ(stretch.angle);
        o.updateMatrix();
        this.overlay.add(o.matrix, this.haloColor, 0.85, this.overlayShapes.halo);
    }

    /** 카메라 거리에서 한 화면 픽셀이 차지하는 월드 길이. 가까운 물체는 깊이 1로 막는다. */
    pixelSize(position) {
        const view = this.view,
            depth = Math.max(
                1,
                -view.temp.vector.copy(position).applyMatrix4(view.camera.matrixWorldInverse).z,
            );
        return (2 * depth * Math.tan((view.camera.fov * Math.PI) / 360)) / view.height;
    }

    /** 카메라를 향한 접점 그룹의 행렬을 this.parent에 둔다: 위치, 카메라 회전, 최소 화면 크기를 지키는 배율. */
    contactGroup(point, radius, minPixels) {
        const o = this.object;
        o.position.copy(point);
        o.quaternion.copy(this.view.camera.quaternion);
        o.scale.setScalar(Math.max(1, (minPixels * 0.5 * this.pixelSize(point)) / radius));
        o.updateMatrix();
        this.parent.copy(o.matrix);
    }

    /** 그룹 행렬(this.parent)과 막대의 그룹 안 행렬을 곱해 레이어에 쓴다. */
    bars(layer, bars, color, opacity, shape) {
        for (const bar of bars)
            layer.add(this.matrix.multiplyMatrices(this.parent, bar), color, opacity, shape);
    }

    guides(viewData, context) {
        const view = this.view,
            rig = view.cameraRig,
            local = Boolean(TAKRAW_MODES[context.mode ?? viewData.state?.mode]?.secondaryInput),
            rally = viewData.state?.phase === 'rally';
        for (let team = 0; team < 2; team++) {
            const guide = viewData.receiveGuides?.[team],
                body = guide ? view.meshes.get(`p${guide.playerId}:pelvis`) : null;
            if (body && guide && rally && (local || team === rig.team))
                this.receiveGuide(guide, body);
        }
        for (let team = 0; team < 2; team++) {
            const guide = viewData.attackGuides?.[team];
            if (guide && rally && (local || team === rig.team)) this.attackGuide(guide, team);
        }
    }

    /** 받는 선수 괄호(바닥)와 예상 접점 마름모(공중, 이때만). */
    receiveGuide(guide, body) {
        const s = this.receive,
            color = this.color.set(guide.human ? s.colors.human : s.colors.ai),
            opacity = guide.reachable ? s.opacity.active : s.opacity.waiting;
        this.parent.copy(this.flat(body.position.x, s.groundHeight, body.position.z, 1));
        this.bars(
            this.ground,
            this.receiveActorBars,
            color,
            opacity,
            this.groundShapes.receiveActor,
        );
        if (!guide.point || guide.stage === 'recover') return;
        this.contactGroup(guide.point, s.contactRadius, s.contactMinPixels);
        this.bars(
            this.overlay,
            this.receiveContactBars,
            color,
            opacity,
            this.overlayShapes.receiveContact,
        );
    }

    /** 공격수의 서는 자리(발·호·점프 링, 바닥)와 공이 맞을 접점 네 막대(공중). */
    attackGuide(guide, team) {
        const s = this.attack,
            ready = guide.stage === 'jump' && guide.jumpWindow,
            color = this.color.set(ready ? s.colors.ready : s.colors.approach),
            opacity = ready ? s.opacity.ready : s.opacity.approach,
            o = this.object;
        o.position.set(guide.stance.x, s.groundHeight, guide.stance.z);
        o.rotation.set(0, team === 0 ? 0 : Math.PI, 0);
        o.scale.set(1, 1, 1);
        o.updateMatrix();
        this.parent.copy(o.matrix);
        const shapes = this.groundShapes;
        this.bars(this.ground, this.attackArcs, color, opacity, shapes.attackArc);
        this.bars(this.ground, this.attackFeet, color, opacity, shapes.attackFoot);
        this.bars(this.ground, this.attackToes, color, opacity, shapes.attackToe);
        if (ready) this.bars(this.ground, [this.attackReady], color, opacity, shapes.attackReady);
        // 접점 막대는 깊이 테스트 없이 위에 그리고, 어두운 테두리(먼저)가 색 막대 아래에 깔린다.
        this.contactGroup(guide.contact, s.contactRadius, s.contactMinPixels);
        const overlay = this.overlayShapes;
        this.bars(this.overlay, this.attackOutlines, this.outlineColor, 0.72, overlay.attackTarget);
        const contactColor = guide.kickWindow ? this.color.set(s.colors.ready) : color,
            contactOpacity = guide.kickWindow ? s.opacity.ready : opacity;
        this.bars(
            this.overlay,
            this.attackTargets,
            contactColor,
            contactOpacity,
            overlay.attackTarget,
        );
        if (guide.kickWindow)
            this.bars(
                this.overlay,
                [this.attackKick],
                contactColor,
                contactOpacity,
                overlay.attackKick,
            );
    }

    dispose() {
        this.scene.remove(...this.layers.map((layer) => layer.mesh));
        for (const layer of this.layers) layer.dispose();
        for (const geometry of this.sources) geometry.dispose();
        this.arrowGeometry.dispose();
        for (const material of this.materials) material.dispose();
    }
}

export { TakrawMarkers };
