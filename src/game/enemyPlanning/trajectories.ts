// 敵の得意関数（family）から候補軌道を組み立てるヘルパー（#17/#46）。純粋関数。
// enemyAI.ts（攻撃計画）と ruptorPlanner.ts（暴発計画）が共有する。
import type { EnemyFamily, Flight, Trajectory, Vec2, ZField } from '../types'
import { sampleTrajectory, validPrefix } from '../coords'
import { simulatePath } from '../physics'
import { zfieldAt } from '../attribute'
import { DEFAULT_FIT_COMPLEXITY, maxEnumPolyDegree, type FitComplexity } from './fitComplexity'

/**
 * 迂回型（attacker の avoider 運用）・暴発型（ruptor）が使える family（#46・05b §2）。
 * V字・放物線・高次曲線は「一度大きく曲がって戻る」制御がしやすく、狙った隙間を安定して抜けられる。
 * wave（周期蛇行）/exp（単調急伸）/spiral/line はこの集合に含めない＝これらのパターンでは決して選ばれない。
 */
export const AVOIDER_FAMILIES: readonly EnemyFamily[] = ['abs', 'arc', 'poly34']

/**
 * 経路フィットに使える family（#69）。AVOIDER_FAMILIES に **harmonic（多重サイン）** を足した集合。
 * harmonic は「複数のサイン波の重ね合わせ」で、通過点を厳密に通しながら何度もうねる軌道を作れる
 * ＝人間が手で係数を合わせるのは現実的でない高難度の系統。ステージ側で明示的に付与した敵だけが使う
 * （enemy.families に 'harmonic' を含める）。
 */
export const ELITE_FIT_FAMILIES: readonly EnemyFamily[] = ['abs', 'arc', 'poly34', 'harmonic']

/** exp 系統の指数の伸び係数（#43：終盤で鋭く跳ね上がる）。 */
const EXP_K = 0.13
/** poly34 系統の 3 次曲線の零点調整（g(x)=shape·(x³−POLY_C·x)＝±√POLY_C で軸を跨ぐ S 字）。 */
const POLY_C = 140
/** poly34 の 5 次項の零点調整（g(x)=shape·(x⁵−POLY_C5·x³)：より多くのこぶを作る・#46）。 */
const POLY_C5 = 700
/** abs 系統の折れ点 h（#46）：目標までの距離に対する割合（0.5＝中間で V 字に折れる）。 */
export const ABS_H_RATIO = 0.5

/**
 * harmonic 系統（#69）：3本のサイン波の重ね合わせ。
 * 角周波数は互いに整数比でない（＝合成波が周期的に繰り返さない）値を選び、
 * 「どこで、どちらへ、どれだけ曲がるか」が一目では読めないうねり方にする。
 * g(x) = shape · Σ aᵢ·sin(ωᵢ·x + φᵢ)
 */
const HARMONIC_TERMS: { w: number; a: number; phase: number }[] = [
  { w: 0.17, a: 1.0, phase: 0 },
  { w: 0.29, a: 0.55, phase: 1.1 },
  { w: 0.47, a: 0.3, phase: 2.3 },
]

/** harmonic の合成波（位相全体を phaseShift だけずらせる＝同じ形の別バリエーション）。 */
function harmonicG(shape: number, phaseShift = 0): (x: number) => number {
  return (x) => shape * HARMONIC_TERMS.reduce((s, t) => s + t.a * Math.sin(t.w * x + t.phase + phaseShift), 0)
}

/**
 * poly34 の 1 つの形状候補（次数と係数のペア・#46）。3〜5次を同じ枠組みで扱う。
 * deg=3：x³−POLY_C·x（S 字）／deg=4：x⁴−POLY_C·x²（W 字＝谷ふたつ）／deg=5：x⁵−POLY_C5·x³（こぶ多め）。
 */
interface PolyShape {
  deg: 3 | 4 | 5
  shape: number
}
const POLY34_SHAPES: PolyShape[] = [
  { deg: 3, shape: -0.004 },
  { deg: 3, shape: -0.002 },
  { deg: 3, shape: 0.002 },
  { deg: 3, shape: 0.004 },
  { deg: 4, shape: -0.00018 },
  { deg: 4, shape: 0.00018 },
  { deg: 5, shape: -0.000012 },
  { deg: 5, shape: 0.000012 },
]

/** poly34 の次数別 g(x)（#46：3〜5次）。 */
function polyG(deg: 3 | 4 | 5, shape: number): (x: number) => number {
  switch (deg) {
    case 3:
      return (x) => shape * (x * x * x - POLY_C * x)
    case 4:
      return (x) => shape * (x * x * x * x - POLY_C * x * x)
    case 5:
      return (x) => shape * (x * x * x * x * x - POLY_C5 * x * x * x)
  }
}

