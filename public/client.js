import {io} from './vendor/socket.io.esm.min.js';
import {analyzeMoveLogic,validateConfig,DEFAULT_CONFIG,Card,RANKS,SUITS,topRun} from './shared/game.js';
import {makeCard,cardName} from './cards.js';
import {unlockAudio,playSound} from './audio.js';

const $=id=>document.getElementById(id);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const write=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
const prefs={back:'noir',motion:'auto',simple:false,sound:false,volume:40,sort:'dealt',...read('daketi:preferences',{})};
if(!['noir','ruby','classic'].includes(prefs.back))prefs.back='noir';
let state=null,myId=-1,selected=null,connected=false,pending=false,animating=false,queue=Promise.resolve(),queuedState=null,privateEnabled=false,summaryRound=-1,sessionConflict=false;
let scoreClicks=0,clickTimer,bannerTimer;
let reconnectStarted=Date.now(),noticeTimer;
const media=matchMedia('(prefers-reduced-motion: reduce)');
const reduced=()=>prefs.motion==='reduced'||(prefs.motion==='auto'&&media.matches);
const apiUrl=String(window.DAKETI_CONFIG?.apiUrl||'').replace(/\/$/,'');
const socket=io(apiUrl||undefined,{autoConnect:false,auth:{sessionToken:read('daketi:session',null)},reconnection:true,reconnectionDelay:1000,reconnectionDelayMax:8000,timeout:15000});
const nameInput=$('player-name');nameInput.value=read('daketi:name','');
const savedConfig={...DEFAULT_CONFIG,...read('daketi:config',{})};
for(const [id,key]of [['players','numPlayers'],['hand-size','handSize'],['face-size','faceUpSize'],['difficulty','difficulty']])$(id).value=savedConfig[key];

