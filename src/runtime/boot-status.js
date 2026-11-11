/**
 * 부팅 단계(interface → physics → graphics → controls → ready, 실패 failed, 종료 disposed)와 처음 화면 상태 줄.
 * stage는 준비 여부·오류 문구 분기·진단의 원본이라 이 모듈만 바꾼다(DEV-001).
 * 상태 줄을 비울 때(경기 시작·처음 화면 복귀)도 PWA 오류 알림(notice)은 남긴다.
 *   render(status): 상태 줄 표시(→ ui.setBootStatus). 처음 show 전에 화면이 있어야 한다.
 */
class BootStatus {
    constructor({ render }) {
        this.render = render;
        this.stage = 'interface';
        this.appNotice = null;
    }

    get ready() {
        return this.stage === 'ready';
    }

    advance(stage) {
        this.stage = stage;
    }

    show(message = '', isError = false) {
        if (!message && !isError && this.appNotice)
            this.render({ phase: this.stage, ...this.appNotice });
        else this.render({ phase: this.stage, message, isError });
    }

    notice(notice) {
        this.appNotice = notice;
        this.show();
    }

    /** 런타임 종료. 자원은 없고 단계만 disposed로 둔다(진단·준비 여부가 읽는다). */
    dispose() {
        this.stage = 'disposed';
    }
}

export { BootStatus };
