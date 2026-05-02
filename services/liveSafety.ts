import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Location from "expo-location";
import {
  equalTo,
  get,
  limitToLast,
  onDisconnect,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  remove,
  set,
  update,
} from "firebase/database";
import { auth, db } from "../firebase";
import type {
  CallRequest,
  ChatMessage,
  LatLng,
  LiveLocation,
  SosAlert,
  UserProfile,
} from "../types/domain";

const LOCATION_INTERVAL_MS = 3000;
const LOCATION_DISTANCE_M = 8;
const STALE_LOCATION_MS = 2 * 60 * 1000;
export const SOS_AUTO_CLEAR_MS = 2 * 60 * 1000;

function now() {
  return Date.now();
}

function toLocation(id: string, value: any): LiveLocation | null {
  const latitude = value?.latitude ?? value?.lat;
  const longitude = value?.longitude ?? value?.lng;

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return null;
  }

  return {
    id,
    latitude,
    longitude,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
}

function toProfile(id: string, value: any): UserProfile {
  return {
    id,
    username: value?.username || "User",
    age: value?.age || "",
    gender: value?.gender || "",
    condition: value?.condition || "None",
    phone: value?.phone || "",
    photo: value?.photo || "",
    markerIcon: value?.markerIcon || "",
    ratingAvg: Number(value?.ratingAvg || 0),
    ratingCount: Number(value?.ratingCount || 0),
  };
}

export function useCurrentLocationPresence() {
  const user = auth.currentUser;
  const [location, setLocation] = useState<LatLng | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    if (!user) return;

    const myLocationRef = ref(db, `locations/${user.uid}`);
    const myStatusRef = ref(db, `status/${user.uid}`);
    let subscription: Location.LocationSubscription | null = null;
    let mounted = true;

    onDisconnect(myStatusRef).set({ state: "offline", updatedAt: now() });
    onDisconnect(myLocationRef).remove();
    set(myStatusRef, { state: "online", updatedAt: now() });

    async function start() {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!mounted) return;

      if (permission.status !== "granted") {
        setPermissionDenied(true);
        return;
      }

      const first = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      if (!mounted) return;

      const initial = {
        latitude: first.coords.latitude,
        longitude: first.coords.longitude,
      };

      setLocation(initial);
      await set(myLocationRef, { ...initial, updatedAt: now() });

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: LOCATION_INTERVAL_MS,
          distanceInterval: LOCATION_DISTANCE_M,
        },
        (next) => {
          const current = {
            latitude: next.coords.latitude,
            longitude: next.coords.longitude,
          };
          setLocation(current);
          update(myLocationRef, { ...current, updatedAt: now() });
          update(myStatusRef, { state: "online", updatedAt: now() });
        }
      );
    }

    start();

    return () => {
      mounted = false;
      subscription?.remove();
      set(myStatusRef, { state: "offline", updatedAt: now() });
      remove(myLocationRef);
    };
  }, [user]);

  return { location, permissionDenied };
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});

  useEffect(() => {
    const usersRef = ref(db, "users");

    const unsubscribe = onValue(usersRef, (snapshot) => {
      const value = snapshot.val() || {};
      const next: Record<string, UserProfile> = {};
      Object.keys(value).forEach((id) => {
        next[id] = toProfile(id, value[id]);
      });
      setProfiles(next);
    });

    return () => unsubscribe();
  }, []);

  return profiles;
}

export function useLiveLocations() {
  const user = auth.currentUser;
  const [locations, setLocations] = useState<Record<string, LiveLocation>>({});
  const [status, setStatus] = useState<Record<string, any>>({});

  useEffect(() => {
    const locationsRef = ref(db, "locations");
    const statusRef = ref(db, "status");

    const unsubscribeLocations = onValue(locationsRef, (snapshot) => {
      const value = snapshot.val() || {};
      const next: Record<string, LiveLocation> = {};

      Object.keys(value).forEach((id) => {
        if (id === user?.uid) return;
        const parsed = toLocation(id, value[id]);
        if (parsed) next[id] = parsed;
      });

      setLocations(next);
    });

    const unsubscribeStatus = onValue(statusRef, (snapshot) => {
      setStatus(snapshot.val() || {});
    });

    return () => {
      unsubscribeLocations();
      unsubscribeStatus();
    };
  }, [user?.uid]);

  return useMemo(() => {
    const cutoff = now() - STALE_LOCATION_MS;

    return Object.values(locations).filter((location) => {
      const userStatus = status[location.id];
      const state =
        typeof userStatus === "string" ? userStatus : userStatus?.state || "online";

      return state !== "offline" && (!location.updatedAt || location.updatedAt > cutoff);
    });
  }, [locations, status]);
}

