#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

clear
echo "========================================"
echo "CME Gold Stocks 立即下载"
echo "========================================"
echo ""
echo "正在检查并下载文件，请稍等..."
echo ""

/usr/local/bin/node "$SCRIPT_DIR/download_gold_stocks.js" --force

echo ""
echo "处理完成。"
echo "下载文件夹："
echo "$HOME/Documents/CME-Gold-Stocks/downloads"
echo ""
open "$HOME/Documents/CME-Gold-Stocks/downloads"
echo "我已经帮你打开下载文件夹。"
echo ""
read -k 1 "?按任意键退出..."
