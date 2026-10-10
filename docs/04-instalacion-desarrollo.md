# Instalación para desarrollo

Cómo levantar Omada Logs en tu equipo para probarlo o programar. Para instalarlo en un servidor, ve a [DESPLIEGUE.md](../DESPLIEGUE.md).

## Requisitos

| | Versión | Notas |
|---|---|---|
| Node.js | 20 o superior | Probado con 24. Mínimo técnico 18.15 (se usa `fs.statfs`). |
| PostgreSQL | 15 o superior | Probado con 17. Necesita particionado por rango (11+). |
| Navegador | Reciente | Chrome, Edge, Firefox |

Sistema operativo: desarrollado y probado en **Windows 11**. En Linux debería funcionar igual (el servidor de producción es Debian), con la salvedad de que no se ha probado ahí todavía ([Estado y pendientes](12-estado-y-pendientes.md)).

## 0. Obtener el código

El proyecto está en https://github.com/devnatlatam/weblog.

```bash
git clone https://github.com/devnatlatam/weblog.git
cd weblog
```

Si vas a hacer cambios, lee antes [Trabajo con git](14-trabajo-con-git.md): qué se sube, qué no, y cómo pasar un cambio al servidor.

## 1. Base de datos

Crea una base vacía (por ejemplo `db_syslog`) y un usuario con permiso sobre ella. Con `psql`:

```sql
CREATE DATABASE db_syslog;
-- opcional: un usuario propio en lugar de postgres
CREATE ROLE syslogweb LOGIN PASSWORD 'una-clave';
ALTER DATABASE db_syslog OWNER TO syslogweb;
```

No hace falta crear tablas a mano: las crea `npm run db:init`.

## 2. Servidor

```bash
cd server
cp .env.example .env
```

Edita `.env`. Lo mínimo:

```ini
DB_HOST=localhost
DB_PORT=5432
DB_NAME=db_syslog
DB_USER=postgres
DB_PASSWORD='tu-clave'
JWT_SECRET=<genera uno>
PORT=4000
```

Genera el secreto de sesión con:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> Si la contraseña de la base tiene `$`, `#` o espacios, ponla entre comillas simples en el `.env`.

Luego:

```bash
npm install
npm run db:init -- --email tu@correo.com --name "Tu Nombre"
```

`db:init` crea las tablas, prepara la tabla de eventos particionada por día e **imprime una contraseña temporal una sola vez**. Es seguro repetirlo: solo crea un usuario si no existe ninguno.

Arranca el servidor:

```bash
npm run dev      # reinicia solo al cambiar un archivo
# o
npm start
```

Debe decir `API escuchando en http://localhost:4000`.

## 3. Web

En otra terminal:

```bash
cd client
npm install
npm run dev
```

Abre http://localhost:5173. Vite reenvía `/api` y `/ws` al servidor en el puerto 4000 (ver `client/vite.config.js`).

Entra con el correo que usaste en `db:init` y la contraseña temporal.

## 4. Probar con datos

Crea un cliente en la web (*Clientes → Gestionar clientes → Nuevo cliente*), por ejemplo en el puerto `5514` UDP, déjalo encendido y envía una línea de prueba:

```powershell
$u = New-Object System.Net.Sockets.UdpClient
$b = [Text.Encoding]::UTF8.GetBytes('<13>Oct  2 20:40:00 prueba ER7206: 2026-10-02 20:40:00 dhcp_server<5>: [OMADA]DHCP Server allocated IP address 172.17.17.50 for the [client:aa:bb:cc:dd:ee:ff].')
$u.Send($b, $b.Length, '127.0.0.1', 5514)
```

Debe aparecer en la pestaña **En vivo** del cliente. En Windows, el primer uso puede pedir permiso en el firewall para que Node reciba por UDP; para pruebas desde la misma máquina no hace falta.

### Importar archivos de rsyslog (opcional)

Solo sirve para cargar historial viejo; no es el camino normal de recepción.

