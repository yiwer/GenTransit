// 站架类型（M7 计划第 3 节）：六种结构形式、按形式的毫米参数（zod 判别联合）、可用的面、预设库、
// 迁移用的名称识别 guessShelfForm（与迁移 SQL 同一组规则，测试同时核对两边）
import { z } from 'zod'
import { BOARD_FACE_LABEL, type BoardFace } from './sign-set'

/* ---------------- 结构形式 ---------------- */

export const SHELF_FORMS = ['singlePost', 'doublePost', 'shelter', 'totem', 'attached', 'ePost'] as const
export type ShelfForm = (typeof SHELF_FORMS)[number]
export const SHELF_FORM_LABEL: Record<ShelfForm, string> = {
  singlePost: '单立柱',
  doublePost: '双立柱',
  shelter: '候车亭',
  totem: '多面柱',
  attached: '附着式',
  ePost: '电子站牌立杆',
}
export const SHELF_FORM_HINT: Record<ShelfForm, string> = {
  singlePost: '一根柱，牌居中抱箍在柱前，或旗式伸出在柱一侧',
  doublePost: '两根柱夹一块或一排牌，最常见的线路站牌',
  shelter: '顶棚 + 立柱，站牌装在背板、端板或立柱间的灯箱上',
  totem: '三到六面的竖向导向柱，每面一组牌',
  attached: '挂在墙面，或挂在路灯杆、电杆上',
  ePost: '带屏或灯箱的厚箱体立杆，有底座',
}

export const SHELF_ORIENTATIONS = ['parallel', 'perpendicular'] as const
export type ShelfOrientation = (typeof SHELF_ORIENTATIONS)[number]
export const SHELF_ORIENTATION_LABEL: Record<ShelfOrientation, string> = {
  parallel: '平行路缘（正面朝站台）',
  perpendicular: '垂直路缘（正面朝来车）',
}

/* ---------------- 参数（毫米） ---------------- */

const mm = (min: number, max: number, def: number) =>
  z.number('应为数字').int('应为整数').min(min, `不小于 ${min}`).max(max, `不大于 ${max}`).default(def)
const sides = (def: 1 | 2) => z.union([z.literal(1), z.literal(2)]).default(def)

const common = {
  /** 牌面下沿离地 */
  mountBottom: mm(0, 3000, 800),
  orientation: z.enum(SHELF_ORIENTATIONS).default('parallel'),
}

export const singlePostParams = z.object({
  ...common,
  postHeight: mm(500, 8000, 3000),
  postDiameter: mm(30, 400, 89),
  mount: z.enum(['center', 'flag']).default('center'),
  sides: sides(1),
})
export const doublePostParams = z.object({
  ...common,
  postHeight: mm(500, 8000, 2600),
  postDiameter: mm(30, 400, 76),
  /** 柱中心到牌组边缘的距离；负数表示柱在牌外侧 */
  postInset: mm(-1000, 1000, 100),
  sides: sides(2),
})
export const shelterParams = z.object({
  ...common,
  // 灯箱一般 2 m 高：下沿取 400，顶边低于顶棚下沿 2.5 m
  mountBottom: mm(0, 3000, 400),
  length: mm(1000, 30000, 6000),
  depth: mm(500, 5000, 1600),
  canopyBottom: mm(1800, 5000, 2500),
  canopyThickness: mm(20, 600, 150),
  posts: z.number('应为数字').int('应为整数').min(2, '至少 2 根').max(8, '最多 8 根').default(3),
  mount: z.enum(['back', 'end']).default('back'),
  backPanel: z.boolean().default(true),
  /** 1 = 只有亭内（正面）；2 = 亭内、亭外 */
  sides: sides(1),
})
export const totemParams = z.object({
  ...common,
  faces: z.number('应为数字').int('应为整数').min(3, '至少 3 面').max(6, '最多 6 面').default(3),
  height: mm(500, 8000, 3000),
  /** 牌组两侧留边 */
  margin: mm(0, 500, 60),
  baseHeight: mm(0, 1500, 200),
})
export const attachedParams = z.object({
  ...common,
  host: z.enum(['wall', 'pole']).default('wall'),
  poleDiameter: mm(30, 600, 160),
  poleHeight: mm(500, 15000, 6000),
  /** 牌面离墙或杆的距离 */
  standoff: mm(0, 1000, 50),
  /** 挂墙只能 1 */
  sides: sides(1),
})
export const ePostParams = z.object({
  ...common,
  height: mm(500, 8000, 2800),
  boxDepth: mm(40, 800, 160),
  baseHeight: mm(0, 1500, 300),
  /** 0 表示无屏；屏在牌组上方 */
  screenHeight: mm(0, 3000, 500),
  sides: sides(2),
})

