import { Linking, Platform } from "react-native";
import type { LatLng } from "../types/domain";

export async function openGoogleMapsDirections(destination: LatLng, label?: string) {
  const encodedLabel = encodeURIComponent(label || "Destination");
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination.latitude},${destination.longitude}&travelmode=driving`;
  const nativeUrl =
    Platform.OS === "ios"
      ? `comgooglemaps://?daddr=${destination.latitude},${destination.longitude}&directionsmode=driving&q=${encodedLabel}`
      : `google.navigation:q=${destination.latitude},${destination.longitude}&mode=d`;

  const canOpenNative = await Linking.canOpenURL(nativeUrl);
  await Linking.openURL(canOpenNative ? nativeUrl : webUrl);
}

export function buildStraightLineRoute(from: LatLng, to: LatLng): LatLng[] {
  return [from, to];
}