export function useSosController(currentLocation: LatLng | null) {
  const user = auth.currentUser;
  const [alerts, setAlerts] = useState<Record<string, SosAlert>>({});

  useEffect(() => {
    const sosRef = ref(db, "sos");

    const unsubscribe = onValue(sosRef, (snapshot) => {
      const value = snapshot.val() || {};
      const next: Record<string, SosAlert> = {};

      Object.keys(value).forEach((id) => {
        const sos = value[id];
        const latitude = sos?.latitude ?? sos?.lat;
        const longitude = sos?.longitude ?? sos?.lng;

        if (typeof latitude !== "number" || typeof longitude !== "number") return;

        const time = Number(sos.time || 0);

        if (!time || now() - time > SOS_AUTO_CLEAR_MS) return;

        next[id] = {
          id,
          latitude,
          longitude,
          time,
          message: sos.message || "",
        };
      });

      setAlerts(next);
    });

    return () => unsubscribe();
  }, []);

  const triggerSOS = useCallback(
    async (message?: string) => {
      if (!user || !currentLocation) return;

      await set(ref(db, `sos/${user.uid}`), {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        time: now(),
        message: message || "Emergency help needed",
      });
    },
    [currentLocation, user]
  );

  const clearSOS = useCallback(async () => {
    if (!user) return;
    await remove(ref(db, `sos/${user.uid}`));
  }, [user]);

  const toggleSOS = useCallback(
    async (message?: string) => {
      if (!user) return;

      if (alerts[user.uid]) {
        await clearSOS();
        return;
      }

      await triggerSOS(message);
    },
    [alerts, clearSOS, triggerSOS, user]
  );

  useEffect(() => {
    if (!user || !alerts[user.uid]) return;

    const remaining = Math.max(
      0,
      SOS_AUTO_CLEAR_MS - (now() - alerts[user.uid].time)
    );
    const timeout = setTimeout(() => {
      clearSOS();
    }, remaining);

    return () => clearTimeout(timeout);
  }, [alerts, clearSOS, user]);

  return { alerts, triggerSOS, clearSOS, toggleSOS };
}

export function chatIdFor(a: string, b: string) {
  return [a, b].sort().join("_");
}

export function useChat(peerId?: string) {
  const user = auth.currentUser;
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (!user || !peerId) {
      setMessages([]);
      return;
    }

    const chatRef = query(
      ref(db, `chats/${chatIdFor(user.uid, peerId)}/messages`),
      orderByChild("createdAt"),
      limitToLast(50)
    );

    const unsubscribe = onValue(chatRef, (snapshot) => {
      const value = snapshot.val() || {};
      const next = Object.keys(value)
        .map((id) => ({ id, ...value[id] }))
        .sort((a, b) => a.createdAt - b.createdAt);
      setMessages(next);
    });

    return () => unsubscribe();
  }, [peerId, user]);

  const sendMessage = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!user || !peerId || !clean) return;

      await push(ref(db, `chats/${chatIdFor(user.uid, peerId)}/messages`), {
        senderId: user.uid,
        text: clean,
        createdAt: now(),
      });
    },
    [peerId, user]
  );

  return { messages, sendMessage };
}

export function useIncomingCalls() {
  const user = auth.currentUser;
  const [incoming, setIncoming] = useState<CallRequest | null>(null);
  const [activeCall, setActiveCall] = useState<CallRequest | null>(null);

  useEffect(() => {
    if (!user) return;

    const callsQuery = query(
      ref(db, "calls"),
      orderByChild("to"),
      equalTo(user.uid),
      limitToLast(5)
    );

    const unsubscribe = onValue(callsQuery, (snapshot) => {
      const calls = snapshot.val() || {};
      const ringing = Object.keys(calls)
        .map((id) => ({ id, ...calls[id] }) as CallRequest)
        .filter((call) => call.status === "ringing")
        .sort((a, b) => b.createdAt - a.createdAt)[0];

      setIncoming(ringing || null);
    });

    return () => unsubscribe();
  }, [user]);

  const updateCall = useCallback(
    async (status: CallRequest["status"]) => {
      if (!incoming) return;
      await update(ref(db, `calls/${incoming.id}`), { status, updatedAt: now() });
      if (status === "accepted") setActiveCall({ ...incoming, status });
      setIncoming(null);
    },
    [incoming]
  );

  const endCall = useCallback(async () => {
    if (!activeCall) return;
    await update(ref(db, `calls/${activeCall.id}`), {
      status: "ended",
      updatedAt: now(),
    });
    setActiveCall(null);
  }, [activeCall]);

  return { incoming, activeCall, updateCall, endCall };
}

export async function requestCall(to: string) {
  const user = auth.currentUser;
  if (!user) return null;

  const callRef = await push(ref(db, "calls"), {
    from: user.uid,
    to,
    status: "ringing",
    createdAt: now(),
  });

  return callRef.key;
}

export function useOutgoingCall(callId: string | null) {
  const [call, setCall] = useState<CallRequest | null>(null);

  useEffect(() => {
    if (!callId) {
      setCall(null);
      return;
    }

    const callRef = ref(db, `calls/${callId}`);
    const unsubscribe = onValue(callRef, (snapshot) => {
      const value = snapshot.val();
      setCall(value ? ({ id: callId, ...value } as CallRequest) : null);
    });

    return () => unsubscribe();
  }, [callId]);

  const endCall = useCallback(async () => {
    if (!callId) return;
    await update(ref(db, `calls/${callId}`), {
      status: "ended",
      updatedAt: now(),
    });
  }, [callId]);

  return { call, endCall };
}

export async function rateUser(userId: string, rating: number) {
  const safeRating = Math.max(1, Math.min(5, Math.round(rating)));
  const userRef = ref(db, `users/${userId}`);
  const snapshot = await get(userRef);
  const profile = snapshot.val() || {};
  const count = Number(profile.ratingCount || 0);
  const average = Number(profile.ratingAvg || 0);
  const nextCount = count + 1;
  const nextAverage = (average * count + safeRating) / nextCount;

  await update(userRef, {
    ratingAvg: Number(nextAverage.toFixed(2)),
    ratingCount: nextCount,
  });
}
