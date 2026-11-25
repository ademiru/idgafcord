  var blockedCount=0,blockedLog=[],catCount={};
  function pushLog(cat,u){blockedCount++;catCount[cat]=(catCount[cat]||0)+1;var d=new Date().toISOString().slice(0,10);if(get('blockedDay','')!==d){set('blockedDay',d);set('blockedToday','0');}set('blockedToday',String((parseInt(get('blockedToday','0'),10)||0)+1));blockedLog.push({t:Date.now(),c:cat,u:String(u).replace(/^https?:\/\//,'').split('?')[0].slice(0,90)});if(blockedLog.length>500)blockedLog.shift();}
  function blocked(input){
    if(SAFE||!ison('block','1')||!input)return false;
    var u;try{u=new URL(String(input),location.href);}catch(e){return false;}
    var host=u.hostname.toLowerCase(),path=u.pathname,category=null;
    if(host==='discord.com'||host.endsWith('.discord.com')){
      if(/^\/api\/v\d+\/science\/?$/.test(path))category='SCIENCE';
      else if(/^\/api\/v\d+\/(track|metrics)\b/.test(path))category='METRICS';
      else if(/^\/api\/v\d+\/applications\/\d+\/analytics\b/.test(path))category='ANALYTICS';
      else if(/^\/api\/v\d+\/rtc\/quality\b/.test(path))category='RTC-QoS';
    }
    if(host==='sentry.io'||host.endsWith('.sentry.io'))category='SENTRY';
    else if(host==='api.segment.io'||host==='api.segment.com')category='SEGMENT';
    else if(host==='google-analytics.com'||host.endsWith('.google-analytics.com'))category='GA';
    else if(host==='doubleclick.net'||host.endsWith('.doubleclick.net'))category='ADS';
    if(!category)return false;
    pushLog(category,u.href);return true;
  }
  var of=window.fetch;
  window.fetch=function(input,init){
    var u=typeof input==='string'||input instanceof URL?String(input):(input&&input.url)||'';
    if(blocked(u)){
      var signal=(init&&init.signal)||(input&&input.signal);
      if(signal&&signal.aborted)return Promise.reject(signal.reason||new DOMException('Aborted','AbortError'));
      return Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));
    }
    return of.apply(this,arguments);
  };
  var xp=XMLHttpRequest.prototype,oo=xp.open,os=xp.send,oa=xp.abort;
  var synthetic=['readyState','status','statusText','response','responseText','responseURL'];
  xp.open=function(method,url,async){
    if(this.__ldcTimer){clearTimeout(this.__ldcTimer);this.__ldcTimer=null;}
    synthetic.forEach(function(key){try{delete this[key];}catch(e){}},this);
    this.__ldcUrl=url;this.__ldcAsync=async!==false;this.__ldcBlocked=false;
    return oo.apply(this,arguments);
  };
  xp.send=function(){
    if(!blocked(this.__ldcUrl))return os.apply(this,arguments);
    var xhr=this;
    if(xhr.readyState!==1)throw new DOMException('Request is not opened','InvalidStateError');
    xhr.__ldcBlocked=true;
    function complete(){
      xhr.__ldcTimer=null;if(!xhr.__ldcBlocked)return;
      var response=xhr.responseType==='json'?{}:xhr.responseType==='blob'?new Blob(['{}'],{type:'application/json'}):xhr.responseType==='arraybuffer'?new TextEncoder().encode('{}').buffer:'{}';
      try{Object.defineProperties(xhr,{readyState:{configurable:true,value:4},status:{configurable:true,value:200},statusText:{configurable:true,value:'OK'},response:{configurable:true,value:response},responseText:{configurable:true,value:'{}'},responseURL:{configurable:true,value:String(xhr.__ldcUrl)}});}catch(e){xhr.__ldcBlocked=false;xhr.dispatchEvent(new ProgressEvent('error'));xhr.dispatchEvent(new ProgressEvent('loadend'));return;}
      xhr.__ldcBlocked=false;
      xhr.dispatchEvent(new Event('readystatechange'));xhr.dispatchEvent(new ProgressEvent('load'));xhr.dispatchEvent(new ProgressEvent('loadend'));
    }
    if(xhr.__ldcAsync)xhr.__ldcTimer=setTimeout(complete,0);else complete();
  };
  xp.abort=function(){
    if(!this.__ldcBlocked)return oa.apply(this,arguments);
    this.__ldcBlocked=false;if(this.__ldcTimer){clearTimeout(this.__ldcTimer);this.__ldcTimer=null;}
    oa.apply(this,arguments);this.dispatchEvent(new ProgressEvent('abort'));this.dispatchEvent(new ProgressEvent('loadend'));
  };
  if(navigator.sendBeacon){var ob=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(u,d){if(blocked(u))return true;return ob(u,d);};}
