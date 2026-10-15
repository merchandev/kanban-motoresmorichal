const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
// sharp solo está instalado en la imagen de la API: fuera de Docker estas pruebas se omiten.
let sharp=null;try{sharp=require('sharp')}catch{}
const skip=!sharp&&'sharp no está instalado (se ejecuta con scripts/test-flow.sh)';
const make=(w,h,format='jpeg')=>sharp({create:{width:w,height:h,channels:3,background:{r:200,g:30,b:40}}})[format]().toBuffer();

test('fotos válidas: se re-codifican en JPEG, sin metadatos y con miniatura',{skip},async()=>{
 const {processImage}=require('../src/media.cjs');
 const withGps=await sharp(await make(3000,2000)).withExif({IFD0:{Make:'Teléfono de prueba'},IFD3:{GPSLatitudeRef:'N'}}).jpeg().toBuffer();
 const out=await processImage(withGps);
 assert.equal(out.width,1600);assert.equal(out.height,1067);
 const meta=await sharp(out.main).metadata();assert.equal(meta.format,'jpeg');assert.equal(meta.exif,undefined);
 const thumb=await sharp(out.thumb).metadata();assert.ok(Math.max(thumb.width,thumb.height)<=320);
 for(const format of['png','webp'])assert.equal((await sharp((await processImage(await make(400,300,format))).main).metadata()).format,'jpeg');
});

test('fotos inválidas: dañadas, truncadas, de otro tipo o con demasiados píxeles',{skip},async()=>{
 const {processImage}=require('../src/media.cjs');
 const good=await make(800,600);
 await assert.rejects(processImage(Buffer.from('no soy una imagen')),{status:400});
 await assert.rejects(processImage(good.subarray(0,Math.floor(good.length/2))),{status:400});
 await assert.rejects(processImage(await sharp({create:{width:20,height:20,channels:3,background:'#fff'}}).gif().toBuffer()),{status:400});
 await assert.rejects(processImage(await make(13000,10,'png')),/píxeles/);
 await assert.rejects(processImage(await make(800,600),{maxPixels:100_000,maxSide:12000,mainSide:1600,thumbSide:320}),{status:400});
});

test('si falla la base o una escritura, no quedan archivos huérfanos',{skip},async()=>{
 const {processImage,storeImages}=require('../src/media.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'media-'));
 const imgs=[await processImage(await make(300,200)),await processImage(await make(200,300))];
 await assert.rejects(storeImages(dir,imgs,async stored=>{assert.equal(stored.length,2);assert.equal(fs.readdirSync(dir).length,4);throw new Error('fallo simulado del INSERT')}),/fallo simulado/);
 assert.deepEqual(fs.readdirSync(dir),[]);
 // Falla la segunda escritura (el archivo ya existe): también se borra la primera foto completa.
 const real=fs.promises.writeFile;let calls=0;
 fs.promises.writeFile=async(...a)=>{if(++calls===3)throw Object.assign(new Error('disco lleno simulado'),{code:'ENOSPC'});return real(...a)};
 try{await assert.rejects(storeImages(dir,imgs,async()=>'no llega'),/disco lleno/)}finally{fs.promises.writeFile=real}
 assert.deepEqual(fs.readdirSync(dir),[]);
 const ok=await storeImages(dir,imgs,async stored=>stored.map(s=>s.id));assert.equal(ok.length,2);assert.equal(fs.readdirSync(dir).length,4);
 fs.rmSync(dir,{recursive:true,force:true});
});
