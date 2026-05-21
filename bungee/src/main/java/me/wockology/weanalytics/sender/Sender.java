package me.wockology.weanalytics.sender;

import net.md_5.bungee.api.plugin.Plugin;
import me.wockology.weanalytics.json.Json;
import me.wockology.weanalytics.config.Settings;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;

public final class Sender {

    private static final String CONTENT_TYPE = "application/json; charset=utf-8";

    private final Plugin plugin;
    private final URI endpoint;
    private final String apiKey;
    private final Duration timeout;
    private final HttpClient client;
    private final ThreadPoolExecutor executor;

    public Sender(Plugin plugin, Settings settings) {
        this.plugin = plugin;
        this.endpoint = URI.create(settings.getApiUrl());
        this.apiKey = settings.getApiKey();
        this.timeout = Duration.ofMillis(settings.getTimeoutMs());
        this.executor = new ThreadPoolExecutor(
                1,
                2,
                60L,
                TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(256),
                r -> {
                    Thread t = new Thread(r, "WeAnalytics-HTTP");
                    t.setDaemon(true);
                    return t;
                },
                new ThreadPoolExecutor.DiscardOldestPolicy()
        );
        this.client = HttpClient.newBuilder()
                .connectTimeout(timeout)
                .executor(executor)
                .version(HttpClient.Version.HTTP_1_1)
                .build();
    }

    public void sendJoin(String subdomain, String playerUuid, String playerName) {
        byte[] body = Json.joinEvent(subdomain, playerUuid, playerName);
        HttpRequest request = HttpRequest.newBuilder(endpoint)
                .timeout(timeout)
                .header("Content-Type", CONTENT_TYPE)
                .header("X-API-Key", apiKey)
                .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                .build();

        client.sendAsync(request, HttpResponse.BodyHandlers.discarding())
                .whenComplete((response, error) -> {
                    if (error != null) {
                        logFailure(subdomain, playerName, error.getMessage());
                        return;
                    }
                    int code = response.statusCode();
                    if (code < 200 || code >= 300) {
                        logFailure(subdomain, playerName, "HTTP " + code);
                    } else {
                        plugin.getLogger().info("[WeAnalytics] OK " + subdomain + " <- " + playerName);
                    }
                });
    }

    private void logFailure(String subdomain, String playerName, String reason) {
        Level level = reason != null && (
                reason.contains("refused") || reason.contains("timed out") || reason.contains("resolve")
        ) ? Level.SEVERE : Level.WARNING;
        plugin.getLogger().log(
                level,
                "[WeAnalytics] Не отправлено {0} <- {1} → {2}: {3}",
                new Object[]{subdomain, playerName, endpoint, reason}
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
