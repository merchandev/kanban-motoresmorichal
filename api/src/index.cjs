'use strict';
const express=require('express');const helmet=require('helmet');const cookieParser=require('cookie-parser');
const rateLimit=require('express-rate-limit');const multer=require('multer');const bcrypt=require('bcryptjs');
const fs=require('node:fs');const path=require('node:path');const {randomUUID,randomBytes,createHash}=require('node:crypto');
const {q,tx,pool}=require('./db.cjs');const {isDay,normPlate,phoneKey,docKey,compareIdentity,normalizePublicUrl}=require('./util.cjs');const mediaLib=require('./media.cjs');const {fetchBcv}=require('./bcv.cjs');const {ROLES,STATIONS,TRANSITIONS,allowed,textRequired,integer,transitionAllowed,transitionActions,PART_STATUS,partFinal,partAllowed,partActions,partStep,partOptions}=require('./shared.cjs');
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:'192kb'}));app.use(cookieParser());
const PORT=Number(process.env.PORT||3001),uploads=process.env.UPLOAD_DIR||'/data/uploads';
fs.mkdirSync(uploads,{recursive:true,mode:0o700});
const digest=t=>createHash('sha256').update(t).digest('hex');
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
function fail(message,status=400){const err=new Error(message);err.status=status;throw err}
function pickText(v,max=500){return String(v??'').trim().slice(0,max)}
function needText(v,label,max=200){if(!textRequired(v,max))fail(`${label} es obligatorio (máximo ${max} caracteres)`);return v.trim()}
function optionalUuid(v){return v||null}
function uuid(v){return typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)}
function checkUuid(v){if(!uuid(v))fail('Identificador inválido');return v}
function log(c,orderId,userId,type,detail={}){return c.query('INSERT INTO audit_events(id,order_id,actor_id,event_type,detail) VALUES($1,$2,$3,$4,$5)',[randomUUID(),orderId||null,userId||null,type,JSON.stringify(detail)])}
const cookieSettings={httpOnly:true,secure:process.env.COOKIE_SECURE!=='false',sameSite:'strict',path:'/api',maxAge:12*60*60*1000};
app.use((req,res,next)=>{if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.headers.origin){try{const from=new URL(req.headers.origin);if(from.host!==req.headers.host)return res.status(403).json({error:'Origen no autorizado'})}catch{return res.status(403).json({error:'Origen inválido'})}}next()});
app.get('/health',(_req,res)=>res.json({ok:true,service:'TallerFlow API'}));
app.get('/api/health',(_req,res)=>res.json({ok:true}));
// Solo cuentan los intentos fallidos: frena a quien prueba contraseñas sin bloquear a un equipo que inicia sesión varias veces.
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:10,skipSuccessfulRequests:true,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Demasiados intentos. Intenta más tarde.'}});
app.post('/api/auth/login',loginLimiter,wrap(async(req,res)=>{
 const email=pickText(req.body.email,190).toLowerCase(),password=String(req.body.password||'');
 const u=(await q('SELECT * FROM users WHERE email=$1 AND active=true',[email])).rows[0];
 if(!u||!await bcrypt.compare(password,u.password_hash))fail('Credenciales incorrectas',401);
 const token=randomBytes(32).toString('base64url');await q('INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval \'12 hours\')',[randomUUID(),u.id,digest(token)]);
 res.cookie('tf_session',token,cookieSettings).json({user:{id:u.id,name:u.name,email:u.email,role:u.role,transition_actions:transitionActions(u.role),part_actions:partActions(u.role)}});
}));
// Autorregistro de clientes (formulario público del QR). Límites: ráfagas cortas por conexión y un tope por hora amplio
// (los clientes suelen compartir el Wi-Fi del taller), contando solo los envíos aceptados, y pocas cargas procesándose a la vez.
const envInt=(k,d)=>{const n=Number(process.env[k]);return Number.isInteger(n)&&n>0?n:d};
const REG={burst:envInt('REGISTRATION_BURST_PER_MIN',6),hourly:envInt('REGISTRATION_PER_HOUR',60),parallel:envInt('REGISTRATION_PARALLEL',3),
 rejectedDays:envInt('REG_REJECTED_PHOTO_DAYS',30),quotaMb:envInt('MEDIA_QUOTA_MB',5120),maxFileMb:6,maxTotalMb:12};
// Texto de autorización vigente: el formulario lo muestra tal cual y cada registro guarda la versión, el texto y la hora aceptados.
const CONSENT={version:`2026-10-15.${REG.rejectedDays}`,text:`Autorizo a Toyota Motores Morichal, C.A. a usar estos datos y fotos solo para identificarme, identificar mi vehículo y atenderlo en el taller. Las fotos son opcionales. Si el registro se rechaza, sus fotos se eliminan a los ${REG.rejectedDays} días; si se acepta, se conservan en la ficha del cliente y del vehículo mientras sea cliente del taller o hasta que pida su eliminación en recepción.`};
const tooMany=(req,res)=>{const reset=req.rateLimit?.resetTime instanceof Date?req.rateLimit.resetTime.getTime():Date.now()+60000,mins=Math.max(1,Math.ceil((reset-Date.now())/60000));
 res.status(429).json({error:`Se recibieron muchos registros desde esta red. Intenta de nuevo en ${mins} min o pide ayuda en recepción.`,retry_minutes:mins})};
const regLimit=(windowMs,limit)=>rateLimit({windowMs,limit,skipFailedRequests:true,standardHeaders:'draft-7',legacyHeaders:false,handler:tooMany});
const regBurst=regLimit(60*1000,REG.burst),regHourly=regLimit(60*60*1000,REG.hourly);
let uploading=0;
const uploadGate=(req,res,next)=>{if(uploading>=REG.parallel)return res.status(503).set('Retry-After','10').json({error:'Estamos recibiendo varios registros a la vez. Espera unos segundos y vuelve a enviar: tus datos siguen en el formulario.'});
 uploading++;let open=true;const release=()=>{if(open){open=false;uploading--}};res.on('finish',release);res.on('close',release);next()};
const PHOTO_KINDS=['profile_photo','vehicle_photo','plate_photo'];
const photoUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:REG.maxFileMb*1024*1024,files:3,fields:24,fieldSize:4000,parts:30}}).fields(PHOTO_KINDS.map(name=>({name,maxCount:1})));
const receivePhotos=(req,res,next)=>photoUpload(req,res,err=>err?res.status(err.code==='LIMIT_FILE_SIZE'?413:400).json({error:err.code==='LIMIT_FILE_SIZE'?`Cada foto debe pesar menos de ${REG.maxFileMb} MB`:'No se pudieron recibir las fotos'}):next());
const regCode=`'REG-'||to_char(created_at,'YYYY')||'-'||lpad(seq::text,5,'0')`;
class RepeatedSubmission extends Error{}
app.get('/api/public/registration-config',(_req,res)=>res.json({consent_version:CONSENT.version,consent_text:CONSENT.text,max_photo_mb:REG.maxFileMb,photo_formats:['JPEG','PNG','WebP']}));
app.post('/api/public/registrations',regBurst,regHourly,uploadGate,receivePhotos,wrap(async(req,res)=>{const b=req.body,files=PHOTO_KINDS.map(k=>req.files?.[k]?.[0]||null);
 // Campo trampa invisible: si un robot lo llena se responde como si nada, sin procesar ni guardar.
 if(b.website)return res.status(201).json({code:'REG-0000-00000'});
 if(b.consent!=='true')fail('Debes autorizar el uso de tus datos para continuar');
 if(b.consent_version!==CONSENT.version)fail('El texto de autorización cambió. Recarga la página, revísalo y vuelve a enviar.',409);
 const plate=needText(b.plate,'Placa',20).toUpperCase().replace(/\s+/g,' ');if(normPlate(plate).length<5)fail('Revisa la placa');
 const phone=needText(b.phone,'Teléfono',50);if(!phoneKey(phone))fail('Revisa el teléfono');
 const email=pickText(b.email,190);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Revisa el correo');
 const year=b.year?Number(b.year):null;if(year!==null&&!integer(year,1950,new Date().getFullYear()+1))fail('Revisa el año');
 const mileage=b.mileage?Number(b.mileage):null;if(mileage!==null&&!integer(mileage,0,3000000))fail('Revisa el kilometraje');
 const values=[needText(b.name,'Nombre',150),phone,email,pickText(b.document,80),plate,needText(b.brand,'Marca',80),needText(b.model,'Modelo',80),year,mileage,needText(b.problem,'Problema del vehículo',2000)];
 if(files.reduce((s,x)=>s+(x?.size||0),0)>REG.maxTotalMb*1024*1024)fail(`Las fotos juntas deben pesar menos de ${REG.maxTotalMb} MB`,413);
 // Reintento del mismo envío (respuesta perdida): misma clave y mismo contenido devuelven el mismo código sin duplicar.
 const key=b.submission_key?String(b.submission_key):null;if(key&&!uuid(key))fail('Clave de envío inválida');
 const hash=createHash('sha256').update(JSON.stringify([...values,...files.map(x=>x?createHash('sha256').update(x.buffer).digest('hex'):null)])).digest('hex');
 const previous=async()=>{const prev=key&&(await q(`SELECT ${regCode} AS code,content_hash FROM client_registrations WHERE submission_key=$1`,[key])).rows[0];
  if(prev&&prev.content_hash!==hash)fail('Este envío ya se registró con otros datos. Recarga la página para hacer un registro nuevo.',409);return prev?.code||null};
 const before=await previous();if(before)return res.json({code:before,repeated:true});
 if(files.some(Boolean)){const used=Number((await q('SELECT coalesce(sum(size),0)::bigint AS n FROM media')).rows[0].n);
  if(used>REG.quotaMb*1024*1024)fail('El espacio para fotos del taller está lleno. Envía el registro sin fotos o pide ayuda en recepción.',507)}
 const images=[];for(const x of files)images.push(x?await mediaLib.processImage(x.buffer):null);
 try{const code=await mediaLib.storeImages(uploads,images.filter(Boolean),stored=>tx(async c=>{const ids=[];let i=0;
   for(const img of images){if(!img){ids.push(null);continue}const s=stored[i++];
    await c.query('INSERT INTO media(id,stored_name,thumb_name,mime,size,width,height) VALUES($1,$2,$3,$4,$5,$6,$7)',[s.id,s.main,s.thumb,'image/jpeg',s.size,s.width,s.height]);ids.push(s.id)}
   const r=await c.query(`INSERT INTO client_registrations(id,name,phone,email,document,plate,brand,model,year,mileage,problem,profile_photo,vehicle_photo,plate_photo,submission_key,content_hash,consent_version,consent_text,consent_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now()) ON CONFLICT (submission_key) DO NOTHING RETURNING ${regCode} AS code`,[randomUUID(),...values,...ids,key,hash,CONSENT.version,CONSENT.text]);
   // Otro envío con la misma clave ganó la carrera: se deshace este (y sus archivos) y se responde con el código existente.
   if(!r.rows[0])throw new RepeatedSubmission();return r.rows[0].code}));
  res.status(201).json({code})}
 catch(err){if(err instanceof RepeatedSubmission){const code=await previous();if(code)return res.json({code,repeated:true})}throw err}}));
