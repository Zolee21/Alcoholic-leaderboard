/**
 * ItalPont V5.0 native Android bridge.
 * Weben biztonságosan no-op.
 */
(() => {
  let selectedPreviewUrl = null;
  let currentPushToken = null;
  let pushInitialized = false;

  const isNative = () => !!window.ItalPontPlatform?.isNative;
  const plugin = name => window.Capacitor?.Plugins?.[name] || null;
  const $ = id => document.getElementById(id);

  function setPushStatus(text, state='warn'){
    const el=$('pushStatus');
    if(!el)return;
    el.textContent=text;
    el.className=`push-status ${state}`;
  }

  async function resultToFile(result, fallbackName='italpont.jpg'){
    const webPath=result?.webPath;
    if(!webPath)throw new Error('A kiválasztott kép nem olvasható.');
    const response=await fetch(webPath);
    if(!response.ok)throw new Error('A kép beolvasása sikertelen.');
    const blob=await response.blob();
    const format=(result?.metadata?.format||blob.type?.split('/')[1]||'jpg').replace('jpeg','jpg');
    return new File([blob],`italpont-${Date.now()}.${format}`,{type:blob.type||`image/${format==='jpg'?'jpeg':format}`});
  }

  function setNativePhoto(file,webPath){
    if(selectedPreviewUrl?.startsWith('blob:'))URL.revokeObjectURL(selectedPreviewUrl);
    selectedPreviewUrl=webPath||URL.createObjectURL(file);
    window.setNativeDrinkPhoto?.(file,selectedPreviewUrl);
  }

  function clearDrinkPhotoPreviewOnly(){
    const box=$('nativePhotoPreview');
    if(box)box.classList.remove('show');
  }

  function clearDrinkPhoto(){
    if(selectedPreviewUrl?.startsWith('blob:'))URL.revokeObjectURL(selectedPreviewUrl);
    selectedPreviewUrl=null;
    window.setNativeDrinkPhoto?.(null,null);
  }

  async function takeDrinkPhoto(){
    if(!isNative())return;
    const Camera=plugin('Camera');
    if(!Camera)throw new Error('A Camera plugin nincs szinkronizálva. Futtasd: npm run android:update');

    try{
      let result;
      if(typeof Camera.takePhoto==='function'){
        result=await Camera.takePhoto({
          quality:92,
          correctOrientation:true,
          saveToGallery:false,
          cameraDirection:'REAR',
          editable:'no',
          includeMetadata:true
        });
      }else{
        result=await Camera.getPhoto({
          quality:92,
          resultType:'uri',
          source:'CAMERA',
          direction:'REAR',
          correctOrientation:true,
          saveToGallery:false
        });
      }
      const file=await resultToFile(result,'camera.jpg');
      setNativePhoto(file,result.webPath);
    }catch(e){
      if(String(e?.message||e).toLowerCase().includes('cancel'))return;
      alert(`Kamera hiba: ${e?.message||e}`);
    }
  }

  async function chooseDrinkPhoto(){
    if(!isNative())return;
    const Camera=plugin('Camera');
    if(!Camera)throw new Error('A Camera plugin nincs szinkronizálva. Futtasd: npm run android:update');

    try{
      let result;
      if(typeof Camera.chooseFromGallery==='function'){
        const picked=await Camera.chooseFromGallery({
          mediaType:0,
          allowMultipleSelection:false,
          quality:92,
          editable:'no',
          includeMetadata:true
        });
        result=picked?.results?.[0];
      }else{
        result=await Camera.getPhoto({
          quality:92,
          resultType:'uri',
          source:'PHOTOS',
          correctOrientation:true
        });
      }
      if(!result)return;
      const file=await resultToFile(result,'gallery.jpg');
      setNativePhoto(file,result.webPath);
    }catch(e){
      if(String(e?.message||e).toLowerCase().includes('cancel'))return;
      alert(`Galéria hiba: ${e?.message||e}`);
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
      }
    });

    await Push.addListener('pushNotificationActionPerformed',action=>{
      const eventType=action?.notification?.data?.event_type;
      if(eventType==='new_drink'){
        const home=document.querySelector('[data-page="home"]');
        window.showPage?.('home',home);
        window.loadHome?.();
      }else{
        const home=document.querySelector('[data-page="home"]');
        window.showPage?.('home',home);
      }
    });

    try{
      await Push.createChannel({
        id:'italpont',
        name:'ItalPont értesítések',
        description:'Új italok és új játékosok',
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
    unregisterPush
  };
})();
