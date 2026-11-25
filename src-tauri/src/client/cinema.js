  // A read-only viewer for existing Discord video tracks. Discord's DOM,
  // playback, audio, track lifetime and call controls remain owned by Discord.
  var cinemaActive=false,cinemaVideo=null,cinemaBar=null,cinemaEntry=null,cinemaDialog=null,cinemaSurface=null,cinemaOriginal=null,cinemaSourceStream=null,cinemaTrack=null,cinemaSources=[],cinemaTimer=null,cinemaScanTimer=null,cinemaOwnedFullscreen=false,cinemaPreviousFocus=null,cinemaPreferred=null;
  var cinemaIds=new WeakMap(),cinemaNextId=0,cinemaObserved=new Set(),cinemaSourceSignature='',cinemaSourceSelect=null;
  var cinemaSelector='[class*="stream_"] video,[class*="streamTile_"] video,[class*="videoFrame_"] video,[class*="callContainer_"] video,[class*="videoGrid_"] video,[class*="videoWrapper_"] video';
  function cinemaText(tr,en){return lang==='en'?en:tr;}
  function cinemaId(video){if(!cinemaIds.has(video))cinemaIds.set(video,++cinemaNextId);return String(cinemaIds.get(video));}
  function cinemaTracks(video){try{return video.srcObject&&typeof video.srcObject.getVideoTracks==='function'?video.srcObject.getVideoTracks().filter(function(track){return track.readyState!=='ended';}):[];}catch(error){return [];}}
  function cinemaEligible(video){var rect=video.getBoundingClientRect(),style=getComputedStyle(video);return video.isConnected&&rect.width>=160&&rect.height>=90&&rect.bottom>0&&rect.right>0&&rect.top<innerHeight&&rect.left<innerWidth&&style.visibility==='visible'&&style.display!=='none'&&!video.closest('#ldc-cinema-view,#ldc-share-menu,#ldc-modal,[hidden]')&&cinemaTracks(video).length>0;}
  function cinemaLabel(video,index){var tile=video.closest('[aria-label],[class*="streamTile_"]'),name=tile&&tile.getAttribute('aria-label');return (name?name.slice(0,80):cinemaText('Görüntü ','Video ')+(index+1))+(video.videoWidth?' · '+video.videoWidth+' × '+video.videoHeight:'');}
  function cinemaQueue(){if(!cinemaScanTimer)cinemaScanTimer=setTimeout(scanCinema,80);}
  var cinemaResize=typeof ResizeObserver==='function'?new ResizeObserver(cinemaQueue):null;
  function cinemaEnsureEntry(){
    if(SAFE)return;
    if(!cinemaEntry){cinemaEntry=document.createElement('button');cinemaEntry.id='ldc-cinema-entry';cinemaEntry.type='button';cinemaEntry.setAttribute('aria-haspopup','dialog');cinemaEntry.setAttribute('aria-controls','ldc-cinema-view');cinemaEntry.innerHTML='<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="3" width="16" height="11" rx="1.5"/><path d="M6 17h8M10 14v3"/></svg><span>Sinema</span>';cinemaEntry.onclick=cinemaEnter;}
    cinemaEntry.hidden=!cinemaSources.length;cinemaEntry.disabled=cinemaActive;cinemaEntry.setAttribute('aria-expanded',String(cinemaActive));cinemaEntry.title=cinemaText('Yayını Sinema görünümünde izle','Watch a video in Cinema view');cinemaEntry.querySelector('span').textContent=cinemaText('Sinema','Cinema');
    var help=document.querySelector('a[href^="https://support.discord.com"]'),host=help&&(help.closest('[class*="trailing_"]')||help.closest('[role="toolbar"]')||help.parentElement);
    if(host){cinemaEntry.removeAttribute('data-floating');if(cinemaEntry.parentNode!==host)host.prepend(cinemaEntry);}
    else{cinemaEntry.setAttribute('data-floating','');if(document.body&&cinemaEntry.parentNode!==document.body)document.body.append(cinemaEntry);}
  }
  function cinemaRefreshOptions(){
    if(!cinemaSourceSelect)return;
    var signature=cinemaSources.map(function(source,index){return cinemaId(source)+':'+cinemaLabel(source,index);}).join('|');
    if(signature===cinemaSourceSignature)return;cinemaSourceSignature=signature;
    cinemaSourceSelect.replaceChildren();cinemaSources.forEach(function(source,index){var option=document.createElement('option');option.value=cinemaId(source);option.textContent=cinemaLabel(source,index);cinemaSourceSelect.append(option);});
    if(cinemaOriginal)cinemaSourceSelect.value=cinemaId(cinemaOriginal);
  }
  function cinemaAttach(source){
    var tracks=cinemaTracks(source);if(!tracks.length||!cinemaVideo)return false;
    cinemaVideo.pause();cinemaVideo.srcObject=null;cinemaOriginal=source;cinemaSourceStream=source.srcObject;cinemaTrack=tracks[0];
    // Reuse only the existing video track. No capture, peer connection or audio
    // track is created. Closing this viewer must never call track.stop().
    cinemaVideo.srcObject=new MediaStream([cinemaTrack]);cinemaVideo.muted=true;cinemaVideo.volume=0;
    var status=cinemaDialog.querySelector('.ldc-cinema-status');status.textContent=cinemaText('Yayın görüntüsü bekleniyor…','Waiting for video…');
    cinemaVideo.play().catch(function(){if(cinemaActive&&status.isConnected)status.textContent=cinemaText('Görüntü başlatılamadı. Kaynağı değiştir veya Sinema’dan çık.','Could not play video. Choose another source or exit Cinema.');});
    var caption=cinemaDialog.querySelector('.ldc-cinema-caption');caption.textContent=cinemaLabel(source,Math.max(0,cinemaSources.indexOf(source)));
    if(cinemaSourceSelect)cinemaSourceSelect.value=cinemaId(source);return true;
  }
  function cinemaExit(){
    if(!cinemaActive&&!cinemaDialog)return;
    cinemaActive=false;document.documentElement.removeAttribute('data-ldc-cinema');
    if(cinemaTimer){clearInterval(cinemaTimer);cinemaTimer=null;}
    var dialog=cinemaDialog,surface=cinemaSurface;cinemaDialog=null;cinemaSurface=null;
    if(cinemaVideo){cinemaVideo.pause();cinemaVideo.srcObject=null;}cinemaVideo=null;cinemaOriginal=null;cinemaTrack=null;cinemaSourceStream=null;cinemaBar=null;cinemaSourceSelect=null;cinemaSourceSignature='';
    if(cinemaOwnedFullscreen&&document.fullscreenElement===surface)document.exitFullscreen().catch(function(){});cinemaOwnedFullscreen=false;
    if(dialog){if(dialog.open)dialog.close();dialog.remove();}
    cinemaEnsureEntry();var focus=cinemaPreviousFocus;cinemaPreviousFocus=null;if(focus&&focus.isConnected&&!focus.disabled)focus.focus({preventScroll:true});cinemaQueue();
  }
  function cinemaBuildControls(surface){
    var bar=document.createElement('section');bar.id='ldc-cinema-tools';bar.setAttribute('aria-label',cinemaText('idgafcord sinema kontrolleri','idgafcord cinema controls'));
    function button(tr,en,fn){var node=document.createElement('button');node.type='button';node.textContent=cinemaText(tr,en);node.onclick=fn;bar.append(node);return node;}
    function icon(tr,en,path,fn){var node=button(tr,en,fn);node.title=node.textContent;node.setAttribute('aria-label',node.title);node.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>';return node;}
    var title=document.createElement('strong');title.textContent=cinemaText('Sinema','Cinema');bar.append(title);
    var details=document.createElement('details');details.className='ldc-cinema-settings';var summary=document.createElement('summary');summary.textContent=cinemaText('Görüntü','Picture');details.append(summary);var pane=document.createElement('div');pane.className='ldc-cinema-pane';details.append(pane);bar.append(details);
    var heading=document.createElement('h3');heading.textContent=cinemaText('Görüntü ayarları','Picture settings');pane.append(heading);
    function selection(label,items){var wrapper=document.createElement('label');wrapper.textContent=label;var select=document.createElement('select');select.setAttribute('aria-label',label);items.forEach(function(item){var option=document.createElement('option');option.value=item[0];option.textContent=item[1];select.append(option);});wrapper.append(select);pane.append(wrapper);return select;}
    cinemaSourceSelect=selection(cinemaText('Görüntü kaynağı','Video source'),[]);cinemaSourceSelect.onchange=function(){var source=cinemaSources.find(function(video){return cinemaId(video)===cinemaSourceSelect.value;});if(source)cinemaAttach(source);};cinemaRefreshOptions();
    var fit=selection(cinemaText('Görüntü yerleşimi','Picture fit'),[['contain',cinemaText('Sığdır · oranı koru','Fit · preserve ratio')],['cover',cinemaText('Doldur · kenarlar kırpılır','Fill · crops edges')],['fill',cinemaText('Esnet · oran değişir','Stretch · changes ratio')]]);
    if(get('cinemaLayoutVersion','')!=='2'){set('cinemaFit','contain');set('cinemaZoom','100');set('cinemaLayoutVersion','2');}
    fit.value=['contain','cover','fill'].includes(get('cinemaFit','contain'))?get('cinemaFit','contain'):'contain';
    function slider(label,min,max,value){var wrapper=document.createElement('label');wrapper.textContent=label;var row=document.createElement('div');row.className='ldc-cinema-range';var input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.value=value;input.setAttribute('aria-label',label);var output=document.createElement('output');function update(){output.textContent=input.value+'%';input.style.setProperty('--range-fill',((input.value-min)/(max-min)*100)+'%');}input.addEventListener('input',update);update();row.append(input,output);wrapper.append(row);pane.append(wrapper);return input;}
    var zoom=slider(cinemaText('Yakınlaştırma','Zoom'),100,200,Math.max(100,Math.min(200,Number(get('cinemaZoom','100'))||100)));
    var brightness=slider(cinemaText('Parlaklık','Brightness'),50,120,Math.max(50,Math.min(120,Number(get('cinemaBrightness','100'))||100)));
    function apply(){surface.style.setProperty('--ldc-cinema-fit',fit.value);surface.style.setProperty('--ldc-cinema-zoom',Number(zoom.value)/100);surface.style.setProperty('--ldc-cinema-brightness',Number(brightness.value)/100);set('cinemaFit',fit.value);set('cinemaZoom',zoom.value);set('cinemaBrightness',brightness.value);}
    fit.onchange=apply;zoom.addEventListener('input',apply);brightness.addEventListener('input',apply);apply();
    var hint=document.createElement('p');hint.textContent=cinemaText('Yalnızca senin görünümünü değiştirir. Ses Discord’dan gelmeye devam eder.','Only changes your view. Audio continues through Discord.');pane.append(hint);
    var reset=button('Sıfırla','Reset',function(){fit.value='contain';zoom.value=brightness.value='100';zoom.dispatchEvent(new Event('input'));brightness.dispatchEvent(new Event('input'));apply();});pane.append(reset);
    var fullscreen=icon('Tam ekran','Fullscreen','<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',function(){
      if(document.fullscreenElement===surface){cinemaOwnedFullscreen=false;document.exitFullscreen().catch(function(){});return;}
      surface.requestFullscreen().then(function(){if(cinemaActive&&cinemaSurface===surface)cinemaOwnedFullscreen=true;else if(document.fullscreenElement===surface)document.exitFullscreen().catch(function(){});},function(){fullscreen.title=cinemaText('Tam ekran bu pencerede kullanılamıyor','Fullscreen unavailable in this window');});
    });fullscreen.disabled=!document.fullscreenEnabled;
    icon('Kumandayı küçült','Minimize controls','<path d="m6 9 6 6 6-6"/>',function(){bar.classList.toggle('ldc-cinema-minimized');details.open=false;this.setAttribute('aria-expanded',String(!bar.classList.contains('ldc-cinema-minimized')));}).className='ldc-cinema-keep';
    icon('Sinemadan çık','Exit cinema','<path d="m7 7 10 10M17 7 7 17"/>',cinemaExit).className='ldc-cinema-keep';surface.append(bar);cinemaBar=bar;
  }
  function cinemaEnter(){
    if(cinemaActive)return;scanCinema();if(!cinemaSources.length)return;
    var source=cinemaSources.find(function(video){return video===cinemaPreferred||cinemaPreferred&&cinemaTracks(video)[0]===cinemaTracks(cinemaPreferred)[0];})||cinemaSources[0];
    cinemaPreviousFocus=document.activeElement;cinemaActive=true;
    var dialog=document.createElement('dialog');dialog.id='ldc-cinema-view';dialog.setAttribute('aria-label',cinemaText('Sinema görünümü','Cinema view'));cinemaDialog=dialog;
    var surface=document.createElement('div');surface.className='ldc-cinema-surface';cinemaSurface=surface;
    var video=document.createElement('video');video.className='ldc-cinema-picture';video.muted=true;video.autoplay=true;video.playsInline=true;video.setAttribute('aria-label',cinemaText('Sinema videosu','Cinema video'));cinemaVideo=video;surface.append(video);
    var caption=document.createElement('div');caption.className='ldc-cinema-caption';surface.append(caption);var status=document.createElement('p');status.className='ldc-cinema-status';status.setAttribute('role','status');surface.append(status);
    video.addEventListener('loadeddata',function(){status.textContent='';});video.addEventListener('playing',function(){status.textContent='';});
    dialog.append(surface);document.body.append(dialog);cinemaBuildControls(surface);
    dialog.addEventListener('cancel',function(event){event.preventDefault();cinemaExit();});dialog.addEventListener('close',function(){if(cinemaDialog===dialog)cinemaExit();});
    try{dialog.showModal();if(!cinemaAttach(source)){cinemaExit();return;}}catch(error){cinemaExit();return;}
    document.documentElement.setAttribute('data-ldc-cinema','');cinemaEnsureEntry();dialog.querySelector('[aria-label="'+cinemaText('Sinemadan çık','Exit cinema')+'"]').focus();
    cinemaTimer=setInterval(function(){if(!cinemaOriginal||!cinemaOriginal.isConnected||cinemaOriginal.srcObject!==cinemaSourceStream||!cinemaTracks(cinemaOriginal).includes(cinemaTrack)){cinemaExit();return;}cinemaRefreshOptions();},500);
  }
  function scanCinema(){
    cinemaScanTimer=null;if(SAFE)return;
    if(cinemaPreferred&&(!cinemaPreferred.isConnected||!cinemaTracks(cinemaPreferred).length))cinemaPreferred=null;
    var all=Array.from(document.querySelectorAll(cinemaSelector)).filter(function(video){return !video.closest('#ldc-cinema-view,#ldc-share-menu,#ldc-modal');});
    if(cinemaResize){cinemaObserved.forEach(function(video){if(!all.includes(video)){cinemaResize.unobserve(video);cinemaObserved.delete(video);}});all.forEach(function(video){if(!cinemaObserved.has(video)){cinemaObserved.add(video);cinemaResize.observe(video);}});}
    var byTrack=new Map();all.filter(cinemaEligible).forEach(function(video){var track=cinemaTracks(video)[0],previous=byTrack.get(track.id);if(!previous||video.getBoundingClientRect().width*video.getBoundingClientRect().height>previous.getBoundingClientRect().width*previous.getBoundingClientRect().height)byTrack.set(track.id,video);});cinemaSources=Array.from(byTrack.values());
    if(cinemaActive&&(!cinemaOriginal.isConnected||cinemaOriginal.srcObject!==cinemaSourceStream||!cinemaTracks(cinemaOriginal).includes(cinemaTrack)))cinemaExit();
    cinemaEnsureEntry();cinemaRefreshOptions();
  }
  var cinemaObserver=new MutationObserver(function(records){if(records.every(function(record){return record.target.closest&&record.target.closest('#ldc-cinema-view,#ldc-cinema-entry');}))return;cinemaQueue();});cinemaObserver.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('loadedmetadata',cinemaQueue,true);document.addEventListener('emptied',cinemaQueue,true);window.addEventListener('resize',cinemaQueue);
  document.addEventListener('pointerdown',function(event){var tile=event.target.closest&&event.target.closest('[class*="streamTile_"],[class*="videoFrame_"]'),video=event.target.tagName==='VIDEO'?event.target:tile&&tile.querySelector('video');if(video&&cinemaEligible(video))cinemaPreferred=video;},true);
  document.addEventListener('fullscreenchange',function(){if(cinemaOwnedFullscreen&&document.fullscreenElement!==cinemaSurface)cinemaExit();});window.addEventListener('pagehide',cinemaExit);
  scanCinema();
