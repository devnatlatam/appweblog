// Recuperar el acceso cuando nadie puede entrar (por ejemplo, el único administrador olvidó su contraseña).
// Genera una contraseña temporal para un usuario existente, lo reactiva y le exige cambiarla al entrar.
// Se ejecuta en el servidor, así que quien lo usa ya tiene acceso al equipo y a la base de datos.
//
//   npm run user:reset -- --email tu@correo.com
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('./db');

const i = process.argv.indexOf('--email');
const email = i > -1 ? String(process.argv[i + 1] || '').trim() : '';

async function main() {
  if (!email) {
    console.error('Indica el correo del usuario:\n  npm run user:reset -- --email tu@correo.com');
    process.exitCode = 1;
    return;
  }
  const password = crypto.randomBytes(9).toString('base64url');
  const { rows } = await pool.query(
    `UPDATE users SET password_hash = $1, must_change_password = TRUE, status = 'active'
     WHERE lower(email) = lower($2) RETURNING name, email, role`,
    [await bcrypt.hash(password, 12), email]
  );
  if (!rows[0]) {
    const all = await pool.query('SELECT email FROM users ORDER BY id');
    console.error(`No existe un usuario con el correo “${email}”.${all.rowCount ? `\nUsuarios que existen: ${all.rows.map((r) => r.email).join(', ')}` : '\nNo hay ningún usuario: usa «npm run db:init -- --email ...» para crear el primero.'}`);
    process.exitCode = 1;
    return;
  }
  await pool.query("INSERT INTO audit_log (action, detail) VALUES ('user.reset-cli', $1)", [JSON.stringify({ email: rows[0].email })]).catch(() => {});
  console.log(`\nContraseña restablecida para ${rows[0].name} (${rows[0].email}, ${rows[0].role}):`);
  console.log(`  contraseña temporal: ${password}   (guárdala ahora, no se vuelve a mostrar)`);
  console.log('  Al entrar, el sistema pedirá crear una contraseña propia.');
}

main()
  .catch((e) => { console.error('Error:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
