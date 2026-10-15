import qrcode from 'qrcode-generator';

// El cartel y la vista pública usan el mismo texto. No implica aceptación contractual.
export const trackingGuide={
 version:'15/10/2026',
 instructions:[
  'Abre la cámara de tu teléfono y apunta al QR. Toca el enlace que aparece.',
  'Si tienes varios vehículos, selecciona la placa que deseas consultar.',
  'Consulta el mapa, la estación actual y el estado. Se actualiza cada 30 segundos; también puedes tocar Actualizar.'
 ],
 benefits:[
  'Consulta desde tu teléfono, sin instalar aplicaciones ni crear una cuenta.',
  'Visualiza las seis estaciones y el último cambio registrado por el taller.',
  'Conserva el mismo QR para las próximas visitas de tus vehículos.'
 ],
 conditions:[
  'El enlace es privado: quien tenga el QR puede consultar los vehículos vinculados al cliente. No lo publiques ni lo compartas con terceros.',
  'El acceso es solo de consulta. No permite mover vehículos, autorizar trabajos, pagar ni acceder al panel del taller.',
  'La información depende de los registros del taller y de tu conexión a internet. Revisa la fecha de la última consulta; el mapa no es una ubicación GPS ni una promesa de hora de entrega.',
  'Si pierdes el QR, detectas un error o necesitas asistencia, solicita ayuda en recepción. El taller puede renovar el enlace e invalidar el anterior.'
 ]
};

const W=2480,H=3508,M=165;
function image(url){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('No se pudo cargar el logo. Intenta descargar de nuevo.'));img.src=url})}
function wrapped(ctx,text,x,y,width,size=37,color='#343434',weight='400',line=53){
 ctx.font=`${weight} ${size}px Arial, sans-serif`;ctx.fillStyle=color;ctx.textAlign='left';
 const words=text.split(/\s+/);let row='';
 for(const word of words){const next=row?row+' '+word:word;if(ctx.measureText(next).width>width&&row){ctx.fillText(row,x,y);y+=line;row=word}else row=next}
 if(row){ctx.fillText(row,x,y);y+=line}return y;
}
function section(ctx,title,lines,y){
 ctx.fillStyle='#eb0a1e';ctx.fillRect(M,y-32,8,43);
 y=wrapped(ctx,title,M+28,y,W-2*M-28,46,'#171717','700',60)+16;
 for(let i=0;i<lines.length;i++)y=wrapped(ctx,`${i+1}. ${lines[i]}`,M,y,W-2*M)+15;
 return y+33;
}

export async function trackingPoster(link){
 const url=new URL(link);if(!['http:','https:'].includes(url.protocol))throw Error('La dirección del QR no es válida.');
 const logo=await image('/logo-morichal.webp');
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Tu navegador no permite generar la descarga.');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.fillStyle='#0d0d0d';ctx.fillRect(0,0,W,360);
 const logoW=980,logoH=logoW*logo.naturalHeight/logo.naturalWidth;ctx.drawImage(logo,(W-logoW)/2,(360-logoH)/2,logoW,logoH);
 ctx.fillStyle='#eb0a1e';ctx.fillRect(0,360,W,12);
 wrapped(ctx,'Sigue tu vehículo',M,500,W-2*M,88,'#171717','700',100);
 wrapped(ctx,'Tu taller, a un escaneo de distancia.',M,590,W-2*M,43,'#555');
 const qr=qrcode(0,'M');qr.addData(url.href);qr.make();
 const modules=qr.getModuleCount(),cell=Math.floor(850/(modules+8)),size=(modules+8)*cell,x=Math.floor((W-size)/2),y=650;
 ctx.fillStyle='#000';for(let row=0;row<modules;row++)for(let col=0;col<modules;col++)if(qr.isDark(row,col))ctx.fillRect(x+(col+4)*cell,y+(row+4)*cell,cell,cell);
 const after=y+size+58;
 wrapped(ctx,'Escanea con la cámara de tu teléfono',M,after,W-2*M,43,'#171717','700');
 const endLink=wrapped(ctx,url.href,M,after+68,W-2*M,28,'#555','400',40);
 let bottom=section(ctx,'Cómo usar tu QR',trackingGuide.instructions,endLink+83);
 bottom=section(ctx,'Beneficios para ti',trackingGuide.benefits,bottom);
 bottom=section(ctx,'Condiciones de uso',trackingGuide.conditions,bottom);
 if(bottom>H-140)throw Error('El contenido supera una página. Contacta al administrador.');
 ctx.fillStyle='#ddd';ctx.fillRect(M,H-125,W-2*M,2);
 wrapped(ctx,`Toyota Motores Morichal, C.A. | Guía del cliente | Versión ${trackingGuide.version}`,M,H-70,W-2*M,27,'#666');
 return {canvas,link:url.href,qrRect:[x,y,size,size]};
}

// PDF A4 con imagen de alta resolución y enlace sobre el QR. Sin servicios externos.
export function posterPdf(jpeg,{width=W,height=H,link,qrRect}){
 const encoder=new TextEncoder(),encode=s=>encoder.encode(s),chunks=[],offsets=[0];let length=0;
 const push=part=>{const bytes=typeof part==='string'?encode(part):part;chunks.push(bytes);length+=bytes.length};
 const object=(n,body)=>{offsets[n]=length;push(`${n} 0 obj\n`);push(body);push('\nendobj\n')};
 push('%PDF-1.4\n');
 object(1,'<< /Type /Catalog /Pages 2 0 R >>');
 object(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
 object(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Poster 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R] >>');
 offsets[4]=length;push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);push(jpeg);push('\nendstream\nendobj\n');
 const commands='q\n595.28 0 0 841.89 0 0 cm\n/Poster Do\nQ\n';
 object(5,`<< /Length ${encode(commands).length} >>\nstream\n${commands}endstream`);
 const [x,y,w,h]=qrRect,rect=[x/width*595.28,(height-y-h)/height*841.89,(x+w)/width*595.28,(height-y)/height*841.89].map(n=>n.toFixed(2)).join(' ');
 const uri=Array.from(encode(link),b=>b.toString(16).padStart(2,'0')).join('');
 object(6,`<< /Type /Annot /Subtype /Link /Rect [${rect}] /Border [0 0 0] /A << /S /URI /URI <${uri}> >> >>`);
 const xref=length;push('xref\n0 7\n0000000000 65535 f \n');for(let i=1;i<=6;i++)push(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
 push(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
 return new Blob(chunks,{type:'application/pdf'});
}

function save(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
export async function downloadTracking(link,format){
 if(!['png','pdf'].includes(format))throw Error('Formato no válido.');
 const poster=await trackingPoster(link);
 if(format==='png'){
  const blob=await new Promise(resolve=>poster.canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('No se pudo generar el PNG.');
  save(blob,'qr-seguimiento-cliente.png');
 }else{
  const data=atob(poster.canvas.toDataURL('image/jpeg',0.97).split(',')[1]),jpeg=Uint8Array.from(data,c=>c.charCodeAt(0));
  save(posterPdf(jpeg,{link:poster.link,qrRect:poster.qrRect}),'qr-seguimiento-cliente.pdf');
 }
}
