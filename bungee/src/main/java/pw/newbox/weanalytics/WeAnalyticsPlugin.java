package pw.newbox.weanalytics;

import net.md_5.bungee.api.connection.ProxiedPlayer;
import net.md_5.bungee.api.event.PostLoginEvent;
import net.md_5.bungee.api.plugin.Plugin;
import net.md_5.bungee.config.Configuration;
import net.md_5.bungee.config.ConfigurationProvider;
import net.md_5.bungee.config.YamlConfiguration;
import net.md_5.bungee.event.EventHandler;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;

public final class WeAnalyticsPlugin extends Plugin {

    private AnalyticsSender sender;

    @Override
    public void onEnable() {
        if (!getDataFolder().exists()) {
            getDataFolder().mkdir();
        }

        File configFile = new File(getDataFolder(), "config.yml");
        try {
            if (!configFile.exists()) {
                try (InputStream in = getResourceAsStream("config.yml")) {
                    if (in != null) {
                        Files.copy(in, configFile.toPath());
                    }
                }
            }

            Configuration defaults = null;
            try (InputStream in = getResourceAsStream("config.yml")) {
                if (in != null) {
                    defaults = ConfigurationProvider.getProvider(YamlConfiguration.class).load(in);
                }
            }

            Configuration config = ConfigurationProvider.getProvider(YamlConfiguration.class).load(configFile);
            if (defaults != null) {
                config.setDefaults(defaults);
                config.copyDefaults(true);
                ConfigurationProvider.getProvider(YamlConfiguration.class).save(config, configFile);
            }

            applyConfig(config);
            getProxy().getPluginManager().registerListener(this, this);
        } catch (IOException e) {
            getLogger().severe("Не удалось загрузить config.yml: " + e.getMessage());
        }
    }

    @Override
    public void onDisable() {
        if (sender != null) {
            sender.shutdown();
        }
    }

    private void applyConfig(Configuration config) {
        String apiUrl = config.getString("api-url", "http://127.0.0.1:3000/api/event").trim();
        String apiKey = config.getString("api-key", "").trim();
        int timeout = config.getInt("timeout-ms", 5000);

        if (apiKey.isEmpty() || apiKey.contains("CHANGE_ME")) {
            getLogger().warning("Укажите api-key в plugins/WeAnalytics/config.yml (ключ из дашборда)");
        }

        if (sender != null) {
            sender.shutdown();
        }
        sender = new AnalyticsSender(this, apiUrl, apiKey, timeout);
        getLogger().info("WeAnalytics включён → " + apiUrl);
    }

    @EventHandler
    public void onPostLogin(PostLoginEvent event) {
        if (sender == null) {
            return;
        }

        ProxiedPlayer player = event.getPlayer();
        String subdomain = VirtualHostUtil.resolve(player);
        if (subdomain == null) {
            return;
        }

        sender.sendJoin(subdomain, player.getUniqueId().toString(), player.getName());
    }
}
