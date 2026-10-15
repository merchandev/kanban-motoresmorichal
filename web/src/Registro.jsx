import React,{useCallback,useEffect,useRef,useState} from 'react';
import {AlertTriangle,CarFront,CheckCircle2,ImagePlus,RefreshCw,RotateCcw,ScanLine,UserRound,Wrench,X} from 'lucide-react';
import {AUTHORS} from './credits.js';

// Formulario público del QR: el cliente registra sus datos, fotos y el problema del vehículo; recepción lo revisa y lo acepta.
const issues=['Mantenimiento','Ruido extraño','Frenos','Motor / encendido','Aire acondicionado','Luces en el tablero','Suspensión','Batería / eléctrico','Cauchos','Otro'];
const photoSlots=[
 {name:'profile_photo',label:'Tu foto de perfil',hint:'Para reconocerte al entregar el vehículo',icon:UserRound,round:true},
 {name:'vehicle_photo',label:'Foto del vehículo',hint:'De frente o de lado, completo',icon:CarFront},
 {name:'plate_photo',label:'Foto de la placa',hint:'Que se lea bien',icon:ScanLine}];
const empty={name:'',phone:'',email:'',document:'',plate:'',brand:'Toyota',model:'',year:'',mileage:'',problem:'',consent:false,website:''};

