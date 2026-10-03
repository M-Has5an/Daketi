import test from 'node:test';
import assert from 'node:assert/strict';
import {server,client,table,emit,until,delay,io} from './helpers.js';
import {Game} from '../public/shared/game.js';
import {RoomStore} from '../server/storage.js';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function setup(t,options={}){const app=await server(options);t.after(()=>app.close());return app;}
test('lobby validation, host start, readiness, safe names, and independent seats',async t=>{
  const app=await setup(t),a=await client(app),b=await client(app);t.after(()=>{a.disconnect();b.disconnect();});
  assert.equal((await emit(a,'createRoom',{config:{numPlayers:6,handSize:10}})).ok,false);assert.equal(app.rooms.size,0);
  assert.equal((await emit(a,'joinRoom',{code:'__proto__'})).ok,false);assert.equal((await emit(a,'createRoom',null)).ok,false);
  await emit(a,'createRoom',{name:'<img src=x onerror=alert(1)>',config:{numPlayers:3}});assert.match(a.state.roomCode,/^[A-Z2-9]{6}$/);assert.equal(a.state.status,'waiting');assert.equal(a.state.players[0].hand.length,0);
  await emit(b,'joinRoom',{code:a.state.roomCode.toLowerCase(),name:'Friend'});assert.equal(b.pid,1);assert.equal((await emit(b,'startRound')).ok,false);assert.equal((await emit(a,'startRound')).ok,false);
  await emit(b,'ready',{ready:true});assert.equal((await emit(a,'startRound')).ok,true);assert.equal(a.state.status,'playing');assert.equal(a.state.players[1].hand,null);assert.equal(b.state.players[0].hand,null);
  assert.equal(a.state.players[0].name.length<=24,true);assert.equal('cheatStrength'in a.state.config,false);
});
test('exclusive private mode has no public messages or public-state change, and foreign room fields have no authority',async t=>{
  const app=await setup(t),[a,b]=await table(app);t.after(()=>{a.disconnect();b.disconnect();});const before=JSON.stringify(b.state),events=b.events.length;
  const results=await Promise.all([emit(a,'privateMode',{enabled:true,strength:'strong'}),emit(b,'privateMode',{enabled:true})]);assert.equal(results.filter(r=>r.enabled).length,1);await delay(40);assert.equal(b.events.length,events);assert.equal(JSON.stringify(b.state),before);
  const room=app.rooms.get(a.state.roomCode);assert.equal(room.cheatOwner,0);assert.equal((await emit(b,'privateMode',{enabled:false,roomCode:'FORGED',playerId:0})).enabled,false);assert.equal(room.cheatOwner,0);
  await emit(a,'privateMode',{enabled:false});assert.equal((await emit(b,'privateMode',{enabled:true})).enabled,true);
  const serialized=JSON.stringify(a.state);for(const secret of ['cheatOwner','cheatStrength','rngState','sessionToken'])assert.equal(serialized.includes(secret),false);
});
test('draw animation and states never reveal a rival card; forged and stale moves are rejected',async t=>{
  const app=await setup(t),[a,b]=await table(app);t.after(()=>{a.disconnect();b.disconnect();});const room=app.rooms.get(a.state.roomCode),version=room.version;
  assert.equal((await emit(b,'action',{type:'DRAW',version})).ok,false);assert.equal((await emit(a,'action',{type:'DISCARD',version,cardId:'fake'})).ok,false);
  assert.equal((await emit(a,'action',{type:'DRAW',version})).ok,true);await until(()=>b.events.some(e=>e.name==='move'));
  const hidden=b.events.find(e=>e.name==='move').data;assert.equal('card'in hidden.event,false);assert.equal(hidden.state.players[0].hand,null);assert.equal(a.events.find(e=>e.name==='move').data.event.card.id,room.game.players[0].hand.at(-1).id);
  const after=room.game.snapshot();assert.equal((await emit(a,'action',{type:'DRAW',version})).ok,false);assert.deepEqual(room.game.snapshot(),after);
  assert.equal((await emit(a,'action',{type:'CAPTURE',version:room.version,cardId:'fake'})).ok,false);
});
test('reserved reconnect seat and exclusive ownership survive briefly without passing to a guest',async t=>{
  const app=await setup(t),[a,b]=await table(app);t.after(()=>{a.disconnect();b.disconnect();});await emit(a,'privateMode',{enabled:true});const code=a.state.roomCode,token=a.token;a.disconnect();await until(()=>!app.rooms.get(code).seats[0].socketId);
  const guest=await client(app);t.after(()=>guest.disconnect());assert.equal((await emit(guest,'joinRoom',{code,name:'Intruder',userId:token})).ok,false);
  assert.equal((await emit(b,'privateMode',{enabled:true})).enabled,false);
  const resumed=await client(app,token);t.after(()=>resumed.disconnect());await until(()=>resumed.state);assert.equal(resumed.pid,0);assert.equal(resumed.state.roomCode,code);assert.equal(resumed.events.some(e=>e.name==='privateMode'&&e.data.enabled),true);
  await emit(resumed,'leaveRoom');assert.equal(app.rooms.get(code).cheatOwner,null);assert.equal(app.rooms.get(code).hostId,1);assert.equal((await emit(guest,'joinRoom',{code,name:'New guest'})).ok,true);assert.equal(guest.events.some(e=>e.name==='privateMode'),false);
});
test('expired ownership is released and seats become available',async t=>{
  const app=await setup(t,{reconnectGrace:30,cleanupInterval:10}),[a,b]=await table(app);t.after(()=>{a.disconnect();b.disconnect();});await emit(a,'privateMode',{enabled:true});const code=a.state.roomCode;a.disconnect();await until(()=>!app.rooms.get(code).seats[0].token);assert.equal(app.rooms.get(code).cheatOwner,null);assert.equal((await emit(b,'privateMode',{enabled:true})).enabled,true);
});
test('joining a bot seat cancels its scheduled move before it can play for the human',async t=>{
  const app=await setup(t,{botDelay:160}),a=await client(app),b=await client(app);t.after(()=>{a.disconnect();b.disconnect();});await emit(a,'createRoom',{});await emit(a,'startRound');await emit(a,'action',{type:'DRAW',version:a.state.version});await emit(a,'action',{type:'DISCARD',version:a.state.version,cardId:a.state.players[0].hand[0].id});
  const version=app.rooms.get(a.state.roomCode).game.moveNumber;await emit(b,'joinRoom',{code:a.state.roomCode,name:'Human'});await delay(220);assert.equal(app.rooms.get(a.state.roomCode).game.moveNumber,version);assert.equal(b.state.currentPlayerIdx,b.pid);
});
test('copied session cannot take over an actively connected player',async t=>{
  const app=await setup(t),a=await client(app);t.after(()=>a.disconnect());const copied=io(app.url,{transports:['websocket'],reconnection:false,auth:{sessionToken:a.token}});t.after(()=>copied.disconnect());let conflict=false;copied.on('sessionConflict',()=>conflict=true);await until(()=>conflict);assert.equal(app.sessions.get(a.token).socketId,a.id);
});
test('bot cover pauses private bias while its owner is disconnected, and every bot pauses at an empty table',async t=>{
  const app=await setup(t,{botDelay:25}),[a,b]=await table(app);t.after(()=>{a.disconnect();b.disconnect();});const room=app.rooms.get(a.state.roomCode);await emit(a,'privateMode',{enabled:true});
  const owners=[],draw=room.game.performDraw.bind(room.game);room.game.performDraw=(pid,owner)=>{owners.push(owner);return draw(pid,owner);};a.disconnect();await until(()=>owners.length>0);assert.equal(owners[0],null);assert.equal(room.cheatOwner,0);
  b.disconnect();await until(()=>room.seats.every(s=>!s.socketId));const moves=room.game.moveNumber;await delay(100);assert.equal(room.game.moveNumber,moves);
});
test('checkpoints advance during continuous traffic instead of waiting for a quiet room',async t=>{
  const saved=[],store={kind:'file',load:async()=>[],save:async rooms=>saved.push(rooms)};const app=await setup(t,{store,saveDelay:25}),a=await client(app);t.after(()=>a.disconnect());await emit(a,'createRoom',{});
  for(let i=0;i<10;i++){await emit(a,'ready',{ready:i%2===0});await delay(10);}assert.equal(saved.length>=2,true);assert.equal(saved.at(-1)[0].version>saved[0][0].version,true);
});
test('all players must vote for a rematch; totals persist and private ownership resets',async t=>{
  const app=await setup(t),[a,b]=await table(app,{numPlayers:2,handSize:10,faceUpSize:0});t.after(()=>{a.disconnect();b.disconnect();});const room=app.rooms.get(a.state.roomCode);await emit(a,'privateMode',{enabled:true});
  let moves=0;while(room.status==='playing'&&moves++<180){const c=room.game.currentPlayerIdx===0?a:b;const choice=room.game.turnPhase==='DRAW'?{type:'DRAW'}:room.game.botChoice(c.pid);const result=await emit(c,'action',{...choice,version:room.version});if(!result.ok&&result.error.includes('wait a moment')){await delay(205);moves--;}else assert.equal(result.ok,true,result.error);}
  assert.equal(room.status,'finished');assert.equal(room.cheatOwner,null);assert.equal(room.seats[0].totals.rounds,1);assert.equal(room.seats[1].totals.rounds,1);await delay(220);assert.equal((await emit(a,'rematch')).ok,true);assert.equal(room.status,'finished');assert.equal((await emit(b,'rematch')).ok,true);assert.equal(room.round,2);assert.equal(room.game.currentPlayerIdx,1);assert.equal(room.seats[0].totals.rounds,1);
});
test('file checkpoints restore a protected room and its session across server restarts',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'daketi-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new RoomStore({file:path.join(dir,'rooms.json')}),app=await server({store});const[a,b]=await table(app);await emit(a,'privateMode',{enabled:true});const code=a.state.roomCode,token=a.token,snapshot=app.rooms.get(code).game.snapshot();a.disconnect();b.disconnect();await app.close();
  assert.equal(JSON.parse(await readFile(store.file,'utf8'))[0].cheatOwner,0);const restored=await setup(t,{store});const c=await client(restored,token);t.after(()=>c.disconnect());await until(()=>c.state);assert.equal(c.state.roomCode,code);assert.deepEqual(restored.rooms.get(code).game.snapshot(),{...snapshot,players:snapshot.players.map((p,i)=>({...p,isBot:i!==0}))});assert.equal(restored.rooms.get(code).cheatOwner,0);
});
test('Upstash adapter uses authenticated commands and protected snapshots; no database is mandatory',async t=>{
  const original=globalThis.fetch,requests=[];globalThis.fetch=async(url,options)=>{requests.push({url,...options});return{ok:true,json:async()=>({result:requests.length===1?'[]':'OK'})};};t.after(()=>globalThis.fetch=original);
  const store=new RoomStore({url:'https://example.upstash.io',token:'secret',namespace:'test'});assert.deepEqual(await store.load(),[]);await store.save([{private:true}]);assert.equal(requests[0].headers.Authorization,'Bearer secret');assert.deepEqual(JSON.parse(requests[1].body),['SET','test:snapshot','[{"private":true}]','EX',86400]);
  assert.equal(new RoomStore({}).kind,'memory');assert.throws(()=>new RoomStore({url:'https://example.io'}));assert.throws(()=>new RoomStore({url:'http://example.io',token:'x'}));
});
