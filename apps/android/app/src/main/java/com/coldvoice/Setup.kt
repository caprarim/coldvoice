package com.coldvoice

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.text.TextUtils
import android.view.inputmethod.InputMethodManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.coldvoice.a11y.ColdVoiceBubbleService

object Setup {

    const val MIC_REQUEST_CODE = 1001

    fun hasMic(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    fun requestMic(activity: Activity) {
        if (!hasMic(activity)) {
            ActivityCompat.requestPermissions(
                activity, arrayOf(Manifest.permission.RECORD_AUDIO), MIC_REQUEST_CODE
            )
        }
    }

    fun bubbleEnabled(context: Context): Boolean {
        val expected = "${context.packageName}/${ColdVoiceBubbleService::class.java.name}"
        val enabled = Settings.Secure.getString(
            context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ).orEmpty()
        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabled)
        for (entry in splitter) {
            if (entry.equals(expected, ignoreCase = true)) return true
        }
        return false
    }

    fun keyboardEnabled(context: Context): Boolean {
        val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        return imm.enabledInputMethodList.any { it.packageName == context.packageName }
    }

    fun complete(context: Context): Boolean = hasMic(context) && bubbleEnabled(context)

    fun openAccessibilitySettings(context: Context) {
        context.startActivity(
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    fun openKeyboardSettings(context: Context) {
        context.startActivity(
            Intent(Settings.ACTION_INPUT_METHOD_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    fun openAppInfo(context: Context) {
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", context.packageName, null)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )
    }
}
