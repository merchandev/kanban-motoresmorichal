'use strict';
// Ensayo local del perfil VPS, con proyecto nuevo, puerto efímero en loopback y sin datos demo.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const id=`tallerflow-vps-qa-${Date.now()}`,root=path.resolve(__dirname,'..'),envFile=path.join(os.tmpdir(),id+'.env'),password='QA_vps_only_2026';
const composeFile=process.argv[2]||'compose.yaml';
assert.ok(['compose.yaml','compose.vps.yaml'].includes(composeFile));
const base=['compose','--env-file',envFile,'-f',composeFile,'-p',id];let created=false;
function docker(args,capture=false){const r=spawnSync('docker',args,{cwd:root,encoding:capture?'utf8':undefined,stdio:capture?'pipe':'inherit',maxBuffer:16*1024*1024});if(r.error)throw r.error;if(r.status!==0)throw Error('Docker: '+args.slice(0,4).join(' ')+' '+String(r.stderr||''));return capture?r.stdout.trim():r;}
async function main(){fs.writeFileSync(envFile,`COMPOSE_PROJECT_NAME=${id}\nHTTP_PORT=0\nBIND_IP=127.0.0.1\nPOSTGRES_PASSWORD=${password}\nADMIN_EMAIL=admin@tallerflow.local\nADMIN_PASSWORD=${password}\nSEED_DEMO=false\nCOOKIE_SECURE=false\n`,{mode:0o600});
 try{docker([...base,'config','--quiet']);
  const defaults=JSON.parse(docker([...base,'config','--format','json'],true));
  assert.equal(defaults.services.web.environment.SITE_ADDRESS,':80');
  assert.equal(defaults.services.web.ports.length,1);
  assert.equal(defaults.services.web.ports[0].target,80);
  created=true;docker([...base,'up','-d','--build','--wait','--wait-timeout','120']);
  const ids=docker([...base,'ps','-q'],true).split(/\r?\n/);assert.equal(ids.length,3);
  const containers=JSON.parse(docker(['inspect',...ids],true));
  for(const c of containers){assert.equal(c.Config.Labels['com.docker.compose.project'],id);assert.equal(c.Config.Labels['traefik.enable'],'false');assert.ok(c.HostConfig.Memory>0);assert.ok(c.HostConfig.NanoCpus>0);
   const bindings=c.HostConfig.PortBindings||{};if(c.Config.Labels['com.docker.compose.service']==='web'){assert.deepEqual(Object.keys(bindings),['80/tcp']);assert.equal(bindings['80/tcp'][0].HostIp,'127.0.0.1');}else assert.equal(Object.keys(bindings).length,0);
   for(const m of c.Mounts.filter(m=>m.Type==='volume'))assert.ok(m.Name.startsWith(id+'_'));
  }
  const address=docker([...base,'port','web','80'],true),url='http://'+address;
  for(const route of ['/','/registro','/api/health','/api/public/registration-config']){const res=await fetch(url+route);assert.equal(res.status,200,route);}
  const login=await fetch(url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:url},body:JSON.stringify({email:'admin@tallerflow.local',password})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/i);assert.doesNotMatch(cookie,/;\s*Secure/i);
  const users=await fetch(url+'/api/users',{headers:{Cookie:cookie.split(';')[0]}});assert.equal(users.status,200);assert.equal((await users.json()).length,1,'No deben existir cuentas demo');
  console.log('Perfil VPS verificado: 3 servicios aislados, solo web publicada, límites activos, login y registro públicos correctos, sin cuentas demo.');
 }finally{if(created)docker([...base,'down','--volumes']);fs.unlinkSync(envFile);}
}
main().catch(err=>{console.error(err);process.exitCode=1});
