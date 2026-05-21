package me.wockology.weanalytics.host;

import net.md_5.bungee.api.connection.PendingConnection;

import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

public final class HostCache {

    private final ConcurrentHashMap<String, String> pending = new ConcurrentHashMap<>();

    public void remember(PendingConnection connection) {
        if (connection == null) {
            return;
        }
        String host = Host.resolveConnection(connection);
        if (host == null) {
            return;
        }
        String name = connection.getName();
        if (name == null || name.isBlank()) {
            return;
        }
        pending.put(name.toLowerCase(Locale.ROOT), host);
    }

    public String take(String playerName) {
        if (playerName == null || playerName.isBlank()) {
            return null;
        }
        return pending.remove(playerName.toLowerCase(Locale.ROOT));
    }
}
