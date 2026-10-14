#!/usr/bin/env bash
# Actualiza Syslog Web desde git. Uso (en el servidor):
#
#   sudo syslogweb-update              # a lo último de main
#   sudo syslogweb-update v1.2.0       # a una versión (etiqueta) concreta; sirve también para volver atrás
#   sudo syslogweb-update --check      # solo mostrar qué cambios hay, sin instalar nada
#
# Hace respaldo de la base antes, trae el código, reinstala dependencias, aplica cambios de tablas,
# reconstruye la web y reinicia. Detalle: docs/15-instalacion-y-actualizacion.md
set -euo pipefail

# El script se copia y se ejecuta desde la copia: al cambiar de versión, git reemplaza este mismo archivo
# y bash se confundiría si lo leyera mientras cambia.
if [ -z "${SYSLOGWEB_UPDATE_COPY:-}" ]; then
  TMP_SCRIPT=$(mktemp)
  cp "$0" "$TMP_SCRIPT"
  SYSLOGWEB_UPDATE_COPY=1 exec bash "$TMP_SCRIPT" "$@"
fi

APP_USER=syslogweb
APP_DIR=/opt/syslogweb
DB_NAME=db_syslog
REF=main
CHECK_ONLY=0

for a in "$@"; do
  case "$a" in
    --check)   CHECK_ONLY=1 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    -*)        echo "Opción desconocida: $a" >&2; exit 1 ;;
    *)         REF="$a" ;;
  esac
done

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }
as_app() { runuser -u "$APP_USER" -- env HOME="$APP_DIR" GIT_TERMINAL_PROMPT=0 "$@"; }
g() { as_app git -C "$APP_DIR" "$@"; }

[ "$(id -u)" -eq 0 ] || die "Ejecútalo con sudo:  sudo syslogweb-update"
[ -d "$APP_DIR/.git" ] || die "$APP_DIR no es un repositorio git. ¿Se instaló con install.sh?"

# Un cambio local en un archivo versionado impediría actualizar
if [ -n "$(g status --porcelain --untracked-files=no)" ]; then
  g status --short --untracked-files=no
  die "Hay archivos modificados a mano en $APP_DIR (lista arriba). Descártalos con 'git -C $APP_DIR restore <archivo>' o guárdalos, y repite."
fi

# El repositorio es público: las instalaciones que se hicieron con clave de despliegue (SSH) pasan a HTTPS
OFFICIAL_REPO=https://github.com/devnatlatam/appweblog.git
case "$(g remote get-url origin)" in
  git@github.com:devnatlatam/appweblog.git|ssh://git@github.com/devnatlatam/appweblog.git)
    g remote set-url origin "$OFFICIAL_REPO"
    echo "Repositorio cambiado a $OFFICIAL_REPO (ya no hace falta la clave de despliegue)." ;;
esac

step "Buscando cambios"
g fetch -q --tags --force origin
OLD=$(g rev-parse HEAD)
if g rev-parse -q --verify "origin/$REF" >/dev/null; then TARGET="origin/$REF"; IS_BRANCH=1
elif g rev-parse -q --verify "$REF^{commit}" >/dev/null; then TARGET="$REF"; IS_BRANCH=0
else die "No existe la rama, etiqueta o commit '$REF'. Etiquetas disponibles: $(g tag | tail -5 | tr '\n' ' ')"; fi
NEW=$(g rev-parse "$TARGET^{commit}")

echo "Versión instalada: $(g log -1 --format='%h  %s  (%cd)' "$OLD")"
echo "Versión destino:   $(g log -1 --format='%h  %s  (%cd)' "$NEW")"
if [ "$OLD" = "$NEW" ]; then echo "Ya estás en esa versión. No hay nada que hacer."; exit 0; fi
if g merge-base --is-ancestor "$OLD" "$NEW"; then
  echo; echo "Cambios que llegan:"; g log --oneline "$OLD..$NEW" | head -30
else
  echo; echo "OJO: la versión destino es anterior o distinta a la instalada (volver atrás)."
fi
[ "$CHECK_ONLY" = 1 ] && exit 0

step "Respaldo de la base de datos"
install -d -m 700 /var/backups/syslogweb
BACKUP="/var/backups/syslogweb/antes-de-actualizar_$(date +%F_%H%M%S).dump"
ENV_DB=$(grep -E "^DB_NAME=" "$APP_DIR/server/.env" 2>/dev/null | tail -1 | cut -d= -f2-); DB_NAME=${ENV_DB:-$DB_NAME}
runuser -u postgres -- pg_dump -Fc "$DB_NAME" > "$BACKUP"
echo "Guardado en $BACKUP"

step "Trayendo el código"
if [ "$IS_BRANCH" = 1 ]; then g checkout -q -B "$REF" "$TARGET"; else g checkout -q --detach "$NEW"; fi

step "Dependencias y tablas"
as_app sh -c "cd $APP_DIR/server && npm ci --omit=dev --no-audit --no-fund && npm run --silent db:init"

step "Reconstruyendo la web"
as_app sh -c "cd $APP_DIR/client && npm ci --no-audit --no-fund && npm run build"

# Los servicios y el firewall viven fuera de /opt/syslogweb: se reinstalan solo si cambiaron
CHANGED=$(g diff --name-only "$OLD" "$NEW" -- deploy/ || true)
if echo "$CHANGED" | grep -q 'deploy/syslogweb\.service';  then cp "$APP_DIR/deploy/syslogweb.service" /etc/systemd/system/; RELOAD=1; fi
if echo "$CHANGED" | grep -q 'deploy/syslogweb-fw-sync';  then install -o root -g root -m 750 "$APP_DIR/deploy/syslogweb-fw-sync" /usr/local/sbin/syslogweb-fw-sync; echo "Aplicador del firewall actualizado."; fi
if echo "$CHANGED" | grep -qE 'deploy/syslogweb-fw\.(path|service)'; then
  cp "$APP_DIR/deploy/syslogweb-fw.path" "$APP_DIR/deploy/syslogweb-fw.service" /etc/systemd/system/; RELOAD=1
fi
[ "${RELOAD:-0}" = 1 ] && { systemctl daemon-reload; systemctl try-restart syslogweb-fw.path; echo "Servicios de systemd actualizados."; }

step "Reiniciando"
systemctl restart syslogweb
sleep 2
systemctl is-active --quiet syslogweb || {
  journalctl -u syslogweb -n 20 --no-pager
  die "El servicio no arrancó. Para volver atrás:  sudo syslogweb-update $(g rev-parse --short "$OLD")   (respaldo: $BACKUP)"
}

if echo "$CHANGED" | grep -q 'deploy/nginx-syslogweb.conf'; then
  echo
  echo "AVISO: cambió la plantilla de nginx. No se aplica sola porque certbot modificó tu archivo."
  echo "Revisa:  git -C $APP_DIR diff $OLD $NEW -- deploy/nginx-syslogweb.conf"
fi

printf '\n\033[1;32mActualizado a %s\033[0m  (respaldo previo: %s)\n' "$(g log -1 --format='%h  %s' "$NEW")" "$BACKUP"
