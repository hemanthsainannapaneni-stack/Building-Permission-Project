-- Phase 13 — plot details on property records. ADDITIVE ONLY.
-- Apply with:
--   npx prisma db execute --file prisma/phase13-plot-details.sql --schema prisma/schema.prisma

ALTER TABLE "property_details"
  ADD COLUMN "lpsStatus" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "planningZone" TEXT NOT NULL DEFAULT '';