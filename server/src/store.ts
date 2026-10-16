// Persistence of each GitHub user's personal state in a JSON file.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { migrate } from '../../shared/state.ts';
import type { AppState } from '../../shared/types.ts';

export interface StateStore {
  get(login: string): Promise<AppState>;
  set(login: string, state: AppState): Promise<void>;
}

type FileContent = { users: Record<string, Partial<AppState>> };

export class JsonFileStore implements StateStore {
  private file: string;
  private data: Promise<FileContent> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  private load(): Promise<FileContent> {
    this.data ??= readFile(this.file, 'utf8').then(
      (raw) => JSON.parse(raw) as FileContent,
      (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return { users: {} };
        throw err;
      },
    );
    return this.data;
  }

  async get(login: string): Promise<AppState> {
    const data = await this.load();
    return migrate(data.users[login] ?? {});
  }

  async set(login: string, state: AppState): Promise<void> {
    const data = await this.load();
    data.users[login] = state;
    // Serialized, atomic writes (temporary file, then rename).
    this.writing = this.writing.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2));
      await rename(tmp, this.file);
    });
    return this.writing;
  }
}

/** In-memory store (tests). */
export class MemoryStore implements StateStore {
  users = new Map<string, AppState>();

  async get(login: string): Promise<AppState> {
    return migrate(this.users.get(login) ?? {});
  }

  async set(login: string, state: AppState): Promise<void> {
    this.users.set(login, state);
  }
}
