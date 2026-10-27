(function(){
'use strict';
const $=id=>document.getElementById(id),banner=$('actifed-banner');
const assets=JSON.parse($('creative-assets').textContent);
const e={base:$('weather-base'),tint:$('weather-tint'),ending:$('ending-backdrop'),effects:$('weather-effects'),header:$('weather-header'),intro:$('opening-copy'),green:$('product-green'),red:$('product-red'),copy:$('main-copy'),cta:$('cta-art'),credit:$('attribution')};
const labels={hujan:'Hujan',berawan:'Berawan',cerah:'Cerah'};
const copy={
 hujan:['Musim hujan?','Jangan biarkan batuk','& pilek mengganggu','aktivitasmu.'],
 berawan:['Pergantian cuaca?','Jangan biarkan batuk','& pilek mengganggu','aktivitasmu.'],
 cerah:['Cuaca cerah,','jadwal padat?','Jangan biarkan batuk','& pilek mengganggu','aktivitasmu.']
};
const icons={
 cerah:'<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
 berawan:'<path d="M6 19h12a4.5 4.5 0 0 0 .3-9 6.5 6.5 0 0 0-12.6-1A5 5 0 0 0 6 19Z"/>',
 hujan:'<path d="M6 15h12a4.2 4.2 0 0 0 0-8 6 6 0 0 0-11.4-1A4.6 4.6 0 0 0 6 15Zm1 3-1 3m7-3-1 3m7-3-1 3"/>'
};
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const easeOut=x=>1-Math.pow(1-clamp(x),3);
const opacity=(el,v)=>{el.style.opacity=String(clamp(v));};
const media=matchMedia('(prefers-reduced-motion: reduce)');
let context={status:'loading',weather:'fallback',region:'',reason:null,isDay:null};
let elapsed=0,last=null,frame=0,started=false,phase='loading';
const motionDeadline=performance.now()+30000;
let motionEnded=false;
function finishMotion(){
 motionEnded=true;cancelAnimationFrame(frame);frame=0;last=null;
 if(started)render(elapsed,true);
}
setTimeout(finishMotion,30000);
const canvas=$('rain-glass'),ctx=canvas.getContext('2d');
if(ctx)ctx.scale(2,2);
const droplets=Array.from({length:27},(_,i)=>({x:8+(i*83.13)%303,y:(i*57.9)%400,r:1.8+(i*1.71)%3.4,speed:13+(i*7.2)%41,phase:i*.77}));
function rain(t){
 if(!ctx)return;
 ctx.clearRect(0,0,320,400);
 for(const d of droplets){
  const y=(d.y+t*d.speed)%440-20,x=d.x+Math.sin(t*.6+d.phase)*2;
  const life=Math.min(1,Math.max(0,(y+20)/24));
  ctx.globalAlpha=.8*life;
  const trail=ctx.createLinearGradient(x,y-24,x,y);
  trail.addColorStop(0,'rgba(255,255,255,0)');trail.addColorStop(1,'rgba(238,247,255,.3)');
  ctx.fillStyle=trail;ctx.beginPath();ctx.ellipse(x,y-10,d.r*.36,14,0,0,Math.PI*2);ctx.fill();
  const glass=ctx.createRadialGradient(x-d.r*.35,y-d.r*.55,.1,x,y,d.r*1.65);
  glass.addColorStop(0,'rgba(255,255,255,.85)');glass.addColorStop(.25,'rgba(238,248,255,.22)');glass.addColorStop(.68,'rgba(44,66,79,.32)');glass.addColorStop(1,'rgba(255,255,255,.4)');
  ctx.fillStyle=glass;ctx.beginPath();ctx.ellipse(x,y,d.r,d.r*1.38,0,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='rgba(230,247,255,.5)';ctx.lineWidth=.45;ctx.stroke();
 }
 ctx.globalAlpha=1;
}
function pose(el,alpha,x,y,scale,rotate,z){
 opacity(el,alpha);
 el.style.transform='perspective(700px) translate3d('+x.toFixed(2)+'px,'+y.toFixed(2)+'px,0) scale('+scale.toFixed(4)+') rotateY('+rotate.toFixed(2)+'deg)';
 el.style.zIndex=String(z);
}
function productScene(t,weather){
 const entryAt=weather?4:0,firstSwap=weather?8:4;
 if(t<entryAt){pose(e.green,0,325,0,1,0,6);pose(e.red,0,0,0,.7,0,6);return 'opening';}
 if(t<entryAt+1){const p=easeOut(t-entryAt);pose(e.green,p,325*(1-p),0,1,0,6);pose(e.red,0,0,0,.7,0,6);return 'product-entry';}
 if(t<firstSwap){pose(e.green,1,0,0,1,0,7);pose(e.red,0,0,0,.7,0,6);return 'product-green';}
 const cycle=Math.floor((t-firstSwap)/3.5),local=(t-firstSwap)%3.5;
 const outgoing=cycle%2===0?e.green:e.red,incoming=cycle%2===0?e.red:e.green;
 if(local<.9){
  const p=smooth(local/.9),arc=Math.sin(Math.PI*p);
  pose(outgoing,1-smooth((p-.6)/.4),-42*arc,-14*arc,1-.32*p,28*p,p<.5?7:6);
  pose(incoming,smooth(p/.28),42*arc,12*arc,.68+.32*p,-28*(1-p),p<.5?6:7);
  return 'product-exchange';
 }
 pose(outgoing,0,0,0,.68,0,6);pose(incoming,1,0,0,1,0,7);
 return incoming===e.green?'product-green':'product-red';
}
function render(t,still){
 const weather=context.weather!=='fallback';
 opacity(e.ending,weather?(still?1:smooth(t-9)):1);
 opacity(e.tint,weather?(still?1:smooth(t-3)):0);
 opacity(e.intro,weather&&!still?(t<4?easeOut(t/.45):1-smooth(t-4)):0);
 const effectAlpha=weather&&!still?1-smooth((t-3.8)/.4):0;
 opacity(e.effects,effectAlpha);
 e.effects.hidden=effectAlpha<=0;
 if(effectAlpha>0){
  if(context.weather==='hujan')rain(t);
  if(context.weather==='cerah'){
   e.effects.querySelector('.sun-rays').style.transform='rotate('+(-2+t*1.5)+'deg)';
   e.effects.querySelector('.sun-halo').style.opacity=String(.8+.12*Math.sin(t*1.7));
  }
  if(context.weather==='berawan'){
   const p=smooth(t/4);
   e.effects.querySelector('.haze-left').style.transform='translate3d('+(-175*p)+'px,0,0)';
   e.effects.querySelector('.haze-right').style.transform='translate3d('+(175*p)+'px,0,0)';
   e.effects.querySelector('.haze-left').style.opacity=String(1-p*.9);
   e.effects.querySelector('.haze-right').style.opacity=String(1-p*.9);
  }
 }
 const copyAt=weather?5:1;
 opacity(e.copy,still?1:smooth(t-copyAt));
 opacity(e.cta,still?1:smooth((t-copyAt-.2)/.8));
 phase=still?'static':productScene(t,weather);
 if(still){pose(e.green,1,0,0,1,0,7);pose(e.red,0,0,0,.68,0,6);}
 const redFront=parseFloat(e.red.style.opacity)>parseFloat(e.green.style.opacity);
 e.red.setAttribute('aria-hidden',String(!redFront));
 e.green.setAttribute('aria-hidden',String(redFront));
 banner.dataset.scene=phase;
}
function tick(now){
 frame=0;
 if(motionEnded||performance.now()>=motionDeadline){finishMotion();return;}
 if(!started||document.hidden||media.matches){last=null;return;}
 if(last!==null)elapsed+=(now-last)/1000;
 last=now;render(elapsed,false);frame=requestAnimationFrame(tick);
}
function resume(){
 cancelAnimationFrame(frame);frame=0;last=null;
 if(!started)return;
 if(motionEnded||performance.now()>=motionDeadline){finishMotion();return;}
 if(media.matches){render(elapsed,true);return;}
 if(!document.hidden)frame=requestAnimationFrame(tick);
}
document.addEventListener('visibilitychange',resume);
if(media.addEventListener)media.addEventListener('change',resume);else if(media.addListener)media.addListener(resume);
function waitImage(im){
 if(im.complete)return Promise.resolve(im.naturalWidth>0);
 return new Promise(resolve=>{
  let done=false;const timer=setTimeout(()=>finish(false),4000);
  function finish(ok){if(done)return;done=true;clearTimeout(timer);resolve(ok);}
  im.addEventListener('load',()=>finish(true),{once:true});im.addEventListener('error',()=>finish(false),{once:true});
 });
}
async function apply(result){
 context=result;
 const weather=context.weather!=='fallback';
 if(weather){
  e.base.src=assets['dco-'+context.weather+'-base'];e.tint.src=assets['dco-'+context.weather+'-layer'];
  const ready=await Promise.all([waitImage(e.base),waitImage(e.tint)]);
  if(ready.some(ok=>!ok))context={weather:'fallback',region:'',status:'fallback',reason:'weather-asset-unavailable',isDay:null};
 }
 const active=context.weather!=='fallback';
 banner.classList.toggle('is-fallback',!active);
 banner.dataset.weather=context.weather;banner.dataset.status=context.status;
 e.base.hidden=!active;e.tint.hidden=!active;e.header.hidden=!active;e.intro.hidden=!active;e.credit.hidden=!active;
 if(active){
  $('weather-name').textContent=labels[context.weather];
  $('weather-icon').innerHTML='<svg viewBox="0 0 24 24">'+icons[context.weather]+'</svg>';
  $('region-name').textContent=context.region;$('region-name').title=context.region;
  $('region-name').style.fontSize='13px';
  e.intro.replaceChildren(...copy[context.weather].map(line=>{const span=document.createElement('span');span.textContent=line;return span;}));
  e.effects.dataset.weather=context.weather;
 }
 elapsed=0;started=true;render(0,media.matches||motionEnded||performance.now()>=motionDeadline);resume();
}
window.ActifedBanner=Object.freeze({
 version:'1.0.0-hybrid-zip',
 getState:()=>Object.freeze({build:'1.0.0-hybrid-zip',accuracyMeters:context.accuracyMeters??null,accuracyLimitMeters:window.ActifedWeather.config.maxAccuracyMeters,locationSamples:context.locationSamples||0,regionField:context.regionField||null,regionLookupSource:context.regionLookupSource||null,status:context.status,weather:context.weather,region:context.region,reason:context.reason,isDay:context.isDay,nightAsset:context.weather==='cerah'&&context.isDay===false?'cerah':null,elapsedSeconds:Math.round(elapsed*100)/100,scene:phase,motionEnded:motionEnded,reducedMotion:media.matches})
});
// Request browser permission on load. There is deliberately no IP lookup or simulated data path.
const request=window.ActifedWeather.resolve();
const visuals=Promise.all([waitImage(e.green),waitImage(e.red),waitImage(e.copy),waitImage(e.cta),waitImage($('brand')),
 Promise.race([document.fonts?document.fonts.ready:Promise.resolve(),new Promise(resolve=>setTimeout(resolve,1500))])]);
Promise.all([request,visuals]).then(([result])=>apply(result)).catch(()=>apply({weather:'fallback',region:'',status:'fallback',reason:'initialization-failed',isDay:null}));
})();
