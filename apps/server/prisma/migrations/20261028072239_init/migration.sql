-- 名称列使用 ICU 中文排序规则，ORDER BY name 即按拼音排序（Prisma schema 无法表达列排序规则，手工加入）
-- CreateEnum
CREATE TYPE "OrientationMode" AS ENUM ('orientation', 'code');

-- CreateEnum
CREATE TYPE "ExtOwner" AS ENUM ('stop', 'line', 'routeStop');

-- CreateEnum
CREATE TYPE "ExtType" AS ENUM ('text', 'select', 'number', 'date', 'time', 'textList');

-- CreateEnum
CREATE TYPE "StopSection" AS ENUM ('basic', 'facility', 'other');

-- CreateEnum
CREATE TYPE "DictCategory" AS ENUM ('shelfType', 'maintainer', 'road', 'fareSystem', 'platformType', 'safety', 'shelterType');

-- CreateEnum
CREATE TYPE "RegionLevel" AS ENUM ('city', 'district', 'street');

-- CreateEnum
CREATE TYPE "LineMode" AS ENUM ('oneway', 'twoway', 'loop', 'doubleLoop');

-- CreateEnum
CREATE TYPE "LineStatus" AS ENUM ('running', 'suspended');

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('attended', 'unattended');

-- CreateEnum
CREATE TYPE "RouteKind" AS ENUM ('up', 'down', 'inner', 'outer', 'oneway', 'loop');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('scheduled', 'interval');

-- CreateEnum
CREATE TYPE "ObjectType" AS ENUM ('stop', 'line', 'signSet');

-- CreateEnum
CREATE TYPE "SnapshotAction" AS ENUM ('create', 'update', 'delete', 'importCreate', 'importUpdate', 'cascadeUpdate');

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "orientationMode" "OrientationMode" NOT NULL DEFAULT 'orientation',
    "landmarkLimit" INTEGER NOT NULL DEFAULT 5,
    "autoMatch" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtField" (
    "id" UUID NOT NULL,
    "owner" "ExtOwner" NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ExtType" NOT NULL,
    "options" TEXT[],
    "description" TEXT NOT NULL DEFAULT '',
    "section" "StopSection",
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DictItem" (
    "id" UUID NOT NULL,
    "category" "DictCategory" NOT NULL,
    "name" TEXT COLLATE "zh-x-icu" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DictItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" UUID NOT NULL,
    "level" "RegionLevel" NOT NULL,
    "parentId" UUID,
    "name" TEXT COLLATE "zh-x-icu" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusCompany" (
    "id" UUID NOT NULL,
    "name" TEXT COLLATE "zh-x-icu" NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "shortName" TEXT NOT NULL DEFAULT '',
    "logoId" UUID,
    "hotline" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandmarkCategory" (
    "id" UUID NOT NULL,
    "name" TEXT COLLATE "zh-x-icu" NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'landmark',
    "defaultRadius" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandmarkCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Landmark" (
    "id" UUID NOT NULL,
    "name" TEXT COLLATE "zh-x-icu" NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "categoryId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Landmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandmarkPoint" (
    "id" UUID NOT NULL,
    "landmarkId" UUID NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "radius" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandmarkPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stop" (
    "id" UUID NOT NULL,
    "name" TEXT COLLATE "zh-x-icu" NOT NULL,
    "direction" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "lng" DOUBLE PRECISION NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "cityId" UUID,
    "districtId" UUID,
    "streetId" UUID,
    "roadId" UUID,
    "qrUrl" TEXT NOT NULL DEFAULT '',
    "berths" INTEGER,
    "platformTypeId" UUID,
    "safetyId" UUID,
    "waiting" TEXT NOT NULL DEFAULT '',
    "shelterTypeId" UUID,
    "bigLightbox" INTEGER,
    "smallLightbox" INTEGER,
    "seats" INTEGER,
    "maintainerId" UUID,
    "remark" TEXT NOT NULL DEFAULT '',
    "ext" JSONB NOT NULL DEFAULT '{}',
    "rev" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StopLandmark" (
    "stopId" UUID NOT NULL,
    "landmarkId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StopLandmark_pkey" PRIMARY KEY ("stopId","landmarkId")
);