app.use('/api',wrap(async(req,res,next)=>{
 const token=req.cookies?.tf_session;if(!token||token.length>200)fail('Inicia sesión',401);
 const result=await q(`SELECT u.id,u.name,u.email,u.role,u.active,s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id
 WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,[digest(token)]);
 if(!result.rows[0])fail('Sesión expirada. Inicia sesión nuevamente.',401);
 req.user=result.rows[0];next();
}));
const permit=p=>(req,res,next)=>allowed(req.user.role,p)?next():res.status(403).json({error:'Tu rol no tiene permiso para esta acción'});
const orderSql=`SELECT o.*,c.name AS client_name,c.phone AS client_phone,v.plate,v.brand,v.model,v.year,v.vin,
 u.name AS technician_name,v.photo_id AS vehicle_photo_id,v.plate_photo_id AS vehicle_plate_photo_id FROM orders o JOIN clients c ON c.id=o.client_id JOIN vehicles v ON v.id=o.vehicle_id
 LEFT JOIN users u ON u.id=o.assigned_to`;
const listOrders=()=>`${orderSql} ORDER BY CASE WHEN o.status='open' THEN 0 ELSE 1 END, CASE o.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,o.updated_at DESC LIMIT 500`;
async function getOrder(id,c=pool){const r=await c.query(`${orderSql} WHERE o.id=$1`,[id]);if(!r.rows[0])fail('Orden no encontrada',404);return r.rows[0]}
async function lockedOrder(c,id){const r=await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[id]);if(!r.rows[0])fail('Orden no encontrada',404);return r.rows[0]}
function openOrder(o){if(o.status!=='open')fail('La orden está cerrada o cancelada',409)}
app.get('/api/auth/me',(req,res)=>res.json({user:{id:req.user.id,name:req.user.name,email:req.user.email,role:req.user.role,transition_actions:transitionActions(req.user.role),part_actions:partActions(req.user.role)}}));
app.post('/api/auth/logout',wrap(async(req,res)=>{await q('DELETE FROM sessions WHERE id=$1',[req.user.session_id]);res.clearCookie('tf_session',{path:'/api',sameSite:'strict',secure:cookieSettings.secure}).json({ok:true})}));
app.post('/api/auth/password',wrap(async(req,res)=>{const previous=String(req.body.previous||''),next=String(req.body.next||'');if(next.length<12||next.length>128)fail('Nueva contraseña: entre 12 y 128 caracteres');
 const r=await q('SELECT password_hash FROM users WHERE id=$1',[req.user.id]);if(!await bcrypt.compare(previous,r.rows[0].password_hash))fail('Contraseña actual incorrecta',403);
 await tx(async c=>{await c.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await bcrypt.hash(next,12),req.user.id]);await c.query('DELETE FROM sessions WHERE user_id=$1 AND id<>$2',[req.user.id,req.user.session_id]);await log(c,null,req.user.id,'auth.password_changed')});res.json({ok:true})}));
app.get('/api/users',permit('read'),wrap(async(req,res)=>res.json((await q('SELECT id,name,email,role,active,created_at FROM users ORDER BY name')).rows)));
app.post('/api/users',permit('admin'),wrap(async(req,res)=>{const {name,email,password,role}=req.body;
 if(!ROLES.includes(role)||!textRequired(email,190)||!/^\S+@\S+\.\S+$/.test(email)||String(password||'').length<12)fail('Email, rol o contraseña no válidos (mínimo 12 caracteres)');
 const id=randomUUID();await q('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)',[id,needText(name,'Nombre'),email.trim().toLowerCase(),await bcrypt.hash(password,12),role]);
 res.status(201).json({id})}));
app.patch('/api/users/:id',permit('admin'),wrap(async(req,res)=>{checkUuid(req.params.id);const u=(await q('SELECT * FROM users WHERE id=$1',[req.params.id])).rows[0];if(!u)fail('Usuario no encontrado',404);
 if(req.body.active===false&&u.id===req.user.id)fail('No puedes desactivar tu propia cuenta');if(req.body.role&&!ROLES.includes(req.body.role))fail('Rol inválido');
 await q('UPDATE users SET name=$1,role=$2,active=$3 WHERE id=$4',[pickText(req.body.name??u.name,100),req.body.role??u.role,typeof req.body.active==='boolean'?req.body.active:u.active,u.id]);
 if(req.body.active===false)await q('DELETE FROM sessions WHERE user_id=$1',[u.id]);res.json({ok:true})}));
app.get('/api/clients',permit('read'),wrap(async(req,res)=>res.json((await q('SELECT * FROM clients WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1000')).rows)));
app.post('/api/clients',permit('people'),wrap(async(req,res)=>{const b=req.body,id=randomUUID();await q('INSERT INTO clients(id,name,phone,email,document) VALUES($1,$2,$3,$4,$5)',[id,needText(b.name,'Nombre'),needText(b.phone,'Teléfono',50),pickText(b.email,190),pickText(b.document,80)]);res.status(201).json({id})}));
app.patch('/api/clients/:id',permit('people'),wrap(async(req,res)=>{checkUuid(req.params.id);const b=req.body;const r=await q('UPDATE clients SET name=COALESCE($1,name),phone=COALESCE($2,phone),email=COALESCE($3,email),document=COALESCE($4,document) WHERE id=$5 RETURNING id',
 [b.name?needText(b.name,'Nombre'):null,b.phone?needText(b.phone,'Teléfono'):null,b.email!==undefined?pickText(b.email,190):null,b.document!==undefined?pickText(b.document,80):null,req.params.id]);if(!r.rowCount)fail('Cliente no encontrado',404);res.json({ok:true})}));
app.get('/api/vehicles',permit('read'),wrap(async(req,res)=>res.json((await q('SELECT v.*,c.name AS client_name FROM vehicles v JOIN clients c ON c.id=v.client_id WHERE v.deleted_at IS NULL ORDER BY v.created_at DESC LIMIT 1000')).rows)));
app.post('/api/vehicles',permit('people'),wrap(async(req,res)=>{const b=req.body,id=randomUUID();checkUuid(b.client_id);if(b.year!==undefined&&b.year!==''&&!integer(b.year,1950,2100))fail('Año inválido');
 if(!integer(b.mileage||0))fail('Kilometraje inválido');const plate=needText(b.plate,'Placa',20).toUpperCase();
 const owner=(await q('SELECT deleted_at FROM clients WHERE id=$1',[b.client_id])).rows[0];if(!owner)fail('Cliente no encontrado',404);if(owner.deleted_at)fail('El cliente está en Borradores; restáuralo primero',409);
 const same=(await q("SELECT deleted_at FROM vehicles WHERE regexp_replace(upper(plate),'[^A-Z0-9]','','g')=$1",[normPlate(plate)])).rows[0];if(same)fail(same.deleted_at?`La placa ${plate} está en Borradores; restáurala desde allí`:`Ya existe un vehículo con la placa ${plate}`,409);
 await q('INSERT INTO vehicles(id,client_id,plate,vin,brand,model,year,mileage,warranty_until,next_service_km) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
 [id,b.client_id,plate,pickText(b.vin,40),needText(b.brand,'Marca',80),needText(b.model,'Modelo',80),b.year||null,Number(b.mileage||0),b.warranty_until||null,b.next_service_km||null]);await log({query:q},null,req.user.id,'vehicle.created',{vehicle_id:id,plate});res.status(201).json({id})}));
app.patch('/api/vehicles/:id',permit('people'),wrap(async(req,res)=>{checkUuid(req.params.id);const b=req.body;const r=await q('UPDATE vehicles SET mileage=COALESCE($1,mileage),warranty_until=COALESCE($2,warranty_until),next_service_km=COALESCE($3,next_service_km) WHERE id=$4 RETURNING id',
 [b.mileage!==undefined?(integer(b.mileage)?Number(b.mileage):fail('Kilometraje inválido')):null,b.warranty_until||null,b.next_service_km||null,req.params.id]);if(!r.rowCount)fail('Vehículo no encontrado',404);
 await log({query:q},null,req.user.id,'vehicle.updated',{vehicle_id:req.params.id,mileage:b.mileage!==undefined?Number(b.mileage):undefined,warranty_until:b.warranty_until||undefined});res.json({ok:true})}));
// Borradores: eliminar mueve el registro a Borradores; solo se borra de verdad si no tiene historial.
async function openOrdersOf(c,column,id){return (await c.query(`SELECT count(*)::int n FROM orders WHERE ${column}=$1 AND status='open'`,[id])).rows[0].n}
app.delete('/api/clients/:id',permit('people'),wrap(async(req,res)=>{checkUuid(req.params.id);const out=await tx(async c=>{
 const cl=(await c.query('SELECT * FROM clients WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.params.id])).rows[0];if(!cl)fail('Cliente no encontrado',404);
 const open=await openOrdersOf(c,'client_id',cl.id);if(open)fail(`No se puede eliminar: tiene ${open} ${open===1?'orden abierta':'órdenes abiertas'} en el taller`,409);
 await c.query('UPDATE clients SET deleted_at=now(),deleted_by=$2 WHERE id=$1',[cl.id,req.user.id]);
 const v=await c.query('UPDATE vehicles SET deleted_at=now(),deleted_by=$2 WHERE client_id=$1 AND deleted_at IS NULL',[cl.id,req.user.id]);
 await log(c,null,req.user.id,'client.deleted',{client_id:cl.id,name:cl.name,vehicles:v.rowCount});return {vehicles:v.rowCount}});res.json({ok:true,...out})}));
app.delete('/api/vehicles/:id',permit('people'),wrap(async(req,res)=>{checkUuid(req.params.id);await tx(async c=>{
 const v=(await c.query('SELECT * FROM vehicles WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.params.id])).rows[0];if(!v)fail('Vehículo no encontrado',404);
 if(await openOrdersOf(c,'vehicle_id',v.id))fail('No se puede eliminar: el vehículo tiene una orden abierta en el taller',409);
 await c.query('UPDATE vehicles SET deleted_at=now(),deleted_by=$2 WHERE id=$1',[v.id,req.user.id]);await log(c,null,req.user.id,'vehicle.deleted',{vehicle_id:v.id,plate:v.plate})});res.json({ok:true})}));
app.get('/api/trash',permit('people'),wrap(async(req,res)=>{const [clients,vehicles]=await Promise.all([
 q(`SELECT c.id,c.name,c.phone,c.document,c.deleted_at,u.name AS deleted_by_name,(SELECT count(*)::int FROM vehicles v WHERE v.client_id=c.id) AS vehicles,
 (SELECT count(*)::int FROM orders o WHERE o.client_id=c.id)+(SELECT count(*)::int FROM appointments a WHERE a.client_id=c.id)+(SELECT count(*)::int FROM client_registrations r WHERE r.client_id=c.id)
 +(SELECT count(*)::int FROM warranties w JOIN vehicles v ON v.id=w.vehicle_id WHERE v.client_id=c.id)+(SELECT count(*)::int FROM part_orders p JOIN vehicles v ON v.id=p.vehicle_id WHERE v.client_id=c.id) AS history
 FROM clients c LEFT JOIN users u ON u.id=c.deleted_by WHERE c.deleted_at IS NOT NULL ORDER BY c.deleted_at DESC LIMIT 500`),
 q(`SELECT v.id,v.plate,v.brand,v.model,v.year,v.client_id,c.name AS client_name,c.deleted_at IS NOT NULL AS client_deleted,v.deleted_at,u.name AS deleted_by_name,
 (SELECT count(*)::int FROM orders o WHERE o.vehicle_id=v.id)+(SELECT count(*)::int FROM appointments a WHERE a.vehicle_id=v.id)+(SELECT count(*)::int FROM warranties w WHERE w.vehicle_id=v.id)+(SELECT count(*)::int FROM part_orders p WHERE p.vehicle_id=v.id)+(SELECT count(*)::int FROM client_registrations r WHERE r.vehicle_id=v.id) AS history
 FROM vehicles v JOIN clients c ON c.id=v.client_id LEFT JOIN users u ON u.id=v.deleted_by WHERE v.deleted_at IS NOT NULL ORDER BY v.deleted_at DESC LIMIT 500`)]);
 res.json({clients:clients.rows,vehicles:vehicles.rows})}));
app.post('/api/clients/:id/restore',permit('people'),wrap(async(req,res)=>{checkUuid(req.params.id);const out=await tx(async c=>{
 const cl=(await c.query('SELECT * FROM clients WHERE id=$1 AND deleted_at IS NOT NULL FOR UPDATE',[req.params.id])).rows[0];if(!cl)fail('El cliente no está en Borradores',404);
 // Vuelven también los vehículos que se eliminaron junto con el cliente (mismo instante).
 const v=await c.query('UPDATE vehicles SET deleted_at=NULL,deleted_by=NULL WHERE client_id=$1 AND deleted_at=(SELECT deleted_at FROM clients WHERE id=$1)',[cl.id]);
 await c.query('UPDATE clients SET deleted_at=NULL,deleted_by=NULL WHERE id=$1',[cl.id]);await log(c,null,req.user.id,'client.restored',{client_id:cl.id,name:cl.name,vehicles:v.rowCount});return {vehicles:v.rowCount}});res.json({ok:true,...out})}));
app.post('/api/vehicles/:id/restore',permit('people'),wrap(async(req,res)=>{checkUuid(req.params.id);const out=await tx(async c=>{
 const v=(await c.query('SELECT * FROM vehicles WHERE id=$1 AND deleted_at IS NOT NULL FOR UPDATE',[req.params.id])).rows[0];if(!v)fail('El vehículo no está en Borradores',404);
 const owner=await c.query('UPDATE clients SET deleted_at=NULL,deleted_by=NULL WHERE id=$1 AND deleted_at IS NOT NULL',[v.client_id]);
 await c.query('UPDATE vehicles SET deleted_at=NULL,deleted_by=NULL WHERE id=$1',[v.id]);await log(c,null,req.user.id,'vehicle.restored',{vehicle_id:v.id,plate:v.plate,client_restored:owner.rowCount>0});return {client_restored:owner.rowCount>0}});res.json({ok:true,...out})}));
const keepHistory='Tiene historial (órdenes, citas o garantías); se conserva en Borradores para auditoría';
app.delete('/api/clients/:id/purge',permit('admin'),wrap(async(req,res)=>{checkUuid(req.params.id);await tx(async c=>{
 const cl=(await c.query('SELECT * FROM clients WHERE id=$1 AND deleted_at IS NOT NULL FOR UPDATE',[req.params.id])).rows[0];if(!cl)fail('El cliente no está en Borradores',404);
 const h=(await c.query(`SELECT (SELECT count(*)::int FROM orders WHERE client_id=$1)+(SELECT count(*)::int FROM appointments WHERE client_id=$1)
 +(SELECT count(*)::int FROM warranties w JOIN vehicles v ON v.id=w.vehicle_id WHERE v.client_id=$1)
 +(SELECT count(*)::int FROM part_orders p JOIN vehicles v ON v.id=p.vehicle_id WHERE v.client_id=$1)+(SELECT count(*)::int FROM client_registrations WHERE client_id=$1) AS n`,[cl.id])).rows[0].n;if(h)fail(keepHistory,409);
 if((await c.query('SELECT count(*)::int n FROM vehicles WHERE client_id=$1 AND deleted_at IS NULL',[cl.id])).rows[0].n)fail('El cliente tiene vehículos activos',409);
 const v=await c.query('DELETE FROM vehicles WHERE client_id=$1',[cl.id]);await c.query('DELETE FROM clients WHERE id=$1',[cl.id]);
 await log(c,null,req.user.id,'client.purged',{name:cl.name,vehicles:v.rowCount})});res.json({ok:true})}));
app.delete('/api/vehicles/:id/purge',permit('admin'),wrap(async(req,res)=>{checkUuid(req.params.id);await tx(async c=>{
 const v=(await c.query('SELECT * FROM vehicles WHERE id=$1 AND deleted_at IS NOT NULL FOR UPDATE',[req.params.id])).rows[0];if(!v)fail('El vehículo no está en Borradores',404);
 const h=(await c.query(`SELECT (SELECT count(*)::int FROM orders WHERE vehicle_id=$1)+(SELECT count(*)::int FROM appointments WHERE vehicle_id=$1)+(SELECT count(*)::int FROM warranties WHERE vehicle_id=$1)+(SELECT count(*)::int FROM part_orders WHERE vehicle_id=$1)+(SELECT count(*)::int FROM client_registrations WHERE vehicle_id=$1) AS n`,[v.id])).rows[0].n;if(h)fail(keepHistory,409);
 await c.query('DELETE FROM vehicles WHERE id=$1',[v.id]);await log(c,null,req.user.id,'vehicle.purged',{plate:v.plate})});res.json({ok:true})}));
// Historial completo de un vehículo: eventos de sus órdenes, del propio vehículo y la trayectoria entera de cada pieza que
// tiene o tuvo (también lo ocurrido antes o después de transferirla), con autor, rol y el técnico encargado de la orden
// en ese momento (la última asignación anterior al evento).
app.get('/api/vehicles/:id/history',permit('read'),wrap(async(req,res)=>{checkUuid(req.params.id);
 const v=(await q('SELECT v.id,v.plate,v.brand,v.model,v.year,v.photo_id,v.created_at,v.deleted_at,c.name AS client_name FROM vehicles v JOIN clients c ON c.id=v.client_id WHERE v.id=$1',[req.params.id])).rows[0];if(!v)fail('Vehículo no encontrado',404);
 const [orders,events,parts]=await Promise.all([
  q('SELECT o.id,o.code,o.type,o.summary,o.status,o.station,o.created_at,o.closed_at FROM orders o WHERE o.vehicle_id=$1 ORDER BY o.created_at DESC',[v.id]),
  q(`SELECT a.id,a.order_id,a.event_type,a.detail,a.created_at,o.code,u.name AS actor_name,u.role AS actor_role,
    CASE WHEN a.order_id IS NOT NULL THEN COALESCE(
     (SELECT t.name FROM audit_events x LEFT JOIN users t ON t.id::text=x.detail->>'technician' WHERE x.order_id=a.order_id AND x.event_type='order.assigned' AND x.created_at<=a.created_at ORDER BY x.created_at DESC LIMIT 1),
     CASE WHEN NOT EXISTS(SELECT 1 FROM audit_events x WHERE x.order_id=a.order_id AND x.event_type='order.assigned') THEN ot.name END) END AS technician_name
   FROM audit_events a LEFT JOIN orders o ON o.id=a.order_id LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN users ot ON ot.id=o.assigned_to
   WHERE o.vehicle_id=$1 OR a.detail->>'vehicle_id'=$2 OR a.detail->>'from_vehicle_id'=$2
    OR a.detail->>'part_id' IN (SELECT p.id::text FROM part_orders p WHERE p.vehicle_id=$1 UNION SELECT x.detail->>'part_id' FROM audit_events x WHERE x.event_type='part.transferred' AND x.detail->>'from_vehicle_id'=$2)
   ORDER BY a.created_at DESC LIMIT 2000`,[v.id,v.id]),
  q(`${partSql} WHERE p.vehicle_id=$1 ORDER BY p.created_at DESC`,[v.id])]);
 res.json({vehicle:v,orders:orders.rows,events:events.rows,parts:parts.rows})}));
// Pedidos de piezas: desde el pedido al proveedor hasta la entrega en el departamento, ligados al vehículo y a su orden.
const PART_DEPARTMENTS=['reception','workshop','quality','wash','warehouse','warranty','admin'];
const partSql=`SELECT p.id,'PZ-'||to_char(p.created_at,'YYYY')||'-'||lpad(p.seq::text,5,'0') AS code,p.description,p.part_number,p.quantity,p.supplier,p.department,
 p.vehicle_id,p.order_id,p.responsible_id,p.requested_by,to_char(p.expected_at,'YYYY-MM-DD') AS expected_at,p.warranty,p.warranty_ref,p.carrier,p.tracking,p.cost_usd,
 p.status,p.delivered_to,p.notes,p.received_at,p.delivered_at,p.created_at,p.updated_at,v.plate,v.brand,v.model,o.code AS order_code,r.name AS responsible_name,rb.name AS requested_by_name
 FROM part_orders p LEFT JOIN vehicles v ON v.id=p.vehicle_id LEFT JOIN orders o ON o.id=p.order_id LEFT JOIN users r ON r.id=p.responsible_id LEFT JOIN users rb ON rb.id=p.requested_by`;
// Permisos por acción (matriz en shared.cjs, la misma que la API devuelve a la interfaz en part_actions y en cada pieza).
const PART_LABELS={request:'registrar piezas pedidas',edit:'editar pedidos de piezas',transit:'marcar piezas en tránsito',receive:'registrar la recepción de piezas',deliver:'entregar piezas al departamento',cancel:'cancelar pedidos de piezas',correct:'hacer ese cambio: es una corrección excepcional de gerencia o administración'};
const partCheck=(user,action,p=null)=>{if(!partAllowed(user.role,action,p))fail(user.role==='warranty'&&p&&!p.warranty&&PART_LABELS[action]?'Garantías solo gestiona piezas por garantía':`Tu rol no puede ${PART_LABELS[action]||'hacer ese cambio'}`,403)};

// Los eventos de piezas llevan vehicle_id (y order_id si van a una orden) para aparecer en el historial del vehículo.
const partLog=(c,p,userId,type,extra={})=>log(c,p.order_id,userId,type,{part_id:p.id,code:p.code,description:p.description,vehicle_id:p.vehicle_id,plate:p.plate,responsible:p.responsible_name,...extra});
async function partInput(c,b){const description=needText(b.description,'Pieza',200),quantity=b.quantity===undefined||b.quantity===null||b.quantity===''?1:Number(b.quantity);if(!Number.isInteger(quantity)||quantity<1||quantity>10000)fail('La cantidad debe ser un número entero entre 1 y 10.000');
 if(!PART_DEPARTMENTS.includes(b.department))fail('Elige el departamento de destino');if(!isDay(b.expected_at))fail('Indica el día estimado de llegada');
 const cost=Number(b.cost_usd||0);if(!Number.isFinite(cost)||cost<0||cost>100000000)fail('Costo inválido');
 let vehicle=b.vehicle_id||null;const order=b.order_id?Number(b.order_id):null;
 if(order){if(!integer(order,1))fail('Orden inválida');const o=(await c.query('SELECT vehicle_id FROM orders WHERE id=$1',[order])).rows[0];if(!o)fail('Orden no encontrada',404);
  if(vehicle&&vehicle!==o.vehicle_id)fail('La orden no corresponde a ese vehículo');vehicle=o.vehicle_id}
 if(vehicle){checkUuid(vehicle);if(!(await c.query('SELECT 1 FROM vehicles WHERE id=$1',[vehicle])).rowCount)fail('Vehículo no encontrado',404)}
 if(!b.responsible_id)fail('Elige el responsable del seguimiento');checkUuid(b.responsible_id);
 const r=(await c.query('SELECT active FROM users WHERE id=$1',[b.responsible_id])).rows[0];if(!r||!r.active)fail('Responsable inválido');
 const warranty=b.warranty===true||b.warranty==='true';
 return {description,part_number:pickText(b.part_number,80),quantity,supplier:pickText(b.supplier,120),department:b.department,vehicle_id:vehicle,order_id:order,responsible_id:b.responsible_id,
  expected_at:b.expected_at,warranty,warranty_ref:warranty?pickText(b.warranty_ref,80):'',carrier:pickText(b.carrier,80),tracking:pickText(b.tracking,120),cost_usd:cost,notes:pickText(b.notes,1500)}}
const partFields=['description','part_number','quantity','supplier','department','vehicle_id','order_id','responsible_id','expected_at','warranty','warranty_ref','carrier','tracking','cost_usd','notes'];
app.get('/api/part-orders',permit('read'),wrap(async(req,res)=>res.json((await q(`${partSql} ORDER BY CASE WHEN p.status IN ('delivered','cancelled') THEN 1 ELSE 0 END,p.expected_at NULLS LAST,p.created_at DESC LIMIT 1000`)).rows
 .map(p=>({...p,actions:partOptions(req.user.role,p)})))));
app.get('/api/part-orders/:id/events',permit('read'),wrap(async(req,res)=>{checkUuid(req.params.id);
 res.json((await q('SELECT a.id,a.event_type,a.detail,a.created_at,u.name AS actor_name,u.role AS actor_role FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.detail->>\'part_id\'=$1 ORDER BY a.created_at',[req.params.id])).rows)}));
app.post('/api/part-orders',wrap(async(req,res)=>{partCheck(req.user,'request');const id=randomUUID();const p=await tx(async c=>{const v=await partInput(c,req.body);
 await c.query(`INSERT INTO part_orders(id,${partFields.join(',')},requested_by) VALUES($1,${partFields.map((_,i)=>'$'+(i+2)).join(',')},$${partFields.length+2})`,[id,...partFields.map(k=>v[k]),req.user.id]);
 const p=(await c.query(`${partSql} WHERE p.id=$1`,[id])).rows[0];
 await partLog(c,p,req.user.id,'part.ordered',{quantity:p.quantity,department:p.department,expected_at:p.expected_at,warranty:p.warranty,warranty_ref:p.warranty_ref,supplier:p.supplier});return p});res.status(201).json(p)}));
const partLabels={description:'pieza',part_number:'n.º de parte',quantity:'cantidad',supplier:'proveedor',department:'destino',vehicle_id:'vehículo',order_id:'orden',responsible_id:'responsable',expected_at:'llegada estimada',warranty:'garantía',warranty_ref:'reclamo de garantía',carrier:'transportista',tracking:'guía',cost_usd:'costo',notes:'notas'};
const partShown=(p,k)=>{const v=k==='responsible_id'?p.responsible_name:p[k];return typeof v==='string'?v.slice(0,300):v??null};
// Editar: una pieza entregada o cancelada solo la corrige gerencia o administración, con motivo. Cambiar el vehículo o la
// orden es una transferencia: exige motivo y deja un evento con origen y destino que aparece en el historial de ambos.
app.patch('/api/part-orders/:id',wrap(async(req,res)=>{checkUuid(req.params.id);const b=req.body;await tx(async c=>{
 const old=(await c.query(`${partSql} WHERE p.id=$1 FOR UPDATE OF p`,[req.params.id])).rows[0];if(!old)fail('Pieza no encontrada',404);
 const final=partFinal(old.status);partCheck(req.user,final?'correct':'edit',old);const v=await partInput(c,b);
 const moved=String(old.vehicle_id??'')!==String(v.vehicle_id??'')||String(old.order_id??'')!==String(v.order_id??'');
 const reason=moved||final?needText(b.reason,moved?'Motivo de la transferencia':'Motivo de la corrección',500):pickText(b.reason,500);
 await c.query(`UPDATE part_orders SET ${partFields.map((k,i)=>k+'=$'+(i+2)).join(',')},updated_at=now() WHERE id=$1`,[old.id,...partFields.map(k=>v[k])]);
 const p=(await c.query(`${partSql} WHERE p.id=$1`,[old.id])).rows[0];
 if(moved)await partLog(c,p,req.user.id,'part.transferred',{from_vehicle_id:old.vehicle_id,from_plate:old.plate,from_order_id:old.order_id,from_order:old.order_code,to_order:p.order_code,status:p.status,reason,correction:final||undefined});
 const keys=partFields.filter(k=>String(old[k]??'')!==String(p[k]??'')&&!(moved&&(k==='vehicle_id'||k==='order_id')));
 if(keys.length)await partLog(c,p,req.user.id,'part.updated',{changes:keys.map(k=>partLabels[k]),values:Object.fromEntries(keys.map(k=>[partLabels[k],{from:partShown(old,k),to:partShown(p,k)}])),
  expected_from:old.expected_at,expected_at:p.expected_at,correction:final||undefined,reason:moved?undefined:reason||undefined})});res.json({ok:true})}));
// Cambiar de estado: el paso ordinario lo hace el rol de esa acción; cualquier otro es una corrección (gerencia o administración,
// con motivo) y la bitácora conserva la recepción o entrega anterior que deje sin efecto.
app.post('/api/part-orders/:id/status',wrap(async(req,res)=>{checkUuid(req.params.id);const b=req.body;if(!PART_STATUS.includes(b.status))fail('Estado inválido');
 if(b.expected_at&&!isDay(b.expected_at))fail('Fecha estimada inválida');
 await tx(async c=>{const old=(await c.query(`${partSql} WHERE p.id=$1 FOR UPDATE OF p`,[req.params.id])).rows[0];if(!old)fail('Pieza no encontrada',404);if(old.status===b.status)fail('La pieza ya está en ese estado',409);
  const step=partStep(old.status,b.status);partCheck(req.user,step,old);
  const note=step==='correct'?needText(b.note,'Motivo de la corrección',800):b.status==='cancelled'?needText(b.note,'Motivo de la cancelación',800):pickText(b.note,800);
  const to=b.status==='delivered'?needText(b.delivered_to,'Persona que recibe en el departamento',150):'';
  await c.query(`UPDATE part_orders SET status=$1,carrier=COALESCE(NULLIF($2,''),carrier),tracking=COALESCE(NULLIF($3,''),tracking),expected_at=COALESCE($4::date,expected_at),
   received_at=CASE WHEN $1 IN ('received','delivered') THEN COALESCE(received_at,now()) WHEN $1 IN ('ordered','in_transit') THEN NULL ELSE received_at END,
   delivered_at=CASE WHEN $1='delivered' THEN now() WHEN $1='cancelled' THEN delivered_at ELSE NULL END,delivered_to=CASE WHEN $1='delivered' THEN $5 WHEN $1='cancelled' THEN delivered_to ELSE '' END,updated_at=now() WHERE id=$6`,
   [b.status,pickText(b.carrier,80),pickText(b.tracking,120),b.expected_at||null,to,old.id]);
  const p=(await c.query(`${partSql} WHERE p.id=$1`,[old.id])).rows[0];
  const replaced=['received_at','delivered_at','delivered_to'].filter(k=>old[k]&&String(old[k])!==String(p[k]??''));
  await partLog(c,p,req.user.id,'part.status',{from:old.status,to:p.status,note,expected_from:old.expected_at,delivered_to:to||undefined,department:p.department,carrier:p.carrier,tracking:p.tracking,expected_at:p.expected_at,
   correction:step==='correct'||undefined,previous:replaced.length?Object.fromEntries(replaced.map(k=>[k,old[k]])):undefined})});res.json({ok:true})}));
// Fotos guardadas: solo con sesión y sin caché del navegador (son fotos personales y el equipo puede ser compartido).
app.get('/api/media/:id',permit('read'),wrap(async(req,res)=>{checkUuid(req.params.id);const f=(await q('SELECT * FROM media WHERE id=$1',[req.params.id])).rows[0];if(!f)fail('Foto no encontrada',404);
 const name=req.query.size==='thumb'&&f.thumb_name?f.thumb_name:f.stored_name;
 res.setHeader('Content-Type',name===f.stored_name?f.mime:'image/jpeg');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.sendFile(path.join(uploads,name))}));
// Dirección pública del formulario (la del QR): una sola para todo el taller; la cambian administración o gerencia.
const canSetup=u=>['admin','manager'].includes(u.role);
app.get('/api/settings/registration-url',permit('people'),wrap(async(req,res)=>{const s=(await q("SELECT s.value,s.updated_at,u.name AS updated_by_name FROM app_settings s LEFT JOIN users u ON u.id=s.updated_by WHERE s.key='registration_url'")).rows[0];
 res.json({...(s?normalizePublicUrl(s.value):{ok:false}),updated_at:s?.updated_at||null,updated_by_name:s?.updated_by_name||null,can_edit:canSetup(req.user)})}));
app.put('/api/settings/registration-url',permit('people'),wrap(async(req,res)=>{if(!canSetup(req.user))fail('Solo administración o gerencia pueden cambiar la dirección del QR',403);
 const n=normalizePublicUrl(req.body.url);if(!n.ok)fail(n.error);
 await tx(async c=>{await c.query(`INSERT INTO app_settings(key,value,updated_by,updated_at) VALUES('registration_url',$1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,[n.origin,req.user.id]);
  await log(c,null,req.user.id,'settings.registration_url',{url:n.url})});res.json(n)}));
