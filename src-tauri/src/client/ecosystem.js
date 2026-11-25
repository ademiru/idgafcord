  __LDC_CARD_SCHEMA__
  function buildCardEditor(){
    var host=document.createElement('section');host.id='ldc-card-editor';var value;
    try{value=JSON.parse(get('profileCard','{}'));}catch(error){value={};}
    var editor=mountIdgafCardEditor(host,{value:value,english:lang==='en',save:function(card){LS.setItem('ldc_profileCard',JSON.stringify(card));}});
    var note=document.createElement('p');note.className='ldc-card-note';note.textContent=lang==='en'?'Your card stays on this computer. Publishing and viewing other people’s cards require the ecosystem connection. No Discord session token is used.':'Kartın bu bilgisayarda saklanır. Yayınlama ve başkalarının kartlarını görme, ekosistem bağlantısı kurulduğunda açılır. Discord oturum anahtarın kullanılmaz.';host.append(note);
    var actions=document.createElement('div');actions.className='idgaf-card-actions';
    var exportButton=document.createElement('button');exportButton.type='button';exportButton.textContent=lang==='en'?'Export card':'Kartı dışa aktar';exportButton.onclick=function(){var blob=new Blob([JSON.stringify(editor.value(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='idgafcord-card.json';link.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);};
    var importButton=document.createElement('button');importButton.type='button';importButton.textContent=lang==='en'?'Import card':'Kartı içe aktar';importButton.onclick=function(){var input=document.createElement('input');input.type='file';input.accept='application/json,.json';input.onchange=async function(){var file=input.files&&input.files[0];if(!file)return;if(file.size>8192){say(lang==='en'?'Card file is too large.':'Kart dosyası çok büyük.',C.warn);return;}try{editor.set(JSON.parse(await file.text()));say(lang==='en'?'Imported. Save to keep your changes.':'İçe aktarıldı. Saklamak için kartını kaydet.');}catch(error){say(lang==='en'?'Invalid card file.':'Kart dosyası geçerli değil.',C.warn);}};input.click();};
    actions.append(exportButton,importButton);host.append(actions);
    var connection=document.createElement('div');connection.className='idgaf-card-fields';var label=document.createElement('label');label.textContent=lang==='en'?'Ecosystem address':'Ekosistem adresi';var address=document.createElement('input');address.type='url';address.id='ldc-ecosystem-url';address.placeholder='https://idgafcord.hesabin.workers.dev';address.value=nativeState.ecosystem_url||'';label.append(address);connection.append(label);
    var enabledLabel=document.createElement('label'),enabled=document.createElement('input');enabled.type='checkbox';enabled.id='ldc-ecosystem-enabled';enabled.checked=!!nativeState.ecosystem_enabled;enabledLabel.append(document.createTextNode(lang==='en'?'Show ecosystem cards':'Ekosistem kartlarını göster'),enabled);connection.append(enabledLabel);host.append(connection);
    var privacy=document.createElement('p');privacy.className='ldc-card-note';privacy.textContent=lang==='en'?'Optional. Opening a profile sends that person’s Discord user ID to your configured ecosystem address. No messages, server lists or Discord tokens are sent.':'İsteğe bağlıdır. Bir profili açtığında, o kişinin Discord kullanıcı kimliği yapılandırdığın ekosistem adresine gönderilir. Mesajlar, sunucu listeleri ve Discord oturum anahtarı gönderilmez.';host.append(privacy);
    var online=document.createElement('div');online.className='idgaf-card-actions';var connect=document.createElement('button');connect.type='button';connect.textContent=lang==='en'?'Save connection':'Bağlantı ayarını kaydet';connect.onclick=function(){nativeCmd('set_ecosystem','',JSON.stringify({url:address.value.trim(),enabled:enabled.checked}));};
    var publish=document.createElement('button');publish.type='button';publish.textContent=lang==='en'?'Publish in browser':'Tarayıcıda yayınla';publish.onclick=function(){var origin=nativeState.ecosystem_url;if(!origin){say(lang==='en'?'Configure the ecosystem address first.':'Önce ekosistem adresini yapılandır.',C.warn);return;}window.location.href=origin+'/#card='+encodeURIComponent(JSON.stringify(editor.value()));};
    online.append(connect,publish);host.append(online);return host;
  }
  var ecosystemPending=new Map(),ecosystemCache=new Map(),ecosystemCounter=0;
  var ecosystemProfileSelector='[class*="userPopout_"],[class*="userProfileModal_"],[class*="userProfileOuter_"]';
  function ecosystemIdentity(host){var avatar=host.querySelector('img[src*="/avatars/"]');return avatar&&(avatar.getAttribute('src')||'').match(/\/avatars\/(\d{16,22})\//)?.[1];}
  function scanEcosystem(){
    if(SAFE||!nativeState.ecosystem_enabled||!nativeState.ecosystem_url)return;
    ecosystemPending.forEach(function(value,key){if(!value.host.isConnected)ecosystemPending.delete(key);});
    document.querySelectorAll(ecosystemProfileSelector).forEach(function(host){
      if(host.parentElement&&host.parentElement.closest(ecosystemProfileSelector))return;
      var id=ecosystemIdentity(host);if(!id||host.getAttribute('data-ldc-ecosystem-user')===id)return;
      host.querySelectorAll('.ldc-ecosystem-profile').forEach(function(card){card.remove();});host.setAttribute('data-ldc-ecosystem-user',id);
      var cached=ecosystemCache.get(id);if(cached&&Date.now()-cached.at<120000){appendEcosystemCard(host,cached.card);return;}
      var request='card-'+(++ecosystemCounter);ecosystemPending.set(request,{host:host,id:id,tries:0});nativeCmd('ecosystem_lookup',request,id);
    });
  }
  function appendEcosystemCard(host,card){if(!card)return;var rendered=renderIdgafCard(document,card,true,lang==='en');rendered.classList.add('ldc-ecosystem-profile');var source=document.createElement('p');source.className='ldc-ecosystem-source';source.textContent=lang==='en'?'Client: selected by the profile owner':'İstemci: profil sahibinin seçimi';rendered.append(source);host.append(rendered);}
  window.__LDC_ecosystemCard=function(result){
    var pending=ecosystemPending.get(result.request);if(!pending||pending.id!==result.id||!pending.host.isConnected||ecosystemIdentity(pending.host)!==result.id)return;
    if(result.status==='busy'&&pending.tries++<3){setTimeout(function(){if(pending.host.isConnected)nativeCmd('ecosystem_lookup',result.request,result.id);},450);return;}
    ecosystemPending.delete(result.request);
    if(result.status==='ok'){if(ecosystemCache.size>=128)ecosystemCache.delete(ecosystemCache.keys().next().value);ecosystemCache.set(result.id,{at:Date.now(),card:result.card});appendEcosystemCard(pending.host,result.card);}
  };
