import test from 'node:test';
import assert from 'node:assert/strict';
import {server,client,emit,io,until} from './helpers.js';

test('public assets and health endpoint have appropriate cache and security headers',async t=>{
  const app=await server();t.after(()=>app.close());
  const health=await fetch(`${app.url}/health`);assert.deepEqual(await health.json(),{ok:true,version:'2.0.0'});assert.equal(health.headers.get('cache-control'),'no-store');
  const page=await fetch(app.url),clientFile=await fetch(`${app.url}/client.js`),css=await fetch(`${app.url}/style.css`),vendor=await fetch(`${app.url}/vendor/socket.io.esm.min.js`);
  assert.equal(page.status,200);assert.equal(vendor.status,200);assert.equal(clientFile.headers.get('cache-control'),'no-cache');assert.equal(css.headers.get('cache-control'),'no-cache');assert.equal(page.headers.get('x-content-type-options'),'nosniff');assert.equal(page.headers.get('x-frame-options'),'DENY');assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);
  assert.equal((await fetch(`${app.url}/.env`)).status,404);assert.equal((await fetch(`${app.url}/.data/rooms.json`)).status,404);
});
test('static-host origin is allowed and an unrelated browser origin is rejected',async t=>{
  const app=await server({allowedOrigins:'https://table.example'});t.after(()=>app.close());
  for(const [origin,ok]of [['https://table.example',true],['https://unrelated.example',false]]){
    const response=await fetch(`${app.url}/socket.io/?EIO=4&transport=polling`,{headers:{Origin:origin}});assert.equal(response.status,ok?200:403);if(ok)assert.equal(response.headers.get('access-control-allow-origin'),origin);
  }
});
test('room and request limits reject excess traffic without breaking a live session',async t=>{
  const app=await server({maxRooms:1}),a=await client(app),b=await client(app);t.after(()=>{a.disconnect();b.disconnect();return app.close();});await emit(a,'createRoom',{});assert.equal((await emit(b,'createRoom',{})).ok,false);
  const replies=[];for(let i=0;i<60;i++)replies.push(await emit(b,'sync'));assert.equal(replies.some(r=>!r.ok&&r.error.includes('wait a moment')),true);assert.equal(app.rooms.size,1);assert.equal(a.connected,true);
});
