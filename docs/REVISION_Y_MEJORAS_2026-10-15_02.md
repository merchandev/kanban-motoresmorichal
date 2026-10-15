# Segunda revisión del proyecto — registro público por QR y fotografías

**Fecha:** 15 de octubre de 2026, America/Caracas.  
**Documento anterior:** [Primera revisión](REVISION_Y_MEJORAS_2026-10-15.md).  
**Alcance:** código actual de frontend, API, esquema, pruebas y configuración relacionadas.  
**Única modificación de esta revisión:** creación de este archivo. No se modificaron fuentes, estilos, configuración, datos ni servicios; el informe anterior se conserva.

## 1. Evaluación del estado actual

El cambio más importante es el **autorregistro público por QR**: formulario independiente en `/registro`, carga de fotos de perfil/vehículo/placa, recepción de solicitudes pendientes y aceptación o rechazo desde la aplicación. Al aceptar se enlazan o crean cliente y vehículo y, opcionalmente, se abre una orden.

También aparecen fotografías en fichas y listas, notificaciones de registros nuevos, impresión y descarga del QR y un ajuste a `clock_timestamp()` para fechar eventos de auditoría con la hora de inserción.

La separación entre registro público pendiente y aceptación interna es una buena base. Mi siguiente prioridad sería asegurar **a quién se atribuyen los datos, qué ocurre si se reintenta una operación y cómo se conservan las fotografías**. Mantendría el diseño actual y no retomaría el cambio global al 80% de ancho.

No hay repositorio Git en esta carpeta; esta revisión no equivale a una comparación exhaustiva de commits. Las líneas citadas corresponden al contenido leído en esta revisión y pueden variar después.

## 2. Verificación realizada

| Verificación | Resultado |
|---|---|
| `npm test` | 7 pruebas aprobadas; 1 prueba de integración omitida por condición de entorno |
| `npm run check` | Sintaxis de API e inicialización correcta |
| `GET /` y `GET /api/health` | HTTP 200 |
| `GET /registro` | HTTP 200; solo confirma entrega de la página, no funcionamiento completo del formulario |
| Docker existente | API y PostgreSQL saludables; web en ejecución |
| Simulación de `saveMedia` con fallo de BD | Una escritura simulada queda fuera de la lista que usa la limpieza |
| Construcción de URL QR con `/registro` ya incluido | Produce `/registro/registro` |

Las simulaciones se ejecutaron en memoria, con escritura de archivos y base de datos sustituidas por funciones simuladas. No se enviaron registros públicos, no se aceptaron solicitudes, no se cargaron fotos y no se alteró la base. Tampoco se ejecutaron builds, despliegues, reinicios, restauraciones ni pruebas e2e nuevas.

Los tests existentes no contienen casos específicos de `client_registrations`, aceptación de autorregistros ni almacenamiento de `media`. No debe considerarse validado el módulo nuevo por el resultado de esas siete pruebas.

## 3. Resumen de mejoras nuevas

**P1:** resolver antes de ampliar el uso del registro público. **P2:** siguiente iteración de fiabilidad y operación. No se identificó un fallo P0 en esta revisión; tampoco se realizó una auditoría de seguridad exhaustiva.

| ID | Prioridad | Mejora | Referencia |
|---|---|---|---|
| N01 | P1 | Resolver la identidad antes de actualizar un cliente existente | `api/src/index.cjs:206–225` |
| N02 | P1 | Hacer segura la aceptación simultánea de registros del mismo vehículo | `api/src/index.cjs:218–235` |
| N03 | P1 | Limitar recursos y validar realmente las imágenes en el servidor | `api/src/index.cjs:32–39` |
| N04 | P1 | Incluir todo archivo creado en la limpieza ante errores | `api/src/index.cjs:37–55` |
| N05 | P1 | Añadir pruebas del flujo público y de aceptación | `api/test/` |
| N06 | P2 | Evitar registros duplicados cuando el cliente reintenta | `api/src/index.cjs:40–55`, `web/src/Registro.jsx:41–49` |
| N07 | P2 | Ajustar el límite por IP al uso de una red compartida | `api/src/index.cjs:32` |
| N08 | P2 | Guardar la evidencia de la autorización mostrada al cliente | `api/src/index.cjs:43`, `api/src/schema.sql:84–90` |
| N09 | P2 | Definir retención y reemplazo de fotografías | `api/src/index.cjs:223–225`, tabla `media` |
| N10 | P2 | Validar y centralizar la dirección del QR | `web/src/App.jsx:408–425` |
| N11 | P2 | Evitar enviar mientras se procesan fotografías | `web/src/Registro.jsx:37–45` |
| N12 | P2 | Hacer visible el estado real de la bandeja y sus límites | `api/src/index.cjs:213`, `web/src/App.jsx:627–637` |

