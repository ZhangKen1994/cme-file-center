#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

clear
echo "========================================"
echo "CME Gold Stocks 自动下载安装器"
echo "========================================"
echo ""
echo "这一步会帮你安装自动下载任务。"
echo "安装后，系统会自动定时检查并下载文件。"
echo ""

chmod +x "$SCRIPT_DIR/install_launch_agent.sh"
"$SCRIPT_DIR/install_launch_agent.sh"

echo ""
echo "安装完成。"
echo ""
echo "以后你不需要再手动运行代码。"
echo "下载结果会保存在："
echo "$HOME/Documents/CME-Gold-Stocks/downloads"
echo ""
echo "你现在可以直接关闭这个窗口。"
echo ""
read -k 1 "?按任意键退出..."
