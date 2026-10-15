'use strict';
const {randomBytes,randomUUID}=require('node:crypto');
const rateLimit=require('express-rate-limit');

function publicTracking(app,{q,wrap,fail}){
 const limiter=rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-7',legacyHeaders:false});
 app.get('/api/public/tracking',(_req,res,next)=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');next()},limiter,wrap(async(req,res)=>{
  const token=req.get('X-Tracking-Token')||'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail('El enlace no está disponible. Solicita tu QR al taller.',404);
  const owner=(await q(`SELECT t.client_id FROM client_tracking t JOIN clients c ON c.id=t.client_id
   WHERE t.token=$1 AND c.deleted_at IS NULL`,[token])).rows[0];
  if(!owner)fail('El enlace no está disponible. Solicita tu QR al taller.',404);
  // Lista explícita: jamás enviar datos de contacto, documentos, diagnósticos, importes o archivos.
  const vehicles=(await q(`SELECT v.id,v.plate,v.brand,v.model,v.year,
   o.code,o.station,o.status,o.substatus,o.updated_at,o.closed_at,(o.blocked_reason<>'') AS blocked
   FROM vehicles v LEFT JOIN LATERAL (
    SELECT code,station,status,substatus,updated_at,closed_at,blocked_reason FROM orders
    WHERE vehicle_id=v.id AND client_id=$1
    ORDER BY (status='open') DESC,created_at DESC,id DESC LIMIT 1
   ) o ON true WHERE v.client_id=$1 AND v.deleted_at IS NULL ORDER BY v.plate`,[owner.client_id])).rows;
  res.json({vehicles,checked_at:new Date().toISOString()});
 }));
}

function internalTracking(app,{q,tx,wrap,fail,permit,checkUuid}){
 app.post('/api/clients/:id/tracking',permit('people'),wrap(async(req,res)=>{
  checkUuid(req.params.id);
  if(req.body?.rotate!==undefined&&typeof req.body.rotate!=='boolean')fail('Solicitud no válida');
  const token=await tx(async c=>{
   const client=(await c.query('SELECT id FROM clients WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.params.id])).rows[0];
   if(!client)fail('Cliente no encontrado',404);
   const old=(await c.query('SELECT token FROM client_tracking WHERE client_id=$1',[client.id])).rows[0];
   if(old&&!req.body?.rotate)return old.token;
   const next=randomBytes(32).toString('base64url');
   await c.query(`INSERT INTO client_tracking(client_id,token) VALUES($1,$2)
    ON CONFLICT(client_id) DO UPDATE SET token=EXCLUDED.token,updated_at=now()`,[client.id,next]);
   await c.query('INSERT INTO audit_events(id,actor_id,event_type,detail) VALUES($1,$2,$3,$4)',
    [randomUUID(),req.user.id,old?'tracking.rotated':'tracking.created',JSON.stringify({client_id:client.id})]);
   return next;
  });
  const setting=(await q("SELECT value FROM app_settings WHERE key='registration_url'")).rows[0];
  let origin=null;try{const url=new URL(setting?.value);if(['http:','https:'].includes(url.protocol))origin=url.origin}catch{}
  res.set('Cache-Control','no-store').json({path:'/seguimiento#'+token,origin});
 }));
}
module.exports={publicTracking,internalTracking};
