// lib/ai/tools.ts
import { tool } from "ai";
import { z } from "zod";
import { addIdea, findIdeaByTitle, completeIdea, setIdeaStatus, updateIdeaNotes, getIdeasToPropose, getProjectsInProgress, getAllIdeas, resolveProjectNames } from "../notion/idees";
import { CATEGORIES } from "../types";
import { createMilestone, completeMilestoneForIdea, getMilestones } from "../notion/milestones";
import { addAgendaItem, addShiftSchedule, getUpcomingAgenda } from "../notion/agenda";
import { getLatestProgress, saveProgress } from "../notion/progress";
import { getSettings, saveBriefingTime } from "../notion/settings";
import { upsertSchedule } from "../integrations/qstash";
import { getWeather } from "../integrations/weather";
import { clearBreak, getAgentApps, getBreak, getLastBriefing, setBreak } from "../memory";
import { dayLabel, todayInParis } from "../date";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_IDEAS_READ = 25; // chaque idée lue coûte des jetons, et Groq n'en laisse que 8 000 par minute

// Choisit le logo affiché dans le dashboard ; null accepté parce que Groq envoie parfois null au lieu d'omettre.
const category = z
  .enum(CATEGORIES)
  .nullish()
  .describe("Détermine le logo du dashboard : la plus proche du sujet, « Autre » sinon.");

// Marque un projet terminé : l'idée passe en Terminé et ses jalons ouverts sont validés. Le nom dit par l'utilisateur est d'abord
// rapproché des projets en cours (« le site d'Andy » devient « Site pour Andy »), comme pour le bilan.
async function finishProject(projectTitle: string) {
  const known = await getProjectsInProgress().catch(() => []);
  const idea = await findIdeaByTitle(resolveProjectNames([projectTitle], known)[0] ?? projectTitle);
  if (!idea) return { success: false, projectTitle, reason: "Idée introuvable dans Notion" };
  await completeIdea(idea.id);
  const milestones = await completeMilestoneForIdea(idea.id);
  return { success: true, projectTitle, ideaCompleted: true, milestonesValidated: milestones };
}