function node(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
function toast(text,error=false){const n=node('div',`toast${error?' error':''}`,text);$('toasts').append(n);setTimeout(()=>n.remove(),3600);}
function banner(text){$('move-banner').textContent=text;$('move-banner').classList.add('show');clearTimeout(bannerTimer);bannerTimer=setTimeout(()=>$('move-banner').classList.remove('show'),2000);}
function dialog(id){const d=$(id);if(!d.open)d.showModal();}
function showPage(id){for(const page of ['home','waiting','game'])$(page).hidden=page!==id;document.body.classList.toggle('at-table',id==='game');}
function connection(text,kind){
  $('connection').className=`connection ${kind||''}`;$('connection').querySelector('span').textContent=text;$('connection').title=text;
  if(kind==='online'){clearInterval(noticeTimer);noticeTimer=null;$('connection-notice').hidden=true;reconnectStarted=Date.now();}
  else if(!noticeTimer){reconnectStarted=Date.now();noticeTimer=setInterval(()=>{
    const seconds=Math.floor((Date.now()-reconnectStarted)/1000);if(seconds<4)return;
    $('connection-notice').hidden=false;$('connection-notice-title').textContent=state?'Reconnecting to your table.':'The table is waking up.';
    $('connection-notice-detail').textContent=state?`Your seat is held briefly. We’ll reconnect automatically. · ${seconds}s`:`We’ll connect automatically. This can take about a minute. · ${seconds}s`;
  },1000);}
}
function applyPreferences(){
  document.body.classList.toggle('simple',!!prefs.simple);document.body.classList.toggle('reduced',reduced());
  $('card-back').value=prefs.back;$('motion-setting').value=prefs.motion;$('simple-setting').checked=!!prefs.simple;$('sound-setting').checked=!!prefs.sound;$('volume-setting').value=prefs.volume;$('hand-sort').value=prefs.sort;
  $('sound-button').setAttribute('aria-label',prefs.sound?'Mute sound':'Enable sound');$('sound-button').title=prefs.sound?'Mute sound':'Enable sound';$('sound-button').style.color=prefs.sound?'var(--gold-light)':'';
  write('daketi:preferences',prefs);
}
function request(event,payload={}){
  return new Promise((resolve,reject)=>{
    if(!connected){reject(new Error('The table is reconnecting. Please wait.'));return;}
    socket.timeout(8000).emit(event,payload,(error,result)=>{
      if(error){reject(new Error('The connection is taking longer than expected. Please try again.'));return;}
      if(!result?.ok){reject(new Error(result?.error||'Please try again.'));return;}
      resolve(result);
    });
  });
}
const me=()=>state?.players.find(p=>p.id===myId);
const isTurn=()=>state?.status==='playing'&&state.currentPlayerIdx===myId;
const canAct=()=>connected&&!pending&&!animating&&isTurn();
function sortedHand(hand=me()?.hand||[]){const list=[...hand];if(prefs.sort==='rank')list.sort((a,b)=>RANKS.indexOf(a.rank)-RANKS.indexOf(b.rank)||SUITS.indexOf(a.suit)-SUITS.indexOf(b.suit));else if(prefs.sort==='suit')list.sort((a,b)=>SUITS.indexOf(a.suit)-SUITS.indexOf(b.suit)||RANKS.indexOf(a.rank)-RANKS.indexOf(b.rank));return list;}

function renderPile(element,player){
  element.replaceChildren();element.classList.toggle('has-cards',player.pile.length>0);element.classList.remove('capture-target');
  element.setAttribute('aria-label',`${player.id===myId?'Your':player.name+'’s'} pile: ${player.pile.length} cards, ${player.score} points. Inspect pile.`);
  if(!player.pile.length){element.append(node('span','empty-pile','◇'));return;}
  element.append(makeCard(player.pile.at(-1),{back:prefs.back}));element.append(node('span','count-badge',player.pile.length));
  const run=topRun(player.pile);if(run.length>1)element.append(node('span','run-badge',`${run.length} × ${run[0].rank}`));
}
function renderOpponents(){
  const players=state.players.filter(p=>p.id!==myId),zone=$('opponents');
  const positions={1:[[50,1]],2:[[32,1],[68,1]],3:[[14,37],[50,1],[86,37]],4:[[10,48],[35,1],[65,1],[90,48]],5:[[8,51],[27,2],[50,0],[73,2],[92,51]]}[players.length];
  const existing=new Map([...zone.children].map(n=>[Number(n.dataset.pid),n]));
  players.forEach((p,index)=>{
    let seat=existing.get(p.id);
    if(!seat){seat=node('div','opponent');seat.id=`seat-${p.id}`;seat.dataset.pid=p.id;seat.append(node('div','avatar'),node('div','opponent-name'),node('div','opponent-info'));const pile=node('button','pile-button');pile.type='button';pile.id=`pile-${p.id}`;pile.onclick=()=>showPile(state.players.find(o=>o.id===p.id));seat.append(pile);}
    seat.classList.toggle('active',state.status==='playing'&&p.id===state.currentPlayerIdx);seat.style.left=`${positions[index][0]}%`;seat.style.top=`${positions[index][1]}%`;
    const avatar=seat.querySelector('.avatar');avatar.textContent=p.isBot?'◇':p.name.slice(0,2).toUpperCase();avatar.classList.toggle('bot',p.isBot);avatar.title=p.isBot?(p.reserved?'Bot covering a disconnected player':'Bot'):p.name;
    seat.querySelector('.opponent-name').textContent=p.name;
    const info=seat.querySelector('.opponent-info');info.replaceChildren(node('span','hand-count',`${p.handCount} cards · `),node('span','opponent-score',`${p.score} pts`));
    renderPile(seat.querySelector('.pile-button'),p);zone.append(seat);existing.delete(p.id);
  });
  for(const old of existing.values())old.remove();
}
function reconcileCards(parent,cards,interactive){
  const existing=new Map([...parent.children].map(n=>[n.dataset.cardId,n]));
  for(const card of cards){let element=existing.get(card.id);if(!element){element=makeCard(card,{interactive,back:prefs.back});if(interactive)element.onclick=()=>selectCard(card.id);}
    element.style.opacity='';parent.append(element);existing.delete(card.id);
  }
  for(const old of existing.values())old.remove();
}
function fitHand(){
  const hand=$('hand'),cards=[...hand.children];if(!cards.length)return;
  const width=cards[0].getBoundingClientRect().width,available=hand.clientWidth-28;
  const overlap=Math.min(0,(available-width*cards.length-4*(cards.length-1))/Math.max(1,cards.length-1));
  // Keep every corner readable; larger hands scroll when this minimum is reached.
  const margin=Math.max(-width*.52,overlap);
  cards.forEach((c,i)=>{const relative=i-(cards.length-1)/2;c.style.setProperty('--overlap',`${margin}px`);c.style.setProperty('--angle',`${reduced()?0:relative*Math.min(1.3,6/cards.length)}deg`);c.style.setProperty('--arc',`${reduced()?0:Math.abs(relative)*.6}px`);c.style.setProperty('--order',i+1);});
  hand.style.justifyContent=margin===overlap?'center':'flex-start';
}
function renderHand(){
  if(!state||!me())return;
  const cards=sortedHand();reconcileCards($('hand'),cards,true);
  if(selected&&!cards.some(c=>c.id===selected))selected=null;
  [...$('hand').children].forEach((c,i)=>{c.disabled=!canAct()||state.turnPhase!=='PLAY';c.classList.toggle('selected',c.dataset.cardId===selected);c.setAttribute('aria-pressed',String(c.dataset.cardId===selected));c.tabIndex=selected?(c.dataset.cardId===selected?0:-1):i===0?0:-1;});
  $('hand-label').textContent=`YOUR HAND · ${cards.length}`;requestAnimationFrame(fitHand);
}
function renderControls(){
  if(!state)return;
  const myTurn=isTurn(),playing=state.status==='playing',card=me()?.hand?.find(c=>c.id===selected);
  const analysis=card?analyzeMoveLogic(state.faceUpCards,state.players,myId,card):null;
  $('draw-button').hidden=!myTurn||state.turnPhase!=='DRAW';$('capture-button').hidden=!myTurn||state.turnPhase!=='PLAY'||!analysis?.canCapture;$('discard-button').hidden=!myTurn||state.turnPhase!=='PLAY'||!card;
  for(const id of ['draw-button','capture-button','discard-button'])$(id).disabled=!canAct();
  $('deck-button').disabled=!canAct()||state.turnPhase!=='DRAW';$('deck-button').classList.toggle('available',canAct()&&state.turnPhase==='DRAW');
  for(const element of document.querySelectorAll('.capture-target'))element.classList.remove('capture-target');
  if(analysis?.canCapture){for(const c of analysis.tableMatch)$('table-cards').querySelector(`[data-card-id="${c.id}"]`)?.classList.add('capture-target');for(const t of analysis.stealTargets)$(t.id===myId?'my-pile':`pile-${t.id}`)?.classList.add('capture-target');if(analysis.selfMatch)$('my-pile').classList.add('capture-target');}
  let preview;
  if(!connected)preview='Reconnecting to your table…';else if(animating||pending)preview='Making the move…';else if(!playing)preview='The round is complete. Ready for another?';else if(!myTurn)preview=`${state.players[state.currentPlayerIdx].name} is making a move.`;else if(state.turnPhase==='DRAW')preview='Draw a card. See what the table has to offer.';else if(!card)preview=state.deckCount?'Choose a card to capture or discard.':'The deck is empty. Choose a card to play.';else if(analysis.canCapture){const stolen=analysis.stealTargets.reduce((n,t)=>n+t.cards.length,0);preview=`${analysis.tableMatch.length?`Capture ${analysis.tableMatch.length} · `:''}${stolen?`Steal ${stolen} · `:''}${analysis.selfMatch&&!stolen&&!analysis.tableMatch.length?'Build your stack · ':''}+${analysis.gain} points${state.deckCount?' · Another turn':''}`;}else preview=`No match for ${card.rank}${card.suit}. Discard to pass the turn.`;
  $('move-preview').textContent=preview;
  $('results-button').hidden=state.status!=='finished';
  $('turn-status').textContent=!connected?'Reconnecting…':!playing?'Round complete':myTurn?(state.turnPhase==='DRAW'?'Your turn · Draw':'Your turn · Play'):`${state.players[state.currentPlayerIdx].name}’s turn`;
  $('turn-status').style.color=myTurn?'var(--gold-light)':'';
}
function renderWaiting(){
  showPage('waiting');$('waiting-code').textContent=state.roomCode;
  $('waiting-settings').textContent=`${state.config.numPlayers} seats · ${state.config.handSize} cards each · ${state.config.faceUpSize} on the table · ${({easy:'Easygoing',medium:'Street smart',hard:'Mastermind'})[state.config.difficulty]} bots`;
  const seats=$('waiting-seats');seats.replaceChildren();
  for(const p of state.players){const row=node('div','waiting-seat'),avatar=node('div',`avatar${p.isBot?' bot':''}`,p.isBot?'◇':p.name.slice(0,2).toUpperCase()),label=node('div','seat-name',p.reserved?p.name:`Seat ${p.id+1}`);
    label.append(node('small','',p.id===state.hostId?'Host':p.reserved?(p.connected?'At the table':'Reconnecting · seat reserved'):'Open to friends · bot if unclaimed'));
    row.append(avatar,label,node('span',`ready-pill${p.reserved&&!p.ready?' waiting':''}`,!p.reserved?'Bot':!p.connected?'Away':p.ready?'Ready':'Getting ready'));seats.append(row);
  }
  const host=state.hostId===myId;$('start-button').hidden=!host;$('ready-button').hidden=host;
  $('start-button').disabled=!connected||state.players.some(p=>p.reserved&&(!p.ready||!p.connected));$('ready-button').disabled=!connected;
  $('ready-button').textContent=me().ready?'Ready ✓ · Tap to change':'I’m ready ✓';
  const humans=state.players.filter(p=>p.reserved).length;
  $('ready-note').textContent=host?(humans===1?'Play with bots now, or invite friends to fill the open seats.':'Start when everyone is connected and ready.'):'The host will deal when everyone is ready.';
}
function renderGame(){
  showPage('game');$('round-label').textContent=`ROUND ${String(state.round).padStart(2,'0')}`;$('game-code').replaceChildren(document.createTextNode(state.roomCode+' '),node('span','','↗'));
  $('deck-art').replaceChildren(makeCard(null,{back:prefs.back}));$('deck-count').textContent=state.deckCount;$('deck-button').classList.toggle('empty',!state.deckCount);
  renderOpponents();reconcileCards($('table-cards'),state.faceUpCards,false);$('table-count').textContent=`${state.faceUpCards.length} CARDS`;$('empty-table').hidden=state.faceUpCards.length>0;
  renderPile($('my-pile'),me());$('my-score').textContent=me().score;$('my-score').setAttribute('aria-label',`Your score: ${me().score}`);$('my-name').textContent=me().name;
  renderHand();renderControls();$('last-move').textContent=state.log.at(-1)?.text||'The table is ready.';
  if(state.status==='finished')renderSummary();
}
function render(){if(!state)return;state.status==='waiting'?renderWaiting():renderGame();}
function acceptState(next,{force=false}={}){
  if(!next||(!force&&state&&next.roomCode===state.roomCode&&next.version<state.version))return;
  if(animating&&!force){if(!queuedState||queuedState.version<=next.version)queuedState=next;return;}
  state=next;render();
}
function selectCard(id){if(!canAct()||state.turnPhase!=='PLAY')return;selected=selected===id?null:id;playSound('select',prefs);renderHand();renderControls();}
async function action(type){
  if(!canAct())return;unlockAudio();pending=true;renderHand();renderControls();
  try{await request('action',{type,cardId:selected,version:state.version});}
  catch(error){toast(error.message,true);if(connected)socket.emit('sync',{},()=>{});}
  finally{pending=false;renderHand();renderControls();}
}

function center(element){if(!element)return null;const r=element.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height};}
async function fly(card,from,to,{duration=330,delay=0,face=true}={}){
  if(reduced()||!from||!to)return;
  const a=center(from),b=center(to);if(!a||!b)return;
  const w=Math.min(76,Math.max(35,a.w)),h=w*100/72,element=makeCard(face?card:null,{back:prefs.back,className:'flying-card'});
  Object.assign(element.style,{left:'0px',top:'0px',width:`${w}px`,height:`${h}px`});document.body.append(element);
  element.setAttribute('aria-hidden','true');
  const start=`translate(${a.x-w/2}px,${a.y-h/2}px) rotate(-5deg)`,end=`translate(${b.x-w/2}px,${b.y-h/2}px) rotate(0deg)`;
  const middle=`translate(${(a.x+b.x)/2-w/2}px,${(a.y+b.y)/2-h/2-Math.min(28,Math.abs(a.x-b.x)*.08)}px) rotate(3deg)`;
  try{await element.animate([{transform:start,opacity:.9},{transform:middle,opacity:1,offset:.5},{transform:end,opacity:1}],{duration,delay,easing:'cubic-bezier(.2,.65,.25,1)',fill:'both'}).finished;}catch{}finally{element.remove();}
}
const pileFor=id=>$(id===myId?'my-pile':`pile-${id}`);
const handFor=id=>id===myId?$('hand'):$(`seat-${id}`)?.querySelector('.avatar');
function floatScore(change){
  if(reduced())return;const target=change.playerId===myId?$('my-score'):$(`seat-${change.playerId}`);const c=center(target);if(!c)return;
  const n=node('span',`score-float${change.points<0?' negative':''}`,`${change.points>0?'+':''}${change.points}`);n.style.left=`${c.x}px`;n.style.top=`${c.y}px`;document.body.append(n);
  n.animate([{transform:'translate(-50%,0)',opacity:1},{transform:'translate(-50%,-32px)',opacity:0}],{duration:850,easing:'ease-out'}).finished.finally(()=>n.remove());
}
function animateNumber(element,from,to,suffix=''){
  if(reduced()||from===to){element.textContent=`${to}${suffix}`;return;}
  const start=performance.now();const tick=now=>{const progress=Math.min(1,(now-start)/330);element.textContent=`${Math.round(from+(to-from)*(1-(1-progress)**3))}${suffix}`;if(progress<1&&element.isConnected)requestAnimationFrame(tick);};requestAnimationFrame(tick);
}
async function animateMove(event,next){
  if(!state||state.roomCode!==next.roomCode||next.version<=state.version)return;
  if(!state||state.roomCode!==next.roomCode||state.round!==event.round){acceptState(next);return;}
  const before=state,started=performance.now();animating=true;renderHand();renderControls();
  const duration=Math.min(350,event.duration*.76);
  try{
    if(event.type==='DRAW'){
      playSound('draw',prefs);await fly(event.card,$('deck-button'),handFor(event.playerId),{duration,face:false});
    }else{
      const source=event.playerId===myId?$(`hand`).querySelector(`[data-card-id="${event.card.id}"]`):handFor(event.playerId);
      if(event.type==='DISCARD'){playSound('discard',prefs);if(event.playerId===myId&&source)source.style.opacity='0';await fly(event.card,source,$('table-cards').children.length?$('table-cards'):$('empty-table'),{duration});}
      else{
        playSound(event.analysis.stealTargets.length?'steal':'capture',prefs);const flights=[];
        if(source&&event.playerId===myId)source.style.opacity='0';flights.push(fly(event.card,source,pileFor(event.playerId),{duration}));
        for(const card of event.analysis.tableMatch){const element=$('table-cards').querySelector(`[data-card-id="${card.id}"]`);if(element){element.style.opacity='0';flights.push(fly(card,element,pileFor(event.playerId),{duration,delay:25*flights.length}));}}
        for(const target of event.analysis.stealTargets)for(const card of target.cards)flights.push(fly(card,pileFor(target.id),pileFor(event.playerId),{duration,delay:20*flights.length}));
        await Promise.all(flights);
      }
    }
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,event.duration-(performance.now()-started))));
  }finally{
    if(!state||state.roomCode!==before.roomCode){animating=false;return;}
    animating=false;selected=null;acceptState(next,{force:true});
    if(queuedState){const queued=queuedState;queuedState=null;acceptState(queued);}
    for(const change of event.scoreChanges){floatScore(change);const element=change.playerId===myId?$('my-score'):$(`seat-${change.playerId}`)?.querySelector('.opponent-score');const old=before.players.find(p=>p.id===change.playerId)?.score;const target=state.players.find(p=>p.id===change.playerId)?.score;if(element)animateNumber(element,old,target,change.playerId===myId?'':' pts');}
    if(event.type==='DRAW'&&event.playerId===myId&&!reduced()){const c=$('hand').querySelector(`[data-card-id="${event.card.id}"]`);c?.animate([{transform:'rotateY(80deg)',opacity:.4},{transform:'rotateY(0deg)',opacity:1}],{duration:120,easing:'ease-out'});}
    if(event.extraTurn)banner(event.playerId===myId?'A good take. Your turn again.':`${state.players[event.playerId].name} plays again.`);
    $('announcer').textContent=state.log.at(-1)?.text||'';
  }
}
async function animateDeal(next){
  summaryRound=-1;selected=null;for(const d of document.querySelectorAll('dialog[open]'))d.close();acceptState(next,{force:true});
  if(reduced())return;
  animating=true;renderHand();renderControls();playSound('draw',prefs);
  try{const flights=[];let delay=0;for(let n=0;n<next.config.handSize;n++)for(const p of next.players){const card=p.id===myId?p.hand[n]:null;const destination=p.id===myId?$('hand').querySelector(`[data-card-id="${card.id}"]`):handFor(p.id);flights.push(fly(card,$('deck-button'),destination,{duration:210,delay,face:p.id===myId}));delay+=10;}await Promise.all(flights);}finally{animating=false;if(queuedState){const s=queuedState;queuedState=null;acceptState(s);}renderHand();renderControls();}
}

