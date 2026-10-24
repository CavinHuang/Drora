#!/bin/sh
# 对运行中的 relay 容器执行设备注册表一致性备份（spec §7：VACUUM INTO 产出与源库
# 一致的自包含快照；禁止直接 cp 运行中的 WAL 库——可能拷出撕裂副本）。
#
# 用法：
#   ./backup.sh                    # 默认名 backup-<UTC 时间戳>.db
#   ./backup.sh my-backup.db       # 自定义文件名
# 取回（standalone 形态，文件在具名卷内）：
#   docker compose -f docker-compose.standalone.yml cp relay:/data/backups/<文件> .
#
# 形态选择：默认 standalone 编排；双服务（Caddy）形态用
#   COMPOSE_FILE=docker-compose.yml ./backup.sh
# 前提：relay 服务healthy（docker compose ps）。VACUUM INTO 只需读锁，可与在线
# 服务并发执行；输出文件已存在时报错不覆盖。
set -e
cd "$(dirname "$0")"
exec docker compose -f "${COMPOSE_FILE:-docker-compose.standalone.yml}" exec -T relay node -e '
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const dbPath = process.env.DB_PATH;
if (!dbPath) throw new Error("DB_PATH 未设置（容器 env 应由编排注入，spec §9）");
const dir = path.join(path.dirname(dbPath), "backups");
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.join(dir, process.argv[1] || `backup-${stamp}.db`);
if (fs.existsSync(out)) throw new Error("目标已存在: " + out);
// 文件名来自本脚本参数（非用户原始输入直插 SQL）；仍按 SQL 字面量规范转义单引号。
new DatabaseSync(dbPath).exec("VACUUM INTO \u0027" + out.replace(/\u0027/g, "\u0027\u0027") + "\u0027");
console.log("backup written: " + out);
' "${1:-}"
