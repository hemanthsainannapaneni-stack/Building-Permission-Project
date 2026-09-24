import 'server-only';
import { prisma } from '@/server/db/prisma';
import { audit } from './audit';
import { conflict, notFound, businessRule } from '@/server/http/errors';
import type { AuthUser } from '@/server/auth/context';

type Meta = { ip?: string; userAgent?: string; correlationId?: string };

// ═══════════════════════════════════════════════════════════════════════════
// DEPARTMENTS
// ═══════════════════════════════════════════════════════════════════════════

export async function listDepartments() {
  return prisma.department.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      createdAt: true,
      _count: { select: { users: { where: { deletedAt: null } }, offices: { where: { deletedAt: null } } } },
    },
  });
}

export async function createDepartment(
  input: { code: string; name: string },
  actor: AuthUser,
  meta: Meta = {}
) {
  const clash = await prisma.department.findUnique({ where: { code: input.code } });
  if (clash) throw conflict(`A department with code "${input.code}" already exists.`);

  return prisma.$transaction(async (tx) => {
    const dept = await tx.department.create({
      data: { code: input.code.toUpperCase(), name: input.name },
      select: { id: true, code: true, name: true },
    });
    await audit(tx, { actor, action: 'DEPARTMENT_CREATED', entityType: 'Department', entityId: dept.id, after: dept, ...meta });
    return dept;
  });
}

export async function updateDepartment(
  id: string,
  input: { code?: string; name?: string; isActive?: boolean },
  actor: AuthUser,
  meta: Meta = {}
) {
  const dept = await prisma.department.findFirst({ where: { id, deletedAt: null } });
  if (!dept) throw notFound('Department not found.');

  if (input.code && input.code !== dept.code) {
    const clash = await prisma.department.findUnique({ where: { code: input.code } });
    if (clash) throw conflict(`A department with code "${input.code}" already exists.`);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.department.update({
      where: { id },
      data: {
        ...(input.code ? { code: input.code.toUpperCase() } : {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: { id: true, code: true, name: true, isActive: true },
    });
    await audit(tx, { actor, action: 'DEPARTMENT_UPDATED', entityType: 'Department', entityId: id, before: dept, after: updated, ...meta });
    return updated;
  });
}

export async function deleteDepartment(id: string, actor: AuthUser, meta: Meta = {}) {
  const dept = await prisma.department.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { users: true, offices: true } } } });
  if (!dept) throw notFound('Department not found.');
  if (dept._count.users > 0) throw businessRule(`Cannot delete: ${dept._count.users} user(s) are assigned to this department.`);
  if (dept._count.offices > 0) throw businessRule(`Cannot delete: ${dept._count.offices} office(s) belong to this department.`);

  return prisma.$transaction(async (tx) => {
    await tx.department.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, { actor, action: 'DEPARTMENT_DELETED', entityType: 'Department', entityId: id, before: { code: dept.code, name: dept.name }, ...meta });
    return { ok: true };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ZONES
// ═══════════════════════════════════════════════════════════════════════════

export async function listZones() {
  return prisma.zone.findMany({
    where: { deletedAt: null },
    orderBy: { code: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      createdAt: true,
      _count: { select: { offices: { where: { deletedAt: null } }, applications: { where: { deletedAt: null } } } },
    },
  });
}

export async function createZone(
  input: { code: string; name: string },
  actor: AuthUser,
  meta: Meta = {}
) {
  const clash = await prisma.zone.findUnique({ where: { code: input.code } });
  if (clash) throw conflict(`A zone with code "${input.code}" already exists.`);

  return prisma.$transaction(async (tx) => {
    const zone = await tx.zone.create({
      data: { code: input.code.toUpperCase(), name: input.name },
      select: { id: true, code: true, name: true },
    });
    await audit(tx, { actor, action: 'ZONE_CREATED', entityType: 'Zone', entityId: zone.id, after: zone, ...meta });
    return zone;
  });
}

export async function updateZone(
  id: string,
  input: { code?: string; name?: string; isActive?: boolean },
  actor: AuthUser,
  meta: Meta = {}
) {
  const zone = await prisma.zone.findFirst({ where: { id, deletedAt: null } });
  if (!zone) throw notFound('Zone not found.');

  if (input.code && input.code !== zone.code) {
    const clash = await prisma.zone.findUnique({ where: { code: input.code } });
    if (clash) throw conflict(`A zone with code "${input.code}" already exists.`);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.zone.update({
      where: { id },
      data: {
        ...(input.code ? { code: input.code.toUpperCase() } : {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: { id: true, code: true, name: true, isActive: true },
    });
    await audit(tx, { actor, action: 'ZONE_UPDATED', entityType: 'Zone', entityId: id, before: zone, after: updated, ...meta });
    return updated;
  });
}

export async function deleteZone(id: string, actor: AuthUser, meta: Meta = {}) {
  const zone = await prisma.zone.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { applications: true, users: true } } } });
  if (!zone) throw notFound('Zone not found.');
  if (zone._count.applications > 0) throw businessRule(`Cannot delete: ${zone._count.applications} application(s) are linked to this zone.`);
  if (zone._count.users > 0) throw businessRule(`Cannot delete: ${zone._count.users} user(s) have this as their primary zone.`);

  return prisma.$transaction(async (tx) => {
    await tx.zone.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, { actor, action: 'ZONE_DELETED', entityType: 'Zone', entityId: id, before: { code: zone.code, name: zone.name }, ...meta });
    return { ok: true };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// OFFICES
// ═══════════════════════════════════════════════════════════════════════════

export async function listOffices() {
  return prisma.office.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      address: true,
      isActive: true,
      createdAt: true,
      departmentId: true,
      zoneId: true,
      department: { select: { id: true, name: true } },
      zone: { select: { id: true, code: true, name: true } },
      _count: { select: { users: { where: { deletedAt: null } } } },
    },
  });
}

