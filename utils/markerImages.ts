import type { ImageURISource } from "react-native";
import type { UserProfile } from "../types/domain";

const ONLINE_DEFAULT = require("../assets/default-marker-online.png");
const SOS_DEFAULT = require("../assets/default-marker-sos.png");

const cache = new Map<string, ImageURISource>();

function cloudinaryMarkerUrl(photo: string, isSOS: boolean): string | null {
  const markerColor = isSOS ? "ef4444" : "22c55e";
  const uploadSegment = "/image/upload/";

  if (!photo.includes("res.cloudinary.com") || !photo.includes(uploadSegment)) {
    return null;
  }

  const transform = [
    "c_fill,w_96,h_96,g_face",
    "r_max",
    "bo_8px_solid_white",
    `b_rgb:${markerColor}`,
    "fl_png",
  ].join(",");

  return photo.replace(uploadSegment, `${uploadSegment}${transform}/`);
}

export function getUserMarkerImage(
  profile: UserProfile | undefined,
  isSOS: boolean
): number | ImageURISource {
  const fallback = isSOS ? SOS_DEFAULT : ONLINE_DEFAULT;
  const source = profile?.markerIcon || profile?.photo;

  if (!source) return fallback;

  const transformed = cloudinaryMarkerUrl(source, isSOS) || source;
  const key = `${isSOS ? "sos" : "online"}:${transformed}`;
  const cached = cache.get(key);

  if (cached) return cached;

  const image = { uri: transformed };
  cache.set(key, image);
  return image;
}
