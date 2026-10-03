# Seguridad

Qué protege el sistema, cómo, y qué riesgos quedan. Para quien instala, administra o audita Omada Logs.

## Roles y permisos

Cuatro niveles; cada uno incluye todo lo del anterior (salvo lo indicado).

| Permiso | Lector | Operador | Administrador | Superadmin |
|---|:-:|:-:|:-:|:-:|
| `dashboard.view` — resumen e incidentes | ✔ | ✔ | ✔ | ✔ |
| `logs.view` — registros y vivo | ✔ | ✔ | ✔ | ✔ |
| `ports.view` — ver clientes y puertos | ✔ | ✔ | ✔ | ✔ |
| `logs.raw` — ver el mensaje original | — | ✔ | ✔ | ✔ |
| `logs.ack` — marcar como revisado | — | ✔ | ✔ | ✔ |
| `logs.export` — exportar CSV | — | ✔ | ✔ | ✔ |
| `ports.toggle` — encender y apagar puertos | — | ✔ | ✔ | ✔ |
| `alerts.view` — ver reglas e historial | — | ✔ | ✔ | ✔ |
| `ports.manage` — crear, editar, eliminar clientes | — | — | ✔ | ✔ |
| `alerts.manage` — crear, editar, apagar reglas | — | — | ✔ | ✔ |
| `storage.manage` — retención y borrado | — | — | ✔ | ✔ |
| `types.review` — aprobar tipos de log nuevos y cambiar la severidad de cada tipo | — | — | ✔ | ✔ |
| `settings.manage` — correo | — | — | ✔ | ✔ |
| `users.manage` — usuarios | — | — | ✔ | ✔ |
| `roles.manage` — ver la pantalla de roles | — | — | — | ✔ |

**Reglas sobre usuarios:** solo se gestiona a quien tenga un nivel igual o menor; nunca a uno mismo; no se asigna un nivel superior al propio; no se elimina al último superadmin activo.

La matriz vive en dos lugares que **deben coincidir**: `server/src/permissions.js` (la que manda) y `client/src/data/roles.js` (solo decide qué se muestra).

## Autenticación y sesiones

- **Contraseñas:** bcrypt con costo 12. Mínimo 10 caracteres al cambiarla. Las temporales (12 caracteres aleatorios) obligan a elegir una propia.
- **Sesión:** JWT firmado con `JWT_SECRET`, duración **8 horas**, guardado en el navegador (`localStorage`).
- **Cada petición** carga al usuario desde la base de datos. Si lo desactivan, lo eliminan o le cambian el rol, **rige de inmediato**, sin esperar a que venza su sesión.
- **Contraseña temporal pendiente:** el servidor bloquea toda la API (salvo ver su perfil y cambiar la clave) hasta que la cambie. No es solo la pantalla.
- **Límite de intentos:** 8 intentos fallidos por IP en 10 minutos → `429`. Detrás de nginx se usa la IP real del visitante (`X-Forwarded-For`, solo cuando la petición viene de la propia máquina); si no, el límite sería compartido por todos.
- **Mensajes de error genéricos** en el inicio de sesión: no distinguen entre usuario inexistente y contraseña incorrecta.
- **WebSocket:** el token va en el primer mensaje, **no en la URL**; se cierra si no se autentica en 10 s y se revalida el usuario cada 30 s.

## Lo que se protege en el servidor

| Medida | Dónde |
|---|---|
| Cada ruta declara su permiso | `middleware.js`, cada `*-api.js` |
| Consultas parametrizadas (`$1…`); los pocos valores interpolados son enteros validados | todo el código |
| Validación de entradas: puertos, IP, correos, rangos de reglas, días (`AAAA-MM-DD`) | cada API |
| El mensaje original (`raw`/`message`) solo se envía a quien tiene `logs.raw` | `shape.js`, `events-api.js`, `live.js` |
| Los tipos nuevos sin aprobar no se muestran ni se transmiten | `events-api.js`, `collector.js` |
| Tamaño máximo por mensaje (64 KB) y por conexión TCP (1 MB); cola máxima de 200.000 | `collector.js` |
| Puertos reservados no asignables a clientes | `ports-api.js` |
| Auditoría de acciones de administración | tabla `audit_log` |
| El CSV neutraliza celdas que empiezan con `= + - @` (inyección de fórmulas en Excel) | `events-api.js` |
| El HTML de los correos escapa todo texto que viene de los logs | `mail-templates.js` |
| La contraseña de correo no se devuelve nunca por la API | `settings-api.js` |

## El programa del firewall

La web **no** ejecuta comandos de firewall ni tiene permisos de administrador. Para abrir y cerrar puertos al encender o apagar un cliente:

