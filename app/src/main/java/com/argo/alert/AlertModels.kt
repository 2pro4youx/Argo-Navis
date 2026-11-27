package com.argo.alert

import org.json.JSONArray
import org.json.JSONObject

data class GeoPoint(
    val lat: Double,
    val lon: Double,
)

data class AlertRegion(
    val center: GeoPoint,
    val radiusKm: Double,
)

data class Shelter(
    val name: String,
    val lat: Double,
    val lon: Double,
    val route: List<GeoPoint> = emptyList(),
    val routeKm: Double? = null,
    val routeMin: Int? = null,
)

data class AlertPayload(
    val alertId: String,
    val type: String,
    val severity: String,
    val headline: String,
    val region: AlertRegion,
    val shelters: List<Shelter>,
    val protocolSteps: List<String>,
    val protocolNote: String,
    val checkinIntervalS: Int,
)

data class PollResponse(
    val status: String,
    val payloadRaw: String?,
    val signature: String?,
    val alertId: String?,
    val clearSig: String?,
)

enum class TransportMode(val label: String, val storageKey: String) {
    DUAL("Both (FB+IP)", "dual"),
    FIREBASE("Firebase", "firebase"),
    HTTP_IP("Direct IP", "http");

    companion object {
        fun fromKey(raw: String?): TransportMode =
            entries.firstOrNull { it.storageKey.equals(raw, ignoreCase = true) } ?: DUAL
    }
}

object AlertJsonParser {

    /**
     * Parses both argo_sim.py wrapped responses:
     *   {"alert": {"payload": "...", "sig": "...", "status": "ACTIVE"|"CLEARED", "clear_sig": "..."}, "server_time": ...}
     * and unwrapped top-level responses.
     */
    fun parsePollResponse(rawJson: String): PollResponse {
        val root = JSONObject(rawJson)

        val alertObj: JSONObject = when {
            root.has("alert") && !root.isNull("alert") -> root.getJSONObject("alert")
            root.has("alert") && root.isNull("alert") -> {
                return PollResponse(
                    status = "NONE",
                    payloadRaw = null,
                    signature = null,
                    alertId = null,
                    clearSig = null,
                )
            }
            else -> root
        }

        val status = alertObj.optString("status", "NONE").uppercase()

        val payloadRaw = when {
            alertObj.isNull("payload") -> null
            else -> {
                val value = alertObj.opt("payload")
                when (value) {
                    is String -> value.takeIf { it.isNotBlank() }
                    is JSONObject -> value.toString()
                    else -> null
                }
            }
        }

        val signature = alertObj.optString("sig", "").ifBlank {
            alertObj.optString("signature", "")
        }.ifBlank { null }

        // argo_sim.py stores alert_id inside payload JSON (even when status == CLEARED)
        var alertId = alertObj.optString("alert_id", "").ifBlank { null }
        if (alertId == null && payloadRaw != null) {
            alertId = runCatching {
                JSONObject(payloadRaw).optString("alert_id", "").ifBlank { null }
            }.getOrNull()
        }

        val clearSig = alertObj.optString("clear_sig", "").ifBlank { null }

        return PollResponse(
            status = status,
            payloadRaw = payloadRaw,
            signature = signature,
            alertId = alertId,
            clearSig = clearSig,
        )
    }

    fun parseAlertPayload(rawPayload: String): AlertPayload {
        val obj = JSONObject(rawPayload)

        val alertId = obj.optString("alert_id", obj.optString("id", "unknown"))
        val type = obj.optString("type", obj.optString("disaster_type", "EMERGENCY"))
        val severity = obj.optString("severity", "EXTREME")
        val headline = obj.optString("headline", "Immediate evacuation ordered")

        val regionObj = obj.getJSONObject("region")
        val centerRaw = regionObj.get("center")
        val centerPoint = when (centerRaw) {
            // argo_sim.py format: "center": [lat, lon]
            is JSONArray -> GeoPoint(
                lat = centerRaw.getDouble(0),
                lon = centerRaw.getDouble(1),
            )
            // Object format: "center": {"lat": ..., "lon": ...}
            is JSONObject -> GeoPoint(
                lat = centerRaw.getDouble("lat"),
                lon = centerRaw.getDouble("lon"),
            )
            else -> throw IllegalArgumentException("Unsupported region.center format")
        }

        val region = AlertRegion(
            center = centerPoint,
            radiusKm = regionObj.getDouble("radius_km"),
        )

        val shelters = mutableListOf<Shelter>()
        val sheltersArray: JSONArray = obj.optJSONArray("shelters") ?: JSONArray()
        for (i in 0 until sheltersArray.length()) {
            val s = sheltersArray.getJSONObject(i)
            val route = mutableListOf<GeoPoint>()
            val routeArr = s.optJSONArray("route")
            if (routeArr != null) {
                for (j in 0 until routeArr.length()) {
                    val pt = routeArr.optJSONArray(j) ?: continue
                    if (pt.length() >= 2) route.add(GeoPoint(pt.getDouble(0), pt.getDouble(1)))
                }
            }
            shelters.add(
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

        val protocolObj = obj.optJSONObject("protocol")
        val stepsArray: JSONArray = obj.optJSONArray("protocol_steps")
            ?: protocolObj?.optJSONArray("steps")
            ?: JSONArray()
        val steps = mutableListOf<String>()
        for (i in 0 until stepsArray.length()) {
            val step = stepsArray.optString(i, "").trim()
            if (step.isNotEmpty()) steps.add(step)
        }

        val protocolNote = obj.optString("protocol_note", "").ifBlank {
            protocolObj?.optString("note", "") ?: ""
        }

        val checkinIntervalS = obj.optInt("checkin_interval_s", 60).coerceAtLeast(5)

        return AlertPayload(
            alertId = alertId,
            type = type,
            severity = severity,
            headline = headline,
            region = region,
            shelters = shelters,
            protocolSteps = steps,
            protocolNote = protocolNote,
            checkinIntervalS = checkinIntervalS,
        )
    }
}
