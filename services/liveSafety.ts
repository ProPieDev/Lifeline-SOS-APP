import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
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
const LOCATION_HEARTBEAT_MS = 5000;
const STALE_LOCATION_MS = 5 * 60 * 1000;
export const SOS_AUTO_CLEAR_MS = 2 * 60 * 1000;
const DEFAULT_LOCATION: LatLng = {
  latitude: 12.9716,
  longitude: 77.5946,
};

function now() {
  return Date.now();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
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
  const uid = user?.uid;
  const [location, setLocation] = useState<LatLng | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    if (!uid) return;

    const myLocationRef = ref(db, `locations/${uid}`);
    const myStatusRef = ref(db, `status/${uid}`);
    let subscription: Location.LocationSubscription | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let mounted = true;
    const currentRef = { current: null as LatLng | null };

    async function publish(next: LatLng) {
      currentRef.current = next;
      setLocation(next);
      await update(myLocationRef, { ...next, updatedAt: now() });
      await update(myStatusRef, { state: "online", updatedAt: now() });
    }

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

      const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge: 10 * 60 * 1000,
        requiredAccuracy: 5000,
      });

      if (!mounted) return;

      await publish(
        lastKnown
          ? {
              latitude: lastKnown.coords.latitude,
              longitude: lastKnown.coords.longitude,
            }
          : DEFAULT_LOCATION
      );

      const first = await withTimeout(
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        }),
        5000
      );

      if (first && mounted) {
        await publish({
          latitude: first.coords.latitude,
          longitude: first.coords.longitude,
        });
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: LOCATION_INTERVAL_MS,
          distanceInterval: LOCATION_DISTANCE_M,
        },
        (next) => {
          publish({
            latitude: next.coords.latitude,
            longitude: next.coords.longitude,
          });
        }
      );

      heartbeat = setInterval(() => {
        if (!currentRef.current) return;
        publish(currentRef.current);
      }, LOCATION_HEARTBEAT_MS);
    }

    start();

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !currentRef.current) return;
      publish(currentRef.current);
    });

    return () => {
      mounted = false;
      subscription?.remove();
      appStateSubscription.remove();
      if (heartbeat) clearInterval(heartbeat);
    };
  }, [uid]);

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
  const uid = user?.uid;
  const [locations, setLocations] = useState<Record<string, LiveLocation>>({});

  useEffect(() => {
    const locationsRef = ref(db, "locations");

    const unsubscribeLocations = onValue(locationsRef, (snapshot) => {
      const value = snapshot.val() || {};
      const next: Record<string, LiveLocation> = {};

      Object.keys(value).forEach((id) => {
        if (id === uid) return;
        const parsed = toLocation(id, value[id]);
        if (parsed) next[id] = parsed;
      });

      setLocations(next);
    });

    return () => {
      unsubscribeLocations();
    };
  }, [uid]);

  return useMemo(() => {
    const cutoff = now() - STALE_LOCATION_MS;

    return Object.values(locations).filter(
      (location) => !location.updatedAt || location.updatedAt > cutoff
    );
  }, [locations]);
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

      const next = {
        id: user.uid,
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        time: now(),
        message: message || "Emergency help needed",
      };

      setAlerts((current) => ({ ...current, [user.uid]: next }));

      await set(ref(db, `sos/${user.uid}`), {
        latitude: next.latitude,
        longitude: next.longitude,
        time: next.time,
        message: next.message,
      });
    },
    [currentLocation, user]
  );

  const clearSOS = useCallback(async () => {
    if (!user) return;
    setAlerts((current) => {
      const next = { ...current };
      delete next[user.uid];
      return next;
    });
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
