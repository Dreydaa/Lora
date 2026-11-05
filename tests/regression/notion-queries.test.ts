// Corrections déjà faites sur les requêtes et écritures Notion : elles ne doivent pas revenir.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createdPages, notionCalls, notionData, progressPage, projectPage, resetNotion, updatedPages } from "../helpers/notion-mock";

vi.mock("@notionhq/client", () => import("../helpers/notion-mock"));

import { addAgendaItem, getUpcomingAgenda } from "../../lib/notion/agenda";
import { addIdea, completeIdea, findIdeaByTitle, getProjectsInProgress, resolveProjectNames, updateIdeaNotes } from "../../lib/notion/idees";
import { loraTools } from "../../lib/ai/tools";
import { completeMilestoneForIdea, createMilestone, getMilestones, markMissedMilestones } from "../../lib/notion/milestones";
import { milestonePage } from "../helpers/notion-mock";
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

// Constaté le 03/11/2026 : « le site de Andy est terminé » dit dans un bilan n'avait rien changé dans Notion.
describe("projet terminé et jalons manqués", () => {
  const statuses = () => updatedPages.map((p) => p.properties.Statut.select.name);
  it("valide tous les jalons ouverts liés à l'idée, pas seulement le premier", async () => {
    notionData["db-milestones"] = [milestonePage("m1", "Maquette", "2026-10-20", "À faire", "i1"), milestonePage("m2", "Maquette (doublon)", "2026-10-20", "Manqué", "i1")];
    expect(await completeMilestoneForIdea("i1")).toBe(2);
    expect(updatedPages.map((p) => p.page_id)).toEqual(["m1", "m2"]);
    expect(statuses()).toEqual(["Validé", "Validé"]);
    expect(lastFilter()).toContain('"does_not_equal":"Validé"'); // un jalon déjà validé n'est pas réécrit
  });
  it("aucun jalon lié : 0, et rien n'est écrit", async () => {
    expect(await completeMilestoneForIdea("i1")).toBe(0);
    expect(updatedPages).toHaveLength(0);
  });
  it("markMissedMilestones passe en Manqué les jalons « À faire » dont l'échéance est passée", async () => {
    notionData["db-milestones"] = [milestonePage("m1", "Site", "2026-10-20")];
    expect(await markMissedMilestones("2026-11-03")).toBe(1);
    expect(lastFilter()).toContain('"equals":"À faire"');
    expect(lastFilter()).toContain('"before":"2026-11-03"');
    expect(statuses()).toEqual(["Manqué"]);
  });
  it("complete_project retrouve « Site pour Andy » depuis « le site d'Andy », et valide son jalon", async () => {
    notionData["db-ideas"] = [projectPage("i1", "Site pour Andy")];
    notionData["db-milestones"] = [milestonePage("m1", "Développer le site", "2026-10-20", "À faire", "i1")];
    const execute = (loraTools.complete_project as any).execute as (input: unknown) => Promise<Record<string, unknown>>;
    expect(await execute({ projectTitle: "le site d'Andy" })).toMatchObject({ success: true, milestonesValidated: 1 });
    expect(JSON.stringify(notionCalls)).toContain('"contains":"Site pour Andy"'); // le titre exact, pas la formulation de l'utilisateur
    expect(updatedPages.map((p) => p.properties.Statut.select.name)).toEqual(["Terminé", "Validé"]);
  });
  it("record_progress avec finishedProjects enregistre le bilan puis termine le projet et son jalon", async () => {
    notionData["db-ideas"] = [projectPage("i1", "Site pour Andy")];
    notionData["db-milestones"] = [milestonePage("m1", "Développer le site", "2026-10-20", "À faire", "i1")];
    const execute = (loraTools.record_progress as any).execute as (input: unknown) => Promise<{ success: boolean; finished?: unknown[] }>;
    const result = await execute({ review: "Site livré", projectsWorkedOn: ["site d'Andy"], finishedProjects: ["site d'Andy"] });
    expect(result.success).toBe(true);
    expect(createdPages.at(-1).properties.Bilan.rich_text[0].text.content).toBe("Projets : Site pour Andy. Site livré");
    expect(result.finished).toEqual([expect.objectContaining({ success: true, milestonesValidated: 1 })]);
    expect(updatedPages.map((p) => p.properties.Statut.select.name)).toEqual(["Terminé", "Validé"]);
  });
  it("record_progress : une panne en terminant le projet ne perd pas le bilan", async () => {
    Object.defineProperty(notionData, "db-ideas", { get: () => { throw new Error("notion 500"); }, configurable: true, enumerable: true });
    const execute = (loraTools.record_progress as any).execute as (input: unknown) => Promise<{ success: boolean; finished?: unknown[] }>;
    const result = await execute({ review: "Site livré", finishedProjects: ["Site pour Andy"] });
    expect(result.success).toBe(true);
    expect(createdPages.at(-1).properties.Bilan.rich_text[0].text.content).toBe("Site livré");
    expect(result.finished).toEqual([expect.objectContaining({ success: false })]);
  });
});