export const SHELF_PARAM_SCHEMAS = {
  singlePost: singlePostParams,
  doublePost: doublePostParams,
  shelter: shelterParams,
  totem: totemParams,
  attached: attachedParams,
  ePost: ePostParams,
} as const

export type SinglePostParams = z.infer<typeof singlePostParams>
export type DoublePostParams = z.infer<typeof doublePostParams>
export type ShelterParams = z.infer<typeof shelterParams>
export type TotemParams = z.infer<typeof totemParams>
export type AttachedParams = z.infer<typeof attachedParams>
export type EPostParams = z.infer<typeof ePostParams>
export type ShelfParamsOf<F extends ShelfForm> = z.infer<(typeof SHELF_PARAM_SCHEMAS)[F]>
export type ShelfParams = ShelfParamsOf<ShelfForm>

/** 结构形式 + 参数（判别联合） */
export type ShelfSpec = { [F in ShelfForm]: { form: F; params: ShelfParamsOf<F> } }[ShelfForm]

/** 参数整体缺省时取该形式的默认参数 */
const withDefault = <T extends z.ZodObject>(o: T) => o.prefault({} as z.input<T>)

/** 挂墙只能单面 */
const wallOneSide = (v: ShelfSpec, ctx: z.RefinementCtx) => {
  if (v.form === 'attached' && v.params.host === 'wall' && v.params.sides !== 1)
    ctx.addIssue({ code: 'custom', path: ['params', 'sides'], message: '挂墙站牌只能单面' })
}

export const shelfSpec = z
  .discriminatedUnion('form', [
    z.object({ form: z.literal('singlePost'), params: withDefault(singlePostParams) }),
    z.object({ form: z.literal('doublePost'), params: withDefault(doublePostParams) }),
    z.object({ form: z.literal('shelter'), params: withDefault(shelterParams) }),
    z.object({ form: z.literal('totem'), params: withDefault(totemParams) }),
    z.object({ form: z.literal('attached'), params: withDefault(attachedParams) }),
    z.object({ form: z.literal('ePost'), params: withDefault(ePostParams) }),
  ])
  .superRefine(wallOneSide)

/** 各形式的默认参数 */
export const SHELF_PARAM_DEFAULTS = Object.fromEntries(
  SHELF_FORMS.map((f) => [f, SHELF_PARAM_SCHEMAS[f].parse({})]),
) as { [F in ShelfForm]: ShelfParamsOf<F> }

/**
 * 读出库里或接口里的参数：缺的字段补默认值；不合法时退回该形式的默认参数（只用于展示，保存时另有校验）
 */
export function parseShelfSpec(form: ShelfForm, params: unknown): ShelfSpec {
  const r = shelfSpec.safeParse({ form, params: params ?? {} })
  if (r.success) return r.data as ShelfSpec
  return { form, params: SHELF_PARAM_DEFAULTS[form] } as ShelfSpec
}

/** 切换形式：保留通用参数，其余换成新形式的默认值 */
export function switchForm(spec: ShelfSpec, form: ShelfForm): ShelfSpec {
  if (spec.form === form) return spec
  const { mountBottom, orientation } = spec.params
  return { form, params: { ...SHELF_PARAM_DEFAULTS[form], mountBottom, orientation } } as ShelfSpec
}

/* ---------------- 面 ---------------- */

export const TOTEM_FACES = ['A', 'B', 'C', 'D', 'E', 'F'] as const satisfies readonly BoardFace[]

/** 这个类型有的面，按立面展开的顺序 */
export function shelfFaces(spec: ShelfSpec): BoardFace[] {
  if (spec.form === 'totem') return TOTEM_FACES.slice(0, spec.params.faces)
  const n = spec.form === 'attached' && spec.params.host === 'wall' ? 1 : spec.params.sides
  return n === 2 ? ['front', 'back'] : ['front']
}

/** 面的名称：候车亭的正面是亭内、背面是亭外 */
export function shelfFaceLabel(form: ShelfForm | undefined, face: BoardFace): string {
  if (form === 'shelter') {
    if (face === 'front') return '亭内'
    if (face === 'back') return '亭外'
  }
  return BOARD_FACE_LABEL[face]
}

/* ---------------- 参数表（站架类型页的属性表按它生成） ---------------- */

export type ShelfParamField =
  | { key: string; label: string; kind: 'mm'; min: number; max: number; hint?: string }
  | { key: string; label: string; kind: 'int'; min: number; max: number; unit: string; hint?: string }
  | { key: string; label: string; kind: 'choice'; options: { value: string | number; label: string }[]; hint?: string }
  | { key: string; label: string; kind: 'bool'; hint?: string }

