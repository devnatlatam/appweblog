# ¿Qué es Omada Logs y para qué sirve?

Esta página es para **todas las personas**, no hace falta saber de informática. Si solo vas a leer una página, que sea esta.

## En una frase

Es una **pantalla web que te cuenta, en español sencillo, qué está pasando en la red de tus clientes**, y te manda un correo cuando algo se cae.

## El problema que resuelve

Los equipos de red (routers, firewalls, controladores TP-Link Omada) escriben todo el tiempo un "diario" de lo que les pasa: *"se cayó la conexión de internet"*, *"alguien se conectó a la VPN"*, *"dos aparatos tienen la misma dirección"*. Ese diario se llama **log**.

El problema: el log original es una avalancha de líneas técnicas, miles por hora, escritas para máquinas. Nadie puede leerlas a tiempo para reaccionar.

## Qué hace Omada Logs

1. **Escucha** lo que cada equipo escribe en su diario.
2. **Lo traduce** a frases claras: en vez de una línea técnica ves *"Internet WAN3 sin conexión"*, qué significa y qué hacer.
3. **Detecta problemas con principio y fin.** Por ejemplo: *"Internet caído desde las 10:42, duró 7 minutos"*. A eso lo llamamos **incidente**.
4. **Te avisa por correo** cuando algo importante ocurre, sin que tengas que estar mirando la pantalla.
5. **Guarda el historial** para consultar qué pasó ayer o la semana pasada, y **borra solo** lo viejo para no llenar el disco.

## Cómo se ve el día a día

| Quién eres | Qué haces con la web |
|---|---|
| **Quien vigila la red** | Abres el *Resumen general*. Si todo está bien, no hay nada marcado. Si algo requiere atención, aparece arriba, en rojo o amarillo. |
| **Quien atiende al cliente** | Entras al espacio de ese cliente y ves sus incidentes: *qué pasó, desde cuándo, si ya se resolvió*. Respondes con datos. |
| **Quien administra** | Das de alta clientes y usuarios, decides quién recibe qué correo y cuánto tiempo se guarda el historial. |

Cada cliente tiene **su propio espacio**: lo de uno nunca se mezcla con lo de otro.

## Palabras que vas a escuchar

| Palabra | Significa |
|---|---|
| **Log** | El "diario" que escribe un equipo de red. |
| **Evento** | Una línea de ese diario. |
| **Incidente** | Un problema con inicio y fin (ej.: internet caído de 10:42 a 10:49). |
| **Cliente** | Una empresa o sede cuyos equipos vigilas. |
| **Puerto** | Como una "ventanilla" del servidor. Cada cliente tiene la suya, y así sabemos de quién viene cada mensaje. |
| **Por aprobar** | Mensajes que el sistema no reconoce todavía. Un administrador decide si se guardan. Nada se pierde. |
| **Servidor** | El computador (en internet) donde vive todo esto. |

Más términos en el [glosario](13-glosario.md).

## Qué NO es

- No es un antivirus ni bloquea ataques: **observa y avisa**, no corrige solo.
- No cambia la configuración de los equipos: solo lee lo que ellos envían.
- No es un respaldo de la red de tu cliente.

## Y lo técnico, ¿quién lo hace?

Una persona de sistemas instala el servidor **una sola vez** con un único comando, y después lo actualiza con otro. Está explicado paso a paso en [Instalación y actualización](15-instalacion-y-actualizacion.md). Tú, como usuario, solo abres la web con tu correo y tu contraseña.

## ¿Por dónde sigo?

| Si quieres… | Lee |
|---|---|
| Aprender a usar la web | [Guía de usuario](01-guia-de-usuario.md) |
| Crear clientes, usuarios y alertas | [Guía del administrador](02-guia-del-administrador.md) |
| Conectar un router o controlador | [Conectar equipos Omada](03-conectar-equipos-omada.md) |
| Instalar el servidor | [Instalación y actualización](15-instalacion-y-actualizacion.md) |
| Entender cómo está construido | [Arquitectura](05-arquitectura.md) |
