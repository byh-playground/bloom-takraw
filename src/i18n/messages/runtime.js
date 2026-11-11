import { LOCALE } from '../locale.js';

/** runtime.js가 화면에 넘기는 상태 문구(연결·보상·소리 저장·부팅). 페이지 언어는 읽을 때 정해지므로 만든 문자열을 그대로 상태에 둔다. */
const RUNTIME = LOCALE.messages({
    // 선수 상태(HUD 선택 선수)
    stateReady: { ko: '준비', en: 'Ready' },
    stateAir: { ko: '공중', en: 'In the air' },
    stateFall: { ko: '낙하', en: 'Falling' },
    stateKick: { ko: '발차기', en: 'Kick' },
    stateSpike: { ko: '스파이크', en: 'Spike' },
    stateGettingUp: { ko: '일어나는 중', en: 'Getting up' },
    playerOf: {
        ko: ({ name, role }) => `${name} · ${role}`,
        en: ({ name, role }) => `${name} · ${role}`,
    },
    myTeam: { ko: '우리 팀', en: 'Our team' },

    // 앱·소리·보상
    pwaFailed: {
        ko: ({ detail }) =>
            `설치·오프라인 준비에 실패했어요. 게임은 그대로 할 수 있어요. (${detail})`,
        en: ({ detail }) => `Install and offline setup failed. You can keep playing. (${detail})`,
    },
    soundConflict: {
        ko: '다른 탭에서 소리 설정이 바뀌었어요. 새로고침하면 최신 설정을 불러와요.',
        en: 'Sound settings changed in another tab. Reload to get the latest.',
    },
    soundUnreadable: {
        ko: '저장된 소리 설정을 확인할 수 없어요. 기존 설정은 보존했어요.',
        en: 'The saved sound settings couldn’t be read. They were kept as they are.',
    },
    soundStorage: {
        ko: '소리 설정을 저장하지 못했어요. 브라우저 저장 권한을 확인해 주세요.',
        en: 'Sound settings couldn’t be saved. Check your browser’s storage permission.',
    },
    soundFailed: {
        ko: ({ detail }) => `소리 설정을 저장하지 못했어요. (${detail})`,
        en: ({ detail }) => `Sound settings couldn’t be saved. (${detail})`,
    },
    soundLocked: {
        ko: '저장된 소리 설정을 확인할 수 없어요. 기존 설정은 보존했고 소리는 꺼 두었어요.',
        en: 'The saved sound settings couldn’t be read. They were kept, and sound is off for now.',
    },
    rewardSaving: { ko: '경기 보상을 저장하고 있어요.', en: 'Saving the match reward.' },
    rewardSaved: {
        ko: ({ credits, points }) => `보상 저장 완료 · ${credits} C + ${points} P`,
        en: ({ credits, points }) => `Reward saved · ${credits} C + ${points} P`,
    },
    rewardAlready: {
        ko: '이미 저장된 경기 보상을 확인했어요.',
        en: 'This match reward was already saved.',
    },
    rewardFailed: {
        ko: '보상을 아직 저장하지 못했어요. 탭을 닫기 전에 재시도해 주세요.',
        en: 'The reward isn’t saved yet. Retry before closing the tab.',
    },

    // 부팅·실행 오류
    bootCourt: { ko: '코트를 준비하고 있어요.', en: 'Setting up the court.' },
    bootPlayers: { ko: '선수와 공을 준비하고 있어요.', en: 'Getting the players and ball ready.' },
    bootWebgl: {
        ko: '이 브라우저에서 3D 화면을 사용할 수 없어요. WebGL2를 지원하는 브라우저에서 하드웨어 가속을 켜고 다시 열어주세요.',
        en: 'This browser can’t show 3D. Open the game in a browser with WebGL2 and hardware acceleration turned on.',
    },
    bootFailed: {
        ko: '게임 준비 중 문제가 생겼어요. 도움말의 실행 정보를 확인한 뒤 새로고침해 주세요.',
        en: 'Something went wrong while starting the game. Check the help for requirements, then reload.',
    },
    runFailed: {
        ko: '게임 실행 중 문제가 생겼어요. 새로고침 후 다시 시작해 주세요.',
        en: 'Something went wrong during the game. Reload and start again.',
    },

    // 온라인 연결: 단계(phase)
    phaseIdle: { ko: '연결 준비', en: 'Ready to connect' },
    phaseRelayFailed: { ko: '중계 서버 문제', en: 'Relay server problem' },
    phasePeerFailed: { ko: '직접 연결 실패', en: 'Direct connection failed' },
    phaseSyncFailed: { ko: '게임 상태 불일치', en: 'Game state mismatch' },
    phaseVersionFailed: { ko: '게임 버전 불일치', en: 'Version mismatch' },
    phaseReconnecting: { ko: '재접속 중', en: 'Reconnecting' },
    phaseSyncing: { ko: '경기 동기화 중', en: 'Syncing the match' },
    phaseWaitingPeer: { ko: '상대 연결 중', en: 'Connecting to your friend' },
    phaseWaitingFriend: { ko: '친구 입장 대기', en: 'Waiting for your friend' },
    phaseConnected: { ko: '연결 완료', en: 'Connected' },
    phaseTimeout: { ko: '연결 시간 초과', en: 'Connection timed out' },
    phaseBrowser: { ko: '브라우저 연결 환경', en: 'Browser requirements' },
    phaseResuming: { ko: '이전 경기 재접속', en: 'Rejoining the last match' },
    phaseHosting: { ko: '방 생성 중', en: 'Creating the room' },
    phaseJoining: { ko: '방 검색 중', en: 'Finding the room' },
    phaseRelay: { ko: '중계 서버 연결됨', en: 'Relay server connected' },
    phasePeer: { ko: '친구와 직접 연결됨', en: 'Connected directly to your friend' },
    phaseFailed: { ko: '연결 오류', en: 'Connection error' },
    phaseResume: { ko: '이전 경기 복귀', en: 'Rejoin the last match' },

    // 온라인 연결: 안내(message)·도움말(hint)
    netReconnecting: {
        ko: '연결이 끊겨 경기를 기다리고 있어요. 같은 방으로 다시 연결합니다.',
        en: 'The connection dropped. Reconnecting to the same room.',
    },
    netSyncing: {
        ko: '상대와 연결됐어요. 동일한 경기 상태를 확인하고 있어요.',
        en: 'Connected. Checking that both games match.',
    },
    netPreparing: {
        ko: '방 연결을 준비하고 있어요. 상대방의 접속을 기다리는 중입니다.',
        en: 'Setting up the room. Waiting for your friend to join.',
    },
    netShareCode: {
        ko: '방 코드를 친구에게 알려주세요. 상대가 들어오면 경기가 시작돼요.',
        en: 'Share the room code with your friend. The match starts when they join.',
    },
    netConnected: { ko: '상대와 연결됐어요.', en: 'Connected with your friend.' },
    netTimeout: {
        ko: '상대와 연결은 됐지만 시간 안에 경기 상태를 맞추지 못했어요. 네트워크가 느리거나 두 게임 버전이 다를 수 있어요. 두 분 모두 새로고침해 같은 버전으로 다시 연결해 주세요.',
        en: 'Connected, but the two games didn’t sync in time. The network may be slow, or the versions may differ. Both players should reload to the same version and reconnect.',
    },
    netVersionHint: {
        ko: ({ version }) => `양쪽에서 v${version} 실행 필요`,
        en: ({ version }) => `Both players need v${version}`,
    },
    netResumeSaveFailed: {
        ko: '이전 경기 복귀 정보를 저장하지 못했어요. 새로고침하면 이 경기로 돌아올 수 없어요.',
        en: 'Couldn’t save the rejoin info. If you reload, you can’t return to this match.',
    },
    netStopped: {
        ko: '경기를 계속할 수 없어요. 방을 닫고 다시 시작해 주세요.',
        en: 'The match can’t continue. Close the room and start again.',
    },
    netNoResume: {
        ko: '다시 연결할 경기 정보가 없어요. 새 방을 만들어 주세요.',
        en: 'There’s no match to rejoin. Create a new room.',
    },
    netEnterCode: {
        ko: '친구에게 받은 네 자리 방 코드를 입력해 주세요.',
        en: 'Enter the 4-digit room code from your friend.',
    },
    netBrowser: {
        ko: 'WebRTC·WebCrypto가 동작하는 HTTPS 브라우저에서 열어 주세요.',
        en: 'Open the game over HTTPS in a browser with WebRTC and WebCrypto.',
    },
    netSameVersion: {
        ko: '두 사람이 모두 동일한 HTML 버전을 사용해야 해요.',
        en: 'Both players need the same version of the game.',
    },
    netHosting: {
        ko: '친구를 초대할 방을 만들고 있어요.',
        en: 'Creating a room to invite your friend.',
    },
    netJoining: { ko: '친구의 방을 찾고 있어요.', en: 'Looking for your friend’s room.' },
    netJoinHint: {
        ko: '방 코드 · 양쪽 버전 · 상대가 방을 열어둔 상태인지 확인하세요.',
        en: 'Check the room code, both versions, and that the room is still open.',
    },
    netHostHint: {
        ko: '브라우저 보안 설정과 네트워크 연결을 확인하세요.',
        en: 'Check your browser’s security settings and network connection.',
    },
    netChoose: {
        ko: '방을 만들거나 친구의 방 코드로 참가해 주세요.',
        en: 'Create a room or join with your friend’s code.',
    },
    netResumeUnreadable: {
        ko: '이전 경기 복귀 정보를 확인할 수 없어요. 기존 정보는 보존했어요. 새 방을 만들면 지워져요.',
        en: 'Couldn’t read the rejoin info. It was kept, and creating a new room clears it.',
    },

    // 연결 오류 풀이. detail은 원문(진단용)이다.
    errSecure: {
        ko: '이 브라우저나 주소에서는 온라인 연결에 필요한 보안 기능을 쓸 수 없어요. 게임 문제가 아니라 접속 환경 문제예요. HTTPS 주소에서 다시 열어 주세요.',
        en: 'This browser or address can’t use the security features online play needs. This isn’t a game problem. Open the game over HTTPS and try again.',
    },
    errSync: {
        ko: ({ detail }) =>
            `두 게임의 경기 상태가 달라 검사에 실패했어요. 게임 쪽 문제일 수 있어요. 두 분 모두 새로고침해 같은 버전으로 다시 연결해 주세요. (진단: ${detail})`,
        en: ({ detail }) =>
            `The two games’ match states didn’t agree, so the check failed. This may be a problem in the game. Both players should reload to the same version and reconnect. (Diagnostic: ${detail})`,
    },
    errVersion: {
        ko: ({ version, detail }) =>
            `서로 다른 게임 버전일 수 있어요. 두 분 모두 새로고침해 v${version}으로 맞춰 다시 연결해 주세요. (진단: ${detail})`,
        en: ({ version, detail }) =>
            `The two games may be different versions. Both players should reload to v${version} and reconnect. (Diagnostic: ${detail})`,
    },
    errRelay: {
        ko: ({ detail }) =>
            `친구를 찾아 주는 중계 서버(Nostr)에 연결하지 못했어요. 게임 문제가 아니라 중계 서버나 네트워크 쪽 문제예요. 잠시 뒤 다시 시도해 주세요. (진단: ${detail})`,
        en: ({ detail }) =>
            `Couldn’t reach the relay server (Nostr) that helps you find your friend. This isn’t a game problem — it’s the relay server or the network. Try again in a moment. (Diagnostic: ${detail})`,
    },
    errPeer: {
        ko: ({ detail }) =>
            `친구와 직접 연결되지 않았어요. 게임 문제가 아니라 두 분 중 한쪽 네트워크(방화벽·공용 망)가 막은 걸 수 있어요. Wi-Fi와 데이터를 바꿔 다시 시도해 보세요. (진단: ${detail})`,
        en: ({ detail }) =>
            `Couldn’t connect directly to your friend. This isn’t a game problem — one of your networks (a firewall or public network) may be blocking it. Switch between Wi-Fi and mobile data and try again. (Diagnostic: ${detail})`,
    },
    errOther: {
        ko: ({ detail }) =>
            `연결 중 원인을 알 수 없는 문제가 생겼어요. 다시 시도해 주세요. 계속되면 진단 정보를 알려 주세요. (진단: ${detail})`,
        en: ({ detail }) =>
            `Something unexpected went wrong while connecting. Try again. If it keeps happening, share the diagnostic info. (Diagnostic: ${detail})`,
    },
});

export { RUNTIME };
