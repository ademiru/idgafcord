// Native, offline command recognition. No browser dictation or audio upload.
  function normVoice(s){return String(s||'').replace(/İ/g,'i').replace(/ı/g,'i').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();}
  function textOf(el){return el?[(el.getAttribute('aria-label')||''),(el.getAttribute('title')||''),(el.textContent||'')].join(' '):'';}
  function visible(el){var r=el.getBoundingClientRect();return r.width>8&&r.height>8&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth;}
  function micButton(){
    var nodes=document.querySelectorAll('button,[role="button"]'),best=null,bestScore=-1,tied=false;
    for(var i=0;i<nodes.length;i++){
      var el=nodes[i];
      if(el.disabled||el.getAttribute('aria-disabled')==='true'||!visible(el)||el.closest('#ldc-root,#ldc-modal,#ldc-audio-status,#ldc-splash,#ldc-voice-hud'))continue;
      var t=normVoice(textOf(el));
      if(!/\b(microphone|mikrofon\w*|mute|unmute|sustur\w*)\b|\bsesi(ni)? ac\b/.test(t))continue;
      if(/deafen|kulak|sagir|notification|bildirim|channel|server|sunucu|kanal|soundboard|camera|kamera|video|screen|ekran|share|yayin|disconnect|ayril/.test(t))continue;
      var r=el.getBoundingClientRect(),score=r.left<440&&r.top>innerHeight-220?100:0;
      if(el.closest('[class*="panels_"],[class*="accountPanel_"],[aria-label="User area"]'))score+=200;
      if(el.tagName==='BUTTON')score+=10;
      if(score>bestScore){best=el;bestScore=score;tied=false;}else if(score===bestScore)tied=true;
    }
    return tied?null:best;
  }
  function micMuteState(btn){
    btn=btn||micButton();if(!btn)return null;
    var ap=btn.getAttribute('aria-pressed'),ac=btn.getAttribute('aria-checked');
    if(ap==='true'||ac==='true')return 'muted';
    if(ap==='false'||ac==='false')return 'live';
    var t=normVoice(btn.getAttribute('aria-label')||btn.getAttribute('title')||'');
    if(/\bunmute\b|susturmayi kaldir|susturmayi ac|sesini ac|sesi ac|mikrofonu ac/.test(t))return 'muted';
    if(/\bmute\b|\bsustur\b|mikrofonu kapat|sesini kapat/.test(t))return 'live';
    return null;
  }
  var micPending=null,micFailure='';
  function setMic(desired,done){
    micFailure='';
    var btn=micButton();if(!btn){micFailure='Mikrofon düğmesi bulunamadı.';return false;}
    var state=micMuteState(btn);
    if(!state&&desired!=='toggle'){micFailure='Mikrofon durumu doğrulanamadı; düğmeye dokunulmadı.';return false;}
    if(micPending)return {found:true,clicked:false,pending:true,state:state};
    var target=desired==='toggle'?(state==='muted'?'live':state==='live'?'muted':null):(desired==='mute'?'muted':'live');
    if(target&&state===target){var unchanged={found:true,clicked:false,state:state};if(done)done(unchanged);return unchanged;}
    try{btn.click();}catch(e){micFailure='Mikrofon değiştirilemedi.';return false;}
    var started=Date.now();micPending={target:target};
    function verify(){
      var current=micMuteState();
      if(target&&current===target){micPending=null;updateMicBadge();if(done)done({found:true,clicked:true,state:current});return;}
      if(Date.now()-started>=1200){micPending=null;updateMicBadge();if(done)done(false);return;}
      setTimeout(verify,60);
    }
    setTimeout(verify,60);
    return {found:true,clicked:true,pending:true,state:state};
  }
  window.__LDC_toggleMute=function(){var r=setMic('toggle');if(!r)say(micFailure,C.warn);return !!r;};
  window.__LDC_setMute=function(v){var r=setMic(v);if(!r)say(micFailure,C.warn);return !!r;};

  var voicePhase='stopped',voiceSession='',voiceSequence=0,voiceStartTimer=null,voiceMessage='';
  var voiceHud=null,voiceHudDot=null,voiceHudTxt=null,voiceHudTimer=null,voiceStatusEl=null;
  function voiceConfig(){
    var vl=get('voiceLanguage',lang==='en'?'en':'tr');
    var unmute=get('voiceUnmutePhrase',vl==='en'?'open mic':'mikrofonu aç');
    if(vl==='en'&&/^(unmute|unmute me)$/.test(unmute))unmute='open mic';
    return {language:vl,mute:get('voiceMutePhrase',vl==='en'?'mute':'mikrofonu kapat'),unmute:unmute};
  }
  function newVoiceSession(){voiceSession=String(Date.now())+'-'+(++voiceSequence);return voiceSession;}
  function voiceApplyAction(cmd){
    if(cmd==='leave'||cmd==='deafen'||cmd==='undeafen'){voiceRoomAction(cmd);return;}
    if(cmd!=='mute'&&cmd!=='unmute')return;
    var result=setMic(cmd,function(confirmed){
      if(!confirmed){voiceHudFlash('Mikrofon değişikliği doğrulanamadı.','warn');say('Mikrofon değişikliği doğrulanamadı.',C.warn);return;}
      var msg=cmd==='mute'?(confirmed.clicked?'Mikrofon kapatıldı':'Mikrofon zaten kapalı'):(confirmed.clicked?'Mikrofon açıldı':'Mikrofon zaten açık');
      voiceHudFlash(msg,cmd);say(msg);
    });
    if(!result){voiceHudFlash(micFailure,'warn');say(micFailure,C.warn);}
  }
  var voiceRoomPending=false;
  function roomControl(kind,all){
    var candidates=Array.from(document.querySelectorAll('button,[role="button"]')).filter(function(button){
      if(button.disabled||button.getAttribute('aria-disabled')==='true'||!visible(button)||button.closest('#ldc-root,#ldc-modal,#ldc-share-menu,#ldc-cinema-tools'))return false;
      if(!button.closest('[class*="panels_"],[class*="accountPanel_"],[class*="voiceConnection_"],[aria-label="User area"]'))return false;
      var label=normVoice(button.getAttribute('aria-label')||button.getAttribute('title')||'');
      return kind==='leave'?/^(disconnect|disconnect voice|leave voice|leave call|baglantiyi kes|ses baglantisini kes|ses kanalindan ayril|aramadan ayril)$/.test(label):/^(deafen|undeafen|sagirlastir|sagirlastirmayi kaldir|sesi tamamen kapat|sesi tamamen ac)$/.test(label);
    });return all?candidates:(candidates.length===1?candidates[0]:null);
  }
  function deafenState(button){if(!button)return null;var pressed=button.getAttribute('aria-pressed')||button.getAttribute('aria-checked');if(pressed==='true'||pressed==='false')return pressed==='true';var label=normVoice(button.getAttribute('aria-label')||button.getAttribute('title')||'');if(/^(undeafen|sagirlastirmayi kaldir|sesi tamamen ac)$/.test(label))return true;if(/^(deafen|sagirlastir|sesi tamamen kapat)$/.test(label))return false;return null;}
  function voiceRoomAction(command){
    if(voiceRoomPending||micPending)return;
    var button=roomControl(command==='leave'?'leave':'audio'),desired=command==='deafen';
    if(!button){say(lang==='en'?'Voice control could not be identified. No action taken.':'Ses bağlantısı düğmesi doğrulanamadı; işlem yapılmadı.',C.warn);return;}
    if(command!=='leave'){
      var current=deafenState(button);if(current===null){say(lang==='en'?'Audio state could not be verified.':'Kulaklık durumu doğrulanamadı.',C.warn);return;}
      if(current===desired){say(desired?(lang==='en'?'Audio already deafened':'Kulaklık zaten kapalı'):(lang==='en'?'Audio already enabled':'Kulaklık zaten açık'));return;}
    }
    voiceRoomPending=true;var started=Date.now(),absent=0;
    try{button.click();}catch(error){voiceRoomPending=false;return;}
    function verify(){
      var control=roomControl(command==='leave'?'leave':'audio');
      if(command==='leave'){absent=button.isConnected===false&&!roomControl('leave',true).length?absent+1:0;}else if(control&&deafenState(control)===desired){voiceRoomPending=false;updateMicBadge();say(desired?(lang==='en'?'Audio deafened':'Kulaklık kapatıldı'):(lang==='en'?'Audio enabled':'Kulaklık açıldı'));return;}
      if(command==='leave'&&absent>=3){voiceRoomPending=false;say(lang==='en'?'Left voice channel':'Ses kanalından ayrıldın');return;}
      if(Date.now()-started>=1600){voiceRoomPending=false;say(lang==='en'?'Discord did not confirm the change.':'Discord değişikliği doğrulamadı.',C.warn);return;}
      setTimeout(verify,80);
    }setTimeout(verify,80);
  }
  function startVoice(){
    if(!ison('voiceMute','0')||voicePhase==='listening'||voicePhase==='starting'||voicePhase==='installing')return false;
    voicePhase='starting';voiceMessage='';ensureVoiceHud();voiceHudState('idle');updateVoiceStatus();
    var session=newVoiceSession();nativeCmd('voice_start',session,JSON.stringify(voiceConfig()));
    voiceStartTimer=setTimeout(function(){if(voiceSession!==session||voicePhase!=='starting')return;stopVoice();voicePhase='error';voiceMessage='Ses motoru zamanında başlamadı. Yeniden başlatmayı dene.';ensureVoiceHud();voiceHudState('error');voiceHudFlash(voiceMessage,'warn');updateVoiceStatus();},15000);
    return true;
  }
  function stopVoice(){
    if(voiceStartTimer){clearTimeout(voiceStartTimer);voiceStartTimer=null;}
    if(voiceHudTimer){clearTimeout(voiceHudTimer);voiceHudTimer=null;}
    newVoiceSession();voicePhase='stopped';voiceMessage='';nativeCmd('voice_stop');
    if(voiceHud)voiceHud.style.display='none';updateVoiceStatus();
  }
  function restartVoice(){stopVoice();return startVoice();}
  function installVoice(){
    stopVoice();voicePhase='installing';ensureVoiceHud();voiceHudState('idle');
    voiceMessage='Yerel ses paketi indiriliyor…';voiceHudFlash(voiceMessage,'heard');updateVoiceStatus();
    nativeCmd('voice_install',newVoiceSession(),voiceConfig().language);
  }
  window.__LDC_voiceEvent=function(event){
    if(!event||event.session!==voiceSession)return;
    if(voiceStartTimer){clearTimeout(voiceStartTimer);voiceStartTimer=null;}
    if(event.phase==='starting'){
      // Native model loading acknowledgement must not cancel startup's timeout.
      voiceStartTimer=setTimeout(function(){if(voicePhase==='starting'){stopVoice();voicePhase='error';voiceMessage='Ses motoru başlatılamadı.';updateVoiceStatus();}},15000);
    }
    voicePhase=event.phase;voiceMessage=event.message||'';
    ensureVoiceHud();voiceHudState(voicePhase==='listening'?'listen':/error|missing/.test(voicePhase)?'error':'idle');
    if(event.action&&voicePhase==='listening')voiceApplyAction(event.action);
    else if(voiceMessage){voiceHudFlash(voiceMessage,/error|missing/.test(voicePhase)?'warn':'heard');if(voicePhase==='error'||voicePhase==='missing')say(voiceMessage,C.warn);}
    updateVoiceStatus();
    if(voicePhase==='ready'&&ison('voiceMute','0'))startVoice();
  };
  function voiceStatusText(){
    if(voicePhase==='installing')return 'Paket indiriliyor…';
    if(!ison('voiceMute','0'))return 'Kapalı';
    if(voicePhase==='error')return 'Durdu (yeniden başlat gerekiyor)';
    if(voicePhase==='missing')return 'Ses paketi gerekli';
    if(voicePhase==='listening')return 'Yerel dinleme';
    if(voicePhase==='starting')return 'Başlatılıyor…';
    return 'Kapalı';
  }
  function updateVoiceStatus(){if(voiceStatusEl){voiceStatusEl.textContent=tr(voiceStatusText());voiceStatusEl.title=voiceMessage;voiceStatusEl.style.color=/error|missing/.test(voicePhase)?C.warn:C.mut;}var detail=document.getElementById&&document.getElementById('ldc-voice-detail');if(detail){detail.textContent=voiceMessage;detail.hidden=!voiceMessage;detail.style.color=/error|missing/.test(voicePhase)?C.warn:C.mut;}updateMicBadge();}
  window.addEventListener('pagehide',stopVoice);
  window.__LDC_voicePermissionReset=function(ok){voiceMessage=ok?(lang==='en'?'Discord device permissions were reset. Rejoin the room to choose again.':'Discord aygıt izinleri sıfırlandı. Yeniden seçim için odaya tekrar katıl.'):(lang==='en'?'Device permissions could not be reset. Update WebView2 and try again.':'Aygıt izinleri sıfırlanamadı. WebView2’yi güncelleyip tekrar dene.');updateVoiceStatus();say(voiceMessage,ok?C.mut:C.warn);};

  function micState(){var s=micMuteState();return s==='muted'?'muted':(s==='live'?'live':'unknown');}
  function updateMicBadge(){
    if(!micBadge||!ison('micBadge','1'))return;
    var s=micState(),on=s==='live',state=tr(s==='unknown'?'Mikrofon ?':(on?'Mikrofon açık':'Mikrofon kapalı'));
    micBadge.dataset.mic=s;micBadge.dataset.phase=voicePhase;
    var slash=micBadge.querySelector('[data-mic-slash]');if(slash)slash.style.display=on?'none':'';
    micBadge.title=state+' · '+tr(voiceMessage||voiceStatusText());
    micBadge.setAttribute('aria-label',state+' · '+(lang==='en'?'Open voice settings':'Ses ayarlarını aç'));
  }
  function ensureMicBadge(){
    if(!ison('micBadge','1')){if(micBadge)micBadge.style.display='none';return;}
    var help=document.querySelector('a[href^="https://support.discord.com"]');
    var host=help&&(help.closest('[class*="trailing_"]')||help.closest('[role="toolbar"]')||help.parentElement);
    if(!host)return;
    if(!micBadge){micBadge=mk('button',{});micBadge.type='button';micBadge.className='ldc-audio-status';micBadge.id='ldc-audio-status';micBadge.setAttribute('aria-haspopup','dialog');micBadge.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v3M9 21h6"/><path data-mic-slash d="m4 4 16 16"/></svg>';micBadge.onclick=function(){activeTab='voice';openPanel();};}
    if(micBadge.parentNode!==host)host.insertBefore(micBadge,host.firstChild);
    micBadge.style.display='inline-flex';updateMicBadge();
  }
  // Audio state lives in the app header. Detailed errors stay in Voice settings.
  function ensureVoiceHud(){
    ensureMicBadge();
  }
  function voiceHudState(mode){ // 'listen' | 'idle' | 'error'
    updateMicBadge();
  }
  function voiceHudFlash(text,kind){ // kind: 'mute' | 'unmute' | 'heard' | 'warn'
    if(micBadge)micBadge.title=tr(text);updateMicBadge();
  }
