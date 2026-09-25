import { defineRoute } from '@/server/http/route';
import { CAPABILITIES } from '@/lib/constants';
import { badRequest } from '@/server/http/errors';
import { isProfessionalRegister, isProfessionalStatus } from '@/lib/professional-registration';
import { professionalDraftSchema } from '@/lib/schemas/professional-registration';
import { createProfessionalDraft, listProfessionalRegistrations, professionalRegisterSummary } from '@/server/services/professional-registrations';
import { readProfessionalUploads } from '@/server/professionals/uploads';

export const dynamic = 'force-dynamic';

/** The professional registers: `?register=ALL|PENDING|IN_PROCESS|SHORTFALL|VERIFIED|REJECTED|EXPIRED|RENEWAL`. */
export const GET = defineRoute(
  async ({ user, searchParams }) => {
    const register = searchParams.get('register') ?? '';
    const status = searchParams.get('status') ?? '';
    const query = {
      register: isProfessionalRegister(register) ? register : undefined,
      status: isProfessionalStatus(status) ? status : undefined,
      type: searchParams.get('type')?.trim() || undefined,
      q: searchParams.get('q')?.trim() || undefined,
      page: Number(searchParams.get('page') ?? 1) || 1,
      pageSize: Number(searchParams.get('pageSize') ?? 20) || 20,
    };
    if (searchParams.get('summary') === 'true') {
      const [result, summary] = await Promise.all([listProfessionalRegistrations(user, query), professionalRegisterSummary(user)]);
      return { ...result, summary };
    }
    return listProfessionalRegistrations(user, query);
  },
  { capabilities: [CAPABILITIES.PROFESSIONAL_REG_VIEW] }
);

/** Opens a registration application as a DRAFT, as MULTIPART. */
export const POST = defineRoute(
  async ({ user, req, ip, userAgent, correlationId }) => {
    const { fields, uploads } = await readProfessionalUploads(req);
    const parsed = professionalDraftSchema.safeParse(fields);
    if (!parsed.success) {
      throw badRequest('The registration details are not valid.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return createProfessionalDraft(user, { ...parsed.data, uploads }, { ip, userAgent, correlationId });
  },
  { capabilities: [CAPABILITIES.PROFESSIONAL_REG_REGISTER], rateLimit: 'upload' }
);
