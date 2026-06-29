import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Groq key is read from the gitignored local.properties (or the GROQ_API_KEY env
// var) at build time and exposed via BuildConfig — the secret never enters source.
val groqApiKey: String = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) FileInputStream(f).use { load(it) }
}.getProperty("GROQ_API_KEY") ?: System.getenv("GROQ_API_KEY") ?: ""

android {
    namespace = "com.coldvoice"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.coldvoice"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "0.1.0"
        buildConfigField("String", "GROQ_API_KEY", "\"$groqApiKey\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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
    // sherpa-onnx offline ASR is added as a local .aar / Maven artifact during
    // ASR integration. The AsrEngine interface keeps the rest of the app decoupled.
}
