// PROTOTYPE — 虚构的"示例市"数据，站名、线路、坐标均为编造
import type { Direction, Landmark, Line, ShelfTemplate, SignSet, Stop } from './types'

export const MAP_W = 1000
export const MAP_H = 640

export const xyToLngLat = (x: number, y: number) => ({
  lng: +(120.1 + (x / MAP_W) * 0.2).toFixed(6),
  lat: +(30.3 - (y / MAP_H) * 0.1).toFixed(6),
})

export const lngLatToXy = (lng: number, lat: number) => ({
  x: ((lng - 120.1) / 0.2) * MAP_W,
  y: ((30.3 - lat) / 0.1) * MAP_H,
})

// 示意地图上的道路（用于绘图与逆地理编码模拟）
export const ROADS: { name: string; points: [number, number][]; major?: boolean }[] = [
  { name: '解放路', points: [[0, 300], [1000, 300]], major: true },
  { name: '中山路', points: [[0, 160], [1000, 160]] },
  { name: '环城北路', points: [[0, 60], [1000, 60]] },
  { name: '文化路', points: [[0, 420], [1000, 420]] },
  { name: '人民大道', points: [[420, 0], [420, 640]], major: true },
  { name: '建设路', points: [[640, 0], [640, 640]] },
  { name: '学院路', points: [[180, 0], [180, 640]] },
  { name: '科技大道', points: [[700, 0], [1000, 250]] },
  { name: '滨江大道', points: [[0, 540], [260, 525], [520, 520], [760, 512], [1000, 530]], major: true },
]

export const RIVER: [number, number][] = [
  [0, 568], [260, 552], [520, 548], [760, 540], [1000, 558], [1000, 640], [0, 640],
]

export const PARKS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: '中山公园', x: 222, y: 178, w: 150, h: 104 },
  { name: '南湖公园', x: 214, y: 440, w: 140, h: 70 },
]

export const DISTRICTS = ['西城区', '中心区', '东城区'] as const
export const STREETS: Record<string, string[]> = {
  西城区: ['学院街道', '西湖街道'],
  中心区: ['解放街道', '人民街道', '滨江街道'],
  东城区: ['科技城街道', '港湾街道'],
}

export const reverseGeocode = (x: number, y: number) => {
  const district = x < 330 ? '西城区' : x < 700 ? '中心区' : '东城区'
  const street =
    district === '西城区'
      ? y < 300 ? '学院街道' : '西湖街道'
      : district === '中心区'
        ? y < 250 ? '人民街道' : y < 470 ? '解放街道' : '滨江街道'
        : y < 300 ? '科技城街道' : '港湾街道'
  // 最近的道路
  let best = { name: '', d: Infinity }
  for (const r of ROADS) {
    for (let i = 0; i < r.points.length - 1; i++) {
      const d = distToSeg(x, y, r.points[i], r.points[i + 1])
      if (d < best.d) best = { name: r.name, d }
    }
  }
  return { city: '示例市', district, street, road: best.name }
}

