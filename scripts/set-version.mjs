import {readFileSync,writeFileSync} from 'node:fs';
const version=process.argv[2];
if(!/^\d+\.\d+\.\d+$/.test(version||''))throw Error('Usage: npm run version:set -- 0.2.1');
const edits=new Map();
for(const path of ['package.json','package-lock.json','src-tauri/tauri.conf.json']){
  const json=JSON.parse(readFileSync(path,'utf8'));json.version=version;
  if(path==='package-lock.json')json.packages[''].version=version;
  edits.set(path,JSON.stringify(json,null,2)+'\n');
}
for(const path of ['src-tauri/Cargo.toml','src-tauri/Cargo.lock']){
  const text=readFileSync(path,'utf8');
  const pattern=path.endsWith('.lock')?/(name = "lightweight-discord-client"\r?\nversion = ")[^"]+("\r?\n)/:/(\[package\][\s\S]*?\r?\nversion = ")[^"]+(")/;
  if(!pattern.test(text))throw Error(`Package version missing: ${path}`);
  edits.set(path,text.replace(pattern,(_,a,b)=>a+version+b));
}
for(const [path,text] of edits)writeFileSync(path,text);
console.log(`All package versions set to ${version}.`);
