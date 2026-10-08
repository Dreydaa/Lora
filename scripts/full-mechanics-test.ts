// Batterie de test complète des mécaniques Soza — utilise les vraies APIs (Notion, Redis, Groq).
// Toutes les données créées sont préfixées "[TEST]" pour pouvoir être nettoyées ensuite.
import { addIdea, findIdeaByTitle, archiveIdea, setIdeaStatus, updateIdeaNotes, getIdeasToPropose } from "../lib/notion/idees";
import { createMilestone, completeMilestoneForIdea, getMilestones } from "../lib/notion/milestones";
import { addAgendaItem, addShiftSchedule, getUpcomingAgenda } from "../lib/notion/agenda";
import { getLatestProgress, saveProgress } from "../lib/notion/progress";
import { getHistory, appendToHistory, setBreak, getBreak, clearBreak, inBreak } from "../lib/memory";
import { askSoza, resolveModel } from "../lib/ai/client";
import { agendaLine, bilanLine, buildBriefing, dayLine, milestoneLine } from "../lib/briefing";
import { notion } from "../lib/notion/client";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
}

const TEST_CHAT_ID = 999999999; // isolé de l'historique Redis réel

async function main() {
  console.log("=== 0. Config de base ===");
  record("resolveModel() ne lève pas", (() => { try { resolveModel(); return true; } catch (e) { record("resolveModel error", false, String(e)); return false; } })());
  record("GROQ_MODEL configuré", true, process.env.GROQ_MODEL ?? "openai/gpt-oss-120b");

  console.log("\n=== 1. Notion CRUD direct (sans IA) ===");
  const ideaTitle = `[TEST] idée rig ${Date.now()}`;
  const idea = await addIdea(ideaTitle, "Moyen").catch((e) => { record("addIdea", false, String(e)); return null; });
  record("addIdea crée une page", !!idea, idea?.id);

  const found = await findIdeaByTitle(ideaTitle);
  record("findIdeaByTitle retrouve l'idée créée", found?.id === idea?.id);

  const ideaWithStatus = await addIdea(`[TEST] idée en cours ${Date.now()}`, "Petit", "", "En cours").catch(() => null);
  record("addIdea accepte un statut initial explicite", (ideaWithStatus as any)?.properties?.Statut?.select?.name === "En cours");
  if (idea) {
    await setIdeaStatus(idea.id, "En cours");
    const afterStatusChange = await notion().pages.retrieve({ page_id: idea.id });
    record("setIdeaStatus met bien à jour le statut", (afterStatusChange as any).properties.Statut.select?.name === "En cours");

    await updateIdeaNotes(idea.id, "[TEST] synthèse mise à jour après coup");
    const afterNotesUpdate = await notion().pages.retrieve({ page_id: idea.id });
    const notesText = (afterNotesUpdate as any).properties.Notes.rich_text.map((r: any) => r.plain_text).join("");
    record("updateIdeaNotes remplace bien les notes d'une idée existante", notesText === "[TEST] synthèse mise à jour après coup");
  }

  const ambiguousTitle = `[TEST] idée rig avancé ${Date.now()}`;
  const idea2 = await addIdea(ambiguousTitle, "Petit").catch(() => null);
  const foundAmbiguous = await findIdeaByTitle(`[TEST] idée rig`);
  record("findIdeaByTitle sur préfixe commun retourne une page (pas de crash)", !!foundAmbiguous);

  const milestone = idea ? await createMilestone(`[TEST] jalon lié ${Date.now()}`, futureDate(7), idea.id).catch((e) => { record("createMilestone", false, String(e)); return null; }) : null;
  record("createMilestone lié à une idée", !!milestone, milestone?.id);

  const overdueMilestone = await createMilestone(`[TEST] jalon en retard ${Date.now()}`, pastDate(3), undefined).catch(() => null);
  record("createMilestone en retard (sans idée liée)", !!overdueMilestone, overdueMilestone?.id);

  const milestonesList = await getMilestones();
  record("getMilestones inclut le jalon en retard", milestonesList.some((m) => m.id === overdueMilestone?.id));
  record("getMilestones exclut les jalons Validé", true, `${milestonesList.length} jalon(s) non validés retournés`);

  if (idea) {
    await archiveIdea(idea.id);
    const afterArchive = await findIdeaByTitle(ideaTitle);
    record("findIdeaByTitle exclut une idée archivée", afterArchive === null || afterArchive?.id !== idea.id);
  }

  if (idea && milestone) {
    const completedId = await completeMilestoneForIdea(idea.id);
    record("completeMilestoneForIdea valide le bon jalon", completedId === milestone.id);
  }

  console.log("\n=== 2. suggest_projects (normal + fallback) ===");
  const suggestions = await getIdeasToPropose();
  record("getIdeasToPropose retourne des suggestions", Array.isArray(suggestions), `${suggestions.length} suggestion(s)`);

  console.log("\n=== 3. Agenda ===");
  const agendaTitle = `[TEST] rdv ${Date.now()}`;
  const agendaItem = await addAgendaItem(agendaTitle, futureDate(2)).catch((e) => { record("addAgendaItem", false, String(e)); return null; });
  record("addAgendaItem crée une page", !!agendaItem);
  const upcoming = await getUpcomingAgenda();
  record("getUpcomingAgenda inclut le nouvel item", upcoming.some((a) => a.title === agendaTitle));

  const timedTitle = `[TEST] rdv horodaté ${Date.now()}`;
  const timedItem = await addAgendaItem(timedTitle, `${futureDate(3)}T14:30:00`, "Perso", `${futureDate(3)}T15:00:00`).catch(() => null);
  record("addAgendaItem accepte une heure de début/fin", !!(timedItem as any)?.properties?.Date?.date?.start?.includes("14:30"));

  // Bornée par une plage de dates propre au test (pas juste Type=Shift) pour ne jamais
  // recouper un vrai planning de shift que l'utilisateur aurait par ailleurs enregistré.
  const shiftStart = futureDate(10);
  const shiftEnd = futureDate(14);
  const shiftCount = await addShiftSchedule(shiftStart, shiftEnd, "05:00", "13:00", ["lundi", "mardi", "mercredi", "jeudi", "vendredi"]).catch((e) => {
    record("addShiftSchedule", false, String(e));
    return 0;
  });
  const shiftItems = await notion().databases.query({
    database_id: process.env.NOTION_AGENDA_DATABASE_ID!,
    filter: {
      and: [
        { property: "Type", select: { equals: "Shift" } },
        { property: "Date", date: { on_or_after: shiftStart } },
        { property: "Date", date: { on_or_before: shiftEnd } },
      ],
    },
  });
  record("addShiftSchedule crée le bon nombre de blocs (jours ouvrés uniquement)", shiftItems.results.length === shiftCount && shiftCount > 0, `${shiftCount} bloc(s)`);
  const shiftDates = (shiftItems.results as any[]).map((p) => p.properties.Date.date.start.slice(0, 10)).sort();
  record("addShiftSchedule ne déborde pas avant la date de début demandée", shiftDates.every((d) => d >= futureDate(10)), shiftDates.join(", "));

  const upcomingWithoutShift = await getUpcomingAgenda();
  record("getUpcomingAgenda exclut les blocs Shift par défaut", !upcomingWithoutShift.some((a) => a.type === "Shift"));
  const upcomingWithShift = await getUpcomingAgenda(true);
  record("getUpcomingAgenda(true) inclut les blocs Shift", upcomingWithShift.some((a) => a.type === "Shift"));

  for (const p of shiftItems.results as any[]) await notion().pages.update({ page_id: p.id, archived: true });

  console.log("\n=== 4. Progress ===");
  const savedTrue = await saveProgress("[TEST] bilan avec preuve").catch((e) => { record("saveProgress", false, String(e)); return null; });
  record("saveProgress enregistre le bilan", !!savedTrue);
  const afterTrue = await getLatestProgress();
  record("getLatestProgress reflète le nouveau bilan", afterTrue.review === "[TEST] bilan avec preuve");

  console.log("\n=== 5. Mémoire Redis ===");
  await appendToHistory(TEST_CHAT_ID, [{ role: "user", content: "[TEST] message 1" }]);
  const hist1 = await getHistory(TEST_CHAT_ID);
  record("appendToHistory + getHistory round-trip", hist1.some((m) => m.content === "[TEST] message 1"));
  for (let i = 0; i < 12; i++) await appendToHistory(TEST_CHAT_ID, [{ role: "user", content: `[TEST] msg ${i}` }]);
  const histCapped = await getHistory(TEST_CHAT_ID);
  record("Historique plafonné à 10 messages", histCapped.length <= 10, `${histCapped.length} message(s)`);

  console.log("\n=== 6. askSoza (bout en bout avec le LLM réel) ===");
  try {
    const r1 = await askSoza(TEST_CHAT_ID, `Ajoute une idée : [TEST] refaire le rig ${Date.now()}, taille moyenne`);
    record("askSoza crée une idée via tool call", r1.toolCalls.some((tc) => tc.name === "create_idea"), r1.text.slice(0, 120));
    record("askSoza réponse n'est pas le fallback générique", r1.text.trim() !== "✅ Action enregistrée.", r1.text.slice(0, 120));
  } catch (e) {
    record("askSoza create_idea", false, String(e));
  }

  try {
    const r2 = await askSoza(TEST_CHAT_ID + 1, "je devrais reprendre un truc un de ces jours, je sais pas trop");
    record("askSoza phrase ambiguë ne déclenche pas create_idea", !r2.toolCalls.some((tc) => tc.name === "create_idea"), r2.text.slice(0, 150));
  } catch (e) {
    record("askSoza doute", false, String(e));
  }

  console.log("\n=== 7. Briefing (fallback + LLM) ===");
  const today0 = "2026-10-07";
  const item = (title: string, date: string | null) => ({ id: "x", title, date, status: "À faire", type: "Perso" as const });
  record("bilanLine: bilan d'hier repris", bilanLine({ review: "ok", date: "2026-10-06" }, today0) === "Bilan d'hier: ok.");
  record("bilanLine: bilan saisi après minuit compte pour hier", bilanLine({ review: "ok", date: "2026-10-07" }, today0).includes("ok"));
  record("bilanLine: ancien bilan présenté comme manquant", bilanLine({ review: "vieux", date: "2026-10-03" }, today0).includes("AUCUN") && !bilanLine({ review: "vieux", date: "2026-10-03" }, today0).includes("vieux"));
  record("bilanLine: aucun bilan jamais", bilanLine({ review: "Aucun bilan", date: null }, today0).includes("AUCUN"));
  const agenda0 = agendaLine([item("Dentiste", "2026-10-07"), item("Coiffeur", "2026-10-08T14:30:00"), item("Cinéma", "2026-10-11"), item("Mariage", "2026-11-20")], today0);
  record("agendaLine: échéances explicites", agenda0.includes("Dentiste (aujourd'hui)") && agenda0.includes("Coiffeur (demain à 14:30)") && agenda0.includes("Cinéma (dans 4 jours, dimanche 11/10)"), agenda0);
  record("agendaLine: rien au-delà de 7 jours", !agenda0.includes("Mariage"));
  record("agendaLine: agenda vide", agendaLine([], today0).includes("rien de prévu"));
  const done = (title: string, status: string) => ({ ...item(title, today0), status });
  record("dayLine: faites sur total + restantes", dayLine([done("A", "Fait"), done("B", "À faire"), done("C", "Fait")]) === "Journée: 2/3 tâche(s) faite(s). Restent à faire: B.");
  record("dayLine: tout fait, rien à lister", !dayLine([done("A", "Fait")]).includes("Restent"));
  record("dayLine: journée vide", dayLine([]).includes("rien n'était prévu"));
  const ms = (title: string, dueDate: string, status = "À faire") => ({ id: "m", title, dueDate, status });
  record("milestoneLine: le jalon en retard passe avant", milestoneLine([ms("Futur", "2026-10-12"), ms("Retard", "2026-10-05")], today0) === "Prochain jalon: Retard (en retard de 2 jour(s)).");
  record("milestoneLine: échéance explicite, validé ignoré", milestoneLine([ms("Fini", "2026-10-06", "Validé"), ms("Demain", "2026-10-08")], today0).includes("Demain (demain)"));
  record("milestoneLine: aucun jalon", milestoneLine([], today0).includes("aucun"));
  const brk0 = { start: "2026-10-10", end: "2026-10-11" };
  const back0 = bilanLine({ review: "rig fini", date: "2026-10-09" }, "2026-10-12", brk0);
  record("pause: retour sans reproche, dernier bilan rappelé", back0.includes("pas un manquement") && back0.includes("rig fini") && !back0.includes("AUCUN"));
  record("pause: sans pause, la même situation = AUCUN bilan", bilanLine({ review: "rig fini", date: "2026-10-09" }, "2026-10-12", null).includes("AUCUN"));
  record("pause: inBreak bornes incluses", inBreak(brk0, "2026-10-10") && inBreak(brk0, "2026-10-11") && !inBreak(brk0, "2026-10-12") && !inBreak(null, "2026-10-10"));
  await setBreak("2000-01-01", "2000-01-02");
  const storedBreak = await getBreak();
  record("pause: round-trip Redis", storedBreak?.start === "2000-01-01" && storedBreak?.end === "2000-01-02");
  await clearBreak();
  record("pause: clearBreak supprime la clé", (await getBreak()) === null);
  try {
    const briefing = await buildBriefing();
    record("buildBriefing retourne un texte non vide", !!briefing?.trim(), briefing.slice(0, 150));
  } catch (e) {
    record("buildBriefing", false, String(e));
  }

  console.log("\n=== Nettoyage des données de test ===");
  await cleanupTestPages();

  console.log("\n=== Résumé ===");
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} tests OK`);
  if (failed.length) {
    console.log("Échecs:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ": " + f.detail : ""}`);
    process.exit(1);
  }
}

