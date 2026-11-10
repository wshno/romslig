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
