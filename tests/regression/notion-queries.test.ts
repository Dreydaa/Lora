// Corrections déjà faites sur les requêtes et écritures Notion : elles ne doivent pas revenir.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createdPages, notionCalls, notionData, progressPage, resetNotion, updatedPages } from "../helpers/notion-mock";

vi.mock("@notionhq/client", () => import("../helpers/notion-mock"));

import { addAgendaItem, getUpcomingAgenda } from "../../lib/notion/agenda";
import { addIdea, completeIdea, findIdeaByTitle, updateIdeaNotes } from "../../lib/notion/idees";
import { createMilestone, getMilestones } from "../../lib/notion/milestones";
import { getLatestProgress, saveProgress } from "../../lib/notion/progress";

const lastFilter = () => JSON.stringify(notionCalls.at(-1)?.filter ?? null);

beforeEach(() => resetNotion());

describe("agenda : les blocs Shift ne noient pas les rendez-vous", () => {
  it("le briefing exclut les blocs Shift par défaut", async () => {
    await getUpcomingAgenda();
    expect(lastFilter()).toContain('"Type"');
    expect(lastFilter()).toContain('"does_not_equal":"Shift"');
  });
  it("le dashboard, lui, les demande explicitement", async () => {
    await getUpcomingAgenda(true, 60);
    expect(lastFilter()).not.toContain("Shift");
  });
  it("ne remonte que les tâches non faites, à partir d'aujourd'hui", async () => {
    await getUpcomingAgenda();
    expect(lastFilter()).toContain('"does_not_equal":"Fait"');
    expect(lastFilter()).toContain("on_or_after");
  });
});

describe("jalons : ceux en retard restent visibles", () => {
  it("seul le statut Validé est exclu par défaut, jamais la date", async () => {
    await getMilestones();
    expect(lastFilter()).toContain('"does_not_equal":"Validé"');
    expect(lastFilter()).not.toMatch(/on_or_after|after|before/);
  });
  it("avec les jalons validés : aucun filtre (le dashboard calcule la progression x/y)", async () => {
    await getMilestones(true);
    expect(notionCalls.at(-1)?.filter).toBeUndefined();
  });
});

describe("idées", () => {
  it("findIdeaByTitle ignore les idées archivées et terminées (sinon un titre proche vise la mauvaise page)", async () => {
    await findIdeaByTitle("Soza");
    expect(lastFilter()).toContain('"does_not_equal":"Archivée"');
    expect(lastFilter()).toContain('"does_not_equal":"Terminé"');
  });
  it("completeIdea passe le statut à Terminé, pas à Archivée", async () => {
    await completeIdea("page");
    expect(updatedPages.at(-1).properties.Statut).toEqual({ select: { name: "Terminé" } });
  });

  // La catégorie n'est écrite que si elle est fournie : une base sans cette colonne ne doit pas casser les écritures existantes.
  it("la catégorie est écrite pour une idée, un item d'agenda et un jalon quand elle est fournie", async () => {
    await addIdea("Projet", "Petit", "", "Brute", "Blender");
    expect(createdPages.at(-1).properties.Catégorie).toEqual({ select: { name: "Blender" } });
    await addAgendaItem("RDV", "2026-10-09", "Perso", undefined, "Rendez-vous");
    expect(createdPages.at(-1).properties.Catégorie).toEqual({ select: { name: "Rendez-vous" } });
    await createMilestone("Jalon", "2026-10-20", undefined, "Figma");
    expect(createdPages.at(-1).properties.Catégorie).toEqual({ select: { name: "Figma" } });
  });
  it("sans catégorie, aucune propriété Catégorie n'est envoyée", async () => {
    await addIdea("Projet", "Petit");
    expect(Object.keys(createdPages.at(-1).properties)).not.toContain("Catégorie");
    await addAgendaItem("RDV", "2026-10-09");
    expect(Object.keys(createdPages.at(-1).properties)).not.toContain("Catégorie");
    await createMilestone("Jalon", "2026-10-20");
    expect(Object.keys(createdPages.at(-1).properties)).not.toContain("Catégorie");
  });

  // Notion limite chaque bloc rich_text à 2000 caractères : une synthèse développée doit être découpée, pas tronquée.
  const blocks = () => createdPages.at(-1).properties.Notes.rich_text as { text: { content: string } }[];
  it("découpe une longue synthèse en blocs de 2000 caractères maximum, sans rien perdre", async () => {
    const notes = "mot ".repeat(1500).trim(); // ~6000 caractères
    await addIdea("Projet", "Moyen", notes);
    expect(blocks().length).toBeGreaterThan(1);
    for (const block of blocks()) expect(block.text.content.length).toBeLessThanOrEqual(2000);
    expect(blocks().map((b) => b.text.content).join(" ")).toBe(notes);
  });
  it("coupe quand même un texte sans espace plutôt que de bloquer", async () => {
    await addIdea("Projet", "Petit", "x".repeat(4500));
    expect(blocks().map((b) => b.text.content.length)).toEqual([2000, 2000, 500]);
  });
  it("updateIdeaNotes découpe pareil, et des notes vides donnent une liste vide", async () => {
    await updateIdeaNotes("page", "mot ".repeat(1500).trim());
    expect(updatedPages.at(-1).properties.Notes.rich_text.length).toBeGreaterThan(1);
    await updateIdeaNotes("page", "");
    expect(updatedPages.at(-1).properties.Notes.rich_text).toEqual([]);
  });
  it("une idée sans notes écrit une liste vide, pas un bloc vide", async () => {
    await addIdea("Projet", "Petit");
    expect(blocks()).toEqual([]);
  });
});

describe("le mode ACTIF/PAUSE n'existe plus (retiré le 07/10/2026)", () => {
  it("l'agenda n'écrit plus de colonne Mode", async () => {
    await addAgendaItem("RDV", "2026-10-09T10:00:00");
    expect(Object.keys(createdPages.at(-1).properties)).not.toContain("Mode");
  });
  it("la progression n'écrit plus de colonne Mode ni de streak", async () => {
    await saveProgress("Rig terminé");
    expect(Object.keys(createdPages.at(-1).properties).sort()).toEqual(["Bilan", "Date"]);
  });
});

describe("bilan : date réelle du dernier bilan", () => {
  it("la date est lue depuis le titre de la page, pour ne pas ressortir un vieux bilan comme celui d'hier", async () => {
    notionData["db-progress"] = [progressPage("2026-10-03", "ancien")];
    expect(await getLatestProgress()).toEqual({ review: "ancien", date: "2026-10-03" });
  });
  it("un titre qui n'est pas une date donne date: null", async () => {
    notionData["db-progress"] = [progressPage("n'importe quoi", "bilan")];
    expect((await getLatestProgress()).date).toBeNull();
  });
  it("aucun bilan enregistré", async () => {
    expect(await getLatestProgress()).toEqual({ review: "Aucun bilan", date: null });
  });
});
