const appearance=window.__LDC_STARTUP__;
if(appearance){document.documentElement.style.backgroundColor=appearance.background;document.documentElement.style.color=appearance.foreground;document.documentElement.style.colorScheme=appearance.dark?'dark':'light';}
requestAnimationFrame(()=>requestAnimationFrame(()=>location.replace('https://discord.com/app')));
