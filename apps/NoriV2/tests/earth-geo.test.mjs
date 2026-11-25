import test from 'node:test'
import assert from 'node:assert/strict'
import { uvToLatLon } from '../src/lib/geo.ts'

test('mesh UV maps the equator and prime meridian to 0,0', () => {
  assert.deepEqual(uvToLatLon(.5, .5), { latitude: 0, longitude: 0 })
})

test('mesh UV maps the corners to the full geographic range', () => {
  assert.deepEqual(uvToLatLon(0, 0), { latitude: -90, longitude: -180 })
  assert.deepEqual(uvToLatLon(1, 1), { latitude: 90, longitude: 180 })
})

test('the QA arrival target UV resolves to Times Square', () => {
  // Same coordinate the surface QA hands to window.previewEarthAt.
  const u = -73.9855 / 360 + .5
  const v = 40.758 / 180 + .5
  const { latitude, longitude } = uvToLatLon(u, v)
  assert.ok(Math.abs(latitude - 40.758) < 1e-9)
  assert.ok(Math.abs(longitude - -73.9855) < 1e-9)
})

test('street arrival coordinates survive a UV round trip', () => {
  for (const [latitude, longitude] of [[0, 0], [40.758, -73.9855], [-33.86, 151.21]]) {
    const result = uvToLatLon(longitude / 360 + .5, latitude / 180 + .5)
    assert.ok(Math.abs(result.latitude - latitude) < 1e-9)
    assert.ok(Math.abs(result.longitude - longitude) < 1e-9)
  }
})
