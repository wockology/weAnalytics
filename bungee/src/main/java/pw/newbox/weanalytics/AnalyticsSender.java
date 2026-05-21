package pw.newbox.weanalytics;

import net.md_5.bungee.api.plugin.Plugin;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;

public final class AnalyticsSender {

    private final Plugin plugin;
    private final String apiUrl;
    private final String apiKey;
    private final int timeoutMs;
    private final ExecutorService executor;

    public AnalyticsSender(
            Plugin plugin,
            String apiUrl,
            String apiKey,
            int timeoutMs
    ) {
        this.plugin = plugin;
        this.apiUrl = apiUrl;
        this.apiKey = apiKey;
        this.timeoutMs = Math.max(1000, timeoutMs);
        this.executor = Executors.newFixedThreadPool(2, r -> {
            Thread t = new Thread(r, "WeAnalytics-HTTP");
            t.setDaemon(true);
            return t;
        });
    }

    public void sendJoin(String subdomain, String playerUuid, String playerName) {
        executor.execute(() -> doSend(subdomain, playerUuid, playerName));
    }

    private void doSend(String subdomain, String playerUuid, String playerName) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) URI.create(apiUrl).toURL().openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("X-API-Key", apiKey);

            byte[] bytes = JsonUtil.joinEvent(subdomain, playerUuid, playerName)
                    .getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(bytes);
            }

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                logFailure(subdomain, playerName, "HTTP " + code);
            }
        } catch (Exception e) {
            logFailure(subdomain, playerName, e.getMessage());
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void logFailure(String subdomain, String playerName, String reason) {
        plugin.getLogger().log(
                Level.WARNING,
                "[WeAnalytics] Failed {0} <- {1}: {2}",
                new Object[]{subdomain, playerName, reason}
        );
    }

    public void shutdown() {
        executor.shutdown();
        try {
            if (!executor.awaitTermination(3, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}
