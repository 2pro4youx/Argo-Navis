package com.argo.alert

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log

class AdminReceiver : DeviceAdminReceiver() {

    companion object {
        private const val TAG = "ArgoAdminReceiver"

        fun componentName(context: Context): ComponentName =
            ComponentName(context.applicationContext, AdminReceiver::class.java)

        fun ensureLockTaskWhitelisted(context: Context) {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val admin = componentName(context)
            if (dpm.isDeviceOwnerApp(context.packageName)) {
                runCatching {
                    dpm.setLockTaskPackages(admin, arrayOf(context.packageName))
                }.onFailure { err ->
                    Log.w(TAG, "Failed to whitelist lock task package: ${err.message}")
                }
            }
        }
    }

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        ensureLockTaskWhitelisted(context)
    }

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        super.onProfileProvisioningComplete(context, intent)
        ensureLockTaskWhitelisted(context)
    }
}
