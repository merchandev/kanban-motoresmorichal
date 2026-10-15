import React,{useEffect,useRef,useState} from 'react';
// Gráficos SVG sin dependencias. Columnas ≤24px con punta redondeada de 4px desde una sola base, rejilla en línea fina,
// leyenda solo con 2+ series, tooltip al pasar el puntero o enfocar con teclado, y tabla de datos como alternativa.

// Ancho real del contenedor, para dibujar a escala 1:1 y que el texto no se deforme.
function useWidth(){const ref=useRef(null),[width,setWidth]=useState(0);
 useEffect(()=>{const el=ref.current;if(!el)return;const ro=new ResizeObserver(([e])=>setWidth(Math.floor(e.contentRect.width)));ro.observe(el);return()=>ro.disconnect()},[]);
 return [ref,width]}
function niceMax(v){if(!(v>0))return 1;const p=10**Math.floor(Math.log10(v)),n=v/p;return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p}
function columnPath(x,y,w,h,r=4){r=Math.min(r,w/2,h);return `M${x},${y+h}V${y+r}Q${x},${y} ${x+r},${y}H${x+w-r}Q${x+w},${y} ${x+w},${y+r}V${y+h}Z`}

function Tip({x,y,width,children}){const left=Math.min(Math.max(x,90),Math.max(90,width-90));return <div className="chart-tip" style={{left,top:y}} role="status">{children}</div>}
function TipRow({color,value,name}){return <div className="chart-tip-row">{color&&<i style={{background:color}}/>}<b>{value}</b>{name&&<span>{name}</span>}</div>}

// rows: [{label, full, values:[...]}] · series: [{name,color}] · format(v,j) para valores · tick(v) para el eje · extra(row) líneas adicionales del tooltip.
export function ColumnChart({rows,series,format,tick,extra,height=230,describe}){const [ref,w]=useWidth(),[active,setActive]=useState(null);
 const padL=58,padR=10,padT=14,padB=28,ph=height-padT-padB,pw=Math.max(0,w-padL-padR),n=rows.length||1,k=series.length;
 const max=niceMax(Math.max(0,...rows.flatMap(r=>r.values))),ticks=[0,.25,.5,.75,1].map(f=>f*max),y=v=>padT+ph-(v/max)*ph;
 const band=pw/n,gap=2,bw=Math.max(2,Math.min(24,(band*.72-gap*(k-1))/k)),group=bw*k+gap*(k-1),every=Math.max(1,Math.ceil(n/Math.max(1,Math.floor(pw/56))));
 const row=active!==null?rows[active]:null;
 return <div className="chart" ref={ref}>
  {k>1&&<div className="chart-legend">{series.map(s=><span key={s.name}><i style={{background:s.color}}/>{s.name}</span>)}</div>}
  {w>0&&<svg width={w} height={height} role="img" aria-label={describe}>
   {ticks.map((t,i)=><g key={i}><line className={i?'chart-rule':'chart-base'} x1={padL} x2={w-padR} y1={y(t)} y2={y(t)}/><text className="chart-tick" x={padL-8} y={y(t)+4} textAnchor="end">{tick(t)}</text></g>)}
   {rows.map((r,i)=>{const x0=padL+i*band+(band-group)/2;return <g key={i} className={'chart-col'+(active!==null&&active!==i?' is-dim':'')}>
    {r.values.map((v,j)=>v>0&&<path key={j} d={columnPath(x0+j*(bw+gap),y(v),bw,padT+ph-y(v))} style={{fill:series[j].color}}/>)}
    {(i%every===0)&&<text className="chart-tick" x={padL+i*band+band/2} y={height-8} textAnchor="middle">{r.label}</text>}
    <rect className="chart-hit" x={padL+i*band} y={padT} width={band} height={ph} tabIndex={0} aria-label={`${r.full}: ${r.values.map((v,j)=>`${series[j].name} ${format(v,j)}`).join(', ')}`}
     onMouseEnter={()=>setActive(i)} onMouseLeave={()=>setActive(null)} onFocus={()=>setActive(i)} onBlur={()=>setActive(null)}/>
   </g>})}
  </svg>}
  {row&&w>0&&<Tip x={padL+active*band+band/2} y={padT} width={w}><div className="chart-tip-title">{row.full}</div>
   {row.values.map((v,j)=><TipRow key={j} color={series[j].color} value={format(v,j)} name={series[j].name}/>)}{extra&&extra(row).map((t,j)=><TipRow key={'x'+j} value={t}/>)}</Tip>}
 </div>}

