import { describe, it, expect } from 'vitest';
import { CAPABILITIES as C, ROLES, type RoleKey } from '@/lib/constants';
import { RBAC_MATRIX, ROLE_META, ROLE_LANDING, dashboardFor } from '@/lib/rbac-matrix';

/**
 * The permission matrix.
 *
 * These assert the SHAPE and the invariants. The integration suite separately
 * asserts that what is in the database matches this file, so the two cannot
 * silently drift.
 */

const allRoles = Object.values(ROLES) as RoleKey[];
const allCapabilities = new Set<string>(Object.values(C));

describe('matrix completeness', () => {
  it('covers every role', () => {
    for (const role of allRoles) {
      expect(RBAC_MATRIX[role], `no grants defined for ${role}`).toBeDefined();
      expect(ROLE_META[role], `no metadata for ${role}`).toBeDefined();
      expect(ROLE_LANDING[role], `no landing route for ${role}`).toBeDefined();
    }
  });

  it('grants only capabilities that exist', () => {
    for (const role of allRoles) {
      for (const capability of RBAC_MATRIX[role]) {
        expect(allCapabilities.has(capability), `${role} grants unknown ${capability}`).toBe(true);
      }
    }
  });

  it('never lists the same capability twice for a role', () => {
    for (const role of allRoles) {
      const grants = RBAC_MATRIX[role];
      expect(new Set(grants).size, `${role} has duplicate grants`).toBe(grants.length);
    }
  });

  it('gives every role at least one capability', () => {
    for (const role of allRoles) {
      expect(RBAC_MATRIX[role].length, `${role} can do nothing at all`).toBeGreaterThan(0);
    }
  });
});

describe('the checklist separation', () => {
  /**
   * THE invariant behind the whole three-capability split: answering a
   * checklist and verifying it are different acts by different people, and no
   * role may do both.
   *
   * This is not theoretical. The demo enrichment recorded 1121 verifications
   * against the role key "LTP", because the all-access demo accounts hold
   * every role and the code was reading `roleKeys[0]`. The data was wrong in
   * precisely the way this separation exists to prevent, and nothing failed.
   */
  it('gives no role both CHECKLIST_RESPOND and CHECKLIST_REVIEW', () => {
    for (const role of allRoles) {
      const grants = RBAC_MATRIX[role];
      const both =
        grants.includes(C.CHECKLIST_RESPOND) && grants.includes(C.CHECKLIST_REVIEW);
      expect(both, `${role} may both answer and verify its own checklist`).toBe(false);
    }
  });

  it('never lets the applicant verify', () => {
    expect(RBAC_MATRIX[ROLES.LTP]).not.toContain(C.CHECKLIST_REVIEW);
  });

  it('gives every desk that verifies the ability to see what it is verifying', () => {
    for (const role of allRoles) {
      const grants = RBAC_MATRIX[role];
      if (!grants.includes(C.CHECKLIST_REVIEW)) continue;
      expect(grants, `${role} verifies a checklist it cannot read`).toContain(C.CHECKLIST_VIEW);
    }
  });

  it('gives the applicant sight of the checklist it answers', () => {
    const grants = RBAC_MATRIX[ROLES.LTP];
    expect(grants).toContain(C.CHECKLIST_RESPOND);
    expect(grants).toContain(C.CHECKLIST_VIEW);
  });

  /**
   * The administrator configures the questions and does not answer or verify
   * them on anybody's file — the same principle as the absent approval grant.
   */
  it('lets the administrator configure the questions but not answer them', () => {
    const grants = RBAC_MATRIX[ROLES.SYSTEM_ADMIN];
    expect(grants).toContain(C.MASTER_DATA_MANAGE);
    expect(grants).not.toContain(C.CHECKLIST_RESPOND);
    expect(grants).not.toContain(C.CHECKLIST_REVIEW);
  });
});

