package com.argo.alert

import android.app.ActivityManager
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class AlertActivity : ComponentActivity() {

    private var initialClearNonce: Long = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        configureLockScreenAndWake()
        hideSystemBars()
        disableBackNavigation()

        initialClearNonce = AlertStateHolder.state.value.clearNonce
        AlertService.cancelAlarmNotification(this)
        AdminReceiver.ensureLockTaskWhitelisted(this)
        enterLockTaskMode()
        SirenController.startFullAlarm(this)

        lifecycleScope.launch {
            AlertStateHolder.state.collect { activeState ->
                if (activeState.clearNonce > initialClearNonce || activeState.alert == null) {
                    teardownAndFinish()
                }
            }
        }

        setContent {
            val activeState by AlertStateHolder.state.collectAsState()

            // Close cleanly whenever AlertService processes a valid ALL_CLEAR
            LaunchedEffect(activeState.clearNonce, activeState.alert) {
                if (activeState.clearNonce > initialClearNonce || activeState.alert == null) {
                    teardownAndFinish()
                }
            }

            val alert = activeState.alert ?: return@setContent
            val effectiveShelters = activeState.effectiveShelters()

            AlertFlowRoot(
                alert = alert,
                shelters = effectiveShelters,
                userLocation = activeState.userLocation,
                reservePowerActive = activeState.reservePowerActive,
                onEmergencyDial = { openEmergencyDialer() },
                onSliderConfirmed = { intervalS, nearestName, nearestDistKm ->
                    val loc = AlertStateHolder.state.value.userLocation
                    EventClient.postEventAsync(
                        event = "SLIDER_CONFIRMED",
                        detail = "evacuation screen opened",
                        lat = loc.lat,
                        lon = loc.lon,
                        intervalS = intervalS,
                    )
                    if (nearestName != null && nearestDistKm != null) {
                        EventClient.postEventAsync(
                            event = "NEAREST_SHELTER",
                            detail = String.format(
                                Locale.US,
                                "%s %.2f km",
                                nearestName,
                                nearestDistKm,
                            ),
                            lat = loc.lat,
                            lon = loc.lon,
                        )
                    }
                    SirenController.setQuietMode(this)
                },
                onCheckIn = { intervalS ->
                    val loc = AlertStateHolder.state.value.userLocation
                    EventClient.postEventAsync(
                        event = "CHECKIN",
                        detail = "user checked in",
                        lat = loc.lat,
                        lon = loc.lon,
                        intervalS = intervalS,
                    )
                    SirenController.pauseSiren()
                },
                onLowTimerWarning = {
                    SirenController.resumeQuietSiren(this)
                },
                onEscalated = {
                    val loc = AlertStateHolder.state.value.userLocation
                    EventClient.postEventAsync(
                        event = "ESCALATED",
                        detail = String.format(
                            Locale.US,
                            "missed_checkin lat=%.6f lon=%.6f",
                            loc.lat,
                            loc.lon,
                        ),
                        lat = loc.lat,
                        lon = loc.lon,
                    )
                    SirenController.resumeQuietSiren(this)
                },
            )
        }
    }

    override fun onResume() {
        super.onResume()
        val activeState = AlertStateHolder.state.value
        if (activeState.clearNonce > initialClearNonce || activeState.alert == null) {
            teardownAndFinish()
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onDestroy() {
        SirenController.stopAll()
        super.onDestroy()
    }

    private fun configureLockScreenAndWake() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            runCatching { km.requestDismissKeyguard(this, null) }
        }
    }

    private fun hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    private fun disableBackNavigation() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    // Intentionally consumed: user cannot exit OEM emergency override.
                }
            },
        )
    }

    private fun enterLockTaskMode() {
        runCatching {
            val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            if (am.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_NONE) {
                startLockTask()
            }
        }
    }

    private fun openEmergencyDialer() {
        runCatching {
            val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            if (am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE) {
                runCatching { stopLockTask() }
            }
            val dialIntent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:112")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(dialIntent)
        }.onFailure {
            android.widget.Toast.makeText(
                this,
                "Dialer unavailable on this device — call 112 manually",
                android.widget.Toast.LENGTH_LONG,
            ).show()
        }
    }

    private fun teardownAndFinish() {
        if (isFinishing || isDestroyed) return
        SirenController.stopAll()
        runCatching {
            val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            if (am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE) {
                stopLockTask()
            }
        }
        finishAndRemoveTask()
    }
}

