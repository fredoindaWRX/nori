import { execFile } from 'node:child_process'
import { correctIntentTypos } from './intent-typos.mjs'

// Live weather for plain questions ("how's the weather today"). The host fetches it
// before the model writes, so the model never has to guess conditions. Reads only
// fixed public HTTPS endpoints; nothing the user typed reaches a command line.
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'
const REVERSE = 'https://api.bigdatacloud.net/data/reverse-geocode-client'
const MAX_BYTES = 200_000

export function requestsWeather(text) {
  const value = correctIntentTypos(text)
  if (/\bunder the weather\b|\bweather(?:ing)? the storm\b/i.test(value)) return false
  return /\b(?:weather|forecast)\b/i.test(value)
    || /\b(?:is it|will it|gonna|going to)\s+(?:be\s+)?(?:rain|snow|storm|sunny|hot|cold|warm|chilly|windy|freezing)/i.test(value)
    || /\b(?:temperature|how (?:hot|cold|warm|chilly) is it)\b.*\b(?:outside|out there|today|tonight|tomorrow|right now)\b/i.test(value)
    || /\bneed an? (?:umbrella|jacket|coat)\b/i.test(value)
}

const STOP = /\s+(?:for|on|at|this|next|today|tonight|tomorrow|right|now|please|later|over|during|in the|like|and|or|is|be|going|gonna|will)\b.*$/i
const NOT_PLACE = /^(?:me|here|my (?:area|location|city|town|place)|the area|the morning|the afternoon|the evening|general|the week(?:end)?|a bit|\w+day|\d.*)$/i
export function weatherPlace(text) {
  for (const match of String(text).matchAll(/\b(?:in|for|at|near|around)\s+([A-Za-z][A-Za-z .,'-]{0,80})/g)) {
    const place = match[1].replace(STOP, '').replace(/[\s.,'-]+$/, '').trim()
    if (place && place.length <= 60 && !NOT_PLACE.test(place)) return place
  }
  return null
}

async function getJson(base, params, signal) {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const response = await fetch(url, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    headers: { accept: 'application/json', 'user-agent': 'Nori-weather/1.0' } })
  if (!response.ok) throw new Error(`weather service returned ${response.status}`)
  const text = await response.text()
  if (text.length > MAX_BYTES) throw new Error('weather response too large')
  return JSON.parse(text)
}

// Windows location (Wi-Fi/IP based, usually within a few km). Fixed script, no input.
const LOCATE = `Add-Type -AssemblyName System.Device
$w = New-Object System.Device.Location.GeoCoordinateWatcher([System.Device.Location.GeoPositionAccuracy]::Default)
[void]$w.TryStart($false, [TimeSpan]::FromSeconds(8))
$end = (Get-Date).AddSeconds(8)
while ($w.Status -ne 'Ready' -and $w.Permission -ne 'Denied' -and (Get-Date) -lt $end) { Start-Sleep -Milliseconds 200 }
$c = $w.Position.Location; $w.Stop()
if ($w.Permission -eq 'Denied') { 'denied' } elseif ($c.IsUnknown) { 'unknown' } else { '{0},{1},{2}' -f $c.Latitude.ToString([cultureinfo]::InvariantCulture), $c.Longitude.ToString([cultureinfo]::InvariantCulture), [math]::Round($c.HorizontalAccuracy) }`

export function pcLocation() {
  return new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', LOCATE],
    { windowsHide: true, timeout: 20000, encoding: 'utf8' }, (error, stdout) => {
      const text = String(stdout || '').trim()
      if (error || !text) return resolve({ error: 'Windows location did not answer.' })
      if (text === 'denied') return resolve({ error: 'Windows location is turned off for desktop apps (Settings > Privacy & security > Location).' })
      const [latitude, longitude, accuracy] = text.split(',').map(Number)
      if (![latitude, longitude].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return resolve({ error: 'Windows location has no fix yet.' })
      resolve({ latitude, longitude, accuracyKm: Math.max(1, Math.round((accuracy || 0) / 1000)) })
    }))
}

async function geocode(place, signal) {
  const [name, ...qualifiers] = place.split(',').map(part => part.trim()).filter(Boolean)
  const data = await getJson(GEOCODE, { name, count: 10, language: 'en', format: 'json' }, signal)
  const results = Array.isArray(data.results) ? data.results : []
  const wanted = qualifiers.join(' ').toLowerCase()
  const hit = (wanted && results.find(r => [r.country, r.country_code, r.admin1, r.admin2].some(v => v && wanted.includes(String(v).toLowerCase())))) || results[0]
  if (!hit) return null
  return { latitude: hit.latitude, longitude: hit.longitude, label: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', ') }
}

const CODES = { 0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'heavy freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'light showers', 81: 'showers', 82: 'violent showers',
  85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'severe thunderstorm with hail' }
const sky = code => CODES[code] ?? 'unknown conditions'
const temp = c => Number.isFinite(c) ? `${Math.round(c * 9 / 5 + 32)}°F (${Math.round(c)}°C)` : 'unknown'
const wind = kmh => Number.isFinite(kmh) ? `${Math.round(kmh / 1.609)} mph` : 'unknown'
const clock = iso => (typeof iso === 'string' && iso.includes('T') ? iso.split('T')[1] : '?')

export async function weatherReport(request, { signal, locate = pcLocation } = {}) {
  const place = weatherPlace(request)
  let spot
  if (place) {
    spot = await geocode(place, signal)
    if (!spot) throw new Error(`no place called "${place}" was found`)
    spot.source = `the place the owner named ("${place}")`
  } else {
    const here = await locate()
    if (here.error) throw new Error(`${here.error} Ask the owner which city they are in.`)
    // Two decimals (about 1 km) is plenty for weather and shares less than the full fix.
    spot = { latitude: Math.round(here.latitude * 100) / 100, longitude: Math.round(here.longitude * 100) / 100,
      source: `this PC's Windows location, accurate to about ${here.accuracyKm} km` }
    try {
      const area = await getJson(REVERSE, { latitude: spot.latitude, longitude: spot.longitude, localityLanguage: 'en' }, signal)
      spot.label = [area.city || area.locality, area.principalSubdivision, area.countryName].filter(Boolean).join(', ') || null
    } catch { spot.label = null }
  }
  const data = await getJson(FORECAST, { latitude: spot.latitude, longitude: spot.longitude, timezone: 'auto', forecast_days: 3,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset' }, signal)
  const now = data.current
  const days = data.daily
  if (!now || !days?.time?.length) throw new Error('weather service returned no forecast')
  const where = spot.label || `near ${data.timezone ?? 'the PC'}`
  const lines = [`Location: ${where} (from ${spot.source})`,
    `Local time of reading: ${String(now.time).replace('T', ' ')} (${data.timezone})`,
    `Now: ${sky(now.weather_code)}, ${temp(now.temperature_2m)}, feels like ${temp(now.apparent_temperature)}, humidity ${now.relative_humidity_2m}%, wind ${wind(now.wind_speed_10m)} gusting ${wind(now.wind_gusts_10m)}, precipitation ${now.precipitation} mm in the last hour`]
  days.time.forEach((day, i) => lines.push(`${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : day} (${day}): ${sky(days.weather_code[i])}, high ${temp(days.temperature_2m_max[i])}, low ${temp(days.temperature_2m_min[i])}, chance of precipitation ${days.precipitation_probability_max[i] ?? '?'}%, total ${days.precipitation_sum[i] ?? '?'} mm, sunrise ${clock(days.sunrise[i])}, sunset ${clock(days.sunset[i])}`))
  lines.push('Source: Open-Meteo (open-meteo.com)')
  return lines.join('\n')
}
