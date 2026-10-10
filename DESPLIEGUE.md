# Instalar Syslog Web en el VPS (Debian)

> **¿Solo quieres instalarlo?** No necesitas esta guía: un único script hace todo lo de abajo. Mira [Instalación y actualización](docs/15-instalacion-y-actualizacion.md). Esta página es la **versión manual**: sirve para entender qué hace `deploy/install.sh` en cada paso, o para instalar sin el script. Si cambias un paso aquí, cambia también el script (y al revés).

> Parte de la documentación de Omada Logs: ver el [índice en README.md](README.md). Para mantener el servidor después: [Operación y mantenimiento](docs/11-operacion.md). Qué está probado y qué no: [Estado y pendientes](docs/12-estado-y-pendientes.md).

Esta guía instala la web, la API y el colector de puertos en un VPS Debian, y explica cómo pasar de rsyslog a recibir los logs directamente por puerto sin cortar el servicio.

**Qué queda instalado**

| Pieza | Dónde | Quién la ve |
|---|---|---|
| Web (archivos estáticos) | `/opt/syslogweb/client/dist` | Internet, por HTTPS (nginx) |
| API + colector de puertos (Node) | `/opt/syslogweb/server`, puerto interno 4000 | Solo nginx (`127.0.0.1`) |
| Puertos de recepción syslog | Los que crees en la web, por ejemplo 5514/udp | Solo las IP que permitas. La web los abre y cierra en el firewall al encender o apagar el cliente |
| Aplicador del firewall (`syslogweb-fw-sync`) | `/usr/local/sbin`, corre como root | Nadie: lo lanza systemd cuando la web cambia su lista |
| PostgreSQL | `localhost:5432` | Solo la propia máquina |

Nunca abras al exterior el puerto 4000 ni el 5432.

> No se probó todavía en Debian: lo construido y probado corre sobre Windows con PostgreSQL 17. En Debian 12 la versión de PostgreSQL es la 15; debería funcionar igual, pero confírmalo en el primer arranque (paso 6).

---

## 1. Requisitos

- Debian 12 con acceso `sudo`.
- Un dominio o subdominio apuntando a la IP del VPS (por ejemplo `logs.tu-dominio.com`), para tener HTTPS.
- Node.js 20 o 22. Debian trae una versión vieja, así que se instala desde NodeSource:

```bash
sudo apt update
sudo apt install -y curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs postgresql nginx certbot python3-certbot-nginx ufw git
node -v   # debe ser v20 o superior
```

## 2. Usuario del sistema

La aplicación no debe correr como root.

```bash
sudo adduser --system --group --home /opt/syslogweb syslogweb
```

## 3. Base de datos

Usa un usuario propio, no `postgres`.

```bash
sudo -u postgres psql
```
```sql
CREATE ROLE syslogweb LOGIN PASSWORD 'pon-una-clave-larga-aqui';
CREATE DATABASE db_syslog OWNER syslogweb;
\q
```

Comprueba que el usuario puede conectarse por red local, tal como lo hará la aplicación (te pedirá la clave; debe responder `1`):

```bash
sudo systemctl enable --now postgresql
psql -h localhost -U syslogweb -d db_syslog -tAc 'SELECT 1'
```

Si falla por autenticación, revisa `/etc/postgresql/*/main/pg_hba.conf`: la línea de `127.0.0.1/32` debe usar `scram-sha-256` (o `md5`). Las tablas las crea el paso 6; aquí solo se prepara el usuario y la base.

> `deploy/install.sh` hace este paso solo: espera a que PostgreSQL esté listo, crea el usuario con clave aleatoria, crea la base, la deja con la misma clave que el `.env` y prueba la conexión.

## 4. Descargar el proyecto en el VPS

El código está en GitHub: **https://github.com/devnatlatam/weblog** (rama `main`). Se instala con `git`, así después se actualiza con un solo comando (paso 14) y siempre sabes qué versión corre.

`/opt/syslogweb` ya existe (es la carpeta personal del usuario del paso 2) y `git clone` exige una carpeta vacía, por eso se inicializa y se trae el código en lugar de clonar. Funciona aunque la carpeta tenga archivos.

