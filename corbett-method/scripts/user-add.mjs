// Create (or reset the password of) a user on this server. No invitations or emails are sent.
//   NEW_USER_PASSWORD=... npm run user:add -- --username corbett --name Corbett --role admin
//   npm run user:add -- --username courtney --name Courtney --role editor        (prompts for password)
//   add --reset to change the password of an existing user.
import { openDb } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const username = (opt('username') || '').trim().toLowerCase();
const name = opt('name') || username;
const role = opt('role') || 'editor';
const reset = args.includes('--reset');
if (!/^[a-z0-9._-]{2,40}$/.test(username)) { console.error('Usage: npm run user:add -- --username <name> [--name "Display"] [--role admin|editor|viewer] [--reset]'); process.exit(2); }
if (!['admin', 'editor', 'viewer'].includes(role)) { console.error('role must be admin, editor or viewer'); process.exit(2); }

async function promptHidden(q) {
  if (!process.stdin.isTTY) { console.error('Set NEW_USER_PASSWORD or run in a terminal.'); process.exit(2); }
  process.stdout.write(q);
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let pw = '';
    process.stdin.on('data', function onData(ch) {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData); process.stdout.write('\n'); resolve(pw); }
      else if (ch === '\u0003') process.exit(130);
      else if (ch === '\u007f') pw = pw.slice(0, -1);
      else pw += ch;
    });
  });
}

const pw = process.env.NEW_USER_PASSWORD || await promptHidden(`Password for ${username} (min 8 chars): `);
let hash;
try { hash = hashPassword(pw); } catch (e) { console.error(e.message); process.exit(2); }
const store = openDb();
if (store.userByUsername(username)) {
  if (!reset) { console.error(`User ${username} exists. Use --reset to change the password.`); process.exit(1); }
  store.setPassword(username, hash); console.log(`Password updated for ${username}.`);
} else {
  store.createUser({ username, name, role, pwHash: hash }); console.log(`Created ${role} ${username}.`);
}
store.close();
