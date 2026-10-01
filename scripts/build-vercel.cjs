const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'vercel-public');
fs.mkdirSync(out,{recursive:true});
for(const name of fs.readdirSync(root)){
 if(name==='index.html'||/\.(css|js|mjs)$/.test(name)||name==='pk-bom.json')fs.copyFileSync(path.join(root,name),path.join(out,name));
}
fs.cpSync(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});
console.log('Static app prepared in vercel-public');
