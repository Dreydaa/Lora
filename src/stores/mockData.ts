import type { AgendaItem } from "../../lib/types";
import type { DashboardData } from "../types/dashboard";
import { localDayKey, parseKey } from "../lib/format";

// Données factices tant que le dashboard n'est branché à aucun backend (cf. docs/ai/STATUS.md).
const day = (offset: number, time?: string) => (time ? `${localDayKey(offset)}T${time}` : localDayKey(offset));
const perso = (id: string, title: string, offset: number, time?: string, end?: string): AgendaItem => ({ id, title, date: day(offset, time), end: end ? day(offset, end) : null, status: "Prévu", mode: "ACTIF", type: "Perso" });

// Rythme de travail : 5h–13h du lundi au vendredi, comme un add_shift_schedule.
const shifts: AgendaItem[] = Array.from({ length: 80 }, (_, i) => i - 35)
  .filter((offset) => { const weekday = parseKey(localDayKey(offset)).getDay(); return weekday >= 1 && weekday <= 5; })
  .map((offset) => ({ id: `shift${offset}`, title: "Shift", date: day(offset, "05:00"), end: day(offset, "13:00"), status: "Prévu", mode: "PAUSE", type: "Shift" }));

export const mockData: DashboardData = {
  mode: "ACTIF",
  streak: 12,
  agenda: [
    ...shifts,
    perso("a1", "Cinéma", -9, "20:30"),
    perso("a2", "Appel famille", -4, "18:00"),
    perso("a3", "Rendu Blender — éclairage", 0, "17:30", "19:30"),
    perso("a4", "Rdv dentiste", 1, "16:00"),
    perso("a5", "Session sculpt", 2, "10:00", "12:30"),
    perso("a6", "Week-end à Lyon", 5),
    perso("a7", "Cours de dessin", 9, "18:00", "19:30"),
    perso("a8", "Live Blender communauté", 9, "20:00"),
    perso("a9", "Salon du jeu vidéo", 15),
    perso("a10", "Révision vélo", 22, "14:00"),
  ],
  milestones: [
    { id: "m1", title: "Modéliser le personnage", dueDate: day(-6), status: "Terminé" },
    { id: "m2", title: "UV + textures", dueDate: day(-1), status: "En retard" },
    { id: "m3", title: "Rig de base", dueDate: day(4), status: "En cours" },
    { id: "m4", title: "Animation idle", dueDate: day(12), status: "À faire" },
  ],
  ideas: [
    { id: "i1", title: "Soza", size: "Grand", status: "En cours" },
    { id: "i2", title: "Court-métrage low poly", size: "Moyen", status: "Brute" },
    { id: "i3", title: "Pack de props", size: "Petit", status: "Brute" },
    { id: "i4", title: "Portfolio web", size: "Moyen", status: "En cours" },
    { id: "i5", title: "Bot Discord", size: "Petit", status: "Archivée" },
  ],
  settings: { shiftActive: true, shiftStartHour: 4, shiftEndHour: 15, morningTime: "06:00", eveningTime: "20:00", pendingChangeDate: null },
  briefing: "Shift de 5h à 13h, récupère avant de t'y remettre.\nObjectif du soir : finir l'éclairage du rendu.\nJalon « UV + textures » en retard d'un jour.",
  news: [
    "[Tech] Blender 5.1 sort avec un nouveau moteur de rendu temps réel",
    "[Tech] Les GPU d'entrée de gamme passent à 16 Go",
    "[Mode] La semaine de la mode de Paris mise sur l'upcycling",
    "[Mode] Les sneakers techniques reviennent en force",
  ],
  quiz: "Quel petit rendu validerais-tu maintenant ?",
};