## 4. Hallazgos sobre el registro nuevo

### N01 — La coincidencia de placa o teléfono no debería resolver por sí sola la identidad

**Observado en el código:** el servidor propone un cliente por cédula/documento o teléfono. Si coincide la placa y no hay cliente coincidente, utiliza al dueño actual del vehículo. El conflicto se rechaza cuando hay una coincidencia de cliente que apunta a otra persona, pero no exige resolver explícitamente el caso sin coincidencia de cliente.

Por ejemplo, una solicitud con nombre y teléfono distintos, pero con una placa existente, puede aceptarse asociada al dueño registrado. Entonces se pueden completar correo/documento vacíos de ese dueño y sustituir su foto con lo enviado. La UI informa que se conservará al propietario, pero no exige una verificación específica de identidad ni una selección explícita de qué datos actualizar.

**No es una actualización pública directa:** hace falta una aceptación autenticada por recepción. El riesgo está en una asociación incorrecta durante esa revisión, no en que cualquier visitante pueda modificar fichas sin aprobación.

**Mejoraría:** tratar las coincidencias como sugerencias, comparar nombre, documento y teléfono normalizados y pedir resolver las discrepancias. Separar al propietario del vehículo de la persona que lo lleva al taller. Mostrar y confirmar por campo las actualizaciones al cliente existente, especialmente documento y foto.

**Aceptación:** una persona que presenta una placa ajena no cambia la identidad del propietario al aceptar el registro; el operador debe indicar si actúa como autorizado, si los datos son una corrección o si procede rechazar.

### N02 — El bloqueo del autorregistro no serializa operaciones sobre el mismo vehículo

**Observado en el código:** aceptar bloquea la fila de `client_registrations`. Eso protege contra aceptar dos veces **el mismo registro**, pero dos registros diferentes pueden referirse al mismo vehículo. La comprobación de órdenes abiertas cuenta filas sin bloquear un recurso común; la creación normal de órdenes tampoco dispone de una restricción única de OT abierta por vehículo en el esquema revisado.

**Riesgo inferido de concurrencia:** dos recepcionistas pueden aceptar registros diferentes del mismo vehículo y ambas operaciones superar la comprobación antes de insertar sus órdenes. La creación de clientes por teléfono/documento también puede duplicarse porque esas coincidencias no son claves únicas. La placa única solo protege representaciones exactamente iguales.

**Mejoraría:** acordar primero si la regla es una OT abierta por vehículo. Si lo es, aplicarla en todos los caminos de alta mediante bloqueo del vehículo y/o un índice único parcial. Para vehículo nuevo, normalizar la placa de forma uniforme y manejar el conflicto de inserción. No convertir automáticamente teléfono o documento opcional en una clave única sin revisar duplicados y reglas del negocio.

**Aceptación:** dos aceptaciones simultáneas del mismo vehículo dejan una única OT abierta y un error 409 claro para la otra operación. Un conflicto no deja clientes o fotos parcialmente asociados.

### N03 — La validación de imágenes del servidor se limita a una firma

**Observado:** el endpoint público recibe hasta tres archivos de 6 MB en memoria. `saveMedia` reconoce cabeceras de JPEG, PNG o WebP, pero no decodifica ni limita dimensiones o píxeles. La compresión a JPEG del formulario ayuda al cliente normal, pero una petición directa puede omitirla.

La comprobación actual evita tipos obvios incorrectos; no demuestra que una imagen esté completa o se pueda renderizar. Además, cada petición puede reservar aproximadamente 18 MB de archivos, más la sobrecarga, y no encontré cuotas globales de cargas o conservación.

