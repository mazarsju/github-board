// Backend entry point.
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { claudeCli } from './claude.ts';
import { JiraClient } from './jira.ts';
import { JsonFileStore } from './store.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '127.0.0.1';
const dataFile = process.env.DATA_FILE || `${root}server/data/state.json`;
const { JIRA_URL, JIRA_EMAIL, JIRA_TOKEN } = process.env;
if (JIRA_TOKEN && !(JIRA_URL && JIRA_EMAIL)) console.warn('JIRA_TOKEN is set without JIRA_URL and JIRA_EMAIL: Jira is disabled.');
if (JIRA_URL && !JIRA_URL.startsWith('https://')) throw new Error('JIRA_URL must start with https://');

const app = createApp({
  store: new JsonFileStore(dataFile),
  envToken: process.env.GITHUB_TOKEN || undefined,
  staticDir: `${root}client/dist`,
  jira: JIRA_URL && JIRA_EMAIL && JIRA_TOKEN ? new JiraClient(JIRA_URL, JIRA_EMAIL, JIRA_TOKEN) : undefined,
  claude: claudeCli({ bin: process.env.CLAUDE_BIN || undefined, cwd: process.env.CLAUDE_CWD || undefined }),
});

app.listen(port, host, () => {
  console.log(`Github Board API on http://${host}:${port} (data: ${dataFile})`);
});
