// Keep a deadline separate from the last draw: rounding every interval up to a
// display frame would otherwise turn 20fps into 15fps on a busy 30Hz surface.
export const createFrameClock = () => {
  let last = NaN
  let next = 0
  let previousInterval = 0
  return {
    advance(now: number, interval: number): number | null {
      if (!Number.isFinite(last) || previousInterval !== interval) {
        last = now
        next = now + interval
        previousInterval = interval
        return interval / 1000
      }
      // Browser timestamps can land just below an exact display boundary.
      if (now + 0.5 < next) return null
      const elapsed = Math.min(Math.max(0, now - last) / 1000, 0.1)
      last = now
      // Skip missed deadlines instead of submitting a burst of catch-up draws.
      next += Math.max(1, Math.floor((now - next) / interval) + 1) * interval
      return elapsed
    },
    reset() { last = NaN; next = 0; previousInterval = 0 },
  }
}
