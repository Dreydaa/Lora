// Faux Redis en mémoire : lib/memory.ts tourne pour de vrai, sans serveur.
export const store = new Map<string, unknown>();

export class Redis {
  static fromEnv() {
    return new Redis();
  }
  async get<T>(key: string) {
    return (store.has(key) ? store.get(key) : null) as T | null;
  }
  async set(key: string, value: unknown, _options?: unknown) {
    store.set(key, value);
    return "OK";
  }
  async del(key: string) {
    return store.delete(key) ? 1 : 0;
  }
}
