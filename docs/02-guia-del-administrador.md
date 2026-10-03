# Guía del administrador

Para quien configura y mantiene Omada Logs: crea clientes, administra usuarios, configura el correo y las alertas, y decide cuánto tiempo se guardan los logs. Requiere el rol **Administrador** o **Superadmin**.

Todo esto se hace **desde la web**. Lo único que se hace en la terminal es crear el primer usuario y, si fuera necesario, recuperar el acceso ([Operación](11-operacion.md#recuperar-el-acceso)).

## Puesta en marcha: orden recomendado

1. **Primer administrador** (una sola vez, en la terminal): `npm run db:init -- --email tu@correo.com --name "Tu Nombre"`. Anota la contraseña temporal.
2. **Entrar y crear tu contraseña.**
3. **Correo** (*Administración → Correo*): configúralo y envía una prueba. Sin esto, las alertas no salen.
4. **Clientes y puertos:** crea un cliente por cada sitio o equipo. → [Sección 1](#1-clientes-y-puertos)
5. **Conectar el equipo** para que envíe a ese puerto. → [Conectar equipos](03-conectar-equipos-omada.md)
6. **Por aprobar:** revisa los tipos de log nuevos que vayan llegando. → [Sección 2](#2-por-aprobar)
7. **Alertas:** crea las reglas. → [Sección 4](#4-alertas)
8. **Almacenamiento:** define cuánto tiempo guardar. → [Sección 5](#5-almacenamiento-y-borrado)
9. **Usuarios:** invita al resto del equipo. → [Sección 6](#6-usuarios)

## 1. Clientes y puertos

*Menú → Clientes → Gestionar clientes.* (También desde *Todos los clientes*, con los botones *Gestionar clientes* y *Nuevo cliente*. Esa pantalla es la vista general: una tarjeta por cliente con su estado y sus últimas 24 horas; aquí se administra.)

### Crear un cliente

*Nuevo cliente* y completa:

| Campo | Qué poner |
|---|---|
| **Nombre del cliente** | Cómo lo reconocerá el equipo (hasta 80 caracteres). Ej.: "Oficina Central". |
| **Puerto** | Un número de 1 a 65535. **Cada cliente necesita el suyo**: el puerto es lo que lo identifica. |
| **Protocolo** | UDP (lo más común en syslog) o TCP. |
| **Aceptar solo desde estas IP** (opcional) | Si lo llenas, el servidor descarta lo que llegue de otras IP. **Léelo antes de usarlo**, abajo. |
| **Encender ahora** | Abre el puerto al crear. Si lo desmarcas, el cliente se crea apagado. |

Reglas del puerto:
- Un mismo número puede usarse una vez en UDP y otra en TCP (son clientes distintos).
- No se pueden usar el 4000 (la API), el 5173 (la web en desarrollo) ni el 5432 (PostgreSQL).
- Los puertos **menores a 1024** (como el 514) requieren permisos especiales en Linux; el servicio de systemd ya los trae.
- Si el puerto está ocupado por otro programa, el cliente se crea **apagado** y te dice el motivo.

> **Sobre "Aceptar solo desde estas IP".** Úsalo con cuidado. Un router puede **cambiar de IP pública**, por ejemplo al pasar a un enlace de respaldo como Starlink. Si limitas por IP, **sus logs quedan bloqueados justo cuando falla el enlace principal**, que es cuando más los necesitas. El sistema avisa con un evento "Nueva IP de origen" cuando esto pasa. Si dudas, déjalo vacío.

### Encender y apagar

Con el interruptor del cliente (lo pueden usar administradores y **operadores**).

- **Encender:** el puerto empieza a recibir. Si el firewall automático está activo, también se abre en `ufw`. Si algo falla (puerto ocupado, firewall que no responde), el cliente queda **apagado** y se explica por qué.
- **Apagar:** el puerto se cierra al instante y **no se guarda nada nuevo** de ese cliente. Lo ya guardado no se toca. Los equipos siguen enviando, pero nadie escucha, así que **esos mensajes se pierden** mientras esté apagado.
- Al reiniciar el servidor, los puertos que estaban encendidos se vuelven a abrir solos.

### Editar y eliminar

- Puedes cambiar el nombre y las IP permitidas en cualquier momento. **El número de puerto y el protocolo solo se cambian con el puerto apagado.**
- **Eliminar un cliente** cierra su puerto y borra también sus incidentes, reglas de alerta, equipos y tipos de log aprobados o pendientes. Los **eventos ya guardados no se borran**, pero como ya no pertenecen a ningún cliente **dejan de verse en la web**; desaparecen con el borrado por días.

### Firewall: automático o manual

La pantalla indica cuál de los dos modos tienes:

- **Automático** (`FIREWALL_DRIVER=ufw`): encender abre el puerto en el firewall del servidor y apagar lo cierra. Configuración en [DESPLIEGUE.md](../DESPLIEGUE.md#10-firewall).
- **Manual:** la aplicación abre el puerto en sí misma, pero **tú** debes abrirlo en el firewall: `sudo ufw allow from <IP del equipo> to any port <PUERTO> proto udp`.

## 2. Por aprobar

*Menú → Por aprobar* (con un contador de lo pendiente).

Cuando llega un tipo de mensaje que el sistema **no reconoce**, no lo descarta ni lo mezcla: lo **agrupa** con los parecidos (por ejemplo, dos mensajes de túnel VPN con IP distintas cuentan como uno), le **sugiere una categoría** y espera tu decisión. Mientras tanto, esos mensajes **se guardan pero no aparecen** en registros, resumen, vivo ni alertas.

Cada tarjeta muestra el cliente, cuántos mensajes llevan y ejemplos reales (*Ver ejemplos reales*). Puedes:

- **Aprobar:** eliges el nombre y la categoría. Sus mensajes pasan a verse y los siguientes entran directo.
- **Rechazar:** se **borran** los mensajes pendientes de ese tipo y los siguientes se **descartan** al llegar.
- **Volver a revisar** (desde *Aprobados* o *Rechazados*): lo regresa a pendiente.

Si un cliente acumula más de 200 tipos pendientes, los nuevos se agrupan en uno solo ("Otros mensajes de …") para no abrumarte.

### Cambiar la severidad de un tipo de log

*Menú → Severidad*, o el botón **Cambiar severidad** en el detalle de cualquier evento.

Cada tipo de log trae una severidad por defecto (por ejemplo, el *cambio de IP de origen* se guarda como Aviso). Si en tu red eso es normal —o quieres que algo sea más grave—, crea una **regla**:

| Campo | Qué significa |
|---|---|
| **Tipo de log** | A qué tipo de aviso aplica (Firewall, Cambio de IP de origen, Conflicto de IP…). |
| **Cliente** | Todos, o solo uno. |
| **Solo si el mensaje contiene** | Opcional. Por ejemplo `Bloqueado` para afectar solo los bloqueos del firewall. |
| **Severidad nueva** | Crítico, Error, Aviso o Info. |
| **Cambiar también los eventos ya guardados** | Marcado por defecto. Cambiar lo guardado no se puede deshacer, pero puedes crear otra regla con la severidad que quieras. |

- La regla se aplica a todo lo que **llegue desde ese momento**, así que también cambia lo que ven el resumen y los registros.
- Si varias reglas coinciden, **gana la más específica**: la de un cliente concreto, y luego la que tiene texto. Al cambiar lo ya guardado, una regla general no pisa lo que decide una más específica.
- Eliminar una regla hace que los eventos **nuevos** vuelvan a su severidad original; los ya guardados conservan la que tienen.
- Los incidentes (internet caído, túnel caído…) siguen su propia severidad. La regla cambia la de los avisos individuales.

## 3. Correo

*Menú → Administración → Correo.*

Rellena el **servidor SMTP**, el **puerto**, la **seguridad**, el **usuario** y la **contraseña**, el **correo remitente** y, opcionalmente, la **dirección de la web** (se usa para los enlaces en los correos).

| Seguridad | Puerto habitual | Cuándo |
|---|---|---|
| STARTTLS | 587 | Lo más común |
| SSL/TLS | 465 | Servidores que cifran desde el inicio |
| Ninguna | 25 | Solo servidores internos de confianza |

- Hay atajos para **Gmail** y **Microsoft 365**. Gmail exige una *contraseña de aplicación*; Microsoft 365 puede requerir que se habilite el envío SMTP para esa cuenta.
- **Enviar correo de prueba:** usa los datos del formulario, estén guardados o no. Los errores se explican en claro.
- **Guardar:** los datos se escriben en el archivo `.env` del servidor y **se aplican al instante, sin reiniciar**. Si los cambias después, el archivo se actualiza.
- La contraseña **nunca se vuelve a mostrar**. Si dejas el campo vacío al guardar, se conserva la que estaba.
- Sin usuario, no se guarda contraseña (servidores internos sin autenticación).

## 4. Alertas

*Menú → Alertas.* Una regla dice **qué vigilar, de qué cliente y a quién avisar**.

### Crear una regla

*Nueva regla* y:

1. **Nombre** (ej.: "Internet caído en la sede").
2. **Avisar cuando…** elige uno de los 7 tipos (abajo).
3. Ajusta sus parámetros.
4. **De qué cliente:** uno en particular o todos.
5. **Correos** que reciben el aviso (hasta 20).
6. **Tiempo mínimo entre dos avisos iguales** (evita llenar la bandeja si el problema sigue).
7. **Avisar también cuando termine** (en los tipos que tienen fin).

Cada regla tiene un botón de **prueba** (envía un correo de ejemplo a sus destinatarios), un interruptor para apagarla y la pestaña **Avisos enviados** guarda el historial durante 90 días, con los fallos y su motivo.

### Los 7 tipos

| Tipo | Avisa cuando… | Ideal para |
|---|---|---|
| **Un problema con duración** | Se abre un incidente: internet o VPN caída, conflicto de IP, DHCP intruso. Opcional: solo si dura más de N minutos. | Lo más importante. Evita avisos de cortes de segundos. |
| **Un cliente deja de enviar logs** | Un puerto encendido pasa N minutos sin recibir nada. | Detectar el router apagado o sin internet. |
| **Llega un evento importante** | Llega un evento de cierta severidad y/o tipo. | Cambios de configuración del controlador, cambio de IP de origen, errores. |
| **Muchos bloqueos del firewall** | Un mismo origen acumula N bloqueos en M minutos. | Escaneos o equipos infectados. |
| **Aparece un equipo nuevo** | Se ve una MAC que no se conocía. | Intrusos en la red. |
| **Pico de actividad** | Llegan X veces más logs de lo normal. | Ataques o equipos descontrolados. |
| **Resumen diario** | Una vez al día, desde la hora elegida. | Un vistazo cada mañana. |

### Un conjunto inicial recomendado

| Regla | Tipo | Parámetros | Aviso |
|---|---|---|---|
| Internet o VPN caída | Problema con duración: *Internet caído* + *Túnel VPN caído* | desde que empieza | también al terminar |
| Conflicto de IP persistente | Problema con duración: *Conflicto de IP* | si dura más de 15 min | — |
| DHCP intruso | Problema con duración: *Servidor DHCP intruso* | desde que empieza | — |
| Router sin señal | Cliente deja de enviar | 15 min | también al terminar |
| Cambios en el controlador | Evento importante: tipo *Cambio de configuración*, cualquier severidad | — | — |
| Cambio de IP de origen | Evento importante: tipo *Cambio de IP de origen* | — | — |
| Resumen de la mañana | Resumen diario | 08:00 | — |

Los detalles de cómo decide cada tipo están en [Alertas y correo](09-alertas-y-correo.md).

## 5. Almacenamiento y borrado

*Menú → Administración → Almacenamiento.*

Muestra el **uso del disco** donde vive PostgreSQL y cuánto ocupan los logs. Los logs se guardan en **una tabla por día**, así que borrar un día es instantáneo y libera el espacio de inmediato.

### Borrado automático

Dos reglas independientes (deja una vacía para no usarla):

- **Guardar los últimos N días** (1 a 3650). Cuentan hoy y los N−1 anteriores.
- **Borrar lo más antiguo si el disco supera X %** (50 a 95). Borra un día completo a la vez, del más antiguo, hasta bajar del límite.

En ambas, **nunca se borra el día de hoy**. Se aplican al guardar y luego cada 10 minutos.

> **Cuidado con el porcentaje de disco.** Si el disco ya está por encima del límite (por ejemplo, lleno de otras cosas), el sistema borrará todo el historial antiguo intentando bajar. Mira el uso actual antes de poner un límite.

### Borrado manual

La tabla de **Logs guardados por día** permite borrar un día completo, con confirmación. **No se puede deshacer.**

### Cuánto espacio necesitas

Con tráfico real medido: cada evento ocupa ~1.060 bytes en PostgreSQL (tabla + índices). Un sitio con firewall registrando todo generó ~105.000 eventos al día, es decir **~106 MB al día o ~3 GB al mes**. El firewall es ~96 % del volumen. Calcula con tus datos: *eventos por día × 1.060 bytes × días a guardar*.

## 6. Usuarios

*Menú → Administración → Usuarios.*

### Crear

*Nuevo usuario*: nombre, correo y **nivel de acceso**. Se genera una **contraseña temporal** y la persona **debe cambiarla** al entrar. Si el correo está configurado, marca *Enviar el acceso por correo* y le llegará con la dirección de la web. Si no, la contraseña se muestra una sola vez para que se la entregues tú.

### Acciones

| Acción | Efecto |
|---|---|
| Editar | Cambia nombre, correo o nivel. |
| Generar contraseña nueva | La actual deja de servir; se genera una temporal (con envío opcional por correo). |
| Desactivar / Reactivar | La persona no puede entrar mientras esté desactivada. Su sesión deja de valer en su siguiente acción. |
| Eliminar | Definitivo. |

### Reglas de niveles

- Solo gestionas a quien tenga un nivel **igual o menor** al tuyo, y **nunca a ti mismo**.
- No puedes asignar un nivel superior al tuyo.
- No se puede eliminar al **último superadmin activo**.

### Los niveles

| Nivel | Pensado para |
|---|---|
| **Lector** | Quien solo necesita mirar. |
| **Operador** | Quien atiende el día a día: revisa, marca, exporta y enciende o apaga puertos. |
| **Administrador** | Quien configura clientes, alertas, correo, almacenamiento y usuarios. |
| **Superadmin** | Todo lo anterior, más ver la pantalla de roles y permisos. |

La matriz completa está en [Seguridad](10-seguridad.md#roles-y-permisos).

## 7. Auditoría

El sistema registra en la base de datos (tabla `audit_log`) quién hizo qué: crear, cambiar, encender y apagar clientes; borrar días de logs; cambiar la configuración de almacenamiento o de correo; aprobar o rechazar tipos; crear, cambiar y eliminar usuarios y reglas de alerta. **Todavía no hay una pantalla para consultarla**; se lee con SQL ([Modelo de datos](06-modelo-de-datos.md#acciones-que-se-auditan)).

## Lista de comprobación al terminar

- [ ] Contraseña temporal cambiada.
- [ ] Correo configurado y prueba recibida.
- [ ] Cada cliente creado, encendido y recibiendo logs (punto verde).
- [ ] "Aceptar solo desde estas IP" revisado para los clientes que pueden cambiar de IP.
- [ ] Tipos nuevos de *Por aprobar* revisados.
- [ ] Reglas de alerta creadas y probadas con su botón de prueba.
- [ ] Almacenamiento: días a conservar definidos, y porcentaje de disco solo si el disco está holgado.
- [ ] Usuarios del equipo creados con el nivel mínimo que necesitan.
