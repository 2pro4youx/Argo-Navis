package com.argo.alert

import android.graphics.Color as AColor
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.drawable.GradientDrawable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.BoundingBox
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polygon
import org.osmdroid.views.overlay.Polyline
import java.io.File
import java.util.Locale
import org.osmdroid.util.GeoPoint as OsmPoint

/**
 * Street map (OpenStreetMap tiles) for the evacuation screen: you, the alert area, the shelters,
 * and the walking route to the nearest one. Needs internet only for the map background; the
 * markers, route and alert area are drawn from the signed alert and still show without tiles.
 * Tiles you have viewed are cached on the phone.
 */
@Composable
fun StreetEvacuationMap(
    userLocation: GeoPoint,
    shelters: List<Shelter>,
    region: AlertRegion,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val density = context.resources.displayMetrics.density
    val nearestPair = remember(userLocation, shelters) {
        CryptoAndGeo.findNearestShelter(userLocation.lat, userLocation.lon, shelters)
    }
    val mapState = remember {
        object {
            var fitKey: String = ""
            var renderKey: String = ""
        }
    }

    val mapView = remember {
        runCatching {
            Configuration.getInstance().apply {
                userAgentValue = context.packageName
                osmdroidBasePath = File(context.cacheDir, "osmdroid")
                osmdroidTileCache = File(context.cacheDir, "osmdroid/tiles")
            }
        }
        MapView(context).apply {
            setTileSource(TileSourceFactory.MAPNIK)
            setMultiTouchControls(true)
            minZoomLevel = 4.0
            controller.setZoom(15.0)
            controller.setCenter(OsmPoint(userLocation.lat, userLocation.lon))
        }
    }

    DisposableEffect(mapView) {
        mapView.onResume()
        onDispose {
            mapView.onPause()
            mapView.onDetach()
        }
    }

    fun dot(color: Int, sizeDp: Int): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(color)
            setStroke((3 * density).toInt(), AColor.WHITE)
            val px = (sizeDp * density).toInt()
            setSize(px, px)
        }

    AndroidView(
        modifier = modifier,
        factory = { mapView },
        update = { mv ->
            val currentRenderKey =
                "${userLocation.lat},${userLocation.lon}|${region.center.lat},${region.center.lon},${region.radiusKm}|${shelters.size}|${nearestPair?.first?.name}"
            if (currentRenderKey == mapState.renderKey) return@AndroidView
            mapState.renderKey = currentRenderKey

            mv.overlays.clear()
            val user = OsmPoint(userLocation.lat, userLocation.lon)
            val nearest = nearestPair?.first
            val straightKm = nearestPair?.second

            // Alert area
            mv.overlays.add(
                Polygon(mv).apply {
                    points = Polygon.pointsAsCircle(
                        OsmPoint(region.center.lat, region.center.lon),
                        region.radiusKm * 1000.0,
                    )
                    fillPaint.color = AColor.argb(28, 255, 59, 48)
                    outlinePaint.color = AColor.argb(200, 255, 59, 48)
                    outlinePaint.strokeWidth = 4f
                },
            )

            // Route to the nearest shelter (walking route if the alert carries one, else a straight line)
            val routePoints: List<OsmPoint> = when {
                nearest != null && nearest.route.size >= 2 -> nearest.route.map { OsmPoint(it.lat, it.lon) }
                nearest != null -> listOf(user, OsmPoint(nearest.lat, nearest.lon))
                else -> emptyList()
            }
            if (routePoints.size >= 2) {
                mv.overlays.add(
                    Polyline(mv).apply {
                        setPoints(routePoints)
                        outlinePaint.color = AColor.rgb(30, 144, 255)
                        outlinePaint.strokeWidth = 12f
                        outlinePaint.strokeCap = Paint.Cap.ROUND
                        if (nearest != null && nearest.route.size < 2) {
                            outlinePaint.pathEffect = DashPathEffect(floatArrayOf(24f, 16f), 0f)
                        }
                    },
                )
            }

            // Shelters
            shelters.forEach { sh ->
                val isNearest = sh === nearest
                mv.overlays.add(
                    Marker(mv).apply {
                        position = OsmPoint(sh.lat, sh.lon)
                        icon = dot(AColor.rgb(46, 204, 113), if (isNearest) 26 else 20)
                        setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                        title = if (isNearest) "NEAREST: ${sh.name}" else sh.name
                        snippet = when {
                            sh.routeKm != null && sh.routeMin != null ->
                                String.format(Locale.US, "%.1f km walk, about %d min", sh.routeKm, sh.routeMin)
                            isNearest && straightKm != null ->
                                String.format(Locale.US, "%.1f km straight line", straightKm)
                            else -> null
                        }
                        if (isNearest) showInfoWindow()
                    },
                )
            }

            // You
            mv.overlays.add(
                Marker(mv).apply {
                    position = user
                    icon = dot(AColor.rgb(33, 150, 243), 22)
                    setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                    title = "You are here"
                },
            )

            // Fit the view to you + nearest shelter + route, but only when the target changes,
            // so the person can still pan and zoom.
            val key = "${nearest?.name}:${nearest?.route?.size}"
            if (key != mapState.fitKey) {
                mapState.fitKey = key
                val all = buildList {
                    add(user)
                    addAll(routePoints)
                }
                if (all.size >= 2) {
                    mv.post {
                        runCatching {
                            mv.zoomToBoundingBox(BoundingBox.fromGeoPoints(all).increaseByScale(1.5f), false)
                        }
                    }
                }
            }
            mv.invalidate()
        },
    )
}
