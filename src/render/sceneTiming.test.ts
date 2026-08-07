import { describe, expect, it } from 'vitest'
import {
  timedOnly,
  ringVisible,
  ringBreakTime,
  deathTime,
  lastEventTime,
  activeDeathIds,
  animationEndTime,
} from './sceneTiming'
import type { DamagePopup } from '../game/types'

describe('sceneTiming', () => {
  it('timedOnly は NaN/Infinity/undefined を落とし、0 は残す', () => {
    const events = [{ t: 0 }, { t: NaN }, { t: Infinity }, { t: -Infinity }, { t: undefined as unknown as number }, { t: 1.5 }]
    expect(timedOnly(events)).toEqual([{ t: 0 }, { t: 1.5 }])
  })

  it('ringVisible は bornBroken: true で false', () => {
    expect(ringVisible({ bornBroken: true })).toBe(false)
    expect(ringVisible({ bornBroken: false })).toBe(true)
    expect(ringVisible({})).toBe(true)
  })

  it('ringBreakTime は「壊れたが breakTime が null」のとき 0 ではなく null を返す', () => {
    expect(ringBreakTime({ broken: true, breakTime: null })).toBeNull()
    expect(ringBreakTime({ broken: true, breakTime: undefined })).toBeNull()
    expect(ringBreakTime({ broken: false, breakTime: 1.2 })).toBeNull()
    expect(ringBreakTime({ broken: true, bornBroken: true, breakTime: 1.2 })).toBeNull()
    expect(ringBreakTime({ broken: true, breakTime: 1.2 })).toBe(1.2)
    expect(ringBreakTime({ broken: true, breakTime: 0 })).toBe(0)
  })

  it('deathTime は同じ対象への複数ポップのうち最大の t（致命打）を返し、heal を無視する', () => {
    const popups: DamagePopup[] = [
      { pos: { x: 0, y: 0 }, amount: 10, kind: 'light', targetId: 'e1', trigger: 'flash', t: 0.4 },
      { pos: { x: 0, y: 0 }, amount: 20, kind: 'dark', targetId: 'e1', trigger: 'flash', t: 0.9 },
      { pos: { x: 0, y: 0 }, amount: 30, kind: 'heal', targetId: 'e1', trigger: 'heal', t: 5.0 },
      { pos: { x: 0, y: 0 }, amount: 10, kind: 'light', targetId: 'e2', trigger: 'flash', t: 2.0 },
      { pos: { x: 0, y: 0 }, amount: 99, kind: 'dark', targetId: 'e1', trigger: 'flash', t: Infinity },
    ]
    expect(deathTime(popups, 'e1')).toBe(0.9)
    expect(deathTime(popups, 'e3')).toBeNull()
  })

  it('致命打より前は敵を隠さず、撃破演出の開始時刻から隠す', () => {
    const starts = { future: 1200, now: 600, invalid: NaN }
    expect([...activeDeathIds(starts, 1199)]).toEqual(['now'])
    expect([...activeDeathIds(starts, 1200)]).toEqual(['future', 'now'])
  })

  it('遅いポップの表示終了を飛行尺へクランプせず総尺に含める', () => {
    expect(
      animationEndTime({
        flightMs: 1600,
        baseTailMs: 400,
        popupStartMs: [2400],
        popupDurationMs: 950,
        popupPaddingMs: 300,
        deathEndMs: [],
      }),
    ).toBe(3650)
  })

  it('ポップ開始時刻を絶対時刻として扱い、flightMs を二重加算しない', () => {
    expect(
      animationEndTime({
        flightMs: 2000,
        baseTailMs: 400,
        popupStartMs: [1500],
        popupDurationMs: 950,
        popupPaddingMs: 300,
        deathEndMs: [3100],
      }),
    ).toBe(3100)
  })

  it('lastEventTime は空配列で 0', () => {
    expect(lastEventTime()).toBe(0)
    expect(lastEventTime([])).toBe(0)
    expect(lastEventTime([{ t: NaN }])).toBe(0)
    expect(lastEventTime([{ t: 0.3 }], [{ t: 1.2 }, { t: 0.1 }])).toBe(1.2)
  })

  it('弾がない周回演出でも、遅いポップを最終ゲーム時刻へ含める', () => {
    const orbitEvents = [{ t: 0.4 }]
    const popups = [{ t: 2.4 }]
    expect(lastEventTime(orbitEvents, popups)).toBe(2.4)
  })
})
