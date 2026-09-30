import { getUpcomingAgenda } from "../lib/notion/agenda";
import { getMilestones } from "../lib/notion/milestones";
import { getAllIdeas } from "../lib/notion/idees";
import { getSettings } from "../lib/notion/settings";
import { scheduledModeFromTime } from "../lib/modes";
import { getNews } from "../lib/integrations/news";
import { getLastBriefing } from "../lib/memory";
import { assertDashboardKey } from "../lib/validation";

export const config = {
  runtime: "edge",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-dashboard-key",
};

export default async function handler(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    assertDashboardKey(request);

    const [agenda, milestones, ideas, settings, mode, news, briefing] = await Promise.all([
      getUpcomingAgenda(true, 60),
      getMilestones(),
      getAllIdeas(),
      getSettings(),
      scheduledModeFromTime(),
      getNews(),
      getLastBriefing(),
    ]);

    return Response.json(
      {
        mode,
        agenda,
        milestones,
        ideas,
        settings: {
          shiftActive: settings.shiftActive,
          shiftStartHour: settings.shiftStartHour,
          shiftEndHour: settings.shiftEndHour,
          morningTime: settings.morningTime,
          eveningTime: settings.eveningTime,
          pendingChangeDate: settings.pendingChangeDate,
        },
        briefing: briefing ?? "Pas encore de briefing aujourd'hui.",
        news,
        quiz: "", // pas encore implémenté côté backend (cf. docs/ai/STATUS.md)
      },
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "Unauthorized dashboard request";
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: unauthorized ? 401 : 500, headers: CORS_HEADERS },
    );
  }
}
