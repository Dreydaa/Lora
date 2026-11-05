import { assertDashboardKey } from "../lib/auth";
import { getProtocolRun, saveAgentApps, saveProtocolRun } from "../lib/memory";
import { finishProtocol } from "../lib/protocols";
import type { StepResult } from "../lib/types";

export const config = {
  runtime: "edge",
};

const MAX_STEPS = 20;
const MAX_APPS = 200;
const MAX_APP_NAME = 60;
const isResult = (r: unknown): r is StepResult =>
  typeof r === "object" && r !== null && typeof (r as StepResult).label === "string" && typeof (r as StepResult).ok === "boolean";

// Appelé par l'app Løra du PC (même clé que le dashboard) :
// GET = « y a-t-il un protocole à exécuter ? » ; POST = statut de chaque étape exécutée, ou la liste des applications du PC.
export default async function handler(request: Request) {
  try {
    assertDashboardKey(request);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  if (request.method === "GET") {
    const run = await getProtocolRun();
    // Remis une seule fois : si le PC tombe en route, le protocole n'est pas relancé en double (le délai prévient l'utilisateur).
    if (!run || run.claimed) return Response.json({ run: null });
    await saveProtocolRun({ ...run, claimed: true });
    return Response.json({ run: { id: run.id, code: run.code, steps: run.steps } });
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => null);
    // Liste des applications du PC (noms seulement), envoyée au démarrage de Løra et à chaque modification de apps.json.
    if (body && Array.isArray(body.apps)) {
      if (body.apps.length > MAX_APPS || !body.apps.every((a: unknown) => typeof a === "string" && a.length > 0 && a.length <= MAX_APP_NAME)) return new Response("Invalid body", { status: 400 });
      await saveAgentApps(body.apps);
      return Response.json({ ok: true });
    }
    if (!body || typeof body.id !== "string" || !Array.isArray(body.results) || body.results.length > MAX_STEPS || !body.results.every(isResult))
      return new Response("Invalid body", { status: 400 });
    const results: StepResult[] = body.results.map((r: StepResult) => ({ label: r.label.slice(0, 80), ok: r.ok, ...(typeof r.detail === "string" ? { detail: r.detail.slice(0, 200) } : {}) }));
    return (await finishProtocol(body.id, results)) ? Response.json({ ok: true }) : new Response("Unknown or expired run", { status: 404 });
  }

  return new Response("Method not allowed", { status: 405 });
}
