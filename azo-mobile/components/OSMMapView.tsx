import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";

export type LatLng = { latitude: number; longitude: number };

export type OSMMarker = {
  id?: string;
  coordinate: LatLng;
  title?: string;
  color?: "green" | "red" | "blue" | "orange";
  heading?: number;
  /** Précision GPS en mètres : dessine un cercle autour du point. */
  accuracy?: number;
};

type Props = {
  center?: LatLng;
  markers?: OSMMarker[];
  polyline?: LatLng[];
  /** Ligne secondaire en pointillés (ex. la suite du trajet : client → destination). */
  secondaryPolyline?: LatLng[];
  onPress?: (coord: LatLng) => void;
  followMarkerId?: string;
  /**
   * Identifiants de marqueurs à garder TOUS visibles (ex. le Speeder, le client et le point de départ
   * avant la prise en charge). La carte ne se recadre que si l un d eux approche du bord ou si le
   * groupe devient trop petit à l écran. Ignoré si `followMarkerId` est fourni.
   */
  fitMarkerIds?: string[];
  zoom?: number;
};

type MapPayload = {
  center?: LatLng | null;
  markers: OSMMarker[];
  // Absent = « inchangé » : le tracé (des milliers de points) n'est renvoyé à la carte que
  // quand il change, pas à chaque position GPS.
  polyline?: LatLng[];
  polyline2?: LatLng[];
  follow?: string | null;
  fitIds?: string[] | null;
  zoom?: number;
};

// Au-delà, un tracé OSRM complet alourdit la WebView sans rien ajouter à l'écran.
const MAX_POLYLINE_POINTS = 250;

