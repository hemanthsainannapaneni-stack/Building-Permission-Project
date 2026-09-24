import { defineRoute, created } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { scheduleInspectionSchema, type ScheduleInspectionInput } from '@/lib/schemas/site-inspections';
import { getApplicationInspections, scheduleInspection } from '@/server/services/site-inspections';

export const dynamic = 'force-dynamic';

/** The application's Site Inspection tab: every round, and whether one can be booked. */
export const GET = defineRoute(async ({ user, params }) => getApplicationInspections(user, params.id!), {
  capabilities: [CAPABILITIES.SITE_INSPECTION_VIEW],
});

/**
 * Schedule. Books the visit, snapshots the 27 questions onto it, moves the
 * file to the site inspection desk and hands the task to the inspector — one
 * transaction.
 */
export const POST = defineRoute<ScheduleInspectionInput>(
  async ({ user, params, body, ip, userAgent, correlationId }) =>
    created(await scheduleInspection(user, params.id!, body, { ip, userAgent, correlationId })),
  { capabilities: [CAPABILITIES.SITE_INSPECTION_SCHEDULE], schema: scheduleInspectionSchema }
);
