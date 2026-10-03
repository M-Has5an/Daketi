import {createRequire} from 'node:module';
import path from 'node:path';
import {createApplication} from '../server.js';
const require=createRequire(import.meta.url);
// Exercise the same real Socket.IO browser bundle shipped to players, using Node's WebSocket.
export const {io}=require(path.resolve(path.dirname(require.resolve('socket.io')),'../client-dist/socket.io.js'));
export const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function until(predicate,timeout=4000){const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)throw new Error('Timed out waiting for state.');await delay(10);}}
export async function server(options={}){const app=await createApplication({botDelay:60000,moveDuration:0,...options});await new Promise(resolve=>app.httpServer.listen(0,'127.0.0.1',resolve));app.url=`http://127.0.0.1:${app.httpServer.address().port}`;return app;}
export async function client(app,token){const c=io(app.url,{transports:['websocket'],forceNew:true,reconnection:false,autoConnect:false,auth:{sessionToken:token}});c.events=[];c.onAny((name,...args)=>{c.events.push({name,data:args[0]});if(name==='hello')c.token=args[0].sessionToken;if(name==='roomJoined'){c.pid=args[0].playerId;c.state=args[0].state;}if(name==='stateUpdate'||name==='roundStarted')c.state=args[0];if(name==='move')c.state=args[0].state;});c.connect();await until(()=>c.token);return c;}
export const emit=(c,event,body={})=>new Promise((resolve,reject)=>c.timeout(3000).emit(event,body,(error,result)=>error?reject(error):resolve(result)));
export async function table(app,config={}){const a=await client(app),b=await client(app);await emit(a,'createRoom',{name:'Host',config});await emit(b,'joinRoom',{code:a.state.roomCode,name:'Friend'});await emit(b,'ready',{ready:true});await emit(a,'startRound');await until(()=>a.state?.status==='playing'&&b.state?.status==='playing');return[a,b];}
