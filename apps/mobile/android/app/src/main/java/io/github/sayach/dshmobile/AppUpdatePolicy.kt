package io.github.sayach.dshmobile

import java.net.URI
import org.json.JSONObject

/** Published package choices that share one application id and release signer. */
internal enum class AppReleaseVariant(val key: String) {
    IROH("iroh"),
    COMPATIBILITY("compatibility"),
}

/** Public release metadata. Parsing it authorizes nothing and installs nothing. */
internal data class AppReleaseDescriptor(
    val version: String,
    val versionCode: Int,
    val downloads: Map<AppReleaseVariant, String>,
    val notesUrl: String? = null,
)

/** A newer published build plus the package this device could download. */
internal data class AppUpdateDecision(
    val version: String,
    val versionCode: Int,
    val downloadUrl: String,
)

/**
 * Reads the release descriptor an owner publishes beside its APKs and decides whether this
 * installation is behind. Only an https package URL for a strictly newer versionCode yields a
 * decision; malformed, downgraded or unrelated descriptors degrade to "no update" so App startup
 * never depends on the release host.
 */
internal object AppUpdatePolicy {
    /** Descriptor bodies stay tiny; anything larger is a misconfigured host. */
    const val MAX_BYTES = 16 * 1024

    private val VERSION = Regex("^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$")
    private val VARIANTS = AppReleaseVariant.values().associateBy { it.key }

    /** Returns null for every body this App cannot trust or does not understand. */
    fun parse(body: String): AppReleaseDescriptor? {
        if (body.isBlank() || body.length > MAX_BYTES) return null
        val json = try { JSONObject(body) } catch (_: Exception) { return null }
        val version = (json.opt("version") as? String)?.trim()?.takeIf(VERSION::matches) ?: return null
        val versionCode = integer(json.opt("versionCode"))
            ?.takeIf { it in 1..Int.MAX_VALUE.toLong() }
            ?.toInt()
            ?: return null
        val downloads = downloads(json.opt("downloads")) ?: return null
        if (downloads.isEmpty()) return null
        return AppReleaseDescriptor(version, versionCode, downloads, httpsUrl(json.opt("notesUrl")))
    }

    /**
     * An iroh build prefers its own package but may fall back to the compatibility package.
     * A compatibility build never offers the iroh package, because that package needs 64-bit ABIs.
     */
    fun evaluate(
        installedVersionCode: Int,
        descriptor: AppReleaseDescriptor,
        irohNative: Boolean,
    ): AppUpdateDecision? {
        if (descriptor.versionCode <= installedVersionCode) return null
        val url = if (irohNative) {
            descriptor.downloads[AppReleaseVariant.IROH] ?: descriptor.downloads[AppReleaseVariant.COMPATIBILITY]
        } else {
            descriptor.downloads[AppReleaseVariant.COMPATIBILITY]
        } ?: return null
        return AppUpdateDecision(descriptor.version, descriptor.versionCode, url)
    }

    /**
     * True when a published build has not been announced yet. Declining a prompt stays quiet until a
     * strictly newer release appears, so the App never nags about the same version.
     */
    fun shouldAnnounce(decision: AppUpdateDecision, announcedVersionCode: Int): Boolean =
        decision.versionCode > announcedVersionCode

    private fun downloads(value: Any?): Map<AppReleaseVariant, String>? {
        val json = value as? JSONObject ?: return null
        val parsed = linkedMapOf<AppReleaseVariant, String>()
        for (key in json.keys()) {
            // Unknown variants are ignored so a newer descriptor format cannot block updates.
            val variant = VARIANTS[key] ?: continue
            parsed[variant] = httpsUrl(json.opt(key)) ?: return null
        }
        return parsed
    }

    private fun httpsUrl(value: Any?): String? {
        val text = (value as? String)?.trim() ?: return null
        if (text.isEmpty() || text.length > 2048) return null
        if (text.any { it.code <= 0x20 || it.code >= 0x7f }) return null
        val uri = try { URI(text) } catch (_: Exception) { return null }
        if (!uri.isAbsolute || !uri.scheme.equals("https", ignoreCase = true)) return null
        if (uri.host.isNullOrEmpty() || uri.userInfo != null) return null
        return text
    }

    private fun integer(value: Any?): Long? {
        val number = value as? Number ?: return null
        val numeric = number.toDouble()
        if (!numeric.isFinite() || numeric % 1.0 != 0.0 || numeric < 0) return null
        return numeric.toLong()
    }
}
