# Revisión del proyecto y mejoras propuestas

**Fecha:** 15 de octubre de 2026, America/Caracas.  
**Alcance:** revisión del código actual, esquema de datos, pruebas, scripts y documentación.  
**Cambios realizados durante esta revisión:** únicamente la creación de este informe. No se modificaron código, estilos, configuración, registros ni servicios.

## 1. Evaluación general

El proyecto ha crecido de forma útil: ahora incluye pedidos de piezas con proveedor, destino, responsable y llegada estimada; historial del vehículo agrupado por días; y movimientos desde el mapa, el tablero y la ficha mediante un flujo común.

Las validaciones anteriores siguen presentes en la API: permisos por acción, garantía elegible antes del traslado, técnico/puesto/tareas/requisiciones antes de Calidad, evidencias de calidad y lavado y retorno confirmado antes de entregar. No encontré que el servidor haya vuelto a completar tareas o aprobar garantías automáticamente dentro de una transición.

Mi prioridad sería consolidar la **consistencia de las operaciones nuevas y la trazabilidad**. Mantendría el diseño actual: no propondría otro cambio global de anchos ni márgenes.

No hay un repositorio Git en esta carpeta, por lo que no es posible atribuir exhaustivamente cada diferencia a un cambio o autor. Las referencias siguientes corresponden a los archivos y líneas revisados en esta fecha.

## 2. Comprobaciones realizadas y límites

| Comprobación | Resultado de esta revisión |
|---|---|
| `npm test` | 7 pruebas aprobadas; 1 prueba de integración omitida por su condición `TF_INTEGRATION` |
| `npm run check` | Sintaxis de `index.cjs` e `init.cjs` correcta |
| `GET http://localhost/` | HTTP 200 |
| `GET http://localhost/api/health` | HTTP 200 |
| Estado Docker existente | API y base saludables; web en ejecución |
| Ejecución aislada de `runPlan` con API simulada | Confirmó que completa también una tarea añadida después de preparar la confirmación |
| Validación aislada de fechas | `isDay` acepta `2026-02-31`, una fecha inexistente |

Las simulaciones se ejecutaron en memoria, sin escribir en la API ni en PostgreSQL. No se ejecutaron builds, despliegues, reinicios, restauraciones ni pruebas con escrituras. Tampoco se hizo una nueva validación visual en dispositivos ni un análisis de vulnerabilidades de dependencias.

Por tanto, **no afirmo que los módulos nuevos hayan pasado una prueba e2e en esta revisión**. Un servicio saludable o siete pruebas unitarias aprobadas no demuestra el flujo completo de pedidos e historial.

## 3. Resumen de prioridades

P1: atender antes de ampliar el uso operativo. P2: siguiente iteración de fiabilidad. P3: mantenimiento y mejoras graduales. La prioridad expresa el impacto propuesto; las decisiones de negocio se distinguen de los defectos comprobados.

| ID | Prioridad | Mejora | Evidencia principal |
|---|---|---|---|
| M01 | P1 | Confirmar exactamente las tareas que el usuario revisó | `web/src/App.jsx:100–105` |
| M02 | P1 | Controlar fallos parciales de movimientos encadenados | `web/src/App.jsx:100–140` |
| M03 | P1 | Definir transiciones y reaperturas de pedidos de piezas | `api/src/index.cjs:160–177` |
| M04 | P1 | Preservar la asociación histórica de una pieza al editarla | `api/src/index.cjs:139–166` |
| M05 | P1 | Definir permisos específicos para pedidos, recepción y entrega de piezas | `api/src/index.cjs:136` |
| M06 | P1 | Ampliar pruebas para los módulos nuevos | `api/test/` |
| M07 | P2 | Distinguir claramente inspeccionar el mapa de mover una orden | `web/src/App.jsx:248–277` |
| M08 | P2 | Definir cómo un pedido pendiente afecta a su OT y al stock | `api/src/index.cjs:240–244` y `167–177` |
| M09 | P2 | Corregir la validación de fechas y datos vacíos | `api/src/index.cjs:137` y `api/src/shared.cjs` |
| M10 | P2 | Hacer que la auditoría conserve datos históricos y sea atómica | `api/src/index.cjs:70–73` y `118–127` |
| M11 | P2 | Mostrar límites, paginar y mejorar consultas del historial | `api/src/index.cjs:42`, `118–128`, `153–155` |
| M12 | P2 | Evitar que un módulo lento bloquee toda la actualización | `web/src/App.jsx:550–554` |
| M13 | P2 | Completar la trazabilidad y vigencia de las tasas | `api/src/index.cjs:323–350` |
| M14 | P3 | Versionar, fijar dependencias y actualizar documentación | Dockerfiles, manifiestos y `README.md` |

