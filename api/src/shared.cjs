const ROLES=['admin','manager','reception','chief','technician','parts','quality','wash','driver','warranty','auditor'];
const PERMISSIONS={
 admin:['*'],manager:['read','people','orders','move','assign','work','parts','quality','wash','delivery','warranty','inventory','reports','audit','quote'],
 reception:['read','people','orders','delivery','quote'],chief:['read','move','assign','work','parts','quality','reports','quote'],
 technician:['read','work','parts'],parts:['read','inventory','parts'],quality:['read','quality'],wash:['read','wash'],
 driver:['read','move'],warranty:['read','warranty','orders'],auditor:['read','reports','audit']
};
const STATIONS=['Recepción','Traslado','Taller','Calidad','Lavado','Entrega'];
const TRANSITIONS={to_transfer: [1,2,'move'],to_workshop:[2,3,'move'],to_quality:[3,4,'move'],quality_pass:[4,5,'quality'],quality_reject:[4,3,'quality'],wash_complete:[5,6,'wash']};
const TRANSITION_ROLES={to_transfer:['reception','chief'],to_workshop:['driver','chief'],to_quality:['chief'],quality_pass:['quality','chief'],quality_reject:['quality','chief'],wash_complete:['wash'],return_confirm:['driver','chief'],deliver:['reception'],cancel:[],revert:ROLES};
function transitionAllowed(role,action){return Object.hasOwn(TRANSITION_ROLES,action)&&(role==='admin'||role==='manager'||TRANSITION_ROLES[action].includes(role))}
function transitionActions(role){return Object.keys(TRANSITION_ROLES).filter(action=>transitionAllowed(role,action))}
function allowed(role,permission){return (PERMISSIONS[role]||[]).includes('*')||(PERMISSIONS[role]||[]).includes(permission)}
// Pedidos de piezas: quién hace cada acción (gerencia y administración, todas). Garantías solo gestiona piezas por garantía.
// Los cambios de estado ordinarios siguen PART_FLOW; cualquier otro (volver atrás, reabrir una entregada o cancelada, entregar
// sin recepción) es una corrección excepcional de gerencia o administración, con motivo y sin borrar la evidencia anterior.
const PART_STATUS=['ordered','in_transit','received','delivered','cancelled'];
const PART_ROLES={request:['technician','chief','parts','warranty'],edit:['parts','warranty'],transit:['parts','warranty'],receive:['parts'],deliver:['parts'],cancel:['parts','warranty'],correct:[]};
const PART_FLOW={ordered:{in_transit:'transit',received:'receive',cancelled:'cancel'},in_transit:{received:'receive',cancelled:'cancel'},received:{delivered:'deliver',cancelled:'cancel'},delivered:{},cancelled:{}};
const partFinal=s=>s==='delivered'||s==='cancelled';
function partAllowed(role,action,part=null){if(!Object.hasOwn(PART_ROLES,action))return false;if(role==='admin'||role==='manager')return true;
 return PART_ROLES[action].includes(role)&&!(role==='warranty'&&part&&!part.warranty&&action!=='request')}
function partActions(role){return Object.keys(PART_ROLES).filter(a=>partAllowed(role,a))}
function partStep(from,to){return PART_FLOW[from]?.[to]||(PART_STATUS.includes(from)&&PART_STATUS.includes(to)&&from!==to?'correct':null)}
// Lo que un rol puede hacer con una pieza concreta: editar (o corregir si ya terminó) y a qué estados llevarla.
function partOptions(role,p){return {edit:partAllowed(role,partFinal(p.status)?'correct':'edit',p),
 status:PART_STATUS.filter(s=>s!==p.status).map(to=>({to,action:partStep(p.status,to)})).filter(x=>partAllowed(role,x.action,p))}}
function textRequired(v,max=200){return typeof v==='string'&&v.trim().length>0&&v.trim().length<=max}
function integer(v,min=0,max=10000000){return Number.isInteger(Number(v))&&Number(v)>=min&&Number(v)<=max}
module.exports={ROLES,PERMISSIONS,STATIONS,TRANSITIONS,allowed,textRequired,integer,transitionAllowed,transitionActions,PART_STATUS,PART_ROLES,PART_FLOW,partFinal,partAllowed,partActions,partStep,partOptions};
