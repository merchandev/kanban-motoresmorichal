const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');const bcrypt=require('bcryptjs');
const {pool,q,tx}=require('./db.cjs');
async function boot(){
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL obligatorio');
 await q(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
 const email=(process.env.ADMIN_EMAIL||'admin@tallerflow.local').toLowerCase();
 const pass=process.env.ADMIN_PASSWORD||'';
 const existing=await q('SELECT count(*)::int AS n FROM users WHERE role=$1',['admin']);
 if(!existing.rows[0].n){if(pass.length<12)throw Error('Defina ADMIN_PASSWORD con al menos 12 caracteres');
 await q('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)',[randomUUID(),'Administrador',email,await bcrypt.hash(pass,12),'admin']);console.log('Administrador creado:',email)}
 if(process.env.SEED_DEMO==='true') await seed();
 console.log('Esquema listo');
}
async function seed(){
 if((await q('SELECT count(*)::int n FROM orders')).rows[0].n>0){console.log('Datos demo ya existentes; se conservan');return}
 const dp=process.env.DEMO_PASSWORD||'';
 if(dp.length<12)throw Error('SEED_DEMO=true requiere DEMO_PASSWORD de al menos 12 caracteres');
 const userNames=[['Recepción','recepcion','reception'],['Jefe de taller','jefe','chief'],['Mecánico','tecnico','technician'],['Repuestos','repuestos','parts'],['Control de calidad','calidad','quality'],['Lavado','lavado','wash'],['Conductor','conductor','driver'],['Garantías','garantias','warranty'],['Gerencia','gerencia','manager']];
 const ids={};const hash=await bcrypt.hash(dp,12);
 for(const [name,key,role] of userNames){const email=`${key}@tallerflow.local`;
 const found=await q('SELECT id FROM users WHERE email=$1',[email]);if(found.rows[0])ids[key]=found.rows[0].id;else{ids[key]=randomUUID();await q('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)',[ids[key],name,email,hash,role]);}}
 const samples=[
 {name:'María González (DEMO)',phone:'0414-0000001',plate:'DEM-101',brand:'Toyota',model:'Corolla Cross',year:2024,mileage:14500,summary:'Mantenimiento 15.000 km',type:'maintenance',station:3,sub:'active',tasks:['Cambio de aceite y filtro','Inspección de frenos']},
 {name:'Carlos Rojas (DEMO)',phone:'0414-0000002',plate:'DEM-202',brand:'Toyota',model:'Hilux',year:2023,mileage:39200,summary:'Diagnóstico de suspensión',type:'repair',station:3,sub:'waiting_parts',tasks:['Revisar amortiguadores','Sustituir buje delantero']},
 {name:'Ana Pérez (DEMO)',phone:'0414-0000003',plate:'DEM-303',brand:'Toyota',model:'Yaris',year:2025,mileage:8200,summary:'Revisión por garantía',type:'warranty',station:1,sub:'pending',tasks:['Validar expediente de garantía']},
 {name:'Luis Martínez (DEMO)',phone:'0414-0000004',plate:'DEM-404',brand:'Toyota',model:'RAV4',year:2022,mileage:63400,summary:'Cambio de aceite y filtros',type:'maintenance',station:4,sub:'pending',tasks:['Sustituir aceite','Cambiar filtro']},
 {name:'Paola Díaz (DEMO)',phone:'0414-0000005',plate:'DEM-505',brand:'Toyota',model:'Fortuner',year:2024,mileage:18400,summary:'Instalación de accesorios',type:'accessories',station:5,sub:'pending',tasks:['Instalar accesorios']},
 {name:'Roberto Méndez (DEMO)',phone:'0414-0000006',plate:'DEM-606',brand:'Toyota',model:'Corolla',year:2021,mileage:78000,summary:'Revisión de frenos',type:'repair',station:2,sub:'pending',tasks:['Revisar frenos']},
 {name:'Sofía Fernández (DEMO)',phone:'0414-0000007',plate:'DEM-707',brand:'Toyota',model:'4Runner',year:2023,mileage:22000,summary:'Servicio completado',type:'maintenance',station:6,sub:'pending',tasks:['Servicio general']}
 ];
 for(const s of samples){const cid=randomUUID(),vid=randomUUID();
 await q('INSERT INTO clients(id,name,phone) VALUES($1,$2,$3)',[cid,s.name,s.phone]);
 await q('INSERT INTO vehicles(id,client_id,plate,brand,model,year,mileage) VALUES($1,$2,$3,$4,$5,$6,$7)',[vid,cid,s.plate,s.brand,s.model,s.year,s.mileage]);
 const r=await q(`INSERT INTO orders(client_id,vehicle_id,created_by,type,station,substatus,summary,inspection,mileage_in,assigned_to,location,blocked_reason,quality_ok,wash_ok)
 VALUES($1,$2,$3,$4,$5,$6,$7,'Inspección inicial completada', $8,$9,$10,$11,$12,$13) RETURNING id`,
 [cid,vid,ids.recepcion,s.type,s.station,s.sub,s.summary,s.mileage,s.station===3?ids.tecnico:null,
 s.station===1?'Recepción':s.station===2?'Patio':s.station===3?'Bahía A1':s.station===4?'Control de calidad':s.station===5?'Lavado':'Zona entrega',
 s.sub==='waiting_parts'?'Pendiente de buje delantero':'',s.station>=5,s.station>=6]);
 const oid=r.rows[0].id;await q('UPDATE orders SET code=$1 WHERE id=$2',[`OT-${new Date().getFullYear()}-${String(oid).padStart(5,'0')}`,oid]);
 for(const d of s.tasks)await q('INSERT INTO tasks(id,order_id,description,status) VALUES($1,$2,$3,$4)',[randomUUID(),oid,d,s.station>=4?'done':'pending']);
 await q('INSERT INTO audit_events(id,order_id,actor_id,event_type,detail) VALUES($1,$2,$3,$4,$5)',[randomUUID(),oid,ids.recepcion,'demo.created',JSON.stringify({message:'Registro ficticio de demostración'})]);
 if(s.type==='warranty')await q('INSERT INTO warranties(id,vehicle_id,policy,notes) VALUES($1,$2,$3,$4)',[randomUUID(),vid,'Plan de mantenimiento según libreta','Pendiente de verificación']);
 }
 const items=[['ACE-5W30','Aceite 5W30 1 L',30,6,12.5],['FIL-001','Filtro de aceite',20,5,8.5],['BUJ-002','Buje delantero',0,2,28],['FRE-003','Pastillas de freno',8,3,50],['LAV-010','Kit de limpieza',14,4,4]];
 for(const [sku,name,stock,min,price] of items)await q('INSERT INTO inventory(id,sku,name,stock,min_stock,unit_price) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(sku) DO NOTHING',[randomUUID(),sku,name,stock,min,price]);
 const invid=(await q("SELECT id FROM inventory WHERE sku='BUJ-002'")).rows[0].id;
 const oid=(await q("SELECT id FROM orders WHERE summary='Diagnóstico de suspensión' ORDER BY id DESC LIMIT 1")).rows[0].id;
 await q('INSERT INTO parts_requests(id,order_id,item_id,quantity,requested_by) VALUES($1,$2,$3,1,$4)',[randomUUID(),oid,invid,ids.tecnico]);
 console.log('Datos ficticios cargados; usuarios @tallerflow.local');
}
boot().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
