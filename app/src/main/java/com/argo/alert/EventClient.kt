package com.argo.alert

import android.content.Context
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
import java.util.UUID
import java.util.concurrent.Executors

object EventClient {

    private const val TAG = "ArgoEventClient"
    const val DEFAULT_BASE_URL = "http://10.0.2.2:8000"
    const val DEFAULT_DEVICE_ID = "nord5"
    const val DEFAULT_FIREBASE_CHANNEL = "argo-default"

    private const val FIREBASE_PROJECT_ID = "circular-xray-qk4jk"
    private const val FIREBASE_DATABASE_ID = "ai-studio-argonavis-bb9b0c5f-87c9-4702-a6e0-f204cdfc39a3"
    private const val FIREBASE_API_KEY = "AIzaSyBkA0F4-H_LzAQLQE5QYjCmMOfDUjrzXnU"
    private const val FIRESTORE_DOC_BASE =
        "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/$FIREBASE_DATABASE_ID/documents"

    private const val PREFS_NAME = "argo_alert_config"
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_TRANSPORT_MODE = "transport_mode"
    private const val KEY_FIREBASE_CHANNEL = "firebase_channel"
    private const val KEY_DEVICE_ID = "device_id"

    @Volatile
    private var baseUrl: String = DEFAULT_BASE_URL

    @Volatile
    private var transportMode: TransportMode = TransportMode.DUAL

    @Volatile
    private var firebaseChannel: String = DEFAULT_FIREBASE_CHANNEL

    @Volatile
    private var deviceId: String = DEFAULT_DEVICE_ID

    @Volatile
    private var currentDeviceStatus: String = "IDLE"

    @Volatile
    private var currentDeadlineEpochS: Double = 0.0

