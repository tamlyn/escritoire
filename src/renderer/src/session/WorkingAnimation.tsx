import { useEffect, useRef } from 'react'

const size = 14
const tau = Math.PI * 2

type Draw = (ctx: CanvasRenderingContext2D, t: number) => void

/** The transcript's live marker: a Lissajous trace on weekdays, orbiting dots at the weekend. */
export function WorkingAnimation() {
  const ref = useRef<HTMLCanvasElement>(null)
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const weekday = new Date().getDay()
    const draw = weekday === 0 || weekday === 6 ? orbit : lissajous
    let frame = requestAnimationFrame(function tick(now) {
      const scale = devicePixelRatio
      if (canvas.width !== size * scale) canvas.width = canvas.height = size * scale
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.clearRect(0, 0, size, size)
      // Read every frame so the colour follows the theme.
      ctx.fillStyle = ctx.strokeStyle = getComputedStyle(canvas).color
      // Absolute time, so the figure carries on unbroken when the row remounts.
      draw(ctx, now / 1000)
      ctx.globalAlpha = 1
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [reducedMotion])

  if (reducedMotion) return <span role="img" aria-label="Working" className="bg-primary size-1.5 rounded-full" />
  return <canvas ref={ref} role="img" aria-label="Working" className="text-primary size-3.5" />
}

/** A 3:2 figure whose phase drifts, so it slowly turns like an oscilloscope trace. */
const lissajous: Draw = (ctx, t) => {
  const centre = size / 2
  const radius = size * 0.4
  const segments = 60
  const span = 2.2
  const at = (u: number) => [centre + radius * Math.sin(4.8 * u + u * 0.35), centre + radius * Math.sin(3.2 * u)] as const
  ctx.lineWidth = 1.1
  ctx.lineCap = 'round'
  let previous = at(t - span)
  for (let i = 1; i <= segments; i++) {
    const point = at(t - span + (span * i) / segments)
    ctx.globalAlpha = (i / segments) ** 1.5
    ctx.beginPath()
    ctx.moveTo(...previous)
    ctx.lineTo(...point)
    ctx.stroke()
    previous = point
  }
}

/** Three dots on tilted orbits that precess, the nearer drawn larger and brighter, each with a short tail. */
const orbit: Draw = (ctx, t) => {
  const centre = size / 2
  const radius = size * 0.36
  const inclination = 1.15
  const tail = 6
  const at = (i: number, u: number) => {
    const angle = u * (3.1 + i * 0.73) + i * 2
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius * Math.cos(inclination)
    const z = Math.sin(angle) * radius * Math.sin(inclination)
    const turn = (i * tau) / 3 + u * 0.4
    return {
      x: centre + x * Math.cos(turn) - y * Math.sin(turn),
      y: centre + x * Math.sin(turn) + y * Math.cos(turn),
      z,
    }
  }
  const marks = []
  for (let i = 0; i < 3; i++) {
    for (let k = tail; k >= 0; k--) marks.push({ ...at(i, t - k * 0.025), k })
  }
  // Painter's order, so nearer dots pass in front.
  marks.sort((a, b) => a.z - b.z)
  for (const mark of marks) {
    const depth = (mark.z + radius) / (2 * radius)
    ctx.globalAlpha = (0.35 + 0.65 * depth) * (1 - mark.k / (tail + 1)) ** 2
    ctx.beginPath()
    ctx.arc(mark.x, mark.y, size * (0.055 + 0.04 * depth), 0, tau)
    ctx.fill()
  }
}
