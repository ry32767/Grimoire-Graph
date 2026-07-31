#!/usr/bin/env node
// 自動復帰ウォッチドッグ
// ------------------------------------------------------------------
// 5時間の利用上限などで Claude Code のセッションが止まったとき、
// 制限が解除されたあとに `claude -c -p <prompt>` で自動的に作業を再開させる。
//
// 心拍（生きているか）の判定は Claude Code が書き続けるセッション transcript
// (~/.claude/projects/<slug>/*.jsonl) の mtime を使う。フック設定は不要。
//
// 使い方:
//   node watchdog.mjs --transcripts <dir> --project <dir> --prompt-file <md>
//                     [--stall 12] [--poll 60] [--deadline 2026-08-02T14:00]
//                     [--log <file>] [--state <file>] [--stop-file <file>]
//                     [--once] [--exec "<self-test用の代替コマンド>"]
//
// 停止方法: --stop-file で指定したファイルを作る（既定 stop-autoresume）。
// ------------------------------------------------------------------
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const opts = parseArgs(process.argv.slice(2))

const project = path.resolve(opts['project'] ?? process.cwd())

const CFG = {
  transcripts: opts['transcripts'] ?? transcriptDirFor(project),
  project,
  promptFile: opts['prompt-file'] ?? '',
  prompt: opts['prompt'] ?? '',
  stallMin: num(opts['stall'], 12), // 何分 transcript が更新されなければ「止まった」とみなすか
  pollSec: num(opts['poll'], 60),
  deadline: opts['deadline'] ? new Date(opts['deadline']) : null,
  log: opts['log'] ?? path.join(os.tmpdir(), 'autoresume.log'),
  state: opts['state'] ?? '',
  stopFile: opts['stop-file'] ?? '',
  once: 'once' in opts,
  exec: opts['exec'] ?? '', // 自己テスト用：claude の代わりにこのコマンドを実行する
  claudeBin: opts['claude-bin'] ?? defaultClaudeBin(),
  maxResumes: num(opts['max-resumes'], 200),
}

if (!CFG.transcripts && !CFG.exec) fail('--transcripts が必要です')

let resumeCount = 0
let backoffMin = 0 // 利用上限を検出したときの待ち時間
let nextAttemptAt = 0 // epoch ms。これ以前は再開しない

log(`[start] pid=${process.pid} stall=${CFG.stallMin}min poll=${CFG.pollSec}s ` +
    `deadline=${CFG.deadline ? CFG.deadline.toISOString() : 'none'} exec=${CFG.exec ? 'TEST' : 'claude'}`)

await mainLoop()

async function mainLoop() {
  for (;;) {
    const now = Date.now()

    if (CFG.stopFile && fs.existsSync(CFG.stopFile)) {
      log('[stop] stop-file を検出したので終了します')
      writeState({ status: 'stopped' })
      process.exit(0)
    }
    if (CFG.deadline && now > CFG.deadline.getTime()) {
      log('[stop] deadline を過ぎたので終了します')
      writeState({ status: 'deadline' })
      process.exit(0)
    }

    const last = newestMtime(CFG.transcripts)
    const idleMin = last ? (now - last) / 60000 : Infinity
    const waiting = nextAttemptAt > now ? Math.ceil((nextAttemptAt - now) / 60000) : 0

    writeState({
      status: waiting ? 'backoff' : 'watching',
      idleMinutes: Number.isFinite(idleMin) ? +idleMin.toFixed(2) : null,
      lastTranscriptAt: last ? new Date(last).toISOString() : null,
      resumeCount,
      nextAttemptAt: nextAttemptAt ? new Date(nextAttemptAt).toISOString() : null,
      checkedAt: new Date().toISOString(),
    })

    if (idleMin >= CFG.stallMin && now >= nextAttemptAt && resumeCount < CFG.maxResumes) {
      resumeCount++
      log(`[resume#${resumeCount}] transcript が ${idleMin.toFixed(1)} 分更新されていないので再開します`)
      writeState({ status: 'resuming', resumeCount, startedAt: new Date().toISOString() })

      const started = Date.now()
      const { code, out } = await runResume()
      const durSec = Math.round((Date.now() - started) / 1000)
      const tail = out.slice(-1500).replace(/\r/g, '')
      log(`[resume#${resumeCount}] exit=${code} ${durSec}s\n${indent(tail)}`)

      const limit = detectLimit(out)
      if (limit) {
        // 利用上限に当たった → 解除時刻まで待って自動で再挑戦する
        if (limit.resetAt) {
          nextAttemptAt = limit.resetAt + 90_000
          log(`[limit] 利用上限を検出。解除予定 ${new Date(limit.resetAt).toLocaleString()} まで待機します`)
        } else {
          backoffMin = backoffMin ? Math.min(backoffMin * 2, 30) : 10
          nextAttemptAt = Date.now() + backoffMin * 60_000
          log(`[limit] 利用上限を検出（解除時刻不明）。${backoffMin} 分後に再挑戦します`)
        }
      } else {
        backoffMin = 0
        nextAttemptAt = 0
      }

      if (CFG.once) {
        log('[stop] --once 指定のため終了します')
        writeState({ status: 'done-once', resumeCount })
        process.exit(0)
      }
    }

    await sleep(CFG.pollSec * 1000)
  }
}

