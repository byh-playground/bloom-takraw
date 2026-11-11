import { LOCALE } from '../i18n/locale.js';

/** 모델이 넘긴 TextPair({ ko, en })를 이 페이지 언어의 문자열로. */
const say = (pair) => LOCALE.text(pair);

/** innerHTML 템플릿에 넣는 모든 문자열(문구·사용자 팀 이름·선수 이름)은 이 함수를 거친다. */
function escape(value) {
    return String(value ?? '').replace(
        /[&<>"']/g,
        (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
}

/**
 * id로 찾은 노드의 textContent를 바꾸되, 마지막으로 쓴 값과 같으면 DOM을 건드리지 않는 함수를 만든다.
 * 노드마다 쓰는 객체가 하나라 객체마다 자기 기록(Map)을 가진다.
 */
function createTextSetter() {
    const cache = new Map();
    return (id, value) => {
        const string = value == null ? '' : String(value);
        if (cache.get(id) === string) return;
        cache.set(id, string);
        const node = document.getElementById(id);
        if (node) node.textContent = string;
    };
}

export { say, escape, createTextSetter };