describe('separation of duties', () => {
  /**
   * The APEX desks, and only those.
   *
   * This used to read "the Commissioner alone", which was true of
   * BP_STANDARD, where the Commissioner was the top of the chain. The BBAS
   * realignment made the ZJD the apex desk and gave it the only APPROVE
   * transition in the workflow every application type now runs — and the
   * matrix was not updated with it, so for a while nobody could approve
   * anything at all.
   *
   * Naming one role was the wrong assertion: it encoded which chain was in
   * use, not the property worth protecting. The property is that DECIDING is
   * confined to the desks at the top of a chain and is available to no
   * ordinary reviewing desk — which is what the two tests below check, and
   * what `rbac-seed` checks against the workflow's own transitions.
   */
  const APEX_ROLES = [ROLES.ZJD, ROLES.COMMISSIONER];

  it('grants approval to the apex desks only', () => {
    const approvers = allRoles.filter((r) => RBAC_MATRIX[r].includes(C.APPLICATION_APPROVE));
    expect([...approvers].sort()).toEqual([...APEX_ROLES].sort());
  });

  it('grants rejection to the apex desks only', () => {
    const rejecters = allRoles.filter((r) => RBAC_MATRIX[r].includes(C.APPLICATION_REJECT));
    expect([...rejecters].sort()).toEqual([...APEX_ROLES].sort());
  });

  it('gives no ordinary reviewing desk the power to decide', () => {
    // The separation that actually matters: a file is decided at the top of
    // the chain, not by whichever desk happens to be holding it.
    for (const role of [ROLES.TPA, ROLES.PLANNING_OFFICER, ROLES.ZDD, ROLES.ZAD, ROLES.LTP]) {
      expect(RBAC_MATRIX[role].includes(C.APPLICATION_APPROVE), `${role} can approve`).toBe(false);
      expect(RBAC_MATRIX[role].includes(C.APPLICATION_REJECT), `${role} can reject`).toBe(false);
    }
  });

  it('keeps revocation narrower than approval', () => {
    // Revoking a permission already issued is heavier than granting one, and
    // it did not move when the chain did.
    const revokers = allRoles.filter((r) => RBAC_MATRIX[r].includes(C.ORDER_REVOKE));
    expect(revokers).toEqual([ROLES.COMMISSIONER]);
  });

  it('does not let the system administrator approve or reject', () => {
    // An administrator configures the system; they do not decide applications.
    // This is the separation that makes the audit trail mean something.
    const admin = RBAC_MATRIX[ROLES.SYSTEM_ADMIN];
    expect(admin).not.toContain(C.APPLICATION_APPROVE);
    expect(admin).not.toContain(C.APPLICATION_REJECT);
    expect(admin).not.toContain(C.FEE_WAIVE);
    expect(admin).not.toContain(C.ORDER_REVOKE);
  });

  it('does not let officers administer users or roles', () => {
    const officers = [ROLES.TPA, ROLES.ZAD, ROLES.ZDD, ROLES.ZJD, ROLES.DIRECTOR_DP, ROLES.COMMISSIONER];
    for (const role of officers) {
      expect(RBAC_MATRIX[role]).not.toContain(C.USER_MANAGE);
      expect(RBAC_MATRIX[role]).not.toContain(C.ROLE_MANAGE);
      expect(RBAC_MATRIX[role]).not.toContain(C.SETTINGS_MANAGE);
    }
  });

  it('lets only the LTP create applications and upload', () => {
    const creators = allRoles.filter((r) => RBAC_MATRIX[r].includes(C.APPLICATION_CREATE));
    expect(creators).toEqual([ROLES.LTP]);

    const uploaders = allRoles.filter((r) => RBAC_MATRIX[r].includes(C.DRAWING_UPLOAD));
    expect(uploaders).toEqual([ROLES.LTP]);
  });

  it('lets only the LTP answer a shortfall, and never raise one', () => {
    const responders = allRoles.filter((r) => RBAC_MATRIX[r].includes(C.SHORTFALL_RESPOND));
    expect(responders).toEqual([ROLES.LTP]);
    expect(RBAC_MATRIX[ROLES.LTP]).not.toContain(C.SHORTFALL_CREATE);
    expect(RBAC_MATRIX[ROLES.LTP]).not.toContain(C.SHORTFALL_RESOLVE);
  });
});

describe('the viewer role is read-only', () => {
  it('holds no capability that mutates anything', () => {
    // Writes are additionally refused at the route wrapper, so this is defence
    // in depth rather than the only control — but a write capability here
    // would still be a mistake worth catching.
    const mutating = /(_CREATE|_EDIT|_DELETE|_UPLOAD|_MANAGE|_APPROVE|_REJECT|_VERIFY|_RESOLVE|_RESPOND|_GENERATE|_WAIVE|_INITIATE|_RECONCILE|_REFUND|_REVOKE|_FORWARD|_RETURN|_REASSIGN|_CLAIM|_WITHDRAW|_REQUEST)$/;

    for (const capability of RBAC_MATRIX[ROLES.VIEWER]) {
      expect(mutating.test(capability), `VIEWER holds mutating ${capability}`).toBe(false);
    }
  });
});

describe('no bypass exists anywhere', () => {
  it('has no scrutiny override (D4)', () => {
    for (const role of allRoles) {
      for (const capability of RBAC_MATRIX[role]) {
        expect(capability).not.toBe('SCRUTINY_OVERRIDE');
      }
    }
  });

  it('has no capability whose name suggests a bypass (D3)', () => {
    // OPEN_SHORTFALLS > 0 → APPROVAL BLOCKED, with no override implemented.
    // A capability named OVERRIDE / BYPASS / FORCE would be the first sign
    // someone reintroduced one.
    for (const role of allRoles) {
      for (const capability of RBAC_MATRIX[role]) {
        expect(/OVERRIDE|BYPASS|FORCE|SKIP/.test(capability), `${role}: ${capability}`).toBe(false);
      }
    }
  });
});

describe('dashboard routing', () => {
  it.each([
    [[ROLES.SYSTEM_ADMIN], 'admin'],
    [[ROLES.LTP], 'ltp'],
    [[ROLES.FINANCE_OFFICER], 'finance'],
    [[ROLES.COMMISSIONER], 'executive'],
    [[ROLES.ADDL_COMMISSIONER], 'executive'],
    [[ROLES.DIRECTOR_DP], 'executive'],
    [[ROLES.TPA], 'officer'],
    [[ROLES.ZAD], 'officer'],
    [[ROLES.ZDD], 'officer'],
    [[ROLES.ZJD], 'officer'],
    // An auditor holds no stage and therefore has no task queue, so the
    // officer dashboard would greet them with four tiles reading zero and a
    // "nothing at your desk" panel — accurate and useless. They get the
    // oversight figures instead, with none of the action links they could not
    // follow anyway.
    [[ROLES.VIEWER], 'viewer'],
  ] as const)('%s lands on the %s dashboard', (roles, expected) => {
    expect(dashboardFor([...roles])).toBe(expected);
  });

  it('never sends a role to a dashboard that does not exist', () => {
    // Cheap, and it is what would have caught the `viewer` kind being added to
    // `dashboardFor` without a branch to render it.
    const kinds = new Set(['ltp', 'officer', 'executive', 'finance', 'admin', 'viewer']);
    for (const role of Object.values(ROLES)) {
      expect(kinds.has(dashboardFor([role])), `${role}`).toBe(true);
    }
  });

  it('prefers the admin dashboard when a user holds several roles', () => {
    expect(dashboardFor([ROLES.TPA, ROLES.SYSTEM_ADMIN])).toBe('admin');
  });
});
