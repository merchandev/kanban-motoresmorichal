'use strict';
const fs=require('node:fs'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
// No crear otra entrada cuando Git prepara un amend o merge sin cambios nuevos.
const changed=git(['diff','--cached','--name-status','--no-renames']).split('\n').filter(Boolean);
if(!changed.length)process.exit(0);
const messageFile=process.argv[2],message=messageFile&&fs.existsSync(messageFile)?fs.readFileSync(messageFile,'utf8').split('\n').find(s=>s.trim()&&!s.startsWith('#')):'Archivos preparados para commit';
const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Caracas',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
const paths=changed.filter(line=>!line.endsWith('\thistorial.md'));
if(!paths.length)process.exit(0);
const patch=execFileSync('git',['diff','--cached','--binary','--','.',':(exclude)historial.md'],{maxBuffer:32*1024*1024});
const fingerprint='<!-- staged:'+createHash('sha256').update(patch).digest('hex')+' -->';
if(fs.existsSync('historial.md')&&fs.readFileSync('historial.md','utf8').includes(fingerprint))process.exit(0);
const entry=`\n### Registro automático — ${date} (America/Caracas)\n\n${message||'Commit de cambios preparados'}\n\n${paths.map(line=>{const [status,...file]=line.split('\t');return '- `'+status+'` — `'+file.join(' → ')+'`';}).join('\n')}\n\n${fingerprint}\n`;
if(!fs.existsSync('historial.md'))fs.writeFileSync('historial.md','# Historial del proyecto\n');
fs.appendFileSync('historial.md',entry);
execFileSync('git',['add','--','historial.md'],{stdio:'inherit'});
