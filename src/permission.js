const request=window.__LDC_PERMISSION__;
const valid=request&&request.origin==='https://discord.com'&&['microphone','camera'].includes(request.kind);
const en=request?.language==='en',camera=request?.kind==='camera';
if(valid){
  document.documentElement.lang=en?'en':'tr';
  const colors=request.appearance;
  if(colors&&!colors.dark){for(const [key,value] of Object.entries({'--bg':'#dbeef5','--surface':'#f4fbff','--fg':'#14384e','--muted':'#41677c','--line':'#21708f44','--shine':'#ffffffbb'}))document.documentElement.style.setProperty(key,value);document.documentElement.style.colorScheme='light';}
  document.getElementById('heading').textContent=en?(camera?'Camera access':'Microphone access'):(camera?'Kamera erişimi':'Mikrofon erişimi');
  document.getElementById('description').textContent=en?(camera?'Discord wants to use your camera for video calls.':'Discord wants to use your microphone so you can speak in a voice channel.'):(camera?'Görüntülü görüşme için kamerana erişim istiyor.':'Ses kanalında konuşabilmek için mikrofonuna erişim istiyor.');
  document.getElementById('remember-label').textContent=en?'Remember this choice':'Bu seçimi hatırla';
  document.getElementById('deny').textContent=en?'Deny':'Reddet';document.getElementById('allow').textContent=en?'Allow':'İzin ver';
  document.getElementById('close').setAttribute('aria-label',en?'Close':'Kapat');
  if(camera)document.getElementById('device-icon').innerHTML='<rect x="3" y="5" width="13" height="14" rx="3"/><path d="m16 10 5-3v10l-5-3z"/>';
  document.getElementById('allow').disabled=false;document.getElementById('deny').disabled=false;
}else{document.getElementById('heading').textContent='İzin isteği kullanılamıyor';document.querySelector('.origin').textContent='';document.getElementById('description').textContent='Etkin bir aygıt izni isteği bulunamadı.';}
function decide(allow,remember=document.getElementById('remember').checked){
  if(!valid&&allow)return;
  for(const id of ['allow','deny','close'])document.getElementById(id).disabled=true;
  location.href='idgafcord://permission?decision='+(allow?'allow':'deny')+'&remember='+(remember?'1':'0');
}
document.getElementById('allow').onclick=()=>decide(true);
document.getElementById('deny').onclick=()=>decide(false);
document.getElementById('close').onclick=()=>decide(false,false);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();decide(false,false);}});
document.getElementById('deny').focus();
