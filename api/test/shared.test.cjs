const {test}=require('node:test');const assert=require('node:assert/strict');const {allowed,TRANSITIONS,integer,textRequired}=require('../src/shared.cjs');
test('roles: tecnico no gestiona inventario ni entrega',()=>{assert.equal(allowed('technician','work'),true);assert.equal(allowed('technician','inventory'),false);assert.equal(allowed('technician','delivery'),false)});
test('transiciones: seis estaciones y retorno',()=>{assert.deepEqual(TRANSITIONS.quality_reject,[4,3,'quality']);assert.deepEqual(TRANSITIONS.wash_complete,[5,6,'wash'])});
test('validaciones',()=>{assert.equal(integer(-1),false);assert.equal(integer(5),true);assert.equal(textRequired(''),false);assert.equal(textRequired('ok'),true)});
const {partActions,partAllowed,partStep,partOptions}=require('../src/shared.cjs');
test('piezas: quién hace cada acción y qué cambios de estado son ordinarios',()=>{
 assert.deepEqual(partActions('technician'),['request']);assert.deepEqual(partActions('reception'),[]);
 assert.deepEqual(partActions('parts'),['request','edit','transit','receive','deliver','cancel']);assert.ok(partActions('manager').includes('correct'));
 assert.equal(partStep('ordered','in_transit'),'transit');assert.equal(partStep('in_transit','received'),'receive');assert.equal(partStep('received','delivered'),'deliver');
 for(const [from,to] of [['delivered','received'],['cancelled','ordered'],['ordered','delivered'],['received','in_transit']])assert.equal(partStep(from,to),'correct');
 assert.equal(partStep('ordered','ordered'),null);assert.equal(partStep('ordered','lost'),null);
 assert.equal(partAllowed('parts','correct'),false);assert.equal(partAllowed('admin','correct'),true);assert.equal(partAllowed('technician','receive'),false);
 assert.equal(partAllowed('warranty','transit',{warranty:false}),false);assert.equal(partAllowed('warranty','transit',{warranty:true}),true);assert.equal(partAllowed('warranty','receive',{warranty:true}),false);
 assert.deepEqual(partOptions('technician',{status:'ordered'}),{edit:false,status:[]});
 assert.deepEqual(partOptions('parts',{status:'received'}),{edit:true,status:[{to:'delivered',action:'deliver'},{to:'cancelled',action:'cancel'}]});
 assert.deepEqual(partOptions('parts',{status:'delivered'}),{edit:false,status:[]});assert.equal(partOptions('manager',{status:'delivered'}).edit,true);
});
