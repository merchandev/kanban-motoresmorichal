// Tasa oficial del Banco Central de Venezuela, leída de la portada de bcv.org.ve
// (bloques #dolar y #euro, y la «Fecha Valor» del span date-display-single).
const https=require('node:https');const tls=require('node:tls');const fs=require('node:fs');const path=require('node:path');
const BCV_URL='https://www.bcv.org.ve/';
// El servidor del BCV envía un intermedio equivocado: se añaden el intermedio y la raíz correctos (Sectigo DV R36 / R46)
// solo para esta conexión, sin desactivar la verificación TLS.
const ca=[...tls.rootCertificates,fs.readFileSync(path.join(__dirname,'..','certs','bcv-sectigo-chain.pem'),'utf8')];

function download(url,redirects=3){return new Promise((resolve,reject)=>{
 const req=https.get(url,{ca,timeout:15000,headers:{'User-Agent':'Mozilla/5.0 (TallerFlow; tasa BCV)','Accept':'text/html'}},res=>{
  if(res.statusCode>=300&&res.statusCode<400&&res.headers.location&&redirects>0){res.resume();return resolve(download(new URL(res.headers.location,url).href,redirects-1))}
  if(res.statusCode!==200){res.resume();return reject(new Error(`El BCV respondió ${res.statusCode}`))}
  let body='';res.setEncoding('utf8');res.on('data',d=>{body+=d;if(body.length>3e6)req.destroy(new Error('Respuesta del BCV demasiado grande'))});res.on('end',()=>resolve(body))});
 req.on('timeout',()=>req.destroy(new Error('El BCV no respondió a tiempo')));req.on('error',reject)})}

// «879,12250000» → 879.1225
function toNumber(text){const n=Number(String(text).trim().replace(/\./g,'').replace(',','.'));return Number.isFinite(n)&&n>0?n:null}
function parseRate(html,id){const m=html.match(new RegExp(`id="${id}"[\\s\\S]{0,1200}?<strong[^>]*>\\s*([\\d.,]+)\\s*</strong>`));return m?toNumber(m[1]):null}
function parseDate(html){const m=html.match(/date-display-single[^>]*content="(\d{4}-\d{2}-\d{2})/);return m?m[1]:null}
function parseBcv(html){const usd=parseRate(html,'dolar'),eur=parseRate(html,'euro'),date=parseDate(html);
 if(!usd||!date)throw new Error('No se encontró la tasa del dólar en la página del BCV');return {usd,eur,date}}

async function fetchBcv(){return parseBcv(await download(BCV_URL))}
module.exports={fetchBcv,parseBcv,toNumber};