**Mejoraría:** limitar bytes totales, concurrencia y uso de almacenamiento; decodificar con límites de dimensiones/píxeles y generar una versión controlada para visualizar. Rechazar archivos truncados. Eliminar metadatos que no hagan falta. Considerar carga temporal en disco si el volumen justifica evitar buffers completos.

**Aceptación:** una imagen corrupta o con dimensiones excesivas se rechaza antes de quedar registrada; varias cargas simultáneas no agotan memoria ni espacio. Probarlo en un entorno desechable, no en la instancia activa.

### N04 — Una fotografía puede quedar huérfana si falla su INSERT

**Reproducido con funciones simuladas:** `saveMedia` escribe el archivo y después inserta en `media`. La lista `saved` del controlador solo recibe el nombre cuando `saveMedia` termina correctamente. Si el INSERT falla, el archivo ya existe, pero su nombre nunca entra en la lista de limpieza.

La simulación de ese punto produjo una escritura simulada y cero archivos registrados para borrar. No se escribieron archivos reales.

**Mejoraría:** registrar el nombre para compensación inmediatamente después de escribir, o hacer que `saveMedia` limpie su propio archivo si falla la consulta. Añadir una comprobación periódica y prudente de huérfanos, diferenciando archivos temporales de archivos referenciados.

**Aceptación:** provocar fallos en cada INSERT y en el alta del registro no deja archivos nuevos sin referencia ni elimina archivos usados por otros registros.

### N05 — Las pruebas todavía no ejercitan el autorregistro

**Mejoraría:** ampliar las pruebas de integración existentes con estos casos:

1. Registro sin fotos y con las tres fotos; descarga de fotos únicamente con sesión autorizada.
2. Archivo inválido, límite de bytes, autorización ausente y datos obligatorios incorrectos.
3. Aceptación con cliente/vehículo nuevos, existentes, en Borradores y con datos conflictivos.
4. Aceptar con y sin OT, rechazado previo y segunda aceptación del mismo registro.
5. Dos registros del mismo vehículo aceptados simultáneamente.
6. Fallo de BD después de escribir una foto y verificación de limpieza.
7. Reintento del envío después de una respuesta perdida.
8. Backup/restauración de `media`, registros, fotos asociadas y archivo físico.

Para frontend: QR que abre la URL esperada, subida mientras se procesa una foto, error de red conservando datos y confirmación de identidad al aceptar.

**Aceptación:** todos estos escenarios tienen resultados reproducibles en la base de pruebas; el flujo normal del taller sigue pasando sus pruebas.

### N06 — Un reintento público genera otro registro

Cada POST genera un UUID y una secuencia nuevos. Si la base guarda el registro pero se pierde la respuesta, el formulario muestra error y el usuario puede reenviar, creando otra solicitud.

**Mejoraría:** generar una clave de envío y conservarla hasta obtener respuesta definitiva. El servidor debe devolver el mismo resultado al repetirla con el mismo contenido. Esto complementa la aceptación protegida, que ya evita revisar dos veces la misma fila.

**Aceptación:** simular pérdida de respuesta y reenvío deja un registro y el mismo código de recepción.

### N07 — Diez registros por hora e IP pueden bloquear al propio taller

El limitador es de diez peticiones por hora por IP. Si los clientes usan el Wi-Fi del taller, pueden compartir una única IP pública. Los intentos fallidos también consumen el contador; el campo trampa se revisa después del limitador y de recibir los archivos.

**Mejoraría:** medir la demanda y combinar un límite de ráfagas, control de cargas y límite por origen de envío. Mantener la protección contra abuso sin depender exclusivamente de una cuota horaria baja por IP. Explicar cuándo puede volver a intentarse y ofrecer recepción como alternativa.

No quitaría el limitador ni confiaría solo en el campo trampa.

**Aceptación:** una jornada normal con más de diez clientes en la misma red no queda bloqueada, y una ráfaga abusiva sigue limitada.

### N08 — La autorización se exige, pero no se guarda de forma explícita

La API exige `consent === 'true'`, pero el INSERT y la tabla no conservan la versión del texto aceptado ni un campo explícito de aceptación. La fecha de creación del registro por sí sola no indica qué texto se mostró.

