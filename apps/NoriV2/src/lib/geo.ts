/**
 * The purple Earth mesh is an equirectangular sphere: u runs west→east and v
 * runs south→north, so the raw UV hit is already the geographic coordinate.
 * Both the scroll-to-explore path and the double-click path use this one map,
 * and tests/earth-geo.test.mjs pins the mapping.
 */
export function uvToLatLon(u: number, v: number): { latitude: number; longitude: number } {
  return { latitude: (v - .5) * 180, longitude: (u - .5) * 360 }
}
