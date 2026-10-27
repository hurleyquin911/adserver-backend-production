/* Client concept review. Hybrid placement integration remains pending. */
window.ACTIFED_CONFIG = Object.assign({
  deliveryMode: 'preview',
  landingUrl: 'https://www.halodoc.com/obat-dan-vitamin/actifed-plus-cough-supressant-sirup-60-ml-merah?srsltid=AU7gw4WsmyEVBPmJPOTQUSIcjDfjj7IDHqqZ0cCI9e_9invzjL8KUlOB',
  trackedClickUrl: '',
  resultDisplayMs: 3000,
  autoShowProduct: true,
  motionDurationMs: 30000,
  endOnResult: true
}, window.ACTIFED_CONFIG || {});

;
(function () {
  'use strict';
  var config = window.ACTIFED_CONFIG;
  var zones = document.querySelectorAll('[data-exit]');
  function report(message) {
    window.dispatchEvent(new CustomEvent('actifed:delivery-error', {detail: {message: message}}));
  }
  function safeUrl(value) {
    try { return new URL(value).protocol === 'https:'; } catch (_) { return false; }
  }
  zones.forEach(function (zone) {
    zone.href = config.deliveryMode === 'preview' ? config.landingUrl : '#';
    zone.addEventListener('click', function (event) {
      if (config.deliveryMode === 'preview' && safeUrl(config.landingUrl)) return;
      event.preventDefault();
      if (config.deliveryMode !== 'mraid') { report('Delivery mode is not configured.'); return; }
      var api = window.mraid;
      if (!api || typeof api.open !== 'function' || typeof api.getState !== 'function' || api.getState() === 'loading') {
        report('MRAID is not ready.'); return;
      }
      var url = config.trackedClickUrl;
      if (!safeUrl(url) || /%%|\{\{/.test(url)) { report('A resolved Hybrid click URL is required.'); return; }
      api.open(url);
    });
  });
}());

;
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var config = window.ACTIFED_CONFIG;
  var banner = $('banner'), messages = $('messages'), choices = $('choices'), input = $('message-input'), send = $('send');
  var questions = [
    {text:'Saat batuk, ada dahak atau lendir?', options:['Ada','Tidak ada'], ack:'Oke, saya catat.'},
    {text:'Apa yang kamu rasakan di tenggorokan?', options:['Ada lendir','Gatal atau kering'], ack:'Baik. Satu pertanyaan lagi.'},
    {text:'Setelah batuk, apa rasanya?', options:['Dahak terasa keluar atau naik','Tetap tidak ada dahak'], ack:'Oke, saya sudah memahami gejalanya.'}
  ];
  var results = {
    green:{type:'batuk berdahak',intro:'Untuk membantu meringankan pilek dan batuk berdahak, kamu bisa memilih:',name:'Actifed Plus Expectorant',label:'Kemasan HIJAU 🟢',benefit:'Membantu meringankan pilek dan batuk berdahak.'},
    red:{type:'batuk kering',intro:'Untuk membantu meringankan pilek dan batuk gatal atau kering, kamu bisa memilih:',name:'Actifed Plus Cough Suppressant',label:'Kemasan MERAH 🔴',benefit:'Membantu meringankan pilek dan batuk gatal dan kering.'}
  };
  var state = {phase:'chat',question:0,answers:[],selected:null,busy:false,result:null,frontProduct:null,motionEnded:false};
  var autoTimer = 0, stopTimer = 0, frame = 0, startedAt = null, latestElapsed = 0;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var duration = Math.min(30000, Math.max(0, Number(config.motionDurationMs) || 30000));
  var productElements = {green:$('product-green'),red:$('product-red')};
  function snapshot() {
    return {version:'0.3.0-review',phase:state.phase,question:Math.min(3,state.question+1),answers:state.answers.slice(),result:state.result,frontProduct:state.frontProduct,motionEnded:state.motionEnded,elapsedSeconds:Math.round(latestElapsed*100)/100,deliveryMode:config.deliveryMode};
  }
  function notify() {
    banner.dataset.phase = state.phase;
    window.dispatchEvent(new CustomEvent('actifed:state',{detail:snapshot()}));
    if(window.parent !== window) window.parent.postMessage({type:'actifed-preview-state',state:snapshot()},location.origin === 'null' ? '*' : location.origin);
  }
  function timeText() { return new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',hour12:false}).replace('.',':'); }
  function scrollLatest() { messages.scrollTop = messages.scrollHeight; }
  function bubble(role, paragraphs) {
    var el = document.createElement('div'); el.className = 'bubble '+role;
    paragraphs.forEach(function(text){var p=document.createElement('p');p.textContent=text;el.appendChild(p);});
    var meta=document.createElement('div');meta.className='message-meta';meta.setAttribute('aria-hidden','true');meta.textContent=timeText();
    if(role==='user'){var ticks=document.createElement('span');ticks.className='ticks';ticks.textContent='✓✓';meta.appendChild(ticks);}
    el.appendChild(meta);messages.appendChild(el);scrollLatest();return el;
  }
  function wait(ms) { return new Promise(function(resolve){setTimeout(resolve,ms);}); }
  async function reply(text) {
    var typing=document.createElement('div');typing.className='bubble bot typing';typing.setAttribute('aria-hidden','true');
    for(var i=0;i<3;i++)typing.appendChild(document.createElement('i'));
    messages.appendChild(typing);scrollLatest();await wait(450);typing.remove();bubble('bot',[text]);
  }
  function renderChoices() {
    choices.querySelectorAll('button').forEach(function(b){b.remove();});
    var q=questions[state.question];
    q.options.forEach(function(label,index){
      var button=document.createElement('button');button.type='button';button.className='choice';button.textContent=label;button.dataset.answer=String(index);button.setAttribute('aria-pressed','false');
      button.addEventListener('click',function(){
        if(state.busy || state.phase!=='chat')return;
        state.selected=index;input.value=label;send.disabled=false;
        choices.querySelectorAll('button').forEach(function(b){b.setAttribute('aria-pressed',String(b===button));});
      });
      choices.appendChild(button);
    });
    $('progress').textContent=(state.question+1)+' / 3';$('progress').setAttribute('aria-label','Pertanyaan '+(state.question+1)+' dari 3');
    state.selected=null;input.value='';send.disabled=true;scrollLatest();
  }
  $('send').addEventListener('click',async function(event){
    event.preventDefault();event.stopPropagation();
    if(state.phase!=='chat'||state.busy||state.selected===null)return;
    state.busy=true;var chosen=state.selected,q=questions[state.question];state.answers.push(chosen===0?'green':'red');
    choices.querySelectorAll('button').forEach(function(b){b.disabled=true;});send.disabled=true;input.value='';
    bubble('user',[q.options[chosen]]);notify();
    await reply(q.ack);await wait(300);
    if(state.question<2){state.question++;bubble('bot',[questions[state.question].text]);state.busy=false;renderChoices();notify();}
    else {showResult();}
  });
  function showResult() {
    state.phase='result';state.busy=false;state.result=state.answers.filter(function(a){return a==='green';}).length>=2?'green':'red';
    var r=results[state.result],copy=$('result-copy');
    messages.hidden=true;$('composer').hidden=true;$('progress').textContent='Hasil';$('progress').setAttribute('aria-label','Hasil konsultasi');
    $('chat-title').textContent='Hasil konsultasi';
    var conclusion=document.createElement('p');conclusion.appendChild(document.createTextNode('Dari jawabanmu, batukmu '));
    var strong=document.createElement('strong');strong.textContent='lebih mengarah ke '+r.type;conclusion.appendChild(strong);conclusion.appendChild(document.createTextNode('.'));copy.appendChild(conclusion);
    var intro=document.createElement('p');intro.textContent=r.intro;copy.appendChild(intro);
    var name=document.createElement('h2');name.textContent=r.name;copy.appendChild(name);
    var label=document.createElement('p');label.className='result-label';label.textContent=r.label;copy.appendChild(label);
    var benefit=document.createElement('p');benefit.textContent=r.benefit;copy.appendChild(benefit);
    $('result-panel').dataset.result=state.result;$('result-panel').hidden=false;
    $('result-panel').focus({preventScroll:true});notify();
    if(config.autoShowProduct)autoTimer=setTimeout(showProduct,Math.max(0,Number(config.resultDisplayMs)||3000));
  }
  var clamp=function(n){return Math.max(0,Math.min(1,n));};
  var smooth=function(n){n=clamp(n);return n*n*(3-2*n);};
  function opacity(el,n){el.style.opacity=String(clamp(n));}
  function pose(color,alpha,x,y,scale,rotate,z){
    var el=productElements[color];opacity(el,alpha);el.style.transform='perspective(700px) translate3d('+x.toFixed(2)+'px,'+y.toFixed(2)+'px,0) scale('+scale.toFixed(4)+') rotateY('+rotate.toFixed(2)+'deg)';el.style.zIndex=String(z);
  }
  function stable(color){var other=color==='green'?'red':'green';pose(color,1,0,0,1,0,3);pose(other,0,0,0,.68,0,2);return color;}
  function exchange(t) {
    var first=state.result,second=first==='green'?'red':'green';
    if(config.endOnResult && t>=29)return stable(first);
    if(t<.85){var p=1-Math.pow(1-clamp(t/.85),3);pose(first,p,0,14*(1-p),.94+.06*p,0,3);pose(second,0,0,0,.68,0,2);return first;}
    if(t<5)return stable(first);
    var cycle=Math.floor((t-5)/4),local=(t-5)%4,outgoing=cycle%2===0?first:second,incoming=cycle%2===0?second:first;
    if(local<.9){var p=smooth(local/.9),arc=Math.sin(Math.PI*p);pose(outgoing,1-smooth((p-.6)/.4),-42*arc,-14*arc,1-.32*p,28*p,p<.5?3:2);pose(incoming,smooth(p/.28),42*arc,12*arc,.68+.32*p,-28*(1-p),p<.5?2:3);return p<.5?outgoing:incoming;}
    return stable(incoming);
  }
  function render(t,still) {
    var fade=still?1:smooth((t-.9)/1.1);
    opacity($('chat-backdrop'),1-fade);opacity($('brand-header'),1-fade);
    opacity($('main-copy'),still?1:smooth(t/.6));opacity($('product-cta'),still?1:smooth((t-.25)/.6));
    var next=still?stable(config.endOnResult?state.result:(state.frontProduct||state.result)):exchange(t);
    Object.keys(productElements).forEach(function(color){productElements[color].setAttribute('aria-hidden',String(color!==next));});
    if(state.frontProduct!==next){state.frontProduct=next;notify();}
  }
  function finishMotion() {
    if(state.phase!=='product'||state.motionEnded)return;
    state.motionEnded=true;latestElapsed=Math.min(duration,Math.max(0,performance.now()-startedAt))/1000;clearTimeout(stopTimer);cancelAnimationFrame(frame);frame=0;
    render(latestElapsed,true);banner.dataset.motionEnded='true';notify();
  }
  function tick(now) {
    frame=0;if(state.motionEnded||state.phase!=='product')return;
    latestElapsed=Math.min(duration,Math.max(0,now-startedAt))/1000;
    if(now-startedAt>=duration){finishMotion();return;}
    render(latestElapsed,false);if(!document.hidden)frame=requestAnimationFrame(tick);
  }
  function showProduct() {
    if(state.phase!=='result')return;
    clearTimeout(autoTimer);state.phase='product';startedAt=performance.now();latestElapsed=0;
    $('consultation').hidden=true;$('product-scene').hidden=false;$('product-scene').setAttribute('aria-hidden','false');
    $('exit-top').hidden=true;$('exit-bottom').hidden=true;$('exit-product').hidden=false;
    $('exit-product').focus({preventScroll:true});notify();render(0,false);
    if(reduced.matches){finishMotion();return;}
    stopTimer=setTimeout(finishMotion,duration);frame=requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange',function(){
    if(state.phase!=='product'||state.motionEnded)return;
    cancelAnimationFrame(frame);frame=0;
    if(performance.now()-startedAt>=duration){finishMotion();return;}
    if(!document.hidden)frame=requestAnimationFrame(tick);
  });
  function motionPreference(){if(reduced.matches&&state.phase==='product')finishMotion();}
  if(reduced.addEventListener)reduced.addEventListener('change',motionPreference);else reduced.addListener(motionPreference);
  function size(){banner.style.setProperty('--banner-scale',Math.min(1,innerWidth/320,innerHeight/480));}
  window.addEventListener('resize',size);size();
  window.ActifedBanner=Object.freeze({getState:snapshot});
  var greeting=bubble('bot',['Selamat datang di Konsultasi Batuk Actifed 👋','Saya bantu kenali jenis batukmu lewat 3 pertanyaan singkat.']);
  greeting.querySelector('p').replaceChildren(document.createTextNode('Selamat datang di '));
  var greetingName=document.createElement('strong');greetingName.textContent='Konsultasi Batuk Actifed\u00a0👋';greeting.querySelector('p').appendChild(greetingName);
  bubble('bot',[questions[0].text]);renderChoices();messages.scrollTop=0;notify();
}());
