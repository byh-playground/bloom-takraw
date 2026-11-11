import { audioSettings } from '@bloom-gamekit/audio';
import {
    createSave,
    indexedDbAdapter,
    localStorageAdapter,
    memoryAdapter,
} from '@bloom-gamekit/save';
import { TAKRAW_VERSION, TAKRAW_ID } from '../config/game.js';
import { TAKRAW_RUNTIME } from '../config/runtime.js';

const SAVE_STORES = Object.freeze({
    club: () => indexedDbAdapter({ database: `${TAKRAW_ID}-club`, store: 'club' }),
    settings: () => localStorageAdapter({ prefix: `${TAKRAW_ID}:` }),
    resume: () =>
        localStorageAdapter({
            storage: sessionStorage,
            prefix: `${TAKRAW_ID}:${TAKRAW_VERSION}:`,
        }),
});

/**
 * 저장소는 여기서만 고른다. 격리 장면(확인용 주소 ?debug, 소개영상 화면 ?showcaseDemo=1)은 모든 저장(팀·소리 설정·방 복귀)을
 * 메모리에만 남겨 실제 저장을 읽지도 쓰지도 않는다. 방 복귀는 탭마다 따로이고 같은 게임 버전끼리만 이어지도록 sessionStorage에 버전을 붙여 둔다.
 *   resume: 방 복귀 어댑터. 마지막으로 연 방(activeRoom)과 transport의 방별 identity가 같은 어댑터의 레코드다.
 *   openClubSave: 클럽이 자기 저장 레코드를 열 때 쓰는 함수.
 */
function createRuntimeStores({ isolated }) {
    const adapter = (store) => (isolated ? memoryAdapter() : SAVE_STORES[store]());
    const resume = adapter('resume');
    const activeRoom = createSave({
        adapter: resume,
        key: 'active-room',
        version: 1,
        create: () => ({ room: null }),
        validate(data) {
            const value = data.room;
            if (
                value !== null &&
                (!value || !['host', 'join'].includes(value.role) || !/^\d{4}$/.test(value.room))
            )
                throw new TypeError('active room record');
        },
    });
    const soundSettings = createSave({
        ...audioSettings(TAKRAW_RUNTIME.audio),
        adapter: adapter('settings'),
    });
    return {
        resume,
        activeRoom,
        soundSettings,
        openClubSave: (options) => createSave({ ...options, adapter: adapter('club') }),
        dispose() {
            soundSettings.dispose();
            activeRoom.dispose();
        },
    };
}

export { createRuntimeStores };
