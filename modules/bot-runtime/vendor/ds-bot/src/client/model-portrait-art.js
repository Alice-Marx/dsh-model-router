import { PORTRAIT_SIZE } from './model-portrait-eyes.js'

const size = PORTRAIT_SIZE
const smooth = value => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

function triangle(a, b, c) {
  const bx = b.u - a.u, by = b.v - a.v, cx = c.u - a.u, cy = c.v - a.v
  const area = bx * cy - by * cx
  return { a, b, c, inv: [cy / area, -by / area, -cx / area, bx / area] }
}

function paintTriangle(ctx, source, { a, b, c, inv }) {
  const bx = b.x - a.x, by = b.y - a.y, cx = c.x - a.x, cy = c.y - a.y
  const xx = bx * inv[0] + cx * inv[1], xy = bx * inv[2] + cx * inv[3]
  const yx = by * inv[0] + cy * inv[1], yy = by * inv[2] + cy * inv[3]
  // A subpixel overlap covers the antialiased edge of the adjacent triangle.
  const centerX = (a.x + b.x + c.x) / 3, centerY = (a.y + b.y + c.y) / 3
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(a.x + (a.x - centerX) * .035, a.y + (a.y - centerY) * .035)
  ctx.lineTo(b.x + (b.x - centerX) * .035, b.y + (b.y - centerY) * .035)
  ctx.lineTo(c.x + (c.x - centerX) * .035, c.y + (c.y - centerY) * .035)
  ctx.closePath()
  ctx.clip()
  ctx.setTransform(xx, yx, xy, yy, a.x - xx * a.u - xy * a.v, a.y - yx * a.u - yy * a.v)
  ctx.drawImage(source, 0, 0)
  ctx.restore()
}

function portraitMesh(rig, compact) {
  const center = rig.eyes.reduce((total, [left, , right]) => total + (left + right) / 4, 0)
  const neck = rig.neck ?? (rig.eyes[0][3] + rig.eyes[1][3]) / 2 + 39
  const columns = compact ? [0, 24, 128, 232, size] : [0, 20, 74, 128, 182, 236, size]
  const rows = [0, 15, 59, 103, neck - 32, neck - 14, neck + 9, neck + 30, 239, size]
  const grid = rows.map(v => columns.map(u => {
    const edge = smooth(Math.min(u, v, size - u, size - v) / 18)
    const side = smooth((Math.abs(u - center) - 36) / 58)
    // Around the jaw, the head gradually yields to the shoulders and outer hair.
    const head = (1 - smooth((v - neck + 26 + side * 14) / 58)) * edge
    return { u, v, x: u, y: v, dx: u - center, head, headY: v - neck, torso: edge, torsoY: v - 231 }
  }))
  const triangles = []
  for (let row = 1; row < rows.length; row++) {
    for (let col = 1; col < columns.length; col++) {
      const a = grid[row - 1][col - 1], b = grid[row - 1][col]
      const c = grid[row][col], d = grid[row][col - 1]
      triangles.push(triangle(a, b, c), triangle(a, c, d))
    }
  }
  return { points: grid.flat(), triangles }
}

const angle = degrees => degrees * Math.PI / 180

// Keep the raster intact while the head turns around the neck and the chest
// turns around a lower pivot. Both tracks share the same vertices at the join.
export function makePortraitArt(canvas, image, eyes, rig, compact) {
  const mesh = portraitMesh(rig, compact)
  let ctx, composite
  return (head, torso) => {
    const [hx, hy, hr] = head, [tx, ty, tr] = torso
    if ((!hx && !hy && !hr && !tx && !ty && !tr) || image.naturalWidth !== size || image.naturalHeight !== size) {
      canvas.hidden = true
      return
    }
    ctx ??= canvas.getContext('2d')
    if (!ctx) return
    let source = image
    if (eyes && !eyes.hidden) {
      if (!composite) {
        const buffer = document.createElement('canvas')
        buffer.width = buffer.height = size
        composite = buffer.getContext('2d')
      }
      if (composite) {
        composite.drawImage(image, 0, 0)
        composite.drawImage(eyes, 0, 0)
        source = composite.canvas
      }
    }
    const hSin = Math.sin(angle(hr)), hCos = Math.cos(angle(hr)) - 1
    const tSin = Math.sin(angle(tr)), tCos = Math.cos(angle(tr)) - 1
    for (const vertex of mesh.points) {
      const { u, v, dx, head, headY, torso, torsoY } = vertex
      vertex.x = u + head * (hx + dx * hCos - headY * hSin) + torso * (tx + dx * tCos - torsoY * tSin)
      vertex.y = v + head * (hy + dx * hSin + headY * hCos) + torso * (ty + dx * tSin + torsoY * tCos)
    }
    ctx.drawImage(source, 0, 0)
    for (const tri of mesh.triangles) paintTriangle(ctx, source, tri)
    canvas.hidden = false
  }
}
