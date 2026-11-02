-- M7：站架类型从字典迁出，成为独立的"站架类型"表（M7 计划 3.3 节）。
-- 原字典项的 ID、名称、时间原样保留，站架与站架模板的 typeId 不变，只换外键指向。
-- 形式按名称识别，规则与 packages/shared/src/shelf-type.ts 的 guessShelfForm 相同（迁移测试同时核对两边），改一边要同时改另一边。
-- 参数取 M7 计划 3.1 节的默认值，sides / faces 参考现有站牌；迁移来的类型标 needsReview，保存一次后清除。
BEGIN;

-- 1. 枚举与表
CREATE TYPE "ShelfForm" AS ENUM ('singlePost', 'doublePost', 'shelter', 'totem', 'attached', 'ePost');

CREATE TABLE "ShelfType" (
    "id" UUID NOT NULL,
    "name" TEXT COLLATE "zh-x-icu" NOT NULL,
    "form" "ShelfForm" NOT NULL,
    "params" JSONB NOT NULL,
    "desc" TEXT NOT NULL DEFAULT '',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShelfType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShelfType_name_key" ON "ShelfType"("name");

CREATE INDEX "ShelfType_updatedAt_id_idx" ON "ShelfType"("updatedAt", "id");

-- 2. 迁出字典里的站架类型
WITH used AS (
  -- 引用它的站架上站牌用到的面：有没有背面、用到的最大 A–F 面
  SELECT sh."typeId" AS id,
         bool_or(b."face" = 'back') AS back,
         max(CASE b."face" WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 WHEN 'D' THEN 4 WHEN 'E' THEN 5 WHEN 'F' THEN 6 ELSE 0 END) AS letters
  FROM "Shelf" sh
  JOIN "Board" b ON b."shelfId" = sh."id"
  GROUP BY sh."typeId"
),
src AS (
  SELECT d."id", d."name", d."createdAt", d."updatedAt",
         CASE
           WHEN strpos(d."name", '候车亭') > 0 OR strpos(d."name", '雨棚') > 0 OR strpos(d."name", '亭') > 0 THEN 'shelter'
           WHEN strpos(d."name", '图腾') > 0 OR strpos(d."name", '多面') > 0 OR strpos(d."name", '三面') > 0
             OR strpos(d."name", '四面') > 0 OR strpos(d."name", '五面') > 0 OR strpos(d."name", '六面') > 0 THEN 'totem'
           WHEN strpos(d."name", '电子') > 0 THEN 'ePost'
           WHEN strpos(d."name", '挂墙') > 0 OR strpos(d."name", '附墙') > 0 OR strpos(d."name", '壁挂') > 0
             OR strpos(d."name", '附着') > 0 OR strpos(d."name", '挂杆') > 0 OR strpos(d."name", '附杆') > 0 THEN 'attached'
           WHEN strpos(d."name", '单立柱') > 0 OR strpos(d."name", '单柱') > 0 OR strpos(d."name", '单杆') > 0 THEN 'singlePost'
           ELSE 'doublePost'
         END AS form,
         CASE WHEN strpos(d."name", '双面') > 0 OR coalesce(u.back, false) THEN 2 ELSE 1 END AS sides,
         coalesce(u.letters, 0) AS letters,
         CASE substring(d."name" FROM '[3-6三四五六]')
           WHEN '三' THEN 3 WHEN '四' THEN 4 WHEN '五' THEN 5 WHEN '六' THEN 6
           WHEN '3' THEN 3 WHEN '4' THEN 4 WHEN '5' THEN 5 WHEN '6' THEN 6
           ELSE 3
         END AS named_faces
  FROM "DictItem" d
  LEFT JOIN used u ON u.id = d."id"
  WHERE d."category" = 'shelfType'
)
INSERT INTO "ShelfType" ("id", "name", "form", "params", "desc", "needsReview", "createdAt", "updatedAt")
SELECT src."id", src."name", src.form::"ShelfForm",
       -- 候车亭的灯箱一般 2 m 高，下沿取 400 才低于 2.5 m 的顶棚下沿（与 shelterParams 的默认值相同）
       jsonb_build_object('mountBottom', CASE src.form WHEN 'shelter' THEN 400 ELSE 800 END, 'orientation', 'parallel') ||
       CASE src.form
         WHEN 'singlePost' THEN jsonb_build_object(
           'postHeight', 3000, 'postDiameter', 89, 'mount', 'center', 'sides', src.sides)
         WHEN 'doublePost' THEN jsonb_build_object(
           'postHeight', 2600, 'postDiameter', 76, 'postInset', 100, 'sides', src.sides)
         WHEN 'shelter' THEN jsonb_build_object(
           'length', 6000, 'depth', 1600, 'canopyBottom', 2500, 'canopyThickness', 150, 'posts', 3,
           'mount', CASE WHEN strpos(src."name", '端') > 0 THEN 'end' ELSE 'back' END,
           'backPanel', true, 'sides', src.sides)
         WHEN 'totem' THEN jsonb_build_object(
           'faces', least(6, greatest(src.named_faces, src.letters)), 'height', 3000, 'margin', 60, 'baseHeight', 200)
         WHEN 'attached' THEN jsonb_build_object(
           'host', CASE WHEN strpos(src."name", '杆') > 0 THEN 'pole' ELSE 'wall' END,
           'poleDiameter', 160, 'poleHeight', 6000, 'standoff', 50,
           'sides', CASE WHEN strpos(src."name", '杆') > 0 THEN src.sides ELSE 1 END)
         ELSE jsonb_build_object(
           'height', 2800, 'boxDepth', 160, 'baseHeight', 300, 'screenHeight', 500, 'sides', src.sides)
       END,
       '', true, src."createdAt", src."updatedAt"
FROM src;

-- 3. 站架、站架模板的外键改指向站架类型（ID 相同，不改数据）
ALTER TABLE "Shelf" DROP CONSTRAINT "Shelf_typeId_fkey";
ALTER TABLE "ShelfTemplate" DROP CONSTRAINT "ShelfTemplate_typeId_fkey";

ALTER TABLE "Shelf" ADD CONSTRAINT "Shelf_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ShelfType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShelfTemplate" ADD CONSTRAINT "ShelfTemplate_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ShelfType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. 删除字典里这一类
DELETE FROM "DictItem" WHERE "category" = 'shelfType';

-- 5. 字典类别去掉 shelfType；墓碑类型加 shelfType（迁移前删除的站架类型仍记为 dictItem）
CREATE TYPE "DictCategory_new" AS ENUM ('maintainer', 'road', 'fareSystem', 'platformType', 'safety', 'shelterType');
ALTER TABLE "DictItem" ALTER COLUMN "category" TYPE "DictCategory_new" USING ("category"::text::"DictCategory_new");
ALTER TYPE "DictCategory" RENAME TO "DictCategory_old";
ALTER TYPE "DictCategory_new" RENAME TO "DictCategory";
DROP TYPE "DictCategory_old";

ALTER TYPE "TombstoneType" ADD VALUE 'shelfType';

COMMIT;
