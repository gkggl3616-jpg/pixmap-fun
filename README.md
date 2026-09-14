# Pixmap Fun Lite

Redis ve MySQL gerektirmeyen, tek Node.js süreciyle çalışan canlı piksel tuvali.

## Özellikler

- Mobil ve masaüstünde yakınlaştırılabilir 256×256 ortak tuval
- Sunucu kontrollü piksel basma ve bekleme süresi
- SSE ile anlık piksel ve çevrimiçi kişi güncellemeleri
- Günlük ve toplam oyuncu sıralaması
- Proxy/VPN denetimi (proxycheck.io v3)
- JSON dosyasına güvenli, atomik kayıt
- Harici npm paketi yok; kurulum boyutu çok küçük

## Yerelde çalıştırma

Node.js 20 veya üstü yeterlidir:

```bash
npm start
```

Sonra `http://localhost:8080` adresini açın.

## Railway değişkenleri

Zorunlu değişken yoktur. İsteğe bağlı:

| Değişken | Varsayılan | Açıklama |
|---|---:|---|
| `COOLDOWN_MS` | `900` | Piksel basma aralığı |
| `DATA_DIR` | `./data` | Kalıcı JSON kayıt klasörü; Railway Volume için `/data` kullanılabilir |
| `PROXYCHECK_KEY` | boş | Daha yüksek günlük sorgu limiti için proxycheck.io anahtarı |
| `BLOCK_PROXIES` | `0` | `1` olursa doğrulanmış proxy/VPN üzerinden piksel basmayı engeller |
| `TIME_ZONE` | `Europe/Istanbul` | Günlük sıralamanın sıfırlanacağı saat dilimi |

Railway otomatik olarak `Dockerfile` ve `railway.json` dosyalarını algılar. Kalıcılık isteniyorsa servise bir Volume ekleyip mount path'i `/data` yapın ve `DATA_DIR=/data` ekleyin.

## Sağlık kontrolü

`GET /api/health` başarılı olduğunda `mode: redisless` döndürür.
