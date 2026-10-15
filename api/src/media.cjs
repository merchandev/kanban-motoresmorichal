// Fotos de clientes y vehículos: se decodifican de verdad (no basta la cabecera), se rechazan las dañadas o gigantes
// y se guardan re-codificadas en JPEG sin metadatos (EXIF/GPS), con una miniatura para listas.
const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');
const sharp=require('sharp');
sharp.cache(false);sharp.concurrency(1);

const LIMITS={maxPixels:40_000_000,maxSide:12_000,mainSide:1600,thumbSide:320};
const imageError=message=>Object.assign(new Error(message),{status:400});

async function processImage(buffer,limits=LIMITS){
 const open=()=>sharp(buffer,{limitInputPixels:limits.maxPixels,failOn:'truncated'});
 let meta;try{meta=await open().metadata()}catch{throw imageError('Una de las fotos está dañada o no es una imagen')}
 if(!['jpeg','png','webp'].includes(meta.format))throw imageError('Las fotos deben ser JPEG, PNG o WebP');
 if(!meta.width||!meta.height||meta.width>limits.maxSide||meta.height>limits.maxSide||meta.width*meta.height>limits.maxPixels)throw imageError('Una de las fotos tiene demasiados píxeles');
 try{const main=await open().rotate().resize({width:limits.mainSide,height:limits.mainSide,fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer({resolveWithObject:true});
  const thumb=await open().rotate().resize({width:limits.thumbSide,height:limits.thumbSide,fit:'inside',withoutEnlargement:true}).jpeg({quality:76}).toBuffer();
  return {main:main.data,thumb,width:main.info.width,height:main.info.height}}
 catch{throw imageError('Una de las fotos está dañada o incompleta')}}

// Escribe todas las fotos y ejecuta `register` (las inserciones en la base). Cada archivo entra en la lista de limpieza
// en cuanto existe en disco: si falla una escritura o la base, se borran todos los archivos creados en esta operación.
async function storeImages(dir,images,register){const written=[],stored=[];
 try{for(const img of images){const id=randomUUID(),main=`m-${id}.jpg`,thumb=`m-${id}-t.jpg`;
   await fs.promises.writeFile(path.join(dir,main),img.main,{flag:'wx',mode:0o600});written.push(main);
   await fs.promises.writeFile(path.join(dir,thumb),img.thumb,{flag:'wx',mode:0o600});written.push(thumb);
   stored.push({id,main,thumb,size:img.main.length+img.thumb.length,width:img.width,height:img.height})}
  return await register(stored)}
 catch(err){await removeFiles(dir,written);throw err}}
const removeFiles=(dir,names)=>Promise.all(names.map(n=>fs.promises.unlink(path.join(dir,n)).catch(()=>{})));

module.exports={processImage,storeImages,removeFiles,LIMITS};
