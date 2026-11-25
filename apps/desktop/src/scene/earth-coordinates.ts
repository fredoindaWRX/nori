export function earthLocationFromUV(u: number, v: number): {latitude:number;longitude:number} | null {
  if (!Number.isFinite(u) || !Number.isFinite(v) || v < 0 || v > 1) return null
  // Sphere seam/pole UV offsets may cross the texture's repeating edge.
  const wrapped = u === 1 ? 1 : ((u % 1) + 1) % 1
  return {latitude:(v-.5)*180,longitude:(wrapped-.5)*360}
}

export function earthDirection(latitude: number, longitude: number): [number,number,number] {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90)
    throw new Error('Invalid Earth coordinates')
  const lat=latitude*Math.PI/180,lon=longitude*Math.PI/180
  return [Math.cos(lon)*Math.cos(lat),Math.sin(lat),-Math.sin(lon)*Math.cos(lat)]
}

export function parseEarthDestination(latitude: string, longitude: string): {latitude:number;longitude:number} | null {
  if (!latitude.trim() || !longitude.trim() || latitude.length>64 || longitude.length>64) return null
  const lat=Number(latitude),lon=Number(longitude)
  return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180
    ? {latitude:lat,longitude:lon} : null
}
