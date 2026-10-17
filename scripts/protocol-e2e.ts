// Essai de bout en bout du protocole 7E3A, sans service réel : le vrai worker et le vrai api/protocol.ts tournent ici avec un faux
// Redis, un faux Telegram et un faux QStash (fetch intercepté) ; la vraie boucle Rust (protocol.rs) les interroge en HTTP local
// et lance de vrais processus. Usage : npm run test:protocol -- <chemin de parsecd.exe> [<chemin d'une autre application pour « code »>]
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [parsecPath, codeStandIn = "C:\\Windows\\System32\\notepad.exe"] = process.argv.slice(2);
if (!parsecPath) throw new Error("usage : npm run test:protocol -- <parsecd.exe> [<application remplaçant code>]");

Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: "t", TELEGRAM_ALLOWED_CHAT_ID: "42", DASHBOARD_API_KEY: "e2e-key", APP_URL: "https://soza.e2e",
  QSTASH_TOKEN: "q", QSTASH_CURRENT_SIGNING_KEY: "e2e-current", QSTASH_NEXT_SIGNING_KEY: "e2e-next", UPSTASH_REDIS_REST_URL: "https://redis.e2e", UPSTASH_REDIS_REST_TOKEN: "r",
});

// --- faux services (fetch intercepté) ---
const redis = new Map<string, string>();
const telegram: string[] = [];
const qstash: { delay?: string; body: any }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://redis.e2e")) {
    const base64 = new Headers(init.headers).get("upstash-encoding") === "base64";
    const exec = ([cmd, key, value]: string[]) => {
      let result: unknown = "OK";
      if (/^get$/i.test(cmd)) { const v = redis.get(key) ?? null; result = v !== null && base64 ? Buffer.from(v).toString("base64") : v; }
      else if (/^set$/i.test(cmd)) redis.set(key, value);
      else if (/^del$/i.test(cmd)) result = redis.delete(key) ? 1 : 0;
      else throw new Error(`commande Redis non prévue : ${cmd}`);
      return { result };
    };
    const body = JSON.parse(init.body);
    return Response.json(Array.isArray(body[0]) ? body.map(exec) : exec(body)); // le client groupe ses commandes en « pipeline »
  }
  if (url.startsWith("https://api.telegram.org/")) { telegram.push(JSON.parse(init.body).text); return Response.json({ ok: true }); }
  if (url.includes("qstash")) {
    const headers = new Headers(init?.headers);
    qstash.push({ delay: headers.get("upstash-delay") ?? undefined, body: JSON.parse(init.body) });
    return Response.json({ messageId: "m" });
  }
  return realFetch(input, init);
}) as typeof fetch;

const { default: worker } = await import("../api/qstash-worker");
const { default: protocolApi } = await import("../api/protocol");

