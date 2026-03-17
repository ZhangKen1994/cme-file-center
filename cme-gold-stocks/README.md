# CME Gold Stocks Downloader

本机版工具会自动下载 CME `Gold_Stocks.xls`，并且只在以下条件同时成立时归档保存：

- 当前是 `America/New_York` 时区下的 CME 工作日
- 当前纽约时间在 `12:00-15:59`
- Excel 里的 `Report Date` 等于纽约“今天”
- Excel 里的 `Activity Date` 等于上一个 CME 工作日

保存目录固定为：

- `/Users/<你的用户名>/Documents/CME-Gold-Stocks/downloads`

文件名格式：

- `YYYY-MM-DD_Gold_Stocks.xls`

同一天重复触发时，如果同名文件已经存在，脚本会跳过，不重复保存。

## 手动运行

如果你不想碰代码，直接双击下面这些文件就可以：

- `一键安装自动下载.command`
- `立刻下载一次.command`
- `打开下载文件夹.command`

如果你需要命令行方式，再用下面这些命令。

在当前工作目录运行：

```bash
node cme-gold-stocks/download_gold_stocks.js --force
```

正常定时运行时不需要 `--force`：

```bash
node cme-gold-stocks/download_gold_stocks.js
```

## 安装本机定时任务

```bash
chmod +x cme-gold-stocks/install_launch_agent.sh
./cme-gold-stocks/install_launch_agent.sh
```

卸载：

```bash
chmod +x cme-gold-stocks/uninstall_launch_agent.sh
./cme-gold-stocks/uninstall_launch_agent.sh
```

## 日志和状态文件

- 运行日志：`/Users/<你的用户名>/Documents/CME-Gold-Stocks/logs/run.log`
- launchd 输出：`/Users/<你的用户名>/Documents/CME-Gold-Stocks/logs/launchd.stdout.log`
- launchd 错误：`/Users/<你的用户名>/Documents/CME-Gold-Stocks/logs/launchd.stderr.log`
- 最新状态：`/Users/<你的用户名>/Documents/CME-Gold-Stocks/state.json`

## 重要限制

这是本机版，不是云端版。

- Mac 关机时不会执行
- Mac 睡眠时通常也不会执行
- 如果你要做到“电脑关机也照常跑”，下一步需要把同一套逻辑迁移到云主机、NAS 或常开设备上