```bash
LOGS_DIR=./logs npm run ingest -- --once    # lee lo pendiente y termina
npm run ingest                              # queda vigilando la carpeta
```

Espera `LOGS_DIR/<ip>/<equipo>/<módulo>.log` (la estructura de rsyslog). Limitaciones: los eventos importados **no se asignan a ningún cliente** (no se ven en ninguna pantalla) y las horas de los routers vienen corridas. Detalle en [Estado y pendientes](12-estado-y-pendientes.md).

## Scripts

### Servidor (`server/`)

| Comando | Qué hace |
|---|---|
| `npm start` | Arranca la API y el colector de puertos |
| `npm run dev` | Igual, pero reinicia al cambiar archivos |
| `npm run db:init` | Crea o actualiza tablas; crea el primer administrador si no hay usuarios |
| `npm run user:reset -- --email x@y.com` | Restablece la contraseña de un usuario (recuperar el acceso) |
| `npm run ingest` | Importa archivos de rsyslog |

### Web (`client/`)

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (puerto 5173) |
| `npm run build` | Genera `client/dist` para producción |
| `npm run preview` | Sirve `dist` para revisarlo |

## Variables de entorno

Todas viven en `server/.env`. Las marcadas con 🌐 también se editan desde la web.

| Variable | Para qué | Por defecto |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Conexión a PostgreSQL | — |
| `JWT_SECRET` | Firma de sesiones. Obligatorio, distinto en cada instalación | — |
| `PORT` | Puerto de la API | `4000` |
| `HOST` | Dirección donde escucha la API. En producción `127.0.0.1` | todas las interfaces |
| `APP_TIMEZONE` | Zona horaria que define dónde empieza cada día (borrado por días) | la del sistema |
| `DISK_PATH` | Disco que se vigila para el borrado por porcentaje, si PostgreSQL no permite consultarlo | carpeta de datos de PostgreSQL |
| `FIREWALL_DRIVER` | `ufw` para que la web abra y cierre puertos en el firewall; `none` para hacerlo a mano | `none` |
| `FIREWALL_DIR` | Carpeta compartida con el programa del firewall | `/var/lib/syslogweb` |
| `FIREWALL_TIMEOUT_MS` | Cuánto espera la respuesta del firewall | `15000` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_FROM_NAME` 🌐 | Correo de salida | — |
| `APP_URL` 🌐 | Dirección de la web, para los enlaces de los correos | — |
| `LOGS_DIR`, `INGEST_POLL_MS` | Solo para `npm run ingest` | `./logs`, `3000` |
| `SEED_EMAIL`, `SEED_NAME`, `SEED_PASSWORD` | Alternativa a los argumentos de `db:init` | — |
| `ENV_FILE` | Ruta del `.env` que edita la web (pruebas) | `server/.env` |

El archivo `.env` está en `.gitignore`: **nunca se sube al repositorio** (tiene claves). Lo que sí está versionado es `server/.env.example`, la plantilla sin secretos; si agregas una variable nueva, agrégala ahí también.

## Problemas comunes

| Síntoma | Causa y solución |
|---|---|
| `EADDRINUSE ... :4000` al arrancar | Ya hay otro servidor en el 4000 (a veces uno anterior que quedó abierto). Ciérralo o cambia `PORT`. |
| `la autentificación password falló` | `DB_USER` o `DB_PASSWORD` incorrectos. Revisa las comillas si la clave tiene símbolos. |
| `no existe la base de datos` | Revisa `DB_NAME` (a veces difiere en una letra, ej. `bd_` y `db_`). |
| La web carga pero no inicia sesión | La API no está encendida, o el proxy de Vite apunta a otro puerto. |
| "No hay ningún usuario todavía" en `db:init` | Es una base nueva: agrega `-- --email ... --name ...`. |
| En vivo dice "Reconectando…" | El WebSocket no conecta: ¿la API está encendida? En producción, ¿nginx pasa `/ws`? |
