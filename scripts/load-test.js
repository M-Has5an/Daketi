import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import {server,client,emit,delay} from '../test/helpers.js';
import {analyzeMoveLogic} from '../public/shared/game.js';

const count=Number(process.env.LOAD_ROOMS)||15,seats=6,clients=[],tables=[];
const app=await server(),loop=monitorEventLoopDelay({resolution:10});
let transmitted=0,messages=0,largest=0,peakRss=process.memoryUsage().rss;
const start=performance.now(),cpu=process.cpuUsage();loop.enable();
try{
  for(let n=0;n<count;n++){
    const players=[];
    for(let id=0;id<seats;id++){
      const c=await client(app);clients.push(c);players.push(c);
      c.onAny((event,data)=>{if(['move','stateUpdate','roundStarted'].includes(event)){const size=Buffer.byteLength(JSON.stringify(data));transmitted+=size;largest=Math.max(largest,size);messages++;}});
      if(!id)await emit(c,'createRoom',{name:`Table ${n+1}`,config:{numPlayers:seats}});
      else{await emit(c,'joinRoom',{name:`Player ${id+1}`,code:players[0].state.roomCode});await emit(c,'ready',{ready:true});}
    }
    await emit(players[0],'startRound');tables.push(players);
  }
  let steps=0;
  while(tables.some(players=>app.rooms.get(players[0].state.roomCode).status==='playing')){
    if(steps++>200)throw new Error('Load run did not terminate.');
    await Promise.all(tables.map(async players=>{
      const room=app.rooms.get(players[0].state.roomCode);if(room.status!=='playing')return;
      const c=players[room.game.currentPlayerIdx],state=c.state;if(state.version!==room.version)return;
      const hand=state.players[c.pid].hand,match=hand.find(card=>analyzeMoveLogic(state.faceUpCards,state.players,c.pid,card).canCapture);
      const move=state.turnPhase==='DRAW'?{type:'DRAW'}:{type:match?'CAPTURE':'DISCARD',cardId:(match||hand[0]).id};
      const result=await emit(c,'action',{...move,version:state.version});if(!result.ok)throw new Error(result.error);
    }));
    peakRss=Math.max(peakRss,process.memoryUsage().rss);await delay(20);
  }
  const used=process.cpuUsage(cpu),elapsed=performance.now()-start;
  const report={environment:'Local Windows Node 22; server and synthetic clients share one process. Not a Render capacity guarantee.',rooms:count,concurrentPlayers:clients.length,completedRounds:tables.filter(p=>app.rooms.get(p[0].state.roomCode).status==='finished').length,moves:[...app.rooms.values()].reduce((n,r)=>n+r.game.moveNumber,0),elapsedSeconds:+(elapsed/1000).toFixed(2),peakProcessRssMB:+(peakRss/1024/1024).toFixed(1),cpuSeconds:+((used.user+used.system)/1e6).toFixed(2),eventLoopP95Ms:+(loop.percentile(95)/1e6).toFixed(2),eventLoopMaxMs:+(loop.max/1e6).toFixed(2),personalizedMessages:messages,personalizedPayloadMB:+(transmitted/1024/1024).toFixed(2),largestPayloadBytes:largest};
  console.log(JSON.stringify(report,null,2));if(process.env.LOAD_REPORT)await writeFile(process.env.LOAD_REPORT,JSON.stringify(report,null,2)+'\n');
}finally{loop.disable();for(const c of clients)c.disconnect();await app.close();}
