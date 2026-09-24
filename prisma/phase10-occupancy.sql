-- CreateTable
CREATE TABLE "occupancy_applications" (
    "id" TEXT NOT NULL,
    "occupancyNumber" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "round" INTEGER NOT NULL DEFAULT 1,
    "approvalOrderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "commencementNumber" TEXT NOT NULL DEFAULT '',
    "commencementDate" TIMESTAMP(3),
    "ownerName" TEXT NOT NULL DEFAULT '',
    "ltpUserId" TEXT NOT NULL,
    "ltpName" TEXT NOT NULL DEFAULT '',
    "ltpLicenceNo" TEXT NOT NULL DEFAULT '',
    "approvedFigures" JSONB NOT NULL DEFAULT '{}',
    "completionDate" TIMESTAMP(3) NOT NULL,
    "completionRemarks" TEXT NOT NULL DEFAULT '',
    "documents" JSONB NOT NULL DEFAULT '[]',
    "submittedById" TEXT,
    "submittedByName" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recommendation" TEXT NOT NULL DEFAULT '',
    "recommendationNotes" TEXT NOT NULL DEFAULT '',
    "reviewedById" TEXT,
    "reviewedByName" TEXT NOT NULL DEFAULT '',
    "reviewedByRoleKey" TEXT NOT NULL DEFAULT '',
    "reviewedAt" TIMESTAMP(3),
    "shortfallItems" JSONB NOT NULL DEFAULT '[]',
    "shortfallRemarks" TEXT NOT NULL DEFAULT '',
    "shortfallRaisedByName" TEXT NOT NULL DEFAULT '',
    "shortfallRaisedAt" TIMESTAMP(3),
    "shortfallResponse" TEXT NOT NULL DEFAULT '',
    "shortfallRespondedAt" TIMESTAMP(3),
    "decision" TEXT NOT NULL DEFAULT '',
    "decisionRemarks" TEXT NOT NULL DEFAULT '',
    "decidedById" TEXT,
    "decidedByName" TEXT NOT NULL DEFAULT '',
    "decidedByRoleKey" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3),
    "certificateNumber" TEXT,
    "certificateIssuedAt" TIMESTAMP(3),
    "certificateIssuedByName" TEXT NOT NULL DEFAULT '',
    "approvedAreaSqm" DOUBLE PRECISION,
    "completedAreaSqm" DOUBLE PRECISION,
    "certificateConditions" JSONB NOT NULL DEFAULT '[]',
    "certificateSnapshot" JSONB NOT NULL DEFAULT '{}',
    "outwardEntryId" TEXT,
    "outwardNumber" TEXT NOT NULL DEFAULT '',
    "currentDeskRoleKey" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "occupancy_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occupancy_inspections" (
    "id" TEXT NOT NULL,
    "occupancyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "inspectorId" TEXT,
    "inspectorName" TEXT NOT NULL DEFAULT '',
    "scheduledByName" TEXT NOT NULL DEFAULT '',
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inspectedAt" TIMESTAMP(3),
    "siteCondition" TEXT NOT NULL DEFAULT '',
    "actualConstruction" TEXT NOT NULL DEFAULT '',
    "approvedConstruction" TEXT NOT NULL DEFAULT '',
    "deviations" TEXT NOT NULL DEFAULT '',
    "remarks" TEXT NOT NULL DEFAULT '',
    "photos" JSONB NOT NULL DEFAULT '[]',
    "recommendation" TEXT NOT NULL DEFAULT '',
    "asBuiltFigures" JSONB NOT NULL DEFAULT '{}',
    "asBuiltSource" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "occupancy_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occupancy_events" (
    "id" TEXT NOT NULL,
    "occupancyId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL DEFAULT '',
    "toStatus" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "actorRoleKey" TEXT NOT NULL DEFAULT '',
    "remarks" TEXT NOT NULL DEFAULT '',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "occupancy_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "occupancy_applications_occupancyNumber_key" ON "occupancy_applications"("occupancyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "occupancy_applications_certificateNumber_key" ON "occupancy_applications"("certificateNumber");

-- CreateIndex
CREATE INDEX "occupancy_applications_applicationId_isCurrent_idx" ON "occupancy_applications"("applicationId", "isCurrent");

-- CreateIndex
CREATE INDEX "occupancy_applications_status_idx" ON "occupancy_applications"("status");

-- CreateIndex
CREATE UNIQUE INDEX "occupancy_inspections_occupancyId_round_key" ON "occupancy_inspections"("occupancyId", "round");

-- CreateIndex
CREATE INDEX "occupancy_events_occupancyId_occurredAt_idx" ON "occupancy_events"("occupancyId", "occurredAt");

-- AddForeignKey
ALTER TABLE "occupancy_applications" ADD CONSTRAINT "occupancy_applications_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupancy_inspections" ADD CONSTRAINT "occupancy_inspections_occupancyId_fkey" FOREIGN KEY ("occupancyId") REFERENCES "occupancy_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupancy_events" ADD CONSTRAINT "occupancy_events_occupancyId_fkey" FOREIGN KEY ("occupancyId") REFERENCES "occupancy_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

