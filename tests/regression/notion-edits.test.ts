// Modifier, supprimer, valider, noter (09/11/2026) : ces écritures Notion ne doivent toucher QU'UNE entrée bien désignée, jamais « la première qui colle ».
import { beforeEach, describe, expect, it, vi } from "vitest";
import { date, notionData, progressPage, projectPage, resetNotion, richText, select, title, updatedPages, milestonePage } from "../helpers/notion-mock";

vi.mock("@notionhq/client", () => import("../helpers/notion-mock"));

import { askConfig } from "../../lib/ai/client";
import { loraTools } from "../../lib/ai/tools";
import { selectToolNames } from "../../lib/ai/tool-routing";
import { shiftIso } from "../../lib/notion/agenda";
import { pickByTitle } from "../../lib/notion/match";
import { todayInParis } from "../../lib/date";

const run = (name: keyof typeof loraTools, input: unknown) => (loraTools[name] as any).execute(input, {}) as Promise<Record<string, any>>;
const agenda = (id: string, name: string, start: string, end: string | null = null) => ({ id, properties: { Titre: title(name), Date: date(start, end), Statut: select("À faire"), Type: select("Perso") } });
const DENTIST = "2026-11-12T14:30:00.000+01:00";

beforeEach(() => resetNotion());

describe("décaler une date", () => {
  it("lit l'heure du mur, passe minuit, et refuse de décaler une date sans heure d'une durée en minutes", () => {
    expect(shiftIso(DENTIST, 60)).toBe("2026-11-12T15:30");
    expect(shiftIso(DENTIST, -30)).toBe("2026-11-12T14:00");
    expect(shiftIso("2026-11-12T23:30", 60)).toBe("2026-11-13T00:30");
    expect(shiftIso("2026-11-12", 1440)).toBe("2026-11-13");
    expect(() => shiftIso("2026-11-12", 60)).toThrow(/jours entiers/);
  });
});

describe("retrouver une entrée par son titre", () => {
  const items = [{ title: "Rendez-vous dentiste" }, { title: "Réunion équipe" }, { title: "Dentiste des enfants" }, { title: "Coiffeur" }];
  it("une seule qui colle : c'est elle, malgré les accents, la casse et les mots d'accompagnement", () => {
    expect(pickByTitle(items, "mon rendez-vous chez le coiffeur").match?.title).toBe("Coiffeur");
    expect(pickByTitle(items, "REUNION equipe").match?.title).toBe("Réunion équipe");
    expect(pickByTitle(items, "Dentiste des enfants").match?.title).toBe("Dentiste des enfants");
  });
  it("plusieurs qui collent : aucune n'est choisie ; aucune : liste vide", () => {
    expect(pickByTitle(items, "le dentiste")).toEqual({ candidates: [items[0], items[2]] });
    expect(pickByTitle(items, "le médecin")).toEqual({ candidates: [] });
    expect(pickByTitle(items, "le")).toEqual({ candidates: [] });
  });
});