@Composable
private fun AlertFlowRoot(
    alert: AlertPayload,
    shelters: List<Shelter>,
    userLocation: GeoPoint,
    reservePowerActive: Boolean,
    onEmergencyDial: () -> Unit,
    onSliderConfirmed: (intervalS: Int, nearestName: String?, nearestDistKm: Double?) -> Unit,
    onCheckIn: (intervalS: Int) -> Unit,
    onLowTimerWarning: () -> Unit,
    onEscalated: () -> Unit,
) {
    var acknowledged by remember(alert.alertId) { mutableStateOf(false) }

    if (!acknowledged) {
        EmergencyTakeoverScreen(
            alert = alert,
            reservePowerActive = reservePowerActive,
            onEmergencyDial = onEmergencyDial,
            onConfirmed = {
                acknowledged = true
                val nearest = CryptoAndGeo.findNearestShelter(
                    userLocation.lat,
                    userLocation.lon,
                    shelters,
                )
                onSliderConfirmed(
                    alert.checkinIntervalS,
                    nearest?.first?.name,
                    nearest?.second,
                )
            },
        )
    } else {
        EvacuationGuidanceScreen(
            alert = alert,
            shelters = shelters,
            userLocation = userLocation,
            reservePowerActive = reservePowerActive,
            onCheckIn = onCheckIn,
            onLowTimerWarning = onLowTimerWarning,
            onEscalated = onEscalated,
        )
    }
}

/**
 * SCREEN 1: Solid flashing red full screen, huge white danger triangle with "!",
 * huge alert type, severity, single slide-to-evacuate control, and tiny 112 link.
 */
@Composable
private fun EmergencyTakeoverScreen(
    alert: AlertPayload,
    reservePowerActive: Boolean,
    onEmergencyDial: () -> Unit,
    onConfirmed: () -> Unit,
) {
    var brightPhase by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(450L)
            brightPhase = !brightPhase
        }
    }

    val backgroundColor = if (brightPhase) Color(0xFFE00000) else Color(0xFF7F0000)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundColor)
            .padding(horizontal = 24.dp, vertical = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Spacer(modifier = Modifier.height(12.dp))

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            DangerTriangleIcon(modifier = Modifier.size(152.dp))
            Spacer(modifier = Modifier.height(28.dp))
            Text(
                text = alert.type.uppercase(Locale.US),
                color = Color.White,
                fontSize = 48.sp,
                lineHeight = 52.sp,
                fontWeight = FontWeight.Black,
                letterSpacing = 1.5.sp,
                textAlign = TextAlign.Center,
            )
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = alert.severity.uppercase(Locale.US),
                color = Color(0xFFFFE4E4),
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 3.sp,
                textAlign = TextAlign.Center,
            )
            if (reservePowerActive) {
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "Running on reserved 5% power",
                    color = Color(0xFFFFF1A8),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Center,
                )
            }
        }

        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            SlideToEvacuateControl(
                onSlideComplete = onConfirmed,
            )
            Spacer(modifier = Modifier.height(20.dp))
            Text(
                text = "Emergency call 112",
                color = Color.White.copy(alpha = 0.85f),
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .clickable(onClick = onEmergencyDial)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            )
        }
    }
}

@Composable
private fun DangerTriangleIcon(modifier: Modifier = Modifier) {
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val w = size.width
            val h = size.height
            val path = Path().apply {
                moveTo(w / 2f, h * 0.08f)
                lineTo(w * 0.94f, h * 0.88f)
                lineTo(w * 0.06f, h * 0.88f)
                close()
            }
            drawPath(
                path = path,
                color = Color.White,
                style = Stroke(width = w * 0.075f, cap = StrokeCap.Round),
            )
        }
        Text(
            text = "!",
            color = Color.White,
            fontSize = 72.sp,
            fontWeight = FontWeight.Black,
            modifier = Modifier.offset(y = 14.dp),
        )
    }
}