// Bandeja de autorregistros (paginada en el servidor, con totales reales y búsqueda por nombre, cédula, teléfono, placa o código).
const regCols=`r.id,r.seq,r.status,r.name,r.phone,r.document,r.email,r.plate,r.brand,r.model,r.year,r.mileage,r.problem,r.profile_photo,r.vehicle_photo,r.plate_photo,
 r.client_id,r.vehicle_id,r.order_id,r.relation,r.applied_updates,r.review_note,r.reviewed_at,r.created_at,r.consent_version,r.consent_at,r.photos_purged_at,'REG-'||to_char(r.created_at,'YYYY')||'-'||lpad(r.seq::text,5,'0') AS code`;
app.get('/api/registrations/summary',permit('people'),wrap(async(req,res)=>{const [n,recent]=await Promise.all([q("SELECT count(*)::int AS n FROM client_registrations WHERE status='pending'"),
 q(`SELECT r.id,r.name,r.plate,r.created_at,${regCode} AS code FROM client_registrations r WHERE status='pending' ORDER BY created_at DESC LIMIT 20`)]);res.json({pending:n.rows[0].n,recent:recent.rows,server_time:new Date()})}));
app.get('/api/registrations',permit('people'),wrap(async(req,res)=>{const status=['pending','accepted','rejected','all'].includes(req.query.status)?req.query.status:'pending';
 const limit=Math.min(100,Math.max(1,Number.parseInt(req.query.limit,10)||25)),offset=Math.max(0,Number.parseInt(req.query.offset,10)||0);
 const term=pickText(req.query.q,80).replace(/[%_\\]/g,''),code=/^REG-?\d{4}-?(\d+)$/i.exec(term.replace(/\s/g,'')),digits=term.replace(/\D/g,'');
 const params=[status,term,normPlate(term),digits,code?Number(code[1]):-1];
 const where=`($1='all' OR r.status=$1) AND ($2='' OR r.name ILIKE '%'||$2||'%' OR r.document ILIKE '%'||$2||'%' OR ($3<>'' AND regexp_replace(upper(r.plate),'[^A-Z0-9]','','g') LIKE '%'||$3||'%')
  OR (length($4)>=4 AND regexp_replace(r.phone,'\\D','','g') LIKE '%'||$4||'%') OR r.seq=$5)`;
 // Pendientes por orden de llegada (los más antiguos primero, para que ninguno quede oculto); el resto, lo más reciente primero.
 const order=status==='pending'?'r.created_at ASC':`CASE WHEN r.status='pending' THEN 0 ELSE 1 END,COALESCE(r.reviewed_at,r.created_at) DESC`;
 const [items,total,counts]=await Promise.all([
  q(`SELECT ${regCols},u.name AS reviewed_by_name,o.code AS order_code,
    EXISTS(SELECT 1 FROM vehicles v WHERE regexp_replace(upper(v.plate),'[^A-Z0-9]','','g')=regexp_replace(upper(r.plate),'[^A-Z0-9]','','g')) AS plate_known,
    EXISTS(SELECT 1 FROM clients c WHERE c.deleted_at IS NULL AND (right(regexp_replace(c.phone,'\\D','','g'),10)=right(regexp_replace(r.phone,'\\D','','g'),10)
     OR (r.document<>'' AND regexp_replace(upper(c.document),'[^A-Z0-9]','','g')=regexp_replace(upper(r.document),'[^A-Z0-9]','','g')))) AS client_known
   FROM client_registrations r LEFT JOIN users u ON u.id=r.reviewed_by LEFT JOIN orders o ON o.id=r.order_id WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,params),
  q(`SELECT count(*)::int AS n FROM client_registrations r WHERE ${where}`,params),
  q('SELECT status,count(*)::int AS n FROM client_registrations GROUP BY status')]);
 const n=Object.fromEntries(counts.rows.map(x=>[x.status,x.n])),c={pending:n.pending||0,accepted:n.accepted||0,rejected:n.rejected||0};
 res.json({items:items.rows,total:total.rows[0].n,limit,offset,counts:{...c,all:c.pending+c.accepted+c.rejected},server_time:new Date()})}));
// Candidatos para decidir la identidad: el vehículo por placa (con su propietario) y clientes por teléfono o cédula, comparados campo a campo.
async function registrationCandidates(c,r){const phone=phoneKey(r.phone),doc=docKey(r.document);
 const v=(await c.query(`SELECT v.id,v.plate,v.brand,v.model,v.year,v.mileage,v.photo_id,v.plate_photo_id,v.deleted_at IS NOT NULL AS deleted,
   o.id AS owner_id,o.name AS owner_name,o.phone AS owner_phone,o.email AS owner_email,o.document AS owner_document,o.photo_id AS owner_photo_id,o.deleted_at IS NOT NULL AS owner_deleted,
   (SELECT x.code FROM orders x WHERE x.vehicle_id=v.id AND x.status='open' LIMIT 1) AS open_order
  FROM vehicles v JOIN clients o ON o.id=v.client_id WHERE regexp_replace(upper(v.plate),'[^A-Z0-9]','','g')=$1 LIMIT 1`,[normPlate(r.plate)])).rows[0]||null;
 const clients=(await c.query(`SELECT c.id,c.name,c.phone,c.email,c.document,c.photo_id,(SELECT count(*)::int FROM vehicles v WHERE v.client_id=c.id AND v.deleted_at IS NULL) AS vehicles
  FROM clients c WHERE c.deleted_at IS NULL AND (($1<>'' AND right(regexp_replace(c.phone,'\\D','','g'),10)=$1) OR ($2<>'' AND regexp_replace(upper(c.document),'[^A-Z0-9]','','g')=$2))
  ORDER BY c.created_at LIMIT 5`,[phone,doc])).rows;
 const owner=v&&{id:v.owner_id,name:v.owner_name,phone:v.owner_phone,email:v.owner_email,document:v.owner_document,photo_id:v.owner_photo_id,deleted:v.owner_deleted};
 return {vehicle:v&&{id:v.id,plate:v.plate,brand:v.brand,model:v.model,year:v.year,mileage:v.mileage,photo_id:v.photo_id,plate_photo_id:v.plate_photo_id,deleted:v.deleted,open_order:v.open_order},
  owner:owner&&{...owner,compare:compareIdentity(r,owner)},
  clients:clients.map(x=>({...x,compare:compareIdentity(r,x),matched_by:[phone&&phoneKey(x.phone)===phone&&'teléfono',doc&&docKey(x.document)===doc&&'cédula'].filter(Boolean)}))}}
app.get('/api/registrations/:id',permit('people'),wrap(async(req,res)=>{checkUuid(req.params.id);
 const r=(await q(`SELECT ${regCols},r.consent_text,u.name AS reviewed_by_name,o.code AS order_code FROM client_registrations r LEFT JOIN users u ON u.id=r.reviewed_by LEFT JOIN orders o ON o.id=r.order_id WHERE r.id=$1`,[req.params.id])).rows[0];
 if(!r)fail('Registro no encontrado',404);res.json({...r,candidates:r.status==='pending'?await registrationCandidates(pool,r):null})}));
// Aceptar exige decidir la identidad: si la placa ya existe, quien registra es el propietario (y se confirman uno a uno los datos
// de su ficha que cambian) o un autorizado (la ficha del propietario no cambia y su nombre queda en la OT). Sin placa conocida se elige
// un cliente coincidente o se crea uno nuevo. Bloqueos por placa y teléfono hacen que dos aceptaciones simultáneas se atiendan en fila.
const CLIENT_UPDATES={name:['name','name'],phone:['phone','phone'],email:['email','email'],document:['document','document'],photo:['photo_id','profile_photo']};
const VEHICLE_UPDATES={photo:['photo_id','vehicle_photo'],plate_photo:['plate_photo_id','plate_photo'],mileage:['mileage','mileage']};
const ORDER_TYPES=['maintenance','repair','warranty','diagnostic','accessories'];
app.post('/api/registrations/:id/accept',permit('people'),wrap(async(req,res)=>{checkUuid(req.params.id);const b=req.body,openIt=b.open_order===true||b.open_order==='true';
 const identity=String(b.identity||''),list=v=>[...new Set(Array.isArray(v)?v.map(String):[])],updates=list(b.updates),vUpdates=list(b.vehicle_updates);
 if(!['new','existing','owner','authorized'].includes(identity))fail('Indica quién es la persona que registra');
 if(updates.some(u=>!CLIENT_UPDATES[u])||vUpdates.some(u=>!VEHICLE_UPDATES[u]))fail('Actualización no permitida');
 if(identity==='authorized'&&updates.length)fail('Una persona autorizada no modifica la ficha del propietario');
 if(identity==='new'&&updates.length)fail('Un cliente nuevo no actualiza otra ficha');
 if(openIt&&!ORDER_TYPES.includes(b.type))fail('Elige el tipo de servicio');
 if(openIt&&!['normal','high','urgent'].includes(b.priority||'normal'))fail('Prioridad inválida');
 const out=await tx(async c=>{const first=(await c.query('SELECT plate,phone FROM client_registrations WHERE id=$1',[req.params.id])).rows[0];if(!first)fail('Registro no encontrado',404);
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['plate:'+normPlate(first.plate)]);
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['phone:'+(phoneKey(first.phone)||req.params.id)]);
  const r=(await c.query(`SELECT ${regCols} FROM client_registrations r WHERE r.id=$1 FOR UPDATE`,[req.params.id])).rows[0];if(r.status!=='pending')fail('Este registro ya fue revisado',409);
  const {vehicle:known,owner,clients}=await registrationCandidates(c,r);
  let clientId=null,vehicleId=null;const applied={},dropoff=identity==='authorized'?{name:r.name,phone:r.phone}:null;
  if(known){if(known.deleted||owner.deleted)fail(`La placa ${known.plate} está en Borradores; restáurala antes de aceptar`,409);
   if(!['owner','authorized'].includes(identity))fail(`La placa ${known.plate} ya está registrada a nombre de ${owner.name}. Indica si quien registra es el propietario o una persona autorizada.`,409);
   clientId=owner.id;vehicleId=known.id}
  else if(identity==='existing'){const m=clients.find(x=>x.id===b.client_id);if(!m)fail('El cliente elegido ya no coincide con este registro; vuelve a abrirlo',409);clientId=m.id}
  else if(identity!=='new')fail('Esta placa no está registrada: elige un cliente coincidente o crea uno nuevo',409);
  // Cambios en la ficha existente: solo los confirmados, con el valor anterior en la auditoría.
  if(clientId&&updates.length){const cur=(await c.query('SELECT name,phone,email,document,photo_id FROM clients WHERE id=$1 FOR UPDATE',[clientId])).rows[0];
   for(const u of updates){const [col,src]=CLIENT_UPDATES[u],val=r[src];if(!val)fail('El registro no trae ese dato para actualizar la ficha');
    applied[u]={from:cur[col]??null,to:val};await c.query(`UPDATE clients SET ${col}=$2 WHERE id=$1`,[clientId,val])}}
  if(!clientId){clientId=randomUUID();await c.query('INSERT INTO clients(id,name,phone,email,document,photo_id) VALUES($1,$2,$3,$4,$5,$6)',[clientId,r.name,r.phone,r.email,r.document,r.profile_photo])}
  if(vehicleId){const cur=(await c.query('SELECT photo_id,plate_photo_id,mileage FROM vehicles WHERE id=$1 FOR UPDATE',[vehicleId])).rows[0];
   for(const u of vUpdates){const [col,src]=VEHICLE_UPDATES[u],val=r[src];if(val==null)fail('El registro no trae ese dato del vehículo');
    if(u==='mileage'&&Number(val)<Number(cur.mileage||0))fail('El kilometraje del registro es menor que el que ya tiene el vehículo');
    applied['vehicle_'+u]={from:cur[col]??null,to:val};await c.query(`UPDATE vehicles SET ${col}=$2 WHERE id=$1`,[vehicleId,val])}}
  else{vehicleId=randomUUID();await c.query('INSERT INTO vehicles(id,client_id,plate,brand,model,year,mileage,photo_id,plate_photo_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[vehicleId,clientId,r.plate,r.brand,r.model,r.year,r.mileage||0,r.vehicle_photo,r.plate_photo]);
   await log(c,null,req.user.id,'vehicle.created',{vehicle_id:vehicleId,plate:r.plate,registration:r.code})}
  let orderId=null;
  if(openIt){if(await openOrdersOf(c,'vehicle_id',vehicleId))fail(`${r.plate} ya tiene una orden abierta en el taller${known?.open_order?` (${known.open_order})`:''}`,409);
   const o=await c.query(`INSERT INTO orders(client_id,vehicle_id,created_by,type,summary,inspection,notes,priority,mileage_in,dropoff_name,dropoff_phone) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [clientId,vehicleId,req.user.id,b.type,pickText(r.problem,250),needText(b.inspection,'Inspección de recepción',3000),`Problema reportado por el cliente (${r.code}): ${r.problem}`.slice(0,3000),b.priority||'normal',r.mileage||0,dropoff?.name||'',dropoff?.phone||'']);
   orderId=o.rows[0].id;await c.query('UPDATE orders SET code=$1 WHERE id=$2',[`OT-${new Date().getFullYear()}-${String(orderId).padStart(5,'0')}`,orderId]);
   await log(c,orderId,req.user.id,'order.created',{type:b.type,summary:pickText(r.problem,250),registration:r.code,dropoff:dropoff?.name})}
  await c.query(`UPDATE client_registrations SET status='accepted',client_id=$2,vehicle_id=$3,order_id=$4,relation=$5,applied_updates=$6,reviewed_by=$7,reviewed_at=now(),review_note=$8 WHERE id=$1`,
   [r.id,clientId,vehicleId,orderId,identity,JSON.stringify(applied),req.user.id,pickText(b.note,500)]);
  await log(c,orderId,req.user.id,'registration.accepted',{registration_id:r.id,code:r.code,vehicle_id:vehicleId,client_id:clientId,name:r.name,problem:r.problem,identity,updates:Object.keys(applied),changes:applied,dropoff:dropoff?.name,note:pickText(b.note,500)});
  return {client_id:clientId,vehicle_id:vehicleId,order_id:orderId,identity,applied}});res.json(out)}));