function showPile(player){if(!player)return;const run=topRun(player.pile);$('pile-heading').textContent=player.id===myId?'YOUR STACK':`${player.name.toUpperCase()}’S STACK`;$('pile-title').textContent=player.pile.length?'A well-earned collection.':'An opportunity awaits.';$('pile-description').textContent=`${player.pile.length} cards · ${player.score} points${run.length?` · ${run.length} ${run[0].rank}${run.length>1?'s':''} at the top can be stolen`:''}.`;$('pile-grid').replaceChildren(...player.pile.map(c=>makeCard(c,{back:prefs.back})));dialog('pile-dialog');}
function celebrate(){
  if(reduced()||prefs.simple)return;
  for(let i=0;i<30;i++){const n=node('div','confetti');n.style.left=`${15+Math.random()*70}vw`;n.style.top='-10px';n.style.background=['#d5b578','#83b89b','#e8e0c8'][i%3];document.body.append(n);n.animate([{transform:`translate(0,0) rotate(0deg)`,opacity:1},{transform:`translate(${Math.random()*160-80}px,${innerHeight+20}px) rotate(${Math.random()*500}deg)`,opacity:0}],{duration:1100+Math.random()*550,delay:Math.random()*250,easing:'ease-in'}).finished.finally(()=>n.remove());}
}
function renderSummary(){
  const ranked=[...state.players].sort((a,b)=>b.score-a.score||a.id-b.id),maximum=ranked[0].score,winners=ranked.filter(p=>p.score===maximum),won=winners.some(p=>p.id===myId);
  $('winner-title').textContent=winners.length>1?'A shared victory.':won?'You took the table.':`${winners[0].name} takes the table.`;
  $('winner-subtitle').textContent=winners.length>1?`${winners.map(p=>p.name).join(' & ')} finish on ${maximum} points.`:`Round ${state.round} · ${maximum} winning points · Well played.`;
  $('summary-list').replaceChildren();let position=0,prior=-1;
  ranked.forEach((p,index)=>{if(p.score!==prior)position=index+1;prior=p.score;const row=node('div','summary-row'),label=node('div','summary-name',`${p.name}${p.id===myId?' · You':''}`);label.append(node('small','',`${p.pile.length} cards · ${p.totals.wins} win${p.totals.wins===1?'':'s'} · ${p.totals.points} total points`));row.append(node('span','summary-rank',String(position).padStart(2,'0')),node('span','avatar',p.isBot?'◇':p.name.slice(0,2).toUpperCase()),label,node('span','summary-points',String(p.score)));$('summary-list').append(row);});
  const stats=me().stats;$('summary-stats').replaceChildren();for(const [value,label]of [[stats.captured,'Cards captured'],[stats.stolen,'Cards stolen'],[stats.longestChain,'Best chain']]){const item=node('div');item.append(node('b','',value),node('span','',label));$('summary-stats').append(item);}
  const waiting=state.players.filter(p=>p.reserved&&!p.rematch);$('rematch-button').disabled=!connected||me().rematch;$('rematch-button').textContent=me().rematch?'Ready for the next round ✓':'Another round ↗';$('rematch-note').textContent=me().rematch?`Waiting for ${waiting.map(p=>p.name).join(', ')||'the next deal'}…`:'Everyone at the table gets a rematch vote.';
  if(summaryRound!==state.round){summaryRound=state.round;dialog('summary-dialog');playSound('win',prefs);celebrate();}
}
async function copyText(text){try{await navigator.clipboard.writeText(text);toast('Copied. Bring some company.');}catch{toast(text);}}
async function setPrivate(enabled,strength=$('private-strength').value){
  try{const result=await request('privateMode',{enabled,strength});privateEnabled=result.enabled;$('private-settings').hidden=!privateEnabled&&$('private-settings').hidden;$('private-toggle').checked=privateEnabled;$('private-strength').value=result.strength;return result;}catch(error){toast(error.message,true);return null;}
}
function updateDealNote(){
  try{const config=validateConfig({numPlayers:$('players').value,handSize:$('hand-size').value,faceUpSize:$('face-size').value,difficulty:$('difficulty').value});const dealt=config.numPlayers*config.handSize+config.faceUpSize;$('deal-note').textContent=`${dealt} cards dealt · ${52-dealt} in the deck`;$('deal-note').classList.remove('invalid');$('create-button').disabled=!connected;}
  catch(error){$('deal-note').textContent=error.message;$('deal-note').classList.add('invalid');$('create-button').disabled=true;}
}

