package me.wockology.weanalytics.sender;

import me.wockology.weanalytics.config.Settings;
import net.md_5.bungee.api.plugin.Plugin;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.logging.Level;

public final class DashboardProbe {

    private DashboardProbe() {
    }

    public static void checkAsync(Plugin plugin, Settings settings) {
        plugin.getProxy().getScheduler().runAsync(plugin, () -> {
            String apiUrl = settings.getApiUrl();
            String root = apiUrl.replaceAll("/api/event/?$", "");
            URI probeUri = URI.create(root + "/login.html");
            try {
                HttpResponse<Void> response = HttpClient.newBuilder()
                        .connectTimeout(Duration.ofSeconds(8))
                        .build()
                        .send(
                                HttpRequest.newBuilder(probeUri)
                                        .GET()
                                        .timeout(Duration.ofSeconds(8))
                                        .build(),
                                HttpResponse.BodyHandlers.discarding()
                        );
                if (response.statusCode() == 200) {
                    plugin.getLogger().info("[WeAnalytics] Связь с дашбордом OK → " + root);
                } else {
                    plugin.getLogger().warning(
                            "[WeAnalytics] Дашборд ответил HTTP " + response.statusCode() + " на " + probeUri
                    );
                }
            } catch (Exception e) {
                plugin.getLogger().log(
                        Level.SEVERE,
                        "[WeAnalytics] С ЭТОГО сервера дашборд недоступен ({0}): {1}",
                        new Object[]{apiUrl, e.getMessage()}
                );
                plugin.getLogger().severe(
                        "[WeAnalytics] События не попадут в панель, пока Bungee не сможет открыть " + apiUrl
                );
            }
        });
    }
}
