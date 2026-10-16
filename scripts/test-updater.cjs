'use strict';
// Solo crea y elimina recursos QA propios; ejecuta el actualizador real en Linux.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), project=`tallerflow-update-qa-${Date.now()}`;
const envFile=path.join(os.tmpdir(),project+'.env'), state=project+'-state', password='QA_update_only_2026';
function docker(args,capture=false){const r=spawnSync('docker',args,{encoding:'utf8',stdio:capture?'pipe':'inherit',maxBuffer:16*1024*1024});if(r.error)throw r.error;if(r.status)throw Error('Docker falló: '+args.slice(0,3).join(' '));return capture?r.stdout.trim():'';}
const compose=['compose','--env-file',envFile,'-p',project,'-f',path.join(root,'compose.yaml')];
function inspect(service){return JSON.parse(docker(['inspect',project+'-'+service+'-1'],true))[0];}
async function main(){
 fs.writeFileSync(envFile,`HTTP_PORT=0\nBIND_IP=127.0.0.1\nPOSTGRES_PASSWORD=${password}\nADMIN_EMAIL=admin@tallerflow.local\nADMIN_PASSWORD=${password}\nDEMO_PASSWORD=${password}\nSEED_DEMO=true\n`,{mode:0o600});
 try{
  docker([...compose,'up','-d','--build','--wait','--wait-timeout','150']);
  const before={db:inspect('db'),api:inspect('api'),web:inspect('web')};
  const port=before.web.NetworkSettings.Ports['80/tcp'][0].HostPort,url='http://127.0.0.1:'+port;
  const snapshot=()=>docker(['exec',project+'-db-1','pg_dump','-U','tallerflow','--data-only','--inserts','tallerflow'],true).split('\n').filter(l=>l.startsWith('INSERT INTO')).sort().join('\n');
  const data=snapshot(); assert.ok(data.length>0);
  docker(['exec',project+'-api-1','sh','-c','printf upload-preserved > /data/uploads/updater-qa.txt']);
  docker(['run','--rm','--mount','type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock','--mount',`type=bind,source=${root},target=/source,readonly`,'--mount',`type=volume,source=${state},target=/state`,'docker:29-cli','sh','-ec',`apk add --no-cache python3 git >/dev/null; python3 /source/scripts/update-production.py --directory /state --project ${project}`]);
  assert.equal(inspect('db').Id,before.db.Id,'PostgreSQL no se recrea');
  assert.equal(inspect('web').NetworkSettings.Ports['80/tcp'][0].HostPort,port);
  for(const service of ['db','api','web'])assert.deepEqual(inspect(service).Mounts.filter(m=>m.Type==='volume').map(m=>m.Name).sort(),before[service].Mounts.filter(m=>m.Type==='volume').map(m=>m.Name).sort());
  assert.equal(snapshot(),data,'Todos los registros conservados');
  assert.equal(docker(['exec',project+'-api-1','cat','/data/uploads/updater-qa.txt'],true),'upload-preserved');
  for(const route of ['/api/health','/seguimiento'])assert.equal((await fetch(url+route)).status,200);
  assert.equal((await fetch(url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:url},body:JSON.stringify({email:'admin@tallerflow.local',password})})).status,200);
  docker(['run','--rm','--mount',`type=volume,source=${state},target=/state,readonly`,'postgres:16-alpine','sh','-ec','pg_restore --list /state/backups/*/database.dump >/dev/null; tar -tzf /state/backups/*/uploads.tgz | grep updater-qa.txt']);
  console.log('Actualizador verificado: mismas filas, credenciales, archivos, puerto, volúmenes y contenedor PostgreSQL; respaldos legibles; HTTP correcto.');
 }finally{
  docker([...compose,'down','--volumes']);
  docker(['volume','rm',state]);
  fs.unlinkSync(envFile);
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
