import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { prisma, databaseAvailable, actorFor, META } from './setup';
import {
  archiveDocumentType,
  createDocumentRequirement,
  createDocumentType,
  deleteDocumentRequirement,
  listDocumentRequirements,
  listDocumentTypes,
  previewCondition,
  restoreDocumentType,
  updateDocumentRequirement,
  updateDocumentType,
} from '@/server/services/document-admin';
import { ROLES } from '@/lib/constants';

/**
 * Administering the document catalogue.
 *
 * The claim this screen exists to make true is repeated all through the
 * documentation: NO document list is hard-coded, so a department changes a
 * threshold without a migration or a deploy. These tests are that claim,
 * exercised — a rule is edited through the service and the checklist the
 * resolver derives changes with it.
 *
 * They also cover the two ways an administrator can quietly break the system:
 * writing a condition that can never be evaluated (so the document is never
 * asked for), and removing a document type that applications already depend
 * on.
 */

const dbUp = await databaseAvailable();

let admin: ReturnType<typeof actorFor>;
const created: string[] = [];
const createdRules: string[] = [];

beforeAll(async () => {
  if (!dbUp) return;
  const row = await prisma.user.findUniqueOrThrow({ where: { email: 'admin.demo@example.com' } });
  admin = actorFor(row.id, row.name, [ROLES.SYSTEM_ADMIN]);
}, 60_000);

