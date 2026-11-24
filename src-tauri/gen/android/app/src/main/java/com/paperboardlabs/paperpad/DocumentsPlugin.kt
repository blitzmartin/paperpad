package com.paperboardlabs.paperpad

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.Collections

// Documents through the Storage Access Framework, for src-tauri/src/android_io.rs.
// Only Rust calls this plugin: no capability grants its commands to the webview.
//
// Why not tauri-plugin-dialog: on Android it opens files with ACTION_GET_CONTENT,
// which may return a read-only or temporary copy (Dropbox, for one). Saving there
// fails, or writes a copy that never syncs. ACTION_OPEN_DOCUMENT returns the
// provider's own document with write access. It also returns no file name, which
// PaperPad needs to tell HTML, Markdown and text apart.

@InvokeArg
class PickArgs {
  var mimeTypes: Array<String> = arrayOf("*/*")
}

@InvokeArg
class CreateArgs {
  var name: String = "Untitled.html"
  var mimeType: String = "text/html"
}

@InvokeArg
class DescriptorArgs {
  var uri: String = ""
  var mode: String = "r"
}

private const val TAG = "PaperPad"

// Same text for reading and saving: the cause is in the app that stores the file
// (Nextcloud, Dropbox...), and its local copy is what usually needs resetting.
private const val NOT_PROVIDED = "The app that stores this file did not let PaperPad open it. " +
  "If the file is in a cloud folder, have that app download it again (for example by removing its local copy), then try again."

@TauriPlugin
class DocumentsPlugin(private val activity: Activity) : Plugin(activity) {
  /** URIs the user picked or created in this session. No other URI can be opened. */
  private val chosenUris: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())

  @Command
  fun pickDocument(invoke: Invoke) {
    val args = invoke.parseArgs(PickArgs::class.java)
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = args.mimeTypes.singleOrNull() ?: "*/*"
      if (args.mimeTypes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, args.mimeTypes)
    }
    startActivityForResult(invoke, intent, "chosen")
  }

  @Command
  fun createDocument(invoke: Invoke) {
    val args = invoke.parseArgs(CreateArgs::class.java)
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = args.mimeType
      putExtra(Intent.EXTRA_TITLE, args.name)
    }
    startActivityForResult(invoke, intent, "chosen")
  }

  /**
   * The picked or created document: its URI and its name as the provider shows it
   * (which may differ from the proposed one, e.g. "Notes (1).html").
   * A cancel resolves with no URI, so Rust can tell it apart from an error.
   */
  @ActivityCallback
  fun chosen(invoke: Invoke, result: ActivityResult) {
    val res = JSObject()
    val uri = result.data?.data
    if (result.resultCode == Activity.RESULT_OK && uri != null) {
      chosenUris.add(uri.toString())
      res.put("uri", uri.toString())
      displayName(uri)?.let { res.put("name", it) }
    }
    invoke.resolve(res)
  }

  /**
   * A file descriptor for Rust to read ("r") or overwrite ("wt") the document
   * directly. Ownership passes to Rust, which closes it.
   */
  @Command
  fun openDescriptor(invoke: Invoke) {
    val args = invoke.parseArgs(DescriptorArgs::class.java)
    if (args.mode != "r" && args.mode != "wt") {
      invoke.reject("Unsupported mode")
      return
    }
    if (!chosenUris.contains(args.uri)) {
      invoke.reject("This file was not chosen in PaperPad")
      return
    }
    try {
      val pfd = activity.contentResolver.openFileDescriptor(Uri.parse(args.uri), args.mode)
      if (pfd == null) {
        Log.w(TAG, "openDescriptor(${args.mode}): the provider returned no descriptor")
        invoke.reject(NOT_PROVIDED)
        return
      }
      val res = JSObject()
      res.put("fd", pfd.detachFd())
      invoke.resolve(res)
    } catch (e: SecurityException) {
      // The grant is gone: the provider revoked it or the app was updated.
      Log.w(TAG, "openDescriptor(${args.mode}) failed", e)
      invoke.reject("PaperPad no longer has access to this file. Choose it again with Open.")
    } catch (e: Exception) {
      // FileNotFoundException (deleted, a failed cloud download, or a virtual file
      // such as a Google Docs document that has no bytes) or a crash inside the
      // provider. The latter may carry no message at all (seen with a Nextcloud file
      // whose local copy was out of sync), so the class name always goes in.
      Log.w(TAG, "openDescriptor(${args.mode}) failed", e)
      invoke.reject("$NOT_PROVIDED (Details: ${e.javaClass.simpleName}${e.message?.let { ": $it" } ?: ""})")
    }
  }

  private fun displayName(uri: Uri): String? = try {
    activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst() && !c.isNull(0)) c.getString(0) else null
    }
  } catch (e: Exception) {
    null
  }
}