## 4. Hallazgos y recomendaciones

### M01 — La confirmación de tareas no queda vinculada a las tareas mostradas

**Hallazgo comprobado.** El formulario muestra las tareas pendientes consultadas al abrirlo. Sin embargo, al ejecutar `runPlan`, se vuelve a consultar la orden y se marcan como terminadas **todas** las tareas pendientes de esa segunda consulta, sin limitarse a las que el usuario había visto.

**Ejemplo:** el operador confirma la tarea A; otro técnico agrega B antes de guardar. La operación completa A y B. Lo reproduje con la función real y una API simulada: se emitieron actualizaciones para ambos identificadores.

**Mejoraría:** conservar los identificadores confirmados y enviar una operación de finalización explícita. Si cambian las tareas o la versión de la orden, pedir revisar las nuevas pendientes. Una confirmación colectiva puede mantenerse, pero debe tener un alcance preciso.

**Aceptación:** una tarea añadida después de abrir el formulario queda pendiente y bloquea el paso a Calidad hasta su confirmación.

### M02 — Los movimientos encadenados pueden quedar guardados a medias

**Hallazgo por lectura de código.** `runPlan` realiza varias peticiones independientes: aprobar presupuesto, desbloquear, asignar, completar tareas y transicionar. Si falla una petición intermedia, las anteriores ya quedaron confirmadas. El contador `done` permite continuar mientras el formulario siga abierto, pero se pierde al cerrarlo o recargar.

Esto no equivale a saltarse las validaciones del servidor: cada transición sigue validada. El riesgo es que una acción presentada como «Mover a Lavado» termine parcialmente ejecutada en Taller o Calidad, con otros cambios ya guardados.

**Mejoraría:** elegir explícitamente una de estas estrategias:

- Para una operación indivisible, implementar un comando del servidor que valide y aplique el conjunto en una transacción, con identificador de operación y control de versión.
- Para una secuencia de pasos reales, conservar el progreso, mostrar el último estado guardado y permitir reanudar con seguridad. No deshacer automáticamente evidencias o actos ya confirmados.

Las dos alternativas requieren manejar reintentos sin duplicar tareas ni eventos.

**Aceptación:** simular un fallo en cada paso y una desconexión después de guardar. La pantalla identifica qué se guardó; reintentar no duplica datos ni usa una estación de origen desactualizada.

### M03 — Los pedidos permiten cualquier cambio de estado y edición después de finalizar

**Hallazgo comprobable en el controlador.** El endpoint de estado comprueba que el nuevo estado pertenezca a la lista y sea distinto del anterior; no valida una matriz de transiciones. La UI ofrece todos los demás estados. Se puede pasar de `ordered` a `delivered`, volver de `delivered` a `ordered` o reabrir un cancelado. Salvo al cancelar, la explicación es opcional.

Además, el `PATCH` permite cambiar los datos de una pieza entregada o cancelada. No existe una protección específica de estado final.

**Mejoraría:** documentar los cambios ordinarios permitidos y separar las correcciones excepcionales. Si el negocio permite entregas directas o reaperturas, exigir el permiso correspondiente y el motivo, conservando las fechas y evidencias previas. No asumir que toda devolución debe estar prohibida.

**Aceptación:** probar cada combinación origen/destino; las excepciones necesitan autorización y motivo y nunca borran la evidencia de una entrega anterior.

### M04 — Reasignar una pieza puede separar sus eventos del historial del vehículo