// Le backend local que la boucle Rust interroge. `failPosts` simule des coupures réseau sur l'envoi des statuts.
let failPosts = 0;
let afterClaim: (() => Promise<unknown>) | null = null; // exécuté entre la remise de la tâche au PC et l'envoi de son statut
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (req.method === "POST" && failPosts-- > 0) return void res.writeHead(503).end("coupure");
  const response = await protocolApi(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as any, body: ["GET", "HEAD"].includes(req.method!) ? undefined : Buffer.concat(chunks) }));
  const text = await response.text();
  if (req.method === "GET" && afterClaim && JSON.parse(text).run) { await afterClaim(); afterClaim = null; }
  res.writeHead(response.status, { "content-type": "application/json" }).end(text);
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${(server.address() as any).port}`;

// --- aides ---
const dir = mkdtempSync(join(tmpdir(), "soza-e2e-"));
const appsFile = (apps: object) => { const f = join(dir, "apps.json"); writeFileSync(f, JSON.stringify(apps)); return f; };
const exeName = (p: string) => p.split("\\").pop()!.replace(/\.exe$/i, "");
const pids = (name: string) => spawnSync("powershell", ["-NoProfile", "-Command", `(Get-Process '${name}' -ErrorAction SilentlyContinue).Id -join ','`], { encoding: "utf8" }).stdout.trim().split(",").filter(Boolean);
const kill = (list: string[]) => list.length && spawnSync("powershell", ["-NoProfile", "-Command", `Stop-Process -Id ${list.join(",")} -Force -ErrorAction SilentlyContinue`]);
// Signature QStash réelle (JWT HS256 avec la clé courante) : le worker la vérifie pour de vrai.
const b64 = (v: string | Buffer) => Buffer.from(v).toString("base64url");
function sign(body: string) {
  const now = Math.floor(Date.now() / 1000);
  const head = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(JSON.stringify({ iss: "Upstash", sub: "https://soza.e2e/api/qstash-worker", exp: now + 300, nbf: now - 5, iat: now, jti: String(now), body: createHash("sha256").update(body).digest("base64url") }))}`;
  return `${head}.${createHmac("sha256", "e2e-current").update(head).digest("base64url")}`;
}
const sendJob = (text: string, extra: object = {}) => {
  const body = JSON.stringify({ chatId: 42, text, messageId: 1, ...extra });
  return worker(new Request("https://soza.e2e/api/qstash-worker", { method: "POST", headers: { "upstash-signature": sign(body) }, body }));
};
// Asynchrone : spawnSync bloquerait la boucle d'événements, donc le faux backend que la boucle Rust interroge.
const poll = (apps: string, key = "e2e-key", base = url) => new Promise<{ ok: boolean; out: string }>((done) => {
  const child = spawn("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "real_poll_against_a_local_backend", "--", "--ignored", "--nocapture"],
    { env: { ...process.env, SOZA_TEST_URL: base, SOZA_TEST_KEY: key, SOZA_TEST_APPS: apps } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  // « exit » et non « close » : une application lancée par le test garde les tuyaux de sortie ouverts tant qu'elle tourne.
  child.on("exit", (code) => setTimeout(() => done({ ok: code === 0, out }), 200));
});
const run = () => (redis.get("protocol:run") ? JSON.parse(redis.get("protocol:run")!) : null);

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`); };
const reset = () => { redis.clear(); telegram.length = 0; qstash.length = 0; };
const opened = (name: string, before: string[]) => pids(name).filter((p) => !before.includes(p));

const standIn = exeName(codeStandIn);
const parsecName = exeName(parsecPath);
const cleanup: string[][] = [];

// 1. Cas nominal
{
  reset();
  const apps = appsFile({ parsec: parsecPath, code: codeStandIn });
  const beforeStandIn = pids(standIn), beforeParsec = pids(parsecName);
  const r = await sendJob("Protocole 7E3A");
  check("le worker répond 200 et dit « Lancement »", r.status === 200 && telegram[0] === "Lancement du protocole 7E3A.", `${r.status} ${await r.clone().text()} ${JSON.stringify(telegram)}`);
  check("un job différé de 600 s est publié", qstash.length === 1 && qstash[0].delay === "600s" && qstash[0].body.protocolTimeout === run()?.id, JSON.stringify(qstash));
  const p = await poll(apps);
  check("la boucle Rust interroge et rend ses statuts sans erreur", p.ok, p.out.slice(-600));
  const newStandIn = opened(standIn, beforeStandIn), newParsec = opened(parsecName, beforeParsec);
  cleanup.push(newStandIn, newParsec);
  check(`l'application de remplacement (${standIn}) est vraiment lancée`, newStandIn.length > 0, `avant ${beforeStandIn} / après ${pids(standIn)}`);
  console.log(`      info : Parsec avant ${beforeParsec.length} processus, nouveaux ${newParsec.length}`);
  check("message de fin « terminé » et protocole clos", telegram.at(-1) === "Protocole 7E3A terminé." && run() === null, JSON.stringify(telegram));
  const again = await poll(apps);
  check("une 2e interrogation ne relance rien", again.ok && opened(standIn, [...beforeStandIn, ...newStandIn]).length === 0);
}

// 2. Application absente de apps.json : l'autre étape doit quand même tourner
{
  reset();
  const apps = appsFile({ parsec: parsecPath });
  const before = pids(parsecName);
  await sendJob("Protocole 7E3A");
  const p = await poll(apps);
  cleanup.push(opened(parsecName, before));
  check("« code » absent : échec nommé, Parsec tenté quand même", p.ok && telegram.at(-1) === "Protocole 7E3A : 1 étape(s) en échec sur 2.\n- Ouvrir code : « code » n'est pas dans apps.json", JSON.stringify(telegram));
}

// 3. Chemin cassé
{
  reset();
  const apps = appsFile({ parsec: parsecPath, code: "C:\\soza-e2e-absent\\absent.exe" });
  const before = pids(parsecName);
  await sendJob("Protocole 7E3A");
  await poll(apps);
  cleanup.push(opened(parsecName, before));
  check("chemin cassé : la raison du système est rapportée", /Ouvrir code : Impossible de lancer code/.test(telegram.at(-1) ?? ""), JSON.stringify(telegram));
}

// 4. PC qui ne vient jamais
{
  reset();
  await sendJob("Protocole 7E3A");
  const id = run().id;
  await sendJob("Protocole 7E3A", { protocolTimeout: id });
  check("délai dépassé : message dédié, protocole clos", /le PC n'a pas répondu/.test(telegram.at(-1) ?? "") && run() === null, JSON.stringify(telegram));
  const apps = appsFile({ parsec: parsecPath, code: codeStandIn });
  const p = await poll(apps);
  check("le PC qui arrive en retard ne trouve plus rien et ne lance rien", p.ok && telegram.length === 2, JSON.stringify(telegram));
}

// 5. Deux lancements d'affilée : l'ancien job différé ne doit rien dire
{
  reset();
  await sendJob("Protocole 7E3A");
  const firstId = run().id;
  await sendJob("Protocole 7E3A");
  check("2e lancement : un nouveau protocole remplace l'ancien", run().id !== firstId);
  const n = telegram.length;
  await sendJob("Protocole 7E3A", { protocolTimeout: firstId });
  check("le job différé de l'ancien lancement reste silencieux", telegram.length === n && run() !== null, JSON.stringify(telegram));
}

// 5b. Coupure réseau brève au moment d'envoyer les statuts : le message de fin doit quand même arriver
{
  reset();
  const apps = appsFile({ parsec: parsecPath, code: codeStandIn });
  const before = pids(standIn);
  await sendJob("Protocole 7E3A");
  failPosts = 1;
  const p = await poll(apps);
  cleanup.push(opened(standIn, before));
  failPosts = 0;
  check("1 coupure sur l'envoi des statuts : réessayé, message de fin reçu", p.ok && telegram.at(-1) === "Protocole 7E3A terminé.", `${p.out.slice(-300)} ${JSON.stringify(telegram)}`);
}

// 5c. Statuts refusés pour de bon (protocole remplacé entre-temps) : pas de réessai inutile
{
  reset();
  const apps = appsFile({ parsec: parsecPath, code: codeStandIn });
  const before = pids(standIn);
  await sendJob("Protocole 7E3A");
  failPosts = 0;
  const started = Date.now();
  afterClaim = () => sendJob("Protocole 7E3A"); // remplace le protocole que le PC est en train d'exécuter
  const p = await poll(apps);
  cleanup.push(opened(standIn, before));
  check("protocole remplacé pendant l'exécution : refus net (404), sans réessai ni message de fin", !p.ok && /refusé \(404\)/.test(p.out) && !telegram.some((t) => t.endsWith("terminé.")), `${p.out.slice(-300)} ${JSON.stringify(telegram)} ${Date.now() - started} ms`);
}

// 6. Mauvaise clé et backend injoignable
{
  reset();
  await sendJob("Protocole 7E3A");
  const bad = await poll(appsFile({ parsec: parsecPath }), "mauvaise");
  check("mauvaise clé : erreur explicite côté PC, protocole intact", !bad.ok && /interrogation du backend échouée/.test(bad.out) && run()?.claimed === false, bad.out.slice(-300));
  const down = await poll(appsFile({ parsec: parsecPath }), "e2e-key", "http://127.0.0.1:9");
  check("backend injoignable : erreur explicite, sans planter", !down.ok && /interrogation du backend échouée/.test(down.out), down.out.slice(-300));
}

for (const list of cleanup) kill(list);
server.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est passé");
process.exit(failures ? 1 : 0);
