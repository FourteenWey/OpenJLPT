#!/usr/bin/env bash
# 一键管理 VOICEVOX Engine 与本平台（Vite 开发服务器）。
#
#   ./start.sh [动作] [目标] [--open | --no-open]
#
#   动作  start（默认）  启动；已在运行的会跳过
#         stop           停止
#         restart        先停后启
#         status         查看运行状态（全部在运行返回 0，否则返回 1）
#         logs           跟随查看日志（Ctrl-C 退出）
#   目标  app（默认，只管本平台）| voicevox（可选，需已安装 VOICEVOX）| all（两者）
#   --open     本平台就绪后用默认浏览器打开（默认）
#   --no-open  不打开浏览器
#
# 引擎查找顺序：$VOICEVOX_ENGINE、项目根目录的 voicebox-engine/ 或 voicevox-engine/、/Applications/VOICEVOX.app。
# 环境变量：APP_HOST APP_PORT VOICEVOX_HOST VOICEVOX_PORT
#           VOICEVOX_ENGINE  引擎的 run 可执行文件、它所在的目录，或 VOICEVOX.app
# 进程号与日志放在 .run/。别处启动的服务也能识别，stop / restart 只会处理确认属于本项目或 VOICEVOX 的进程。

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
RUN_DIR="$ROOT/.run"

APP_HOST="${APP_HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-5173}"
VV_HOST="${VOICEVOX_HOST:-127.0.0.1}"
VV_PORT="${VOICEVOX_PORT:-50021}"
STOP_TIMEOUT=10

label() { case $1 in app) echo "本平台" ;; voicevox) echo "VOICEVOX" ;; esac; }
port_of() { case $1 in app) echo "$APP_PORT" ;; voicevox) echo "$VV_PORT" ;; esac; }
base_url() { case $1 in app) echo "http://$APP_HOST:$APP_PORT/" ;; voicevox) echo "http://$VV_HOST:$VV_PORT" ;; esac; }
health_url() { case $1 in app) base_url app ;; voicevox) echo "$(base_url voicevox)/version" ;; esac; }
ready_secs() { case $1 in app) echo 30 ;; voicevox) echo 90 ;; esac; }
pidfile() { echo "$RUN_DIR/$1.pid"; }
logfile() { echo "$RUN_DIR/$1.log"; }

# 用响应内容确认端口上就是本服务，而不是恰好占用同一端口的其它程序：
# 本平台通过首页的 application-name 标识识别；VOICEVOX 的 /version 返回带引号的版本号（如 "0.24.1"）。
is_up() {
  local body re='^"[0-9][^"]*"$'
  body=$(curl -fsS -m 2 "$(health_url "$1")" 2>/dev/null) || return 1
  case $1 in
    app) [[ $body == *'name="application-name" content="OpenJLPT"'* ]] ;;
    voicevox) [[ $body =~ $re ]] ;;
  esac
}
listeners() { lsof -nP -iTCP:"$(port_of "$1")" -sTCP:LISTEN -t 2>/dev/null | sort -u; }
alive() { kill -0 "$1" 2>/dev/null; }
started_at() { ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//'; }
cmd_of() { ps -o command= -p "$1" 2>/dev/null; }
cwd_of() { lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'; }

# 输出本脚本启动且仍在运行的进程号。同时比对启动时间，避免进程号被别的程序复用后误认。
saved_pid() {
  local pid at
  [ -f "$(pidfile "$1")" ] || return 1
  IFS='|' read -r pid at <"$(pidfile "$1")"
  [ -n "$pid" ] && alive "$pid" && [ "$(started_at "$pid")" = "$at" ] && echo "$pid"
}

record_pid() { printf '%s|%s\n' "$1" "$(started_at "$1")" >"$(pidfile "$2")"; }

# 在 $1 里找 VOICEVOX Engine 的可执行文件。
resolve_engine() {
  local p=$1 sub
  if [ -f "$p" ] && [ -x "$p" ]; then echo "$p"; return 0; fi
  for sub in Contents/Resources/vv-engine/run Contents/MacOS/vv-engine/run Contents/MacOS/run macos-arm64/run macos-x64/run run; do
    if [ -f "$p/$sub" ] && [ -x "$p/$sub" ]; then echo "$p/$sub"; return 0; fi
  done
  return 1
}

find_engine() {
  local app
  if [ -n "${VOICEVOX_ENGINE:-}" ]; then resolve_engine "$VOICEVOX_ENGINE"; return; fi
  for app in "$ROOT/voicebox-engine" "$ROOT/voicevox-engine" /Applications/VOICEVOX.app "$HOME/Applications/VOICEVOX.app"; do
    resolve_engine "$app" && return 0
  done
  return 1
}

# 只处理确认属于本项目 / VOICEVOX 的进程，避免误杀恰好占用同一端口的其它程序。
is_ours() {
  local svc=$1 pid=$2 cmd engine
  [ "$(saved_pid "$svc")" = "$pid" ] && return 0
  cmd=$(cmd_of "$pid")
  case $svc in
    app) [ "$(cwd_of "$pid")" = "$ROOT" ] && [[ $cmd == *vite* ]] ;;
    voicevox)
      [[ $cmd == *[Vv][Oo][Ii][Cc][Ee][Vv][Oo][Xx]* || $cmd == *vv-engine* ]] && return 0
      engine=$(find_engine) && [[ $cmd == "$engine"* ]]
      ;;
  esac
}

