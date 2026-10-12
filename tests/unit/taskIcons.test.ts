import { describe, expect, it } from "vitest";
import { iconFor } from "../../src/features/calendar/taskIcons";

const label = (title: string) => iconFor(title)?.label;

describe("iconFor : logo deviné par mots-clés dans le titre", () => {
  it.each([
    ["Modélisation du rig sur Blender", "Blender"],
    ["Push sur GitHub", "GitHub"],
    ["Maquette Figma de la page d'accueil", "Figma"],
    ["Ranger Notion", "Notion"],
    ["Cinéma avec Léa", "Cinéma"],
    ["Répondre aux mails", "Mail"],
    ["Réunion d'équipe", "Réunion"],
    ["Concert de Nekfeu", "Concert"],
    ["Festival Solidays", "Festival"],
    ["Vacances en Grèce", "Vacances"],
    ["Voyage à Tokyo", "Voyage"],
    ["Séance de muscu", "Sport"],
    ["Pause café", "Pause"],
    ["Dentiste à 14h", "Rendez-vous"],
  ])("%s -> %s", (title, expected) => expect(label(title)).toBe(expected));

  it("la première règle qui correspond gagne (le plus précis d'abord)", () => {
    expect(label("Blender et GitHub")).toBe("Blender");
  });
  it("pas de logo pour un titre sans mot-clé reconnu", () => {
    expect(iconFor("Faire les courses")).toBeUndefined();
    expect(iconFor("")).toBeUndefined();
  });
  it("faux amis : une révision de vélo n'est pas du sport", () => {
    expect(label("Révision vélo")).not.toBe("Sport");
  });
  it("ignore la casse", () => expect(label("BLENDER")).toBe("Blender"));
});

describe("iconFor : la catégorie Notion passe avant les mots-clés", () => {
  it("la catégorie gagne sur le titre", () => expect(iconFor("Push sur GitHub", "Figma")?.label).toBe("Figma"));
  it("la catégorie donne un logo à un titre sans mot-clé", () => expect(iconFor("Faire les courses", "Sport")?.label).toBe("Sport"));
  it("« Autre » = pas de logo, même si le titre contient un mot-clé", () => expect(iconFor("Push sur GitHub", "Autre")).toBeUndefined());
  it("catégorie inconnue ou vide : retour aux mots-clés", () => {
    expect(iconFor("Push sur GitHub", "Inconnue")?.label).toBe("GitHub");
    expect(iconFor("Push sur GitHub", undefined)?.label).toBe("GitHub");
  });
});
