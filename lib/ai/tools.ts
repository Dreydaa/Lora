// lib/ai/tools.ts
import { tool } from "ai";
import { z } from "zod";
import { addIdea, findIdeaByTitle, completeIdea, setIdeaStatus, updateIdeaNotes, getIdeasToPropose } from "../notion/idees";
import { CATEGORIES } from "../types";
import { createMilestone, completeMilestoneForIdea, getMilestones } from "../notion/milestones";
import { addAgendaItem, addShiftSchedule } from "../notion/agenda";
import { saveProgress } from "../notion/progress";
import { saveBriefingTime } from "../notion/settings";
import { upsertSchedule } from "../integrations/qstash";
import { clearBreak, setBreak } from "../memory";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Choisit le logo affiché dans le dashboard ; null accepté parce que Groq envoie parfois null au lieu d'omettre.
const category = z
  .enum(CATEGORIES)
  .nullish()
  .describe("Catégorie, qui détermine le logo affiché dans le dashboard. Choisis la plus proche du sujet ; « Autre » si aucune ne convient.");

export const sozaTools = {
  create_idea: tool({
    description:
      "Enregistre une idée dans Notion. Détermine toi-même la taille du projet selon son ampleur réelle — ne demande jamais à l'utilisateur de la préciser, sauf s'il l'a déjà fait explicitement (dans ce cas respecte son choix). Rédige aussi une synthèse complète dans `notes` : pas un résumé de quelques lignes, mais une restitution du fond (objectif, portée, enjeux, éléments clés) et de la forme (structure, étapes ou composants évoqués) du projet tel que décrit, pour que la note seule permette de comprendre l'idée en profondeur plus tard, sans avoir à se souvenir de la conversation. N'invente rien au-delà de ce que l'utilisateur a réellement dit — organise et clarifie, n'ajoute pas de faits.",
    inputSchema: z.object({
      title: z.string(),
      size: z
        .enum(["Petit", "Moyen", "Grand"])
        .describe(
          "Taille que TU estimes selon l'ampleur du projet — Petit: quelques heures à 1-2 jours de travail ; Moyen: plusieurs jours à ~3 semaines ; Grand: projet long, complexe, ou à plusieurs composants. Décide seul, ne demande pas à l'utilisateur.",
        ),
      notes: z
        .string()
        .describe(
          "Synthèse structurée et complète du fond ET de la forme de l'idée telle que décrite par l'utilisateur — pas un résumé minimal. Si la description d'origine est très longue et détaillée, condense-la sans perdre les éléments importants.",
        ),
      statut: z
        .enum(["Brute", "En cours", "Archivée"])
        .nullish()
        .describe(
          "Ne renseigne ce champ QUE si l'utilisateur précise explicitement un statut de départ (ex: 'ajoute ce projet et marque-le en cours'). Sinon laisse vide — l'idée sera créée en 'Brute' par défaut.",
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
      "Réécrit la synthèse (notes) d'une idée/projet déjà enregistré — à utiliser quand l'utilisateur détaille, précise ou complète une idée après coup. Ce texte REMPLACE entièrement l'ancienne note : si tu connais déjà des éléments pertinents de cette idée via la conversation, combine-les avec les nouvelles précisions plutôt que d'écraser une note riche par une plus pauvre. Même règles que pour create_idea : synthèse structurée du fond et de la forme, pas un résumé minimal, rien d'inventé.",
    inputSchema: z.object({
      title: z.string().describe("Le titre (ou un extrait) de l'idée/projet à compléter"),
      notes: z
        .string()
        .describe("Nouvelle synthèse complète (remplace l'ancienne) — fond ET forme du projet, structurée."),
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
      "Change le statut d'une idée/projet existant (Brute, En cours, Archivée = abandonné). À utiliser quand l'utilisateur demande explicitement de mettre à jour l'avancement d'un projet déjà enregistré — pas pour en créer un nouveau, et pas pour le marquer terminé (utilise complete_project pour ça, qui gère aussi le jalon lié).",
    inputSchema: z.object({
      title: z.string().describe("Le titre (ou un extrait) de l'idée/projet à mettre à jour"),
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
    description: "Marque un projet comme terminé : passe l'idée correspondante en statut Terminé et valide son jalon lié dans Notion.",
    inputSchema: z.object({
      projectTitle: z.string().describe("Le titre (ou un extrait) de l'idée/projet terminé"),
    }),
    execute: async ({ projectTitle }) => {
      console.log("[tool] complete_project →", { projectTitle });
      const idea = await findIdeaByTitle(projectTitle);
      if (!idea) return { success: false, reason: "Idée introuvable dans Notion" };
      await completeIdea(idea.id);
      const milestoneId = await completeMilestoneForIdea(idea.id);
      return { success: true, ideaCompleted: true, milestoneValidated: !!milestoneId };
    },
  }),

  suggest_projects: tool({
    description:
      "Propose 3 idées de projets à commencer, une par taille (Grand/Moyen/Petit) en priorisant les plus anciennes. Si une taille n'a aucune idée disponible, propose les 3 idées les plus anciennes toutes tailles confondues à la place. À utiliser après qu'un projet vient d'être marqué terminé, ou sur demande explicite.",
    inputSchema: z.object({}),
    execute: async () => {
      console.log("[tool] suggest_projects");
      const suggestions = await getIdeasToPropose();
      return { suggestions };
    },
  }),

  add_agenda_item: tool({
    description:
      "Ajoute un item ponctuel à l'agenda Notion pour une date (et heure si connue) donnée — pas un jalon de plusieurs jours, plutôt une tâche ou un rendez-vous simple. Ne pas utiliser pour un planning de travail récurrent (voir add_shift_schedule).",
    inputSchema: z.object({
      title: z.string(),
      date: z
        .string()
        .describe(
          "Date ISO. Si l'utilisateur précise une heure, inclus-la au format YYYY-MM-DDTHH:mm (ex: 2026-10-05T14:30) pour que Notion Calendar affiche un horaire précis plutôt qu'un évènement journée entière. Sinon juste YYYY-MM-DD.",
        ),
      endDate: z
        .string()
        .nullish()
        .describe("Heure/date de fin, même format que `date`, si l'utilisateur précise une durée (ex: rdv de 14h à 15h30)."),
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
      "Ajoute un planning de travail récurrent (shift à horaires fixes) dans l'agenda : un bloc par jour ouvré dans la plage donnée, avec heure de début et de fin. À utiliser quand l'utilisateur décrit un rythme de travail répété (ex: 'je travaille de 5h à 13h du lundi au vendredi jusqu'au 24 octobre'), pas pour un rendez-vous ponctuel (voir add_agenda_item). Ces blocs sont marqués d'un type distinct (Shift) pour que Notion Calendar puisse leur donner une couleur différente des rendez-vous personnels.",
    inputSchema: z.object({
      startDate: z.string().describe("Date ISO (YYYY-MM-DD) du premier jour du planning. Aujourd'hui si l'utilisateur ne précise pas de début."),
      endDate: z.string().describe("Date ISO (YYYY-MM-DD) du dernier jour concerné, incluse — ex: la date de fin de contrat mentionnée."),
      startTime: z.string().describe("Heure de début du shift, format HH:mm"),
      endTime: z.string().describe("Heure de fin du shift, format HH:mm"),
      weekdays: z
        .array(z.enum(["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]))
        .nullish()
        .describe("Jours de la semaine concernés. Par défaut lundi à vendredi si l'utilisateur ne précise rien d'autre."),
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
      "Change l'heure d'envoi du briefing du matin ou du bilan du soir. À utiliser quand l'utilisateur demande explicitement de décaler l'un de ces deux messages automatiques.",
    inputSchema: z.object({
      type: z.enum(["morning", "evening"]).describe("morning = briefing du matin, evening = bilan du soir"),
      time: z.string().describe("Heure au format HH:mm, ex: 07:30"),
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
      "Met Soza en pause sur une période où l'utilisateur ne travaillera pas (un week-end, des vacances...) : pendant ces jours, plus de briefing du matin ni de bilan du soir, et l'absence de bilan n'est pas reprochée. Au retour, le briefing accueille la reprise. À utiliser quand l'utilisateur annonce qu'il prend une pause ou ne bossera pas sur des jours précis. Remplace toute pause précédente. Convertis toi-même les expressions relatives (« ce week-end », « jusqu'à dimanche ») en dates à partir de la date du jour.",
    inputSchema: z.object({
      startDate: z.string().regex(ISO_DAY).describe("Premier jour de pause, YYYY-MM-DD (aujourd'hui si la pause commence maintenant)."),
      endDate: z.string().regex(ISO_DAY).describe("Dernier jour de pause, inclus, YYYY-MM-DD."),
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

  record_progress: tool({
    description: "Enregistre le bilan du jour dans Notion.",
    inputSchema: z.object({
      review: z.string().describe("Résumé court de ce qui a été fait ou non aujourd'hui"),
    }),
    execute: async ({ review }) => {
      console.log("[tool] record_progress →", { review });
      const page = await saveProgress(review);
      return { success: true, pageId: page.id };
    },
  }),
};