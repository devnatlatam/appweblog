# Operación y mantenimiento

Para quien mantiene el servidor en marcha. Los comandos asumen la instalación de [DESPLIEGUE.md](../DESPLIEGUE.md): servicio `syslogweb`, usuario `syslogweb`, carpeta `/opt/syslogweb`.

## Rutina

### Cada día (2 minutos)
- Abre el **Resumen general**: ¿todos los clientes con señal? ¿incidentes abiertos? ¿"Necesita tu atención"?
- Mira el contador de **Por aprobar** en el menú.

### Cada semana
- **Almacenamiento:** ¿el disco sube más de lo esperado? Compara con el ritmo de eventos por día.
- **Avisos enviados:** ¿hay correos fallidos?
- Revisa `journalctl -u syslogweb --since "7 days ago" -p warning` en busca de errores repetidos.

### Cada mes
- Prueba una **restauración** del respaldo en otra máquina (un respaldo que no se ha probado no es un respaldo).
- Revisa los **usuarios**: ¿alguien que ya no debería entrar?
- `npm audit` en `server/` y `client/`.

## El servicio

```bash
sudo systemctl status syslogweb        # ¿está vivo?
sudo systemctl restart syslogweb       # reiniciar (ver efectos abajo)
sudo journalctl -u syslogweb -f        # registros en vivo
sudo journalctl -u syslogweb --since "1 hour ago"
```

**Efectos de reiniciar:** durante unos segundos los puertos de los clientes están cerrados y **los mensajes UDP que lleguen en ese lapso se pierden**. Al volver, los puertos que estaban encendidos se reabren solos. Los navegadores reconectan el vivo por su cuenta. Los mensajes en cola que aún no se guardaron (como máximo unas décimas de segundo de tráfico, salvo que la base estuviera caída) se pierden.

**Si PostgreSQL se cae:** el servicio sigue recibiendo y retiene hasta 200.000 mensajes en memoria, reintentando guardarlos. Al volver la base se guardan. Si Node se reinicia mientras tanto, esa cola se pierde.

## Respaldos

### Hacerlos
Un respaldo diario de la base, por ejemplo con cron (como `root`):

```
0 3 * * *  sudo -u postgres pg_dump -Fc db_syslog > /var/backups/db_syslog_$(date +\%F).dump && find /var/backups -name 'db_syslog_*.dump' -mtime +14 -delete
```

Respalda también, **por separado y con acceso restringido**, el archivo `/opt/syslogweb/server/.env`: tiene las credenciales de la base y del correo y el secreto de sesiones. Sin él, un respaldo de la base es difícil de reponer.

> Los logs pesan: un respaldo completo de varias semanas de firewall puede ser grande. Si solo te interesa la configuración, respalda las tablas pequeñas (`users`, `clients_ports`, `alert_rules`, `log_types`, `settings`, `acl_names`) y deja los eventos con su propia política.

### Restaurar

```bash
sudo -u postgres createdb -O syslogweb db_syslog        # base vacía
sudo -u postgres pg_restore -d db_syslog --no-owner --role=syslogweb /var/backups/db_syslog_2026-10-02.dump
sudo systemctl restart syslogweb
```

Para mudarte a otro servidor: instala siguiendo [DESPLIEGUE.md](../DESPLIEGUE.md) **sin** ejecutar `db:init` con `--email`, restaura la base, copia el `.env`, y cambia en cada equipo Omada la dirección de destino del syslog (los puertos pueden ser los mismos).

## Recuperar el acceso

Si nadie puede entrar (el único administrador olvidó su contraseña, o su cuenta quedó desactivada), desde el servidor:

```bash
cd /opt/syslogweb/server
sudo -u syslogweb npm run user:reset -- --email tu@correo.com
```

Genera una contraseña temporal, **reactiva** la cuenta y obliga a cambiarla al entrar. Queda en la auditoría como `user.reset-cli`. Si el correo no existe, lista los que sí.

## Actualizar