$('create-tab').onclick=()=>{$('create-tab').setAttribute('aria-selected','true');$('join-tab').setAttribute('aria-selected','false');$('create-panel').hidden=false;$('join-panel').hidden=true;};
$('join-tab').onclick=()=>{$('create-tab').setAttribute('aria-selected','false');$('join-tab').setAttribute('aria-selected','true');$('create-panel').hidden=true;$('join-panel').hidden=false;$('room-input').focus();};
for(const id of ['players','hand-size','face-size','difficulty'])$(id).addEventListener('input',updateDealNote);
nameInput.addEventListener('change',()=>write('daketi:name',nameInput.value.trim()));
$('create-panel').onsubmit=async event=>{event.preventDefault();unlockAudio();$('home-error').textContent='';try{const config=validateConfig({numPlayers:$('players').value,handSize:$('hand-size').value,faceUpSize:$('face-size').value,difficulty:$('difficulty').value});write('daketi:config',config);write('daketi:name',nameInput.value.trim());$('create-button').disabled=true;await request('createRoom',{name:nameInput.value||'Host',config});}catch(error){$('home-error').textContent=error.message;}finally{updateDealNote();}};
$('join-panel').onsubmit=async event=>{event.preventDefault();unlockAudio();$('home-error').textContent='';$('join-button').disabled=true;try{write('daketi:name',nameInput.value.trim());await request('joinRoom',{code:$('room-input').value.trim().toUpperCase(),name:nameInput.value||'Guest'});}catch(error){$('home-error').textContent=error.message;}finally{$('join-button').disabled=!connected;}};
$('start-button').onclick=async()=>{unlockAudio();try{await request('startRound');}catch(error){toast(error.message,true);}};
$('ready-button').onclick=async()=>{try{await request('ready',{ready:!me().ready});}catch(error){toast(error.message,true);}};
$('waiting-code').onclick=() => copyText(state.roomCode);$('game-code').onclick=()=>copyText(state.roomCode);
$('invite-button').onclick=()=>{const url=new URL(location.href);url.searchParams.set('room',state.roomCode);copyText(url.href);};
$('draw-button').onclick=()=>action('DRAW');$('deck-button').onclick=()=>action('DRAW');$('capture-button').onclick=()=>action('CAPTURE');$('discard-button').onclick=()=>action('DISCARD');
$('my-pile').onclick=()=>showPile(me());
$('hand-sort').onchange=()=>{prefs.sort=$('hand-sort').value;applyPreferences();if(state)renderHand();};
$('rules-button').onclick=()=>dialog('rules-dialog');$('settings-button').onclick=()=>dialog('settings-dialog');
$('results-button').onclick=()=>{renderSummary();dialog('summary-dialog');};
$('history-button').onclick=()=>{$('history-list').replaceChildren(...state.log.map(entry=>node('li','',entry.text)));dialog('history-dialog');};
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$(button.dataset.close).close();
for(const d of document.querySelectorAll('dialog'))d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});
for(const id of ['leave-waiting','leave-game','leave-summary'])$(id).onclick=()=>dialog('leave-dialog');
$('confirm-leave').onclick=async()=>{try{await request('leaveRoom');for(const d of document.querySelectorAll('dialog[open]'))d.close();state=null;myId=-1;selected=null;privateEnabled=false;queuedState=null;summaryRound=-1;$('private-settings').hidden=true;history.replaceState(null,'',location.pathname);showPage('home');toast('You left the table.');}catch(error){toast(error.message,true);}};
$('rematch-button').onclick=async()=>{unlockAudio();try{await request('rematch',{ready:true});}catch(error){toast(error.message,true);}};
$('fullscreen-button').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Fullscreen is unavailable on this device.');}};
$('sound-button').onclick=()=>{unlockAudio();prefs.sound=!prefs.sound;applyPreferences();playSound('select',prefs);};
for(const [id,key]of [['card-back','back'],['motion-setting','motion'],['simple-setting','simple'],['sound-setting','sound'],['volume-setting','volume']])$(id).oninput=()=>{unlockAudio();prefs[key]=$(id).type==='checkbox'?$(id).checked:$(id).type==='range'?Number($(id).value):$(id).value;applyPreferences();if(state)render();};
$('private-toggle').onchange=()=>setPrivate($('private-toggle').checked);$('private-strength').onchange=()=>setPrivate(privateEnabled);
$('my-score').onclick=()=>{if(state?.status!=='playing')return;scoreClicks++;clearTimeout(clickTimer);clickTimer=setTimeout(()=>scoreClicks=0,500);if(scoreClicks>=3){scoreClicks=0;setPrivate(!privateEnabled).then(result=>{if(result?.enabled){$('private-settings').hidden=false;toast('Private setting enabled.');}else if(result)toast('Private setting unchanged or disabled.');});}};
media.addEventListener('change',()=>{applyPreferences();if(state)renderHand();});
new ResizeObserver(()=>{if(state&&state.status!=='waiting')fitHand();}).observe($('hand'));
document.addEventListener('keydown',event=>{
  if(document.querySelector('dialog[open]')||event.target.matches('input,select,textarea')||event.ctrlKey||event.metaKey||event.altKey||!isTurn())return;
  const key=event.key.toLowerCase();
  if(key==='arrowleft'||key==='arrowright'){const cards=sortedHand();if(!cards.length||!canAct()||state.turnPhase!=='PLAY')return;event.preventDefault();const current=cards.findIndex(c=>c.id===selected);const i=current<0?(key==='arrowright'?0:cards.length-1):(current+(key==='arrowright'?1:-1)+cards.length)%cards.length;selected=cards[i].id;renderHand();renderControls();$('hand').querySelector(`[data-card-id="${selected}"]`)?.focus();}
  else if(key==='escape'){selected=null;renderHand();renderControls();}
  else if(key==='d'&&state.turnPhase==='DRAW'){event.preventDefault();action('DRAW');}
  else if(key==='x'&&selected){event.preventDefault();action('DISCARD');}
  else if(key==='enter'&&selected&&(!event.target.matches('button')||event.target.closest('#hand'))){event.preventDefault();if(analyzeMoveLogic(state.faceUpCards,state.players,myId,me().hand.find(c=>c.id===selected)).canCapture)action('CAPTURE');}
});
window.addEventListener('beforeunload',event=>{if(state?.status==='playing'){event.preventDefault();event.returnValue='';}});