describe("update_agenda_item", () => {
  it("décale le début et la fin ensemble, avec le fuseau Paris, sans toucher au titre", async () => {
    notionData["db-agenda"] = [agenda("a1", "Rendez-vous dentiste", DENTIST, "2026-11-12T15:30:00.000+01:00")];
    const answer = await run("update_agenda_item", { title: "dentiste", shiftMinutes: 60 });
    expect(answer).toMatchObject({ success: true, title: "Rendez-vous dentiste", nouvelleDate: "2026-11-12T15:30" });
    expect(updatedPages).toEqual([{ page_id: "a1", properties: { Date: { date: { start: "2026-11-12T15:30", end: "2026-11-12T16:30", time_zone: "Europe/Paris" } } } }]);
  });

  it("sans titre : la prochaine entrée", async () => {
    notionData["db-agenda"] = [agenda("a1", "Premier", "2026-11-10"), agenda("a2", "Second", "2026-11-11")];
    expect(await run("update_agenda_item", { shiftMinutes: 1440 })).toMatchObject({ success: true, title: "Premier" });
    expect(updatedPages[0].page_id).toBe("a1");
    expect(updatedPages[0].properties.Date.date).toEqual({ start: "2026-11-11", end: null });
  });

  it("renommer seul ne réécrit pas la date", async () => {
    notionData["db-agenda"] = [agenda("a1", "Rendez-vous dentiste", DENTIST)];
    await run("update_agenda_item", { title: "dentiste", newTitle: "Dentiste, cabinet Martin" });
    expect(updatedPages).toHaveLength(1);
    expect(updatedPages[0].properties).toEqual({ Titre: { title: [{ text: { content: "Dentiste, cabinet Martin" } }] } });
  });

  it("plusieurs entrées qui correspondent, introuvable, ou demande vide : rien n'est écrit", async () => {
    notionData["db-agenda"] = [agenda("a1", "Rendez-vous dentiste", DENTIST), agenda("a2", "Dentiste des enfants", "2026-11-20")];
    expect(await run("update_agenda_item", { title: "dentiste", shiftMinutes: 60 })).toMatchObject({ success: false, candidates: ["Rendez-vous dentiste", "Dentiste des enfants"] });
    expect(await run("update_agenda_item", { title: "garagiste", shiftMinutes: 60 })).toMatchObject({ success: false, reason: expect.stringContaining("introuvable") });
    expect(await run("update_agenda_item", { title: "enfants" })).toMatchObject({ success: false, reason: expect.stringContaining("Rien à modifier") });
    expect(await run("update_agenda_item", { title: "enfants", shiftMinutes: 60, newDate: "2026-11-21" })).toMatchObject({ success: false });
    expect(updatedPages).toEqual([]);
  });

  it("une date sans heure ne se décale pas en minutes : l'erreur est rendue, rien n'est écrit", async () => {
    notionData["db-agenda"] = [agenda("a1", "Anniversaire", "2026-11-15")];
    expect(await run("update_agenda_item", { title: "anniversaire", shiftMinutes: 60 })).toMatchObject({ success: false, reason: expect.stringContaining("jours entiers") });
    expect(updatedPages).toEqual([]);
  });
});

describe("delete_agenda_item", () => {
  it("archive une seule entrée, jamais plusieurs", async () => {
    notionData["db-agenda"] = [agenda("a1", "Rendez-vous dentiste", DENTIST), agenda("a2", "Coiffeur", "2026-11-13")];
    expect(await run("delete_agenda_item", { title: "coiffeur" })).toEqual({ success: true, title: "Coiffeur" });
    expect(updatedPages).toEqual([{ page_id: "a2", archived: true }]);
    updatedPages.length = 0;
    expect(await run("delete_agenda_item", { title: "rendez" })).toMatchObject({ success: false });
    expect(updatedPages).toEqual([]);
  });
});

describe("complete_milestone", () => {
  it("valide un seul jalon désigné, pas tous", async () => {
    notionData["db-milestones"] = [milestonePage("m1", "Maquette de l'app", "2026-11-14"), milestonePage("m2", "Version bêta", "2026-11-30")];
    expect(await run("complete_milestone", { title: "la maquette" })).toEqual({ success: true, title: "Maquette de l'app" });
    expect(updatedPages).toEqual([{ page_id: "m1", properties: { Statut: { select: { name: "Validé" } } } }]);
    updatedPages.length = 0;
    notionData["db-milestones"] = [milestonePage("m1", "Maquette A", "2026-11-14"), milestonePage("m2", "Maquette B", "2026-11-30")];
    expect(await run("complete_milestone", { title: "maquette" })).toMatchObject({ success: false, candidates: ["Maquette A", "Maquette B"] });
    expect(await run("complete_milestone", { title: "inexistant" })).toMatchObject({ success: false });
    expect(updatedPages).toEqual([]);
  });
});