descendants() {
  local p c
  for p in "$@"; do
    for c in $(pgrep -P "$p" 2>/dev/null); do
      echo "$c"
      descendants "$c"
    done
  done
}

all_dead() {
  local p
  for p in "$@"; do alive "$p" && return 1; done
  return 0
}

stop_svc() {
  local svc=$1 name pids="" p all i
  name=$(label "$svc")
  for p in $(listeners "$svc"); do
    if is_ours "$svc" "$p"; then
      pids="$pids $p"
    else
      echo "${name}：端口 $(port_of "$svc") 被其它程序占用（pid ${p}：$(cmd_of "$p")），未处理。"
      return 1
    fi
  done
  p=$(saved_pid "$svc") && pids="$pids $p"
  if [ -z "${pids// /}" ]; then
    rm -f "$(pidfile "$svc")"
    echo "${name}：未在运行"
    return 0
  fi
  all="$pids $(descendants $pids)"
  kill -TERM $all 2>/dev/null
  for ((i = 0; i < STOP_TIMEOUT * 5; i++)); do
    all_dead $all && break
    sleep 0.2
  done
  if ! all_dead $all; then
    kill -KILL $all 2>/dev/null
    sleep 0.5
  fi
  rm -f "$(pidfile "$svc")"
  echo "${name}：已停止"
}

spawn_app() {
  if [ ! -x "$ROOT/node_modules/.bin/vite" ]; then
    echo "本平台：首次运行，先安装依赖（npm install）…"
    (cd "$ROOT" && npm install) || { echo "本平台：npm install 失败"; return 1; }
  fi
  (cd "$ROOT" && exec nohup ./node_modules/.bin/vite --host "$APP_HOST" --port "$APP_PORT" --strictPort) >"$(logfile app)" 2>&1 </dev/null &
  SPAWNED=$!
  record_pid "$SPAWNED" app
}

spawn_voicevox() {
  local engine
  if ! engine=$(find_engine); then
    echo "VOICEVOX：没有找到 Engine。请安装 VOICEVOX（https://voicevox.hiroshiba.jp/）到 /Applications，"
    echo "          或指定路径：VOICEVOX_ENGINE=/path/to/run ./start.sh"
    return 1
  fi
  nohup "$engine" --host "$VV_HOST" --port "$VV_PORT" >"$(logfile voicevox)" 2>&1 </dev/null &
  SPAWNED=$!
  record_pid "$SPAWNED" voicevox
}

