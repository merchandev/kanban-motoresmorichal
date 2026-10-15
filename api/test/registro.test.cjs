const {test}=require('node:test');
const assert=require('node:assert/strict');

// Solo contra una base desechable (scripts/test-flow.sh): crea registros, clientes, vehículos y órdenes por HTTP.
test('autorregistro por QR: validaciones, reintentos, fotos, identidad, concurrencia y bandeja',{
 skip:process.env.TF_INTEGRATION!=='1',timeout:180000
},async()=>{
 const base=process.env.TF_TEST_URL||'http://127.0.0.1:3001/api',password=process.env.TF_TEST_PASSWORD,cookies={};
 for(const [role,key] of [['admin','admin'],['reception','recepcion']]){
  const res=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:key+'@tallerflow.local',password})});
  assert.equal(res.status,200);cookies[role]=res.headers.get('set-cookie').split(';')[0]}
 const raw=(role,path,body,method='POST')=>fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:cookies[role]||''},...(body===undefined?{}:{body:JSON.stringify(body)})});
 async function call(role,path,body,method='POST',expected=200){const res=await raw(role,path,body,method);const value=await res.json();assert.equal(res.status,expected,`${method} ${path}: ${JSON.stringify(value)}`);return value}
 const get=path=>call('reception',path,undefined,'GET');
 const sharp=require('sharp');const jpeg=(w=640,h=480)=>sharp({create:{width:w,height:h,channels:3,background:{r:20,g:60,b:120}}}).jpeg().toBuffer();
 const cfg=await (await fetch(base+'/public/registration-config')).json();assert.ok(cfg.consent_version&&cfg.consent_text);
 const stamp=String(Date.now()).slice(-6);let n=0;
 const phone=()=>`0414${stamp}${String(++n).padStart(2,'0')}`.slice(0,14);
 async function send(fields,photos={},expected=201){const form=new FormData();
  for(const [k,v] of Object.entries({consent:'true',consent_version:cfg.consent_version,brand:'Toyota',model:'Yaris',problem:'Ruido al frenar',phone:phone(),...fields}))form.append(k,String(v));
  for(const [k,buf] of Object.entries(photos))form.append(k,new Blob([buf],{type:'image/jpeg'}),k+'.jpg');
  const res=await fetch(base+'/public/registrations',{method:'POST',body:form});const body=await res.json();assert.equal(res.status,expected,JSON.stringify(body));return body}
 const findReg=async code=>{const r=await get('/registrations?status=all&q='+code);assert.equal(r.total,1,code);return get('/registrations/'+r.items[0].id)};

 // 1. Validaciones del formulario público.
 await send({name:'Sin autorización',plate:`QR${stamp}X`,consent:'false'},{},400);
 await send({name:'Versión vieja',plate:`QR${stamp}X`,consent_version:'1999-01-01'},{},409);
 await send({name:'Sin placa',plate:''},{},400);
 await send({name:'Foto falsa',plate:`QR${stamp}X`},{vehicle_photo:Buffer.from('no soy una imagen')},400);
 await send({name:'Foto enorme',plate:`QR${stamp}X`},{vehicle_photo:Buffer.alloc(7*1024*1024,1)},413);
 assert.equal((await get(`/registrations?status=all&q=QR${stamp}X`)).total,0);

 // 2. Envío con tres fotos y reintento de la misma clave (respuesta perdida): mismo código y un solo registro.
 const key='8f0e6c1a-1b2c-4d3e-8f00-'+stamp.padStart(12,'0');const photos={profile_photo:await jpeg(500,500),vehicle_photo:await jpeg(),plate_photo:await jpeg(900,300)};
 const fieldsB={name:'Registro Con Fotos',plate:`QR${stamp}B`,phone:phone(),submission_key:key};
 const first=await send(fieldsB,photos);
 const again=await send(fieldsB,photos,200);assert.equal(again.code,first.code);assert.equal(again.repeated,true);
 await send({...fieldsB,problem:'Otro problema distinto'},photos,409);
 const b=await findReg(first.code);assert.ok(b.profile_photo&&b.vehicle_photo&&b.plate_photo);assert.equal(b.consent_version,cfg.consent_version);assert.ok(b.consent_at);
 // Fotos: solo con sesión, sin caché y con miniatura.
 assert.equal((await fetch(base+'/media/'+b.vehicle_photo)).status,401);
 const photo=await fetch(base+'/media/'+b.vehicle_photo,{headers:{Cookie:cookies.reception}});assert.equal(photo.status,200);
 assert.equal(photo.headers.get('content-type'),'image/jpeg');assert.match(photo.headers.get('cache-control'),/no-store/);
 assert.equal((await fetch(base+'/media/'+b.vehicle_photo+'?size=thumb',{headers:{Cookie:cookies.reception}})).status,200);

 // 3. Placa y cliente nuevos: se acepta con OT; aceptar dos veces el mismo registro falla.
 const a=await findReg((await send({name:'Cliente Nuevo QR',plate:`QR${stamp}A`})).code);
 assert.equal(a.candidates.vehicle,null);assert.deepEqual(a.candidates.clients,[]);
 const acc=await call('reception',`/registrations/${a.id}/accept`,{identity:'new',open_order:'true',type:'repair',priority:'normal',inspection:'Sin golpes'});
 assert.ok(acc.order_id&&acc.vehicle_id&&acc.client_id);
 await call('reception',`/registrations/${a.id}/accept`,{identity:'new',open_order:'false'},'POST',409);

 // 4. Placa existente (escrita distinto) traída por otra persona: hay que decidir la identidad; un autorizado no cambia la ficha.
 const owner=await call('reception','/clients',{name:'Dueño De Prueba',phone:phone()},'POST',201);
 await call('reception','/vehicles',{client_id:owner.id,plate:`QR-${stamp}-D`,brand:'Toyota',model:'Hilux'},'POST',201);
 const c=await findReg((await send({name:'Chofer De Prueba',plate:`qr ${stamp} d`,email:'chofer@correo.test'})).code);
 assert.equal(c.candidates.vehicle.plate,`QR-${stamp}-D`);assert.equal(c.candidates.owner.compare.name,'differs');
 await call('reception',`/registrations/${c.id}/accept`,{identity:'new',open_order:'false'},'POST',409);
 await call('reception',`/registrations/${c.id}/accept`,{identity:'authorized',updates:['email'],open_order:'false'},'POST',400);
 const accC=await call('reception',`/registrations/${c.id}/accept`,{identity:'authorized',open_order:'true',type:'diagnostic',inspection:'Revisión'});
 const orderC=await get('/orders/'+accC.order_id);assert.equal(orderC.client_id,owner.id);assert.equal(orderC.dropoff_name,'Chofer De Prueba');
 const ownerAfter=(await get('/clients')).find(x=>x.id===owner.id);assert.equal(ownerAfter.name,'Dueño De Prueba');assert.equal(ownerAfter.email,'');

 // 5. El propietario corrige su ficha: solo cambia lo confirmado.
 const ownerF=await call('reception','/clients',{name:'Propietaria Prueba',phone:phone()},'POST',201);
 await call('reception','/vehicles',{client_id:ownerF.id,plate:`QR${stamp}F`,brand:'Toyota',model:'RAV4',mileage:1000},'POST',201);
 const e=await findReg((await send({name:'Propietaria Prueba Gómez',plate:`QR${stamp}F`,email:'propietaria@correo.test',mileage:5000},{vehicle_photo:await jpeg()})).code);
 await call('reception',`/registrations/${e.id}/accept`,{identity:'owner',updates:['email'],vehicle_updates:['photo','mileage'],open_order:'false'});
 const ownerF2=(await get('/clients')).find(x=>x.id===ownerF.id);assert.equal(ownerF2.email,'propietaria@correo.test');assert.equal(ownerF2.name,'Propietaria Prueba');
 const vehF=(await get('/vehicles')).find(x=>x.plate===`QR${stamp}F`);assert.equal(vehF.mileage,5000);assert.ok(vehF.photo_id);

 // 6. Cliente existente por teléfono con un vehículo nuevo: el vehículo queda en su ficha.
 const k=await findReg((await send({name:'Dueño De Prueba',plate:`QR${stamp}K`,phone:ownerAfter.phone})).code);
 assert.equal(k.candidates.clients[0].id,owner.id);assert.deepEqual(k.candidates.clients[0].matched_by,['teléfono']);
 const accK=await call('reception',`/registrations/${k.id}/accept`,{identity:'existing',client_id:owner.id,open_order:'false'});assert.equal(accK.client_id,owner.id);

 // 7. Concurrencia: dos registros de la misma placa nueva aceptados a la vez → un solo vehículo y una sola OT.
 const g1=await findReg((await send({name:'Concurrente Uno',plate:`QR${stamp}G`})).code),g2=await findReg((await send({name:'Concurrente Dos',plate:`QR-${stamp}-G`})).code);
 const both=await Promise.all([g1,g2].map(g=>raw('reception',`/registrations/${g.id}/accept`,{identity:'new',open_order:'true',type:'repair',inspection:'Prueba'})));
 assert.deepEqual(both.map(r=>r.status).sort(),[200,409]);
 assert.equal((await get('/vehicles')).filter(v=>v.plate.replace(/[^A-Z0-9]/g,'')===`QR${stamp}G`).length,1);
 // Dos autorizados del mismo vehículo existente, con OT, a la vez → una sola OT abierta.
 const ownerH=await call('reception','/clients',{name:'Dueño H',phone:phone()},'POST',201);const vehH=await call('reception','/vehicles',{client_id:ownerH.id,plate:`QR${stamp}H`,brand:'Toyota',model:'Yaris'},'POST',201);
 const h1=await findReg((await send({name:'Chofer H1',plate:`QR${stamp}H`})).code),h2=await findReg((await send({name:'Chofer H2',plate:`QR${stamp}H`})).code);
 const pair=await Promise.all([h1,h2].map(h=>raw('reception',`/registrations/${h.id}/accept`,{identity:'authorized',open_order:'true',type:'repair',inspection:'Prueba'})));
 assert.deepEqual(pair.map(r=>r.status).sort(),[200,409]);
 assert.equal((await get('/orders')).filter(o=>o.vehicle_id===vehH.id&&o.status==='open').length,1);
 // Alta directa de OT simultánea para el mismo vehículo → 201 y 409.
 const vehI=await call('reception','/vehicles',{client_id:ownerH.id,plate:`QR${stamp}I`,brand:'Toyota',model:'Yaris'},'POST',201);
 const direct=await Promise.all([1,2].map(()=>raw('reception','/orders',{client_id:ownerH.id,vehicle_id:vehI.id,type:'repair',summary:'Prueba',inspection:'Prueba'})));
 assert.deepEqual(direct.map(r=>r.status).sort(),[201,409]);
 // Una placa con otro formato no crea un vehículo duplicado por la vía normal.
 await call('reception','/vehicles',{client_id:ownerH.id,plate:`qr-${stamp}-i`,brand:'Toyota',model:'Yaris'},'POST',409);

 // 8. Rechazo y bandeja paginada con totales del servidor.
 const j=await findReg((await send({name:'Registro Rechazado',plate:`QR${stamp}J`})).code);
 await call('reception',`/registrations/${j.id}/reject`,{note:'Duplicado'});
 await call('reception',`/registrations/${j.id}/accept`,{identity:'new',open_order:'false'},'POST',409);
 const page=await get('/registrations?status=all&limit=2&offset=0');assert.equal(page.items.length,2);assert.ok(page.total>=10);assert.ok(page.counts.rejected>=1);
 const pending=await get('/registrations?status=pending&limit=100');assert.equal(pending.total,pending.counts.pending);
 for(let i=1;i<pending.items.length;i++)assert.ok(new Date(pending.items[i-1].created_at)<=new Date(pending.items[i].created_at),'pendientes en orden de llegada');
 const summary=await get('/registrations/summary');assert.equal(summary.pending,pending.counts.pending);

 // 9. Dirección del QR única para el taller: la cambia administración y se normaliza.
 await call('reception','/settings/registration-url',{url:'https://taller.example'},'PUT',403);
 const saved=await call('admin','/settings/registration-url',{url:'https://taller.example/registro/'},'PUT');assert.equal(saved.url,'https://taller.example/registro');
 await call('admin','/settings/registration-url',{url:'ftp://taller.example'},'PUT',400);
 assert.equal((await get('/settings/registration-url')).url,'https://taller.example/registro');
});
