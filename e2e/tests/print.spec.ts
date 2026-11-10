import { readFile } from 'node:fs/promises'

import { expect, projectName, removeProject, test } from './fixtures'

interface Seeded {
  id: string
  version: number
  scenarios: Record<string, unknown>[]
}

test.describe('print', () => {
  test('the print page draws the plan with its lists, and hands it out as a PNG', async ({ page }, testInfo) => {
    const name = projectName('utskrift')
    const created = await page.request.post('/api/projects', { multipart: { name } })
    expect(created.status()).toBe(201)
    const project = (await created.json()) as Seeded
    try {
      // A room of 4 × 3 m with a sofa in it, saved the way the editor saves
      const wall = (id: string, ax: number, ay: number, bx: number, by: number) => ({
        id,
        a: { x: ax, y: ay },
        b: { x: bx, y: by },
        thickness: 0.2,
        height: 2.4,
        loadBearing: 'no',
        exterior: true,
      })
      const scenario = {
        ...project.scenarios[0],
        walls: [
          wall('t', -0.1, -0.1, 4.1, -0.1),
          wall('r', 4.1, -0.1, 4.1, 3.1),
          wall('b', 4.1, 3.1, -0.1, 3.1),
          wall('l', -0.1, 3.1, -0.1, -0.1),
        ],
        rooms: [
          {
            id: 'r1',
            name: 'Stue (øst)',
            type: 'stue',
            polygon: [
              { x: 0, y: 0 },
              { x: 4, y: 0 },
              { x: 4, y: 3 },
              { x: 0, y: 3 },
            ],
            statedArea: null,
          },
        ],
        furniture: [
          { id: 'f1', catalogId: 'sofa-3', x: 2, y: 0.5, rotation: 0, roomId: null, size: null, label: null },
        ],
      }
      const stored = await page.request.put(`/api/projects/${project.id}`, {
        headers: { 'If-Match': String(project.version) },
        data: { ...project, scenarios: [scenario] },
      })
      expect(stored.status()).toBe(200)

      // Straight to the address, the way a bookmark or a reload gets there
      await page.goto(`/#/p/${project.id}/print`)
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
      await expect(page).toHaveTitle(`${name} – Romslig`)
      const plan = page.getByRole('img', { name: 'Plantegning av Eksisterende' })
      await expect(plan).toHaveJSProperty('complete', true)
      expect(await plan.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
      // The drawing is our own SVG, with the room's name and the sofa's number in it
      const svg = decodeURIComponent((await plan.getAttribute('src'))!.split(',')[1]!)
      expect(svg).toContain('>Stue (øst)</text>')
      expect(svg).toContain('>4,00 m</text>')
      expect(svg).toContain('>1</text>')

      await expect(page.getByRole('row', { name: /Stue \(øst\).*12,0 m²/ })).toBeVisible()
      await expect(page.getByRole('row', { name: /1.*Sofa, 3-seter.*210 × 90 × 85/ })).toBeVisible()

      // Without the furniture: no numbers in the drawing, and no number column in the list
      await page.getByLabel('Møbler').uncheck()
      await expect(page.getByRole('columnheader', { name: 'Nr.' })).toHaveCount(0)
      await expect(page.getByRole('row', { name: /Sofa, 3-seter/ })).toBeVisible()
      await page.getByLabel('Møbler').check()

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Last ned som PNG' }).click(),
      ])
      expect(download.suggestedFilename()).toMatch(/^romslig-e2e-utskrift-kjøkken-ås-s-\w+-eksisterende\.png$/)
      const file = testInfo.outputPath('plan.png')
      await download.saveAs(file)
      const png = await readFile(file)
      expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
      // IHDR: the long edge is 2400 px
      expect(Math.max(png.readUInt32BE(16), png.readUInt32BE(20))).toBe(2400)

      // Back to the editor, and from its top bar to the print page again
      await page.getByRole('link', { name: '← Tilbake til prosjektet' }).click()
      await expect(page.locator('.project-name')).toHaveValue(name)
      await expect(page).toHaveTitle('Romslig')
      await page.getByRole('button', { name: 'Skriv ut', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`#/p/${project.id}/print$`))
      await expect(page.getByRole('row', { name: /Sofa, 3-seter/ })).toBeVisible()
    } finally {
      await removeProject(page.request, project.id)
    }
  })
})
