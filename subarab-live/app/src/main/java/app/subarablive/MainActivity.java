package app.subarablive;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.graphics.Color;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private WebView webView;
    private EditText address;
    private TextView status;
    private SubtitleOverlayService overlay;
    private final ExecutorService translator = Executors.newSingleThreadExecutor();
    private volatile String endpoint = "https://translate.argosopentech.com/translate";
    private volatile String lastOriginal = "";
    private volatile String lastTranslation = "";

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
        openUrl("https://www.youtube.com/");
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(15, 18, 25));

        LinearLayout bar = new LinearLayout(this);
        bar.setPadding(8, 8, 8, 6);
        address = new EditText(this);
        address.setSingleLine(true);
        address.setHint("أدخل رابط موقع الفيديو");
        address.setTextColor(Color.WHITE);
        address.setHintTextColor(Color.LTGRAY);
        address.setInputType(android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        bar.addView(address, new LinearLayout.LayoutParams(0, 48, 1f));

        Button go = new Button(this);
        go.setText("فتح");
        bar.addView(go);
        go.setOnClickListener(v -> openUrl(address.getText().toString()));
        address.setOnEditorActionListener((v, action, event) -> {
            if (action == EditorInfo.IME_ACTION_GO) { openUrl(address.getText().toString()); return true; }
            return false;
        });

        LinearLayout controls = new LinearLayout(this);
        Button back = new Button(this); back.setText("رجوع");
        Button forward = new Button(this); forward.setText("تقدم");
        Button reload = new Button(this); reload.setText("تحديث");
        Button overlayButton = new Button(this); overlayButton.setText("الترجمة العائمة");
        controls.addView(back, new LinearLayout.LayoutParams(0, 46, 1f));
        controls.addView(forward, new LinearLayout.LayoutParams(0, 46, 1f));
        controls.addView(reload, new LinearLayout.LayoutParams(0, 46, 1f));
        controls.addView(overlayButton, new LinearLayout.LayoutParams(0, 46, 1.4f));

        back.setOnClickListener(v -> { if (webView.canGoBack()) webView.goBack(); });
        forward.setOnClickListener(v -> { if (webView.canGoForward()) webView.goForward(); });
        reload.setOnClickListener(v -> webView.reload());
        overlayButton.setOnClickListener(v -> toggleOverlay());

        status = new TextView(this);
        status.setTextColor(Color.rgb(190, 205, 220));
        status.setPadding(12, 4, 12, 6);
        status.setText("جاهز — افتح فيديو يحتوي على مسار ترجمة");
        status.setTextSize(12);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                address.setText(url);
                installSubtitleProbe();
                status.setText("الصفحة مفتوحة — تُكتشف المسارات التي يتيحها الموقع فقط");
            }
        });
        webView.addJavascriptInterface(new SubtitleBridge(), "SubArab");
        root.addView(bar);
        root.addView(controls);
        root.addView(status);
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1f));
        setContentView(root);
    }

    private void openUrl(String raw) {
        if (raw == null) return;
        String url = raw.trim();
        if (url.isEmpty()) return;
        if (!url.matches("(?i)^https?://.*")) url = "https://" + url;
        try {
            Uri uri = Uri.parse(url);
            if (uri.getHost() == null) throw new IllegalArgumentException();
            webView.loadUrl(uri.toString());
        } catch (Exception e) {
            Toast.makeText(this, "الرابط غير صالح", Toast.LENGTH_SHORT).show();
        }
    }

    private void installSubtitleProbe() {
        String js = "(function(){if(window.__subArabProbe)return;window.__subArabProbe=true;" +
          "var last='';var box=document.createElement('div');box.id='subarab-translation';" +
          "box.style.cssText='position:fixed;z-index:2147483647;left:5%;right:5%;bottom:8%;padding:8px 12px;" +
          "background:rgba(0,0,0,.78);color:white;text-align:center;font-size:20px;font-weight:600;" +
          "line-height:1.45;border-radius:8px;direction:rtl;pointer-events:none;text-shadow:0 1px 2px #000;display:none';" +
          "document.documentElement.appendChild(box);" +
          "window.__subArabShow=function(t){box.textContent=t||'';box.style.display=t?'block':'none';};" +
          "setInterval(function(){try{var vs=document.querySelectorAll('video');for(var i=0;i<vs.length;i++){" +
          "var v=vs[i];for(var j=0;j<v.textTracks.length;j++){var tr=v.textTracks[j];" +
          "if(tr.kind==='subtitles'||tr.kind==='captions'){if(tr.mode==='disabled')tr.mode='hidden';" +
          "var cs=tr.activeCues;if(cs&&cs.length){var t=cs[0].text||'';if(t&&t!==last){last=t;SubArab.onCue(t);}" +
          "break;}}}}}catch(e){}},250);})();";
        webView.evaluateJavascript(js, null);
    }

    private void toggleOverlay() {
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "اسمح للتطبيق بالظهور فوق التطبيقات ثم اضغط الزر مرة أخرى", Toast.LENGTH_LONG).show();
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
            startActivity(i);
            return;
        }
        Intent intent = new Intent(this, SubtitleOverlayService.class);
        intent.setAction(SubtitleOverlayService.ACTION_TOGGLE);
        startService(intent);
        Toast.makeText(this, "تم تبديل نافذة الترجمة العائمة", Toast.LENGTH_SHORT).show();
    }

    private class SubtitleBridge {
        @JavascriptInterface public void onCue(String text) {
            if (text == null || text.trim().isEmpty()) return;
            final String clean = text.replaceAll("<[^>]*>", "").trim();
            if (clean.isEmpty() || clean.equals(lastOriginal)) return;
            lastOriginal = clean;
            translator.execute(() -> {
                try {
                    String translated = translate(clean);
                    if (translated == null || translated.trim().isEmpty()) return;
                    lastTranslation = translated;
                    runOnUiThread(() -> {
                        status.setText("الأصل: " + clean + "  |  العربية: " + translated);
                        webView.evaluateJavascript("window.__subArabShow && window.__subArabShow(" +
                          JSONObject.quote(translated) + ")", null);
                        Intent update = new Intent(MainActivity.this, SubtitleOverlayService.class);
                        update.setAction(SubtitleOverlayService.ACTION_UPDATE);
                        update.putExtra("text", translated);
                        startService(update);
                    });
                } catch (Exception e) {
                    runOnUiThread(() -> status.setText("تعذرت الترجمة — تحقق من خادم الترجمة أو الاتصال"));
                }
            });
        }
    }

    private String translate(String text) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(endpoint).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(5000);
        c.setReadTimeout(7000);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        JSONObject body = new JSONObject();
        body.put("q", text);
        body.put("source", "auto");
        body.put("target", "ar");
        body.put("format", "text");
        byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream os = c.getOutputStream()) { os.write(data); }
        int code = c.getResponseCode();
        InputStream stream = code >= 200 && code < 300 ? c.getInputStream() : c.getErrorStream();
        if (stream == null) throw new IllegalStateException("HTTP " + code);
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line; while ((line = reader.readLine()) != null) result.append(line);
        } finally { c.disconnect(); }
        if (code < 200 || code >= 300) throw new IllegalStateException("HTTP " + code);
        return new JSONObject(result.toString()).optString("translatedText", "");
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        translator.shutdownNow();
        if (webView != null) { webView.removeJavascriptInterface("SubArab"); webView.destroy(); }
    }
}