1. La web escribe la lista de puertos que deben estar abiertos en `/var/lib/syslogweb/firewall.desired` (con un identificador único).
2. systemd (`syslogweb-fw.path`) lanza `syslogweb-fw-sync`, que corre como **root**, lee el archivo y **valida cada línea** antes de tocar `ufw`.
3. Deja el resultado en `firewall.status`; la web espera hasta 15 s ese identificador.

Garantías de `syslogweb-fw-sync` (verificadas con un `ufw` simulado en `deploy/test-fw-sync.sh`):

- Se **niega** a abrir puertos delicados aunque se lo pidan: 22, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 3306, 4000, 5173, 5432, 6379 y 8080.
- Valida protocolo (`udp`/`tcp`), puerto (1–65535) y cada IP; máximo 300 entradas.
- Los errores indican el **número de línea**, nunca repiten su contenido (no filtra datos si el archivo fuera un enlace a otro archivo).
- Ignora enlaces simbólicos y **no aplica un archivo incompleto** (no cierra puertos por una escritura a medias).
- Solo gestiona las reglas que él mismo creó (las recuerda en `/var/lib/syslogweb-fw`); no toca las demás.
- Su salida de estado se escribe con un archivo temporal y renombrado, sin seguir enlaces.

**Lo que no impide:** si alguien tomara control de la web, podría pedir abrir cualquier puerto *no protegido* a cualquier IP. Por eso la lista de protegidos incluye lo crítico.

## Riesgos conocidos

| Riesgo | Detalle | Qué hacer |
|---|---|---|
| **Logs falsos por UDP** | Quien pueda enviar paquetes a un puerto abierto puede inyectar eventos. UDP no autentica. | Limitar por IP en el firewall o en "Aceptar solo desde estas IP". **Ojo:** un router que cambia de IP pública queda bloqueado; ver [conectar equipos](03-conectar-equipos-omada.md#cosas-que-conviene-saber). Los tipos nuevos van a cuarentena. |
| **Contenido de los logs no es de fiar** | Lo envían equipos externos. | Ya se escapa en HTML y CSV. Trátalo como entrada no confiable en cualquier integración nueva. |
| **Contraseña SMTP en texto plano** | Está en `.env`, igual que la de la base de datos. | Permisos 600 y propietario `syslogweb`. La web nunca la muestra. |
| **El token vive en `localStorage`** | Un fallo de XSS podría leerlo. | React escapa el contenido; no se cargan scripts de terceros. Mantén HTTPS. |
| **Cambiar la contraseña no cierra otras sesiones** | Un token ya emitido vale hasta 8 horas, salvo que desactives o elimines al usuario. | Para cortar un acceso de inmediato, desactiva la cuenta. Rotar `JWT_SECRET` cierra **todas** las sesiones. |
| **Límite de intentos en memoria** | Se reinicia con el servidor y es por IP, no por cuenta. | Suficiente contra adivinación simple; no sustituye a un WAF. |
| **Sin doble factor (2FA)** | Solo contraseña. | Usa contraseñas largas únicas. |
| **Contraseñas temporales por correo** | Viajan en texto en el mensaje. | Son de un solo uso: obligan a cambiarlas al entrar. |
| **Fuentes desde Google** | `index.html` carga la tipografía IBM Plex desde Google Fonts. | En redes cerradas o por privacidad, aloja las fuentes en el propio servidor. |
| **Auditoría sin pantalla ni protección** | Se consulta con SQL; quien tenga acceso a la base puede alterarla. | Restringe el acceso a PostgreSQL. |
| **CORS fijo a `localhost:5173`** | Pensado para desarrollo. | En producción la web y la API comparten origen (nginx), no aplica. |
| **Sin pruebas de seguridad externas** | No se hizo pentest ni análisis de dependencias. | Haz `npm audit` y una revisión antes de exponerlo a internet. |

## Lista de comprobación antes de abrirlo a internet

- [ ] `JWT_SECRET` nuevo y distinto al de desarrollo.
- [ ] HTTPS activo (nginx + certbot).
- [ ] Solo abiertos: SSH, 80, 443 y los puertos de syslog de clientes encendidos.
- [ ] Nunca abiertos hacia fuera: 4000 (API) y 5432 (PostgreSQL). `HOST=127.0.0.1`.
- [ ] `.env` con permisos 600 y propietario del servicio.
- [ ] El primer administrador cambió su contraseña temporal.
- [ ] Cada usuario con el nivel mínimo que necesita.
- [ ] `npm audit` revisado en `server/` y `client/`.
- [ ] Respaldo diario de la base funcionando.
