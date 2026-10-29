import { z } from 'zod'
import {
  V1_LIMIT_MAX_HEAVY,
  v1BusCompany,
  v1Deleted,
  v1DeletedQuery,
  v1DictItem,
  v1DictQuery,
  v1Error,
  v1ExtField,
  v1Landmark,
  v1LandmarkCategory,
  v1Line,
  v1ListQuery,
  v1PageOf,
  v1Region,
  v1ShelfTemplate,
  v1SignSet,
  v1Stop,
} from '@gentransit/shared'

/**
 * OpenAPI 3.1 文档由共享包的 zod 模式经 z.toJSONSchema 生成（M4 计划 3.8 节，默认决定 10）。
 * 接口表同时是契约测试的依据：路径集合要与控制器路由一致
 */

export const v1StopPage = v1PageOf(v1Stop)
export const v1LinePage = v1PageOf(v1Line)
export const v1SignSetPage = v1PageOf(v1SignSet)
export const v1LandmarkPage = v1PageOf(v1Landmark)
export const v1LandmarkCategoryPage = v1PageOf(v1LandmarkCategory)
export const v1DictItemPage = v1PageOf(v1DictItem)
export const v1RegionPage = v1PageOf(v1Region)
export const v1BusCompanyPage = v1PageOf(v1BusCompany)
export const v1ShelfTemplatePage = v1PageOf(v1ShelfTemplate)
export const v1ExtFieldPage = v1PageOf(v1ExtField)
export const v1DeletedPage = v1PageOf(v1Deleted)

export const v1StopListQuery = v1ListQuery()
export const v1HeavyListQuery = v1ListQuery(V1_LIMIT_MAX_HEAVY)

/** 组件名 → 模式；生成文档时同一个模式实例写成 $ref */
const COMPONENTS: [string, z.ZodType][] = [
  ['Stop', v1Stop],
  ['Line', v1Line],
  ['SignSet', v1SignSet],
  ['Landmark', v1Landmark],
  ['LandmarkCategory', v1LandmarkCategory],
  ['DictItem', v1DictItem],
  ['Region', v1Region],
  ['BusCompany', v1BusCompany],
  ['ShelfTemplate', v1ShelfTemplate],
  ['ExtField', v1ExtField],
  ['Deleted', v1Deleted],
  ['Error', v1Error],
  ['StopPage', v1StopPage],
  ['LinePage', v1LinePage],
  ['SignSetPage', v1SignSetPage],
  ['LandmarkPage', v1LandmarkPage],
  ['LandmarkCategoryPage', v1LandmarkCategoryPage],
  ['DictItemPage', v1DictItemPage],
  ['RegionPage', v1RegionPage],
  ['BusCompanyPage', v1BusCompanyPage],
  ['ShelfTemplatePage', v1ShelfTemplatePage],
  ['ExtFieldPage', v1ExtFieldPage],
  ['DeletedPage', v1DeletedPage],
]

export interface V1Endpoint {
  /** OpenAPI 写法，如 /stops/{id} */
  path: string
  tag: string
  summary: string
  description?: string
  query?: z.ZodObject
  /** 路径参数名 */
  params?: string[]
  /** 响应模式；文件接口为 undefined（二进制） */
  response?: z.ZodType
}

const LIST_NOTE = '按（changedAt，id）升序，游标分页。增量同步的做法见文档开头。'

