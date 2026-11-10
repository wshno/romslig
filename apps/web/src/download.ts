/** Hands the browser a file to save, made from data the page already holds. */
export function saveFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  // The download has its own hold on the data once it has started
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** An SVG as an address an <img> can show. */
export const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

/**
 * An SVG as a PNG on a white background, `longEdge` pixels along its longest side. The SVG has to
 * state its own width and height, which give the proportions.
 */
export function svgToPng(svg: string, longEdge = 2400): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const failed = () => reject(new Error('Kunne ikke lage bildet.'))
    const img = new Image()
    img.onerror = failed
    img.onload = () => {
      const scale = longEdge / Math.max(img.naturalWidth, img.naturalHeight, 1)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return failed()
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => (blob ? resolve(blob) : failed()), 'image/png')
    }
    img.src = svgUrl(svg)
  })
}
