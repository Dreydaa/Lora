import { tool } from "ai";
import { z } from "zod";
import { addIdea } from "../notion/idees";
import { createMilestone } from "../notion/milestones";

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
    description: "Crée un jalon Notion de 7 à 10 jours",
    parameters: z.object({
      title: z.string(),
      dueDate: z.string().describe("Date ISO"),
    }),
    execute: async ({ title, dueDate }) => {
      await createMilestone(title, dueDate);
      return { success: true, title, dueDate };
    },
  }),
};