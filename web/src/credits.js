// Créditos del proyecto: se imprimen en la consola del navegador al cargar la app y se muestran en el pie de página.
export const AUTHORS={dev:'Merchan.Dev',partner:'Epressivo Venezuela, C.A.'};

// Letras del banner (figlet «Standard», 5 filas); se arman en tiempo de ejecución para que el texto sea legible aquí.
const glyphs={
 M:[' __  __ ','|  \\/  |','| |\\/| |','| |  | |','|_|  |_|'],
 e:['      ','  ___ ',' / _ \\','|  __/',' \\___|'],
 r:['      ',' _ __ ','| \'__|','| |   ','|_|   '],
 c:['      ','  ___ ',' / __|','| (__ ',' \\___|'],
 h:[' _     ','| |__  ','| \'_ \\ ','| | | |','|_| |_|'],
 a:['       ','  __ _ ',' / _` |','| (_| |',' \\__,_|'],
 n:['       ',' _ __  ','| \'_ \\ ','| | | |','|_| |_|'],
 '.':['   ','   ','   ',' _ ','(_)'],
 d:['     _ ','  __| |',' / _` |','| (_| |',' \\__,_|'],
 v:['       ','__   __','\\ \\ / /',' \\ V / ','  \\_/  ']
};

const legal=[
 'Todos los derechos de propiedad intelectual e industrial sobre el código fuente, bases de datos, flujos de trabajo y arquitectura están reservados.',
 'Queda estrictamente prohibida la reproducción, modificación, copia, distribución, comercialización, ingeniería inversa, plagio o cualquier uso no autorizado,',
 'total o parcial, de los elementos desarrollados en este proyecto sin consentimiento previo, expreso y por escrito de los autores.',
 'Toda infracción será sujeta a las acciones civiles y penales correspondientes.'
];

export function printCredits(){
 const art=[0,1,2,3,4].map(row=>[...'Merchan.dev'].map(ch=>glyphs[ch][row]).join('')).join('\n');
 const width=art.split('\n')[0].length,tagline='< Programmer Full-Stack />',rule='─'.repeat(width);
 const mono='font-family:ui-monospace,Consolas,monospace;';
 console.log(`%c${art}\n%c${' '.repeat(Math.max(0,(width-tagline.length)>>1))}${tagline}`,`${mono}color:#22c55e;font-weight:700;line-height:1.15`,`${mono}color:#22c55e;font-weight:700`);
 console.log(`%c${rule}\n${AUTHORS.dev.toUpperCase()}  ×  ${AUTHORS.partner.toUpperCase()}\n${rule}`,`${mono}font-weight:700`);
 console.log(`%cDesarrollo e ingeniería de software propiedad de ${AUTHORS.dev} y ${AUTHORS.partner}`,`${mono}color:#9ca3af`);
 console.log(`%c${legal.join('\n')}`,`${mono}color:#60a5fa;line-height:1.6`);
}
