import { CalendarCheck, Clapperboard, Coffee, Dumbbell, Mail, Music, Palmtree, Plane, Tent, Users, type LucideIcon } from "lucide-react";
import { siBlender, siFigma, siGithub, siNotion, type SimpleIcon } from "simple-icons";

// Pastille d'une tâche : logo de marque (simple-icons) ou pictogramme (lucide) coloré.
export type TaskIcon = { id: string; label: string; color: string; brand?: SimpleIcon; glyph?: LucideIcon };

export const brand = (icon: SimpleIcon): TaskIcon => ({ id: icon.slug, label: icon.title, color: `#${icon.hex}`, brand: icon });
export const glyph = (id: string, label: string, color: string, icon: LucideIcon): TaskIcon => ({ id, label, color, glyph: icon });

// Icône devinée par mots-clés dans le titre (Notion n'a pas de champ catégorie).
// Pour en ajouter une : une ligne ici ; la première qui correspond gagne, donc le plus précis en haut.
const TASK_ICONS: { icon: TaskIcon; match: RegExp }[] = [
  { icon: brand(siBlender), match: /blender|\brig\b|\buv\b|texture|sculpt|rendu|animation|mod[ée]lis/i },
  { icon: brand(siGithub), match: /github|\bgit\b|commit|\bpr\b|pull request|\brepo\b|\bcode\b|\bbug\b|d[ée]ploi/i },
  { icon: brand(siFigma), match: /figma|maquette/i },
  { icon: brand(siNotion), match: /notion/i },
  { icon: glyph("cinema", "Cinéma", "#e0457b", Clapperboard), match: /cin[ée]ma|\bfilm\b/i },
  { icon: glyph("mail", "Mail", "#3b82f6", Mail), match: /\bmails?\b|e-?mails?|courriel/i },
  { icon: glyph("reunion", "Réunion", "#8b5cf6", Users), match: /r[ée]union|meeting|\bvisio\b|\bcall\b/i },
  { icon: glyph("concert", "Concert", "#d97706", Music), match: /concert|\bgig\b/i },
  { icon: glyph("festival", "Festival", "#ef4444", Tent), match: /festival|\bfest\b/i },
  { icon: glyph("vacances", "Vacances", "#14b8a6", Palmtree), match: /vacances|cong[ée]s?\b/i },
  { icon: glyph("voyage", "Voyage", "#0ea5e9", Plane), match: /voyage|\btrip\b|avion|\bvol\b|\btrain\b|week-?end|s[ée]jour/i },
  {
    icon: glyph("sport", "Sport", "#22c55e", Dumbbell),
    match: /sport|\bgym\b|muscu|fitness|crossfit|running|footing|jogging|course [àa] pied|sortie v[ée]lo|cyclisme|natation|piscine|\bfoot(ball)?\b|basket|tennis|badminton|volley|handball|rugby|boxe|judo|karat[ée]|escalade|yoga|pilates|danse|randonn[ée]e|\bski\b|surf|entra[iî]nement|workout/i,
  },
  { icon: glyph("pause", "Pause", "#a16207", Coffee), match: /pause|\bbreak\b|sieste|repos/i },
  { icon: glyph("rdv", "Rendez-vous", "#f97316", CalendarCheck), match: /rendez-?vous|\brdv\b|dentiste|m[ée]decin|docteur/i },
];

export const iconFor = (title: string) => TASK_ICONS.find((t) => t.match.test(title))?.icon;