app.post('/api/registrations/:id/reject',permit('people'),wrap(async(req,res)=>{checkUuid(req.params.id);const note=needText(req.body.note,'Motivo del rechazo',500);
 await tx(async c=>{const r=(await c.query(`SELECT ${regCols} FROM client_registrations r WHERE r.id=$1 FOR UPDATE`,[req.params.id])).rows[0];if(!r)fail('Registro no encontrado',404);if(r.status!=='pending')fail('Este registro ya fue revisado',409);
  await c.query(`UPDATE client_registrations SET status='rejected',reviewed_by=$2,reviewed_at=now(),review_note=$3 WHERE id=$1`,[r.id,req.user.id,note]);
  await log(c,null,req.user.id,'registration.rejected',{registration_id:r.id,code:r.code,name:r.name,plate:r.plate,note})});res.json({ok:true})}));
// Limpieza de fotos: a los N días se quitan las de registros rechazados; después se borran las fotos que ya no usa ninguna ficha
// ni registro (con más de un día) y los archivos m-* sin fila en la base (con más de una hora). Nada referenciado se toca.
async function sweepMedia(){const out={rejected:0,rows:0,files:0};
 out.rejected=(await q(`UPDATE client_registrations SET profile_photo=NULL,vehicle_photo=NULL,plate_photo=NULL,photos_purged_at=now()
  WHERE status='rejected' AND photos_purged_at IS NULL AND reviewed_at<now()-make_interval(days=>$1) AND (profile_photo IS NOT NULL OR vehicle_photo IS NOT NULL OR plate_photo IS NOT NULL)`,[REG.rejectedDays])).rowCount;
 const dead=(await q(`DELETE FROM media m WHERE m.created_at<now()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM clients x WHERE x.photo_id=m.id)
  AND NOT EXISTS(SELECT 1 FROM vehicles x WHERE x.photo_id=m.id OR x.plate_photo_id=m.id) AND NOT EXISTS(SELECT 1 FROM client_registrations x WHERE m.id IN (x.profile_photo,x.vehicle_photo,x.plate_photo))
  RETURNING stored_name,thumb_name`)).rows;
 await mediaLib.removeFiles(uploads,dead.flatMap(d=>[d.stored_name,d.thumb_name].filter(Boolean)));out.rows=dead.length;
 const known=new Set((await q('SELECT stored_name,thumb_name FROM media')).rows.flatMap(x=>[x.stored_name,x.thumb_name]));const cutoff=Date.now()-60*60*1000;
 for(const name of await fs.promises.readdir(uploads)){if(!/^m-[0-9a-f-]{36}(-t)?\.(jpg|png|webp)$/.test(name)||known.has(name))continue;
  const st=await fs.promises.stat(path.join(uploads,name)).catch(()=>null);if(st&&st.mtimeMs<cutoff){await fs.promises.unlink(path.join(uploads,name)).catch(()=>{});out.files++}}
 if(out.rejected||out.rows||out.files)await log({query:q},null,null,'media.purged',out);return out}
