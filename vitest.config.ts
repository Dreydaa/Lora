import { defineConfig } from "vitest/config";

// Quatre familles de tests (npm run test:unit | test:integration | test:regression | test:acceptance).
// Unit, integration et regression ne touchent jamais Notion, Redis, Telegram, Groq ni le réseau : tests/helpers/setup.ts
// pose des variables factices et fait échouer tout fetch non prévu. L'acceptation pilote un vrai navigateur sur l'app.
const sandbox = { environment: "node" as const, setupFiles: ["tests/helpers/setup.ts"], restoreMocks: true };

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["tests/unit/**/*.test.ts"], ...sandbox } },
      { test: { name: "integration", include: ["tests/integration/**/*.test.ts"], ...sandbox } },
      { test: { name: "regression", include: ["tests/regression/**/*.test.ts"], ...sandbox } },
      { test: { name: "acceptance", include: ["tests/acceptance/**/*.test.ts"], environment: "node", testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false } },
    ],
  },
});
