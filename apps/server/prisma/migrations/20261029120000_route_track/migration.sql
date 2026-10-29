-- 走向轨迹：按站序调用高德驾车路径规划算出，手动计算；不进修改快照
ALTER TABLE "Route" ADD COLUMN "track" JSONB,
ADD COLUMN "trackKey" TEXT,
ADD COLUMN "trackDistance" INTEGER,
ADD COLUMN "trackAt" TIMESTAMP(3);
