package com.argo.alert

import android.Manifest
import android.app.NotificationManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.util.Locale

class MainActivity : ComponentActivity() {

    private var serviceStarted by mutableStateOf(false)
    private var isDeviceOwner by mutableStateOf(false)
    private var hasLocationPermission by mutableStateOf(false)
    private var hasNotificationPermission by mutableStateOf(true)
    private var canDrawOverlays by mutableStateOf(false)
    private var canUseFullScreenIntent by mutableStateOf(true)
    private var requestedPermissionsBefore = false

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshStatus()
        AlertService.refreshTelemetry(applicationContext)
        serviceStarted = true
        if (hasLocationPermission && hasNotificationPermission) {
            showToast("Permissions granted")
        } else {
            showToast("Some permissions denied — tap button again for App Settings")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        EventClient.init(applicationContext)
        AdminReceiver.ensureLockTaskWhitelisted(this)
        refreshStatus()
        requestRequiredPermissionsIfNeeded(openSettingsIfBlocked = false)
        startAlertService()

        setContent {
            val state by AlertStateHolder.state.collectAsState()
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Color(0xFFDC2626),
                    onPrimary = Color.White,
                    background = Color(0xFF090B0E),
                    surface = Color(0xFF111827),
                    onBackground = Color.White,
                    onSurface = Color.White,
                ),
            ) {
                BootstrapScreen(
                    serviceStarted = serviceStarted,
                    isDeviceOwner = isDeviceOwner,
                    hasLocationPermission = hasLocationPermission,
                    hasNotificationPermission = hasNotificationPermission,
                    canDrawOverlays = canDrawOverlays,
                    canUseFullScreenIntent = canUseFullScreenIntent,
                    transportMode = state.transportMode,
                    firebaseChannel = state.firebaseChannel,
                    firebaseStatus = state.firebaseStatus,
                    deviceId = state.deviceId,
                    serverUrl = state.serverUrl,
                    pollStatus = state.lastPollStatus,
                    location = state.userLocation,
                    locationSource = state.locationSource,
                    batteryPct = state.batteryPct,
                    mockLocationOverride = state.mockLocationOverride,
                    mockBatteryOverride = state.mockBatteryOverride,
                    onSelectTransportMode = { mode ->
                        EventClient.setTransportMode(applicationContext, mode)
                        AlertService.pollNow(applicationContext)
                        showToast("Transport: ${mode.label}")
                    },
                    onSaveFirebaseChannel = { ch ->
                        val saved = EventClient.setFirebaseChannel(applicationContext, ch)
                        AlertService.pollNow(applicationContext)
                        showToast("Firebase channel: $saved")
                    },
                    onSaveDeviceId = { dev ->
                        val saved = EventClient.setDeviceId(applicationContext, dev)
                        AlertService.pollNow(applicationContext)
                        showToast("Device ID: $saved")
                    },
                    onSaveServerUrl = { url ->
                        if (EventClient.setBaseUrl(applicationContext, url)) {
                            AlertService.pollNow(applicationContext)
                            showToast("Gateway URL saved: ${EventClient.getBaseUrl()}")
                        } else {
                            showToast("Enter a valid URL (e.g. 192.168.1.5:8000)")
                        }
                    },
                    onSetMockLocation = { point ->
                        AlertStateHolder.setMockLocation(point)
                        if (point == null) {
                            if (!hasLocationPermission) {
                                requestRequiredPermissionsIfNeeded(openSettingsIfBlocked = true)
                            }
                            AlertService.refreshTelemetry(applicationContext)
                            showToast("Using real device GPS")
                        } else {
                            AlertService.pollNow(applicationContext)
                            showToast("Demo GPS override active")
                        }
                    },
                    onSetMockBattery = { pct ->
                        AlertStateHolder.setMockBattery(pct)
                        AlertService.refreshTelemetry(applicationContext)
                        showToast(if (pct != null) "Simulating $pct% battery" else "Using real BatteryManager")
                    },
                    onRequestPermissions = {
                        requestRequiredPermissionsIfNeeded(openSettingsIfBlocked = true)
                    },
                    onOpenOverlaySettings = { openOverlaySettings() },
                    onOpenFullScreenIntentSettings = { openFullScreenIntentSettings() },
                    onPollNow = {
                        AlertService.pollNow(applicationContext)
                        showToast("Polling gateway now...")
                    },
                    onRestartService = {
                        AlertService.restart(applicationContext)
                        serviceStarted = true
                        showToast("AlertService restarted")
                    },
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
        AlertService.refreshTelemetry(applicationContext)
    }

    private fun showToast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    private fun refreshStatus() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        isDeviceOwner = dpm.isDeviceOwnerApp(packageName)
        hasLocationPermission = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED
        hasNotificationPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
        canDrawOverlays = Settings.canDrawOverlays(this)
        canUseFullScreenIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.canUseFullScreenIntent()
        } else {
            true
        }
    }

    private fun requestRequiredPermissionsIfNeeded(openSettingsIfBlocked: Boolean) {
        val needed = buildList {
            if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED
            ) {
                add(Manifest.permission.ACCESS_FINE_LOCATION)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (needed.isEmpty()) {
            AlertService.refreshTelemetry(applicationContext)
            return
        }

        val canShowDialog = !requestedPermissionsBefore || needed.any { perm ->
            ActivityCompat.shouldShowRequestPermissionRationale(this, perm)
        }
        if (canShowDialog || !openSettingsIfBlocked) {
            requestedPermissionsBefore = true
            permissionLauncher.launch(needed.toTypedArray())
        } else {
            openAppDetailsSettings("Enable Location & Notifications in App Settings")
        }
    }

    private fun openOverlaySettings() {
        val attempts = listOf(
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")),
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION),
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")),
        )
        launchFirstValidIntent(attempts, "Unable to open Overlay settings")
    }

    private fun openFullScreenIntentSettings() {
        val attempts = buildList {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                add(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName")))
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                add(
                    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                        putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                    }
                )
            }
            add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
        launchFirstValidIntent(attempts, "Unable to open Notification settings")
    }

    private fun openAppDetailsSettings(message: String) {
        showToast(message)
        launchFirstValidIntent(
            listOf(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))),
            "Unable to open App Settings",
        )
    }

    private fun launchFirstValidIntent(intents: List<Intent>, errorMessage: String) {
        for (intent in intents) {
            val launched = runCatching {
                startActivity(intent)
                true
            }.getOrDefault(false)
            if (launched) return
        }
        showToast(errorMessage)
    }

    private fun startAlertService() {
        AlertService.start(applicationContext)
        serviceStarted = true
    }
}

