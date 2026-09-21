import { useState } from "react";
import { MapPin, MapPinOff, Search, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import MapModal from "../sites/MapModal";
import { geocodingApi } from "../../lib/api";

/**
 * Setting a site's location from inside the agent.
 *
 * A site with no coordinates has no geofence: the clock-in check lets anyone in
 * from anywhere. The site form makes the location hard to skip because the map
 * is on the page; the agent had no map, so every site it created was quietly
 * unfenced. This brings the form's three ways of placing a site into the
 * conversation:
 *
 *   - search an address  (forward-geocoded, like the form)
 *   - pick on the map    (the form's own MapModal)
 *   - use my location    (inside that same map)
 *
 * Every route ends on the map. A searched address is a starting point, not an
 * answer — geocoders can be hundreds of metres out on an informal address, and
 * a geofence drawn around the wrong point turns employees away at the real
 * site. So the admin always sees the pin, and the radius, before it is used.
 *
 * The result goes back into the pending change, which is re-previewed; nothing
 * is saved until that new preview is confirmed. The picker works in kilometres
 * like the form; the server stores metres.
 */

const toFields = (picked) => ({
  latitude: String(picked.latitude),
  longitude: String(picked.longitude),
  geoFenceRadius: String(Math.round(Number(picked.geoFenceRadius) * 1000)),
  address: picked.address || "",
  townSuburb: picked.townSuburb || "",
  state: picked.state || "",
  postalCode: picked.postalCode || "",
});

export default function SiteLocationControl({ location, geofence, disabled = false, onSet }) {
  const [start, setStart] = useState(null); // where the map opens; null = closed
  const [query, setQuery] = useState(
    [location?.address, location?.townSuburb].filter(Boolean).join(", ")
  );
  const [finding, setFinding] = useState(false);
  const [problem, setProblem] = useState("");

  if (!location) return null;

  const isSet = location.latitude != null && location.longitude != null;

  const openAt = (overrides = {}) =>
    setStart({
      latitude: location.latitude ?? undefined,
      longitude: location.longitude ?? undefined,
      address: location.address,
      townSuburb: location.townSuburb,
      state: location.state,
      postalCode: location.postalCode,
      ...overrides,
    });

  const findAddress = async () => {
    const q = query.trim();
    if (!q || finding) return;
    setProblem("");
    setFinding(true);
    try {
      // No country filter, as in the site form: sites are in Australia and
      // India, and a query is better answered than guessed at.
      const response = await geocodingApi.search(q, "", 1);
      const hit = (response.data?.data || [])[0];
      if (!hit) {
        setProblem("Could not find that address. Open the map and drop the pin instead.");
        return;
      }
      const a = hit.address || {};
      openAt({
        latitude: parseFloat(hit.lat),
        longitude: parseFloat(hit.lon),
        address: a.road || a.street || hit.display_name?.split(",")[0] || q,
        townSuburb: a.suburb || a.town || a.city || a.village || "",
        state: a.state || "",
        postalCode: a.postcode || "",
      });
    } catch (error) {
      setProblem(
        error.response?.data?.message || "Address search is unavailable. Open the map and drop the pin instead."
      );
    } finally {
      setFinding(false);
    }
  };

  return (
    <div className={`agent-geofence ${isSet ? "is-set" : "is-unset"}`}>
      <div className="agent-geofence-status">
        {isSet ? <MapPin size={13} /> : <MapPinOff size={13} />}
        <span>
          <strong>Geofence</strong>
          {geofence || (isSet ? "Set" : "Not set: employees can clock in from anywhere")}
        </span>
      </div>

      <form
        className="agent-geofence-search"
        onSubmit={(e) => {
          e.preventDefault();
          findAddress();
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the site's address"
          aria-label="Search the site's address"
          disabled={disabled || finding}
        />
        <Button type="submit" variant="outline" size="sm" disabled={disabled || finding || !query.trim()}>
          {finding ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          Find
        </Button>
      </form>

      <Button
        type="button"
        variant={isSet ? "outline" : "default"}
        size="sm"
        disabled={disabled}
        onClick={() => openAt()}
      >
        {isSet ? "Adjust on map" : "Pick on map or use my location"}
      </Button>

      {problem && <p className="agent-geofence-problem">{problem}</p>}

      {start && (
        <MapModal
          initLatitude={start.latitude}
          initLongitude={start.longitude}
          initAddress={start.address}
          initState={start.state}
          initTownSuburb={start.townSuburb}
          initPostalCode={start.postalCode}
          initGeoFenceRadius={(location.geoFenceRadius || 300) / 1000}
          onClose={() => setStart(null)}
          onSave={(picked) => onSet?.(toFields(picked), "Set the site's location on the map.")}
        />
      )}
    </div>
  );
}
