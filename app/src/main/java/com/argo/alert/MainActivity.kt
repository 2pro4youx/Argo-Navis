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
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import java.util.Locale

class MainActivity : ComponentActivity() {

    private var serviceStarted by mutableStateOf(false)
    private var isDeviceOwner by mutableStateOf(false)
    private var hasLocationPermission by mutableStateOf(false)
    private var canDrawOverlays by mutableStateOf(false)
    private var canUseFullScreenIntent by mutableStateOf(true)

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshStatus()
        startAlertService()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        EventClient.init(applicationContext)
        AdminReceiver.ensureLockTaskWhitelisted(this)
        refreshStatus()
        requestRequiredPermissionsIfNeeded()
        startAlertService()

        setContent {
            val state by AlertStateHolder.state.collectAsState()
            BootstrapScreen(
                serviceStarted = serviceStarted,
                isDeviceOwner = isDeviceOwner,
                hasLocationPermission = hasLocationPermission,
                canDrawOverlays = canDrawOverlays,
                canUseFullScreenIntent = canUseFullScreenIntent,
                serverUrl = state.serverUrl,
                pollStatus = state.lastPollStatus,
                location = state.userLocation,
                batteryPct = state.batteryPct,
                mockLocationActive = state.mockLocationOverride != null,
                mockBatteryActive = state.mockBatteryOverride != null,
                onSaveServerUrl = { EventClient.setBaseUrl(applicationContext, it) },
                onSetMockLocation = { AlertStateHolder.setMockLocation(it) },
                onSetMockBattery = { AlertStateHolder.setMockBattery(it) },
                onRequestPermissions = { requestRequiredPermissionsIfNeeded() },
                onOpenOverlaySettings = { openOverlaySettings() },
                onOpenFullScreenIntentSettings = { openFullScreenIntentSettings() },
                onStartService = { startAlertService() },
            )
        }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun refreshStatus() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        isDeviceOwner = dpm.isDeviceOwnerApp(packageName)
        hasLocationPermission = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        canDrawOverlays = Settings.canDrawOverlays(this)
        canUseFullScreenIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.canUseFullScreenIntent()
        } else {
            true
        }
    }

    private fun requestRequiredPermissionsIfNeeded() {
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
        if (needed.isNotEmpty()) {
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    private fun openOverlaySettings() {
        runCatching {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName"),
            )
            startActivity(intent)
        }
    }

    private fun openFullScreenIntentSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            runCatching {
                val intent = Intent(
                    Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                    Uri.parse("package:$packageName"),
                )
                startActivity(intent)
            }
        }
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
    canDrawOverlays: Boolean,
    canUseFullScreenIntent: Boolean,
    serverUrl: String,
    pollStatus: String,
    location: GeoPoint,
    batteryPct: Int,
    mockLocationActive: Boolean,
    mockBatteryActive: Boolean,
    onSaveServerUrl: (String) -> Unit,
    onSetMockLocation: (GeoPoint?) -> Unit,
    onSetMockBattery: (Int?) -> Unit,
    onRequestPermissions: () -> Unit,
    onOpenOverlaySettings: () -> Unit,
    onOpenFullScreenIntentSettings: () -> Unit,
    onStartService: () -> Unit,
) {
    var urlInput by remember(serverUrl) { mutableStateOf(serverUrl) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF090B0E))
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        Spacer(modifier = Modifier.height(16.dp))
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
        Spacer(modifier = Modifier.height(18.dp))

        StatusLine("Foreground AlertService", if (serviceStarted) "Running (2s poll)" else "Stopped")
        StatusLine(
            "Server Connection",
            pollStatus,
            valueColor = if (pollStatus.startsWith("Connected")) Color(0xFF4ADE80) else Color(0xFFF59E0B),
        )
        StatusLine(
            "Current GPS (${if (mockLocationActive) "Demo Override" else "Device GPS"})",
            String.format(Locale.US, "%.4f, %.4f", location.lat, location.lon),
        )
        StatusLine(
            "Battery (${if (mockBatteryActive) "Demo Override" else "BatteryManager"})",
            "$batteryPct%",
        )
        StatusLine(
            "Device Owner (Lock Task)",
            if (isDeviceOwner) "Provisioned" else "Optional on personal phone",
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "Gateway Server URL",
            color = Color(0xFF9CA3AF),
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
        )
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
            Button(
                onClick = { onSaveServerUrl(urlInput) },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626)),
            ) {
                Text("Save URL", fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
            Button(
                onClick = {
                    urlInput = EventClient.DEFAULT_BASE_URL
                    onSaveServerUrl(EventClient.DEFAULT_BASE_URL)
                },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF065F46)),
            ) {
                Text("Firebase (Default)", fontSize = 12.sp, color = Color.White, fontWeight = FontWeight.SemiBold)
            }
        }
        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = {
                    urlInput = "http://127.0.0.1:8000"
                    onSaveServerUrl("http://127.0.0.1:8000")
                },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1F2937)),
            ) {
                Text("USB 127.0.0.1", fontSize = 12.sp, color = Color.White)
            }
            Button(
                onClick = {
                    urlInput = "http://10.0.2.2:8000"
                    onSaveServerUrl("http://10.0.2.2:8000")
                },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1F2937)),
            ) {
                Text("Emu 10.0.2.2", fontSize = 12.sp, color = Color.White)
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "Indoor / Physical Phone Demo Overrides",
            color = Color(0xFF9CA3AF),
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(modifier = Modifier.height(6.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = { onSetMockLocation(GeoPoint(23.2599, 77.4126)) },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E3A5F)),
            ) {
                Text("Bhopal GPS", fontSize = 12.sp, color = Color.White)
            }
            Button(
                onClick = { onSetMockLocation(GeoPoint(13.0827, 80.2707)) },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1F2937)),
            ) {
                Text("Chennai GPS", fontSize = 12.sp, color = Color.White)
            }
            Button(
                onClick = { onSetMockLocation(null) },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1F2937)),
            ) {
                Text("Real GPS", fontSize = 12.sp, color = Color.White)
            }
        }
        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = { onSetMockBattery(4) },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF78350F)),
            ) {
                Text("Sim 4% Reserve", fontSize = 12.sp, color = Color.White)
            }
            Button(
                onClick = { onSetMockBattery(null) },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1F2937)),
            ) {
                Text("Real Battery", fontSize = 12.sp, color = Color.White)
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        if (!hasLocationPermission) {
            Button(
                onClick = onRequestPermissions,
                modifier = Modifier.fillMaxWidth().height(46.dp),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626)),
            ) {
                Text("Grant GPS & Notification Permissions", fontWeight = FontWeight.Bold)
            }
            Spacer(modifier = Modifier.height(8.dp))
        }

        if (!canDrawOverlays) {
            Button(
                onClick = onOpenOverlaySettings,
                modifier = Modifier.fillMaxWidth().height(46.dp),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFB45309)),
            ) {
                Text("Allow Display Over Other Apps (Required)", fontWeight = FontWeight.Bold)
            }
            Spacer(modifier = Modifier.height(8.dp))
        }

        if (!canUseFullScreenIntent) {
            Button(
                onClick = onOpenFullScreenIntentSettings,
                modifier = Modifier.fillMaxWidth().height(46.dp),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFB45309)),
            ) {
                Text("Allow Full-Screen Notifications (Required)", fontWeight = FontWeight.Bold)
            }
            Spacer(modifier = Modifier.height(8.dp))
        }

        Button(
            onClick = onStartService,
            modifier = Modifier.fillMaxWidth().height(46.dp),
            shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1F2937)),
        ) {
            Text("Restart AlertService", color = Color.White, fontWeight = FontWeight.SemiBold)
        }
        Spacer(modifier = Modifier.height(24.dp))
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