**Hallazgo por lectura de código.** La edición permite cambiar `vehicle_id` y `order_id`. Los eventos de creación conservan la asociación original y los eventos nuevos se registran con la nueva. El historial del vehículo consulta esas asociaciones para reunir los eventos. La edición solo guarda una lista de nombres de campos cambiados, no sus valores anteriores y nuevos.

**Consecuencia:** una pieza puede aparecer asociada al vehículo B mientras su creación y parte de su trayectoria siguen en el historial de A, sin una explicación completa de la reasignación.

**Mejoraría:** registrar la transferencia con vehículo y OT anteriores/nuevos, responsable, fecha y motivo. Mostrarla en ambos historiales. Restringir reasignaciones después de recibir o entregar según la política del taller.

**Aceptación:** reasignar una pieza A → B permite reconstruir la trayectoria completa desde cualquiera de los dos vehículos.

### M05 — El permiso para gestionar piezas es demasiado amplio para distinguir responsabilidades

**Decisión de permisos a revisar.** `partsStaff` acepta a quien tenga `parts`, `inventory` o `warranty`. Como el técnico tiene `parts`, puede crear y editar pedidos al proveedor y registrar su recepción, entrega, cancelación o reapertura. El mismo acceso engloba actividades distintas.

No lo presento como una vulnerabilidad explotada: es el comportamiento explícito actual. Falta decidir si un técnico que solicita una pieza también debe poder certificar su recepción o entrega.

**Mejoraría:** separar permisos como solicitar, editar pedido, registrar recepción, entregar, cancelar y reabrir; devolver las capacidades desde la API para que la interfaz use la misma definición. Mantener administración y gerencia según la matriz acordada.

**Aceptación:** verificar por HTTP cada rol y acción, incluyendo peticiones hechas directamente sin pasar por la interfaz.

### M06 — La cobertura actual no protege los cambios nuevos

Las pruebas existentes cubren utilidades, el parser BCV y un flujo HTTP de órdenes habilitado mediante variable de entorno. No encontré pruebas específicas de pedidos al proveedor, historial diario, reasignación de piezas, movimientos encadenados ni la interacción del mapa con los formularios.

**Mejoraría:** agregar casos de integración para permisos y estados de piezas; eventos por vehículo; modificaciones de vínculos; fechas imposibles; operaciones concurrentes; y estados finales. Para frontend, probar confirmaciones, cambios concurrentes de tareas y reintentos de `runPlan`.

El script `scripts/test-flow.sh` ya ofrece un punto de partida aislado. Conviene ampliar también la verificación de restauración: actualmente compara el número de órdenes y comprueba que haya archivos, pero no compara contenidos, hashes ni todas las entidades nuevas.

**Aceptación:** una ejecución reproducible en una base desechable cubre los módulos nuevos y falla si se introduce cualquiera de los problemas M01–M04.

### M07 — Consultar una estación del mapa puede ejecutar un movimiento

**Comportamiento actual, mejora de interacción.** Las estaciones llaman a `onSelect`, que en el diálogo llama a `moveTo`. Hay indicaciones «Mover aquí» y una leyenda que explica la acción, pero algunos avances sin datos faltantes se ejecutan sin formulario. Las placas usan otro recorrido para inspeccionar.

**Mejoraría:** conservar el mapa, pero diferenciar de forma permanente las acciones «Ver estación» y «Mover vehículo». Una alternativa es que seleccionar una estación solo muestre sus datos y que un botón explícito ejecute el movimiento. Si se conserva el clic directo, la etiqueta accesible debe indicar que modifica la orden, no únicamente el número de vehículos.

**Aceptación:** un usuario puede explorar todas las estaciones sin escribir en la API; mover una orden requiere una acción inequívoca.

### M08 — Los pedidos al proveedor y las requisiciones no tienen una política conjunta

**Decisión funcional pendiente.** Hay dos circuitos: `part_orders` para rastrear pedidos y `parts_requests` para despachar inventario. El paso a Calidad comprueba requisiciones, pero no pedidos al proveedor. Marcar un pedido como recibido o entregado tampoco genera un movimiento de inventario.

Esto puede ser correcto si el rastreo es informativo o si hay piezas entregadas directamente al departamento. No conviene conectarlos automáticamente sin definir el proceso.