export const V1_ENDPOINTS: V1Endpoint[] = [
  {
    path: '/stops',
    tag: '站点',
    summary: '站点列表',
    description: LIST_NOTE,
    query: v1StopListQuery,
    response: v1StopPage,
  },
  { path: '/stops/{id}', tag: '站点', summary: '单个站点', params: ['id'], response: v1Stop },
  {
    path: '/stops/{stopId}/sign-set',
    tag: '站牌集',
    summary: '按站点查询站牌集',
    params: ['stopId'],
    response: v1SignSet,
  },
  {
    path: '/lines',
    tag: '线路',
    summary: '线路列表',
    description: `${LIST_NOTE}每页最多 ${V1_LIMIT_MAX_HEAVY} 条。`,
    query: v1HeavyListQuery,
    response: v1LinePage,
  },
  { path: '/lines/{id}', tag: '线路', summary: '单条线路', params: ['id'], response: v1Line },
  {
    path: '/sign-sets',
    tag: '站牌集',
    summary: '站牌集列表（增量同步用）',
    description: `${LIST_NOTE}每项是完整内容，每页最多 ${V1_LIMIT_MAX_HEAVY} 个。`,
    query: v1HeavyListQuery,
    response: v1SignSetPage,
  },
  {
    path: '/landmarks',
    tag: '地标',
    summary: '地标列表',
    description: LIST_NOTE,
    query: v1StopListQuery,
    response: v1LandmarkPage,
  },
  { path: '/landmarks/{id}', tag: '地标', summary: '单个地标', params: ['id'], response: v1Landmark },
  {
    path: '/landmark-categories',
    tag: '地标',
    summary: '地标类别列表',
    description: LIST_NOTE,
    query: v1StopListQuery,
    response: v1LandmarkCategoryPage,
  },
  {
    path: '/landmark-categories/{id}',
    tag: '地标',
    summary: '单个地标类别',
    params: ['id'],
    response: v1LandmarkCategory,
  },
  {
    path: '/dict-items',
    tag: '参考数据',
    summary: '字典项',
    description: `${LIST_NOTE}可按七类之一筛选。`,
    query: v1DictQuery,
    response: v1DictItemPage,
  },
  {
    path: '/regions',
    tag: '参考数据',
    summary: '行政区划',
    description: LIST_NOTE,
    query: v1StopListQuery,
    response: v1RegionPage,
  },
  {
    path: '/bus-companies',
    tag: '参考数据',
    summary: '公交公司',
    description: LIST_NOTE,
    query: v1StopListQuery,
    response: v1BusCompanyPage,
  },
  {
    path: '/shelf-templates',
    tag: '参考数据',
    summary: '站架模板',
    description: `${LIST_NOTE}模板示意图用 image.url 下载。`,
    query: v1StopListQuery,
    response: v1ShelfTemplatePage,
  },
  {
    path: '/ext-fields',
    tag: '参考数据',
    summary: '扩展字段定义',
    description: `${LIST_NOTE}用来解读各对象的 ext。改了扩展字段定义后，建议下游做一次全量同步。`,
    query: v1StopListQuery,
    response: v1ExtFieldPage,
  },
  {
    path: '/deleted',
    tag: '已删除对象',
    summary: '已删除对象',
    description:
      'updatedSince 的含义是"删除时间晚于它"，按（deletedAt，id）升序，游标与水位的做法和其他列表相同。站点删除时它的站牌集也一起删除，两条都会列出。',
    query: v1DeletedQuery,
    response: v1DeletedPage,
  },
  {
    path: '/files/{id}',
    tag: '文件',
    summary: '下载文件（照片、logo、模板示意图）',
    description: '文件上传后不会改变，响应头 Cache-Control: private, max-age=86400。',
    params: ['id'],
  },
]

