// Crea las tablas y el primer superadmin. Se puede ejecutar más de una vez sin duplicar nada.
// Uso: npm run db:init            (genera una contraseña aleatoria y la muestra una sola vez)
//      SEED_PASSWORD=... npm run db:init
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { setupEvents, TZ } = require('./partitions');

const ADMIN = { name: 'Mauricio Cabello', email: 'mcabello@softkale.com', role: 'superadmin' };

async function main() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  console.log('Tablas listas.');
  const ev = await setupEvents();
  console.log(`Eventos particionados por día (zona horaria ${TZ}).${ev.migrated ? ` Se trasladaron ${ev.migrated} eventos anteriores.` : ''}`);

  const existing = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [ADMIN.email]);
  if (existing.rowCount) {
    console.log(`El usuario ${ADMIN.email} ya existe. No se modificó.`);
    return;
  }

  const password = process.env.SEED_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, status, must_change_password)
     VALUES ($1, $2, $3, $4, 'active', TRUE)`,
    [ADMIN.name, ADMIN.email, hash, ADMIN.role]
  );
  console.log('\nUsuario creado:');
  console.log(`  correo:     ${ADMIN.email}`);
  console.log(`  rol:        ${ADMIN.role}`);
  if (!process.env.SEED_PASSWORD) console.log(`  contraseña: ${password}   (guárdala ahora, no se vuelve a mostrar)`);
}

main()
  .catch((e) => { console.error('Error:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