**Mejoraría:** guardar fecha de aceptación y versión del aviso, vinculadas al registro. Explicar la finalidad y conservación de las fotos; mantener la de perfil opcional si no es necesaria para atender el vehículo. No recopilar datos adicionales solo por precaución.

Esta es una recomendación de trazabilidad del producto, no una conclusión sobre cumplimiento legal.

**Aceptación:** desde un registro puede identificarse qué autorización confirmó el cliente, cuándo y para qué fotos/datos.

### N09 — Faltan reglas de retención, reemplazo y caché de fotos

Rechazar un registro conserva sus fotos y datos. Reemplazar una foto en un cliente o vehículo cambia la referencia actual, pero no establece una política sobre la foto anterior. No encontré un proceso de conservación o depuración de `media`.

Además, `/api/media/:id` responde con caché privada de un día. Está protegido por autenticación en el servidor, pero un navegador compartido puede conservar una imagen en su caché después de cerrar sesión. Eso no supone que un usuario remoto sin sesión pueda descargarla desde la API.

**Mejoraría:** definir plazos por estado y referencias activas, preservar la evidencia que proceda y borrar solo lo que pueda eliminarse. Para fotos personales, revisar si corresponde `no-store` o revalidación. Incluir el conjunto BD/archivos en la restauración probada.

**Aceptación:** sustituir, rechazar y depurar fotos tiene resultados previsibles y auditables; ningún archivo usado por una ficha o registro vigente se elimina accidentalmente.

### N10 — La URL del QR se concatena sin validación

**Reproducido en memoria:** si se introduce `https://taller.example/registro`, el código genera `https://taller.example/registro/registro`. El campo también permite una dirección sin protocolo, esquemas no HTTP o una cadena excesivamente larga. El aviso de `localhost` es útil, pero no valida el destino completo.

La dirección se guarda en `localStorage`, por navegador. Dos equipos de recepción pueden imprimir QRs con destinos distintos.

**Mejoraría:** parsear la dirección con `URL`, admitir únicamente HTTP/HTTPS, construir la ruta de forma controlada, limitar longitud y gestionar errores de generación. Mostrar dominio y ruta antes de imprimir. Para uso estable, centralizar la dirección publicada del taller y mantener separada una configuración de prueba.

**Aceptación:** entradas con/sin barra final o con `/registro` producen el mismo destino válido; una dirección inválida no genera ni permite imprimir un QR incorrecto. Probar el enlace desde un teléfono conectado a la red real antes de distribuir el cartel.

### N11 — Procesar una foto y enviar son operaciones independientes

`pick` comprime la imagen de forma asíncrona, pero no hay un estado de procesamiento por foto. `submit` envía las fotos que ya estén en `photos` en ese momento. Puede enviarse antes de terminar la compresión. Si se eligen rápidamente dos archivos para el mismo campo, puede imponerse el resultado del procesamiento que termine más tarde, aunque corresponda a la selección anterior.

**Mejoraría:** estado «Procesando foto», identificador de selección por campo y prevención del envío hasta finalizar las selecciones vigentes. Poder quitar una foto mientras se procesa sin que reaparezca al terminar. Indicar formatos compatibles: el selector admite `image/*`, pero la experiencia con HEIC u otros formatos depende del navegador.

**Aceptación:** escoger A y después B siempre conserva B; quitar la foto cancela su resultado pendiente; enviar no pierde una fotografía que el cliente acaba de seleccionar.

### N12 — La bandeja tiene límites y pausas que deben ser visibles

`/registrations` devuelve como máximo 500 registros, priorizando pendientes recientes. El frontend calcula contadores sobre ese subconjunto. Además, la actualización periódica se pausa cuando hay un formulario o una OT abierta. Los avisos nuevos dependen de esa actualización y no son notificaciones inmediatas del servidor.

**Mejoraría:** paginación, total de pendientes desde servidor, búsqueda de código y orden de atención que evite ocultar solicitudes antiguas. Mostrar cuándo se actualizó la bandeja y mantener su consulta ligera activa cuando recepción revisa otras fichas. Las consultas de coincidencias por teléfono/documento/placa deberían normalizarse e indexarse después de revisar su plan de ejecución.

