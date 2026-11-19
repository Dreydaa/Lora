// lib/ai/tool-routing.ts
// Chaque appel à Groq renvoie toutes les définitions d'outils, or la limite gratuite est de 8 000 jetons par minute :
// on n'envoie que les outils dont un mot-clé apparaît dans le message. Aucun mot-clé reconnu = tous les outils (suite
// d'une conversation, formulation inattendue) : un outil en trop coûte des jetons, un outil manquant bloque l'action.

type ToolGroup = { tools: string[]; pattern: RegExp };

const GROUPS: ToolGroup[] = [
  {
    tools: ["create_idea", "update_idea_notes", "update_idea_status", "add_quick_note"],
    pattern: /\bidee|projet|\bnotes?\b|statut|archiv|abandon|en cours|brute|\bapp\b|\bsite\b|\bjeu\b|logiciel|concept/,
  },
  {
    tools: ["complete_project"],
    pattern: /termin|\bfini|livr|boucl|finalis|complet|achev|valide/,
  },
  { tools: ["create_milestone", "list_milestones", "complete_milestone"], pattern: /jalon|echeance|deadline|milestone|etape|objectif/ },
  // Modifier ou supprimer une entrée de l'agenda (« décale mon rendez-vous d'une heure », « supprime le dentiste »).
  { tools: ["update_agenda_item", "delete_agenda_item"], pattern: /decal|deplace|report|repouss|retard|recul|modifi|chang|supprim|efface|enleve|retire|renomm|annul/ },
  // « Que devrais-je faire maintenant ? » : agenda, jalon et projets d'un coup.
  { tools: ["get_what_to_do_now"], pattern: /que (devrais|dois|puis|peux)[- ]?je faire|quoi faire|par quoi (commencer|je commence)|je fais quoi|maintenant/ },
  {
    tools: ["add_agenda_item"],
    pattern:
      /agenda|rdv|rendez|reunion|rappel|calendrier|planifi|programm|ajoute|mets?\b|demain|apres-demain|ce soir|cette semaine|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d\s?h\b|\d{1,2}[/-]\d{1,2}|\b\d{1,2}\s(janv|fevr|mars|avr|mai|juin|juil|aout|sept|oct|nov|dec)/,
  },
  { tools: ["add_shift_schedule"], pattern: /shift|travaille|boulot|horaire|planning|tous les jours|du (lundi|mardi|mercredi|jeudi|vendredi)|contrat|\d\s?h\b/ },
  { tools: ["update_briefing_schedule", "get_briefing"], pattern: /briefing|bilan|decale|heure d.envoi|matin|soir|reveil/ },
  // Lectures (voix et Telegram) : un avis sur un projet a besoin des idées, des jalons et de l'agenda ensemble.
  { tools: ["list_ideas", "list_milestones", "get_agenda"], pattern: /\bidees?\b|projets?|en cours|avis|pense|conseil|tache|prevu|programme|a faire|planning|agenda|rdv|rendez|calendrier/ },
  // Un merci peut appeler une suggestion (« merci » après un briefing) : les lectures suffisent, pas tous les outils.
  { tools: ["list_ideas", "list_milestones", "get_agenda"], pattern: /\bmerci|\bthanks?\b/ },
  { tools: ["get_weather"], pattern: /meteo|temps (fait|il)|pluie|pleu|temperature|degres|soleil|parapluie|chaud|froid/ },
  { tools: ["get_news"], pattern: /\bactus?\b|actualite|news|nouvelles|infos?\b|journal|bourse|cac ?40|marches?\b|economi|monde|tech|\bmode\b|sport|cultur|scienc/ },
  { tools: ["get_last_progress", "get_week_progress"], pattern: /bilan|hier|derniere? (fois|seance|session)|avance|semaine/ },
  { tools: ["set_break", "cancel_break"], pattern: /pause|vacance|week-?end|repos|conge|ne (vais|travaille|bosse)|pas (bosser|travailler)|jusqu.a|reprend|annule/ },
  {
    tools: ["get_settings"],
    pattern: /reglage|parametre|configur|\bsettings?\b|heure du (briefing|bilan)|a quelle heure|ma pause|pause (actuelle|en cours|prevue)|quelles? (applications?|apps?)/,
  },
  { tools: ["record_progress"], pattern: /bilan|aujourd|avance|travaille|bosse|j.ai fait|progres|journee|ce soir|touche/ },
];

function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Noms des outils à envoyer pour ce message ; null = tous.
export function selectToolNames(input: string): Set<string> | null {
  const text = normalize(input);
  const names = new Set<string>();
  for (const group of GROUPS) {
    if (group.pattern.test(text)) group.tools.forEach((name) => names.add(name));
  }
  return names.size === 0 ? null : names;
}

export function pickTools<T extends Record<string, unknown>>(tools: T, input: string): T {
  const names = selectToolNames(input);
  if (!names) return tools;
  return Object.fromEntries(Object.entries(tools).filter(([name]) => names.has(name))) as T;
}
