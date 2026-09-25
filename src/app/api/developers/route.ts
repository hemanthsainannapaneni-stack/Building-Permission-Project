import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest } from '@/server/http/errors';
import { isDeveloperRegister, isDeveloperType } from '@/lib/developer-registration';
import { developerDraftSchema } from '@/lib/schemas/developer-registration';
import { createDeveloperDraft, developerRegisterSummary, listDeveloperRegistrations } from '@/server/services/developer-registrations';
import { readDeveloperUploads } from '@/server/developers/uploads';

export const dynamic = 'force-dynamic';

/** The developer registers: `?register=ALL|PENDING|SHORTFALL|APPROVED|REJECTED|EXPIRED|RENEWAL`. */
export const GET = defineRoute(
  async ({ user, searchParams }) => {
    const register = searchParams.get('register') ?? '';
    const type = searchParams.get('type') ?? '';
    const query = {
      register: isDeveloperRegister(register) ? register : undefined,
      type: isDeveloperType(type) ? type : undefined,
      q: searchParams.get('q')?.trim() || undefined,
      page: Number(searchParams.get('page') ?? 1) || 1,
      pageSize: Number(searchParams.get('pageSize') ?? 20) || 20,
    };
    if (searchParams.get('summary') === 'true') {
      const [result, summary] = await Promise.all([listDeveloperRegistrations(user, query), developerRegisterSummary(user)]);
      return { ...result, summary };
    }
    return listDeveloperRegistrations(user, query);
  },
  { capabilities: [CAPABILITIES.DEVELOPER_VIEW] }
);

/** Opens a registration application as a DRAFT, as MULTIPART (particulars + documents). */
export const POST = defineRoute(
  async ({ user, req, ip, userAgent, correlationId }) => {
    const { fields, uploads } = await readDeveloperUploads(req);
    const parsed = developerDraftSchema.safeParse(fields);
    if (!parsed.success) {
      throw badRequest('The registration details are not valid.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return createDeveloperDraft(user, { ...parsed.data, uploads }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.DEVELOPER_REGISTER], rateLimit: 'upload' }
);
