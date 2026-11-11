import { PresentationRuntime, RenderObject } from '@bloom-gamekit/interpolation';

/**
 * 시뮬레이션 뷰를 보간 표시(gamekit PresentationRuntime)에 넘기는 통로. 신체 pose 캐시와 게시 리비전·순번을 소유한다.
 * reset()마다 새 PresentationRuntime과 새 BodyPose 클래스를 만든다(이전 리셋의 pose가 섞이지 않게).
 * 타이머·구독은 없다. dispose()는 보간 런타임과 pose 캐시를 놓는다.
 */
class PresentationFeed {
    constructor({ stepMs }) {
        this.stepMs = stepMs;
        this.presentation = null;
        this.BodyPose = null;
        this.poseCache = new Map();
        this.poseEntities = [];
        this.publishedTick = -1;
        this.gameRevision = -1;
        this.presentationRevision = 0;
        this.presentationSequence = 0;
        this.resetMode = 'reset';
    }

    /** 보간을 처음부터 다시 시작한다(경기 시작·처음 화면 복귀). */
    reset() {
        class BodyPose extends RenderObject {
            static renderSchema = {
                x: this.POSITION_X,
                y: this.POSITION_Y,
                z: this.POSITION_Z,
                qx: this.LINEAR,
                qy: this.LINEAR,
                qz: this.LINEAR,
                qw: this.LINEAR,
                halfHeight: this.LINEAR,
            };
        }
        this.presentation = new PresentationRuntime({ stepMs: this.stepMs, delayMs: this.stepMs });
        this.poseCache.clear();
        this.poseEntities.length = 0;
        this.publishedTick = -1;
        this.gameRevision = -1;
        this.presentationRevision += 1;
        this.presentationSequence = 0;
        this.resetMode = 'reset';
        this.BodyPose = BodyPose;
    }

    /** 표시할 수 있는지(첫 reset 이후). */
    get ready() {
        return Boolean(this.presentation);
    }

    /** 다음 게시를 이어지는 장면이 아니라 끊긴 장면으로 보낸다. kind: 'reset'(불러오기·합류) | 'rollback'(롤백 재계산). */
    invalidate(kind) {
        this.resetMode = kind;
    }

    /** 시뮬레이션 뷰 하나를 보간 버퍼에 넣는다. 같은 틱·같은 리비전이면 force가 아닐 때 건너뛴다. */
    publish(view, force = false, now = performance.now()) {
        if (!this.presentation || !view) return;
        const tick = view.state.tick;
        if (
            !force &&
            this.publishedTick === tick &&
            this.gameRevision === view.revision &&
            !this.resetMode
        )
            return;
        if (this.gameRevision !== view.revision || tick < this.publishedTick)
            this.resetMode ||= 'reset';
        if (this.resetMode) this.presentationRevision += 1;
        const poseCache = this.poseCache,
            poseEntities = this.poseEntities;
        poseEntities.length = 0;
        const liveIds = new Set();
        for (const entity of view.entities) {
            liveIds.add(entity.id);
            let source = poseCache.get(entity.id);
            if (!source) {
                source = {
                    x: entity.x,
                    y: entity.y,
                    z: entity.z,
                    qx: entity.qx,
                    qy: entity.qy,
                    qz: entity.qz,
                    qw: entity.qw,
                    halfHeight: entity.halfHeight ?? 0,
                };
                poseCache.set(entity.id, source);
            }
            const dot =
                source.qx * entity.qx +
                source.qy * entity.qy +
                source.qz * entity.qz +
                source.qw * entity.qw;
            const sign = dot < 0 ? -1 : 1;
            source.x = entity.x;
            source.y = entity.y;
            source.z = entity.z;
            source.qx = entity.qx * sign;
            source.qy = entity.qy * sign;
            source.qz = entity.qz * sign;
            source.qw = entity.qw * sign;
            source.halfHeight = entity.halfHeight ?? 0;
            poseEntities.push({ id: entity.id, generation: 0, type: this.BodyPose, source });
        }
        for (const id of poseCache.keys()) if (!liveIds.has(id)) poseCache.delete(id);
        this.presentation.capture(
            {
                revision: this.presentationRevision,
                sequence: ++this.presentationSequence,
                timeMs: tick * this.stepMs,
                mode: this.resetMode || 'continuous',
                entities: poseEntities,
            },
            now,
        );
        this.publishedTick = tick;
        this.gameRevision = view.revision;
        this.resetMode = null;
    }

    /** 지금 시각의 보간 pose. */
    frame(now) {
        return this.presentation.frame(now);
    }

    /** 런타임 종료: 보간 런타임과 pose 캐시를 놓는다. 그 뒤 ready는 false다. */
    dispose() {
        this.presentation = null;
        this.BodyPose = null;
        this.poseCache.clear();
        this.poseEntities.length = 0;
    }
}

export { PresentationFeed };