// points: [{label, full, value}] — una sola serie; el eje no parte de cero (es una tasa), con margen arriba y abajo.
export function LineChart({points,format,tick,color,height=210,describe}){const [ref,w]=useWidth(),[active,setActive]=useState(null);
 const padL=70,padR=86,padT=16,padB=28,ph=height-padT-padB,pw=Math.max(0,w-padL-padR),n=points.length;
 const vals=points.map(p=>p.value),lo=Math.min(...vals),hi=Math.max(...vals),span=(hi-lo)||hi*.02||1,min=lo-span*.2,max=hi+span*.2;
 const x=i=>padL+(n<2?pw/2:i*pw/(n-1)),y=v=>padT+ph-((v-min)/(max-min))*ph,ticks=[min,(min+max)/2,max];
 const d=points.map((p,i)=>`${i?'L':'M'}${x(i)},${y(p.value)}`).join(''),last=n-1,every=Math.max(1,Math.ceil(n/Math.max(1,Math.floor(pw/64))));
 function pick(clientX,el){const r=el.getBoundingClientRect(),rel=clientX-r.left-padL;setActive(Math.max(0,Math.min(last,Math.round(n<2?0:rel/(pw/(n-1))))))}
 const shown=active??last;
 return <div className="chart" ref={ref}>
  {w>0&&<svg width={w} height={height} role="img" aria-label={describe}>
   {ticks.map((t,i)=><g key={i}><line className={i?'chart-rule':'chart-base'} x1={padL} x2={w-padR} y1={y(t)} y2={y(t)}/><text className="chart-tick" x={padL-8} y={y(t)+4} textAnchor="end">{tick(t)}</text></g>)}
   {points.map((p,i)=>(i%every===0||i===last)&&<text key={i} className="chart-tick" x={x(i)} y={height-8} textAnchor="middle">{p.label}</text>)}
   <path className="chart-line" d={d} style={{stroke:color}}/>
   {active!==null&&<line className="chart-cross" x1={x(active)} x2={x(active)} y1={padT} y2={padT+ph}/>}
   <circle className="chart-dot" cx={x(shown)} cy={y(points[shown].value)} r="4.5" style={{fill:color}}/>
   {active===null&&<text className="chart-end" x={x(last)+10} y={y(points[last].value)+4}>{format(points[last].value)}</text>}
   <rect className="chart-hit" x={padL} y={padT} width={pw} height={ph} tabIndex={0} aria-label={describe}
    onPointerMove={e=>pick(e.clientX,e.currentTarget.ownerSVGElement)} onPointerLeave={()=>setActive(null)} onBlur={()=>setActive(null)}
    onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setActive(a=>Math.max(0,Math.min(last,(a??last)+(e.key==='ArrowLeft'?-1:1))))}}}/>
  </svg>}
  {active!==null&&w>0&&<Tip x={x(active)} y={padT} width={w}><div className="chart-tip-title">{points[active].full}</div><TipRow color={color} value={format(points[active].value)}/></Tip>}
 </div>}

// Tabla de datos de cualquier gráfico (alternativa accesible al tooltip).
export function ChartTable({head,rows}){return <details className="chart-table"><summary>Ver datos</summary><div className="table-wrap"><table><thead><tr>{head.map(h=><th key={h}>{h}</th>)}</tr></thead>
 <tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j} className={j?'num':''}>{c}</td>)}</tr>)}</tbody></table></div></details>}