@Composable
private fun BootstrapScreen(
    serviceStarted: Boolean,
    isDeviceOwner: Boolean,
    hasLocationPermission: Boolean,
    hasNotificationPermission: Boolean,
    canDrawOverlays: Boolean,
    canUseFullScreenIntent: Boolean,
    transportMode: TransportMode,
    firebaseChannel: String,
    firebaseStatus: String,
    deviceId: String,
    serverUrl: String,
    pollStatus: String,
    location: GeoPoint,
    locationSource: String,
    batteryPct: Int,
    mockLocationOverride: GeoPoint?,
    mockBatteryOverride: Int?,
    onSelectTransportMode: (TransportMode) -> Unit,
    onSaveFirebaseChannel: (String) -> Unit,
    onSaveDeviceId: (String) -> Unit,
    onSaveServerUrl: (String) -> Unit,
    onSetMockLocation: (GeoPoint?) -> Unit,
    onSetMockBattery: (Int?) -> Unit,
    onRequestPermissions: () -> Unit,
    onOpenOverlaySettings: () -> Unit,
    onOpenFullScreenIntentSettings: () -> Unit,
    onPollNow: () -> Unit,
    onRestartService: () -> Unit,
) {
    var urlInput by remember(serverUrl) { mutableStateOf(serverUrl) }
    var channelInput by remember(firebaseChannel) { mutableStateOf(firebaseChannel) }
    var deviceIdInput by remember(deviceId) { mutableStateOf(deviceId) }

    val isBhopalMock = mockLocationOverride != null &&
        kotlin.math.abs(mockLocationOverride.lat - 23.2599) < 0.001
    val isChennaiMock = mockLocationOverride != null &&
        kotlin.math.abs(mockLocationOverride.lat - 13.0827) < 0.001

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF090B0E))
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Argo Alert",
            color = Color.White,
            fontSize = 30.sp,
            fontWeight = FontWeight.Black,
        )
        Text(
            text = "OEM Emergency Layer · com.argo.alert",
            color = Color(0xFF9CA3AF),
            fontSize = 13.sp,
        )
        Spacer(modifier = Modifier.height(16.dp))

        StatusLine("Foreground AlertService", if (serviceStarted) "Running (2s poll)" else "Stopped")
        StatusLine(
            "Firebase Cloud Link",
            firebaseStatus,
            valueColor = when {
                firebaseStatus.startsWith("Connected") -> Color(0xFF4ADE80)
                firebaseStatus.startsWith("Paused") -> Color(0xFF9CA3AF)
                else -> Color(0xFFF59E0B)
            },
        )
        StatusLine(
            "Direct IP Gateway",
            pollStatus,
            valueColor = when {
                pollStatus.startsWith("Connected") -> Color(0xFF4ADE80)
                pollStatus.startsWith("Paused") -> Color(0xFF9CA3AF)
                else -> Color(0xFFF59E0B)
            },
        )
        StatusLine(
            "Current GPS ($locationSource)",
            String.format(Locale.US, "%.4f, %.4f", location.lat, location.lon),
        )
        StatusLine(
            "Battery (${if (mockBatteryOverride != null) "Demo Override" else "BatteryManager"})",
            "$batteryPct%",
        )
        StatusLine(
            "Device Owner (Lock Task)",
            if (isDeviceOwner) "Provisioned" else "Optional on personal phone",
        )

        Spacer(modifier = Modifier.height(16.dp))
        SectionLabel("Transport Mode (Firebase + IP Side-by-Side)")
        Spacer(modifier = Modifier.height(6.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TransportMode.entries.forEach { mode ->
                val selected = mode == transportMode
                CompactActionButton(
                    label = mode.label,
                    selected = selected,
                    activeColor = Color(0xFF0284C7),
                    onClick = { onSelectTransportMode(mode) },
                    modifier = Modifier.weight(1f),
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
        SectionLabel("Firebase Channel ID (No Port-Forward / IPv4 Needed)")
        Spacer(modifier = Modifier.height(6.dp))
        OutlinedTextField(
            value = channelInput,
            onValueChange = { channelInput = it },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White,
                focusedBorderColor = Color(0xFF38BDF8),
                unfocusedBorderColor = Color(0xFF374151),
            ),
        )
        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CompactActionButton(
                label = "Save Channel",
                selected = true,
                activeColor = Color(0xFF0284C7),
                onClick = { onSaveFirebaseChannel(channelInput) },
                modifier = Modifier.weight(1f),
            )
            CompactActionButton(
                label = "Default (argo-default)",
                selected = false,
                onClick = {
                    channelInput = EventClient.DEFAULT_FIREBASE_CHANNEL
                    onSaveFirebaseChannel(EventClient.DEFAULT_FIREBASE_CHANNEL)
                },
                modifier = Modifier.weight(1f),
            )
        }

        Spacer(modifier = Modifier.height(16.dp))
        SectionLabel("Device ID")
        Spacer(modifier = Modifier.height(6.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = deviceIdInput,
                onValueChange = { deviceIdInput = it },
                singleLine = true,
                modifier = Modifier.weight(1.4f),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    focusedBorderColor = Color(0xFFEF4444),
                    unfocusedBorderColor = Color(0xFF374151),
                ),
            )
            CompactActionButton(
                label = "Save ID",
                selected = false,
                onClick = { onSaveDeviceId(deviceIdInput) },
                modifier = Modifier
                    .weight(0.8f)
                    .height(54.dp),
            )
        }

        Spacer(modifier = Modifier.height(16.dp))
        SectionLabel("Direct IP Gateway URL (Local / USB / LAN)")
        Spacer(modifier = Modifier.height(6.dp))
        OutlinedTextField(
            value = urlInput,
            onValueChange = { urlInput = it },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White,
                focusedBorderColor = Color(0xFFEF4444),
                unfocusedBorderColor = Color(0xFF374151),
            ),
        )
        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CompactActionButton(
                label = "Save URL",
                selected = true,
                activeColor = Color(0xFFDC2626),
                onClick = { onSaveServerUrl(urlInput) },
                modifier = Modifier.weight(1f),
            )
            CompactActionButton(
                label = "USB 127.0.0.1",
                selected = serverUrl == "http://127.0.0.1:8000",
                activeColor = Color(0xFF2563EB),
                onClick = {
                    urlInput = "http://127.0.0.1:8000"
                    onSaveServerUrl("http://127.0.0.1:8000")
                },
                modifier = Modifier.weight(1f),
            )
            CompactActionButton(
                label = "Emu 10.0.2.2",
                selected = serverUrl == "http://10.0.2.2:8000",
                activeColor = Color(0xFF2563EB),
                onClick = {
                    urlInput = "http://10.0.2.2:8000"
                    onSaveServerUrl("http://10.0.2.2:8000")
                },
                modifier = Modifier.weight(1f),
            )
        }

        Spacer(modifier = Modifier.height(16.dp))
        SectionLabel("Indoor / Physical Phone Demo Overrides")
        Spacer(modifier = Modifier.height(6.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CompactActionButton(
                label = "Bhopal GPS",
                selected = isBhopalMock,
                activeColor = Color(0xFF1E3A5F),
                onClick = { onSetMockLocation(GeoPoint(23.2599, 77.4126)) },
                modifier = Modifier.weight(1f),
            )
            CompactActionButton(
                label = "Chennai GPS",
                selected = isChennaiMock,
                activeColor = Color(0xFF1E3A5F),
                onClick = { onSetMockLocation(GeoPoint(13.0827, 80.2707)) },
                modifier = Modifier.weight(1f),
            )
            CompactActionButton(
                label = "Real GPS",
                selected = mockLocationOverride == null,
                activeColor = Color(0xFF15803D),
                onClick = { onSetMockLocation(null) },
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CompactActionButton(
                label = "Sim 4% Reserve",
                selected = mockBatteryOverride != null,
                activeColor = Color(0xFFB45309),
                onClick = { onSetMockBattery(4) },
                modifier = Modifier.weight(1f),
            )
            CompactActionButton(
                label = "Real Battery",
                selected = mockBatteryOverride == null,
                activeColor = Color(0xFF15803D),
                onClick = { onSetMockBattery(null) },
                modifier = Modifier.weight(1f),
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        if (!hasLocationPermission || !hasNotificationPermission) {
            Button(
                onClick = onRequestPermissions,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626)),
            ) {
                Text(
                    "Grant GPS & Notification Permissions",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
        }

        if (!canDrawOverlays) {
            Button(
                onClick = onOpenOverlaySettings,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFB45309)),
            ) {
                Text(
                    "Allow Display Over Other Apps (Required)",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
        }

        if (!canUseFullScreenIntent) {
            Button(
                onClick = onOpenFullScreenIntentSettings,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFB45309)),
            ) {
                Text(
                    "Allow Full-Screen Notifications (Required)",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = onPollNow,
                modifier = Modifier
                    .weight(1f)
                    .height(48.dp),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E293B)),
            ) {
                Text("Poll Now", color = Color.White, fontWeight = FontWeight.SemiBold)
            }
            Button(
                onClick = onRestartService,
                modifier = Modifier
                    .weight(1.2f)
                    .height(48.dp),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1F2937)),
            ) {
                Text("Restart AlertService", color = Color.White, fontWeight = FontWeight.SemiBold)
            }
        }
        Spacer(modifier = Modifier.height(24.dp))
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text,
        color = Color(0xFF9CA3AF),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun CompactActionButton(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    activeColor: Color = Color(0xFF2563EB),
) {
    Button(
        onClick = onClick,
        modifier = modifier.height(44.dp),
        shape = RoundedCornerShape(8.dp),
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp),
        border = if (selected) BorderStroke(1.dp, Color.White.copy(alpha = 0.45f)) else null,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (selected) activeColor else Color(0xFF1F2937),
            contentColor = Color.White,
        ),
    ) {
        Text(
            text = label,
            fontSize = 11.sp,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Ellipsis,
            color = Color.White,
        )
    }
}

@Composable
private fun StatusLine(
    label: String,
    value: String,
    valueColor: Color = Color.White,
) {
    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Text(text = label, color = Color(0xFF9CA3AF), fontSize = 11.sp)
        Text(text = value, color = valueColor, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    }
}
