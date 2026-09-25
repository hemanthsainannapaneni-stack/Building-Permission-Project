-- Phase 12 — professional registration. ADDITIVE ONLY: two nullable columns on
-- applicants, two new tables, their indexes and two foreign keys. Nothing
-- existing is altered or removed. Requires Phase 11 applied first (no
-- dependency between them, but apply in order).
--
-- Generated with `prisma migrate diff`. Apply with:
--   npx prisma db execute --file prisma/phase12-professional-registration.sql --schema prisma/schema.prisma
-- then `npm run professionals:config` (grants, settings, professional types) and
-- `npm run professionals:seed -- --apply` (registers existing LTP accounts + demo professionals).

-- AlterTable
ALTER TABLE "applicants" ADD COLUMN     "ltpRegistrationId" TEXT,
ADD COLUMN     "structuralEngineerRegistrationId" TEXT;

-- CreateTable
CREATE TABLE "professional_registrations" (
    "id" TEXT NOT NULL,
    "applicationNumber" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NEW',
    "registrationNumber" TEXT,
    "lineageId" TEXT NOT NULL,
    "renewalOfId" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "round" INTEGER NOT NULL DEFAULT 1,
    "professionalType" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "licenceNo" TEXT NOT NULL,
    "registrationBody" TEXT NOT NULL,
    "qualification" TEXT NOT NULL DEFAULT '',
    "experienceYears" INTEGER,
    "organization" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL,
    "district" TEXT NOT NULL DEFAULT '',
    "pincode" TEXT NOT NULL DEFAULT '',
    "mobile" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "licenceValidFrom" TIMESTAMP(3),
    "licenceValidTo" TIMESTAMP(3),
    "consentGiven" BOOLEAN NOT NULL DEFAULT false,
    "consentText" TEXT NOT NULL DEFAULT '',
    "consentAt" TIMESTAMP(3),
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
    "cappedByLicence" BOOLEAN NOT NULL DEFAULT false,
    "expiredAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "outwardEntryId" TEXT,
    "outwardNumber" TEXT NOT NULL DEFAULT '',
    "currentDeskRoleKey" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "professional_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_registration_events" (
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

CONSTRAINT "professional_registration_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "professional_registrations_applicationNumber_key" ON "professional_registrations"("applicationNumber");

-- CreateIndex
CREATE INDEX "professional_registrations_isCurrent_status_idx" ON "professional_registrations"("isCurrent", "status");

-- CreateIndex
CREATE INDEX "professional_registrations_status_idx" ON "professional_registrations"("status");

-- CreateIndex
CREATE INDEX "professional_registrations_lineageId_idx" ON "professional_registrations"("lineageId");

-- CreateIndex
CREATE INDEX "professional_registrations_professionalType_licenceNo_idx" ON "professional_registrations"("professionalType", "licenceNo");

-- CreateIndex
CREATE INDEX "professional_registrations_userId_idx" ON "professional_registrations"("userId");

-- CreateIndex
CREATE INDEX "professional_registrations_validTo_idx" ON "professional_registrations"("validTo");

-- CreateIndex
CREATE INDEX "professional_registration_events_registrationId_occurredAt_idx" ON "professional_registration_events"("registrationId", "occurredAt");

-- AddForeignKey
ALTER TABLE "professional_registrations" ADD CONSTRAINT "professional_registrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_registration_events" ADD CONSTRAINT "professional_registration_events_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "professional_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
