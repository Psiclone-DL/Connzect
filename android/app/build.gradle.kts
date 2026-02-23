plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

val connzectWebUrl = providers.gradleProperty("CONNZECT_WEB_URL").orElse("http://5.75.169.93:3002")
val connzectKeystorePath = providers.gradleProperty("CONNZECT_ANDROID_KEYSTORE_PATH").orNull
val connzectKeystorePassword = providers.gradleProperty("CONNZECT_ANDROID_KEYSTORE_PASSWORD").orNull
val connzectKeyAlias = providers.gradleProperty("CONNZECT_ANDROID_KEY_ALIAS").orNull
val connzectKeyPassword = providers.gradleProperty("CONNZECT_ANDROID_KEY_PASSWORD").orNull

val hasReleaseSigning =
  !connzectKeystorePath.isNullOrBlank() &&
    !connzectKeystorePassword.isNullOrBlank() &&
    !connzectKeyAlias.isNullOrBlank() &&
    !connzectKeyPassword.isNullOrBlank()

android {
  namespace = "com.psiclone.connzect"
  compileSdk = 34

  defaultConfig {
    applicationId = "com.psiclone.connzect"
    minSdk = 24
    targetSdk = 34
    versionCode = 1
    versionName = "1.0.53"

    buildConfigField("String", "CONNZECT_WEB_URL", "\"${connzectWebUrl.get()}\"")
  }

  if (hasReleaseSigning) {
    signingConfigs {
      create("release") {
        storeFile = file(connzectKeystorePath!!)
        storePassword = connzectKeystorePassword
        keyAlias = connzectKeyAlias
        keyPassword = connzectKeyPassword
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro"
      )
      if (hasReleaseSigning) {
        signingConfig = signingConfigs.getByName("release")
      }
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }

  buildFeatures {
    buildConfig = true
  }
}

dependencies {
  implementation("androidx.core:core-ktx:1.13.1")
  implementation("androidx.appcompat:appcompat:1.7.0")
  implementation("com.google.android.material:material:1.12.0")
}
