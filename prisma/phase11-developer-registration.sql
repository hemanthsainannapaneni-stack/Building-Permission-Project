-- Phase 11 — developer registration. ADDITIVE ONLY: two new tables, their
-- indexes and one foreign key, and one nullable column on applicants (the
-- developer chosen on an application). Nothing existing is altered or removed.
--
-- Generated with `prisma migrate diff` from the committed schema to this one.
-- Apply with:
--   npx prisma db execute --file prisma/phase11-developer-registration.sql --schema prisma/schema.prisma
-- then `npm run developers:config` (grants + settings) and
-- `npm run developers:seed -- --apply` (demo developers).

-- CreateTable
CREATE TABLE "developer_registrations" (
    "id" TEXT NOT NULL,
    "applicationNumber" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NEW',
    "registrationNumber" TEXT,
    "lineageId" TEXT NOT NULL,
    "renewalOfId" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "round" INTEGER NOT NULL DEFAULT 1,
    "developerType" TEXT NOT NULL,
    "developerName" TEXT NOT NULL,
    "organization" TEXT NOT NULL DEFAULT '',
    "authorizedPerson" TEXT NOT NULL,
    "authorizedDesignation" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL,
    "district" TEXT NOT NULL DEFAULT '',
    "pincode" TEXT NOT NULL DEFAULT '',
    "mobile" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "pan" TEXT NOT NULL DEFAULT '',
    "gstin" TEXT NOT NULL DEFAULT '',
    "incorporationNo" TEXT NOT NULL DEFAULT '',
    "incorporationDate" TIMESTAMP(3),
    "reraNo" TEXT NOT NULL DEFAULT '',
    "experienceYears" INTEGER,
    "projectsCompleted" INTEGER,
    "registrationInfo" TEXT NOT NULL DEFAULT '',
    "documents" JSONB NOT NULL DEFAULT '[]',
    "submittedById" TEXT,
    "submittedByName" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3),
    "takenUpById" TEXT,
    "takenUpByName" TEXT NOT NULL DEFAULT '',
    "takenUpAt" TIMESTAMP(3),
    "shortfallItems" JSONB NOT NULL DEFAULT '[]',
    "shortfallRemarks" TEXT NOT NULL DEFAULT '',
    "shortfallRaisedByName" TEXT NOT NULL DEFAULT '',
    "shortfallRaisedAt" TIMESTAMP(3),
    "shortfallResponse" TEXT NOT NULL DEFAULT '',
    "shortfallRespondedAt" TIMESTAMP(3),
    "verificationOutcome" TEXT NOT NULL DEFAULT '',
    "verificationRemarks" TEXT NOT NULL DEFAULT '',
    "verifiedById" TEXT,
    "verifiedByName" TEXT NOT NULL DEFAULT '',
    "verifiedByRoleKey" TEXT NOT NULL DEFAULT '',
    "verifiedAt" TIMESTAMP(3),
    "decision" TEXT NOT NULL DEFAULT '',
    "decisionRemarks" TEXT NOT NULL DEFAULT '',
    "decidedById" TEXT,
    "decidedByName" TEXT NOT NULL DEFAULT '',
    "decidedByRoleKey" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3),
    "issueDate" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "renewalDueDate" TIMESTAMP(3),
    "validityYears" INTEGER,
    "expiredAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "renewalNotifiedAt" TIMESTAMP(3),
    "outwardEntryId" TEXT,
    "outwardNumber" TEXT NOT NULL DEFAULT '',
    "currentDeskRoleKey" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "developer_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_registration_events" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL DEFAULT '',
    "toStatus" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "actorRoleKey" TEXT NOT NULL DEFAULT '',
    "remarks" TEXT NOT NULL DEFAULT '',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "developer_registration_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "developer_registrations_applicationNumber_key" ON "developer_registrations"("applicationNumber");

-- CreateIndex
CREATE INDEX "developer_registrations_isCurrent_status_idx" ON "developer_registrations"("isCurrent", "status");

-- CreateIndex
CREATE INDEX "developer_registrations_status_idx" ON "developer_registrations"("status");

-- CreateIndex
CREATE INDEX "developer_registrations_lineageId_idx" ON "developer_registrations"("lineageId");

-- CreateIndex
CREATE INDEX "developer_registrations_registrationNumber_idx" ON "developer_registrations"("registrationNumber");

-- CreateIndex
CREATE INDEX "developer_registrations_pan_idx" ON "developer_registrations"("pan");

-- CreateIndex
CREATE INDEX "developer_registrations_validTo_idx" ON "developer_registrations"("validTo");

-- CreateIndex
CREATE INDEX "developer_registration_events_registrationId_occurredAt_idx" ON "developer_registration_events"("registrationId", "occurredAt");

-- AddForeignKey
ALTER TABLE "developer_registration_events" ADD CONSTRAINT "developer_registration_events_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "developer_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable — the developer register entry an application names (nullable).
ALTER TABLE "applicants" ADD COLUMN "developerRegistrationId" TEXT;
