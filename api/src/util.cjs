// Validación y normalización compartidas por las rutas (sin dependencias, para poder probarlas aisladas).

// Fecha AAAA-MM-DD real: 2026-02-31 no existe aunque JavaScript la "corrija" al 3 de marzo.
function isDay(v){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v??''));if(!m)return false;
 const [y,mo,d]=[Number(m[1]),Number(m[2]),Number(m[3])],date=new Date(Date.UTC(y,mo-1,d));
 return y>=1900&&y<=2100&&date.getUTCFullYear()===y&&date.getUTCMonth()===mo-1&&date.getUTCDate()===d}

// Placa sin guiones ni espacios: «dem 303», «DEM-303» y «dem303» son la misma placa.
const normPlate=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
// Teléfono: solo dígitos y los últimos 10, para que 0414-1234567 y +58 414 1234567 coincidan.
const phoneKey=v=>{const d=String(v??'').replace(/\D/g,'');return d.length>=7?d.slice(-10):''};
// Cédula o RIF: letras y números en mayúscula (V-12.345.678 → V12345678).
const docKey=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
// Nombre comparable: sin tildes, sin mayúsculas, sin anotaciones entre paréntesis y con espacios simples.
const nameKey=v=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\([^)]*\)/g,' ').toLowerCase().replace(/[^a-z0-9ñ ]/g,' ').replace(/\s+/g,' ').trim();
const emailKey=v=>String(v??'').trim().toLowerCase();

// Compara el registro con una ficha existente campo por campo: same (igual), differs (distinto), fill (la ficha está vacía) o empty (el registro no lo trae).
function compareIdentity(reg,client){const keys={name:nameKey,phone:phoneKey,document:docKey,email:emailKey},out={};
 for(const [field,key] of Object.entries(keys)){const a=key(reg[field]),b=key(client[field]);
  out[field]=!a?'empty':!b?'fill':a===b?'same':field==='name'&&namesOverlap(a,b)?'similar':'differs'}
 return out}
// Dos nombres «parecidos» comparten al menos dos palabras con contenido (o la única de uno de ellos); «de», «la»… no cuentan.
const particles=new Set(['de','del','la','las','los','el','y','e','da','do','dos','van','von','san','santa']);
const words=s=>s.split(' ').filter(w=>w.length>1&&!particles.has(w));
function namesOverlap(a,b){const A=new Set(words(a)),B=words(b),common=B.filter(w=>A.has(w)).length;
 return common>=2||(common===1&&(A.size===1||B.length===1))}

// Dirección pública del formulario: solo http/https, sin usuario ni contraseña; se guarda el origen y la ruta /registro se añade siempre igual.
function normalizePublicUrl(input){const raw=String(input??'').trim();if(!raw)return {ok:false,error:'Escribe la dirección del taller'};
 if(raw.length>200)return {ok:false,error:'La dirección es demasiado larga'};
 let u;try{u=new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)?raw:'http://'+raw)}catch{return {ok:false,error:'La dirección no es válida'}}
 if(!['http:','https:'].includes(u.protocol))return {ok:false,error:'Usa una dirección http:// o https://'};
 if(u.username||u.password)return {ok:false,error:'La dirección no puede incluir usuario ni contraseña'};
 if(!u.hostname)return {ok:false,error:'Falta el nombre o la IP del servidor'};
 const local=/^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/i.test(u.hostname);
 return {ok:true,origin:u.origin,url:u.origin+'/registro',local}}

module.exports={isDay,normPlate,phoneKey,docKey,nameKey,emailKey,compareIdentity,namesOverlap,normalizePublicUrl};
