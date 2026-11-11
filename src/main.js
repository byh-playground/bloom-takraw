import { TAKRAW_DIAGNOSTIC_NAME } from './config/game.js';

// Load the runtime after the shell so a failed CDN import stays visible.
// The page text comes first: index.html leaves every data-i18n element empty until LOCALE.applyPage fills it (docs/i18n.md).
const message = document.getElementById('boot-message');
for (const button of document.querySelectorAll('.start-button')) button.disabled = true;
let boot = null;
try {
    const [{ LOCALE }, { PAGE, BOOT }] = await Promise.all([
        import('./i18n/locale.js'),
        import('./i18n/messages/page.js'),
    ]);
    LOCALE.applyPage(document, PAGE);
    boot = BOOT;
    message.textContent = boot.loading();
    const { bootTakraw } = await import('./runtime.js');
    await bootTakraw();
} catch (error) {
    console.error(`[${TAKRAW_DIAGNOSTIC_NAME}]`, error);
    document.getElementById('boot-status').className = 'boot-status error';
    // Without the i18n module there is no language to write in; the reload button keeps its ↻ glyph.
    if (!window.__takraw) message.textContent = boot ? boot.failed() : '⚠';
    const reload = document.getElementById('reload-button');
    reload.hidden = false;
    // The UI owns this listener once bootTakraw has created the runtime.
    if (!window.__takraw) reload.addEventListener('click', () => location.reload(), { once: true });
}
