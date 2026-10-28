// 开发种子数据：沿用 M0 原型虚构的"示例市"（坐标落在杭州附近，站点不在真实道路上）。
// 用法：pnpm db:seed（库里已有站点时跳过）；pnpm db:seed --reset（先清空业务数据再写入）
import { createHash } from 'node:crypto'
import path from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { STOP_NORMALIZE, compareText, signSetSnapshot, stopLabel, stopSnapshot, type Ref } from '@gentransit/shared'
import { PrismaClient, type DictCategory, type Prisma, type RouteKind } from '../src/generated/prisma/client'

try {
  process.loadEnvFile(path.resolve(__dirname, '../../../.env'))
} catch {
  // 没有 .env 时只用系统环境变量
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
const hash = (type: 'stop' | 'signSet', content: unknown) =>
  createHash('sha256')
    .update(compareText(content, type === 'stop' ? STOP_NORMALIZE : {}))
    .digest('hex')

// 原型的示意坐标 → 经纬度（GCJ-02）
const lngLat = (x: number, y: number) => ({
  lng: +(120.1 + (x / 1000) * 0.2).toFixed(6),
  lat: +(30.3 - (y / 640) * 0.1).toFixed(6),
})

const ROADS: { name: string; points: [number, number][] }[] = [
  {
    name: '解放路',
    points: [
      [0, 300],
      [1000, 300],
    ],
  },
  {
    name: '中山路',
    points: [
      [0, 160],
      [1000, 160],
    ],
  },
  {
    name: '环城北路',
    points: [
      [0, 60],
      [1000, 60],
    ],
  },
  {
    name: '文化路',
    points: [
      [0, 420],
      [1000, 420],
    ],
  },
  {
    name: '人民大道',
    points: [
      [420, 0],
      [420, 640],
    ],
  },
  {
    name: '建设路',
    points: [
      [640, 0],
      [640, 640],
    ],
  },
  {
    name: '学院路',
    points: [
      [180, 0],
      [180, 640],
    ],
  },
  {
    name: '科技大道',
    points: [
      [700, 0],
      [1000, 250],
    ],
  },
  {
    name: '滨江大道',
    points: [
      [0, 540],
      [260, 525],
      [520, 520],
      [760, 512],
      [1000, 530],
    ],
  },
]
const STREETS: Record<string, string[]> = {
  西城区: ['学院街道', '西湖街道'],
  中心区: ['解放街道', '人民街道', '滨江街道'],
  东城区: ['科技城街道', '港湾街道'],
}
function regionOf(x: number, y: number) {
  const district = x < 330 ? '西城区' : x < 700 ? '中心区' : '东城区'
  const street =
    district === '西城区'
      ? y < 300
        ? '学院街道'
        : '西湖街道'
      : district === '中心区'
        ? y < 250
          ? '人民街道'
          : y < 470
            ? '解放街道'
            : '滨江街道'
        : y < 300
          ? '科技城街道'
          : '港湾街道'
  return { district, street }
}
function nearestRoad(x: number, y: number) {
  let best = { name: '', d: Infinity }
  for (const r of ROADS)
    for (let i = 0; i < r.points.length - 1; i++) {
      const [ax, ay] = r.points[i]
      const [bx, by] = r.points[i + 1]
      const dx = bx - ax
      const dy = by - ay
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
      if (d < best.d) best = { name: r.name, d }
    }
  return best.name
}

const DICTS: Record<DictCategory, string[]> = {
  shelfType: ['双立柱站架', '单立柱站架', '候车亭灯箱', '电子站牌立杆'],
  maintainer: ['示例公交一公司', '示例公交二公司', '示例市政养护中心'],
  road: ROADS.map((r) => r.name),
  fareSystem: ['一票制', '分段计价'],
  platformType: ['港湾式', '直线式', '岛式'],
  safety: ['护栏', '护栏 + 隔离墩', '无'],
  shelterType: ['标准候车亭', '简易雨棚', '无'],
}

type StopSeed = [code: string, name: string, dir: string, x: number, y: number, maintainer?: string]
const STOPS: StopSeed[] = [
  ['s01', '人民广场', '东', 432, 294, '示例公交一公司'],
  ['s02', '人民广场', '西', 408, 306, '示例公交一公司'],
  ['s03', '解放路口', '南', 652, 310],
  ['s04', '解放路口', '北', 628, 290],
  ['s05', '火车站', '场站', 884, 300, '示例公交二公司'],
  ['s06', '市民中心', '东', 432, 160],
  ['s07', '中山公园', '北', 292, 292],
  ['s08', '中山公园', '南', 300, 308],
  ['s09', '体育中心', '西', 170, 420],
  ['s10', '学院路口', '东', 190, 300],
  ['s11', '大学城', '北', 180, 92],
  ['s12', '科技园', '东', 820, 116],
  ['s13', '金融中心', '西', 630, 160],
  ['s14', '会展中心', '南', 760, 520, '示例公交二公司'],
  ['s15', '滨江公园', '北', 520, 528],
  ['s16', '汽车南站', '场站', 420, 612, '示例公交二公司'],
  ['s17', '东方医院', '东', 650, 420],
  ['s18', '文化宫', '西', 410, 420],
  ['s19', '实验中学', '南', 520, 168],
  ['s20', '港湾路', '北', 902, 538],
  ['s21', '北门', '南', 420, 52],
  ['s22', '南湖公园', '东', 300, 520],
  ['s23', '新华书店', '北', 520, 292],
  ['s24', '建设路口', '西', 632, 232],
  ['s25', '环城北路', '东', 650, 60],
  ['s26', '西站', '场站', 36, 300],
  ['s27', '软件园', '北', 940, 196],
  ['s28', '梧桐巷', '无', 560, 380],
  ['s29', '市图书馆', '东', 340, 160],
  ['s30', '老街', '南', 120, 216],
  ['s31', '科技大道', '西', 760, 70],
  ['s32', '江景路', '北', 700, 516],
]
const EN: Record<string, string> = {
  人民广场: 'Renmin Square',
  解放路口: 'Jiefang Rd. Junction',
  火车站: 'Railway Station',
  市民中心: 'Civic Center',
  中山公园: 'Zhongshan Park',
  体育中心: 'Sports Center',
  学院路口: 'Xueyuan Rd. Junction',
  大学城: 'University Town',
  科技园: 'Science Park',
  金融中心: 'Financial Center',
  会展中心: 'Expo Center',
  滨江公园: 'Riverside Park',
  汽车南站: 'South Bus Station',
  东方医院: 'Dongfang Hospital',
  文化宫: 'Cultural Palace',
  实验中学: 'Experimental Middle School',
  港湾路: 'Gangwan Rd.',
  北门: 'North Gate',
  南湖公园: 'Nanhu Park',
  新华书店: 'Xinhua Bookstore',
  建设路口: 'Jianshe Rd. Junction',
  环城北路: 'North Ring Rd.',
  西站: 'West Station',
  软件园: 'Software Park',
  梧桐巷: 'Wutong Lane',
  市图书馆: 'City Library',
  老街: 'Old Street',
  科技大道: 'Keji Ave.',
  江景路: 'Jiangjing Rd.',
}

// 示意坐标 1 单位约 19 米
const UNIT_M = 19
const LANDMARKS: [name: string, category: string, x: number, y: number, radius: number][] = [
  ['中山公园', '公园', 297, 230, 90],
  ['市图书馆', '文化场馆', 345, 140, 60],
  ['地铁人民广场站', '地铁站', 425, 280, 70],
  ['东方医院', '医院', 670, 440, 70],
  ['实验中学', '学校', 520, 140, 60],
  ['市民中心广场', '广场', 455, 175, 80],
  ['会展中心', '文化场馆', 770, 495, 70],
  ['火车站东广场', '交通枢纽', 900, 285, 80],
]
const CATEGORIES: [string, string, number][] = [
  ['公园', 'trees', 1200],
  ['文化场馆', 'library', 1000],
  ['地铁站', 'train-front', 1200],
  ['医院', 'hospital', 1200],
  ['学校', 'school', 1000],
  ['广场', 'landmark', 1400],
  ['交通枢纽', 'bus', 1500],
]

const r = (kind: RouteKind, codes: string) => ({ kind, codes: codes.split(' ') })
const LINES: {
  name: string
  number: string
  mode: 'oneway' | 'twoway' | 'loop'
  status?: 'suspended'
  company: string
  routes: { kind: RouteKind; codes: string[] }[]
}[] = [
  {
    name: '1路',
    number: 'G-0001',
    mode: 'twoway',
    company: '示例公交一公司',
    routes: [r('up', 's26 s10 s07 s01 s23 s04 s05'), r('down', 's05 s03 s28 s02 s08 s10 s26')],
  },
  {
    name: '2路',
    number: 'G-0002',
    mode: 'twoway',
    company: '示例公交一公司',
    routes: [r('up', 's21 s06 s01 s18 s16'), r('down', 's16 s18 s02 s06 s21')],
  },
  {
    name: '10路',
    number: 'G-0010',
    mode: 'twoway',
    company: '示例公交一公司',
    routes: [r('up', 's11 s10 s02 s18 s16'), r('down', 's16 s18 s01 s10 s11')],
  },
  {
    name: '101路',
    number: 'G-0101',
    mode: 'oneway',
    company: '示例公交二公司',
    routes: [r('oneway', 's21 s06 s01 s23 s24 s12 s27')],
  },
  {
    name: 'B1路',
    number: 'B-0001',
    mode: 'twoway',
    company: '示例公交二公司',
    routes: [r('up', 's26 s30 s29 s01 s19 s13 s25'), r('down', 's25 s13 s19 s02 s29 s30 s26')],
  },
  {
    name: 'K3路',
    number: 'K-0003',
    mode: 'twoway',
    company: '示例公交二公司',
    routes: [r('up', 's16 s18 s01 s06 s21'), r('down', 's21 s06 s02 s18 s16')],
  },
  {
    name: 'K12路',
    number: 'K-0012',
    mode: 'twoway',
    company: '示例公交二公司',
    routes: [r('up', 's22 s18 s01 s23 s03 s17 s14'), r('down', 's14 s17 s04 s28 s02 s18 s22')],
  },
  {
    name: '环1路',
    number: 'H-0001',
    mode: 'loop',
    company: '示例公交一公司',
    routes: [r('loop', 's01 s23 s04 s24 s13 s19 s06 s29 s07 s01')],
  },
  {
    name: '夜1路',
    number: 'Y-0001',
    mode: 'twoway',
    status: 'suspended',
    company: '示例公交一公司',
    routes: [r('up', 's26 s10 s01 s04 s05'), r('down', 's05 s03 s02 s10 s26')],
  },
  {
    name: '15路',
    number: 'G-0015',
    mode: 'twoway',
    company: '示例公交一公司',
    routes: [r('up', 's11 s10 s08 s22 s16'), r('down', 's16 s22 s07 s10 s11')],
  },
  {
    name: '旅游专线',
    number: 'T-0001',
    mode: 'oneway',
    company: '示例公交二公司',
    routes: [r('oneway', 's21 s29 s01 s18 s15 s14 s20')],
  },
  {
    name: '18路',
    number: 'G-0018',
    mode: 'twoway',
    company: '示例公交二公司',
    routes: [r('up', 's20 s32 s14 s17 s03 s23 s02 s30'), r('down', 's30 s29 s01 s23 s04 s17 s14 s32 s20')],
  },
  {
    name: '3路',
    number: 'G-0003',
    mode: 'twoway',
    company: '示例公交一公司',
    routes: [r('up', 's26 s30 s11'), r('down', 's11 s30 s26')],
  },
  {
    name: '22路',
    number: 'G-0022',
    mode: 'twoway',
    company: '示例公交二公司',
    routes: [r('up', 's12 s27 s31 s25 s24'), r('down', 's24 s25 s31 s27 s12')],
  },
  {
    name: '33路',
    number: 'G-0033',
    mode: 'loop',
    company: '示例公交二公司',
    routes: [r('loop', 's14 s15 s22 s16 s14')],
  },
  {
    name: '夜2路',
    number: 'Y-0002',
    mode: 'twoway',
    company: '示例公交二公司',
    routes: [r('up', 's05 s17 s14 s20'), r('down', 's20 s14 s17 s05')],
  },
]

async function main() {
  const reset = process.argv.includes('--reset')
  if (reset) {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'Account', 'Session', 'Setting')`
    await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((x) => `"${x.tablename}"`).join(', ')} CASCADE`)
  } else if ((await prisma.stop.count()) > 0) {
    console.log('库里已有站点，跳过种子数据。需要重来请执行 pnpm db:seed --reset')
    return
  }
  await prisma.setting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} })

  const dict: Record<string, Ref> = {}
  for (const [category, names] of Object.entries(DICTS) as [DictCategory, string[]][])
    for (const name of names)
      dict[`${category}:${name}`] = await prisma.dictItem.create({
        data: { category, name },
        select: { id: true, name: true },
      })
  const d = (category: DictCategory, name: string) => dict[`${category}:${name}`] ?? null

  const city = await prisma.region.create({ data: { level: 'city', name: '示例市' }, select: { id: true, name: true } })
  const region: Record<string, Ref> = {}
  for (const [district, streets] of Object.entries(STREETS)) {
    const di = await prisma.region.create({
      data: { level: 'district', name: district, parentId: city.id },
      select: { id: true, name: true },
    })
    region[district] = di
    for (const s of streets)
      region[s] = await prisma.region.create({
        data: { level: 'street', name: s, parentId: di.id },
        select: { id: true, name: true },
      })
  }

  const companies: Record<string, string> = {}
  for (const [name, shortName, nameEn] of [
    ['示例公交一公司', '一公司', 'Example Bus Co. No.1'],
    ['示例公交二公司', '二公司', 'Example Bus Co. No.2'],
  ])
    companies[name] = (await prisma.busCompany.create({ data: { name, shortName, nameEn, hotline: '96000' } })).id

  const cats: Record<string, string> = {}
  for (const [name, icon, radius] of CATEGORIES)
    cats[name] = (await prisma.landmarkCategory.create({ data: { name, icon, defaultRadius: radius } })).id
  const landmarks: { id: string; name: string; category: string; x: number; y: number; radius: number }[] = []
  for (const [name, category, x, y, radius] of LANDMARKS) {
    const lm = await prisma.landmark.create({
      data: {
        name,
        categoryId: cats[category],
        points: { create: [{ ...lngLat(x, y), radius: radius * UNIT_M, sort: 0 }] },
      },
    })
    landmarks.push({ id: lm.id, name, category, x, y, radius })
  }

  await prisma.extField.create({
    data: {
      owner: 'stop',
      key: 'area',
      name: '养护片区',
      type: 'select',
      options: ['解放片区', '滨江片区', '科技城片区'],
      section: 'other',
    },
  })

  const stopIds: Record<string, string> = {}
  for (const [i, [code, name, direction, x, y, maintainerName]] of STOPS.entries()) {
    const { district, street } = regionOf(x, y)
    const roadRef = d('road', nearestRoad(x, y))
    const near = landmarks.filter((l) => Math.hypot(l.x - x, l.y - y) <= l.radius).slice(0, 2)
    const fac = {
      berths: i % 3 === 0 ? 3 : 2,
      platformType: d('platformType', i % 4 === 0 ? '港湾式' : '直线式'),
      safety: d('safety', i % 5 === 0 ? '护栏 + 隔离墩' : '护栏'),
      waiting: i % 2 === 0 ? '座椅 4 个、遮阳棚' : '',
      shelterType: d('shelterType', i % 3 === 0 ? '标准候车亭' : '简易雨棚'),
      bigLightbox: i % 3 === 0 ? 2 : 0,
      smallLightbox: i % 2 === 0 ? 1 : 0,
      seats: i % 2 === 0 ? 4 : 0,
    }
    const maintainer = d('maintainer', maintainerName ?? '示例市政养护中心')
    const ext =
      x > 330 && x < 700 ? { area: y < 470 ? '解放片区' : '滨江片区' } : x >= 700 ? { area: '科技城片区' } : {}
    const remark = code === 's01' ? '地铁 2 号线 B 口出站即到' : ''
    const { lng, lat } = lngLat(x, y)
    const stop = await prisma.stop.create({
      data: {
        name,
        direction,
        nameEn: EN[name] ?? '',
        lng,
        lat,
        cityId: city.id,
        districtId: region[district].id,
        streetId: region[street].id,
        roadId: roadRef?.id,
        berths: fac.berths,
        platformTypeId: fac.platformType?.id,
        safetyId: fac.safety?.id,
        waiting: fac.waiting,
        shelterTypeId: fac.shelterType?.id,
        bigLightbox: fac.bigLightbox,
        smallLightbox: fac.smallLightbox,
        seats: fac.seats,
        maintainerId: maintainer?.id,
        remark,
        ext,
        landmarks: { create: near.map((l) => ({ landmarkId: l.id })) },
        signSet: { create: {} },
      },
      include: { signSet: true },
    })
    stopIds[code] = stop.id
    const content = stopSnapshot(
      {
        name,
        direction,
        nameEn: EN[name] ?? '',
        lng,
        lat,
        city,
        district: region[district],
        street: region[street],
        road: roadRef,
        qrUrl: '',
        facilities: fac,
        maintainer,
        remark,
        landmarks: near.map((l) => ({ id: l.id, name: l.name, category: l.category })),
        photos: [],
        ext,
      },
      [{ key: 'area', name: '养护片区', type: 'select' }],
    )
    const label = stopLabel({ name, direction })
    const ss = signSetSnapshot({ id: stop.id, name: label })
    await prisma.snapshot.createMany({
      data: [
        {
          objectType: 'stop',
          objectId: stop.id,
          objectName: label,
          action: 'create',
          content: content as unknown as Prisma.InputJsonValue,
          compareHash: hash('stop', content),
        },
        {
          objectType: 'signSet',
          objectId: stop.signSet!.id,
          objectName: label,
          action: 'create',
          content: ss as unknown as Prisma.InputJsonValue,
          compareHash: hash('signSet', ss),
        },
      ],
    })
  }

  for (const l of LINES) {
    await prisma.line.create({
      data: {
        name: l.name,
        number: l.number,
        mode: l.mode,
        status: l.status ?? 'running',
        companyId: companies[l.company],
        ticketType: 'unattended',
        fareSystemId: d('fareSystem', l.name.startsWith('K') ? '分段计价' : '一票制')?.id,
        fare: l.name.startsWith('K') ? '2–4 元' : '2 元',
        routes: {
          create: l.routes.map((rt) => ({
            kind: rt.kind,
            serviceType: 'interval',
            serviceTime: l.name.startsWith('夜') ? '22:30–次日 05:30' : '05:50–22:30',
            interval: '10–15 分钟',
            stops: { create: rt.codes.map((c, seq) => ({ stopId: stopIds[c], seq: seq + 1 })) },
          })),
        },
      },
    })
  }

  console.log(`已写入示例市：${STOPS.length} 个站点、${LINES.length} 条线路、${LANDMARKS.length} 个地标`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