**Aceptación:** con más de 500 solicitudes se localiza cualquiera y los contadores siguen siendo correctos. Un operador que trabaja en una ficha sabe si hay registros nuevos sin perder sus cambios.

## 5. Qué cambió respecto al informe anterior

| Observación anterior | Estado observado ahora |
|---|---|
| M01: confirmar exactamente las tareas mostradas | Sigue pendiente: `runPlan` vuelve a consultar y completa todas las pendientes, no solo las confirmadas inicialmente (`App.jsx:103–108`). |
| M02: movimientos encadenados y fallos parciales | Sigue pendiente: continúan siendo peticiones independientes con progreso en memoria. |
| M03/M05: estados y permisos específicos de piezas | Continúan la edición/estados con el permiso amplio de `partsStaff`; falta la matriz acordada. |
| M04: reasignación histórica de piezas | Sigue pendiente: se editan los vínculos y se registran nombres de campos cambiados, sin una transferencia histórica completa. |
| M06: pruebas de módulos nuevos | Se amplía la necesidad: ahora deben incluir autorregistro y fotos. Los archivos de pruebas no incorporan esos escenarios. |
| M09: validación estricta de fechas | El helper `isDay` sigue utilizando formato más `new Date`, sin verificar la fecha de ida y vuelta. |
| M10: auditoría histórica | Mejora parcial: `clock_timestamp()` fecha cada inserción con hora real. No resuelve por sí solo el rol histórico, los valores anteriores/nuevos ni la atomicidad de todas las escrituras. |
| M11: límites e historial de Borradores | La purga ya incluye `client_registrations`; los contadores de Borradores aún cuentan solo órdenes/citas y, para vehículos, garantías. Tampoco reflejan pedidos. Puede mostrarse «Sin historial» y rechazarse correctamente la purga. |
| M12: actualización global acoplada | Sigue presente `Promise.all` de los listados, consultas adicionales y espera de la tasa antes de publicar los datos. La bandeja añade otra dependencia. |
| M13/M14: tasas, versionado y documentación | No se observó una solución general. Se mantiene el archivo anterior como detalle; estas conclusiones no incluyen una nueva prueba funcional de tasas o dependencias. |

La inclusión de registros en la protección de purga es positiva: la base y la API evitan eliminar entidades vinculadas. Mejoraría los contadores y mensajes para que la pantalla explique esa protección.

## 6. Orden que seguiría

1. Cubrir con pruebas el autorregistro, la aceptación y la limpieza de fotos; incluir reintentos y concurrencia.
2. Resolver identidad y asociación de registros existentes (N01) y la creación concurrente de OTs (N02).
3. Corregir la limpieza del archivo ante fallo de BD y establecer límites reales de procesamiento/almacenamiento (N03–N04).
4. Añadir idempotencia y ajustar límites para clientes que comparten la red del taller (N06–N07).
5. Conservar autorización, definir retención y revisar el ciclo de caché de fotos (N08–N09).
6. Validar el QR, coordinar el procesamiento de imágenes y paginar la bandeja (N10–N12).
7. Retomar las tareas pendientes del informe anterior, especialmente confirmación exacta de tareas y movimientos parciales.

## 7. Qué conservaría

- El formulario separado y accesible sin una cuenta interna.
- La aprobación de recepción antes de incorporar el registro al taller.
- La posibilidad de aceptar sin abrir una OT.
- Las fotos opcionales y la compresión del lado del cliente como ayuda de experiencia y transferencia.
- La descarga de fotos protegida por sesión; el registro público solo devuelve su código, no las coincidencias internas.
- La protección contra revisar dos veces el mismo registro mediante bloqueo y comprobación de estado.
- La prevención de conflictos explícitos cliente/vehículo y la protección de vehículos en Borradores.
- La impresión y descarga del QR y el aviso cuando se usa `localhost`.
- El diseño actual y los accesos al mapa e historial.

La mejora con mayor impacto ahora es que **aceptar un registro público no atribuya datos a la persona equivocada y que cada envío o aceptación produzca un único resultado verificable**.
