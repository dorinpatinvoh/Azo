import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, UrlTile, type MapPressEvent, type Region } from "react-native-maps";
import { MaterialIcons } from "@expo/vector-icons";

export type LatLng = { latitude: number; longitude: number };

export type OSMMarker = {
  id?: string;
  coordinate: LatLng;
  title?: string;
  color?: "green" | "red" | "blue" | "orange";
  heading?: number;
};

type Props = {
  center?: LatLng;
  markers?: OSMMarker[];
  polyline?: LatLng[];
  onPress?: (coordinate: LatLng) => void;
  followMarkerId?: string;
  zoom?: number;
};

const DEFAULT_CENTER: LatLng = { latitude: 6.3703, longitude: 2.3912 };
const MAP_DELTA = 0.02;
const MARKER_COLORS: Record<NonNullable<OSMMarker["color"]>, string> = {
  green: "#1E8E3E",
  red: "#D93025",
  blue: "#1A73E8",
  orange: "#F9AB00",
};

function regionAt(center: LatLng, zoom = 14): Region {
  const delta = Math.min(60, Math.max(0.002, 360 / 2 ** zoom));
  return { ...center, latitudeDelta: delta, longitudeDelta: delta };
}

export default function TrackingMap({
  center,
  markers = [],
  polyline = [],
  onPress,
  followMarkerId,
  zoom,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const fittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const initialRegion = useMemo(() => regionAt(center ?? DEFAULT_CENTER), []);

  const handlePress = useCallback(
    (event: MapPressEvent) => onPress?.(event.nativeEvent.coordinate),
    [onPress],
  );

  const followMarker = markers.find((marker) => marker.id === followMarkerId);
  const fitCoordinates = useMemo(() => {
    const points = [...markers.map((marker) => marker.coordinate), ...polyline];
    const unique = new Map(points.map((point) => [`${point.latitude},${point.longitude}`, point]));
    return [...unique.values()];
  }, [markers, polyline]);

  useEffect(() => {
    if (!mapReady || followMarker) return;
    if (!fittedRef.current && fitCoordinates.length >= 2) {
      mapRef.current?.fitToCoordinates(fitCoordinates, {
        edgePadding: { top: 80, right: 48, bottom: 80, left: 48 },
        animated: true,
      });
      fittedRef.current = true;
      return;
    }
    if (center && fittedRef.current === false) {
      mapRef.current?.animateToRegion(regionAt(center, zoom), 250);
    }
  }, [center?.latitude, center?.longitude, fitCoordinates, followMarker, mapReady, zoom]);

  useEffect(() => {
    if (!mapReady || !followMarker) return;
    mapRef.current?.animateCamera(
      { center: followMarker.coordinate, zoom: zoom ?? 16 },
      { duration: 500 },
    );
  }, [
    followMarker?.coordinate.latitude,
    followMarker?.coordinate.longitude,
    mapReady,
    zoom,
  ]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        mapType={Platform.OS === "android" ? "none" : "standard"}
        onMapReady={() => setMapReady(true)}
        onPress={handlePress}
        rotateEnabled
        showsCompass
        showsBuildings={false}
        showsTraffic={false}
      >
        <UrlTile
          urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
          tileSize={256}
          shouldReplaceMapContent
        />
        {markers.map((marker, index) => {
          const color = MARKER_COLORS[marker.color ?? "blue"];
          const key = marker.id ?? marker.title ?? `marker-${index}`;
          return (
            <Marker
              key={key}
              identifier={key}
              coordinate={marker.coordinate}
              title={marker.title}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View style={[styles.marker, { backgroundColor: color }]}>
                <MaterialIcons
                  name={marker.id === "driver" ? "two-wheeler" : "place"}
                  size={marker.id === "driver" ? 22 : 20}
                  color="#fff"
                  style={
                    marker.id === "driver" && typeof marker.heading === "number"
                      ? { transform: [{ rotate: `${marker.heading}deg` }] }
                      : undefined
                  }
                />
              </View>
            </Marker>
          );
        })}
        {polyline.length >= 2 && (
          <Polyline
            coordinates={polyline}
            strokeColor="#0B7A53"
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
        )}
      </MapView>
      <Text style={styles.attribution}>© OpenStreetMap contributors</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  marker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 3,
  },
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
});
