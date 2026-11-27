package com.argo.alert

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {

    private var serviceStarted by mutableStateOf(false)
    private var isDeviceOwner by mutableStateOf(false)
    private var hasLocationPermission by mutableStateOf(false)

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshStatus()
        startAlertService()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AdminReceiver.ensureLockTaskWhitelisted(this)
        refreshStatus()
        requestRequiredPermissionsIfNeeded()
        startAlertService()

        setContent {
            BootstrapScreen(
                serviceStarted = serviceStarted,
                isDeviceOwner = isDeviceOwner,
                hasLocationPermission = hasLocationPermission,
                onRequestPermissions = { requestRequiredPermissionsIfNeeded() },
                onStartService = { startAlertService() },
            )
        }
    }

    private fun refreshStatus() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        isDeviceOwner = dpm.isDeviceOwnerApp(packageName)
        hasLocationPermission = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
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
    onRequestPermissions: () -> Unit,
    onStartService: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF090B0E))
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = "Argo Alert",
            color = Color.White,
            fontSize = 32.sp,
            fontWeight = FontWeight.Black,
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = "OEM Emergency Layer · com.argo.alert",
            color = Color(0xFF9CA3AF),
            fontSize = 14.sp,
        )
        Spacer(modifier = Modifier.height(24.dp))

        StatusLine("Foreground AlertService", if (serviceStarted) "Running (2s poll)" else "Stopped")
        StatusLine("GPS Location Permission", if (hasLocationPermission) "Granted" else "Required")
        StatusLine("Device Owner (Lock Task)", if (isDeviceOwner) "Provisioned" else "Not set via ADB")
        StatusLine("Endpoint", EventClient.BASE_URL)

        Spacer(modifier = Modifier.height(28.dp))

        if (!hasLocationPermission) {
            Button(
                onClick = onRequestPermissions,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626)),
            ) {
                Text("Grant GPS & Notification Permissions", fontWeight = FontWeight.Bold)
            }
            Spacer(modifier = Modifier.height(12.dp))
        }

        Button(
            onClick = onStartService,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1F2937)),
        ) {
            Text("Ensure AlertService Active", color = Color.White, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun StatusLine(label: String, value: String) {
    Column(modifier = Modifier.padding(vertical = 6.dp)) {
        Text(text = label, color = Color(0xFF9CA3AF), fontSize = 12.sp)
        Text(text = value, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}