-- CreateTable
CREATE TABLE "StopPhoto" (
    "id" UUID NOT NULL,
    "stopId" UUID NOT NULL,
    "uploadId" UUID NOT NULL,
    "sort" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StopPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignSet" (
    "id" UUID NOT NULL,
    "stopId" UUID NOT NULL,
    "reminder" TEXT NOT NULL DEFAULT '',
    "rev" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Line" (
    "id" UUID NOT NULL,
    "name" TEXT COLLATE "zh-x-icu" NOT NULL,
    "number" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "mode" "LineMode" NOT NULL,
    "companyId" UUID,
    "ticketType" "TicketType",
    "fareSystemId" UUID,
    "fare" TEXT NOT NULL DEFAULT '',
    "status" "LineStatus" NOT NULL DEFAULT 'running',
    "ext" JSONB NOT NULL DEFAULT '{}',
    "rev" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "kind" "RouteKind" NOT NULL,
    "serviceType" "ServiceType",
    "serviceTime" TEXT NOT NULL DEFAULT '',
    "interval" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteStop" (
    "id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "stopId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "times" TEXT[],
    "ext" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" UUID NOT NULL,
    "objectType" "ObjectType" NOT NULL,
    "objectId" UUID NOT NULL,
    "objectName" TEXT NOT NULL,
    "action" "SnapshotAction" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "content" JSONB NOT NULL,
    "compareHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_username_key" ON "Account"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_accountId_idx" ON "Session"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtField_owner_key_key" ON "ExtField"("owner", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ExtField_owner_name_key" ON "ExtField"("owner", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DictItem_category_name_key" ON "DictItem"("category", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Region_parentId_name_key" ON "Region"("parentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BusCompany_name_key" ON "BusCompany"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LandmarkCategory_name_key" ON "LandmarkCategory"("name");

-- CreateIndex
CREATE INDEX "Landmark_categoryId_idx" ON "Landmark"("categoryId");

-- CreateIndex
CREATE INDEX "LandmarkPoint_landmarkId_idx" ON "LandmarkPoint"("landmarkId");

-- CreateIndex
CREATE INDEX "Stop_districtId_idx" ON "Stop"("districtId");

-- CreateIndex
CREATE INDEX "Stop_streetId_idx" ON "Stop"("streetId");

-- CreateIndex
CREATE INDEX "Stop_roadId_idx" ON "Stop"("roadId");

-- CreateIndex
CREATE INDEX "Stop_maintainerId_idx" ON "Stop"("maintainerId");

-- CreateIndex
CREATE INDEX "Stop_updatedAt_idx" ON "Stop"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Stop_name_direction_key" ON "Stop"("name", "direction");

-- CreateIndex
CREATE INDEX "StopLandmark_landmarkId_idx" ON "StopLandmark"("landmarkId");

-- CreateIndex
CREATE INDEX "StopPhoto_stopId_idx" ON "StopPhoto"("stopId");

-- CreateIndex
CREATE INDEX "StopPhoto_uploadId_idx" ON "StopPhoto"("uploadId");

-- CreateIndex
CREATE UNIQUE INDEX "SignSet_stopId_key" ON "SignSet"("stopId");

-- CreateIndex
CREATE UNIQUE INDEX "Line_name_key" ON "Line"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Line_number_key" ON "Line"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Route_lineId_kind_key" ON "Route"("lineId", "kind");

-- CreateIndex
CREATE INDEX "RouteStop_stopId_idx" ON "RouteStop"("stopId");

-- CreateIndex
CREATE UNIQUE INDEX "RouteStop_routeId_seq_key" ON "RouteStop"("routeId", "seq");

-- CreateIndex
CREATE INDEX "Snapshot_objectType_objectId_createdAt_idx" ON "Snapshot"("objectType", "objectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Snapshot_objectType_action_createdAt_idx" ON "Snapshot"("objectType", "action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Snapshot_createdAt_idx" ON "Snapshot"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusCompany" ADD CONSTRAINT "BusCompany_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Landmark" ADD CONSTRAINT "Landmark_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "LandmarkCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandmarkPoint" ADD CONSTRAINT "LandmarkPoint_landmarkId_fkey" FOREIGN KEY ("landmarkId") REFERENCES "Landmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_streetId_fkey" FOREIGN KEY ("streetId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_roadId_fkey" FOREIGN KEY ("roadId") REFERENCES "DictItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_platformTypeId_fkey" FOREIGN KEY ("platformTypeId") REFERENCES "DictItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_safetyId_fkey" FOREIGN KEY ("safetyId") REFERENCES "DictItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_shelterTypeId_fkey" FOREIGN KEY ("shelterTypeId") REFERENCES "DictItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_maintainerId_fkey" FOREIGN KEY ("maintainerId") REFERENCES "DictItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopLandmark" ADD CONSTRAINT "StopLandmark_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopLandmark" ADD CONSTRAINT "StopLandmark_landmarkId_fkey" FOREIGN KEY ("landmarkId") REFERENCES "Landmark"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopPhoto" ADD CONSTRAINT "StopPhoto_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopPhoto" ADD CONSTRAINT "StopPhoto_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignSet" ADD CONSTRAINT "SignSet_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Line" ADD CONSTRAINT "Line_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "BusCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Line" ADD CONSTRAINT "Line_fareSystemId_fkey" FOREIGN KEY ("fareSystemId") REFERENCES "DictItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