describe("add_quick_note", () => {
  const idea = (notes: string) => ({ id: "i1", properties: { Titre: title("Løra"), Notes: richText(notes), Statut: select("En cours") } });
  it("ajoute une ligne datée à la suite des notes, sans les écraser", async () => {
    notionData["db-ideas"] = [idea("Première note")];
    expect(await run("add_quick_note", { ideaTitle: "Løra", text: "  penser au son  " })).toEqual({ success: true, ideaTitle: "Løra", note: "penser au son" });
    expect(updatedPages[0].page_id).toBe("i1");
    expect(updatedPages[0].properties.Notes.rich_text.map((part: any) => part.text.content).join("")).toBe(`Première note\n- ${todayInParis()} : penser au son`);
  });
  it("sur une idée sans note, pas de ligne vide en tête ; idée introuvable : rien n'est écrit", async () => {
    notionData["db-ideas"] = [idea("")];
    await run("add_quick_note", { ideaTitle: "Løra", text: "x" });
    expect(updatedPages[0].properties.Notes.rich_text[0].text.content).toBe(`- ${todayInParis()} : x`);
    updatedPages.length = 0;
    notionData["db-ideas"] = [];
    expect(await run("add_quick_note", { ideaTitle: "Rien", text: "x" })).toMatchObject({ success: false });
    expect(updatedPages).toEqual([]);
  });
});

describe("lectures : bilans de la semaine et « que faire maintenant »", () => {
  it("get_week_progress rend les bilans avec une longueur bornée", async () => {
    notionData["db-progress"] = [progressPage("2026-11-09", "a".repeat(900)), progressPage("2026-11-08", "Court")];
    const { bilans } = await run("get_week_progress", {});
    expect(bilans).toHaveLength(2);
    expect(bilans[0]).toEqual({ date: "2026-11-09", bilan: "a".repeat(300) });
    expect(bilans[1]).toEqual({ date: "2026-11-08", bilan: "Court" });
  });

  it("get_what_to_do_now rassemble l'agenda, le jalon et les projets ; une source en panne est dite", async () => {
    notionData["db-agenda"] = [agenda("a1", "Dentiste", DENTIST)];
    notionData["db-milestones"] = [milestonePage("m1", "Maquette", "2026-11-14")];
    notionData["db-ideas"] = [projectPage("p1", "Løra")];
    const now = await run("get_what_to_do_now", {});
    expect(now.agendaAujourdhui).toEqual([{ title: "Dentiste", heure: "14:30" }]);
    expect(now.jalonLePlusProche).toMatchObject({ title: "Maquette", statut: "À faire" });
    expect(now.projetsEnCours).toEqual(["Løra"]);
    expect(now.maintenant).toMatch(/^\d{2}:\d{2}$/);
    delete process.env.NOTION_MILESTONES_DATABASE_ID;
    try {
      expect((await run("get_what_to_do_now", {})).jalonLePlusProche).toContain("indisponible");
    } finally {
      process.env.NOTION_MILESTONES_DATABASE_ID = "db-milestones";
    }
  });
});

describe("routage et confirmation vocale", () => {
  const names = (text: string) => [...(selectToolNames(text) ?? [])];
  it("chaque demande reçoit son outil", () => {
    expect(names("décale mon rendez-vous d'une heure")).toContain("update_agenda_item");
    expect(names("supprime le rendez-vous du dentiste")).toContain("delete_agenda_item");
    expect(names("valide le jalon maquette")).toContain("complete_milestone");
    expect(names("mes bilans de la semaine")).toContain("get_week_progress");
    expect(names("que devrais-je faire maintenant ?")).toContain("get_what_to_do_now");
    expect(names("note : penser au son pour le projet Løra")).toContain("add_quick_note");
  });

  it("toute écriture est dans la consigne de confirmation vocale", () => {
    const { system } = askConfig(loraTools, false, "x", true, true);
    const writes = Object.keys(loraTools).filter((name) => !/^(get|list|suggest)_/.test(name));
    for (const name of writes) expect(system, name).toContain(name);
  });
});
