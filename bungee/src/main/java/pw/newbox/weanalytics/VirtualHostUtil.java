package pw.newbox.weanalytics;

import net.md_5.bungee.api.connection.PendingConnection;
import net.md_5.bungee.api.connection.ProxiedPlayer;

import java.net.InetSocketAddress;
import java.util.Locale;

/** Поддомен из адреса, с которым игрок зашёл на прокси. */
public final class VirtualHostUtil {

    private VirtualHostUtil() {}

    public static String resolve(ProxiedPlayer player) {
        if (player == null) {
            return null;
        }
        return fromConnection(player.getPendingConnection());
    }

    private static String fromConnection(PendingConnection connection) {
        if (connection == null) {
            return null;
        }
        InetSocketAddress virtualHost = connection.getVirtualHost();
        if (virtualHost == null) {
            return null;
        }
        String host = virtualHost.getHostString();
        if (host == null || host.isBlank()) {
            return null;
        }
        host = host.toLowerCase(Locale.ROOT).trim();
        if (host.equals("localhost") || isIpAddress(host)) {
            return null;
        }
        return host.replaceAll(":\\d+$", "");
    }

    private static boolean isIpAddress(String host) {
        return host.matches("^\\d{1,3}(\\.\\d{1,3}){3}$")
                || host.matches("^\\[[0-9a-f:]+\\]$");
    }
}
