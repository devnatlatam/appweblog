# Estado y pendientes

Qué está probado, qué no, qué límites tiene y qué falta. Escrito sin adornos: es lo que hay que saber antes de confiarle algo importante al sistema.

## Resumen

El sistema funciona **de punta a punta en desarrollo** (Windows 11, Node 24, PostgreSQL 17): recibe logs por puertos, los interpreta, detecta incidentes, transmite en vivo, aprueba tipos nuevos, borra por días y envía alertas por correo con un servidor SMTP de prueba. Lo que **nunca se ha ejecutado** es la instalación en el servidor real (Debian) y el contacto con un proveedor real de correo o con `ufw` real.

## Qué se probó

Durante el desarrollo se probó con scripts de prueba que **no se conservaron en el repositorio** (ver [pendientes](#pendientes)). Cada uno se ejecutó contra el servidor real y una base de datos real o desechable:

| Área | Qué se comprobó |
|---|---|
| **Intérprete** | 57.175 líneas reales de tres routers y un controlador: todas se interpretan, ninguna cae en "desconocido", sin `undefined` en resúmenes ni campos |
| **Recepción** | UDP y TCP (por línea y con longitud), IP permitidas, puerto ocupado, apagar y encender, varios clientes en paralelo sin mezclarse |
| **Tiempo real** | WebSocket: autenticación, token falso rechazado, filtros por palabra, IP y cliente; el lector no recibe el mensaje original; lo pendiente no se transmite |
| **Permisos** | Cada rol contra rutas de lectura y escritura; contraseña temporal bloquea la API; usuarios desactivados; niveles de usuario |
| **Tipos nuevos** | Agrupación por firma, aprobar, rechazar, reconsiderar; lo oculto no aparece en vistas, resumen ni vivo |
| **Incidentes** | Apertura y cierre con duración; un conflicto repetido es un solo incidente; cierre automático; alertas reenviadas por el controlador |
| **Cambio de IP, equipos y ACL** | Aviso de IP nueva (sin repetir al volver a una conocida), nombre de regla aprendido del controlador |
| **Agrupar repetidos** | 25 eventos iguales = una fila; abrir un grupo devuelve los eventos reales |
| **Almacenamiento** | Particiones por día, migración de una tabla anterior, borrado manual, retención por días, validaciones |
| **Alertas** | Los 7 tipos con datos de ejemplo; sin repetir; resuelto; tiempo mínimo; fallo y reintento; sin correo no evalúa; reglas por cliente |
| **Correo** | Envío con un servidor SMTP de prueba (autenticación PLAIN y LOGIN), contraseña errónea, puerto cerrado, cambio de configuración en caliente |
| **`.env`** | Contraseñas con comillas, espacios, `$` y `#` se leen idénticas; no se tocan otras claves; un valor inválido no daña el archivo |
| **Usuarios** | Crear y enviar acceso, correo caído, restablecer, eliminar, cambiar nombre y contraseña propios |
| **Primer usuario y recuperación** | `db:init` y `user:reset` en bases desechables |
| **Límite de intentos** | Por visitante detrás de un proxy |
| **Firewall (programa root)** | `deploy/test-fw-sync.sh` (**sí está en el repositorio**) con un `ufw` simulado: abrir, no repetir, cerrar, cambiar IP, puertos protegidos, entradas inválidas, fallos, archivo incompleto |
| **Firewall (lado web)** | Encender/apagar/crear/eliminar con el programa simulado: éxito, rechazo, sin respuesta, reversión |

## Qué NO está verificado

| Pendiente de verificar | Por qué importa |
|---|---|
| **Instalación en Debian** | Los pasos de `DESPLIEGUE.md` no se ejecutaron nunca de principio a fin, incluida la descarga del código con `git` (clave de despliegue, `git pull`) y la reinstalación de los archivos de `deploy/`. Pueden tener errores. |
| **PostgreSQL 15** | Debian 12 trae la 15; se probó con la 17. Debería funcionar. |
| **Correo con un proveedor real** | Gmail, Microsoft 365 u otros pueden tener requisitos propios (contraseñas de aplicación, bloqueo del puerto). |
| **`ufw` real** | Falta confirmar que `ufw` borra una regla creada con comentario usando solo su descripción. Si no, la web avisa "no se pudo cerrar en el firewall". |
| **nginx + WebSocket** | La configuración es estándar pero no se probó. |
| **Formato real de los mensajes en la red** | Se vieron los de archivos de rsyslog, no capturas de red. El intérprete es tolerante a las cabeceras habituales, pero conviene capturar con `tcpdump` al conectar el primer equipo. |
| **Interfaz en distintos navegadores y celulares** | Las pruebas automáticas cubrieron la API y que la web compile, no su aspecto ni su uso real. |
| **Carga alta** | Medido ~105.000 eventos/día en un sitio. No se probó con tráfico mucho mayor. |
| **Cambiar `APP_TIMEZONE` con datos** | Se espera un choque de particiones; no se probó. |
| **Último superadmin** | La protección existe en el código pero no se ejercitó para no arriesgar una cuenta real. |

## Límites conocidos

- **Pérdida de mensajes si el servidor está apagado.** UDP no confirma entrega; no hay copia en disco de lo que está en cola.
- **Un solo proceso.** No hay alta disponibilidad ni escalado horizontal.
- **Importar archivos viejos de rsyslog es limitado:** los eventos no se asignan a ningún cliente (no se ven en ninguna pantalla), las horas de los routers vienen corridas y los mensajes del controlador (JSON) no se importan.
- **Los eventos guardados no se reinterpretan** si mejoras un intérprete; solo vale para los que lleguen después.
- **Eliminar un cliente** deja sus eventos huérfanos (no se ven) hasta que el borrado por días los elimine.
- **No hay pantalla de auditoría.** Se consulta con SQL.
- **"Aceptar solo desde estas IP"** puede dejar sin logs a un router que cambia de IP.
- **El firewall registra "todo"** si así se configura en el equipo: es la mayor parte del espacio.
- **Cambiar la contraseña no cierra otras sesiones abiertas.**
- **Sin doble factor.**

## Pendientes

Ideas pedidas, discutidas o detectadas que no se hicieron:

| Idea | Nota |
|---|---|
| **Suite de pruebas automáticas en el repositorio** | Las pruebas se hicieron con scripts desechables. Convertirlas en una suite (`npm test`) es lo primero que habría que hacer para cambiar el código con seguridad. |
| **Guardar el firewall solo como resumen por minuto** | Ahorra ~84 % del espacio (medido: 54.731 eventos → 8.628 filas) pero pierde el detalle de cada paquete. Se pidió guardar todo, así que queda como opción. |
| **Pantalla de "crear primer administrador"** en la web | Hoy el primero se crea con `db:init`. Sería segura solo con un código de activación. |
| **Copia opcional en archivo de texto** de cada mensaje | Como respaldo adicional; implicaría rotar esos archivos. |
| **Pantalla de auditoría** | Los datos ya se registran. |
| **Importar historial de rsyslog a un cliente**, corrigiendo la hora | Hoy no es útil. |
| **Herramienta para reinterpretar eventos** guardados | El texto original se conserva. |
| **Cerrar sesiones al cambiar la contraseña** | Hoy solo se cortan desactivando la cuenta. |
| **Alojar las fuentes en el servidor** | Hoy se piden a Google Fonts. |
| **Más tipos de log** | Cada módulo nuevo que aparezca en *Por aprobar* es candidato a un intérprete propio ([cómo](08-tipos-de-log.md#agregar-un-tipo-nuevo)). |
| **Otros canales de aviso** (Telegram, etc.) | Hoy solo correo. |
| **Capturas de pantalla** en la guía de usuario | Esta documentación describe las pantallas con texto. |

## Decisiones tomadas durante el desarrollo

Para que quien llegue después sepa **por qué** es así:

| Decisión | Motivo |
|---|---|
| Un puerto por cliente | Lo pidió la especificación; además sobrevive a cambios de IP del router |
| Node escucha directo; rsyslog se retira | Permite apagar un cliente al instante y separar por puerto |
| Base de datos en el PC durante el desarrollo; PostgreSQL en el servidor en producción | Decisión del proyecto |
| Hora = la de llegada al servidor | La hora del router viene local y sin zona |
| Una tabla por día | Borrar un día es instantáneo y libera disco |
| Tipos desconocidos en cuarentena | Nada se pierde ni ensucia los registros |
| Correo configurado desde la web y guardado en el `.env` | Pedido explícito: gestión desde la web, única fuente de verdad |
| El firewall lo toca un programa aparte | No dar permisos de administrador a la web |
| El firewall se guarda completo | Pedido explícito; el agrupado es solo de visualización |
| El primer usuario, por terminal | Antes de que exista alguien no hay quién cree usuarios |
| Código en GitHub; el servidor lo trae con `git pull` | Actualizar y volver atrás es un comando, y se sabe qué versión corre ([Trabajo con git](14-trabajo-con-git.md)) |
