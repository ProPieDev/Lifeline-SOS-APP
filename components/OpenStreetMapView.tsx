import { memo, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import {
  WebView,
  type WebViewMessageEvent,
  type WebView as WebViewType,
} from "react-native-webview";
import type { Hospital } from "../utils/hospitals";
import type { LatLng, MapUser, SosAlert } from "../types/domain";

type MapFocus = LatLng & { zoom?: number; nonce: number };

type Props = {
  center: LatLng;
  users: MapUser[];
  hospitals: Hospital[];
  alerts: SosAlert[];
  route: LatLng[];
  pulse: number;
  focus?: MapFocus | null;
  onUserPress: (id: string) => void;
  onHospitalPress: (id: string) => void;
};

function OpenStreetMapView({
  center,
  users,
  hospitals,
  alerts,
  route,
  pulse,
  focus,
  onUserPress,
  onHospitalPress,
}: Props) {
  const webRef = useRef<WebViewType | null>(null);
  const readyRef = useRef(false);

  const payload = useMemo(
    () => ({
      center,
      users: users.map((user) => ({
        id: user.id,
        latitude: user.latitude,
        longitude: user.longitude,
        name: user.profile?.username || "User",
        isSOS: user.isSOS,
        isCurrentUser: Boolean(user.isCurrentUser),
      })),
      hospitals: hospitals.map((hospital) => ({
        id: hospital.id,
        name: hospital.name,
        latitude: hospital.lat,
        longitude: hospital.lng,
        distance: hospital.distanceFormatted,
        type: hospital.type,
      })),
      alerts,
      route,
      pulse,
      focus,
    }),
    [alerts, center, focus, hospitals, pulse, route, users]
  );

  useEffect(() => {
    if (!readyRef.current) return;
    webRef.current?.injectJavaScript(
      `window.renderLifelineMap(${JSON.stringify(payload)}); true;`
    );
  }, [payload]);

  function handleMessage(event: WebViewMessageEvent) {
    try {
      const message = JSON.parse(event.nativeEvent.data);

      if (message.type === "ready") {
        readyRef.current = true;
        webRef.current?.injectJavaScript(
          `window.renderLifelineMap(${JSON.stringify(payload)}); true;`
        );
      }

      if (message.type === "user") onUserPress(message.id);
      if (message.type === "hospital") onHospitalPress(message.id);
    } catch {
      // Ignore malformed messages from the embedded map.
    }
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html: MAP_HTML }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        geolocationEnabled
        mixedContentMode="always"
        scalesPageToFit={false}
        onMessage={handleMessage}
      />
    </View>
  );
}

const MAP_HTML = `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; width: 100%; margin: 0; padding: 0; background: #eef2f7; }
    .leaflet-control-attribution { display: none; }
    .user-dot {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 4px solid #fff;
      background: #22c55e;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.3);
    }
    .user-dot.me {
      width: 28px;
      height: 28px;
      background: #2563eb;
      border-color: #dbeafe;
      box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.2), 0 2px 8px rgba(15, 23, 42, 0.3);
    }
    .user-dot.sos {
      background: #ef4444;
      box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.25), 0 2px 8px rgba(15, 23, 42, 0.3);
    }
    .user-dot.sos.dim {
      background: #991b1b;
      box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.16), 0 2px 8px rgba(15, 23, 42, 0.3);
    }
    .hospital-dot {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ef4444;
      font: 900 22px system-ui, -apple-system, sans-serif;
      background: #fee2e2;
      border: 3px solid #fff;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.25);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const map = L.map('map', { zoomControl: false }).setView([12.9716, 77.5946], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true
    }).addTo(map);

    const layers = {
      users: L.layerGroup().addTo(map),
      hospitals: L.layerGroup().addTo(map),
      alerts: L.layerGroup().addTo(map),
      route: L.layerGroup().addTo(map)
    };

    function post(message) {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(message));
    }

    function userIcon(isSOS, isCurrentUser, pulse) {
      let className = 'user-dot';
      if (isCurrentUser) className += ' me';
      if (isSOS) className += ' sos ' + (pulse % 2 === 0 ? '' : 'dim');
      const size = isCurrentUser ? 38 : 32;
      return L.divIcon({ className: '', html: '<div class="' + className + '"></div>', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    }

    function hospitalIcon() {
      return L.divIcon({ className: '', html: '<div class="hospital-dot">+</div>', iconSize: [34, 34], iconAnchor: [17, 17] });
    }

    window.renderLifelineMap = function(payload) {
      if (!payload || !payload.center) return;

      layers.users.clearLayers();
      layers.hospitals.clearLayers();
      layers.alerts.clearLayers();
      layers.route.clearLayers();

      payload.users.forEach(function(user) {
        L.marker([user.latitude, user.longitude], { icon: userIcon(user.isSOS, user.isCurrentUser, payload.pulse), zIndexOffset: user.isSOS ? 1000 : user.isCurrentUser ? 900 : 100 })
          .bindTooltip(user.name, { direction: 'top', offset: [0, -14], opacity: 0.9 })
          .on('click', function() { post({ type: 'user', id: user.id }); })
          .addTo(layers.users);
      });

      payload.hospitals.forEach(function(hospital) {
        L.marker([hospital.latitude, hospital.longitude], { icon: hospitalIcon(), zIndexOffset: 500 })
          .bindTooltip(hospital.name + ' • ' + hospital.distance, { direction: 'top', offset: [0, -14], opacity: 0.9 })
          .on('click', function() { post({ type: 'hospital', id: hospital.id }); })
          .addTo(layers.hospitals);
      });

      payload.alerts.forEach(function(alert) {
        L.circle([alert.latitude, alert.longitude], {
          radius: 90 + payload.pulse * 45,
          color: '#ef4444',
          weight: 2,
          fillColor: '#ef4444',
          fillOpacity: Math.max(0.08, 0.18 - payload.pulse * 0.04)
        }).addTo(layers.alerts);
      });

      if (payload.route && payload.route.length > 1) {
        L.polyline(payload.route.map(function(point) {
          return [point.latitude, point.longitude];
        }), { color: '#2563eb', weight: 5, opacity: 0.92 }).addTo(layers.route);
      }

      if (payload.focus && payload.focus.nonce !== window.__lastLifelineFocusNonce) {
        window.__lastLifelineFocusNonce = payload.focus.nonce;
        map.setView([payload.focus.latitude, payload.focus.longitude], payload.focus.zoom || 16, { animate: true });
      } else if (!window.__lifelineCentered) {
        window.__lifelineCentered = true;
        map.setView([payload.center.latitude, payload.center.longitude], 15);
      }
    };

    setTimeout(function() { post({ type: 'ready' }); }, 100);
  </script>
</body>
</html>`;

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: "#eef2f7",
  },
});

export default memo(OpenStreetMapView);
