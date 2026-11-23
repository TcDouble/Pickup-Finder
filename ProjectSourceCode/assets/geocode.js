// Look up a place's coordinates with OpenStreetMap's free geocoder.
// Used by Host a game and by Settings -> Map -> Home area.

/** { lat, lng } for the best match, or null if nothing matched. */
export async function geocode(text) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(text);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Geocoding failed");
  const results = await res.json();
  if (!results.length) return null;
  return { lat: Number(results[0].lat), lng: Number(results[0].lon) };
}
