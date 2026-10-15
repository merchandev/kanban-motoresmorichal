const {test}=require('node:test');
const assert=require('node:assert/strict');
const {transitionAllowed}=require('../src/shared.cjs');

test('permisos por acción: conductor no termina trabajos ni aprueba garantías',()=>{
 assert.equal(transitionAllowed('driver','to_quality'),false);
 assert.equal(transitionAllowed('driver','to_transfer'),false);
 assert.equal(transitionAllowed('driver','to_workshop'),true);
 assert.equal(transitionAllowed('driver','return_confirm'),true);
 assert.equal(transitionAllowed('warranty','to_transfer'),false);
 assert.equal(transitionAllowed('technician','deliver'),false);
 assert.equal(transitionAllowed('reception','deliver'),true);
 assert.equal(transitionAllowed('chief','to_quality'),true);
 assert.equal(transitionAllowed('admin','unknown'),false);
});

// Solo contra una base desechable: este test crea datos y recorre el ciclo real por HTTP.
test('flujo completo HTTP y PostgreSQL, permisos, retrabajo, stock y tasa',{
 skip:process.env.TF_INTEGRATION!=='1',timeout:120000
},async(t)=>{
 t.after(()=>require('../src/db.cjs').pool.end());
 const base=process.env.TF_TEST_URL||'http://127.0.0.1:3001/api';
 const password=process.env.TF_TEST_PASSWORD;
 const cookies={};
 async function request(role,path,body,method='POST',expected=200){
  const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:cookies[role]||''},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await res.json();assert.equal(res.status,expected,`${role} ${method} ${path}: ${JSON.stringify(value)}`);return value;
 }
 const names={admin:'admin',reception:'recepcion',chief:'jefe',technician:'tecnico',parts:'repuestos',quality:'calidad',wash:'lavado',driver:'conductor',warranty:'garantias'};
 for(const [role,name] of Object.entries(names)){
  const res=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:name+'@tallerflow.local',password})});
  assert.equal(res.status,200);cookies[role]=res.headers.get('set-cookie').split(';')[0];
  const payload=await res.json();assert.ok(Array.isArray(payload.user.transition_actions));
 }
 const get=(path)=>request('admin',path,undefined,'GET');
 const move=(role,id,action,extra={},status=200)=>request(role,`/orders/${id}/transition`,{action,...extra},'POST',status);
 const client=await request('reception','/clients',{name:'Prueba de flujo',phone:'0000000000'},'POST',201);
 const vehicle=await request('reception','/vehicles',{client_id:client.id,plate:'QA-'+Date.now(),brand:'Prueba',model:'QA',year:2026,mileage:100},'POST',201);
 const order=await request('reception','/orders',{client_id:client.id,vehicle_id:vehicle.id,type:'repair',summary:'Prueba completa',inspection:'Inspección documentada'},'POST',201);
 const id=order.id;
 await move('driver',id,'to_transfer',{},403);
 await move('reception',id,'to_quality',{},403);
 await move('reception',id,'to_transfer');
 await move('driver',id,'to_workshop');
 const upload=async(expected)=>{const body=new FormData();body.append('file',new Blob(['%PDF-1.4\nQA\n%%EOF'],{type:'application/pdf'}),'qa.pdf');const res=await fetch(base+`/orders/${id}/attachments`,{method:'POST',headers:{Cookie:cookies.reception},body});assert.equal(res.status,expected);return res.json()};
 const file=await upload(201);
 const download=await fetch(base+`/attachments/${file.id}`,{headers:{Cookie:cookies.reception}});assert.equal(download.status,200);assert.match(await download.text(),/^%PDF/);
 await move('driver',id,'to_quality',{},403);
 await move('chief',id,'to_quality',{},409);
 const users=await get('/users');const tech=users.find(u=>u.role==='technician');
 await request('chief',`/orders/${id}/assign`,{assigned_to:tech.id,bay:'QA-1'});
 await request('technician',`/orders/${id}/tasks`,{description:'Trabajo de prueba'},'POST',201);
 await move('chief',id,'to_quality',{},409);
 let details=await get(`/orders/${id}`);assert.equal(details.tasks[0].status,'pending');
 await request('technician',`/tasks/${details.tasks[0].id}`,{status:'done'},'PATCH');
 await request('reception',`/orders/${id}/quote`,{amount:100,approved:false});
 await request('technician',`/orders/${id}/unblock`,{},'POST',409);
 await move('chief',id,'to_quality',{},409);
 assert.equal((await get(`/orders/${id}`)).quote_approved,false);
 await request('reception',`/orders/${id}/quote`,{amount:100,approved:true});
 const item=await request('parts','/inventory',{sku:'QA-'+Date.now(),name:'Última pieza QA',stock:1,min_stock:0,unit_price:1},'POST',201);
 await request('technician',`/orders/${id}/parts`,{item_id:item.id,quantity:1},'POST',201);
 await move('chief',id,'to_quality',{},409);
 details=await get(`/orders/${id}`);const part=details.parts[0];
 // Dos despachos simultáneos de la misma solicitud: uno debe fallar y descontarse una vez.
 const statuses=await Promise.all([1,2].map(async()=>{const r=await fetch(base+`/parts-requests/${part.id}/fulfill`,{method:'POST',headers:{Cookie:cookies.parts,'Content-Type':'application/json'},body:'{}'});return r.status}));
 assert.deepEqual(statuses.sort(),[200,409]);
 assert.equal((await get('/inventory')).find(x=>x.id===item.id).stock,0);
 await request('technician',`/orders/${id}/block`,{reason:'Comprobar bloqueo',substatus:'paused'});
 await move('chief',id,'to_quality',{},409);
 await request('chief',`/orders/${id}/unblock`,{});
 await move('chief',id,'to_quality');
 await move('quality',id,'quality_pass',{},400);
 await move('quality',id,'quality_reject',{note:'Ajuste requerido'});
 details=await get(`/orders/${id}`);assert.equal(details.station,3);assert.equal(details.reworks,1);assert.equal(details.quality_ok,false);
 await move('chief',id,'to_quality',{},409);
 for(const t of details.tasks.filter(t=>t.status!=='done'))await request('technician',`/tasks/${t.id}`,{status:'done'},'PATCH');
 await move('chief',id,'to_quality');
 await move('quality',id,'quality_pass',{note:'Revisión satisfactoria'});
 await move('wash',id,'wash_complete',{},400);
 await move('wash',id,'wash_complete',{note:'Lavado certificado'});
 await move('reception',id,'deliver',{recipient:'Cliente QA'},409);
 await move('driver',id,'return_confirm');
 await move('driver',id,'return_confirm',{},409);
 // Deshacer un movimiento vuelve a exigir los controles posteriores.
 await move('chief',id,'revert',{station:4,note:'Comprobar devolución'});
 details=await get(`/orders/${id}`);assert.equal(details.quality_ok,false);assert.equal(details.wash_ok,false);assert.equal(details.returned_ok,false);
 await move('quality',id,'quality_pass',{note:'Nueva revisión'});
 await move('wash',id,'wash_complete',{note:'Nuevo lavado'});
 await move('driver',id,'return_confirm');
 // Una tasa de mañana debe aparecer como próxima, jamás como vigente.
 const {q}=require('../src/db.cjs');
 const tomorrow=(await q("SELECT ((now() AT TIME ZONE 'America/Caracas')::date+1)::text AS d")).rows[0].d;
 await q('DELETE FROM exchange_rates');
 await q("INSERT INTO exchange_rates(rate_date,usd,source) VALUES($1,999,'Manual')",[tomorrow]);
 let rate=await get('/exchange-rate');assert.equal(rate.current,null);assert.equal(rate.next.date,tomorrow);
 const today=(await q("SELECT (now() AT TIME ZONE 'America/Caracas')::date::text AS d")).rows[0].d;
 await request('admin','/exchange-rate',{date:today,usd:100},'PUT');
 await move('reception',id,'deliver',{},400);
 await move('reception',id,'deliver',{recipient:'Cliente QA',note:'Constancia'});
 details=await get(`/orders/${id}`);assert.equal(details.status,'closed');assert.equal(Number(details.paid_usd),100);assert.equal(Number(details.paid_ves),10000);assert.equal(details.delivery_recipient,'Cliente QA');
 await request('technician',`/orders/${id}/notes`,{diagnosis:'No permitido'},'PATCH',409);
 await upload(409);
 await move('chief',id,'revert',{station:3,note:'No permitido'},409);
 assert.ok(details.events.some(e=>e.event_type==='order.deliver'));
 const finance=await get('/reports/finance');assert.ok(finance.series.some(day=>day.delivered>0&&day.usd>=100));
 const warrantyOrder=await request('reception','/orders',{client_id:client.id,vehicle_id:vehicle.id,type:'warranty',summary:'Garantía QA',inspection:'Inspección QA'},'POST',201);
 await move('reception',warrantyOrder.id,'to_transfer',{},409);
 const w=await request('warranty','/warranties',{vehicle_id:vehicle.id,policy:'QA'},'POST',201);
 await request('warranty',`/warranties/${w.id}`,{state:'not_eligible',notes:'Rechazada'},'PATCH');
 await move('reception',warrantyOrder.id,'to_transfer',{},409);
 assert.equal((await get(`/orders/${warrantyOrder.id}`)).warranty.state,'not_eligible');
 await request('warranty',`/warranties/${w.id}`,{state:'eligible',notes:'Evaluación aprobada'},'PATCH');
 await move('reception',warrantyOrder.id,'to_transfer');

});
