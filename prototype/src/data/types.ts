// PROTOTYPE — 原型用的内存数据形状，不代表正式数据库设计

export type Direction = '东' | '南' | '西' | '北' | '无' | '场站'

export interface Stop {
  id: string
  name: string
  direction: Direction
  nameEn: string
  x: number // 示意地图坐标
  y: number
  lng: number
  lat: number
  city: string
  district: string
  street: string
  road: string
  maintainer: string
  remark: string
  qrUrl: string
  landmarkIds: string[]
  facilities: {
    berths: number | null
    platformType: string
    safety: string
    waiting: string
    shelterType: string
    bigLightbox: number | null
    smallLightbox: number | null
    seats: number | null
  }
  photos: number
  updatedAt: string
  deleted?: boolean
}

export type LineMode = '单向' | '双边' | '单环' | '双环'
export type RouteKind = '上行' | '下行' | '内环' | '外环' | '单向' | '环线'

export interface Route {
  id: string
  kind: RouteKind
  stopIds: string[]
  serviceType: '发车间隔' | '定时班车'
  serviceTime: string
  interval: string
}

export interface Line {
  id: string
  name: string
  number: string
  nameEn: string
  mode: LineMode
  status: '运营' | '停运'
  company: string
  ticket: '无人售票' | '有人售票'
  fareSystem: string
  fare: string
  routes: Route[]
  updatedAt: string
}

export type BoardFace = '正面' | '背面' | 'A面' | 'B面' | 'C面' | 'D面' | 'E面' | 'F面'

export interface Slot {
  id: string
  no: number
  kind: '线路' | '非线路'
  note: string
  w: number
  h: number
}

export interface Board {
  id: string
  no: number
  face: BoardFace
  kind: '整版' | '分片'
  w: number
  h: number
  remark: string
  slots: Slot[]
}

export interface Shelf {
  id: string
  no: number
  type: string
  name: string
  desc: string
  noPhysical: boolean
  material: string
  boards: Board[]
}

export type Placement =
  | { type: 'board'; boardId: string; order: number }
  | { type: 'slot'; slotId: string }
  | { type: 'hidden' }

export interface Schedule {
  id: string
  routeId: string
  nth: number
  place: Placement
  // 线路不再经过时用于显示失效编排
  lineName: string
  kind: RouteKind
}

export interface SignSet {
  stopId: string
  reminder: string
  shelves: Shelf[]
  schedules: Schedule[]
}

export interface ShelfTemplate {
  id: string
  name: string
  type: string
  desc: string
  noPhysical: boolean
  boards: (Omit<Board, 'id' | 'no' | 'slots'> & { slots: Omit<Slot, 'id'>[] })[]
}

export interface Landmark {
  id: string
  name: string
  category: string
  x: number
  y: number
  radius: number
}

export interface SnapshotEntry {
  id: number
  objType: '站点' | '线路' | '站牌集'
  objId: string
  objName: string
  action: '新增' | '修改' | '删除' | '连带修改'
  at: string
  summary: string
}
