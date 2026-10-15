# Instrucciones del proyecto

- Mantener la interfaz y los datos existentes salvo cambios pedidos por el usuario.
- Cada cambio funcional, de seguridad, pruebas, configuración o documentación debe quedar descrito en `historial.md`, con fecha, motivo y validación real. No inventar pruebas ni despliegues.
- Ejecutar `npm run hooks:install` en cada clon: el hook agrega automáticamente al historial los archivos incluidos en cada commit. La explicación funcional se escribe además en el historial.
- No versionar `.env`, `.env.vps`, claves privadas, dumps, respaldos, cargas ni dependencias instaladas. Los archivos `.env.example` y `.env.vps.example` contienen solo plantillas.
- `compose.yaml` es el perfil predeterminado para paneles Git y publica solo HTTP_PORT (18090 por defecto). `compose.vps.yaml` es el perfil autónomo para scripts con .env.vps. No combinar los archivos, ocupar 80/443 ni modificar proyectos vecinos. Mantener el nombre del proyecto y sus volúmenes al actualizar.
- Antes de afirmar que un despliegue está listo: comprobar sintaxis, tests, build de ambas imágenes y flujo HTTP/PostgreSQL aislado. El VPS requiere además acceso real, comprobación de puerto y recursos; un build local no equivale a desplegar.
- Para correcciones de despliegue, primero corregir y verificar en local, documentar en `historial.md` y publicar el commit; después actualizar solo el proyecto del taller.
