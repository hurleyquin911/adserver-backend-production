/* Hybrid ZIP build based on supplied working references. External providers are contacted only after a fresh
   device position passes the accuracy filter. No IP fallback or coordinate logs. */
(function(root){
'use strict';
const RAIN=new Set([51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,97,99]);
function classify(code){
  if(!Number.isInteger(code))return 'fallback';
  if(code===0||code===1)return 'cerah';
  if(code===2||code===3)return 'berawan';
  return RAIN.has(code)?'hujan':'fallback';
}
// 500m is a configurable product filter, not a guarantee of city-boundary accuracy.
const CONFIG=Object.freeze({maxAccuracyMeters:500,locationTimeoutMs:15000,apiTimeoutMs:6500,maxWeatherAgeMs:90*60000});
function failure(reason){const e=new Error(reason);e.reason=reason;return e;}
function validPosition(p){
  const c=p&&p.coords;
  if(!c||!Number.isFinite(c.latitude)||Math.abs(c.latitude)>90||!Number.isFinite(c.longitude)||Math.abs(c.longitude)>180||!Number.isFinite(c.accuracy)||c.accuracy<0)throw failure('location-invalid');
  if(!Number.isFinite(p.timestamp)||Math.abs(Date.now()-p.timestamp)>60000)throw failure('location-stale');
  return {latitude:c.latitude,longitude:c.longitude,accuracyMeters:c.accuracy};
}
function locate(diagnostics){
  return new Promise((resolve,reject)=>{
    const geo=navigator.geolocation;
    let ended=false,watchId=null,retryTimer=null,singleAttempts=0;
    const canWatch=typeof geo.watchPosition==='function'&&typeof geo.clearWatch==='function';
    const timer=setTimeout(()=>finish(failure(diagnostics.accuracyMeters===null?'location-timeout':'location-inaccurate')),CONFIG.locationTimeoutMs+1000);
    function stopWatch(){
      if(watchId!==null){try{geo.clearWatch(watchId);}catch(ignore){}watchId=null;}
    }
    function finish(e,p){
      if(ended)return;ended=true;
      clearTimeout(timer);clearTimeout(retryTimer);stopWatch();
      root.removeEventListener('pagehide',onPageHide);
      e?reject(e):resolve(p);
    }
    function onPageHide(){finish(failure('location-cancelled'));}
    function onPosition(raw){
      if(ended)return;
      diagnostics.locationSamples++;
      let p;
      try{p=validPosition(raw);}catch(e){finish(e);return;}
      if(diagnostics.accuracyMeters===null||p.accuracyMeters<diagnostics.accuracyMeters)diagnostics.accuracyMeters=p.accuracyMeters;
      if(p.accuracyMeters<=CONFIG.maxAccuracyMeters){
        diagnostics.accuracyMeters=p.accuracyMeters;
        finish(null,p);return;
      }
      // Keep listening for an improved fix. Never geocode a coarse result.
      if(!canWatch&&singleAttempts<2)retryTimer=setTimeout(requestSingle,1000);
    }
    function onError(e){
      if(ended)return;
      const reason=e&&e.code===1?'location-denied':e&&e.code===3?(diagnostics.accuracyMeters===null?'location-timeout':'location-inaccurate'):'location-unavailable';
      finish(failure(reason));
    }
    const options={enableHighAccuracy:true,timeout:CONFIG.locationTimeoutMs,maximumAge:0};
    function requestSingle(){
      if(ended)return;
      singleAttempts++;
      try{geo.getCurrentPosition(onPosition,onError,options);}catch(e){finish(failure('location-unavailable'));}
    }
    root.addEventListener('pagehide',onPageHide,{once:true});
    try{
      if(canWatch){
        watchId=geo.watchPosition(onPosition,onError,options);
        // Also handles implementations that invoke the callback synchronously.
        if(ended)stopWatch();
      }else requestSingle();
    }catch(e){finish(failure('location-unavailable'));}
  });
}
async function fetchJSON(url,controller,label){
  let timer;
  try{
    const timedOut=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure(label+'-timeout'));},CONFIG.apiTimeoutMs);});
    const request=(async()=>{
      const response=await fetch(url,{signal:controller.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',mode:'cors'});
      if(!response.ok)throw failure(label+'-http');
      return await response.json();
    })();
    return await Promise.race([request,timedOut]);
  }catch(e){throw e.reason?e:failure(label+'-network');}
  finally{clearTimeout(timer);}
}
function readWeather(body){
  const c=body&&body.current;
  if(!c||!Number.isInteger(c.weather_code)||!Number.isFinite(c.time)||(c.is_day!==0&&c.is_day!==1))throw failure('weather-invalid');
  if(c.time*1000>Date.now()+15*60000||Date.now()-c.time*1000>CONFIG.maxWeatherAgeMs)throw failure('weather-stale');
  const weather=classify(c.weather_code);
  if(weather==='fallback')throw failure('weather-unsupported');
  return {weather:weather,isDay:c.is_day===1,weatherCode:c.weather_code};
}
function readRegion(body,coords){
  if(!body||body.error||typeof body.lookupSource!=='string'||/\bip\b/i.test(body.lookupSource))throw failure('region-invalid');
  if(!Number.isFinite(body.latitude)||!Number.isFinite(body.longitude)||Math.abs(body.latitude-coords.latitude)>.001||Math.abs(body.longitude-coords.longitude)>.001)throw failure('region-coordinate-mismatch');
  const clean=v=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,'').trim():'';
  const city=clean(body.city),region=city||clean(body.locality);
  if(!region||region.length>160)throw failure('region-missing');
  return {region:region,regionField:city?'city':'locality',regionLookupSource:body.lookupSource};
}
async function resolveContext(){
  // Diagnostics expose quality and field provenance, never latitude/longitude.
  const diagnostics={accuracyMeters:null,accuracyLimitMeters:CONFIG.maxAccuracyMeters,locationSamples:0,regionField:null,regionLookupSource:null};
  const fallback=reason=>Object.assign({weather:'fallback',region:'',status:'fallback',reason:reason,isDay:null},diagnostics);
  if(!root.isSecureContext)return fallback('insecure-context');
  const policy=document.permissionsPolicy||document.featurePolicy;
  if(policy&&typeof policy.allowsFeature==='function'&&!policy.allowsFeature('geolocation'))return fallback('location-policy-blocked');
  if(!navigator.geolocation||typeof navigator.geolocation.getCurrentPosition!=='function')return fallback('location-unsupported');
  if(typeof fetch!=='function'||typeof AbortController!=='function')return fallback('network-unsupported');
  let coords,controllers=[];
  try{
    coords=await locate(diagnostics);
    const weatherURL=new URL('https://api.open-meteo.com/v1/forecast');
    weatherURL.search=new URLSearchParams({latitude:coords.latitude.toFixed(3),longitude:coords.longitude.toFixed(3),current:'weather_code,is_day',timeformat:'unixtime',timezone:'GMT',forecast_days:'1'});
    const regionURL=new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    regionURL.search=new URLSearchParams({latitude:String(coords.latitude),longitude:String(coords.longitude),localityLanguage:'id'});
    controllers=[new AbortController(),new AbortController()];
    const results=await Promise.all([
      fetchJSON(weatherURL.toString(),controllers[0],'weather').then(readWeather),
      fetchJSON(regionURL.toString(),controllers[1],'region').then(b=>readRegion(b,coords))
    ]);
    return Object.assign({status:'ready',reason:null},diagnostics,results[0],results[1]);
  }catch(e){controllers.forEach(c=>c.abort());return fallback(e.reason||'data-unavailable');}
  finally{coords=null;}
}
root.ActifedWeather=Object.freeze({resolve:resolveContext,classify:classify,config:CONFIG});
})(window);
