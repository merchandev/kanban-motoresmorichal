'use strict';
const {execFileSync}=require('node:child_process');
const files=execFileSync('git',['diff','--cached','--name-only','--diff-filter=ACM','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const file of files){
 if(/(^|\/)\.env(?:\.|$)/.test(file)&&!['.env.example','.env.vps.example'].includes(file))throw Error('No se permite versionar configuración secreta: '+file);
 if(/(^|\/)(backups|node_modules|uploads)\//.test(file)||/\.(dump|tgz|key)$/.test(file))throw Error('Archivo privado o generado: '+file);
 if(!/\.(webp|png|jpe?g|woff2?|ico)$/.test(file)){
  const value=execFileSync('git',['show',':'+file],{encoding:'utf8',maxBuffer:16*1024*1024});
  if(/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/.test(value))throw Error('Se detectó una clave privada en '+file);
 }
}
