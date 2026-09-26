import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { requirePageCapability } from '@/server/auth/page-guard';
import { CAPABILITIES } from '@/lib/constants';
import { getUser, getUserActivity } from '@/server/services/users';
import { isApiError } from '@/server/http/errors';
import { prisma } from '@/server/db/prisma';
import { RBAC_MATRIX } from '@/lib/rbac-matrix';
import type { RoleKey } from '@/lib/constants';
import { PageHeader } from '@/components/common/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { initials } from '@/lib/utils';
import { EmptyState } from '@/components/common/empty-state';
import { UserActions } from '@/features/admin/user-actions';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loads the user once per request, turning "no such user" into null.
 *
 * `getUser()` signals that with an ApiError, which is the right thing for an
 * API route and the wrong thing for a page: left unhandled it surfaced as a
 * 500 — the server reporting its own failure for what is simply a bad URL.
 *
 * A malformed id is short-circuited rather than sent to Postgres, where the
 * uuid cast would fail and produce a 500 for the same reason.
 */
const loadUser = cache(async (id: string) => {
  if (!UUID.test(id)) return null;
  try {
    return await getUser(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  }
});

/**
 * Decides the 404 before the head is flushed, which is what makes the status
 * a real 404 rather than a 404 page served with 200. See the note on the
 * application detail page for the measurement behind this.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  await requirePageCapability(CAPABILITIES.USER_MANAGE);
  const { id } = await params;
  const user = await loadUser(id);

  if (!user) notFound();
  return { title: user.name };
}

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageCapability(CAPABILITIES.USER_MANAGE);
  const { id } = await params;

  // Shared with generateMetadata by cache(); that call has already thrown for
  // the not-found case, so this narrows the type and backstops it.
  const user = await loadUser(id);
  if (!user) notFound();

  const [activity, roles, departments, offices, zones] = await Promise.all([
    getUserActivity(id, 15),
    prisma.role.findMany({
      where: { deletedAt: null },
      select: { key: true, name: true },
      orderBy: { rank: 'asc' },
    }),
    prisma.department.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.office.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, code: true, name: true, departmentId: true, zoneId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.zone.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    }),
  ]);

  const roleKey = (user.roleKeys[0] ?? '') as RoleKey;
  const capabilities = RBAC_MATRIX[roleKey] ?? [];
  const isLocked = Boolean(user.lockedUntil && new Date(user.lockedUntil) > new Date());

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/settings/users">
          <ArrowLeft className="size-4" />
          All users
        </Link>
      </Button>

      <PageHeader
        title={user.name}
        description={user.email}
        actions={
          <UserActions
            userId={user.id}
            userName={user.name}
            status={user.status}
            isLocked={isLocked}
            currentRoleKey={roleKey}
            roles={roles}
            meta={{
              departments,
              offices,
              zones,
              departmentId: user.department?.id || null,
              officeId: user.office?.id || null,
              primaryZoneId: user.primaryZone?.id || null,
              zoneIds: user.zones.map((z) => z.id),
              designation: user.designation || undefined,
            }}
            isSelf={actor.id === user.id}
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Detail label="Status">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge kind="user" status={user.status} />
                    {isLocked && <Badge tone="danger">Locked out</Badge>}
                    {user.mustChangePassword && <Badge tone="warning">Must change password</Badge>}
                  </div>
                </Detail>
                <Detail label="Role">
                  <div className="flex flex-wrap gap-1">
                    {user.roleNames.map((r) => (
                      <Badge key={r} tone="info">
                        {r}
                      </Badge>
                    ))}
                  </div>
                </Detail>
                <Detail label="Designation">{user.designation || '—'}</Detail>
                <Detail label="Staff code">{user.employeeCode || '—'}</Detail>
                <Detail label="Mobile">{user.phone || '—'}</Detail>
                <Detail label="Office">{user.office?.name ?? '—'}</Detail>
                <Detail label="Department">{user.department?.name ?? '—'}</Detail>
                <Detail label="Primary zone">{user.primaryZone?.name ?? '—'}</Detail>
                <Detail label="Additional zones">
                  {user.zones.length ? (
                    <div className="flex flex-wrap gap-1">
                      {user.zones.map((z) => (
                        <Badge key={z.id} tone="outline">
                          {z.name}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    '—'
                  )}
                </Detail>
                <Detail label="Last signed in">
                  {user.lastLoginAt
                    ? new Date(user.lastLoginAt).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })
                    : 'Never'}
                </Detail>
                <Detail label="Failed attempts">{user.failedLoginCount}</Detail>
                <Detail label="Created">
                  {new Date(user.createdAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Detail>
              </dl>
            </CardContent>
          </Card>

          {user.ltpLicenceNo && (
            <Card>
              <CardHeader>
                <CardTitle>Licence</CardTitle>
                <CardDescription>Recorded, not verified against any external register.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Detail label="Licence number">{user.ltpLicenceNo}</Detail>
                  <Detail label="Class">{user.ltpLicenceClass || '—'}</Detail>
                  <Detail label="Firm">{user.firmName || '—'}</Detail>
                  <Detail label="Valid until">
                    {user.ltpValidUpto
                      ? new Date(user.ltpValidUpto).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })
                      : '—'}
                  </Detail>
                </dl>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>From the audit trail and sign-in log.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {activity.audits.length === 0 && activity.attempts.length === 0 ? (
                <EmptyState title="No activity yet" description="Actions appear here as they happen." />
              ) : (
                <ul className="divide-y divide-border">
                  {activity.audits.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-small text-text">{humanise(a.action)}</p>
                        {a.remarks && <p className="text-caption text-text-muted">{a.remarks}</p>}
                      </div>
                      <time className="shrink-0 text-caption text-text-subtle">
                        {new Date(a.occurredAt).toLocaleString('en-IN', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-col items-center py-6 text-center">
              <Avatar className="size-14">
                <AvatarFallback className="text-body">{initials(user.name)}</AvatarFallback>
              </Avatar>
              <p className="mt-3 text-body font-medium text-text">{user.name}</p>
              <p className="text-small text-text-muted">{user.email}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-text-muted" />
                What this role may do
              </CardTitle>
              <CardDescription>
                {capabilities.length} {capabilities.length === 1 ? 'capability' : 'capabilities'}.
                Enforced on the server on every request.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-wrap gap-1">
                {capabilities.map((c) => (
                  <li key={c}>
                    <Badge tone="outline" className="font-mono text-[10px]">
                      {c}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption font-medium uppercase tracking-wide text-text-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-small text-text">{children}</dd>
    </div>
  );
}

function humanise(action: string): string {
  const lower = action.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
