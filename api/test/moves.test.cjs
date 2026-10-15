const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

// Solo contra una base desechable (scripts/test-flow.sh): mueve órdenes por HTTP y revisa la base después de cada fallo.
test('movimiento encadenado: una sola transacción, reintento seguro y datos confirmados',{
 skip:process.env.TF_INTEGRATION!=='1',timeout:120000
},async(t)=>{
 const {q,pool}=require('../src/db.cjs');t.after(()=>pool.end());
 const base=process.env.TF_TEST_URL||'http://127.0.0.1:3001/api',password=process.env.TF_TEST_PASSWORD,cookies={};
 for(const [role,key] of [['admin','admin'],['reception','recepcion'],['chief','jefe'],['technician','tecnico'],['parts','repuestos'],['driver','conductor']]){
  const res=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:key+'@tallerflow.local',password})});
  assert.equal(res.status,200);cookies[role]=res.headers.get('set-cookie').split(';')[0]}
 const raw=(role,path,body,method='POST')=>fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:cookies[role]||''},...(body===undefined?{}:{body:JSON.stringify(body)})});
 async function call(role,path,body,method='POST',expected=200){const res=await raw(role,path,body,method);const value=await res.json();assert.equal(res.status,expected,`${role} ${method} ${path}: ${JSON.stringify(value)}`);return value}
 const get=path=>call('admin',path,undefined,'GET'),move=(role,id,body,expected=200)=>call(role,`/orders/${id}/move`,body,'POST',expected);
 const opEvents=async op=>(await q("SELECT event_type FROM audit_events WHERE detail->>'operation'=$1 ORDER BY created_at",[op])).rows.map(r=>r.event_type);
 const stamp=Date.now();
 const client=await call('reception','/clients',{name:'Movimientos QA',phone:'0412'+String(stamp).slice(-7)},'POST',201);
 const vehicle=await call('reception','/vehicles',{client_id:client.id,plate:'MV-'+stamp,brand:'Toyota',model:'Corolla'},'POST',201);
 const {id}=await call('reception','/orders',{client_id:client.id,vehicle_id:vehicle.id,type:'repair',summary:'Movimiento QA',inspection:'Sin novedades'},'POST',201);
 // Todo lo que un movimiento puede tocar: si falla, debe quedar idéntico.
 const state=async()=>{const o=await get(`/orders/${id}`);return {station:o.station,substatus:o.substatus,quote_approved:o.quote_approved,assigned_to:o.assigned_to,bay:o.bay,blocked:o.blocked_reason,quality_ok:o.quality_ok,
  tasks:o.tasks.map(x=>`${x.description}:${x.status}`).sort(),events:(await q('SELECT count(*)::int n FROM audit_events WHERE order_id=$1',[id])).rows[0].n,operations:(await q('SELECT count(*)::int n FROM order_operations WHERE order_id=$1',[id])).rows[0].n}};

 // 1. Recepción → Taller de una vez: ambas transiciones quedan en la auditoría con el id de la operación.
 const op1=randomUUID(),toWorkshop={operation_id:op1,from:1,to:3,steps:[{action:'to_transfer'},{action:'to_workshop'}]};
 assert.equal((await move('chief',id,toWorkshop)).station,3);
 assert.deepEqual(await opEvents(op1),['order.to_transfer','order.to_workshop']);
 // Respuesta perdida: el reintento con el mismo id devuelve lo guardado sin repetir nada.
 const again=await move('chief',id,toWorkshop);assert.equal(again.repeated,true);assert.equal(again.station,3);
 assert.deepEqual(await opEvents(op1),['order.to_transfer','order.to_workshop']);
 // Un plan nuevo preparado con la orden aún en Recepción ya no se aplica.
 await move('chief',id,{...toWorkshop,operation_id:randomUUID()},409);
 // Cada paso exige su permiso, también por petición directa.
 await move('driver',id,{operation_id:randomUUID(),from:3,to:4,steps:[{action:'to_quality'}]},403);
 await move('technician',id,{operation_id:randomUUID(),from:3,to:3,steps:[{kind:'quote',amount:0}]},403);
 await move('chief',id,{operation_id:randomUUID(),from:3,steps:[{kind:'constructor'}]},400);
 await move('chief',id,{operation_id:'no-es-uuid',from:3,steps:[{action:'to_quality'}]},400);

 // 2. Taller → Lavado con presupuesto, asignación, tareas, Calidad y evidencia en un solo paso.
 await call('reception',`/orders/${id}/quote`,{amount:80,approved:false});
 await call('technician',`/orders/${id}/tasks`,{description:'Cambiar pastillas'},'POST',201);
 const users=await get('/users'),tech=users.find(u=>u.role==='technician'),reception=users.find(u=>u.role==='reception');
 const taskA=(await get(`/orders/${id}`)).tasks[0].id;
 const plan=(over={})=>({operation_id:randomUUID(),from:3,to:5,steps:[{kind:'quote',amount:80},{kind:'assign',assigned_to:tech.id,bay:'B-7'},{kind:'tasks',task_ids:[taskA]},
  {action:'to_quality'},{action:'quality_pass',note:'Frenos probados'}].map(s=>({...s,...over[s.kind||s.action]}))});
 const item=await call('parts','/inventory',{sku:'MV-'+stamp,name:'Pastillas QA',stock:5,min_stock:0,unit_price:10},'POST',201);
 await call('technician',`/orders/${id}/parts`,{item_id:item.id,quantity:1},'POST',201);
 // Un fallo en cualquier paso (antes, durante o después de los ya válidos) deja la orden exactamente como estaba.
 let before=await state();
 const failsClean=async cases=>{for(const [label,over,status] of cases){await move('chief',id,plan(over),status);assert.deepEqual(await state(),before,label)}};
 await failsClean([['repuesto sin despachar al enviar a Calidad',{},409],['monto distinto del confirmado',{quote:{amount:70}},409],['técnico inválido',{assign:{assigned_to:reception.id}},400],
  ['tarea confirmada que no existe',{tasks:{task_ids:[randomUUID()]}},409]]);
 const request=(await get(`/orders/${id}`)).parts[0];await call('parts',`/parts-requests/${request.id}/reject`,{reason:'Se usará otra referencia'});
 before=await state();await failsClean([['Calidad sin evidencia (último paso)',{quality_pass:{note:''}},400]]);
 // Otro técnico agrega una tarea mientras el jefe confirma solo la que vio: no se termina ninguna ni se avanza.
 await call('technician',`/orders/${id}/tasks`,{description:'Revisar discos'},'POST',201);before=await state();
 const late=await raw('chief',`/orders/${id}/move`,plan());assert.equal(late.status,409);assert.match((await late.json()).error,/Revisar discos/);
 assert.deepEqual(await state(),before);
 const taskB=(await get(`/orders/${id}`)).tasks.find(x=>x.description==='Revisar discos').id;
 const op2=randomUUID(),done=await move('chief',id,{...plan({tasks:{task_ids:[taskA,taskB]}}),operation_id:op2});assert.equal(done.station,5);
 const after=await get(`/orders/${id}`);assert.equal(after.quote_approved,true);assert.equal(after.assigned_to,tech.id);assert.equal(after.bay,'B-7');assert.equal(after.quality_ok,true);
 assert.ok(after.tasks.every(x=>x.status==='done'));
 assert.deepEqual(await opEvents(op2),['order.quote','order.assigned','task.status','task.status','order.to_quality','order.quality_pass']);

 // 3. Dos envíos simultáneos de la misma operación (doble clic, reintento): se aplica una vez.
 const op3=randomUUID(),back={operation_id:op3,from:5,to:3,steps:[{action:'revert',station:3,note:'Devolución QA'}]};
 const both=await Promise.all([1,2].map(()=>raw('chief',`/orders/${id}/move`,back).then(async r=>({status:r.status,body:await r.json()}))));
 assert.deepEqual(both.map(r=>r.status),[200,200]);assert.equal(both.filter(r=>r.body.repeated).length,1);assert.deepEqual(await opEvents(op3),['order.revert']);
 assert.equal((await get(`/orders/${id}`)).station,3);
 // Ese id ya pertenece a esta orden: no sirve para otra.
 const other=await call('reception','/vehicles',{client_id:client.id,plate:'MV2-'+stamp,brand:'Toyota',model:'Yaris'},'POST',201);
 const second=await call('reception','/orders',{client_id:client.id,vehicle_id:other.id,type:'repair',summary:'Otra QA',inspection:'Sin novedades'},'POST',201);
 await move('chief',second.id,{operation_id:op3,from:1,to:2,steps:[{action:'to_transfer'}]},409);

 // 4. El bloqueo confirmado debe ser el mismo que tiene la orden.
 await call('technician',`/orders/${id}/block`,{reason:'Falta herramienta',substatus:'paused'});
 const unblock=reason=>({operation_id:randomUUID(),from:3,to:4,steps:[{kind:'unblock',reason},{action:'to_quality'}]});
 before=await state();await move('chief',id,unblock('Otro motivo'),409);assert.deepEqual(await state(),before);
 assert.equal((await move('chief',id,unblock('Falta herramienta'))).station,4);
 // El plan debe terminar donde dijo; si no, no se guarda nada.
 before=await state();await move('chief',id,{operation_id:randomUUID(),from:4,to:6,steps:[{action:'quality_pass',note:'Aprobado'}]},409);assert.deepEqual(await state(),before);
});
