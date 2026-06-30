// 自由入力式の安全な評価基盤（mathjs の限定インスタンス＋コンパイルキャッシュ）。
//
// 方針（安全性・性能）：
// - フル mathjs を読み込まず、必要な関数・定数だけの限定インスタンスを作る
//   （import/createUnit など想定外機能への到達を構造的に排除し、バンドルも縮める）。
// - 式文字列→コンパイル結果を Map でキャッシュ（同じ式の再コンパイルを避ける）。
// - パース木を走査し、許可ノード以外（代入・複文・添字など）と未知シンボルを静的に弾く。
//   → 「式が不正（直前の関数を維持）」と「式は正当だが入力で発散（暴発）」を明確に分離する。
import {
  create,
  addDependencies,
  subtractDependencies,
  multiplyDependencies,
  divideDependencies,
  modDependencies,
  powDependencies,
  unaryMinusDependencies,
  unaryPlusDependencies,
  sinDependencies,
  cosDependencies,
  tanDependencies,
  asinDependencies,
  acosDependencies,
  atanDependencies,
  sqrtDependencies,
  cbrtDependencies,
  expDependencies,
  absDependencies,
  logDependencies,
  log10Dependencies,
  log2Dependencies,
  signDependencies,
  minDependencies,
  maxDependencies,
  floorDependencies,
  ceilDependencies,
  roundDependencies,
  hypotDependencies,
  piDependencies,
  eDependencies,
  tauDependencies,
  parseDependencies,
  compileDependencies,
  ConstantNodeDependencies,
  SymbolNodeDependencies,
  type MathNode,
} from 'mathjs'

// number 限定（BigNumber/Complex/行列を排し、評価結果は常に number か例外）。
const math = create(
  {
    ...addDependencies,
    ...subtractDependencies,
    ...multiplyDependencies,
    ...divideDependencies,
    ...modDependencies,
    ...powDependencies,
    ...unaryMinusDependencies,
    ...unaryPlusDependencies,
    ...sinDependencies,
    ...cosDependencies,
    ...tanDependencies,
    ...asinDependencies,
    ...acosDependencies,
    ...atanDependencies,
    ...sqrtDependencies,
    ...cbrtDependencies,
    ...expDependencies,
    ...absDependencies,
    ...logDependencies,
    ...log10Dependencies,
    ...log2Dependencies,
    ...signDependencies,
    ...minDependencies,
    ...maxDependencies,
    ...floorDependencies,
    ...ceilDependencies,
    ...roundDependencies,
    ...hypotDependencies,
    ...piDependencies,
    ...eDependencies,
    ...tauDependencies,
    ...parseDependencies,
    ...compileDependencies,
    ...ConstantNodeDependencies,
    ...SymbolNodeDependencies,
  },
  { number: 'number' },
)

/** mathjs ノードのコンストラクタ（限定インスタンス由来）。式の係数化に使う。 */
const ConstantNode = math.ConstantNode
const SymbolNode = math.SymbolNode

/** 式から参照してよい定数（変数チェックで許可する）。 */
const CONSTANTS = new Set(['pi', 'e', 'tau'])

/** パース木で許可するノード種別（代入・複文・添字・オブジェクト等は拒否）。 */
const ALLOWED_NODES = new Set([
  'ConstantNode',
  'SymbolNode',
  'OperatorNode',
  'ParenthesisNode',
  'FunctionNode',
])

/** コンパイル済み式：自由変数の集合と、スコープを与えて評価する関数。 */
export interface CompiledExpr {
  /** 式に現れる自由変数名（関数名・定数は含まない） */
  vars: Set<string>
  /** scope（{x:..} など）を渡して評価。結果は number とは限らない（呼び側で検査） */
  evalWith: (scope: Record<string, number>) => unknown
}

// 式文字列→結果のキャッシュ（null=不正式も記憶し再パースを避ける）。
const cache = new Map<string, CompiledExpr | null>()
const CACHE_MAX = 256

/**
 * パース木を走査して自由変数を集める。許可外ノードがあれば null（不正式）。
 * 関数呼び出しの関数名（FunctionNode.fn）は変数として数えない。
 */
