package com.argo.alert

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import kotlin.math.PI
import kotlin.math.sin

/**
 * Synthesizes a looping two-tone alternating emergency siren on AudioAttributes.USAGE_ALARM
 * and drives a repeating tactile vibration pattern for deaf / hard-of-hearing accessibility.
 */
object SirenController {

    private const val SAMPLE_RATE = 22_050
    private const val TONE_HIGH_HZ = 960.0
    private const val TONE_LOW_HZ = 720.0
    private const val HALF_CYCLE_MS = 400
    private const val FULL_VOLUME = 1.0f
    private const val QUIET_VOLUME = 0.20f

    private val lock = Any()
    private var audioTrack: AudioTrack? = null
    private var vibrator: Vibrator? = null
    private var isPlayingAudio = false
    private var isVibrating = false

    fun startFullAlarm(context: Context) {
        synchronized(lock) {
            maximizeAlarmStream(context)
            ensureTrackCreated()
            audioTrack?.apply {
                setVolume(FULL_VOLUME)
                if (playState != AudioTrack.PLAYSTATE_PLAYING) {
                    play()
                }
            }
            isPlayingAudio = true
            startVibration(context)
        }
    }

    fun setQuietMode(context: Context) {
        synchronized(lock) {
            if (audioTrack == null) {
                ensureTrackCreated()
            }
            audioTrack?.apply {
                setVolume(QUIET_VOLUME)
                if (playState != AudioTrack.PLAYSTATE_PLAYING) {
                    play()
                }
            }
            isPlayingAudio = true
            stopVibration()
        }
    }

    fun pauseSiren() {
        synchronized(lock) {
            runCatching {
                audioTrack?.let { track ->
                    if (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
                        track.pause()
                    }
                }
            }
            isPlayingAudio = false
            stopVibration()
        }
    }

    fun resumeQuietSiren(context: Context) {
        setQuietMode(context)
    }

    fun stopAll() {
        synchronized(lock) {
            runCatching {
                audioTrack?.let { track ->
                    if (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
                        track.stop()
                    }
                    track.release()
                }
            }
            audioTrack = null
            isPlayingAudio = false
            stopVibration()
        }
    }

    private fun maximizeAlarmStream(context: Context) {
        runCatching {
            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM)
            audioManager.setStreamVolume(AudioManager.STREAM_ALARM, maxVol, 0)
        }
    }

    private fun ensureTrackCreated() {
        if (audioTrack != null) return

        val samplesPerHalf = (SAMPLE_RATE * HALF_CYCLE_MS) / 1000
        val totalSamples = samplesPerHalf * 2
        val pcm = ShortArray(totalSamples)

        for (i in 0 until totalSamples) {
            val freq = if (i < samplesPerHalf) TONE_HIGH_HZ else TONE_LOW_HZ
            // Soft 5ms fade envelope at tone boundaries to avoid click artifacts
            val localIdx = i % samplesPerHalf
            val fadeSamples = 110
            val envelope = when {
                localIdx < fadeSamples -> localIdx.toDouble() / fadeSamples
                localIdx > samplesPerHalf - fadeSamples -> (samplesPerHalf - localIdx).toDouble() / fadeSamples
                else -> 1.0
            }
            // Fundamental + subtle 3rd harmonic for crisp emergency penetration
            val angle = 2.0 * PI * freq * i / SAMPLE_RATE
            val wave = (0.82 * sin(angle) + 0.18 * sin(3.0 * angle)) * envelope
            pcm[i] = (wave * Short.MAX_VALUE * 0.92).toInt().toShort()
        }

        val bufferBytes = pcm.size * 2
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val format = AudioFormat.Builder()
            .setSampleRate(SAMPLE_RATE)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build()

        val track = AudioTrack.Builder()
            .setAudioAttributes(attributes)
            .setAudioFormat(format)
            .setBufferSizeInBytes(bufferBytes)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()

        track.write(pcm, 0, pcm.size)
        track.setLoopPoints(0, totalSamples, -1)
        audioTrack = track
    }

    private fun startVibration(context: Context) {
        if (isVibrating) return
        runCatching {
            val vib = getVibrator(context)
            vibrator = vib
            if (vib.hasVibrator()) {
                val pattern = longArrayOf(0L, 450L, 200L, 450L, 200L, 700L, 400L)
                val effect = VibrationEffect.createWaveform(pattern, 0)
                val audioAttrs = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
                @Suppress("DEPRECATION")
                vib.vibrate(effect, audioAttrs)
                isVibrating = true
            }
        }
    }

    private fun stopVibration() {
        runCatching {
            vibrator?.cancel()
        }
        isVibrating = false
    }

    private fun getVibrator(context: Context): Vibrator {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val manager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            manager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
    }
}
