# Omada Logs

Visor de **syslog en tiempo real** para equipos TP-Link Omada (routers y controlador). Recibe los logs directamente por puertos de red, los interpreta en lenguaje claro, detecta problemas con inicio y fin, y avisa por correo.

Está pensado para quien administra la red de uno o varios clientes y necesita responder rápido a: *¿qué está pasando?, ¿desde cuándo?, ¿a quién afecta? y ¿qué hago?*

## Qué hace

- **Un puerto por cliente.** Cada sitio o equipo envía sus logs a un puerto propio, y ese puerto lo identifica. Los puertos se encienden y apagan desde la web, sin reiniciar nada.
- **Cada cliente tiene su propio espacio:** resumen, logs en vivo, historial e incidentes. Nada se mezcla con otros clientes.
- **Interpreta los mensajes.** Convierte líneas técnicas en frases claras ("WAN3 sin conexión a internet"), con qué significan y qué hacer.
- **Incidentes con duración.** Internet o VPN caída, conflicto de IP, servidor DHCP intruso: con inicio, fin y cuánto duraron.
- **Tipos de log nuevos en cuarentena.** Lo que el sistema no reconoce se clasifica solo y espera la aprobación de un administrador.
- **Alertas por correo** configurables desde la web (7 tipos), con historial de lo enviado.
- **Todo se gestiona desde la web:** clientes, puertos, usuarios, correo, alertas y borrado de logs.
- **Control de acceso por niveles:** superadmin, administrador, operador y lector.
- **Borrado automático** por días o por porcentaje de disco, y borrado manual por día.
- **Firewall opcional:** al encender un cliente, la web puede abrir su puerto en `ufw` (con un programa aparte y mínimo, ver [seguridad](docs/10-seguridad.md)).

## Cómo funciona

```
 Equipos Omada                  Servidor (Node.js)                       Navegador
┌────────────┐   UDP/TCP    ┌────────────────────────┐   WebSocket   ┌──────────────┐
│ Router     │────puerto───►│ Colector → Intérprete  │──────────────►│ En vivo      │
│ Controlador│  por cliente │      │                 │               │              │
└────────────┘              │      ▼                 │   HTTP/JSON   │ Resumen      │
                            │  PostgreSQL ◄──────────┼──────────────►│ Registros    │
                            │  (1 tabla por día)     │               │ Incidentes   │
                            │      │                 │               │ Administración│
                            │      ▼                 │               └──────────────┘
                            │  Incidentes · Alertas ─┼──► Correo (SMTP)
                            └────────────────────────┘
```

Los logs **no pasan por archivos de texto**: Node escucha el puerto y guarda en PostgreSQL. Detalle en [arquitectura](docs/05-arquitectura.md).

## Tecnología

| Parte | Tecnología |
|---|---|
| Servidor | Node.js, Express, `ws` (WebSocket), `pg`, `nodemailer` |
| Base de datos | PostgreSQL (tabla de eventos particionada por día) |
| Web | React 17, React Router 6, Vite |
| Recepción de logs | `dgram` (UDP) y `net` (TCP) de Node.js |
| Sesiones | JWT de 8 horas, contraseñas con bcrypt |

## Inicio rápido (desarrollo)

Requisitos: Node.js 20 o superior y PostgreSQL 15 o superior. Guía completa en [instalación para desarrollo](docs/04-instalacion-desarrollo.md).

```bash
git clone https://github.com/Softkale/weblog.git && cd weblog

# 1. Base de datos: crea una vacía llamada db_syslog (o la que prefieras)
# 2. Servidor
cd server
cp .env.example .env        # completa DB_* y JWT_SECRET
npm install
npm run db:init -- --email tu@correo.com --name "Tu Nombre"   # imprime una contraseña temporal
npm run dev                 # API en http://localhost:4000

# 3. Web (otra terminal)
cd client
npm install
npm run dev                 # http://localhost:5173
```

## Instalar en un servidor (un solo comando)