function analyze(root: MathNode): { vars: Set<string> } | null {
  const vars = new Set<string>()
  let ok = true
  root.traverse((node: MathNode, _path: string, parent: MathNode | null) => {
    if (!ok) return
    if (!ALLOWED_NODES.has(node.type)) {
      ok = false
      return
    }
    if (node.type === 'SymbolNode') {
      // 関数呼び出しの関数名は変数扱いしない
      if (parent && parent.type === 'FunctionNode' && (parent as unknown as { fn: MathNode }).fn === node) {
        return
      }
      vars.add((node as unknown as { name: string }).name)
    }
  })
  return ok ? { vars } : null
}

/**
 * 式文字列をコンパイルする（キャッシュつき）。構文エラー・許可外ノードなら null。
 * 変数の許可判定（x/t/x,y か）は呼び側で vars を見て行う。
 */
export function compileExpr(expr: string): CompiledExpr | null {
  const trimmed = expr.trim()
  if (trimmed === '') return null
  const cached = cache.get(trimmed)
  if (cached !== undefined) return cached

  let result: CompiledExpr | null = null
  try {
    const node = math.parse(trimmed)
    const info = analyze(node)
    if (info) {
      const code = node.compile()
      result = {
        vars: info.vars,
        evalWith: (scope) => code.evaluate(scope),
      }
    }
  } catch {
    result = null
  }

  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(trimmed, result)
  return result
}

/** 自由変数が「許可変数＋定数」の範囲に収まっているか。 */
export function varsAllowed(vars: Set<string>, allowedVars: readonly string[]): boolean {
  for (const v of vars) {
    if (!allowedVars.includes(v) && !CONSTANTS.has(v)) return false
  }
  return true
}

// ===== 式の係数化（数値リテラル→可変パラメータ・係数スライダー／フィット用） =====

/** OperatorNode の op を安全に取り出す（型のための薄いヘルパー）。 */
function opOf(node: MathNode): string | undefined {
  return node.type === 'OperatorNode' ? (node as unknown as { op: string }).op : undefined
}

/**
 * 式中の数値リテラルを可変パラメータ `p0,p1,…` に置き換えたテンプレートと、その元の値を返す。
 * 例: `2*sin(0.6*x)+1` → template `p0 * sin(p1 * x) + p2`、originals `[2, 0.6, 1]`。
 * べき指数（`x^2` の 2 など）は非整数化で複素数（暴発）になりやすいので係数化しない。
 * 構文エラー・許可外ノードなら null。数値リテラルが無ければ originals は空。
 */
export function parametrizeConstants(expr: string): { template: string; originals: number[] } | null {
  const trimmed = expr.trim()
  if (trimmed === '') return null
  let node: MathNode
  try {
    node = math.parse(trimmed)
  } catch {
    return null
  }
  if (!analyze(node)) return null
  // べき指数の位置にある定数（`^` の右側）は係数化から除外する
  const exponentConsts = new Set<MathNode>()
  node.traverse((n: MathNode, _path: string, parent: MathNode | null) => {
    if (parent && opOf(parent) === '^') {
      const args = (parent as unknown as { args: MathNode[] }).args
      if (args && args[1] === n && n.type === 'ConstantNode') exponentConsts.add(n)
    }
  })
  const originals: number[] = []
  const template = node.transform((n: MathNode) => {
    if (
      n.type === 'ConstantNode' &&
      typeof (n as unknown as { value: unknown }).value === 'number' &&
      !exponentConsts.has(n)
    ) {
      const idx = originals.length
      originals.push((n as unknown as { value: number }).value)
      return new SymbolNode(`p${idx}`)
    }
    return n
  })
  return { template: template.toString(), originals }
}

/** テンプレートの `p0,p1,…` を数値に戻して式文字列にする（係数値→自由入力式）。 */
export function substituteParams(template: string, values: number[]): string | null {
  let node: MathNode
  try {
    node = math.parse(template)
  } catch {
    return null
  }
  const out = node.transform((n: MathNode) => {
    if (n.type === 'SymbolNode') {
      const m = /^p(\d+)$/.exec((n as unknown as { name: string }).name)
      if (m) {
        const v = values[Number(m[1])]
        if (v !== undefined) return new ConstantNode(Number(v.toFixed(4)))
      }
    }
    return n
  })
  // 負値の `+ -6` / `- -6` を `- 6` / `+ 6` に整える（見た目だけ・評価は不変）
  return out
    .toString()
    .replace(/\+ -/g, '- ')
    .replace(/- -/g, '+ ')
}
