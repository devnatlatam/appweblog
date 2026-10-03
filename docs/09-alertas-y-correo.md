# Alertas y correo

Cómo decide el sistema cuándo enviar un correo, qué contiene, y qué hace si algo falla. Las reglas se crean desde la web ([Guía del administrador](02-guia-del-administrador.md#4-alertas)); aquí está el detalle del comportamiento.

## Principios

- **Un aviso, una vez.** Cada aviso se manda una vez y no se repite hasta que pase el **tiempo mínimo entre avisos** de la regla, o hasta que el problema se resuelva y vuelva a ocurrir.
- **Sin correo configurado no se evalúa nada.** Así un aviso nunca se marca como enviado sin haberse enviado. Al configurar el correo, lo pendiente sale en la siguiente vuelta.
- **Una regla nueva no mira el pasado.** Las reglas por evento empiezan desde el último evento existente al crearlas.
- **Nada se pierde si el correo falla.** Se registra como fallido y se reintenta.

## El ciclo

Cada **30 segundos** el motor (`alerts.js`) lee las reglas activas y las evalúa una por una. Cada evaluación produce *candidatos* (un aviso posible, con una clave) y el motor decide para cada uno:

| Situación del candidato | Qué hace |
|---|---|
| Se cumple y nunca se avisó | Envía |
| Se cumple, ya se avisó y el tipo avisa **una sola vez** (`once`) | No repite |
| Se cumple, ya se avisó y pasó el tiempo mínimo entre avisos | Envía de nuevo (recordatorio) |
| Se cumple, ya se avisó y no ha pasado ese tiempo | Silencia |
| Se cumplió, se resolvió y vuelve a cumplirse | Envía de nuevo |
| Dejó de cumplirse y la regla tiene "avisar cuando termine" | Envía el aviso de **resuelto** |
| El último envío **falló** | Reintenta pasados 5 minutos. En las reglas por evento se da por perdido tras 1 hora; en las demás se sigue intentando cada 5 minutos mientras la condición continúe |

Salvaguardas: máximo **10 correos por regla en cada vuelta** (el resto sale en la siguiente); las consultas pesadas (pico de actividad cada 5 min, bloqueos del firewall cada 1 min) no corren cada 30 s.

## Los 7 tipos de regla

### 1. Un problema con duración (`incident`)
Avisa cuando se abre un [incidente](08-tipos-de-log.md#incidentes) de los tipos elegidos.

| Parámetro | Valores | Defecto |
|---|---|---|
| `kinds` | Uno o más de: `wan_offline`, `ipsec_down`, `ip_conflict`, `rogue_dhcp` | internet y VPN |
| `minMinutes` | 0–1440. El incidente debe llevar al menos ese tiempo abierto | 0 |

- **Una vez por incidente.** Con "avisar cuando termine", se envía otro correo al resolverse, con la duración.
- Mira los incidentes abiertos y los resueltos en los últimos 2 días.

### 2. Un cliente deja de enviar (`client_silent`)
Para clientes con el puerto **encendido**.

| Parámetro | Valores | Defecto |
|---|---|---|
| `minutes` | 2–1440 | 15 |

- La referencia es el más reciente entre *último log*, *cuándo se encendió* y *cuándo se creó*: **un puerto recién encendido no alerta** aunque su último log sea viejo.
- Mientras siga callado, **recuerda** cada tiempo mínimo entre avisos. Al volver, avisa si está activado "terminar".

### 3. Llega un evento importante (`events`)

| Parámetro | Valores | Defecto |
|---|---|---|
| `maxLevel` | 0–7 (menor = más grave). En la web: *Solo críticos* (2), *Errores y críticos* (3), *Avisos, errores y críticos* (4), *Cualquier evento* (7) | 4 |
| `modules` | Lista de tipos; vacía = todos | todos |

- Mira **solo eventos posteriores a la creación de la regla** y solo los visibles (no pendientes de aprobación). Un evento sin severidad se trata como *Info* (6).
- **Agrupa** por cliente + tipo + mensaje: 4 eventos iguales en una vuelta son **un** correo ("Cuántas veces: 4").
- El tiempo mínimo entre avisos silencia el mismo mensaje. Los eventos silenciados no se avisan después.
- Si un correo falla, la marca de lectura **no avanza**, así el aviso se reintenta en vez de perderse.
- Es el tipo para *cambios de configuración del controlador* (`omada_audit`) y *cambio de IP de origen* (`cliente_ip`).

### 4. Muchos bloqueos del firewall (`firewall_blocks`)

| Parámetro | Valores | Defecto |
|---|---|---|
| `count` | 1–100000 | 20 |
| `minutes` | 1–1440 | 5 |

Cuenta los eventos de firewall cuya acción **no** empieza con `allow`, agrupados por cliente y origen. Avisa si un origen suma `count` o más en `minutes`.

### 5. Equipo nuevo (`new_device`)
Sin parámetros. Avisa de una MAC que no se había visto en la red del cliente (viene del DHCP y de la MAC de origen del firewall).

- **Periodo de aprendizaje:** durante los **primeros 60 minutos** desde que el cliente vio su primer equipo, todo se considera conocido (si no, todos los equipos serían "nuevos" al empezar).
- Solo cuenta equipos vistos **después de crear la regla**.
- Una sola vez por equipo.

### 6. Pico de actividad (`spike`)

| Parámetro | Valores | Defecto |
|---|---|---|
| `windowMin` | 5–120 | 15 |
| `factor` | 1,5–100 | 3 |
| `minEvents` | 10–1.000.000 | 300 |

Compara los eventos de los últimos `windowMin` minutos con el promedio de ventanas iguales en las 24 horas anteriores. Avisa si hay al menos `minEvents` **y** `factor` veces el promedio. `minEvents` evita falsas alarmas cuando casi no hay actividad. Al volver a la normalidad, avisa si está activado "terminar".

### 7. Resumen diario (`daily_summary`)

| Parámetro | Valores | Defecto |
|---|---|---|
| `hour` | 0–23 | 8 |

Un correo por día, a partir de la hora indicada (en `APP_TIMEZONE`), con un renglón por cliente: eventos, errores, avisos, incidentes nuevos y abiertos de las últimas 24 horas.

## Parámetros comunes

| Parámetro | Valores |
|---|---|
| Cliente | Uno, o todos |
| Correos | 1 a 20, sin repetidos |
| Tiempo mínimo entre avisos | 1 minuto a 7 días (la web ofrece 15 min, 30 min, 1 h, 3 h, 6 h, 24 h) |
| Avisar cuando termine | Solo en: problema con duración, cliente sin señal, pico |

Si cambias lo que mide una regla (tipo, parámetros o cliente), se borra su memoria de avisos y se evalúa desde cero.

## El correo

- **Asunto:** `[Omada Logs] Cliente: Título`. Si es de resuelto: `[Omada Logs] Resuelto — Cliente: …`. Si es una prueba: `[Omada Logs] PRUEBA — …`.
- **Cuerpo:** título, cliente, tabla de datos (tipo, desde cuándo, cuánto lleva…) y un botón *Ver en Omada Logs* **si `APP_URL` está configurada**. Pie con el nombre de la regla. Versión en texto plano incluida.
- **Hora:** en la zona `APP_TIMEZONE`.
- Todo texto que viene de los logs se **escapa** en el HTML.

El historial (*Alertas → Avisos enviados*) guarda cada correo, enviado o fallido, con el error, durante 90 días.

## Configuración del correo (SMTP)

Se hace en *Administración → Correo* y se guarda en el `.env`:

| Clave | Contenido |
|---|---|
| `SMTP_HOST`, `SMTP_PORT` | Servidor y puerto |
| `SMTP_SECURITY` | `starttls` (587), `ssl` (465) o `none` (25) |
| `SMTP_USER`, `SMTP_PASSWORD` | Credenciales (opcionales) |
| `SMTP_FROM`, `SMTP_FROM_NAME` | Remitente |
| `APP_URL` | Dirección de la web para los enlaces |

- Los valores se leen **en cada envío**: un cambio guardado vale al instante, sin reiniciar.
- Los errores se traducen: usuario o contraseña rechazados, servidor no encontrado, conexión rechazada, sin respuesta, error de TLS (con la pista de qué puerto usa cada seguridad).
- Tiempos de espera: 10 s para conectar, 10 s para el saludo y 20 s por operación.
- **No se verificó con un proveedor real** (Gmail, Microsoft 365, etc.). Se probó con un servidor SMTP de pruebas con autenticación PLAIN y LOGIN. Usa el botón de prueba al configurarlo ([Estado y pendientes](12-estado-y-pendientes.md)).

## Correos de acceso a usuarios

Al crear un usuario o generarle una contraseña nueva, la web puede enviarle un correo con su acceso (correo, contraseña temporal y enlace). Usa el mismo SMTP. Si el envío falla, el usuario se crea igual y la web muestra la contraseña para entregarla a mano. La contraseña temporal obliga a elegir una propia en el primer ingreso.

## Agregar un tipo de regla nuevo

1. **Servidor:** agrega el tipo a la lista del `CHECK` de `alert_rules.kind` en `schema.sql` (y vuelve a ejecutar `db:init`), un validador en `PARAMS` de `alerts-api.js` y un evaluador en `EVAL` de `alerts.js` que devuelva `candidates` (`{ key, bad, once?, clientId, clientName, title, lines, link, resolvedTitle?, resolvedLines? }`) y, si procede, `sweep` y `after`.
2. **Web:** descríbelo en `KINDS`, `DEFAULTS` y `describe` de `client/src/pages/Alerts.jsx`, con su formulario de parámetros.
