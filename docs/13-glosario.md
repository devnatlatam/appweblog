# Glosario

Los términos que aparecen en la web y en la documentación, en orden alfabético.

| Término | Significado |
|---|---|
| **ACL** | *Access Control List.* Regla del firewall del router que permite o bloquea cierto tráfico. En los logs aparece con un número; el controlador informa su nombre. |
| **Aprobar / Rechazar** | Decisión del administrador sobre un tipo de log nuevo. Aprobado se muestra; rechazado se descarta. |
| **Aviso** | Severidad intermedia: algo inusual que conviene revisar. También se usa para un correo de alerta. |
| **bcrypt** | Forma de guardar las contraseñas que impide leerlas aunque se robe la base de datos. |
| **Categoría** | Agrupación temática de un evento: Red, Firewall, Seguridad, Conectividad, Configuración, VPN, Sistema, Controlador, Otros. |
| **Cliente** | Un sitio o equipo que envía logs. Se identifica por su **puerto**. Tiene su propio espacio en la web. |
| **Colector** | La parte del servidor que escucha los puertos y recibe los mensajes. |
| **Conflicto de IP** | Dos equipos usando la misma dirección IP, lo que provoca cortes intermitentes en ambos. |
| **Controlador (Omada)** | El programa o servicio que administra los equipos Omada de uno o varios sitios. Puede estar en la nube o en un equipo local. |
| **Cuarentena** | Ver *Por aprobar*. |
| **DHCP** | Servicio que le asigna una dirección IP a cada equipo cuando se conecta. |
| **DHCP intruso (rogue)** | Un equipo que no debería, repartiendo direcciones en la red. Puede dejar sin conexión a los demás. |
| **DPD** | *Dead Peer Detection.* Mecanismo de un túnel VPN para notar que el otro extremo dejó de responder. |
| **ER7206** | Modelo de router TP-Link Omada, de los que envían logs a este sistema. |
| **Evento** | Un mensaje de log ya interpretado y guardado. |
| **Failover** | Cambio automático a un camino de respaldo cuando falla el principal (otro enlace a internet, otro túnel VPN). |
| **Firma** | Versión de un mensaje sin sus números, IP y MAC, para reconocer mensajes del mismo tipo. |
| **Firewall** | Filtro que decide qué tráfico pasa. Aquí son dos: el del router (cuyas reglas generan logs) y el del servidor (`ufw`, que decide quién puede enviar a cada puerto). |
| **Incidente** | Un problema con inicio y fin (internet caído, VPN caída, conflicto de IP, DHCP intruso). Abierto mientras dura; resuelto cuando termina. |
| **IPsec** | Tecnología de los túneles VPN entre sedes. |
| **JWT** | Credencial firmada que la web recibe al iniciar sesión y envía en cada petición. Dura 8 horas. |
| **MAC** | Dirección física de la tarjeta de red de un equipo. |
| **MAC privada / aleatoria** | Dirección que los celulares modernos inventan por cada red Wi-Fi para no ser rastreados. Puede cambiar con el tiempo. |
| **Módulo** | Nombre interno del tipo de mensaje (`dhcp_server`, `firewall`, `ipsec`…). |
| **Operador** | Nivel de acceso: atiende el día a día. |
| **Partición** | Cada tabla diaria de eventos. Borrar un día = borrar su partición. |
| **Puerto** | Número que identifica por dónde llegan los logs de un cliente. |
| **Por aprobar** | Lista de tipos de log nuevos esperando la decisión de un administrador. Mientras tanto, sus mensajes se guardan ocultos. |
| **PostgreSQL** | La base de datos donde se guardan los logs y todo lo demás. |
| **Retención** | Cuánto tiempo se conservan los logs antes de borrarse automáticamente. |
| **Revisado** | Marca de que ya miraste un evento o problema. |
| **RBAC** | Control de acceso por roles. |
| **Severidad** | Gravedad de un evento: Crítico, Error, Aviso, Info. Corresponde a los niveles 0–7 de syslog. |
| **SMTP** | Protocolo para enviar correo. Hay que configurar un servidor SMTP para las alertas. |
| **Starlink** | Servicio de internet satelital. En esta documentación aparece como ejemplo de un enlace de respaldo cuya IP pública cambia. |
| **STARTTLS / SSL/TLS** | Dos formas de cifrar la conexión con el servidor de correo. |
| **Syslog** | Estándar con el que los equipos de red envían sus mensajes de registro. |
| **Tiempo mínimo entre avisos** | Cuánto debe pasar antes de que una alerta pueda repetir el mismo correo. |
| **UDP / TCP** | Dos formas de enviar datos por la red. UDP es rápido pero no confirma entrega; TCP sí. |
| **ufw** | Programa de firewall de Linux (Debian/Ubuntu). |
| **VPN** | Conexión privada entre sedes a través de internet. |
| **WAN** | La salida del router hacia internet. Un router puede tener varias (WAN1, WAN2, WAN3). |
| **WebSocket** | Conexión que permite al servidor enviar a tu navegador los logs apenas llegan (el "En vivo"). |
