import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

// Storage is optional. The game itself has no database dependency.
export class RoomStore {
  constructor({ url=process.env.UPSTASH_REDIS_REST_URL, token=process.env.UPSTASH_REDIS_REST_TOKEN, file=process.env.ROOM_STORE_FILE, namespace=process.env.ROOM_STORE_NAMESPACE || 'daketi:v2' }={}) {
    if (!!url !== !!token) throw new Error('Set both Upstash REST environment variables.');
    if (url && !url.startsWith('https://')) throw new Error('The room store must use HTTPS.');
    Object.assign(this,{url,token,file,namespace,queue:Promise.resolve()});
    this.kind=url?'redis':file?'file':'memory';
  }
  async command(body) {
    const response=await fetch(this.url,{method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw new Error(`Room store returned ${response.status}.`);
    const data=await response.json();if(data.error)throw new Error('Room storage is unavailable.');return data.result;
  }
  async load() {
    if(this.url){const raw=await this.command(['GET',`${this.namespace}:snapshot`]);return raw?JSON.parse(raw):[];}
    if(this.file){try{return JSON.parse(await readFile(this.file,'utf8'));}catch(error){if(error.code==='ENOENT')return[];throw error;}}
    return[];
  }
  save(rooms) {
    if(this.kind==='memory')return Promise.resolve();
    // One checkpoint per debounce, not one external request per player or animation frame.
    const data=JSON.stringify(rooms);
    const run=async()=>{
      if(this.url)await this.command(['SET',`${this.namespace}:snapshot`,data,'EX',86400]);
      else{await mkdir(path.dirname(this.file),{recursive:true});await writeFile(`${this.file}.tmp`,data,{mode:0o600});await rename(`${this.file}.tmp`,this.file);}
    };
    this.queue=this.queue.catch(()=>{}).then(run);return this.queue;
  }
}
