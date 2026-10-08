import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

export type LatLng = { latitude: number; longitude: number };

export type OSMMarker = {
  /** Identifiant stable : permet de faire glisser (animer) un marqueur qui bouge. */
  id?: string;
  coordinate: LatLng;
  title?: string;
  color?: "green" | "red" | "blue" | "orange";
  /** Cap en degrés (0 = nord) : fait pivoter la flèche du marqueur, comme Google Maps. */
  heading?: number;
};

type Props = {
  center?: LatLng;
  markers?: OSMMarker[];
  polyline?: LatLng[];
  onPress?: (coord: LatLng) => void;
  /**
   * Suivre ce marqueur (ex: "driver") comme le suivi live Google Maps :
   * la caméra reste centrée dessus, sans recadrage intempestif.
   */
  followMarkerId?: string;
  /** Zoom caméra en mode suivi (défaut : 16, niveau rue). */
  zoom?: number;
};

type MapPayload = {
  center?: LatLng | null;
  markers: OSMMarker[];
  polyline: LatLng[];
  follow?: string | null;
  zoom?: number;
};

/*
 * ⚠️ IMPORTANT : ce HTML est construit UNE SEULE FOIS (au montage), avec tout au plus
 * le centre initial dedans — il ne change plus jamais ensuite.
 *
 * Avant, le HTML était reconstruit avec la position dedans à chaque mise à jour GPS :
 * la WebView se rechargait entièrement (react-native-webview recharge quand `source`
 * change), et le marqueur ne bougeait jamais. Désormais, la carte est chargée une
 * seule fois et TOUTES les mises à jour passent par `window.updateMap(...)` en JS.
 */