const DESCRIPTION = `GenTransit 只读 API：站点、线路、站牌集与参考数据，供下游系统增量同步。只有 GET。

## 鉴权
在设置 → API Token 里新建 Token，请求时带上请求头 \`Authorization: Bearer gt_…\`。不支持放在查询参数里。
Token 无效或已吊销时返回 401。本文档与文档页不需要 Token。

## 分页与增量同步
列表固定按（changedAt，id）升序，用游标分页，不返回总数。响应为 \`{ items, nextCursor, nextUpdatedSince }\`。

1. 第一次不带 \`updatedSince\`，用 \`nextCursor\` 翻页直到它为 null，记下 \`nextUpdatedSince\`。
2. 以后每次带上记下的值作为 \`updatedSince\`，同样翻页取完，再记下新的 \`nextUpdatedSince\`。
3. 同一轮里用同样的做法同步一次 \`/deleted\`。
4. 会重复取到少量对象，按 ID 覆盖即可。

翻页时其余参数要与第一页相同。\`nextUpdatedSince\` 是本轮的"水位"：取当前时间与进行中写事务最早开始时间里较早的一个，再减 5 秒，所以长时间的导入也不会漏。本轮每一页返回的值相同。

## "有变化"的口径（changedAt）
- 站点、线路、地标及各类参考数据：每次有效修改（表单保存、导入）都会更新；没有变化的保存不更新。
- 站牌集：自身保存与连带修改；线路新建、删除、停运、恢复，或站序变化使本站的途经变了，也算。只改到站时刻、票价等不算。
- 不算"有变化"：被引用的对象改名（字典项、行政区划、公交公司、地标、线路、站点）；扩展字段定义变化。改了扩展字段定义后，建议做一次全量同步。

## 数据约定
- 时间：ISO 8601 UTC，带毫秒。
- 坐标：按库里的值原样输出，是高德的 GCJ-02 坐标系。
- 引用其他对象写成 \`{ id, name }\`（站点引用另带 direction），名称取当前值。请按 ID 关联，参考数据单独同步。
- 枚举输出代码值，中文名见各字段说明。
- 扩展字段写成 \`ext: { 键: 值 }\`，只含启用中的字段，定义见 \`/ext-fields\`。
- 文件地址是相对路径 \`/api/v1/files/{id}\`，用同一个 Token 下载。
- 站牌集的途经按（走向 ID，站点 ID，第几次途经）与线路的路径站对应。
- 错误响应为 \`{ code, message, details }\`；已删除的对象返回 404，请查 \`/deleted\`。`

/** 去掉生成结果里每个组件自带的 $id、$schema */
function clean(s: Record<string, unknown>) {
  const { $id: _id, $schema: _schema, ...rest } = s
  return rest
}

/** 单个查询参数的 JSON Schema（按输入类型） */
function paramSchema(t: z.ZodType) {
  return clean(z.toJSONSchema(t, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>)
}

export function buildOpenApi(version: string) {
  const registry = z.registry<{ id: string }>()
  for (const [id, schema] of COMPONENTS) registry.add(schema, { id })
  const { schemas } = z.toJSONSchema(registry, {
    uri: (id) => `#/components/schemas/${id}`,
    unrepresentable: 'any',
  }) as { schemas: Record<string, Record<string, unknown>> }
  const refOf = (t: z.ZodType) => {
    const hit = COMPONENTS.find(([, s]) => s === t)
    if (!hit) throw new Error('响应模式没有登记为组件')
    return { $ref: `#/components/schemas/${hit[0]}` }
  }
  const error = (description: string) => ({
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  })

  const paths: Record<string, Record<string, unknown>> = {}
  for (const e of V1_ENDPOINTS) {
    const parameters = [
      ...(e.params ?? []).map((name) => ({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      })),
      ...Object.entries(e.query?.shape ?? {}).map(([name, t]) => {
        const field = t as z.ZodType
        const s = paramSchema(field)
        return {
          name,
          in: 'query',
          required: !field.safeParse(undefined).success,
          description: (s.description as string | undefined) ?? undefined,
          schema: s,
        }
      }),
    ]
    paths[e.path] = {
      get: {
        tags: [e.tag],
        summary: e.summary,
        description: e.description,
        operationId: `get${e.path.replace(/[{}]/g, '').replace(/(^|[/-])(\w)/g, (_, __, c: string) => c.toUpperCase())}`,
        parameters,
        responses: {
          '200': e.response
            ? { description: '成功', content: { 'application/json': { schema: refOf(e.response) } } }
            : {
                description: '文件内容',
                content: { 'image/*': { schema: { type: 'string', contentMediaType: 'application/octet-stream' } } },
              },
          ...(e.query ? { '400': error('参数或游标不合法') } : {}),
          '401': error('API Token 无效或已吊销'),
          ...(e.params ? { '404': error('对象不存在或已删除') } : {}),
        },
      },
    }
  }

  return {
    openapi: '3.1.0',
    info: { title: 'GenTransit 只读 API', version, description: DESCRIPTION },
    servers: [{ url: '/api/v1' }],
    security: [{ bearer: [] }],
    tags: ['站点', '线路', '站牌集', '地标', '参考数据', '已删除对象', '文件'].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'gt_…', description: '设置 → API Token 里新建' },
      },
      schemas: Object.fromEntries(Object.entries(schemas).map(([k, v]) => [k, clean(v)])),
    },
  }
}
