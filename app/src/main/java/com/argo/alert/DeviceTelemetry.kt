package com.argo.alert

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Bundle
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat

class DeviceTelemetry(private val context: Context) {

    private val locationManager =
        context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private val batteryManager =
        context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager

    // Placeholder only so the UI has something to draw before the first fix. It is NOT a real fix:
    // locationSource() reports "none" until a genuine GPS/network location has arrived.
    @Volatile
    private var latestLocation: GeoPoint = GeoPoint(23.2599, 77.4126)

    @Volatile
    private var fixElapsedMs: Long = -1L

    @Volatile
    private var fixProvider: String = "none"

    private var listening = false

    private val locationListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            acceptFix(location, SystemClock.elapsedRealtime())
        }

        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        override fun onProviderEnabled(provider: String) = Unit
        override fun onProviderDisabled(provider: String) = Unit
    }

    private fun acceptFix(location: Location, fixAtMs: Long) {
        if (location.latitude == 0.0 && location.longitude == 0.0) return
        val provider = location.provider ?: LocationManager.GPS_PROVIDER
        // A coarse network fix must not overwrite a GPS fix that arrived in the last 10 seconds.
        if (provider == LocationManager.NETWORK_PROVIDER &&
            fixProvider == LocationManager.GPS_PROVIDER &&
            SystemClock.elapsedRealtime() - fixElapsedMs < 10_000L
        ) {
            return
        }
        if (fixAtMs < fixElapsedMs) return
        latestLocation = GeoPoint(location.latitude, location.longitude)
        fixElapsedMs = fixAtMs
        fixProvider = provider
        if (AlertStateHolder.state.value.mockLocationOverride == null) {
            AlertStateHolder.updateLocation(latestLocation, locationSource())
        }
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    fun startLocationUpdates(forceRefresh: Boolean = false) {
        if (!hasLocationPermission()) return
        if (listening && !forceRefresh) {
            runCatching { refreshFromLastKnown() }
            return
        }
        if (listening) {
            runCatching { locationManager.removeUpdates(locationListener) }
            listening = false
        }
        runCatching { refreshFromLastKnown() }
        // GPS gives the exact position; the network provider gives a fast rough fix indoors.
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            runCatching {
                if (locationManager.isProviderEnabled(provider)) {
                    locationManager.requestLocationUpdates(
                        provider,
                        2_000L,
                        0f,
                        locationListener,
                        Looper.getMainLooper(),
                    )
                    listening = true
                }
            }
        }
    }

    fun stopLocationUpdates() {
        if (!listening) return
        runCatching { locationManager.removeUpdates(locationListener) }
        listening = false
    }

    /** Where the position comes from: "mock" (demo override), "gps", "network", or "none" (no recent real fix). */
    fun locationSource(): String {
        if (AlertStateHolder.state.value.mockLocationOverride != null) return "mock"
        if (fixElapsedMs < 0) return "none"
        val age = SystemClock.elapsedRealtime() - fixElapsedMs
        return if (age <= FIX_MAX_AGE_MS) fixProvider else "none"
    }

    fun getCurrentLocation(): GeoPoint {
        val override = AlertStateHolder.state.value.mockLocationOverride
        if (override != null) return override
        if (hasLocationPermission()) {
            runCatching { refreshFromLastKnown() }
        }
        return latestLocation
    }

    private fun refreshFromLastKnown() {
        val best = listOf(
            LocationManager.GPS_PROVIDER,
            LocationManager.NETWORK_PROVIDER,
            LocationManager.PASSIVE_PROVIDER,
        ).mapNotNull { runCatching { locationManager.getLastKnownLocation(it) }.getOrNull() }
            .maxByOrNull { it.elapsedRealtimeNanos } ?: return
        val ageMs = (SystemClock.elapsedRealtimeNanos() - best.elapsedRealtimeNanos) / 1_000_000L
        acceptFix(best, SystemClock.elapsedRealtime() - ageMs)
    }

    fun getBatteryPercentage(): Int {
        val override = AlertStateHolder.state.value.mockBatteryOverride
        if (override != null) return override.coerceIn(0, 100)

        val direct = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        if (direct in 0..100) return direct

        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        return if (level >= 0 && scale > 0) {
            ((level * 100f) / scale).toInt().coerceIn(0, 100)
        } else {
            100
        }
    }

    companion object {
        private const val FIX_MAX_AGE_MS = 10 * 60 * 1000L
    }
}
