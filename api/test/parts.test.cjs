const {test}=require('node:test');
const assert=require('node:assert/strict');

// Solo contra una base desechable (scripts/test-flow.sh): crea pedidos de piezas y fuerza estados directamente en la base.
test('pedidos de piezas: permisos por rol, estados, correcciones con motivo y transferencias en ambos historiales',{
 skip:process.env.TF_INTEGRATION!=='1',timeout:120000
},async(t)=>{
 const {q,pool}=require('../src/db.cjs');t.after(()=>pool.end());
 const base=process.env.TF_TEST_URL||'http://127.0.0.1:3001/api',password=process.env.TF_TEST_PASSWORD,cookies={};
 for(const [role,key] of [['admin','admin'],['manager','gerencia'],['reception','recepcion'],['chief','jefe'],['technician','tecnico'],['parts','repuestos'],['warranty','garantias']]){
  const res=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:key+'@tallerflow.local',password})});
  assert.equal(res.status,200);cookies[role]=res.headers.get('set-cookie').split(';')[0]}
 async function call(role,path,body,method='POST',expected=200){const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:cookies[role]},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await res.json();assert.equal(res.status,expected,`${role} ${method} ${path}: ${JSON.stringify(value)}`);return value}
 const get=(path,role='admin')=>call(role,path,undefined,'GET');

 // Capacidades que la API entrega a la interfaz (la página Piezas no decide permisos por su cuenta).
 const actions=async role=>(await get('/auth/me',role)).user.part_actions;
 assert.deepEqual(await actions('technician'),['request']);assert.deepEqual(await actions('reception'),[]);assert.deepEqual(await actions('chief'),['request']);
 assert.deepEqual(await actions('parts'),['request','edit','transit','receive','deliver','cancel']);assert.deepEqual(await actions('warranty'),['request','edit','transit','cancel']);
 assert.ok((await actions('manager')).includes('correct'));

 const stamp=Date.now(),users=await get('/users'),tech=users.find(u=>u.role==='technician');
 const client=await call('reception','/clients',{name:'Piezas QA',phone:'0416'+String(stamp).slice(-7)},'POST',201);
 const A=await call('reception','/vehicles',{client_id:client.id,plate:'PZA-'+stamp,brand:'Toyota',model:'Hilux'},'POST',201);
 const B=await call('reception','/vehicles',{client_id:client.id,plate:'PZB-'+stamp,brand:'Toyota',model:'Yaris'},'POST',201);
 const orderA=(await call('reception','/orders',{client_id:client.id,vehicle_id:A.id,type:'repair',summary:'Piezas QA',inspection:'Sin novedades'},'POST',201)).id;
 const body=(extra={})=>({description:'Filtro QA',quantity:1,department:'workshop',responsible_id:tech.id,expected_at:'2026-12-01',warranty:false,vehicle_id:A.id,order_id:String(orderA),...extra});

 // 1. Registrar: recepción no; el mecánico sí, aunque no puede editar ni certificar recepción, entrega o cancelación.
 await call('reception','/part-orders',body(),'POST',403);
 const part=await call('technician','/part-orders',body(),'POST',201);
 await call('technician',`/part-orders/${part.id}`,body({supplier:'Otro'}),'PATCH',403);
 for(const status of ['in_transit','received','cancelled'])await call('technician',`/part-orders/${part.id}/status`,{status,note:'QA'},'POST',403);
 await call('reception',`/part-orders/${part.id}/status`,{status:'in_transit'},'POST',403);
 // 2. Garantías gestiona solo las piezas por garantía, y no certifica la recepción (es de Almacén).
 await call('warranty',`/part-orders/${part.id}/status`,{status:'in_transit'},'POST',403);
 const wPart=await call('warranty','/part-orders',body({warranty:true,warranty_ref:'R-'+stamp}),'POST',201);
 await call('warranty',`/part-orders/${wPart.id}/status`,{status:'in_transit',tracking:'G-'+stamp});
 await call('warranty',`/part-orders/${wPart.id}/status`,{status:'received'},'POST',403);

 // 3. Cada combinación origen → destino. Almacén hace solo las ordinarias; las demás son correcciones de gerencia con motivo.
 const ordinary=new Set(['ordered>in_transit','ordered>received','ordered>cancelled','in_transit>received','in_transit>cancelled','received>delivered','received>cancelled']);
 const states=['ordered','in_transit','received','delivered','cancelled'];
 const force=s=>q(`UPDATE part_orders SET status=$2,received_at=CASE WHEN $2 IN ('received','delivered') THEN now() END,delivered_at=CASE WHEN $2='delivered' THEN now() END,
  delivered_to=CASE WHEN $2='delivered' THEN 'Taller QA' ELSE '' END WHERE id=$1`,[part.id,s]);
 for(const from of states)for(const to of states){if(from===to)continue;const change={status:to,note:'Motivo QA',delivered_to:'Jefe QA'},key=`${from}>${to}`;
  await force(from);await call('parts',`/part-orders/${part.id}/status`,change,'POST',ordinary.has(key)?200:403);
  await force(from);if(!ordinary.has(key))await call('manager',`/part-orders/${part.id}/status`,{...change,note:''},'POST',400);
  await call('manager',`/part-orders/${part.id}/status`,change);
  const last=(await get(`/part-orders/${part.id}/events`)).filter(e=>e.event_type==='part.status').pop();assert.equal(last.detail.correction,ordinary.has(key)?undefined:true,key)}
 // El bucle termina en delivered: fijar received para probar realmente un reintento del mismo estado.
 await force('received');
 await call('parts',`/part-orders/${part.id}/status`,{status:'received'},'POST',409);

 // 4. Deshacer una entrega es una corrección: la entrega anterior queda en la bitácora.
 await force('received');await call('parts',`/part-orders/${part.id}/status`,{status:'delivered',delivered_to:'Mecánico QA'});
 await call('parts',`/part-orders/${part.id}/status`,{status:'received',note:'Error'},'POST',403);
 await call('manager',`/part-orders/${part.id}/status`,{status:'received',note:'Se entregó a otro puesto por error'});
 const fix=(await get(`/part-orders/${part.id}/events`)).filter(e=>e.event_type==='part.status').pop();
 assert.equal(fix.detail.correction,true);assert.equal(fix.detail.previous.delivered_to,'Mecánico QA');assert.ok(fix.detail.previous.delivered_at);
 // 5. Una pieza entregada o cancelada no se edita: se corrige, con motivo, y quedan los valores anteriores y nuevos.
 await force('delivered');
 await call('parts',`/part-orders/${part.id}`,body({supplier:'Proveedor B'}),'PATCH',403);
 await call('manager',`/part-orders/${part.id}`,body({supplier:'Proveedor B'}),'PATCH',400);
 await call('manager',`/part-orders/${part.id}`,body({supplier:'Proveedor B',reason:'Proveedor mal registrado'}),'PATCH');
 const upd=(await get(`/part-orders/${part.id}/events`)).filter(e=>e.event_type==='part.updated').pop();
 assert.deepEqual(upd.detail.values,{proveedor:{from:'',to:'Proveedor B'}});assert.equal(upd.detail.correction,true);assert.equal(upd.detail.reason,'Proveedor mal registrado');

 // 6. El listado trae lo que cada usuario puede hacer con cada pieza (botones de la página Piezas).
 await force('ordered');
 const row=async role=>(await get('/part-orders',role)).find(p=>p.id===part.id).actions;
 assert.deepEqual(await row('parts'),{edit:true,status:[{to:'in_transit',action:'transit'},{to:'received',action:'receive'},{to:'cancelled',action:'cancel'}]});
 assert.deepEqual(await row('technician'),{edit:false,status:[]});assert.deepEqual(await row('warranty'),{edit:false,status:[]});
 assert.equal((await row('manager')).status.find(x=>x.to==='delivered').action,'correct');

 // 7. Transferencia A → B: exige motivo y la trayectoria completa se reconstruye desde cualquiera de los dos vehículos.
 await call('parts',`/part-orders/${part.id}/status`,{status:'in_transit',tracking:'GUIA-'+stamp});
 await call('parts',`/part-orders/${part.id}`,body({supplier:'Proveedor B',vehicle_id:B.id,order_id:''}),'PATCH',400);
 await call('parts',`/part-orders/${part.id}`,body({supplier:'Proveedor B',vehicle_id:B.id,order_id:'',reason:'La Hilux ya no la necesita'}),'PATCH');
 await call('parts',`/part-orders/${part.id}/status`,{status:'received'});
 const [histA,histB]=await Promise.all([get(`/vehicles/${A.id}/history`),get(`/vehicles/${B.id}/history`)]);
 const trail=h=>h.events.filter(e=>e.detail?.part_id===part.id).map(e=>e.id).reverse();
 assert.deepEqual(trail(histA),trail(histB));
 const types=histA.events.filter(e=>e.detail?.part_id===part.id).map(e=>e.event_type);
 assert.ok(types.includes('part.ordered')&&types.includes('part.transferred'));assert.equal(types[0],'part.status');
 const moved=histB.events.find(e=>e.event_type==='part.transferred'&&e.detail.part_id===part.id);
 assert.equal(moved.detail.from_vehicle_id,A.id);assert.equal(moved.detail.from_plate,'PZA-'+stamp);assert.equal(moved.detail.vehicle_id,B.id);assert.equal(moved.detail.plate,'PZB-'+stamp);
 assert.equal(String(moved.detail.from_order_id),String(orderA));assert.equal(moved.detail.reason,'La Hilux ya no la necesita');assert.equal(moved.detail.status,'in_transit');assert.equal(moved.actor_role,'parts');
 // La pieza ya es de B; la orden anterior conserva el aviso de la transferencia.
 assert.ok(histB.parts.some(p=>p.id===part.id));assert.ok(!histA.parts.some(p=>p.id===part.id));
 const oa=await get(`/orders/${orderA}`);assert.ok(!oa.part_orders.some(p=>p.id===part.id));assert.ok(oa.events.some(e=>e.event_type==='part.transferred'&&e.detail.part_id===part.id));
 // Cambiar otros datos no es una transferencia ni pide motivo.
 await call('parts',`/part-orders/${part.id}`,body({supplier:'Proveedor C',vehicle_id:B.id,order_id:''}),'PATCH');
 assert.equal((await get(`/part-orders/${part.id}/events`)).filter(e=>e.event_type==='part.transferred').length,1);
});
