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
import java.util.concurrent.Executors

object EventClient {

    private const val TAG = "ArgoEventClient"
    const val BASE_URL = "http://10.0.2.2:8000"
    const val DEVICE_ID = "emu1"

    private val eventExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "argo-event-post").apply { isDaemon = true }
    }

    fun poll(lat: Double?, lon: Double?, batteryPct: Int, src: String = "gps"): PollResponse? {
        val params = buildList {
            add("device=${URLEncoder.encode(DEVICE_ID, "UTF-8")}")
            if (lat != null && lon != null) {
                add(String.format(Locale.US, "lat=%.6f", lat))
                add(String.format(Locale.US, "lon=%.6f", lon))
            }
            add(String.format(Locale.US, "battery=%d", batteryPct))
            add("src=${URLEncoder.encode(src, "UTF-8")}")
        }
        val query = params.joinToString("&")
        val url = URL("$BASE_URL/api/device/poll?$query")
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
                if (body.isBlank()) null else AlertJsonParser.parsePollResponse(body)
            } else {
                Log.w(TAG, "Poll returned HTTP $code")
                null
            }
        } catch (e: Exception) {
            Log.w(TAG, "Poll failed: ${e.message}")
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
    ) {
        val url = URL("$BASE_URL/api/device/event")
        var conn: HttpURLConnection? = null
        try {
            val payload = JSONObject().apply {
                put("device", DEVICE_ID)
                put("event", event)
                put("detail", detail)
                put("lat", lat)
                put("lon", lon)
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
    ) {
        eventExecutor.execute {
            postEventSync(event, detail, lat, lon)
        }
    }
}
