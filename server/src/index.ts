// Point d'entrée du backend.
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { JsonFileStore } from './store.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '127.0.0.1';
const dataFile = process.env.DATA_FILE || `${root}server/data/state.json`;

const app = createApp({
  store: new JsonFileStore(dataFile),
  envToken: process.env.GITHUB_TOKEN || undefined,
  staticDir: `${root}client/dist`,
});

app.listen(port, host, () => {
  console.log(`Github Board API sur http://${host}:${port} (données : ${dataFile})`);
});
