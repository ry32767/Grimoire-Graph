// 「＋敵を追加」の種族×ティア初期値（#67・docs/11-stage-editor.md §6.1）。
// 05c-bestiary.md のティア表と、実際に src/data/stages.ts で使われている数値を1:1で揃える
// （図鑑の記述だけでなく実装値を転記し、エディタの初期値と本編の見た目・強さがズレないようにする）。
import type { Attribute, Enemy, EnemyFamily, EnemyRole, EnemySpecies, Vec2 } from '../game/types'
import { enemy as buildEnemy } from '../data/stageBuilders'
import { buildCastZField, type ZFieldPreset } from './enemyRules'

/** 種族選択のラベル（05c-bestiary.md §0）。 */
export const SPECIES_LABELS: Record<EnemySpecies, string> = {
  proto: '原型',
  oni: '鋼鬼（火力型）',
  wraith: '亡霊魔術師（迂回型）',
  redWraith: '紅亡霊（暴発型）',
  golem: 'ゴーレム（守護型）',
}
export const SPECIES_LIST: EnemySpecies[] = ['proto', 'oni', 'wraith', 'redWraith', 'golem']

/** 種族×ティアの初期値プリセット。stageBuilders.enemy() へそのまま渡せる形にしている。 */
export interface EnemyTierPreset {
  id: string
  tierLabel: string
  level: number
  defaultName: string
  element: Attribute
  role?: EnemyRole
  family: EnemyFamily
  families?: EnemyFamily[]
  zFieldPreset: ZFieldPreset
  /** sinCos プリセットの極性（未指定は属性から自動判定） */
  zSign?: 1 | -1
  slipThrough?: boolean
  directedAura?: boolean
  alternatingAura?: boolean
  ruptorTarget?: Enemy['ruptorTarget']
  fireEvery?: number
  fireOffset?: number
  /** 未指定は LVL_SCALE から自動算出（stageBuilders.enemy() の既定） */
  hp?: number
  /** 未指定は CAST_SPEED=8（第6面崩し手のみ例外 6.5・06b §2） */
  castInitialSpeed?: number
}

