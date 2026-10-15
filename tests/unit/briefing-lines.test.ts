import { describe, expect, it } from "vitest";
import { agendaLine, bilanLine, dayLine, milestoneLine, projectMilestonesLine, projectsLine } from "../../lib/briefing";
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

const project = (id: string) => ({ id, title: id.toUpperCase() });
const linked = (title: string, dueDate: string, ideaId: string, status = "À faire"): Milestone => ({ ...milestone(title, dueDate, status), ideaId });

describe("projectsLine (projets en cours)", () => {
  it("liste tous les projets, sans limite", () => expect(projectsLine([project("a"), project("b"), project("c"), project("d")])).toBe("Projets en cours: A · B · C · D."));
  it("aucun projet", () => expect(projectsLine([])).toBe("Projets en cours: aucun."));
});

describe("projectMilestonesLine (jalon de chaque projet, le soir)", () => {
  const projects = [project("a"), project("b"), project("c"), project("d")];
  it("un jalon par projet, le plus urgent d'abord, et seulement le prochain de chacun", () => {
    const line = projectMilestonesLine(
      [project("a"), project("b")],
      [linked("A2", "2026-10-20", "a"), linked("A1", "2026-10-12", "a"), linked("B1", "2026-10-08", "b")],
      TODAY,
    );
    expect(line).toBe("Prochain jalon par projet: B : B1 (demain) · A : A1 (dans 5 jours, lundi 12/10).");
    expect(line).not.toContain("A2");
  });
  it("3 projets au maximum", () => {
    const line = projectMilestonesLine(projects, projects.map((p, i) => linked(`J${i}`, `2026-10-1${i}`, p.id)), TODAY);
    expect(line.match(/ : J/g)).toHaveLength(3);
    expect(line).not.toContain("J3");
  });
  it("un jalon validé ne compte pas, un jalon en retard le dit", () => {
    const line = projectMilestonesLine([project("a"), project("b")], [linked("Fini", "2026-10-05", "a", "Validé"), linked("Retard", "2026-10-05", "b")], TODAY);
    expect(line).toContain("B : Retard (en retard de 2 jour(s))");
    expect(line).not.toContain("Fini");
  });
  it("un projet sans jalon est simplement absent", () => {
    expect(projectMilestonesLine([project("a"), project("b")], [linked("A1", "2026-10-12", "a")], TODAY)).not.toContain("B :");
  });
  it("sans projet en cours, ou sans jalon rattaché : le prochain jalon global, comme avant", () => {
    const milestones = [milestone("Libre", "2026-10-12")];
    expect(projectMilestonesLine([], milestones, TODAY)).toBe(milestoneLine(milestones, TODAY));
    expect(projectMilestonesLine([project("a")], milestones, TODAY)).toBe("Prochain jalon: Libre (dans 5 jours, lundi 12/10).");
  });
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