# 已在运行就跳过；成功拉起（或发现正在启动）后把「服务:进程号」追加到 PENDING，由 wait_ready 等待就绪。
start_svc() {
  local svc=$1 name pid
  name=$(label "$svc")
  if is_up "$svc"; then
    echo "${name}：已在运行，跳过（$(base_url "$svc")）"
    return 0
  fi
  if pid=$(saved_pid "$svc"); then
    echo "${name}：正在启动中（pid ${pid}），等待就绪"
    PENDING="$PENDING $svc:$pid"
    return 0
  fi
  if [ -n "$(listeners "$svc")" ]; then
    echo "${name}：端口 $(port_of "$svc") 被占用，但不是预期的服务。可先 ./start.sh stop ${svc}，或直接 restart。"
    return 1
  fi
  "spawn_$svc" || return 1
  echo "${name}：已启动（pid ${SPAWNED}），日志 .run/$svc.log"
  PENDING="$PENDING $svc:$SPAWNED"
}

wait_ready() {
  local svc=$1 pid=$2 name limit i
  name=$(label "$svc")
  limit=$(ready_secs "$svc")
  for ((i = 0; i < limit; i++)); do
    if is_up "$svc"; then
      echo "${name}：已就绪（${i}s）$(base_url "$svc")"
      return 0
    fi
    if ! alive "$pid"; then
      echo "${name}：进程已退出，最近日志："
      tail -n 15 "$(logfile "$svc")" | sed 's/^/    /'
      rm -f "$(pidfile "$svc")"
      return 1
    fi
    sleep 1
  done
  echo "${name}：${limit}s 内没有就绪，进程仍在运行。查看日志：./start.sh logs $svc"
  return 1
}

status_svc() {
  local svc=$1 name pids who ver=""
  name=$(label "$svc")
  pids=$(listeners "$svc" | tr '\n' ' ')
  pids=${pids% }
  if is_up "$svc"; then
    if saved_pid "$svc" >/dev/null; then who="本脚本启动"; else who="非本脚本启动"; fi
    [ "$svc" = voicevox ] && ver=" v$(curl -fsS -m 2 "$(base_url voicevox)/version" 2>/dev/null | tr -d '"')"
    echo "${name}：运行中$ver  $(base_url "$svc")  pid ${pids:-?}（${who}）"
  elif [ -n "$pids" ]; then
    echo "${name}：端口 $(port_of "$svc") 被占用，但不是预期的服务（pid ${pids}）"
    return 1
  else
    echo "${name}：未运行"
    return 1
  fi
}

do_logs() {
  local svc files=""
  for svc in $1; do
    [ -f "$(logfile "$svc")" ] && files="$files $(logfile "$svc")"
  done
  if [ -z "$files" ]; then
    echo "还没有日志（只有经本脚本启动的服务才有）。"
    return 1
  fi
  exec tail -n 40 -f $files
}

usage() { sed -n '2,/^$/s/^# \{0,1\}//p' "$0"; }

ACTION=start
TARGET=app
OPEN=1
for arg in "$@"; do
  case $arg in
    -h | --help) usage; exit 0 ;;
    --open) OPEN=1 ;;
    --no-open) OPEN=0 ;;
    start | stop | restart | status | logs) ACTION=$arg ;;
    all | app | voicevox) TARGET=$arg ;;
    *) echo "未知参数：$arg" >&2; usage >&2; exit 2 ;;
  esac
done

for tool in curl lsof; do
  command -v "$tool" >/dev/null || { echo "缺少命令：$tool" >&2; exit 1; }
done

# 引擎加载模型较慢，先启动；停止时反过来。
if [ "$TARGET" = all ]; then START_ORDER="voicevox app"; STOP_ORDER="app voicevox"; else START_ORDER=$TARGET; STOP_ORDER=$TARGET; fi

mkdir -p "$RUN_DIR"
rc=0
PENDING=""
SPAWNED=""

do_stop() { for svc in $STOP_ORDER; do stop_svc "$svc" || rc=1; done; }
do_start() {
  for svc in $START_ORDER; do start_svc "$svc" || rc=1; done
  for item in $PENDING; do wait_ready "${item%%:*}" "${item##*:}" || rc=1; done
  if [ "$OPEN" = 1 ] && [ "$TARGET" != voicevox ] && is_up app; then
    command -v open >/dev/null && open "$(base_url app)"
  fi
}

case $ACTION in
  start) do_start ;;
  stop) do_stop ;;
  restart) do_stop; do_start ;;
  status) for svc in $START_ORDER; do status_svc "$svc" || rc=1; done ;;
  logs) do_logs "$START_ORDER" || rc=1 ;;
esac
exit $rc
