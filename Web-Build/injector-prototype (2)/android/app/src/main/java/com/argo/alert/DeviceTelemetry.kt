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
import androidx.core.content.ContextCompat

data class LocationReading(
    val point: GeoPoint?,
    val source: String,
)

class DeviceTelemetry(private val context: Context) {

    private val locationManager =
        context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private val batteryManager =
        context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager

    @Volatile
    private var latestFix: Location? = null

    @Volatile
    private var latestSource: String = "none"

    private var listening = false

    private val locationListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            updateIfBetter(location)
        }

        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        override fun onProviderEnabled(provider: String) = Unit
        override fun onProviderDisabled(provider: String) = Unit
    }

    @Synchronized
    private fun updateIfBetter(candidate: Location) {
        val current = latestFix
        val accept = if (current == null) {
            true
        } else {
            val timeDelta = candidate.time - current.time
            val isNewer = timeDelta > 10_000L
            val isFromGps = candidate.provider == LocationManager.GPS_PROVIDER
            val isMoreAccurate = candidate.hasAccuracy() &&
                (!current.hasAccuracy() || candidate.accuracy <= current.accuracy)
            isNewer || (isFromGps && timeDelta >= 0L) || (isMoreAccurate && timeDelta >= -5_000L)
        }
        if (accept) {
            latestFix = candidate
            latestSource = when (candidate.provider) {
                LocationManager.GPS_PROVIDER -> "gps"
                LocationManager.NETWORK_PROVIDER -> "network"
                else -> "fused"
            }
            AlertStateHolder.updateLocation(GeoPoint(candidate.latitude, candidate.longitude))
        }
    }

    fun startLocationUpdates() {
        if (listening) return
        val hasFine = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        if (!hasFine && !hasCoarse) {
            latestSource = "none"
            return
        }

        runCatching {
            if (hasFine) {
                locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)?.let {
                    updateIfBetter(it)
                }
            }
            locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)?.let {
                updateIfBetter(it)
            }

            if (hasFine && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    2_000L,
                    0f,
                    locationListener,
                    Looper.getMainLooper(),
                )
                listening = true
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    5_000L,
                    0f,
                    locationListener,
                    Looper.getMainLooper(),
                )
                listening = true
            }
        }
    }

    fun stopLocationUpdates() {
        if (!listening) return
        runCatching {
            locationManager.removeUpdates(locationListener)
        }
        listening = false
    }

    fun getCurrentReading(): LocationReading {
        val hasFine = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED

        if (hasFine || hasCoarse) {
            runCatching {
                if (hasFine) {
                    locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)?.let {
                        updateIfBetter(it)
                    }
                }
                locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)?.let {
                    updateIfBetter(it)
                }
            }
        }

        val fix = latestFix
        return if (fix != null) {
            LocationReading(GeoPoint(fix.latitude, fix.longitude), latestSource)
        } else {
            LocationReading(null, "none")
        }
    }

    fun getCurrentLocation(): GeoPoint {
        return getCurrentReading().point ?: GeoPoint(0.0, 0.0)
    }

    fun getBatteryPercentage(): Int {
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
}
