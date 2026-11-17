import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Db, Store } from './types';

const clone = <T>(value: T): T => structuredClone(value);

/** In-memory store for tests. Reads return copies so callers cannot mutate state by accident. */
export class MemoryStore implements Store {
  private db: Db;
  constructor(initial: Db) {
    this.db = clone(initial);
  }
  read(): Db {
    return clone(this.db);
  }
  update<T>(mutate: (db: Db) => T): T {
    const draft = clone(this.db);
    const result = mutate(draft);
    this.db = draft;
    return clone(result);
  }
  replace(db: Db): void {
    this.db = clone(db);
  }
}

/** JSON file store: the local default. Writes go to a temp file first, then an atomic rename. */
export class JsonFileStore implements Store {
  private constructor(
    private readonly path: string,
    private cache: Db,
  ) {}

  /** Opens the store at `path`, creating it from `seed` when the file does not exist yet. */
  static async open(path: string, seed: () => Promise<Db>): Promise<JsonFileStore> {
    if (existsSync(path)) return new JsonFileStore(path, JSON.parse(readFileSync(path, 'utf8')) as Db);
    const store = new JsonFileStore(path, await seed());
    store.persist();
    return store;
  }

  read(): Db {
    return clone(this.cache);
  }
  update<T>(mutate: (db: Db) => T): T {
    const draft = clone(this.cache);
    const result = mutate(draft);
    this.cache = draft;
    this.persist();
    return clone(result);
  }
  replace(db: Db): void {
    this.cache = clone(db);
    this.persist();
  }
  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cache, null, 2));
    renameSync(tmp, this.path);
  }
}
