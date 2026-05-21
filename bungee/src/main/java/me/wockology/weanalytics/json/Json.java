package me.wockology.weanalytics.json;

import lombok.experimental.UtilityClass;

import java.nio.charset.StandardCharsets;

@UtilityClass
public class Json {

    public byte[] joinEvent(String subdomain, String playerUuid, String playerName) {
        return joinEventBuilder(subdomain, playerUuid, playerName)
                .toString()
                .getBytes(StandardCharsets.UTF_8);
    }

    private StringBuilder joinEventBuilder(String subdomain, String playerUuid, String playerName) {
        StringBuilder sb = new StringBuilder(128);
        sb.append('{');
        sb.append("\"subdomain\":").append(quote(subdomain));
        if (playerUuid != null) {
            sb.append(",\"player_uuid\":").append(quote(playerUuid));
        }
        if (playerName != null) {
            sb.append(",\"player_name\":").append(quote(playerName));
        }
        sb.append('}');
        return sb;
    }

    private String quote(String value) {
        if (value == null) {
            return "null";
        }
        int len = value.length();
        StringBuilder sb = new StringBuilder(len + 8);
        sb.append('"');
        for (int i = 0; i < len; i++) {
            char c = value.charAt(i);
            switch (c) {
                case '\\' -> sb.append("\\\\");
                case '"' -> sb.append("\\\"");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append("\\u");
                        sb.append(String.format("%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        sb.append('"');
        return sb.toString();
    }
}