### Si el repositorio es público

```bash
sudo -u syslogweb git -C /opt/syslogweb init -b main
sudo -u syslogweb git -C /opt/syslogweb remote add origin git@github.com:devnatlatam/weblog.git
sudo -u syslogweb git -C /opt/syslogweb pull origin main
```

### Si el repositorio es privado: clave de despliegue (solo lectura)

Una *clave de despliegue* le da al servidor permiso para **leer** ese único repositorio, y nada más. Es más seguro que guardar una contraseña o un token personal en el VPS.

```bash
sudo -u syslogweb mkdir -p -m 700 /opt/syslogweb/.ssh
sudo -u syslogweb ssh-keygen -t ed25519 -N "" -C "syslogweb-vps" -f /opt/syslogweb/.ssh/id_ed25519
sudo cat /opt/syslogweb/.ssh/id_ed25519.pub        # copia esa línea completa
```

En GitHub: abre el repositorio → **Settings → Deploy keys → Add deploy key**, pega la línea y **deja sin marcar** "Allow write access". Luego:

```bash
sudo -u syslogweb sh -c 'ssh-keyscan -t ed25519 github.com >> /opt/syslogweb/.ssh/known_hosts'
sudo -u syslogweb git -C /opt/syslogweb init -b main
sudo -u syslogweb git -C /opt/syslogweb remote add origin git@github.com:devnatlatam/weblog.git
sudo -u syslogweb git -C /opt/syslogweb pull origin main
```

