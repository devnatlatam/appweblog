# Modelo de datos

Las tablas de PostgreSQL y para qué sirve cada una. La definición está en `server/src/schema.sql` (todo menos `events`) y `server/src/partitions.js` (`events`). `npm run db:init` las crea y es seguro repetirlo: solo agrega lo que falte.

## Mapa

```
users ──┬─< clients_ports ──┬─< log_types          (tipos de log nuevos y su decisión)
        │        │          ├─< incidents          (problemas con inicio y fin)
        │        │          ├─< client_ips         (IP desde las que envió)
        │        │          ├─< client_devices     (equipos vistos en su red, por MAC)
        │        │          ├─< alert_rules >─< alert_state   (reglas de alerta)
        │        │          └── events (client_id, sin llave foránea) ─ particiones events_AAAAMMDD
        │        └ alert_history   (correos enviados)
        └ audit_log
settings · acl_names · ingest_state
```

Las flechas `<` indican "uno a muchos" con borrado en cascada: al eliminar un cliente se eliminan sus incidentes, IP, equipos, tipos de log y reglas de alerta propias. Los **eventos no se borran** con el cliente (ver [`events`](#events)).

## `events`

Cada mensaje de syslog recibido. **Particionada por día** (`PARTITION BY RANGE (ts)`), con una tabla hija `events_AAAAMMDD` por día en la zona `APP_TIMEZONE`.

| Columna | Tipo | Qué es |
|---|---|---|
| `id` | bigserial | Identificador (la secuencia es única aunque la clave primaria incluya `ts`) |
| `ts` | timestamptz | Cuándo **el servidor recibió** el mensaje. Es la hora que manda |
| `device_ts` | timestamp | La hora que escribe el equipo, sin zona, solo informativa |
| `source_ip` | text | IP que envió el mensaje |
| `host` | text | Nombre del equipo que declara el mensaje (ej. `ER7206`) |
| `client_id` | integer | Cliente (puerto) por el que llegó. `NULL` en eventos importados de archivos |
| `port` | integer | Puerto de escucha por el que entró |
| `module` | text | Tipo: `dhcp_server`, `ip_conflict`, `firewall`, `ipsec`, `online_dection`, `alerta_controlador`, `omada_audit`, `cliente_ip`, `otros`… |
| `severity` | smallint | Nivel syslog 0–7 (0 = el más grave). Puede ser `NULL` |
| `category` | text | Red, Firewall, Seguridad, Conectividad, Configuración, VPN, Sistema, Controlador, Otros |
| `summary` | text | Frase en lenguaje claro |
| `fields` | jsonb | Datos extraídos (IP, MAC, puertos, regla, cambios…) |
| `message` | text | El mensaje, sin cabecera |
| `raw` | text | La línea completa original |
| `acknowledged` | boolean | Marcado como revisado |
| `type_key` | text | Firma del tipo (el módulo, o la firma de un tipo nuevo) |
| `pending` | boolean | `true` = tipo nuevo sin aprobar: se guarda pero no se muestra |

- **Clave primaria:** `(ts, id)` (debe incluir la columna de partición).
- **Índices** (se crean en cada partición): `id`; `(source_ip, ts DESC)`; `(client_id, ts DESC)`; `module`; parcial `(ts DESC) WHERE severity <= 4 AND NOT acknowledged` (para "Necesita atención"); parcial `(client_id, type_key) WHERE pending`.
- **Severidad en la web:** 0–2 → *Crítico*, 3 → *Error*, 4 → *Aviso*, 5–7 o `NULL` → *Info*.
- **Eliminar un cliente no borra sus eventos:** quedan con un `client_id` que ya no existe y no se muestran en ninguna pantalla. El borrado por días los elimina.
- **Tamaño medido:** ~1.060 bytes por evento (tabla + índices).

## `users`

| Columna | Qué es |
|---|---|
| `id`, `name`, `email` | Datos de la persona. El correo es único sin importar mayúsculas |
| `password_hash` | bcrypt (costo 12) |
| `role` | `superadmin`, `admin`, `operador`, `lector` |
| `status` | `active`, `disabled` (`invited` existe en el esquema pero ya no se usa) |
| `must_change_password` | `true` mientras use una contraseña temporal; bloquea toda la API salvo cambiarla |
| `last_login_at`, `created_at` | Fechas |

## `clients_ports`

Un cliente = un puerto.

| Columna | Qué es |
|---|---|
| `id`, `client_name` | Identificador y nombre |
| `port_number`, `protocol` | Puerto (1–65535) y `udp`/`tcp`. Único el par |
| `is_active` | Encendido: el puerto está (o debe estar) abierto |
| `allowed_ips` | Lista opcional de IP permitidas; vacía = cualquiera |
| `created_by`, `created_at` | Quién y cuándo |
| `last_seen` | Último mensaje recibido (se actualiza por lote) |
| `activated_at` | Cuándo se encendió por última vez |

## `log_types`

Los tipos de log que el sistema no reconocía y la decisión del administrador.

| Columna | Qué es |
|---|---|
| `client_id`, `type_key` | A qué cliente y firma pertenece. Único el par |
| `label` | Nombre del tipo (editable al aprobar) |
| `suggested_category`, `category` | Categoría sugerida y la elegida |
| `status` | `pending`, `approved`, `rejected` |
| `event_count`, `sample` | Cuántos mensajes y un ejemplo |
| `first_seen`, `last_seen`, `decided_by`, `decided_at` | Fechas y quién decidió |

## `incidents`

| Columna | Qué es |
|---|---|
| `client_id`, `kind`, `key` | Qué y a quién afecta. `kind`: `wan_offline`, `ipsec_down`, `ip_conflict`, `rogue_dhcp`. `key`: `WAN3`, `10.10.0.33`… |
| `title`, `severity` | Texto al abrir y severidad más grave vista |
| `status` | `open` o `resolved` |
| `opened_at`, `last_seen`, `resolved_at` | Tiempos. Duración = `resolved_at − opened_at` |
| `event_count` | Cuántos avisos reunió |
| `auto_close_secs`, `auto_closed` | Si se cierra solo tras ese tiempo sin repetirse, y si así fue |

Solo puede haber **un incidente abierto** por `(client_id, kind, key)` (índice único parcial).

## `client_ips`, `client_devices`, `acl_names`

| Tabla | Para qué |
|---|---|
| `client_ips (client_id, ip, first_seen, last_seen)` | IP desde las que ha enviado cada cliente. Una IP nueva genera el evento "Nueva IP de origen" |
| `client_devices (client_id, mac, ip, first_seen, last_seen)` | Equipos de la red del cliente, por MAC (del DHCP y del firewall). Alimenta la alerta "equipo nuevo" |
| `acl_names (entry_id, name)` | Número de regla del firewall → nombre, aprendido de las ediciones de ACL del controlador |

## `alert_rules`, `alert_state`, `alert_history`

| Tabla | Para qué |
|---|---|
| `alert_rules` | Las reglas: `name`, `kind`, `client_id` (`NULL` = todos), `params` (jsonb), `recipients[]`, `cooldown_min`, `notify_resolved`, `enabled`, `cursor_id` (hasta qué evento ya revisó), `last_fired` |
| `alert_state (rule_id, key, active, failed, last_sent)` | Qué avisos están activos en cada regla, para no repetirlos |
| `alert_history` | Cada correo enviado o fallido: regla, cliente, asunto, tipo (`alert`/`resolved`/`test`), estado, error, destinatarios. Se depura a los 90 días |

## `settings`, `audit_log`, `ingest_state`

| Tabla | Para qué |
|---|---|
| `settings (key, value jsonb)` | Ajustes. Hoy solo `retention`: `{"retentionDays": 30, "diskMaxPercent": 80}` (cada uno puede ser `null`) |
| `audit_log (ts, user_id, action, detail jsonb)` | Registro de acciones (abajo) |
| `ingest_state (source_file, byte_offset)` | Hasta dónde se leyó cada archivo en `npm run ingest` |

### Acciones que se auditan

| `action` | Cuándo |
|---|---|
| `port.create`, `port.update`, `port.on`, `port.off`, `port.delete` | Cambios en clientes y puertos |
| `type.approve`, `type.reject`, `type.reopen` | Decisiones sobre tipos nuevos |
| `storage.settings`, `storage.delete-day`, `storage.purge` | Retención, borrado manual de un día, borrado automático |
| `settings.smtp`, `settings.smtp-test` | Cambios y pruebas del correo |
| `user.create`, `user.update`, `user.delete`, `user.reset-password`, `user.reset-cli` | Gestión de usuarios (`reset-cli` = desde la terminal) |
| `alert.create`, `alert.update`, `alert.delete` | Reglas de alerta |

## Consultas útiles

```sql
-- Las últimas 30 acciones de administración, con el nombre de quien las hizo
SELECT a.ts, u.email, a.action, a.detail
FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
ORDER BY a.ts DESC LIMIT 30;

-- Cuánto ocupa cada día de logs y cuántos eventos tiene (aprox.)
SELECT c.relname AS tabla, pg_size_pretty(pg_total_relation_size(c.oid)) AS tamano, s.n_live_tup AS eventos
FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
JOIN pg_class p ON p.oid = i.inhparent AND p.relname = 'events'
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
ORDER BY c.relname DESC;

-- Incidentes abiertos ahora
SELECT c.client_name, i.kind, i.key, i.title, now() - i.opened_at AS lleva
FROM incidents i JOIN clients_ports c ON c.id = i.client_id
WHERE i.status = 'open' ORDER BY i.opened_at;

-- Eventos por cliente en las últimas 24 horas
SELECT c.client_name, count(*) FROM events e JOIN clients_ports c ON c.id = e.client_id
WHERE e.ts > now() - interval '24 hours' AND NOT e.pending GROUP BY 1 ORDER BY 2 DESC;
```

> No borres filas de `events` con `DELETE` para liberar espacio: no devuelve el espacio al disco. Usa *Almacenamiento → borrar un día* (elimina la partición entera).
