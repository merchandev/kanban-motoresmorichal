import React,{useCallback,useEffect,useState} from 'react';
import {WorkshopMap} from './App.jsx';
import {RefreshCw} from 'lucide-react';
import {trackingGuide} from './tracking-export.js';

const stations=['Recepción','Traslado','Taller','Calidad','Lavado','Entrega'];
const statuses={pending:'Pendiente',active:'En ejecución',waiting_parts:'Esperando repuestos',waiting_approval:'Esperando aprobación',waiting_bay:'En espera de puesto',paused:'En pausa',rework:'En revisión',ready:'Listo para entregar'};
export default function Seguimiento(){
 const [token,setToken]=useState(()=>location.hash.slice(1)),[data,setData]=useState(null),[focus,setFocus]=useState(''),[selected,setSelected]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const changed=()=>{setToken(location.hash.slice(1));setData(null);setFocus('')};window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed)},[]);
 const load=useCallback(async(signal)=>{
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)){setData(null);setError('El enlace no está disponible. Solicita tu QR al taller.');return}
  setBusy(true);try{const res=await fetch('/api/public/tracking',{headers:{'X-Tracking-Token':token},cache:'no-store',signal});
   const out=await res.json();if(!res.ok){if(res.status===404)setData(null);throw Error(out.error||'No se pudo consultar el estado.')}
   setData(out);setError('');
  }catch(e){if(e.name!=='AbortError')setError(e.message==='Failed to fetch'?'Sin conexión. El estado mostrado puede estar desactualizado.':e.message)}finally{if(!signal?.aborted)setBusy(false)}
 },[token]);
 useEffect(()=>{const c=new AbortController();load(c.signal);const timer=setInterval(()=>{if(!document.hidden)load(c.signal)},30000);const visible=()=>{if(!document.hidden)load(c.signal)};document.addEventListener('visibilitychange',visible);return()=>{c.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible)}},[load]);
 useEffect(()=>{if(data&&!data.vehicles.some(v=>v.id===focus)){setFocus(data.vehicles.find(v=>v.status==='open')?.id||data.vehicles[0]?.id||'');setSelected(null)}},[data,focus]);
 const vehicle=data?.vehicles.find(v=>v.id===focus),order=vehicle?.status?{station:vehicle.station,status:vehicle.status}:null;
 const entries=vehicle?[{vehicle,order:order&&order.status!=='cancelled'?order:null}]:[];
 const state=vehicle?.status==='closed'?'Entregado':vehicle?.status==='cancelled'?'Orden anulada':vehicle?.blocked?'En espera':statuses[vehicle?.substatus]||'En proceso';
 return <div className="tracking-page"><header className="tracking-brand"><img src="/logo-morichal.webp" alt="Toyota Motores Morichal"/></header><main className="tracking-content">
  <div className="page-head"><div><h1>Seguimiento de tu vehículo</h1><p>Consulta su estado y estación en el taller.</p></div><button className="btn btn-secondary" disabled={busy} onClick={()=>load()}><RefreshCw size={16}/>{busy?'Actualizando…':'Actualizar'}</button></div>
  {error&&<div className="inline-error" role="alert">{error}</div>}
  {!data&&!error&&<p role="status">Consultando el estado del vehículo…</p>}
  {data&&<>{data.vehicles.length>1&&<label className="field"><span>Selecciona tu vehículo</span><select value={focus} onChange={e=>{setFocus(e.target.value);setSelected(null)}}>{data.vehicles.map(v=><option key={v.id} value={v.id}>{v.plate} · {v.brand} {v.model}</option>)}</select></label>}
   {!data.vehicles.length&&<section className="surface tracking-summary"><h2>Sin vehículos registrados</h2><p>Consulta en recepción para vincular tu vehículo.</p></section>}
   {vehicle&&<section className="surface tracking-summary"><div className="section-head"><div><span className="plate">{vehicle.plate}</span><h2>{vehicle.brand} {vehicle.model} {vehicle.year||''}</h2></div><span className="pill pill-info">{vehicle.status?state:'Sin orden registrada'}</span></div>
    {vehicle.status&&<><p><strong>{vehicle.status==='closed'?'Vehículo entregado':vehicle.status==='cancelled'?'Orden anulada':'Estación actual: '+stations[vehicle.station-1]}</strong> · {vehicle.code}</p><p className="muted">Último cambio: {new Date(vehicle.updated_at).toLocaleString('es-VE')}</p></>}
    {order&&order.status!=='cancelled'?<WorkshopMap entries={entries} focus={focus} onFocus={setFocus} selected={selected||vehicle.station} onSelect={setSelected} readOnly/>:<p>El mapa se mostrará cuando el vehículo tenga una orden en el taller.</p>}
   </section>}
   <p className="muted" role="status">Última consulta: {new Date(data.checked_at).toLocaleString('es-VE')}. Actualización automática cada 30 segundos.</p>
  </>}
  <details className="surface tracking-summary tracking-guide"><summary>Instrucciones, beneficios y condiciones de uso</summary>{[['Cómo usar tu QR',trackingGuide.instructions],['Beneficios',trackingGuide.benefits],['Condiciones de uso',trackingGuide.conditions]].map(([title,items])=><section key={title}><h2>{title}</h2><ol>{items.map(item=><li key={item}>{item}</li>)}</ol></section>)}<p className="muted">Guía del cliente · Versión {trackingGuide.version}</p></details>
 </main></div>;
}
