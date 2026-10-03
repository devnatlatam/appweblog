# Guía de usuario

Para quien usa Omada Logs a diario para ver qué pasa en la red. Si además administras clientes, alertas o usuarios, sigue con la [guía del administrador](02-guia-del-administrador.md).

## Entrar

1. Abre la dirección de la web e inicia sesión con tu **correo** (completo, con `@`) y tu contraseña.
2. Si es tu primer ingreso, el sistema te pide **crear una contraseña propia** (mínimo 10 caracteres). No puedes usar nada más hasta hacerlo.
3. La sesión dura **8 horas**. Después, vuelve a entrar.
4. Tras 8 intentos fallidos desde un mismo equipo, se bloquea el acceso **10 minutos**.

En la barra superior puedes cambiar entre tema **claro y oscuro** y **pausar** la actualización en vivo. En el celular, el menú se abre con el botón de las tres rayas y abajo hay una barra con las secciones principales.

## Ideas clave

**Cliente.** Es un sitio o equipo que envía logs al sistema. Cada cliente tiene su propio espacio en el menú, con un punto de color:

| Punto | Significa |
|---|---|
| Verde | Está recibiendo logs |
| Círculo vacío | Apagado: no se recibe nada |
| Rojo | Está encendido pero no pudo abrir su puerto (el motivo se ve en su página) |

**Severidad.** Cada evento tiene un nivel:

| Nivel | Color | Es… |
|---|---|---|
| Crítico | rojo | Algo grave que requiere acción inmediata |
| Error | naranja | Algo falló |
| Aviso | amarillo | Algo inusual que conviene revisar |
| Info | azul | Actividad normal |

**Revisado.** Un evento o problema que ya miraste lo marcas como *revisado*. Deja de aparecer en "Necesita tu atención" pero sigue en los registros.

**Incidente.** Un problema con inicio y fin: *internet caído*, *túnel VPN caído*, *conflicto de IP*, *servidor DHCP intruso*. Mientras sigue activo está **abierto**; cuando termina pasa a **resuelto** y queda anotado cuánto duró.

## Resumen general

La pantalla de inicio muestra lo ocurrido en las **últimas 24 horas** de todos los clientes:

- **Clientes con señal:** cuántos puertos encendidos recibieron logs en los últimos 15 minutos.
- **Eventos recibidos, problemas por revisar y avisos.**
- **Eventos por hora:** barras apiladas por severidad.
- **Por categoría:** Red, Firewall, Seguridad, Conectividad, VPN, Configuración…
- **Incidentes abiertos:** los problemas que siguen activos, con un enlace al cliente afectado.
- **Necesita tu atención:** errores y avisos sin revisar, **agrupados por problema** ("se repitió 388 veces, la última hace 1 min"). Con el botón *Revisado* marcas todo el grupo.

