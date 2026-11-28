package com.argo.alert

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class ActiveAlertState(
    val alert: AlertPayload? = null,
    val reservePowerActive: Boolean = false,
    val userLocation: GeoPoint = GeoPoint(23.2599, 77.4126),
    val locationSource: String = "none",
    val batteryPct: Int = 100,
    val clearNonce: Long = 0L,
    val transportMode: TransportMode = TransportMode.DUAL,
    val firebaseChannel: String = EventClient.DEFAULT_FIREBASE_CHANNEL,
    val deviceId: String = EventClient.DEFAULT_DEVICE_ID,
    val firebaseStatus: String = "Connecting...",
    val serverUrl: String = EventClient.DEFAULT_BASE_URL,
    val lastPollStatus: String = "Starting...",
    val mockLocationOverride: GeoPoint? = null,
    val mockBatteryOverride: Int? = null,
    val localShelters: List<Shelter> = emptyList(),
) {
    fun effectiveShelters(): List<Shelter> {
        val alertShelters = alert?.shelters.orEmpty()
        return if (localShelters.isEmpty()) {
            alertShelters
        } else {
            LocalShelterResolver.mergeShelters(userLocation, localShelters, alertShelters)
        }
    }
}

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
            localShelters = emptyList(),
        )
    }

    fun updateAlertPayload(alert: AlertPayload) {
        val current = _state.value
        if (current.alert?.alertId == alert.alertId) {
            _state.value = current.copy(alert = alert)
        }
    }

    fun updateLocalShelters(alertId: String, shelters: List<Shelter>) {
        val current = _state.value
        if (current.alert?.alertId == alertId) {
            _state.value = current.copy(localShelters = shelters)
        }
    }

    fun updateLocation(location: GeoPoint, source: String = _state.value.locationSource) {
        _state.value = _state.value.copy(
            userLocation = location,
            locationSource = source,
        )
    }

    fun updateBattery(batteryPct: Int) {
        val current = _state.value
        val nextReserve = if (current.alert != null) {
            current.reservePowerActive || batteryPct <= 5
        } else {
            batteryPct <= 5
        }
        _state.value = current.copy(
            batteryPct = batteryPct,
            reservePowerActive = nextReserve,
        )
    }

    fun updateTransportMode(mode: TransportMode) {
        _state.value = _state.value.copy(transportMode = mode)
    }

    fun updateFirebaseChannel(channel: String) {
        _state.value = _state.value.copy(firebaseChannel = channel)
    }

    fun updateDeviceId(deviceId: String) {
        _state.value = _state.value.copy(deviceId = deviceId)
    }

    fun updateFirebaseStatus(status: String) {
        _state.value = _state.value.copy(firebaseStatus = status)
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
            locationSource = if (point != null) "mock" else _state.value.locationSource,
        )
    }

    fun setMockBattery(pct: Int?) {
        val current = _state.value
        _state.value = current.copy(
            mockBatteryOverride = pct,
            batteryPct = pct ?: current.batteryPct,
            reservePowerActive = if (pct != null) pct <= 5 else false,
        )
    }

    fun clearAlert() {
        _state.value = _state.value.copy(
            alert = null,
            reservePowerActive = false,
            localShelters = emptyList(),
            clearNonce = _state.value.clearNonce + 1L,
        )
    }
}
