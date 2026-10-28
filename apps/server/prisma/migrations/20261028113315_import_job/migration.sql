-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('stop', 'line');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('pending', 'confirmed', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'pending',
    "fileName" TEXT NOT NULL,
    "file" BYTEA NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "preview" JSONB NOT NULL,
    "failures" JSONB NOT NULL DEFAULT '[]',
    "planHash" TEXT NOT NULL,
    "result" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportJob_createdAt_idx" ON "ImportJob"("createdAt" DESC);
