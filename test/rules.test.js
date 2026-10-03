import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,Card,RuleError,validateConfig,score,topRun} from '../public/shared/game.js';

const card=(rank,suit='♠')=>new Card(rank,suit);
function conserve(game){const all=[...game.deck,...game.faceUpCards,...game.players.flatMap(p=>[...p.hand,...p.pile])];assert.equal(all.length,52);assert.equal(new Set(all.map(c=>c.id)).size,52);assert.equal(score(all),380);}
function fixture(){const g=new Game({numPlayers:3});g.players.forEach(p=>{p.hand=[];p.pile=[];});g.deck=[card('2')];g.turnPhase='PLAY';return g;}

test('invalid, fractional, and oversized deals are rejected before shuffling',()=>{
  for(const config of [{numPlayers:7},{numPlayers:2.5},{handSize:0},{faceUpSize:-1},{numPlayers:6,handSize:9},{difficulty:'omniscient'},null,[]])assert.throws(()=>validateConfig(config),RuleError);
  const g=new Game({numPlayers:6,handSize:7,faceUpSize:10},123).init();conserve(g);assert.equal(g.deck.length,0);assert.equal(g.turnPhase,'PLAY');
});
test('capture takes every matching table card and only consecutive top runs from all rivals',()=>{
  const g=fixture();g.players[0].hand=[card('7')];g.players[0].pile=[card('7','♦')];
  g.players[1].pile=[card('7','♠'),card('3'),card('7','♥'),card('7','♣')];
  g.players[2].pile=[card('A'),card('7','♦')];g.faceUpCards=[card('7','♣'),card('Q')];
  const a=g.analyzeCard(0,g.players[0].hand[0]);assert.equal(a.selfMatch,true);assert.equal(a.stealTargets.length,2);assert.equal(a.gain,25);
  const move=g.performCapture(0,g.players[0].hand[0].id);
  assert.equal(g.players[1].pile.length,2);assert.equal(g.players[2].pile.length,1);assert.equal(g.faceUpCards.length,1);
  assert.equal(move.extraTurn,true);assert.equal(g.currentPlayerIdx,0);assert.equal(g.turnPhase,'DRAW');assert.equal(g.players[0].stats.stolen,3);
  assert.deepEqual(move.scoreChanges.map(c=>c.points),[-10,-5,25]);assert.equal(topRun(g.players[0].pile).length,6);
});
test('own top matches are legal, and capture passes when the deck is empty',()=>{
  const g=fixture();g.deck=[];g.players[0].hand=[card('A')];g.players[0].pile=[card('A','♥')];g.players[2].hand=[card('2')];
  const move=g.performCapture(0,g.players[0].hand[0].id);assert.equal(move.extraTurn,false);assert.equal(score(g.players[0].pile),40);assert.equal(g.currentPlayerIdx,2);assert.equal(g.turnPhase,'PLAY');
});
test('discard skips empty hands and the final move finishes without awarding leftover table cards',()=>{
  const g=fixture();g.deck=[];g.players[0].hand=[card('3')];g.players[2].hand=[card('4')];g.faceUpCards=[card('A')];
  g.performDiscard(0,g.players[0].hand[0].id);assert.equal(g.currentPlayerIdx,2);
  g.performDiscard(2,g.players[2].hand[0].id);assert.equal(g.finished,true);assert.equal(g.turnPhase,'OVER');assert.equal(score(g.players[0].pile),0);assert.equal(g.faceUpCards.length,3);
});
test('wrong turn, phase, forged card, and unmatched capture never mutate state',()=>{
  const g=new Game({},5).init(),before=g.snapshot();
  assert.throws(()=>g.performDraw(1),RuleError);assert.throws(()=>g.performDiscard(0,g.players[0].hand[0].id),RuleError);assert.deepEqual(g.snapshot(),before);
  g.performDraw(0);const after=g.snapshot();assert.throws(()=>g.performDraw(0),RuleError);assert.throws(()=>g.performDiscard(0,'forged'),RuleError);assert.deepEqual(g.snapshot(),after);
  const f=fixture();f.players[0].hand=[card('K')];assert.throws(()=>f.performCapture(0,f.players[0].hand[0].id),RuleError);assert.equal(f.players[0].hand.length,1);
});
test('classic bias chooses a steal for the owner and avoids exposing the owner to rivals',()=>{
  const g=new Game({},7);g.deck=[card('A'),card('7'),card('2')];g.players[1].pile=[card('7','♥')];
  assert.equal(g.performDraw(0,0).card.rank,'7');
  g.turnPhase='DRAW';g.currentPlayerIdx=1;g.players[0].pile=[card('A','♥')];g.deck=[card('A'),card('2'),card('3')];assert.equal(g.performDraw(1,0).card.rank,'2');
});
test('snapshots preserve cards, random state, and biased future moves',()=>{
  const g=new Game({difficulty:'hard',cheatStrength:'gentle'},765).init();const restored=Game.restore(g.snapshot());
  for(let i=0;i<70&&!g.finished;i++){assert.equal(JSON.stringify(restored.calculateBotMove(restored.currentPlayerIdx,0)),JSON.stringify(g.calculateBotMove(g.currentPlayerIdx,0)));assert.deepEqual(restored.snapshot(),g.snapshot());}
});
test('bot strategy reads its own hand and public piles, never a rival hidden hand',()=>{
  const g=new Game({difficulty:'hard'},345).init();g.performDraw(0);const before=g.rngState,a=g.botChoice(0);g.rngState=before;
  Object.defineProperty(g.players[1],'hand',{get(){throw new Error('Hidden hand accessed');}});assert.deepEqual(g.botChoice(0),a);
});
test('public state excludes the deck, seed, private strength, and opponent hands',()=>{
  const g=new Game({},77).init(),s=g.publicState(1);assert.equal(s.players[0].hand,null);assert.equal(s.players[1].hand.length,6);
  for(const key of ['deck','rngState','config','cheatOwner'])assert.equal(key in s,false);
});
test('450 seeded complete games conserve all 52 unique cards and terminate across all difficulties and seats',()=>{
  for(const difficulty of ['easy','medium','hard'])for(let players=2;players<=6;players++)for(let seed=0;seed<30;seed++){
    const g=new Game({numPlayers:players,difficulty,handSize:seed%2?1:Math.min(8,Math.floor(46/players)),faceUpSize:6},seed).init();
    let moves=0;while(!g.finished&&moves++<300){g.calculateBotMove(g.currentPlayerIdx,seed%3?null:0);conserve(g);}assert.equal(g.finished,true,`${difficulty}/${players}/${seed}`);
  }
});
