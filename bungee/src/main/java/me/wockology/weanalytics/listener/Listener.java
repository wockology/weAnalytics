package me.wockology.weanalytics.listener;

import lombok.RequiredArgsConstructor;
import net.md_5.bungee.api.connection.ProxiedPlayer;
import net.md_5.bungee.api.event.PostLoginEvent;
import net.md_5.bungee.api.event.PreLoginEvent;
import net.md_5.bungee.api.plugin.Plugin;
import net.md_5.bungee.event.EventHandler;
import me.wockology.weanalytics.host.Host;
import me.wockology.weanalytics.host.HostCache;
import me.wockology.weanalytics.sender.Sender;

import java.util.logging.Level;

@RequiredArgsConstructor
public final class Listener implements net.md_5.bungee.api.plugin.Listener {

    private final Plugin plugin;
    private final Sender sender;
    private final HostCache hostCache = new HostCache();

    @EventHandler
    public void onPreLogin(PreLoginEvent event) {
        hostCache.remember(event.getConnection());
    }

    @EventHandler
    public void onPostLogin(PostLoginEvent event) {
        ProxiedPlayer player = event.getPlayer();
        String subdomain = hostCache.take(player.getName());
        if (subdomain == null) {
            subdomain = Host.resolve(player);
        }
        if (subdomain == null) {
            plugin.getLogger().log(
                    Level.WARNING,
                    "[WeAnalytics] Пропуск {0}: не удалось определить домен входа ({1}). Заходите по домену в списке серверов, не по IP.",
                    new Object[]{
                            player.getName(),
                            Host.describeVirtualHost(player.getPendingConnection())
                    }
            );
            return;
        }

        sender.sendJoin(subdomain, player.getUniqueId().toString(), player.getName());
    }
}
