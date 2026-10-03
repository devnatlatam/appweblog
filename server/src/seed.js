// Crea las tablas y, si todavía no hay ningún usuario, el primer administrador. Se puede ejecutar más de una vez sin riesgo.
// Los demás usuarios se crean desde la web (Administración → Usuarios).
//
// Primer uso (base de datos nueva):
//   npm run db:init -- --email tu@correo.com --name "Tu Nombre"
//   (o con variables: SEED_EMAIL, SEED_NAME y, si quieres elegirla tú, SEED_PASSWORD)
// Imprime una contraseña temporal una sola vez; el sistema pedirá cambiarla en el primer ingreso.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { setupEvents, TZ } = require('./partitions');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function main() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  console.log('Tablas listas.');
  const ev = await setupEvents();
  console.log(`Eventos particionados por día (zona horaria ${TZ}).${ev.migrated ? ` Se trasladaron ${ev.migrated} eventos anteriores.` : ''}`);

  // Solo se crea un usuario si no existe ninguno. Así, borrar un usuario desde la web nunca lo "revive" al actualizar.
  const { rows } = await pool.query('SELECT count(*) AS n FROM users');
  if (Number(rows[0].n) > 0) {
    console.log('Ya hay usuarios creados: no se agregó ninguno. Los demás se crean desde la web.');
    return;
  }

  const email = String(arg('email') || process.env.SEED_EMAIL || '').trim();
  const name = String(arg('name') || process.env.SEED_NAME || 'Administrador').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('\nNo hay ningún usuario todavía. Indica el correo del primer administrador:');
    console.error('  npm run db:init -- --email tu@correo.com --name "Tu Nombre"');
    process.exitCode = 1;
    return;
  }

  const password = process.env.SEED_PASSWORD || crypto.randomBytes(9).toString('base64url');
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, status, must_change_password)
     VALUES ($1, $2, $3, 'superadmin', 'active', TRUE)`,
    [name, email, await bcrypt.hash(password, 12)]
  );
  console.log('\nPrimer administrador creado:');
  console.log(`  nombre:     ${name}`);
  console.log(`  correo:     ${email}`);
  console.log('  rol:        superadmin');
  if (!process.env.SEED_PASSWORD) console.log(`  contraseña: ${password}   (guárdala ahora, no se vuelve a mostrar)`);
  console.log('  Al entrar, el sistema te pedirá crear una contraseña propia.');
}

main()
  .catch((e) => { console.error('Error:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
