package me.wockology.weanalytics.listener;

import lombok.RequiredArgsConstructor;
import net.md_5.bungee.api.connection.ProxiedPlayer;
import net.md_5.bungee.api.event.PostLoginEvent;
import net.md_5.bungee.event.EventHandler;
import me.wockology.weanalytics.host.Host;
import me.wockology.weanalytics.sender.Sender;

@RequiredArgsConstructor
public final class Listener implements net.md_5.bungee.api.plugin.Listener {

    private final Sender sender;

    @EventHandler
    public void onPostLogin(PostLoginEvent event) {
        ProxiedPlayer player = event.getPlayer();
        String subdomain = Host.resolve(player);
        if (subdomain == null) {
            return;
        }

        sender.sendJoin(subdomain, player.getUniqueId().toString(), player.getName());
    }
}