function decimate(points: LatLng[], max: number): LatLng[] {
  if (points.length <= max) return points;
  const out: LatLng[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

function polylineKey(points: LatLng[]): string {
  if (points.length === 0) return "0";
  const at = (p: LatLng) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`;
  return `${points.length}|${at(points[0])}|${at(points[points.length >> 1])}|${at(points[points.length - 1])}`;
}

function buildMapHtml(initial?: LatLng) {
  const startLat = initial?.latitude ?? 6.3703;
  const startLng = initial?.longitude ?? 2.3912;
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
      body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #f0f0f0; }
      .leaflet-control-attribution { display: none; }
      .pin { position: relative; width: 18px; height: 18px; }
      .pin .dot {
        width: 18px; height: 18px; border-radius: 50%; box-sizing: border-box;
        border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.45);
      }
      .pin-blue .dot { background: #1A73E8; }
      .pin-green .dot { background: #1E8E3E; }
      .pin-red .dot { background: #D93025; }
      .pin-orange .dot { background: #F9AB00; }
      .pin .needle {
        position: absolute; left: 50%; top: 50%; width: 0; height: 0;
        border-left: 4px solid transparent; border-right: 4px solid transparent;
        border-bottom: 7px solid #fff; transform-origin: 50% 50%;
        transition: transform 0.35s linear;
        filter: drop-shadow(0 0 1px rgba(0,0,0,0.5));
      }
      .pin .label {
        position: absolute; top: 22px; left: 50%; transform: translateX(-50%);
        background: rgba(255,255,255,0.92); color: #202124;
        font: 600 10px/1.2 -apple-system, Roboto, sans-serif;
        padding: 2px 6px; border-radius: 6px; white-space: nowrap;
        box-shadow: 0 1px 3px rgba(0,0,0,0.25);
      }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script>
      var map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([${startLat}, ${startLng}], 14);
      var tileOpts = { maxZoom: 19, detectRetina: true, updateWhenIdle: false, keepBuffer: 4 };
      // Carte OpenStreetMap standard : TOUJOURS la couche du dessus (pharmacies, commerces, écoles…).
      var primaryTiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', Object.assign({ zIndex: 2 }, tileOpts)).addTo(map);
      // En cas d'échec de tuiles (réseau faible, zone reculée), un second serveur est ajouté EN DESSOUS : il ne sert qu'à
      // combler les tuiles manquantes, il ne remplace jamais la carte standard.
      var underlayAdded = false;
      primaryTiles.on('tileerror', function () {
        if (underlayAdded) return;
        underlayAdded = true;
        L.tileLayer('https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', Object.assign({ zIndex: 1 }, tileOpts)).addTo(map);
      });
      var accuracyLayer = L.layerGroup().addTo(map);
      var markersLayer = L.layerGroup().addTo(map);
      var polylineLayer = L.layerGroup().addTo(map);
      var markerStore = {};
      var polyline = null;
      var polyline2 = null;
      var followId = null;
      var followZoom = 16;
      var followReady = false;
      var followPaused = false;
      var fitIds = [];
      var lastCamAt = 0;
      var lastFitKey = null;
      var lastPanLatLng = null;
      var loopOn = false;

      function post(obj) { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); }

      map.on('click', function (e) {
        post({ type: 'click', latitude: e.latlng.lat, longitude: e.latlng.lng });
      });

      // L'utilisateur déplace la carte avec le doigt : on cesse de la recentrer de force
      // (sinon elle lui échappe à chaque position GPS) jusqu'au bouton « Recentrer ».
      map.on('dragstart', function () {
        if ((followId || fitIds.length) && !followPaused) {
          followPaused = true;
          post({ type: 'follow', value: false });
        }
      });

      function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
      }

      function colorClass(color) {
        return color === 'green' ? 'pin-green' : color === 'red' ? 'pin-red'
          : color === 'orange' ? 'pin-orange' : 'pin-blue';
      }

      function hasHeading(h) { return typeof h === 'number' && isFinite(h); }

      // L'aiguille est toujours créée : le cap se met à jour en tournant l'élément existant,
      // sans reconstruire l'icône (coûteux et clignotant à chaque position).
      function buildIcon(m) {
        var needle = '<div class="needle" style="display:' + (hasHeading(m.heading) ? 'block' : 'none') +
          ';transform:translate(-50%,-50%) rotate(' + (hasHeading(m.heading) ? Math.round(m.heading) : 0) + 'deg)"></div>';
        var label = m.title ? '<div class="label">' + esc(m.title) + '</div>' : '';
        return L.divIcon({
          className: '',
          html: '<div class="pin ' + colorClass(m.color) + '"><div class="dot"></div>' + needle + label + '</div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });
      }

      // Cercle de précision GPS (rayon réel, 5 à 120 m) autour du point : montre la fiabilité de la position
      function setAccuracy(entry, acc) {
        if (typeof acc !== 'number' || !isFinite(acc) || acc <= 0) {
          if (entry.circle) { accuracyLayer.removeLayer(entry.circle); entry.circle = null; }
          return;
        }
        var r = Math.min(Math.max(acc, 5), 120);
        if (!entry.circle) {
          entry.circle = L.circle(entry.marker.getLatLng(), { radius: r, color: '#1A73E8', weight: 1, opacity: 0.5, fillColor: '#1A73E8', fillOpacity: 0.12, interactive: false }).addTo(accuracyLayer);
        } else entry.circle.setRadius(r);
      }

      // Rotation par le plus court chemin (350° -> 10° ne fait pas un tour complet).
      function setHeading(entry, heading) {
        var el = entry.marker.getElement();
        var n = el && el.querySelector('.needle');
        if (!n) return;
        if (!hasHeading(heading)) { n.style.display = 'none'; entry.angle = null; return; }
        var h = ((heading % 360) + 360) % 360;
        if (entry.angle === null || entry.angle === undefined) entry.angle = h;
        else entry.angle += ((h - (entry.angle % 360) + 540) % 360) - 180;
        n.style.display = 'block';
        n.style.transform = 'translate(-50%,-50%) rotate(' + Math.round(entry.angle) + 'deg)';
      }

      // Déplacement continu : la durée de l'animation suit le rythme réel des positions
      // (2-3 s), au lieu d'un mouvement de 0,8 s suivi d'un arrêt. On repart de la position
      // affichée, pas de la précédente cible : aucun saut si une position arrive en avance.
      function moveTo(entry, to) {
        var now = performance.now();
        var cur = entry.marker.getLatLng();
        var dist = map.distance(cur, to);
        if (dist < 0.5) return;
        if (dist > 2000) {
          entry.marker.setLatLng(to);
          if (entry.circle) entry.circle.setLatLng(to);
          entry.anim = null;
          entry.lastAt = now;
          return;
        }
        var dur = Math.min(Math.max(now - (entry.lastAt || now - 1500), 400), 3500);
        entry.lastAt = now;
        entry.anim = { from: cur, to: to, t0: now, dur: dur };
        ensureLoop();
      }

      function ensureLoop() {
        if (loopOn) return;
        loopOn = true;
        requestAnimationFrame(frame);
      }

      function frame(t) {
        var active = false;
        for (var id in markerStore) {
          var e = markerStore[id];
          if (!e.anim) continue;
          var a = e.anim;
          var k = Math.min(1, (t - a.t0) / a.dur);
          e.marker.setLatLng([a.from.lat + (a.to.lat - a.from.lat) * k, a.from.lng + (a.to.lng - a.from.lng) * k]);
          if (e.circle) e.circle.setLatLng(e.marker.getLatLng());
          if (k >= 1) e.anim = null; else active = true;
        }
        followCamera(t, false);
        if (active) requestAnimationFrame(frame); else loopOn = false;
      }

      // La caméra suit le marqueur à chaque image (~20 fois par seconde), comme une
      // navigation : plus de saccade tous les 30 m.
      function followCamera(t, force) {
        if (!followId || followPaused || !markerStore[followId]) return;
        if (!force && t - lastCamAt < 50) return;
        var ll = markerStore[followId].marker.getLatLng();
        if (!force && lastPanLatLng && map.distance(lastPanLatLng, ll) < 0.3) return;
        lastCamAt = t;
        lastPanLatLng = ll;
        if (!followReady) {
          followReady = true;
          map.setView(ll, followZoom, { animate: false });
        } else {
          map.setView(ll, map.getZoom(), { animate: false });
        }
      }

      // Garde un groupe de marqueurs visible : recadre seulement si l un d eux approche du bord
      // (marge de 18 %) ou si le groupe est devenu petit dans la vue, au lieu de bouger à chaque position.
      function fitTracked(force) {
        if (!force && followPaused) return;
        var pts = [];
        for (var k = 0; k < fitIds.length; k++) {
          var en = markerStore[fitIds[k]];
          if (en) pts.push(en.marker.getLatLng());
        }
        if (!pts.length) return;
        var view = map.getBounds();
        if (pts.length === 1) {
          if (force || !view.pad(-0.25).contains(pts[0])) map.panTo(pts[0], { animate: true });
          return;
        }
        var b = L.latLngBounds(pts);
        var inner = view.pad(-0.18);
        var inside = inner.contains(b.getSouthWest()) && inner.contains(b.getNorthEast());
        var small = (b.getNorth() - b.getSouth()) < (view.getNorth() - view.getSouth()) * 0.2 &&
                    (b.getEast() - b.getWest()) < (view.getEast() - view.getWest()) * 0.2;
        if (!force && inside && !small) return;
        map.fitBounds(b, { padding: [70, 70], animate: true, maxZoom: 17 });
      }

      window.recenter = function () {
        followPaused = false;
        lastPanLatLng = null;
        post({ type: 'follow', value: true });
        if (followId) followCamera(performance.now(), true);
        else if (fitIds.length) fitTracked(true);
      };

      function latLngOf(p) { return L.latLng(p.latitude, p.longitude); }

      function maybeFit(points) {
        if (points.length < 2) return;
        var b = L.latLngBounds(points);
        var c = b.getCenter();
        var span = Math.max(b.getNorth() - b.getSouth(), b.getEast() - b.getWest());
        var key = c.lat.toFixed(3) + ',' + c.lng.toFixed(3) + ',' + span.toFixed(3);
        if (key === lastFitKey) return;
        lastFitKey = key;
        map.fitBounds(b, { padding: [50, 50], animate: true });
      }

      window.updateMap = function (data) {
        if (!data) return;
        var m, i, id, entry;
        var seen = {};
        if (data.markers) {
          for (i = 0; i < data.markers.length; i++) {
            m = data.markers[i];
            id = m.id || m.title || ('m' + i);
            seen[id] = true;
            entry = markerStore[id];
            var iconKey = (m.title || '') + '|' + (m.color || '');
            if (!entry) {
              entry = {
                marker: L.marker(latLngOf(m.coordinate), { icon: buildIcon(m) }).addTo(markersLayer),
                anim: null,
                lastAt: performance.now(),
                lastIconKey: iconKey,
                angle: hasHeading(m.heading) ? ((m.heading % 360) + 360) % 360 : null
              };
              markerStore[id] = entry;
              setAccuracy(entry, m.accuracy);
            } else {
              moveTo(entry, latLngOf(m.coordinate));
              if (iconKey !== entry.lastIconKey) {
                entry.lastIconKey = iconKey;
                entry.marker.setIcon(buildIcon(m));
                entry.angle = null;
              }
              setHeading(entry, m.heading);
              setAccuracy(entry, m.accuracy);
            }
          }
        }
        for (id in markerStore) {
          if (!seen[id]) {
            markersLayer.removeLayer(markerStore[id].marker);
            if (markerStore[id].circle) accuracyLayer.removeLayer(markerStore[id].circle);
            delete markerStore[id];
          }
        }

        if ('polyline' in data) {
          if (data.polyline && data.polyline.length > 1) {
            var latlngs = data.polyline.map(latLngOf);
            if (!polyline) polyline = L.polyline(latlngs, { color: '#6200EE', weight: 5, opacity: 0.85 }).addTo(polylineLayer);
            else polyline.setLatLngs(latlngs);
          } else if (polyline) {
            polylineLayer.removeLayer(polyline);
            polyline = null;
          }
        }

        if ('polyline2' in data) {
          if (data.polyline2 && data.polyline2.length > 1) {
            var latlngs2 = data.polyline2.map(latLngOf);
            if (!polyline2) polyline2 = L.polyline(latlngs2, { color: '#9C6BD1', weight: 4, opacity: 0.85, dashArray: '2 10', lineCap: 'round' }).addTo(polylineLayer);
            else polyline2.setLatLngs(latlngs2);
          } else if (polyline2) {
            polylineLayer.removeLayer(polyline2);
            polyline2 = null;
          }
        }

        if ('follow' in data) {
          var nextFollow = data.follow || null;
          if (nextFollow !== followId) {
            followId = nextFollow;
            followReady = false;
            followPaused = false;
            lastPanLatLng = null;
            post({ type: 'follow', value: true });
          }
        }
        if ('fitIds' in data) {
          var nextFit = data.fitIds || [];
          if (nextFit.join('|') !== fitIds.join('|')) {
            fitIds = nextFit;
            followPaused = false;
            if (!followId && fitIds.length) post({ type: 'follow', value: true });
          }
        }
        if (typeof data.zoom === 'number' && isFinite(data.zoom)) followZoom = data.zoom;

        if (followId && markerStore[followId]) {
          followCamera(performance.now(), !followReady);
        } else if (!followId && fitIds.length) {
          followReady = false;
          fitTracked(false);
        } else if (!followId) {
          followReady = false;
          var fitPoints = [];
          if (data.markers) {
            for (i = 0; i < data.markers.length; i++) fitPoints.push(latLngOf(data.markers[i].coordinate));
          }
          if (fitPoints.length > 1) {
            maybeFit(fitPoints);
          } else if (data.center) {
            var c = latLngOf(data.center);
            if (!lastPanLatLng || map.distance(lastPanLatLng, c) > 30) {
              lastPanLatLng = c;
              map.panTo(c, { animate: true });
            }
          }
        }
      };

      post({ type: 'ready' });
    </script>
  </body>
</html>
`;
}

// Constantes : un `[]` par défaut serait une nouvelle liste à chaque affichage et relancerait
// l'envoi vers la carte pour rien.
const NO_MARKERS: OSMMarker[] = [];
const NO_POLYLINE: LatLng[] = [];

export default function OSMMapView({
  center,
  markers = NO_MARKERS,
  polyline = NO_POLYLINE,
  secondaryPolyline = NO_POLYLINE,
  onPress,
  followMarkerId,
  fitMarkerIds,
  zoom,
}: Props) {
  const webViewRef = useRef<WebView>(null);
  // Le suivi automatique est suspendu quand l'utilisateur déplace la carte : un bouton propose
  // alors de recentrer. L'état vient de la carte (message `follow`).
  const [following, setFollowing] = useState(true);
  const sentPolylineKeyRef = useRef<string | null>(null);
  const sentPolyline2KeyRef = useRef<string | null>(null);
  // Clé stable : un tableau recréé à chaque affichage ne doit pas relancer l envoi vers la carte.
  const fitKey = fitMarkerIds ? fitMarkerIds.join("|") : "";

  const simplified = useMemo(() => decimate(polyline, MAX_POLYLINE_POINTS), [polyline]);
  const simplified2 = useMemo(() => decimate(secondaryPolyline, MAX_POLYLINE_POINTS), [secondaryPolyline]);

  const latestPayloadRef = useRef<MapPayload>({
    center: center ?? null,
    markers,
    polyline: simplified,
    polyline2: simplified2,
    follow: followMarkerId ?? null,
    fitIds: fitMarkerIds ?? null,
    zoom,
  });

  const htmlContent = useMemo(() => buildMapHtml(center), []);
  const source = useMemo(() => ({ html: htmlContent }), [htmlContent]);

  const inject = useCallback((payload: MapPayload, forcePolyline = false) => {
    const next = { ...payload };
    const key = polylineKey(payload.polyline ?? []);
    if (!forcePolyline && key === sentPolylineKeyRef.current) delete next.polyline;
    else sentPolylineKeyRef.current = key;
    const key2 = polylineKey(payload.polyline2 ?? []);
    if (!forcePolyline && key2 === sentPolyline2KeyRef.current) delete next.polyline2;
    else sentPolyline2KeyRef.current = key2;
    const json = JSON.stringify(next).replace(new RegExp("[\\u2028\\u2029]", "g"), (c) => "\\u" + c.charCodeAt(0).toString(16));
    webViewRef.current?.injectJavaScript(`window.updateMap && window.updateMap(${json}); true;`);
  }, []);

  useEffect(() => {
    const payload: MapPayload = {
      center: center ?? null,
      markers,
      polyline: simplified,
      polyline2: simplified2,
      follow: followMarkerId ?? null,
      fitIds: fitMarkerIds ?? null,
      zoom,
    };
    latestPayloadRef.current = payload;
    inject(payload);
  }, [center?.latitude, center?.longitude, markers, simplified, simplified2, followMarkerId, fitKey, zoom, inject]);

  const handleMessage = useCallback(
    (event: any) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === "ready") {
          sentPolylineKeyRef.current = null;
          sentPolyline2KeyRef.current = null;
          inject(latestPayloadRef.current, true);
        } else if (data.type === "follow") {
          setFollowing(!!data.value);
        } else if (data.type === "click" && onPress) {
          onPress({ latitude: data.latitude, longitude: data.longitude });
        }
      } catch {}
    },
    [inject, onPress]
  );

  const recenter = useCallback(() => {
    setFollowing(true);
    webViewRef.current?.injectJavaScript("window.recenter && window.recenter(); true;");
  }, []);

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={source}
        style={StyleSheet.absoluteFill}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        nestedScrollEnabled
      />
      {(!!followMarkerId || !!fitMarkerIds?.length) && !following && (
        <Pressable
          style={styles.recenter}
          onPress={recenter}
          accessibilityRole="button"
          accessibilityLabel="Recentrer la carte"
        >
          <MaterialIcons name="my-location" size={18} color="#1A73E8" />
          <Text style={styles.recenterText}>Recentrer</Text>
        </Pressable>
      )}
      <Text style={styles.attribution}>© OpenStreetMap contributors</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  attribution: {
    position: "absolute",
    top: 8,
    right: 8,
    overflow: "hidden",
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.88)",
    color: "#333",
    paddingHorizontal: 5,
    paddingVertical: 3,
    fontSize: 10,
  },
  recenter: {
    position: "absolute",
    right: 10,
    bottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  recenterText: { color: "#1A73E8", fontWeight: "700", fontSize: 12 },
});
