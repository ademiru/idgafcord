  // Decoration only: Discord retains its controls, timers and event handlers.
  function decorateWorkspace(scope){
    if(SAFE)return;
    var selector='[class*="sidebarList_"] a,[class*="sidebarList_"] [role="button"],[class*="sidebarList_"] [role="link"],[class*="sidebarList_"] [data-list-item-id]';
    var candidates=scope.querySelectorAll?Array.from(scope.querySelectorAll(selector)):[];
    if(scope.matches&&scope.matches(selector))candidates.unshift(scope);
    candidates.forEach(function(item){
      if(item.closest('#ldc-root,#ldc-modal'))return;
      var href=item.getAttribute('href')||'',id=item.getAttribute('data-list-item-id')||'';
      // A real text/voice channel may be called "Members" or "Events".
      if(/\/channels\/\d+\/\d+/.test(href)||/channels___\d+$/.test(id))return;
      var name=(item.getAttribute('aria-label')||item.textContent||'').trim().toLowerCase();
      var kind=/^(events|etkinlikler)$/.test(name)?'events':/^(members|üyeler|uyeler)$/.test(name)?'members':/^(server boosts|sunucu takviyeleri|sunucu takviyesi|sunucu destekleri)$/.test(name)?'boosts':null;
      if(kind){var row=item.closest('li')||item;row.setAttribute('data-ldc-server-shortcut',kind);}
    });
  }
  function syncWorkspace(){
    document.documentElement.toggleAttribute('data-ldc-safe',SAFE);
    ['events','members','boosts'].forEach(function(kind){document.documentElement.toggleAttribute('data-ldc-hide-'+kind,!SAFE&&ison('hideServer'+kind[0].toUpperCase()+kind.slice(1),'0'));});
  }
