'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
for(const dir of ['api/src','api/test','scripts'])for(const name of fs.readdirSync(dir))if(name.endsWith('.cjs'))execFileSync(process.execPath,['--check',path.join(dir,name)],{stdio:'inherit'});
console.log('Sintaxis CJS verificada en API, pruebas y scripts.');
