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
import java.util.concurrent.Executors

object EventClient {

    private const val TAG = "ArgoEventClient"
    const val DEFAULT_BASE_URL = "http://10.0.2.2:8000"
    const val DEVICE_ID = "nord5"
    private const val PREFS_NAME = "argo_alert_config"
    private const val KEY_SERVER_URL = "server_url"

    @Volatile
    private var baseUrl: String = DEFAULT_BASE_URL

    private val eventExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "argo-event-post").apply { isDaemon = true }
    }

    fun init(context: Context) {
        runCatching {
            val storageCtx = context.createDeviceProtectedStorageContext()
            val prefs = storageCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val saved = prefs.getString(KEY_SERVER_URL, DEFAULT_BASE_URL)
            if (!saved.isNullOrBlank()) {
                baseUrl = saved.trim().trimEnd('/')
                AlertStateHolder.updateServerUrl(baseUrl)
            }
        }
    }

    fun setBaseUrl(context: Context, url: String) {
        val normalized = url.trim().trimEnd('/')
        if (normalized.isEmpty()) return
        baseUrl = normalized
        AlertStateHolder.updateServerUrl(normalized)
        runCatching {
            val storageCtx = context.createDeviceProtectedStorageContext()
            storageCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_SERVER_URL, normalized)
                .apply()
        }
    }

    fun getBaseUrl(): String = baseUrl

    fun poll(lat: Double, lon: Double, batteryPct: Int, source: String = "gps"): PollResponse? {
        val query = String.format(
            Locale.US,
            "device=%s&lat=%.6f&lon=%.6f&battery=%d&src=%s",
            URLEncoder.encode(DEVICE_ID, "UTF-8"),
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

    fun postEventSync(
        event: String,
        detail: String,
        lat: Double,
        lon: Double,
        intervalS: Int? = null,
    ) {
        val url = URL("$baseUrl/api/device/event")
        var conn: HttpURLConnection? = null
        try {
            val payload = JSONObject().apply {
                put("device", DEVICE_ID)
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
                Log.w(TAG, "Event $event returned HTTP $code")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed posting event $event: ${e.message}")
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
