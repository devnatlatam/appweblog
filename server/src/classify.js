// Clasificación automática de logs que el sistema todavía no conoce.
// Cada mensaje desconocido recibe una "firma" (type_key) que agrupa los mensajes parecidos, y una categoría sugerida.
// Un administrador decide después si ese tipo se aprueba o se rechaza.

const CATEGORIES = ['Red', 'Firewall', 'Seguridad', 'Conectividad', 'Configuración', 'VPN', 'Sistema', 'Controlador', 'Otros'];

// El orden importa: gana la primera que coincide
const GUESSES = [
  ['Configuración', /\b(config|configuration|edited|added|deleted|created|updated|saved|changed|modified|setting|firmware|upgrade|reboot|restart)\w*/i],
  ['VPN', /\b(vpn|ipsec|l2tp|pptp|openvpn|wireguard|tunnel)\b/i],
  ['Seguridad', /\b(login|logon|logout|logged|auth\w*|password|ssh|telnet|brute|attack|intrusion|rogue|unauthori[sz]ed|failed|denied)\b/i],
  ['Firewall', /\b(firewall|acl|drop(ped)?|block(ed)?|allow(ed)?|nat|rule)\b/i],
  ['Conectividad', /\b(wan|link|interface|online|offline|disconnect\w*|connect\w*|heartbeat|ping|latency|up|down)\b/i],
  ['Red', /\b(dhcp|lease|ip|arp|dns|vlan|conflict\w*|client)\b/i],
  ['Sistema', /\b(cpu|memory|ram|temperature|disk|fan|power|poe|system|reset|boot)\b/i],
];

function guessCategory(text) {
  const t = String(text || '');
  const hit = GUESSES.find(([, re]) => re.test(t));
  return hit ? hit[0] : 'Otros';
}

// Quita lo que cambia de un mensaje a otro (números, IP, MAC, identificadores) para que los mensajes del mismo tipo
// compartan firma. Si queda largo, se conserva el inicio y el final, donde suele estar lo que identifica el tipo.
function skeleton(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  s = s
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/gi, '<mac>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>')
    .replace(/\b[0-9a-f]{24,}\b/gi, '<id>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<correo>')
    .replace(/\b\d+\b/g, '#');
  const words = s.split(' ');
  if (words.length > 7) s = `${words.slice(0, 2).join(' ')} … ${words.slice(-5).join(' ')}`;
  return s.slice(0, 140);
}

module.exports = { CATEGORIES, guessCategory, skeleton };
