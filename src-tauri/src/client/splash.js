  var splashShown=false;
  function splash(){try{
    if(splashShown||SAFE||!ison('splash','1')||document.hidden)return;
    var host=document.body||document.documentElement;if(!host)return;
    splashShown=true;
    var s=document.createElement('div');s.id='ldc-splash';s.setAttribute('aria-hidden','true');
    var english=lang==='en';
    s.innerHTML='<div class="ldc-sp-wrap"><div class="ldc-sp-orb"><img class="ldc-sp-mark" alt="" src="'+LDC_LOGO_DATA_URI+'"></div><div class="ldc-sp-logo"><b>idgaf</b><span>cord</span></div><div class="ldc-sp-tag">I DON’T GIVE A FUCK ABOUT YOUR DATA</div><div class="ldc-sp-status"><span class="ldc-sp-dot"></span><span class="ldc-sp-status-text">'+(english?'Loading Discord':'Discord yükleniyor')+'</span></div><div class="ldc-sp-foot">'+(english?'Click or press any key to continue':'Devam etmek için tıkla veya bir tuşa bas')+'</div></div>';
    host.appendChild(s);
    var born=Date.now(),done=false,removeTimer=null;
    var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function remove(){if(removeTimer)clearTimeout(removeTimer);s.removeEventListener('animationend',animationEnd);if(s.parentNode)s.parentNode.removeChild(s);}
    function animationEnd(e){if(e.target===s&&e.animationName==='ldc-sp-exit')remove();}
    function cleanup(){clearInterval(poll);clearTimeout(max);document.removeEventListener('pointerdown',finish,true);document.removeEventListener('keydown',finish,true);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);}
    function finish(){if(done)return;done=true;cleanup();s.className='out';s.addEventListener('animationend',animationEnd);removeTimer=setTimeout(remove,reduced?0:360);}
    function visibility(){if(document.hidden||Date.now()-born>900)finish();}
    function pagehide(){finish();remove();}
    var poll=setInterval(function(){if(ldcRendered()&&Date.now()-born>=(reduced?0:650)){var label=s.querySelector('.ldc-sp-status-text');if(label)label.textContent=english?'Ready':'Hazır';finish();}},100);
    var max=setTimeout(finish,2200);
    document.addEventListener('pointerdown',finish,true);document.addEventListener('keydown',finish,true);document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pagehide);
  }catch(e){var stuck=document.getElementById('ldc-splash');if(stuck)stuck.remove();}}
