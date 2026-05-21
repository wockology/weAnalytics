package me.wockology.weanalytics.host;

import lombok.experimental.UtilityClass;
import net.md_5.bungee.api.connection.PendingConnection;
import net.md_5.bungee.api.connection.ProxiedPlayer;

import java.net.InetSocketAddress;
import java.util.Locale;
import java.util.regex.Pattern;

@UtilityClass
public class Host {

    private static final Pattern PORT_SUFFIX = Pattern.compile(":\\d+$");
    private static final Pattern IPV4 = Pattern.compile("^\\d{1,3}(\\.\\d{1,3}){3}$");
    private static final Pattern IPV6_BRACKET = Pattern.compile("^\\[[0-9a-f:]+\\]$");

    public String resolve(ProxiedPlayer player) {
        if (player == null) {
            return null;
        }
        return resolveConnection(player.getPendingConnection());
    }

    public String resolveConnection(PendingConnection connection) {
        if (connection == null) {
            return null;
        }
        InetSocketAddress virtualHost = connection.getVirtualHost();
        if (virtualHost == null) {
            return null;
        }
        String raw = virtualHost.getHostString();
        if (raw == null || raw.isBlank()) {
            raw = virtualHost.getHostName();
        }
        return normalizeVirtualHost(raw);
    }

    public String describeVirtualHost(PendingConnection connection) {
        if (connection == null) {
            return "нет соединения";
        }
        InetSocketAddress virtualHost = connection.getVirtualHost();
        if (virtualHost == null) {
            return "virtual host = null";
        }
        String host = virtualHost.getHostString();
        if (host == null || host.isBlank()) {
            host = virtualHost.getHostName();
        }
        return host + ":" + virtualHost.getPort();
    }

    static String normalizeVirtualHost(String host) {
        if (host == null || host.isBlank()) {
            return null;
        }
        host = PORT_SUFFIX.matcher(host.toLowerCase(Locale.ROOT).trim()).replaceAll("");
        if ("localhost".equals(host) || isIpAddress(host)) {
            return null;
        }
        return host;
    }

    private boolean isIpAddress(String host) {
        return IPV4.matcher(host).matches() || IPV6_BRACKET.matcher(host).matches();
    }
}
