import {cp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const backend=process.env.DAKETI_API_URL;
if(!backend||!/^https:\/\/[^/]+\/?$/.test(backend))throw new Error('Set DAKETI_API_URL to your backend HTTPS origin.');
await mkdir('dist',{recursive:true});await cp('public','dist',{recursive:true});
await writeFile(path.join('dist','config.js'),`window.DAKETI_CONFIG = ${JSON.stringify({apiUrl:backend.replace(/\/$/,'')})};\n`);
console.log('Static frontend prepared in dist/. Allow its origin on the backend.');