Para ver los logs de un cliente en particular, entra a su espacio desde el menú o desde [Clientes](#clientes).

## El espacio de un cliente

Se entra desde la pantalla [Clientes](#clientes) o desde el menú. Arriba ves su nombre, puerto, estado, el último log recibido y **desde qué IP envía** (con las IP anteriores, útil para notar que el router cambió de enlace). Quien tenga permiso ve un interruptor para encender o apagar su puerto.

Cuatro pestañas:

### Resumen
Lo mismo que el resumen general, pero **solo de ese cliente**.

### En vivo
Los logs aparecen aquí apenas llegan.

- Al abrir muestra los últimos 50 para no empezar vacío; luego entra lo nuevo.
- **Filtros:** palabra clave (por ejemplo `DNS` o `conflicto`) e IP de origen. **Al cambiar un filtro la pantalla se limpia** y solo verás lo nuevo que coincida.
- **Pausar:** congela la pantalla para leer. Lo que llega mientras tanto se junta y aparece al reanudar (el botón indica cuántos hay).
- **Limpiar:** vacía la pantalla (no borra nada de la base de datos).
- Se conservan los **últimos 5.000** eventos en pantalla. Si llegan demasiados de golpe, la pantalla lo avisa y el resto está en *Registros*.
- Toca una fila para ver su detalle.
- Si se pierde la conexión, el indicador pasa a "Reconectando…" y se restablece solo.

### Registros
El historial completo, guardado en la base de datos.

- **Buscar** por texto, IP o dirección MAC.
- **Período:** última hora, 6 horas, 24 horas o 7 días.
- **Tipo de log, categoría, severidad y "Sin revisar"** como filtros. La **categoría** (Red, Firewall, Seguridad, Conectividad, VPN, Configuración, Controlador, Sistema u Otros) agrupa los tipos por tema. Desde el *Resumen* de un cliente, tocar una categoría en "Por categoría" abre los registros ya filtrados.
- **Mostrar más** carga los siguientes. El total se muestra hasta "más de 10.000".
- **Agrupar repetidos:** el firewall genera miles de líneas iguales (por ejemplo, el mismo equipo consultando el DNS cada 2 segundos). Con esta opción, los eventos iguales de un mismo tramo (1 min, 5 min, 15 min o 1 hora) se muestran en **una fila con su cantidad** (`×25`). Al tocar la fila ves los eventos reales de ese tramo. **No se pierde nada:** se guardan todos, solo cambia cómo se muestran.
- **Columnas del firewall:** cuando hay eventos de firewall a la vista (o eliges ese tipo), la tabla añade lo que importa de cada paquete: **Acción** (Permitido o Bloqueado), **Origen**, **Puerto origen**, **Destino**, **Puerto destino** (con el nombre del servicio, por ejemplo `53` · DNS) y **Protocolo**. En los eventos que no son de firewall esas celdas quedan con un guion. Si la regla tiene nombre, aparece bajo el resumen. Si no hay nada de firewall a la vista, las columnas no se muestran.
- **Exportar CSV** (si tu rol lo permite): descarga lo que coincide con los filtros actuales, hasta 50.000 filas. Con el tipo Firewall elegido, el archivo incluye también las columnas de acción, origen, destino, puerto, protocolo y regla.

### Incidentes
Los problemas del cliente, **abiertos** y **resueltos**, con su duración. Un problema que se repite (como un conflicto de IP que avisa cada minuto) cuenta como **un solo incidente**, no cientos.

**Toca un incidente para ver qué pasa.** Se abre su detalle con:

- Si sigue abierto o ya terminó, **desde cuándo** y **cuánto lleva o cuánto duró**.
- **A quién afecta** (la salida WAN, la IP, el equipo).
- **Qué significa** y **qué hacer**.
- Los **datos del primer aviso** (por ejemplo, las dos MAC de un conflicto de IP).
- **Qué pasó**: la lista de avisos que lo componen, del más reciente al más antiguo. Toca uno para ver su detalle completo.
- **Ver en Registros**: te lleva a los registros de ese cliente, ya filtrados al tramo de tiempo del incidente.

También puedes abrirlos desde el **Resumen general**, en "Incidentes abiertos".

## El detalle de un evento

Al tocar un evento se abre un panel con:

- **Qué significa:** una explicación en lenguaje claro.
- **Qué hacer:** una recomendación, cuando la hay.
- **Datos extraídos:** IP, MAC, puertos, regla del firewall, etc. Si la regla del firewall tiene nombre (porque el controlador lo informó), se muestra, por ejemplo `DMZ (1571129632)`.
- **Mensaje original (syslog):** el texto tal como lo envió el equipo, con botón *Copiar*. *Solo lo ven operadores, administradores y superadmins.*
- **Marcar como revisado**, si tu rol lo permite.
- **Cambiar severidad** (solo administradores): abre una ventana para decidir con qué severidad se guardan los avisos de ese tipo. Ver [Cambiar la severidad](02-guia-del-administrador.md#cambiar-la-severidad-de-un-tipo-de-log).

En los cambios de configuración del controlador, los datos incluyen **qué campo cambió y de qué valor a cuál** (por ejemplo `syslog: false → true`).

## Clientes

*Menú → Clientes → Todos los clientes.* Es la lista de todos los clientes creados, una tarjeta por cliente. **Toca una tarjeta para entrar a su espacio** y ver sus logs.

Cada tarjeta muestra:

- el **nombre**, el **puerto** y el **estado**: *Recibiendo*, *Esperando logs* (aún no llegó nada), *Sin señal* (más de 15 minutos sin recibir), *Apagado* o *Error de puerto* (encendido pero sin poder abrir el puerto);
- un gráfico con los **eventos por hora de las últimas 24 horas** (en rojo las horas con errores);
- los totales de **eventos, errores y avisos** de esas 24 horas;
- cuándo llegó el **último log** y **desde qué IP** envía;
- cuántos **incidentes abiertos** tiene;
- accesos directos a **Registros**, **En vivo** e **Incidentes**.

Arriba hay un resumen (clientes, recibiendo, con problemas, incidentes abiertos), un buscador por nombre o puerto y filtros *Todos / Con problemas / Recibiendo / Apagados*. Los que necesitan atención salen primero. La pantalla se actualiza sola cada 15 segundos.

Los administradores ven además *Nuevo cliente* y *Gestionar clientes*, donde se crean, editan, eliminan y se encienden o apagan los puertos (los operadores también pueden encender y apagar).

## Alertas

*Menú → Alertas.* Muestra las reglas que avisan por correo y la pestaña **Avisos enviados** con el historial. Los operadores las ven; solo los administradores las crean y cambian. Cómo funcionan: [Alertas y correo](09-alertas-y-correo.md).

## Mi cuenta

Toca tu nombre abajo en el menú para:

- cambiar tu **nombre**;
- cambiar tu **contraseña** (pide la actual; mínimo 10 caracteres).

## Qué puede hacer cada rol

| | Lector | Operador | Administrador | Superadmin |
|---|:-:|:-:|:-:|:-:|
| Ver resumen, en vivo, registros e incidentes | ✔ | ✔ | ✔ | ✔ |
| Ver clientes y su estado | ✔ | ✔ | ✔ | ✔ |
| Ver el mensaje original del syslog | — | ✔ | ✔ | ✔ |
| Marcar eventos como revisados y exportar CSV | — | ✔ | ✔ | ✔ |
| Encender y apagar puertos | — | ✔ | ✔ | ✔ |
| Ver las reglas de alerta | — | ✔ | ✔ | ✔ |
| Crear/eliminar clientes, reglas de alerta; correo; almacenamiento; usuarios; aprobar tipos de log | — | — | ✔ | ✔ |
| Ver la pantalla de roles y permisos | — | — | — | ✔ |

El detalle completo está en [Seguridad](10-seguridad.md#roles-y-permisos).

## Preguntas frecuentes

**No veo logs de un cliente.**
Revisa su punto en el menú. Apagado (círculo vacío): hay que encender su puerto. Verde pero sin eventos: el equipo no está enviando; mira [conectar equipos](03-conectar-equipos-omada.md). Rojo: la página del cliente explica por qué no se pudo abrir el puerto.

**¿Por qué la hora de un evento no coincide con la que muestra el router?**
La web muestra la hora en que el **servidor recibió** el mensaje, convertida a tu zona horaria. Algunos routers envían su hora local sin indicar la zona, por eso el sistema no la usa.

**Un problema aparece "Sin señal" pero el equipo funciona.**
Significa que no llegó ningún log en el tiempo configurado. Puede ser que el equipo no tenga nada que reportar, que el puerto esté apagado, o que el firewall del servidor bloquee ese puerto.

**¿Por qué un mismo problema aparece una sola vez si pasó muchas veces?**
Es a propósito: se agrupan los avisos iguales ("se repitió 388 veces") y los incidentes tienen un solo registro con su duración.

**¿Por qué algunos eventos no aparecen en Registros?**
Si es un tipo de log nuevo que un administrador todavía no aprobó, se guarda pero no se muestra hasta que lo apruebe. Si fue rechazado, ya no se guarda.

**Me bloquearon la cuenta por intentos fallidos.**
Espera 10 minutos. Si olvidaste tu contraseña, pide a un administrador que genere una nueva.
