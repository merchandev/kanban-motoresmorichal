'use strict';
const {execFileSync}=require('node:child_process');
execFileSync('git',['config','--local','core.hooksPath','.githooks'],{stdio:'inherit'});
console.log('Hooks locales instalados: cada commit registra sus archivos en historial.md.');