**Mejoraría:** indicar si cada pedido es informativo o necesario para completar la OT. Para los necesarios, definir cuándo bloquea y cuándo se libera. Para stock, diferenciar recepción a almacén de entrega directa, con una vinculación explícita y descuento/entrada una sola vez.

**Aceptación:** una OT no avanza con una pieza obligatoria pendiente; una recepción reintentada no duplica stock. Los pedidos informativos no bloquean indebidamente.

### M09 — Fechas y valores vacíos requieren validación estricta

**Hallazgo reproducido.** `isDay` acepta una cadena con formato correcto y una fecha que JavaScript pueda interpretar. JavaScript normaliza fechas como `2026-02-31`, por lo que supera esa validación. PostgreSQL puede rechazarla posteriormente; el código `22008` no está incluido en el manejo específico de errores de datos.

Asimismo, `integer` convierte primero con `Number`: valores como `null` se convierten en cero. La cantidad de piezas utiliza `b.quantity || 1`, de modo que un cero numérico se reemplaza por uno antes de validarse.

**Mejoraría:** validar día/mes/año reales y comprobar la conversión de ida y vuelta. Distinguir ausente, vacío y cero; aplicar valores por defecto solo cuando el campo realmente falte. Mantener también restricciones de base de datos.

**Aceptación:** fechas imposibles y cantidades cero producen errores 400 claros, sin crear registros ni responder 500 por datos del usuario.

### M10 — Auditoría histórica y escritura deben conservarse juntas

Hay dos puntos concretos:

1. El historial devuelve `actor_role` desde el rol actual de `users`. Si cambia el rol del usuario, el pasado se presenta con el nuevo rol. Los nombres del técnico también se resuelven contra usuarios actuales.
2. El alta y la actualización de vehículos guardan el cambio y el evento en consultas independientes. Si falla la auditoría, el vehículo puede quedar guardado aunque la petición termine con error.

**Mejoraría:** guardar actor, rol y referencias históricas relevantes en el evento; conservar los identificadores para navegación. Incluir la modificación del vehículo y su evento en la misma transacción. Registrar valores anteriores/nuevos para cambios operativos importantes.

**Aceptación:** cambiar el rol no altera cómo se describe un evento pasado; un fallo al insertar la auditoría revierte la modificación asociada.

### M11 — Los límites de listado e historial pueden producir una visión incompleta

`/orders` devuelve hasta 500 órdenes, priorizando las abiertas, y el frontend filtra ese conjunto localmente. Los pedidos tienen un límite de 1000 y el historial de vehículo de 2000 eventos. No se devuelve un cursor ni un indicador de truncamiento.

**Consecuencia:** un mapa puede dejar fuera una OT si aumenta el volumen, un filtro de órdenes cerradas puede parecer vacío aunque haya registros y un historial presentado como completo puede estar recortado.

**Mejoraría:** búsqueda y paginación en servidor; totales calculados sobre el conjunto completo; consulta directa del estado por vehículo y de la OT seleccionada. Mostrar los límites del historial. Revisar con `EXPLAIN` las consultas por `detail->>'vehicle_id'` y `detail->>'part_id'` antes de agregar índices de expresión u otra estructura.

También actualizaría el contador de historial en Borradores: no incluye `part_orders`, mientras que la purga sí los tiene en cuenta. La pantalla puede indicar «Sin historial» y la API rechazar correctamente la eliminación por existir un pedido.

**Aceptación:** con más de 500 órdenes y 2000 eventos se puede localizar cualquier registro y la interfaz distingue un historial paginado de uno realmente vacío.

### M12 — Una consulta lenta o fallida afecta a toda la actualización

`refresh` consulta todos los listados mediante `Promise.all`. Si falla un módulo, no actualiza los demás. Además, espera la tasa BCV antes de publicar `setData`; una consulta externa lenta puede retrasar la operación aunque órdenes y clientes ya estén disponibles. El historial del vehículo se carga al abrirse y no se actualiza por cambios posteriores mientras siga abierto.

**Mejoraría:** cargar módulos según la pantalla, publicar primero los datos operativos y resolver tasas por separado; mostrar errores por sección y la fecha de última actualización. Invalidar o actualizar historiales cuando se guardan eventos relevantes. Preservar los códigos HTTP para tratar un 401 sin depender del texto del error.

