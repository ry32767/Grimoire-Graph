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
  },
  { number: 'number' },
)

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
