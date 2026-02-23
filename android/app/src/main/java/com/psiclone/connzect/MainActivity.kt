package com.psiclone.connzect

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
  private lateinit var webView: WebView
  private var pendingWebPermissionRequest: PermissionRequest? = null
  private var pendingFileCallback: ValueCallback<Array<Uri>>? = null

  private val runtimePermissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grantResults ->
      val request = pendingWebPermissionRequest ?: return@registerForActivityResult
      pendingWebPermissionRequest = null
      val allGranted = grantResults.values.all { granted -> granted }
      if (allGranted) {
        request.grant(request.resources)
      } else {
        request.deny()
      }
    }

  private val fileChooserLauncher =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      val callback = pendingFileCallback ?: return@registerForActivityResult
      pendingFileCallback = null

      if (result.resultCode != Activity.RESULT_OK) {
        callback.onReceiveValue(null)
        return@registerForActivityResult
      }

      val uri = result.data?.data
      callback.onReceiveValue(uri?.let { arrayOf(it) })
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    webView = WebView(this)
    setContentView(webView)
    configureWebView()

    if (savedInstanceState == null) {
      webView.loadUrl(BuildConfig.CONNZECT_WEB_URL)
    } else {
      webView.restoreState(savedInstanceState)
    }
  }

  override fun onSaveInstanceState(outState: Bundle) {
    webView.saveState(outState)
    super.onSaveInstanceState(outState)
  }

  @Suppress("SetJavaScriptEnabled")
  private fun configureWebView() {
    webView.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      cacheMode = WebSettings.LOAD_DEFAULT
      mediaPlaybackRequiresUserGesture = false
      allowFileAccess = true
      allowContentAccess = true
      mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
    }

    webView.webViewClient =
      object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
          return false
        }
      }

    webView.webChromeClient =
      object : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
          runOnUiThread { handleWebPermissionRequest(request) }
        }

        override fun onShowFileChooser(
          webView: WebView?,
          filePathCallback: ValueCallback<Array<Uri>>?,
          fileChooserParams: FileChooserParams?
        ): Boolean {
          if (filePathCallback == null) return false
          pendingFileCallback?.onReceiveValue(null)
          pendingFileCallback = filePathCallback

          val contentIntent =
            Intent(Intent.ACTION_GET_CONTENT).apply {
              addCategory(Intent.CATEGORY_OPENABLE)
              type = "*/*"
            }

          val chooserIntent = Intent.createChooser(contentIntent, "Select file")
          fileChooserLauncher.launch(chooserIntent)
          return true
        }
      }
  }

  private fun handleWebPermissionRequest(request: PermissionRequest) {
    val androidPermissions = linkedSetOf<String>()

    request.resources.forEach { resource ->
      when (resource) {
        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> {
          androidPermissions += Manifest.permission.RECORD_AUDIO
        }

        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> {
          androidPermissions += Manifest.permission.CAMERA
        }
      }
    }

    if (androidPermissions.isEmpty()) {
      request.grant(request.resources)
      return
    }

    val missingPermissions =
      androidPermissions.filter { permission ->
        ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED
      }

    if (missingPermissions.isEmpty()) {
      request.grant(request.resources)
      return
    }

    pendingWebPermissionRequest?.deny()
    pendingWebPermissionRequest = request
    runtimePermissionLauncher.launch(missingPermissions.toTypedArray())
  }

  override fun onBackPressed() {
    if (webView.canGoBack()) {
      webView.goBack()
      return
    }
    super.onBackPressed()
  }

  override fun onDestroy() {
    pendingFileCallback?.onReceiveValue(null)
    pendingFileCallback = null
    pendingWebPermissionRequest?.deny()
    pendingWebPermissionRequest = null
    webView.destroy()
    super.onDestroy()
  }
}
