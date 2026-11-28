package com.argo.alert

import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * Ensures an in-region user is always guided to the closest real shelter around *their* live GPS
 * with a walking route starting from their position — even when the regional alert center is far
 * away (e.g., an alert centered on Bhopal with an 80 km radius covering VIT Bhopal).
 */
object LocalShelterResolver {

    private const val TAG = "ArgoShelterResolver"
    private const val LOCAL_SHELTER_THRESHOLD_KM = 5.0
    private const val ROUTE_ORIGIN_TOLERANCE_KM = 1.0
    private const val ROUTE_TARGET_TOLERANCE_KM = 1.0
    private const val WALK_KMH = 5.0

    private val SHELTER_TAGS = mapOf(
        "community_centre" to "Community Hall",
        "townhall" to "Town Hall",
        "school" to "School",
        "college" to "College",
        "university" to "University",
        "place_of_worship" to "Place of Worship",
        "hospital" to "Hospital",
    )

    private val OVERPASS_URLS = listOf(
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    )

    private data class CachedRoute(
        val points: List<GeoPoint>,
        val routeKm: Double,
        val routeMin: Int,
    )

    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "argo-shelter-resolver").apply { isDaemon = true }
    }

    private val shelterCache = ConcurrentHashMap<String, List<Shelter>>()
    private val routeCache = ConcurrentHashMap<String, CachedRoute>()
    private val inFlightKeys = ConcurrentHashMap.newKeySet<String>()

    fun isRouteValidForUser(userLocation: GeoPoint, shelter: Shelter?): Boolean {
        if (shelter == null || shelter.route.size < 2) return false
        val startDist = CryptoAndGeo.haversineKm(
            userLocation.lat,
            userLocation.lon,
            shelter.route.first().lat,
            shelter.route.first().lon,
        )
        val endDist = CryptoAndGeo.haversineKm(
            shelter.lat,
            shelter.lon,
            shelter.route.last().lat,
            shelter.route.last().lon,
        )
        return startDist <= ROUTE_ORIGIN_TOLERANCE_KM && endDist <= ROUTE_TARGET_TOLERANCE_KM
    }

    fun needsLocalDiscovery(userLocation: GeoPoint, shelters: List<Shelter>): Boolean {
        val nearest = CryptoAndGeo.findNearestShelter(userLocation.lat, userLocation.lon, shelters)
        return nearest == null || nearest.second > LOCAL_SHELTER_THRESHOLD_KM
    }

    fun mergeShelters(
        userLocation: GeoPoint,
        preferred: List<Shelter>,
        fallback: List<Shelter>,
    ): List<Shelter> {
        val out = mutableListOf<Shelter>()
        val keyToIndex = mutableMapOf<String, Int>()

        fun addCandidate(sh: Shelter) {
            val coordKey = String.format(Locale.US, "%.4f,%.4f", sh.lat, sh.lon)
            val nameKey = sh.name.trim().lowercase(Locale.US)
            val existingIdx = keyToIndex[coordKey] ?: keyToIndex[nameKey]
            if (existingIdx == null) {
                val idx = out.size
                out.add(sh)
                keyToIndex[coordKey] = idx
                if (nameKey.isNotEmpty()) keyToIndex[nameKey] = idx
            } else {
                val cur = out[existingIdx]
                val shValid = isRouteValidForUser(userLocation, sh)
                val curValid = isRouteValidForUser(userLocation, cur)
                if ((shValid && !curValid) || (shValid == curValid && sh.route.size > cur.route.size)) {
                    out[existingIdx] = sh
                }
            }
        }

        preferred.forEach(::addCandidate)
        fallback.forEach(::addCandidate)
        return out
    }

    fun resolveIfNeeded(state: ActiveAlertState) {
        val alert = state.alert ?: return
        val effective = state.effectiveShelters()
        val loc = state.userLocation
        val nearest = CryptoAndGeo.findNearestShelter(loc.lat, loc.lon, effective)
        val needShelters = nearest == null || nearest.second > LOCAL_SHELTER_THRESHOLD_KM
        val needRoute = nearest != null && !isRouteValidForUser(loc, nearest.first)
        if (!needShelters && !needRoute) return

        val locKey = String.format(Locale.US, "%.3f,%.3f", loc.lat, loc.lon)
        val targetKey = nearest?.first?.let {
            String.format(Locale.US, "%.4f,%.4f", it.lat, it.lon)
        } ?: "none"
        val jobKey = "${alert.alertId}|$locKey|$targetKey|${if (needShelters) "S" else "R"}"
        if (!inFlightKeys.add(jobKey)) return

        executor.execute {
            try {
                resolveSync(
                    alertId = alert.alertId,
                    userLocation = loc,
                    baseShelters = effective,
                    gatewayUrl = state.serverUrl,
                    transportMode = state.transportMode,
                )
            } catch (e: Exception) {
                Log.w(TAG, "Local shelter/route resolution failed: ${e.message}")
            } finally {
                inFlightKeys.remove(jobKey)
            }
        }
    }

    private fun resolveSync(
        alertId: String,
        userLocation: GeoPoint,
        baseShelters: List<Shelter>,
        gatewayUrl: String,
        transportMode: TransportMode,
    ) {
        var candidates = baseShelters
        if (needsLocalDiscovery(userLocation, candidates)) {
            val discovered = fetchLocalShelters(userLocation, gatewayUrl, transportMode)
            if (discovered.isNotEmpty()) {
                candidates = mergeShelters(userLocation, discovered, candidates)
                AlertStateHolder.updateLocalShelters(alertId, candidates)
            }
        }

        val nearest = CryptoAndGeo.findNearestShelter(userLocation.lat, userLocation.lon, candidates)?.first
            ?: return
        if (!isRouteValidForUser(userLocation, nearest)) {
            val routeInfo = fetchWalkingRoute(userLocation, nearest) ?: return
            val updatedNearest = nearest.copy(
                route = routeInfo.points,
                routeKm = routeInfo.routeKm,
                routeMin = routeInfo.routeMin,
            )
            val updatedList = candidates.map { sh ->
                if (sh === nearest || (sh.name == nearest.name && sh.lat == nearest.lat && sh.lon == nearest.lon)) {
                    updatedNearest
                } else {
                    sh
                }
            }
            AlertStateHolder.updateLocalShelters(alertId, updatedList)
        }
    }

    private fun fetchLocalShelters(
        loc: GeoPoint,
        gatewayUrl: String,
        transportMode: TransportMode,
    ): List<Shelter> {
        val cacheKey = String.format(Locale.US, "%.3f,%.3f", loc.lat, loc.lon)
        shelterCache[cacheKey]?.let { return it }

        // 1. If a Python HTTP gateway is reachable, query its cached/OSM /api/shelters first
        val lowerUrl = gatewayUrl.lowercase(Locale.US)
        val isFirebaseOnlyUrl = lowerUrl.contains("firebaseio.com") || lowerUrl.contains("firebasedatabase.app")
        if (transportMode != TransportMode.FIREBASE && !isFirebaseOnlyUrl) {
            fetchFromGateway(gatewayUrl, loc)?.takeIf { it.isNotEmpty() }?.let { list ->
                shelterCache[cacheKey] = list
                return list
            }
        }

        // 2. Fallback: query OpenStreetMap Overpass directly from the phone
        val overpass = fetchFromOverpass(loc)
        if (overpass.isNotEmpty()) {
            shelterCache[cacheKey] = overpass
        }
        return overpass
    }

    private fun fetchFromGateway(gatewayUrl: String, loc: GeoPoint): List<Shelter>? {
        var conn: HttpURLConnection? = null
        return try {
            val urlStr = String.format(
                Locale.US,
                "%s/api/shelters?lat=%.5f&lon=%.5f",
                gatewayUrl.trimEnd('/'),
                loc.lat,
                loc.lon,
            )
            conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 4_000
                readTimeout = 8_000
                setRequestProperty("Accept", "application/json")
            }
            if (conn.responseCode !in 200..299) return null
            val raw = BufferedReader(InputStreamReader(conn.inputStream, StandardCharsets.UTF_8)).use {
                it.readText()
            }
            val arr = JSONObject(raw).optJSONArray("shelters") ?: return null
            val out = mutableListOf<Shelter>()
            for (i in 0 until arr.length()) {
                val s = arr.getJSONObject(i)
                val route = mutableListOf<GeoPoint>()
                val routeArr = s.optJSONArray("route")
                if (routeArr != null) {
                    for (j in 0 until routeArr.length()) {
                        val pt = routeArr.optJSONArray(j) ?: continue
                        if (pt.length() >= 2) route.add(GeoPoint(pt.getDouble(0), pt.getDouble(1)))
                    }
                }
                out.add(
                    Shelter(
                        name = s.getString("name"),
                        lat = s.getDouble("lat"),
                        lon = s.getDouble("lon"),
                        route = route,
                        routeKm = if (s.has("route_km")) s.optDouble("route_km") else null,
                        routeMin = if (s.has("route_min")) s.optInt("route_min") else null,
                    )
                )
            }
            out
        } catch (_: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }

    private fun fetchFromOverpass(loc: GeoPoint): List<Shelter> {
        val amenRegex = SHELTER_TAGS.keys.joinToString("|")
        for (radiusM in listOf(2500, 6000, 15000)) {
            val query = String.format(
                Locale.US,
                "[out:json][timeout:20];(nwr[\"amenity\"~\"^(%s)$\"][\"name\"](around:%d,%.5f,%.5f););out center 80;",
                amenRegex,
                radiusM,
                loc.lat,
                loc.lon,
            )
            for (endpoint in OVERPASS_URLS) {
                var conn: HttpURLConnection? = null
                try {
                    conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                        requestMethod = "POST"
                        doOutput = true
                        connectTimeout = 6_000
                        readTimeout = 15_000
                        setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
                        setRequestProperty("User-Agent", "ArgoNavis-Android/1.0")
                    }
                    val body = "data=" + URLEncoder.encode(query, "UTF-8")
                    OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use {
                        it.write(body)
                        it.flush()
                    }
                    if (conn.responseCode !in 200..299) continue
                    val raw = BufferedReader(InputStreamReader(conn.inputStream, StandardCharsets.UTF_8)).use {
                        it.readText()
                    }
                    val elements = JSONObject(raw).optJSONArray("elements") ?: continue
                    val picked = pickSheltersFromOverpass(elements, loc)
                    if (picked.size >= 3 || (radiusM == 15000 && picked.isNotEmpty())) {
                        return picked
                    }
                    if (picked.isNotEmpty()) break
                } catch (_: Exception) {
                    // Try next mirror
                } finally {
                    conn?.disconnect()
                }
            }
        }
        return emptyList()
    }

    private fun pickSheltersFromOverpass(elements: org.json.JSONArray, origin: GeoPoint): List<Shelter> {
        data class Cand(val distKm: Double, val name: String, val kind: String, val lat: Double, val lon: Double)

        val cands = mutableListOf<Cand>()
        for (i in 0 until elements.length()) {
            val el = elements.optJSONObject(i) ?: continue
            val tags = el.optJSONObject("tags") ?: continue
            val amen = tags.optString("amenity", "")
            val kind = SHELTER_TAGS[amen] ?: continue
            val rawName = tags.optString("name", "").trim()
            if (rawName.isEmpty()) continue
            val center = el.optJSONObject("center") ?: el
            if (!center.has("lat") || !center.has("lon")) continue
            val la = center.optDouble("lat", Double.NaN)
            val lo = center.optDouble("lon", Double.NaN)
            if (la.isNaN() || lo.isNaN()) continue
            cands.add(Cand(CryptoAndGeo.haversineKm(origin.lat, origin.lon, la, lo), rawName, kind, la, lo))
        }
        cands.sortBy { it.distKm }

        val out = mutableListOf<Shelter>()
        val counts = mutableMapOf<String, Int>()
        val seen = mutableSetOf<String>()
        for (c in cands) {
            val lower = c.name.lowercase(Locale.US)
            if (seen.contains(lower) || (counts[c.kind] ?: 0) >= 2) continue
            seen.add(lower)
            counts[c.kind] = (counts[c.kind] ?: 0) + 1
            val label = "${c.name.take(34)} (${c.kind})"
            out.add(Shelter(name = label, lat = c.lat, lon = c.lon))
            if (out.size == 5) break
        }
        return out
    }

    private fun fetchWalkingRoute(origin: GeoPoint, shelter: Shelter): CachedRoute? {
        val key = String.format(
            Locale.US,
            "%.4f,%.4f>%.5f,%.5f",
            origin.lat,
            origin.lon,
            shelter.lat,
            shelter.lon,
        )
        routeCache[key]?.let { return it }

        var conn: HttpURLConnection? = null
        return try {
            val urlStr = String.format(
                Locale.US,
                "https://routing.openstreetmap.de/routed-foot/route/v1/foot/%.5f,%.5f;%.5f,%.5f?overview=full&geometries=geojson",
                origin.lon,
                origin.lat,
                shelter.lon,
                shelter.lat,
            )
            conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 6_000
                readTimeout = 10_000
                setRequestProperty("User-Agent", "ArgoNavis-Android/1.0")
            }
            if (conn.responseCode !in 200..299) return null
            val raw = BufferedReader(InputStreamReader(conn.inputStream, StandardCharsets.UTF_8)).use {
                it.readText()
            }
            val routes = JSONObject(raw).optJSONArray("routes") ?: return null
            if (routes.length() == 0) return null
            val rt = routes.getJSONObject(0)
            val coords = rt.getJSONObject("geometry").getJSONArray("coordinates")
            val pts = mutableListOf<GeoPoint>()
            for (i in 0 until coords.length()) {
                val c = coords.optJSONArray(i) ?: continue
                if (c.length() >= 2) {
                    pts.add(GeoPoint(lat = c.getDouble(1), lon = c.getDouble(0)))
                }
            }
            if (pts.size < 2) return null
            val thinned = thinPoints(pts, 70)
            val km = rt.getDouble("distance") / 1000.0
            val info = CachedRoute(
                points = thinned,
                routeKm = (km * 100.0).roundToInt() / 100.0,
                routeMin = ((km / WALK_KMH) * 60.0).roundToInt().coerceAtLeast(1),
            )
            routeCache[key] = info
            info
        } catch (_: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }

    private fun thinPoints(pts: List<GeoPoint>, maxN: Int): List<GeoPoint> {
        if (pts.size <= maxN) return pts
        val step = (pts.size - 1).toDouble() / (maxN - 1).toDouble()
        return List(maxN) { i -> pts[(i * step).roundToInt().coerceIn(0, pts.lastIndex)] }
    }
}