app.get('/api/appointments',permit('read'),wrap(async(req,res)=>res.json((await q('SELECT a.*,c.name AS client_name,v.plate FROM appointments a JOIN clients c ON c.id=a.client_id JOIN vehicles v ON v.id=a.vehicle_id ORDER BY a.scheduled_at DESC LIMIT 500')).rows)));
app.post('/api/appointments',permit('orders'),wrap(async(req,res)=>{const b=req.body,id=randomUUID();checkUuid(b.client_id);checkUuid(b.vehicle_id);if(!b.scheduled_at||!Number.isFinite(new Date(b.scheduled_at).getTime()))fail('Fecha inválida');
 const v=(await q('SELECT client_id,deleted_at FROM vehicles WHERE id=$1',[b.vehicle_id])).rows[0];if(!v||v.client_id!==b.client_id)fail('Vehículo no pertenece al cliente');if(v.deleted_at)fail('El vehículo está en Borradores; restáuralo primero',409);
 await q('INSERT INTO appointments(id,client_id,vehicle_id,scheduled_at,reason,notes) VALUES($1,$2,$3,$4,$5,$6)',[id,b.client_id,b.vehicle_id,b.scheduled_at,needText(b.reason,'Motivo'),pickText(b.notes,1000)]);res.status(201).json({id})}));
app.patch('/api/appointments/:id',permit('orders'),wrap(async(req,res)=>{checkUuid(req.params.id);if(!['scheduled','confirmed','arrived','cancelled'].includes(req.body.status))fail('Estado inválido');
 const r=await q('UPDATE appointments SET status=$1 WHERE id=$2 RETURNING id',[req.body.status,req.params.id]);if(!r.rowCount)fail('Cita no encontrada',404);res.json({ok:true})}));
