package com.argo.alert

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

class AlertService : Service() {

    companion object {
        private const val TAG = "ArgoAlertService"
        private const val LEGACY_MONITOR_CHANNEL_ID = "argo_monitor"
        private const val MONITOR_CHANNEL_ID = "argo_monitor_hidden"
        private const val ALARM_CHANNEL_ID = "argo_alarm"
        private const val MONITOR_NOTIFICATION_ID = 1001
        const val ALARM_NOTIFICATION_ID = 1002
        private const val POLL_INTERVAL_SECONDS = 2L

        const val ACTION_START = "com.argo.alert.ACTION_START"
        const val ACTION_POLL_NOW = "com.argo.alert.ACTION_POLL_NOW"
        const val ACTION_REFRESH_TELEMETRY = "com.argo.alert.ACTION_REFRESH_TELEMETRY"
        const val ACTION_RESTART = "com.argo.alert.ACTION_RESTART"

        private fun sendAction(context: Context, action: String) {
            val intent = Intent(context, AlertService::class.java).apply {
                this.action = action
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun start(context: Context) = sendAction(context, ACTION_START)
        fun pollNow(context: Context) = sendAction(context, ACTION_POLL_NOW)
        fun refreshTelemetry(context: Context) = sendAction(context, ACTION_REFRESH_TELEMETRY)
        fun restart(context: Context) = sendAction(context, ACTION_RESTART)

        fun cancelAlarmNotification(context: Context) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(ALARM_NOTIFICATION_ID)
        }
    }

    private lateinit var telemetry: DeviceTelemetry
    private var scheduler: ScheduledExecutorService? = null
    private var wakeLock: PowerManager.WakeLock? = null

    private val seenPayloads = mutableSetOf<String>()
    private val clearedAlertIds = mutableSetOf<String>()
    private var activeAlertId: String? = null

    override fun onCreate() {
        super.onCreate()
        EventClient.init(applicationContext)
        telemetry = DeviceTelemetry(applicationContext)
        createNotificationChannels()
        startForegroundMonitor()
        telemetry.startLocationUpdates()
        startPollingLoop()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_POLL_NOW -> {
                triggerImmediatePoll()
            }
            ACTION_REFRESH_TELEMETRY -> {
                telemetry.startLocationUpdates(forceRefresh = true)
                syncTelemetryToState()
                triggerImmediatePoll()
            }
            ACTION_RESTART -> {
                if (activeAlertId == null) {
                    seenPayloads.clear()
                }
                telemetry.startLocationUpdates(forceRefresh = true)
                restartPollingLoop()
                syncTelemetryToState()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scheduler?.shutdownNow()
        scheduler = null
        telemetry.stopLocationUpdates()
        releaseWakeLock()
        super.onDestroy()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.deleteNotificationChannel(LEGACY_MONITOR_CHANNEL_ID)

        val monitorChannel = NotificationChannel(
            MONITOR_CHANNEL_ID,
            getString(R.string.monitor_channel_name),
            NotificationManager.IMPORTANCE_MIN,
        ).apply {
            description = getString(R.string.monitor_channel_description)
            setShowBadge(false)
            setSound(null, null)
            enableVibration(false)
            lockscreenVisibility = Notification.VISIBILITY_SECRET
        }
        nm.createNotificationChannel(monitorChannel)

        val alarmChannel = NotificationChannel(
            ALARM_CHANNEL_ID,
            getString(R.string.alarm_channel_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = getString(R.string.alarm_channel_description)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setBypassDnd(true)
            setSound(null, null) // AudioTrack handles USAGE_ALARM siren synthesis
            enableVibration(false)
        }
        nm.createNotificationChannel(alarmChannel)
    }

    private fun startForegroundMonitor() {
        val notification = NotificationCompat.Builder(this, MONITOR_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("OEM emergency layer active")
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                MONITOR_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(MONITOR_NOTIFICATION_ID, notification)
        }
    }

    private fun startPollingLoop() {
        if (scheduler != null) return
        scheduler = Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "argo-poll-loop").apply { isDaemon = true }
        }
        scheduler?.scheduleWithFixedDelay(
            { pollOnce() },
            0L,
            POLL_INTERVAL_SECONDS,
            TimeUnit.SECONDS,
        )
    }

    private fun restartPollingLoop() {
        scheduler?.shutdownNow()
        scheduler = null
        startPollingLoop()
    }

    private fun triggerImmediatePoll() {
        val exec = scheduler
        if (exec == null || exec.isShutdown) {
            startPollingLoop()
        } else {
            runCatching { exec.execute { pollOnce() } }
        }
    }

    private fun syncTelemetryToState() {
        val location = telemetry.getCurrentLocation()
        val batteryPct = telemetry.getBatteryPercentage()
        AlertStateHolder.updateLocation(location, telemetry.locationSource())
        AlertStateHolder.updateBattery(batteryPct)
    }

    private fun pollOnce() {
        try {
            val location = telemetry.getCurrentLocation()
            val batteryPct = telemetry.getBatteryPercentage()
            val source = telemetry.locationSource()
            AlertStateHolder.updateLocation(location, source)
            AlertStateHolder.updateBattery(batteryPct)

            val responses = EventClient.pollAll(location.lat, location.lon, batteryPct, source)
            for (response in responses) {
                when (response.status) {
                    "ACTIVE" -> handleActivePoll(response, location, batteryPct)
                    "CLEARED" -> handleClearedPoll(response, location)
                }
            }
            val currentActive = activeAlertId ?: AlertStateHolder.state.value.alert?.alertId
            if (currentActive != null &&
                responses.isNotEmpty() &&
                responses.none { it.status == "ACTIVE" } &&
                responses.any { it.status == "NONE" }
            ) {
                clearActiveAlert(currentActive, location)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in poll loop: ${e.message}", e)
        }
    }

    private fun handleActivePoll(
        response: PollResponse,
        location: GeoPoint,
        batteryPct: Int,
    ) {
        val rawPayload = response.payloadRaw ?: return
        if (seenPayloads.contains(rawPayload)) return
        seenPayloads.add(rawPayload)

        // Step 1: ALERT_RECEIVED
        EventClient.postEventSync(
            event = "ALERT_RECEIVED",
            detail = "bytes=${rawPayload.length}",
            lat = location.lat,
            lon = location.lon,
        )

        // Step 2: Verify HMAC-SHA256 (constant-time hex compare)
        val sigOk = CryptoAndGeo.verifyHmacSha256(
            message = rawPayload,
            providedHex = response.signature,
            secret = CryptoAndGeo.SHARED_SECRET,
        )
        if (!sigOk) {
            EventClient.postEventSync(
                event = "SIGNATURE_FAIL",
                detail = "HMAC-SHA256 verification failed",
                lat = location.lat,
                lon = location.lon,
            )
            return
        }
        EventClient.postEventSync(
            event = "SIGNATURE_OK",
            detail = "HMAC-SHA256 verified",
            lat = location.lat,
            lon = location.lon,
        )

        val alert = try {
            AlertJsonParser.parseAlertPayload(rawPayload)
        } catch (e: Exception) {
            Log.e(TAG, "Invalid alert JSON: ${e.message}", e)
            return
        }
        if (clearedAlertIds.contains(alert.alertId)) {
            return
        }

        // Step 3: Haversine distance check
        val distanceKm = CryptoAndGeo.haversineKm(
            location.lat,
            location.lon,
            alert.region.center.lat,
            alert.region.center.lon,
        )
        if (distanceKm > alert.region.radiusKm) {
            EventClient.postEventSync(
                event = "OUT_OF_REGION",
                detail = String.format(
                    Locale.US,
                    "distance_km=%.2f radius_km=%.2f",
                    distanceKm,
                    alert.region.radiusKm,
                ),
                lat = location.lat,
                lon = location.lon,
            )
            return
        }
        EventClient.postEventSync(
            event = "IN_REGION",
            detail = String.format(
                Locale.US,
                "distance_km=%.2f radius_km=%.2f",
                distanceKm,
                alert.region.radiusKm,
            ),
            lat = location.lat,
            lon = location.lon,
        )

        // Step 4: Reserve power check
        val reservePowerActive = batteryPct <= 5
        if (reservePowerActive) {
            EventClient.postEventSync(
                event = "RESERVE_POWER_ACTIVE",
                detail = "battery=${batteryPct}%",
                lat = location.lat,
                lon = location.lon,
            )
        }

        // Step 5: Launch AlertActivity (+ full-screen-intent notification fallback) & post SIREN_ON
        activeAlertId = alert.alertId
        AlertStateHolder.activateAlert(
            alert = alert,
            reservePowerActive = reservePowerActive,
            location = location,
            batteryPct = batteryPct,
        )
        acquireTemporaryWakeLock()
        SirenController.startFullAlarm(applicationContext)
        launchEmergencyUi(alert)

        EventClient.postEventSync(
            event = "SIREN_ON",
            detail = alert.headline,
            lat = location.lat,
            lon = location.lon,
        )
    }

    private fun handleClearedPoll(response: PollResponse, location: GeoPoint) {
        // Only process CLEARED once while an alert is actually active
        val currentActive = activeAlertId ?: AlertStateHolder.state.value.alert?.alertId ?: return
        val targetAlertId = response.alertId ?: currentActive
        val expectedMessage = "$targetAlertId|CLEARED"
        val validClear = CryptoAndGeo.verifyHmacSha256(
            message = expectedMessage,
            providedHex = response.clearSig,
            secret = CryptoAndGeo.SHARED_SECRET,
        )
        if (!validClear) {
            Log.w(TAG, "Ignoring CLEARED response with invalid clear_sig")
            return
        }

        clearActiveAlert(targetAlertId, location)
    }

    private fun clearActiveAlert(targetAlertId: String, location: GeoPoint) {
        // Step 6: Stop siren, stop lock task / close activity, cancel full-screen notification, post ALL_CLEAR
        clearedAlertIds.add(targetAlertId)
        activeAlertId?.let { clearedAlertIds.add(it) }
        SirenController.stopAll()
        AlertStateHolder.clearAlert()
        activeAlertId = null
        seenPayloads.clear()
        cancelAlarmNotification()
        releaseWakeLock()

        EventClient.postEventSync(
            event = "ALL_CLEAR",
            detail = "alert_id=$targetAlertId",
            lat = location.lat,
            lon = location.lon,
        )
    }

    private fun launchEmergencyUi(alert: AlertPayload) {
        val activityIntent = Intent(this, AlertActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
        }

        runCatching {
            startActivity(activityIntent)
        }.onFailure { err ->
            Log.w(TAG, "Direct startActivity blocked; relying on fullScreenIntent: ${err.message}")
            // Full-screen-intent notification fallback (required for background launches on Android 10+)
            val fullScreenPendingIntent = PendingIntent.getActivity(
                this,
                ALARM_NOTIFICATION_ID,
                activityIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

            val alarmNotification = NotificationCompat.Builder(this, ALARM_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("${alert.type.uppercase()} — ${alert.severity.uppercase()}")
                .setContentText(alert.headline)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .build()

            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(ALARM_NOTIFICATION_ID, alarmNotification)
        }
    }

    private fun cancelAlarmNotification() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(ALARM_NOTIFICATION_ID)
    }

    private fun acquireTemporaryWakeLock() {
        runCatching {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (wakeLock?.isHeld == true) return
            @Suppress("DEPRECATION")
            wakeLock = pm.newWakeLock(
                PowerManager.FULL_WAKE_LOCK or
                    PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    PowerManager.ON_AFTER_RELEASE,
                "ArgoAlert::EmergencyWakeLock",
            ).apply {
                acquire(60_000L)
            }
        }
    }

    private fun releaseWakeLock() {
        runCatching {
            wakeLock?.let {
                if (it.isHeld) it.release()
            }
            wakeLock = null
        }
    }
}
