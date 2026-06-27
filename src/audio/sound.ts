// Web Audio で合成する効果音＋簡易BGM（#10）。依存なし・完全ローカル・音源ファイル不要。
// AudioContext はユーザー操作（ボタン）で resume する。SSR/テスト環境では何もしない。

export type SfxKind = 'fire' | 'select' | 'hit' | 'enemyHit' | 'orbit' | 'misfire' | 'clear' | 'gameover'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let muted = false
let musicOn = false
let musicTimer: ReturnType<typeof setInterval> | null = null
let step = 0

const VOL = 0.5

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = VOL
    master.connect(ctx.destination)
  }
  return ctx
}

/** ユーザー操作時に呼ぶ：suspended なコンテキストを再開する。 */
export function ensureAudio(): void {
  const c = ac()
  if (c && c.state === 'suspended') void c.resume()
}

export function isMuted(): boolean {
  return muted
}
export function setMuted(m: boolean): void {
  muted = m
  if (master) master.gain.value = m ? 0 : VOL
}
export function toggleMuted(): boolean {
  setMuted(!muted)
  return muted
}

/** 1音（任意波形・音量・ピッチグライド）。 */
function tone(freq: number, t0: number, dur: number, type: OscillatorType, vol: number, glideTo?: number): void {
  const c = ac()
  if (!c || !master) return
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g)
  g.connect(master)
  o.start(t0)
  o.stop(t0 + dur + 0.03)
}

/** ノイズ（暴発用）。 */
function noise(t0: number, dur: number, vol: number): void {
  const c = ac()
  if (!c || !master) return
  const n = Math.floor(c.sampleRate * dur)
  const buf = c.createBuffer(1, n, c.sampleRate)
  const data = buf.getChannelData(0)
  // 決定的な擬似ノイズ（Math.random を避ける必要はないがテンポよく）
  let s = 1234.5
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647
    data[i] = ((s / 2147483647) * 2 - 1) * (1 - i / n)
  }
  const src = c.createBufferSource()
  const g = c.createGain()
  src.buffer = buf
  g.gain.setValueAtTime(vol, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(g)
  g.connect(master)
  src.start(t0)
}

/** 効果音を鳴らす。 */
export function playSfx(kind: SfxKind): void {
  if (muted) return
  const c = ac()
  if (!c) return
  const t = c.currentTime
  switch (kind) {
    case 'fire':
      tone(680, t, 0.16, 'square', 0.16, 240)
      break
    case 'select':
      tone(880, t, 0.05, 'square', 0.1)
      break
    case 'hit':
      tone(990, t, 0.12, 'triangle', 0.2, 1480)
      tone(1320, t + 0.02, 0.09, 'square', 0.1)
      break
    case 'enemyHit':
      tone(180, t, 0.2, 'sawtooth', 0.2, 70)
      break
    case 'orbit':
      tone(440, t, 0.34, 'sine', 0.13, 700)
      break
    case 'misfire':
      noise(t, 0.32, 0.22)
      tone(120, t, 0.32, 'sawtooth', 0.16, 40)
      break
    case 'clear':
      ;[523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.1, 0.18, 'square', 0.18))
      break
    case 'gameover':
      ;[392, 330, 262, 196].forEach((f, i) => tone(f, t + i * 0.18, 0.3, 'square', 0.16))
      break
  }
}

// --- 簡易BGM（神秘的なペンタトニックのループ） ---
const MELODY = [262, 0, 311, 349, 0, 392, 349, 311, 262, 0, 233, 262, 0, 311, 0, 196]

export function startMusic(): void {
  musicOn = true
  if (musicTimer != null) return
  const c = ac()
  if (!c) return
  musicTimer = setInterval(() => {
    if (!musicOn || muted) return
    const cc = ac()
    if (!cc) return
    const t = cc.currentTime + 0.05
    const note = MELODY[step % MELODY.length]
    if (note > 0) tone(note, t, 0.22, 'triangle', 0.06)
    if (step % 4 === 0 && note > 0) tone(note / 2, t, 0.5, 'sine', 0.05)
    step++
  }, 240)
}

export function stopMusic(): void {
  musicOn = false
  if (musicTimer != null) {
    clearInterval(musicTimer)
    musicTimer = null
  }
}