app.get('/api/orders',permit('read'),wrap(async(req,res)=>res.json((await q(listOrders())).rows)));
app.get('/api/orders/:id',permit('read'),wrap(async(req,res)=>{const id=req.params.id;if(!integer(id,1))fail('ID inválido');const order=await getOrder(id);
 const [tasks,parts,events,files,warranty,partOrders]=await Promise.all([
 q('SELECT t.*,u.name AS assigned_name FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.order_id=$1 ORDER BY t.created_at',[id]),
 q('SELECT r.*,i.name AS item_name,i.sku,i.stock FROM parts_requests r JOIN inventory i ON i.id=r.item_id WHERE r.order_id=$1 ORDER BY r.created_at DESC',[id]),
 q("SELECT a.*,u.name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.order_id=$1 OR (a.event_type='part.transferred' AND a.detail->>'from_order_id'=$2) ORDER BY a.created_at DESC LIMIT 100",[id,String(id)]),
 q('SELECT id,original_name,mime,size,created_at FROM attachments WHERE order_id=$1 ORDER BY created_at DESC',[id]),
 q('SELECT * FROM warranties WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT 1',[order.vehicle_id]),
 q(`${partSql} WHERE p.order_id=$1 ORDER BY p.created_at DESC`,[id])]);
 res.json({...order,tasks:tasks.rows,parts:parts.rows,events:events.rows,attachments:files.rows,warranty:warranty.rows[0]||null,part_orders:partOrders.rows});
}));
app.post('/api/orders',permit('orders'),wrap(async(req,res)=>{const b=req.body;checkUuid(b.vehicle_id);checkUuid(b.client_id);if(!['maintenance','repair','warranty','diagnostic','accessories'].includes(b.type))fail('Tipo de servicio inválido');
 if(!integer(b.mileage_in||0))fail('Kilometraje inválido');if(!['normal','high','urgent'].includes(b.priority||'normal'))fail('Prioridad inválida');
 const id=await tx(async c=>{const vehicle=(await c.query('SELECT client_id,deleted_at FROM vehicles WHERE id=$1 FOR UPDATE',[b.vehicle_id])).rows[0];if(!vehicle||vehicle.client_id!==b.client_id)fail('El vehículo no pertenece al cliente');if(vehicle.deleted_at)fail('El vehículo está en Borradores; restáuralo primero',409);
 // Una sola OT abierta por vehículo (el bloqueo de la fila serializa altas simultáneas; el índice único parcial lo respalda).
 if(await openOrdersOf(c,'vehicle_id',b.vehicle_id))fail('El vehículo ya tiene una orden abierta en el taller',409);
 const r=await c.query(`INSERT INTO orders(client_id,vehicle_id,created_by,type,summary,inspection,notes,priority,mileage_in,estimated_finish)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[b.client_id,b.vehicle_id,req.user.id,b.type,needText(b.summary,'Trabajo',250),needText(b.inspection,'Inspección de recepción',3000),pickText(b.notes,3000),b.priority||'normal',Number(b.mileage_in||0),b.estimated_finish||null]);
 const id=r.rows[0].id;await c.query('UPDATE orders SET code=$1 WHERE id=$2',[`OT-${new Date().getFullYear()}-${String(id).padStart(5,'0')}`,id]);await log(c,id,req.user.id,'order.created',{type:b.type,summary:b.summary});return id});res.status(201).json({id});
}));
// Pasos sobre una orden ya bloqueada (FOR UPDATE) dentro de una transacción: los usan las rutas sueltas y el movimiento
// encadenado. op es el id de ese movimiento, si lo hay: queda en cada evento para reconocer los pasos de una misma operación.
const orderLog=(c,o,user,op,type,detail={})=>log(c,o.id,user.id,type,op?{...detail,operation:op}:detail);
async function assignOrder(c,user,o,b,op){if(b.assigned_to)checkUuid(b.assigned_to);openOrder(o);if(o.station!==3)fail('La asignación corresponde a taller');
 if(b.assigned_to){const tech=(await c.query('SELECT role,active FROM users WHERE id=$1',[b.assigned_to])).rows[0];if(!tech||!tech.active||!['technician','chief','manager','admin'].includes(tech.role))fail('Técnico inválido')}
 await c.query('UPDATE orders SET assigned_to=$1,bay=$2,location=$3,updated_at=now() WHERE id=$4',[optionalUuid(b.assigned_to),pickText(b.bay,60),pickText(b.bay,60)||'Taller',o.id]);await orderLog(c,o,user,op,'order.assigned',{technician:b.assigned_to,bay:b.bay})}
// Resolver un bloqueo no aprueba presupuestos ni sustituye el despacho de repuestos.
async function unblockOrder(c,user,o,op){openOrder(o);
 if(o.substatus==='waiting_approval'&&!o.quote_approved)fail('El presupuesto debe aprobarse desde Presupuesto',409);
 if((await c.query("SELECT count(*)::int n FROM parts_requests WHERE order_id=$1 AND status='requested'",[o.id])).rows[0].n)fail('Hay solicitudes de repuestos pendientes',409);
 await c.query("UPDATE orders SET substatus='active',blocked_reason='',updated_at=now() WHERE id=$1",[o.id]);await orderLog(c,o,user,op,'order.unblocked',{reason:o.blocked_reason})}
async function quoteOrder(c,user,o,b,op){const amount=Number(b.amount);if(!Number.isFinite(amount)||amount<0||amount>100000000)fail('Monto inválido');openOrder(o);
 await c.query('UPDATE orders SET quote_amount=$1,quote_approved=$2,substatus=$3,blocked_reason=$4,updated_at=now() WHERE id=$5',
 [amount,b.approved===true,b.approved===true?(o.substatus==='waiting_approval'?'active':o.substatus):'waiting_approval',b.approved===true?(o.substatus==='waiting_approval'?'':o.blocked_reason):'Esperando aprobación de presupuesto',o.id]);
 await orderLog(c,o,user,op,'order.quote',{amount,approved:b.approved===true})}
// Confirmar tareas al enviar a Calidad: se terminan exactamente las que el usuario revisó (y la que describió si no había
// ninguna); si apareció otra pendiente mientras confirmaba, se detiene sin guardar nada.
async function confirmTasks(c,user,o,b,op){openOrder(o);if(o.station!==3)fail('Las tareas se confirman en taller');
 const ids=new Set(Array.isArray(b.task_ids)?b.task_ids.map(String):[]),work=pickText(b.work_done,500);
 if(work){const id=randomUUID();await c.query('INSERT INTO tasks(id,order_id,description) VALUES($1,$2,$3)',[id,o.id,work]);await orderLog(c,o,user,op,'task.created',{description:work});ids.add(id)}
 const tasks=(await c.query('SELECT id,description,status FROM tasks WHERE order_id=$1 ORDER BY created_at',[o.id])).rows;
 if([...ids].some(id=>!tasks.some(t=>t.id===id)))fail('Una de las tareas confirmadas ya no está en la orden. Cierra el formulario y vuelve a intentarlo.',409);
 const pending=tasks.filter(t=>t.status!=='done'),extra=pending.filter(t=>!ids.has(t.id));
 if(extra.length)fail(`Se agregaron tareas mientras confirmabas: ${extra.map(t=>t.description).join(' · ')}. Revísalas antes de enviar a Calidad.`,409);
 for(const t of pending){await c.query("UPDATE tasks SET status='done',done_at=now() WHERE id=$1",[t.id]);await orderLog(c,o,user,op,'task.status',{task:t.description,status:'done'})}}
app.post('/api/orders/:id/assign',permit('assign'),wrap(async(req,res)=>{await tx(async c=>assignOrder(c,req.user,await lockedOrder(c,req.params.id),req.body));res.json({ok:true})}));
app.patch('/api/orders/:id/notes',permit('work'),wrap(async(req,res)=>{const b=req.body;await tx(async c=>{const o=await lockedOrder(c,req.params.id);openOrder(o);
 await c.query('UPDATE orders SET notes=$1,diagnosis=$2,updated_at=now() WHERE id=$3',[pickText(b.notes??o.notes,5000),pickText(b.diagnosis??o.diagnosis,5000),o.id]);await log(c,o.id,req.user.id,'order.notes_updated')});res.json({ok:true})}));
app.post('/api/orders/:id/tasks',permit('work'),wrap(async(req,res)=>{const desc=needText(req.body.description,'Tarea',500);await tx(async c=>{const o=await lockedOrder(c,req.params.id);openOrder(o);if(o.station!==3)fail('Las tareas se agregan en taller');
 await c.query('INSERT INTO tasks(id,order_id,description) VALUES($1,$2,$3)',[randomUUID(),o.id,desc]);await log(c,o.id,req.user.id,'task.created',{description:desc})});res.status(201).json({ok:true})}));
app.patch('/api/tasks/:id',permit('work'),wrap(async(req,res)=>{checkUuid(req.params.id);if(!['pending','in_progress','done'].includes(req.body.status))fail('Estado de tarea inválido');
 await tx(async c=>{const item=(await c.query('SELECT * FROM tasks WHERE id=$1',[req.params.id])).rows[0];if(!item)fail('Tarea no encontrada',404);const o=await lockedOrder(c,item.order_id);openOrder(o);if(o.station!==3)fail('La tarea no está en taller');
 await c.query('UPDATE tasks SET status=$1,done_at=$2 WHERE id=$3',[req.body.status,req.body.status==='done'?new Date():null,item.id]);await log(c,o.id,req.user.id,'task.status',{task:item.description,status:req.body.status})});res.json({ok:true})}));
app.post('/api/orders/:id/block',permit('work'),wrap(async(req,res)=>{const reason=needText(req.body.reason,'Motivo de bloqueo',500);const state=['waiting_parts','waiting_approval','waiting_bay','paused'].includes(req.body.substatus)?req.body.substatus:'paused';
 await tx(async c=>{const o=await lockedOrder(c,req.params.id);openOrder(o);await c.query('UPDATE orders SET substatus=$1,blocked_reason=$2,updated_at=now() WHERE id=$3',[state,reason,o.id]);await log(c,o.id,req.user.id,'order.blocked',{state,reason})});res.json({ok:true})}));
app.post('/api/orders/:id/unblock',permit('work'),wrap(async(req,res)=>{await tx(async c=>unblockOrder(c,req.user,await lockedOrder(c,req.params.id)));res.json({ok:true})}));
app.post('/api/orders/:id/quote',permit('quote'),wrap(async(req,res)=>{await tx(async c=>quoteOrder(c,req.user,await lockedOrder(c,req.params.id),req.body));res.json({ok:true})}));
const STATION_LOCATIONS=['Recepción','Área de traslado','Taller','Control de calidad','Área de lavado','Pendiente de traslado a entrega'];
function checkTransition(user,action){if(!TRANSITIONS[action]&&!['return_confirm','deliver','cancel','revert'].includes(action))fail('Acción no reconocida');if(!transitionAllowed(user.role,action))fail('Tu rol no puede realizar esta transición',403)}
async function transitionOrder(c,user,o,action,b,op,deliveryRate=null){const def=TRANSITIONS[action];openOrder(o);
 if(def&&o.station!==def[0])fail('La orden no está en la estación correspondiente',409);
 const forward=(def&&def[1]>def[0])||action==='return_confirm'||action==='deliver',extra={};
 if(forward&&o.blocked_reason)fail('Resuelve el bloqueo antes de avanzar',409);
 if(forward&&(o.substatus==='waiting_approval'||Number(o.quote_amount)>0)&&!o.quote_approved)fail('El presupuesto requiere aprobación',409);
 const args={station:o.station,substatus:'pending',location:o.location,quality_ok:o.quality_ok,quality_note:o.quality_note,wash_ok:o.wash_ok,wash_note:o.wash_note,returned_ok:o.returned_ok,
 reworks:o.reworks,status:o.status,recipient:o.delivery_recipient,delivery_note:o.delivery_note,exchange_rate:null,paid_usd:null,paid_ves:null};
 if(action==='to_transfer'){
 if(o.type==='warranty'){const w=(await c.query('SELECT id,state FROM warranties WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT 1',[o.vehicle_id])).rows[0];
  if(!w||w.state!=='eligible')fail('Garantías debe evaluar y aprobar el expediente antes del traslado',409)}
 args.station=2;args.location='Área de traslado';
 }else if(action==='to_workshop'){args.station=3;args.location='Taller';args.substatus='active';
 }else if(action==='to_quality'){
 if(!o.assigned_to||!o.bay.trim())fail('Asigna técnico y puesto antes de enviar a Calidad',409);
 const tasks=(await c.query("SELECT count(*)::int total,count(*) FILTER(WHERE status<>'done')::int pending FROM tasks WHERE order_id=$1",[o.id])).rows[0];
 if(!tasks.total||tasks.pending)fail('Completa todas las tareas antes de enviar a Calidad',409);
 if((await c.query("SELECT count(*)::int n FROM parts_requests WHERE order_id=$1 AND status='requested'",[o.id])).rows[0].n)fail('Hay solicitudes de repuestos pendientes',409);
 args.station=4;args.location='Control de calidad';
 }else if(action==='quality_pass'){
 args.quality_ok=true;args.quality_note=needText(b.note,'Evidencia de calidad',1000);args.station=5;args.location='Área de lavado';
 }else if(action==='quality_reject'){
 const note=needText(b.note,'Motivo del rechazo',1000);args.quality_ok=false;args.quality_note=note;args.station=3;args.location='Taller';args.substatus='rework';args.reworks=Number(o.reworks)+1;
 await c.query('INSERT INTO tasks(id,order_id,description) VALUES($1,$2,$3)',[randomUUID(),o.id,`Retrabajo: ${note}`]);
 }else if(action==='wash_complete'){
 if(!o.quality_ok)fail('Calidad debe aprobar el trabajo antes del lavado',409);args.wash_ok=true;args.wash_note=needText(b.note,'Evidencia de lavado',1000);args.station=6;args.location='Pendiente de traslado a entrega';
 }else if(action==='return_confirm'){
 if(o.station!==6)fail('El vehículo debe estar en Entrega',409);if(!o.quality_ok||!o.wash_ok)fail('Faltan calidad o lavado',409);if(o.returned_ok)fail('El retorno ya fue confirmado',409);args.returned_ok=true;args.location='Recepción · listo para entrega';args.substatus='ready';
 }else if(action==='deliver'){
 if(o.station!==6)fail('La orden debe estar en Entrega',409);if(!o.quality_ok||!o.wash_ok||!o.returned_ok)fail('Faltan calidad, lavado o confirmación de retorno',409);
 args.recipient=needText(b.recipient,'Persona que recibe',150);args.delivery_note=pickText(b.note,1500);args.status='closed';args.substatus='closed';args.location='Entregado';
 args.paid_usd=Number(o.quote_amount);args.exchange_rate=deliveryRate;args.paid_ves=deliveryRate?Math.round(args.paid_usd*deliveryRate*100)/100:null;
 extra.paid={usd:args.paid_usd,ves:args.paid_ves,rate:deliveryRate};
 }else if(action==='revert'){
 const to=Number(b.station);if(!Number.isInteger(to)||to<1||to>=o.station)fail('Elige una estación anterior a la actual');
 if(!['admin','manager','chief'].includes(user.role)){
  // Sin rol de supervisión solo se deshace el último movimiento propio, durante 10 minutos.
  const last=(await c.query("SELECT actor_id,detail,created_at>now()-interval '10 minutes' AS recent FROM audit_events WHERE order_id=$1 AND event_type LIKE 'order.%' AND detail ? 'from' AND detail ? 'to' ORDER BY created_at DESC LIMIT 1",[o.id])).rows[0];
  if(!last||last.actor_id!==user.id||!last.recent||Number(last.detail.from)!==to||Number(last.detail.to)!==o.station)fail('Solo puedes deshacer tu último movimiento durante 10 minutos. Para otras correcciones pide ayuda al jefe de taller.',403)}
 args.station=to;args.location=to===3?(o.bay||'Taller'):STATION_LOCATIONS[to-1];args.substatus=to===3?'active':'pending';needText(b.note,'Motivo de la devolución',800);
 if(to<=4)args.quality_ok=false;if(to<=5)args.wash_ok=false;args.returned_ok=false;
 }else if(action==='cancel'){
 if(!['admin','manager'].includes(user.role))fail('Solo gerencia puede cancelar',403);args.status='cancelled';args.substatus='cancelled';args.delivery_note=needText(b.note,'Motivo de cancelación',800);
 }
 await c.query(`UPDATE orders SET station=$1,substatus=$2,location=$3,quality_ok=$4,quality_note=$5,wash_ok=$6,wash_note=$7,returned_ok=$8,
 reworks=$9,status=$10,delivery_recipient=$11,delivery_note=$12,blocked_reason=$17,closed_at=CASE WHEN $10='closed' THEN now() ELSE closed_at END,
 exchange_rate=COALESCE($14,exchange_rate),paid_usd=COALESCE($15,paid_usd),paid_ves=COALESCE($16,paid_ves),updated_at=now() WHERE id=$13`,
 [args.station,args.substatus,args.location,args.quality_ok,args.quality_note,args.wash_ok,args.wash_note,args.returned_ok,args.reworks,args.status,args.recipient,args.delivery_note,o.id,args.exchange_rate,args.paid_usd,args.paid_ves,o.blocked_reason]);
 await orderLog(c,o,user,op,`order.${action}`,{from:o.station,to:args.station,note:pickText(b.note,800),...extra})}
app.post('/api/orders/:id/transition',wrap(async(req,res)=>{const action=req.body.action;checkTransition(req.user,action);
 // Al entregar se guarda la tasa BCV vigente y el monto en US$ y Bs; se consulta antes de abrir la transacción para no bloquear la orden.
 const deliveryRate=action==='deliver'?(await rateInfo()).current?.usd??null:null;
 await tx(async c=>transitionOrder(c,req.user,await lockedOrder(c,req.params.id),action,req.body,null,deliveryRate));res.json({ok:true})}));
// Movimiento encadenado (mapa, tablero y ficha): presupuesto, desbloqueo, asignación, tareas y transiciones en UNA transacción,
// con las mismas validaciones que las rutas sueltas. Si un paso falla no queda ninguno guardado. operation_id hace seguro el
// reintento (si ya se guardó, responde lo mismo sin repetir nada) y from, el monto, el bloqueo y las tareas confirmadas impiden
// aplicar un plan preparado con datos que otro usuario cambió mientras tanto.
const MOVE_STEPS={quote:['quote','aprobar el presupuesto'],unblock:['work','resolver bloqueos'],assign:['assign','asignar técnico y puesto'],tasks:['work','terminar tareas']};
const MOVE_ACTIONS=[...Object.keys(TRANSITIONS),'revert'];
app.post('/api/orders/:id/move',wrap(async(req,res)=>{const b=req.body,id=req.params.id,steps=Array.isArray(b.steps)?b.steps:[];checkUuid(b.operation_id);
 if(!integer(id,1))fail('ID inválido');if(!integer(b.from,1,6)||(b.to!=null&&!integer(b.to,1,6)))fail('Estación inválida');if(!steps.length||steps.length>12)fail('Movimiento sin pasos');
 for(const s of steps){if(s?.kind){if(!Object.hasOwn(MOVE_STEPS,s.kind))fail('Paso no reconocido');if(!allowed(req.user.role,MOVE_STEPS[s.kind][0]))fail(`Tu rol no puede ${MOVE_STEPS[s.kind][1]}`,403)}
  else{if(!MOVE_ACTIONS.includes(s?.action))fail('Acción no reconocida');checkTransition(req.user,s.action)}}
 const out=await tx(async c=>{let o=await lockedOrder(c,id);
  const prev=(await c.query('SELECT order_id,result FROM order_operations WHERE id=$1',[b.operation_id])).rows[0];
  if(prev){if(String(prev.order_id)!==String(o.id))fail('Ese identificador de operación pertenece a otra orden',409);return {...prev.result,repeated:true}}
  openOrder(o);if(o.station!==Number(b.from))fail(`${o.code} ya no está en ${STATIONS[b.from-1]} sino en ${STATIONS[o.station-1]}: alguien la movió. Cierra el formulario y vuelve a intentarlo.`,409);
  for(const s of steps){o=await lockedOrder(c,id);
   if(s.kind==='quote'){if(Number(s.amount)!==Number(o.quote_amount))fail(`El presupuesto cambió a US$ ${Number(o.quote_amount).toFixed(2)} mientras confirmabas. Cierra el formulario y revísalo.`,409);
    if(!o.quote_approved)await quoteOrder(c,req.user,o,{amount:o.quote_amount,approved:true},b.operation_id)}
   else if(s.kind==='unblock'){if(!o.blocked_reason)continue;if(String(s.reason??'')!==o.blocked_reason)fail(`El bloqueo cambió: ${o.blocked_reason}. Cierra el formulario y revísalo.`,409);await unblockOrder(c,req.user,o,b.operation_id)}
   else if(s.kind==='assign')await assignOrder(c,req.user,o,s,b.operation_id);
   else if(s.kind==='tasks')await confirmTasks(c,req.user,o,s,b.operation_id);
   else await transitionOrder(c,req.user,o,s.action,s,b.operation_id)}
  o=await lockedOrder(c,id);if(b.to!=null&&o.station!==Number(b.to))fail(`El movimiento terminaría en ${STATIONS[o.station-1]} y no en ${STATIONS[b.to-1]}; no se guardó nada`,409);
  const result={operation_id:b.operation_id,order_id:o.id,from:Number(b.from),station:o.station};
  await c.query('INSERT INTO order_operations(id,order_id,actor_id,steps,result) VALUES($1,$2,$3,$4,$5)',[b.operation_id,o.id,req.user.id,JSON.stringify(steps.map(s=>s.kind||s.action)),JSON.stringify(result)]);return result});
 res.json(out)}));
app.get('/api/inventory',permit('read'),wrap(async(req,res)=>res.json((await q('SELECT * FROM inventory ORDER BY name')).rows)));
app.post('/api/inventory',permit('inventory'),wrap(async(req,res)=>{const b=req.body;if(!integer(b.stock)||!integer(b.min_stock))fail('Existencias inválidas');const price=Number(b.unit_price||0);if(!Number.isFinite(price)||price<0||price>99999999)fail('Precio inválido');
 const id=randomUUID();await q('INSERT INTO inventory(id,sku,name,category,stock,min_stock,unit_price) VALUES($1,$2,$3,$4,$5,$6,$7)',
 [id,needText(b.sku,'SKU',60).toUpperCase(),needText(b.name,'Artículo',150),pickText(b.category||'General',60),Number(b.stock),Number(b.min_stock),price]);res.status(201).json({id})}));
app.post('/api/inventory/:id/adjust',permit('inventory'),wrap(async(req,res)=>{checkUuid(req.params.id);const delta=Number(req.body.delta);if(!Number.isInteger(delta)||delta===0||Math.abs(delta)>100000)fail('Ajuste inválido');const reason=needText(req.body.reason,'Motivo de ajuste',500);
 await tx(async c=>{const r=await c.query('UPDATE inventory SET stock=stock+$1 WHERE id=$2 AND stock+$1>=0 RETURNING id,stock',[delta,req.params.id]);if(!r.rowCount)fail('Artículo no encontrado o stock insuficiente',409);
 await c.query('INSERT INTO inventory_movements(id,item_id,delta,reason,actor_id) VALUES($1,$2,$3,$4,$5)',[randomUUID(),req.params.id,delta,reason,req.user.id]);await log(c,null,req.user.id,'inventory.adjusted',{item_id:req.params.id,delta,reason})});res.json({ok:true})}));
app.get('/api/parts-requests',permit('read'),wrap(async(req,res)=>res.json((await q(`SELECT r.*,i.sku,i.name AS item_name,o.code FROM parts_requests r JOIN inventory i ON i.id=r.item_id JOIN orders o ON o.id=r.order_id ORDER BY r.created_at DESC LIMIT 500`)).rows)));
app.post('/api/orders/:id/parts',permit('parts'),wrap(async(req,res)=>{checkUuid(req.body.item_id);if(!integer(req.body.quantity,1,10000))fail('Cantidad inválida');
 await tx(async c=>{const o=await lockedOrder(c,req.params.id);openOrder(o);if(o.station!==3)fail('Solicitud disponible en taller');const it=(await c.query('SELECT * FROM inventory WHERE id=$1',[req.body.item_id])).rows[0];if(!it)fail('Repuesto no encontrado',404);
 await c.query('INSERT INTO parts_requests(id,order_id,item_id,quantity,requested_by) VALUES($1,$2,$3,$4,$5)',[randomUUID(),o.id,it.id,Number(req.body.quantity),req.user.id]);
 if(it.stock<Number(req.body.quantity))await c.query("UPDATE orders SET substatus='waiting_parts',blocked_reason=$1,updated_at=now() WHERE id=$2",[`Stock insuficiente: ${it.name}`,o.id]);
 await log(c,o.id,req.user.id,'parts.requested',{item:it.sku,quantity:Number(req.body.quantity)})});res.status(201).json({ok:true})}));
app.post('/api/parts-requests/:id/fulfill',wrap(async(req,res)=>{if(!['admin','manager','parts'].includes(req.user.role))fail('Solo almacén puede despachar',403);checkUuid(req.params.id);
 await tx(async c=>{const p=(await c.query('SELECT * FROM parts_requests WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!p)fail('Solicitud no encontrada',404);if(p.status!=='requested')fail('Esta solicitud ya fue procesada',409);
 const o=await lockedOrder(c,p.order_id);openOrder(o);
 const it=await c.query('UPDATE inventory SET stock=stock-$1 WHERE id=$2 AND stock>=$1 RETURNING id,stock',[p.quantity,p.item_id]);if(!it.rowCount)fail('Stock insuficiente. Registra una entrada antes de despachar',409);
 await c.query("UPDATE parts_requests SET status='fulfilled',fulfilled_by=$1,fulfilled_at=now() WHERE id=$2",[req.user.id,p.id]);
 await c.query('INSERT INTO inventory_movements(id,item_id,order_id,delta,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),p.item_id,o.id,-p.quantity,'Despacho a orden de trabajo',req.user.id]);
 const outstanding=(await c.query("SELECT count(*)::int n FROM parts_requests WHERE order_id=$1 AND status='requested'",[o.id])).rows[0].n;
 if(!outstanding&&o.substatus==='waiting_parts')await c.query("UPDATE orders SET substatus='active',blocked_reason='',updated_at=now() WHERE id=$1",[o.id]);
 await log(c,o.id,req.user.id,'parts.fulfilled',{request_id:p.id,quantity:p.quantity})});res.json({ok:true})}));
app.post('/api/parts-requests/:id/reject',wrap(async(req,res)=>{if(!['admin','manager','parts'].includes(req.user.role))fail('Solo almacén puede rechazar',403);checkUuid(req.params.id);const reason=needText(req.body.reason,'Motivo de rechazo',500);
 await tx(async c=>{const p=(await c.query('SELECT * FROM parts_requests WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!p)fail('Solicitud no encontrada',404);if(p.status!=='requested')fail('Solicitud ya procesada');
 const o=await lockedOrder(c,p.order_id);openOrder(o);await c.query("UPDATE parts_requests SET status='rejected',fulfilled_by=$1,fulfilled_at=now() WHERE id=$2",[req.user.id,p.id]);await log(c,o.id,req.user.id,'parts.rejected',{reason});
 if(o.substatus==='waiting_parts')await c.query("UPDATE orders SET substatus='paused',blocked_reason=$1 WHERE id=$2",[`Repuesto rechazado: ${reason}`,o.id])});res.json({ok:true})}));
app.get('/api/warranties',permit('read'),wrap(async(req,res)=>res.json((await q('SELECT w.*,v.plate,v.brand,v.model,c.name AS client_name FROM warranties w JOIN vehicles v ON v.id=w.vehicle_id JOIN clients c ON c.id=v.client_id ORDER BY w.created_at DESC LIMIT 500')).rows)));
app.post('/api/warranties',permit('warranty'),wrap(async(req,res)=>{checkUuid(req.body.vehicle_id);const id=randomUUID();
 const v=(await q('SELECT deleted_at FROM vehicles WHERE id=$1',[req.body.vehicle_id])).rows[0];if(!v)fail('Vehículo no encontrado',404);if(v.deleted_at)fail('El vehículo está en Borradores; restáuralo primero',409);await q('INSERT INTO warranties(id,vehicle_id,policy,notes,last_service_km) VALUES($1,$2,$3,$4,$5)',
 [id,req.body.vehicle_id,needText(req.body.policy,'Plan o referencia',500),pickText(req.body.notes,1200),Number(req.body.last_service_km||0)]);res.status(201).json({id})}));
app.patch('/api/warranties/:id',permit('warranty'),wrap(async(req,res)=>{checkUuid(req.params.id);if(!['review','eligible','not_eligible'].includes(req.body.state))fail('Estado de garantía inválido');
 const r=await q('UPDATE warranties SET state=$1,notes=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4 RETURNING id',[req.body.state,pickText(req.body.notes,1200),req.user.id,req.params.id]);if(!r.rowCount)fail('Garantía no encontrada',404);res.json({ok:true})}));
function fileSignature(buf){if(buf.length>=4&&buf[0]===0x25&&buf[1]===0x50&&buf[2]===0x44&&buf[3]===0x46)return ['application/pdf','pdf'];
 if(buf.length>=3&&buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff)return ['image/jpeg','jpg'];
 if(buf.length>=8&&buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return ['image/png','png'];
 if(buf.length>=12&&buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP')return ['image/webp','webp'];return null}
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1}});
app.post('/api/orders/:id/attachments',permit('orders'),upload.single('file'),wrap(async(req,res)=>{if(!req.file)fail('Selecciona un archivo');const sig=fileSignature(req.file.buffer);if(!sig)fail('Solo JPEG, PNG, WebP o PDF');
 const [mime,ext]=sig,id=randomUUID(),stored=`${id}.${ext}`,filepath=path.join(uploads,stored);
 await getOrder(req.params.id);await fs.promises.writeFile(filepath,req.file.buffer,{flag:'wx',mode:0o600});
 try{await tx(async c=>{openOrder(await lockedOrder(c,req.params.id));await c.query('INSERT INTO attachments(id,order_id,stored_name,original_name,mime,size,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
 [id,req.params.id,stored,pickText(req.file.originalname,140),mime,req.file.size,req.user.id]);await log(c,req.params.id,req.user.id,'attachment.created',{name:pickText(req.file.originalname,140)})})}catch(e){await fs.promises.unlink(filepath).catch(()=>{});throw e}res.status(201).json({id})}));
app.get('/api/attachments/:id',permit('read'),wrap(async(req,res)=>{checkUuid(req.params.id);const f=(await q('SELECT * FROM attachments WHERE id=$1',[req.params.id])).rows[0];if(!f)fail('Archivo no encontrado',404);
 res.setHeader('Content-Type',f.mime);res.setHeader('Content-Disposition',`attachment; filename="archivo-${f.id}.${f.stored_name.split('.').pop()}"`);res.setHeader('X-Content-Type-Options','nosniff');res.sendFile(path.join(uploads,f.stored_name))}));
app.get('/api/audit',permit('audit'),wrap(async(req,res)=>res.json((await q(`SELECT a.*,u.name AS actor_name,o.code FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN orders o ON o.id=a.order_id ORDER BY a.created_at DESC LIMIT 500`)).rows)));
// Tasa BCV: se consulta como máximo cada 3 horas y se guarda por fecha valor. Si el BCV no responde se usa la última guardada.
// La tasa vigente es la de fecha valor más reciente que no sea posterior a hoy (hora de Caracas); la publicada para mañana va en `next`.
const RATE_MAX_AGE=3*3600e3;let rateFetch=null;
function refreshRate(){if(!rateFetch)rateFetch=fetchBcv().then(async r=>{await q(`INSERT INTO exchange_rates(rate_date,usd,eur,source,fetched_at) VALUES($1,$2,$3,'BCV',now())
 ON CONFLICT(rate_date) DO UPDATE SET usd=EXCLUDED.usd,eur=EXCLUDED.eur,source='BCV',set_by=NULL,fetched_at=now()`,[r.date,r.usd,r.eur]);return r}).finally(()=>{rateFetch=null});return rateFetch}
async function rateInfo({force=false}={}){let error=null;const last=(await q('SELECT max(fetched_at) AS t FROM exchange_rates')).rows[0].t;
 if(force||!last||Date.now()-new Date(last).getTime()>RATE_MAX_AGE){try{await refreshRate()}catch(e){error=e.message;console.error('Tasa BCV:',e.message)}}
 const [rows,today]=await Promise.all([q('SELECT rate_date::text AS date,usd::float8 AS usd,eur::float8 AS eur,source,fetched_at FROM exchange_rates ORDER BY rate_date DESC LIMIT 60'),
  q("SELECT (now() AT TIME ZONE 'America/Caracas')::date::text AS d")]);const list=rows.rows,day=today.rows[0].d;
 const current=list.find(r=>r.date<=day)||null,next=list.filter(r=>r.date>day).pop()||null;
 return {current,next,today:day,history:list.slice().reverse(),error}}
app.get('/api/exchange-rate',permit('read'),wrap(async(req,res)=>res.json(await rateInfo())));
app.post('/api/exchange-rate/refresh',permit('read'),wrap(async(req,res)=>{const last=(await q('SELECT max(fetched_at) AS t FROM exchange_rates')).rows[0].t;
 res.json(await rateInfo({force:!last||Date.now()-new Date(last).getTime()>60e3}))}));
app.put('/api/exchange-rate',wrap(async(req,res)=>{if(!['admin','manager'].includes(req.user.role))fail('Solo gerencia puede fijar la tasa manualmente',403);
 const usd=Number(req.body.usd);if(!Number.isFinite(usd)||usd<=0||usd>1e9)fail('Tasa inválida');
 const date=/^\d{4}-\d{2}-\d{2}$/.test(req.body.date||'')?req.body.date:(await q("SELECT (now() AT TIME ZONE 'America/Caracas')::date::text AS d")).rows[0].d;
 await q(`INSERT INTO exchange_rates(rate_date,usd,source,set_by,fetched_at) VALUES($1,$2,'Manual',$3,now()) ON CONFLICT(rate_date) DO UPDATE SET usd=EXCLUDED.usd,source='Manual',set_by=EXCLUDED.set_by,fetched_at=now()`,[date,usd,req.user.id]);
 await tx(c=>log(c,null,req.user.id,'exchange_rate.manual',{date,usd}));res.json(await rateInfo())}));
// Ingresos y progreso por día (hora de Caracas). Bs: monto guardado al entregar o, si falta, US$ × tasa de esa fecha.
app.get('/api/reports/finance',permit('reports'),wrap(async(req,res)=>{const days=[7,14,30,90].includes(Number(req.query.days))?Number(req.query.days):30;
 const [rate,series,receivable]=await Promise.all([rateInfo(),
  q(`WITH t AS (SELECT (now() AT TIME ZONE 'America/Caracas')::date AS today),
   d AS (SELECT generate_series(t.today-($1::int-1),t.today,interval '1 day')::date AS day FROM t),
   c AS (SELECT (created_at AT TIME ZONE 'America/Caracas')::date AS day,count(*)::int n FROM orders GROUP BY 1),
   x AS (SELECT (o.closed_at AT TIME ZONE 'America/Caracas')::date AS day,count(*)::int n,sum(coalesce(o.paid_usd,o.quote_amount)) usd,
    sum(coalesce(o.paid_ves,o.quote_amount*coalesce((SELECT r.usd FROM exchange_rates r WHERE r.rate_date<=(o.closed_at AT TIME ZONE 'America/Caracas')::date ORDER BY r.rate_date DESC LIMIT 1),
     NULL::numeric))) ves FROM orders o WHERE o.status='closed' GROUP BY 1)
   SELECT d.day::text AS day,coalesce(c.n,0) AS created,coalesce(x.n,0) AS delivered,coalesce(x.usd,0)::float8 AS usd,coalesce(x.ves,0)::float8 AS ves
   FROM d LEFT JOIN c USING(day) LEFT JOIN x USING(day) ORDER BY d.day`,[days]),
  q(`SELECT count(*)::int open,count(*) FILTER(WHERE quote_amount>0)::int quoted,coalesce(sum(quote_amount),0)::float8 usd,
   coalesce(sum(quote_amount) FILTER(WHERE quote_approved),0)::float8 approved_usd FROM orders WHERE status='open'`)]);
 res.json({days,rate:rate.current,rate_error:rate.error,series:series.rows,receivable:receivable.rows[0]})}));
app.get('/api/reports',permit('reports'),wrap(async(req,res)=>{
 const [overview,stations,daily,low,blocked,technicians]=await Promise.all([
 q(`SELECT count(*) FILTER(WHERE status='open')::int active,
 count(*) FILTER(WHERE status='closed')::int closed,
 count(*) FILTER(WHERE status='open' AND blocked_reason<>'')::int blocked,
 count(*) FILTER(WHERE status='open' AND priority='urgent')::int urgent,
 round(coalesce(avg(extract(epoch FROM (closed_at-created_at))/3600) FILTER(WHERE status='closed'),0)::numeric,1) avg_hours
 FROM orders`),
 q("SELECT station,count(*)::int total FROM orders WHERE status='open' GROUP BY station ORDER BY station"),
 q("SELECT to_char(date_trunc('day',created_at),'DD Mon') label,count(*)::int total FROM orders WHERE created_at >= now()-interval '6 days' GROUP BY date_trunc('day',created_at) ORDER BY date_trunc('day',created_at)"),
 q('SELECT id,sku,name,stock,min_stock FROM inventory WHERE stock<=min_stock ORDER BY stock ASC LIMIT 12'),
 q("SELECT code,summary,blocked_reason,updated_at FROM orders WHERE status='open' AND blocked_reason<>'' ORDER BY updated_at DESC LIMIT 15"),
 q("SELECT u.name,count(o.id)::int total FROM users u LEFT JOIN orders o ON o.assigned_to=u.id AND o.status='open' WHERE u.role IN ('technician','chief') GROUP BY u.id,u.name ORDER BY total DESC")]);
 res.json({overview:overview.rows[0],stations:stations.rows,daily:daily.rows,low_stock:low.rows,blocked_orders:blocked.rows,technicians:technicians.rows})}));
app.get('/api/reports/orders.csv',permit('reports'),wrap(async(req,res)=>{const rows=(await q(`${orderSql} ORDER BY o.created_at DESC LIMIT 10000`)).rows;
 const keys=['code','client_name','plate','type','station','status','substatus','summary','location','technician_name','created_at','closed_at'];
 const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,'\' $&').replace(/"/g,'""')+'"';
 const csv='\uFEFF'+keys.join(',')+'\r\n'+rows.map(o=>keys.map(k=>cell(o[k])).join(',')).join('\r\n');
 res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="ordenes-tallerflow.csv"');res.send(csv)}));
const uniqueMessages={orders_one_open_per_vehicle:'El vehículo ya tiene una orden abierta en el taller',vehicles_plate_norm_key:'Ya existe un vehículo con esa placa',client_registrations_submission_key:'Este envío ya se registró'};
app.use((err,req,res,next)=>{if(res.headersSent)return next(err);if(err.code==='23505')return res.status(409).json({error:uniqueMessages[err.constraint]||'Ya existe un registro con ese identificador (placa, código o correo)'});
 if(err.code==='22008')return res.status(400).json({error:'Fecha no válida'});
 if(err.code==='23503')return res.status(400).json({error:'Registro relacionado no encontrado'});
 if(err.code==='23514'||err.code==='22P02'||err.code==='22007')return res.status(400).json({error:'Datos no válidos'});
 if(err instanceof multer.MulterError)return res.status(400).json({error:'Error de archivo: '+err.message});
 if(!err.status||err.status>=500)console.error('[API ERROR]',err);
 res.status(err.status||500).json({error:err.status?err.message:'Error interno del servidor'})});
const server=app.listen(PORT,'0.0.0.0',()=>console.log(`TallerFlow API en puerto ${PORT}`));
// Guarda la tasa BCV cada 3 horas aunque nadie abra la app, para que el historial tenga un valor por fecha valor.
const rateTimer=setInterval(()=>refreshRate().catch(e=>console.error('Tasa BCV:',e.message)),RATE_MAX_AGE);rateTimer.unref();
// Limpieza de fotos al minuto de arrancar y cada 6 horas.
const sweep=()=>sweepMedia().then(r=>{if(r.rejected||r.rows||r.files)console.log('Fotos depuradas:',r)}).catch(e=>console.error('Limpieza de fotos:',e.message));
setTimeout(sweep,60*1000).unref();setInterval(sweep,6*60*60*1000).unref();
const shutdown=()=>{server.close(()=>pool.end().then(()=>process.exit(0)));setTimeout(()=>process.exit(1),10000).unref()};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
