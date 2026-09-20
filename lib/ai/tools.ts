import { tool } from "ai";
import { z } from "zod";
import { addIdea, findIdeaByTitle, archiveIdea, getIdeasToPropose } from "../notion/idees";
import { createMilestone, completeMilestoneForIdea, getMilestones } from "../notion/milestones";
import { addAgendaItem } from "../notion/agenda";
import { getLatestProgress, saveProgress } from "../notion/progress";
import { scheduledModeFromTime } from "../modes";

export const sozaTools = {
  create_idea: tool({
    description: "Enregistre une idée dans Notion",
    parameters: z.object({
      title: z.string(),
      size: z.enum(["Petit", "Moyen", "Grand"]),
    }),
    execute: async ({ title, size }) => {
      await addIdea(title, size);
      return { success: true, title, size };
    },
  }),

  create_milestone: tool({
    description: "Crée un jalon Notion de 7 à 10 jours, éventuellement lié à une idée existante",
    parameters: z.object({
      title: z.string(),
      dueDate: z.string().describe("Date ISO"),
      ideaTitle: z.string().optional().describe("Titre de l'idée d'origine, si ce jalon en découle"),
    }),
    execute: async ({ title, dueDate, ideaTitle }) => {
      const idea = ideaTitle ? await findIdeaByTitle(ideaTitle) : null;
      await createMilestone(title, dueDate, idea?.id);
      return { success: true, title, dueDate, linkedToIdea: !!idea };
    },
  }),

  complete_project: tool({
    description: "Marque un projet comme terminé : archive l'idée correspondante et valide son jalon lié dans Notion.",
    parameters: z.object({
      projectTitle: z.string().describe("Le titre (ou un extrait) de l'idée/projet terminé"),
    }),
    execute: async ({ projectTitle }) => {
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
    parameters: z.object({}),
    execute: async () => {
      const suggestions = await getIdeasToPropose();
      return { suggestions };
    },
  }),

  add_agenda_item: tool({
    description:
      "Ajoute un item ponctuel à l'agenda Notion pour une date donnée — pas un jalon de plusieurs jours, plutôt une tâche ou un rendez-vous simple.",
    parameters: z.object({
      title: z.string(),
      date: z.string().describe("Date ISO"),
    }),
    execute: async ({ title, date }) => {
      await addAgendaItem(title, date, scheduledModeFromTime());
      return { success: true, title, date };
    },
  }),

  list_milestones: tool({
    description: "Liste les jalons de projet à venir (non validés), triés par échéance, avec leur statut.",
    parameters: z.object({}),
    execute: async () => {
      const milestones = await getMilestones();
      return { milestones };
    },
  }),

  record_progress: tool({
    description:
      "Enregistre le bilan du jour dans Notion. Incrémente le streak si l'utilisateur a fourni une preuve de travail concrète aujourd'hui, le remet à zéro sinon. À utiliser typiquement en réponse au bilan du soir, une fois par jour.",
    parameters: z.object({
      review: z.string().describe("Résumé court de ce qui a été fait ou non aujourd'hui"),
      completed: z.boolean().describe("true si une preuve de travail concrète a été fournie aujourd'hui"),
    }),
    execute: async ({ review, completed }) => {
      const previous = await getLatestProgress();
      const newStreak = completed ? previous.streak + 1 : 0;
      await saveProgress(newStreak, review, scheduledModeFromTime());
      return { success: true, streak: newStreak };
    },
  }),
};