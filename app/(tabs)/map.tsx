import { Ionicons } from "@expo/vector-icons";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
} from "react-native-maps";
import { auth } from "../../firebase";
import {
  rateUser,
  requestCall,
  useChat,
  useCurrentLocationPresence,
  useIncomingCalls,
  useOutgoingCall,
  useLiveLocations,
  useProfiles,
  useSosController,
} from "../../services/liveSafety";
import type { Hospital } from "../../utils/hospitals";
import { fetchNearbyHospitals } from "../../utils/hospitals";
import { bearingBetween } from "../../utils/bearing";
import { distanceBetween, formatDistance } from "../../utils/distance";
import { buildStraightLineRoute, openGoogleMapsDirections } from "../../utils/navigation";
import { playSOSAlert, stopSOSAlert } from "../../utils/alertSystem";
import { sendLocalNotification } from "../../utils/notifications";
import type { LatLng, MapUser } from "../../types/domain";

const DEFAULT_REGION_DELTA = 0.012;
const SOS_FRESH_MS = 3 * 60 * 1000;

const hospitalMarker = require("../../assets/default-marker-online.png");
const defaultUser = require("../../assets/default-user.png");
const greenDotMarker = require("../../assets/marker-dot-green.png");
const redDotMarker = require("../../assets/marker-dot-red.png");
const redDarkDotMarker = require("../../assets/marker-dot-red-dark.png");

const HospitalMarker = memo(function HospitalMarker({
  hospital,
  onPress,
}: {
  hospital: Hospital;
  onPress: (hospital: Hospital) => void;
}) {
  return (
    <Marker
      identifier={`hospital-${hospital.id}`}
      coordinate={{ latitude: hospital.lat, longitude: hospital.lng }}
      image={hospitalMarker}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      zIndex={5}
      onPress={() => onPress(hospital)}
    />
  );
});

