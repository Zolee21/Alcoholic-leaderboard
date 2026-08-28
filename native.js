/**
 * ItalPont V5.8.0 native Android bridge.
 * Kamera-stabilitás + Android appRestoredResult kezelés.
 * Weben biztonságosan no-op.
 */
(() => {
  let selectedPreviewUrl = null;
  let currentPushToken = null;
  let pushInitialized = false;
  let cameraBusy = false;
  let restoredListenerInitialized = false;
  let pendingRestoredCameraResult = null;
  let lastUpdateCheck = 0;
  let updateCheckInFlight = false;
  let pendingInstallRelease = null;
  let appLifecycleInitialized = false;
  let cameraRecoveryTimeout = null;

  const CAMERA_PENDING_KEY='italpont_camera_restore_pending';
  const CAMERA_STARTED_KEY='italpont_camera_started_at';
  const CAMERA_RESUME_PAGE_KEY='italpont_camera_resume_page';

  const isNative = () => !!window.ItalPontPlatform?.isNative;
  const pluginCache={};
  const plugin = name => {
    if(pluginCache[name])return pluginCache[name];
    const legacy=window.Capacitor?.Plugins?.[name];
    if(legacy)return (pluginCache[name]=legacy);
    try{
      if(typeof window.Capacitor?.registerPlugin==='function'){
        return (pluginCache[name]=window.Capacitor.registerPlugin(name));
      }
    }catch(_){}
    return null;
  };
  const $ = id => document.getElementById(id);

  function setPushStatus(text, state='warn'){
    const el=$('pushStatus');
    if(!el)return;
    el.textContent=text;
    el.className=`push-status ${state}`;
  }

  async function resultToFile(result, fallbackName='italpont.jpg'){
    const candidates=[];
    const add=value=>{
      if(value && !candidates.includes(value))candidates.push(value);
    };

    add(result?.webPath);

    for(const nativePath of [result?.uri,result?.path]){
      if(!nativePath)continue;
      try{
        if(window.Capacitor?.convertFileSrc)add(window.Capacitor.convertFileSrc(nativePath));
      }catch(_){}
      add(nativePath);
    }

    if(!candidates.length)throw new Error('A kiválasztott képhez nem érkezett olvasható fájlútvonal.');

    let lastError=null;
    for(const mediaPath of candidates){
      try{
        const response=await fetch(mediaPath,{cache:'no-store'});
        if(!response.ok)throw new Error(`Kép beolvasási HTTP hiba: ${response.status}`);
        const blob=await response.blob();
        if(!blob?.size)throw new Error('A kamerakép üres.');
        const format=(result?.format||result?.metadata?.format||blob.type?.split('/')[1]||'jpg').replace('jpeg','jpg');
        const safeName=fallbackName.replace(/\.[^.]+$/,'')||'italpont';
        return new File(
          [blob],
          `${safeName}-${Date.now()}.${format}`,
          {type:blob.type||`image/${format==='jpg'?'jpeg':format}`}
        );
      }catch(e){
        lastError=e;
      }
    }

    throw lastError||new Error('A kép beolvasása sikertelen.');
  }

  function setNativePhoto(file,webPath,source='native'){
    if(selectedPreviewUrl?.startsWith('blob:'))URL.revokeObjectURL(selectedPreviewUrl);
    selectedPreviewUrl=webPath||URL.createObjectURL(file);
    window.setNativeDrinkPhoto?.(file,selectedPreviewUrl,source);
  }

  function clearDrinkPhotoPreviewOnly(){
    const box=$('nativePhotoPreview');
    if(box)box.classList.remove('show');
  }

  function clearDrinkPhoto(){
    if(selectedPreviewUrl?.startsWith('blob:'))URL.revokeObjectURL(selectedPreviewUrl);
    selectedPreviewUrl=null;
    window.setNativeDrinkPhoto?.(null,null,null);
  }

  function setCameraBusy(busy){
    cameraBusy=!!busy;
    const cameraBtn=$('nativeCameraBtn');
    const galleryBtn=$('nativeGalleryBtn');
    if(cameraBtn)cameraBtn.disabled=cameraBusy;
    if(galleryBtn)galleryBtn.disabled=cameraBusy;
  }

  function markCameraPending(){
    try{
      localStorage.setItem(CAMERA_PENDING_KEY,'1');
      localStorage.setItem(CAMERA_STARTED_KEY,String(Date.now()));
      localStorage.setItem(CAMERA_RESUME_PAGE_KEY,'upload');
    }catch(_){}
  }

  function clearCameraPending(){
    try{
      localStorage.removeItem(CAMERA_PENDING_KEY);
      localStorage.removeItem(CAMERA_STARTED_KEY);
      localStorage.removeItem(CAMERA_RESUME_PAGE_KEY);
    }catch(_){}
    if(cameraRecoveryTimeout){
      clearTimeout(cameraRecoveryTimeout);
      cameraRecoveryTimeout=null;
    }
  }

  function hasPendingCameraRecovery(){
    try{
      if(localStorage.getItem(CAMERA_PENDING_KEY)!=='1')return false;
      const started=Number(localStorage.getItem(CAMERA_STARTED_KEY)||0);
      // Régi, félbemaradt jelzőt ne őrizzünk örökké.
      if(started && Date.now()-started>5*60*1000){
        clearCameraPending();
        return false;
      }
      return true;
    }catch(_){
      return false;
    }
  }

  function showCameraRecoverySplash(){
    if(!hasPendingCameraRecovery())return;
    window.ItalPontBootSplash?.show?.('Kamerakép visszaállítása…');
  }

  function navigateToUploadWhenReady(mode='normal'){
    let tries=0;
    const timer=setInterval(()=>{
      tries++;
      const app=$('app');
      const ready=app && !app.classList.contains('hidden') && typeof window.showPage==='function';
      if(ready){
        clearInterval(timer);
        const btn=document.querySelector('.navbtn[data-page="upload"]');
        window.showPage('upload',btn);

        if(mode==='restored'){
          if(typeof window.message==='function'){
            window.message('uploadMsg','A kamerakép sikeresen visszaállt. Ellenőrizd, majd töltsd fel.');
          }
          clearCameraPending();
        }else if(mode==='recovering'){
          if(typeof window.message==='function'){
            window.message('uploadMsg','Kamerakép visszaállítása folyamatban…',false);
          }
        }

        window.ItalPontBootSplash?.hide?.(180);
      }else if(tries>=80){
        clearInterval(timer);
      }
    },150);
  }

  function startCameraRecoveryTimeout(){
    if(!hasPendingCameraRecovery())return;
    if(cameraRecoveryTimeout)clearTimeout(cameraRecoveryTimeout);

    cameraRecoveryTimeout=setTimeout(()=>{
      if(!hasPendingCameraRecovery())return;

      // Ha már megjött az eredmény, még hagyunk időt a WebView fájl-elérésnek.
      if(pendingRestoredCameraResult){
        cameraRecoveryTimeout=setTimeout(startCameraRecoveryTimeout,3500);
        return;
      }

      clearCameraPending();
      window.ItalPontBootSplash?.hide?.(120);
      navigateToUploadWhenReady('normal');

      setTimeout(()=>{
        if(typeof window.message==='function'){
          window.message(
            'uploadMsg',
            'A kamera bezárult, de a kép nem érkezett vissza az alkalmazásba. Próbáld meg újra; az ItalPont most már nem dob vissza a főoldalra.',
            true
          );
        }
      },250);
    },12000);
  }

  function resumeCameraRecoveryUi(){
    if(!hasPendingCameraRecovery())return false;
    showCameraRecoverySplash();
    navigateToUploadWhenReady('recovering');
    startCameraRecoveryTimeout();
    return true;
  }

  function extractRestoredMedia(event){
    if(!event?.success || event?.pluginId!=='Camera')return null;
    const data=event.data;
    if(!data)return null;
    if(Array.isArray(data?.results))return data.results[0]||null;
    if(Array.isArray(data))return data[0]||null;
    return data;
  }

  async function flushPendingRestoredPhoto(){
    if(!pendingRestoredCameraResult || typeof window.setNativeDrinkPhoto!=='function')return false;

    const result=pendingRestoredCameraResult;
    try{
      const file=await resultToFile(result,'camera-restored.jpg');

      // Csak a sikeres beolvasás UTÁN töröljük a pending resultot.
      // Korábban egy túl korai WebView/fetch hiba végleg elvesztette a képet.
      pendingRestoredCameraResult=null;

      setNativePhoto(file,result?.webPath,'camera');
      navigateToUploadWhenReady('restored');
      return true;
    }catch(e){
      // Fontos: pendingRestoredCameraResult megmarad, így a következő retry
      // ugyanazt a képet újra megpróbálja beolvasni.
      console.warn('Visszaállított kamerakép még nem olvasható, újrapróbáljuk:',e);
      return false;
    }
  }

  async function initRestoredResultListener(){
    if(!isNative() || restoredListenerInitialized)return;
    const App=plugin('App');
    if(!App?.addListener)return;
    restoredListenerInitialized=true;

    await App.addListener('appRestoredResult',async event=>{
      if(event?.pluginId!=='Camera')return;

      showCameraRecoverySplash();
      navigateToUploadWhenReady('recovering');

      if(!event.success){
        console.warn('Camera restored result hiba:',event?.error);
        clearCameraPending();
        window.ItalPontBootSplash?.hide?.(120);
        setTimeout(()=>{
          if(typeof window.message==='function'){
            window.message('uploadMsg','A kamera nem adott vissza képet. Próbáld újra.',true);
          }
        },250);
        return;
      }

      const result=extractRestoredMedia(event);
      if(!result){
        console.warn('Camera restored result: nincs feldolgozható data.');
        startCameraRecoveryTimeout();
        return;
      }

      pendingRestoredCameraResult=result;

      // Android process/Activity újraindításkor az event gyakran hamarabb érkezik,
      // mint hogy a Capacitor helyi fájlszervere teljesen készen állna.
      for(let i=0;i<60 && pendingRestoredCameraResult;i++){
        if(await flushPendingRestoredPhoto())break;
        await new Promise(r=>setTimeout(r,250));
      }

      if(pendingRestoredCameraResult)startCameraRecoveryTimeout();
    });
  }

  async function takeDrinkPhoto(){
    if(!isNative()||cameraBusy)return;
    const Camera=plugin('Camera');
    if(!Camera)throw new Error('A Camera plugin nincs szinkronizálva. Futtasd: npm run android:update');

    setCameraBusy(true);
    markCameraPending();
    try{
      let result;
      if(typeof Camera.takePhoto==='function'){
        result=await Camera.takePhoto({
          quality:74,
          targetWidth:1280,
          targetHeight:1280,
          correctOrientation:true,
          saveToGallery:false,
          cameraDirection:'REAR',
          editable:'no',
          includeMetadata:true
        });
      }else{
        result=await Camera.getPhoto({
          quality:74,
          width:1280,
          height:1280,
          resultType:'uri',
          source:'CAMERA',
          direction:'REAR',
          correctOrientation:true,
          saveToGallery:false
        });
      }
      const file=await resultToFile(result,'camera.jpg');
      setNativePhoto(file,result?.webPath,'camera');
      clearCameraPending();
      navigateToUploadWhenReady('normal');
    }catch(e){
      clearCameraPending();
      if(String(e?.message||e).toLowerCase().includes('cancel'))return;
      alert(`Kamera hiba: ${e?.message||e}`);
    }finally{
      setCameraBusy(false);
    }
  }

  async function chooseDrinkPhoto(){
    if(!isNative()||cameraBusy)return;
    const Camera=plugin('Camera');
    if(!Camera)throw new Error('A Camera plugin nincs szinkronizálva. Futtasd: npm run android:update');

    setCameraBusy(true);
    try{
      let result;
      if(typeof Camera.chooseFromGallery==='function'){
        const picked=await Camera.chooseFromGallery({
          mediaType:0,
          allowMultipleSelection:false,
          quality:74,
          targetWidth:1280,
          targetHeight:1280,
          editable:'no',
          includeMetadata:true
        });
        result=picked?.results?.[0];
      }else{
        result=await Camera.getPhoto({
          quality:74,
          width:1280,
          height:1280,
          resultType:'uri',
          source:'PHOTOS',
          correctOrientation:true
        });
      }
      if(!result)return;
      const file=await resultToFile(result,'gallery.jpg');
      setNativePhoto(file,result?.webPath,'gallery');
      navigateToUploadWhenReady('normal');
    }catch(e){
      if(String(e?.message||e).toLowerCase().includes('cancel'))return;
      alert(`Galéria hiba: ${e?.message||e}`);
    }finally{
      setCameraBusy(false);
    }
  }

  async function ensurePushListeners(){
    const Push=plugin('PushNotifications');
    if(!Push || pushInitialized)return Push;
    pushInitialized=true;

    await Push.addListener('registration',async token=>{
      currentPushToken=token.value;
      localStorage.setItem('italpont_push_token',token.value);
      try{
        await window.savePushToken?.(token.value);
        setPushStatus('Bekapcsolva ✓','ok');
      }catch(e){
        console.error('Push token mentési hiba:',e);
        setPushStatus('Token mentési hiba','off');
      }
    });

    await Push.addListener('registrationError',err=>{
      console.error('Push regisztrációs hiba:',err);
      setPushStatus('Regisztrációs hiba','off');
    });

    await Push.addListener('pushNotificationReceived',notification=>{
      console.log('Push érkezett:',notification);
      if(notification?.data?.event_type==='new_drink'){
        window.loadHome?.();
      }else if(notification?.data?.event_type==='new_comment'){
        window.loadDrinks?.();
      }
    });

    await Push.addListener('pushNotificationActionPerformed',action=>{
      const eventType=action?.notification?.data?.event_type;
      if(eventType==='new_drink'){
        const home=document.querySelector('[data-page="home"]');
        window.showPage?.('home',home);
        window.loadHome?.();
      }else if(eventType==='new_comment'){
        const drinkId=action?.notification?.data?.drink_id;
        if(drinkId)window.openDrinkFromNotification?.(drinkId);
        else{
          const community=document.querySelector('[data-page="community"]');
          window.showPage?.('community',community);
          window.loadDrinks?.();
        }
      }else{
        const home=document.querySelector('[data-page="home"]');
        window.showPage?.('home',home);
      }
    });

    try{
      await Push.createChannel({
        id:'italpont',
        name:'ItalPont értesítések',
        description:'Új italok, új játékosok és hozzászólások',
        importance:5,
        visibility:1,
        sound:'default',
        vibration:true
      });
    }catch(e){
      console.warn('Notification channel:',e);
    }
    return Push;
  }

  async function initPush(){
    if(!isNative())return;
    const Push=await ensurePushListeners();
    if(!Push){
      setPushStatus('Push plugin nincs telepítve','off');
      return;
    }

    try{
      let perm=await Push.checkPermissions();
      if(perm.receive==='granted'){
        setPushStatus('Bekapcsolva ✓','ok');
        await Push.register();
        return;
      }

      const asked=localStorage.getItem('italpont_push_permission_asked')==='1';
      if(!asked && (perm.receive==='prompt'||perm.receive==='prompt-with-rationale')){
        localStorage.setItem('italpont_push_permission_asked','1');
        perm=await Push.requestPermissions();
        if(perm.receive==='granted'){
          setPushStatus('Bekapcsolva ✓','ok');
          await Push.register();
          return;
        }
      }
      setPushStatus('Nincs engedélyezve','off');
    }catch(e){
      console.error('Push init hiba:',e);
      setPushStatus('Push beállítási hiba','off');
    }
  }

  async function enablePush(){
    if(!isNative())return;
    const Push=await ensurePushListeners();
    if(!Push)return setPushStatus('Push plugin nincs telepítve','off');
    try{
      const perm=await Push.requestPermissions();
      localStorage.setItem('italpont_push_permission_asked','1');
      if(perm.receive!=='granted'){
        setPushStatus('Az értesítés nincs engedélyezve','off');
        return;
      }
      setPushStatus('Regisztráció...','warn');
      await Push.register();
    }catch(e){
      console.error(e);
      setPushStatus('Push engedélyezési hiba','off');
    }
  }

  async function checkForUpdates(force=false){
    if(!isNative()||updateCheckInFlight)return;
    const now=Date.now();
    if(!force && now-lastUpdateCheck<5*60*1000)return;
    lastUpdateCheck=now;
    updateCheckInFlight=true;

    try{
      const App=plugin('App');
      const info=await App?.getInfo?.();
      const currentCode=Number.parseInt(info?.build||'0',10)||0;
      const release=await window.fetchLatestAndroidRelease?.();
      if(!release || Number(release.version_code)<=currentCode)return;

      const dismissedKey=`italpont_update_dismissed_${release.version_code}`;
      const dismissedAt=Number(localStorage.getItem(dismissedKey)||0);
      if(!release.required && dismissedAt && Date.now()-dismissedAt<24*60*60*1000)return;

      window.showAndroidUpdate?.(release,{
        version:info?.version||'',
        build:currentCode
      });
    }catch(e){
      console.warn('Android frissítés ellenőrzési hiba:',e);
    }finally{
      updateCheckInFlight=false;
    }
  }

  async function installAndroidUpdate(release){
    if(!isNative()||!release?.apk_url)return;
    const Updater=plugin('ItalPontUpdater');
    if(!Updater){
      window.setAndroidUpdateStatus?.('A frissítő natív modul nincs telepítve. Készíts új APK-t a V5.5 projektből.',true);
      return;
    }

    try{
      window.setAndroidUpdateStatus?.('Telepítési jogosultság ellenőrzése...');
      const permission=await Updater.canInstall();
      if(!permission?.allowed){
        pendingInstallRelease=release;
        window.setAndroidUpdateStatus?.('Engedélyezd az „Ismeretlen alkalmazások telepítése” jogosultságot. Visszatérés után automatikusan folytatjuk.');
        await Updater.openInstallPermission();
        return;
      }

      pendingInstallRelease=null;
      window.setAndroidUpdateStatus?.('Frissítés letöltése…');
      await Updater.downloadAndInstall({
        url:release.apk_url,
        fileName:`ItalPont-${release.version_name||release.version_code}.apk`
      });
      window.setAndroidUpdateStatus?.('A rendszer telepítési folyamata elindult. Hagyd jóvá az Android ablakában.');
    }catch(e){
      console.error('Android frissítés hiba:',e);
      window.setAndroidUpdateStatus?.(e?.message||String(e),true);
    }
  }

  async function resumePendingInstall(){
    if(!pendingInstallRelease)return;
    const release=pendingInstallRelease;
    const Updater=plugin('ItalPontUpdater');
    if(!Updater)return;
    try{
      const permission=await Updater.canInstall();
      if(permission?.allowed){
        await installAndroidUpdate(release);
      }
    }catch(e){console.warn(e)}
  }

  async function initAppLifecycle(){
    if(!isNative()||appLifecycleInitialized)return;
    const App=plugin('App');
    if(!App?.addListener)return;
    appLifecycleInitialized=true;
    await App.addListener('appStateChange',state=>{
      if(state?.isActive){
        resumePendingInstall();
        checkForUpdates(false);

        if(hasPendingCameraRecovery()){
          resumeCameraRecoveryUi();
          if(pendingRestoredCameraResult){
            flushPendingRestoredPhoto().catch(e=>console.warn('Camera resume restore:',e));
          }
        }
      }
    });
  }

  async function openUpdateInBrowser(url){
    if(!isNative()||!url)return;
    const Updater=plugin('ItalPontUpdater');
    if(!Updater?.openDownloadUrl)throw new Error('A böngészős frissítési tartalék nem érhető el.');
    await Updater.openDownloadUrl({url});
  }

  async function unregisterPush(){
    if(!isNative())return;
    const Push=plugin('PushNotifications');
    const token=currentPushToken||localStorage.getItem('italpont_push_token');
    if(token)await window.removePushToken?.(token);
    try{await Push?.unregister?.()}catch(e){console.warn(e)}
    localStorage.removeItem('italpont_push_token');
    currentPushToken=null;
  }

  window.ItalPontNative={
    takeDrinkPhoto,
    chooseDrinkPhoto,
    clearDrinkPhoto,
    clearDrinkPhotoPreviewOnly,
    initPush,
    enablePush,
    unregisterPush,
    flushPendingRestoredPhoto,
    hasPendingCameraRecovery,
    resumeCameraRecoveryUi,
    checkForUpdates,
    installAndroidUpdate,
    openUpdateInBrowser
  };

  initRestoredResultListener().catch(e=>console.warn('App restored listener:',e));
  initAppLifecycle().catch(e=>console.warn('App lifecycle listener:',e));

  // Process death után már a DOM felépülésekor jelezzük, hogy nem a főoldalra
  // akarunk visszatérni, hanem a kamerakép helyreállítása folyik.
  document.addEventListener('DOMContentLoaded',()=>{
    if(hasPendingCameraRecovery()){
      resumeCameraRecoveryUi();
    }
  });
  window.addEventListener('load',()=>{
    flushPendingRestoredPhoto().catch(e=>console.warn(e));
    if(localStorage.getItem('italpont_camera_restore_pending')==='1')navigateToUploadWhenReady(true);
  });
})();
