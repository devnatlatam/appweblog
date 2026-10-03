# Arquitectura

Cómo está construido Omada Logs y, sobre todo, **por qué**. Para quien va a mantener o ampliar el código.

## Vista general

Un solo proceso de Node.js hace casi todo: sirve la API, escucha los puertos de syslog, transmite en vivo por WebSocket y ejecuta las tareas periódicas. Un programa aparte, mínimo y con permisos de administrador, solo toca el firewall.

```
                       ┌──────────────────────── proceso Node.js (server/src) ───────────────────────┐
 Equipos  ─UDP/TCP───► │ collector.js ─► wire.js / parser.js ─► classify.js                            │
 Omada                 │      │             (interpretar)        (tipos desconocidos)                │
                       │      ▼                                                                      │
                       │  cola en memoria ──cada 300 ms──► PostgreSQL (events, particiones por día)  │
                       │      │                                  ▲                                   │
                       │      ├──► live.js ──WebSocket──► navegadores                                │
                       │      └──► insights.js ─► incidentes · IP de origen · equipos · nombres ACL  │
                       │                                                                             │
 Navegador ──HTTP────► │ events/ports/types/storage/incidents/alerts/settings-api.js + index.js       │
                       │                                                                             │
                       │ alerts.js (cada 30 s) ──► mailer.js ──► SMTP                                 │
                       │ retention.js (cada 10 min) ──► borra días enteros                           │
                       │ firewall.js ──escribe lista──► /var/lib/syslogweb/firewall.desired          │
                       └──────────────────────────────────────────────────────────────────────────────┘
                                                                          │ (systemd path)
                                                       deploy/syslogweb-fw-sync (root) ──► ufw
```

## El recorrido de un mensaje

1. **Llega** por el socket del cliente (`collector.js`). UDP: un datagrama es un mensaje (máx. 64 KB). TCP: mensajes separados por salto de línea o con longitud al inicio (RFC 6587), con un tope de 1 MB por conexión. Si el cliente tiene IP permitidas, se descarta lo que venga de otras.
2. **Se interpreta** (`wire.js`, `parser.js`). Reconoce la cabecera RFC 3164/5424 (o ninguna), y luego la familia del mensaje: router (`modulo<n>:`), controlador con JSON, o alerta reenviada del controlador. Resultado: módulo, severidad, categoría, resumen en lenguaje claro, campos extraídos y, si abre o cierra un problema con duración, un descriptor de **incidente**.
3. **Se clasifica si es desconocido** (`classify.js`). Los mensajes que ningún intérprete reconoce reciben una *firma* (el mensaje sin números, IP ni MAC) y una categoría sugerida.
4. **Entra a una cola en memoria.** Cada 300 ms, o al juntar 500, se guarda un lote de hasta 2.000. La hora que se guarda (`ts`) es la **de llegada al servidor**.
5. **Se resuelve el tipo** de lo desconocido: ya conocido y *aprobado* → se guarda visible; *pendiente* → se guarda oculto (`pending`); *rechazado* → se descarta.
6. **Se guarda** en la tabla del día (se crea sola si no existe).
7. **Se transmite en vivo** a los navegadores conectados (solo lo no pendiente), ya con su `id`.
8. **Se analiza** (`insights.js`, siempre en orden de llegada y **después** de guardar): abre/cierra incidentes, detecta IP de origen nuevas, registra equipos de la red (por MAC) y aprende nombres de ACL. Un fallo aquí se registra pero **nunca duplica ni pierde** el lote ya guardado.
9. Las tareas periódicas leen lo guardado: **alertas** (cada 30 s), **cierre automático de incidentes** (cada 30 s) y **borrado por retención** (cada 10 min).

## Decisiones de diseño

### Un puerto por cliente
El puerto es el identificador. Así, un router que cambia de IP pública (enlace de respaldo, IP dinámica) sigue siendo el mismo cliente; y un cliente se enciende o apaga cerrando un socket, sin depender de reglas por IP. Se mantuvo opcional la lista de IP permitidas, pero con la advertencia de que puede dejar sin logs a un router que cambió de IP.

### Node escucha directo (sin archivos intermedios)
Se evaluó seguir leyendo los archivos de rsyslog. Se descartó: no permite apagar un cliente al instante, mezcla clientes (rsyslog separa por IP, no por puerto) y añade una pieza más que mantener. El importador de archivos se conserva solo para cargar historial. El costo: si Node está caído, los mensajes UDP se pierden (igual que pasaría con rsyslog detenido).

### La hora es la de llegada
Los routers Omada envían su hora **local sin zona** y rsyslog la etiqueta como UTC. Por eso `events.ts` es la hora de recepción en el servidor (`timestamptz`, exacta). La hora del equipo se conserva como texto en `device_ts` solo informativa.

### Una tabla por día (particionado)
`events` está particionada por rango de `ts`, una partición por día **en la zona `APP_TIMEZONE`** (`events_AAAAMMDD`). Razón: borrar un día es un `DROP TABLE` instantáneo que libera el disco de inmediato; un `DELETE` masivo no lo hace y deja la tabla inflada. Costos aceptados: la clave primaria es `(ts, id)` (debe incluir la columna de partición) y no hay unicidad de importación, por eso la importación de archivos es transaccional con su posición. Las particiones se crean bajo demanda (`ensurePartition`); no hay partición por defecto a propósito.

### Tipos desconocidos en cuarentena
En lugar de descartar o mezclar lo que no entiende, el sistema lo guarda **oculto** y pide aprobación. Así nada se pierde, el administrador decide, y un equipo que empieza a enviar basura no ensucia los registros. La firma agrupa los mensajes parecidos para que decidir sea una sola vez por tipo.

