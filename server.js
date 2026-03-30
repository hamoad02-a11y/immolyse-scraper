const express = require('express')
const { chromium } = require('playwright')
const app = express()
app.use(express.json())

const API_KEY = process.env.SCRAPER_API_KEY || 'changeme'
app.use((req, res, next) => {
  const key = req.headers['authorization']?.replace('Bearer ', '')
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' })
  next()
})

app.get('/', (req, res) => res.json({ status: 'ok', service: 'immolyse-scraper' }))

app.post('/scrape', async (req, res) => {
  const { titre_foncier } = req.body
  if (!titre_foncier) return res.status(400).json({ error: 'titre_foncier required' })

  let browser = null
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    const page = await browser.newPage()
    const captured = {}
    page.on('response', async (response) => {
      const url = response.url()
      if (url.includes('DataSynchronise') || url.includes('bpm/action')) {
        try { captured[url.includes('DataSynchronise') ? 'datasync' : 'bpm'] = await response.text() } catch(e) {}
      }
    })
    await page.goto('https://e-auc.org/karazal/', { waitUntil: 'networkidle', timeout: 30000 })
    await page.evaluate(() => { ApplicationManager.run('auc/noterenseignement/search/MapRF!', 'search', 'Recherche Géographique') })
    await page.waitForTimeout(2000)
    const inputs = await page.$$('input.ow-field-input[type=text]')
    if (inputs.length > 0) {
      await inputs[0].fill(titre_foncier.replace(/\/.*/, ''))
      await page.keyboard.press('Enter')
      await page.waitForTimeout(5000)
    }
    if (captured.datasync) {
      const data = JSON.parse(captured.datasync)
      const feature = data?.features?.[0]
      if (feature) {
        return res.json({
          titre_foncier,
          prefecture: feature.properties?.prefecture || 'Casablanca',
          commune: feature.properties?.commune || 'Casablanca',
          secteur: feature.properties?.secteur || '',
          zone_code: feature.properties?.zone || 'RA',
          zone_label: feature.properties?.zone_label || '',
          surface_m2: feature.properties?.superficie || 0,
          source: 'karazal',
          fetched_at: new Date().toISOString()
        })
      }
    }
    res.json({ error: 'Titre foncier not found or Karazal unavailable', titre_foncier })
  } catch (err) {
    console.error('[Scraper error]', err.message)
    res.status(500).json({ error: err.message })
  } finally {
    if (browser) await browser.close()
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`[Scraper] Running on port ${PORT}`))