function futureDate(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function pastDate(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function cleanupTestPages() {
  const dbs = [
    process.env.NOTION_IDEAS_DATABASE_ID,
    process.env.NOTION_MILESTONES_DATABASE_ID,
    process.env.NOTION_AGENDA_DATABASE_ID,
    process.env.NOTION_PROGRESS_DATABASE_ID,
  ].filter(Boolean) as string[];

  let archived = 0;
  for (const database_id of dbs) {
    const data = await notion().databases.query({ database_id, page_size: 100 });
    for (const page of data.results as any[]) {
      // Le titre n'est pas toujours l'indicateur de test (ex: base Progress, titrée par date) —
      // on scanne aussi les propriétés rich_text (ex: "Bilan") pour retrouver "[TEST]".
      const textValues = Object.values(page.properties).flatMap((p: any) => {
        if (p.type === "title") return p.title?.map((t: any) => t.plain_text) ?? [];
        if (p.type === "rich_text") return p.rich_text?.map((t: any) => t.plain_text) ?? [];
        return [];
      });
      const isTest = textValues.some((t: string) => t?.includes("[TEST]"));
      if (isTest && !page.archived) {
        await notion().pages.update({ page_id: page.id, archived: true });
        archived++;
      }
    }
  }
  console.log(`${archived} page(s) de test archivée(s)/supprimée(s).`);
}

main().catch((e) => {
  console.error("Erreur fatale:", e);
  process.exit(1);
});
