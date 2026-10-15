const {test}=require('node:test');
const assert=require('node:assert/strict');
const {isDay,normPlate,phoneKey,docKey,nameKey,compareIdentity,normalizePublicUrl}=require('../src/util.cjs');

test('fechas reales: rechaza días que no existen y formatos ambiguos',()=>{
 assert.equal(isDay('2026-10-15'),true);
 assert.equal(isDay('2028-02-29'),true);
 assert.equal(isDay('2026-02-29'),false);
 assert.equal(isDay('2026-02-31'),false);
 assert.equal(isDay('2026-13-01'),false);
 assert.equal(isDay('2026-1-5'),false);
 assert.equal(isDay(''),false);
 assert.equal(isDay(null),false);
});

test('placa, teléfono y cédula se comparan normalizados',()=>{
 assert.equal(normPlate('dem 303'),'DEM303');
 assert.equal(normPlate('DEM-303'),normPlate('dem303'));
 assert.equal(phoneKey('0414-123.45.67'),phoneKey('+58 414 1234567'));
 assert.equal(phoneKey('123'),'');
 assert.equal(docKey('v-12.345.678'),'V12345678');
 assert.equal(nameKey('Ana  Pérez (DEMO)'),'ana perez');
});

test('comparación de identidad campo a campo',()=>{
 const reg={name:'Ana Perez',phone:'0414-1234567',email:'ana@correo.com',document:''};
 const same=compareIdentity(reg,{name:'Ana Pérez (DEMO)',phone:'+58 414 123 4567',email:'',document:'V-1'});
 assert.deepEqual(same,{name:'same',phone:'same',email:'fill',document:'empty'});
 const other=compareIdentity({...reg,name:'Carlos Ruiz'},{name:'Ana Pérez',phone:'0412-0000000',email:'x@y.z',document:''});
 assert.equal(other.name,'differs');assert.equal(other.phone,'differs');assert.equal(other.email,'differs');
 assert.equal(compareIdentity({...reg,name:'Ana María Pérez'},{name:'Ana Pérez'}).name,'similar');
 assert.equal(compareIdentity({...reg,name:'Chofer De Prueba'},{name:'Dueño De Prueba'}).name,'differs');
});

test('dirección del QR: mismo destino con o sin /registro y solo http(s)',()=>{
 const expected='https://taller.example/registro';
 for(const input of['https://taller.example','https://taller.example/','https://taller.example/registro','https://taller.example/registro/','taller.example'.replace(/^/,'https://')])
  assert.equal(normalizePublicUrl(input).url,expected,input);
 assert.equal(normalizePublicUrl('192.168.10.5').url,'http://192.168.10.5/registro');
 assert.equal(normalizePublicUrl('http://localhost').local,true);
 assert.equal(normalizePublicUrl('ftp://taller.example').ok,false);
 assert.equal(normalizePublicUrl('javascript:alert(1)').ok,false);
 assert.equal(normalizePublicUrl('https://usuario:clave@taller.example').ok,false);
 assert.equal(normalizePublicUrl('https://'+'a'.repeat(250)+'.com').ok,false);
 assert.equal(normalizePublicUrl('').ok,false);
});