> `ssh-keyscan` confía en la primera respuesta de GitHub. Si quieres verificar, compara la huella con las que GitHub publica en su documentación (*GitHub's SSH key fingerprints*).

### Comprobar

```bash
ls /opt/syslogweb            # debe mostrar: client  deploy  docs  server  README.md ...
sudo -u syslogweb git -C /opt/syslogweb log -1 --format='%h  %s  (%cd)'
```

**No edites archivos dentro de `/opt/syslogweb`:** un cambio local en un archivo versionado impide el `git pull` de las actualizaciones. Lo que es propio del servidor (`server/.env`, `server/logs`, `client/dist`, `node_modules`) no está en el repositorio, así que `git` nunca lo toca.

## 5. Configurar y preparar el servidor

```bash
cd /opt/syslogweb/server
sudo -u syslogweb cp .env.example .env
sudo -u syslogweb nano .env
```

En `.env` completa:
- `DB_PASSWORD`: la clave del paso 3.
- `JWT_SECRET`: genera una nueva, **no reutilices la de tu PC**:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `HOST=127.0.0.1` y `PORT=4000` (déjalos así).
- `APP_TIMEZONE`: define dónde empieza cada día para el borrado por días.
- `DISK_PATH=/var/lib/postgresql`: es el disco que se vigila para el borrado por porcentaje.

```bash
sudo chmod 600 .env
sudo -u syslogweb npm ci --omit=dev
```

## 6. Crear las tablas y el primer usuario

Este es el único usuario que se crea desde la terminal: antes de que exista alguien, no hay quién pueda crear usuarios en la web. Indica el correo y el nombre del primer administrador:

```bash
cd /opt/syslogweb/server
sudo -u syslogweb npm run db:init -- --email tu@correo.com --name "Tu Nombre"
```

Al final imprime la **contraseña temporal, una sola vez**. Guárdala: el sistema te pedirá cambiarla en el primer ingreso. Desde ahí, **todos los demás usuarios se crean desde la web** (Administración → Usuarios), y se les puede enviar el acceso por correo.

Si repites el comando más adelante, no pasa nada: solo crea un usuario cuando no existe ninguno, así que nunca vuelve a crear una cuenta que hayas eliminado.

Si aquí aparece un error de base de datos, revísalo antes de seguir. Es el primer lugar donde se vería una diferencia entre PostgreSQL 15 y la versión con la que se probó.

## 7. Construir la web

```bash
cd /opt/syslogweb/client
sudo -u syslogweb npm ci
sudo -u syslogweb npm run build      # genera client/dist
```

## 8. Dejar la API corriendo como servicio

```bash
sudo cp /opt/syslogweb/deploy/syslogweb.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now syslogweb
sudo journalctl -u syslogweb -f       # debe decir: API escuchando en http://127.0.0.1:4000
```

El servicio permite abrir puertos menores a 1024 (como el 514) sin ser root.

## 9. nginx y HTTPS

```bash
sudo cp /opt/syslogweb/deploy/nginx-syslogweb.conf /etc/nginx/sites-available/syslogweb
sudo nano /etc/nginx/sites-available/syslogweb      # cambia logs.tu-dominio.com por tu dominio
sudo ln -s /etc/nginx/sites-available/syslogweb /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d logs.tu-dominio.com
```

Entra a `https://logs.tu-dominio.com` con el correo y la contraseña temporal del paso 6.

## 9.1 Correo y alertas (se configuran desde la web)

Tras entrar a la web como administrador:

1. **Administración → Correo:** escribe el servidor SMTP, el puerto, el usuario y la contraseña, y pulsa *Enviar correo de prueba*. Al guardar, los datos se escriben en el archivo `/opt/syslogweb/server/.env` (claves `SMTP_*` y `APP_URL`) y valen al instante, sin reiniciar. Si los cambias después, el archivo se actualiza solo.
2. **Alertas:** crea las reglas (quién recibe cada aviso, de qué cliente, cada cuánto). Los usuarios nuevos también pueden recibir su acceso por correo.

Dos cosas del servidor que hay que tener en cuenta:

- **El servicio debe poder escribir su `.env`.** Con los pasos de esta guía ya es así (`chown -R syslogweb` y `chmod 600`). Si la web dice que no pudo escribir el archivo, revisa que `/opt/syslogweb/server/.env` pertenezca a `syslogweb`.
- **La contraseña del correo queda en texto en el `.env`**, igual que la de la base de datos, protegida por los permisos 600. La web nunca la vuelve a mostrar.
- **Salida a internet:** el VPS debe poder conectarse al puerto SMTP (587 o 465). Algunos proveedores bloquean el 25 y a veces también el 587; si la prueba dice que no hay respuesta, pregúntale al proveedor.
- **Dirección de la web** (en la misma pantalla): ponla (`https://logs.tu-dominio.com`) para que las alertas incluyan un enlace.

## 10. Firewall

Hay dos partes: lo fijo, que haces una vez a mano, y los puertos de los clientes, que abre y cierra la propia web.

### 10.1 Lo fijo (una sola vez)

```bash
sudo ufw default deny incoming
sudo ufw allow 22/tcp                     # SSH (ajusta si usas otro puerto)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Si tu proveedor del VPS tiene su propio firewall (grupos de seguridad), abre ahí 22, 80, 443 y los puertos que vayas a usar para syslog.

### 10.2 Que la web abra y cierre los puertos de los clientes

Con esto, **encender un cliente en la web abre su puerto en ufw, y apagarlo lo cierra**. Si el cliente tiene "Aceptar solo desde estas IP", ufw solo deja pasar a esas IP (una regla por IP; dos IP en el mismo puerto son dos reglas, dentro del mismo cliente).

**Cómo está hecho, y por qué.** La web no ejecuta comandos de firewall ni tiene permisos de administrador. Solo escribe la lista de puertos que deben estar abiertos en `/var/lib/syslogweb/firewall.desired`. Un programa aparte (`syslogweb-fw-sync`), que sí corre como root, la lee, **valida cada línea** y aplica las reglas en ufw. Se niega a abrir puertos delicados aunque la web se lo pida: 22, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 3306, 4000, 5173, 5432, 6379 y 8080.

```bash
# 1) Carpeta compartida entre la web y el aplicador
sudo install -d -o syslogweb -g syslogweb -m 755 /var/lib/syslogweb

# 2) El aplicador (solo root puede tocarlo)
sudo install -o root -g root -m 750 /opt/syslogweb/deploy/syslogweb-fw-sync /usr/local/sbin/syslogweb-fw-sync

# 3) Que systemd lo lance cuando la web cambie su lista
sudo cp /opt/syslogweb/deploy/syslogweb-fw.path /opt/syslogweb/deploy/syslogweb-fw.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now syslogweb-fw.path syslogweb-fw.service

# 4) Activarlo en la web: en /opt/syslogweb/server/.env agrega
#      FIREWALL_DRIVER=ufw
sudo systemctl restart syslogweb
```

**Comprobar que funciona:**

```bash
# Antes de usarlo de verdad, prueba el aplicador con un ufw de mentira (no toca nada):
bash /opt/syslogweb/deploy/test-fw-sync.sh        # debe terminar en "TODAS LAS PRUEBAS OK"

# Ya en la web: crea un cliente con "Encender ahora" y mira:
sudo ufw status | grep syslogweb                  # debe aparecer su puerto
cat /var/lib/syslogweb/firewall.status            # {"token":"...","ok":true,...}
journalctl -u syslogweb-fw -n 20                  # salida del aplicador
```

> **Pendiente de verificar en tu servidor:** el aplicador se probó con un ufw de mentira, no con ufw real. La parte más delicada es que ufw borre una regla creada con comentario usando solo su descripción. Haz la comprobación de arriba, y luego apaga el cliente y confirma que su regla desaparece de `ufw status`. Si no desaparece, la web te avisará con "no se pudo cerrar en el firewall".

Si no activas `FIREWALL_DRIVER=ufw`, todo sigue funcionando, pero abrir cada puerto en el firewall queda a tu cargo:

```bash
sudo ufw allow from 179.7.94.149 to any port 5514 proto udp
```

---

## 11. Pasar de rsyslog a recibir por puerto, sin cortar nada

**Antes de empezar, entiende esto:** si rsyslog se detiene y ningún programa escucha ese puerto, **lo que llegue se pierde**. En UDP se descarta sin avisar; en TCP la conexión es rechazada. Por eso se migra un equipo a la vez, con rsyslog funcionando mientras tanto.

1. **Crear el cliente.** En la web: *Gestionar clientes → Nuevo cliente*. Pon el nombre y un puerto **libre y distinto del 514**, por ejemplo 5514 UDP para el router. Deja marcado "Encender ahora": la web abre el puerto y, con el paso 10.2, también en el firewall.
2. **Comprobar el firewall.** Si no activaste el paso 10.2, ábrelo tú ahora para ese puerto.
3. **Apuntar el equipo.** En Omada, en la configuración del servidor syslog remoto de ese equipo, cambia el puerto al nuevo. Los logs empiezan a aparecer en el espacio del cliente. rsyslog sigue recibiendo el resto en el 514 sin tocarse.
4. **Verificar la captura (la primera vez).** Para confirmar el formato real de lo que envía cada equipo:
   ```bash
   sudo tcpdump -n -A -i any udp port 5514 -c 5
   ```
   Si algo no se interpreta bien, el log igual se guarda y queda en *Por aprobar*.
5. **Repetir** con cada equipo. El controlador en la nube (`50.17.102.58`) debe tener **su propio puerto**, distinto del router.
6. **Retirar rsyslog del 514** cuando todo esté migrado y verificado. Edita `/etc/rsyslog.conf`, comenta las líneas que abren el puerto (`module(load="imudp")`, `input(type="imudp" port="514")` y las equivalentes de `imtcp`), mueve `/etc/rsyslog.d/10-remoto.conf` fuera de esa carpeta y reinicia:
   ```bash
   sudo mv /etc/rsyslog.d/10-remoto.conf /root/10-remoto.conf.bak
   sudo systemctl restart rsyslog
   ss -ulpn | grep ':514'      # no debe mostrar nada (el puerto queda libre)
   ```
   Si quieres usar el 514 con Node, crea ahora el cliente con ese puerto y enciéndelo.

**Qué pasa con lo que ya tienes en `/var/log/remoto/`:** esos archivos se quedan donde están, pero ya no crecen. Todavía no se importan a la web: el importador existente no asigna los logs a un cliente, así que no se verían. Si quieres conservar ese historial dentro de la web, hay que ajustarlo.

## 12. Apagar y encender un puerto

Desde la web, en el cliente o en *Gestionar clientes*, con el interruptor (administradores y operadores). Al apagar:
- Node cierra el puerto al instante y no se guarda nada nuevo de ese cliente.
- Con el paso 10.2 activo, también se cierra en el firewall: desde fuera, el puerto deja de responder.
- Lo ya guardado no se toca.
- Los equipos siguen enviando, pero nadie escucha: esos mensajes se pierden mientras esté apagado.

Al **encender**, la web abre primero el puerto en la aplicación y luego en el firewall. Si el firewall falla o no responde en 15 segundos, el puerto vuelve a quedar apagado y la web te dice el motivo. Al **reiniciar el servidor**, los puertos de los clientes encendidos se vuelven a abrir solos, también en el firewall.

## 13. Respaldos y espacio

- **Respaldo diario** de la base (ejemplo, como `root` en `crontab -e`):
  ```
  0 3 * * *  sudo -u postgres pg_dump -Fc db_syslog > /var/backups/db_syslog_$(date +\%F).dump && find /var/backups -name 'db_syslog_*.dump' -mtime +14 -delete
  ```
- **Borrado automático:** en la web, *Administración → Almacenamiento*. Define cuántos días guardar y/o el porcentaje de disco que no se debe superar. Se borran días completos, del más antiguo, y nunca el día de hoy.
- **Antes de poner un límite por porcentaje**, mira cuánto ocupa el disco hoy. Si ya está por encima del límite, el sistema borrará historial para intentar bajar.

## 14. Actualizar la aplicación

Antes de actualizar, ten un respaldo reciente de la base ([Operación](docs/11-operacion.md#respaldos)).

```bash
cd /opt/syslogweb

# 1) Ver qué cambios llegan (opcional)
sudo -u syslogweb git fetch --tags
sudo -u syslogweb git log --oneline HEAD..origin/main

# 2) Traerlos. --ff-only se niega a mezclar si el servidor tuviera cambios propios
sudo -u syslogweb git pull --ff-only origin main

# 3) Dependencias y tablas (db:init agrega lo que falte sin tocar datos)
cd /opt/syslogweb/server && sudo -u syslogweb npm ci --omit=dev && sudo -u syslogweb npm run db:init

# 4) Reconstruir la web
cd /opt/syslogweb/client && sudo -u syslogweb npm ci && sudo -u syslogweb npm run build

# 5) Reiniciar
sudo systemctl restart syslogweb
```

`server/.env` no está en el repositorio, así que tu configuración se conserva. `db:init` es seguro de repetir: no duplica nada.

### Si cambiaron archivos de `deploy/`

Los servicios, nginx y el programa del firewall viven **fuera** de `/opt/syslogweb` (en `/etc` y `/usr/local/sbin`), así que `git pull` no los actualiza. Mira si cambió algo y, si es así, vuelve a instalar solo eso:

```bash
git -C /opt/syslogweb diff --stat 'HEAD@{1}' HEAD -- deploy/       # ¿qué archivos de deploy cambiaron?

# según cuál haya cambiado:
sudo cp /opt/syslogweb/deploy/syslogweb.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart syslogweb
sudo cp /opt/syslogweb/deploy/syslogweb-fw.path /opt/syslogweb/deploy/syslogweb-fw.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart syslogweb-fw.path
sudo install -o root -g root -m 750 /opt/syslogweb/deploy/syslogweb-fw-sync /usr/local/sbin/syslogweb-fw-sync
sudo cp /opt/syslogweb/deploy/nginx-syslogweb.conf /etc/nginx/sites-available/syslogweb   # ojo: vuelve a poner tu dominio, y luego: sudo nginx -t && sudo systemctl reload nginx
```

### Volver atrás

Si una actualización da problemas, vuelve a la versión anterior:

```bash
sudo -u syslogweb git -C /opt/syslogweb log --oneline -10          # elige el commit (o etiqueta) que funcionaba
sudo -u syslogweb git -C /opt/syslogweb checkout <commit-o-etiqueta>
# repite los pasos 3, 4 y 5 de arriba
```

Para volver a lo más reciente: `git checkout main` y `git pull --ff-only origin main`.

El código vuelve atrás, **la base de datos no**: los cambios de tablas se diseñan para ser aditivos (`IF NOT EXISTS`), así que una versión anterior suele funcionar con las tablas nuevas. Si no, restaura el respaldo.

### Qué versión está corriendo

```bash
sudo -u syslogweb git -C /opt/syslogweb log -1 --format='%h  %s  (%cd)'
sudo -u syslogweb git -C /opt/syslogweb describe --tags --always     # etiqueta si la hay, o el commit
```

Más sobre el flujo de trabajo, ramas y versiones: [Trabajo con git](docs/14-trabajo-con-git.md).

## 15. Si algo falla

| Síntoma | Qué revisar |
|---|---|
| Al encender un puerto dice "ya está en uso" | Otro programa lo tiene: `sudo ss -ulpn \| grep :PUERTO` (UDP) o `ss -tlpn` (TCP). Si es rsyslog, ver el paso 11. |
| "Sin permiso para abrir el puerto" | Puerto menor a 1024 fuera del servicio. Verifica que el servicio se inició con systemd (tiene la capacidad) y no a mano. |
| El puerto está encendido pero no llega nada | `sudo ufw status`, el firewall del proveedor, y `sudo tcpdump -n -i any port PUERTO`: si ahí ves paquetes, el problema es la app; si no, es la red o el firewall. |
| La web carga pero "En vivo" dice Reconectando | nginx no pasa el WebSocket: revisa el bloque `location /ws` y `sudo nginx -t`. |
| Nadie puede entrar (olvidaron la contraseña del único administrador) | `sudo -u syslogweb npm run user:reset -- --email tu@correo.com` en `/opt/syslogweb/server` (ver [Operación](docs/11-operacion.md#recuperar-el-acceso)). |
| `db:init` dice “no hay ningún usuario todavía” | Es una base nueva: agrega `-- --email tu@correo.com --name "Tu Nombre"` al comando (paso 6). |
| `db:init` falla con autenticación | `DB_USER` y `DB_PASSWORD` en `.env`, y que el rol del paso 3 exista. |
| La web dice "el firewall no respondió" | El servicio no está activo: `systemctl status syslogweb-fw.path syslogweb-fw`. Revisa también que `/var/lib/syslogweb` pertenezca a `syslogweb`. |
| La web dice "el puerto está protegido" | Intentaste usar un puerto de la lista protegida (22, 80, 443, 4000, 5432...). Elige otro. |
| El correo de prueba falla | El mensaje dice el motivo (usuario o contraseña, puerto cerrado, servidor no encontrado). Revisa también que el VPS pueda salir al puerto SMTP. |
| Al guardar el correo: “no se pudo escribir el archivo .env” | `/opt/syslogweb/server/.env` debe pertenecer al usuario `syslogweb`: `sudo chown syslogweb:syslogweb /opt/syslogweb/server/.env`. |
| Un tipo de log aparece en *Por aprobar* | Es normal: es un mensaje que el sistema no reconocía. Un administrador lo aprueba o lo rechaza. |
| Almacenamiento no muestra el disco | Revisa `DISK_PATH` en `.env` y reinicia el servicio. |

## Lista de seguridad antes de abrirlo a internet

- [ ] `JWT_SECRET` nuevo, distinto al de desarrollo.
- [ ] Contraseña temporal cambiada en el primer ingreso.
- [ ] Solo abiertos: 22, 80, 443 y los puertos de syslog de los clientes encendidos, y estos últimos solo para las IP de cada cliente.
- [ ] Paso 10.2 verificado: al apagar un cliente, su regla desaparece de `ufw status`.
- [ ] `HOST=127.0.0.1` en `.env` (la API no es visible desde fuera).
- [ ] HTTPS activo (paso 9).
- [ ] Correo probado desde la web (paso 9.1).
- [ ] Respaldo diario funcionando (paso 13).
