package io.github.sayach.dshmobile

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Fetches the public release descriptor at most once per App process. It carries no paired-device
 * credentials, uses no pinned TLS, and every failure stays silent: the App must keep working when
 * the owner's release host is unreachable.
 */
internal class AppUpdateChecker(
    private val descriptorUrl: String,
    private val installedVersionCode: Int,
    private val irohNative: Boolean,
    private val userAgent: String,
    private val load: (url: String, userAgent: String) -> String? = HttpUpdateDescriptor::load,
) {
    fun check(): AppUpdateDecision? {
        if (descriptorUrl.isBlank()) return null
        val descriptor = load(descriptorUrl, userAgent)?.let(AppUpdatePolicy::parse) ?: return null
        return AppUpdatePolicy.evaluate(installedVersionCode, descriptor, irohNative)
    }
}

/** Plain anonymous GET for the small public descriptor; unrelated to gateway authentication. */
internal object HttpUpdateDescriptor {
    private const val CONNECT_TIMEOUT_MS = 5_000
    private const val READ_TIMEOUT_MS = 5_000

    fun load(url: String, userAgent: String): String? {
        val connection = try {
            URL(url).openConnection() as? HttpURLConnection
        } catch (_: Exception) {
            null
        } ?: return null
        return try {
            connection.requestMethod = "GET"
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.instanceFollowRedirects = true
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", userAgent)
            if (connection.responseCode != HttpURLConnection.HTTP_OK) return null
            val body = ByteArrayOutputStream()
            copyDownloadAtMost(connection.inputStream, body, AppUpdatePolicy.MAX_BYTES.toLong())
            String(body.toByteArray(), Charsets.UTF_8)
        } catch (_: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }
}
