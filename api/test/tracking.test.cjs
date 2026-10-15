'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');

test('QR compartido: acceso público acotado, estado actual, permisos y renovación',{
 skip:process.env.TF_INTEGRATION!=='1',timeout:120000
},async t=>{
 const {q,pool}=require('../src/db.cjs');t.after(()=>pool.end());
 const base=process.env.TF_TEST_URL||'http://127.0.0.1:3001/api',password=process.env.TF_TEST_PASSWORD,cookies={};
 for(const [role,name] of [['admin','admin'],['reception','recepcion'],['technician','tecnico']]){
  const r=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:name+'@tallerflow.local',password})});
  assert.equal(r.status,200);cookies[role]=r.headers.get('set-cookie').split(';')[0];
 }
 async function call(role,path,body,method='POST',expected=200){
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:cookies[role]||''},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const out=await r.json();assert.equal(r.status,expected,JSON.stringify(out));return out;
 }
 async function view(token,expected=200){const r=await fetch(base+'/public/tracking',{headers:{'X-Tracking-Token':token}});assert.equal(r.status,expected);assert.equal(r.headers.get('cache-control'),'no-store');return r.json()}
 const stamp=Date.now(),client=await call('reception','/clients',{name:'QR confidencial',phone:'04125559999',email:'secreto@example.test',document:'V-99999999'},'POST',201);
 const car=async(c,tag)=>call('reception','/vehicles',{client_id:c.id,plate:'QR'+tag+stamp,brand:'Toyota',model:'Corolla'},'POST',201);
 const first=await car(client,'A'),second=await car(client,'B');
 const other=await call('reception','/clients',{name:'Otro propietario',phone:'04121112222'},'POST',201),foreign=await car(other,'C');
 const order=await call('reception','/orders',{client_id:client.id,vehicle_id:first.id,type:'repair',summary:'No publicar el trabajo',inspection:'Inspección privada',notes:'Notas privadas'},'POST',201);
 await call('',`/clients/${client.id}/tracking`,{},'POST',401);
 await call('technician',`/clients/${client.id}/tracking`,{},'POST',403);
 const links=await Promise.all([call('reception',`/clients/${client.id}/tracking`,{}),call('admin',`/clients/${client.id}/tracking`,{})]);
 assert.equal(links[0].path,links[1].path,'Un QR estable por cliente');
 assert.match(links[0].path,/^\/seguimiento#[A-Za-z0-9_-]{43}$/);
 const token=links[0].path.split('#')[1];
 let out=await view(token);assert.deepEqual(out.vehicles.map(v=>v.id).sort(),[first.id,second.id].sort());assert.ok(!out.vehicles.some(v=>v.id===foreign.id));
 const publicKeys=['id','plate','brand','model','year','code','station','status','substatus','updated_at','closed_at','blocked'].sort();
 for(const v of out.vehicles)assert.deepEqual(Object.keys(v).sort(),publicKeys);
 assert.equal(out.vehicles.find(v=>v.id===second.id).status,null);
 for(const station of [1,2,3,4,5,6]){
  await q("UPDATE orders SET station=$1,substatus='active',updated_at=now() WHERE id=$2",[station,order.id]);
  out=await view(token);assert.equal(out.vehicles.find(v=>v.id===first.id).station,station);
 }
 const text=JSON.stringify(out);for(const secret of ['QR confidencial','04125559999','V-99999999','secreto@example.test','No publicar el trabajo','Inspección privada','Notas privadas'])assert.ok(!text.includes(secret));
 await q("UPDATE orders SET status='closed',substatus='closed',closed_at=now(),updated_at=now() WHERE id=$1",[order.id]);
 assert.equal((await view(token)).vehicles.find(v=>v.id===first.id).status,'closed');
 // El mismo QR sigue sirviendo en una visita nueva y prioriza la orden abierta.
 const next=await call('reception','/orders',{client_id:client.id,vehicle_id:first.id,type:'repair',summary:'Segunda visita',inspection:'Inspección'},'POST',201);
 assert.equal((await view(token)).vehicles.find(v=>v.id===first.id).station,1);
 await q("UPDATE orders SET status='cancelled',updated_at=now() WHERE id=$1",[next.id]);
 assert.equal((await view(token)).vehicles.find(v=>v.id===first.id).status,'cancelled');
 await view('invalid',404);await view('a'.repeat(43),404);
 await call('', '/public/tracking',{},'POST',401);
 const rotated=await call('reception',`/clients/${client.id}/tracking`,{rotate:true});assert.notEqual(rotated.path,links[0].path);await view(token,404);
 const current=rotated.path.split('#')[1];await view(current);
 await q('UPDATE vehicles SET deleted_at=now() WHERE id=$1',[second.id]);assert.equal((await view(current)).vehicles.length,1);
 await q('UPDATE clients SET deleted_at=now() WHERE id=$1',[client.id]);await view(current,404);
 await q('UPDATE clients SET deleted_at=NULL WHERE id=$1',[client.id]);
 // La auditoría conserva el hecho y no el enlace secreto.
 const events=(await q("SELECT detail FROM audit_events WHERE event_type LIKE 'tracking.%' AND detail->>'client_id'=$1",[client.id])).rows;
 assert.equal(events.length,2);assert.ok(!JSON.stringify(events).includes(current));
});
