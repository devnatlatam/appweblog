# Conectar equipos Omada

Cómo hacer que un router o el controlador Omada envíen sus logs a un cliente de Omada Logs, y cómo comprobar que llegan.

## La idea

Cada equipo (o sitio) envía su syslog a **la dirección del servidor + el puerto de su cliente**:

```
 Equipo Omada ──► IP_DEL_SERVIDOR : PUERTO_DEL_CLIENTE
```

El puerto es lo que identifica al cliente. Por eso:

- **Un puerto distinto por cliente.** No pongas al router y al controlador en el mismo.
- Varios equipos del mismo cliente **pueden compartir el puerto**: todos quedan dentro del mismo cliente.
- Si un router cambia de IP pública (por un enlace de respaldo, por ejemplo), **sigue siendo el mismo cliente** porque sigue usando el mismo puerto.

## Antes de tocar el equipo

1. En la web, crea el cliente con su puerto y **enciéndelo** ([Guía del administrador](02-guia-del-administrador.md#1-clientes-y-puertos)).
2. Confirma que el puerto está abierto en el firewall del servidor y en el del proveedor del VPS, si lo tiene. Con el firewall automático activo, ya está.
3. Ten a mano: la **IP o el dominio del servidor** y el **número de puerto**.

## Configurar el equipo

En Omada busca la opción de **servidor syslog remoto / registro remoto** (el nombre y la ubicación exactos cambian según el modelo y la versión del firmware). Ahí indica:

| Dato | Valor |
|---|---|
| Servidor / IP | La IP o dominio del servidor de Omada Logs |
| Puerto | El del cliente |
| Protocolo | El mismo que elegiste en el cliente (UDP o TCP) |

Dos puntos a revisar en el **firewall del router**:

- El syslog de las **reglas de firewall (ACL)** se activa **por regla**: cada ACL tiene su opción de registrar en syslog. Si no la activas, esa regla no genera logs de firewall.
- Un cambio de configuración de ACL desde el controlador aparece como "Cambio de configuración" y muestra qué campo cambió.

## Router y controlador son clientes distintos

| | Router (ej. ER7206) | Controlador Omada (nube o local) |
|---|---|---|
| Envía | DHCP, conflictos de IP, firewall (ACL), IPsec, detección de internet (WAN) | Cambios de configuración y reenvío de alertas |
| Formato | `modulo<nivel>: mensaje` | Texto con el sitio y JSON |
| Cliente recomendado | Uno por router/sitio | Uno para el controlador |

Si tienes varios routers dependientes de un mismo controlador, el controlador es **su propio cliente** con su propio puerto, y cada router otro.

## Comprobar que llegan

1. En la web, abre el cliente: debe tener punto **verde** y el *Último log* debe actualizarse.
2. En la pestaña **En vivo** deberían aparecer eventos.
3. Si no aparece nada, mira el servidor directamente:

```bash
# UDP: muestra los paquetes que llegan al puerto (cambia 5514 por el tuyo)
sudo tcpdump -n -A -i any udp port 5514 -c 5
# TCP
sudo tcpdump -n -A -i any tcp port 5514 -c 5
```

- **Si ves paquetes aquí pero no en la web:** el problema está en la aplicación o en que el cliente está apagado. Revisa el punto del cliente y los registros del servicio (`journalctl -u syslogweb -f`).
- **Si no ves paquetes:** nunca llegaron. Revisa el firewall del servidor, el del proveedor, la IP/puerto escritos en el equipo y que el equipo tenga salida a internet.

### Probar sin un equipo real

Desde cualquier equipo con PowerShell, envía una línea de prueba por UDP (cambia IP y puerto):

```powershell
$u = New-Object System.Net.Sockets.UdpClient
$b = [Text.Encoding]::UTF8.GetBytes('<13>Oct  2 20:40:00 prueba ER7206: 2026-10-02 20:40:00 dhcp_server<5>: [OMADA]DHCP Server allocated IP address 172.17.17.50 for the [client:aa:bb:cc:dd:ee:ff].')
$u.Send($b, $b.Length, 'IP_DEL_SERVIDOR', 5514)
```

Debe aparecer en **En vivo** como "El servidor DHCP asignó 172.17.17.50 al equipo aa:bb:cc:dd:ee:ff".

## Cosas que conviene saber

**La hora.** El sistema usa la hora en que **el servidor recibe** cada mensaje, no la que escribe el equipo. Los routers Omada envían su hora **local** sin indicar la zona; si se usara tal cual, quedaría corrida varias horas.

**Cambios de IP del router.** Cuando un cliente empieza a enviar desde una IP nueva, el sistema crea un evento **"Nueva IP de origen"** que dice la IP anterior y cuánto hacía que no se veía. Suele indicar que el router pasó a otro enlace. Es un buen candidato para una [alerta](09-alertas-y-correo.md).

**Mensajes con un "55" pegado.** Verás claves como `WAN355` o `10.10.0.3355` en el texto original. Es un detalle del firmware del router (un sufijo que se pega a la clave del problema). El sistema lo ignora y usa el dato correcto.

**El firewall genera muchísimo volumen.** Si registras todas las ACL, el firewall puede ser más del 95 % de los eventos. Mira [Almacenamiento](02-guia-del-administrador.md#5-almacenamiento-y-borrado) para calcular el espacio y *Registros → Agrupar repetidos* para leerlo cómodamente.

**UDP no confirma entrega.** Si el servidor está apagado o el puerto cerrado, los mensajes UDP se pierden sin aviso. TCP reintenta la conexión, pero los mensajes que el equipo no pudo entregar tampoco se guardan para después. Para detectar cortes usa una alerta de *cliente sin señal*.

**Tipos nuevos.** Si el equipo envía algo que el sistema no reconoce, no se pierde: aparece en *Por aprobar*. Ver [Tipos de log](08-tipos-de-log.md).
