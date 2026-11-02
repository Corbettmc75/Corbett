// Entry point: `npm start`. Configuration comes only from environment variables (see .env.example).
import { createServer } from './app.js';

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const server = createServer();
server.listen(port, host, () => {
  console.log(`The Corbett Method running at http://${host}:${port}`);
  console.log(`Drawing analysis: ${process.env.ANTHROPIC_API_KEY ? 'enabled (key loaded from environment)' : 'NOT configured — text-layer fallback only (set ANTHROPIC_API_KEY)'}`);
  if (!server.store.listUsers().length) console.log('No users yet. Create one: NEW_USER_PASSWORD=... npm run user:add -- --username corbett --name Corbett --role admin');
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