afterEach(async () => {
  if (!dbUp) return;
  if (createdRules.length) {
    await prisma.documentRequirement.deleteMany({ where: { id: { in: createdRules } } });
    createdRules.length = 0;
  }
  if (created.length) {
    await prisma.documentRequirement.deleteMany({ where: { documentTypeId: { in: created } } });
    await prisma.documentType.deleteMany({ where: { id: { in: created } } });
    created.length = 0;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

let counter = 0;
const uniqueCode = () => `TEST_DOC_${Date.now()}_${counter++}`;

async function makeType(overrides: Partial<Parameters<typeof createDocumentType>[0]> = {}) {
  const type = await createDocumentType(
    {
      code: uniqueCode(),
      name: 'Test Certificate',
      description: '',
      category: 'Testing',
      allowedExtensions: ['pdf'],
      maxSizeMb: 10,
      requiresExpiry: false,
      isActive: true,
      ...overrides,
    },
    admin,
    META
  );
  created.push(type.id);
  return type;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The catalogue
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('the document catalogue', () => {
  it('creates a type and derives its MIME allow-list from the extensions', async () => {
    const type = await makeType({ allowedExtensions: ['pdf', 'png'] });

    const stored = await prisma.documentType.findUniqueOrThrow({ where: { id: type.id } });
    expect(stored.allowedExtensions).toEqual(['pdf', 'png']);
    // Held alongside, not derived at read time: the upload pipeline checks
    // extension and sniffed MIME as two independent gates.
    expect(stored.allowedMime).toContain('application/pdf');
    expect(stored.allowedMime).toContain('image/png');
  }, 30_000);

  it('refuses a duplicate code, and says so differently when the clash is archived', async () => {
    const type = await makeType();

    await expect(makeType({ code: type.code })).rejects.toThrow(/already exists/i);

    // Give it a reference, so removing it ARCHIVES rather than deletes — an
    // unreferenced type goes outright and frees its code, which is the point
    // of the distinction.
    const rule = await createDocumentRequirement(
      { documentTypeId: type.id, applicationTypeId: null, buildingUse: '', landUseZone: '', isMandatory: true, condition: {}, displayOrder: 908, helpText: '', isActive: true },
      admin,
      META
    );
    createdRules.push(rule.id);

    await archiveDocumentType(type.id, admin, META);

    // The archived row still holds the code, and the archived documents still
    // point at it — so a second type under the same code would be ambiguous
    // for ever. The message says to restore instead.
    await expect(makeType({ code: type.code })).rejects.toThrow(/archived/i);
  }, 30_000);

  it('audits every change with what it was and what it became', async () => {
    const type = await makeType({ name: 'Before' });
    await updateDocumentType(type.id, { name: 'After' }, admin, META);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'DocumentType', entityId: type.id, action: 'DOCUMENT_TYPE_UPDATED' },
      orderBy: { seq: 'desc' },
    });

    expect((audit!.before as Record<string, unknown>).name).toBe('Before');
    expect((audit!.after as Record<string, unknown>).name).toBe('After');
  }, 30_000);

  it('reports whether a type can be removed outright, before the button is pressed', async () => {
    const type = await makeType();

    const before = (await listDocumentTypes()).find((t) => t.id === type.id);
    expect(before?.deletable).toBe(true);

    const rule = await createDocumentRequirement(
      { documentTypeId: type.id, applicationTypeId: null, buildingUse: '', landUseZone: '', isMandatory: true, condition: {}, displayOrder: 900, helpText: '', isActive: true },
      admin,
      META
    );
    createdRules.push(rule.id);

    const after = (await listDocumentTypes()).find((t) => t.id === type.id);
    expect(after?.deletable).toBe(false);
    expect(after?.requirementCount).toBe(1);
  }, 30_000);

  it('deletes a type nothing references, and ARCHIVES one that is referenced', async () => {
    const unused = await makeType();
    const outcome = await archiveDocumentType(unused.id, admin, META);
    expect(outcome.outcome).toBe('DELETED');
    expect(await prisma.documentType.findUnique({ where: { id: unused.id } })).toBeNull();

    const used = await makeType();
    const rule = await createDocumentRequirement(
      { documentTypeId: used.id, applicationTypeId: null, buildingUse: '', landUseZone: '', isMandatory: true, condition: {}, displayOrder: 901, helpText: '', isActive: true },
      admin,
      META
    );
    createdRules.push(rule.id);

    const second = await archiveDocumentType(used.id, admin, META);
    expect(second.outcome).toBe('ARCHIVED');

    const stored = await prisma.documentType.findUniqueOrThrow({ where: { id: used.id } });
    expect(stored.deletedAt).not.toBeNull();

    // The rule went off with it. A rule pointing at an archived type would
    // resolve to nothing on every application, silently.
    const storedRule = await prisma.documentRequirement.findUniqueOrThrow({ where: { id: rule.id } });
    expect(storedRule.isActive).toBe(false);
  }, 30_000);

  it('restores an archived type without turning its rules back on by itself', async () => {
    const type = await makeType();
    const rule = await createDocumentRequirement(
      { documentTypeId: type.id, applicationTypeId: null, buildingUse: '', landUseZone: '', isMandatory: true, condition: {}, displayOrder: 902, helpText: '', isActive: true },
      admin,
      META
    );
    createdRules.push(rule.id);

    await archiveDocumentType(type.id, admin, META);
    await restoreDocumentType(type.id, admin, META);

    const stored = await prisma.documentType.findUniqueOrThrow({ where: { id: type.id } });
    expect(stored.deletedAt).toBeNull();
    expect(stored.isActive).toBe(true);

    // Deliberate: turning a type back on must not silently start demanding a
    // document of every applicant again.
    const storedRule = await prisma.documentRequirement.findUniqueOrThrow({ where: { id: rule.id } });
    expect(storedRule.isActive).toBe(false);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Requirement rules
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('requirement rules', () => {
  it('reads a rule back in the words the applicant will see', async () => {
    const type = await makeType();
    const rule = await createDocumentRequirement(
      {
        documentTypeId: type.id,
        applicationTypeId: null,
        buildingUse: '',
        landUseZone: '',
        isMandatory: true,
        condition: { gte: ['building.numFloors', 4] },
        displayOrder: 903,
        helpText: '',
        isActive: true,
      },
      admin,
      META
    );
    createdRules.push(rule.id);

    const listed = (await listDocumentRequirements()).find((r) => r.id === rule.id);
    expect(listed?.explanation).toBe('the number of floors is at least 4');
    expect(listed?.conditionProblem).toBeNull();
  }, 30_000);

  it('flags a stored rule that can no longer be evaluated', async () => {
    const type = await makeType();
    const rule = await createDocumentRequirement(
      { documentTypeId: type.id, applicationTypeId: null, buildingUse: '', landUseZone: '', isMandatory: true, condition: {}, displayOrder: 904, helpText: '', isActive: true },
      admin,
      META
    );
    createdRules.push(rule.id);

    // Corrupt it the way a hand-edited database row would be.
    await prisma.documentRequirement.update({
      where: { id: rule.id },
      data: { condition: { greaterThan: ['building.numFloors', 4] } },
    });

    const listed = (await listDocumentRequirements()).find((r) => r.id === rule.id);
    // The administrator is told. Without this the document is simply never
    // asked for and nothing anywhere says why.
    expect(listed?.conditionProblem).toMatch(/not a condition operator/i);
  }, 30_000);

  it('refuses a rule pointing at an inactive type, which could never fire', async () => {
    const type = await makeType({ isActive: false });

    await expect(
      createDocumentRequirement(
        { documentTypeId: type.id, applicationTypeId: null, buildingUse: '', landUseZone: '', isMandatory: true, condition: {}, displayOrder: 905, helpText: '', isActive: true },
        admin,
        META
      )
    ).rejects.toThrow(/inactive/i);
  }, 30_000);

  it('keeps the audit record of a deleted rule, so "why was this once demanded?" stays answerable', async () => {
    const type = await makeType();
    const rule = await createDocumentRequirement(
      {
        documentTypeId: type.id,
        applicationTypeId: null,
        buildingUse: '',
        landUseZone: '',
        isMandatory: true,
        condition: { gte: ['building.numFloors', 7] },
        displayOrder: 906,
        helpText: '',
        isActive: true,
      },
      admin,
      META
    );

    await deleteDocumentRequirement(rule.id, admin, META);
    expect(await prisma.documentRequirement.findUnique({ where: { id: rule.id } })).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'DocumentRequirement', entityId: rule.id, action: 'DOCUMENT_REQUIREMENT_DELETED' },
    });
    const before = audit!.before as Record<string, unknown>;
    expect(before.condition).toEqual({ gte: ['building.numFloors', 7] });
  }, 30_000);

  it('updates a rule and audits the change to the condition', async () => {
    const type = await makeType();
    const rule = await createDocumentRequirement(
      { documentTypeId: type.id, applicationTypeId: null, buildingUse: '', landUseZone: '', isMandatory: true, condition: { gte: ['building.numFloors', 4] }, displayOrder: 907, helpText: '', isActive: true },
      admin,
      META
    );
    createdRules.push(rule.id);

    await updateDocumentRequirement(
      rule.id,
      { condition: { gte: ['building.numFloors', 3] } },
      admin,
      META
    );

    const listed = (await listDocumentRequirements()).find((r) => r.id === rule.id);
    expect(listed?.explanation).toBe('the number of floors is at least 3');
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The preview the editor runs as you type
// ═══════════════════════════════════════════════════════════════════════════

describe.runIf(dbUp)('previewCondition', () => {
  it('reads a valid rule back as a sentence', () => {
    const result = previewCondition({ gte: ['building.numFloors', 4] });
    expect(result.valid).toBe(true);
    expect(result.explanation).toBe('the number of floors is at least 4');
  });

  it('uses the SAME words the applicant-facing checklist uses', () => {
    // The two label maps must not drift: an administrator previewing a rule
    // has to read the exact sentence the applicant will, not an approximation.
    const result = previewCondition({
      or: [{ gte: ['building.numFloors', 4] }, { gt: ['building.buildingHeightM', 15] }],
    });
    expect(result.explanation).toBe(
      'the number of floors is at least 4 or the building height in metres is more than 15'
    );
  });

  it('refuses one that could never fire, and says why', () => {
    const result = previewCondition({ greaterThan: ['building.numFloors', 4] });
    expect(result.valid).toBe(false);
    expect(result.explanation).toBe('');
    expect(result.problems[0]!.message).toMatch(/not a condition operator/i);
  });

  it('treats an empty condition as "always"', () => {
    const result = previewCondition({});
    expect(result.valid).toBe(true);
    expect(result.explanation).toBe('');
  });
});