describe("bilan du jour", () => {
  it("les projets travaillés sont écrits en tête du bilan, sans colonne en plus", async () => {
    await saveProgress("Rig fini, UV à reprendre", ["Personnage 3D", " Løra "]);
    expect(createdPages.at(-1).properties.Bilan.rich_text[0].text.content).toBe("Projets : Personnage 3D, Løra. Rig fini, UV à reprendre");
    expect(Object.keys(createdPages.at(-1).properties)).toEqual(["Date", "Bilan"]);
  });
  // Le modèle ne connaît pas les titres exacts (constaté : « Portfolio » pour « Portfolio web », « Rig personnage 3D » pour « Personnage 3D »).
  const IN_PROGRESS = [{ id: "i1", title: "Løra" }, { id: "i2", title: "Portfolio web" }, { id: "i3", title: "Personnage 3D" }];
  it("resolveProjectNames remplace un nom approximatif par le titre du seul projet qu'il désigne", () => {
    expect(resolveProjectNames(["portfolio", "Rig personnage 3D", "LØRA"], IN_PROGRESS)).toEqual(["Portfolio web", "Personnage 3D", "Løra"]);
    expect(resolveProjectNames(["le Portfolio Web"], IN_PROGRESS)).toEqual(["Portfolio web"]);
  });
  it("resolveProjectNames garde tel quel un nom inconnu ou ambigu, sans doublon", () => {
    // « portfolio » désigne deux projets : il reste tel quel ; « 3D » n'en désigne qu'un seul.
    expect(resolveProjectNames(["Site de recettes", "3D", "portfolio", "Portfolio web"], [...IN_PROGRESS, { id: "i4", title: "Portfolio photo" }])).toEqual(["Site de recettes", "Personnage 3D", "portfolio", "Portfolio web"]);
    expect(resolveProjectNames(["lora", "Løra"], IN_PROGRESS)).toEqual(["Løra"]);
    expect(resolveProjectNames(["café"], [{ id: "x", title: "Cafe" }])).toEqual(["Cafe"]); // accents ignorés
    expect(resolveProjectNames(["", "  "], IN_PROGRESS)).toEqual([]);
    expect(resolveProjectNames(["Løra"], [])).toEqual(["Løra"]);
  });
  it("l'outil record_progress écrit les vrais titres, et accepte null ou une absence de projets", async () => {
    notionData["db-ideas"] = IN_PROGRESS.map((p) => projectPage(p.id, p.title));
    const execute = (loraTools.record_progress as any).execute as (input: unknown) => Promise<{ success: boolean }>;
    expect((await execute({ review: "Rig fini", projectsWorkedOn: ["portfolio", "rig personnage 3D"] })).success).toBe(true);
    expect(createdPages.at(-1).properties.Bilan.rich_text[0].text.content).toBe("Projets : Portfolio web, Personnage 3D. Rig fini");
    for (const projectsWorkedOn of [null, undefined, []]) {
      notionCalls.length = 0;
      await execute({ review: "Calme", projectsWorkedOn });
      expect(createdPages.at(-1).properties.Bilan.rich_text[0].text.content).toBe("Calme");
      expect(notionCalls).toHaveLength(0); // aucun projet cité : aucune lecture inutile de Notion
    }
  });
  it("l'outil record_progress enregistre quand même le bilan si la lecture des projets échoue", async () => {
    Object.defineProperty(notionData, "db-ideas", { get: () => { throw new Error("notion 500"); }, configurable: true, enumerable: true });
    const execute = (loraTools.record_progress as any).execute as (input: unknown) => Promise<{ success: boolean }>;
    expect((await execute({ review: "Rig fini", projectsWorkedOn: ["Løra"] })).success).toBe(true);
    expect(createdPages.at(-1).properties.Bilan.rich_text[0].text.content).toBe("Projets : Løra. Rig fini");
  });
  it("sans projet nommé, le bilan reste tel quel", async () => {
    await saveProgress("Journée calme");
    expect(createdPages.at(-1).properties.Bilan.rich_text[0].text.content).toBe("Journée calme");
    await saveProgress("Journée calme", ["", "  "]);
    expect(createdPages.at(-1).properties.Bilan.rich_text[0].text.content).toBe("Journée calme");
  });
});

describe("idées", () => {
  it("findIdeaByTitle ignore les idées archivées et terminées (sinon un titre proche vise la mauvaise page)", async () => {
    await findIdeaByTitle("Løra");
    expect(lastFilter()).toContain('"does_not_equal":"Archivée"');
    expect(lastFilter()).toContain('"does_not_equal":"Terminé"');
  });
  it("getProjectsInProgress lit les idées « En cours », sans limite de nombre", async () => {
    notionData["db-ideas"] = [projectPage("i1", "Løra"), projectPage("i2", "Portfolio"), projectPage("i3", "Personnage 3D")];
    expect(await getProjectsInProgress()).toEqual([{ id: "i1", title: "Løra" }, { id: "i2", title: "Portfolio" }, { id: "i3", title: "Personnage 3D" }]);
    expect(lastFilter()).toContain('"equals":"En cours"');
    expect(JSON.stringify(notionCalls.at(-1))).not.toContain("page_size");
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
