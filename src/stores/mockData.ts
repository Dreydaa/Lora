import type { AgendaItem, Article } from "../../lib/types";
import type { DashboardData } from "../types/dashboard";
import { localDayKey, parseKey } from "../lib/format";

// Données factices affichées le temps que le premier fetch backend aboutisse, ou en repli
// si l'API est injoignable (cf. src/features/dashboard/DashboardPage.tsx et docs/ai/STATUS.md).
const day = (offset: number, time?: string) => (time ? `${localDayKey(offset)}T${time}` : localDayKey(offset));
const perso = (id: string, title: string, offset: number, time?: string, end?: string): AgendaItem => ({ id, title, date: day(offset, time), end: end ? day(offset, end) : null, status: "Prévu", type: "Perso" });

// Rythme de travail : 5h–13h du lundi au vendredi, comme un add_shift_schedule.
const shifts: AgendaItem[] = Array.from({ length: 80 }, (_, i) => i - 35)
  .filter((offset) => { const weekday = parseKey(localDayKey(offset)).getDay(); return weekday >= 1 && weekday <= 5; })
  .map((offset) => ({ id: `shift${offset}`, title: "Shift", date: day(offset, "05:00"), end: day(offset, "13:00"), status: "Prévu", type: "Shift" }));

const articles: Article[] = [
  { tag: "Tech", title: "Blender 5.1 sort avec un nouveau moteur de rendu temps réel", url: "https://www.blender.org/news/" },
  { tag: "Tech", title: "Les GPU d'entrée de gamme passent à 16 Go", url: "https://www.example.com/tech/gpu-16-go" },
  { tag: "Tech", title: "Un nouveau moteur de jeu open source vise les petites équipes", url: "https://www.example.com/tech/moteur-open-source" },
  { tag: "Mode", title: "La semaine de la mode de Paris mise sur l'upcycling", url: "https://www.example.com/mode/upcycling" },
  { tag: "Mode", title: "Les sneakers techniques reviennent en force", url: "https://www.example.com/mode/sneakers-techniques" },
  { tag: "Mode", title: "Le denim brut s'impose dans les collections d'automne", url: "https://www.example.com/mode/denim-brut" },
];

export const mockData: DashboardData = {
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
    { id: "m1", title: "Modéliser le personnage", dueDate: day(-6), status: "Terminé", ideaId: "i6" },
    { id: "m2", title: "UV + textures", dueDate: day(-1), status: "En retard", ideaId: "i6" },
    { id: "m3", title: "Rig de base", dueDate: day(4), status: "En cours", ideaId: "i6" },
    { id: "m4", title: "Animation idle", dueDate: day(12), status: "À faire", ideaId: "i6" },
  ],
  ideas: [
    { id: "i1", title: "Løra", size: "Grand", status: "En cours", notes: "Assistant perso sur Telegram avec dashboard en verre et briefings quotidiens.", since: day(-40), updated: day(-1) },
    { id: "i2", title: "Court-métrage low poly", size: "Moyen", status: "Brute", since: day(-20) },
    { id: "i3", title: "Pack de props", size: "Petit", status: "Brute", since: day(-12) },
    { id: "i4", title: "Portfolio web", size: "Moyen", status: "En cours", notes: "Vitrine des rendus Blender et des projets code, avec études de cas.", since: day(-18), updated: day(-6) },
    { id: "i5", title: "Bot Discord", size: "Petit", status: "Terminé", since: day(-60) },
    { id: "i6", title: "Personnage 3D", size: "Grand", status: "En cours", notes: "Personnage stylisé animé : modélisation, UV, rig puis cycle idle.", since: day(-8), updated: day(0) },
  ],
  settings: { morningTime: "06:00", eveningTime: "20:00" },
  briefing: "Shift de 5h à 13h, récupère avant de t'y remettre. Le jalon « UV + textures » a un jour de retard : c'est ton objectif ce soir.",
  eveningBriefing: "Deux tâches sur trois bouclées, Boss. Il reste le jalon « UV + textures », avec un jour de retard : rien d'irrattrapable.",
  articles,
};