socket.on('hello',data=>{write('daketi:session',data.sessionToken);socket.auth={sessionToken:data.sessionToken};connected=true;connection('At your service','online');if(state&&!data.hasRoom){state=null;myId=-1;selected=null;privateEnabled=false;queuedState=null;$('private-settings').hidden=true;showPage('home');toast('This table has expired. Create a fresh table or join your friends.');}updateDealNote();$('join-button').disabled=false;render();});
socket.on('sessionConflict',()=>{sessionConflict=true;connected=false;connection('Open in another tab','offline');clearInterval(noticeTimer);noticeTimer=null;$('connection-notice').hidden=false;$('connection-notice-title').textContent='Your player is open in another tab.';$('connection-notice-detail').textContent='Close that tab, then reload here to continue.';$('home-error').textContent='This player is already connected in another tab. Close that tab, then reload here.';render();});
socket.on('connect_error',()=>{connected=false;connection('Waking the table…','offline');updateDealNote();$('join-button').disabled=true;render();});
socket.on('disconnect',reason=>{connected=false;pending=false;if(!sessionConflict)connection(reason==='io server disconnect'?'Connection closed':'Reconnecting…','offline');updateDealNote();$('join-button').disabled=true;render();});
socket.on('roomJoined',data=>{myId=data.playerId;selected=null;summaryRound=-1;privateEnabled=false;queuedState=null;$('private-settings').hidden=true;for(const d of document.querySelectorAll('dialog[open]'))d.close();state=null;acceptState(data.state,{force:true});const url=new URL(location.href);url.searchParams.set('room',data.state.roomCode);history.replaceState(null,'',url);});
socket.on('stateUpdate',s=>acceptState(s));
socket.on('roundStarted',s=>{queue=queue.then(()=>animateDeal(s)).catch(error=>{animating=false;acceptState(s,{force:true});console.error('Deal animation failed:',error);});});
socket.on('move',({event,state:next})=>{queue=queue.then(()=>animateMove(event,next)).catch(error=>{animating=false;acceptState(next,{force:true});console.error('Move animation failed:',error);});});
socket.on('privateMode',data=>{privateEnabled=data.enabled;$('private-toggle').checked=privateEnabled;$('private-strength').value=data.strength;$('private-settings').hidden=!privateEnabled;});

$('hero-cards').append(makeCard(new Card('K','♠')),makeCard(new Card('Q','♥')),makeCard(new Card('A','♠')));
const invitation=new URLSearchParams(location.search).get('room');if(invitation){$('room-input').value=invitation.trim().toUpperCase();$('join-tab').click();}
applyPreferences();updateDealNote();connection('Connecting…','offline');socket.connect();
if(apiUrl)fetch(`${apiUrl}/health`).catch(()=>{});
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
