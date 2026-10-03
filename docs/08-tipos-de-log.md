# Tipos de log

Qué mensajes entiende el sistema, cómo los interpreta, y cómo agregar uno nuevo. Para programadores, y para quien quiere saber qué esperar de cada tipo.

Los ejemplos son reales (de un router ER7206 y un controlador Omada) con las direcciones sustituidas.

## Cómo se reconoce un mensaje

`wire.js` prueba, en este orden:

1. **Cabecera:** quita `<PRI>` y, si la hay, la cabecera RFC 3164 (`Oct  2 14:51:44 host`) o RFC 5424 (`1 2026-10-02T14:51:44Z host app - - -`). Si no hay cabecera, sigue igual.
2. **Controlador con JSON** (`fecha hora SITIO - - - {json}`): auditoría de cambios.
3. **Controlador con texto** (`fecha hora SITIO - - - [gateway:NOMBRE:MAC]: texto`, el prefijo es opcional): alertas reenviadas.
4. **Router** (`modulo<n>: mensaje`): el módulo y la severidad vienen **dentro** del mensaje. Se busca por el patrón, sin importar qué cabecera tenga delante. El router envía una cabecera sin nombre de equipo (`Oct  3 11:59:20 ER7206: 2026-…`): la etiqueta `ER7206:` se usa como nombre del equipo, **sin** los dos puntos.
5. **Nada de lo anterior:** tipo desconocido → [cuarentena](#tipos-desconocidos-y-aprobación).

**Severidad:** la del `<n>` del módulo (router); si no la hay, la de la cabecera `PRI & 7`; si tampoco, ninguna (se muestra como *Info*). Los incidentes de internet o VPN caída suben a *Error* (3) y el DHCP intruso a *Aviso* (4).

## Catálogo

### `dhcp_server` — Red / Seguridad

| Mensaje | Resumen | Incidente |
|---|---|---|
| `[OMADA]DHCP Server allocated IP address 172.17.17.209 for the [client:ec:b1:d7:4f:9c:2a].` | El servidor DHCP asignó 172.17.17.209 al equipo ec:b1:d7:4f:9c:2a | — |
| `[OMADA]6C:4C:BC:D6:88:9355 A suspicious Rogue DHCP server (ip:172.17.17.54, mac:6C:4C:BC:D6:88:93) is detected in Network LAN.` | Servidor DHCP intruso detectado en Network LAN: 172.17.17.54 (6c:4c:…) | `rogue_dhcp`, clave = IP del intruso. Se cierra solo a los **90 min** sin repetirse |

Campos: `ip`, `mac` (y `network` en el intruso). Las MAC se guardan en minúsculas. Además, la MAC alimenta el inventario de equipos (`client_devices`).

### `ip_conflict` — Red

| Mensaje | Resumen | Incidente |
|---|---|---|
| `[OMADA]10.10.0.3355 client[1a:9f:…] client[7a:3c:…]  used conflicted ip: 10.10.0.33.` | Dos equipos están usando la misma IP 10.10.0.33 | `ip_conflict`, clave = IP. Se cierra solo a los **15 min** sin repetirse |
| `[OMADA][MARK]10.10.0.3355[alertLogResolve] conflicted ip resolved: 10.10.0.33.` | Se resolvió el conflicto de la IP 10.10.0.33 | **No** cierra el incidente (alterna con los de conflicto) |

Campos: `ip`, `mac1`, `mac2`. La IP correcta es la del **final** del mensaje; la del principio viene pegada a un `55`.

### `firewall` — Firewall

```
[ACL]GATEWAY=78-20-51-74-B8-00,DESC=1571129632,ACTION=Allow,SRC_MAC=00:77:8d:0e:de:e8,DST_MAC=78:20:51:74:b8:00,SRC=172.17.17.52,DST=10.10.0.2,PROTO=UDP,Sport=49153,Dport=53
```

Resumen: `Permitido UDP de 172.17.17.52 a 10.10.0.2:53 (DNS)`. Es `Bloqueado` si la acción empieza con `deny`, `drop`, `block` o `reject`; si no es `allow` ni eso, se muestra la acción tal cual.

Campos: `action`, `src`, `dst`, `proto`, `sport`, `dport`, `srcMac`, `dstMac`, `rule` (= `DESC`, el número de la ACL), `gateway`. El `rule` se traduce al **nombre de la ACL** con `acl_names`. La MAC de origen alimenta el inventario de equipos.

Puertos con nombre: 21 FTP, 22 SSH, 23 Telnet, 25 SMTP, 53 DNS, 67 DHCP, 80 HTTP, 88 Kerberos, 110 POP3, 123 NTP, 135 RPC, 143 IMAP, 161 SNMP, 389 LDAP, 443 HTTPS, 445 SMB, 514 Syslog, 993 IMAPS, 1433 SQL Server, 3268 Catálogo global AD, 3306 MySQL, 3389 Escritorio remoto, 5060 SIP, 5432 PostgreSQL, 8080 HTTP alterno.

### `ipsec` — VPN

| Mensaje (resumido) | Resumen | Incidente |
|---|---|---|
| `WAN3: Lifetime of the SA created in phase 1 of IKE negotiation expired. (Peers=A<->B)` | Túnel IPsec en WAN3: se renovó la clave de seguridad (fase 1) | — (es normal) |
| `…IPsec failover from Primary IPsec X to Secondary IPsec Y.` | Failover de IPsec: pasó del túnel «X» al secundario «Y» | — |
| `[alertLogResolve]WAN3: Set up IPsec connection successfully. (Peers=A<->B)` | Túnel IPsec en WAN3 establecido con B | **Cierra** `ipsec_down` de esa WAN |
| `WAN3: Enable DPD successfully. (DPD-Interval=10, Peers=A<->B)` | Túnel IPsec en WAN3: detección de caída activada (cada 10 s) | — |
| `WAN2: DPD detection times out. IPsec connection was disconnected. (Peers=A<->B)` | Túnel IPsec en WAN2 caído: el otro extremo (B) no responde | **Abre** `ipsec_down`, clave = WAN |

Campos: `wan`, `phase`, `local`, `remote`, `intervalo`, `principal`, `secundario`.

### `online_dection` — Conectividad
(Así se escribe el módulo en Omada.)

| Mensaje | Resumen | Incidente |
|---|---|---|
| `[OMADA][MARK]WAN355: The online detection result of [WAN3] was offline.` | WAN3 sin conexión a internet | **Abre** `wan_offline`, clave = WAN |
| `[OMADA][MARK]WAN355[alertLogResolve]: The online detection result of [WAN3] was online.` | WAN3 volvió a tener conexión a internet | **Cierra** `wan_offline` |

`WAN/LAN3` se normaliza a `WAN3`.

### `omada_audit` — Configuración (controlador)

```
2026-10-02 20:08:37 NOMBRE DEL SITIO - - - {"details":{"newValue":"{…}","oldValue":"{…}"},"operation":"Gateway ACL DMZ edited successfully in Network Security."}
```

Resumen: `Configuración: se editó Gateway ACL DMZ (Network Security)`. Verbos reconocidos: edited, added, deleted, created, updated, enabled, disabled, removed, renamed, modified (si no coincide, categoría *Controlador* y resumen `Controlador: …`).

Campos: `site`, `operation` y `cambio.<campo>` con `antes → después` solo de lo que cambió (hasta 8; `id` se ignora). Ejemplo: `cambio.syslog = false → true`.

Si es una ACL del gateway, el `entryId` y `name` del nuevo valor se guardan en `acl_names`: así el firewall puede mostrar el nombre de la regla.

### `alerta_controlador` — Conectividad / VPN (controlador)

Alertas que el controlador reenvía como texto, con o sin el prefijo `[gateway:NOMBRE:MAC]:`. Se interpretan igual que las del router (internet caída, IPsec, DHCP intruso) y abren o cierran los mismos incidentes. Campos extra: `site`, `equipo`, `mac-equipo`.

### `cliente_ip` — Conectividad (generado por el sistema)

Cuando un cliente envía desde una IP que nunca había usado, el sistema crea este evento (severidad *Aviso*): `Nueva IP de origen: X (antes enviaba desde Y, vista por última vez hace Z)`. Campos: `nueva`, `anterior`, `anterior-visto`. La primera IP de un cliente no cuenta como cambio.

## Incidentes

Un mensaje puede traer un descriptor `incident: { kind, key, action, autoCloseSecs? }`:

| `action` | Efecto |
|---|---|
| `open` | Abre el incidente `(cliente, kind, key)`. Si ya hay uno abierto, suma un aviso y renueva `last_seen` |
| `resolve` | Cierra el incidente abierto con `resolved_at` = hora de llegada |

Un cierre automático (`auto_close_secs`) lo hace una tarea cada 30 s: si `last_seen` es más viejo que ese tiempo, el incidente se marca resuelto con `resolved_at = last_seen` y `auto_closed = true`.

| Tipo (`kind`) | Se cierra con | Severidad mínima |
|---|---|---|
| `wan_offline` | `online_dection` "online" | Error (3) |
| `ipsec_down` | "Set up IPsec connection successfully" | Error (3) |
| `ip_conflict` | 15 min sin repetirse | — |
| `rogue_dhcp` | 90 min sin repetirse | Aviso (4) |

## Tipos desconocidos y aprobación

Lo que ningún intérprete reconoce (o un módulo conocido con un mensaje distinto al esperado) no se pierde ni se muestra: se guarda **oculto** (`pending = true`) y espera a un administrador.

**La firma** (`classify.js`) agrupa los mensajes parecidos. Del mensaje se quita lo que cambia de uno a otro:

| Se reemplaza | Por |
|---|---|
| Texto entre comillas | `"…"` |
| MAC | `<mac>` |
| IPv4 | `<ip>` |
| Cadenas hexadecimales de 24 o más caracteres | `<id>` |
| Correos | `<correo>` |
| Números | `#` |

Si queda con más de 7 palabras se conservan las 2 primeras y las 5 últimas (`primeras … últimas`); máximo 140 caracteres. La clave del tipo es `módulo:firma` en minúsculas (hasta 160 caracteres).

**La categoría sugerida** es la primera que coincida, en este orden: Configuración, VPN, Seguridad, Firewall, Conectividad, Red, Sistema; si ninguna, Otros.

**Estados:** `pending` (se guarda oculto) → `approved` (visible, con la categoría elegida) o `rejected` (los siguientes se descartan al llegar). Un cliente admite hasta **200 tipos pendientes**; los siguientes se agrupan como `módulo:varios`. Al aprobar, los eventos pendientes de ese tipo pasan a visibles; al rechazar, se borran.

## Agregar un tipo nuevo

Cuando un tipo llegue seguido a *Por aprobar* y quieras que se interprete mejor (resumen claro, campos, incidentes), agrégalo al catálogo.

1. **Consigue líneas reales.** Captura mensajes del equipo (`tcpdump`) o copia ejemplos de *Por aprobar → Ver ejemplos reales*.
2. **Escribe el intérprete** en `server/src/parser.js`: una función que reciba el texto del mensaje y devuelva `null` si no lo reconoce, o `{ category, summary, fields, incident? }`. Regístrala:
   - bajo el nombre del módulo en `MODULES` (mensajes del router), o
   - en `RELAY` (alertas del controlador en texto).
3. **Si abre o cierra un problema con duración,** agrega `incident: { kind, key, action: 'open' | 'resolve', autoCloseSecs? }`. Para que además suba de severidad, añade el `kind` a `INCIDENT_SEVERITY`. Registra su nombre legible en `INCIDENT_KINDS` (`client/src/data/catalog.js`) y `KIND_LABEL` (`server/src/alerts.js`): así aparece también en las reglas de alerta.
4. **Si es un JSON del controlador,** la lógica está en `parseAudit` de `wire.js`.
5. **Explícalo en la web** en `client/src/data/catalog.js`: `MODULE_INFO` (nombre, qué significa, qué hacer), `FILTER_MODULES` (para el filtro y las alertas) y `FIELD_LABELS` (nombre en español de cada campo).
6. **Pruébalo** pasando tus líneas reales por `parseWire` y comprobando que ya no salen como desconocidas, sin `undefined` en el resumen ni en los campos.

> **Los eventos ya guardados no se reinterpretan.** El resumen y los campos se calculan al recibir el mensaje. Lo anterior conserva el texto original en `raw`, así que se podría reprocesar con un script, pero no existe una herramienta para eso.
