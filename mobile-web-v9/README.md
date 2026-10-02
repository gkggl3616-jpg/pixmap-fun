# Pixmap Studio Mobile Web V9

Telefon için V9 özelliklerini mobil PWA arayüzüne taşıyan sürüm.

## Yerelde
```powershell
py -m pip install -r requirements.txt
py app.py
```
Telefon ve PC aynı ağdaysa `http://PC-IP:8765` açılabilir.

## Gerçek telefonda PC'siz kullanım
Bu proje Railway / VPS / Docker sunucusuna deploy edilir. Dockerfile FFmpeg'i de kurar. Böylece telefon yalnızca siteyi/PWA'yı açar; PC'nin açık kalması gerekmez.

## Railway
1. Bu klasörü bir GitHub reposuna koy.
2. Railway'de repo'yu deploy et.
3. İstersen `APP_PIN` environment variable ekle.
4. Railway domainini telefonda açıp **Ana ekrana ekle**.

## Mobil karşılıklar
- Masaüstüne Ekle -> PWA/Ana ekrana kur
- Mouse/cursor efektleri -> dokunma/aktif buton glow
- Çıktı klasörünü aç -> Çıktılar ekranı + telefona indir
- Son çıktıyı aç -> Durum ekranında son çıktı butonu

## Pixmap API
Uygulama mevcut Pixmap URL yapısını kullanır:
- `/api/canvases`
- `/chunks/{canvas}/{x}/{y}`
- `/history/snapshots/{canvas}?day=YYYYMMDD`
- `/history/chunk/{canvas}/{day}/{hhmm}/{x}_{y}.png`