    private val eventExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "argo-event-post").apply { isDaemon = true }
    }

    fun init(context: Context) {
        runCatching {
            val storageCtx = context.createDeviceProtectedStorageContext()
            val prefs = storageCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val savedUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_BASE_URL)
            if (!savedUrl.isNullOrBlank()) {
                baseUrl = normalizeUrl(savedUrl) ?: DEFAULT_BASE_URL
            }
            transportMode = TransportMode.fromKey(prefs.getString(KEY_TRANSPORT_MODE, TransportMode.DUAL.storageKey))
            firebaseChannel = sanitizeChannel(prefs.getString(KEY_FIREBASE_CHANNEL, DEFAULT_FIREBASE_CHANNEL))
            deviceId = sanitizeId(prefs.getString(KEY_DEVICE_ID, DEFAULT_DEVICE_ID), DEFAULT_DEVICE_ID)
        }
        AlertStateHolder.updateServerUrl(baseUrl)
        AlertStateHolder.updateTransportMode(transportMode)
        AlertStateHolder.updateFirebaseChannel(firebaseChannel)
        AlertStateHolder.updateDeviceId(deviceId)
    }

    private fun prefs(context: Context) =
        context.createDeviceProtectedStorageContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun normalizeUrl(raw: String): String? {
        var trimmed = raw.trim().trimEnd('/')
        if (trimmed.isEmpty()) return null
        if (!trimmed.startsWith("http://", ignoreCase = true) &&
            !trimmed.startsWith("https://", ignoreCase = true)
        ) {
            trimmed = "http://$trimmed"
        }
        return runCatching {
            val parsed = URL(trimmed)
            if (parsed.host.isNullOrBlank()) null else trimmed
        }.getOrNull()
    }

    private fun sanitizeId(raw: String?, fallback: String): String {
        val cleaned = (raw ?: "").trim().replace(Regex("[^a-zA-Z0-9_\\-]"), "_").take(64)
        return cleaned.ifEmpty { fallback }
    }

    private fun sanitizeChannel(raw: String?): String {
        val cleaned = sanitizeId(raw, DEFAULT_FIREBASE_CHANNEL)
        return if (cleaned.length >= 4) cleaned else DEFAULT_FIREBASE_CHANNEL
    }

    fun setBaseUrl(context: Context, url: String): Boolean {
        val normalized = normalizeUrl(url)
        if (normalized == null) {
            AlertStateHolder.updatePollStatus("Invalid URL: enter host:port or http://...")
            return false
        }
        baseUrl = normalized
        AlertStateHolder.updateServerUrl(normalized)
        runCatching {
            prefs(context).edit().putString(KEY_SERVER_URL, normalized).apply()
        }
        return true
    }

    fun setTransportMode(context: Context, mode: TransportMode) {
        transportMode = mode
        AlertStateHolder.updateTransportMode(mode)
        if (mode == TransportMode.FIREBASE) {
            AlertStateHolder.updatePollStatus("Paused (Firebase-only mode)")
        } else if (mode == TransportMode.HTTP_IP) {
            AlertStateHolder.updateFirebaseStatus("Paused (Direct IP mode)")
        }
        runCatching {
            prefs(context).edit().putString(KEY_TRANSPORT_MODE, mode.storageKey).apply()
        }
    }

    fun setFirebaseChannel(context: Context, channel: String): String {
        val cleaned = sanitizeChannel(channel)
        firebaseChannel = cleaned
        AlertStateHolder.updateFirebaseChannel(cleaned)
        runCatching {
            prefs(context).edit().putString(KEY_FIREBASE_CHANNEL, cleaned).apply()
        }
        return cleaned
    }

    fun setDeviceId(context: Context, id: String): String {
        val cleaned = sanitizeId(id, DEFAULT_DEVICE_ID)
        deviceId = cleaned
        AlertStateHolder.updateDeviceId(cleaned)
        runCatching {
            prefs(context).edit().putString(KEY_DEVICE_ID, cleaned).apply()
        }
        return cleaned
    }

    fun getBaseUrl(): String = baseUrl
    fun getTransportMode(): TransportMode = transportMode
    fun getFirebaseChannel(): String = firebaseChannel
    fun getDeviceId(): String = deviceId

    fun pollAll(
        lat: Double,
        lon: Double,
        batteryPct: Int,
        source: String = "gps",
    ): List<PollResponse> {
        val mode = transportMode
        val responses = mutableListOf<PollResponse>()

        if (mode == TransportMode.FIREBASE || mode == TransportMode.DUAL) {
            pollFirebase(lat, lon, batteryPct, source)?.let { responses.add(it) }
        } else {
            AlertStateHolder.updateFirebaseStatus("Paused (Direct IP mode)")
        }

        if (mode == TransportMode.HTTP_IP || mode == TransportMode.DUAL) {
            pollHttp(lat, lon, batteryPct, source)?.let { responses.add(it) }
        } else {
            AlertStateHolder.updatePollStatus("Paused (Firebase-only mode)")
        }

        return responses
    }

    private fun pollHttp(
        lat: Double,
        lon: Double,
        batteryPct: Int,
        source: String,
    ): PollResponse? {
        val query = String.format(
            Locale.US,
            "device=%s&lat=%.6f&lon=%.6f&battery=%d&src=%s",
            URLEncoder.encode(deviceId, "UTF-8"),
            lat,
            lon,
            batteryPct,
            URLEncoder.encode(source, "UTF-8"),
        )
        var conn: HttpURLConnection? = null
        return try {
            val url = URL("$baseUrl/api/device/poll?$query")
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 1_500
                readTimeout = 1_500
                setRequestProperty("Accept", "application/json")
            }
            val code = conn.responseCode
            if (code in 200..299) {
                val body = BufferedReader(
                    InputStreamReader(conn.inputStream, StandardCharsets.UTF_8)
                ).use { it.readText() }
                AlertStateHolder.updatePollStatus("Connected (HTTP $code)")
                if (body.isBlank()) null else AlertJsonParser.parsePollResponse(body)
            } else {
                Log.w(TAG, "HTTP poll returned $code")
                AlertStateHolder.updatePollStatus("HTTP error $code")
                null
            }
        } catch (e: Exception) {
            val msg = e.message ?: e.javaClass.simpleName
            Log.w(TAG, "HTTP poll failed ($baseUrl): $msg")
            AlertStateHolder.updatePollStatus("Offline: $msg")
            null
        } finally {
            conn?.disconnect()
        }
    }

    private fun pollFirebase(
        lat: Double,
        lon: Double,
        batteryPct: Int,
        source: String,
    ): PollResponse? {
        val ch = firebaseChannel
        val dev = deviceId
        val hasFix = source != "none" && !(lat == 0.0 && lon == 0.0)
        val safeLat = if (hasFix) lat.coerceIn(-90.0, 90.0) else 0.0
        val safeLon = if (hasFix) lon.coerceIn(-180.0, 180.0) else 0.0
        val nowSec = System.currentTimeMillis() / 1000.0

        // 1. Upsert live device telemetry document in Firestore
        val deviceFields = JSONObject().apply {
            put("id", fsString(dev))
            put("status", fsString(currentDeviceStatus))
            put("lat", fsDouble(safeLat))
            put("lon", fsDouble(safeLon))
            put("has_fix", fsBool(hasFix))
            put("battery", fsInt(batteryPct.coerceIn(0, 100)))
            put("src", fsString(source.take(32)))
            put("last_seen", fsDouble(nowSec))
            put("deadline", fsDouble(currentDeadlineEpochS))
        }
        val telemetryRes = firestoreRequest(
            method = "PATCH",
            path = "channels/$ch/devices/$dev",
            bodyJson = JSONObject().put("fields", deviceFields).toString(),
        )
        if (!telemetryRes.ok) {
            AlertStateHolder.updateFirebaseStatus("Error: ${telemetryRes.error}")
            return null
        }

        // 2. Read channel alert document
        val channelRes = firestoreRequest(
            method = "GET",
            path = "channels/$ch",
            bodyJson = null,
        )
        if (channelRes.code == 404) {
            AlertStateHolder.updateFirebaseStatus("Connected ($ch · idle)")
            return null
        }
        if (!channelRes.ok || channelRes.body.isBlank()) {
            AlertStateHolder.updateFirebaseStatus("Error: ${channelRes.error}")
            return null
        }

        return runCatching {
            val root = JSONObject(channelRes.body)
            val fields = root.optJSONObject("fields")
            if (fields == null) {
                AlertStateHolder.updateFirebaseStatus("Connected ($ch · idle)")
                return@runCatching null
            }
            val status = readFsString(fields, "status").uppercase(Locale.US).ifBlank { "NONE" }
            val payloadRaw = readFsString(fields, "payload").ifBlank { null }
            val sig = readFsString(fields, "sig").ifBlank { null }
            val clearSig = readFsString(fields, "clear_sig").ifBlank { null }
            val alertId = readFsString(fields, "alert_id").ifBlank { null }
            AlertStateHolder.updateFirebaseStatus("Connected ($ch · $status)")
            PollResponse(
                status = status,
                payloadRaw = payloadRaw,
                signature = sig,
                alertId = alertId,
                clearSig = clearSig,
            )
        }.onFailure { err ->
            Log.w(TAG, "Failed parsing Firestore channel doc: ${err.message}")
            AlertStateHolder.updateFirebaseStatus("Parse error: ${err.message}")
        }.getOrNull()
    }

    fun postEventSync(
        event: String,
        detail: String,
        lat: Double,
        lon: Double,
        intervalS: Int? = null,
    ) {
        updateLocalStatusForEvent(event, intervalS)
        val mode = transportMode
        if (mode == TransportMode.FIREBASE || mode == TransportMode.DUAL) {
            postEventFirebaseSync(event, detail, lat, lon, intervalS)
        }
        if (mode == TransportMode.HTTP_IP || mode == TransportMode.DUAL) {
            postEventHttpSync(event, detail, lat, lon, intervalS)
        }
    }

    private fun updateLocalStatusForEvent(event: String, intervalS: Int?) {
        when (event.uppercase(Locale.US)) {
            "SIREN_ON" -> currentDeviceStatus = "ALERTED"
            "SLIDER_CONFIRMED" -> {
                currentDeviceStatus = "EVACUATING"
                if (intervalS != null && intervalS > 0) {
                    currentDeadlineEpochS = (System.currentTimeMillis() / 1000.0) + intervalS
                }
            }
            "CHECKIN" -> {
                currentDeviceStatus = "CHECKED_IN"
                if (intervalS != null && intervalS > 0) {
                    currentDeadlineEpochS = (System.currentTimeMillis() / 1000.0) + intervalS
                }
            }
            "ESCALATED" -> {
                currentDeviceStatus = "ESCALATED"
                currentDeadlineEpochS = 0.0
            }
            "ALL_CLEAR" -> {
                currentDeviceStatus = "IDLE"
                currentDeadlineEpochS = 0.0
            }
        }
    }

    private fun postEventHttpSync(
        event: String,
        detail: String,
        lat: Double,
        lon: Double,
        intervalS: Int? = null,
    ) {
        var conn: HttpURLConnection? = null
        try {
            val url = URL("$baseUrl/api/device/event")
            val payload = JSONObject().apply {
                put("device", deviceId)
                put("event", event)
                put("detail", detail)
                put("lat", lat)
                put("lon", lon)
                if (intervalS != null) {
                    put("interval_s", intervalS)
                }
            }.toString()

            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 1_500
                readTimeout = 1_500
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
            OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use { writer ->
                writer.write(payload)
                writer.flush()
            }
            val code = conn.responseCode
            if (code !in 200..299) {
                Log.w(TAG, "HTTP event $event returned $code")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed posting HTTP event $event: ${e.message}")
        } finally {
            conn?.disconnect()
        }
    }

    private fun postEventFirebaseSync(
        event: String,
        detail: String,
        lat: Double,
        lon: Double,
        intervalS: Int? = null,
    ) {
        val ch = firebaseChannel
        val dev = deviceId
        val nowMs = System.currentTimeMillis()
        val nowSec = nowMs / 1000.0
        val eventId = "${nowMs}_${UUID.randomUUID().toString().replace("-", "").take(6)}"
        val kind = event.uppercase(Locale.US).replace(Regex("[^A-Z0-9_]"), "_").take(48).ifBlank { "EVENT" }
        val validCoords = !(lat == 0.0 && lon == 0.0) && lat in -90.0..90.0 && lon in -180.0..180.0
        val safeLat = if (validCoords) lat else 0.0
        val safeLon = if (validCoords) lon else 0.0

        val eventFields = JSONObject().apply {
            put("ts", fsDouble(nowSec))
            put("device", fsString(dev))
            put("kind", fsString(kind))
            put("detail", fsString(detail.take(512)))
            put("lat", fsDouble(safeLat))
            put("lon", fsDouble(safeLon))
            put("has_coords", fsBool(validCoords))
            put("interval_s", fsInt((intervalS ?: 0).coerceIn(0, 86400)))
        }
        val res = firestoreRequest(
            method = "PATCH",
            path = "channels/$ch/events/$eventId",
            bodyJson = JSONObject().put("fields", eventFields).toString(),
        )
        if (!res.ok) {
            Log.w(TAG, "Failed posting Firestore event $event: ${res.error}")
        }
    }

    fun postEventAsync(
        event: String,
        detail: String,
        lat: Double,
        lon: Double,
        intervalS: Int? = null,
    ) {
        eventExecutor.execute {
            postEventSync(event, detail, lat, lon, intervalS)
        }
    }

    private data class FsResult(
        val ok: Boolean,
        val code: Int,
        val body: String,
        val error: String,
    )

    private fun firestoreRequest(
        method: String,
        path: String,
        bodyJson: String?,
    ): FsResult {
        var conn: HttpURLConnection? = null
        return try {
            val encodedKey = URLEncoder.encode(FIREBASE_API_KEY, "UTF-8")
            val url = URL("$FIRESTORE_DOC_BASE/${path.trimStart('/')}?key=$encodedKey")
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 4_000
                readTimeout = 4_000
                setRequestProperty("Accept", "application/json")
                if (bodyJson != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }
            }
            if (bodyJson != null) {
                OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use { writer ->
                    writer.write(bodyJson)
                    writer.flush()
                }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.let {
                BufferedReader(InputStreamReader(it, StandardCharsets.UTF_8)).use { r -> r.readText() }
            } ?: ""
            if (code in 200..299) {
                FsResult(ok = true, code = code, body = body, error = "")
            } else {
                FsResult(ok = false, code = code, body = body, error = "HTTP $code")
            }
        } catch (e: Exception) {
            val msg = e.message ?: e.javaClass.simpleName
            FsResult(ok = false, code = -1, body = "", error = msg)
        } finally {
            conn?.disconnect()
        }
    }

    private fun fsString(v: String) = JSONObject().put("stringValue", v)
    private fun fsDouble(v: Double) = JSONObject().put("doubleValue", v)
    private fun fsInt(v: Int) = JSONObject().put("integerValue", v.toString())
    private fun fsBool(v: Boolean) = JSONObject().put("booleanValue", v)

    private fun readFsString(fields: JSONObject, key: String): String {
        val obj = fields.optJSONObject(key) ?: return ""
        return obj.optString("stringValue", "")
    }
}