/** 敵位置 from から to を向く基準角。 */
export function aimAt(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

/**
 * family＋狙い角＋形状係数から敵の軌道を組み立てる（origin=敵位置・z 場つき）。
 * hFold は abs（折れ）の折れ点 h（ローカル x）。未指定は SAMPLING の代表距離を使う（既定 20）。
 */
export function buildEnemyTrajectory(
  family: EnemyFamily,
  origin: Vec2,
  angle: number,
  shape: number,
  z: ZField,
  hFold = 20,
  polyDeg: 3 | 4 | 5 = 3,
  fieldR?: number,
): Trajectory {
  switch (family) {
    case 'line':
      return { mode: 'rotate', g: () => 0, angle, origin, z, fieldR }
    case 'arc':
      // 緩い放物の弧（左右に曲がる）
      return { mode: 'rotate', g: (x) => shape * x * x, angle, origin, z, fieldR }
    case 'wave':
      // 波打って進む（shape=振幅）
      return { mode: 'rotate', g: (x) => shape * Math.sin(0.45 * x), angle, origin, z, fieldR }
    case 'spiral':
      // 渦巻き（shape=巻きの強さ）。狙い角ぶん回す
      return { mode: 'polar', f: (t) => shape * (t + angle), origin, z, fieldR }
    case 'exp':
      // 指数（#43）：序盤はほぼ直進し、終盤で鋭く横へ跳ね上がる
      return { mode: 'rotate', g: (x) => shape * (Math.exp(EXP_K * x) - 1), angle, origin, z, fieldR }
    case 'poly34':
      // 3〜5次（#43/#46）：S字・こぶを作る高自由度の捻れ曲線
      return { mode: 'rotate', g: polyG(polyDeg, shape), angle, origin, z, fieldR }
    case 'abs':
      // 折れ（#46）：g(x)=shape·|x−h|。折れ点 h で V 字に鋭く曲がる
      return { mode: 'rotate', g: (x) => shape * Math.abs(x - hFold), angle, origin, z, fieldR }
    case 'harmonic':
      // 多重サイン（#69）：3本のサイン波の重ね合わせ。繰り返さないうねりで隙間を縫う
      return { mode: 'rotate', g: harmonicG(shape), angle, origin, z, fieldR }
  }
}

/** family ごとの形状係数候補（poly34 の 4/5 次は POLY34_SHAPES で別扱い）。 */
export function shapeCandidates(family: EnemyFamily): number[] {
  switch (family) {
    case 'line':
      return [0]
    case 'arc':
      return [-0.09, -0.04, 0.04, 0.09]
    case 'wave':
      return [1.5, 3]
    case 'spiral':
      return [0.7, 1.1]
    case 'exp':
      return [-0.8, -0.35, 0.35, 0.8]
    case 'poly34':
      // 3 次分（4/5 次は familyTrajectories が POLY34_SHAPES から別途展開する）
      return [-0.004, -0.002, 0.002, 0.004]
    case 'abs':
      // 折れの傾き（V字の開き）。左右どちらへも折れられるよう正負を用意
      return [-0.9, -0.45, 0.45, 0.9]
    case 'harmonic':
      // 合成波の振幅（#69）。大きいほど深くうねって遠くの隙間まで回り込める
      return [-5, -2.5, 2.5, 5]
  }
}

/**
 * family の全形状候補を「基準角＋オフセット」で展開した軌道群を返す（#46：poly34 の 3〜5 次・
 * abs の折れ点 h を含めてここで一元化する）。spiral は狙い角オフセットを取らない。
 * hFold は abs の折れ点（対象までのローカル距離 × ABS_H_RATIO を呼び出し側が渡す）。
 */
export function familyTrajectories(
  family: EnemyFamily,
  origin: Vec2,
  baseAngle: number,
  z: ZField,
  hFold: number,
  fieldR?: number,
  complexity: FitComplexity = DEFAULT_FIT_COMPLEXITY,
): Trajectory[] {
  const offsets = family === 'spiral' ? [0] : [-0.28, -0.14, 0, 0.14, 0.28]
  const out: Trajectory[] = []
  // 決め打ちパレットも敵の強さで絞る（#70）：低 LVL の個体は 4/5 次の捻れを持ち出せない
  const maxDeg = maxEnumPolyDegree(complexity)
  for (const off of offsets) {
    const angle = baseAngle + off
    if (family === 'poly34') {
      // 3〜5 次を次数ごとに展開（05b §2）
      for (const ps of POLY34_SHAPES) {
        if (ps.deg > maxDeg) continue
        out.push({ mode: 'rotate', g: polyG(ps.deg, ps.shape), angle, origin, z, fieldR })
      }
      continue
    }
    if (family === 'harmonic') {
      // 振幅 × 位相ずらしを展開（#69）：同じ合成波を前後にずらして山谷の位置を変える
      for (const shape of shapeCandidates('harmonic')) {
        for (const ph of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          out.push({ mode: 'rotate', g: harmonicG(shape, ph), angle, origin, z, fieldR })
        }
      }
      continue
    }
    for (const shape of shapeCandidates(family)) {
      out.push(buildEnemyTrajectory(family, origin, angle, shape, z, hFold, 3, fieldR))
    }
  }
  return out
}

/** 敵の軌道から path と飛行を作る（z は軌道の z 場を位置で評価・#28）。 */
export function enemyFlight(traj: Trajectory, speed: number): { path: Vec2[]; flight: Flight } {
  const path = validPrefix(sampleTrajectory(traj)).map((s) => s.pos)
  const flight = simulatePath(path, speed, (i) => zfieldAt(traj, path[Math.min(i, path.length - 1)]))
  return { path, flight }
}