@Composable
private fun SlideToEvacuateControl(
    onSlideComplete: () -> Unit,
) {
    val thumbSizeDp = 64.dp
    val trackHeightDp = 76.dp
    val paddingDp = 6.dp
    val density = LocalDensity.current

    var dragOffsetPx by remember { mutableFloatStateOf(0f) }
    var triggered by remember { mutableStateOf(false) }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxWidth()
            .height(trackHeightDp)
            .clip(RoundedCornerShape(38.dp))
            .background(Color(0x66000000))
            .border(2.dp, Color.White.copy(alpha = 0.85f), RoundedCornerShape(38.dp))
            .padding(paddingDp),
        contentAlignment = Alignment.CenterStart,
    ) {
        val maxSlidePx = with(density) { (maxWidth - thumbSizeDp).toPx().coerceAtLeast(1f) }
        val progress = (dragOffsetPx / maxSlidePx).coerceIn(0f, 1f)

        Text(
            text = "SLIDE TO EVACUATE  >>>",
            color = Color.White.copy(alpha = (1f - progress * 0.9f).coerceIn(0.15f, 1f)),
            fontSize = 16.sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = 1.4.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = thumbSizeDp / 2),
        )

        Box(
            modifier = Modifier
                .offset { IntOffset(dragOffsetPx.roundToInt(), 0) }
                .size(thumbSizeDp)
                .clip(CircleShape)
                .background(Color.White)
                .pointerInput(maxSlidePx) {
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            if (!triggered) {
                                if (dragOffsetPx >= maxSlidePx * 0.82f) {
                                    triggered = true
                                    dragOffsetPx = maxSlidePx
                                    onSlideComplete()
                                } else {
                                    dragOffsetPx = 0f
                                }
                            }
                        },
                        onDragCancel = {
                            if (!triggered) dragOffsetPx = 0f
                        },
                        onHorizontalDrag = { _, dragAmount ->
                            if (!triggered) {
                                dragOffsetPx = (dragOffsetPx + dragAmount).coerceIn(0f, maxSlidePx)
                                if (dragOffsetPx >= maxSlidePx * 0.92f) {
                                    triggered = true
                                    onSlideComplete()
                                }
                            }
                        },
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = ">>>",
                color = Color(0xFFB71C1C),
                fontSize = 18.sp,
                fontWeight = FontWeight.Black,
            )
        }
    }
}

/**
 * SCREEN 2: Top 60% Compose Canvas schematic map + bottom 40% disaster headline,
 * numbered government evacuation protocol steps, protocol note, and bottom-right CHECK-IN ring.
 */
@Composable
private fun EvacuationGuidanceScreen(
    alert: AlertPayload,
    shelters: List<Shelter>,
    userLocation: GeoPoint,
    reservePowerActive: Boolean,
    onCheckIn: (intervalS: Int) -> Unit,
    onLowTimerWarning: () -> Unit,
    onEscalated: () -> Unit,
) {
    val totalSeconds = alert.checkinIntervalS.coerceAtLeast(5)
    var remainingSeconds by remember(alert.alertId) { mutableIntStateOf(totalSeconds) }
    var hasCheckedInOnce by remember(alert.alertId) { mutableStateOf(false) }
    var lowWarningResumed by remember(alert.alertId) { mutableStateOf(false) }
    var escalated by remember(alert.alertId) { mutableStateOf(false) }

    LaunchedEffect(alert.alertId, remainingSeconds, escalated) {
        if (escalated) return@LaunchedEffect
        if (remainingSeconds <= 0) {
            escalated = true
            onEscalated()
            return@LaunchedEffect
        }
        if (hasCheckedInOnce && remainingSeconds < 10 && !lowWarningResumed) {
            lowWarningResumed = true
            onLowTimerWarning()
        }
        delay(1_000L)
        remainingSeconds = (remainingSeconds - 1).coerceAtLeast(0)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF090B0E)),
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Top 60%: Schematic Map Canvas
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(0.60f)
                    .clipToBounds()
                    .background(Color(0xFF0D1117)),
            ) {
                StreetEvacuationMap(
                    userLocation = userLocation,
                    shelters = shelters,
                    region = alert.region,
                    modifier = Modifier.fillMaxSize(),
                )
            }

            // Hairline separator
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(Color(0xFF263042)),
            )

            // Bottom 40%: Disaster Type, Headline, Protocol Steps, Note
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(0.40f)
                    .clipToBounds()
                    .background(Color(0xFF090B0E))
                    .verticalScroll(rememberScrollState())
                    .padding(start = 18.dp, end = 112.dp, top = 14.dp, bottom = 20.dp),
            ) {
                if (escalated) {
                    Text(
                        text = "Rescue team notified",
                        color = Color(0xFFFF3B30),
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                }

                if (reservePowerActive) {
                    Text(
                        text = "Running on reserved 5% power",
                        color = Color(0xFFF59E0B),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                }

                Text(
                    text = alert.type.uppercase(Locale.US),
                    color = Color(0xFFEF4444),
                    fontSize = 14.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 1.2.sp,
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = alert.headline,
                    color = Color.White,
                    fontSize = 20.sp,
                    lineHeight = 25.sp,
                    fontWeight = FontWeight.Bold,
                )

                Spacer(modifier = Modifier.height(12.dp))

                alert.protocolSteps.forEachIndexed { index, step ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Text(
                            text = "${index + 1}.",
                            color = Color(0xFF93C5FD),
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.width(26.dp),
                        )
                        Text(
                            text = step,
                            color = Color(0xFFE5E7EB),
                            fontSize = 15.sp,
                            lineHeight = 20.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }

                if (alert.protocolNote.isNotBlank()) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = alert.protocolNote,
                        color = Color(0xFF9CA3AF),
                        fontSize = 11.sp,
                        lineHeight = 15.sp,
                    )
                }
            }
        }

        // Large circular CHECK-IN button with visible countdown ring in bottom-right corner
        CheckInCountdownButton(
            remainingSeconds = remainingSeconds,
            totalSeconds = totalSeconds,
            escalated = escalated,
            onClick = {
                hasCheckedInOnce = true
                lowWarningResumed = false
                escalated = false
                remainingSeconds = totalSeconds
                onCheckIn(totalSeconds)
            },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp),
        )
    }
}

