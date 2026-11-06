import { describe, expect, it } from "vitest";
import { pickTools, selectToolNames } from "../../lib/ai/tool-routing";
import { loraTools } from "../../lib/ai/tools";

const names = (input: string) => [...(selectToolNames(input) ?? Object.keys(loraTools))];

describe("selectToolNames", () => {
  it("envoie tous les outils quand aucun mot-clé n'est reconnu", () => {
    expect(selectToolNames("oui vas-y")).toBeNull();
    expect(selectToolNames("")).toBeNull();
  });

  it("ne garde que les outils de l'agenda pour un rendez-vous", () => {
    const picked = names("ajoute un rdv demain à 14h30 chez le dentiste");
    expect(picked).toContain("add_agenda_item");
    expect(picked).not.toContain("create_idea");
    expect(picked).not.toContain("set_break");
  });

  it("garde les outils d'idée pour une nouvelle idée, accents ou non", () => {
    expect(names("j'ai une idée de projet : une appli météo")).toEqual(expect.arrayContaining(["create_idea", "update_idea_notes"]));
    expect(names("J'AI UNE IDEE")).toContain("create_idea");
  });

  it("garde la pause pour un week-end sans travail", () => {
    expect(names("je ne bosse pas ce week-end")).toEqual(expect.arrayContaining(["set_break", "cancel_break"]));
  });

  it("garde le planning récurrent pour un shift", () => {
    expect(names("je travaille de 5h à 13h du lundi au vendredi jusqu'au 24 octobre")).toContain("add_shift_schedule");
  });

  it("réunit les outils d'un message à plusieurs intentions", () => {
    const picked = names("mon bilan : Løra avancé. Et mets un rdv demain à 10h");
    expect(picked).toEqual(expect.arrayContaining(["record_progress", "add_agenda_item"]));
  });

  it("garde l'outil de réglages seul pour une question sur les réglages", () => {
    expect(names("quels sont tes réglages actuels ?")).toEqual(["get_settings"]);
    expect(names("à quelle heure est mon briefing ?")).toContain("get_settings");
    expect(names("je ne bosse pas ce week-end")).not.toContain("get_settings");
  });

  it("garde le bilan et les jalons", () => {
    expect(names("c'est mon bilan du jour, j'ai avancé sur Løra")).toContain("record_progress");
    expect(names("liste mes jalons")).toContain("list_milestones");
    expect(names("j'ai terminé le projet Løra")).toContain("complete_project");
  });
});

describe("lectures vocales", () => {
  it("route chaque demande de lecture vers son outil", () => {
    expect(names("donne-moi mon briefing du matin")).toContain("get_briefing");
    expect(names("quelle est la météo ?")).toContain("get_weather");
    expect(names("quels sont mes projets en cours ?")).toEqual(expect.arrayContaining(["list_ideas", "list_milestones"]));
    expect(names("qu'est-ce que j'ai de prévu demain ?")).toContain("get_agenda");
    expect(names("qu'est-ce que j'ai fait hier ?")).toContain("get_last_progress");
  });

  it("un simple merci reçoit les lectures, pas les outils d'écriture", () => {
    expect(names("Merci !")).toEqual(["list_ideas", "list_milestones", "get_agenda"]);
  });

  it("n'envoie pas la météo pour un changement d'heure de briefing", () => {
    expect(names("décale le briefing à 8h")).not.toContain("get_weather");
  });
});

describe("pickTools", () => {
  it("renvoie un sous-ensemble des vrais outils", () => {
    const picked = pickTools(loraTools, "liste mes jalons");
    expect(Object.keys(picked).length).toBeLessThan(Object.keys(loraTools).length);
    expect(picked.list_milestones).toBe(loraTools.list_milestones);
  });

  it("renvoie tous les outils sans mot-clé", () => {
    expect(pickTools(loraTools, "ok")).toBe(loraTools);
  });

  it("ne référence que des outils qui existent", () => {
    const all = new Set(Object.keys(loraTools));
    for (const input of ["idée", "jalon", "rdv", "shift", "briefing", "pause", "bilan", "terminé"]) {
      for (const name of names(input)) expect(all.has(name)).toBe(true);
    }
  });
});
