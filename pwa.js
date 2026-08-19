(() => {
  let deferredPrompt = null;
  const $ = id => document.getElementById(id);
  const isNative = () => !!window.ItalPontPlatform?.isNative;
  const isStandalone = () =>
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true;
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function syncInstalledState() {
    const installed = isStandalone() || isNative();
    document.documentElement.classList.toggle('pwa-installed', installed);
    if (installed) {
      $('pwaInstallBanner')?.classList.remove('show');
      $('pwaInstallMenu')?.classList.add('hidden');
    }
    return installed;
  }

  function showInstallUI() {
    if (isNative() || syncInstalledState()) return;
    const dismissed = localStorage.getItem('italpont_pwa_install_dismissed') === '1';
    const menu = $('pwaInstallMenu');
    if (menu && (isIOS || deferredPrompt)) menu.classList.remove('hidden');
    if (dismissed) return;
    const banner = $('pwaInstallBanner');
    if (!banner) return;

    if (isIOS) {
      $('pwaInstallText').textContent = 'iPhone-on add hozzá az ItalPontot a Főképernyőhöz.';
      $('pwaInstallHelp').textContent = 'Safari → Megosztás → Hozzáadás a Főképernyőhöz → Hozzáadás';
      $('pwaInstallHelp').classList.remove('hidden');
      banner.classList.add('show');
    } else if (deferredPrompt) {
      $('pwaInstallText').textContent = 'Telepítsd az ItalPontot alkalmazásként erre az eszközre.';
      $('pwaInstallHelp').classList.add('hidden');
      banner.classList.add('show');
    }
  }

  async function install() {
    if (isNative() || syncInstalledState()) return;
    if (isIOS) {
      const help = $('pwaInstallHelp');
      if (help) {
        help.textContent = 'Safari → Megosztás → Hozzáadás a Főképernyőhöz → Hozzáadás';
        help.classList.remove('hidden');
      }
      $('pwaInstallBanner')?.classList.add('show');
      return;
    }
    if (!deferredPrompt) {
      alert('A böngésző telepítési menüjéből add hozzá az ItalPontot az eszközödhöz.');
      return;
    }
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (_) {}
    deferredPrompt = null;
    syncInstalledState();
  }

  function dismiss() {
    localStorage.setItem('italpont_pwa_install_dismissed', '1');
    $('pwaInstallBanner')?.classList.remove('show');
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallUI();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    localStorage.removeItem('italpont_pwa_install_dismissed');
    syncInstalledState();
  });

  if ('serviceWorker' in navigator && !isNative()) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
        console.log('ItalPont PWA service worker:', reg.scope);
      } catch (e) {
        console.warn('PWA service worker regisztráció sikertelen:', e);
      }
      setTimeout(showInstallUI, 900);
    });
  } else {
    window.addEventListener('load', () => setTimeout(showInstallUI, 500));
  }

  window.ItalPontPWA = { install, dismiss, isIOS, isStandalone, showInstallUI };
})();