@Composable
private fun SchematicEvacuationMap(
    userLocation: GeoPoint,
    shelters: List<Shelter>,
    modifier: Modifier = Modifier,
) {
    val textMeasurer = rememberTextMeasurer()
    val nearestPair = remember(userLocation, shelters) {
        CryptoAndGeo.findNearestShelter(userLocation.lat, userLocation.lon, shelters)
    }

    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        val gridColor = Color(0xFF1C2433)
        val gridSpacing = 48.dp.toPx()

        // Draw schematic grid
        var gx = gridSpacing
        while (gx < w) {
            drawLine(gridColor, Offset(gx, 0f), Offset(gx, h), strokeWidth = 1.dp.toPx())
            gx += gridSpacing
        }
        var gy = gridSpacing
        while (gy < h) {
            drawLine(gridColor, Offset(0f, gy), Offset(w, gy), strokeWidth = 1.dp.toPx())
            gy += gridSpacing
        }

        // Compute bounding box covering user + all shelters
        val allLats = buildList {
            add(userLocation.lat)
            shelters.forEach { add(it.lat) }
        }
        val allLons = buildList {
            add(userLocation.lon)
            shelters.forEach { add(it.lon) }
        }

        val minLat = allLats.minOrNull() ?: userLocation.lat
        val maxLat = allLats.maxOrNull() ?: userLocation.lat
        val minLon = allLons.minOrNull() ?: userLocation.lon
        val maxLon = allLons.maxOrNull() ?: userLocation.lon

        val latSpan = max(maxLat - minLat, 0.008)
        val lonSpan = max(maxLon - minLon, 0.008)

        val padX = w * 0.14f
        val padY = h * 0.16f
        val usableW = (w - 2f * padX).coerceAtLeast(1f)
        val usableH = (h - 2f * padY).coerceAtLeast(1f)

        fun project(lat: Double, lon: Double): Offset {
            val nx = ((lon - minLon) / lonSpan).toFloat()
            val ny = (1.0 - (lat - minLat) / latSpan).toFloat()
            return Offset(
                x = padX + nx * usableW,
                y = padY + ny * usableH,
            )
        }

        val userPos = project(userLocation.lat, userLocation.lon)
        val nearestShelter = nearestPair?.first
        val nearestDistKm = nearestPair?.second

        // Highlighted straight route line to nearest shelter
        if (nearestShelter != null) {
            val targetPos = project(nearestShelter.lat, nearestShelter.lon)
            drawLine(
                color = Color(0xFF4ADE80),
                start = userPos,
                end = targetPos,
                strokeWidth = 4.dp.toPx(),
                cap = StrokeCap.Round,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(18f, 12f), 0f),
            )
        }

        // Draw all shelters as green squares with names
        shelters.forEach { shelter ->
            val pos = project(shelter.lat, shelter.lon)
            val isNearest = nearestShelter != null && shelter.name == nearestShelter.name
            val sqSize = if (isNearest) 18.dp.toPx() else 14.dp.toPx()

            if (isNearest) {
                drawRect(
                    color = Color(0xFF4ADE80),
                    topLeft = Offset(pos.x - sqSize * 0.78f, pos.y - sqSize * 0.78f),
                    size = Size(sqSize * 1.56f, sqSize * 1.56f),
                    style = Stroke(width = 2.dp.toPx()),
                )
            }

            drawRect(
                color = if (isNearest) Color(0xFF22C55E) else Color(0xFF15803D),
                topLeft = Offset(pos.x - sqSize / 2f, pos.y - sqSize / 2f),
                size = Size(sqSize, sqSize),
            )

            val labelResult = textMeasurer.measure(
                text = shelter.name,
                style = TextStyle(
                    color = if (isNearest) Color.White else Color(0xFFD1D5DB),
                    fontSize = if (isNearest) 13.sp else 11.sp,
                    fontWeight = if (isNearest) FontWeight.Bold else FontWeight.Medium,
                ),
            )
            val labelX = (pos.x - labelResult.size.width / 2f)
                .coerceIn(8f, max(8f, w - labelResult.size.width - 8f))
            val userBelowNearest = isNearest && userPos.y > pos.y && (userPos.y - pos.y) < 72.dp.toPx()
            val labelY = if (userBelowNearest) {
                max(8f, pos.y - sqSize / 2f - labelResult.size.height - 6f)
            } else {
                min(pos.y + sqSize / 2f + 6f, h - labelResult.size.height - 8f)
            }
            drawText(
                textLayoutResult = labelResult,
                topLeft = Offset(labelX, labelY),
            )
        }

        // Distance callout badge cleanly offset from close markers
        if (nearestShelter != null && nearestDistKm != null) {
            val targetPos = project(nearestShelter.lat, nearestShelter.lon)
            val distText = String.format(Locale.US, "%.2f km", nearestDistKm)
            val measured = textMeasurer.measure(
                text = distText,
                style = TextStyle(
                    color = Color(0xFF052E16),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.ExtraBold,
                ),
            )
            val midX = (userPos.x + targetPos.x) / 2f
            val midY = (userPos.y + targetPos.y) / 2f
            val segLen = kotlin.math.hypot(targetPos.x - userPos.x, targetPos.y - userPos.y)
            val boxW = measured.size.width + 16f
            val boxH = measured.size.height + 10f
            val rectTopLeft = if (segLen < 90.dp.toPx()) {
                Offset(
                    x = (max(userPos.x, targetPos.x) + 22.dp.toPx()).coerceIn(8f, w - boxW - 8f),
                    y = (midY - boxH / 2f).coerceIn(8f, h - boxH - 8f),
                )
            } else {
                Offset(
                    x = (midX - boxW / 2f).coerceIn(8f, w - boxW - 8f),
                    y = (midY - boxH / 2f - 16f).coerceIn(8f, h - boxH - 8f),
                )
            }
            drawRect(
                color = Color(0xFF4ADE80),
                topLeft = rectTopLeft,
                size = Size(boxW, boxH),
            )
            drawText(
                textLayoutResult = measured,
                topLeft = Offset(rectTopLeft.x + 8f, rectTopLeft.y + 5f),
            )
        }

        // Draw user position as a blue dot with high-contrast outer ring
        drawCircle(
            color = Color(0xFF3B82F6).copy(alpha = 0.28f),
            radius = 18.dp.toPx(),
            center = userPos,
        )
        drawCircle(
            color = Color.White,
            radius = 10.dp.toPx(),
            center = userPos,
        )
        drawCircle(
            color = Color(0xFF2563EB),
            radius = 7.dp.toPx(),
            center = userPos,
        )
    }
}

