// Load the runtime after the shell so a failed CDN import stays visible.
const message = document.getElementById('boot-message');
message.textContent = '게임 모듈을 불러오고 있어요.';
for (const button of document.querySelectorAll('.start-button')) button.disabled = true;
try {
  const { bootTakraw } = await import('./runtime.js');
  await bootTakraw();
} catch (error) {
  console.error('[BLOOM TAKRAW]', error);
  document.getElementById('boot-status').className = 'boot-status error';
  if (!window.__takraw) {
    message.textContent = '게임 모듈을 불러오지 못했어요. 인터넷 연결을 확인하고 HTTP 서버 또는 배포 주소에서 다시 열어 주세요.';
  }
  const reload = document.getElementById('reload-button');
  reload.hidden = false;
  // The UI owns this listener once bootTakraw has created the runtime.
  if (!window.__takraw) reload.addEventListener('click', () => location.reload(), { once: true });
}
