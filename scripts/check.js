import {SourceTextModule} from 'node:vm';
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function files(dir){const list=[];for(const e of await readdir(dir,{withFileTypes:true})){if(['node_modules','.git','old','vendor'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())list.push(...await files(p));else if(p.endsWith('.js'))list.push(p);}return list;}
for(const file of await files(root)){try{new SourceTextModule(await readFile(file,'utf8'),{identifier:file});}catch(error){console.error(error.message);process.exit(1);}}
console.log('JavaScript syntax checks passed.');
