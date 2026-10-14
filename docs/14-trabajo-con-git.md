# Trabajo con git

Cómo se versiona el proyecto, qué se sube y qué no, y cómo pasar un cambio del código al servidor. Para quien programa o despliega.

**Repositorio:** https://github.com/devnatlatam/appweblog · **Rama principal:** `main`

## Qué se versiona y qué no

| Se versiona | No se versiona (ya está en `.gitignore`) | Por qué |
|---|---|---|
| Código de `server/` y `client/` | `server/.env` | Tiene las claves de la base de datos, del correo y el secreto de sesiones |
| `server/.env.example` (plantilla sin secretos) | `node_modules/` | Se reconstruye con `npm ci` |
| `deploy/` (servicios, nginx, firewall) | `client/dist/` | Se genera con `npm run build` |
| `docs/`, `README.md`, `DESPLIEGUE.md` | `server/logs/` | Logs reales de los equipos: datos del cliente |
| `package.json` y `package-lock.json` | `*.dump`, `*.tgz` | Respaldos de la base y paquetes |

`package-lock.json` **debe** estar versionado: la instalación usa `npm ci`, que instala exactamente las versiones del archivo.

> `.claude/settings.local.json` (ajustes personales de la herramienta de edición) está ignorado a nivel de tu usuario de git en este equipo; si trabajas desde otro equipo, ignóralo también.

## Reglas de oro

1. **Nunca subas un secreto.** Ni `.env`, ni una contraseña pegada en un archivo, ni un respaldo de la base, ni logs reales.
2. **Si ocurre, asume que está comprometido.** Borrarlo en un commit nuevo **no** lo quita del historial. Cambia de inmediato la contraseña de la base, `JWT_SECRET` (cierra todas las sesiones) y la contraseña del correo; después, limpia el historial.
3. **Un cambio de tablas siempre debe poder repetirse.** `npm run db:init` corre en cada actualización, así que `schema.sql` solo usa `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` y `CREATE INDEX IF NOT EXISTS`. Nunca borres ni renombres sin una migración pensada.
4. **La documentación es parte del cambio.** Si lo que cambias aparece en la tabla de abajo, actualiza el documento en el mismo commit.

## Flujo de trabajo recomendado

```
main  ──●──●──────────●──────────●──  (siempre desplegable)
         \          /  \        /
 feature  ●──●──●──●    ●──●───●
```

1. `main` es lo que se despliega. Mantenla siempre en estado funcional.
2. Para cada cambio, crea una rama: `git switch -c feature/alerta-de-equipo-nuevo` (o `fix/…` para correcciones).
3. Haz commits pequeños con mensajes que digan **qué** y **por qué** (ver abajo).
4. Antes de integrar, comprueba que la web compila (`cd client && npm run build`) y prueba a mano lo que tocaste. Todavía no hay pruebas automáticas ([Estado y pendientes](12-estado-y-pendientes.md)).
5. Integra a `main` (idealmente con un *pull request* en GitHub para que otra persona lo revise) y súbelo: `git push origin main`.
6. Despliega en el servidor con `sudo syslogweb-update` ([detalle](15-instalacion-y-actualizacion.md#3-actualizar)).

### Mensajes de commit

Una línea corta en imperativo que explique el cambio, y si hace falta una línea en blanco y el motivo:

```
Agrega la alerta de equipo nuevo en la red

Se detecta por la MAC del DHCP y del firewall. Los primeros 60 minutos de
cada cliente son de aprendizaje para no avisar de todo al empezar.
```

Evita mensajes como "cambios" o "últimos cambios": dentro de seis meses no dirán nada.

## Versiones (etiquetas)

Cuando el sistema esté en un estado que quieras poder recuperar, márcalo con una etiqueta:

```bash
git tag -a v1.0.0 -m "Primera versión en producción"
git push origin v1.0.0
```

En el servidor puedes instalar justo esa versión (`git checkout v1.0.0`) y volver a ella si algo sale mal. Una numeración sencilla alcanza: `v1.0.0` → `v1.1.0` (función nueva) → `v1.1.1` (corrección).

## Empezar en un equipo nuevo

```bash
git clone https://github.com/devnatlatam/appweblog.git
cd appweblog
# luego sigue docs/04-instalacion-desarrollo.md
```

## Si cambias… actualiza…

| Si cambias | Actualiza |
|---|---|
| Un intérprete de logs (`parser.js`, `wire.js`) | [Tipos de log](08-tipos-de-log.md) y `client/src/data/catalog.js` |
| Permisos (`permissions.js`) | `client/src/data/roles.js` (**deben coincidir**), [Seguridad](10-seguridad.md#roles-y-permisos), [Guía de usuario](01-guia-de-usuario.md#qué-puede-hacer-cada-rol) |
| Una ruta de la API | [Referencia de la API](07-referencia-api.md) |
| Una tabla (`schema.sql`, `partitions.js`) | [Modelo de datos](06-modelo-de-datos.md) |
| Una variable de `.env` | `server/.env.example` y [Instalación para desarrollo](04-instalacion-desarrollo.md#variables-de-entorno) |
| Reglas de alerta o correo | [Alertas y correo](09-alertas-y-correo.md) y [Guía del administrador](02-guia-del-administrador.md) |
| Una pantalla | [Guía de usuario](01-guia-de-usuario.md) o [del administrador](02-guia-del-administrador.md) |
| Cómo se instala (`deploy/`) | [DESPLIEGUE.md](../DESPLIEGUE.md), [Instalación y actualización](15-instalacion-y-actualizacion.md) y los scripts `install.sh` / `update.sh` (deben hacer lo mismo que la guía manual) |
| El diseño general | [Arquitectura](05-arquitectura.md) |
| Algo que ahora está probado o ya no es un pendiente | [Estado y pendientes](12-estado-y-pendientes.md) |

## Comandos útiles

```bash
git status                       # qué cambió
git diff                         # ver los cambios línea por línea
git log --oneline -10            # últimos commits
git switch -c fix/nombre         # crear una rama
git add -p                       # elegir qué partes de los cambios incluir
git commit                       # confirmar
git push -u origin fix/nombre    # subir la rama
git pull --ff-only               # traer cambios sin mezclar a la fuerza
git restore archivo              # descartar los cambios de un archivo (¡no se recuperan!)
git stash                        # guardar cambios a medias y dejar la carpeta limpia
```
