-- M3：站牌集的站架、站牌、插片、线路编排与站架模板（M3 计划 3.1 节）
-- 模板名称用 ICU 中文排序规则；编排的三个部分唯一索引 Prisma schema 无法表达，手写在文件末尾
-- CreateEnum
CREATE TYPE "BoardFace" AS ENUM ('front', 'back', 'A', 'B', 'C', 'D', 'E', 'F');

-- CreateEnum
CREATE TYPE "BoardKind" AS ENUM ('whole', 'sliced');

-- CreateEnum
CREATE TYPE "SlotKind" AS ENUM ('route', 'other');

-- CreateEnum
CREATE TYPE "Placement" AS ENUM ('board', 'slot', 'hidden');

-- CreateTable
CREATE TABLE "Shelf" (
    "id" UUID NOT NULL,
    "signSetId" UUID NOT NULL,
    "typeId" UUID NOT NULL,
    "no" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "desc" TEXT NOT NULL DEFAULT '',
    "noPhysical" BOOLEAN NOT NULL DEFAULT false,
    "material" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shelf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" UUID NOT NULL,
    "shelfId" UUID NOT NULL,
    "signSetId" UUID NOT NULL,
    "no" INTEGER NOT NULL,
    "face" "BoardFace" NOT NULL,
    "kind" "BoardKind" NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "remark" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Slot" (
    "id" UUID NOT NULL,
    "boardId" UUID NOT NULL,
    "no" INTEGER NOT NULL,
    "kind" "SlotKind" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" UUID NOT NULL,
    "signSetId" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "pass" INTEGER NOT NULL,
    "placement" "Placement" NOT NULL,
    "boardId" UUID,
    "slotId" UUID,
    "order" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShelfTemplate" (
    "id" UUID NOT NULL,
    "name" TEXT COLLATE "zh-x-icu" NOT NULL,
    "typeId" UUID NOT NULL,
    "desc" TEXT NOT NULL DEFAULT '',
    "noPhysical" BOOLEAN NOT NULL DEFAULT false,
    "imageId" UUID,
    "boards" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShelfTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shelf_typeId_idx" ON "Shelf"("typeId");

-- CreateIndex
CREATE UNIQUE INDEX "Shelf_signSetId_no_key" ON "Shelf"("signSetId", "no");

-- CreateIndex
CREATE INDEX "Board_shelfId_idx" ON "Board"("shelfId");

-- CreateIndex
CREATE UNIQUE INDEX "Board_signSetId_no_key" ON "Board"("signSetId", "no");

-- CreateIndex
CREATE UNIQUE INDEX "Slot_boardId_no_key" ON "Slot"("boardId", "no");

-- CreateIndex
CREATE INDEX "Schedule_signSetId_idx" ON "Schedule"("signSetId");

-- CreateIndex
CREATE INDEX "Schedule_routeId_idx" ON "Schedule"("routeId");

-- CreateIndex
CREATE INDEX "Schedule_boardId_idx" ON "Schedule"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "ShelfTemplate_typeId_name_key" ON "ShelfTemplate"("typeId", "name");

-- AddForeignKey
ALTER TABLE "Shelf" ADD CONSTRAINT "Shelf_signSetId_fkey" FOREIGN KEY ("signSetId") REFERENCES "SignSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shelf" ADD CONSTRAINT "Shelf_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "DictItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "Shelf"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_signSetId_fkey" FOREIGN KEY ("signSetId") REFERENCES "SignSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_signSetId_fkey" FOREIGN KEY ("signSetId") REFERENCES "SignSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShelfTemplate" ADD CONSTRAINT "ShelfTemplate_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "DictItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShelfTemplate" ADD CONSTRAINT "ShelfTemplate_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 编排的部分唯一索引（BR-06、BR-07）
-- 每个插片最多一条编排
CREATE UNIQUE INDEX "Schedule_slot_once" ON "Schedule"("slotId") WHERE "slotId" IS NOT NULL;
-- 同一途经在同一块站牌最多一次（放在插片上的编排也记下站牌）
CREATE UNIQUE INDEX "Schedule_board_once" ON "Schedule"("signSetId", "routeId", "pass", "boardId") WHERE "boardId" IS NOT NULL;
-- 同一途经最多一条隐藏
CREATE UNIQUE INDEX "Schedule_hidden_once" ON "Schedule"("signSetId", "routeId", "pass") WHERE "placement" = 'hidden';
