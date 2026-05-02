import type { GeoPoint } from "./distance";

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

export function getBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLambda = toRad(lon2 - lon1);
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function bearingBetween(from: GeoPoint, to: GeoPoint): number {
  return getBearing(from.latitude, from.longitude, to.latitude, to.longitude);
}
