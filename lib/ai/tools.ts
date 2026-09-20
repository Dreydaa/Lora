import { tool } from "ai";
import { z } from "zod";
import { addIdea, findIdeaByTitle, archiveIdea, getIdeasToPropose } from "../notion/idees";
import { createMilestone, completeMilestoneForIdea } from "../notion/milestones";

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
};