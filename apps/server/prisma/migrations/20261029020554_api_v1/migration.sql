-- CreateEnum
CREATE TYPE "TombstoneType" AS ENUM ('landmark', 'landmarkCategory', 'dictItem', 'region', 'busCompany', 'shelfTemplate');

-- DropIndex
DROP INDEX "Stop_updatedAt_idx";

-- AlterTable
ALTER TABLE "SignSet" ADD COLUMN     "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 回填：下游第一次本来就做全量同步，取 updatedAt 即可（M4 计划 3.5 节）
UPDATE "SignSet" SET "changedAt" = "updatedAt";

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tombstone" (
    "objectId" UUID NOT NULL,
    "type" "TombstoneType" NOT NULL,
    "name" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tombstone_pkey" PRIMARY KEY ("objectId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_name_key" ON "ApiToken"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "Tombstone_deletedAt_objectId_idx" ON "Tombstone"("deletedAt", "objectId");

-- CreateIndex
CREATE INDEX "BusCompany_updatedAt_id_idx" ON "BusCompany"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "DictItem_updatedAt_id_idx" ON "DictItem"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "ExtField_updatedAt_id_idx" ON "ExtField"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "Landmark_updatedAt_id_idx" ON "Landmark"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "LandmarkCategory_updatedAt_id_idx" ON "LandmarkCategory"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "Line_updatedAt_id_idx" ON "Line"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "Region_updatedAt_id_idx" ON "Region"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "ShelfTemplate_updatedAt_id_idx" ON "ShelfTemplate"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "SignSet_changedAt_id_idx" ON "SignSet"("changedAt", "id");

-- CreateIndex
CREATE INDEX "Stop_updatedAt_id_idx" ON "Stop"("updatedAt", "id");

-- 已删除对象（只读 API）：快照表里动作为"删除"的记录按（时间，ID）翻页。部分索引，手写
CREATE INDEX "Snapshot_deleted_page" ON "Snapshot"("createdAt", "id") WHERE "action" = 'delete';