function distToSeg(px: number, py: number, a: [number, number], b: [number, number]) {
  const [ax, ay] = a
  const [bx, by] = b
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

type StopSeed = [id: string, name: string, dir: Direction, x: number, y: number, maintainer?: string]

const STOP_SEEDS: StopSeed[] = [
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
  人民广场: 'Renmin Square', 解放路口: 'Jiefang Rd. Junction', 火车站: 'Railway Station', 市民中心: 'Civic Center',
  中山公园: 'Zhongshan Park', 体育中心: 'Sports Center', 学院路口: 'Xueyuan Rd. Junction', 大学城: 'University Town',
  科技园: 'Science Park', 金融中心: 'Financial Center', 会展中心: 'Expo Center', 滨江公园: 'Riverside Park',
  汽车南站: 'South Bus Station', 东方医院: 'Dongfang Hospital', 文化宫: 'Cultural Palace', 实验中学: 'Experimental Middle School',
  港湾路: 'Gangwan Rd.', 北门: 'North Gate', 南湖公园: 'Nanhu Park', 新华书店: 'Xinhua Bookstore', 建设路口: 'Jianshe Rd. Junction',
  环城北路: 'North Ring Rd.', 西站: 'West Station', 软件园: 'Software Park', 梧桐巷: 'Wutong Lane', 市图书馆: 'City Library',
  老街: 'Old Street', 科技大道: 'Keji Ave.', 江景路: 'Jiangjing Rd.',
}

export const LANDMARKS: Landmark[] = [
  { id: 'lm1', name: '中山公园', category: '公园', x: 297, y: 230, radius: 90 },
  { id: 'lm2', name: '市图书馆', category: '文化场馆', x: 345, y: 140, radius: 60 },
  { id: 'lm3', name: '地铁人民广场站', category: '地铁站', x: 425, y: 280, radius: 70 },
  { id: 'lm4', name: '东方医院', category: '医院', x: 670, y: 440, radius: 70 },
  { id: 'lm5', name: '实验中学', category: '学校', x: 520, y: 140, radius: 60 },
  { id: 'lm6', name: '市民中心广场', category: '广场', x: 455, y: 175, radius: 80 },
  { id: 'lm7', name: '会展中心', category: '文化场馆', x: 770, y: 495, radius: 70 },
  { id: 'lm8', name: '火车站东广场', category: '交通枢纽', x: 900, y: 285, radius: 80 },
]

export const landmarkCandidates = (x: number, y: number) =>
  LANDMARKS.filter((l) => Math.hypot(l.x - x, l.y - y) <= l.radius)

export const DICT = {
  shelfType: ['双立柱站架', '单立柱站架', '候车亭灯箱', '电子站牌立杆'],
  maintainer: ['示例公交一公司', '示例公交二公司', '示例市政养护中心'],
  road: ROADS.map((r) => r.name),
  platformType: ['港湾式', '直线式', '岛式'],
  safety: ['护栏', '护栏 + 隔离墩', '无'],
  shelterType: ['标准候车亭', '简易雨棚', '无'],
}

export const buildStops = (): Stop[] =>
  STOP_SEEDS.map(([id, name, direction, x, y, maintainer], i) => {
    const geo = reverseGeocode(x, y)
    const { lng, lat } = xyToLngLat(x, y)
    return {
      id,
      name,
      direction,
      nameEn: EN[name] ?? '',
      x,
      y,
      lng,
      lat,
      city: geo.city,
      district: geo.district,
      street: geo.street,
      road: geo.road,
      maintainer: maintainer ?? '示例市政养护中心',
      remark: id === 's01' ? '地铁 2 号线 B 口出站即到' : '',
      qrUrl: '',
      landmarkIds: landmarkCandidates(x, y).slice(0, 2).map((l) => l.id),
      facilities: {
        berths: i % 3 === 0 ? 3 : 2,
        platformType: i % 4 === 0 ? '港湾式' : '直线式',
        safety: i % 5 === 0 ? '护栏 + 隔离墩' : '护栏',
        waiting: i % 2 === 0 ? '座椅 4 个、遮阳棚' : '',
        shelterType: i % 3 === 0 ? '标准候车亭' : '简易雨棚',
        bigLightbox: i % 3 === 0 ? 2 : 0,
        smallLightbox: i % 2 === 0 ? 1 : 0,
        seats: i % 2 === 0 ? 4 : 0,
      },
      photos: i % 4,
      updatedAt: `2026-10-${String(26 - (i % 20)).padStart(2, '0')} ${String(9 + (i % 9)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`,
    }
  })

const r = (id: string, kind: Line['routes'][number]['kind'], stopIds: string) => ({ id, kind, stopIds: stopIds.split(' ') })

type LineSeed = Pick<Line, 'id' | 'name' | 'number' | 'mode' | 'status' | 'company'> & { routes: { id: string; kind: Line['routes'][number]['kind']; stopIds: string[] }[] }

export const buildLines = (): Line[] =>
  LINE_SEEDS.map((l, i) => {
    const night = l.name.startsWith('夜')
    return {
      ...l,
      nameEn: night ? `Night Route ${l.name.replace(/\D/g, '')}` : l.name.startsWith('环') ? `Loop ${l.name.replace(/\D/g, '')}` : l.name === '旅游专线' ? 'Tourist Line' : `Route ${l.name.replace('路', '')}`,
      ticket: '无人售票' as const,
      fareSystem: i % 3 === 0 ? '分段计价' : '一票制',
      fare: i % 3 === 0 ? '2–4 元' : '2 元',
      updatedAt: `2026-10-${String(25 - (i % 18)).padStart(2, '0')} ${String(8 + (i % 10)).padStart(2, '0')}:${String((i * 11) % 60).padStart(2, '0')}`,
      routes: l.routes.map((rt) => ({
        ...rt,
        serviceType: (l.name === 'K12路' ? '定时班车' : '发车间隔') as Line['routes'][number]['serviceType'],
        serviceTime: night ? '22:30–次日 05:30' : l.name.startsWith('K') ? '06:30–21:00' : '05:50–22:30',
        interval: night ? '30 分钟' : l.name === 'K12路' ? '按时刻表' : i % 2 ? '6–10 分钟' : '10–15 分钟',
      })),
    }
  })

const LINE_SEEDS: LineSeed[] = [
  { id: 'L01', name: '1路', number: 'G-0001', mode: '双边', status: '运营', company: '示例公交一公司', routes: [r('L01u', '上行', 's26 s10 s07 s01 s23 s04 s05'), r('L01d', '下行', 's05 s03 s28 s02 s08 s10 s26')] },
  { id: 'L02', name: '2路', number: 'G-0002', mode: '双边', status: '运营', company: '示例公交一公司', routes: [r('L02u', '上行', 's21 s06 s01 s18 s16'), r('L02d', '下行', 's16 s18 s02 s06 s21')] },
  { id: 'L03', name: '10路', number: 'G-0010', mode: '双边', status: '运营', company: '示例公交一公司', routes: [r('L03u', '上行', 's11 s10 s02 s18 s16'), r('L03d', '下行', 's16 s18 s01 s10 s11')] },
  { id: 'L04', name: '101路', number: 'G-0101', mode: '单向', status: '运营', company: '示例公交二公司', routes: [r('L04a', '单向', 's21 s06 s01 s23 s24 s12 s27')] },
  { id: 'L05', name: 'B1路', number: 'B-0001', mode: '双边', status: '运营', company: '示例公交二公司', routes: [r('L05u', '上行', 's26 s30 s29 s01 s19 s13 s25'), r('L05d', '下行', 's25 s13 s19 s02 s29 s30 s26')] },
  { id: 'L06', name: 'K3路', number: 'K-0003', mode: '双边', status: '运营', company: '示例公交二公司', routes: [r('L06u', '上行', 's16 s18 s01 s06 s21'), r('L06d', '下行', 's21 s06 s02 s18 s16')] },
  { id: 'L07', name: 'K12路', number: 'K-0012', mode: '双边', status: '运营', company: '示例公交二公司', routes: [r('L07u', '上行', 's22 s18 s01 s23 s03 s17 s14'), r('L07d', '下行', 's14 s17 s04 s28 s02 s18 s22')] },
  { id: 'L08', name: '环1路', number: 'H-0001', mode: '单环', status: '运营', company: '示例公交一公司', routes: [r('L08a', '环线', 's01 s23 s04 s24 s13 s19 s06 s29 s07 s01')] },
  { id: 'L09', name: '夜1路', number: 'Y-0001', mode: '双边', status: '停运', company: '示例公交一公司', routes: [r('L09u', '上行', 's26 s10 s01 s04 s05'), r('L09d', '下行', 's05 s03 s02 s10 s26')] },
  { id: 'L10', name: '15路', number: 'G-0015', mode: '双边', status: '运营', company: '示例公交一公司', routes: [r('L10u', '上行', 's11 s10 s08 s22 s16'), r('L10d', '下行', 's16 s22 s07 s10 s11')] },
  { id: 'L11', name: '旅游专线', number: 'T-0001', mode: '单向', status: '运营', company: '示例公交二公司', routes: [r('L11a', '单向', 's21 s29 s01 s18 s15 s14 s20')] },
  { id: 'L12', name: '18路', number: 'G-0018', mode: '双边', status: '运营', company: '示例公交二公司', routes: [r('L12u', '上行', 's20 s32 s14 s17 s03 s23 s02 s30'), r('L12d', '下行', 's30 s29 s01 s23 s04 s17 s14 s32 s20')] },
  { id: 'L13', name: '3路', number: 'G-0003', mode: '双边', status: '运营', company: '示例公交一公司', routes: [r('L13u', '上行', 's26 s30 s11'), r('L13d', '下行', 's11 s30 s26')] },
  { id: 'L14', name: '22路', number: 'G-0022', mode: '双边', status: '运营', company: '示例公交二公司', routes: [r('L14u', '上行', 's12 s27 s31 s25 s24'), r('L14d', '下行', 's24 s25 s31 s27 s12')] },
  { id: 'L15', name: '33路', number: 'G-0033', mode: '单环', status: '运营', company: '示例公交二公司', routes: [r('L15a', '环线', 's14 s15 s22 s16 s14')] },
  { id: 'L16', name: '夜2路', number: 'Y-0002', mode: '双边', status: '运营', company: '示例公交二公司', routes: [r('L16u', '上行', 's05 s17 s14 s20'), r('L16d', '下行', 's20 s14 s17 s05')] },
]

export const SHELF_TEMPLATES: ShelfTemplate[] = [
  {
    id: 't1', name: '双立柱 · 双面整版', type: '双立柱站架', desc: '主干道标准站牌', noPhysical: false,
    boards: [
      { face: '正面', kind: '整版', w: 1200, h: 1800, remark: '', slots: [] },
      { face: '背面', kind: '整版', w: 1200, h: 1800, remark: '', slots: [] },
    ],
  },
  {
    id: 't2', name: '候车亭灯箱 · 6 插片', type: '候车亭灯箱', desc: '标准候车亭侧灯箱', noPhysical: false,
    boards: [
      {
        face: '正面', kind: '分片', w: 1500, h: 2000, remark: '',
        slots: [
          ...[1, 2, 3, 4, 5].map((no) => ({ no, kind: '线路' as const, note: '', w: 700, h: 360 })),
          { no: 6, kind: '非线路' as const, note: '公告栏', w: 700, h: 360 },
        ],
      },
    ],
  },
  {
    id: 't3', name: '单立柱 · 单面', type: '单立柱站架', desc: '支路简易站牌', noPhysical: false,
    boards: [{ face: '正面', kind: '整版', w: 600, h: 1200, remark: '', slots: [] }],
  },
]

// 焦点站点"人民广场（东）"的站牌集：覆盖已编排、隐藏、待编排、失效四种状态
export const buildSignSets = (): Record<string, SignSet> => ({
  s01: {
    stopId: 's01',
    reminder: '2026 年 11 月 1 日起，夜1路暂停运营，恢复时间另行通知。',
    shelves: [
      {
        id: 'sh1', no: 1, type: '双立柱站架', name: '主站架', desc: '靠近人行道一侧', noPhysical: false, material: '铝型材 + 钢化玻璃',
        boards: [
          { id: 'b1', no: 1, face: '正面', kind: '整版', w: 1200, h: 1800, remark: '', slots: [] },
          { id: 'b2', no: 2, face: '背面', kind: '整版', w: 1200, h: 1800, remark: '夜班线路', slots: [] },
        ],
      },
      {
        id: 'sh2', no: 2, type: '候车亭灯箱', name: '候车亭', desc: '', noPhysical: false, material: '灯箱',
        boards: [
          {
            id: 'b3', no: 3, face: '正面', kind: '分片', w: 1500, h: 2000, remark: '',
            slots: [
              { id: 'sl1', no: 1, kind: '线路', note: '', w: 700, h: 360 },
              { id: 'sl2', no: 2, kind: '线路', note: '', w: 700, h: 360 },
              { id: 'sl3', no: 3, kind: '线路', note: '', w: 700, h: 360 },
              { id: 'sl4', no: 4, kind: '线路', note: '', w: 700, h: 360 },
              { id: 'sl5', no: 5, kind: '线路', note: '', w: 700, h: 360 },
              { id: 'sl6', no: 6, kind: '非线路', note: '公交公司公告栏', w: 700, h: 360 },
            ],
          },
        ],
      },
      {
        id: 'sh3', no: 3, type: '单立柱站架', name: '路口立杆', desc: '对面路口补充站牌', noPhysical: false, material: '铝板',
        boards: [{ id: 'b4', no: 4, face: '正面', kind: '整版', w: 600, h: 1200, remark: '', slots: [] }],
      },
    ],
    schedules: [
      { id: 'c1', routeId: 'L03d', nth: 1, place: { type: 'board', boardId: 'b1', order: 1 }, lineName: '10路', kind: '下行' },
      { id: 'c2', routeId: 'L02u', nth: 1, place: { type: 'board', boardId: 'b1', order: 2 }, lineName: '2路', kind: '上行' },
      { id: 'c3', routeId: 'L04a', nth: 1, place: { type: 'board', boardId: 'b1', order: 3 }, lineName: '101路', kind: '单向' },
      { id: 'c4', routeId: 'L01u', nth: 1, place: { type: 'board', boardId: 'b1', order: 4 }, lineName: '1路', kind: '上行' },
      { id: 'c5', routeId: 'L09u', nth: 1, place: { type: 'board', boardId: 'b2', order: 1 }, lineName: '夜1路', kind: '上行' },
      { id: 'c6', routeId: 'L10u', nth: 1, place: { type: 'board', boardId: 'b2', order: 2 }, lineName: '15路', kind: '上行' },
      { id: 'c7', routeId: 'L06u', nth: 1, place: { type: 'slot', slotId: 'sl1' }, lineName: 'K3路', kind: '上行' },
      { id: 'c8', routeId: 'L05u', nth: 1, place: { type: 'slot', slotId: 'sl2' }, lineName: 'B1路', kind: '上行' },
      { id: 'c9', routeId: 'L11a', nth: 1, place: { type: 'hidden' }, lineName: '旅游专线', kind: '单向' },
    ],
  },
})

export const emptySignSet = (stopId: string): SignSet => ({ stopId, reminder: '', shelves: [], schedules: [] })
