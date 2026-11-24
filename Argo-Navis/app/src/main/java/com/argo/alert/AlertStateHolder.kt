package com.argo.alert

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class ActiveAlertState(
    val alert: AlertPayload? = null,
    val reservePowerActive: Boolean = false,
    val userLocation: GeoPoint = GeoPoint(23.2599, 77.4126),
    val batteryPct: Int = 100,
    val clearNonce: Long = 0L,
    val serverUrl: String = EventClient.DEFAULT_BASE_URL,
    val lastPollStatus: String = "Starting...",
    val mockLocationOverride: GeoPoint? = null,
    val mockBatteryOverride: Int? = null,
)

object AlertStateHolder {

    private val _state = MutableStateFlow(ActiveAlertState())
    val state: StateFlow<ActiveAlertState> = _state.asStateFlow()

    fun activateAlert(
        alert: AlertPayload,
        reservePowerActive: Boolean,
        location: GeoPoint,
        batteryPct: Int,
    ) {
        _state.value = _state.value.copy(
            alert = alert,
            reservePowerActive = reservePowerActive,
            userLocation = location,
            batteryPct = batteryPct,
        )
    }

    fun updateLocation(location: GeoPoint) {
        _state.value = _state.value.copy(userLocation = location)
    }

    fun updateBattery(batteryPct: Int) {
        _state.value = _state.value.copy(
            batteryPct = batteryPct,
            reservePowerActive = _state.value.reservePowerActive || batteryPct <= 5,
        )
    }

    fun updateServerUrl(url: String) {
        val cleaned = url.trim().trimEnd('/')
        if (cleaned.isNotEmpty()) {
            _state.value = _state.value.copy(serverUrl = cleaned)
        }
    }

    fun updatePollStatus(status: String) {
        _state.value = _state.value.copy(lastPollStatus = status)
    }

    fun setMockLocation(point: GeoPoint?) {
        _state.value = _state.value.copy(
            mockLocationOverride = point,
            userLocation = point ?: _state.value.userLocation,
        )
    }

    fun setMockBattery(pct: Int?) {
        _state.value = _state.value.copy(
            mockBatteryOverride = pct,
            batteryPct = pct ?: _state.value.batteryPct,
        )
    }

    fun clearAlert() {
        _state.value = _state.value.copy(
            alert = null,
            reservePowerActive = false,
            clearNonce = _state.value.clearNonce + 1L,
        )
    }
}