const f = {
  mm: (key: string, label: string, min: number, max: number, hint?: string): ShelfParamField => ({
    key,
    label,
    kind: 'mm',
    min,
    max,
    hint,
  }),
  sides: (hint?: string): ShelfParamField => ({
    key: 'sides',
    label: '面',
    kind: 'choice',
    options: [
      { value: 1, label: '单面' },
      { value: 2, label: '双面' },
    ],
    hint,
  }),
}

const COMMON_FIELDS: ShelfParamField[] = [
  f.mm('mountBottom', '牌面下沿离地', 0, 3000, '多块站牌时最下一块底边不宜低于 400'),
  {
    key: 'orientation',
    label: '朝向',
    kind: 'choice',
    options: SHELF_ORIENTATIONS.map((o) => ({ value: o, label: SHELF_ORIENTATION_LABEL[o] })),
  },
]

export const SHELF_PARAM_FIELDS: Record<ShelfForm, ShelfParamField[]> = {
  singlePost: [
    f.mm('postHeight', '柱高', 500, 8000),
    f.mm('postDiameter', '柱径', 30, 400),
    {
      key: 'mount',
      label: '挂法',
      kind: 'choice',
      options: [
        { value: 'center', label: '居中抱箍' },
        { value: 'flag', label: '旗式伸出' },
      ],
    },
    f.sides(),
  ],
  doublePost: [
    f.mm('postHeight', '柱高', 500, 8000),
    f.mm('postDiameter', '柱径', 30, 400),
    f.mm('postInset', '柱到牌组边缘', -1000, 1000, '负数表示柱在牌外侧'),
    f.sides('双面为背靠背'),
  ],
  shelter: [
    f.mm('length', '长度', 1000, 30000, '放不下牌组时立面自动加长'),
    f.mm('depth', '顶棚进深', 500, 5000, '不宜小于 1500'),
    f.mm('canopyBottom', '顶棚下沿高', 1800, 5000, '不小于 2500'),
    f.mm('canopyThickness', '顶棚厚', 20, 600),
    { key: 'posts', label: '立柱数', kind: 'int', min: 2, max: 8, unit: '根' },
    {
      key: 'mount',
      label: '站牌挂在',
      kind: 'choice',
      options: [
        { value: 'back', label: '背板' },
        { value: 'end', label: '端板' },
      ],
    },
    { key: 'backPanel', label: '有背板', kind: 'bool' },
    {
      key: 'sides',
      label: '面',
      kind: 'choice',
      options: [
        { value: 1, label: '只有亭内' },
        { value: 2, label: '亭内 + 亭外' },
      ],
    },
  ],
  totem: [
    { key: 'faces', label: '面数', kind: 'int', min: 3, max: 6, unit: '面', hint: '从 A 面起' },
    f.mm('height', '柱高', 500, 8000),
    f.mm('margin', '牌组两侧留边', 0, 500),
    f.mm('baseHeight', '底座高', 0, 1500),
  ],
  attached: [
    {
      key: 'host',
      label: '依附',
      kind: 'choice',
      options: [
        { value: 'wall', label: '墙面' },
        { value: 'pole', label: '路灯杆 / 电杆' },
      ],
    },
    f.mm('poleDiameter', '杆径', 30, 600, '只对挂杆有效'),
    f.mm('poleHeight', '杆高', 500, 15000, '只对挂杆有效'),
    f.mm('standoff', '离墙或杆', 0, 1000),
    f.sides('挂墙只能单面'),
  ],
  ePost: [
    f.mm('height', '总高', 500, 8000),
    f.mm('boxDepth', '箱体厚', 40, 800),
    f.mm('baseHeight', '底座高', 0, 1500),
    f.mm('screenHeight', '屏幕高', 0, 3000, '0 表示无屏；屏在牌组上方'),
    f.sides(),
  ],
}

export const shelfParamFields = (form: ShelfForm) => [...COMMON_FIELDS, ...SHELF_PARAM_FIELDS[form]]

/* ---------------- 预设库（5.1 节；新建时复制参数，之后与预设库无关） ---------------- */

export interface ShelfPreset {
  key: string
  name: string
  desc: string
  spec: ShelfSpec
}

const preset = <F extends ShelfForm>(
  key: string,
  name: string,
  desc: string,
  form: F,
  params: Partial<ShelfParamsOf<F>> = {},
): ShelfPreset => ({
  key,
  name,
  desc,
  spec: { form, params: SHELF_PARAM_SCHEMAS[form].parse(params) } as ShelfSpec,
})

