package io.github.sayach.dshmobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdatePolicyTest {
    private val descriptor = """
        {
          "version": "0.7.3",
          "versionCode": 88,
          "releaseTag": "android-v0.7.3",
          "downloads": {
            "iroh": "https://dl.example.com/android/quwork-android-v0.7.3-iroh.apk",
            "compatibility": "https://dl.example.com/android/quwork-android-v0.7.3.apk"
          }
        }
    """.trimIndent()

    private fun decision(installedVersionCode: Int, irohNative: Boolean, body: String = descriptor) =
        AppUpdatePolicy.parse(body)?.let { AppUpdatePolicy.evaluate(installedVersionCode, it, irohNative) }

    @Test
    fun offersTheNewerPackageForTheInstalledVariant() {
        assertEquals(
            "https://dl.example.com/android/quwork-android-v0.7.3-iroh.apk",
            decision(87, irohNative = true)?.downloadUrl,
        )
        assertEquals(
            "https://dl.example.com/android/quwork-android-v0.7.3.apk",
            decision(87, irohNative = false)?.downloadUrl,
        )
        assertEquals("0.7.3", decision(87, irohNative = true)?.version)
    }

    @Test
    fun ignoresSameOrOlderBuildsAndDowngrades() {
        assertNull(decision(88, irohNative = true))
        assertNull(decision(120, irohNative = true))
    }

    @Test
    fun fallsBackToTheCompatibilityPackageForAnIrohBuild() {
        val body = descriptor.replace(
            """"iroh": "https://dl.example.com/android/quwork-android-v0.7.3-iroh.apk",""",
            "",
        )
        assertEquals(
            "https://dl.example.com/android/quwork-android-v0.7.3.apk",
            decision(87, irohNative = true, body)?.downloadUrl,
        )
    }

    @Test
    fun neverOffersTheIrohPackageToACompatibilityBuild() {
        val body = """
            {"version":"0.7.3","versionCode":88,
             "downloads":{"iroh":"https://dl.example.com/iroh.apk"}}
        """.trimIndent()
        assertNull(decision(87, irohNative = false, body))
    }

    @Test
    fun rejectsCleartextAndMalformedDownloadUrls() {
        for (url in listOf(
            "http://dl.example.com/a.apk",
            "https://user:pass@dl.example.com/a.apk",
            "https:///a.apk",
            "dl.example.com/a.apk",
            "",
        )) {
            val body = """{"version":"0.7.3","versionCode":88,"downloads":{"compatibility":"$url"}}"""
            assertNull("expected rejection of $url", AppUpdatePolicy.parse(body))
        }
    }

    @Test
    fun rejectsDescriptorsWithoutVersionOrDownloads() {
        assertNull(AppUpdatePolicy.parse("""{"versionCode":88,"downloads":{"compatibility":"https://a.example/a.apk"}}"""))
        assertNull(AppUpdatePolicy.parse("""{"version":"0.7.3","downloads":{"compatibility":"https://a.example/a.apk"}}"""))
        assertNull(AppUpdatePolicy.parse("""{"version":"0.7.3","versionCode":88,"downloads":{}}"""))
        assertNull(AppUpdatePolicy.parse("""{"version":"0.7.3","versionCode":88.5,"downloads":{"compatibility":"https://a.example/a.apk"}}"""))
        assertNull(AppUpdatePolicy.parse("""{"version":"latest","versionCode":88,"downloads":{"compatibility":"https://a.example/a.apk"}}"""))
        assertNull(AppUpdatePolicy.parse("not json"))
        assertNull(AppUpdatePolicy.parse(""))
    }

    @Test
    fun rejectsOversizedBodies() {
        val padded = """{"version":"0.7.3","versionCode":88,"downloads":{"compatibility":"https://a.example/a.apk","pad":"${"x".repeat(AppUpdatePolicy.MAX_BYTES)}"}}"""
        assertNull(AppUpdatePolicy.parse(padded))
        assertTrue(AppUpdatePolicy.MAX_BYTES > 0)
    }

    @Test
    fun ignoresUnknownVariantsAndKeepsKnownOnes() {
        val body = """
            {"version":"0.7.3","versionCode":88,"notesUrl":"https://dl.example.com/notes",
             "downloads":{"compatibility":"https://dl.example.com/a.apk","arm32":"https://dl.example.com/b.apk"}}
        """.trimIndent()
        val parsed = AppUpdatePolicy.parse(body)
        assertEquals(1, parsed?.downloads?.size)
        assertEquals("https://dl.example.com/notes", parsed?.notesUrl)
    }

    @Test
    fun announcesEachPublishedBuildOnlyOnce() {
        val decision = decision(87, irohNative = true)!!
        assertTrue(AppUpdatePolicy.shouldAnnounce(decision, announcedVersionCode = 0))
        assertTrue(AppUpdatePolicy.shouldAnnounce(decision, announcedVersionCode = 87))
        // Declining the prompt for 88 keeps it quiet, and installing it must not reset that.
        assertTrue(!AppUpdatePolicy.shouldAnnounce(decision, announcedVersionCode = 88))
        assertTrue(!AppUpdatePolicy.shouldAnnounce(decision, announcedVersionCode = 120))
    }

    @Test
    fun checkerStaysSilentWhenTheReleaseHostFails() {
        val failing = AppUpdateChecker(
            descriptorUrl = "https://dl.example.com/update.json",
            installedVersionCode = 87,
            irohNative = true,
            userAgent = "DSHMobile/test",
            load = { _, _ -> null },
        )
        assertNull(failing.check())

        val disabled = AppUpdateChecker(
            descriptorUrl = "",
            installedVersionCode = 87,
            irohNative = true,
            userAgent = "DSHMobile/test",
            load = { _, _ -> error("must not fetch without a configured descriptor URL") },
        )
        assertNull(disabled.check())
    }

    @Test
    fun checkerReportsANewerBuildFromThePublishedDescriptor() {
        val checker = AppUpdateChecker(
            descriptorUrl = "https://dl.example.com/update.json",
            installedVersionCode = 87,
            irohNative = true,
            userAgent = "DSHMobile/test",
            load = { url, agent ->
                assertEquals("https://dl.example.com/update.json", url)
                assertEquals("DSHMobile/test", agent)
                descriptor
            },
        )
        assertEquals(88, checker.check()?.versionCode)
    }
}