```bash
# En un Debian 12 limpio, con tu dominio apuntando al servidor
curl -fsSL https://raw.githubusercontent.com/Softkale/weblog/main/deploy/install.sh -o install.sh
sudo bash install.sh --domain logs.tu-dominio.com --email tu@correo.com --name "Tu Nombre"

# Para actualizar después (usa git)
sudo syslogweb-update
```

Todo el detalle, opciones y cómo volver atrás: [Instalación y actualización](docs/15-instalacion-y-actualizacion.md). Si prefieres hacerlo a mano paso a paso: [DESPLIEGUE.md](DESPLIEGUE.md).

## Documentación

| Documento | Para quién | Responde a… |
|---|---|---|
| [¿Qué es y para qué sirve?](docs/00-que-es-y-para-que-sirve.md) | **Personas no técnicas** | ¿Qué hace esto, en palabras simples? |
| [Guía de usuario](docs/01-guia-de-usuario.md) | Todos | ¿Cómo uso cada pantalla? ¿Qué significa lo que veo? |
| [Guía del administrador](docs/02-guia-del-administrador.md) | Administradores | ¿Cómo creo clientes, alertas, usuarios? ¿Cómo configuro el correo? |
| [Conectar equipos Omada](docs/03-conectar-equipos-omada.md) | Quien configura la red | ¿Cómo hago que un router o controlador envíe sus logs? |
| [Instalación para desarrollo](docs/04-instalacion-desarrollo.md) | Programadores | ¿Cómo lo levanto en mi equipo? |
| [Instalación y actualización](docs/15-instalacion-y-actualizacion.md) | Sistemas | ¿Cómo lo instalo con un comando y lo actualizo con git? |
| [Despliegue manual en Debian](DESPLIEGUE.md) | Sistemas | ¿Qué hace exactamente el instalador, paso a paso? |
| [Arquitectura](docs/05-arquitectura.md) | Programadores | ¿Cómo está construido y por qué? |
| [Modelo de datos](docs/06-modelo-de-datos.md) | Programadores | ¿Qué tablas hay y para qué? |
| [Referencia de la API](docs/07-referencia-api.md) | Programadores | ¿Qué endpoints hay? ¿Cómo funciona el WebSocket? |
| [Tipos de log](docs/08-tipos-de-log.md) | Programadores | ¿Qué mensajes entiende? ¿Cómo agrego uno nuevo? |
| [Alertas y correo](docs/09-alertas-y-correo.md) | Administradores y programadores | ¿Cómo decide cuándo enviar un correo? |
| [Seguridad](docs/10-seguridad.md) | Todos los técnicos | ¿Qué protege el sistema y qué riesgos quedan? |
| [Operación y mantenimiento](docs/11-operacion.md) | Sistemas | ¿Cómo lo mantengo, respaldo y recupero? |
| [Estado y pendientes](docs/12-estado-y-pendientes.md) | Todos | ¿Qué está probado, qué no, y qué falta? |
| [Glosario](docs/13-glosario.md) | Todos | ¿Qué significa cada término? |
| [Trabajo con git](docs/14-trabajo-con-git.md) | Programadores | ¿Qué se sube al repositorio? ¿Cómo paso un cambio al servidor? ¿Qué documento actualizo? |

## Estructura del repositorio

Código en https://github.com/Softkale/weblog (rama `main`).

```
server/            API, colector de puertos, intérprete de logs, alertas
  src/             código (ver arquitectura)
  .env.example     plantilla de configuración
client/            la web (React)
  src/pages/       una pantalla por archivo
  src/components/  piezas compartidas
  src/data/        catálogos (explicaciones de logs, roles, severidades)
deploy/            install.sh, update.sh y archivos del servidor: systemd, nginx, firewall
docs/              esta documentación
DESPLIEGUE.md      instalación manual paso a paso en Debian
```

## Estado

Funciona de punta a punta en desarrollo (Windows, PostgreSQL 17). Hay cosas que **todavía no se han probado en un entorno real**: el envío por un servidor SMTP real, `ufw` real y la instalación en Debian. El detalle honesto está en [Estado y pendientes](docs/12-estado-y-pendientes.md).
