package com.venom3byte.forgegame;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

public class MainActivity extends Activity {
  private WebView webView;

  @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    requestWindowFeature(Window.FEATURE_NO_TITLE);
    getWindow().setStatusBarColor(Color.BLACK);
    getWindow().setNavigationBarColor(Color.BLACK);
    getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);

    webView = new WebView(this);
    webView.setBackgroundColor(Color.BLACK);
    webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

    android.webkit.WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setBuiltInZoomControls(false);
    settings.setDisplayZoomControls(false);
    settings.setSupportZoom(false);
    settings.setLoadsImagesAutomatically(true);
    settings.setJavaScriptCanOpenWindowsAutomatically(false);
    settings.setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);

    final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
      .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
      .build();

    webView.setWebViewClient(new WebViewClientCompat() {
      @Override
      public WebResourceResponse shouldInterceptRequest(@NonNull WebView view, @NonNull WebResourceRequest request) {
        return loader.shouldInterceptRequest(request.getUrl());
      }
      @SuppressWarnings("deprecation")
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
        return loader.shouldInterceptRequest(android.net.Uri.parse(url));
      }
      @Override
      public boolean onRenderProcessGone(@NonNull WebView view, @NonNull android.webkit.RenderProcessGoneDetail detail) {
        recreate();
        return true;
      }
    });

    webView.setWebChromeClient(new WebChromeClient());
    webView.addJavascriptInterface(new ForgeAndroidBridge(this), "ForgeAndroid");
    setContentView(webView);

    hideSystemUi();
    webView.loadUrl("https://appassets.androidplatform.net/assets/forge/index.html");
  }

  private void hideSystemUi() {
    getWindow().getDecorView().setSystemUiVisibility(
      View.SYSTEM_UI_FLAG_FULLSCREEN |
      View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
      View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
      View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
      View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
      View.SYSTEM_UI_FLAG_LAYOUT_STABLE
    );
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideSystemUi();
  }

  @Override
  protected void onPause() {
    if (webView != null) webView.onPause();
    super.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (webView != null) webView.onResume();
    hideSystemUi();
  }

  @Override
  public void onBackPressed() {
    if (webView != null) {
      webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('forgeandroidback'));", null);
    }
    new android.os.Handler(getMainLooper()).postDelayed(this::finish, 120);
  }

  public static class ForgeAndroidBridge {
    private final Context context;
    ForgeAndroidBridge(Context context) { this.context = context; }

    @JavascriptInterface
    public String platform() { return "android"; }

    @JavascriptInterface
    public String version() { return BuildConfig.VERSION_NAME; }

    @JavascriptInterface
    public void vibrate(long milliseconds) {
      long ms = Math.max(1, Math.min(1000, milliseconds));
      if (Build.VERSION.SDK_INT >= 31) {
        VibratorManager vm = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
        if (vm != null) vm.getDefaultVibrator().vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
      } else {
        Vibrator v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        if (v != null) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
      }
    }
  }
}
