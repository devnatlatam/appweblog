#!/usr/bin/env bash
# Instalador de Syslog Web (Omada Logs) para Debian 12 / Ubuntu. Instala TODO con un solo comando:
#
#   sudo bash install.sh --domain logs.tu-dominio.com --email tu@correo.com --name "Tu Nombre"
#
# Se puede ejecutar más de una vez sin riesgo: lo que ya existe no se toca (base de datos, .env, claves, usuarios).
# Detalle de cada paso y de las opciones: docs/15-instalacion-y-actualizacion.md
set -euo pipefail

REPO="${REPO:-git@github.com:devnatlatam/weblog.git}"
BRANCH="${BRANCH:-main}"
APP_USER=syslogweb
APP_DIR=/opt/syslogweb
DB_NAME=db_syslog
DOMAIN="${DOMAIN:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_NAME="${ADMIN_NAME:-Administrador}"
TIMEZONE="${APP_TIMEZONE:-America/Lima}"
HTTPS=1
FIREWALL=1
ASSUME_YES=0

usage() {
  cat <<'EOF'
Uso: sudo bash install.sh [opciones]

  --domain  DOMINIO   Dirección de la web (ej. logs.tu-dominio.com). Sin ella se instala solo por IP y sin HTTPS.
  --email   CORREO    Correo del primer administrador (también lo usa Let's Encrypt).
  --name    NOMBRE    Nombre del primer administrador.
  --repo    URL       Repositorio git (por defecto el oficial).
  --branch  RAMA      Rama o etiqueta a instalar (por defecto main).
  --timezone ZONA     Zona horaria de los días de logs (por defecto America/Lima).
  --no-https          No pedir certificado HTTPS.
  --no-firewall       No tocar el firewall (ufw).
  --yes               No hacer preguntas.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)      DOMAIN="${2:-}"; shift 2 ;;
    --email)       ADMIN_EMAIL="${2:-}"; shift 2 ;;
    --name)        ADMIN_NAME="${2:-}"; shift 2 ;;
    --repo)        REPO="${2:-}"; shift 2 ;;
    --branch)      BRANCH="${2:-}"; shift 2 ;;
    --timezone)    TIMEZONE="${2:-}"; shift 2 ;;
    --no-https)    HTTPS=0; shift ;;
    --no-firewall) FIREWALL=0; shift ;;
    --yes|-y)      ASSUME_YES=1; shift ;;
    -h|--help)     usage; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; usage; exit 1 ;;
  esac
done

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[aviso]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }
# Las preguntas se leen del teclado aunque el script llegue por una tubería (curl ... | sudo bash)
ask() { # ask "pregunta" variable
  local answer=""
  if [ "$ASSUME_YES" = 1 ] || [ ! -r /dev/tty ]; then return 0; fi
  read -r -p "$1 " answer < /dev/tty || true
  printf -v "$2" '%s' "$answer"
}
as_app() { runuser -u "$APP_USER" -- env HOME="$APP_DIR" GIT_TERMINAL_PROMPT=0 "$@"; }

# ───────── 0. Comprobaciones ─────────
[ "$(id -u)" -eq 0 ] || die "Ejecútalo con sudo:  sudo bash install.sh ..."
command -v apt-get >/dev/null || die "Este instalador es para Debian/Ubuntu (usa apt)."

if [ -z "$ADMIN_EMAIL" ]; then ask "Correo del primer administrador:" ADMIN_EMAIL; fi
if [ -z "$DOMAIN" ] && [ "$HTTPS" = 1 ]; then
  ask "Dominio de la web (ej. logs.tu-dominio.com; deja vacío para instalar solo por IP):" DOMAIN