function buildMapHtml(initial?: LatLng) {
  const startLat = initial?.latitude ?? 6.3703; // Cotonou par défaut
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
      var map = L.map('map', { zoomControl: false }).setView([${startLat}, ${startLng}], 14);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

      var markersLayer = L.layerGroup().addTo(map);
      var polylineLayer = L.layerGroup().addTo(map);
      var markerStore = {};   // id -> { marker, anim, lastIconKey }
      var polyline = null;
      var followId = null;
      var followZoom = 16;
      var followReady = false;
      var lastFitKey = null;
      var lastPanLatLng = null;

      map.on('click', function (e) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'click', latitude: e.latlng.lat, longitude: e.latlng.lng
        }));
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

      function buildIcon(m) {
        var needle = (typeof m.heading === 'number' && isFinite(m.heading))
          ? '<div class="needle" style="transform:translate(-50%,-50%) rotate(' + m.heading + 'deg)"></div>'
          : '';
        var label = m.title ? '<div class="label">' + esc(m.title) + '</div>' : '';
        return L.divIcon({
          className: '',
          html: '<div class="pin ' + colorClass(m.color) + '"><div class="dot"></div>' + needle + label + '</div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });
      }

      // Glissement animé du marqueur (comme Google Maps) au lieu d'une téléportation.
      function animateMarker(entry, to) {
        if (entry.anim) cancelAnimationFrame(entry.anim);
        var from = entry.marker.getLatLng();
        if (map.distance(from, to) > 2000) {
          // Saut trop grand (reprise de course, GPS erratique) : pas d'interpolation.
          entry.marker.setLatLng(to);
          return;
        }
        var t0 = performance.now();
        var dur = 800;
        function step(t) {
          var k = Math.min(1, (t - t0) / dur);
          var e = k * (2 - k); // ease-out
          entry.marker.setLatLng([
            from.lat + (to.lat - from.lat) * e,
            from.lng + (to.lng - from.lng) * e
          ]);
          if (k < 1) entry.anim = requestAnimationFrame(step);
          else entry.anim = null;
        }
        entry.anim = requestAnimationFrame(step);
      }

      function latLngOf(p) { return L.latLng(p.latitude, p.longitude); }

      // Recadrage prudent : uniquement si le cadre demandé change vraiment,
      // sinon la carte saute à chaque tick GPS.
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

        // --- Marqueurs : création / mise à jour / glissement animé ---
        var seen = {};
        if (data.markers) {
          for (i = 0; i < data.markers.length; i++) {
            m = data.markers[i];
            id = m.id || m.title || ('m' + i);
            seen[id] = true;
            entry = markerStore[id];
            if (!entry) {
              entry = {
                marker: L.marker(latLngOf(m.coordinate), { icon: buildIcon(m) }).addTo(markersLayer),
                anim: null,
                lastIconKey: null
              };
              markerStore[id] = entry;
            } else {
              var to = latLngOf(m.coordinate);
              // Ne glisse que si la position a réellement bougé (évite les micro-animations).
              if (map.distance(entry.marker.getLatLng(), to) > 0.5) animateMarker(entry, to);
            }
            var iconKey = (m.title || '') + '|' + (m.color || '') + '|' + (m.heading == null ? '' : Math.round(m.heading));
            if (iconKey !== entry.lastIconKey) {
              entry.lastIconKey = iconKey;
              entry.marker.setIcon(buildIcon(m));
            }
          }
        }
        for (id in markerStore) {
          if (!seen[id]) {
            if (markerStore[id].anim) cancelAnimationFrame(markerStore[id].anim);
            markersLayer.removeLayer(markerStore[id].marker);
            delete markerStore[id];
          }
        }

        // --- Tracé ---
        if (data.polyline && data.polyline.length > 1) {
          var latlngs = data.polyline.map(latLngOf);
          if (!polyline) polyline = L.polyline(latlngs, { color: '#6200EE', weight: 4 }).addTo(polylineLayer);
          else polyline.setLatLngs(latlngs);
        } else if (polyline) {
          polylineLayer.removeLayer(polyline);
          polyline = null;
        }

        // --- Caméra ---
        if ('follow' in data) followId = data.follow || null;
        if (typeof data.zoom === 'number' && isFinite(data.zoom)) followZoom = data.zoom;

        if (followId && markerStore[followId]) {
          // Mode suivi Google Maps : la caméra reste sur le véhicule, zoom stable.
          var target = markerStore[followId].marker.getLatLng();
          if (!followReady) {
            followReady = true;
            map.setView(target, followZoom, { animate: false });
          } else if (map.distance(map.getCenter(), target) > 3000) {
            map.setView(target, followZoom, { animate: true });
          } else if (map.distance(map.getCenter(), target) > 30) {
            map.panTo(target, { animate: true, duration: 0.6 });
          }
        } else {
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

      // Carte prête : React Native renverra la dernière position connue.
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
    </script>
  </body>
</html>
`;
}

export default function OSMMapView({
  center,
  markers = [],
  polyline = [],
  onPress,
  followMarkerId,
  zoom,
}: Props) {
  const webViewRef = useRef<WebView>(null);
  // Dernier état connu : rejoué quand la carte devient prête (course au chargement).
  const latestPayloadRef = useRef<MapPayload>({
    center: center ?? null,
    markers,
    polyline,
    follow: followMarkerId ?? null,
    zoom,
  });

  // HTML construit AU MONTAGE avec le centre initial, puis figé : `source` ne change
  // plus jamais → aucun rechargement de la WebView pendant le suivi.
  const htmlContent = useMemo(() => buildMapHtml(center), []); // eslint-disable-line react-hooks/exhaustive-deps
  const source = useMemo(() => ({ html: htmlContent }), [htmlContent]);

  const inject = useCallback((payload: MapPayload) => {
    // Les noms propres peuvent contenir des caractères spéciaux : JSON.stringify les échappe.
    // \u2028/\u2029 sont des fins de ligne en JS : on les neutralise par sécurité.
    const json = JSON.stringify(payload).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    webViewRef.current?.injectJavaScript(`window.updateMap && window.updateMap(${json}); true;`);
  }, []);

  useEffect(() => {
    const payload: MapPayload = { center: center ?? null, markers, polyline, follow: followMarkerId ?? null, zoom };
    latestPayloadRef.current = payload;
    inject(payload);
  }, [center?.latitude, center?.longitude, markers, polyline, followMarkerId, zoom, inject]);

  const handleMessage = useCallback(
    (event: any) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === "ready") {
          // La carte est chargée : on rejoue l'état courant (les injections
          // envoyées pendant le chargement de Leaflet ont été perdues).
          inject(latestPayloadRef.current);
        } else if (data.type === "click" && onPress) {
          onPress({ latitude: data.latitude, longitude: data.longitude });
        }
      } catch {}
    },
    [inject, onPress]
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={source}
        style={StyleSheet.absoluteFill}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
      />
    </View>
  );
}
