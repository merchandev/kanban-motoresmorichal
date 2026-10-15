'use strict';
// Windows/Linux/macOS. No usa .env ni accede a contenedores/volúmenes existentes.
const {spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),id=`tallerflow-qa-${Date.now()}-${process.pid}`,image=`${id}:test`,password='QA_flow_only_2026';
const made=[];let network=false,failed=false;
function docker(args,{capture=false,input,allowFailure=false}={}){
 const r=spawnSync('docker',args,{cwd:root,input,encoding:capture?'utf8':undefined,maxBuffer:64*1024*1024,stdio:capture||input?['pipe','pipe','pipe']:'inherit'});
 if(r.error)throw r.error;
 if(r.status!==0&&!allowFailure)throw Error(`Docker falló (${args.slice(0,3).join(' ')}): ${(r.stderr||'').toString()}`);
 return capture?String(r.stdout||'').trim():r;
}
async function ready(name,args){for(let i=0;i<60;i++){
 const r=docker(['exec',name,...args],{input:Buffer.alloc(0),allowFailure:true});if(r.status===0)return;
 await new Promise(r=>setTimeout(r,1000));
 }docker(['logs','--tail','30',name]);throw Error('No inició el contenedor de prueba '+name);}
async function main(){try{
 docker(['info','--format','{{.ServerVersion}}']);
 docker(['build','-t',image,'./api']);
 docker(['network','create',id]);network=true;
 docker(['run','-d','--name',id+'-db','--network',id,'--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_PASSWORD='+password,'-e','POSTGRES_DB=tallerflow','-e','POSTGRES_USER=tallerflow','postgres:16-alpine']);made.push(id+'-db');
 await ready(id+'-db',['pg_isready','-U','tallerflow','-d','tallerflow']);
 docker(['run','-d','--name',id+'-api','--network',id,
  '-e',`DATABASE_URL=postgresql://tallerflow:${password}@${id}-db:5432/tallerflow`,
  '-e','ADMIN_EMAIL=admin@tallerflow.local','-e','ADMIN_PASSWORD='+password,'-e','DEMO_PASSWORD='+password,
  '-e','SEED_DEMO=true','-e','COOKIE_SECURE=false','-e','UPLOAD_DIR=/tmp/qa-uploads',
  '-e','REGISTRATION_BURST_PER_MIN=1000','-e','REGISTRATION_PER_HOUR=10000',
  '--mount',`type=bind,source=${path.join(root,'api','test')},target=/app/test,readonly`,image]);made.push(id+'-api');
 await ready(id+'-api',['node','-e',"fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]);
 const tests=fs.readdirSync(path.join(root,'api','test')).filter(n=>n.endsWith('.test.cjs')).sort().map(n=>'test/'+n);
 docker(['exec','-e','TF_INTEGRATION=1','-e','TF_TEST_PASSWORD='+password,id+'-api','node','--test','--test-concurrency=1',...tests]);
 const archive=docker(['exec',id+'-api','tar','-czf','-','-C','/tmp/qa-uploads','.'],{input:Buffer.alloc(0)}).stdout;
 docker(['exec','-i',id+'-api','sh','-ec','cat > /tmp/uploads-qa.tgz; mkdir /tmp/uploads-restored; tar -xzf /tmp/uploads-qa.tgz -C /tmp/uploads-restored'],{input:archive});
 docker(['exec',id+'-db','sh','-ec','pg_dump -U tallerflow -d tallerflow -Fc > /tmp/qa.dump; createdb -U tallerflow qa_restored; pg_restore --exit-on-error -U tallerflow -d qa_restored /tmp/qa.dump']);
 const tables=['users','clients','vehicles','orders','tasks','inventory','inventory_movements','parts_requests','part_orders','media','client_registrations','audit_events','order_operations','attachments','app_settings','client_tracking'];
 const sql="SELECT json_build_object("+tables.map(t=>`'${t}',(SELECT count(*) FROM ${t})`).join(',')+')::text';
 const count=db=>docker(['exec',id+'-db','psql','-U','tallerflow','-d',db,'-Atc',sql],{capture:true});
 if(count('tallerflow')!==count('qa_restored'))throw Error('La restauración no coincide con las tablas originales');
 const names=docker(['exec',id+'-db','psql','-U','tallerflow','-d','qa_restored','-Atc','SELECT stored_name FROM media UNION ALL SELECT thumb_name FROM media WHERE thumb_name IS NOT NULL UNION ALL SELECT stored_name FROM attachments'],{capture:true}).split('\n').filter(Boolean);
 for(const name of names){if(!/^[a-zA-Z0-9._-]+$/.test(name))throw Error('Nombre de archivo inesperado');
  const sha=dir=>docker(['exec',id+'-api','sha256sum',dir+'/'+name],{capture:true}).split(/\s/)[0];
  if(sha('/tmp/qa-uploads')!==sha('/tmp/uploads-restored'))throw Error('Archivo restaurado diferente: '+name);
 }
 console.log(`Restauración verificada: ${tables.length} tablas y ${names.length} archivos por SHA-256.`);
 console.log('Flujo completo, fotos, autorregistro, permisos, movimientos, piezas y restauración: correctos.');
 }catch(err){failed=true;console.error(err.message);for(const name of made.filter(n=>n.endsWith('-api')))docker(['logs','--tail','20',name],{allowFailure:true});}
 finally{for(const name of made.reverse())docker(['rm','-f',name],{allowFailure:true});if(network)docker(['network','rm',id],{allowFailure:true});docker(['image','rm',image],{allowFailure:true});}
 if(failed)process.exitCode=1;
}
main().catch(err=>{console.error(err.message);process.exitCode=1});