**Aceptación:** un fallo del BCV o de pedidos no impide consultar órdenes; un historial abierto incorpora los cambios pertinentes y distingue datos antiguos de datos recién cargados.

### M13 — Las tasas necesitan una política de vigencia y de corrección histórica

La exclusión de tasas futuras como vigentes sigue corregida. Quedan estas mejoras:

- Advertir claramente la antigüedad de la última tasa disponible y decidir qué hacer al entregar sin tasa. Actualmente puede cerrarse con monto en dólares y bolívares nulos.
- Conservar el identificador/fecha valor y la fuente aplicados al cierre, además del número de tasa.
- Decidir si una actualización automática del BCV debe reemplazar una tasa manual del mismo día. `refreshRate` actualmente la sobrescribe y borra `set_by`.
- Evitar presentar como importe histórico definitivo una conversión calculada después: el reporte puede estimar bolívares para entregas sin `paid_ves` usando tasas disponibles posteriormente.

**Aceptación:** cada cierre permite identificar la tasa realmente usada; los importes estimados y los registrados se distinguen; una corrección manual no desaparece sin trazabilidad.

### M14 — Mantenimiento, documentación y operación

Sin alterar la interfaz, mejoraría gradualmente:

- **Versionado:** iniciar un repositorio Git y revisar que `.env`, respaldos y adjuntos no se incorporen. Facilita comparar cambios y revertir una versión concreta.
- **Dependencias:** añadir archivos de bloqueo y usar instalaciones reproducibles en Docker. Fijar versiones directas no fija las dependencias transitivas ni las etiquetas base de imagen.
- **Estructura:** separar `App.jsx` y `index.cjs` por módulos después de cubrir los flujos con pruebas; evitar una reescritura grande antes de estabilizar el comportamiento.
- **Documentación:** incorporar `/part-orders`, historial del vehículo, transiciones de piezas y reglas del mapa en `ENDPOINTS.md` y arquitectura. Actualizar el estado de validación del README y distinguir evidencias anteriores de las de esta revisión.
- **Backups:** conservar el script ya corregido y añadir detección de archivos incompletos, verificación del archivo y política de copias externas. Definir cómo mantener consistencia entre BD y adjuntos durante actividad concurrente.
- **Sesiones:** limpieza de sesiones expiradas, política de recuperación de acceso y protección del último administrador activo. La ruta de usuarios evita la autodesactivación, pero no una autodegradación de rol mediante petición directa.
- **Accesibilidad:** foco dentro de los diálogos, retorno al control de origen al cerrar y revisión de superposición de mapa/historial/formulario. Son ajustes puntuales; no hace falta cambiar la distribución general.

## 5. Orden de implementación recomendado

1. Cubrir con pruebas las tareas confirmadas y los movimientos parciales; resolver M01 y acordar la estrategia de M02.
2. Definir la matriz de permisos y estados de piezas; proteger reasignaciones e historial: M03–M05.
3. Decidir qué pedidos bloquean una OT y cómo se relacionan con inventario: M08.
4. Completar las pruebas de los módulos nuevos y los errores de datos: M06 y M09.
5. Fortalecer auditoría, paginación y actualización de datos: M10–M12.
6. Precisar tasas, operación y documentación: M13–M14; ajustar la interacción del mapa de M07 sin rediseñar la plataforma.

## 6. Qué conservaría

- El diseño y la distribución actuales, respetando la reversión del cambio global al 80%.
- El acceso al mapa desde clientes, vehículos y órdenes.
- El historial por días y la navegación hacia la OT correspondiente.
- La separación visual entre pedidos con rastreo y existencias.
- La validación de transiciones y roles en la API, aunque la UI anticipe los requisitos.
- El bloqueo de inventario para evitar descuentos dobles y stock negativo.
- El script de pruebas con base desechable y el respaldo de adjuntos por salida estándar.

La siguiente mejora con mayor valor sería hacer que **cada confirmación afecte exactamente a los datos que el operador revisó y que cada fallo deje un estado claro y trazable**.
