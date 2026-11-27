package com.argo.alert

import android.content.Context
import android.os.Build
import android.provider.Settings
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
    const val DEFAULT_BASE_URL = "https://argo-navis-ad84c-default-rtdb.asia-southeast1.firebasedatabase.app"
    const val DEFAULT_FIREBASE_CHANNEL = "argo-default"
    const val DEFAULT_DEVICE_ID = "argo-device"

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

    private fun isFirebaseRtdb(url: String): Boolean {
        val lower = url.lowercase(Locale.US)
        return lower.contains("firebaseio.com") || lower.contains("firebasedatabase.app")
    }

    private fun sanitizeId(raw: String): String {
        val cleaned = raw.trim()
            .lowercase(Locale.US)
            .replace(Regex("[^a-z0-9_-]+"), "-")
            .trim('-', '_')
        return cleaned.take(32)
    }

    private fun generateUniqueDeviceId(context: Context): String {
        val modelSlug = sanitizeId(Build.MODEL ?: "phone").take(16).ifEmpty { "phone" }
        val androidId = runCatching {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        }.getOrNull().orEmpty().trim()
        val suffix = if (androidId.length >= 4) {
            androidId.takeLast(4).lowercase(Locale.US)
        } else {
            UUID.randomUUID().toString().replace("-", "").take(4)
        }
        return "$modelSlug-$suffix"
    }

    private val eventExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "argo-event-post").apply { isDaemon = true }
    }

    fun init(context: Context) {
        runCatching {
            val storageCtx = context.createDeviceProtectedStorageContext()
            val prefs = storageCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

            val savedUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_BASE_URL)
            if (!savedUrl.isNullOrBlank()) {
                baseUrl = savedUrl.trim().trimEnd('/')
                AlertStateHolder.updateServerUrl(baseUrl)
            }

            val savedMode = TransportMode.fromKey(prefs.getString(KEY_TRANSPORT_MODE, null))
            transportMode = savedMode
            AlertStateHolder.updateTransportMode(savedMode)

            val savedChannel = prefs.getString(KEY_FIREBASE_CHANNEL, DEFAULT_FIREBASE_CHANNEL)
            if (!savedChannel.isNullOrBlank()) {
                firebaseChannel = sanitizeId(savedChannel).ifEmpty { DEFAULT_FIREBASE_CHANNEL }
                AlertStateHolder.updateFirebaseChannel(firebaseChannel)
            }

            val savedDeviceId = prefs.getString(KEY_DEVICE_ID, null)
            val resolvedDeviceId = if (!savedDeviceId.isNullOrBlank()) {
                sanitizeId(savedDeviceId).ifEmpty { generateUniqueDeviceId(context) }
            } else {
                val generated = generateUniqueDeviceId(context)
                prefs.edit().putString(KEY_DEVICE_ID, generated).apply()
                generated
            }
            deviceId = resolvedDeviceId
            AlertStateHolder.updateDeviceId(resolvedDeviceId)
        }
    }

    fun setBaseUrl(context: Context, url: String): Boolean {
        var normalized = url.trim().trimEnd('/')
        if (normalized.isEmpty()) return false
        if (!normalized.startsWith("http://", ignoreCase = true) &&
            !normalized.startsWith("https://", ignoreCase = true)
        ) {
            normalized = "http://$normalized"
        }
        val parsed = runCatching { URL(normalized) }.getOrNull() ?: return false
        if (parsed.host.isNullOrBlank()) return false

        baseUrl = normalized
        AlertStateHolder.updateServerUrl(normalized)
        runCatching {
            val storageCtx = context.createDeviceProtectedStorageContext()
            storageCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_SERVER_URL, normalized)
                .apply()
        }
        return true
    }

    fun getBaseUrl(): String = baseUrl

    fun setTransportMode(context: Context, mode: TransportMode) {
        transportMode = mode
        AlertStateHolder.updateTransportMode(mode)
        runCatching {
            val storageCtx = context.createDeviceProtectedStorageContext()
            storageCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_TRANSPORT_MODE, mode.storageKey)
                .apply()
        }
    }

    fun setFirebaseChannel(context: Context, channel: String): String {
        val normalized = sanitizeId(channel).ifEmpty { DEFAULT_FIREBASE_CHANNEL }
        firebaseChannel = normalized
        AlertStateHolder.updateFirebaseChannel(normalized)
        runCatching {
            val storageCtx = context.createDeviceProtectedStorageContext()
            storageCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_FIREBASE_CHANNEL, normalized)
                .apply()
        }
        return normalized
    }

    fun setDeviceId(context: Context, rawId: String): String {
        val normalized = sanitizeId(rawId).ifEmpty { generateUniqueDeviceId(context) }
        deviceId = normalized
        AlertStateHolder.updateDeviceId(normalized)
        runCatching {
            val storageCtx = context.createDeviceProtectedStorageContext()
            storageCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_DEVICE_ID, normalized)
                .apply()
        }
        return normalized
    }

    fun getDeviceId(): String = deviceId

    private fun firebaseRootUrl(): String =
        if (isFirebaseRtdb(baseUrl)) baseUrl else DEFAULT_BASE_URL

    private fun firebasePathPrefix(): String =
        if (firebaseChannel == DEFAULT_FIREBASE_CHANNEL) "" else "channels/$firebaseChannel/"

    fun pollAll(lat: Double, lon: Double, batteryPct: Int, source: String = "gps"): List<PollResponse> {
        val results = mutableListOf<PollResponse>()
        val useFirebase = transportMode == TransportMode.FIREBASE || transportMode == TransportMode.DUAL
        val useDirectHttp = transportMode == TransportMode.HTTP_IP ||
            (transportMode == TransportMode.DUAL && !isFirebaseRtdb(baseUrl))

        if (useFirebase) {
            pollFirebase(lat, lon, batteryPct, source)?.let { results.add(it) }
        } else {
            AlertStateHolder.updateFirebaseStatus("Disabled (${transportMode.label})")
        }

        if (useDirectHttp) {
            pollHttp(lat, lon, batteryPct, source)?.let { results.add(it) }
        } else if (transportMode == TransportMode.FIREBASE) {
            AlertStateHolder.updatePollStatus("Firebase only")
        }

        return results
    }

    fun poll(lat: Double, lon: Double, batteryPct: Int, source: String = "gps"): PollResponse? =
        pollAll(lat, lon, batteryPct, source).firstOrNull()

    private fun pollHttp(lat: Double, lon: Double, batteryPct: Int, source: String): PollResponse? {
        val query = String.format(
            Locale.US,
            "device=%s&lat=%.6f&lon=%.6f&battery=%d&src=%s",
            URLEncoder.encode(deviceId, "UTF-8"),
            lat,
            lon,
            batteryPct,
            URLEncoder.encode(source, "UTF-8"),
        )
        val url = URL("$baseUrl/api/device/poll?$query")
        var conn: HttpURLConnection? = null
        return try {
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
                Log.w(TAG, "Poll returned HTTP $code")
                AlertStateHolder.updatePollStatus("HTTP error $code")
                null
            }
        } catch (e: Exception) {
            val msg = e.message ?: e.javaClass.simpleName
            Log.w(TAG, "Poll failed ($baseUrl): $msg")
            AlertStateHolder.updatePollStatus("Offline: $msg")
            null
        } finally {
            conn?.disconnect()
        }
    }

    private fun pollFirebase(lat: Double, lon: Double, batteryPct: Int, source: String): PollResponse? {
        val fbRoot = firebaseRootUrl()
        val prefix = firebasePathPrefix()

        // 1. Update this device's telemetry in RTDB under its unique deviceId
        runCatching {
            val telemetry = JSONObject().apply {
                put("id", deviceId)
                put("model", Build.MODEL ?: "Android")
                put("lat", lat)
                put("lon", lon)
                put("battery", batteryPct)
                put("src", source)
                put("last_seen", System.currentTimeMillis() / 1000.0)
            }.toString()
            val putConn = (URL("$fbRoot/${prefix}devices/$deviceId.json").openConnection() as HttpURLConnection).apply {
                requestMethod = "PUT"
                doOutput = true
                connectTimeout = 3_000
                readTimeout = 3_000
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
            OutputStreamWriter(putConn.outputStream, StandardCharsets.UTF_8).use {
                it.write(telemetry)
                it.flush()
            }
            putConn.responseCode
            putConn.disconnect()
        }

        // 2. Read current alert from RTDB
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("$fbRoot/${prefix}alert.json").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 3_000
                readTimeout = 3_000
                setRequestProperty("Accept", "application/json")
            }
            val code = conn.responseCode
            if (code in 200..299) {
                val body = BufferedReader(
                    InputStreamReader(conn.inputStream, StandardCharsets.UTF_8)
                ).use { it.readText() }.trim()
                AlertStateHolder.updateFirebaseStatus("Connected ($deviceId)")
                if (transportMode == TransportMode.DUAL && isFirebaseRtdb(baseUrl)) {
                    AlertStateHolder.updatePollStatus("Connected (Firebase · $deviceId)")
                }
                if (body.isBlank() || body == "null") null else AlertJsonParser.parsePollResponse(body)
            } else {
                Log.w(TAG, "Firebase poll returned HTTP $code")
                AlertStateHolder.updateFirebaseStatus("HTTP $code")
                null
            }
        } catch (e: Exception) {
            val msg = e.message ?: e.javaClass.simpleName
            Log.w(TAG, "Firebase poll failed ($fbRoot): $msg")
            AlertStateHolder.updateFirebaseStatus("Offline: $msg")
            null
        } finally {
            conn?.disconnect()
        }
    }

    fun postEventSync(
        event: String,
        detail: String,
        lat: Double,
        lon: Double,
        intervalS: Int? = null,
    ) {
        val useFirebase = transportMode == TransportMode.FIREBASE || transportMode == TransportMode.DUAL
        val useDirectHttp = transportMode == TransportMode.HTTP_IP ||
            (transportMode == TransportMode.DUAL && !isFirebaseRtdb(baseUrl))

        if (useFirebase) {
            val fbRoot = firebaseRootUrl()
            val prefix = firebasePathPrefix()
            postJson(
                targetUrl = "$fbRoot/${prefix}events.json",
                event = event,
                detail = detail,
                lat = lat,
                lon = lon,
                intervalS = intervalS,
                includeTimestamp = true,
                timeoutMs = 3_000,
            )
        }

        if (useDirectHttp) {
            postJson(
                targetUrl = "$baseUrl/api/device/event",
                event = event,
                detail = detail,
                lat = lat,
                lon = lon,
                intervalS = intervalS,
                includeTimestamp = false,
                timeoutMs = 1_500,
            )
        }
    }

    private fun postJson(
        targetUrl: String,
        event: String,
        detail: String,
        lat: Double,
        lon: Double,
        intervalS: Int?,
        includeTimestamp: Boolean,
        timeoutMs: Int,
    ) {
        var conn: HttpURLConnection? = null
        try {
            val payload = JSONObject().apply {
                put("device", deviceId)
                put("event", event)
                put("detail", detail)
                put("lat", lat)
                put("lon", lon)
                if (intervalS != null) {
                    put("interval_s", intervalS)
                }
                if (includeTimestamp) {
                    put("ts", System.currentTimeMillis() / 1000.0)
                }
            }.toString()

            conn = (URL(targetUrl).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
            OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use { writer ->
                writer.write(payload)
                writer.flush()
            }
            val code = conn.responseCode
            if (code !in 200..299) {
                Log.w(TAG, "Event $event to $targetUrl returned HTTP $code")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed posting event $event to $targetUrl: ${e.message}")
        } finally {
            conn?.disconnect()
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
}