Sigue [DESPLIEGUE.md § Actualizar la aplicación](../DESPLIEGUE.md#14-actualizar-la-aplicación). En resumen: subir el nuevo paquete, `npm ci`, `npm run db:init` (agrega tablas o columnas nuevas, sin tocar datos), reconstruir la web y reiniciar el servicio. El `.env` no se pisa.

## Espacio en disco

Medido: **~1.060 bytes por evento**. Sirve para estimar:

| Eventos por día | Por día | 30 días | 90 días |
|---|---|---|---|
| 25.000 | 25 MB | 0,75 GB | 2,2 GB |
| 100.000 | 100 MB | 3 GB | 9 GB |
| 500.000 | 500 MB | 15 GB | 45 GB |

El firewall suele ser más del 95 % del volumen. Palancas para bajarlo:

1. **Registrar menos en el equipo:** activar el syslog solo en las ACL que importan.
2. **Menos días de retención** (*Almacenamiento*).
3. Mantener el borrado por porcentaje de disco como red de seguridad (ver el aviso en la guía del administrador).

> **Aún no existe** la opción de guardar el firewall solo como resumen por minuto. *Agrupar repetidos* en Registros cambia cómo se ve, no cuánto ocupa.

Una partición por día significa **una tabla nueva cada día**: con retención de 90 días son ~90 tablas, una cantidad cómoda para PostgreSQL.

## Zona horaria

Los días de logs (particiones) y el borrado por días usan `APP_TIMEZONE`.

> **No cambies `APP_TIMEZONE` una vez que haya logs guardados.** Cada día ya tiene sus límites calculados con la zona anterior; con otra zona, la partición del día siguiente puede solaparse con una existente y PostgreSQL la rechazaría, de modo que **no se podrían guardar logs**. Es una consecuencia esperada del particionado y **no se ha probado**. Si debes cambiarla, hazlo con un desarrollador y con respaldo.

## Cambiar o mover un cliente

- **Cambiar el puerto:** apaga el cliente, edita el puerto, enciéndelo, y cambia el puerto en el equipo Omada. Hasta que lo cambies, el equipo enviará a un puerto cerrado y esos mensajes se perderán.
- **Reemplazar un router:** el cliente es el puerto, así que el router nuevo, apuntando al mismo puerto, continúa el mismo historial. El sistema avisará de una "Nueva IP de origen" y de los equipos nuevos que vea.
- **Eliminar un cliente:** ver [la guía del administrador](02-guia-del-administrador.md#editar-y-eliminar).

## Monitorear al monitor

El sistema avisa si un **cliente** deja de enviar (regla *Un cliente deja de enviar logs*). No puede avisar si **el propio servidor** está caído, porque el aviso sale de él. Pon una comprobación externa que consulte `https://logs.tu-dominio.com` cada pocos minutos (cualquier servicio de monitoreo gratuito sirve) y te avise por otro canal.

## Solución de problemas

| Síntoma | Qué revisar |
|---|---|
| Un cliente en rojo | Abre su página: dice por qué no pudo abrir el puerto (ocupado, sin permiso). Corrige y apágalo y enciéndelo. |
| Cliente verde pero sin eventos | `tcpdump` en el puerto ([conectar equipos](03-conectar-equipos-omada.md#comprobar-que-llegan)). Firewall del servidor y del proveedor. |
| "Sin señal" falso | ¿El equipo realmente genera logs? Un cliente que casi no tiene actividad parece callado. Sube los minutos de la regla. |
| Los logs llegan pero no se ven | ¿Es un tipo nuevo sin aprobar? Mira *Por aprobar*. ¿Fue rechazado? |
| El vivo dice "Reconectando…" | La API cayó o nginx no pasa `/ws`. `systemctl status syslogweb`, `nginx -t`. |
| `No se pudo guardar un lote de logs` en el registro | La base no responde o falta una partición. Revisa PostgreSQL y el espacio en disco. |
| El disco se llena | Sube la retención a menos días o borra días antiguos en *Almacenamiento*. No uses `DELETE` en SQL: no libera disco. |
| Las alertas no salen | ¿Correo configurado y probado? Mira *Alertas → Avisos enviados* para ver el error. ¿La regla está activa y apunta al cliente correcto? |
| La web no puede escribir el `.env` | `sudo chown syslogweb:syslogweb /opt/syslogweb/server/.env && sudo chmod 600 ...` |
| Los usuarios no pueden entrar (429) | Demasiados intentos fallidos; esperar 10 minutos o reiniciar el servicio. |
| Todas las sesiones cerradas tras un cambio | Normal si se cambió `JWT_SECRET`. |
