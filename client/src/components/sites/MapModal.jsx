import Modal from "../ui/Modal";
import { useEffect, useState, useRef } from "react";
import { X, MapPin, Maximize2, Navigation, Loader2 } from "lucide-react";
import { Input } from "../ui/Input";
import { StateInput } from "../ui/StateInput";
import { STATE_GROUPS } from "../../constants/locations";
import toast from "react-hot-toast";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { geocodingApi } from "../../lib/api";

// Leaflet's default marker icon breaks under Vite because the bundler can't
// resolve the relative image URLs baked into leaflet's CSS. Rebind them to
// the unpkg CDN copies so the pin renders correctly.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const TILES = {
  roadmap: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
  },
};

/**
 * Child helper: keeps the imperative Leaflet map in sync with our React
 * state (recenter when `coords` changes, invalidateSize on fullscreen toggle).
 * Also captures clicks on the map surface to move the marker.
 */
function MapController({ coords, onMapClick, fullscreenTick }) {
  const map = useMap();

  useEffect(() => {
    map.setView([coords.lat, coords.lng]);
  }, [coords.lat, coords.lng, map]);

  useEffect(() => {
    // Wait for the container transition to settle, then reflow tiles.
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(t);
  }, [fullscreenTick, map]);

  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });

  return null;
}