/** 種族ごとのティア表（05c §1〜§4、実装値は stages.ts と一致）。 */
export const SPECIES_TIERS: Record<EnemySpecies, EnemyTierPreset[]> = {
  proto: [
    {
      id: 'proto-1',
      tierLabel: '原型',
      level: 1,
      defaultName: '石像の番人',
      element: 'dark',
      family: 'line',
      zFieldPreset: 'constant',
      hp: 90,
    },
  ],
  oni: [
    {
      id: 'oni-1a',
      tierLabel: 'I',
      level: 3,
      defaultName: '白の祭司',
      element: 'light',
      role: 'breaker',
      family: 'line',
      families: ['arc'],
      zFieldPreset: 'constant',
      hp: 130,
    },
    {
      id: 'oni-1b',
      tierLabel: 'I',
      level: 3,
      defaultName: '黒の祭司',
      element: 'dark',
      role: 'breaker',
      family: 'line',
      families: ['arc'],
      zFieldPreset: 'constant',
      hp: 130,
    },
    {
      id: 'oni-2a',
      tierLabel: 'II',
      level: 4,
      defaultName: '鏡像の衛士（光）',
      element: 'light',
      role: 'breaker',
      family: 'line',
      families: ['exp'],
      zFieldPreset: 'constant',
      hp: 125,
    },
    {
      id: 'oni-2b',
      tierLabel: 'II',
      level: 4,
      defaultName: '鏡像の衛士（闇）',
      element: 'dark',
      role: 'breaker',
      family: 'line',
      families: ['exp'],
      zFieldPreset: 'constant',
      hp: 125,
    },
    {
      id: 'oni-3',
      tierLabel: 'III',
      level: 6,
      defaultName: '守護者の眷属（鋼鬼）',
      element: 'light',
      role: 'breaker',
      family: 'line',
      families: ['arc'],
      zFieldPreset: 'constant',
      hp: 130,
    },
  ],
  wraith: [
    {
      id: 'wraith-1a',
      tierLabel: 'I',
      level: 2,
      defaultName: '回廊の衛士',
      element: 'dark',
      family: 'arc',
      zFieldPreset: 'constant',
      hp: 110,
    },
    {
      id: 'wraith-1b',
      tierLabel: 'I',
      level: 2,
      defaultName: '影の射手',
      element: 'dark',
      family: 'abs',
      zFieldPreset: 'constant',
      hp: 105,
    },
    {
      id: 'wraith-2a',
      tierLabel: 'II',
      level: 2,
      defaultName: '祭壇の影',
      element: 'dark',
      family: 'abs',
      zFieldPreset: 'constant',
      hp: 110,
    },
    {
      id: 'wraith-2b',
      tierLabel: 'II',
      level: 3,
      defaultName: '坑道の弓手',
      element: 'light',
      family: 'abs',
      families: ['arc'],
      zFieldPreset: 'constant',
      hp: 125,
    },
    {
      id: 'wraith-3a',
      tierLabel: 'III',
      level: 5,
      defaultName: '鏡像の射手（闇）',
      element: 'dark',
      family: 'abs',
      families: ['poly34'],
      zFieldPreset: 'sinCos',
      zSign: -1,
      slipThrough: true,
      hp: 120,
    },
    {
      id: 'wraith-3b',
      tierLabel: 'III',
      level: 5,
      defaultName: '鏡像の射手（光）',
      element: 'light',
      family: 'abs',
      families: ['poly34'],
      zFieldPreset: 'sinCos',
      zSign: 1,
      slipThrough: true,
      hp: 120,
    },
    {
      id: 'wraith-4',
      tierLabel: 'IV',
      level: 6,
      defaultName: '守護者の眷属（亡霊魔術師）',
      element: 'dark',
      family: 'abs',
      families: ['poly34'],
      zFieldPreset: 'sinCos',
      zSign: -1,
      slipThrough: true,
      hp: 130,
    },
  ],
  redWraith: [
    {
      id: 'redWraith-1',
      tierLabel: 'I',
      level: 5,
      defaultName: '崩し手（提示個体）',
      element: 'dark',
      role: 'ruptor',
      family: 'arc',
      zFieldPreset: 'constant',
      ruptorTarget: 'obstacles',
      fireEvery: 2,
      fireOffset: 1,
    },
    {
      id: 'redWraith-2a',
      tierLabel: 'II',
      level: 6,
      defaultName: '崩し手・弧',
      element: 'light',
      role: 'ruptor',
      family: 'arc',
      zFieldPreset: 'constant',
      fireEvery: 2,
      fireOffset: 1,
      hp: 175,
      castInitialSpeed: 6.5,
    },
    {
      id: 'redWraith-2b',
      tierLabel: 'II',
      level: 6,
      defaultName: '崩し手・折れ',
      element: 'dark',
      role: 'ruptor',
      family: 'abs',
      zFieldPreset: 'constant',
      fireEvery: 2,
      fireOffset: 0,
      hp: 175,
      castInitialSpeed: 6.5,
    },
    {
      id: 'redWraith-2c',
      tierLabel: 'II',
      level: 6,
      defaultName: '崩し手・捻れ',
      element: 'light',
      role: 'ruptor',
      family: 'poly34',
      zFieldPreset: 'constant',
      fireEvery: 2,
      fireOffset: 0,
      hp: 175,
      castInitialSpeed: 6.5,
    },
  ],
  golem: [
    {
      id: 'golem-1',
      tierLabel: 'I',
      level: 4,
      defaultName: '渦の番兵',
      element: 'dark',
      role: 'guardian',
      family: 'spiral',
      zFieldPreset: 'constant',
      hp: 140,
    },
    {
      id: 'golem-2',
      tierLabel: 'II',
      level: 5,
      defaultName: '鏡守のゴーレム',
      element: 'light',
      role: 'guardian',
      family: 'spiral',
      zFieldPreset: 'constant',
      directedAura: true,
      hp: 160,
    },
    {
      id: 'golem-3',
      tierLabel: 'III',
      level: 6,
      defaultName: '封印の番人',
      element: 'light',
      role: 'guardian',
      family: 'spiral',
      zFieldPreset: 'constant',
      directedAura: true,
      alternatingAura: true,
      hp: 180,
    },
  ],
}

/** ティアプリセット＋配置座標から Enemy を生成する（stageBuilders.enemy() へ委譲・#67 §6.1）。 */
export function createEnemyFromTier(species: EnemySpecies, tier: EnemyTierPreset, pos: Vec2): Enemy {
  const sign: 1 | -1 = tier.zSign ?? (tier.element === 'dark' ? -1 : 1)
  return buildEnemy(tier.defaultName, pos, tier.element, tier.level, tier.family, {
    role: tier.role,
    families: tier.families,
    hp: tier.hp,
    castInitialSpeed: tier.castInitialSpeed,
    castZField: buildCastZField(tier.zFieldPreset, sign, undefined),
    ruptorTarget: tier.ruptorTarget,
    fireEvery: tier.fireEvery,
    fireOffset: tier.fireOffset,
    slipThrough: tier.slipThrough,
    directedAura: tier.directedAura,
    alternatingAura: tier.alternatingAura,
    species,
  })
}
