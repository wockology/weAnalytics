# WeAnalytics — BungeeCord

Сразу при входе на прокси отправляет поддомен, с которым игрок подключился (`eu.newbox.pw` в адресе Minecraft).

## config.yml

```yaml
api-url: "https://ваш-сайт/api/event"
api-key: "wea_live_..."
```

## Запрос

```json
{
  "subdomain": "eu.newbox.pw",
  "player_uuid": "...",
  "player_name": "Steve"
}
```

## Сборка

```bash
cd bungee && mvn package
```
