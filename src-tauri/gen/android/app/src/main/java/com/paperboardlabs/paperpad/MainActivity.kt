package com.paperboardlabs.paperpad

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    fitAboveKeyboard()
  }

  /**
   * Drawn edge to edge, the app is no longer shrunk for the on-screen keyboard
   * (adjustResize is ignored), so the keyboard covers the bottom of the page and
   * the formatting bar with it. Shrink it here: the webview ends at the top of
   * the keyboard, and the page (100dvh in src/mobile/mobile.css) follows.
   *
   * While the keyboard is open the navigation bar is behind it, so the webview
   * is told there is none: otherwise mobile.css would leave a gap of its height
   * (env(safe-area-inset-bottom)) between the bar and the keyboard.
   */
  private fun fitAboveKeyboard() {
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      view.setPadding(0, 0, 0, keyboard)
      if (keyboard == 0) {
        insets
      } else {
        WindowInsetsCompat.Builder(insets)
          .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.NONE)
          .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
          .build()
      }
    }
  }
}
