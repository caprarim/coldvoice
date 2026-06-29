package com.coldvoice.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest

/**
 * Online/offline auto-detection. Mirrors the desktop `net.js`: ColdVoice itself
 * dictates fully on-device, so connectivity only governs whether the richer
 * cloud (Groq) path is used. Dictation keeps working either way.
 *
 * We use the system [ConnectivityManager] (no polling, no network traffic of our
 * own) and report the validated-internet state. Listeners are notified only when
 * the state actually flips.
 */
object Connectivity {

    fun interface Listener {
        fun onChange(online: Boolean)
    }

    private var cm: ConnectivityManager? = null
    private var registered = false
    @Volatile private var online = true
    private val listeners = mutableSetOf<Listener>()

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = recompute()
        override fun onLost(network: Network) = recompute()
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = recompute()
    }

    /** Begin watching connectivity. Safe to call more than once. */
    fun start(context: Context) {
        if (registered) return
        val manager = context.applicationContext
            .getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        cm = manager
        online = computeOnline(manager)
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        try {
            manager.registerNetworkCallback(request, callback)
            registered = true
        } catch (_: RuntimeException) {
            // Some OEMs throw if too many callbacks are registered; fall back to
            // on-demand checks via isOnline().
        }
    }

    fun stop() {
        if (!registered) return
        try { cm?.unregisterNetworkCallback(callback) } catch (_: RuntimeException) {}
        registered = false
    }

    /** Current best-known connectivity. Falls back to a live query if needed. */
    fun isOnline(context: Context? = null): Boolean {
        val manager = cm ?: (context?.applicationContext
            ?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)
        if (manager != null && !registered) return computeOnline(manager)
        return online
    }

    fun onChange(listener: Listener): () -> Unit {
        synchronized(listeners) { listeners.add(listener) }
        return { synchronized(listeners) { listeners.remove(listener) } }
    }

    private fun recompute() {
        val manager = cm ?: return
        setOnline(computeOnline(manager))
    }

    private fun setOnline(next: Boolean) {
        if (next == online) return
        online = next
        val snapshot = synchronized(listeners) { listeners.toList() }
        for (l in snapshot) {
            try { l.onChange(next) } catch (_: Exception) {}
        }
    }

    private fun computeOnline(manager: ConnectivityManager): Boolean {
        val active = manager.activeNetwork ?: return false
        val caps = manager.getNetworkCapabilities(active) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }
}
