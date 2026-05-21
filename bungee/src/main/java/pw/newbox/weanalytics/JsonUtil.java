package pw.newbox.weanalytics;

final class JsonUtil {

    private JsonUtil() {}

    static String joinEvent(String subdomain, String playerUuid, String playerName) {
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
        return sb.toString();
    }

    private static String quote(String value) {
        if (value == null) {
            return "null";
        }
        StringBuilder sb = new StringBuilder(value.length() + 2);
        sb.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '\\' -> sb.append("\\\\");
                case '"' -> sb.append("\\\"");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
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