@Composable
private fun CheckInCountdownButton(
    remainingSeconds: Int,
    totalSeconds: Int,
    escalated: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val progress = (remainingSeconds.toFloat() / totalSeconds.toFloat()).coerceIn(0f, 1f)
    val ringColor = when {
        escalated -> Color(0xFFEF4444)
        remainingSeconds < 10 -> Color(0xFFF59E0B)
        else -> Color(0xFF22C55E)
    }

    Box(
        modifier = modifier
            .size(92.dp)
            .clip(CircleShape)
            .background(Color(0xFF111827))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.fillMaxSize().padding(4.dp)) {
            val stroke = Stroke(width = 6.dp.toPx(), cap = StrokeCap.Round)
            drawArc(
                color = Color(0xFF263042),
                startAngle = -90f,
                sweepAngle = 360f,
                useCenter = false,
                style = stroke,
            )
            drawArc(
                color = ringColor,
                startAngle = -90f,
                sweepAngle = 360f * progress,
                useCenter = false,
                style = stroke,
            )
        }

        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = "CHECK-IN",
                color = Color.White,
                fontSize = 11.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 0.6.sp,
            )
            Text(
                text = "${remainingSeconds}s",
                color = ringColor,
                fontSize = 18.sp,
                fontWeight = FontWeight.Black,
            )
        }
    }
}
