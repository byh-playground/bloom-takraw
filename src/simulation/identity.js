import { TAKRAW_SCHOOLS } from '../config/schools.js';

/** 온라인 1대1에서 두 사람이 접속 직후 서로에게 알리는 팀 이름·학교. 표시 전용이고 능력치는 담지 않는다. */
const TAKRAW_IDENTITY_COMMAND = 40;
const NAME_LENGTH = 18;

/** 명령 payload: [40, 학교 번호, ...UTF-8 팀 이름]. 이름은 18자까지만 담는다. */
function takrawEncodeIdentity(schoolId, name) {
  const index = Math.max(0, TAKRAW_SCHOOLS.findIndex(school => school.id === schoolId));
  const text = [...String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, NAME_LENGTH).join('');
  return Uint8Array.of(TAKRAW_IDENTITY_COMMAND, index, ...new TextEncoder().encode(text));
}

/** 받은 payload를 검증해 { schoolId, name }으로 푼다. 모양이 맞지 않으면 null이라 무시한다. 두 피어가 같은 결과를 얻는다. */
function takrawDecodeIdentity(payload) {
  if (!payload || payload[0] !== TAKRAW_IDENTITY_COMMAND || payload.length < 3 || payload.length > 2 + NAME_LENGTH * 4) return null;
  const school = TAKRAW_SCHOOLS[payload[1]];
  const name = [...new TextDecoder().decode(payload.subarray(2)).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, NAME_LENGTH).join('');
  return school && name ? { schoolId: school.id, name } : null;
}

/** 두 팀의 학교를 정한다. 아직 모르는 쪽은 기본 쌍(처음 두 학교)을 쓰고, 같은 학교가 겹치면 두 번째 팀은 다음 학교 색을 쓴다. */
function takrawIdentitySchools(ids) {
  const first = TAKRAW_SCHOOLS.find(school => school.id === ids?.[0]) ?? TAKRAW_SCHOOLS[0];
  let second = TAKRAW_SCHOOLS.find(school => school.id === ids?.[1]) ?? TAKRAW_SCHOOLS[1];
  if (second === first) second = TAKRAW_SCHOOLS[(TAKRAW_SCHOOLS.indexOf(first) + 1) % TAKRAW_SCHOOLS.length];
  return [first, second];
}

export { TAKRAW_IDENTITY_COMMAND, takrawEncodeIdentity, takrawDecodeIdentity, takrawIdentitySchools };
