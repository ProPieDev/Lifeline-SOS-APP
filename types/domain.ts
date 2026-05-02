export type LatLng = {
  latitude: number;
  longitude: number;
};

export type UserProfile = {
  id: string;
  username: string;
  age?: string;
  gender?: string;
  condition?: string;
  phone?: string;
  photo?: string;
  markerIcon?: string;
  ratingAvg?: number;
  ratingCount?: number;
};

export type LiveLocation = {
  id: string;
  latitude: number;
  longitude: number;
  updatedAt: number;
};

export type SosAlert = {
  id: string;
  latitude: number;
  longitude: number;
  time: number;
  message?: string;
};

export type MapUser = LiveLocation & {
  profile?: UserProfile;
  isSOS: boolean;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  text: string;
  createdAt: number;
};

export type CallRequest = {
  id: string;
  from: string;
  to: string;
  status: "ringing" | "accepted" | "declined" | "ended";
  createdAt: number;
  updatedAt?: number;
};
