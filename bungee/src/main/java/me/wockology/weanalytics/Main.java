package me.wockology.weanalytics;

import net.md_5.bungee.api.plugin.Plugin;
import me.wockology.weanalytics.listener.Listener;
import me.wockology.weanalytics.config.Config;
import me.wockology.weanalytics.config.Settings;
import me.wockology.weanalytics.sender.DashboardProbe;
import me.wockology.weanalytics.sender.Sender;

public final class Main extends Plugin {

    private Sender sender;

    @Override
    public void onEnable() {
        try {
            Settings settings = Config.load(this);

            if (sender != null) {
                sender.shutdown();
            }

            sender = new Sender(this, settings);
            getProxy().getPluginManager().registerListener(this, new Listener(this, sender));
            getLogger().info("WeAnalytics включён → " + settings.getApiUrl());
            String apiUrl = settings.getApiUrl().toLowerCase();
            if (apiUrl.contains("127.0.0.1") || apiUrl.contains("localhost")) {
                getLogger().warning(
                        "[WeAnalytics] api-url указывает на localhost — события дойдут только если дашборд запущен на этой же машине, что Bungee"
                );
            }
            DashboardProbe.checkAsync(this, settings);
        } catch (Exception e) {
            getLogger().severe("Ошибка: " + e.getMessage());
        }
    }

    @Override
    public void onDisable() {
        if (sender != null) {
            sender.shutdown();
            sender = null;
        }
    }
}
