// lib/ai/tools.ts
import { tool } from "ai";
import { z } from "zod";
import { addIdea, findIdeaByTitle, completeIdea, setIdeaStatus, updateIdeaNotes, getIdeasToPropose, getProjectsInProgress, resolveProjectNames } from "../notion/idees";
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
  .describe("Catégorie (logo du dashboard) la plus proche du sujet ; « Autre » si aucune ne convient.");

export const sozaTools = {
  create_idea: tool({
    description:
      "Enregistre une idée dans Notion. Estime toi-même la taille selon l'ampleur réelle, sans la demander (sauf si l'utilisateur l'a précisée : respecte son choix). Dans `notes`, rédige une synthèse complète du fond (objectif, portée, enjeux, éléments clés) et de la forme (structure, étapes, composants évoqués), compréhensible seule plus tard sans la conversation. N'invente aucun fait : organise et clarifie ce qui a été dit.",
    inputSchema: z.object({
      title: z.string(),
      size: z
        .enum(["Petit", "Moyen", "Grand"])
        .describe("Petit : quelques heures à 1-2 jours ; Moyen : plusieurs jours à ~3 semaines ; Grand : long, complexe ou à plusieurs composants. Décide seul."),
      notes: z
        .string()
        .describe("Synthèse complète du fond ET de la forme de l'idée, pas un résumé minimal. Si la description est très longue, condense sans perdre l'essentiel."),
      statut: z
        .enum(["Brute", "En cours", "Archivée"])
        .nullish()
        .describe("Seulement si l'utilisateur donne explicitement un statut de départ ; sinon vide (créée en « Brute »)."),
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
      "Réécrit la synthèse d'une idée déjà enregistrée quand l'utilisateur la détaille ou la complète. Le texte REMPLACE l'ancienne note : fusionne-y ce que tu connais déjà via la conversation plutôt que d'écraser une note riche. Mêmes règles que create_idea (fond et forme, rien d'inventé).",
    inputSchema: z.object({
      title: z.string().describe("Titre (ou extrait) de l'idée"),
      notes: z.string().describe("Nouvelle synthèse complète, remplace l'ancienne."),
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
      "Change le statut d'une idée existante (Brute, En cours, Archivée = abandonnée), sur demande explicite. Ni pour en créer une, ni pour la terminer (voir complete_project, qui gère aussi le jalon lié).",
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
      const idea = await findIdeaByTitle(projectTitle);
      if (!idea) return { success: false, reason: "Idée introuvable dans Notion" };
      await completeIdea(idea.id);
      const milestoneId = await completeMilestoneForIdea(idea.id);
      return { success: true, ideaCompleted: true, milestoneValidated: !!milestoneId };
    },
  }),

  suggest_projects: tool({
    description:
      "Propose 3 idées à commencer, une par taille (Grand/Moyen/Petit), les plus anciennes d'abord ; si une taille est vide, les 3 plus anciennes toutes tailles. Après un projet terminé ou sur demande.",
    inputSchema: z.object({}),
    execute: async () => {
      console.log("[tool] suggest_projects");
      const suggestions = await getIdeasToPropose();
      return { suggestions };
    },
  }),

  add_agenda_item: tool({
    description:
      "Ajoute un item ponctuel (tâche, rendez-vous) à l'agenda Notion. Ni un jalon de plusieurs jours, ni un planning récurrent (voir add_shift_schedule).",
    inputSchema: z.object({
      title: z.string(),
      date: z.string().describe("YYYY-MM-DD ; si une heure est donnée, YYYY-MM-DDTHH:mm (ex: 2026-10-05T14:30) pour un horaire précis dans Notion Calendar."),
      endDate: z.string().nullish().describe("Fin, même format que `date`, si une durée est donnée (rdv de 14h à 15h30)."),
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
      "Ajoute un planning de travail récurrent (shift) à l'agenda : un bloc de type Shift par jour ouvré de la plage, avec heures de début et de fin. Pour un rythme répété (« 5h à 13h du lundi au vendredi jusqu'au 24 octobre »), pas un rendez-vous ponctuel (voir add_agenda_item).",
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
      "Met Soza en pause sur une période sans travail (week-end, vacances) : plus de briefing ni de bilan, l'absence de bilan n'est pas reprochée, la reprise est accueillie au retour. Quand l'utilisateur annonce qu'il ne bossera pas sur des jours précis. Remplace toute pause précédente. Convertis toi-même « ce week-end », « jusqu'à dimanche » en dates à partir de la date du jour.",
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

  record_progress: tool({
    description: "Enregistre le bilan du jour dans Notion. Un seul bilan par jour, même avec plusieurs projets en cours.",
    inputSchema: z.object({
      review: z.string().describe("Résumé court de ce qui a été fait ou non aujourd'hui"),
      projectsWorkedOn: z
        .array(z.string())
        .nullish()
        .describe(
          "Seuls les projets TRAVAILLÉS aujourd'hui, nommés ou confirmés par l'utilisateur, tels qu'il les a dits. Un projet non touché, laissé de côté ou seulement évoqué n'y figure PAS ; n'en déduis aucun. « Soza avancé, personnage 3D pas touché » donne [\"Soza\"]. Omets le champ si aucun projet n'est nommé.",
        ),
    }),
    execute: async ({ review, projectsWorkedOn }) => {
      console.log("[tool] record_progress →", { review, projectsWorkedOn });
      // Les noms sont rapprochés des vrais titres des projets en cours ; si cette lecture échoue, ils restent tels que tapés.
      const known = projectsWorkedOn?.length ? await getProjectsInProgress().catch(() => []) : [];
      const page = await saveProgress(review, projectsWorkedOn ? resolveProjectNames(projectsWorkedOn, known) : undefined);
      return { success: true, pageId: page.id };
    },
  }),
};