export async function createOffice(
  input: { code: string; name: string; departmentId?: string | null; zoneId?: string | null; address?: string },
  actor: AuthUser,
  meta: Meta = {}
) {
  const clash = await prisma.office.findUnique({ where: { code: input.code } });
  if (clash) throw conflict(`An office with code "${input.code}" already exists.`);

  return prisma.$transaction(async (tx) => {
    const office = await tx.office.create({
      data: {
        code: input.code.toUpperCase(),
        name: input.name,
        address: input.address ?? '',
        departmentId: input.departmentId ?? null,
        zoneId: input.zoneId ?? null,
      },
      select: { id: true, code: true, name: true },
    });
    await audit(tx, { actor, action: 'OFFICE_CREATED', entityType: 'Office', entityId: office.id, after: office, ...meta });
    return office;
  });
}

export async function updateOffice(
  id: string,
  input: { code?: string; name?: string; departmentId?: string | null; zoneId?: string | null; address?: string; isActive?: boolean },
  actor: AuthUser,
  meta: Meta = {}
) {
  const office = await prisma.office.findFirst({ where: { id, deletedAt: null } });
  if (!office) throw notFound('Office not found.');

  if (input.code && input.code !== office.code) {
    const clash = await prisma.office.findUnique({ where: { code: input.code } });
    if (clash) throw conflict(`An office with code "${input.code}" already exists.`);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.office.update({
      where: { id },
      data: {
        ...(input.code ? { code: input.code.toUpperCase() } : {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.zoneId !== undefined ? { zoneId: input.zoneId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: { id: true, code: true, name: true, isActive: true },
    });
    await audit(tx, { actor, action: 'OFFICE_UPDATED', entityType: 'Office', entityId: id, before: office, after: updated, ...meta });
    return updated;
  });
}

export async function deleteOffice(id: string, actor: AuthUser, meta: Meta = {}) {
  const office = await prisma.office.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { users: true } } } });
  if (!office) throw notFound('Office not found.');
  if (office._count.users > 0) throw businessRule(`Cannot delete: ${office._count.users} user(s) are assigned to this office.`);

  return prisma.$transaction(async (tx) => {
    await tx.office.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, { actor, action: 'OFFICE_DELETED', entityType: 'Office', entityId: id, before: { code: office.code, name: office.name }, ...meta });
    return { ok: true };
  });
}
