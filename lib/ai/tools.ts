// lib/ai/tools.ts
import { tool } from "ai";
import { z } from "zod";
import { addIdea, findIdeaByTitle, completeIdea, setIdeaStatus, updateIdeaNotes, getProjectsInProgress, getAllIdeas, resolveProjectNames } from "../notion/idees";
import { CATEGORIES } from "../types";
import { createMilestone, completeMilestoneByTitle, completeMilestoneForIdea, getMilestones } from "../notion/milestones";
import { addAgendaItem, addShiftSchedule, deleteAgendaItem, findAgendaItem, getAgendaOn, getUpcomingAgenda, shiftIso, updateAgendaItem } from "../notion/agenda";
import { getLatestProgress, getRecentProgress, saveProgress } from "../notion/progress";
import { getSettings, saveBriefingTime } from "../notion/settings";
import { upsertSchedule } from "../integrations/qstash";
import { getWeather } from "../integrations/weather";
import { NEWS_TOPICS, getTopicNews } from "../integrations/news";
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
      "Démarre un nouveau projet dans Notion (statut « En cours »), à partir des détails donnés par l'utilisateur. Estime toi-même la taille selon l'ampleur réelle, sans jamais la demander (sauf si l'utilisateur l'a précisée : respecte son choix). Rédige dans `notes` une synthèse complète, pas un résumé de quelques lignes : le fond (objectif, portée, enjeux, éléments clés) et la forme (structure, étapes, composants évoqués), assez riche pour comprendre le projet plus tard sans la conversation. N'invente aucun fait : organise et clarifie seulement.",
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
          "Seulement si l'utilisateur précise un autre statut de départ. Sinon vide : le projet est créé « En cours ».",
        ),
      category,
    }),
    execute: async ({ title, size, notes, statut, category }) => {
      const finalStatut = statut ?? "En cours";
      console.log("[tool] create_idea →", { title, size, statut: finalStatut, category, notesLength: notes.length });
      if (!title) throw new Error("create_idea: title is required");
      const page = await addIdea(title, size, notes, finalStatut, category ?? undefined);
      console.log("[tool] ✅ projet créé :", page.id);
      return { success: true, title, size, statut: finalStatut, pageId: page.id };
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

  // Modifier ou supprimer l'agenda, valider un jalon, une note rapide : des écritures, donc confirmées avant d'agir quand la demande vient de la voix.
  update_agenda_item: tool({
    description:
      "Modifie une entrée de l'agenda Notion : la décale (`shiftMinutes` : « décale d'une heure » = 60, « avance de 30 minutes » = -30, « à demain, même heure » = 1440), la déplace à une date précise (`newDate`) ou la renomme (`newTitle`). Désigne l'entrée par les mots de son titre (`title`) ; sans `title`, c'est la PROCHAINE entrée. Plusieurs entrées qui correspondent : rien n'est modifié, demande laquelle. Pour décaler, utilise toujours shiftMinutes : ne recalcule jamais une date toi-même.",
    inputSchema: z.object({
      title: z.string().nullish().describe("Mots du titre de l'entrée à modifier ; vide = la prochaine entrée de l'agenda."),
      shiftMinutes: z.number().int().nullish().describe("Décalage en minutes, positif = plus tard. Le début et la fin bougent ensemble."),
      newDate: z.string().nullish().describe("Nouvelle date de début, YYYY-MM-DD ou YYYY-MM-DDTHH:mm, seulement si l'utilisateur donne une date précise."),
      newEndDate: z.string().nullish().describe("Nouvelle fin, même format, seulement si l'utilisateur change la durée."),
      newTitle: z.string().nullish().describe("Nouveau titre, seulement pour renommer."),
    }),
    execute: async ({ title, shiftMinutes, newDate, newEndDate, newTitle }) => {
      console.log("[tool] update_agenda_item →", { title, shiftMinutes, newDate, newEndDate, newTitle });
      if (!shiftMinutes && !newDate && !newEndDate && !newTitle) return { success: false, reason: "Rien à modifier : précise un décalage, une date ou un titre" };
      if (shiftMinutes && newDate) return { success: false, reason: "Un décalage OU une nouvelle date, pas les deux" };
      const found = await findAgendaItem(title ?? undefined);
      if (!("item" in found)) {
        return found.candidates.length ? { success: false, reason: "Plusieurs entrées correspondent : demande laquelle", candidates: found.candidates.map((c) => c.title) } : { success: false, reason: "Entrée introuvable dans l'agenda" };
      }
      const { item } = found;
      if (!item.date) return { success: false, reason: "Cette entrée n'a pas de date" };
      try {
        // Heure du mur sans décalage : Notion rend « …+01:00 » mais le fuseau est remis à l'écriture (toDateProperty), les deux ensemble sont refusés.
        const wall = (iso: string) => (iso.includes("T") ? iso.slice(0, 16) : iso);
        const dateChanged = Boolean(shiftMinutes || newDate || newEndDate);
        const start = !dateChanged ? undefined : (newDate ?? (shiftMinutes ? shiftIso(item.date, shiftMinutes) : wall(item.date)));
        const end = newEndDate ?? (shiftMinutes && item.end ? shiftIso(item.end, shiftMinutes) : item.end ? wall(item.end) : null);
        await updateAgendaItem(item.id, { title: newTitle ?? undefined, start, end });
        return { success: true, title: newTitle ?? item.title, ...(start ? { avant: dayLabel(item.date.slice(0, 10), todayInParis()), nouvelleDate: start, quand: dayLabel(start.slice(0, 10), todayInParis()) } : {}) };
      } catch (error) {
        return { success: false, reason: error instanceof Error ? error.message : "Modification impossible" };
      }
    },
  }),

  delete_agenda_item: tool({
    description:
      "Supprime une entrée de l'agenda Notion (elle est archivée : Notion la garde 30 jours dans sa corbeille), désignée par les mots de son titre. Plusieurs entrées qui correspondent : rien n'est supprimé, demande laquelle.",
    inputSchema: z.object({ title: z.string().min(1).describe("Mots du titre de l'entrée à supprimer") }),
    execute: async ({ title }) => {
      console.log("[tool] delete_agenda_item →", { title });
      const found = await findAgendaItem(title);
      if (!("item" in found)) {
        return found.candidates.length ? { success: false, reason: "Plusieurs entrées correspondent : demande laquelle", candidates: found.candidates.map((c) => c.title) } : { success: false, reason: "Entrée introuvable dans l'agenda" };
      }
      await deleteAgendaItem(found.item.id);
      return { success: true, title: found.item.title };
    },
  }),

  complete_milestone: tool({
    description:
      "Valide UN jalon (statut Validé), désigné par les mots de son titre. Pour un projet entier terminé, utilise complete_project. Plusieurs jalons qui correspondent : rien n'est validé, demande lequel.",
    inputSchema: z.object({ title: z.string().min(1).describe("Mots du titre du jalon à valider") }),
    execute: async ({ title }) => {
      console.log("[tool] complete_milestone →", { title });
      const found = await completeMilestoneByTitle(title);
      if (found.match) return { success: true, title: found.match.title };
      return found.candidates.length ? { success: false, reason: "Plusieurs jalons correspondent : demande lequel", candidates: found.candidates.map((c) => c.title) } : { success: false, reason: "Jalon introuvable parmi les jalons ouverts" };
    },
  }),

  add_quick_note: tool({
    description:
      "Ajoute une note rapide, datée, à la fin des notes d'une idée ou d'un projet, sans rien écraser : pour « note : … » ou « ajoute une note au projet X ». Pour réécrire ou compléter toute la synthèse, utilise update_idea_notes. Sans idée nommée, demande laquelle.",
    inputSchema: z.object({
      ideaTitle: z.string().min(1).describe("Titre (ou extrait) de l'idée ou du projet"),
      text: z.string().min(1).describe("La note, telle que dite, courte."),
    }),
    execute: async ({ ideaTitle, text }) => {
      console.log("[tool] add_quick_note →", { ideaTitle, textLength: text.length });
      const idea: any = await findIdeaByTitle(ideaTitle);
      if (!idea) return { success: false, reason: "Idée introuvable dans Notion" };
      const existing: string = (idea.properties?.Notes?.rich_text ?? []).map((part: any) => part.plain_text).join("");
      await updateIdeaNotes(idea.id, `${existing}${existing ? "\n" : ""}- ${todayInParis()} : ${text.trim()}`);
      return { success: true, ideaTitle, note: text.trim() };
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

  get_news: tool({
    description:
      "Lit les derniers articles de médias fiables sur un thème (bourse, économie, monde, tech, mode, sport, culture, sciences) : titre, résumé et lien. À préférer à la recherche web pour toute question d'actualité. Ne cite que ce qui est dans les résumés, sans rien inventer ; à voix haute ne dis jamais les liens, sur Telegram joins le lien des articles que tu cites.",
    inputSchema: z.object({ topic: z.enum(NEWS_TOPICS).describe("Thème demandé : « actu en bourse » = bourse, « l'actualité » sans précision = monde.") }),
    execute: async ({ topic }) => {
      console.log("[tool] get_news →", { topic });
      return { articles: await getTopicNews(topic) };
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

  get_week_progress: tool({
    description:
      "Lit les bilans des 7 derniers jours enregistrés dans Notion (date et texte, du plus récent au plus ancien) : « mes bilans de la semaine », « comment s'est passée ma semaine ». Résume, ne recopie pas ; un jour sans bilan n'apparaît pas.",
    inputSchema: z.object({}),
    execute: async () => {
      console.log("[tool] get_week_progress");
      return { bilans: (await getRecentProgress(7)).map(({ date, review }) => ({ date, bilan: review.slice(0, 300) })) };
    },
  }),

  get_what_to_do_now: tool({
    description:
      "Rassemble de quoi répondre à « que devrais-je faire maintenant ? » : heure de Paris, agenda d'aujourd'hui, prochains rendez-vous, jalon le plus proche, projets en cours. Propose une ou deux actions concrètes d'après ces seules données (ce qui est prévu maintenant d'abord, sinon le jalon le plus proche, sinon un projet en cours), sans rien inventer, sans rien écrire ni programmer. Une source « indisponible » : dis-le.",
    inputSchema: z.object({}),
    execute: async () => {
      console.log("[tool] get_what_to_do_now");
      const today = todayInParis();
      const [agenda, upcoming, milestones, projects] = await Promise.allSettled([getAgendaOn(today), getUpcomingAgenda(false, 3), getMilestones(), getProjectsInProgress()]);
      const read = <T>(result: PromiseSettledResult<T>, pick: (value: T) => unknown) => {
        if (result.status === "fulfilled") return pick(result.value);
        console.error("[tool] get_what_to_do_now, lecture en échec :", result.reason);
        return "indisponible (lecture impossible)";
      };
      return {
        maintenant: new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date()),
        aujourdhui: today,
        agendaAujourdhui: read(agenda, (items) => items.filter((i) => i.status !== "Fait").map(({ title, date }) => ({ title, heure: date?.includes("T") ? date.slice(11, 16) : null }))),
        prochainsRendezVous: read(upcoming, (items) => items.map(({ title, date }) => ({ title, quand: date ? dayLabel(date.slice(0, 10), today) : null }))),
        jalonLePlusProche: read(milestones, (items) => {
          const next = items.find((m) => m.dueDate);
          return next ? { title: next.title, quand: dayLabel(next.dueDate!.slice(0, 10), today), statut: next.status } : "aucun jalon ouvert";
        }),
        projetsEnCours: read(projects, (items) => items.map((p) => p.title)),
      };
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