import Modal from "../ui/Modal";
import { useState, useEffect } from "react";
import {
  X,
  MapPin,
  Save,
  Users,
  Key,
  Info,
  Target,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { LocationAutocomplete } from "../ui/LocationAutocomplete";
import { StateInput } from "../ui/StateInput";
import { siteApi, clientApi, geocodingApi } from "../../lib/api";
import staticClients from "../../data/clients";
import MapModal from "./MapModal";
import AccessCodesManager from "./AccessCodesManager";
import { STATE_GROUPS, INDIAN_STATES, SUPPORTED_TIMEZONES } from "../../constants/locations";

export default function AddSiteModal({ onClose, onSuccess, site = null }) {
  const [activeTab, setActiveTab] = useState("address");
  // DB stores geoFenceRadius in meters; slider/UI uses km
  const [geoFenceRadius, setGeoFenceRadius] = useState(
    site?.geoFenceRadius ? site.geoFenceRadius / 1000 : 0.3,
  );
  // API state
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [clients, setClients] = useState(staticClients);

  // Map / geocoding state
  const [showWarning, setShowWarning] = useState(false);
  const [warningMessage, setWarningMessage] = useState("");
  const [showMapModal, setShowMapModal] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const [formData, setFormData] = useState({
    siteLocationName: site?.siteLocationName || "",
    shortName: site?.shortName || "",
    jobRefNo: site?.jobRefNo || "",
    status:
      site?.status === "ACTIVE"
        ? "Active"
        : site?.status === "INACTIVE"
          ? "Inactive"
          : "Active",
    client: site?.client || "",
    flatBillingRate: site?.flatBillingRate || "",
    exportId: site?.exportId || "",
    region: site?.region || "",
    address: site?.address || "",
    state: site?.state || "",
    townSuburb: site?.townSuburb || "",
    postalCode: site?.postalCode || "",
    timezone: site?.timezone || "Australia/Sydney",
    latitude: site?.latitude || "",
    longitude: site?.longitude || "",
    contactPerson: site?.contactPerson || "",
    contactPosition: site?.contactPosition || "",
    contactPhone: site?.contactPhone || "",
    contactMobile: site?.contactMobile || "",
    contactEmail: site?.contactEmail || "",
    contactNotes: site?.contactNotes || "",
  });

  // Fetch clients on mount
  useEffect(() => {
    const fetchClients = async () => {
      try {
        const response = await clientApi.getAll({ limit: 100 });
        const clientsData =
          response.data.data?.clients || response.data.data || response.data;

        if (Array.isArray(clientsData) && clientsData.length > 0) {
          setClients(clientsData);
        }
      } catch (err) {
        console.warn("Failed to fetch clients, using static data:", err);
        // Keep static clients as fallback
      }
    };

    fetchClients();
  }, []);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const showWarningDialog = (message) => {
    setWarningMessage(message);
    setShowWarning(true);
  };

  // Push a geocoded result (from forward-search OR reverse from geolocation)
  // into the form fields. Same mapping used by both entry points, so the
  // resulting UX is identical whether the user typed an address or let the
  // browser share their location.
  //
  // `displayName` is optional — used as fallback for Address when Nominatim
  // returns empty road/street (e.g. locality-level matches inside business
  // parks like "GP Block, Sector V, Bidhannagar…").
  const applyGeocodeResult = (lat, lon, address, displayName) => {
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

    handleInputChange("latitude", parseFloat(lat).toFixed(6));
    handleInputChange("longitude", parseFloat(lon).toFixed(6));

    if (!address) return;

    const suburbValue =
      address.suburb || address.town || address.city || "";
    const roadValue = (address.road || address.street || "").trim();

    // Address fallback: if Nominatim didn't return a road, use the first
    // display_name segment that isn't the same as the suburb. Keeps the
    // input from being blank on locality-level hits.
    let addressToSet = roadValue;
    if (!addressToSet && displayName) {
      const parts = String(displayName)
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const firstMeaningful = parts.find(
        (p) => p.toLowerCase() !== suburbValue.toLowerCase(),
      );
      if (firstMeaningful) addressToSet = firstMeaningful;
    }
    if (addressToSet) {
      handleInputChange("address", addressToSet);
    }

    if (suburbValue) {
      handleInputChange("townSuburb", suburbValue);
    }
    if (address.state) {
      const stateCode = mapStateToCode(address.state);
      handleInputChange("state", stateCode);

      // AU state → AU zone; Indian state (by code OR name) → IST.
      const timezoneMap = {
        NSW: 'Australia/Sydney',
        VIC: 'Australia/Melbourne',
        QLD: 'Australia/Brisbane',
        SA: 'Australia/Adelaide',
        WA: 'Australia/Perth',
        TAS: 'Australia/Hobart',
        NT: 'Australia/Darwin',
        ACT: 'Australia/Canberra',
      };
      const isIndianState = (s) => {
        if (!s) return false;
        const needle = String(s).toLowerCase();
        return INDIAN_STATES.some(
          (i) => i.code.toLowerCase() === needle || i.name.toLowerCase() === needle,
        );
      };
      if (stateCode && timezoneMap[stateCode]) {
        handleInputChange("timezone", timezoneMap[stateCode]);
      } else if (isIndianState(stateCode)) {
        handleInputChange("timezone", 'Asia/Kolkata');
      }
    }
    if (address.postcode) {
      handleInputChange("postalCode", address.postcode);
    }
  };

  const handleGetMapAddress = async () => {
    const addressParts = [
      formData.address,
      formData.townSuburb,
      formData.state,
      formData.postalCode,
    ]
      .filter(Boolean)
      .join(", ");

    // No address typed → use the browser's geolocation and reverse-geocode.
    // This matches the intuitive read of the button label ("get my map address").
    if (!addressParts.trim()) {
      if (!navigator.geolocation) {
        showWarningDialog(
          "Your browser does not support geolocation. Please type an address instead.",
        );
        return;
      }

      // Some browsers (particularly mobile with intermittent GPS) will fire
      // the success callback with a cached fix and then still fire the error
      // callback when the high-accuracy fetch times out. Guard both so only
      // whichever arrives first actually runs.
      let settled = false;
      setGeocoding(true);
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          if (settled) return;
          settled = true;
          try {
            const { latitude, longitude } = position.coords;
            const response = await geocodingApi.reverse(latitude, longitude);
            const result = response.data?.data;
            if (!result) {
              showWarningDialog(
                "Could not resolve your current location to an address. Try typing the address instead.",
              );
              return;
            }
            applyGeocodeResult(latitude, longitude, result.address, result.display_name);
            toast.success("Filled from your current location");
          } catch (error) {
            console.error("Reverse geocoding error:", error);
            showWarningDialog(
              error.response?.data?.message ||
                "Failed to resolve your current location. Please try again.",
            );
          } finally {
            setGeocoding(false);
          }
        },
        (error) => {
          if (settled) return;
          settled = true;
          setGeocoding(false);
          let msg = "Failed to get your location";
          if (error.code === error.PERMISSION_DENIED) {
            msg = "Location permission denied. Enable it or type the address instead.";
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            msg = "Location information unavailable";
          } else if (error.code === error.TIMEOUT) {
            msg = "Location request timed out";
          }
          showWarningDialog(msg);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
      return;
    }

    // Address typed → forward-geocode and apply the top result.
    setGeocoding(true);
    try {
      // No country filter — the app supports both AU and IN (and Nominatim
      // covers everywhere else too if a user types a foreign address).
      const response = await geocodingApi.search(addressParts, "", 1);
      const data = response.data.data || [];

      if (data && data.length > 0) {
        const result = data[0];
        applyGeocodeResult(result.lat, result.lon, result.address, result.display_name);
        toast.success("Location details updated from address");
      } else {
        showWarningDialog(
          "Could not find coordinates for the entered address. Please check the address and try again.",
        );
      }
    } catch (error) {
      console.error("Geocoding error:", error);
      showWarningDialog(
        error.response?.data?.message || "Failed to fetch coordinates. Please try again.",
      );
    } finally {
      setGeocoding(false);
    }
  };

  const handleMapSave = ({ latitude, longitude, address, state, townSuburb, postalCode, geoFenceRadius: radius }) => {
    handleInputChange("latitude", latitude);
    handleInputChange("longitude", longitude);
    if (address !== undefined) handleInputChange("address", address);
    if (state !== undefined) handleInputChange("state", state);
    if (townSuburb !== undefined) handleInputChange("townSuburb", townSuburb);
    if (postalCode !== undefined) handleInputChange("postalCode", postalCode);
    if (radius !== undefined) setGeoFenceRadius(radius);
    toast.success("Location updated from map");
  };

  const handleSave = async () => {
    try {
      setSubmitting(true);
      setErrors({});

      // Build request payload from formData
      const payload = {
        ...formData,
        // Convert string values to appropriate types
        flatBillingRate: formData.flatBillingRate
          ? parseFloat(formData.flatBillingRate)
          : null,
        latitude: formData.latitude ? parseFloat(formData.latitude) : null,
        longitude: formData.longitude ? parseFloat(formData.longitude) : null,
        geoFenceRadius: Math.round(geoFenceRadius * 1000), // convert km → meters for DB
        status: formData.status === "Active" ? "ACTIVE" : "INACTIVE",
      };

      let response;
      if (site) {
        // Update existing site
        response = await siteApi.update(site.id, payload);
      } else {
        // Create new site
        response = await siteApi.create(payload);
      }

      onClose();
      if (onSuccess) onSuccess();
    } catch (err) {
      const apiErrors = err.response?.data?.errors;
      if (apiErrors) {
        setErrors(apiErrors);
      }
      toast.error(
        err.response?.data?.message ||
          `Failed to ${site ? "update" : "create"} site`,
      );
    } finally {
      setSubmitting(false);
    }
  };



  return (
    <Modal onClose={onClose} label="Site details">
      <div
        className="modal-surface bg-[hsl(var(--color-card))] rounded-lg w-full max-w-7xl my-4 flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div
          className="modal-header flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4 border-b border-[hsl(var(--color-border))] gap-2 flex-wrap bg-[hsl(var(--color-surface-elevated))] rounded-t-lg"
        >
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 sm:w-5 sm:h-5 text-[hsl(var(--color-foreground-secondary))]" />
            <h2 className="text-base sm:text-lg font-semibold text-[hsl(var(--color-foreground))]">
              {site ? "Edit Site" : "Site Details"}
            </h2>
          </div>

          <button type="button" onClick={onClose} aria-label="Close site form" className="icon-button">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto">
          <div className="p-6">
            {/* Site Details Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                  Site/Location Name
                </label>
                <Input
                  value={formData.siteLocationName}
                  onChange={(e) =>
                    handleInputChange("siteLocationName", e.target.value)
                  }
                  placeholder=""
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                  Short Name
                </label>
                <Input
                  value={formData.shortName}
                  onChange={(e) =>
                    handleInputChange("shortName", e.target.value)
                  }
                  placeholder=""
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                  Job Ref No.
                </label>
                <Input
                  value={formData.jobRefNo}
                  onChange={(e) =>
                    handleInputChange("jobRefNo", e.target.value)
                  }
                  placeholder=""
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                  Status
                </label>
                <Select
                  value={formData.status}
                  onChange={(e) => handleInputChange("status", e.target.value)}
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                  Client
                </label>
                <Select
                  value={formData.client}
                  onChange={(e) => handleInputChange("client", e.target.value)}
                >
                  <option value="">Select Client</option>
                  {clients.map((client, index) => (
                    <option key={client.id || client._id || `client-${index}`} value={client.clientName}>
                      {client.clientName}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                  Flat Billing Rate
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--color-foreground-muted))]">
                    $
                  </span>
                  <Input
                    className="pl-7"
                    value={formData.flatBillingRate}
                    onChange={(e) =>
                      handleInputChange("flatBillingRate", e.target.value)
                    }
                    placeholder=""
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1 flex items-center gap-1">
                  Export/External ID
                  <Info className="w-3 h-3 text-[hsl(var(--color-primary))]" />
                </label>
                <Input
                  value={formData.exportId}
                  onChange={(e) =>
                    handleInputChange("exportId", e.target.value)
                  }
                  placeholder=""
                />
              </div>

              <div className="md:col-span-2 xl:col-span-4">
                <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                  Region
                </label>
                <Input
                  value={formData.region}
                  onChange={(e) => handleInputChange("region", e.target.value)}
                  placeholder=""
                />
              </div>

            </div>

            {/* Tabs and Content Section */}
            <div className="flex flex-col md:flex-row gap-6">
              {/* Left Sidebar Tabs */}
              <div className="flex md:flex-col gap-2 md:w-44 flex-shrink-0">
                <button
                  type="button"
                  aria-label="Address"
                  aria-pressed={activeTab === "address"}
                  onClick={() => setActiveTab("address")}
                  className={`flex items-center justify-center md:justify-start gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-1 md:flex-none ${
                    activeTab === "address"
                      ? "bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))] shadow-md"
                      : "bg-[hsl(var(--color-card))] text-[hsl(var(--color-primary))] border border-[hsl(var(--color-primary))] hover:bg-[hsl(var(--color-primary-soft))]"
                  }`}
                >
                  <MapPin className="w-4 h-4" />
                  <span className="hidden sm:inline">Address</span>
                </button>
                <button
                  type="button"
                  aria-label="Contact information"
                  aria-pressed={activeTab === "contact"}
                  onClick={() => setActiveTab("contact")}
                  className={`flex items-center justify-center md:justify-start gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-1 md:flex-none ${
                    activeTab === "contact"
                      ? "bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))] shadow-md"
                      : "bg-[hsl(var(--color-card))] text-[hsl(var(--color-primary))] border border-[hsl(var(--color-primary))] hover:bg-[hsl(var(--color-primary-soft))]"
                  }`}
                >
                  <Users className="w-4 h-4" />
                  <span className="hidden sm:inline">Contact Information</span>
                </button>
                <button
                  type="button"
                  aria-label="Access codes"
                  aria-pressed={activeTab === "access"}
                  onClick={() => setActiveTab("access")}
                  className={`flex items-center justify-center md:justify-start gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-1 md:flex-none ${
                    activeTab === "access"
                      ? "bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))] shadow-md"
                      : "bg-[hsl(var(--color-card))] text-[hsl(var(--color-primary))] border border-[hsl(var(--color-primary))] hover:bg-[hsl(var(--color-primary-soft))]"
                  }`}
                >
                  <Key className="w-4 h-4" />
                  <span className="hidden sm:inline">Access Codes</span>
                </button>
              </div>

              {/* Tab Content */}
              <div className="min-w-0 flex-1 border border-[hsl(var(--color-border))] rounded-lg p-6 bg-[hsl(var(--color-card))]">
                {activeTab === "address" && (
                  <div>
                    <h3 className="text-base font-semibold text-[hsl(var(--color-foreground))] mb-4">
                      Address
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <div>
                        <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                          Address
                        </label>
                        <LocationAutocomplete
                          value={formData.address}
                          onChange={(e) =>
                            handleInputChange("address", e.target.value)
                          }
                          onSelect={(addressData) => {
                            // Auto-select timezone from state. AU states map
                            // to their zone; anything matching an Indian state
                            // (by code or name) maps to IST; unknown falls back
                            // to Australia/Sydney (existing default).
                            const autoSelectTimezone = (state) => {
                              const timezoneMap = {
                                NSW: 'Australia/Sydney',
                                VIC: 'Australia/Melbourne',
                                QLD: 'Australia/Brisbane',
                                SA: 'Australia/Adelaide',
                                WA: 'Australia/Perth',
                                TAS: 'Australia/Hobart',
                                NT: 'Australia/Darwin',
                                ACT: 'Australia/Canberra',
                              };
                              if (state && timezoneMap[state]) return timezoneMap[state];
                              const needle = String(state || '').toLowerCase();
                              const isIndian = INDIAN_STATES.some(
                                (i) => i.code.toLowerCase() === needle || i.name.toLowerCase() === needle,
                              );
                              if (isIndian) return 'Asia/Kolkata';
                              return 'Australia/Sydney';
                            };

                            // Update all address fields
                            handleInputChange("address", addressData.address);
                            handleInputChange("townSuburb", addressData.townSuburb);
                            handleInputChange("state", addressData.state);
                            handleInputChange("postalCode", addressData.postalCode);
                            handleInputChange("latitude", addressData.latitude);
                            handleInputChange("longitude", addressData.longitude);

                            // Auto-select timezone based on state
                            if (addressData.state) {
                              handleInputChange("timezone", autoSelectTimezone(addressData.state));
                            }

                            toast.success("Location details auto-filled");
                          }}
                          placeholder="Enter a location"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                          State
                        </label>
                        <StateInput
                          value={formData.state}
                          onChange={(next) => handleInputChange("state", next)}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                          Town/Suburb
                        </label>
                        <Input
                          value={formData.townSuburb}
                          onChange={(e) =>
                            handleInputChange("townSuburb", e.target.value)
                          }
                          placeholder="Enter Suburb, Town, City or Postcode"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                          Postal Code
                        </label>
                        <Input
                          value={formData.postalCode}
                          onChange={(e) =>
                            handleInputChange("postalCode", e.target.value)
                          }
                          placeholder=""
                        />
                      </div>
                    </div>

                    {/* GeoLocation Section */}
                    <div className="border-t border-[hsl(var(--color-border))] pt-6 mt-6">
                      <h4 className="text-sm font-semibold text-[hsl(var(--color-foreground-muted))] mb-4">
                        GeoLocation
                      </h4>

                      <div className="mb-4">
                        <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                          Timezone
                        </label>
                        <Select
                          value={formData.timezone}
                          onChange={(e) =>
                            handleInputChange("timezone", e.target.value)
                          }
                          wrapperClassName="max-w-md"
                        >
                          <option value="">Select Timezone</option>
                          {SUPPORTED_TIMEZONES.map((tz) => (
                            <option key={tz.value} value={tz.value}>
                              {tz.label}
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                            Latitude
                          </label>
                          <Input
                            value={formData.latitude}
                            onChange={(e) =>
                              handleInputChange("latitude", e.target.value)
                            }
                            placeholder=""
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                            Longitude
                          </label>
                          <Input
                            value={formData.longitude}
                            onChange={(e) =>
                              handleInputChange("longitude", e.target.value)
                            }
                            placeholder=""
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3 mb-6">
                        <Button
                          variant="primary"
                          className="disabled:opacity-60"
                          onClick={handleGetMapAddress}
                          disabled={geocoding}
                        >
                          {geocoding ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Target className="w-4 h-4 mr-2" />
                          )}
                          {geocoding ? "Fetching..." : "Get Map Address"}
                        </Button>
                        <Button
                          variant="primary"
                          onClick={() => setShowMapModal(true)}
                        >
                          <MapPin className="w-4 h-4 mr-2" />
                          View Map
                        </Button>
                      </div>

                      {/* GEOFence Radius Slider */}
                      <div>
                        <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-3">
                          GEOFence Radius
                        </label>
                        <div className="flex items-center gap-4">
                          <span className="text-xs text-[hsl(var(--color-foreground-secondary))] w-16">
                            {geoFenceRadius.toFixed(1)} km
                          </span>
                          <div className="flex-1 relative max-w-lg">
                            <input
                              type="range"
                              min="0.1"
                              max="5"
                              step="0.1"
                              value={geoFenceRadius}
                              onChange={(e) =>
                                setGeoFenceRadius(parseFloat(e.target.value))
                              }
                              className="w-full h-2 bg-[hsl(var(--color-border))] rounded-lg appearance-none cursor-pointer slider-thumb"
                              style={{
                                background: `linear-gradient(to right, #dc2626 0%, #dc2626 ${((geoFenceRadius - 0.1) / 4.9) * 100}%, hsl(var(--color-border)) ${((geoFenceRadius - 0.1) / 4.9) * 100}%, hsl(var(--color-border)) 100%)`,
                              }}
                            />
                          </div>
                          <span className="text-xs text-[hsl(var(--color-foreground-secondary))] w-16 text-right">
                            5.0 km
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "contact" && (
                  <div>
                    <h3 className="text-base font-semibold text-[hsl(var(--color-foreground))] mb-4">
                      Contact Information
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                          Contact Person
                        </label>
                        <Input
                          placeholder="Enter contact person name"
                          value={formData.contactPerson}
                          onChange={(e) => handleInputChange("contactPerson", e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                          Position/Title
                        </label>
                        <Input
                          placeholder="Enter position"
                          value={formData.contactPosition}
                          onChange={(e) => handleInputChange("contactPosition", e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                          Phone Number
                        </label>
                        <Input
                          type="tel"
                          placeholder="Enter phone number"
                          value={formData.contactPhone}
                          onChange={(e) => handleInputChange("contactPhone", e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                          Mobile Number
                        </label>
                        <Input
                          type="tel"
                          placeholder="Enter mobile number"
                          value={formData.contactMobile}
                          onChange={(e) => handleInputChange("contactMobile", e.target.value)}
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                          Email Address
                        </label>
                        <Input
                          type="email"
                          placeholder="Enter email address"
                          value={formData.contactEmail}
                          onChange={(e) => handleInputChange("contactEmail", e.target.value)}
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                          Additional Notes
                        </label>
                        <textarea
                          className="flex w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 py-2 text-sm text-[hsl(var(--color-foreground))] ring-offset-[hsl(var(--color-card))] placeholder:text-[hsl(var(--color-foreground-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--color-ring))] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[100px] resize-none"
                          placeholder="Enter any additional contact information or notes"
                          value={formData.contactNotes}
                          onChange={(e) => handleInputChange("contactNotes", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "access" && (
                  site && (site.id || site._id) ? (
                    <AccessCodesManager siteId={site.id || site._id} />
                  ) : (
                    <div className="p-6 text-sm text-[hsl(var(--color-foreground-secondary))] border border-dashed border-[hsl(var(--color-border))] rounded">
                      <p className="mb-2 font-medium text-[hsl(var(--color-foreground))]">
                        Save the site first
                      </p>
                      <p>
                        Access codes attach to a saved site. Fill in the site
                        details and click <strong>Save site</strong>, then
                        re-open this site to add and manage its access codes.
                      </p>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer flex items-center justify-end gap-3 px-6 py-4 border-t">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSave} disabled={submitting}>
            <Save size={16} />
            {submitting ? "Saving..." : "Save site"}
          </Button>
        </div>
      </div>

      {/* Warning Dialog */}
      {showWarning && (
        <Modal onClose={() => setShowWarning(false)} label="Address warning">
          <div className="modal-surface w-full max-w-sm">
            <div className="flex items-center justify-between px-4 py-3 bg-[hsl(var(--color-error))] rounded-t">
              <div className="flex items-center gap-2 text-[hsl(var(--color-error-foreground))]">
                <AlertTriangle className="w-4 h-4" />
                <span className="font-semibold text-sm">Warning</span>
              </div>
              <button
                onClick={() => setShowWarning(false)}
                className="text-[hsl(var(--color-error-foreground))]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-6 text-sm text-[hsl(var(--color-foreground-secondary))] min-h-[80px]">
              {warningMessage}
            </div>
            <div className="flex justify-end px-4 py-3 border-t border-[hsl(var(--color-border))]">
              <button
                onClick={() => setShowWarning(false)}
                className="px-5 py-2 bg-[hsl(var(--color-error))] text-[hsl(var(--color-error-foreground))] text-sm rounded hover:opacity-90 transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Map Modal */}
      {showMapModal && (
        <MapModal
          initLatitude={formData.latitude}
          initLongitude={formData.longitude}
          initAddress={formData.address}
          initState={formData.state}
          initTownSuburb={formData.townSuburb}
          initPostalCode={formData.postalCode}
          initGeoFenceRadius={geoFenceRadius}
          onClose={() => setShowMapModal(false)}
          onSave={handleMapSave}
        />
      )}
    </Modal>
  );
}