export default function MapModal({
  onClose,
  onSave,
  initLatitude,
  initLongitude,
  initAddress,
  initState,
  initTownSuburb,
  initPostalCode,
  initGeoFenceRadius,
}) {
  const [mapView, setMapView] = useState("roadmap");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenTick, setFullscreenTick] = useState(0);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const [address, setAddress] = useState(initAddress || "");
  const [state, setState] = useState(initState || "");
  const [townSuburb, setTownSuburb] = useState(initTownSuburb || "");
  const [postalCode, setPostalCode] = useState(initPostalCode || "");
  const [geoFenceRadius, setGeoFenceRadius] = useState(
    initGeoFenceRadius || 0.3,
  );
  const [coords, setCoords] = useState({
    lat: initLatitude ? parseFloat(initLatitude) : -33.8688,
    lng: initLongitude ? parseFloat(initLongitude) : 151.2093,
  });

  const markerRef = useRef(null);
  const radiusMeters = geoFenceRadius * 1000;

  // Nominatim can return the state as a full name; match against AU + IN
  // presets, otherwise return the raw string so <StateInput> shows custom mode.
  const mapStateToCode = (stateName) => {
    if (!stateName) return "";
    const needle = String(stateName).toLowerCase();
    for (const group of STATE_GROUPS) {
      const byName = group.options.find((s) => s.name.toLowerCase() === needle);
      if (byName) return byName.code;
      const byCode = group.options.find((s) => s.code.toLowerCase() === needle);
      if (byCode) return byCode.code;
    }
    return stateName;
  };

  const reverseGeocode = async (lat, lng) => {
    setGeocoding(true);
    try {
      const response = await geocodingApi.reverse(lat, lng);
      const data = response.data?.data;
      if (!data) throw new Error("No address found");

      const addr = data.address || {};
      if (addr.road || addr.street) setAddress(addr.road || addr.street);
      if (addr.suburb || addr.town || addr.city) {
        setTownSuburb(addr.suburb || addr.town || addr.city);
      }
      if (addr.state) setState(mapStateToCode(addr.state));
      if (addr.postcode) setPostalCode(addr.postcode);

      toast.success("Address updated from location");
    } catch (error) {
      console.error("Reverse geocoding error:", error);
      const msg = error.response?.data?.message || error.message;
      if (msg?.toLowerCase().includes("rate")) {
        toast.error("Address lookup rate-limited. Please wait a moment.");
      } else {
        console.warn("Auto-fill disabled - you can still enter the address manually");
      }
    } finally {
      setGeocoding(false);
    }
  };

  const handleMapClick = (lat, lng) => {
    setCoords({ lat, lng });
    reverseGeocode(lat, lng);
  };

  const handleMarkerDragEnd = (e) => {
    const { lat, lng } = e.target.getLatLng();
    setCoords({ lat, lng });
    reverseGeocode(lat, lng);
  };

  const handleLiveLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser");
      return;
    }

    // Modern browsers refuse geolocation on non-HTTPS pages unless served
    // from localhost. Catching this up-front avoids a confusing generic
    // failure with no hint how to proceed.
    if (window.isSecureContext === false) {
      toast.error("Location is only available on HTTPS or localhost");
      return;
    }

    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setCoords({ lat, lng });
        reverseGeocode(lat, lng);
        setGettingLocation(false);
        toast.success("Location updated");
      },
      (error) => {
        setGettingLocation(false);
        let msg;
        if (error.code === error.PERMISSION_DENIED) {
          msg = "Location permission denied. Enable it in your browser settings.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          msg = "Your device could not determine a location right now.";
        } else if (error.code === error.TIMEOUT) {
          msg = "The location request timed out. Try again.";
        } else {
          const reason = error?.message ? ` (${error.message})` : "";
          msg = `Could not get your location${reason}. Drag the pin to set it manually.`;
        }
        toast.error(msg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const handleKeepChanges = () => {
    onSave({
      latitude: coords.lat.toFixed(6),
      longitude: coords.lng.toFixed(6),
      address,
      state,
      townSuburb,
      postalCode,
      geoFenceRadius,
    });
    onClose();
  };

  // Bump this counter whenever fullscreen changes so MapController re-runs
  // invalidateSize() after the container transitions.
  useEffect(() => {
    setFullscreenTick((n) => n + 1);
  }, [isFullscreen]);

  const tile = TILES[mapView];

  return (
    <Modal onClose={onClose} label="Site map">
      <div
        className={`modal-surface flex flex-col transition-all ${
          isFullscreen
            ? "w-full h-full rounded-none"
            : "w-full h-full sm:h-auto sm:max-w-4xl sm:rounded-lg"
        } shadow-2xl`}
      >
        {/* Header */}
        <div className="modal-header flex items-center justify-between px-4 sm:px-5 py-3 sm:py-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 sm:w-4 sm:h-4" />
            <span className="font-semibold text-base sm:text-sm">
              {onSave ? "Site Map" : "View Site Location"}
            </span>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="text-[hsl(var(--color-foreground-secondary))] hover:text-[hsl(var(--color-foreground))] transition-colors p-1 touch-manipulation"
          >
            <X className="w-6 h-6 sm:w-4 sm:h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col overflow-y-auto flex-1 p-3 sm:p-5 gap-3 sm:gap-4">
          {/* Action Buttons */}
          <div className="flex justify-end gap-2 sm:gap-3">
            {onSave && (
              <button
                onClick={handleKeepChanges}
                className="px-4 sm:px-5 py-2.5 sm:py-2 bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))] text-sm sm:text-sm rounded hover:bg-[hsl(var(--color-primary-hover))] transition-colors font-medium touch-manipulation flex-1 sm:flex-none"
              >
                Keep Changes
              </button>
            )}
            <button
              type="button"
              aria-label="Close dialog"
              onClick={onClose}
              className="px-4 sm:px-5 py-2.5 sm:py-2 bg-[hsl(var(--color-card))] text-[hsl(var(--color-foreground-secondary))] text-sm sm:text-sm rounded border border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-card))] transition-colors font-medium touch-manipulation flex-1 sm:flex-none"
            >
              {onSave ? "Cancel" : "Close"}
            </button>
          </div>

          {/* Address Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-x-6 sm:gap-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <label className="text-sm text-[hsl(var(--color-foreground-secondary))] sm:w-24 flex-shrink-0 font-medium">
                Address
              </label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Enter a location"
                className="flex-1"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <label className="text-sm text-[hsl(var(--color-foreground-secondary))] sm:w-24 flex-shrink-0 font-medium">
                State
              </label>
              <StateInput
                value={state}
                onChange={setState}
                className="flex-1"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <label className="text-sm text-[hsl(var(--color-foreground-secondary))] sm:w-24 flex-shrink-0 font-medium">
                Town/Suburb
              </label>
              <Input
                value={townSuburb}
                onChange={(e) => setTownSuburb(e.target.value)}
                className="flex-1"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <label className="text-sm text-[hsl(var(--color-foreground-secondary))] sm:w-24 flex-shrink-0 font-medium">
                Postal Code
              </label>
              <Input
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                className="flex-1"
              />
            </div>
          </div>

          {/* GeoFence Slider */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-2">
              GeoFence Area
            </label>
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="text-xs sm:text-xs bg-[hsl(var(--color-foreground))] text-[hsl(var(--color-background))] px-2 py-1 rounded whitespace-nowrap">
                {geoFenceRadius.toFixed(1)} km
              </span>
              <div className="flex-1 relative">
                <input
                  type="range"
                  min="0.1"
                  max="5"
                  step="0.1"
                  value={geoFenceRadius}
                  onChange={(e) => setGeoFenceRadius(parseFloat(e.target.value))}
                  className="w-full h-2 sm:h-2 rounded-lg appearance-none cursor-pointer touch-manipulation"
                  style={{
                    background: `linear-gradient(to right, #dc2626 0%, #dc2626 ${
                      ((geoFenceRadius - 0.1) / 4.9) * 100
                    }%, #d1d5db ${
                      ((geoFenceRadius - 0.1) / 4.9) * 100
                    }%, #d1d5db 100%)`,
                  }}
                />
                <div className="hidden sm:flex justify-between text-[10px] text-[hsl(var(--color-foreground-muted))] mt-1 px-0.5">
                  <span>0.1</span>
                  <span>1.3</span>
                  <span>2.6</span>
                  <span>3.8</span>
                  <span>5</span>
                </div>
              </div>
              <span className="hidden sm:inline text-xs bg-[hsl(var(--color-surface-elevated))] text-[hsl(var(--color-foreground-secondary))] px-2 py-0.5 rounded border border-[hsl(var(--color-border))] whitespace-nowrap">
                5 km
              </span>
            </div>
          </div>

          {/* Map */}
          <div className="border border-[hsl(var(--color-border))] rounded overflow-hidden flex flex-col flex-1 min-h-[300px] sm:min-h-[340px] relative">
            {/* Map/Satellite Toggle */}
            <div className="absolute top-3 sm:top-2 left-3 sm:left-2 z-[1000] flex border border-[hsl(var(--color-border))] rounded overflow-hidden shadow-md bg-[hsl(var(--color-card))]">
              <button
                onClick={() => setMapView("roadmap")}
                className={`px-4 py-2 sm:px-3 sm:py-1 text-sm sm:text-xs font-medium transition-colors touch-manipulation ${
                  mapView === "roadmap"
                    ? "bg-[hsl(var(--color-card))] text-[hsl(var(--color-foreground))]"
                    : "bg-[hsl(var(--color-surface-elevated))] text-[hsl(var(--color-foreground-secondary))] hover:bg-[hsl(var(--color-card))]"
                }`}
              >
                Map
              </button>
              <button
                onClick={() => setMapView("satellite")}
                className={`px-4 py-2 sm:px-3 sm:py-1 text-sm sm:text-xs font-medium transition-colors border-l border-[hsl(var(--color-border))] touch-manipulation ${
                  mapView === "satellite"
                    ? "bg-[hsl(var(--color-card))] text-[hsl(var(--color-foreground))]"
                    : "bg-[hsl(var(--color-surface-elevated))] text-[hsl(var(--color-foreground-secondary))] hover:bg-[hsl(var(--color-card))]"
                }`}
              >
                Satellite
              </button>
            </div>

            {/* Live Location Button */}
            <button
              onClick={handleLiveLocation}
              disabled={gettingLocation || geocoding}
              className="absolute top-14 sm:top-2 left-3 sm:left-1/2 sm:-translate-x-1/2 z-[1000] bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded px-4 py-2 sm:px-3 sm:py-1.5 shadow-md hover:bg-[hsl(var(--color-card))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 touch-manipulation"
              title="Get my current location"
            >
              {gettingLocation || geocoding ? (
                <>
                  <Loader2 className="w-5 h-5 sm:w-4 sm:h-4 text-[hsl(var(--color-info))] animate-spin" />
                  <span className="text-sm sm:text-xs font-medium text-[hsl(var(--color-foreground-secondary))] whitespace-nowrap">
                    {gettingLocation ? "Getting..." : "Loading..."}
                  </span>
                </>
              ) : (
                <>
                  <Navigation className="w-5 h-5 sm:w-4 sm:h-4 text-[hsl(var(--color-info))]" />
                  <span className="text-sm sm:text-xs font-medium text-[hsl(var(--color-foreground-secondary))] whitespace-nowrap">
                    Use My Location
                  </span>
                </>
              )}
            </button>

            {/* Fullscreen button - Desktop only */}
            <button
              onClick={() => setIsFullscreen((v) => !v)}
              className="hidden sm:block absolute top-2 right-2 z-[1000] bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded p-1 shadow-sm hover:bg-[hsl(var(--color-card))] transition-colors"
            >
              <Maximize2 className="w-4 h-4 text-[hsl(var(--color-foreground-secondary))]" />
            </button>

            <div
              style={{
                height: isFullscreen
                  ? "calc(100vh - 320px)"
                  : window.innerWidth < 640
                    ? "300px"
                    : "380px",
                width: "100%",
              }}
            >
              <MapContainer
                center={[coords.lat, coords.lng]}
                zoom={15}
                style={{ height: "100%", width: "100%" }}
                scrollWheelZoom
              >
                <TileLayer
                  key={mapView}
                  url={tile.url}
                  attribution={tile.attribution}
                  maxZoom={tile.maxZoom}
                />
                <Marker
                  position={[coords.lat, coords.lng]}
                  draggable
                  ref={markerRef}
                  eventHandlers={{ dragend: handleMarkerDragEnd }}
                />
                <Circle
                  center={[coords.lat, coords.lng]}
                  radius={radiusMeters}
                  pathOptions={{
                    color: "#dc2626",
                    weight: 2,
                    opacity: 0.8,
                    fillColor: "#dc2626",
                    fillOpacity: 0.15,
                  }}
                />
                <MapController
                  coords={coords}
                  onMapClick={handleMapClick}
                  fullscreenTick={fullscreenTick}
                />
              </MapContainer>
            </div>
          </div>

          {/* Coordinates hint */}
          <p className="text-xs sm:text-xs text-[hsl(var(--color-foreground-muted))] text-center -mt-2 px-2">
            <span className="hidden sm:inline">
              Click on the map or drag the marker to set the site location &mdash;{" "}
            </span>
            <span className="font-mono text-[10px] sm:text-xs">
              {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
            </span>
          </p>
        </div>
      </div>
    </Modal>
  );
}
