  // Extend the existing viewer; never replace the image URL or Discord's modal.
  var photoState=null,photoScanTimer=null;
  var photoHostSelector='[class*="carouselModal_"],[class*="mediaViewer_"],[class*="imageModal_"],[role="dialog"]';
  function resetPhoto(state){if(!state)return;['scale','rotate','translate','cursor','touch-action','image-rendering'].forEach(function(key){var value=state.saved[key];if(value)state.image.style.setProperty(key,value[0],value[1]);else state.image.style.removeProperty(key);});}
  function closePhotoTools(){if(!photoState)return;var state=photoState;photoState=null;resetPhoto(state);state.cleanup();state.bar.remove();}
  function scanPhotoTools(){
    photoScanTimer=null;if(SAFE)return;
    if(photoState&&(!photoState.image.isConnected||!photoState.host.isConnected||photoState.source!==(photoState.image.currentSrc||photoState.image.src)))closePhotoTools();
    if(photoState)return;
    var images=Array.from(document.querySelectorAll('[class*="imageWrapper_"] img,[class*="carouselModal_"] img,[class*="mediaViewer_"] img,[class*="imageModal_"] img'));
    var image=images.filter(function(img){var host=img.closest(photoHostSelector),rect=img.getBoundingClientRect();return host&&!host.closest('#ldc-modal,#ldc-share-menu')&&rect.width>=100&&rect.height>=80&&!img.closest('[class*="avatar_"],[class*="emoji_"]');}).sort(function(a,b){return b.getBoundingClientRect().width*b.getBoundingClientRect().height-a.getBoundingClientRect().width*a.getBoundingClientRect().height;})[0];
    if(!image)return;
    var host=image.closest(photoHostSelector),bar=document.createElement('section');bar.id='ldc-photo-tools';bar.setAttribute('aria-label',lang==='en'?'idgafcord image tools':'idgafcord fotoğraf araçları');
    var state={image:image,host:host,bar:bar,source:image.currentSrc||image.src,zoom:1,angle:0,flipX:1,flipY:1,x:0,y:0,pixel:false,saved:{}};
    ['scale','rotate','translate','cursor','touch-action','image-rendering'].forEach(function(key){var value=image.style.getPropertyValue(key);state.saved[key]=value?[value,image.style.getPropertyPriority(key)]:null;});
    var name=document.createElement('strong');name.textContent='idgafcord';bar.append(name);
    var dimensions=document.createElement('span');dimensions.className='ldc-photo-dimensions';dimensions.textContent=image.naturalWidth&&image.naturalHeight?image.naturalWidth+' × '+image.naturalHeight:'';bar.append(dimensions);
    var zoomText=document.createElement('output');zoomText.setAttribute('aria-live','polite');
    function apply(){image.style.scale=(state.zoom*state.flipX)+' '+(state.zoom*state.flipY);image.style.rotate=state.angle+'deg';image.style.translate=state.x+'px '+state.y+'px';image.style.cursor=state.zoom>1?'grab':'';image.style.touchAction=state.zoom>1?'none':'';image.style.imageRendering=state.pixel?'pixelated':'';zoomText.textContent=Math.round(state.zoom*100)+'%';}
    function button(trText,enText,glyph,action){var button=document.createElement('button');button.type='button';button.title=lang==='en'?enText:trText;button.setAttribute('aria-label',button.title);button.textContent=glyph;button.onclick=function(event){event.stopPropagation();action(button);};bar.append(button);return button;}
    function zoom(value){state.zoom=Math.max(.25,Math.min(8,value));if(state.zoom<=1){state.x=0;state.y=0;}apply();}
    button('Uzaklaştır','Zoom out','−',function(){zoom(state.zoom/1.25);});bar.append(zoomText);
    button('Yakınlaştır','Zoom in','+',function(){zoom(state.zoom*1.25);});
    button('Sola döndür','Rotate left','↶',function(){state.angle=(state.angle-90)%360;apply();});
    button('Sağa döndür','Rotate right','↷',function(){state.angle=(state.angle+90)%360;apply();});
    button('Yatay çevir','Flip horizontally','↔',function(button){state.flipX*=-1;button.setAttribute('aria-pressed',String(state.flipX===-1));apply();});
    button('Dikey çevir','Flip vertically','↕',function(button){state.flipY*=-1;button.setAttribute('aria-pressed',String(state.flipY===-1));apply();});
    button('Piksel inceleme','Inspect pixels','▦',function(button){state.pixel=!state.pixel;button.setAttribute('aria-pressed',String(state.pixel));apply();});
    button('Orijinal piksel boyutu','Actual pixel size','1:1',function(){var width=image.offsetWidth;if(width&&image.naturalWidth)zoom(image.naturalWidth/width);});
    var download=button('Orijinali indir','Download original','↓',function(button){
      var url=originalPhotoUrl(state.source);if(!url)return;
      state.downloadId='photo-'+Date.now().toString(36);button.disabled=true;downloadStatus.textContent=lang==='en'?'Choose save location…':'Kaydetme konumunu seç…';
      nativeCmd('download_image',state.downloadId,url);
    });
    download.disabled=!originalPhotoUrl(state.source);if(download.disabled)download.title=lang==='en'?'Original download is available for Discord image attachments':'Orijinal indirme Discord görsel eklerinde kullanılabilir';
    var downloadStatus=document.createElement('span');downloadStatus.className='ldc-photo-download-status';downloadStatus.setAttribute('role','status');bar.append(downloadStatus);state.downloadButton=download;state.downloadStatus=downloadStatus;
    button('Görünümü sıfırla','Reset view',lang==='en'?'Reset':'Sıfırla',function(){state.zoom=1;state.angle=0;state.flipX=state.flipY=1;state.x=state.y=0;state.pixel=false;bar.querySelectorAll('[aria-pressed]').forEach(function(button){button.setAttribute('aria-pressed','false');});apply();});
    var drag=null;
    function down(event){if(state.zoom<=1||event.button!==0)return;event.preventDefault();event.stopPropagation();drag={id:event.pointerId,x:event.clientX,y:event.clientY,startX:state.x,startY:state.y};image.setPointerCapture(event.pointerId);image.style.cursor='grabbing';}
    function move(event){if(!drag||event.pointerId!==drag.id)return;event.preventDefault();event.stopPropagation();state.x=drag.startX+event.clientX-drag.x;state.y=drag.startY+event.clientY-drag.y;apply();image.style.cursor='grabbing';}
    function up(event){if(!drag||event.pointerId!==drag.id)return;event.stopPropagation();if(image.hasPointerCapture(event.pointerId))image.releasePointerCapture(event.pointerId);drag=null;apply();}
    image.addEventListener('pointerdown',down);image.addEventListener('pointermove',move);image.addEventListener('pointerup',up);image.addEventListener('pointercancel',up);
    state.cleanup=function(){image.removeEventListener('pointerdown',down);image.removeEventListener('pointermove',move);image.removeEventListener('pointerup',up);image.removeEventListener('pointercancel',up);};
    host.append(bar);photoState=state;apply();
  }
  function originalPhotoUrl(source){
    try{var url=new URL(source);if(url.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname)||url.username||url.password||url.port||!/^\/(?:attachments|ephemeral-attachments)\/\d+\/\d+\/[^/]+\.(png|jpe?g|gif|webp|avif|bmp|tiff?|heic|heif)$/i.test(url.pathname))return null;
      url.hostname='cdn.discordapp.com';['width','height','format','quality','size'].forEach(function(key){url.searchParams.delete(key);});url.hash='';return url.href;
    }catch(error){return null;}
  }
  window.__LDC_downloadStatus=function(result){
    if(!photoState||photoState.downloadId!==result.id)return;
    var messages=lang==='en'?{downloading:'Downloading original…',saved:'Original saved',cancelled:'Cancelled',busy:'Another download is in progress',error:'Download failed; the attachment may have expired. Reopen the image and retry.'}:{downloading:'Orijinal indiriliyor…',saved:'Orijinal kaydedildi',cancelled:'Vazgeçildi',busy:'Başka bir indirme sürüyor',error:'İndirilemedi; ekin bağlantısı eskimiş olabilir. Görseli yeniden açıp dene.'};
    photoState.downloadStatus.textContent=messages[result.status]||'';photoState.downloadStatus.title=result.message||'';photoState.downloadButton.disabled=result.status==='downloading';
  };
  var photoObserver=new MutationObserver(function(records){
    if(records.every(function(record){return record.target.closest&&record.target.closest('#ldc-photo-tools');}))return;
    if(!photoScanTimer)photoScanTimer=setTimeout(scanPhotoTools,80);
  });
  photoObserver.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
  document.addEventListener('load',function(event){if(event.target.tagName==='IMG'&&!photoScanTimer)photoScanTimer=setTimeout(scanPhotoTools,80);},true);
  scanPhotoTools();