fi
[[ "$ADMIN_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] \
  || warn "Sin correo válido no se creará el primer usuario (si la base ya tiene usuarios no hace falta)."
if [ -z "$DOMAIN" ]; then HTTPS=0; fi
[[ -z "$DOMAIN" || "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "El dominio '$DOMAIN' no es válido."

# ───────── 1. Paquetes ─────────
step "1/10 Instalando paquetes del sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git openssl postgresql nginx ufw cron >/dev/null
[ "$HTTPS" = 1 ] && apt-get install -y -qq certbot python3-certbot-nginx >/dev/null

# ───────── 2. Node.js 20 o superior ─────────
step "2/10 Node.js"
node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' || echo 0; }
if [ "$(node_major)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "Node $(node -v)"

# ───────── 3. Usuario del sistema ─────────
step "3/10 Usuario del sistema ($APP_USER)"
id "$APP_USER" >/dev/null 2>&1 || adduser --system --group --home "$APP_DIR" "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"

# ───────── 4. Código desde git ─────────
step "4/10 Descargando el código ($REPO, $BRANCH)"
GIT_URL="$REPO"
export GIT_TERMINAL_PROMPT=0
if ! git ls-remote "$GIT_URL" >/dev/null 2>&1 && ! as_app git ls-remote "$GIT_URL" >/dev/null 2>&1; then
  # Repositorio privado: se crea una clave de solo lectura y se espera a que la registres en GitHub
  KEY="$APP_DIR/.ssh/id_ed25519"
  if [ ! -f "$KEY" ]; then
    as_app mkdir -p -m 700 "$APP_DIR/.ssh"
    as_app ssh-keygen -q -t ed25519 -N "" -C "syslogweb-$(hostname)" -f "$KEY"
  fi
  GIT_URL=$(printf '%s' "$REPO" | sed -E 's#^https://github.com/([^/]+/[^/.]+)(\.git)?$#git@github.com:\1.git#')
  as_app sh -c "ssh-keyscan -t ed25519 github.com >> $APP_DIR/.ssh/known_hosts 2>/dev/null"
  export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o UserKnownHostsFile=$APP_DIR/.ssh/known_hosts"
  until as_app env GIT_SSH_COMMAND="$GIT_SSH_COMMAND" git ls-remote "$GIT_URL" >/dev/null 2>&1; do
    if [ "$ASSUME_YES" = 1 ] || [ ! -r /dev/tty ]; then
      echo "Clave de despliegue (regístrala en GitHub → Settings → Deploy keys):"; cat "$KEY.pub"
      die "El repositorio es privado y el servidor aún no tiene permiso. Registra la clave y repite el comando."
    fi
    echo
    echo "El repositorio es privado. Registra esta clave en GitHub:"
    echo "  Repositorio → Settings → Deploy keys → Add deploy key  (deja SIN marcar 'Allow write access')"
    echo
    cat "$KEY.pub"
    echo
    ask "Cuando la hayas guardado en GitHub, pulsa Enter para continuar..." _
  done
fi
GITRUN() { as_app env ${GIT_SSH_COMMAND:+GIT_SSH_COMMAND="$GIT_SSH_COMMAND"} git -C "$APP_DIR" "$@"; }
if [ ! -d "$APP_DIR/.git" ]; then
  GITRUN init -q -b main
  GITRUN remote add origin "$GIT_URL"
fi
GITRUN remote set-url origin "$GIT_URL"
GITRUN fetch -q --tags origin
if GITRUN rev-parse -q --verify "origin/$BRANCH" >/dev/null; then
  GITRUN checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  GITRUN checkout -q "$BRANCH"
fi
# Los archivos ejecutables no deben aparecer como "modificados" por sus permisos
GITRUN config core.fileMode false
echo "Versión: $(GITRUN log -1 --format='%h  %s  (%cd)')"

# ───────── 5. Base de datos ─────────
step "5/10 Base de datos (PostgreSQL)"
systemctl enable --now postgresql >/dev/null 2>&1 || true
# Esperar a que acepte conexiones (en la primera instalación puede tardar unos segundos)
for _ in $(seq 1 30); do runuser -u postgres -- pg_isready -q && break; sleep 1; done
runuser -u postgres -- pg_isready -q || die "PostgreSQL no arrancó. Revisa: systemctl status postgresql"
echo "PostgreSQL $(runuser -u postgres -- psql -tA -c 'SHOW server_version')"

ENV_FILE="$APP_DIR/server/.env"
NEW_ENV=0
[ -f "$ENV_FILE" ] || NEW_ENV=1
env_get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -E "s/^['\"]//; s/['\"]$//"; }
if [ "$NEW_ENV" = 1 ]; then
  DB_USER="$APP_USER"
  DB_PASSWORD=$(openssl rand -hex 24)
  JWT_SECRET=$(openssl rand -hex 48)
else
  # Reinstalación: se respetan los datos de conexión que ya hay en el .env
  DB_USER=$(env_get DB_USER); DB_USER=${DB_USER:-$APP_USER}
  DB_NAME=$(env_get DB_NAME); DB_NAME=${DB_NAME:-db_syslog}
  DB_PASSWORD=$(env_get DB_PASSWORD)
  [ -n "$DB_PASSWORD" ] || die "server/.env existe pero no tiene DB_PASSWORD. Complétalo o bórralo para empezar de cero."
fi
[[ "$DB_USER" =~ ^[a-z_][a-z0-9_]*$ && "$DB_NAME" =~ ^[a-z_][a-z0-9_]*$ ]] || die "DB_USER/DB_NAME deben ser solo letras minúsculas, números y _."
[[ "$DB_PASSWORD" =~ ^[A-Za-z0-9]+$ ]] || die "La clave de la base en el .env tiene caracteres especiales; el instalador solo maneja letras y números."

PSQL() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tA "$@"; }
# Rol: se crea si falta; si existe, se deja con la clave del .env (así .env y base siempre coinciden)
if [ "$(PSQL -c "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'")" = 1 ]; then
  PSQL -c "ALTER ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD'" >/dev/null
else
  PSQL -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD'" >/dev/null
  echo "Usuario de base '$DB_USER' creado."
fi
if [ "$(PSQL -c "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")" != 1 ]; then
  PSQL -c "CREATE DATABASE $DB_NAME OWNER $DB_USER" >/dev/null
  echo "Base '$DB_NAME' creada."
else
  PSQL -c "ALTER DATABASE $DB_NAME OWNER TO $DB_USER" >/dev/null
  echo "Base '$DB_NAME' ya existía."
fi
# Prueba real, igual que la hará la app: por TCP y con la clave
PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT 1' >/dev/null \
  || die "La app no podrá conectarse a la base como '$DB_USER'. Revisa /etc/postgresql/*/main/pg_hba.conf (debe permitir scram-sha-256 o md5 en 127.0.0.1)."
echo "Conexión a la base comprobada."

# ───────── 6. Configuración (.env) ─────────
step "6/10 Configuración (server/.env)"
set_env() { # set_env CLAVE VALOR  (reemplaza la línea o la agrega; los valores no llevan caracteres especiales)
  if grep -qE "^$1=" "$ENV_FILE"; then sed -i -E "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
if [ "$NEW_ENV" = 1 ]; then
  as_app cp "$APP_DIR/server/.env.example" "$ENV_FILE"
  set_env DB_USER "$DB_USER"
  set_env DB_NAME "$DB_NAME"
  set_env DB_PASSWORD "$DB_PASSWORD"
  set_env JWT_SECRET "$JWT_SECRET"
  set_env HOST 127.0.0.1
  set_env PORT 4000
  set_env APP_TIMEZONE "$TIMEZONE"
  [ "$FIREWALL" = 1 ] && set_env FIREWALL_DRIVER ufw
  if [ -n "$DOMAIN" ]; then
    if [ "$HTTPS" = 1 ]; then set_env APP_URL "https://$DOMAIN"; else set_env APP_URL "http://$DOMAIN"; fi
  fi
  echo "Archivo .env creado con claves nuevas."
else
  echo "Ya existía server/.env: se conserva tal cual."
fi
chown "$APP_USER:$APP_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"

# ───────── 7. Dependencias, tablas y primer usuario ─────────
step "7/10 Dependencias y tablas"
as_app sh -c "cd $APP_DIR/server && npm ci --omit=dev --no-audit --no-fund"
SEED_LOG=$(mktemp)
trap 'rm -f "$SEED_LOG"' EXIT
SEED_ARGS=()
[[ "$ADMIN_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] && SEED_ARGS=(--email "$ADMIN_EMAIL" --name "$ADMIN_NAME")
as_app sh -c 'cd "$1" && shift && npm run --silent db:init -- "$@"' _ "$APP_DIR/server" "${SEED_ARGS[@]}" | tee "$SEED_LOG"

# ───────── 8. La web (build) ─────────
step "8/10 Construyendo la web"
as_app sh -c "cd $APP_DIR/client && npm ci --no-audit --no-fund && npm run build"

# ───────── 9. Servicios, nginx y HTTPS ─────────
step "9/10 Servicios y nginx"
cp "$APP_DIR/deploy/syslogweb.service" /etc/systemd/system/
install -d -o "$APP_USER" -g "$APP_USER" -m 755 /var/lib/syslogweb
install -o root -g root -m 750 "$APP_DIR/deploy/syslogweb-fw-sync" /usr/local/sbin/syslogweb-fw-sync
cp "$APP_DIR/deploy/syslogweb-fw.path" "$APP_DIR/deploy/syslogweb-fw.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now syslogweb >/dev/null
[ "$FIREWALL" = 1 ] && systemctl enable --now syslogweb-fw.path syslogweb-fw.service >/dev/null 2>&1 || true
systemctl restart syslogweb

# nginx: no se pisa un sitio ya configurado (certbot lo modifica); solo se crea la primera vez
NGINX_SITE=/etc/nginx/sites-available/syslogweb
if [ ! -f "$NGINX_SITE" ]; then
  if [ -n "$DOMAIN" ]; then
    sed "s/logs\.tu-dominio\.com/$DOMAIN/" "$APP_DIR/deploy/nginx-syslogweb.conf" > "$NGINX_SITE"
  else
    # Por IP: este sitio solo puede ser el predeterminado si no hay otro (nginx rechaza dos)
    DEFAULT_OPT=" default_server"
    if grep -rqE 'listen[^;]*default_server' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null; then
      DEFAULT_OPT=""
      warn "Este servidor ya tiene otro sitio en nginx como predeterminado: entrar por la IP mostrará ESE sitio, no Syslog Web."
      warn "Usa un dominio (puede ser gratuito: IP-con-guiones.sslip.io) y repite el instalador con --domain."
    fi
    sed -e "s/listen 80;/listen 80$DEFAULT_OPT;/" -e 's/server_name logs\.tu-dominio\.com;/server_name _;/' \
      "$APP_DIR/deploy/nginx-syslogweb.conf" > "$NGINX_SITE"
  fi
fi
ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/syslogweb
# Solo se retira el sitio de bienvenida de nginx; los demás sitios del servidor no se tocan
if [ "$(readlink -f /etc/nginx/sites-enabled/default 2>/dev/null)" = /etc/nginx/sites-available/default ]; then
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl reload nginx

HTTPS_OK=0
if [ "$HTTPS" = 1 ]; then
  CERT_MAIL=(--register-unsafely-without-email)
  [[ "$ADMIN_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] && CERT_MAIL=(-m "$ADMIN_EMAIL")
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect "${CERT_MAIL[@]}"; then
    HTTPS_OK=1
  else
    warn "No se pudo obtener el certificado HTTPS. Casi siempre es porque '$DOMAIN' aún no apunta a la IP de este servidor."
    warn "Cuando apunte, ejecuta:  sudo certbot --nginx -d $DOMAIN"
  fi
fi

# ───────── 10. Firewall y respaldo diario ─────────
step "10/10 Firewall y respaldo diario"
if [ "$FIREWALL" = 1 ]; then
  SSH_PORT=$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}' || true)
  SSH_PORT=${SSH_PORT:-22}
  if ufw status | grep -q '^Status: active'; then
    # Ya hay un firewall en uso: solo se agregan nuestras reglas, no se cambian sus políticas
    ufw allow "$SSH_PORT/tcp" >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
    echo "ufw ya estaba activo: se agregaron SSH ($SSH_PORT), 80 y 443."
  else
    # No se enciende un firewall nuevo en un servidor que ya presta otros servicios: los dejaría sin acceso
    OTHERS=$(ss -Hltun 2>/dev/null | awk '$5 !~ /^(127\.|\[::1\]|\[::ffff:127)/ {n=split($5,a,":"); print a[n]}' \
      | sort -un | grep -vxE "$SSH_PORT|80|443|68|0|53" | tr '\n' ' ' || true)
    if [ -n "$OTHERS" ]; then
      warn "NO se activó el firewall: este servidor ya escucha en otros puertos ($OTHERS) y se cortarían."
      warn "Decide tú qué abrir (ufw allow ...) y luego: sudo ufw enable. Mientras, usa el firewall del proveedor."
      set_env FIREWALL_DRIVER none
    else
      ufw default deny incoming >/dev/null
      ufw default allow outgoing >/dev/null
      ufw allow "$SSH_PORT/tcp" >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
      ufw --force enable >/dev/null
      echo "ufw activo: SSH ($SSH_PORT), 80 y 443. Los puertos de cada cliente los abre la web al encenderlo."
    fi
  fi
  systemctl start syslogweb-fw.service >/dev/null 2>&1 || true
else
  warn "Firewall sin tocar. Abre tú los puertos 80, 443 y los de syslog de cada cliente."
fi

install -d -m 700 /var/backups/syslogweb
cat > /etc/cron.d/syslogweb-backup <<EOF
# Respaldo diario de la base de datos de Syslog Web (se conservan 14 días)
0 3 * * * root runuser -u postgres -- pg_dump -Fc $DB_NAME > /var/backups/syslogweb/db_syslog_\$(date +\%F).dump && find /var/backups/syslogweb -name 'db_syslog_*.dump' -mtime +14 -delete
EOF
chmod 644 /etc/cron.d/syslogweb-backup

# Comando corto para actualizar:  sudo syslogweb-update
cat > /usr/local/bin/syslogweb-update <<EOF
#!/bin/sh
exec bash $APP_DIR/deploy/update.sh "\$@"
EOF
chmod 755 /usr/local/bin/syslogweb-update

# ───────── Resumen ─────────
sleep 2
systemctl is-active --quiet syslogweb || { journalctl -u syslogweb -n 20 --no-pager; die "El servicio syslogweb no arrancó (ver arriba)."; }
if [ -n "$DOMAIN" ]; then
  [ "$HTTPS_OK" = 1 ] && URL="https://$DOMAIN" || URL="http://$DOMAIN"
else
  URL="http://$(hostname -I | awk '{print $1}')"
fi
PASS_LINE=$(grep 'contraseña:' "$SEED_LOG" || true)

printf '\n\033[1;32m============================================================\n'
printf ' Instalación terminada\n'
printf '============================================================\033[0m\n'
echo " Web:        $URL"
if [ -n "$PASS_LINE" ]; then
  echo " Usuario:    $ADMIN_EMAIL"
  echo "$PASS_LINE" | sed 's/^ */ /'
  echo " (Se muestra una sola vez. Al entrar te pedirá crear una contraseña propia.)"
else
  echo " Usuarios:   ya existían; no se creó ninguno nuevo."
fi
echo
echo " Siguientes pasos:"
echo "   1. Entra a la web y, en Administración → Correo, configura el SMTP."
echo "   2. Crea el primer cliente (Gestionar clientes) y apunta su equipo Omada al puerto que elijas."
echo "   3. Actualizar en el futuro:   sudo syslogweb-update"
echo "   4. Respaldos diarios en /var/backups/syslogweb (guarda también $ENV_FILE por separado)."
