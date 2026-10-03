import express from 'express';
import {createServer} from 'node:http';
import {randomBytes,randomInt} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {Server} from 'socket.io';
import {Game,RuleError,validateConfig,score} from './public/shared/game.js';
import {RoomStore} from './server/storage.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const cleanName=value=>String(value||'Player').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,24)||'Player';
const publicConfig=c=>({numPlayers:c.numPlayers,handSize:c.handSize,faceUpSize:c.faceUpSize,difficulty:c.difficulty});
const emptySeat=()=>({token:null,socketId:null,ready:false,disconnectedAt:null,rematch:false,totals:{wins:0,points:0,rounds:0}});

export async function createApplication(options={}) {
  const app=express(),httpServer=createServer(app),rooms=new Map(),sessions=new Map();
  const store=options.store||new RoomStore();
  const reconnectGrace=options.reconnectGrace??90000,botDelay=options.botDelay??650,moveDuration=options.moveDuration??470;
  const maxRooms=options.maxRooms??200;
  const allowedOrigins=(options.allowedOrigins??process.env.ALLOWED_ORIGINS??'').split(',').map(v=>v.trim()).filter(Boolean);
  const originAllowed=(origin,host)=>{
    if(!origin)return true;
    try{return new URL(origin).host===host||allowedOrigins.includes(origin);}catch{return false;}
  };
  const io=new Server(httpServer,{pingInterval:20000,pingTimeout:20000,maxHttpBufferSize:8192,
    cors:{origin:(origin,callback)=>callback(null,!origin||allowedOrigins.includes(origin)||!allowedOrigins.length)},
    allowRequest:(request,callback)=>callback(null,originAllowed(request.headers.origin,request.headers.host))});
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ${allowedOrigins.join(' ')}; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
    next();
  });
  app.get('/health',(_req,res)=>res.set('Cache-Control','no-store').json({ok:true,version:'2.0.0'}));
  app.get('/api/config',(_req,res)=>res.set('Cache-Control','no-store').json({apiUrl:'',version:'2.0.0'}));
  app.use(express.static(path.join(root,'public'),{etag:true,maxAge:'1h',setHeaders:(res,file)=>{if(/\.(html|js|css)$/.test(file))res.setHeader('Cache-Control','no-cache');}}));

  const snapshot=()=>[...rooms.values()].map(r=>({code:r.code,status:r.status,hostId:r.hostId,version:r.version,round:r.round,createdAt:r.createdAt,lastActive:r.lastActive,cheatOwner:r.cheatOwner,log:r.log,game:r.game.snapshot(),seats:r.seats.map(s=>({...s,socketId:null})),lockUntil:0}));
  let saveTimer=null,storageWarning=false,saving=false,dirty=false,closing=false;
  const persist=()=>{
    if(store.kind==='memory'||closing)return;
    dirty=true;if(saveTimer||saving)return;
    // Throttle checkpoints so constant multiplayer traffic cannot postpone every save.
    saveTimer=setTimeout(()=>{saveTimer=null;dirty=false;saving=true;store.save(snapshot()).then(()=>{storageWarning=false;}).catch(()=>{if(!storageWarning)console.warn('Room checkpoint failed; live play continues. Check storage configuration.');storageWarning=true;}).finally(()=>{saving=false;if(dirty)persist();});},options.saveDelay??750);
    saveTimer.unref?.();
  };
  for(const saved of await store.load()) {
    if(!saved||Date.now()-saved.lastActive>86400000)continue;
    try{
      const r={...saved,game:Game.restore(saved.game),botTimer:null,lockUntil:0};
      r.seats=r.seats.map(s=>({...s,socketId:null,disconnectedAt:s.token?Date.now():null}));rooms.set(r.code,r);
      for(const player of r.game.players)player.isBot=true;
      for(let id=0;id<r.seats.length;id++){const s=r.seats[id];if(s.token)sessions.set(s.token,{token:s.token,roomCode:r.code,seatId:id,socketId:null,lastSeen:Date.now()});}
    }catch{console.warn('Skipped an invalid room checkpoint.');}
  }
  const roomFor=socket=>rooms.get(socket.data.session.roomCode);
  const activeHumans=r=>r.seats.some(s=>s.token&&s.socketId);
  const stateFor=(r,pid)=>{const game=r.game.publicState(pid);return{roomCode:r.code,status:r.status,hostId:r.hostId,version:r.version,round:r.round,config:publicConfig(r.game.config),paused:r.status==='playing'&&!activeHumans(r),log:r.log,
    ...game,players:game.players.map(p=>({...p,connected:!!r.seats[p.id].socketId,reserved:!!r.seats[p.id].token,ready:r.seats[p.id].ready,rematch:r.seats[p.id].rematch,totals:{...r.seats[p.id].totals}}))};};
  const broadcast=r=>{for(let id=0;id<r.seats.length;id++){const s=r.seats[id];if(s.socketId)io.to(s.socketId).emit('stateUpdate',stateFor(r,id));}};
  const clearBot=r=>{clearTimeout(r.botTimer);r.botTimer=null;};
  const touch=r=>{r.version++;r.lastActive=Date.now();persist();};
  const addLog=(r,text)=>{r.log.push({id:r.version,text,at:Date.now()});if(r.log.length>12)r.log.shift();};
  const resetCheat=r=>{if(r.cheatOwner!==null){const owner=r.seats[r.cheatOwner];if(owner?.socketId)io.to(owner.socketId).emit('privateMode',{enabled:false,strength:r.game.config.cheatStrength});}r.cheatOwner=null;};
  function scheduleBot(r) {
    clearBot(r);
    if(r.status!=='playing'||!activeHumans(r)||!r.game.players[r.game.currentPlayerIdx].isBot)return;
    const expectedVersion=r.version,expectedPlayer=r.game.currentPlayerIdx;
    r.botTimer=setTimeout(()=>{
      r.botTimer=null;
      if(!rooms.has(r.code)||r.status!=='playing'||r.version!==expectedVersion||r.game.currentPlayerIdx!==expectedPlayer||!r.game.players[expectedPlayer].isBot||!activeHumans(r))return;
      try{const owner=r.cheatOwner!==null&&r.seats[r.cheatOwner]?.socketId?r.cheatOwner:null;const move=r.game.calculateBotMove(expectedPlayer,owner);if(move)publishMove(r,move);else{touch(r);broadcast(r);scheduleBot(r);}}catch(error){console.error('Bot move failed:',error.message);}
    },Math.max(0,r.lockUntil-Date.now())+botDelay);
    r.botTimer.unref?.();
  }
  function publishMove(r,move) {
    clearBot(r);touch(r);r.lockUntil=Date.now()+moveDuration;
    const name=r.game.players[move.playerId].name;
    addLog(r,move.type==='DRAW'?`${name} drew a card.`:move.type==='DISCARD'?`${name} discarded ${move.card.rank}${move.card.suit}.`:`${name} captured ${move.analysis.tableMatch.length+1} card${move.analysis.tableMatch.length?'s':''}${move.analysis.stealTargets.length?` and stole ${move.analysis.stealTargets.reduce((n,t)=>n+t.cards.length,0)}`:''}.${move.extraTurn?' Another turn!':''}`);
    if(r.game.finished){
      r.status='finished';const maximum=Math.max(...r.game.players.map(p=>score(p.pile)));
      for(const p of r.game.players){const t=r.seats[p.id].totals;t.rounds++;t.points+=score(p.pile);if(score(p.pile)===maximum)t.wins++;}
      resetCheat(r);persist();
    }
    for(let id=0;id<r.seats.length;id++) {
      const seat=r.seats[id];if(!seat.socketId)continue;
      // Never send another player's drawn rank, suit, or card ID, even for animation.
      const event={...move,id:r.version,round:r.round,duration:moveDuration};
      if(move.type==='DRAW'&&id!==move.playerId)delete event.card;
      io.to(seat.socketId).emit('move',{event,state:stateFor(r,id)});
    }
    scheduleBot(r);
  }
  function startRound(r) {
    clearBot(r);resetCheat(r);r.round++;r.status='playing';
    r.game.init((r.round-1)%r.game.players.length);r.log=[];
    for(let id=0;id<r.seats.length;id++){r.seats[id].rematch=false;r.game.players[id].isBot=!r.seats[id].token||!r.seats[id].socketId;}
    touch(r);r.lockUntil=Date.now()+moveDuration;addLog(r,`Round ${r.round}. ${r.game.players[r.game.currentPlayerIdx].name} starts.`);
    for(let id=0;id<r.seats.length;id++)if(r.seats[id].socketId)io.to(r.seats[id].socketId).emit('roundStarted',stateFor(r,id));
    scheduleBot(r);
  }
  function releaseSeat(r,id) {
    const seat=r.seats[id];if(r.cheatOwner===id)resetCheat(r);
    if(seat.token){const session=sessions.get(seat.token);if(session){session.roomCode=null;session.seatId=null;}}
    r.seats[id]=emptySeat();r.game.players[id].isBot=true;r.game.players[id].name=`Bot ${id+1}`;
    if(r.hostId===id){const next=r.seats.findIndex(s=>s.token&&s.socketId);const reserved=r.seats.findIndex(s=>s.token);if(next>=0||reserved>=0){r.hostId=next>=0?next:reserved;r.seats[r.hostId].ready=true;}}
  }
  function leave(socket) {
    const session=socket.data.session,r=roomFor(socket);
    if(!r)return;
    if(r.seats[session.seatId]?.socketId===socket.id){clearBot(r);releaseSeat(r,session.seatId);touch(r);broadcast(r);scheduleBot(r);}
    socket.leave(r.code);session.roomCode=null;session.seatId=null;
  }
  function seatSocket(socket,r,id) {
    const session=socket.data.session,seat=r.seats[id];
    seat.token=session.token;seat.socketId=socket.id;seat.disconnectedAt=null;
    session.roomCode=r.code;session.seatId=id;socket.join(r.code);r.game.players[id].isBot=false;
    clearBot(r);touch(r);socket.emit('roomJoined',{playerId:id,state:stateFor(r,id)});broadcast(r);
    if(r.cheatOwner===id)socket.emit('privateMode',{enabled:true,strength:r.game.config.cheatStrength});
    scheduleBot(r);
  }
  io.on('connection',socket=>{
    const supplied=socket.handshake.auth?.sessionToken;
    let session=typeof supplied==='string'&&tokenPattern.test(supplied)?sessions.get(supplied):null;
    if(session?.socketId&&io.sockets.sockets.has(session.socketId)){socket.emit('sessionConflict');socket.disconnect(true);return;}
    if(!session){const token=randomBytes(32).toString('base64url');session={token,roomCode:null,seatId:null,socketId:null,lastSeen:Date.now()};sessions.set(token,session);}
    session.socketId=socket.id;session.lastSeen=Date.now();socket.data.session=session;
    const resumed=rooms.get(session.roomCode);
    socket.emit('hello',{sessionToken:session.token,hasRoom:!!resumed&&resumed.seats[session.seatId]?.token===session.token});
    if(resumed&&resumed.seats[session.seatId]?.token===session.token)seatSocket(socket,resumed,session.seatId);
    let bucket=50,lastRefill=Date.now();
    const handle=(event,fn)=>socket.on(event,(body={},ack)=>{
      if(typeof body==='function'){ack=body;body={};}
      const reply=typeof ack==='function'?ack:()=>{};
      try{
        const now=Date.now();bucket=Math.min(50,bucket+(now-lastRefill)/200);lastRefill=now;
        if(bucket<1)throw new RuleError('Please wait a moment before trying again.');bucket--;
        if(!body||typeof body!=='object'||Array.isArray(body))throw new RuleError('Invalid request.');
        session.lastSeen=now;const result=fn(body);reply({ok:true,...result});
      }catch(error){reply({ok:false,error:error instanceof RuleError?error.message:'That action could not be completed. Try again.'});if(!(error instanceof RuleError))console.error('Request failed:',error.message);}
    });
    handle('createRoom',body=>{
      if(roomFor(socket))throw new RuleError('Leave your current room before creating another.');
      if(rooms.size>=maxRooms)throw new RuleError('All tables are occupied. Please try again shortly.');
      const game=new Game(validateConfig(body.config),randomInt(0,4294967296));
      let code;do{code=Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join('');}while(rooms.has(code));
      game.players[0].name=cleanName(body.name);const now=Date.now();
      const r={code,game,seats:game.players.map(emptySeat),hostId:0,status:'waiting',round:0,version:0,createdAt:now,lastActive:now,cheatOwner:null,log:[],lockUntil:0,botTimer:null};
      r.seats[0].ready=true;rooms.set(code,r);seatSocket(socket,r,0);return{};
    });
    handle('joinRoom',body=>{
      const code=String(body.code||'').trim().toUpperCase();if(!/^[A-Z2-9]{6}$/.test(code))throw new RuleError('Enter the six-character room code.');
      const r=rooms.get(code);if(!r)throw new RuleError('That room has expired or does not exist.');
      const own=r.seats.findIndex(s=>s.token===session.token);
      if(own>=0){seatSocket(socket,r,own);return{};}
      const id=r.seats.findIndex(s=>!s.token);if(id<0)throw new RuleError('This room is full. Disconnected seats are reserved briefly.');
      leave(socket);r.game.players[id].name=cleanName(body.name);r.seats[id].ready=false;seatSocket(socket,r,id);return{};
    });
    handle('ready',body=>{const r=roomFor(socket);if(!r||r.status!=='waiting')throw new RuleError('The round has already started.');r.seats[session.seatId].ready=!!body.ready;touch(r);broadcast(r);return{};});
    handle('startRound',()=>{
      const r=roomFor(socket);if(!r||r.hostId!==session.seatId||r.status!=='waiting')throw new RuleError('Only the host can start the table.');
      if(r.seats.some(s=>s.token&&(!s.socketId||!s.ready)))throw new RuleError('Wait until every player is connected and ready.');startRound(r);return{};
    });
    handle('action',body=>{
      const r=roomFor(socket);if(!r||r.status!=='playing')throw new RuleError('Join a running round first.');
      if(body.version!==r.version)throw new RuleError('The table changed. Please try your move again.');
      if(Date.now()<r.lockUntil)throw new RuleError('Let the current move finish.');
      const pid=session.seatId;if(r.seats[pid]?.socketId!==socket.id)throw new RuleError('Reconnect to your seat.');
      const owner=r.cheatOwner!==null&&r.seats[r.cheatOwner]?.socketId?r.cheatOwner:null;
      let move;if(body.type==='DRAW')move=r.game.performDraw(pid,owner);else if(body.type==='CAPTURE')move=r.game.performCapture(pid,body.cardId);else if(body.type==='DISCARD')move=r.game.performDiscard(pid,body.cardId);else throw new RuleError('Choose a valid move.');
      publishMove(r,move);return{version:r.version};
    });
    handle('sync',()=>{const r=roomFor(socket);if(r)socket.emit('stateUpdate',stateFor(r,session.seatId));return{};});
    handle('privateMode',body=>{
      const r=roomFor(socket);if(!r||r.status!=='playing')return{enabled:false};
      const id=session.seatId;if(r.seats[id]?.socketId!==socket.id)return{enabled:false};
      if(body.enabled===false&&r.cheatOwner===id)r.cheatOwner=null;
      else if(body.enabled===true&&(r.cheatOwner===null||r.cheatOwner===id))r.cheatOwner=id;
      if(r.cheatOwner===id&&['gentle','classic','strong'].includes(body.strength))r.game.config.cheatStrength=body.strength;
      // Ownership never appears in public state or room broadcasts.
      persist();return{enabled:r.cheatOwner===id,strength:r.cheatOwner===id?r.game.config.cheatStrength:'classic'};
    });
    handle('rematch',body=>{
      const r=roomFor(socket);if(!r||r.status!=='finished')throw new RuleError('Finish the current round first.');
      r.seats[session.seatId].rematch=body.ready!==false;touch(r);broadcast(r);
      if(r.seats.every(s=>!s.token||(s.socketId&&s.rematch)))startRound(r);return{};
    });
    handle('leaveRoom',()=>{leave(socket);return{};});
    socket.on('disconnect',()=>{
      if(session.socketId!==socket.id)return;session.socketId=null;session.lastSeen=Date.now();
      const r=roomFor(socket);if(!r)return;const seat=r.seats[session.seatId];if(seat?.socketId!==socket.id)return;
      seat.socketId=null;seat.disconnectedAt=Date.now();r.game.players[session.seatId].isBot=true;clearBot(r);touch(r);broadcast(r);scheduleBot(r);
    });
  });
  const cleanup=setInterval(()=>{
    const now=Date.now();let changed=false;
    for(const r of rooms.values()){
      let roomChanged=false;
      for(let id=0;id<r.seats.length;id++){const s=r.seats[id];if(s.token&&!s.socketId&&s.disconnectedAt!==null&&now-s.disconnectedAt>reconnectGrace){releaseSeat(r,id);roomChanged=true;}}
      if(roomChanged){touch(r);broadcast(r);if(r.status==='finished'&&activeHumans(r)&&r.seats.every(s=>!s.token||(s.socketId&&s.rematch)))startRound(r);else scheduleBot(r);changed=true;}
      const expiry=r.status==='waiting'?7200000:r.status==='finished'?1800000:1200000;
      if(!activeHumans(r)&&now-r.lastActive>expiry){clearBot(r);for(let id=0;id<r.seats.length;id++)releaseSeat(r,id);rooms.delete(r.code);changed=true;}
    }
    for(const [token,s]of sessions)if(!s.socketId&&!s.roomCode&&now-s.lastSeen>7200000)sessions.delete(token);
    if(changed)persist();
  },options.cleanupInterval??10000);cleanup.unref();
  const close=async()=>{closing=true;clearInterval(cleanup);clearTimeout(saveTimer);for(const r of rooms.values())clearBot(r);try{await store.save(snapshot());}catch{console.warn('Final room checkpoint failed.');}await new Promise(resolve=>io.close(resolve));if(httpServer.listening)await new Promise(resolve=>httpServer.close(resolve));};
  return{app,httpServer,io,rooms,sessions,store,close,stateFor,snapshot};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const server=await createApplication();const port=Number(process.env.PORT)||3000;
  server.httpServer.listen(port,'0.0.0.0',()=>console.log(`Daketi is ready on port ${port}. Room storage: ${server.store.kind}.`));
  const shutdown=()=>{server.close().then(()=>process.exit(0)).catch(()=>process.exit(1));setTimeout(()=>process.exit(1),8000).unref();};
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