### Incidentes como entidad propia
Un conflicto de IP avisa cada minuto durante horas. Mostrarlo como 388 filas no responde "¿desde cuándo y cuánto duró?". Los incidentes (`incidents`) tienen inicio, fin y conteo. Los que se resuelven con un mensaje (internet, VPN) se cierran con él; los que solo se repiten (conflicto de IP, DHCP intruso) se **cierran solos** cuando dejan de repetirse. Los mensajes "resuelto" del conflicto de IP **no** lo cierran porque alternan con los de conflicto.

### Severidad elevada para lo que abre incidente
El router marca "internet caído" como aviso (5). Para que aparezca en "Necesita tu atención", una WAN o VPN caída sube a *error* (3) y un DHCP intruso a *aviso* (4). Está en `parser.js` (`INCIDENT_SEVERITY`).

### El firewall se toca con un programa aparte
La web escribe la lista de puertos que deben estar abiertos en un archivo; `syslogweb-fw-sync` (root, lanzado por systemd) la valida línea por línea y aplica `ufw`. Razón: dar a la web un `sudo` ilimitado o quitar el endurecimiento de su servicio sería peor que este desvío. El programa rechaza puertos delicados (22, 80, 443, 4000, 5432…), no repite el contenido de líneas inválidas y no aplica un archivo incompleto. Ver [Seguridad](10-seguridad.md#el-programa-del-firewall).

### La configuración del correo vive en el `.env`
Pedido explícito: se edita desde la web y se escribe en el archivo, de modo que sea la única fuente de verdad y se aplique al instante (también a `process.env`). `envfile.js` solo modifica las claves indicadas, conserva el resto, escribe a un temporal y renombra (si algo falla, el original queda intacto).

### Permisos siempre en el servidor
La web oculta lo que no corresponde, pero **quien manda es la API**: cada ruta declara su permiso y el middleware carga al usuario de la base en **cada petición** (si lo desactivan o le bajan el rol, rige de inmediato). El WebSocket revalida cada 30 s.

## Tareas periódicas

| Tarea | Frecuencia | Dónde |
|---|---|---|
| Guardar lote de eventos | 300 ms o 500 mensajes | `collector.js` |
| Cerrar incidentes que dejaron de repetirse | 30 s | `insights.js` / `collector.js` |
| Evaluar reglas de alerta | 30 s (pico: 5 min; bloqueos: 1 min) | `alerts.js` |
| Aplicar retención (días y % de disco) | 10 min y al guardar la configuración | `retention.js` |
| Revalidar sesiones del WebSocket | 30 s | `live.js` |
| Depurar historial de alertas | 1 h (borra > 90 días) | `alerts.js` |

## Límites del diseño

- **Cola en memoria de hasta 200.000 mensajes** si la base se atrasa; si Node se reinicia en ese lapso, se pierden. No hay un respaldo en disco.
- **Un solo proceso:** el colector, la API y las alertas comparten el mismo proceso y la misma base. Está dimensionado para decenas de miles de eventos por hora; no se probó con carga mayor.
- **Sin escalado horizontal:** el WebSocket y la cola viven en memoria del proceso.
- **Tamaño medido:** ~1.060 bytes por evento (tabla + índices) en PostgreSQL 17.

## Código del servidor (`server/src`)

| Archivo | Responsabilidad |
|---|---|
| `index.js` | Arranque, rutas de sesión y usuarios, montaje de las demás APIs |
| `collector.js` | Sockets UDP/TCP, cola, guardado por lotes, apertura y cierre de puertos |
| `wire.js` | Interpreta un mensaje tal como llega por la red |
| `parser.js` | Catálogo de módulos conocidos del router; también interpreta líneas de archivo de rsyslog |
| `classify.js` | Firma y categoría sugerida de lo desconocido |
| `insights.js` | Incidentes, IP de origen, equipos de la red, nombres de ACL |
| `live.js` | WebSocket: autenticación, filtros y transmisión |
| `alerts.js`, `alerts-api.js` | Motor y API de las reglas de alerta |
| `mailer.js`, `mail-templates.js`, `settings-api.js` | Correo: envío, plantillas y su configuración |
| `envfile.js` | Edición segura del `.env` |
| `retention.js`, `storage-api.js` | Borrado automático y manual de logs |
| `partitions.js` | Tabla de eventos particionada y su migración |
| `firewall.js`, `ports-api.js` | Puertos de los clientes y su apertura en el firewall |
| `types-api.js` | Aprobación de tipos nuevos |
| `incidents-api.js`, `events-api.js` | Consulta de incidentes, eventos, resumen y exportación |
| `middleware.js`, `permissions.js` | Sesión y matriz de permisos |
| `schema.sql`, `seed.js`, `user-reset.js` | Tablas, primer usuario y recuperación de acceso |
| `ingest.js` | Importador de archivos de rsyslog (legado) |

## Código de la web (`client/src`)

| Carpeta | Contenido |
|---|---|
| `pages/` | Una pantalla por archivo; `pages/admin/` para la administración |
| `components/` | `AppShell` (menú y barra), `EventDetail`, `Incidents`, `AccountDialog`, `ui` (piezas comunes) |
| `context/` | Sesión, tema, avisos emergentes y resumen general con actualización en vivo |
| `data/` | `catalog.js` (explicaciones de cada tipo de log), `roles.js`, `severity.js` |
| `api.js` | Cliente HTTP: añade la sesión y traduce los errores |

La web es React 17 con rutas de React Router 6. El menú se arma dinámicamente con un elemento por cliente. Las listas largas del vivo usan una ventana virtual propia (solo se dibujan las filas visibles) con un tope de 5.000 filas en pantalla.
