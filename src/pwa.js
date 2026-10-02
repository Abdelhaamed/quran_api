import { registerSW } from 'virtual:pwa-register';
import { h, qs } from './utils/dom.js';

export function initPWA({ onUpdateReady } = {}) {
  let deferredPrompt = null;
  const installBtn = qs('#install');

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      const toast = qs('#toast');
      toast.replaceChildren(
        h('span', {}, 'يتوفر تحديث للتطبيق'),
        h('button', {
          class: 'btn-primary', type: 'button',
          style: 'margin-inline-start:var(--sp-3)',
          onclick: () => { onUpdateReady?.(); updateSW(true); },
        }, 'تحديث'),
      );
      toast.hidden = false;
    },
  });

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });

  installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  addEventListener('appinstalled', () => { if (installBtn) installBtn.hidden = true; });

  return { updateSW };
}