export default function MapScreen() {
  const currentUser = auth.currentUser;
  const mapRef = useRef<MapView | null>(null);
  const handledSOSRef = useRef<Record<string, number>>({});
  const shortcutTapRef = useRef<number[]>([]);

  const { location, permissionDenied } = useCurrentLocationPresence();
  const profiles = useProfiles();
  const liveLocations = useLiveLocations();
  const { alerts, toggleSOS, clearSOS } = useSosController(location);
  const { incoming, activeCall, updateCall, endCall } = useIncomingCalls();

  const [selectedUser, setSelectedUser] = useState<MapUser | null>(null);
  const [selectedHospital, setSelectedHospital] = useState<Hospital | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [hospitalLoading, setHospitalLoading] = useState(false);
  const [hospitalPanelOpen, setHospitalPanelOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [outgoingCallId, setOutgoingCallId] = useState<string | null>(null);
  const [route, setRoute] = useState<LatLng[]>([]);
  const [pulse, setPulse] = useState(0);
  const { call: outgoingCall, endCall: endOutgoingCall } = useOutgoingCall(outgoingCallId);
  const mySOSActive = Boolean(currentUser && alerts[currentUser.uid]);
  const activeAlerts = Object.values(alerts).filter(
    (sos) => Date.now() - sos.time < SOS_FRESH_MS
  );

  const mapUsers = useMemo<MapUser[]>(() => {
    return liveLocations.map((live) => {
      const activeSOS = alerts[live.id];
      const isSOS = Boolean(activeSOS && Date.now() - activeSOS.time < SOS_FRESH_MS);
      const profile = profiles[live.id];

      return {
        ...live,
        profile,
        isSOS,
      };
    });
  }, [alerts, liveLocations, profiles]);

  useEffect(() => {
    if (!incoming) return;

    const caller = profiles[incoming.from];
    sendLocalNotification(
      "Incoming in-app call",
      `${caller?.username || "A nearby user"} is calling you.`
    );
    Vibration.vibrate([0, 300, 150, 300]);
  }, [incoming, profiles]);

  const selectedTarget = useMemo(() => {
    if (selectedUser) {
      return { latitude: selectedUser.latitude, longitude: selectedUser.longitude };
    }

    if (selectedHospital) {
      return { latitude: selectedHospital.lat, longitude: selectedHospital.lng };
    }

    return null;
  }, [selectedHospital, selectedUser]);

  const navigationMeta = useMemo(() => {
    if (!location || !selectedTarget) return null;

    return {
      distance: formatDistance(distanceBetween(location, selectedTarget)),
      bearing: bearingBetween(location, selectedTarget),
    };
  }, [location, selectedTarget]);

  useEffect(() => {
    const interval = setInterval(() => {
      setPulse((value) => (value + 1) % 3);
    }, 850);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    Object.values(alerts).forEach(async (sos) => {
      if (!currentUser || sos.id === currentUser.uid) return;
      if (handledSOSRef.current[sos.id] === sos.time) return;
      if (Date.now() - sos.time > SOS_FRESH_MS) return;

      handledSOSRef.current[sos.id] = sos.time;
      const profile = profiles[sos.id];

      await playSOSAlert();
      await sendLocalNotification(
        "SOS Alert",
        `${profile?.username || "Someone nearby"} needs help now.`
      );
      Vibration.vibrate([0, 700, 250, 700]);

      mapRef.current?.animateCamera(
        {
          center: { latitude: sos.latitude, longitude: sos.longitude },
          zoom: 17,
        },
        { duration: 700 }
      );

      Alert.alert(
        "SOS Alert",
        `${profile?.username || "Someone nearby"} needs help now.`,
        [
          { text: "Stop Alarm", onPress: () => stopSOSAlert(), style: "cancel" },
          {
            text: "View",
            onPress: () => {
              const live = mapUsers.find((item) => item.id === sos.id);
              if (live) setSelectedUser(live);
            },
          },
        ]
      );
    });
  }, [alerts, currentUser, mapUsers, profiles]);

  async function loadHospitals() {
    if (!location) return;

    setHospitalLoading(true);
    setHospitalPanelOpen(true);

    try {
      const data = await fetchNearbyHospitals(
        location.latitude,
        location.longitude,
        5000
      );
      setHospitals(data);
    } catch (error: any) {
      Alert.alert("Hospitals unavailable", error.message);
    } finally {
      setHospitalLoading(false);
    }
  }

  function focusOn(target: LatLng, zoom = 16) {
    mapRef.current?.animateCamera({ center: target, zoom }, { duration: 550 });
  }

  function selectUser(user: MapUser) {
    setSelectedHospital(null);
    setSelectedUser(user);
    setRoute([]);
  }

  function selectHospital(hospital: Hospital) {
    setSelectedUser(null);
    setSelectedHospital(hospital);
    setHospitalPanelOpen(false);
    setRoute([]);
    focusOn({ latitude: hospital.lat, longitude: hospital.lng }, 16);
  }

  function drawRoute() {
    if (!location || !selectedTarget) return;
    setRoute(buildStraightLineRoute(location, selectedTarget));
  }

  async function startCall() {
    if (!selectedUser) return;

    const phone = selectedUser.profile?.phone?.trim();
    if (phone) {
      await Linking.openURL(`tel:${phone}`);
      return;
    }

    const callId = await requestCall(selectedUser.id);
    setOutgoingCallId(callId);
    await sendLocalNotification("Calling", "In-app call request sent.");
    Alert.alert("Calling", "The helper will see your call request in the app.");
  }

  function handleShortcutTap() {
    const time = Date.now();
    shortcutTapRef.current = [...shortcutTapRef.current, time].filter(
      (tapTime) => time - tapTime < 1800
    );

    if (shortcutTapRef.current.length >= 3) {
      shortcutTapRef.current = [];
      if (!mySOSActive) {
        toggleSOS("Emergency help needed");
        Vibration.vibrate([0, 120, 80, 120, 80, 220]);
        sendLocalNotification("SOS triggered", "Emergency alert sent from shortcut.");
      }
    }
  }

  if (permissionDenied) {
    return (
      <View style={styles.centered}>
        <Ionicons name="location-outline" size={42} color="#ef4444" />
        <Text style={styles.centerTitle}>Location permission is required</Text>
        <Text style={styles.centerCopy}>
          Lifeline needs live location access to show nearby helpers and send SOS.
        </Text>
      </View>
    );
  }

  if (!location) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#ef4444" />
        <Text style={styles.centerCopy}>Locking on to your location...</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: DEFAULT_REGION_DELTA,
          longitudeDelta: DEFAULT_REGION_DELTA,
        }}
        showsUserLocation
        showsMyLocationButton={false}
        moveOnMarkerPress={false}
        toolbarEnabled={false}
      >
        {mapUsers.map((user) => {
          const flashOn = user.isSOS && pulse % 2 === 0;

          return (
            <Marker
              key={user.id}
              identifier={`user-${user.id}`}
              coordinate={{ latitude: user.latitude, longitude: user.longitude }}
              image={
                user.isSOS ? (flashOn ? redDotMarker : redDarkDotMarker) : greenDotMarker
              }
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              zIndex={user.isSOS ? 60 : 10}
              onPress={() => selectUser(user)}
            />
          );
        })}

        {hospitals.map((hospital) => (
          <HospitalMarker
            key={hospital.id}
            hospital={hospital}
            onPress={selectHospital}
          />
        ))}

        {activeAlerts.map((sos) => (
          <Circle
            key={sos.id}
            center={{ latitude: sos.latitude, longitude: sos.longitude }}
            radius={90 + pulse * 45}
            strokeWidth={2}
            strokeColor={`rgba(239, 68, 68, ${0.75 - pulse * 0.2})`}
            fillColor={`rgba(239, 68, 68, ${0.18 - pulse * 0.04})`}
            zIndex={40}
          />
        ))}

        {route.length > 1 && (
          <Polyline
            coordinates={route}
            strokeColor="#2563eb"
            strokeWidth={5}
            geodesic
          />
        )}
      </MapView>

      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => {
            handleShortcutTap();
            focusOn(location, 17);
          }}
        >
          <Ionicons name="locate" size={22} color="#0f172a" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={loadHospitals}>
          <Ionicons name="medical" size={22} color="#0f172a" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sosButton, mySOSActive && styles.sosButtonActive]}
          onPress={() => toggleSOS("Emergency help needed")}
          onLongPress={clearSOS}
        >
          <Text style={styles.sosText}>{mySOSActive ? "STOP" : "SOS"}</Text>
        </TouchableOpacity>
      </View>

      {navigationMeta && (
        <View style={styles.directionHud}>
          <View style={styles.directionIcon}>
            <Ionicons
              name="navigate"
              size={23}
              color="#ffffff"
              style={{ transform: [{ rotate: `${navigationMeta.bearing}deg` }] }}
            />
          </View>
          <Text style={styles.directionText}>{navigationMeta.distance}</Text>
        </View>
      )}

      {(incoming || activeCall || outgoingCall) && (
        <View style={styles.callBanner}>
          {incoming ? (
            <>
              <Text style={styles.callTitle}>Incoming in-app call</Text>
              <Text style={styles.callSubtitle}>Accept to open a live helper session.</Text>
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.smallButton, styles.acceptButton]}
                  onPress={() => updateCall("accepted")}
                >
                  <Ionicons name="call" size={16} color="#ffffff" />
                  <Text style={styles.smallButtonText}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.smallButton, styles.declineButton]}
                  onPress={() => updateCall("declined")}
                >
                  <Ionicons name="close" size={16} color="#ffffff" />
                  <Text style={styles.smallButtonText}>Decline</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.callTitle}>
                {outgoingCall?.status === "accepted" || activeCall
                  ? "In-app call connected"
                  : outgoingCall?.status === "declined"
                  ? "Call declined"
                  : "Calling..."}
              </Text>
              <Text style={styles.callSubtitle}>
                Use chat during this call. Voice/video needs a WebRTC provider build.
              </Text>
              <TouchableOpacity
                style={[styles.smallButton, styles.declineButton]}
                onPress={() => {
                  endCall();
                  endOutgoingCall();
                  setOutgoingCallId(null);
                }}
              >
                <Ionicons name="call" size={16} color="#ffffff" />
                <Text style={styles.smallButtonText}>End</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {hospitalPanelOpen && (
        <HospitalPanel
          hospitals={hospitals}
          loading={hospitalLoading}
          onClose={() => setHospitalPanelOpen(false)}
          onSelect={selectHospital}
        />
      )}

      {(selectedUser || selectedHospital) && (
        <TargetSheet
          user={selectedUser}
          hospital={selectedHospital}
          navigationMeta={navigationMeta}
          onClose={() => {
            setSelectedUser(null);
            setSelectedHospital(null);
            setChatOpen(false);
            setRoute([]);
          }}
          onNavigate={() => {
            if (!selectedTarget) return;
            openGoogleMapsDirections(
              selectedTarget,
              selectedUser?.profile?.username || selectedHospital?.name
            );
          }}
          onRoute={drawRoute}
          onCall={startCall}
          onChat={() => setChatOpen(true)}
          onRate={(rating) => selectedUser && rateUser(selectedUser.id, rating)}
        />
      )}

      {chatOpen && selectedUser && (
        <ChatSheet
          peerId={selectedUser.id}
          peerName={selectedUser.profile?.username || "User"}
          onClose={() => setChatOpen(false)}
        />
      )}
    </View>
  );
}

