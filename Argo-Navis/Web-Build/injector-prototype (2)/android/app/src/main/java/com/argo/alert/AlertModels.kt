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

object AlertJsonParser {

    fun parsePollResponse(rawJson: String): PollResponse {
        val root = JSONObject(rawJson)
        val alertObj = root.optJSONObject("alert")
        val status = root.optString("status", alertObj?.optString("status", "NONE") ?: "NONE")
            .uppercase()

        val sourceObj = alertObj ?: root
        val payloadRaw = when {
            sourceObj.isNull("payload") -> null
            else -> {
                val value = sourceObj.opt("payload")
                when (value) {
                    is String -> value.takeIf { it.isNotBlank() }
                    is JSONObject -> value.toString()
                    else -> null
                }
            }
        }

        val signature = sourceObj.optString("sig", "").ifBlank {
            sourceObj.optString("signature", "")
        }.ifBlank { null }

        val alertId = sourceObj.optString("alert_id", "").ifBlank { null }
        val clearSig = sourceObj.optString("clear_sig", "").ifBlank { null }

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
        val centerRaw = regionObj.opt("center")
        val center = when (centerRaw) {
            is JSONArray -> GeoPoint(centerRaw.getDouble(0), centerRaw.getDouble(1))
            is JSONObject -> GeoPoint(centerRaw.getDouble("lat"), centerRaw.getDouble("lon"))
            else -> throw IllegalArgumentException("Missing region.center")
        }
        val region = AlertRegion(
            center = center,
            radiusKm = regionObj.getDouble("radius_km"),
        )

        val shelters = mutableListOf<Shelter>()
        val sheltersArray: JSONArray = obj.optJSONArray("shelters") ?: JSONArray()
        for (i in 0 until sheltersArray.length()) {
            val s = sheltersArray.getJSONObject(i)
            val routePts = mutableListOf<GeoPoint>()
            val routeArr = s.optJSONArray("route")
            if (routeArr != null) {
                for (j in 0 until routeArr.length()) {
                    val pt = routeArr.optJSONArray(j)
                    if (pt != null && pt.length() >= 2) {
                        routePts.add(GeoPoint(pt.getDouble(0), pt.getDouble(1)))
                    }
                }
            }
            val routeKm = if (s.has("route_km") && !s.isNull("route_km")) s.optDouble("route_km") else null
            val routeMin = if (s.has("route_min") && !s.isNull("route_min")) s.optInt("route_min") else null
            shelters.add(
                Shelter(
                    name = s.getString("name"),
                    lat = s.getDouble("lat"),
                    lon = s.getDouble("lon"),
                    route = routePts,
                    routeKm = routeKm,
                    routeMin = routeMin,
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
