package me.wockology.weanalytics.config;

import lombok.experimental.UtilityClass;
import net.md_5.bungee.api.plugin.Plugin;
import net.md_5.bungee.config.Configuration;
import net.md_5.bungee.config.ConfigurationProvider;
import net.md_5.bungee.config.YamlConfiguration;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;

@UtilityClass
public class Config {

    public Settings load(Plugin plugin) throws IOException {
        File dataFolder = plugin.getDataFolder();
        if (!dataFolder.exists()) {
            dataFolder.mkdir();
        }

        File configFile = new File(dataFolder, "config.yml");
        Configuration defaults = readEmbedded(plugin);

        if (!configFile.exists() && defaults != null) {
            ConfigurationProvider.getProvider(YamlConfiguration.class).save(defaults, configFile);
        }

        Configuration config = ConfigurationProvider.getProvider(YamlConfiguration.class).load(configFile);
        if (defaults != null) {
            mergeMissing(config, defaults);
            ConfigurationProvider.getProvider(YamlConfiguration.class).save(config, configFile);
        }

        return Settings.from(config);
    }

    private Configuration readEmbedded(Plugin plugin) throws IOException {
        try (InputStream in = plugin.getResourceAsStream("config.yml")) {
            if (in == null) {
                return null;
            }
            return ConfigurationProvider.getProvider(YamlConfiguration.class).load(in);
        }
    }

    private void mergeMissing(Configuration target, Configuration defaults) {
        for (String key : defaults.getKeys()) {
            if (!target.contains(key)) {
                target.set(key, defaults.get(key));
            }
        }
    }
}
