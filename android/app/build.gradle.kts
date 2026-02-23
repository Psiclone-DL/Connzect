plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

val connzectWebUrl = providers.gradleProperty("CONNZECT_WEB_URL").orElse("http://5.75.169.93:3002")

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

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro"
      )
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
