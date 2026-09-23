// lib/ai/tools.ts
import { tool } from "ai";
import { z } from "zod";
import { addIdea, findIdeaByTitle, archiveIdea, getIdeasToPropose } from "../notion/idees";
import { createMilestone, completeMilestoneForIdea, getMilestones } from "../notion/milestones";
import { addAgendaItem } from "../notion/agenda";
import { getLatestProgress, saveProgress } from "../notion/progress";
import { updateModeSchedule, saveBriefingTime } from "../notion/settings";
import { upsertSchedule } from "../integrations/qstash";
import { scheduledModeFromTime } from "../modes";

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
    }),
    execute: async ({ title, size, notes }) => {
      console.log("[tool] create_idea →", { title, size, notesLength: notes.length });
      if (!title) throw new Error("create_idea: title is required");
      const page = await addIdea(title, size, notes);
      console.log("[tool] ✅ idée créée :", page.id);
      return { success: true, title, size, pageId: page.id };
    },
  }),

  create_milestone: tool({
    description: "Crée un jalon Notion de 7 à 10 jours, éventuellement lié à une idée existante",
    inputSchema: z.object({
      title: z.string(),
      dueDate: z.string().describe("Date ISO"),
      ideaTitle: z.string().optional().describe("Titre de l'idée d'origine, si ce jalon en découle"),
    }),
    execute: async ({ title, dueDate, ideaTitle }) => {
      console.log("[tool] create_milestone →", { title, dueDate, ideaTitle });
      const idea = ideaTitle ? await findIdeaByTitle(ideaTitle) : null;
      const page = await createMilestone(title, dueDate, idea?.id);
      return { success: true, title, dueDate, linkedToIdea: !!idea, pageId: page.id };
    },
  }),

  complete_project: tool({
    description: "Marque un projet comme terminé : archive l'idée correspondante et valide son jalon lié dans Notion.",
    inputSchema: z.object({
      projectTitle: z.string().describe("Le titre (ou un extrait) de l'idée/projet terminé"),
    }),
    execute: async ({ projectTitle }) => {
      console.log("[tool] complete_project →", { projectTitle });
      const idea = await findIdeaByTitle(projectTitle);
      if (!idea) return { success: false, reason: "Idée introuvable dans Notion" };
      await archiveIdea(idea.id);
      const milestoneId = await completeMilestoneForIdea(idea.id);
      return { success: true, ideaArchived: true, milestoneValidated: !!milestoneId };
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
      "Ajoute un item ponctuel à l'agenda Notion pour une date donnée — pas un jalon de plusieurs jours, plutôt une tâche ou un rendez-vous simple.",
    inputSchema: z.object({
      title: z.string(),
      date: z.string().describe("Date ISO"),
    }),
    execute: async ({ title, date }) => {
      console.log("[tool] add_agenda_item →", { title, date });
      const page = await addAgendaItem(title, date, await scheduledModeFromTime());
      return { success: true, title, date, pageId: page.id };
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

  update_mode_schedule: tool({
    description:
      "Change si la fenêtre PAUSE (basée sur les horaires de shift/travail) est active, à partir d'une date donnée. À utiliser quand l'utilisateur annonce un changement de contrat/travail qui affecte le besoin du mode calme automatique : ex. fin de contrat → plus de fenêtre pause (mode actif en continu), nouveau travail avec horaires → réactive la fenêtre pause.",
    inputSchema: z.object({
      shiftActive: z
        .boolean()
        .describe("true si un travail avec horaires fixes s'applique (fenêtre pause activée), false si plus aucun (mode actif en continu)"),
      effectiveDate: z
        .string()
        .describe("Date ISO (YYYY-MM-DD) à partir de laquelle ce changement s'applique. Aujourd'hui si l'utilisateur dit 'maintenant' ou ne précise pas."),
      shiftStartHour: z.number().min(0).max(23).optional().describe("Nouvelle heure de début de la fenêtre pause, si elle change"),
      shiftEndHour: z.number().min(0).max(23).optional().describe("Nouvelle heure de fin de la fenêtre pause, si elle change"),
    }),
    execute: async ({ shiftActive, effectiveDate, shiftStartHour, shiftEndHour }) => {
      console.log("[tool] update_mode_schedule →", { shiftActive, effectiveDate });
      await updateModeSchedule({ shiftActive, effectiveDate, shiftStartHour, shiftEndHour });
      return { success: true, shiftActive, effectiveDate };
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

  record_progress: tool({
    description:
      "Enregistre le bilan du jour dans Notion. Incrémente le streak si l'utilisateur a fourni une preuve de travail concrète aujourd'hui, le remet à zéro sinon. À utiliser typiquement en réponse au bilan du soir, une fois par jour.",
    inputSchema: z.object({
      review: z.string().describe("Résumé court de ce qui a été fait ou non aujourd'hui"),
      completed: z.boolean().describe("true si une preuve de travail concrète a été fournie aujourd'hui"),
    }),
    execute: async ({ review, completed }) => {
      console.log("[tool] record_progress →", { review, completed });
      const previous = await getLatestProgress();
      const newStreak = completed ? previous.streak + 1 : 0;
      const page = await saveProgress(newStreak, review, await scheduledModeFromTime());
      return { success: true, streak: newStreak, pageId: page.id };
    },
  }),
};