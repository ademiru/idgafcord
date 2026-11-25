  var AERO_CSS=__LDC_AERO_CSS__;
  function buildAeroTheme(dark){
    var bg=dark?['#061321','#081827','#0b2032','#112a3c','#163246','#1c3d52']:['#d4edf5','#e2f3f9','#f3fbfe','#e3f4fa','#d5edf6','#c5e3ef'];
    return buildTheme(bg,dark?'#68bfd5':'#0078a8')+AERO_CSS;
  }
  function syncAero(){
    var theme=get('theme','aeroDark'),active=!SAFE&&(theme==='aero'||theme==='aeroDark'),el=document.documentElement;
    if(active){el.setAttribute('data-ldc-aero',theme==='aeroDark'?'dark':'light');el.setAttribute('data-ldc-aero-fx',get('aeroEffects','1'));el.setAttribute('data-ldc-aero-focus',get('aeroFocus','0'));}
    else{el.removeAttribute('data-ldc-aero');el.removeAttribute('data-ldc-aero-fx');el.removeAttribute('data-ldc-aero-focus');}
    var tools=document.getElementById('ldc-aero-tools');if(tools){tools.style.display=active?'flex':'none';var buttons=tools.querySelectorAll('button');if(buttons[0])buttons[0].setAttribute('aria-pressed',String(theme==='aeroDark'));if(buttons[1])buttons[1].setAttribute('aria-pressed',String(ison('aeroFocus','0')));if(buttons[2])buttons[2].setAttribute('aria-pressed',String(ison('aeroEffects','1')));}
  }
  function buildAeroTools(){
    var bar=mk('div',{display:'none',gap:'5px',padding:'0 5px'});bar.id='ldc-aero-tools';bar.className='ldc-aero-tools';
    function button(label,glyph,fn){var b=mk('button',{height:'32px',minWidth:'32px',padding:'0 8px',fontFamily:'inherit',fontSize:'12px',fontWeight:'700',cursor:'pointer'},glyph);b.type='button';b.title=tr(label);b.setAttribute('aria-label',tr(label));b.onclick=fn;bar.appendChild(b);}
    button('Açık / koyu Aero','◐',function(){set('theme',get('theme','aero')==='aero'?'aeroDark':'aero');applyAll();if(themePills)themePills.set(get('theme','aero'));});
    button('Odak görünümü','◎',function(){set('aeroFocus',ison('aeroFocus','0')?'0':'1');applyAll();});
    button('Cam efektleri','◇',function(){set('aeroEffects',ison('aeroEffects','1')?'0':'1');applyAll();});
    return bar;
  }
