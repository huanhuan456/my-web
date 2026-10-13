package cn.yaoyao.pointscard;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String APP_HOST = "appassets.androidplatform.net";
    private WebView webView;
    private SharedPreferences preferences;
    private final ExecutorService requests = Executors.newSingleThreadExecutor();

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences("points-card", MODE_PRIVATE);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(246, 247, 242));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(246, 247, 242));
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                | (Build.VERSION.SDK_INT >= 26 ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0));
        root.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = windowInsets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets keyboard = windowInsets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            } else {
                view.setPadding(windowInsets.getSystemWindowInsetLeft(), windowInsets.getSystemWindowInsetTop(),
                        windowInsets.getSystemWindowInsetRight(), windowInsets.getSystemWindowInsetBottom());
            }
            return windowInsets;
        });
        root.requestApplyInsets();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        webView.addJavascriptInterface(new NativeBridge(), "PointsCardAndroid");
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse resource = loader.shouldInterceptRequest(request.getUrl());
                if (resource != null) return resource;
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(),
                        new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !APP_HOST.equals(request.getUrl().getHost());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !APP_HOST.equals(android.net.Uri.parse(url).getHost());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsConfirm(WebView view, String url, String message, android.webkit.JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton("确定", (dialog, which) -> result.confirm())
                        .setNegativeButton("取消", (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
        });
        webView.loadUrl("https://" + APP_HOST + "/assets/index.html");
    }

    public class NativeBridge {
        @JavascriptInterface public String getServerUrl() {
            return preferences.getString("server-url", "");
        }

        @JavascriptInterface public void showSettings() {
            runOnUiThread(() -> openSettings());
        }

        @JavascriptInterface public void requestState(String requestId, String method, String body, String etag) {
            if (!"GET".equals(method) && !"PUT".equals(method)) return;
            requests.execute(() -> fetchState(requestId, method, body, etag));
        }
    }

    private void openSettings() {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (20 * getResources().getDisplayMetrics().density);
        content.setPadding(padding, padding / 2, padding, 0);
        TextView description = new TextView(this);
        description.setText("留空时仅保存在本机。与电脑共享课程和积分时，填写电脑服务地址，并连接同一 Wi-Fi。");
        description.setTextSize(14);
        content.addView(description);
        EditText address = new EditText(this);
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint("http://电脑IP:4173");
        address.setText(preferences.getString("server-url", ""));
        content.addView(address);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("同步设置").setView(content)
                .setPositiveButton("保存", null).setNegativeButton("取消", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
            String value = address.getText().toString().trim();
            try {
                if (!value.isEmpty()) {
                    URI uri = new URI(value);
                    if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                            || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) {
                        throw new IllegalArgumentException("Invalid server address");
                    }
                    while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
                }
                preferences.edit().putString("server-url", value).apply();
                dialog.dismiss();
                webView.evaluateJavascript("window.dispatchEvent(new Event('android-sync-config-changed'))", null);
                Toast.makeText(this, value.isEmpty() ? "已切换为本机保存" : "同步地址已保存", Toast.LENGTH_SHORT).show();
            } catch (Exception error) {
                address.setError("请输入完整的 http:// 或 https:// 服务地址");
            }
        }));
        dialog.show();
    }

    private void fetchState(String requestId, String method, String body, String etag) {
        JSONObject result = new JSONObject();
        HttpURLConnection connection = null;
        try {
            result.put("id", requestId);
            String baseUrl = preferences.getString("server-url", "");
            if (baseUrl.isEmpty()) throw new IllegalStateException("未设置同步地址");
            connection = (HttpURLConnection) new URL(baseUrl + "/api/state").openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Cache-Control", "no-cache");
            if (!etag.isEmpty()) connection.setRequestProperty("If-Match", etag);
            if ("PUT".equals(method)) {
                byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                if (payload.length > 1024 * 1024) throw new IllegalArgumentException("记录过大");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(payload.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(payload); }
            }
            int status = connection.getResponseCode();
            result.put("status", status);
            JSONObject headers = new JSONObject();
            String responseTag = connection.getHeaderField("ETag");
            if (responseTag != null) headers.put("ETag", responseTag);
            headers.put("Content-Type", "application/json; charset=utf-8");
            result.put("headers", headers);
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            if (stream != null) {
                try (InputStream input = stream) {
                    byte[] bytes = new byte[8192];
                    int count;
                    while ((count = input.read(bytes)) != -1) {
                        buffer.write(bytes, 0, count);
                        if (buffer.size() > 2 * 1024 * 1024) throw new IllegalArgumentException("服务返回的记录过大");
                    }
                }
            }
            result.put("body", new String(buffer.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception error) {
            try { result.put("error", "暂时无法连接同步服务"); } catch (Exception ignored) { }
        } finally {
            if (connection != null) connection.disconnect();
        }
        final String response = result.toString();
        runOnUiThread(() -> {
            if (!isFinishing() && !isDestroyed()) {
                webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-state-response',{detail:" + response + "}))", null);
            }
        });
    }

    @Override public void onBackPressed() {
        webView.evaluateJavascript("(function(){var m=document.getElementById('course-modal');if(m&&!m.classList.contains('is-hidden')){closeModal();return true;}if(typeof activeView!=='undefined'&&activeView==='details'){setView('week');return true;}return false;})()",
                result -> { if (!"true".equals(result)) MainActivity.super.onBackPressed(); });
    }

    @Override protected void onDestroy() {
        requests.shutdownNow();
        webView.removeJavascriptInterface("PointsCardAndroid");
        webView.destroy();
        super.onDestroy();
    }
}
