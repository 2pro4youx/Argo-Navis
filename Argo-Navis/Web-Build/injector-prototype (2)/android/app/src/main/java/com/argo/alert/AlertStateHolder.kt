package com.argo.alert

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class ActiveAlertState(
    val alert: AlertPayload? = null,
    val reservePowerActive: Boolean = false,
    val userLocation: GeoPoint = GeoPoint(0.0, 0.0),
    val batteryPct: Int = 100,
    val clearNonce: Long = 0L,
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

    fun clearAlert() {
        _state.value = _state.value.copy(
            alert = null,
            reservePowerActive = false,
            clearNonce = _state.value.clearNonce + 1L,
        )
    }
}
