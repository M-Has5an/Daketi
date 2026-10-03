// One rules engine for the authoritative server and browser move previews.
export const SUITS = ['♠', '♥', '♣', '♦'];
export const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
export const VALUES = Object.fromEntries(RANKS.map(r => [r, r === 'A' ? 20 : ['J','Q','K'].includes(r) ? 10 : 5]));
export const DEFAULT_CONFIG = {numPlayers:2,handSize:6,faceUpSize:6,difficulty:'medium',cheatStrength:'classic'};
export class RuleError extends Error {}
export const score = pile => pile.reduce((sum,c) => sum+c.val,0);
export function validateConfig(input={}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RuleError('Choose valid game settings.');
  const config={...DEFAULT_CONFIG};
  for (const [key,min,max,label] of [['numPlayers',2,6,'Players'],['handSize',1,10,'Hand size'],['faceUpSize',0,10,'Face-up cards']]) {
    const v=input[key]===undefined?config[key]:Number(input[key]);
    if (!Number.isInteger(v)||v<min||v>max) throw new RuleError(`${label} must be between ${min} and ${max}.`);
    config[key]=v;
  }
  if (config.numPlayers*config.handSize+config.faceUpSize>52) throw new RuleError('That deal needs more than 52 cards. Reduce the hand size or face-up cards.');
  for (const [key,options] of [['difficulty',['easy','medium','hard']],['cheatStrength',['gentle','classic','strong']]]) {
    if (input[key]!==undefined) {
      if (!options.includes(input[key])) throw new RuleError('Choose valid game settings.');
      config[key]=input[key];
    }
  }
  return config;
}
export function topRun(pile) {
  if (!pile.length) return [];
  let i=pile.length-1; const rank=pile[i].rank;
  while(i>0&&pile[i-1].rank===rank)i--;
  return pile.slice(i);
}
export function analyzeMoveLogic(faceUpCards,players,pid,card) {
  const a={canCapture:false,stealTargets:[],tableMatch:[],selfMatch:false,gain:0};
  const p=players.find(p=>p.id===pid);
  if(!p||!card)return a;
  for(const o of players) if(o.id!==pid&&o.pile.at(-1)?.rank===card.rank)a.stealTargets.push({id:o.id,cards:topRun(o.pile)});
  a.tableMatch=faceUpCards.filter(c=>c.rank===card.rank);
  a.selfMatch=p.pile.at(-1)?.rank===card.rank;
  a.canCapture=!!(a.stealTargets.length||a.tableMatch.length||a.selfMatch);
  if(a.canCapture)a.gain=card.val+score(a.tableMatch)+a.stealTargets.reduce((n,t)=>n+score(t.cards),0);
  return a;
}
export class Card {
  constructor(rank,suit){this.rank=rank;this.suit=suit;this.val=VALUES[rank];this.color=suit==='♥'||suit==='♦'?'red':'black';this.id=`${SUITS.indexOf(suit)}-${rank}`;}
}
const stats=()=>({captured:0,stolen:0,steals:0,turns:0,longestChain:0});
export class Player {
  constructor(id,name=`Bot ${id+1}`,isBot=true){Object.assign(this,{id,name,isBot,hand:[],pile:[],stats:stats()});}
}
export class Game {
  constructor(config={},seed=Date.now()) {
    this.config=validateConfig(config);this.rngState=seed>>>0;
    this.players=Array.from({length:this.config.numPlayers},(_,id)=>new Player(id));
    Object.assign(this,{deck:[],faceUpCards:[],currentPlayerIdx:0,turnPhase:'DRAW',finished:false,moveNumber:0,chain:0});
  }
  random(){this.rngState=(this.rngState+0x6D2B79F5)>>>0;let t=this.rngState;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}
  init(starter=0){
    this.deck=SUITS.flatMap(s=>RANKS.map(r=>new Card(r,s)));
    for(let i=this.deck.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[this.deck[i],this.deck[j]]=[this.deck[j],this.deck[i]];}
    this.faceUpCards=[];for(const p of this.players){p.hand=[];p.pile=[];p.stats=stats();}
    for(let n=0;n<this.config.handSize;n++)for(const p of this.players)p.hand.push(this.deck.pop());
    for(let n=0;n<this.config.faceUpSize;n++)this.faceUpCards.push(this.deck.pop());
    this.currentPlayerIdx=starter%this.players.length;this.turnPhase=this.deck.length?'DRAW':'PLAY';
    this.finished=false;this.moveNumber=0;this.chain=0;return this;
  }
  assertTurn(pid,phase){
    if(this.finished)throw new RuleError('This round has finished.');
    if(!Number.isInteger(pid)||pid!==this.currentPlayerIdx)throw new RuleError('Wait for your turn.');
    if(this.turnPhase!==phase)throw new RuleError(phase==='DRAW'?'Play a card first.':'Draw a card first.');
  }
  getCard(pid,id){const index=this.players[pid].hand.findIndex(c=>c.id===id);if(index<0)throw new RuleError('That card is no longer in your hand.');return{card:this.players[pid].hand[index],index};}
  analyzeCard(pid,card){return analyzeMoveLogic(this.faceUpCards,this.players,pid,card);}
  bestDrawIndex(pid){
    let best=-Infinity,index=this.deck.length-1;
    this.deck.forEach((c,i)=>{const a=this.analyzeCard(pid,c);const v=c.val+(a.stealTargets.length?1000+a.stealTargets.reduce((n,t)=>n+t.cards.length*50,0):0)+(a.selfMatch?500:0)+(a.tableMatch.length?200+a.tableMatch.length*20:0);if(v>best){best=v;index=i;}});
    return index;
  }
  sabotageIndex(pid,ownerId){
    let best=-Infinity,index=this.deck.length-1;
    this.deck.forEach((c,i)=>{let v=-c.val;if(this.players[ownerId].pile.at(-1)?.rank===c.rank)v-=5000;if(this.players[pid].pile.at(-1)?.rank===c.rank)v-=1000;if(this.faceUpCards.some(f=>f.rank===c.rank))v-=200;if(this.config.cheatStrength==='strong')v-=this.analyzeCard(pid,c).gain*20;if(v>best){best=v;index=i;}});return index;
  }
  performDraw(pid,ownerId=null){
    this.assertTurn(pid,'DRAW');if(!this.deck.length)throw new RuleError('The deck is empty. Play a card from your hand.');
    let index=this.deck.length-1;const bias=ownerId!==null&&(this.config.cheatStrength!=='gentle'||this.random()<0.55);
    if(bias&&pid===ownerId)index=this.bestDrawIndex(pid);else if(bias&&this.config.cheatStrength!=='gentle')index=this.sabotageIndex(pid,ownerId);
    const card=this.deck.splice(index,1)[0];this.players[pid].hand.push(card);this.turnPhase='PLAY';this.moveNumber++;
    return{type:'DRAW',playerId:pid,card,scoreChanges:[],extraTurn:false};
  }
  performDiscard(pid,id){
    this.assertTurn(pid,'PLAY');const{card,index}=this.getCard(pid,id);this.players[pid].hand.splice(index,1);this.faceUpCards.push(card);
    this.players[pid].stats.turns++;this.moveNumber++;this.chain=0;this.endTurn();return{type:'DISCARD',playerId:pid,card,scoreChanges:[],extraTurn:false};
  }
  performCapture(pid,id){
    this.assertTurn(pid,'PLAY');const{card,index}=this.getCard(pid,id);const analysis=this.analyzeCard(pid,card);
    if(!analysis.canCapture)throw new RuleError('That card has no matching capture.');
    const p=this.players[pid],scoreChanges=[];p.hand.splice(index,1);
    for(const t of analysis.stealTargets){const stolen=this.players[t.id].pile.splice(-t.cards.length);p.pile.push(...stolen);p.stats.stolen+=stolen.length;p.stats.steals++;scoreChanges.push({playerId:t.id,points:-score(stolen)});}
    const ids=new Set(analysis.tableMatch.map(c=>c.id));this.faceUpCards=this.faceUpCards.filter(c=>!ids.has(c.id));p.pile.push(...analysis.tableMatch,card);
    p.stats.captured+=analysis.tableMatch.length+1;p.stats.turns++;this.chain++;p.stats.longestChain=Math.max(p.stats.longestChain,this.chain);
    scoreChanges.push({playerId:pid,points:analysis.gain});this.moveNumber++;const extraTurn=this.deck.length>0;
    if(extraTurn)this.turnPhase='DRAW';else{this.chain=0;this.endTurn();}
    return{type:'CAPTURE',playerId:pid,card,analysis,scoreChanges,extraTurn};
  }
  endTurn(){
    if(this.isGameOver()){this.finished=true;this.turnPhase='OVER';return;}
    do{this.currentPlayerIdx=(this.currentPlayerIdx+1)%this.players.length;}while(!this.deck.length&&!this.players[this.currentPlayerIdx].hand.length);
    this.turnPhase=this.deck.length?'DRAW':'PLAY';
  }
  isGameOver(){return!this.deck.length&&this.players.every(p=>!p.hand.length);}
  botChoice(pid){
    const p=this.players[pid];const choices=p.hand.map(card=>({card,a:this.analyzeCard(pid,card)})).filter(c=>c.a.canCapture);
    if(choices.length){
      if(this.config.difficulty==='easy')return{type:'CAPTURE',cardId:choices[Math.floor(this.random()*choices.length)].card.id};
      const value=({card,a})=>{let v=a.gain+a.stealTargets.reduce((n,t)=>n+score(t.cards),0);if(this.config.difficulty==='hard'){const exposed=topRun(p.pile).filter(c=>c.rank===card.rank).length+a.tableMatch.length+a.stealTargets.reduce((n,t)=>n+t.cards.length,0)+1;const visible=[...this.faceUpCards,...this.players.flatMap(o=>o.pile),...p.hand].filter(c=>c.rank===card.rank).length;v-=Math.max(0,4-visible)*exposed*card.val*.45;v+=p.hand.filter(c=>c.rank===card.rank).length*3;}return v;};
      choices.sort((a,b)=>value(b)-value(a));return{type:'CAPTURE',cardId:choices[0].card.id};
    }
    if(!p.hand.length)return{type:'SKIP'};
    if(this.config.difficulty==='easy')return{type:'DISCARD',cardId:p.hand[Math.floor(this.random()*p.hand.length)].id};
    const risk=c=>c.val+this.players.filter(o=>o.id!==pid&&o.pile.at(-1)?.rank===c.rank).length*c.val*4+this.faceUpCards.filter(f=>f.rank===c.rank).length*c.val+(p.hand.filter(h=>h.rank===c.rank).length>1?8:0);
    return{type:'DISCARD',cardId:[...p.hand].sort((a,b)=>risk(a)-risk(b))[0].id};
  }
  calculateBotMove(pid,ownerId=null){if(this.turnPhase==='DRAW')return this.performDraw(pid,ownerId);this.assertTurn(pid,'PLAY');const m=this.botChoice(pid);if(m.type==='SKIP'){this.endTurn();return null;}return m.type==='CAPTURE'?this.performCapture(pid,m.cardId):this.performDiscard(pid,m.cardId);}
  publicState(pid){return{deckCount:this.deck.length,faceUpCards:this.faceUpCards,currentPlayerIdx:this.currentPlayerIdx,turnPhase:this.turnPhase,finished:this.finished,moveNumber:this.moveNumber,players:this.players.map(p=>({id:p.id,name:p.name,isBot:p.isBot,pile:p.pile,score:score(p.pile),handCount:p.hand.length,hand:p.id===pid?p.hand:null,stats:{...p.stats}}))};}
  snapshot(){return JSON.parse(JSON.stringify(this));}
  static restore(snapshot){const game=new Game(snapshot.config,snapshot.rngState);Object.assign(game,snapshot);game.config=validateConfig(snapshot.config);return game;}
}
