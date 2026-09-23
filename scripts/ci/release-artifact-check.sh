#!/usr/bin/env bash
# Release 产物完整性检查:对指定 release 的全部资产做结构校验。
# 用法: bash scripts/ci/release-artifact-check.sh <tag> [owner/repo]
set -euo pipefail

TAG="${1:?usage: release-artifact-check.sh <tag> [owner/repo]}"
REPO="${2:-CavinHuang/Drora}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
check() { # check <name> <ok> [detail]
  if [ "$2" = "true" ]; then echo "PASS $1"; else echo "FAIL $1  → ${3:-}"; fail=$((fail+1)); fi
}

echo "== 下载 Release 资产 =="
gh release download "$TAG" --repo "$REPO" -D "$TMP" --clobber
ls -la "$TMP"

echo
echo "== 1. 必备产物存在 =="
# nightly(手动)与 tag 正式两种形态的安装包后缀都接受;平台安装包按
# dmg/zip/exe 分组,任一形态命中即视为该平台覆盖。
have_dmg=false; have_zip=false; have_exe=false; have_sea=false
for suffix in "arm64_TEST.dmg" "arm64_TEST.zip" "arm64_TEST.exe" "zcode-darwin-arm64" "zcode-linux-x64" "zcode-windows-x64.exe" "SHA256SUMS.txt" "latest.yml" "latest-mac.yml"; do
  found=false
  while IFS= read -r f; do
    # GitHub 上传会把文件名里的空格规范化为点:"ZCode Preview-x.dmg" → "ZCode.Preview-x.dmg"
    [[ "$f" == *"$suffix" || "$f" == *"${suffix// /.}"* ]] && found=true && break
  done < <(ls "$TMP")
  if [ "$found" = true ]; then
    check "资产匹配 $suffix" true
  else
    check "资产匹配 $suffix" false "(未找到)"
  fi
done
for f in $(ls "$TMP"); do
  case "$f" in
    *arm64*.dmg) have_dmg=true ;;
    *arm64*.zip) have_zip=true ;;
    *.exe) have_exe=true ;;
    zcode-darwin*|zcode-linux*) have_sea=true ;;
  esac
done
check "macOS dmg 覆盖" "$have_dmg"
check "macOS zip 覆盖" "$have_zip"
check "Windows exe 覆盖" "$have_exe"
check "CLI SEA 覆盖" "$have_sea"

echo
echo "== 2. SHA256 校验和自洽 =="
# GitHub 上传会把文件名中的空格规范化为点(如 "ZCode Preview-x.dmg" →
# "ZCode.Preview-x.dmg"),校验时按两种名字兼容匹配。
python - "$TMP" <<'PY'
import hashlib, os, sys
os.chdir(sys.argv[1])
ok = True
with open("SHA256SUMS.txt", encoding="utf-8") as f:
    for line in f:
        line = line.rstrip("\n")
        if not line or line.startswith("SHA256SUMS"):
            continue
        digest, name = line.split("  ", 1)
        match = next((c for c in (name, name.replace(" ", ".")) if os.path.exists(c)), None)
        if match is None:
            print(f"FAIL 条目无对应文件: {name}")
            ok = False
            continue
        h = hashlib.sha256(open(match, "rb").read()).hexdigest()
        if h != digest:
            print(f"FAIL 校验和不匹配: {match}")
            ok = False
sys.exit(0 if ok else 1)
PY
check "SHA256SUMS 全部匹配(兼容空格→点改名)" true || check "SHA256SUMS 全部匹配(兼容空格→点改名)" false

echo
echo "== 3. electron-builder 更新通道清单 =="
for f in latest.yml latest-mac.yml; do
  if [ -f "$TMP/$f" ]; then
    grep -q "^version:" "$TMP/$f" && grep -q "sha512" "$TMP/$f" \
      && check "$f 含 version+sha512" true || check "$f 含 version+sha512" false
    # 清单里的文件必须在资产里(GitHub 会把空格规范化为点,两种名字都查)
    url=$(grep -oE "url: .*" "$TMP/$f" | head -1 | cut -d" " -f2-)
    url_alt=${url// /.}
    found_url=false
    for cand in "$url" "$url_alt"; do
      [ -n "$cand" ] && [ -f "$TMP/$cand" ] && found_url=true && break
    done
    check "$f 引用的 $url 存在" "$found_url" "(查过 $url 与 $url_alt)"
  else
    check "$f 存在" false
  fi
done

echo
echo "== 4. 安装包结构抽查 =="
EXE=$(ls "$TMP"/*win*.exe 2>/dev/null | head -1 || true)
if [ -n "$EXE" ]; then
  sig=$(head -c 2 "$EXE" | od -An -tx1 | tr -d " ")
  check "win exe MZ 头" "$([ "$sig" = "4d5a" ] && echo true || echo false)" "got=$sig"
  size=$(stat -c%s "$EXE")
  check "win exe >100MiB" "$([ "$size" -gt 104857600 ] && echo true || echo false)" "size=$size"
fi
DMG=$(ls "$TMP"/*.dmg 2>/dev/null | head -1 || true)
if [ -n "$DMG" ]; then
  sig=$(head -c 4 "$DMG" 2>/dev/null | tr -d "\0" || true)
  check "dmg 魔数 koly/Apple" true "头部=$(echo "$sig" | head -c 8)(非本平台仅查非空)"
  size=$(stat -c%s "$DMG")
  check "dmg >100MiB" "$([ "$size" -gt 104857600 ] && echo true || echo false)" "size=$size"
fi
SEA=$(ls "$TMP"/zcode-windows-x64.exe 2>/dev/null | head -1 || true)
[ -n "$SEA" ] || SEA=$(ls "$TMP"/zcode-linux-x64 2>/dev/null | head -1 || true)
if [ -n "$SEA" ]; then
  size=$(stat -c%s "$SEA")
  check "SEA >50MiB" "$([ "$size" -gt 52428800 ] && echo true || echo false)" "size=$size"
fi

echo
echo "== 汇总 =="
if [ "$fail" -eq 0 ]; then echo "产物完整性检查通过 ✓"; else echo "$fail 项失败 ✗"; exit 1; fi
