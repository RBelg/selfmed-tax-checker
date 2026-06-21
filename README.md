# セルフメディケーション税制チェッカー

Amazonで購入した市販薬（OTC医薬品）が、確定申告の**セルフメディケーション税制**の対象になるかを自動判定する、無料・サーバーレスの静的Webサービス。

- すべての処理は**ブラウザ内で完結**し、外部サーバーへデータを送信しません。
- 収益化は Google AdSense ＋ Ko-fi（ページ内に配置）。
- データ出典：厚生労働省「[セルフメディケーション税制対象品目一覧](https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000124853.html)」

## 仕組み

```
[Amazon注文履歴ページ]
   └─ ブックマークレット(bookmarklet.js): 商品名をDOMから抽出
        └─ localStorage と URLハッシュ に格納 → 自サイトへ遷移
[自サイト index.html]
   └─ data/medicines.json を読み込み、商品名を正規化して照合
        └─ 対象薬リスト / 合計金額 / 判定 / 税率別の節税額を表示
```

ブックマークレットは `medicines.json` を取得しません（AmazonのCSPによる外部通信ブロックを避けるため）。**抽出はAmazon側、照合は自サイト側**に役割分担しています。

## ファイル構成

| パス | 役割 |
|---|---|
| `index.html` | メインUI。照合・判定・税額表示・AdSense枠・Ko-fiボタン。ブックマークレット登録リンクを実行時生成 |
| `bookmarklet.js` | 抽出ロジックの**正本**。`__SITE__` / `__KEY__` を実行時に置換 |
| `bookmarklet.min.txt` | 手動コピー用の `javascript:` 文字列（生成物） |
| `data/medicines.json` | 対象品目リスト（生成物） |
| `scripts/build_medicines.py` | 厚労省xlsx → `medicines.json` 生成 |
| `scripts/build_bookmarklet.mjs` | `bookmarklet.js` → `bookmarklet.min.txt` 生成 |
| `scripts/requirements.txt` | Python依存（openpyxl, requests） |

## 判定ロジック

- 対象薬の年間購入額が **12,000円を超える** と申告対象。
- 控除額 ＝ `min(購入額 − 12,000, 88,000)`（上限88,000円）。
- 節税額の目安 ＝ 控除額 ×（所得税率 ＋ 住民税率10%）。所得税率 5/10/20/23/33% で表示。
- 通常の医療費控除（年間10万円超）とは**選択適用**（どちらか一方）。

## セットアップ・開発

### 1. 品目データの生成

```bash
pip install -r scripts/requirements.txt
python scripts/build_medicines.py
# -> data/medicines.json を生成
```

### 2. ローカルで動作確認

```bash
python -m http.server 8765
# ブラウザで http://localhost:8765/ を開く
```

「手動で商品名を貼り付ける」に以下のようなテキストを入れて判定を確認できる:

```
【第1類医薬品】ロキソニンSプレミアム 24錠
【指定第2類医薬品】アレグラFX 28錠
```

### 3. ブックマークレット文字列（手動コピー用）の生成（任意）

```bash
node scripts/build_bookmarklet.mjs https://your-deployed-site/
# -> bookmarklet.min.txt
```

## データの月次更新運用

厚労省は対象品目一覧を毎月更新する。手順：

1. [厚労省ページ](https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000124853.html) で最新版「対象品目一覧」xlsx の直リンクを確認。
2. `scripts/build_medicines.py` の `SOURCES` の URL・ラベルを差し替え。
3. `python scripts/build_medicines.py` を実行して `data/medicines.json` を再生成。
4. コミット＆デプロイ。

> **注意**: 非スイッチOTCは最新版が **PDFのみ** の月がある。xlsx が公開されている月のみ `SOURCES` に追加する。常に最新を反映したい場合は PDF パース（pdfplumber）の追加が必要（未実装）。

将来的には GitHub Actions での定期再生成も検討。

## デプロイ

GitHub Pages または Render Static Site（いずれも無料・スリープなし）に静的ファイルをそのまま配置。

## 既知の課題・未確認事項

- **AmazonのDOM構造は未実機確認**。`bookmarklet.js` のセレクタ・除外語は実際の注文履歴ページで要検証（PC/スマホ/年フィルタで差あり）。CSPで遷移がブロックされる場合は拡張機能化を検討。
- 商品名の照合精度（表記揺れ・容量違い・セット品）は継続調整課題。
- 価格の自動取得は未対応（サイト側で手入力・調整）。
- 非スイッチOTCのPDF対応は未実装。
- AdSense審査・Ko-fi連携は実装後の作業（`index.html` 内にプレースホルダあり）。

## 免責

本ツールの判定・金額はあくまで目安です。実際の確定申告は最新の制度と領収書に基づき、必要に応じて税務署・税理士にご確認ください。本サイトは情報提供を目的とした非公式ツールです。