export const loraTools = {
  create_idea: tool({
    description:
      "Enregistre une idée dans Notion. Estime toi-même la taille selon l'ampleur réelle, sans jamais la demander (sauf si l'utilisateur l'a précisée : respecte son choix). Rédige dans `notes` une synthèse complète, pas un résumé de quelques lignes : le fond (objectif, portée, enjeux, éléments clés) et la forme (structure, étapes, composants évoqués), assez riche pour comprendre l'idée plus tard sans la conversation. N'invente aucun fait : organise et clarifie seulement.",
    inputSchema: z.object({
      title: z.string(),
      size: z
        .enum(["Petit", "Moyen", "Grand"])
        .describe(
          "Petit: quelques heures à 1-2 jours ; Moyen: plusieurs jours à ~3 semaines ; Grand: long, complexe ou à plusieurs composants. Décide seul.",
        ),
      notes: z
        .string()
        .describe(
          "Synthèse structurée du fond ET de la forme, telle que décrite par l'utilisateur. Si sa description est très longue, condense-la sans perdre l'essentiel.",
        ),
      statut: z
        .enum(["Brute", "En cours", "Archivée"])
        .nullish()
        .describe(
          "Seulement si l'utilisateur précise un statut de départ (« ajoute ce projet et marque-le en cours »). Sinon vide : l'idée est créée « Brute ».",
        ),
      category,
    }),
    execute: async ({ title, size, notes, statut, category }) => {
      const finalStatut = statut ?? undefined;
      console.log("[tool] create_idea →", { title, size, statut: finalStatut, category, notesLength: notes.length });
      if (!title) throw new Error("create_idea: title is required");
      const page = await addIdea(title, size, notes, finalStatut, category ?? undefined);
      console.log("[tool] ✅ idée créée :", page.id);
      return { success: true, title, size, statut: finalStatut ?? "Brute", pageId: page.id };
    },
  }),

  update_idea_notes: tool({
    description:
      "Réécrit la synthèse (notes) d'une idée déjà enregistrée quand l'utilisateur la détaille ou la complète. Ce texte REMPLACE l'ancienne note : combine ce que tu connais déjà de l'idée avec les nouvelles précisions, sans écraser une note riche par une plus pauvre. Mêmes règles que create_idea.",
    inputSchema: z.object({
      title: z.string().describe("Le titre (ou un extrait) de l'idée/projet à compléter"),
      notes: z
        .string()
        .describe("Nouvelle synthèse complète (remplace l'ancienne), fond ET forme, structurée."),
    }),
    execute: async ({ title, notes }) => {
      console.log("[tool] update_idea_notes →", { title, notesLength: notes.length });
      const idea = await findIdeaByTitle(title);
      if (!idea) return { success: false, reason: "Idée introuvable dans Notion" };
      await updateIdeaNotes(idea.id, notes);
      return { success: true, title };
    },
  }),

  update_idea_status: tool({
    description:
      "Change le statut d'une idée existante (Brute, En cours, Archivée = abandonné) sur demande explicite. Ni pour en créer une, ni pour la marquer terminée (complete_project, qui gère aussi le jalon lié).",
    inputSchema: z.object({
      title: z.string().describe("Titre (ou extrait) de l'idée"),
      statut: z.enum(["Brute", "En cours", "Archivée"]),
    }),
    execute: async ({ title, statut }) => {
      console.log("[tool] update_idea_status →", { title, statut });
      const idea = await findIdeaByTitle(title);
      if (!idea) return { success: false, reason: "Idée introuvable dans Notion" };
      await setIdeaStatus(idea.id, statut);
      return { success: true, title, statut };
    },
  }),

  create_milestone: tool({
    description: "Crée un jalon Notion de 7 à 10 jours, éventuellement lié à une idée existante",
    inputSchema: z.object({
      title: z.string(),
      dueDate: z.string().describe("Date ISO"),
      ideaTitle: z.string().nullish().describe("Titre de l'idée d'origine, si ce jalon en découle"),
      category,
    }),
    execute: async ({ title, dueDate, ideaTitle, category }) => {
      console.log("[tool] create_milestone →", { title, dueDate, ideaTitle, category });
      const idea = ideaTitle ? await findIdeaByTitle(ideaTitle) : null;
      const page = await createMilestone(title, dueDate, idea?.id, category ?? undefined);
      return { success: true, title, dueDate, linkedToIdea: !!idea, pageId: page.id };
    },
  }),

  complete_project: tool({
    description: "Marque un projet terminé : l'idée passe en statut Terminé et son jalon lié est validé.",
    inputSchema: z.object({
      projectTitle: z.string().describe("Titre (ou extrait) du projet terminé"),
    }),
    execute: async ({ projectTitle }) => {
      console.log("[tool] complete_project →", { projectTitle });
      return finishProject(projectTitle);
    },
  }),

  suggest_projects: tool({
    description:
      "Propose 3 idées à commencer, une par taille (Grand/Moyen/Petit), les plus anciennes d'abord ; sans idée disponible pour une taille, les 3 plus anciennes toutes tailles. À utiliser après qu'un projet vient d'être marqué terminé, ou sur demande.",
    inputSchema: z.object({}),
    execute: async () => {
      console.log("[tool] suggest_projects");
      const suggestions = await getIdeasToPropose();
      return { suggestions };
    },
  }),

  add_agenda_item: tool({
    description:
      "Ajoute à l'agenda Notion une tâche ou un rendez-vous ponctuel (pas un jalon de plusieurs jours, pas un planning récurrent : add_shift_schedule).",
    inputSchema: z.object({
      title: z.string(),
      date: z
        .string()
        .describe(
          "Date ISO. Avec une heure : YYYY-MM-DDTHH:mm (ex: 2026-10-05T14:30), pour un horaire précis dans Notion Calendar. Sinon YYYY-MM-DD.",
        ),
      endDate: z
        .string()
        .nullish()
        .describe("Fin, même format que `date`, si une durée est précisée (rdv de 14h à 15h30)."),
      category,
    }),
    execute: async ({ title, date, endDate, category }) => {
      const finalEndDate = endDate ?? undefined;
      console.log("[tool] add_agenda_item →", { title, date, endDate: finalEndDate, category });
      const page = await addAgendaItem(title, date, "Perso", finalEndDate, category ?? undefined);
      return { success: true, title, date, pageId: page.id };
    },
  }),

  add_shift_schedule: tool({
    description:
      "Ajoute un planning de travail récurrent (shift à horaires fixes) : un bloc par jour ouvré de la plage, de type Shift (couleur distincte des rendez-vous dans Notion Calendar). Pour un rythme répété (« je travaille de 5h à 13h du lundi au vendredi jusqu'au 24 octobre »), pas pour un rendez-vous ponctuel (add_agenda_item).",
    inputSchema: z.object({
      startDate: z.string().describe("YYYY-MM-DD du premier jour ; aujourd'hui si non précisé."),
      endDate: z.string().describe("YYYY-MM-DD du dernier jour, inclus (ex: fin de contrat)."),
      startTime: z.string().describe("Début du shift, HH:mm"),
      endTime: z.string().describe("Fin du shift, HH:mm"),
      weekdays: z
        .array(z.enum(["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]))
        .nullish()
        .describe("Jours concernés ; lundi à vendredi par défaut."),
    }),
    execute: async ({ startDate, endDate, startTime, endTime, weekdays }) => {
      console.log("[tool] add_shift_schedule →", { startDate, endDate, startTime, endTime, weekdays });
      const days = weekdays ?? ["lundi", "mardi", "mercredi", "jeudi", "vendredi"];
      const count = await addShiftSchedule(startDate, endDate, startTime, endTime, days);
      return { success: true, count, startDate, endDate, startTime, endTime };
    },
  }),

  list_milestones: tool({
    description: "Liste les jalons de projet à venir (non validés), triés par échéance, avec leur statut.",
    inputSchema: z.object({}),
    execute: async () => {
      console.log("[tool] list_milestones");
      const milestones = await getMilestones();
      return { milestones };
    },
  }),

  update_briefing_schedule: tool({
    description:
      "Change l'heure d'envoi du briefing du matin ou du bilan du soir, sur demande explicite.",
    inputSchema: z.object({
      type: z.enum(["morning", "evening"]).describe("morning = briefing du matin, evening = bilan du soir"),
      time: z.string().describe("HH:mm, ex: 07:30"),
    }),
    execute: async ({ type, time }) => {
      console.log("[tool] update_briefing_schedule →", { type, time });
      const scheduleId = type === "morning" ? "soza-morning-briefing" : "soza-evening-review";
      const path = type === "morning" ? "/api/cron-morning" : "/api/cron-evening";
      await upsertSchedule(scheduleId, path, time);
      await saveBriefingTime(type, time, scheduleId);
      return { success: true, type, time };
    },
  }),

  set_break: tool({
    description:
      "Met Løra en pause sur des jours sans travail (week-end, vacances) : plus de briefing du matin ni de bilan du soir, absence de bilan non reprochée, le briefing accueille la reprise. À utiliser quand l'utilisateur annonce qu'il ne bossera pas ces jours-là. Remplace toute pause précédente. Convertis toi-même « ce week-end », « jusqu'à dimanche » en dates à partir de la date du jour.",
    inputSchema: z.object({
      startDate: z.string().regex(ISO_DAY).describe("Premier jour, YYYY-MM-DD (aujourd'hui si la pause commence maintenant)."),
      endDate: z.string().regex(ISO_DAY).describe("Dernier jour, inclus, YYYY-MM-DD."),
    }),
    execute: async ({ startDate, endDate }) => {
      console.log("[tool] set_break →", { startDate, endDate });
      if (endDate < startDate) return { success: false, reason: "La date de fin précède la date de début" };
      await setBreak(startDate, endDate);
      return { success: true, startDate, endDate };
    },
  }),

  cancel_break: tool({
    description: "Annule la pause en cours ou programmée : les briefings et bilans reprennent normalement.",
    inputSchema: z.object({}),
    execute: async () => {
      console.log("[tool] cancel_break");
      await clearBreak();
      return { success: true };
    },
  }),

  get_settings: tool({
    description:
      "Lit les réglages actuels de Løra : heures du briefing du matin et du bilan du soir, pause en cours ou à venir, applications qu'elle peut ouvrir sur le PC. À appeler dès qu'on te demande tes réglages ; ne les donne jamais de mémoire.",
    inputSchema: z.object({}),
    execute: async () => {
      console.log("[tool] get_settings");
      const [settings, brk, apps] = await Promise.allSettled([getSettings(), getBreak(), getAgentApps()]);
      // Une lecture en échec devient « indisponible » : le modèle doit l'avouer, pas deviner (chaque source échoue seule).
      const read = <T>(result: PromiseSettledResult<T>, pick: (value: T) => unknown) => {
        if (result.status === "fulfilled") return pick(result.value);
        console.error("[tool] get_settings, lecture en échec :", result.reason);
        return "indisponible (lecture impossible)";
      };
      return {
        briefing: read(settings, (s) => ({ matin: s.morningTime || "non renseignée", soir: s.eveningTime || "non renseignée" })),
        pause: read(brk, (b) => (b && b.end >= todayInParis() ? { debut: b.start, fin: b.end } : "aucune pause en cours ni à venir")),
        applications: read(apps, (a) => (a.length ? a : "inconnues : l'app Løra du PC n'a pas encore envoyé sa liste")),
      };
    },
  }),

  // Lectures : Løra sait enfin dire ce qu'il y a dans Notion (avant, seuls list_milestones et get_settings lisaient).
  get_agenda: tool({
    description: "Lit les prochains rendez-vous et tâches de l'agenda Notion (hors shifts), avec leur date et `quand` (aujourd'hui, demain, dans N jours). Reprends `quand` tel quel : ne dis jamais « aujourd'hui » pour un autre jour. À appeler dès qu'on te demande l'agenda ou ce qui est prévu ; ne le donne jamais de mémoire.",
    inputSchema: z.object({}),
    execute: async () => {
      console.log("[tool] get_agenda");
      const items = await getUpcomingAgenda();
      // `quand` (« aujourd'hui », « demain », « dans 10 jours, dimanche 15/11 ») est calculé ici : à partir d'une date brute, le modèle
      // calculait mal le jour de la semaine et disait « aujourd'hui » pour un événement du 15 novembre.
      const today = todayInParis();
      return { today, items: items.map(({ title, date, end, status }) => ({ title, quand: date ? dayLabel(date.slice(0, 10), today) : null, date, end, status })) };
    },
  }),

  list_ideas: tool({
    description:
      "Lit les idées et projets de Notion (titre, taille, statut). Les projets sont les idées « En cours ». Avec `search`, ajoute un extrait des notes des idées qui correspondent. À appeler pour parler des idées, des projets en cours ou en donner un avis.",
    inputSchema: z.object({
      statut: z.enum(["Brute", "En cours", "Archivée", "Terminé"]).nullish().describe("Seulement ce statut ; vide = tous."),
      search: z.string().nullish().describe("Mot du titre à chercher."),
    }),
    execute: async ({ statut, search }) => {
      console.log("[tool] list_ideas →", { statut, search });
      const wanted = search?.trim().toLowerCase();
      const ideas = (await getAllIdeas())
        .filter((i) => (!statut || i.status === statut) && (!wanted || i.title.toLowerCase().includes(wanted)))
        .slice(0, MAX_IDEAS_READ)
        .map(({ title, size, status, notes }) => ({ title, size, status, ...(wanted ? { notes: notes.slice(0, 200) } : {}) }));
      return { ideas };
    },
  }),

  get_weather: tool({
    description: "Lit la météo actuelle (température et code météo WMO de Open-Meteo : 0 dégagé, 1-3 nuageux à couvert, 45-48 brouillard, 51-67 pluie, 71-77 neige, 80-82 averses, 95-99 orage). Traduis le code en mots, ne le lis jamais. Ne l'invente jamais.",
    inputSchema: z.object({}),
    execute: async () => {
      console.log("[tool] get_weather");
      return { weather: await getWeather() };
    },
  }),

  get_last_progress: tool({
    description: "Lit le dernier bilan enregistré dans Notion (texte et date).",
    inputSchema: z.object({}),
    execute: async () => {
      console.log("[tool] get_last_progress");
      return getLatestProgress();
    },
  }),

  get_briefing: tool({
    description: "Lit le dernier briefing déjà généré (matin ou soir), prêt à être dit : redis-le presque tel quel, sans rien y ajouter.",
    inputSchema: z.object({ type: z.enum(["morning", "evening"]).describe("morning = matin, evening = soir") }),
    execute: async ({ type }) => {
      console.log("[tool] get_briefing →", { type });
      return { briefing: (await getLastBriefing(type)) ?? "Aucun briefing disponible pour l'instant (pause, ou pas encore envoyé)." };
    },
  }),

  record_progress: tool({
    description: "Enregistre le bilan du jour dans Notion. Un seul bilan par jour, même avec plusieurs projets en cours.",
    inputSchema: z.object({
      review: z.string().describe("Résumé court de ce qui a été fait ou non aujourd'hui"),
      projectsWorkedOn: z
        .array(z.string())
        .nullish()
        .describe(
          "Seuls les projets TRAVAILLÉS aujourd'hui, nommés ou confirmés par l'utilisateur, tels qu'il les a dits. Un projet non touché, laissé de côté ou seulement évoqué n'y figure PAS ; n'en déduis aucun. « Løra avancé, personnage 3D pas touché » donne [\"Løra\"]. Omets le champ si aucun projet n'est nommé.",
        ),
      finishedProjects: z
        .array(z.string())
        .nullish()
        .describe(
          "Les projets que l'utilisateur dit TERMINÉS dans ce bilan, tels qu'il les a dits : ils passent en Terminé et leurs jalons sont validés (inutile d'appeler complete_project). Un projet seulement avancé n'y figure PAS. Omets le champ si aucun n'est fini.",
        ),
    }),
    execute: async ({ review, projectsWorkedOn, finishedProjects }) => {
      console.log("[tool] record_progress →", { review, projectsWorkedOn, finishedProjects });
      // Les noms sont rapprochés des vrais titres des projets en cours ; si cette lecture échoue, ils restent tels que tapés.
      const known = projectsWorkedOn?.length ? await getProjectsInProgress().catch(() => []) : [];
      const page = await saveProgress(review, projectsWorkedOn ? resolveProjectNames(projectsWorkedOn, known) : undefined);
      // Après le bilan, qui a besoin des projets encore « En cours » pour rapprocher les noms. Une panne ici ne perd pas le bilan.
      const finished = [];
      for (const name of finishedProjects ?? []) finished.push(await finishProject(name).catch(() => ({ success: false, projectTitle: name, reason: "Notion injoignable" })));
      return { success: true, pageId: page.id, ...(finished.length ? { finished } : {}) };
    },
  }),
};