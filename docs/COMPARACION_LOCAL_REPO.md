# Comparación del proyecto local y GitHub

Fecha: 15 de octubre de 2026. Repositorio: https://github.com/merchandev/kanban-motoresmorichal

## Base comparada

`origin/main`: `2e076c7f71e0393ab8110dc0354abe5a70545b84` — «Add files via upload».
El árbol remoto tenía seis archivos, todos en la raíz. El workspace local no tenía
metadatos Git; se enlazó a esa historia sin sobrescribir sus archivos de trabajo.

| Área | Remoto de referencia | Versión local incorporada |
|---|---|---|
| API | Ausente | Express, PostgreSQL, sesiones, permisos, fotos y flujos transaccionales |
| Frontend | Ausente | React/Vite, tablero, mapa, piezas, historial y registro por QR |
| Persistencia | Solo referencias en Compose | Esquema e inicialización completos |
| Pruebas | Ausentes | Utilidades, imágenes y escenarios HTTP/PostgreSQL |
| Despliegue | Compose que referenciaba carpetas ausentes | Dockerfiles, lockfiles, scripts y perfil VPS autónomo |
| Documentación | README de MVP | Arquitectura, API, QA, revisiones, comparación, VPS e historial |
| Secretos | `.env` versionado | Retirado del árbol actual; plantillas sin claves reales; rotación pendiente si se usaron las claves históricas |
| Historia futura | Sin mecanismo | `historial.md`, instrucciones, hooks y validación CI |

## Conservación y alcance

- Se mantiene el antecesor remoto y la identidad Git configurada del propietario.
- El código local es la versión funcional que se incorpora, no una sustitución basada
  solo en el README remoto. No se rediseñó la interfaz.
- `compose.yaml` conserva el entorno local; `compose.vps.yaml` prepara el despliegue
  independiente sin heredar 80/443.
- `.env`, respaldos, bases, fotos privadas y `node_modules` no forman parte del commit.
- Los informes de revisión son históricos: parte de sus hallazgos ya está atendida en
  la implementación posterior, por ejemplo identidad, fotos y movimiento transaccional.

## Evidencia de validación de esta consolidación

| Comprobación | Resultado local |
|---|---|
| Sintaxis de API, pruebas y scripts | Correcta (`npm run check`) |
| Suite completa Docker, Node 22 y PostgreSQL 16 | **19/19 aprobadas, sin omisiones** |
| Restauración de datos | 15 tablas comparadas y 9 archivos verificados por SHA-256 |
| Build de frontend | Vite correcto, 1749 módulos transformados |
| Build de API | Correcto con `npm ci` y Sharp 0.35.5 |
| Perfil VPS en un proyecto local desechable | Tres servicios, solo web publicada en loopback/puerto efímero, login y /registro correctos, sin demo; límites y aislamiento verificados |
| Auditoría npm API producción y frontend | Cero vulnerabilidades reportadas después de actualizar Sharp |
| Hooks Git en repositorio temporal | Historial incluido en el commit y .env bloqueado |
| Compose VPS y scripts Bash | Configuración y sintaxis correctas |

Se detectaron y corrigieron dos problemas en las pruebas de piezas: precondición
incorrecta en el caso de estado repetido y tres llamadas POST que debían ser PATCH.
Se conservó el comportamiento y los permisos de la API. También se corrigió la
versión vulnerable de Sharp (0.34.3 → 0.35.5) y se repitió la suite con la nueva versión.

Estos resultados son locales; no equivalen a un despliegue remoto ni a una prueba de carga.

## Pendiente exclusivamente del VPS

Acceso SSH válido, inventario real de puertos, confirmación de `18090/TCP`, capacidad
de CPU/RAM/disco, firewall, credenciales nuevas y prueba de acceso externo. No se ha
modificado el servidor ni ninguno de los proyectos que aparecen en las capturas.
