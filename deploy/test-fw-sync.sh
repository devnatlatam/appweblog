#!/usr/bin/env bash
# Prueba del programa syslogweb-fw-sync con un "ufw" de mentira (no toca ningún firewall real).
# Uso: bash deploy/test-fw-sync.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/dir" "$T/state" "$T/bin"

# ufw de mentira: anota cada llamada y falla si el puerto es 5999 (para probar errores)
cat > "$T/bin/ufw" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
case "$*" in
  *"port 5999"*) echo "ERROR: simulado" >&2; exit 1 ;;
esac
exit 0
EOF
chmod +x "$T/bin/ufw"

export FAKE_LOG="$T/ufw.log" SYSLOGWEB_DIR="$T/dir" SYSLOGWEB_STATE="$T/state" UFW_BIN="$T/bin/ufw"
fails=0
ok() { if [[ $2 == 1 ]]; then echo "OK    $1"; else echo "FALLA $1"; fails=$((fails + 1)); fi; }
run() { bash "$HERE/syslogweb-fw-sync" 2>/dev/null; }
desired() { printf '# syslogweb\n# token=%s\n%s\n# end\n' "$1" "$2" > "$T/dir/firewall.desired"; }
status_has() { grep -q "$1" "$T/dir/firewall.status"; }
calls() { [[ -f $FAKE_LOG ]] && wc -l < "$FAKE_LOG" | tr -d ' ' || echo 0; }

# 1) abre dos puertos: uno para cualquier IP y otro con dos IP
desired aa01 $'udp 5514 any\nudp 5515 179.7.94.149,190.10.20.30'
run
ok "abre 3 reglas (1 + 2 IP)" $([[ $(calls) == 3 ]] && echo 1 || echo 0)
ok "estado ok con el mismo identificador" $(status_has '"token":"aa01","ok":true' && echo 1 || echo 0)
ok "una regla por IP" $(grep -q 'from 190.10.20.30 to any port 5515' "$T/ufw.log" && echo 1 || echo 0)

# 2) repetir lo mismo no vuelve a tocar nada
: > "$FAKE_LOG"; desired aa02 $'udp 5514 any\nudp 5515 179.7.94.149,190.10.20.30'; run
ok "sin cambios: no llama a ufw" $([[ $(calls) == 0 ]] && echo 1 || echo 0)
ok "aun así responde con el nuevo identificador" $(status_has '"token":"aa02","ok":true' && echo 1 || echo 0)

# 3) apagar un cliente cierra solo su regla
: > "$FAKE_LOG"; desired aa03 'udp 5515 179.7.94.149,190.10.20.30'; run
ok "cierra el puerto que ya no se pide" $(grep -q 'delete allow proto udp from any to any port 5514' "$T/ufw.log" && [[ $(calls) == 1 ]] && echo 1 || echo 0)

# 4) cambiar las IP: cierra las viejas y abre las nuevas
: > "$FAKE_LOG"; desired aa04 'udp 5515 179.7.94.149'; run
ok "cambio de IP: quita las 2 viejas y abre 1" $([[ $(grep -c delete "$FAKE_LOG") == 2 && $(grep -c allow "$FAKE_LOG") == 3 ]] && echo 1 || echo 0)

# 5) lo protegido se rechaza, aunque se pida
: > "$FAKE_LOG"; desired aa05 $'udp 5515 179.7.94.149\ntcp 22 any\ntcp 5432 any\ntcp 4000 any'; run
ok "puertos protegidos (22, 5432, 4000): no se abren" $([[ $(grep -c 'port 22\b\|port 5432\|port 4000' "$FAKE_LOG") == 0 ]] && echo 1 || echo 0)
ok "y se informa el error" $(status_has '"ok":false' && status_has 'protegido' && echo 1 || echo 0)

# 6) entradas inválidas
: > "$FAKE_LOG"; desired aa06 $'udp 5515 179.7.94.149\nicmp 5600 any\nudp 99999 any\nudp 5601 300.1.1.1\nudp 5602 any; rm -rf /\nudp 5603 1.1.1.1 extra'; run
ok "protocolo, puerto, IP o texto extra inválidos: no se aplican" $([[ $(grep -c 'port 56' "$FAKE_LOG") == 0 ]] && echo 1 || echo 0)
ok "el error no repite el contenido de la línea" $(! grep -q 'rm -rf' "$T/dir/firewall.status" && status_has 'Línea' && echo 1 || echo 0)

# 7) un fallo de ufw se informa y no se da por abierto
: > "$FAKE_LOG"; desired aa07 $'udp 5515 179.7.94.149\nudp 5999 any'; run
ok "fallo de ufw: estado con error" $(status_has '"token":"aa07","ok":false' && echo 1 || echo 0)
: > "$FAKE_LOG"; desired aa08 $'udp 5515 179.7.94.149\nudp 5999 any'; run
ok "se vuelve a intentar lo que falló" $(grep -q 'port 5999' "$FAKE_LOG" && echo 1 || echo 0)

# 8) archivo a medio escribir (sin "# end"): no se toca nada
: > "$FAKE_LOG"; printf '# token=aa09\nudp 7000 any\n' > "$T/dir/firewall.desired"; run
ok "lista incompleta: no se aplica" $([[ $(calls) == 0 ]] && echo 1 || echo 0)

# 9) enlace simbólico en lugar del archivo: se ignora
rm -f "$T/dir/firewall.desired"; ln -s /etc/hostname "$T/dir/firewall.desired" 2>/dev/null; : > "$FAKE_LOG"; run
ok "enlace simbólico: se ignora" $([[ $(calls) == 0 ]] && echo 1 || echo 0)

echo; if (( fails )); then echo "$fails PRUEBA(S) FALLARON"; exit 1; else echo "TODAS LAS PRUEBAS OK"; fi
