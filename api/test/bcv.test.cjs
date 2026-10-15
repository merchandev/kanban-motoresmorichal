const {test}=require('node:test');const assert=require('node:assert/strict');const {parseBcv,toNumber}=require('../src/bcv.cjs');
const html=`<div id="euro" class="col-sm-12"><div class="field-content"><span> EUR</span><strong> 977,68092347 </strong></div></div>
<div id="dolar" class="col-sm-12"><div class="field-content"><span> USD</span> <div class="centrado"><strong class="strong-tb">879,12250000</strong></div></div></div>
<span class="date-display-single" property="dc:date" content="2026-10-15T00:00:00-04:00">Jueves, 15 Octubre 2026</span>`;
test('bcv: lee dólar, euro y fecha valor',()=>{assert.deepEqual(parseBcv(html),{usd:879.1225,eur:977.68092347,date:'2026-10-15'})});
test('bcv: números con miles y coma decimal',()=>{assert.equal(toNumber('1.234,56'),1234.56);assert.equal(toNumber('0,00'),null);assert.equal(toNumber('abc'),null)});
test('bcv: página sin tasa falla con mensaje claro',()=>{assert.throws(()=>parseBcv('<html></html>'),/No se encontró la tasa/)});
