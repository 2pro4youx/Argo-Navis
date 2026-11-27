package com.argo.alert

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

object CryptoAndGeo {

    const val SHARED_SECRET = "argo-demo-shared-secret"
    private const val EARTH_RADIUS_KM = 6371.0

    fun computeHmacSha256Hex(message: String, secret: String = SHARED_SECRET): String {
        val mac = Mac.getInstance("HmacSHA256")
        val keySpec = SecretKeySpec(secret.toByteArray(StandardCharsets.UTF_8), "HmacSHA256")
        mac.init(keySpec)
        val digest = mac.doFinal(message.toByteArray(StandardCharsets.UTF_8))
        val hexChars = CharArray(digest.size * 2)
        val digits = "0123456789abcdef"
        for (i in digest.indices) {
            val v = digest[i].toInt() and 0xFF
            hexChars[i * 2] = digits[v ushr 4]
            hexChars[i * 2 + 1] = digits[v and 0x0F]
        }
        return String(hexChars)
    }

    /**
     * Constant-time hex comparison of HMAC-SHA256 using MessageDigest.isEqual.
     */
    fun verifyHmacSha256(
        message: String,
        providedHex: String?,
        secret: String = SHARED_SECRET,
    ): Boolean {
        if (providedHex.isNullOrBlank()) return false
        val expectedHex = computeHmacSha256Hex(message, secret)
        val normalizedProvided = providedHex.trim().lowercase()
        return MessageDigest.isEqual(
            expectedHex.toByteArray(StandardCharsets.UTF_8),
            normalizedProvided.toByteArray(StandardCharsets.UTF_8),
        )
    }

    fun haversineKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val rLat1 = Math.toRadians(lat1)
        val rLat2 = Math.toRadians(lat2)

        val a = sin(dLat / 2.0).pow(2) +
            cos(rLat1) * cos(rLat2) * sin(dLon / 2.0).pow(2)
        val c = 2.0 * asin(sqrt(a.coerceIn(0.0, 1.0)))
        return EARTH_RADIUS_KM * c
    }

    fun findNearestShelter(
        userLat: Double,
        userLon: Double,
        shelters: List<Shelter>,
    ): Pair<Shelter, Double>? {
        if (shelters.isEmpty()) return null
        var best: Shelter = shelters.first()
        var bestDist = haversineKm(userLat, userLon, best.lat, best.lon)
        for (i in 1 until shelters.size) {
            val candidate = shelters[i]
            val dist = haversineKm(userLat, userLon, candidate.lat, candidate.lon)
            if (dist < bestDist) {
                best = candidate
                bestDist = dist
            }
        }
        return best to bestDist
    }
}
