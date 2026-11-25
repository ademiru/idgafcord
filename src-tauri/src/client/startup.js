  // Keep a static, non-blocking waiting surface after the short brand animation.
  var bootTimer=null,appearanceTimer=null,lastAppearance='';
  function syncAppearance(){
    clearTimeout(appearanceTimer);
    appearanceTimer=setTimeout(function(){
      var theme=get('theme','aeroDark'),light=!SAFE&&theme==='aero';
      var appearance={background:light?'#dbeef5':'#061321',foreground:light?'#14384e':'#e0f5fb',dark:!light};
      if(theme!=='aero'&&theme!=='aeroDark'){
        var sample=document.createElement('span');sample.style.cssText='position:absolute;visibility:hidden;pointer-events:none;background:var(--background-base-lowest);color:var(--text-normal)';
        (document.querySelector('#app-mount')||document.documentElement).appendChild(sample);
        var styles=getComputedStyle(sample),color=styles.backgroundColor.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
        if(color){var channels=color.slice(1).map(Number);appearance.background='#'+channels.map(function(v){return v.toString(16).padStart(2,'0');}).join('');appearance.dark=(channels[0]*.2126+channels[1]*.7152+channels[2]*.0722)<145;appearance.foreground=appearance.dark?'#e0f5fb':'#14384e';}sample.remove();
      }
      document.documentElement.style.backgroundColor=appearance.background;
      var serialized=JSON.stringify(appearance);
      if(ldcRendered()&&lastAppearance!==serialized){lastAppearance=serialized;nativeCmd('appearance','',serialized);}
    },120);
  }
  function watchBoot(){
    if(ldcRendered()){
      var waiting=document.getElementById('ldc-loading');if(waiting)waiting.remove();
      var issue=document.getElementById('ldc-load-issue');if(issue)issue.remove();
      syncAppearance();
      clearInterval(bootTimer);bootTimer=null;return;
    }
    if(!document.getElementById('ldc-loading')){
      var waiting=mk('div',{position:'fixed',inset:'0',display:'grid',placeItems:'center',background:'var(--ldc-ui-field,#061321)',color:'var(--ldc-ui-fg,#e0f5fb)',fontFamily:'"Segoe UI",Tahoma,sans-serif',zIndex:'2147482000',pointerEvents:'none'});
      waiting.id='ldc-loading';waiting.setAttribute('role','status');
      var text=mk('div',{textAlign:'center',fontSize:'13px',lineHeight:'1.8'});
      text.appendChild(mk('strong',{display:'block',fontSize:'19px',fontWeight:'600'},'idgafcord'));
      text.appendChild(mk('span',{opacity:'.65'},lang==='en'?'Connecting to Discord…':'Discord’a bağlanılıyor…'));waiting.appendChild(text);
      (document.body||document.documentElement).appendChild(waiting);
    }
  }
  watchBoot();bootTimer=setInterval(watchBoot,250);
  new MutationObserver(syncAppearance).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  // No automatic reload or safe-mode transition, even on a slow connection.
