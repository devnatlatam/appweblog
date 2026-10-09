# Instalación y actualización (con git)

Todo el ciclo de vida del servidor, con **un comando para instalar** y **un comando para actualizar**. Para quien administra el servidor (no hace falta programar).

> **Estado:** los scripts `deploy/install.sh` y `deploy/update.sh` pasaron la revisión de sintaxis, pero **todavía no se han ejecutado en un Debian real**. Pruébalos primero en un servidor desechable y cualquier fallo corrígelo en el script, no a mano. Ver [Estado y pendientes](12-estado-y-pendientes.md).

## Lo que necesitas antes

| Qué | Detalle |
|---|---|
| Un servidor | Debian 12 (o Ubuntu 22.04+), con acceso `sudo` y salida a internet. |
| Un dominio *(recomendado)* | Algo como `logs.tu-dominio.com`, ya apuntando a la IP del servidor. Sin él, funciona por IP pero sin HTTPS. |
| Un correo | Será el del primer administrador (y el que usa Let's Encrypt para avisar de vencimientos). |
| Acceso al repositorio | https://github.com/Softkale/weblog. Si es privado, el instalador crea una clave de solo lectura y te la muestra para registrarla en GitHub. |

## 1. Instalar (un solo comando)

Conéctate al servidor por SSH y ejecuta:

```bash
curl -fsSL https://raw.githubusercontent.com/Softkale/weblog/main/deploy/install.sh -o install.sh
sudo bash install.sh --domain logs.tu-dominio.com --email tu@correo.com --name "Tu Nombre"
```

> Si el repositorio es **privado**, `curl` no podrá bajar el script. Cópialo desde tu PC: `scp deploy/install.sh usuario@servidor:~` y ejecútalo igual. El resto lo resuelve solo.

Tarda unos minutos. Si no pasas las opciones, **te las pregunta**. Al terminar muestra la dirección de la web y una **contraseña temporal que se ve una sola vez**: guárdala. Al entrar, el sistema te pide crear una propia.

### Qué hace el script (y por qué es seguro repetirlo)

| # | Hace | Si ya existe |
|---|---|---|
| 1 | Instala paquetes: PostgreSQL, nginx, ufw, certbot, git | Los deja |
| 2 | Instala Node.js 22 (si el del sistema es menor a 20) | Lo deja |
| 3 | Crea el usuario `syslogweb` (la app **no** corre como root) | Lo deja |
| 4 | Baja el código con **git** a `/opt/syslogweb` | Hace `fetch` y se pone en la rama pedida |
| 5 | **Base de datos:** espera a que PostgreSQL esté listo, crea el usuario `syslogweb` con **clave aleatoria** y la base `db_syslog`, y **prueba la conexión** como lo hará la app | Si existen, los reutiliza y deja la clave igual a la del `.env` |
| 6 | Crea `server/.env` con claves nuevas y aleatorias | **No lo toca** |
| 7 | Instala dependencias, **crea todas las tablas** (incluida la partición por día) y el **primer administrador** | Solo agrega lo que falte; no crea usuarios si ya hay |
| 8 | Construye la web | La reconstruye |
| 9 | Instala los servicios de systemd, nginx y pide el certificado HTTPS | No pisa un nginx ya configurado |
| 10 | Activa el firewall (SSH, 80, 443), el respaldo diario y el comando `syslogweb-update` | Los deja |

Por eso, si algo falla a la mitad (por ejemplo el dominio aún no apuntaba al servidor), **corrige y vuelve a ejecutar el mismo comando**.

### Opciones

| Opción | Para qué |
|---|---|
| `--domain DOMINIO` | Dirección de la web. Sin ella: solo por IP, sin HTTPS. |
| `--email CORREO` / `--name NOMBRE` | Primer administrador. |
| `--branch RAMA_O_ETIQUETA` | Instalar una versión concreta, ej. `--branch v1.0.0`. |
| `--repo URL` | Otro repositorio (un fork). |
| `--timezone ZONA` | Zona horaria de los días de logs. Por defecto `America/Lima`. |
| `--no-https` | Sin certificado. |
| `--no-firewall` | No tocar `ufw` (lo administras tú). |
| `--yes` | No hacer preguntas (para automatizar). |

## 2. Después de instalar (desde la web)

1. **Entra** con el correo y la contraseña temporal.
2. **Administración → Correo:** configura el servidor SMTP y envía una prueba.
3. **Gestionar clientes → Nuevo cliente:** elige un puerto libre (ej. 5514 UDP) y déjalo encendido. La web lo abre en el firewall sola.
4. **En el equipo Omada**, apunta el syslog remoto a la IP del servidor y ese puerto: [Conectar equipos Omada](03-conectar-equipos-omada.md).

## 3. Actualizar

Cuando haya cambios nuevos en git, en el servidor:

```bash
sudo syslogweb-update --check      # opcional: ver qué cambios llegan, sin instalar nada
sudo syslogweb-update              # actualizar a lo último de main
```

El script, en este orden: **respalda la base** → trae el código con `git` → reinstala dependencias → aplica cambios de tablas → reconstruye la web → reinicia → comprueba que arrancó. Tu `.env` y tus datos no se tocan. Reiniciar corta la recepción unos segundos (los mensajes UDP de ese lapso se pierden): hazlo en horario tranquilo.

Si encuentra archivos modificados a mano dentro de `/opt/syslogweb`, **se detiene** y te los lista (ver [Reglas](#reglas-de-oro)).

### Versiones y volver atrás

```bash
sudo syslogweb-update v1.2.0       # ir a una versión (etiqueta) concreta
sudo syslogweb-update a1b2c3d      # o a un commit
sudo syslogweb-update main         # volver a lo último
```

Si una actualización falla, el propio script te imprime el comando exacto para volver a la versión anterior y la ruta del respaldo. Volver atrás cambia **el código, no la base de datos**: los cambios de tablas son aditivos, así que una versión anterior suele funcionar. Si no, restaura el respaldo ([Operación](11-operacion.md#respaldos)).

### Qué versión está corriendo

```bash
sudo -u syslogweb git -C /opt/syslogweb log -1 --format='%h  %s  (%cd)'
sudo -u syslogweb git -C /opt/syslogweb describe --tags --always
```

## 4. Quien programa: cómo sube un cambio

```bash
git switch -c fix/nombre            # una rama por cambio
# ...editar...
git add -p && git commit            # mensaje claro, no "cambios"
git push -u origin fix/nombre       # pull request en GitHub → revisión → merge a main
git tag -a v1.1.0 -m "Descripción"  # opcional: marcar una versión estable
git push origin v1.1.0
```

Luego en el servidor: `sudo syslogweb-update` (o `sudo syslogweb-update v1.1.0`). Más detalle, qué se versiona y qué documento actualizar: [Trabajo con git](14-trabajo-con-git.md).

## Reglas de oro

1. **Nunca edites archivos dentro de `/opt/syslogweb`.** Los cambios se hacen en git y se bajan con `syslogweb-update`. Lo propio del servidor (`.env`, `node_modules`, `client/dist`) ya no está en git y no estorba.
2. **Nunca subas secretos a git** (`.env`, claves, respaldos). Ver [Trabajo con git](14-trabajo-con-git.md#reglas-de-oro).
3. **Guarda por separado** una copia de `/opt/syslogweb/server/.env`: sin él, un respaldo de la base cuesta reponerlo.

## Lo que queda en el servidor

| Qué | Dónde |
|---|---|
| Código (carpeta git) | `/opt/syslogweb` |
| Configuración y secretos | `/opt/syslogweb/server/.env` (permisos 600) |
| Servicio de la app | `systemctl status syslogweb` · logs: `journalctl -u syslogweb -f` |
| Aplicador del firewall (root) | `/usr/local/sbin/syslogweb-fw-sync` |
| Respaldos automáticos (diario 03:00, 14 días) | `/var/backups/syslogweb/` |
| Respaldos antes de actualizar | `/var/backups/syslogweb/antes-de-actualizar_*.dump` |
| Comando de actualización | `/usr/local/bin/syslogweb-update` |

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| El instalador dice que el repositorio es privado | Copia la clave que imprime en GitHub → *Settings → Deploy keys* (sin "write access") y vuelve a ejecutar. |
| "No se pudo obtener el certificado HTTPS" | El dominio aún no apunta a la IP del servidor. Cuando apunte: `sudo certbot --nginx -d logs.tu-dominio.com`. |
| El servicio no arranca | `sudo journalctl -u syslogweb -n 50`. Lo más común: clave de base de datos mal en `.env`. |
| `syslogweb-update` dice "archivos modificados a mano" | `sudo -u syslogweb git -C /opt/syslogweb status` para verlos; descarta con `git restore <archivo>`. |
| Perdí la contraseña del administrador | `cd /opt/syslogweb/server && sudo -u syslogweb npm run user:reset -- --email tu@correo.com` |
| Instalar a mano, paso por paso | [DESPLIEGUE.md](../DESPLIEGUE.md) (es la misma instalación explicada en detalle). |

Más problemas frecuentes: [DESPLIEGUE.md, "Si algo falla"](../DESPLIEGUE.md#15-si-algo-falla).
