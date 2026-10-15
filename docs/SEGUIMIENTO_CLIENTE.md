# Seguimiento del vehículo por QR

## Entregar el QR

1. Configurar la dirección pública real en **Registro QR** (por ejemplo, la IP y
   el puerto del despliegue). Esta dirección también se usa para seguimiento.
2. En **Clientes** o **Vehículos**, pulsar **QR cliente**. Se requiere permiso
   para gestionar personas (administración, gerencia o recepción).
3. Abrir la vista para comprobar el destino, descargar PNG o PDF A4, o imprimir el QR
   y entregarlo al propietario. El enlace también se puede seleccionar y copiar.

Es un QR por cliente: el de su ficha y el de cualquiera de sus vehículos es el
mismo. Si tiene varios vehículos, puede elegirlos en la vista pública. El enlace
no cambia al crear otra orden; muestra la orden abierta o, si no hay, la más
reciente. Sin orden muestra el vehículo y un mensaje, sin inventar una estación.
Las órdenes entregadas o anuladas se distinguen de las abiertas.

## Vista del cliente

`/seguimiento#ENLACE_ALEATORIO` abre el mapa sin una cuenta del taller. Solo permite
consultar: no mueve vehículos, edita órdenes ni entra al tablero. La consulta se
actualiza cada 30 segundos y al volver a la pestaña; el cliente puede actualizar
manualmente. La fecha del último cambio y la última consulta quedan visibles.
Si falla la red se indica que la información puede estar desactualizada.

El enlace concede lectura a quien lo tenga: entregarlo solo al cliente.
**Renovar QR** invalida el anterior y exige entregar el nuevo QR. No existe
búsqueda pública por placa, cédula o correo. No se muestran contactos, documentos,
fotos, notas, diagnósticos, presupuestos, técnicos ni información de otros clientes.
Los registros en Borradores quedan fuera de la consulta.

## Despliegue y persistencia

La tabla `client_tracking` se crea automáticamente al arrancar la API. El cambio
es aditivo y los QR se generan al solicitarlos por primera vez. Conservar la base
y respaldar esta tabla junto con el resto para mantener los QR emitidos. No cambia
credenciales ni requiere borrar volúmenes. Actualizar API y frontend juntos.

Usar la misma dirección pública para el QR de registro y el de seguimiento.
Cambiar IP, puerto o dominio requiere volver a distribuir los QR con el destino
correcto. La accesibilidad desde teléfonos y HTTPS dependen del despliegue real.

## API

- `POST /api/clients/:id/tracking`, sesión y permiso `people`, cuerpo `{}`:
  devuelve el enlace estable y el origen público configurado. `{ "rotate": true }`
  lo renueva e invalida el anterior. Devuelve `Cache-Control: no-store`.
- `GET /api/public/tracking`, sin sesión, cabecera `X-Tracking-Token` con el
  valor del fragmento: devuelve exclusivamente los vehículos del propietario y
  el estado de su orden actual. Token inválido, renovado o cliente en Borradores:
  404. No permite modificaciones. Respuestas sin caché y límite de consultas.

El token no se incluye en la ruta HTTP ni en eventos de auditoría. La tabla interna
lo conserva para poder mostrar otra vez el mismo QR; no debe exponerse mediante
listados públicos ni registrarse en logs.

## Validación

`npm run test:flow` comprueba autorización interna, enlace estable concurrente,
aislamiento entre clientes, lista explícita de campos públicos, seis estaciones,
entrega, anulación, nueva visita con el mismo QR, renovación, Borradores y respaldo.

## PNG y PDF para entregar al cliente

Ambas descargas incluyen el logo, QR, instrucciones, beneficios y condiciones de
uso. Se generan localmente en el navegador, sin enviar el enlace a un generador
externo. PNG: 2480 x 3508 píxeles. PDF: una página A4, con el QR como enlace
clicable. La impresión usa el mismo diseño y contenido. El PDF contiene una
imagen de alta resolución; su texto no es seleccionable.

Las condiciones son instrucciones de uso de la consulta, no una aceptación
contractual ni una autorización para realizar trabajos. También se pueden leer
en la vista pública. El contenido se mantiene en tracking-export.js.