export const SHELF_PRESETS: ShelfPreset[] = [
  preset('single', '单立柱 · 单面', '一根柱，牌居中', 'singlePost', { mount: 'center', sides: 1 }),
  preset('single-flag', '单立柱 · 旗式双面', '旗式伸出，垂直路缘，双面', 'singlePost', {
    mount: 'flag',
    sides: 2,
    orientation: 'perpendicular',
    mountBottom: 1200,
  }),
  preset('double', '双立柱 · 单面', '两根柱夹一排牌', 'doublePost', { sides: 1 }),
  preset('double-2', '双立柱 · 双面', '背靠背双面', 'doublePost', { sides: 2 }),
  preset('shelter-back', '候车亭 · 背板', '6 m、3 柱，站牌在背板灯箱上', 'shelter', {
    length: 6000,
    posts: 3,
    mount: 'back',
  }),
  preset('shelter-end', '候车亭 · 端板灯箱', '站牌在端板灯箱上，亭内亭外双面', 'shelter', {
    mount: 'end',
    sides: 2,
    length: 4000,
    posts: 2,
  }),
  preset('totem-3', '三面图腾柱', '三面导向柱', 'totem', { faces: 3 }),
  preset('totem-4', '四面图腾柱', '四面导向柱', 'totem', { faces: 4 }),
  preset('wall', '挂墙站牌', '挂在墙面，单面', 'attached', { host: 'wall', sides: 1, mountBottom: 1000 }),
  preset('pole', '挂杆站牌', '抱箍在路灯杆或电杆上，双面', 'attached', {
    host: 'pole',
    sides: 2,
    mountBottom: 1200,
  }),
  preset('epost', '电子站牌立杆', '厚箱体立杆，屏幕在牌组上方，双面', 'ePost', { sides: 2, screenHeight: 500 }),
]

/* ---------------- 迁移用的名称识别（3.3 节） ---------------- */

const has = (name: string, words: string[]) => words.some((w) => name.includes(w))
const CN_DIGIT: Record<string, number> = { 三: 3, 四: 4, 五: 5, 六: 6 }

/**
 * 按名称识别结构形式（规则按顺序匹配，先中先得）；usedFaces 为引用它的站架上站牌用到的面。
 * sides：名称含"双面"或用到了背面时取 2，否则 1（挂墙固定 1）；
 * 多面柱面数取名称中的第一个 3–6 / 三–六，没有时 3，再与用到的最大 A–F 面取较大值。
 * 迁移 SQL 里有同一组规则，改这里要同时改迁移测试
 */
export function guessShelfForm(name: string, usedFaces: readonly BoardFace[] = []): ShelfSpec {
  const twoSided = name.includes('双面') || usedFaces.includes('back') ? 2 : 1
  if (has(name, ['候车亭', '雨棚', '亭']))
    return {
      form: 'shelter',
      params: shelterParams.parse({ sides: twoSided, mount: name.includes('端') ? 'end' : 'back' }),
    }
  if (has(name, ['图腾', '多面', '三面', '四面', '五面', '六面'])) {
    const m = /[3-6三四五六]/.exec(name)?.[0]
    const named = m ? (CN_DIGIT[m] ?? Number(m)) : 3
    const used = Math.max(0, ...usedFaces.map((x) => (TOTEM_FACES as readonly string[]).indexOf(x) + 1))
    return { form: 'totem', params: totemParams.parse({ faces: Math.min(6, Math.max(named, used)) }) }
  }
  if (name.includes('电子')) return { form: 'ePost', params: ePostParams.parse({ sides: twoSided }) }
  if (has(name, ['挂墙', '附墙', '壁挂', '附着', '挂杆', '附杆'])) {
    const pole = name.includes('杆')
    return {
      form: 'attached',
      params: attachedParams.parse({ host: pole ? 'pole' : 'wall', sides: pole ? twoSided : 1 }),
    }
  }
  if (has(name, ['单立柱', '单柱', '单杆']))
    return { form: 'singlePost', params: singlePostParams.parse({ sides: twoSided }) }
  return { form: 'doublePost', params: doublePostParams.parse({ sides: twoSided }) }
}

/* ---------------- 接口数据 ---------------- */

export interface ShelfTypeItem {
  id: string
  name: string
  form: ShelfForm
  params: ShelfParams
  desc: string
  /** 由字典迁移而来、形式按名称识别：保存一次后清除 */
  needsReview: boolean
  shelfCount: number
  templateCount: number
  updatedAt: string
}

/** 站牌集、模板里引用的站架类型 */
export interface ShelfTypeRef {
  id: string
  name: string
  form: ShelfForm
}

/* ---------------- 请求体 ---------------- */

/** 新建、修改站架类型：名称、说明 + 结构形式与参数 */
export const shelfTypeInput = z
  .object({
    name: z.string().trim().min(1, '必填').max(50, '不能超过 50 字'),
    desc: z.string().trim().max(200, '不能超过 200 字').default(''),
  })
  .and(shelfSpec)
export type ShelfTypeInput = z.infer<typeof shelfTypeInput>
export type ShelfTypeInputRaw = z.input<typeof shelfTypeInput>
