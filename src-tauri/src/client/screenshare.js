  // Keep the browser's consent and source selection. Capture starts only from
  // the explicit Continue click, preserving getDisplayMedia user activation.
  var sharePending=null,shareBusy=false;
  function shareText(trText,enText){return lang==='en'?enText:trText;}
  function registerShare(stream,hint){stream.getVideoTracks().forEach(function(track){try{track.contentHint=hint;}catch(error){}});return stream;}
  function shareMenu(original,receiver,options){
    if(sharePending||shareBusy)return Promise.reject(new DOMException('Another screen selection is in progress.','InvalidStateError'));
    return new Promise(function(resolve,reject){
      var focus=document.activeElement,overlay=document.createElement('div');overlay.id='ldc-share-menu';
      var dialog=document.createElement('section');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','ldc-share-title');
      var head=document.createElement('header'),brand=document.createElement('img');brand.src=LDC_LOGO_DATA_URI;brand.alt='';
      var heading=document.createElement('div'),name=document.createElement('small'),title=document.createElement('h2');name.textContent='idgafcord';title.id='ldc-share-title';title.textContent=shareText('Ekranını paylaş','Share your screen');heading.append(name,title);head.append(brand,heading);dialog.append(head);
      var note=document.createElement('p');note.textContent=shareText('Önce kaynağını seç, sonra önizlemesini kontrol et. Son onayına kadar Discord’a görüntü verilmez.','Choose your source, then check the preview. Video is not given to Discord until your final confirmation.');dialog.append(note);
      var preview=document.createElement('div');preview.className='ldc-share-preview';var empty=document.createElement('div');empty.className='ldc-share-empty';empty.innerHTML='<svg width="42" height="34" viewBox="0 0 42 34" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="2" width="38" height="24" rx="2"/><path d="M15 32h12M21 26v6M7 7h28"/></svg>';var emptyText=document.createElement('span');emptyText.textContent=shareText('Kaynak seçilmedi','No source selected');var emptyHint=document.createElement('small');emptyHint.textContent=shareText('Seçtiğin pencere veya ekran burada canlı görünecek.','Your selected window or screen will appear live here.');empty.append(emptyText,emptyHint);preview.append(empty);dialog.append(preview);
      var previewStatus=document.createElement('p');previewStatus.className='ldc-share-preview-status';previewStatus.setAttribute('role','status');dialog.append(previewStatus);var previewVideo=null,pendingStream=null,confirmed=false;
      function select(labelText,id,items,value){var label=document.createElement('label');label.textContent=labelText;var select=document.createElement('select');select.id=id;select.setAttribute('aria-label',labelText);items.forEach(function(item){var option=document.createElement('option');option.value=item[0];option.textContent=item[1];select.append(option);});select.value=value;label.append(select);dialog.append(label);return select;}
      var resolution=select(shareText('Yakalama boyutu','Capture size'),'ldc-share-size', [['auto',shareText('Kaynağa göre','Source size')],['1080','1920 × 1080'],['720','1280 × 720']],get('shareSize','auto'));
      var fps=select(shareText('Akıcılık','Frame rate'),'ldc-share-fps',[['30',shareText('30 fps · Dengeli','30 fps · Balanced')],['60',shareText('60 fps · Hareketli içerik','60 fps · Motion')]],get('shareFps','30'));
      var content=select(shareText('İçerik','Content'),'ldc-share-content',[['motion',shareText('Film / oyun · akıcılık','Movie / game · motion')],['detail',shareText('Masaüstü / yazı · ayrıntı','Desktop / text · detail')]],get('shareContent','motion'));
      var audioLabel=document.createElement('label');audioLabel.className='ldc-share-audio';var audio=document.createElement('input');audio.type='checkbox';audio.checked=!!options.audio&&get('shareAudio','1')==='1';audio.disabled=!options.audio;audioLabel.append(audio,document.createTextNode(shareText('Kaynak sesi iste','Request source audio')));dialog.append(audioLabel);
      var hint=document.createElement('p');hint.className='ldc-share-hint';hint.textContent=shareText('Ses desteği seçilen kaynağa bağlıdır. Bunlar yakalama tercihleridir; Discord’un yayın kalitesi ve hesap sınırları geçerlidir.','Audio availability depends on the selected source. These are capture preferences; Discord streaming quality and account limits still apply.');dialog.append(hint);
      var footer=document.createElement('footer'),cancel=document.createElement('button'),start=document.createElement('button'),confirm=document.createElement('button');cancel.type=start.type=confirm.type='button';cancel.textContent=shareText('Vazgeç','Cancel');start.textContent=shareText('Kaynak seç','Choose source');start.className='ldc-share-primary';confirm.textContent=shareText('Paylaşımı başlat','Start sharing');confirm.className='ldc-share-primary';confirm.hidden=true;confirm.disabled=true;footer.append(cancel,start,confirm);dialog.append(footer);overlay.append(dialog);
      function stopPreview(){if(pendingStream&&!confirmed)pendingStream.getTracks().forEach(function(track){track.stop();});if(previewVideo)previewVideo.srcObject=null;pendingStream=null;}
      var done=false;function cleanup(){if(done)return;done=true;sharePending=null;window.removeEventListener('keydown',key,true);stopPreview();overlay.remove();if(focus&&focus.isConnected)focus.focus({preventScroll:true});}
      function abort(){cleanup();reject(new DOMException('Screen sharing was cancelled.','NotAllowedError'));}
      function key(event){if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();abort();}else if(event.key==='Tab'){var controls=Array.from(dialog.querySelectorAll('button,select,input')).filter(function(control){return !control.hidden&&!control.disabled;}),index=controls.indexOf(document.activeElement),next=(index+(event.shiftKey?-1:1)+controls.length)%controls.length;event.preventDefault();event.stopImmediatePropagation();controls[next].focus();}}
      confirm.onclick=function(){if(!pendingStream||pendingStream.getVideoTracks().every(function(track){return track.readyState==='ended';}))return;var stream=pendingStream;confirmed=true;cleanup();try{resolve(registerShare(stream,content.value));}catch(error){stream.getTracks().forEach(function(track){track.stop();});reject(error);}};
      cancel.onclick=abort;start.onclick=function(){
        if(shareBusy||done)return;stopPreview();confirm.hidden=true;confirm.disabled=true;
        var video=typeof options.video==='object'?Object.assign({},options.video):{};
        function preference(key,value){var previous=video[key];if(previous&&typeof previous==='object'&&previous.exact!==undefined)return;video[key]=Object.assign({},typeof previous==='object'?previous:{},{ideal:value});}
        preference('frameRate',Number(fps.value));if(resolution.value!=='auto'){preference('height',Number(resolution.value));preference('width',resolution.value==='720'?1280:1920);}
        var config=Object.assign({},options,{video:video,audio:audio.checked?options.audio:false});
        if(audio.checked)config.systemAudio='include';
        set('shareSize',resolution.value);set('shareFps',fps.value);set('shareAudio',audio.checked?'1':'0');set('shareContent',content.value);
        // Invoke synchronously while the browser still has the click activation.
        var capture;try{capture=original.call(receiver,config);}catch(error){cleanup();reject(error);return;}
        shareBusy=true;start.disabled=true;resolution.disabled=fps.disabled=content.disabled=audio.disabled=true;
        Promise.resolve(capture).then(function(stream){
          shareBusy=false;if(done){stream.getTracks().forEach(function(track){track.stop();});return;}
          pendingStream=stream;previewVideo=document.createElement('video');previewVideo.muted=true;previewVideo.autoplay=true;previewVideo.playsInline=true;previewVideo.setAttribute('aria-label',shareText('Canlı ekran önizlemesi','Live screen preview'));previewVideo.srcObject=stream;preview.replaceChildren(previewVideo);previewVideo.play().catch(function(){});
          var track=stream.getVideoTracks()[0],settings=track&&track.getSettings?track.getSettings():{};
          previewStatus.textContent=shareText('Önizleme · henüz Discord’a gönderilmiyor','Preview · not yet sent to Discord')+(settings.width?' · '+settings.width+' × '+settings.height:'');
          function frameReady(){if(!done&&pendingStream===stream&&previewVideo.readyState>=2)confirm.disabled=false;}
          previewVideo.addEventListener('loadeddata',frameReady,{once:true});frameReady();
          if(track)track.addEventListener('ended',function(){if(!confirmed&&!done)abort();},{once:true});
          start.disabled=false;start.className='';start.textContent=shareText('Kaynağı değiştir','Change source');confirm.hidden=false;confirm.focus();
        },function(error){shareBusy=false;cleanup();reject(error);});
      };
      sharePending=abort;window.addEventListener('keydown',key,true);(document.body||document.documentElement).append(overlay);cancel.focus();
    });
  }
  if(!SAFE&&navigator.mediaDevices&&typeof navigator.mediaDevices.getDisplayMedia==='function'){
    var displayMedia=navigator.mediaDevices.getDisplayMedia;
    navigator.mediaDevices.getDisplayMedia=function(options){
      options=options===undefined?{video:true}:options;
      if(!options||typeof options!=='object'||options.video===false)return displayMedia.apply(this,arguments);
      return shareMenu(displayMedia,this,options);
    };
  }
