package me.wockology.weanalytics.config;

import lombok.Value;
import net.md_5.bungee.config.Configuration;

@Value
public class Settings {

    private static final String DEFAULT_URL = "http://127.0.0.1:3000/api/event";

    String apiUrl;
    String apiKey;
    int timeoutMs;

    public static Settings from(Configuration config) {
        return new Settings(
                config.getString("api-url", DEFAULT_URL).trim(),
                config.getString("api-key", "").trim(),
                Math.max(1000, config.getInt("timeout-ms", 5000))
        );
    }

    public boolean isApiKeyConfigured() {
        return !apiKey.isEmpty() && !apiKey.contains("CHANGE_ME");
    }
}
