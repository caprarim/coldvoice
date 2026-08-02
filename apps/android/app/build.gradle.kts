import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Secrets and signing come from the gitignored local.properties (or env vars) at
// build time — nothing sensitive enters source control.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) FileInputStream(f).use { load(it) }
}

val groqApiKey: String =
    localProps.getProperty("GROQ_API_KEY") ?: System.getenv("GROQ_API_KEY") ?: ""

// Release signing. Every published ColdVoice APK so far has been signed with the
// Android debug key, and Android only lets an app update if the new build carries
// the SAME signature — so switching keys would force every existing user to
// uninstall first. Point RELEASE_STORE_FILE (+ password properties) at a real
// keystore in local.properties when you're ready to make that break deliberately;
// until then we keep the existing signature so updates install cleanly.
val releaseStoreFile: String? = localProps.getProperty("RELEASE_STORE_FILE")
val debugKeystore = File(System.getProperty("user.home"), ".android/debug.keystore")

android {
    namespace = "com.coldvoice"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.coldvoice"
        minSdk = 26
        targetSdk = 34
        versionCode = 5
        versionName = "0.3.2"
        buildConfigField("String", "GROQ_API_KEY", "\"$groqApiKey\"")
        // Real phones are arm; dropping the x86/x86_64 emulator ABIs that Vosk
        // bundles keeps the download roughly half the size.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        create("release") {
            if (releaseStoreFile != null) {
                storeFile = file(releaseStoreFile)
                storePassword = localProps.getProperty("RELEASE_STORE_PASSWORD")
                keyAlias = localProps.getProperty("RELEASE_KEY_ALIAS")
                keyPassword = localProps.getProperty("RELEASE_KEY_PASSWORD")
            } else {
                storeFile = debugKeystore
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // Vosk: fully on-device, offline speech recognition. The small en-us model is
    // bundled in assets/model-en-us and unpacked at first launch, so dictation
    // works with no internet and no Google offline pack — like desktop whisper.cpp.
    implementation("com.alphacephei:vosk-android:0.3.47")
    implementation("net.java.dev.jna:jna:5.13.0@aar")
}
