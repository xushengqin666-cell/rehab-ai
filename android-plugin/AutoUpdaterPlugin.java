package com.rehabai.app;

import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// 自主更新：下载 APK（jsDelivr/GitHub）到缓存目录 → 唤起系统安装器
// download()：仅静默下载；install()：打开已下载的包；downloadAndInstall()：两步合一
@CapacitorPlugin(name = "AutoUpdater")
public class AutoUpdaterPlugin extends Plugin {

    private File apkFile() {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, "rehab-update.apk");
    }

    private void doDownload(PluginCall call, boolean andInstall) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("no url");
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                File apk = apkFile();
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.connect();
                int status = conn.getResponseCode();
                if (status < 200 || status >= 300) {
                    call.reject("http " + status);
                    return;
                }
                int total = conn.getContentLength();
                InputStream in = conn.getInputStream();
                FileOutputStream out = new FileOutputStream(apk);
                byte[] buf = new byte[65536];
                long done = 0;
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    done += n;
                    if (total > 0) {
                        JSObject ret = new JSObject();
                        ret.put("percent", Math.min(99, (int) (done * 100 / total)));
                        notifyListeners("progress", ret);
                    }
                }
                out.close();
                in.close();
                conn.disconnect();
                JSObject ret = new JSObject();
                ret.put("ready", true);
                ret.put("size", apk.length());
                if (andInstall) ret.put("started", openInstaller());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "download failed" : e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private boolean openInstaller() {
        File apk = apkFile();
        if (!apk.exists()) return false;
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getContext().startActivity(intent);
        return true;
    }

    @PluginMethod
    public void download(PluginCall call) {
        doDownload(call, false);
    }

    @PluginMethod
    public void install(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("started", openInstaller());
        call.resolve(ret);
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        doDownload(call, true);
    }
}
