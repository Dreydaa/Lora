import { describe, expect, it } from "vitest";
import { agendaLine, bilanLine, dayLine, milestoneLine } from "../../lib/briefing";
import type { AgendaItem, Milestone } from "../../lib/types";

const TODAY = "2026-10-07"; // un mercredi

const item = (title: string, date: string | null, status = "À faire"): AgendaItem => ({ id: title, title, date, status, type: "Perso" });
const milestone = (title: string, dueDate: string | null, status = "À faire"): Milestone => ({ id: title, title, dueDate, status });

describe("bilanLine (bilan d'hier)", () => {
  it("reprend le bilan d'hier tel quel", () => {
    expect(bilanLine({ review: "rig fini", date: "2026-10-06" }, TODAY)).toBe("Bilan d'hier: rig fini.");
  });
  it("un bilan saisi après minuit (daté d'aujourd'hui) compte pour hier", () => {
    expect(bilanLine({ review: "ok", date: TODAY }, TODAY)).toContain("ok");
  });
  it("un ancien bilan est présenté comme manquant, sans être ressorti", () => {
    const line = bilanLine({ review: "vieux bilan", date: "2026-10-03" }, TODAY);
    expect(line).toContain("AUCUN");
    expect(line).toContain("4 jours");
    expect(line).not.toContain("vieux bilan");
  });
  it("aucun bilan jamais enregistré", () => {
    expect(bilanLine({ review: "Aucun bilan", date: null }, TODAY)).toContain("jamais");
  });
  it("retour de pause : pas de reproche, dernier bilan rappelé", () => {
    const line = bilanLine({ review: "rig fini", date: "2026-10-09" }, "2026-10-12", { start: "2026-10-10", end: "2026-10-11" });
    expect(line).toContain("pas un manquement");
    expect(line).toContain("rig fini");
    expect(line).not.toContain("AUCUN");
  });
});

describe("agendaLine (7 prochains jours)", () => {
  const line = agendaLine(
    [item("Dentiste", "2026-10-07"), item("Coiffeur", "2026-10-08T14:30:00"), item("Cinéma", "2026-10-11"), item("Mariage", "2026-11-20")],
    TODAY,
  );
  it("donne l'échéance explicite de chaque rendez-vous", () => {
    expect(line).toContain("Dentiste (aujourd'hui)");
    expect(line).toContain("Coiffeur (demain à 14:30)");
    expect(line).toContain("Cinéma (dans 4 jours, dimanche 11/10)");
  });
  it("ignore ce qui dépasse l'horizon de 7 jours", () => expect(line).not.toContain("Mariage"));
  it("garde 5 rendez-vous au maximum", () => {
    const many = Array.from({ length: 8 }, (_, i) => item(`RDV ${i}`, "2026-10-08"));
    expect(agendaLine(many, TODAY).match(/RDV/g)).toHaveLength(5);
  });
  it("agenda vide", () => expect(agendaLine([], TODAY)).toContain("rien de prévu"));
  it("ignore les entrées sans date", () => expect(agendaLine([item("Sans date", null)], TODAY)).toContain("rien de prévu"));
});

describe("dayLine (journée écoulée)", () => {
  it("compte les tâches faites sur le total et liste les restantes", () => {
    expect(dayLine([item("A", null, "Fait"), item("B", null), item("C", null, "Fait")])).toBe("Journée: 2/3 tâche(s) faite(s). Restent à faire: B.");
  });
  it("tout fait : rien à lister", () => expect(dayLine([item("A", null, "Fait")])).not.toContain("Restent"));
  it("journée vide : le dit sans inventer de tâches", () => expect(dayLine([])).toContain("rien n'était prévu"));
});

describe("milestoneLine (prochain jalon)", () => {
  it("un jalon en retard passe avant un jalon à venir", () => {
    expect(milestoneLine([milestone("Futur", "2026-10-12"), milestone("Retard", "2026-10-05")], TODAY)).toBe("Prochain jalon: Retard (en retard de 2 jour(s)).");
  });
  it("échéance explicite, jalon validé ignoré", () => {
    const line = milestoneLine([milestone("Fini", "2026-10-06", "Validé"), milestone("Demain", "2026-10-08")], TODAY);
    expect(line).toContain("Demain (demain)");
    expect(line).not.toContain("Fini");
  });
  it("aucun jalon, ou jalons sans échéance", () => {
    expect(milestoneLine([], TODAY)).toContain("aucun");
    expect(milestoneLine([milestone("Sans date", null)], TODAY)).toContain("aucun");
  });
});
