// guessShelfForm 的用例表：名称 + 引用它的站架上用到的面 → 形式与关键参数。
// 共享包测试核对 TypeScript，后端迁移测试用同一张表核对迁移 SQL（M7 计划 3.3 节）
// 不 import 共享包：后端测试也直接引用这个文件
type Face = 'front' | 'back' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export interface GuessCase {
  name: string
  faces: Face[]
  form: string
  params?: Record<string, unknown>
}

export const GUESS_CASES: GuessCase[] = [
  { name: '候车亭灯箱', faces: ['front'], form: 'shelter', params: { sides: 1, mount: 'back' } },
  { name: '候车亭端板', faces: ['front', 'back'], form: 'shelter', params: { sides: 2, mount: 'end' } },
  { name: '港湾雨棚', faces: [], form: 'shelter', params: { sides: 1 } },
  { name: '书报亭附杆', faces: [], form: 'shelter', params: { sides: 1 } },
  { name: '三面图腾柱', faces: ['A', 'B'], form: 'totem', params: { faces: 3 } },
  { name: '多面导向柱', faces: ['A', 'B', 'C', 'D', 'E'], form: 'totem', params: { faces: 5 } },
  { name: '图腾柱4', faces: [], form: 'totem', params: { faces: 4 } },
  { name: '六面柱', faces: ['A'], form: 'totem', params: { faces: 6 } },
  { name: '电子站牌立杆', faces: ['front'], form: 'ePost', params: { sides: 1 } },
  { name: '电子双面站牌', faces: [], form: 'ePost', params: { sides: 2 } },
  { name: '挂墙站牌', faces: ['front', 'back'], form: 'attached', params: { sides: 1, host: 'wall' } },
  { name: '路灯挂杆牌', faces: ['back'], form: 'attached', params: { sides: 2, host: 'pole' } },
  { name: '附着式', faces: [], form: 'attached', params: { sides: 1, host: 'wall' } },
  { name: '单立柱站架', faces: ['front'], form: 'singlePost', params: { sides: 1 } },
  { name: '单杆双面', faces: [], form: 'singlePost', params: { sides: 2 } },
  { name: '双立柱站架', faces: ['front', 'back'], form: 'doublePost', params: { sides: 2 } },
  { name: '普通站架', faces: [], form: 'doublePost', params: { sides: 1 } },
]
