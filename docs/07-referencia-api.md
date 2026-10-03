# Referencia de la API

Todas las rutas cuelgan de `/api` y devuelven **JSON**. La web es su único cliente oficial. Para quien quiera integrar o automatizar.

## Convenciones

- **Autenticación:** `Authorization: Bearer <token>`. El token se obtiene en `POST /api/auth/login` y dura **8 horas**.
- **Permisos:** cada ruta indica el permiso que exige (ver [la matriz](10-seguridad.md#roles-y-permisos)). Sin sesión → `401`; con sesión pero sin permiso → `403`.
- **Errores:** siempre `{ "error": "texto en español, pensado para mostrarse al usuario" }` con el código HTTP que corresponda: `400` datos inválidos, `401` sin sesión o vencida, `403` sin permiso, `404` no existe, `409` conflicto (duplicado, puerto ocupado), `429` demasiados intentos, `500` error interno.
- **Contraseña temporal pendiente:** mientras `mustChangePassword` sea `true`, **todas** las rutas devuelven `403` salvo `GET /auth/me` y `POST /auth/change-password`.
- **Fechas:** ISO 8601 en UTC.
- **Severidad:** número `level` (0–7) y texto `severity`: `critical` (0–2), `error` (3), `warning` (4), `info` (5–7 o nulo).

## Sesión

### `POST /api/auth/login`
Cuerpo: `{ "email", "password" }` → `{ "token", "user" }`.
`401` credenciales incorrectas · `403` cuenta desactivada · `429` tras 8 intentos fallidos desde una misma IP en 10 minutos.

Objeto `user`: `{ id, name, email, role, status, mustChangePassword, lastLoginAt }`.

### `GET /api/auth/me` → `{ user }`
### `PATCH /api/auth/me` → `{ user }`
Cuerpo: `{ "name" }` (hasta 80 caracteres).
### `POST /api/auth/change-password` → `{ user }`
Cuerpo: `{ "current", "next" }`. `next`: mínimo 10 caracteres y distinta de la actual.

## Usuarios · `users.manage`

Solo se gestiona a quien tenga un nivel **igual o menor** y nunca a uno mismo; no se asigna un nivel superior al propio.

| Ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /users` | — | `{ users[], mailConfigured }` |
| `POST /users` | `{ name, email, role, sendEmail? }` | `201 { user, tempPassword, email: { sent, error? } }` |
| `PATCH /users/:id` | `{ name?, email?, role?, status? }` (`status`: `active`/`disabled`) | `{ user }` |
| `POST /users/:id/reset-password` | `{ sendEmail? }` | `{ user, tempPassword, email }` |
| `DELETE /users/:id` | — | `{ ok }` · `409` si es el último superadmin activo |

`tempPassword` solo se devuelve en esta respuesta. Si `sendEmail` es verdadero y el envío falla, el usuario **se crea igual** y `email.error` dice por qué.

## Clientes y puertos

Objeto `port`: `{ id, clientName, port, protocol, isActive, allowedIps[], lastSeen, createdAt, listening, error, events24h, openIncidents, sourceIps[{ip,firstSeen,lastSeen}] }`.

| Ruta | Permiso | Cuerpo | Respuesta |
|---|---|---|---|
| `GET /ports` | `ports.view` | — | `{ ports[], firewallManaged }` |
| `POST /ports` | `ports.manage` | `{ clientName, port, protocol, allowedIps?, activate? }` | `201 { port, warning }` |
| `PATCH /ports/:id` | `ports.manage` | `{ clientName?, port?, protocol?, allowedIps? }` | `{ port }` |
| `POST /ports/:id/toggle` | `ports.toggle` | `{ active: true \| false }` | `{ port, warning }` |
| `DELETE /ports/:id` | `ports.manage` | — | `{ ok, warning }` |

- `activate: true` enciende al crear. Si no se puede, el cliente se crea **apagado** y `warning` explica el motivo.
- `port` y `protocol` solo se cambian con el puerto apagado (`409` si no).
- `allowedIps`: lista o texto separado por comas/espacios; vacío = cualquiera.
- `toggle` a `true`: `409` si el puerto está ocupado, sin permiso o el firewall falla (queda apagado). A `false` siempre apaga; `warning` avisa si el firewall no pudo cerrarse.
- `409` por duplicado `(port, protocol)`. Puertos reservados: la API, 5173, 5432.

## Eventos

### `GET /events` · `logs.view`

| Parámetro | Descripción |
|---|---|
| `client` | Id de cliente |
| `hours` | Últimas N horas (1–8760, por defecto 24) |
| `since`, `until` | Rango exacto (ISO). Reemplaza a `hours` |
| `sev` | Lista separada por comas: `critical,error,warning,info` |
| `module` | Tipo exacto (ej. `firewall`) |
| `ip` | IP de origen (contiene) |
| `ack` | `0` = solo sin revisar |
| `q` | Texto (hasta 100 caracteres) en resumen, mensaje, equipo e IP |
| `limit` | 1–200 (por defecto 40) |
| `after` | Solo eventos con `id` mayor (para pedir lo nuevo) |
| `beforeTs` + `beforeId` | Paginación: pide los anteriores a ese evento |
| `group` | `60`, `300`, `900` o `3600` (segundos): agrupa repetidos. Admite `offset` |

Los eventos de tipos **pendientes de aprobación no se devuelven**.

Respuesta normal: `{ events[], hasMore, total? }`. `total` solo en la primera página y con tope de 10.001.

Objeto `event`: `{ id, ts, sourceIp, host, clientId, clientName, port, module, level, severity, category, summary, fields, acknowledged, aclName, message?, raw? }`. `message` y `raw` **solo si el rol tiene `logs.raw`**.

Respuesta agrupada: `{ grouped: true, seconds, hasMore, total?, groups[{ bucket, until, lastTs, clientId, clientName, module, summary, level, severity, category, count, acknowledged }] }`. Para ver los eventos de un grupo, pide `/events` con `since=bucket`, `until=until`, `q=summary`.

### `POST /events/ack` · `logs.ack`
Cuerpo: `{ "ids": [..] }` (hasta 5.000) **o** `{ "clientId", "module", "summary" }` (marca el grupo de las últimas 24 h). → `{ updated }`.

### `GET /events/export` · `logs.export`
Mismos filtros que `/events`. Devuelve un **CSV** (UTF-8 con BOM, hasta 50.000 filas). Las celdas que empiezan con `= + - @` se prefijan con `'` para que no se ejecuten como fórmulas.

## Resumen e incidentes · `dashboard.view`

### `GET /summary` (opcional `?client=ID`)
```json
{
  "totals": { "critical": 0, "error": 3, "warning": 12, "info": 4100 },
  "total": 4115,
  "byCategory": [{ "category": "Firewall", "n": 3900 }],
  "hourly": [{ "hour": "2026-10-02T14:00:00.000Z", "critical": 0, "error": 0, "warning": 1, "info": 160, "total": 161 }],
  "attention": [{ "clientId": 3, "clientName": "Oficina", "module": "ip_conflict", "summary": "...", "severity": "warning", "count": 388, "firstTs": "...", "lastTs": "..." }],
  "pending": 1,
  "incidents": { "open": 2, "list": [ /* incidentes abiertos, los 6 más graves */ ] },
  "sources": { "total": 3, "withSignal": 3 }
}
```
Cubre las últimas 24 horas. `attention` agrupa errores y avisos sin revisar (máx. 8). `sources` cuenta puertos encendidos y cuántos recibieron algo en los últimos 15 minutos.

### `GET /incidents`
Parámetros: `client`, `status` (`open`/`resolved`), `limit` (1–200). → `{ incidents[], counts: { open, resolved } }`.
Incidente: `{ id, clientId, clientName, kind, key, title, level, severity, status, openedAt, lastSeen, resolvedAt, durationSecs, eventCount, autoClosed }`.

## Tipos por aprobar · `types.review`

| Ruta | Respuesta |
|---|---|
| `GET /types/summary` | `{ pending }` |
| `GET /types?status=pending\|approved\|rejected` | `{ types[], counts, categories[] }` |
| `GET /types/:id/samples` | `{ samples[] }` (últimos 5 mensajes reales) |
| `POST /types/:id/approve` — `{ category, label? }` | `{ ok, shown }` (cuántos mensajes pasaron a verse) |
| `POST /types/:id/reject` | `{ ok, removed }` (cuántos se borraron) |
| `POST /types/:id/reopen` | `{ ok }` |

Categorías válidas: Red, Firewall, Seguridad, Conectividad, Configuración, VPN, Sistema, Controlador, Otros.

## Almacenamiento · `storage.manage`

| Ruta | Descripción |
|---|---|
| `GET /storage` | `{ timezone, today, disk{ path, totalBytes, usedBytes, percent }, dbBytes, settings{ retentionDays, diskMaxPercent }, days[{ day, bytes, rows }] }` |
| `PUT /storage/settings` | `{ retentionDays: 1–3650 \| null, diskMaxPercent: 50–95 \| null }`. Se aplica al instante. → `{ settings, dropped[] }` |
| `DELETE /storage/days/:day` | `day` = `AAAA-MM-DD`. Borra todos los logs de ese día. → `{ ok, day }` |

## Correo · `settings.manage`

| Ruta | Descripción |
|---|---|
| `GET /settings/smtp` | `{ smtp: { host, port, security, user, hasPassword, fromName, from, configured, appUrl } }`. Nunca devuelve la contraseña |
| `PUT /settings/smtp` | Mismos campos más `password` (vacío = conservar la actual). Escribe el `.env` y aplica al instante |
| `POST /settings/smtp/test` | `{ to, ...campos del formulario }`. Envía una prueba **sin guardar**. `429` si se repite en menos de 3 s |

`security`: `starttls`, `ssl` o `none`.

## Alertas

| Ruta | Permiso | Descripción |
|---|---|---|
| `GET /alerts` | `alerts.view` | `{ rules[], smtpConfigured }` |
| `GET /alerts/history?limit=` | `alerts.view` | `{ history[] }` (hasta 200) |
| `POST /alerts` | `alerts.manage` | Crea una regla → `201 { rule }` |
| `PATCH /alerts/:id` | `alerts.manage` | Cambia una regla (también `enabled`) |
| `DELETE /alerts/:id` | `alerts.manage` | Elimina |
| `POST /alerts/:id/test` | `alerts.manage` | Envía un correo de prueba a sus destinatarios |

Cuerpo de una regla: `{ name, kind, clientId?, params, recipients, cooldownMin, notifyResolved, enabled }`. Tipos y parámetros: [Alertas y correo](09-alertas-y-correo.md#los-7-tipos-de-regla).

## WebSocket · `/ws`

Para el vivo. Requiere el permiso `logs.view`.

**Protocolo** (mensajes JSON):

| Sentido | Mensaje | Descripción |
|---|---|---|
| Cliente → servidor | `{ "type": "auth", "token", "filter" }` | Debe enviarse en los primeros **10 s**. Si no, se cierra (código `4001`) |
| Cliente → servidor | `{ "type": "filter", "filter" }` | Cambia el filtro |
| Servidor → cliente | `{ "type": "ready" }` | Autenticado |
| Servidor → cliente | `{ "type": "filter-ok" }` | Filtro aplicado |
| Servidor → cliente | `{ "type": "events", "events": [..], "skipped": 0 }` | Eventos nuevos que coinciden |
| Servidor → cliente | `{ "type": "error", "error" }` | Sesión no válida; se cierra (código `4003`) |

`filter`: `{ "ip": "texto", "client": id, "port": número, "q": "palabra" }`, todo opcional.

Detalles:
- Cada mensaje trae **hasta 300 eventos**; si llegaron más, `skipped` dice cuántos no se enviaron (siguen en la base).
- Los eventos tienen la misma forma que en `/events`; `message` y `raw` solo para quien tenga `logs.raw`.
- Los tipos pendientes de aprobación **no se transmiten**.
- Se envía un `ping` cada 30 s; las conexiones que no responden se cierran. En ese mismo ciclo se revalida el usuario (si lo desactivan o pierde el permiso, se cierra con `4003`).
- El token va en el mensaje, **no en la URL**, para que no quede en registros de acceso.