// Clave de envío: identifica este intento para que reenviarlo (respuesta perdida) no cree otro registro.
// crypto.randomUUID solo existe en HTTPS; getRandomValues también funciona por http en la red del taller.
export function newKey(){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]&15|64;b[8]=b[8]&63|128;
 const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`}

// Las fotos del teléfono pesan varios MB: se reducen a 1600 px en JPEG antes de enviarlas (el servidor vuelve a validarlas).
async function shrink(file,max=1600){
 if(file.type&&!file.type.startsWith('image/'))throw Error('Ese archivo no es una foto. Usa JPG, PNG o WebP.');
 const url=URL.createObjectURL(file);
 try{const img=await new Promise((ok,ko)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>ko(Error('No pudimos leer esa foto (formato no compatible). Tómala con la cámara o elige una JPG o PNG.'));i.src=url});
  const k=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.round(img.naturalWidth*k),h=Math.round(img.naturalHeight*k);
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(img,0,0,w,h);
  const blob=await new Promise(ok=>canvas.toBlob(ok,'image/jpeg',.82));if(!blob)throw Error('No se pudo procesar la foto; prueba con otra.');return blob}
 finally{URL.revokeObjectURL(url)}}

function PhotoField({slot,photo,busy,onPick,onClear}){const Icon=slot.icon;
 return <div className={'reg-photo'+(photo?' has-photo':'')+(slot.round?' is-round':'')+(busy?' is-busy':'')} aria-busy={busy||undefined}>
  <label className="reg-photo-pick">{photo?<img src={photo.url} alt={slot.label}/>:<span className="reg-photo-empty"><Icon size={26} strokeWidth={1.6}/><ImagePlus size={15} className="reg-photo-plus"/></span>}
   {busy&&<span className="reg-photo-wait"><span className="spinner"/></span>}
   <input type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)onPick(f)}}/></label>
  <span className="reg-photo-text"><b>{slot.label}</b><small>{busy?'Procesando foto…':photo?'Toca la foto para cambiarla':slot.hint}</small></span>
  {(photo||busy)&&<button type="button" className="reg-photo-clear" onClick={onClear} aria-label={`Quitar ${slot.label.toLowerCase()}`}><X size={15}/></button>}</div>}

function Field({label,required,children,wide}){return <label className={'field'+(wide?' field-wide':'')}><span>{label}{required&&' *'}</span>{children}</label>}

export default function Registro(){const [v,setV]=useState(empty),[photos,setPhotos]=useState({}),[processing,setProcessing]=useState({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(null);
 const [config,setConfig]=useState(null),[configError,setConfigError]=useState('');
 // Selección vigente por foto: si el cliente elige otra (o la quita) mientras se procesa, el resultado anterior se descarta.
 const pickSeq=useRef(0),current=useRef({}),key=useRef(newKey()),live=useRef(photos);live.current=photos;
 useEffect(()=>{document.title='Registro de cliente · Kamban (MPV)'},[]);
 useEffect(()=>()=>Object.values(live.current).forEach(p=>URL.revokeObjectURL(p.url)),[]);
 // Texto de autorización vigente: lo define el taller y el registro guarda la versión aceptada.
 const loadConfig=useCallback(()=>{setConfigError('');return fetch('/api/public/registration-config').then(r=>r.ok?r.json():Promise.reject()).then(setConfig).catch(()=>setConfigError('No hay conexión con el taller. Revisa tu internet y vuelve a intentarlo.'))},[]);
 useEffect(()=>{loadConfig()},[loadConfig]);
 // Cualquier cambio convierte el envío en uno nuevo; un reenvío idéntico conserva la clave y recupera el mismo código.
 const changed=()=>{key.current=newKey()};
 const set=k=>e=>{changed();setV({...v,[k]:e.target.type==='checkbox'?e.target.checked:e.target.value})};
 async function pick(name,file){setError('');changed();const id=++pickSeq.current;current.current[name]=id;setProcessing(p=>({...p,[name]:true}));
  try{const blob=await shrink(file);if(current.current[name]!==id)return;
   const url=URL.createObjectURL(blob);setPhotos(p=>{if(p[name])URL.revokeObjectURL(p[name].url);return {...p,[name]:{blob,url}}})}
  catch(err){if(current.current[name]===id)setError(err.message)}
  finally{if(current.current[name]===id)setProcessing(p=>({...p,[name]:false}))}}
 function clear(name){changed();current.current[name]=++pickSeq.current;setProcessing(p=>({...p,[name]:false}));setPhotos(p=>{const n={...p};if(n[name])URL.revokeObjectURL(n[name].url);delete n[name];return n})}
 function addIssue(t){changed();setV(x=>({...x,problem:x.problem.includes(t)?x.problem:(x.problem.trim()?x.problem.trim()+(/[.,;:!?]$/.test(x.problem.trim())?' ':', '):'')+t}))}
 const waiting=Object.values(processing).some(Boolean);
 async function submit(e){e.preventDefault();if(waiting||!config)return;setBusy(true);setError('');
  try{const form=new FormData();Object.entries(v).forEach(([k,val])=>form.append(k,String(val)));form.append('consent_version',config.consent_version);form.append('submission_key',key.current);
   Object.entries(photos).forEach(([k,p])=>form.append(k,p.blob,`${k}.jpg`));
   const res=await fetch('/api/public/registrations',{method:'POST',body:form});const out=await res.json().catch(()=>({}));
   if(res.status===409&&/autorizaci/i.test(out.error||'')){await loadConfig();setV(x=>({...x,consent:false}))}
   if(!res.ok)throw Error(out.error||'No se pudo enviar el registro. Inténtalo de nuevo.');
   setDone({code:out.code,name:v.name.trim().split(/\s+/)[0],plate:v.plate.toUpperCase()});window.scrollTo(0,0)}
  catch(err){setError(err instanceof TypeError?'Sin conexión con el taller. Tus datos siguen aquí: revisa tu internet y vuelve a enviar.':err.message)}finally{setBusy(false)}}
 function again(){Object.values(photos).forEach(p=>URL.revokeObjectURL(p.url));current.current={};key.current=newKey();setV(empty);setPhotos({});setProcessing({});setDone(null);setError('')}
 return <div className="reg-page">
  <header className="reg-top"><img src="/logo-morichal.webp" width="768" height="238" alt="Toyota Motores Morichal"/></header>
  <main className="reg-main">{done?<section className="reg-card reg-done" aria-live="polite"><CheckCircle2 size={44} strokeWidth={1.6}/><h1>¡Listo{done.name?`, ${done.name}`:''}!</h1>
    <p>Recibimos los datos de tu vehículo <b>{done.plate}</b>. Muestra este código en recepción:</p><div className="reg-code">{done.code}</div>
    <p className="reg-muted">Recepción revisará tu registro y te atenderá en breve.</p><button type="button" className="btn btn-secondary" onClick={again}><RotateCcw size={16}/> Registrar otro vehículo</button></section>
   :<form className="reg-card" onSubmit={submit}>
    <div className="reg-intro"><h1>Registro de cliente</h1><p>Completa tus datos y los de tu vehículo. Toma menos de 2 minutos.</p></div>
    <section className="reg-step"><h2><span>1</span>Tus datos</h2><div className="field-grid">
     <Field label="Nombre y apellido" required wide><input required maxLength={150} autoComplete="name" value={v.name} onChange={set('name')}/></Field>
     <Field label="Teléfono" required><input required type="tel" inputMode="tel" maxLength={50} autoComplete="tel" placeholder="0414-0000000" value={v.phone} onChange={set('phone')}/></Field>
     <Field label="Cédula o RIF"><input maxLength={80} placeholder="V-12345678" value={v.document} onChange={set('document')}/></Field>
     <Field label="Correo electrónico" wide><input type="email" maxLength={190} autoComplete="email" value={v.email} onChange={set('email')}/></Field></div></section>
    <section className="reg-step"><h2><span>2</span>Tu vehículo</h2><div className="field-grid">
     <Field label="Placa" required><input required maxLength={20} className="reg-plate" autoCapitalize="characters" placeholder="AB123CD" value={v.plate} onChange={set('plate')}/></Field>
     <Field label="Marca" required><input required maxLength={80} value={v.brand} onChange={set('brand')}/></Field>
     <Field label="Modelo" required><input required maxLength={80} placeholder="Corolla, Hilux, Fortuner…" value={v.model} onChange={set('model')}/></Field>
     <Field label="Año"><input type="number" inputMode="numeric" min={1950} max={new Date().getFullYear()+1} value={v.year} onChange={set('year')}/></Field>
     <Field label="Kilometraje" wide><input type="number" inputMode="numeric" min={0} placeholder="Ej.: 45000" value={v.mileage} onChange={set('mileage')}/></Field></div></section>
    <section className="reg-step"><h2><span>3</span>Fotos <small>opcionales</small></h2>
     <p className="reg-help">JPG, PNG o WebP de hasta {config?.max_photo_mb||6} MB; las del iPhone se convierten solas. Solo se usan para identificarte a ti y a tu vehículo.</p>
     <div className="reg-photos">{photoSlots.map(s=><PhotoField key={s.name} slot={s} photo={photos[s.name]} busy={processing[s.name]} onPick={f=>pick(s.name,f)} onClear={()=>clear(s.name)}/>)}</div></section>
    <section className="reg-step"><h2><span>4</span>¿Qué le pasa al vehículo?</h2>
     <div className="reg-chips">{issues.map(t=><button type="button" key={t} className={'reg-chip'+(v.problem.includes(t)?' is-on':'')} onClick={()=>addIssue(t)}>{t}</button>)}</div>
     <Field label="Describe el problema" required wide><textarea required rows={4} maxLength={2000} placeholder="Ej.: suena al frenar y vibra el volante desde hace una semana" value={v.problem} onChange={set('problem')}/></Field></section>
    <input className="reg-trap" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={v.website} onChange={set('website')}/>
    {config?<label className="reg-consent"><input type="checkbox" required checked={v.consent} onChange={set('consent')}/><span>{config.consent_text}</span></label>
     :<div className="reg-consent is-missing">{configError?<><span>{configError}</span><button type="button" className="btn btn-secondary" onClick={loadConfig}><RefreshCw size={15}/> Reintentar</button></>:<span>Cargando la autorización…</span>}</div>}
    {error&&<div className="inline-error" role="alert"><AlertTriangle size={16}/>{error}</div>}
    <button type="submit" className="btn btn-primary reg-submit" disabled={busy||waiting||!config}>{busy?'Enviando…':waiting?'Procesando foto…':<><Wrench size={17}/> Enviar registro</>}</button>
   </form>}</main>
  <footer className="reg-foot">Desarrollado por <b>{AUTHORS.dev}</b> × <b>{AUTHORS.partner}</b></footer></div>}