function HospitalPanel({
  hospitals,
  loading,
  onClose,
  onSelect,
}: {
  hospitals: Hospital[];
  loading: boolean;
  onClose: () => void;
  onSelect: (hospital: Hospital) => void;
}) {
  return (
    <View style={styles.hospitalPanel}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>Nearby hospitals</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={22} color="#0f172a" />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color="#ef4444" style={styles.panelLoader} />
      ) : (
        <FlatList
          data={hospitals}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No hospitals found within 5 km.</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.hospitalRow}
              onPress={() => onSelect(item)}
            >
              <View style={styles.hospitalIcon}>
                <Ionicons name="medical" size={18} color="#ef4444" />
              </View>
              <View style={styles.flex}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.distanceFormatted} - {item.rating ? `${item.rating}/5` : "OSM"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#64748b" />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

function TargetSheet({
  user,
  hospital,
  navigationMeta,
  onClose,
  onNavigate,
  onRoute,
  onCall,
  onChat,
  onRate,
}: {
  user: MapUser | null;
  hospital: Hospital | null;
  navigationMeta: { distance: string; bearing: number } | null;
  onClose: () => void;
  onNavigate: () => void;
  onRoute: () => void;
  onCall: () => void;
  onChat: () => void;
  onRate: (rating: number) => void;
}) {
  const profile = user?.profile;
  const isSOS = Boolean(user?.isSOS);
  const title = profile?.username || hospital?.name || "Destination";
  const subtitle = user
    ? `${profile?.condition || "No condition listed"}`
    : `${hospital?.type || "hospital"} - ${hospital?.distanceFormatted}`;

  return (
    <View style={[styles.targetSheet, isSOS && styles.sosSheet]}>
      <View style={styles.sheetHeader}>
        <View style={styles.profileHeader}>
          {user && (
            <Image
              source={profile?.photo ? { uri: profile.photo } : defaultUser}
              style={[styles.avatar, isSOS && styles.sosAvatar]}
            />
          )}
          <View style={styles.flex}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.sheetSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </View>
        <Pressable onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={22} color="#0f172a" />
        </Pressable>
      </View>

      {isSOS && (
        <View style={styles.priorityStrip}>
          <Ionicons name="warning" size={16} color="#ffffff" />
          <Text style={styles.priorityText}>Priority SOS active</Text>
        </View>
      )}

      <View style={styles.metaGrid}>
        <Text style={styles.metaText}>Distance: {navigationMeta?.distance || "--"}</Text>
        {user && <Text style={styles.metaText}>Age: {profile?.age || "N/A"}</Text>}
        {user && <Text style={styles.metaText}>Gender: {profile?.gender || "N/A"}</Text>}
        {user && (
          <Text style={styles.metaText}>
            Rating: {profile?.ratingAvg ? profile.ratingAvg.toFixed(1) : "New"}
          </Text>
        )}
      </View>

      <View style={styles.actionRow}>
        <ActionButton icon="navigate" label="Maps" onPress={onNavigate} />
        <ActionButton icon="git-compare" label="Route" onPress={onRoute} />
        {user && <ActionButton icon="call" label="Call" onPress={onCall} />}
        {user && <ActionButton icon="chatbubble" label="Chat" onPress={onChat} />}
      </View>

      {user && (
        <View style={styles.ratingBox}>
          <Text style={styles.ratingLabel}>Rate this helper</Text>
          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map((rating) => (
              <TouchableOpacity
                key={rating}
                style={styles.starButton}
                onPress={() => {
                  onRate(rating);
                  Alert.alert("Rating saved", `You rated ${title} ${rating}/5.`);
                }}
              >
                <Ionicons name="star" size={24} color="#f59e0b" />
                <Text style={styles.starText}>{rating}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.actionButton} onPress={onPress}>
      <Ionicons name={icon} size={18} color="#ffffff" />
      <Text style={styles.actionText}>{label}</Text>
    </TouchableOpacity>
  );
}

function ChatSheet({
  peerId,
  peerName,
  onClose,
}: {
  peerId: string;
  peerName: string;
  onClose: () => void;
}) {
  const { messages, sendMessage } = useChat(peerId);
  const currentUser = auth.currentUser;
  const [draft, setDraft] = useState("");

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.chatSheet}
    >
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>Chat with {peerName}</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={22} color="#0f172a" />
        </Pressable>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        style={styles.chatList}
        renderItem={({ item }) => {
          const mine = item.senderId === currentUser?.uid;
          return (
            <View style={[styles.messageBubble, mine && styles.myMessage]}>
              <Text style={[styles.messageText, mine && styles.myMessageText]}>
                {item.text}
              </Text>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor="#94a3b8"
          style={styles.chatInput}
        />
        <TouchableOpacity
          style={styles.sendButton}
          onPress={() => {
            sendMessage(draft);
            setDraft("");
          }}
        >
          <Ionicons name="send" size={18} color="#ffffff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#e2e8f0",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    backgroundColor: "#f8fafc",
  },
  centerTitle: {
    marginTop: 14,
    fontSize: 19,
    fontWeight: "800",
    color: "#0f172a",
    textAlign: "center",
  },
  centerCopy: {
    marginTop: 10,
    fontSize: 14,
    color: "#475569",
    textAlign: "center",
    lineHeight: 20,
  },
  topBar: {
    position: "absolute",
    top: 52,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    elevation: 4,
    shadowColor: "#000000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  sosButton: {
    marginLeft: "auto",
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ef4444",
    borderWidth: 5,
    borderColor: "#fecaca",
    elevation: 8,
  },
  sosButtonActive: {
    backgroundColor: "#0f172a",
    borderColor: "#ef4444",
  },
  sosText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 18,
  },
  directionHud: {
    position: "absolute",
    top: 132,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#0f172a",
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 22,
  },
  directionIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563eb",
  },
  directionText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  callBanner: {
    position: "absolute",
    top: 132,
    left: 16,
    right: 16,
    padding: 14,
    borderRadius: 8,
    backgroundColor: "#0f172a",
  },
  callTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 10,
  },
  callSubtitle: {
    color: "#cbd5e1",
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  smallButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  acceptButton: {
    backgroundColor: "#16a34a",
  },
  declineButton: {
    backgroundColor: "#dc2626",
  },
  smallButtonText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  hospitalPanel: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 24,
    maxHeight: "48%",
    backgroundColor: "#ffffff",
    borderRadius: 8,
    padding: 14,
    elevation: 8,
  },
  targetSheet: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 24,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    padding: 14,
    elevation: 8,
  },
  sosSheet: {
    borderWidth: 2,
    borderColor: "#ef4444",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#0f172a",
  },
  sheetSubtitle: {
    marginTop: 3,
    fontSize: 13,
    color: "#64748b",
  },
  profileHeader: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#e2e8f0",
  },
  sosAvatar: {
    borderWidth: 3,
    borderColor: "#ef4444",
  },
  priorityStrip: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "#ef4444",
  },
  priorityText: {
    color: "#ffffff",
    fontWeight: "900",
  },
  metaGrid: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaText: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
    overflow: "hidden",
    color: "#334155",
    backgroundColor: "#f1f5f9",
    fontWeight: "700",
  },
  actionRow: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionButton: {
    minWidth: 74,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#0f172a",
  },
  actionText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  ratingBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e2e8f0",
  },
  ratingLabel: {
    marginBottom: 8,
    color: "#334155",
    fontWeight: "900",
  },
  ratingRow: {
    flexDirection: "row",
    gap: 8,
  },
  starButton: {
    minWidth: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#fffbeb",
  },
  starText: {
    marginTop: 2,
    color: "#92400e",
    fontSize: 11,
    fontWeight: "900",
  },
  panelLoader: {
    marginVertical: 24,
  },
  hospitalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
  },
  hospitalIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fee2e2",
  },
  rowTitle: {
    color: "#0f172a",
    fontWeight: "800",
  },
  rowMeta: {
    marginTop: 2,
    color: "#64748b",
    fontSize: 12,
    textTransform: "capitalize",
  },
  flex: {
    flex: 1,
  },
  emptyText: {
    paddingVertical: 20,
    textAlign: "center",
    color: "#64748b",
  },
  chatSheet: {
    position: "absolute",
    top: "18%",
    left: 12,
    right: 12,
    bottom: 20,
    borderRadius: 8,
    padding: 14,
    backgroundColor: "#ffffff",
    elevation: 10,
  },
  chatList: {
    marginTop: 12,
  },
  messageBubble: {
    alignSelf: "flex-start",
    maxWidth: "82%",
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: "#e2e8f0",
  },
  myMessage: {
    alignSelf: "flex-end",
    backgroundColor: "#2563eb",
  },
  messageText: {
    color: "#0f172a",
  },
  myMessageText: {
    color: "#ffffff",
  },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  chatInput: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: "#0f172a",
    backgroundColor: "#f1f5f9",
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563eb",
  },
});
