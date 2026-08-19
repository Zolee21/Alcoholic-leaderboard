/** ItalPont V5.2 PWA + standards-based Web Push */
(() => {
  let deferredPrompt = null;
  let swRegistration = null;
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

  async function ensureServiceWorker(){
    if(!('serviceWorker' in navigator))throw new Error('A Service Worker nem támogatott ezen az eszközön.');
    if(swRegistration)return swRegistration;
    try{
      swRegistration=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
    }catch(e){
      console.warn('PWA service worker regisztráció sikertelen:',e);
      throw e;
    }
    return navigator.serviceWorker.ready;
  }

  function setWebPushStatus(text,state='warn',enabled=false){
    const el=$('webPushStatus');
    if(el){el.textContent=text;el.className=`push-status ${state}`;}
    $('webPushEnableBtn')?.classList.toggle('hidden',enabled);
    $('webPushDisableBtn')?.classList.toggle('hidden',!enabled);
  }

  function base64UrlToUint8Array(base64Url){
    const padding='='.repeat((4-base64Url.length%4)%4);
    const base64=(base64Url+padding).replace(/-/g,'+').replace(/_/g,'/');
    const raw=atob(base64);
    return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
  }

  function webPushSupported(){
    return !isNative() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  async function initPush(){
    const card=$('webPushSettings');
    if(!card||isNative())return;

    // iPhone Safari only exposes usable Home Screen Web Push after install.
    if(isIOS && !isStandalone()){
      card.classList.remove('hidden');
      setWebPushStatus('Előbb telepítsd a Főképernyőre','warn',false);
      const h=$('webPushHint');
      if(h)h.textContent='Safari → Megosztás → Hozzáadás a Főképernyőhöz, majd az ikonról nyisd meg.';
      return;
    }

    if(!webPushSupported()){
      // Other browsers where Web Push is unavailable: keep the card hidden.
      if(isIOS){card.classList.remove('hidden');setWebPushStatus('Ezen a verzión nem támogatott','off',false)}
      return;
    }

    card.classList.remove('hidden');
    try{
      const reg=await ensureServiceWorker();
      const sub=await reg.pushManager.getSubscription();
      if(sub){
        await window.registerWebPushSubscription?.(sub);
        setWebPushStatus('Bekapcsolva ✓','ok',true);
      }else if(Notification.permission==='denied'){
        setWebPushStatus('Letiltva a rendszerben','off',false);
      }else{
        setWebPushStatus('Nincs bekapcsolva','warn',false);
      }
    }catch(e){
      console.error('Web Push állapot hiba:',e);
      setWebPushStatus('Állapot nem olvasható','off',false);
    }
  }

  async function enablePush(){
    if(isNative())return;
    if(isIOS && !isStandalone()){
      showInstallUI();
      alert('iPhone-on előbb add az ItalPontot a Főképernyőhöz, majd az ikonról nyisd meg és ott kapcsold be az értesítéseket.');
      return;
    }
    if(!webPushSupported()){
      alert('Ezen az eszközön/böngészőben a Web Push nem érhető el.');
      return;
    }

    try{
      setWebPushStatus('Engedélykérés...','warn',false);
      const permission=await Notification.requestPermission();
      if(permission!=='granted'){
        setWebPushStatus('Az értesítés nincs engedélyezve','off',false);
        return;
      }

      const reg=await ensureServiceWorker();
      let sub=await reg.pushManager.getSubscription();
      if(!sub){
        const publicKey=await window.getWebPushPublicKey?.();
        if(!publicKey)throw new Error('Nem érhető el a VAPID publikus kulcs.');
        sub=await reg.pushManager.subscribe({
          userVisibleOnly:true,
          applicationServerKey:base64UrlToUint8Array(publicKey)
        });
      }
      await window.registerWebPushSubscription?.(sub);
      setWebPushStatus('Bekapcsolva ✓','ok',true);
      const h=$('webPushHint');
      if(h)h.textContent='Az iPhone mostantól fogadhatja az ItalPont értesítéseit.';
    }catch(e){
      console.error('Web Push bekapcsolási hiba:',e);
      setWebPushStatus('Bekapcsolási hiba','off',false);
      alert(e?.message||String(e));
    }
  }

  async function disablePush(){
    if(!webPushSupported())return;
    try{
      const reg=await ensureServiceWorker();
      const sub=await reg.pushManager.getSubscription();
      if(sub){
        await window.unregisterWebPushSubscription?.(sub);
        await sub.unsubscribe();
      }
      setWebPushStatus('Kikapcsolva','warn',false);
    }catch(e){
      console.error('Web Push kikapcsolási hiba:',e);
      alert(e?.message||String(e));
    }
  }

  async function unregisterPush(){
    if(!webPushSupported())return;
    try{
      const reg=await ensureServiceWorker();
      const sub=await reg.pushManager.getSubscription();
      if(sub){
        await window.unregisterWebPushSubscription?.(sub);
        await sub.unsubscribe();
      }
    }catch(e){console.warn('Web Push logout cleanup:',e)}
  }

  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();deferredPrompt=e;showInstallUI();
  });
  window.addEventListener('appinstalled',()=>{
    deferredPrompt=null;localStorage.removeItem('italpont_pwa_install_dismissed');syncInstalledState();
  });
  window.addEventListener('load',async()=>{
    if(!isNative()){
      try{await ensureServiceWorker()}catch(_){}
      setTimeout(showInstallUI,900);
    }else setTimeout(showInstallUI,500);
  });

  window.ItalPontPWA={
    install,dismiss,isIOS,isStandalone,showInstallUI,
    initPush,enablePush,disablePush,unregisterPush
  };
})();
