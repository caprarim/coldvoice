package com.coldvoice

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.coldvoice.data.Store
import com.coldvoice.net.Connectivity
import com.coldvoice.screens.DictionaryScreen
import com.coldvoice.screens.HomeScreen
import com.coldvoice.screens.InsightsScreen
import com.coldvoice.screens.SettingsScreen
import com.coldvoice.screens.SnippetsScreen
import com.coldvoice.ui.Ui
import kotlin.concurrent.thread

/**
 * The ColdVoice app on Android: the same five places the desktop app has —
 * Home (every dictation you have ever made), Insights, Dictionary, Snippets and
 * Settings — over the floating bubble that does the actual dictating.
 */
class MainActivity : Activity() {

    private enum class Tab(val label: String, val glyph: String) {
        HOME("Home", "▤"),
        INSIGHTS("Insights", "▦"),
        DICTIONARY("Words", "A"),
        SNIPPETS("Snippets", "❝"),
        SETTINGS("Settings", "⚙")
    }

    private var current = Tab.HOME
    private lateinit var content: FrameLayout
    private val tabViews = HashMap<Tab, LinearLayout>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Connectivity.start(this)
        thread(name = "coldvoice-store-warm") { Store.warm(this) }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Ui.BG)
        }
        content = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
            )
        }
        root.addView(content)
        root.addView(tabBar())
        setContentView(root)

        show(Tab.HOME)

        if (intent?.getBooleanExtra(EXTRA_REQUEST_MIC, false) == true) Setup.requestMic(this)
    }

    override fun onNewIntent(intent: android.content.Intent?) {
        super.onNewIntent(intent)
        if (intent?.getBooleanExtra(EXTRA_REQUEST_MIC, false) == true) Setup.requestMic(this)
    }

    override fun onResume() {
        super.onResume()
        show(current)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        show(current)
    }

    private fun show(tab: Tab) {
        current = tab
        content.removeAllViews()
        val reload = { show(current) }
        val screen = when (tab) {
            Tab.HOME -> HomeScreen.view(this, reload)
            Tab.INSIGHTS -> InsightsScreen.view(this)
            Tab.DICTIONARY -> DictionaryScreen.view(this, reload)
            Tab.SNIPPETS -> SnippetsScreen.view(this, reload)
            Tab.SETTINGS -> SettingsScreen.view(this, reload)
        }
        content.addView(
            screen,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        for ((key, view) in tabViews) styleTab(view, key == tab)
    }

    private fun tabBar(): View {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#0B0C0E"))
            setPadding(Ui.dp(this@MainActivity, 6), Ui.dp(this@MainActivity, 6), Ui.dp(this@MainActivity, 6), Ui.dp(this@MainActivity, 8))
        }
        for (tab in Tab.values()) {
            val view = tabButton(tab)
            tabViews[tab] = view
            bar.addView(view, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
        val wrapper = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        wrapper.addView(topRule(), LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 1)
        ))
        wrapper.addView(bar, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        return wrapper
    }

    private fun topRule(): View = View(this).apply { setBackgroundColor(Ui.STROKE) }

    private fun tabButton(tab: Tab): LinearLayout {
        val glyph = TextView(this).apply {
            text = tab.glyph
            textSize = 16f
            gravity = Gravity.CENTER
        }
        val label = TextView(this).apply {
            text = tab.label
            textSize = 10.5f
            gravity = Gravity.CENTER
            setPadding(0, Ui.dp(this@MainActivity, 3), 0, 0)
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            setPadding(0, Ui.dp(this@MainActivity, 8), 0, Ui.dp(this@MainActivity, 6))
            addView(glyph)
            addView(label)
            setOnClickListener { show(tab) }
        }
    }

    private fun styleTab(view: LinearLayout, selected: Boolean) {
        val color = if (selected) Ui.ACCENT else Ui.MUTED
        (view.getChildAt(0) as TextView).setTextColor(color)
        (view.getChildAt(1) as TextView).setTextColor(color)
    }

    companion object {
        const val EXTRA_REQUEST_MIC = "coldvoice.requestMic"
    }
}
