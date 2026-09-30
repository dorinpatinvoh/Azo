import React, { useRef, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

export type LatLng = { latitude: number; longitude: number };

export type OSMMarker = {
  coordinate: LatLng;
  title?: string;
  color?: "green" | "red" | "blue" | "orange";
};

type Props = {
  center?: LatLng;
  markers?: OSMMarker[];
  polyline?: LatLng[];
  onPress?: (coord: LatLng) => void;
};

export default function OSMMapView({ center, markers = [], polyline = [], onPress }: Props) {
  const webViewRef = useRef<WebView>(null);
  const defaultCenter = center || { latitude: 6.3703, longitude: 2.3912 }; // Cotonou par défaut

  // Code HTML / JavaScript embarquant OpenStreetMap Leaflet
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #f0f0f0; }
          .leaflet-control-attribution { display: none; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          const map = L.map('map', { zoomControl: false }).setView([${defaultCenter.latitude}, ${defaultCenter.longitude}], 14);
          
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
          }).addTo(map);

          let markersLayer = L.layerGroup().addTo(map);
          let polylineLayer = L.layerGroup().addTo(map);

          // Clic sur la carte
          map.on('click', function(e) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'click',
              latitude: e.latlng.lat,
              longitude: e.latlng.lng
            }));
          });

          // Fonctions appelées depuis React Native
          window.updateMap = function(data) {
            markersLayer.clearLayers();
            polylineLayer.clearLayers();

            const bounds = [];

            // Marqueurs
            if (data.markers) {
              data.markers.forEach(m => {
                const marker = L.marker([m.coordinate.latitude, m.coordinate.longitude]).addTo(markersLayer);
                if (m.title) marker.bindPopup(m.title);
                bounds.push([m.coordinate.latitude, m.coordinate.longitude]);
              });
            }

            // Tracé / Polyline
            if (data.polyline && data.polyline.length > 1) {
              const latlngs = data.polyline.map(p => [p.latitude, p.longitude]);
              L.polyline(latlngs, { color: '#6200EE', weight: 4 }).addTo(polylineLayer);
              data.polyline.forEach(p => bounds.push([p.latitude, p.longitude]));
            }

            // Recadrer la vue sur les points
            if (bounds.length > 1) {
              map.fitBounds(bounds, { padding: [50, 50] });
            } else if (data.center) {
              map.panTo([data.center.latitude, data.center.longitude]);
            }
          };
        </script>
      </body>
    </html>
  `;

  // Met à jour la carte en direct quand les coordonnées changent
  useEffect(() => {
    const payload = JSON.stringify({ center, markers, polyline });
    webViewRef.current?.injectJavaScript(`window.updateMap && window.updateMap(${payload}); true;`);
  }, [center?.latitude, center?.longitude, markers, polyline]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "click" && onPress) {
        onPress({ latitude: data.latitude, longitude: data.longitude });
      }
    } catch {}
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: htmlContent }}
        style={StyleSheet.absoluteFill}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
      />
    </View>
  );
}