// --- 再開の実行 ------------------------------------------------------
function runResume() {
  return new Promise((resolve) => {
    let child
    try {
      if (CFG.exec) {
        child = spawn(CFG.exec, { shell: true, cwd: CFG.project })
      } else {
        const prompt = CFG.prompt || (CFG.promptFile ? fs.readFileSync(CFG.promptFile, 'utf8') : '作業を再開してください。')
        // 権限は普段のセッションと同じ（settings.json の defaultMode）を使う。
        // bypassPermissions は付けない：無人実行でも危険な操作は普段どおり止まる。
        child = spawn(CFG.claudeBin, ['-c', '-p', prompt],
          { cwd: CFG.project, stdio: ['ignore', 'pipe', 'pipe'] })
      }
    } catch (e) {
      return resolve({ code: -1, out: `spawn error: ${e}` })
    }
    let out = ''
    const cap = (d) => { out += d.toString(); if (out.length > 200_000) out = out.slice(-100_000) }
    child.stdout?.on('data', cap)
    child.stderr?.on('data', cap)
    child.on('error', (e) => resolve({ code: -1, out: out + `\nspawn error: ${e}` }))
    child.on('close', (code) => resolve({ code, out }))
  })
}

// 利用上限メッセージの検出。可能なら解除時刻(epoch)も取り出す。
// 例: "Claude AI usage limit reached|1754035200"
function detectLimit(out) {
  if (!/usage limit|rate.?limit|limit reached|利用上限|上限に達し/i.test(out)) return null
  const m = out.match(/(?:limit reached|limit_reached|resets? at)\D{0,20}(\d{10,13})/i)
  if (m) {
    let v = Number(m[1])
    if (v < 1e12) v *= 1000 // 秒 → ミリ秒
    if (v > Date.now()) return { resetAt: v }
  }
  return { resetAt: null }
}

// --- ユーティリティ --------------------------------------------------
function newestMtime(dir) {
  try {
    let newest = 0
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const st = fs.statSync(path.join(dir, f))
      if (st.mtimeMs > newest) newest = st.mtimeMs
    }
    return newest || null
  } catch { return null }
}

function writeState(extra) {
  if (!CFG.state) return
  try {
    fs.writeFileSync(CFG.state, JSON.stringify({ pid: process.pid, ...extra }, null, 2))
  } catch { /* 状態ファイルは書けなくても致命ではない */ }
}

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`
  process.stdout.write(line)
  try { fs.appendFileSync(CFG.log, line) } catch { /* noop */ }
}

function indent(s) { return s.split('\n').map((l) => '    ' + l).join('\n') }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d }
function fail(m) { console.error(m); process.exit(2) }

// Claude Code のセッション transcript 置き場（プロジェクトパスから機械的に決まる）
// 例: C:\Users\me\WorkSpace\My Proj -> ~/.claude/projects/C--Users-me-WorkSpace-My-Proj
function transcriptDirFor(projectPath) {
  const slug = projectPath.replace(/[:\\/\s]/g, '-')
  return path.join(os.homedir(), '.claude', 'projects', slug)
}

function defaultClaudeBin() {
  const home = os.homedir()
  const cands = [
    path.join(home, '.local', 'bin', 'claude.exe'),
    path.join(home, '.local', 'bin', 'claude'),
  ]
  for (const c of cands) if (fs.existsSync(c)) return c
  return 'claude'
}

function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) o[key] = true
    else { o[key] = next; i++ }
  }
  return o
}
