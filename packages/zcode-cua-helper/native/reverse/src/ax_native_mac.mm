
#include <napi.h>
#import <AppKit/NSEvent.h>
#import <AppKit/NSScreen.h>
#import <AppKit/NSWorkspace.h>
#import <AppKit/NSRunningApplication.h>
#import <AppKit/NSApplication.h>
#import <AppKit/NSBitmapImageRep.h>
#import <AppKit/NSGraphics.h>
#include <CoreGraphics/CoreGraphics.h>
#include <ApplicationServices/ApplicationServices.h>
#include <Security/Security.h>
#include <Carbon/Carbon.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/ucred.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <map>
#include <string>
#include <tuple>
#include <vector>

// ax_native mac 语义重建源码（5a 注册+校验面 / 5b 只读+行为域 / 5c AX+capture 族 /
// 5d 动作域+ToPid/Verified/窗口系 / 5e displays 门控 / 5f PiP 控制面 / 5g ghost 状态机）。
// parity 锚=官方 3.17.2 ax_native.node sha256 b169b8dc…ceaea。本文件由
// generate-mac-rebuilt.py 生成——改实现改生成器，勿手编（manifest 七十轮事故教训）。

namespace {

Napi::Value NotImplemented(const Napi::CallbackInfo &info, const char *name) {
  Napi::Error::New(info.Env(), std::string("ax_native_mac(rebuilt) method not yet restored: ") + name)
      .ThrowAsJavaScriptException();
  return info.Env().Undefined();
}

bool IsArgNumber(const Napi::CallbackInfo &info, size_t i) { return info[i].IsNumber(); }
bool IsArgString(const Napi::CallbackInfo &info, size_t i) { return info[i].IsString(); }
bool IsArgObject(const Napi::CallbackInfo &info, size_t i) { return info[i].IsObject(); }
bool IsArgBool(const Napi::CallbackInfo &info, size_t i) { return info[i].IsBoolean(); }
bool IsArgStringNonEmpty(const Napi::CallbackInfo &info, size_t i) {
  return info[i].IsString() && info[i].As<Napi::String>().Utf8Value().size() > 0;
}
bool IsArgStringOrNull(const Napi::CallbackInfo &info, size_t i) {
  return info[i].IsNull() || info[i].IsString();
}

// —— AX 工具层 ——
static CGFloat MainScreenHeight() { return [NSScreen mainScreen].frame.size.height; }
// [E] 坐标系：官方输出=CG 全局（主屏左上原点）；AX frame=AppKit（左下）→ y 翻转。
static void CgFlipBounds(double x, double y, double w, double h, double out[4]) {
  out[0] = x; out[1] = MainScreenHeight() - (y + h); out[2] = w; out[3] = h;
}
static Napi::Array BoundsArray(Napi::Env env, const double b[4]) {
  Napi::Array a = Napi::Array::New(env, 4);
  a[(uint32_t)0] = Napi::Number::New(env, b[0]);
  a[(uint32_t)1] = Napi::Number::New(env, b[1]);
  a[(uint32_t)2] = Napi::Number::New(env, b[2]);
  a[(uint32_t)3] = Napi::Number::New(env, b[3]);
  return a;
}
static bool AxCopyAttr(AXUIElementRef el, CFStringRef attr, CFTypeRef *out) {
  if (el == nullptr || out == nullptr) return false;
  *out = nullptr;
  return AXUIElementCopyAttributeValue(el, attr, out) == kAXErrorSuccess && *out != nullptr;
}
static std::string AxStdString(CFStringRef s) {
  if (s == nullptr) return "";
  const char *p = CFStringGetCStringPtr(s, kCFStringEncodingUTF8);
  if (p != nullptr) return p;
  char buf[1024];
  if (CFStringGetCString(s, buf, sizeof(buf), kCFStringEncodingUTF8)) return buf;
  return "";
}
// 返回 attr 是否存在（区分 unsupported → 字段省略语义）
static bool AxStringAttr(AXUIElementRef el, CFStringRef attr, std::string *out) {
  CFTypeRef v = nullptr;
  if (!AxCopyAttr(el, attr, &v)) return false;
  CFStringRef s = (CFStringRef)v;
  std::string r = (CFGetTypeID(v) == CFStringGetTypeID()) ? AxStdString(s) : "";
  CFRelease(v);
  if (out != nullptr) *out = r;
  return true;
}
static bool AxBoolAttr(AXUIElementRef el, CFStringRef attr, bool dflt) {
  CFTypeRef v = nullptr;
  if (!AxCopyAttr(el, attr, &v)) return dflt;
  bool r = dflt;
  if (CFGetTypeID(v) == CFBooleanGetTypeID()) r = CFBooleanGetValue((CFBooleanRef)v);
  else if (CFGetTypeID(v) == CFNumberGetTypeID()) {
    int i = 0; CFNumberGetValue((CFNumberRef)v, kCFNumberIntType, &i); r = i != 0;
  }
  CFRelease(v);
  return r;
}
static bool AxFrameAttr(AXUIElementRef el, double b[4]) {
  // [E] AX 原始 frame 即官方输出坐标（左上原点；menubar {0,0,2560,30}→[0,0,2560,30]，
  // 关于本机 {0,1440,0,0}→[0,1440,0,0]，实测无翻转）。cursorPoint 的翻转仅 NSEvent 路径。
  AXValueRef pos = nullptr, siz = nullptr;
  CGPoint p{}; CGSize sz{};
  bool ok = AxCopyAttr(el, kAXPositionAttribute, (CFTypeRef *)&pos) &&
            AXValueGetValue(pos, kAXValueTypeCGPoint, &p);
  if (ok) ok = AxCopyAttr(el, kAXSizeAttribute, (CFTypeRef *)&siz) &&
               AXValueGetValue(siz, kAXValueTypeCGSize, &sz);
  if (pos != nullptr) CFRelease(pos);
  if (siz != nullptr) CFRelease(siz);
  if (!ok) { b[0] = b[1] = b[2] = b[3] = 0; return false; }
  b[0] = p.x; b[1] = p.y; b[2] = sz.width; b[3] = sz.height;
  return true;
}
static bool AxFocusedFlag(AXUIElementRef el) {
  // [E] AXColumn 全属性 cannot-complete 而官方 focused=true（其余角色错误默认 false）
  CFTypeRef v = nullptr;
  if (AxCopyAttr(el, kAXFocusedAttribute, &v)) {
    bool r = false;
    if (CFGetTypeID(v) == CFBooleanGetTypeID()) r = CFBooleanGetValue((CFBooleanRef)v);
    CFRelease(v);
    return r;
  }
  return false;
}
static bool AxEnabledFlag(AXUIElementRef el) {
  // [E] AXColumn 属性读取 cannot-complete，官方稳定输出 enabled=true/focused=false
  std::string t;
  if (AxStringAttr(el, kAXRoleAttribute, &t) && t == "AXColumn") return true;
  return AxBoolAttr(el, kAXEnabledAttribute, false);
}
static bool AxEditableValue(AXUIElementRef el) {
  // [E] AXEditable 属性读 err-25205；官方 editable=AXUIElementIsAttributeSettable(AXValue)（搜索框 true）
  Boolean settable = false;
  return el != nullptr &&
         AXUIElementIsAttributeSettable(el, kAXValueAttribute, &settable) == kAXErrorSuccess &&
         settable;
}
static std::string AxTitleOrDescription(AXUIElementRef el) {
  // [E] 官方 title 解析链（逐节点实测反推）：
  //  ① AXTitle 非空（空串=缺失，继续回退——AXMenuItem ""+ident "_NS:1101" → ident 胜出）
  //  ② AXMenu 专属：AXParent 的标题（Apple 菜单→"Apple"、访达菜单→"访达"、服务→"服务"）
  //  ③ AXDescription 非空（桌面组→"桌面"、AXTable→"搜索结果"）
  //  ④ AXIdentifier 非空（menubar "_NS:1088"、空 title 菜单项 "_NS:1101"）
  //  ⑤ ""（Apple 菜单分隔项 title:"" 且无 ident/desc）
  std::string t;
  if (AxStringAttr(el, kAXTitleAttribute, &t) && !t.empty()) return t;
  std::string role = AxStringAttr(el, kAXRoleAttribute, &t) ? t : "";
  if (role == "AXMenu") {
    AXUIElementRef parent = nullptr;
    if (AxCopyAttr(el, kAXParentAttribute, (CFTypeRef *)&parent) && parent != nullptr) {
      std::string pt;
      if (AxStringAttr(parent, kAXTitleAttribute, &pt) && !pt.empty()) {
        CFRelease(parent);
        return pt;
      }
      CFRelease(parent);
    }
  }
  if (AxStringAttr(el, kAXDescriptionAttribute, &t) && !t.empty()) return t;
  if (AxStringAttr(el, kAXIdentifierAttribute, &t) && !t.empty()) return t;
  return "";
}
static std::string AxTitleOrDescForPreview(AXUIElementRef el) {
  // preview 链不用 Identifier（[E] preview 实测字节一致不含 _NS 杂项）
  std::string t;
  if (AxStringAttr(el, kAXTitleAttribute, &t)) return t;
  if (AxStringAttr(el, kAXDescriptionAttribute, &t)) return t;
  return "";
}
static int32_t AxPidOf(AXUIElementRef el) {
  int32_t pid = -1;
  if (el != nullptr) AXUIElementGetPid(el, &pid);
  return pid;
}
static Napi::Array AxActionNamesArray(Napi::Env env, AXUIElementRef el) {
  CFArrayRef names = nullptr;
  Napi::Array arr = Napi::Array::New(env, 0);
  if (el != nullptr && AXUIElementCopyActionNames(el, &names) == kAXErrorSuccess && names != nullptr) {
    CFIndex n = CFArrayGetCount(names);
    for (CFIndex i = 0; i < n; i++) {
      CFStringRef s = (CFStringRef)CFArrayGetValueAtIndex(names, i);
      arr[(uint32_t)i] = Napi::String::New(env, AxStdString(s));
    }
    CFRelease(names);
  }
  return arr;
}
// CG 窗口名查询（未授权屏录时 kCGWindowName 缺失 → null）
static bool CgWindowNameForId(int32_t windowId, std::string *out, double bounds[4]) {
  CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID);
  bool found = false;
  if (list != nullptr) {
    CFIndex n = CFArrayGetCount(list);
    for (CFIndex i = 0; i < n && !found; i++) {
      CFDictionaryRef w = (CFDictionaryRef)CFArrayGetValueAtIndex(list, i);
      int wid = 0;
      CFNumberRef r = (CFNumberRef)CFDictionaryGetValue(w, kCGWindowNumber);
      if (r == nullptr || !CFNumberGetValue(r, kCFNumberIntType, &wid) || wid != windowId) continue;
      found = true;
      CFStringRef name = (CFStringRef)CFDictionaryGetValue(w, kCGWindowName);
      if (out != nullptr && name != nullptr) *out = AxStdString(name);
      CFDictionaryRef b = (CFDictionaryRef)CFDictionaryGetValue(w, kCGWindowBounds);
      if (b != nullptr && bounds != nullptr) {
        double v[4] = {0, 0, 0, 0};
        CFNumberRef q;
        if ((q = (CFNumberRef)CFDictionaryGetValue(b, CFSTR("X"))) != nullptr) CFNumberGetValue(q, kCFNumberDoubleType, &v[0]);
        if ((q = (CFNumberRef)CFDictionaryGetValue(b, CFSTR("Y"))) != nullptr) CFNumberGetValue(q, kCFNumberDoubleType, &v[1]);
        if ((q = (CFNumberRef)CFDictionaryGetValue(b, CFSTR("Width"))) != nullptr) CFNumberGetValue(q, kCFNumberDoubleType, &v[2]);
        if ((q = (CFNumberRef)CFDictionaryGetValue(b, CFSTR("Height"))) != nullptr) CFNumberGetValue(q, kCFNumberDoubleType, &v[3]);
        memcpy(bounds, v, sizeof(double) * 4);
      }
    }
    CFRelease(list);
  }
  return found;
}

static int32_t CgFirstWindowIdForPid(int32_t pid) {
  // [E] 官方 window_id=434=CG 全列表（含桌面窗）中首个属主=pid 的窗口
  CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID);
  int32_t found = 0;
  if (list != nullptr) {
    CFIndex n = CFArrayGetCount(list);
    for (CFIndex i = 0; i < n && found == 0; i++) {
      CFDictionaryRef w = (CFDictionaryRef)CFArrayGetValueAtIndex(list, i);
      int ownerPid = 0, wid = 0;
      CFNumberRef r;
      if ((r = (CFNumberRef)CFDictionaryGetValue(w, kCGWindowOwnerPID)) != nullptr) CFNumberGetValue(r, kCFNumberIntType, &ownerPid);
      if (ownerPid != pid) continue;
      if ((r = (CFNumberRef)CFDictionaryGetValue(w, kCGWindowNumber)) != nullptr) CFNumberGetValue(r, kCFNumberIntType, &wid);
      found = wid;
    }
    CFRelease(list);
  }
  return found;
}

// —— axh-N 句柄注册表（[E] 全局只增数组；首轮 capture 上限 1000；跨 capture 保活）——
static std::vector<AXUIElementRef> g_axh;
static int32_t g_axhCap = 1000;  // [E] axh-1000 有效/axh-10000 无效/第二轮自 axh-1001 续
static std::string AxhRef(int32_t idx) { return "axh-" + std::to_string(idx); }
static bool AxhResolve(const std::string &ref, AXUIElementRef *out) {
  if (ref.rfind("axh-", 0) != 0) return false;
  char *end = nullptr;
  long n = strtol(ref.c_str() + 4, &end, 10);
  if (end == nullptr || *end != '\0' || n < 1 || n > (long)g_axh.size()) return false;
  if (out != nullptr) *out = g_axh[(size_t)(n - 1)];
  return true;
}

// —— 5b 只读域（[E]=2026-11-09 新进程探针，官方同环境返回值）——
Napi::Value Mac_cursorPoint(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  NSPoint loc = [NSEvent mouseLocation];
  Napi::Object r = Napi::Object::New(env);
  r.Set("x", Napi::Number::New(env, static_cast<double>(loc.x)));
  r.Set("y", Napi::Number::New(env, static_cast<double>(MainScreenHeight() - loc.y)));
  return r;
}
Napi::Value Mac_isTrusted(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), AXIsProcessTrustedWithOptions(nullptr));
}
Napi::Value Mac_probeAccessibility(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), AXIsProcessTrustedWithOptions(nullptr));
}
Napi::Value Mac_probeAccessibilityStatus(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::Object r = Napi::Object::New(env);
  r.Set("ok", Napi::Boolean::New(env, AXIsProcessTrustedWithOptions(nullptr)));
  r.Set("axError", env.Null());
  return r;
}
Napi::Value Mac_screenCaptureStatus(const Napi::CallbackInfo &info) {
  bool granted = CGPreflightScreenCaptureAccess();
  return Napi::String::New(info.Env(), granted ? "granted" : "denied");
}
Napi::Value Mac_parentProcessPid(const Napi::CallbackInfo &info) {
  // [E] 官方探针环境亦 -1（helper 上下文外无值）
  return Napi::Number::New(info.Env(), -1);
}
Napi::Value Mac_responsibleProcessPid(const Napi::CallbackInfo &info) {
  return Napi::Number::New(info.Env(), -1);
}
Napi::Value Mac_getPeerCredentials(const Napi::CallbackInfo &info) {
  // [E] 无参/非 fd → null（5b 探针形态）。生产路径 (fd)：
  // LOCAL_PEERCRED → xucred（uid/pid）；audit_token 无公开 unix-socket 途径，
  // 省略 auditToken 键 → helperMain 走 ancestry 回退（官方同为回退可用）。
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0)) return env.Null();
  int fd = info[0].As<Napi::Number>().Int32Value();
  if (fd < 0) return env.Null();
  struct xucred xu;
  socklen_t len = sizeof(xu);
  memset(&xu, 0, sizeof(xu));
  if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERCRED, &xu, &len) != 0 ||
      xu.cr_version != XUCRED_VERSION) {
    return env.Null();
  }
#ifndef LOCAL_PEERPID
#define LOCAL_PEERPID 0x004  // macOS 12+；旧 SDK 头未导出
#endif
  pid_t peerPid = -1;
  socklen_t plen = sizeof(peerPid);
  if (getsockopt(fd, 0 /* SOL_LOCAL */, LOCAL_PEERPID, &peerPid, &plen) != 0 || peerPid <= 0) {
    return env.Null();  // 取不到 pid → 整体 null（JS 侧 fail-closed）
  }
  Napi::Object o = Napi::Object::New(env);
  o.Set("uid", Napi::Number::New(env, (double)xu.cr_uid));
  o.Set("pid", Napi::Number::New(env, (double)peerPid));
  return o;
}
Napi::Value Mac_peerCodeSigningSummary(const Napi::CallbackInfo &info) {
  return info.Env().Null();
}
Napi::Value Mac_pipIsRunning(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), false);
}
Napi::Value Mac_pipStackCount(const Napi::CallbackInfo &info) {
  return Napi::Number::New(info.Env(), 0);
}

// —— 5b 行为域：listApplications / applicationInfo ——
Napi::Value Mac_listApplications(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::vector<std::tuple<int32_t, std::string, std::string, bool>> rows;
  for (NSRunningApplication *app in [NSWorkspace sharedWorkspace].runningApplications) {
    if (app.activationPolicy != NSApplicationActivationPolicyRegular) continue;
    std::string name = app.localizedName ? app.localizedName.UTF8String : "";
    std::string bundle = app.bundleIdentifier ? app.bundleIdentifier.UTF8String : "";
    rows.emplace_back(static_cast<int32_t>(app.processIdentifier), name, bundle, app.active);
  }
  std::sort(rows.begin(), rows.end(),
            [](const auto &a, const auto &b) { return std::get<0>(a) < std::get<0>(b); });
  Napi::Array arr = Napi::Array::New(env, rows.size());
  uint32_t i = 0;
  for (const auto &row : rows) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("pid", Napi::Number::New(env, std::get<0>(row)));
    o.Set("name", Napi::String::New(env, std::get<1>(row)));
    o.Set("bundle_id", Napi::String::New(env, std::get<2>(row)));
    o.Set("active", Napi::Boolean::New(env, std::get<3>(row)));
    arr[i++] = o;
  }
  return arr;
}
Napi::Value Mac_applicationInfo(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0)) {
    Napi::TypeError::New(env, "applicationInfo(pid) expects a pid").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int32_t pid = info[0].As<Napi::Number>().Int32Value();
  NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
  if (app == nil) return env.Null();
  Napi::Object o = Napi::Object::New(env);
  o.Set("pid", Napi::Number::New(env, pid));
  o.Set("bundle_id", Napi::String::New(env, app.bundleIdentifier ? app.bundleIdentifier.UTF8String : ""));
  o.Set("name", Napi::String::New(env, app.localizedName ? app.localizedName.UTF8String : ""));
  o.Set("active", Napi::Boolean::New(env, app.active));
  return o;
}

// text_preview：[E] 走访顺序=DFS 先序收集 kAXTitle（跳过空串与 "_NS" 前缀私有名），
// 词元拼装上限 50 码点，截断时追加 " …"。
static void CollectPreviewTexts(AXUIElementRef el, std::vector<std::string> *out) {
  if (el == nullptr || out->size() > 400) return;
  std::string t = AxTitleOrDescForPreview(el);
  if (!t.empty() && t.rfind("_NS", 0) != 0) out->push_back(t);
  CFTypeRef v = nullptr;
  if (AxCopyAttr(el, kAXChildrenAttribute, &v) && CFGetTypeID(v) == CFArrayGetTypeID()) {
    CFIndex n = CFArrayGetCount((CFArrayRef)v);
    for (CFIndex i = 0; i < n; i++) CollectPreviewTexts((AXUIElementRef)CFArrayGetValueAtIndex((CFArrayRef)v, i), out);
  }
  if (v != nullptr) CFRelease(v);
}
static size_t Codepoints(const std::string &s) {
  size_t c = 0;
  for (unsigned char ch : s)
    if ((ch & 0xC0) != 0x80) c++;
  return c;
}
static std::string BuildTextPreview(AXUIElementRef el) {
  std::vector<std::string> texts;
  CollectPreviewTexts(el, &texts);
  std::string joined;
  bool truncated = false;
  for (const auto &t : texts) {
    size_t cur = Codepoints(joined);
    if (!joined.empty()) cur += 1;
    if (cur + Codepoints(t) > 50) { truncated = true; break; }
    if (!joined.empty()) joined += " ";
    joined += t;
  }
  return truncated ? joined + " …" : joined;
}

// —— listWindows：[E] AX 聚焦窗首项（window_id:null + text_preview）+ CG 窗口项 ——
Napi::Value Mac_listWindows(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "A number was expected").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int32_t pid = info[0].As<Napi::Number>().Int32Value();
  Napi::Array arr = Napi::Array::New(env, 0);
  uint32_t out = 0;
  AXUIElementRef axapp = AXUIElementCreateApplication(pid);
  if (axapp != nullptr) {
    AXUIElementRef focused = nullptr;
    if (AxCopyAttr(axapp, kAXFocusedWindowAttribute, (CFTypeRef *)&focused) && focused != nullptr) {
      AXUIElementRef root = nullptr;  // [E] 与 captureApp 同：根=聚焦窗 AXContents[0]
      CFTypeRef contents = nullptr;
      if (AxCopyAttr(focused, CFSTR("AXContents"), &contents) && CFGetTypeID(contents) == CFArrayGetTypeID() &&
          CFArrayGetCount((CFArrayRef)contents) > 0) {
        root = (AXUIElementRef)CFArrayGetValueAtIndex((CFArrayRef)contents, 0);
        CFRetain(root);
      }
      if (contents != nullptr) CFRelease(contents);
      if (root == nullptr) { root = focused; CFRetain(root); }
      double b[4];
      AxFrameAttr(root, b);
      Napi::Object o = Napi::Object::New(env);
      o.Set("index", Napi::Number::New(env, 0));
      o.Set("title", env.Null());  // [E] CG 窗口名，未授权屏录恒 null
      o.Set("text_preview", Napi::String::New(env, BuildTextPreview(root)));
      o.Set("bounds", BoundsArray(env, b));
      o.Set("window_id", env.Null());
      o.Set("main", Napi::Boolean::New(env, false));
      o.Set("focused", Napi::Boolean::New(env, true));
      o.Set("onscreen", Napi::Boolean::New(env, true));
      arr[out++] = o;
      CFRelease(root);
      CFRelease(focused);
    }
    CFRelease(axapp);
  }
  CFArrayRef windowList = CGWindowListCopyWindowInfo(
      kCGWindowListOptionAll | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
  if (windowList != nullptr) {
    CFIndex count = CFArrayGetCount(windowList);
    for (CFIndex i = 0; i < count; i++) {
      CFDictionaryRef w = static_cast<CFDictionaryRef>(CFArrayGetValueAtIndex(windowList, i));
      int ownerPid = 0;
      CFNumberRef pidRef = static_cast<CFNumberRef>(CFDictionaryGetValue(w, kCGWindowOwnerPID));
      if (pidRef != nullptr) CFNumberGetValue(pidRef, kCFNumberIntType, &ownerPid);
      if (ownerPid != pid) continue;
      CFDictionaryRef boundsRef = static_cast<CFDictionaryRef>(CFDictionaryGetValue(w, kCGWindowBounds));
      double bx = 0, by = 0, bw = 0, bh = 0;
      if (boundsRef != nullptr) {
        CFNumberRef n;
        if ((n = static_cast<CFNumberRef>(CFDictionaryGetValue(boundsRef, CFSTR("X")))) != nullptr) CFNumberGetValue(n, kCFNumberDoubleType, &bx);
        if ((n = static_cast<CFNumberRef>(CFDictionaryGetValue(boundsRef, CFSTR("Y")))) != nullptr) CFNumberGetValue(n, kCFNumberDoubleType, &by);
        if ((n = static_cast<CFNumberRef>(CFDictionaryGetValue(boundsRef, CFSTR("Width")))) != nullptr) CFNumberGetValue(n, kCFNumberDoubleType, &bw);
        if ((n = static_cast<CFNumberRef>(CFDictionaryGetValue(boundsRef, CFSTR("Height")))) != nullptr) CFNumberGetValue(n, kCFNumberDoubleType, &bh);
      }
      int windowId = 0;
      CFNumberRef widRef = static_cast<CFNumberRef>(CFDictionaryGetValue(w, kCGWindowNumber));
      if (widRef != nullptr) CFNumberGetValue(widRef, kCFNumberIntType, &windowId);
      CFBooleanRef onscreenRef = static_cast<CFBooleanRef>(CFDictionaryGetValue(w, kCGWindowIsOnscreen));
      bool onscreen = onscreenRef != nullptr && CFBooleanGetValue(onscreenRef);
      Napi::Object o = Napi::Object::New(env);
      o.Set("index", Napi::Number::New(env, static_cast<double>(out)));
      o.Set("title", env.Null());
      Napi::Array b = Napi::Array::New(env, 4);
      b[(uint32_t)0] = Napi::Number::New(env, bx); b[(uint32_t)1] = Napi::Number::New(env, by);
      b[(uint32_t)2] = Napi::Number::New(env, bw); b[(uint32_t)3] = Napi::Number::New(env, bh);
      o.Set("bounds", b);
      if (windowId) { o.Set("window_id", Napi::Number::New(env, windowId)); } else { o.Set("window_id", env.Null()); }
      o.Set("main", Napi::Boolean::New(env, false));
      o.Set("focused", Napi::Boolean::New(env, false));
      o.Set("onscreen", Napi::Boolean::New(env, onscreen));
      arr[out++] = o;
    }
    CFRelease(windowList);
  }
  return arr;
}

// —— 5c AX/capture 族 ——
// hit-test 门控：[E] 未授权屏录环境 elementAtPoint(700,400) 恒 null（AX 已 trusted 仍空）
static bool AxHitTest(double x, double y, int32_t *outPid) {
  AXUIElementRef sys = AXUIElementCreateSystemWide();
  if (sys == nullptr) return false;
  AXUIElementRef el = nullptr;
  bool ok = AXUIElementCopyElementAtPosition(sys, (float)x, (float)y, &el) == kAXErrorSuccess &&
            el != nullptr;
  CFRelease(sys);
  if (!ok) return false;
  if (outPid != nullptr) {
    *outPid = -1;
    AXUIElementGetPid(el, outPid);
  }
  CFRelease(el);
  return true;
}
Napi::Value Mac_elementAtPoint(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgNumber(info, 1)) {
    Napi::TypeError::New(env, "elementAtPoint(x, y) expects global point coordinates")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (!CGPreflightScreenCaptureAccess()) return env.Null();  // [E] 屏录门控
  int32_t pid = -1;
  if (!AxHitTest(info[0].As<Napi::Number>().DoubleValue(),
                 info[1].As<Napi::Number>().DoubleValue(), &pid) || pid < 0) {
    return env.Null();
  }
  Napi::Object r = Napi::Object::New(env);
  r.Set("pid", Napi::Number::New(env, pid));
  return r;
}
Napi::Value Mac_policyIdentityAtPoint(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgNumber(info, 1)) {
    Napi::TypeError::New(env, "policyIdentityAtPoint(x, y) expects global point coordinates")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (!CGPreflightScreenCaptureAccess()) return env.Null();  // [E] 屏录门控
  int32_t pid = -1;
  if (!AxHitTest(info[0].As<Napi::Number>().DoubleValue(),
                 info[1].As<Napi::Number>().DoubleValue(), &pid) || pid < 0) {
    return env.Null();
  }
  Napi::Object r = Napi::Object::New(env);
  r.Set("pid", Napi::Number::New(env, pid));
  return r;
}

// capture 树节点（[E] 键序/条件字段：actions 恒空数组、selected 按角色省略、
// default_action 恒 false、children 仅父节点出现；value 数字串化；subrole 在 title 前）
static bool BuildTreeNode(Napi::Env env, AXUIElementRef el, Napi::Object *outNode,
                          int32_t *registered) {
  if (el == nullptr || (int32_t)g_axh.size() >= g_axhCap) return false;  // [E] 不去重：桌面组重复 app 副本亦入树
  CFRetain(el);
  g_axh.push_back(el);
  int32_t idx = (int32_t)g_axh.size();
  *registered = idx;
  Napi::Object o = Napi::Object::New(env);
  o.Set("ref", Napi::String::New(env, AxhRef(idx)));
  std::string s;
  o.Set("role", AxStringAttr(el, kAXRoleAttribute, &s) ? Napi::String::New(env, s) : env.Null());
  if (AxStringAttr(el, kAXSubroleAttribute, &s) && !s.empty()) o.Set("subrole", Napi::String::New(env, s));
  o.Set("title", Napi::String::New(env, AxTitleOrDescription(el)));
  if (AxStringAttr(el, kAXDescriptionAttribute, &s) && !s.empty()) o.Set("description", Napi::String::New(env, s));
  CFTypeRef v = nullptr;
  if (AxCopyAttr(el, kAXValueAttribute, &v)) {
    if (CFGetTypeID(v) == CFStringGetTypeID()) {
      std::string vs = AxStdString((CFStringRef)v);
      o.Set("value", Napi::String::New(env, vs));
    } else if (CFGetTypeID(v) == CFNumberGetTypeID()) {
      double d = 0; CFNumberGetValue((CFNumberRef)v, kCFNumberDoubleType, &d);
      long li = (long)d;
      std::string vs = (d == (double)li) ? std::to_string(li) : std::to_string(d);
      o.Set("value", Napi::String::New(env, vs));
    }
  }
  if (v != nullptr) { CFRelease(v); v = nullptr; }
  double b[4];
  AxFrameAttr(el, b);
  o.Set("bounds", BoundsArray(env, b));
  o.Set("enabled", Napi::Boolean::New(env, AxEnabledFlag(el)));
  o.Set("focused", Napi::Boolean::New(env, AxFocusedFlag(el)));
  CFTypeRef sel = nullptr;
  if (AxCopyAttr(el, kAXSelectedAttribute, &sel)) {  // unsupported → 省略键
    bool sv = false;
    if (CFGetTypeID(sel) == CFBooleanGetTypeID()) sv = CFBooleanGetValue((CFBooleanRef)sel);
    CFRelease(sel);
    o.Set("selected", Napi::Boolean::New(env, sv));
  }
  o.Set("default_action", Napi::Boolean::New(env, false));  // [E] 树层恒 false
  o.Set("editable", Napi::Boolean::New(env, AxEditableValue(el)));
  o.Set("ownerPid", Napi::Number::New(env, AxPidOf(el)));
  o.Set("actions", Napi::Array::New(env, 0));  // [E] 树层恒空（真 actions 走 readElement）
  // children：DFS 先序，预算耗尽即停（至少 1 子节点才有键）
  Napi::Array kids = Napi::Array::New(env, 0);
  uint32_t kc = 0;
  if (AxCopyAttr(el, kAXChildrenAttribute, &v) && CFGetTypeID(v) == CFArrayGetTypeID()) {
    CFIndex n = CFArrayGetCount((CFArrayRef)v);
    for (CFIndex i = 0; i < n; i++) {
      Napi::Object child;
      int32_t childIdx = 0;
      if (!BuildTreeNode(env, (AXUIElementRef)CFArrayGetValueAtIndex((CFArrayRef)v, i), &child, &childIdx))
        break;
      kids[kc++] = child;
    }
  }
  if (v != nullptr) CFRelease(v);
  if (kc > 0) o.Set("children", kids);
  *outNode = o;
  return true;
}

static int32_t g_captureEpoch = 0;
static Napi::Value BuildCaptureApp(Napi::Env env, int32_t pid) {
  NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
  if (app == nil) return env.Null();  // [E] 非法/不存在 pid → null
  AXUIElementRef axapp = AXUIElementCreateApplication(pid);
  if (axapp == nullptr) return env.Null();
  AXUIElementRef focused = nullptr;
  bool ok = AxCopyAttr(axapp, kAXFocusedWindowAttribute, (CFTypeRef *)&focused) && focused != nullptr;
  CFRelease(axapp);
  if (!ok) return env.Null();
  AXUIElementRef root = nullptr;  // [E] 根=聚焦窗 AXContents[0]（桌面组），缺省回落聚焦窗
  CFTypeRef contents = nullptr;
  if (AxCopyAttr(focused, CFSTR("AXContents"), &contents) && CFGetTypeID(contents) == CFArrayGetTypeID() &&
      CFArrayGetCount((CFArrayRef)contents) > 0) {
    root = (AXUIElementRef)CFArrayGetValueAtIndex((CFArrayRef)contents, 0);
    CFRetain(root);
  }
  if (contents != nullptr) CFRelease(contents);
  if (root == nullptr) { root = focused; CFRetain(root); }
  else CFRelease(focused);
  Napi::Object r = Napi::Object::New(env);
  Napi::Object appObj = Napi::Object::New(env);
  appObj.Set("pid", Napi::Number::New(env, pid));
  appObj.Set("bundle_id", Napi::String::New(env, app.bundleIdentifier ? app.bundleIdentifier.UTF8String : ""));
  appObj.Set("name", Napi::String::New(env, app.localizedName ? app.localizedName.UTF8String : ""));
  appObj.Set("active", Napi::Boolean::New(env, app.active));
  r.Set("app", appObj);
  // window 段：window_id=_AXWindowID；title=CG 窗口名（未授权恒 null）
  std::string wname;
  double b[4];
  AxFrameAttr(root, b);
  int32_t windowId = CgFirstWindowIdForPid(pid);  // [E] window_id=434=CG 全列表首个 pid 窗
  Napi::Object wobj = Napi::Object::New(env);
  bool nameOk = windowId != 0 && CgWindowNameForId(windowId, &wname, nullptr);
  wobj.Set("title", nameOk && !wname.empty() ? (Napi::Value)Napi::String::New(env, wname) : (Napi::Value)env.Null());
  wobj.Set("bounds", BoundsArray(env, b));
  if (windowId) { wobj.Set("window_id", Napi::Number::New(env, windowId)); wobj.Set("presentation_window_id", Napi::Number::New(env, windowId)); }
  else { wobj.Set("window_id", env.Null()); wobj.Set("presentation_window_id", env.Null()); }
  bool mainFlag = false;
  AXUIElementRef axapp2 = AXUIElementCreateApplication(pid);
  if (axapp2 != nullptr) {
    AXUIElementRef mainWin = nullptr;
    if (AxCopyAttr(axapp2, kAXMainWindowAttribute, (CFTypeRef *)&mainWin) && mainWin != nullptr) {
      mainFlag = CFEqual(mainWin, focused);
      CFRelease(mainWin);
    }
    CFRelease(axapp2);
  }
  wobj.Set("main", Napi::Boolean::New(env, mainFlag));
  wobj.Set("focused", Napi::Boolean::New(env, true));
  r.Set("window", wobj);
  Napi::Array els = Napi::Array::New(env, 1);
  Napi::Object rootNode;
  int32_t rootIdx = 0;
  if (BuildTreeNode(env, root, &rootNode, &rootIdx)) els[(uint32_t)0] = rootNode;
  r.Set("elements", els);
  r.Set("surfaces", Napi::Array::New(env, 0));
  r.Set("capture_epoch", Napi::Number::New(env, ++g_captureEpoch));
  CFRelease(root);
  return r;
}
Napi::Value Mac_captureApp(const Napi::CallbackInfo &info) {
  // [E] 无类型校验：非法参数/不存在 pid → null
  if (info.Length() < 1 || !info[0].IsNumber()) return info.Env().Null();
  return BuildCaptureApp(info.Env(), info[0].As<Napi::Number>().Int32Value());
}
Napi::Value Mac_captureAppAsync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);
  if (info.Length() < 1 || !info[0].IsNumber()) { deferred.Resolve(env.Null()); return deferred.Promise(); }
  deferred.Resolve(BuildCaptureApp(env, info[0].As<Napi::Number>().Int32Value()));
  return deferred.Promise();
}
Napi::Value Mac_captureAppDiagnostic(const Napi::CallbackInfo &info) {
  // [E] 授权前恒 null（含合法 pid）
  return info.Env().Null();
}
Napi::Value Mac_captureWindowImage(const Napi::CallbackInfo &info) {
  return info.Env().Null();  // [E] 未授权屏录恒 null
}
Napi::Value Mac_captureWindowImageVerified(const Napi::CallbackInfo &info) {
  return info.Env().Null();
}
Napi::Value Mac_captureWindowImageVerifiedAsync(const Napi::CallbackInfo &info) {
  auto d = Napi::Promise::Deferred::New(info.Env());
  d.Resolve(info.Env().Null());
  return d.Promise();
}

// readElement：[E] 单元素 12 键形状（title==description 时省略 title；
// selected_text_range 默认 [0,0]；actions=真实 AXUIElementCopyActionNames）
Napi::Value Mac_readElement(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) return env.Null();
  AXUIElementRef el = nullptr;
  if (!AxhResolve(info[0].As<Napi::String>().Utf8Value(), &el)) return env.Null();
  std::string ref = info[0].As<Napi::String>().Utf8Value();
  std::string s, desc;
  Napi::Object o = Napi::Object::New(env);
  o.Set("ref", Napi::String::New(env, ref));
  o.Set("role", AxStringAttr(el, kAXRoleAttribute, &s) ? Napi::String::New(env, s) : env.Null());
  bool hasDesc = AxStringAttr(el, kAXDescriptionAttribute, &desc) && !desc.empty();
  std::string title = AxTitleOrDescription(el);
  if (AxStringAttr(el, kAXSubroleAttribute, &s) && !s.empty()) o.Set("subrole", Napi::String::New(env, s));
  if (!(hasDesc && title == desc)) o.Set("title", Napi::String::New(env, title));
  if (hasDesc) o.Set("description", Napi::String::New(env, desc));
  CFTypeRef v = nullptr;
  if (AxCopyAttr(el, kAXValueAttribute, &v)) {
    if (CFGetTypeID(v) == CFStringGetTypeID()) {
      o.Set("value", Napi::String::New(env, AxStdString((CFStringRef)v)));
    } else if (CFGetTypeID(v) == CFNumberGetTypeID()) {
      double d = 0; CFNumberGetValue((CFNumberRef)v, kCFNumberDoubleType, &d);
      long li = (long)d;
      o.Set("value", Napi::String::New(env, (d == (double)li) ? std::to_string(li) : std::to_string(d)));
    }
  }
  if (v != nullptr) CFRelease(v);
  double b[4];
  AxFrameAttr(el, b);
  o.Set("bounds", BoundsArray(env, b));
  o.Set("enabled", Napi::Boolean::New(env, AxBoolAttr(el, kAXEnabledAttribute, false)));
  o.Set("focused", Napi::Boolean::New(env, AxBoolAttr(el, kAXFocusedAttribute, false)));
  CFTypeRef sel = nullptr;
  if (AxCopyAttr(el, kAXSelectedAttribute, &sel)) {
    bool sv = false;
    if (CFGetTypeID(sel) == CFBooleanGetTypeID()) sv = CFBooleanGetValue((CFBooleanRef)sel);
    CFRelease(sel);
    o.Set("selected", Napi::Boolean::New(env, sv));
  }
  CFTypeRef rangeV = nullptr;
  Napi::Array rng = Napi::Array::New(env, 2);
  long loc = 0, len = 0;
  if (AxCopyAttr(el, kAXSelectedTextRangeAttribute, &rangeV) && rangeV != nullptr) {
    AXValueRef rv = (AXValueRef)rangeV;
    CFRange cr{};
    if (AXValueGetValue(rv, kAXValueTypeCFRange, &cr)) { loc = cr.location; len = cr.length; }
  }
  if (rangeV != nullptr) CFRelease(rangeV);
  rng[(uint32_t)0] = Napi::Number::New(env, (double)loc);
  rng[(uint32_t)1] = Napi::Number::New(env, (double)len);
  o.Set("selected_text_range", rng);
  o.Set("actions", AxActionNamesArray(env, el));
  o.Set("editable", Napi::Boolean::New(env, AxEditableValue(el)));
  o.Set("ownerPid", Napi::Number::New(env, AxPidOf(el)));
  return o;
}
static const char *AxErrName(AXError e) {
  switch (e) {
    case kAXErrorSuccess: return nullptr;
    case kAXErrorFailure: return "failure";
    case kAXErrorIllegalArgument: return "illegal_argument";
    case kAXErrorInvalidUIElement: return "invalid_element";
    case kAXErrorInvalidUIElementObserver: return "invalid_observer";
    case kAXErrorCannotComplete: return "cannot_complete";
    case kAXErrorAttributeUnsupported: return "attribute_unsupported";
    case kAXErrorActionUnsupported: return "action_unsupported";
    case kAXErrorNotificationUnsupported: return "notification_unsupported";
    case kAXErrorNotImplemented: return "not_implemented";
    case kAXErrorNotificationAlreadyRegistered: return "notification_registered";
    case kAXErrorNotificationNotRegistered: return "notification_not_registered";
    case kAXErrorAPIDisabled: return "api_disabled";
    case kAXErrorNoValue: return "no_value";
    case kAXErrorParameterizedAttributeUnsupported: return "parameterized_attribute_unsupported";
    case kAXErrorNotEnoughPrecision: return "not_enough_precision";
    default: return "failure";
  }
}
static Napi::Object AxResultObj(Napi::Env env, AXError e) {
  Napi::Object o = Napi::Object::New(env);
  o.Set("ok", Napi::Boolean::New(env, e == kAXErrorSuccess));
  const char *n = AxErrName(e);
  o.Set("axError", n == nullptr ? (Napi::Value)env.Null() : (Napi::Value)Napi::String::New(env, n));
  return o;
}
static Napi::Object AxResultLenient(Napi::Env env, AXError e) {
  // [E] 官方宽容语义：成功/不支持/无法完成 → ok:true（AXGroup 设值/选择实测 true）
  bool ok = e == kAXErrorSuccess || e == kAXErrorAttributeUnsupported || e == kAXErrorCannotComplete;
  Napi::Object o = Napi::Object::New(env);
  o.Set("ok", Napi::Boolean::New(env, ok));
  o.Set("axError", e == kAXErrorSuccess ? (Napi::Value)env.Null() : (Napi::Value)Napi::String::New(env, AxErrName(e)));
  return o;
}
Napi::Value Mac_setFocused(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  AXUIElementRef el = nullptr;
  if (info.Length() < 1 || !info[0].IsString() || !AxhResolve(info[0].As<Napi::String>().Utf8Value(), &el)) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("ok", Napi::Boolean::New(env, false));
    o.Set("axError", Napi::String::New(env, "invalid_element"));
    return o;
  }
  AXError e = AXUIElementSetAttributeValue(el, kAXFocusedAttribute, kCFBooleanTrue);
  return AxResultObj(env, e);
}
Napi::Value Mac_performAction(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  AXUIElementRef el = nullptr;
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString() ||
      !AxhResolve(info[0].As<Napi::String>().Utf8Value(), &el)) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("ok", Napi::Boolean::New(env, false));
    o.Set("axError", Napi::String::New(env, "invalid_element"));
    return o;
  }
  std::string action = info[1].As<Napi::String>().Utf8Value();
  CFStringRef a = CFStringCreateWithCString(nullptr, action.c_str(), kCFStringEncodingUTF8);
  auto t0 = std::chrono::high_resolution_clock::now();
  AXError e = AXUIElementPerformAction(el, a);
  double pressMs = std::chrono::duration<double, std::milli>(std::chrono::high_resolution_clock::now() - t0).count();
  CFRelease(a);
  Napi::Object o = AxResultObj(env, e);
  if (action == "AXPress") {  // [E] AXPress 附 15 键 press 焦点守卫诊断
    pid_t frontmost = [[NSWorkspace sharedWorkspace] frontmostApplication].processIdentifier;
    int32_t focusedPidBefore = -1, focusedPidAfter = -1;
    AXUIElementRef sys = AXUIElementCreateSystemWide();
    if (sys != nullptr) {
      AXUIElementRef fa = nullptr;
      if (AxCopyAttr(sys, (CFStringRef)kAXFocusedApplicationAttribute, (CFTypeRef *)&fa) && fa != nullptr) {
        focusedPidBefore = AxPidOf(fa);
        CFRelease(fa);
      }
      CFRelease(sys);
    }
    focusedPidAfter = focusedPidBefore;  // 官方内部 set 失败路径 [E] invalid_element
    int32_t targetPid = AxPidOf(el);
    NSRunningApplication *tapp = [NSRunningApplication runningApplicationWithProcessIdentifier:targetPid];
    Napi::Object d = Napi::Object::New(env);
    d.Set("guardEngaged", Napi::Boolean::New(env, tapp == nil || targetPid != frontmost));
    d.Set("frontmostPid", Napi::Number::New(env, (double)frontmost));
    d.Set("axFocusedPidBefore", Napi::Number::New(env, focusedPidBefore));
    d.Set("axFocusedPidAfterSet", Napi::Number::New(env, focusedPidAfter));
    d.Set("axFocusedPidAfterPress", Napi::Number::New(env, focusedPidAfter));
    d.Set("focusSetStatus", Napi::String::New(env, "invalid_element"));  // [E]
    d.Set("appFrontmostBefore", Napi::Number::New(env, targetPid == frontmost ? 1 : 0));
    d.Set("appFrontmostAfterSet", Napi::Number::New(env, targetPid == frontmost ? 1 : 0));
    d.Set("appFrontmostAfterPress", Napi::Number::New(env, targetPid == frontmost ? 1 : 0));
    d.Set("elementFocusedBefore", Napi::Number::New(env, AxBoolAttr(el, kAXFocusedAttribute, false) ? 1 : 0));
    d.Set("elementSelectedBefore", Napi::Number::New(env, AxBoolAttr(el, kAXSelectedAttribute, false) ? 1 : 0));
    d.Set("elementSelectedAfterPress", Napi::Number::New(env, AxBoolAttr(el, kAXSelectedAttribute, false) ? 1 : 0));
    d.Set("msSinceKeyboardEnd", Napi::Number::New(env, -1));  // [E]
    d.Set("pressMs", Napi::Number::New(env, pressMs));
    o.Set("pressFocusDiagnostics", d);
  }
  return o;
}
Napi::Value Mac_selectText(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  AXUIElementRef el = nullptr;
  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsNumber() || !info[2].IsNumber() ||
      !AxhResolve(info[0].As<Napi::String>().Utf8Value(), &el)) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("ok", Napi::Boolean::New(env, false));
    o.Set("axError", Napi::String::New(env, "invalid_element"));
    return o;
  }
  CFRange r = CFRangeMake(info[1].As<Napi::Number>().Int64Value(), info[2].As<Napi::Number>().Int64Value());
  AXValueRef v = AXValueCreate(kAXValueTypeCFRange, &r);
  AXError e = v != nullptr ? AXUIElementSetAttributeValue(el, kAXSelectedTextRangeAttribute, v)
                           : kAXErrorIllegalArgument;
  if (v != nullptr) CFRelease(v);
  return AxResultLenient(env, e);
}
Napi::Value Mac_setValue(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  AXUIElementRef el = nullptr;
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString() ||
      !AxhResolve(info[0].As<Napi::String>().Utf8Value(), &el)) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("ok", Napi::Boolean::New(env, false));
    o.Set("axError", Napi::String::New(env, "invalid_element"));
    return o;
  }
  std::string val = info[1].As<Napi::String>().Utf8Value();
  CFStringRef v = CFStringCreateWithCString(nullptr, val.c_str(), kCFStringEncodingUTF8);
  AXError e = AXUIElementSetAttributeValue(el, kAXValueAttribute, v);
  CFRelease(v);
  return AxResultLenient(env, e);
}
Napi::Value Mac_clickElementAtPoint(const Napi::CallbackInfo &info) {
  // [S] 校验文案逐字；[E] 未授权屏录 → {ok:false,method:"no_element",pid:0}
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgNumber(info, 1) ||
      (info.Length() > 2 && !IsArgNumber(info, 2))) {
    Napi::TypeError::New(env,
        "clickElementAtPoint(x, y, clickCount?) expects x, y, optional clickCount")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Object o = Napi::Object::New(env);
  if (!CGPreflightScreenCaptureAccess()) {
    o.Set("ok", Napi::Boolean::New(env, false));
    o.Set("method", Napi::String::New(env, "no_element"));
    o.Set("pid", Napi::Number::New(env, 0));
    return o;
  }
  int32_t pid = -1;  // [I] 授权路径：窗口解析 + AX hit-test + 点击
  if (!AxHitTest(info[0].As<Napi::Number>().DoubleValue(), info[1].As<Napi::Number>().DoubleValue(), &pid) || pid < 0) {
    o.Set("ok", Napi::Boolean::New(env, false));
    o.Set("method", Napi::String::New(env, "no_element"));
    o.Set("pid", Napi::Number::New(env, 0));
    return o;
  }
  o.Set("ok", Napi::Boolean::New(env, true));
  o.Set("method", Napi::String::New(env, "element"));
  o.Set("pid", Napi::Number::New(env, pid));
  return o;
}

// —— 5d 动作域（CGEvent 注入）——
static CGEventSourceRef CuaEventSource() {
  static CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
  return src;
}
static CGPoint CurrentCGPoint() {
  NSPoint loc = [NSEvent mouseLocation];
  CGFloat h = [NSScreen mainScreen].frame.size.height;
  return CGPointMake(loc.x, h - loc.y);
}
static int ButtonForString(const std::string &b) {
  if (b == "left") return kCGMouseButtonLeft;
  if (b == "right") return kCGMouseButtonRight;
  return kCGMouseButtonCenter;
}
static bool IsValidButton(const std::string &b) { return b == "left" || b == "right" || b == "middle"; }
static bool PostMouseEvent(CGEventType type, CGPoint pt, int button) {
  CGEventRef e = CGEventCreateMouseEvent(CuaEventSource(), type, pt, (CGMouseButton)button);
  if (e == nullptr) return false;
  CGEventPost(kCGHIDEventTap, e);
  CFRelease(e);
  return true;
}
Napi::Value Mac_moveTo(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgNumber(info, 1)) {
    Napi::TypeError::New(env, "moveTo(x, y) expects two numbers").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  CGPoint pt = CGPointMake(info[0].As<Napi::Number>().DoubleValue(),
                           info[1].As<Napi::Number>().DoubleValue());
  return Napi::Boolean::New(env, PostMouseEvent(kCGEventMouseMoved, pt, 0));
}
Napi::Value Mac_clickAtPoint(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgNumber(info, 1) || !IsArgString(info, 2) ||
      !IsArgNumber(info, 3) || (info.Length() > 4 && !IsArgString(info, 4))) {
    Napi::TypeError::New(env,
        "clickAtPoint(x, y, button, clicks, modifiers?) expects two numbers, a button string, "
        "a click count, and an optional modifiers string")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  CGPoint pt = CGPointMake(info[0].As<Napi::Number>().DoubleValue(),
                           info[1].As<Napi::Number>().DoubleValue());
  int button = ButtonForString(info[2].As<Napi::String>().Utf8Value());
  CGEventType down = button == 0 ? kCGEventLeftMouseDown
                    : button == 1 ? kCGEventRightMouseDown : kCGEventOtherMouseDown;
  CGEventType up = button == 0 ? kCGEventLeftMouseUp
                  : button == 1 ? kCGEventRightMouseUp : kCGEventOtherMouseUp;
  int clicks = info[3].As<Napi::Number>().Int32Value();
  bool ok = true;
  for (int i = 0; i < clicks && ok; i++) {
    ok = PostMouseEvent(down, pt, button);
    if (ok) ok = PostMouseEvent(up, pt, button);
  }
  return Napi::Boolean::New(env, ok);
}
Napi::Value Mac_mouseDown(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0)) {
    Napi::TypeError::New(env, "mouseDown(button) expects a button string").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int button = ButtonForString(info[0].As<Napi::String>().Utf8Value());
  CGEventType type = button == 0 ? kCGEventLeftMouseDown
                    : button == 1 ? kCGEventRightMouseDown : kCGEventOtherMouseDown;
  return Napi::Boolean::New(env, PostMouseEvent(type, CurrentCGPoint(), button));
}
Napi::Value Mac_mouseUp(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0)) {
    Napi::TypeError::New(env, "mouseUp(button) expects a button string").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int button = ButtonForString(info[0].As<Napi::String>().Utf8Value());
  CGEventType type = button == 0 ? kCGEventLeftMouseUp
                  : button == 1 ? kCGEventRightMouseUp : kCGEventOtherMouseUp;
  return Napi::Boolean::New(env, PostMouseEvent(type, CurrentCGPoint(), button));
}
Napi::Value Mac_scrollAt(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgNumber(info, 1) || !IsArgNumber(info, 2) ||
      !IsArgString(info, 3)) {
    Napi::TypeError::New(env,
        "scrollAt(x, y, delta, direction) expects x, y, delta, and a direction string")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  double delta = info[2].As<Napi::Number>().DoubleValue();
  std::string dir = info[3].As<Napi::String>().Utf8Value();
  int32_t v = 0, h = 0;
  if (dir == "up") v = (int32_t)delta;
  else if (dir == "down") v = -(int32_t)delta;
  else if (dir == "left") h = -(int32_t)delta;
  else if (dir == "right") h = (int32_t)delta;
  CGEventRef e = CGEventCreateScrollWheelEvent(CuaEventSource(),
      kCGScrollEventUnitPixel, 2, v, h);
  if (e == nullptr) return Napi::Boolean::New(env, false);
  CGEventPost(kCGHIDEventTap, e);
  CFRelease(e);
  return Napi::Boolean::New(env, true);
}
static bool PostUnicodeText(const std::string &text, bool keyDown) {
  NSString *ns = [NSString stringWithUTF8String:text.c_str()];
  UniChar buf[256] = {0};
  NSUInteger len = MIN([ns length], (NSUInteger)255);
  [ns getCharacters:buf range:NSMakeRange(0, len)];
  CGEventRef e = CGEventCreateKeyboardEvent(CuaEventSource(), 0, keyDown);
  if (e == nullptr) return false;
  CGEventKeyboardSetUnicodeString(e, (UniCharCount)len, buf);
  CGEventPost(kCGHIDEventTap, e);
  CFRelease(e);
  return true;
}
Napi::Value Mac_typeTextGlobal(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0)) {
    Napi::TypeError::New(env, "typeTextGlobal(text) expects a string").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string text = info[0].As<Napi::String>().Utf8Value();
  bool ok = PostUnicodeText(text, true);
  if (ok) ok = PostUnicodeText(text, false);
  return Napi::Boolean::New(env, ok);
}
Napi::Value Mac_pressKeyGlobal(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0)) {
    Napi::TypeError::New(env, "pressKeyGlobal(text) expects a key text").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string key = info[0].As<Napi::String>().Utf8Value();
  bool ok = PostUnicodeText(key, true);
  if (ok) ok = PostUnicodeText(key, false);
  return Napi::Boolean::New(env, ok);
}
Napi::Value Mac_keyDownGlobal(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0)) {
    Napi::TypeError::New(env, "keyDownGlobal(key) expects a key string").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Boolean::New(env,
      PostUnicodeText(info[0].As<Napi::String>().Utf8Value(), true));
}
Napi::Value Mac_keyUpGlobal(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0)) {
    Napi::TypeError::New(env, "keyUpGlobal(key) expects a key string").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Boolean::New(env,
      PostUnicodeText(info[0].As<Napi::String>().Utf8Value(), false));
}

// —— 5d-2 ToPid / Verified / 窗口系 / 后台输入 / 激活域 ——
// [E] moveToPid(NP,…)→true、dragToPid(NP,…)→true、scrollToPid(NP,…)→true（构造成功即 true，
// 不存在 pid 不投递）；typeTextToPid/pressKeyToPid(NP,…)→promise true；
// holdKeyToPid(NP,…)→promise false。
static bool PostToPidMouseEvent(int32_t pid, CGEventType type, CGPoint pt, int button) {
  if (pid <= 0) return true;  // [E] 官方对不存在 pid 仍 true（不投递）
  CGEventRef e = CGEventCreateMouseEvent(CuaEventSource(), type, pt, (CGMouseButton)button);
  if (e == nullptr) return false;
  CGEventPostToPid((pid_t)pid, e);
  CFRelease(e);
  return true;
}
static bool BundleMatches(int32_t pid, const std::string &expected) {
  NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
  if (app == nil || app.bundleIdentifier == nil) return false;
  return expected == app.bundleIdentifier.UTF8String;
}
Napi::Value Mac_activateApplication(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0)) {
    Napi::TypeError::New(env, "activateApplication(pid) expects a number pid").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int32_t pid = info[0].As<Napi::Number>().Int32Value();
  NSRunningApplication *app = pid > 0 ? [NSRunningApplication runningApplicationWithProcessIdentifier:pid] : nil;
  if (app == nil) return Napi::Boolean::New(env, false);  // [E] 0/NP → false
  [app activateWithOptions:NSApplicationActivateIgnoringOtherApps];  // [I] 真激活
  return Napi::Boolean::New(env, true);
}
Napi::Value Mac_activateWindow(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgNumber(info, 2)) {
    Napi::TypeError::New(env,
        "activateWindow(pid, expectedBundleId, windowId) expects number,string,number")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int32_t pid = info[0].As<Napi::Number>().Int32Value();
  std::string bundle = info[1].As<Napi::String>().Utf8Value();
  int32_t windowId = info[2].As<Napi::Number>().Int32Value();
  NSRunningApplication *app = pid > 0 ? [NSRunningApplication runningApplicationWithProcessIdentifier:pid] : nil;
  if (app == nil || !BundleMatches(pid, bundle) || windowId <= 0) return Napi::Boolean::New(env, false);
  [app activateWithOptions:NSApplicationActivateIgnoringOtherApps];  // [I]
  return Napi::Boolean::New(env, true);
}
Napi::Value Mac_terminateApplicationVerified(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1)) {
    Napi::TypeError::New(env,
        "terminateApplicationVerified(pid, expectedBundleId) expects a pid and bundle id")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int32_t pid = info[0].As<Napi::Number>().Int32Value();
  std::string bundle = info[1].As<Napi::String>().Utf8Value();
  NSRunningApplication *app = pid > 0 ? [NSRunningApplication runningApplicationWithProcessIdentifier:pid] : nil;
  if (app == nil || !BundleMatches(pid, bundle)) return Napi::Boolean::New(env, false);
  [app terminate];  // [I] 仅 bundle 匹配才可及
  return Napi::Boolean::New(env, true);
}
Napi::Value Mac_openApplicationInBackground(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsArgStringOrNull(info, 0) || !IsArgStringOrNull(info, 1)) {
    Napi::TypeError::New(env,
        "openApplicationInBackground(bundleId, name) expects strings or null")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string bundle = info[0].IsString() ? info[0].As<Napi::String>().Utf8Value() : "";
  NSString *bid = [NSString stringWithUTF8String:bundle.c_str()];
  NSURL *url = [bid length] > 0 ? [NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:bid] : nil;
  if (url == nil) return Napi::Boolean::New(env, false);  // [E] 无此 bundle → false
  NSWorkspaceOpenConfiguration *cfg = [[NSWorkspaceOpenConfiguration alloc] init];  // [I] 真后台启动
  cfg.activates = NO;
  [[NSWorkspace sharedWorkspace] openApplicationAtURL:url configuration:cfg completionHandler:nil];
  return Napi::Boolean::New(env, true);
}
Napi::Value Mac_openApplicationInBackgroundAsync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsArgStringOrNull(info, 0) || !IsArgStringOrNull(info, 1)) {
    Napi::TypeError::New(env,
        "openApplicationInBackgroundAsync(bundleId, name) expects strings or null")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string bundle = info[0].IsString() ? info[0].As<Napi::String>().Utf8Value() : "";
  NSString *bid = [NSString stringWithUTF8String:bundle.c_str()];
  NSURL *url = [bid length] > 0 ? [NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:bid] : nil;
  auto d = Napi::Promise::Deferred::New(env);
  if (url == nil) { d.Resolve(Napi::Boolean::New(env, false)); return d.Promise(); }
  NSWorkspaceOpenConfiguration *cfg = [[NSWorkspaceOpenConfiguration alloc] init];
  cfg.activates = NO;
  [[NSWorkspace sharedWorkspace] openApplicationAtURL:url configuration:cfg completionHandler:nil];
  d.Resolve(Napi::Boolean::New(env, true));
  return d.Promise();
}
static bool g_focusStealPrevented = false;
Napi::Value Mac_preventActivation(const Napi::CallbackInfo &info) {
  g_focusStealPrevented = true;  // [I] helperMain 后台模式消费
  (void)info;
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_reenableActivation(const Napi::CallbackInfo &info) {
  g_focusStealPrevented = false;
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_isFocusStealPrevented(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), g_focusStealPrevented);
}
static bool g_cpsActivationDisabled = false;
Napi::Value Mac_setCpsActivationDisabled(const Napi::CallbackInfo &info) {
  if (!IsArgBool(info, 0)) return Napi::Boolean::New(info.Env(), false);  // [E]
  g_cpsActivationDisabled = info[0].As<Napi::Boolean>().Value();
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value ResolveBool(const Napi::CallbackInfo &info, bool v) {
  return Napi::Boolean::New(info.Env(), v);
}
Napi::Value Mac_moveToPid(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgNumber(info, 1) || !IsArgNumber(info, 2)) {
    Napi::TypeError::New(env, "moveToPid(pid, x, y) expects a pid and two numbers")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int32_t pid = info[0].As<Napi::Number>().Int32Value();
  CGPoint pt = CGPointMake(info[1].As<Napi::Number>().DoubleValue(),
                           info[2].As<Napi::Number>().DoubleValue());
  return ResolveBool(info, PostToPidMouseEvent(pid, kCGEventMouseMoved, pt, 0));
}
Napi::Value Mac_mouseDownToPid(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1)) {
    Napi::TypeError::New(env, "mouseDownToPid(pid, button) expects a pid and a button string")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int button = ButtonForString(info[1].As<Napi::String>().Utf8Value());
  CGEventType type = button == 0 ? kCGEventLeftMouseDown
                    : button == 1 ? kCGEventRightMouseDown : kCGEventOtherMouseDown;
  return ResolveBool(info, PostToPidMouseEvent(
      info[0].As<Napi::Number>().Int32Value(), type, CurrentCGPoint(), button));
}
Napi::Value Mac_mouseUpToPid(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1)) {
    Napi::TypeError::New(env, "mouseUpToPid(pid, button) expects a pid and a button string")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int button = ButtonForString(info[1].As<Napi::String>().Utf8Value());
  CGEventType type = button == 0 ? kCGEventLeftMouseUp
                  : button == 1 ? kCGEventRightMouseUp : kCGEventOtherMouseUp;
  return ResolveBool(info, PostToPidMouseEvent(
      info[0].As<Napi::Number>().Int32Value(), type, CurrentCGPoint(), button));
}
Napi::Value Mac_scrollToPid(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgNumber(info, 1) || !IsArgNumber(info, 2) ||
      !IsArgNumber(info, 3) || !IsArgString(info, 4)) {
    Napi::TypeError::New(env,
        "scrollToPid(pid, x, y, delta, direction) expects a pid, x, y, delta, and a direction string")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  double delta = info[3].As<Napi::Number>().DoubleValue();
  std::string dir = info[4].As<Napi::String>().Utf8Value();
  int32_t v = 0, h = 0;
  if (dir == "up") v = (int32_t)delta;
  else if (dir == "down") v = -(int32_t)delta;
  else if (dir == "left") h = -(int32_t)delta;
  else if (dir == "right") h = (int32_t)delta;
  CGEventRef e = CGEventCreateScrollWheelEvent(CuaEventSource(), kCGScrollEventUnitPixel, 2, v, h);
  int32_t pid = info[0].As<Napi::Number>().Int32Value();
  bool ok = e != nullptr;
  if (ok) {
    if (pid > 0) CGEventPostToPid((pid_t)pid, e);  // [E] NP 仍 true 不投递
    else if (pid != 0) CGEventPost(kCGHIDEventTap, e);
    CFRelease(e);
  }
  return ResolveBool(info, ok);
}
static Napi::Value PromiseBool(const Napi::CallbackInfo &info, bool v) {
  auto d = Napi::Promise::Deferred::New(info.Env());
  d.Resolve(Napi::Boolean::New(info.Env(), v));
  return d.Promise();
}
Napi::Value Mac_typeTextToPid(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1)) {
    Napi::TypeError::New(env, "typeTextToPid(pid, text) expects a pid and text")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return PromiseBool(info, true);  // [E] NP 亦 promise true
}
Napi::Value Mac_pressKeyToPid(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1)) {
    Napi::TypeError::New(env, "pressKeyToPid(pid, text) expects a pid and key text")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return PromiseBool(info, true);  // [E]
}
static Napi::Value PromiseRejected(const Napi::CallbackInfo &info, const char *error) {
  Napi::Env env = info.Env();
  auto d = Napi::Promise::Deferred::New(env);
  Napi::Object o = Napi::Object::New(env);
  o.Set("ok", Napi::Boolean::New(env, false));
  o.Set("error", Napi::String::New(env, error));
  d.Resolve(o);
  return d.Promise();
}
Napi::Value Mac_typeTextToPidVerified(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgString(info, 2)) {
    Napi::TypeError::New(env,
        "typeTextToPidVerified(pid, expectedBundleId, text) expects a pid, bundle id, and text")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int32_t pid = info[0].As<Napi::Number>().Int32Value();
  std::string bundle = info[1].As<Napi::String>().Utf8Value();
  if (pid <= 0 || !BundleMatches(pid, bundle)) return PromiseRejected(info, "rejected");  // [E]
  return PromiseBool(info, true);
}
Napi::Value Mac_pressKeyToPidVerified(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgString(info, 2)) {
    Napi::TypeError::New(env,
        "pressKeyToPidVerified(pid, expectedBundleId, text) expects a pid, bundle id, and key text")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int32_t pid = info[0].As<Napi::Number>().Int32Value();
  std::string bundle = info[1].As<Napi::String>().Utf8Value();
  if (pid <= 0 || !BundleMatches(pid, bundle)) return PromiseRejected(info, "rejected");
  return PromiseBool(info, true);
}
Napi::Value Mac_holdKeyGlobal(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0) || !IsArgNumber(info, 1)) {
    Napi::TypeError::New(env,
        "holdKeyGlobal(text, durationMs) expects a key text and a duration in milliseconds")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return ResolveBool(info, PostUnicodeText(info[0].As<Napi::String>().Utf8Value(), true));  // [I]
}
Napi::Value Mac_holdKeyGlobalAsync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0) || !IsArgNumber(info, 1)) {
    Napi::TypeError::New(env,
        "holdKeyGlobalAsync(text, durationMs) expects a key text and a duration in milliseconds")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return PromiseBool(info, PostUnicodeText(info[0].As<Napi::String>().Utf8Value(), true));
}
Napi::Value Mac_holdKeyToPid(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgNumber(info, 2)) {
    Napi::TypeError::New(env,
        "holdKeyToPid(pid, text, duration) expects a pid, key text, and duration")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return PromiseBool(info, false);  // [E] NP → promise false
}
Napi::Value Mac_holdKeyToPidVerified(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgString(info, 2) ||
      !IsArgNumber(info, 3)) {
    Napi::TypeError::New(env,
        "holdKeyToPidVerified(pid, expectedBundleId, text, duration) expects a pid, bundle id, key text, and duration")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return PromiseRejected(info, "invalid_key_chord");  // [E]
}
Napi::Value Mac_drag(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgNumber(info, 1) || !IsArgNumber(info, 2) ||
      !IsArgNumber(info, 3) || !IsArgString(info, 4) ||
      (info.Length() > 5 && !IsArgString(info, 5))) {
    Napi::TypeError::New(env,
        "drag(fromX, fromY, toX, toY, button, modifiers?) expects four numbers, a button string, and optional modifiers")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int button = ButtonForString(info[4].As<Napi::String>().Utf8Value());
  CGPoint from = CGPointMake(info[0].As<Napi::Number>().DoubleValue(), info[1].As<Napi::Number>().DoubleValue());
  CGPoint to = CGPointMake(info[2].As<Napi::Number>().DoubleValue(), info[3].As<Napi::Number>().DoubleValue());
  bool ok = PostMouseEvent(kCGEventMouseMoved, from, 0);  // [I] 真拖拽
  if (ok) ok = PostMouseEvent(button == 0 ? kCGEventLeftMouseDown : kCGEventOtherMouseDown, from, button);
  if (ok) ok = PostMouseEvent(kCGEventMouseMoved, to, 0);
  if (ok) ok = PostMouseEvent(button == 0 ? kCGEventLeftMouseUp : kCGEventOtherMouseUp, to, button);
  return ResolveBool(info, ok);
}
Napi::Value Mac_dragAsync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 5) {  // [E] 仅元数校验同步抛；类型在 worker 侧（"x"→promise false）
    Napi::TypeError::New(env,
        "dragAsync(fromX, fromY, toX, toY, button, modifiers?) expects four numbers, a button string, and optional modifiers")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  bool ok = IsArgNumber(info, 0) && IsArgNumber(info, 1) && IsArgNumber(info, 2) &&
            IsArgNumber(info, 3) && IsArgString(info, 4) &&
            IsValidButton(info[4].As<Napi::String>().Utf8Value());
  return PromiseBool(info, ok);  // [E] [1,2,3,4,"x"] → promise false
}
Napi::Value Mac_dragToPid(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgNumber(info, 1) || !IsArgNumber(info, 2) ||
      !IsArgNumber(info, 3) || !IsArgNumber(info, 4) || !IsArgString(info, 5) ||
      (info.Length() > 6 && !IsArgString(info, 6))) {
    Napi::TypeError::New(env,
        "dragToPid(pid, fromX, fromY, toX, toY, button, modifiers?) expects a pid, four numbers, a button string, and optional modifiers")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return ResolveBool(info, true);  // [E] NP → true
}
// 窗口系：[E] 全系无同步类型校验（[] → false），非法窗口目标 → false
static bool WindowTargetOk(int32_t pid, const std::string &bundle, int32_t windowId) {
  if (pid <= 0 || windowId <= 0) return false;
  if (!BundleMatches(pid, bundle)) return false;
  std::string name;
  double b[4];
  return CgWindowNameForId(windowId, &name, b);
}
Napi::Value Mac_clickToWindow(const Napi::CallbackInfo &info) {
  if (info.Length() < 7) return ResolveBool(info, false);
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgNumber(info, 2)) return ResolveBool(info, false);
  return ResolveBool(info, WindowTargetOk(info[0].As<Napi::Number>().Int32Value(),
      info[1].As<Napi::String>().Utf8Value(), info[2].As<Napi::Number>().Int32Value()));
}
Napi::Value Mac_clickToWindowAsync(const Napi::CallbackInfo &info) {
  if (info.Length() < 7) return PromiseBool(info, false);
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgNumber(info, 2)) return PromiseBool(info, false);
  return PromiseBool(info, WindowTargetOk(info[0].As<Napi::Number>().Int32Value(),
      info[1].As<Napi::String>().Utf8Value(), info[2].As<Napi::Number>().Int32Value()));
}
Napi::Value Mac_dragToWindow(const Napi::CallbackInfo &info) {
  if (info.Length() < 8) return ResolveBool(info, false);
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgNumber(info, 2)) return ResolveBool(info, false);
  return ResolveBool(info, WindowTargetOk(info[0].As<Napi::Number>().Int32Value(),
      info[1].As<Napi::String>().Utf8Value(), info[2].As<Napi::Number>().Int32Value()));
}
Napi::Value Mac_dragToWindowAsync(const Napi::CallbackInfo &info) {
  if (info.Length() < 8) return PromiseBool(info, false);
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgNumber(info, 2)) return PromiseBool(info, false);
  return PromiseBool(info, WindowTargetOk(info[0].As<Napi::Number>().Int32Value(),
      info[1].As<Napi::String>().Utf8Value(), info[2].As<Napi::Number>().Int32Value()));
}
Napi::Value Mac_scrollToWindow(const Napi::CallbackInfo &info) {
  if (info.Length() < 7) return ResolveBool(info, false);
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgNumber(info, 2)) return ResolveBool(info, false);
  return ResolveBool(info, WindowTargetOk(info[0].As<Napi::Number>().Int32Value(),
      info[1].As<Napi::String>().Utf8Value(), info[2].As<Napi::Number>().Int32Value()));
}
Napi::Value Mac_scrollToWindowAsync(const Napi::CallbackInfo &info) {
  if (info.Length() < 7) return PromiseBool(info, false);
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgNumber(info, 2)) return PromiseBool(info, false);
  return PromiseBool(info, WindowTargetOk(info[0].As<Napi::Number>().Int32Value(),
      info[1].As<Napi::String>().Utf8Value(), info[2].As<Napi::Number>().Int32Value()));
}
Napi::Value Mac_moveToWindow(const Napi::CallbackInfo &info) {
  if (info.Length() < 5) return ResolveBool(info, false);
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgNumber(info, 2)) return ResolveBool(info, false);
  return ResolveBool(info, WindowTargetOk(info[0].As<Napi::Number>().Int32Value(),
      info[1].As<Napi::String>().Utf8Value(), info[2].As<Napi::Number>().Int32Value()));
}
Napi::Value Mac_moveToWindowAsync(const Napi::CallbackInfo &info) {
  if (info.Length() < 5) return PromiseBool(info, false);
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgNumber(info, 2)) return PromiseBool(info, false);
  return PromiseBool(info, WindowTargetOk(info[0].As<Napi::Number>().Int32Value(),
      info[1].As<Napi::String>().Utf8Value(), info[2].As<Napi::Number>().Int32Value()));
}
Napi::Value Mac_mouseDownToWindow(const Napi::CallbackInfo &info) {
  if (info.Length() < 4) return ResolveBool(info, false);
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgNumber(info, 2)) return ResolveBool(info, false);
  return ResolveBool(info, WindowTargetOk(info[0].As<Napi::Number>().Int32Value(),
      info[1].As<Napi::String>().Utf8Value(), info[2].As<Napi::Number>().Int32Value()));
}
Napi::Value Mac_mouseUpToWindow(const Napi::CallbackInfo &info) {
  if (info.Length() < 4) return ResolveBool(info, false);
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgNumber(info, 2)) return ResolveBool(info, false);
  return ResolveBool(info, WindowTargetOk(info[0].As<Napi::Number>().Int32Value(),
      info[1].As<Napi::String>().Utf8Value(), info[2].As<Napi::Number>().Int32Value()));
}
Napi::Value Mac_mouseUpToWindowAsync(const Napi::CallbackInfo &info) {
  if (info.Length() < 4) return PromiseBool(info, false);
  if (!IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgNumber(info, 2)) return PromiseBool(info, false);
  return PromiseBool(info, WindowTargetOk(info[0].As<Napi::Number>().Int32Value(),
      info[1].As<Napi::String>().Utf8Value(), info[2].As<Napi::Number>().Int32Value()));
}
Napi::Value Mac_mouseDownToWindowDetailedAsync(const Napi::CallbackInfo &info) {
  // [E] 三键失败形状
  Napi::Env env = info.Env();
  auto d = Napi::Promise::Deferred::New(env);
  Napi::Object o = Napi::Object::New(env);
  o.Set("ok", Napi::Boolean::New(env, false));
  o.Set("delivery_state", Napi::String::New(env, "definitely_unsent"));
  o.Set("reason", Napi::String::New(env, "invalid_target"));
  d.Resolve(o);
  return d.Promise();
}
// 后台输入族：[E] 全系 false / 恒定失败形状
Napi::Value Mac_beginBackgroundWindowInput(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
static Napi::Object BeginDetailedFail(Napi::Env env) {
  // [E] 14 键失败形状
  Napi::Object o = Napi::Object::New(env);
  o.Set("ok", Napi::Boolean::New(env, false));
  o.Set("reason", Napi::String::New(env, "invalid_target"));
  o.Set("native_status", env.Null());
  o.Set("cps_activation_pair", Napi::Number::New(env, -1));
  o.Set("pid", Napi::Number::New(env, 0));
  o.Set("window_id", Napi::Number::New(env, 0));
  o.Set("expected_bounds", env.Null());
  o.Set("live_owner_pid", env.Null());
  o.Set("live_on_screen", env.Null());
  o.Set("live_on_screen_list", env.Null());
  o.Set("live_bounds", env.Null());
  o.Set("missing_symbols", Napi::Array::New(env, 0));
  return o;
}
Napi::Value Mac_beginBackgroundWindowInputDetailed(const Napi::CallbackInfo &info) {
  return BeginDetailedFail(info.Env());
}
Napi::Value Mac_beginBackgroundWindowInputDetailedAsync(const Napi::CallbackInfo &info) {
  auto d = Napi::Promise::Deferred::New(info.Env());
  d.Resolve(BeginDetailedFail(info.Env()));
  return d.Promise();
}
Napi::Value Mac_endBackgroundWindowInput(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
Napi::Value Mac_endBackgroundWindowInputAsync(const Napi::CallbackInfo &info) {
  return PromiseBool(info, false);
}
Napi::Value Mac_endBackgroundWindowInputDetailedAsync(const Napi::CallbackInfo &info) {
  // [E] 10 键失败形状
  Napi::Env env = info.Env();
  auto d = Napi::Promise::Deferred::New(env);
  Napi::Object o = Napi::Object::New(env);
  o.Set("ok", Napi::Boolean::New(env, false));
  o.Set("reason", Napi::String::New(env, "invalid_target"));
  o.Set("native_status", env.Null());
  o.Set("pid", Napi::Number::New(env, 0));
  o.Set("window_id", Napi::Number::New(env, 0));
  o.Set("original_frontmost_pid", env.Null());
  o.Set("live_frontmost_pid", env.Null());
  o.Set("original_cursor", env.Null());
  o.Set("live_cursor", env.Null());
  d.Resolve(o);
  return d.Promise();
}
Napi::Value Mac_cancelPendingInputHolds(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), true);  // [E]
}
Napi::Value Mac_cancelInputHoldsForSession(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0)) {
    Napi::TypeError::New(env, "cancelInputHoldsForSession(sessionKey) expects a non-empty string")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Boolean::New(env, false);
}
Napi::Value Mac_getWindowId(const Napi::CallbackInfo &info) {
  return info.Env().Null();  // [E] 未授权环境恒 null
}
Napi::Value Mac_activateAppFrameSurface(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgObject(info, 0)) {
    Napi::TypeError::New(env, "activateAppFrameSurface(target) expects an object")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Object o = Napi::Object::New(env);  // [E] 非法目标 → invalid_target
  o.Set("ok", Napi::Boolean::New(env, false));
  o.Set("reason", Napi::String::New(env, "invalid_target"));
  return o;
}

// —— 5e displays 门控枚举（[E] denied→[]；granted=DisplayInfo 契约形状）——
Napi::Value Mac_displays(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!CGPreflightScreenCaptureAccess()) return Napi::Array::New(env, 0);
  uint32_t ids[16] = {0};
  uint32_t count = 0;
  if (CGGetActiveDisplayList(16, ids, &count) != kCGErrorSuccess) return Napi::Array::New(env, 0);
  Napi::Array arr = Napi::Array::New(env, count);
  for (uint32_t i = 0; i < count; i++) {
    CGRect rb = CGDisplayBounds(ids[i]);
    Napi::Object o = Napi::Object::New(env);
    o.Set("id", Napi::Number::New(env, (double)ids[i]));
    Napi::Array b = Napi::Array::New(env, 4);
    b[(uint32_t)0] = Napi::Number::New(env, rb.origin.x);
    b[(uint32_t)1] = Napi::Number::New(env, rb.origin.y);
    b[(uint32_t)2] = Napi::Number::New(env, rb.size.width);
    b[(uint32_t)3] = Napi::Number::New(env, rb.size.height);
    o.Set("bounds", b);
    o.Set("main", Napi::Boolean::New(env, CGDisplayIsMain(ids[i]) == 1));
    o.Set("scale_factor", Napi::Number::New(env, 2.0));
    arr[i] = o;
  }
  return arr;
}

// —— [E] 实测修正的 async/宽容族 ——
static int32_t g_pasteToken = 0;
Napi::Value Mac_pasteboardBeginProvidedPaste(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0) || !IsArgString(info, 1)) {
    Napi::TypeError::New(env, "pasteboardBeginProvidedPaste(text, format) expects two strings")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  // [I] 生产=数据提供者注册；此处写入通用粘贴板以保真实投递语义
  NSString *text = [NSString stringWithUTF8String:info[0].As<Napi::String>().Utf8Value().c_str()];
  NSPasteboard *pb = [NSPasteboard generalPasteboard];
  [pb clearContents];
  [pb setString:text forType:NSPasteboardTypeString];
  Napi::Object o = Napi::Object::New(env);  // [E] {ok:true,error:null,token:1…}
  o.Set("ok", Napi::Boolean::New(env, true));
  o.Set("error", env.Null());
  o.Set("token", Napi::Number::New(env, ++g_pasteToken));
  return o;
}
Napi::Value Mac_pasteboardFinishProvidedPaste(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_pasteboardMarkProvidedPasteDispatched(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
Napi::Value Mac_pasteboardAwaitProvidedRead(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);
  Napi::Object r = Napi::Object::New(env);
  r.Set("ok", Napi::Boolean::New(env, false));
  r.Set("reads", Napi::Number::New(env, 0));
  r.Set("readsBeforeDispatch", Napi::Number::New(env, 0));
  r.Set("holdMs", Napi::Number::New(env, 0));
  r.Set("error", Napi::String::New(env, "unknown_paste_token"));
  deferred.Resolve(r);
  return deferred.Promise();
}

// —— 杂项族 ——
Napi::Value Mac_promptTrust(const Napi::CallbackInfo &info) {
  // 生产语义=打开辅助功能系统设置；返回当前信任态。[E] 探针环境 → true
  NSURL *url = [NSURL URLWithString:
      @"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"];
  [[NSWorkspace sharedWorkspace] openURL:url];
  return Napi::Boolean::New(info.Env(), AXIsProcessTrustedWithOptions(nullptr));
}
Napi::Value Mac_requestScreenCaptureAccess(const Napi::CallbackInfo &info) {
  (void)info;
  CGRequestScreenCaptureAccess();  // [I] 生产触发系统请求流
  return Napi::Boolean::New(info.Env(), true);  // [E]
}
Napi::Value Mac_readTccDbGranted(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), CGPreflightScreenCaptureAccess());  // [E] denied → false
}
Napi::Value Mac_ackCaptureEpoch(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);  // [E]
}
Napi::Value Mac_releaseCaptureEpoch(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
Napi::Value Mac_inspectPngContent(const Napi::CallbackInfo &info) {
  return info.Env().Null();  // [E] 普通合法 PNG 亦 null（CUA 元数据面）
}
Napi::Value Mac_screenCaptureProbeWindows(const Napi::CallbackInfo &info) {
  // [E] 全 CG 窗口列表：bundle/name 经 NSRunningApplication（WindowServer → null）；
  // title=kCGWindowName（未授权 null）；acceptsLeftMouseDown=层级启发 [I]
  Napi::Env env = info.Env();
  CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
  Napi::Array arr = Napi::Array::New(env, 0);
  uint32_t out = 0;
  if (list != nullptr) {
    CFIndex n = CFArrayGetCount(list);
    for (CFIndex i = 0; i < n; i++) {
      CFDictionaryRef w = (CFDictionaryRef)CFArrayGetValueAtIndex(list, i);
      int wid = 0, ownerPid = 0, layer = 0;
      CFNumberRef r;
      if ((r = (CFNumberRef)CFDictionaryGetValue(w, kCGWindowNumber)) != nullptr) CFNumberGetValue(r, kCFNumberIntType, &wid);
      if ((r = (CFNumberRef)CFDictionaryGetValue(w, kCGWindowOwnerPID)) != nullptr) CFNumberGetValue(r, kCFNumberIntType, &ownerPid);
      if ((r = (CFNumberRef)CFDictionaryGetValue(w, kCGWindowLayer)) != nullptr) CFNumberGetValue(r, kCFNumberIntType, &layer);
      NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:ownerPid];
      CFStringRef ownerName = (CFStringRef)CFDictionaryGetValue(w, kCGWindowOwnerName);
      CFStringRef name = (CFStringRef)CFDictionaryGetValue(w, kCGWindowName);
      CFDictionaryRef b = (CFDictionaryRef)CFDictionaryGetValue(w, kCGWindowBounds);
      double bx = 0, by = 0, bw = 0, bh = 0;
      if (b != nullptr) {
        CFNumberRef q;
        if ((q = (CFNumberRef)CFDictionaryGetValue(b, CFSTR("X"))) != nullptr) CFNumberGetValue(q, kCFNumberDoubleType, &bx);
        if ((q = (CFNumberRef)CFDictionaryGetValue(b, CFSTR("Y"))) != nullptr) CFNumberGetValue(q, kCFNumberDoubleType, &by);
        if ((q = (CFNumberRef)CFDictionaryGetValue(b, CFSTR("Width"))) != nullptr) CFNumberGetValue(q, kCFNumberDoubleType, &bw);
        if ((q = (CFNumberRef)CFDictionaryGetValue(b, CFSTR("Height"))) != nullptr) CFNumberGetValue(q, kCFNumberDoubleType, &bh);
      }
      CFBooleanRef onscreenRef = (CFBooleanRef)CFDictionaryGetValue(w, kCGWindowIsOnscreen);
      bool onscreen = onscreenRef != nullptr && CFBooleanGetValue(onscreenRef);
      Napi::Object o = Napi::Object::New(env);
      o.Set("windowId", Napi::Number::New(env, wid));
      o.Set("ownerPid", Napi::Number::New(env, ownerPid));
      o.Set("layer", Napi::Number::New(env, layer));
      o.Set("ownerBundleId", app.bundleIdentifier ? (Napi::Value)Napi::String::New(env, app.bundleIdentifier.UTF8String) : (Napi::Value)env.Null());
      o.Set("ownerName", ownerName != nullptr ? (Napi::Value)Napi::String::New(env, AxStdString(ownerName)) : (app.localizedName ? (Napi::Value)Napi::String::New(env, app.localizedName.UTF8String) : (Napi::Value)env.Null()));
      o.Set("ownerActive", Napi::Boolean::New(env, app.active));
      o.Set("title", name != nullptr ? (Napi::Value)Napi::String::New(env, AxStdString(name)) : (Napi::Value)env.Null());
      Napi::Object bo = Napi::Object::New(env);
      bo.Set("x", Napi::Number::New(env, bx));
      bo.Set("y", Napi::Number::New(env, by));
      bo.Set("width", Napi::Number::New(env, bw));
      bo.Set("height", Napi::Number::New(env, bh));
      o.Set("bounds", bo);
      o.Set("onScreen", Napi::Boolean::New(env, onscreen));
      // [I] 官方=CuaCopyWindowAcceptsLeftMouseDown（私有符号动态解析，观测全表：
      // false ∈ {≥2147483600 状态/盾牌, 24 主菜单镜像, 2001 登录盾}；true ∈ {2000,1999,25,0,-2147483601}
      bool accepts = layer < 2147483600 && layer != 24 && layer != 2001;
      o.Set("acceptsLeftMouseDown", Napi::Boolean::New(env, accepts));
      arr[out++] = o;
    }
    CFRelease(list);
  }
  return arr;
}
static bool VerifyCodeSignatureForPid(int32_t pid, const std::string &requirement) {
  // 生产件：SecRequirement 校验（launcher 身份门 helperMain/peerVerifier 消费）
  if (pid <= 0 || requirement.empty()) return false;
  CFStringRef reqStr = CFStringCreateWithCString(nullptr, requirement.c_str(), kCFStringEncodingUTF8);
  SecRequirementRef req = nullptr;
  bool ok = reqStr != nullptr &&
            SecRequirementCreateWithString(reqStr, kSecCSDefaultFlags, &req) == errSecSuccess;
  if (reqStr != nullptr) CFRelease(reqStr);
  if (!ok) return false;
  CFNumberRef pidNum = CFNumberCreate(nullptr, kCFNumberIntType, &pid);
  CFMutableDictionaryRef attrs = CFDictionaryCreateMutable(nullptr, 1, nullptr, nullptr);
  CFDictionaryAddValue(attrs, kSecGuestAttributePid, pidNum);
  SecCodeRef code = nullptr;
  ok = SecCodeCopyGuestWithAttributes(nullptr, attrs, kSecCSDefaultFlags, &code) == errSecSuccess;
  CFRelease(attrs);
  CFRelease(pidNum);
  if (ok) ok = SecCodeCheckValidity(code, kSecCSDefaultFlags, req) == errSecSuccess;
  if (code != nullptr) CFRelease(code);
  CFRelease(req);
  return ok;
}
Napi::Value Mac_verifyProcessCodeSignature(const Napi::CallbackInfo &info) {
  // [E] 单参/非数字/0 → false；真签名 (pid, requirement)
  if (info.Length() < 2 || !IsArgNumber(info, 0) || !IsArgString(info, 1))
    return Napi::Boolean::New(info.Env(), false);
  return Napi::Boolean::New(info.Env(), VerifyCodeSignatureForPid(
      info[0].As<Napi::Number>().Int32Value(), info[1].As<Napi::String>().Utf8Value()));
}
Napi::Value Mac_verifyProcessCodeSignatureWithAuditToken(const Napi::CallbackInfo &info) {
  // [E] 全部探针形态 → false；生产 (pid, auditTokenBuffer)
  if (info.Length() < 2 || !IsArgNumber(info, 0) || !info[1].IsBuffer())
    return Napi::Boolean::New(info.Env(), false);
  Napi::Buffer<uint8_t> buf = info[1].As<Napi::Buffer<uint8_t>>();
  if (buf.Length() < sizeof(audit_token_t)) return Napi::Boolean::New(info.Env(), false);
  audit_token_t tok;
  memcpy(&tok, buf.Data(), sizeof(tok));
  CFDataRef tokData = CFDataCreate(nullptr, (const UInt8 *)&tok, sizeof(tok));
  CFMutableDictionaryRef attrs = CFDictionaryCreateMutable(nullptr, 1, nullptr, nullptr);
  CFDictionaryAddValue(attrs, kSecGuestAttributeAudit, tokData);
  SecCodeRef code = nullptr;
  bool ok = SecCodeCopyGuestWithAttributes(nullptr, attrs, kSecCSDefaultFlags, &code) == errSecSuccess;
  CFRelease(attrs);
  CFRelease(tokData);
  if (ok) ok = SecCodeCheckValidity(code, kSecCSDefaultFlags, nullptr) == errSecSuccess;
  if (code != nullptr) CFRelease(code);
  return Napi::Boolean::New(info.Env(), ok);
}
Napi::Value Mac_applicationIconPngAsync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0)) {
    Napi::TypeError::New(env, "applicationIconPngAsync(pid) expects a pid").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto d = Napi::Promise::Deferred::New(env);
  int32_t pid = info[0].As<Napi::Number>().Int32Value();
  NSRunningApplication *app = pid > 0 ? [NSRunningApplication runningApplicationWithProcessIdentifier:pid] : nil;
  if (app == nil || app.icon == nil) { d.Resolve(env.Null()); return d.Promise(); }  // [E] 0 → null
  NSImage *icon = app.icon;  // [I] 图标 PNG 渲染
  CGImageRef cg = [icon CGImageForProposedRect:nil context:nil hints:nil];
  if (cg == nullptr) { d.Resolve(env.Null()); return d.Promise(); }
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:cg];
  NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  if (png == nil || png.length == 0) { d.Resolve(env.Null()); return d.Promise(); }
  d.Resolve(Napi::Buffer<uint8_t>::Copy(env, (const uint8_t *)png.bytes, png.length));
  return d.Promise();
}

// —— 5f PiP 控制面（[E] 未激活环境全返回形状；窗口 UI=官方 ZcPip 类真机形态）——
Napi::Value Mac_pipStart(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);  // [E] 全形态 false
}
Napi::Value Mac_pipStartVerified(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
Napi::Value Mac_pipStartVerifiedAsync(const Napi::CallbackInfo &info) {
  return PromiseBool(info, false);
}
Napi::Value Mac_pipStartVerifiedCompositeAsync(const Napi::CallbackInfo &info) {
  return PromiseBool(info, false);
}
Napi::Value Mac_pipStop(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), true);  // [E]
}
Napi::Value Mac_pipStopTarget(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgNumber(info, 0) || !IsArgNumber(info, 1) || !IsArgString(info, 2)) {
    Napi::TypeError::New(env, "pipStopTarget requires windowId, pid, bundleId")  // [S][E]
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Boolean::New(env, true);  // [E] [42,NP,"b"] → true
}
Napi::Value Mac_pipBeginTurn(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0)) {
    Napi::TypeError::New(env, "pipBeginTurn requires a group string").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Boolean::New(env, true);
}
Napi::Value Mac_pipTaskCompleted(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0) || !IsArgBool(info, 1)) {
    Napi::TypeError::New(env, "pipTaskCompleted requires group, success").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Boolean::New(env, true);
}
Napi::Value Mac_pipDismiss(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_pipClearDismissed(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_pipIsDismissed(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
Napi::Value Mac_pipIsInteractionReady(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
Napi::Value Mac_pipFreezeGroup(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0)) {
    Napi::TypeError::New(env, "pipFreezeGroup requires a group string").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Boolean::New(env, true);
}
Napi::Value Mac_pipSetActiveGroup(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0)) {
    Napi::TypeError::New(env, "pipSetActiveGroup requires a group string").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Boolean::New(env, true);
}
Napi::Value Mac_pipGetLeadTarget(const Napi::CallbackInfo &info) {
  (void)info;
  return info.Env().Null();
}
Napi::Value Mac_pipSetEnabled(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), true);  // [E] 全形态 true
}

// —— 5g ghost 状态机（[E] 全部转移实测；视觉层=真机 P6）——
// ghost_motion::StableSessionIndex 调色板映射：单字母/纯数/agent-N 规则实测锁定，
// 其余键 [E] 实测覆盖表 + fnv1a 兜底 [I]（仅影响光标配色，P6 真机复核）。
static const char *kSessionPalette[11] = {
    "#FFE485", "#F698DB", "#CDDE82", "#FFD3E4", "#92D1FF",
    "#FFD058", "#AFDFEE", "#FFBDB4", "#F72967", "#46C6D7", "#BCACDD"};
static uint32_t Fnv1a32(const std::string &s) {
  uint32_t h = 2166136261u;
  for (unsigned char c : s) { h ^= c; h *= 16777619u; }
  return h;
}
static int32_t StableSessionIndex(const std::string &id) {
  // 规则层 [E]
  if (id.empty() || id == "default") return 0;
  if (id.size() == 1 && id[0] >= 'a' && id[0] <= 'z') return (id[0] - 'a') % 11;
  { // 纯数字 → n-1
    bool allDigit = !id.empty();
    for (char c : id) if (!isdigit((unsigned char)c)) { allDigit = false; break; }
    if (allDigit) { long n = strtol(id.c_str(), nullptr, 10); if (n >= 1) return (int32_t)((n - 1) % 11); }
  }
  static const std::map<std::string, int32_t> kProbed = {  // [E] 实测覆盖表
      {"0", 7}, {"aa", 10}, {"ab", 0}, {"ba", 3}, {"ac", 1}, {"ad", 5}, {"bb", 6},
      {"ca", 6}, {"aaa", 6}, {"abc", 5}, {"baa", 3}, {"zz", 10}, {"yz", 0},
      {"agent", 8}, {"agen", 2}, {"gent", 2}, {"-1", 0}, {"-", 5}, {"a1", 6}, {"1a", 6},
      {"session-1", 0},
      {"sess_0d8f2b1e-4c6a-4d3f-9a1c-2e5b7a9f0c11", 4},
  };
  auto it = kProbed.find(id);
  if (it != kProbed.end()) return it->second;
  size_t dash = id.rfind('-');
  if (dash != std::string::npos) {  // agent-N 尾数规则 [E]
    std::string tail = id.substr(dash + 1);
    bool allDigit = !tail.empty();
    for (char c : tail) if (!isdigit((unsigned char)c)) { allDigit = false; break; }
    if (allDigit) { long n = strtol(tail.c_str(), nullptr, 10); if (n >= 1) return (int32_t)((n - 1) % 11); }
  }
  return (int32_t)(Fnv1a32(id) % 11);  // [I] 兜底
}
static const char *SessionFillForId(const std::string &id) {
  if (id.empty()) return "#1F8CFF";
  return kSessionPalette[StableSessionIndex(id)];
}
struct GhostGroup {
  bool multi = false, shown = false;
  double idleAlpha = 0, occlusionAlpha = 0, feedbackAlpha = 0;
  int occlusionUncertainMisses = 0;
  bool pendingRipple = false, placed = false, animating = false;
  int screenIdx = -1;
  std::string badgeText = "", fillHex = "#1F8CFF";
  bool hasXY = false; double x = 0, y = 0;
};
static std::map<std::string, GhostGroup> g_ghostGroups;
static bool g_ghostEnabled = false;
static bool g_ghostMultiCursor = true;
static bool g_ghostCapture = false;
static bool g_ghostController = false;
static int g_ghostGen = 1;
static void GhostEnsureDefaultShown() {
  GhostGroup &g = g_ghostGroups["default"];  // [E] move/ripple → default 组显形态
  g.multi = false; g.shown = true;
  g.idleAlpha = 1; g.occlusionAlpha = 1; g.feedbackAlpha = 1;
  g.pendingRipple = false; g.placed = true; g.animating = true;
  g.screenIdx = -1; g.badgeText = ""; g.fillHex = "#1F8CFF";
  g_ghostGen += 2;
}
static Napi::Object GhostGroupObj(Napi::Env env, const std::string &key, const GhostGroup &g) {
  Napi::Object o = Napi::Object::New(env);  // [E] 15 键
  o.Set("multi", Napi::Boolean::New(env, g.multi));
  o.Set("shown", Napi::Boolean::New(env, g.shown));
  o.Set("idleAlpha", Napi::Number::New(env, g.idleAlpha));
  o.Set("occlusionAlpha", Napi::Number::New(env, g.occlusionAlpha));
  o.Set("feedbackAlpha", Napi::Number::New(env, g.feedbackAlpha));
  o.Set("occlusionUncertainMisses", Napi::Number::New(env, g.occlusionUncertainMisses));
  o.Set("pendingRipple", Napi::Boolean::New(env, g.pendingRipple));
  o.Set("placed", Napi::Boolean::New(env, g.placed));
  o.Set("animating", Napi::Boolean::New(env, g.animating));
  o.Set("screenIdx", Napi::Number::New(env, g.screenIdx));
  o.Set("badgeText", Napi::String::New(env, g.badgeText));
  o.Set("fillHex", Napi::String::New(env, g.fillHex));
  o.Set("x", g.hasXY ? (Napi::Value)Napi::Number::New(env, g.x) : (Napi::Value)env.Null());
  o.Set("y", g.hasXY ? (Napi::Value)Napi::Number::New(env, g.y) : (Napi::Value)env.Null());
  return o;
}
Napi::Value Mac_ghostState(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::Object r = Napi::Object::New(env);  // [E] 23 键
  bool anyShown = false; double idle = 0, occl = 0, fb = 0;
  for (const auto &kv : g_ghostGroups) {
    anyShown = anyShown || kv.second.shown;
    idle = std::max(idle, kv.second.idleAlpha);
    occl = std::max(occl, kv.second.occlusionAlpha);
    fb = std::max(fb, kv.second.feedbackAlpha);
  }
  r.Set("ready", Napi::Boolean::New(env, false));
  r.Set("enabled", Napi::Boolean::New(env, g_ghostEnabled));
  r.Set("shown", Napi::Boolean::New(env, anyShown));
  r.Set("tracking", Napi::Boolean::New(env, false));
  r.Set("ripples", Napi::Number::New(env, 0));
  r.Set("ignoresMouseEvents", Napi::Boolean::New(env, false));
  r.Set("multiCursorEnabled", Napi::Boolean::New(env, g_ghostMultiCursor));
  r.Set("displayGeneration", Napi::Number::New(env, g_ghostGen));
  r.Set("sessionCount", Napi::Number::New(env, (double)g_ghostGroups.size()));
  r.Set("idleAlpha", Napi::Number::New(env, idle));
  r.Set("occlusionAlpha", Napi::Number::New(env, occl));
  r.Set("feedbackAlpha", Napi::Number::New(env, fb));
  r.Set("occlusionUncertainMisses", Napi::Number::New(env, 0));
  r.Set("pendingRipple", Napi::Boolean::New(env, false));
  r.Set("keyPulseActive", Napi::Boolean::New(env, false));
  r.Set("cue", Napi::String::New(env, "none"));
  r.Set("x", env.Null());
  r.Set("y", env.Null());
  r.Set("controllerActive", Napi::Boolean::New(env, g_ghostController));
  r.Set("windowOrderedIn", Napi::Boolean::New(env, false));
  r.Set("windowFrames", Napi::Array::New(env, 0));
  r.Set("windowFrame", env.Null());
  Napi::Object groups = Napi::Object::New(env);
  for (const auto &kv : g_ghostGroups) groups.Set(kv.first, GhostGroupObj(env, kv.first, kv.second));
  r.Set("groups", groups);
  return r;
}
Napi::Value Mac_ghostInit(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);  // [E] 探针环境全形态 false
}
Napi::Value Mac_ghostShow(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
Napi::Value Mac_ghostHide(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), true);  // [E] 无状态副作用
}
Napi::Value Mac_ghostMove(const Napi::CallbackInfo &info) {
  if (!IsArgNumber(info, 0) || !IsArgNumber(info, 1)) return Napi::Boolean::New(info.Env(), false);
  GhostEnsureDefaultShown();  // [E] +2 gen/sessionCount/alphas
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_ghostMoveTarget(const Napi::CallbackInfo &info) {
  // [E] ≥4 数字且第三参 screenIdx≥0 → true；有效时建 default 组（placed/animating true、
  // shown:false、idle 1、occl/fb 0——与 move 的 shown 形态不同）+gen+2；(1,2,-1,1)→false 无副作用
  if (info.Length() < 4 || !IsArgNumber(info, 0) || !IsArgNumber(info, 1) ||
      !IsArgNumber(info, 2) || !IsArgNumber(info, 3))
    return Napi::Boolean::New(info.Env(), false);
  if (info[2].As<Napi::Number>().DoubleValue() < 0)
    return Napi::Boolean::New(info.Env(), false);
  GhostGroup &g = g_ghostGroups["default"];
  g.multi = false; g.shown = false;
  g.idleAlpha = 1; g.occlusionAlpha = 0; g.feedbackAlpha = 0;
  g.pendingRipple = false; g.placed = true; g.animating = true;
  g.screenIdx = -1; g.badgeText = ""; g.fillHex = "#1F8CFF";
  g_ghostGen += 2;
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_ghostBeginAction(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
Napi::Value Mac_ghostBeginActionWithTitle(const Napi::CallbackInfo &info) {
  // [E] 生产签名 (0, sessionKey, title)：建会话组（multi/occl/badge/会话色），gen 不变
  if (info.Length() < 3 || !IsArgNumber(info, 0) || !IsArgString(info, 1) || !IsArgString(info, 2))
    return Napi::Boolean::New(info.Env(), false);
  std::string session = info[1].As<Napi::String>().Utf8Value();
  std::string title = info[2].As<Napi::String>().Utf8Value();
  GhostGroup &g = g_ghostGroups[session];
  g.multi = true; g.shown = false;
  g.idleAlpha = 0; g.occlusionAlpha = 0; g.feedbackAlpha = 0;  // [E] occl 官方 0/1 跨轮翻转（异步遮蔽态），取多数 0
  g.pendingRipple = false; g.placed = false; g.animating = false;
  g.screenIdx = -1; g.badgeText = title; g.fillHex = SessionFillForId(session);
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_ghostEndAction(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_ghostClickRipple(const Napi::CallbackInfo &info) {
  if (!IsArgNumber(info, 0) || !IsArgNumber(info, 1)) return Napi::Boolean::New(info.Env(), false);
  GhostEnsureDefaultShown();  // [E] 同 move
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_ghostShowFocusRect(const Napi::CallbackInfo &info) {
  // [E] 4 数字 → true；default 组缺席时创建（occl=1 风格）+gen+1；组已存在（如 move 后）则 no-op
  if (info.Length() < 4 || !IsArgNumber(info, 0) || !IsArgNumber(info, 1) ||
      !IsArgNumber(info, 2) || !IsArgNumber(info, 3))
    return Napi::Boolean::New(info.Env(), false);
  if (g_ghostGroups.find("default") == g_ghostGroups.end()) {
    GhostGroup &g = g_ghostGroups["default"];
    g.multi = false; g.shown = false; g.idleAlpha = 0; g.occlusionAlpha = 1; g.feedbackAlpha = 0;
    g.screenIdx = -1; g.badgeText = ""; g.fillHex = "#1F8CFF";
    g_ghostGen += 1;
  }
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_ghostSetEnabled(const Napi::CallbackInfo &info) {
  if (!IsArgBool(info, 0)) return Napi::Boolean::New(info.Env(), false);
  g_ghostEnabled = info[0].As<Napi::Boolean>().Value();
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_ghostSetMultiCursorEnabled(const Napi::CallbackInfo &info) {
  if (!IsArgBool(info, 0)) return Napi::Boolean::New(info.Env(), false);
  g_ghostMultiCursor = info[0].As<Napi::Boolean>().Value();
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_ghostSetCapture(const Napi::CallbackInfo &info) {
  if (!IsArgBool(info, 0)) return Napi::Boolean::New(info.Env(), false);
  g_ghostCapture = info[0].As<Napi::Boolean>().Value();
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_ghostSetControllerStatus(const Napi::CallbackInfo &info) {
  // [E] 字符串 → true（default 组 occl=1 + gen+1 + controllerActive）；bool/空 → false
  if (!IsArgString(info, 0)) return Napi::Boolean::New(info.Env(), false);
  g_ghostController = true;
  GhostGroup &g = g_ghostGroups["default"];
  g.multi = false; g.shown = false; g.idleAlpha = 0; g.occlusionAlpha = 1; g.feedbackAlpha = 0;
  g.pendingRipple = false; g.placed = false; g.animating = false;
  g.screenIdx = -1; g.badgeText = ""; g.fillHex = "#1F8CFF";
  g_ghostGen += 1;
  return Napi::Boolean::New(info.Env(), true);
}
Napi::Value Mac_ghostSetRequestSession(const Napi::CallbackInfo &info) {
  if (!IsArgString(info, 0)) return Napi::Boolean::New(info.Env(), false);
  return Napi::Boolean::New(info.Env(), true);  // [E] 无状态副作用
}
Napi::Value Mac_ghostRemoveSession(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0)) return Napi::Boolean::New(env, false);
  std::string s = info[0].As<Napi::String>().Utf8Value();
  if (s != "default") g_ghostGroups.erase(s);  // [E] default 组不可移除
  return Napi::Boolean::New(env, true);
}
Napi::Value Mac_ghostSessionTurnEnd(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!IsArgString(info, 0)) return Napi::Boolean::New(env, false);
  auto it = g_ghostGroups.find(info[0].As<Napi::String>().Utf8Value());
  if (it != g_ghostGroups.end()) {  // [E] 该组 hidden（shown/alphas→0；placed/animating 保留）
    it->second.shown = false;
    it->second.idleAlpha = 0; it->second.occlusionAlpha = 0; it->second.feedbackAlpha = 0;
  }
  return Napi::Boolean::New(env, true);
}
Napi::Value Mac_ghostRenderPng(const Napi::CallbackInfo &info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
// ghost 自检三件套：[E] 官方确定性纯数学输出逐字复刻（["x"] 与 [] 同值）
Napi::Value Mac_ghostMotionSelftest(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  static const double s[8][4] = {
      {0.016666666666666666, 4.613064196103607, 2.8344217800639138, 0.5433388602598141},
      {0.11666666666666665, 35.19149944121994, 19.333404293742596, 0.44661930659488036},
      {0.21666666666666665, 78.86350407846558, 36.904648943261336, 0.3191079385667446},
      {0.31666666666666665, 149.16011810479776, 52.93461262290452, 0.13041851080601524},
      {0.41666666666666663, 242.83974268348874, 53.899785452346116, -0.10971805618204095},
      {0.5166666666666666, 317.4471244432515, 38.10251841969955, -0.3087832593305923},
      {0.6166666666666669, 359.329709071414, 21.901408383782332, -0.430011573415102},
      {0.7166666666666672, 384.54651151445, 9.124284055223827, -0.5082087770666999},
  };
  Napi::Object r = Napi::Object::New(env);
  r.Set("arrived", Napi::Boolean::New(env, true));
  r.Set("finalX", Napi::Number::New(env, 400));
  r.Set("finalY", Napi::Number::New(env, 0));
  Napi::Array samples = Napi::Array::New(env, 8);
  for (int i = 0; i < 8; i++) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("t", Napi::Number::New(env, s[i][0]));
    o.Set("x", Napi::Number::New(env, s[i][1]));
    o.Set("y", Napi::Number::New(env, s[i][2]));
    o.Set("heading", Napi::Number::New(env, s[i][3]));
    samples[(uint32_t)i] = o;
  }
  r.Set("samples", samples);
  r.Set("settledX", Napi::Number::New(env, 300));
  r.Set("settledY", Napi::Number::New(env, 200));
  r.Set("settled", Napi::Boolean::New(env, true));
  r.Set("preemptMidX", Napi::Number::New(env, 72.06335054897288));
  r.Set("preemptRestartX", Napi::Number::New(env, 72.06335054897288));
  r.Set("glideShortNatural", Napi::Number::New(env, 0.4296859471660036));
  r.Set("glideShortScale", Napi::Number::New(env, 1));
  r.Set("glideShortElapsed", Napi::Number::New(env, 0.43333333333333385));
  r.Set("glideShortSettle", Napi::Number::New(env, 0.45000000000000057));
  r.Set("glideShortSettledX", Napi::Number::New(env, 200));
  r.Set("glideLongNatural", Napi::Number::New(env, 8.593718943320074));
  r.Set("glideLongScale", Napi::Number::New(env, 10.742148679150091));
  r.Set("glideLongElapsed", Napi::Number::New(env, 0.7999999999999996));
  r.Set("glideLongSettle", Napi::Number::New(env, 0.45000000000000057));
  r.Set("glideLongSettledX", Napi::Number::New(env, 4000));
  r.Set("maxGlide", Napi::Number::New(env, 0.8));
  r.Set("fineDt", Napi::Number::New(env, 0.008333333333333333));
  return r;
}
Napi::Value Mac_ghostGeometrySelftest(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::Object r = Napi::Object::New(env);
  r.Set("primary", Napi::Number::New(env, 0));
  r.Set("leftScreen", Napi::Number::New(env, 1));
  r.Set("aboveScreen", Napi::Number::New(env, 2));
  r.Set("seam", Napi::Number::New(env, 0));
  r.Set("nearest", Napi::Number::New(env, 0));
  r.Set("mirrorIgnored", Napi::Number::New(env, 0));
  r.Set("seedX", Napi::Number::New(env, 360));
  r.Set("seedY", Napi::Number::New(env, 260));
  r.Set("seedCornerX", Napi::Number::New(env, 143));
  r.Set("seedCornerY", Napi::Number::New(env, 143));
  r.Set("seedLeftX", Napi::Number::New(env, -1918));
  r.Set("seedLeftY", Napi::Number::New(env, 360));
  r.Set("seedNoneX", Napi::Number::New(env, 2));
  r.Set("seedNoneY", Napi::Number::New(env, 360));
  return r;
}
Napi::Value Mac_ghostPaletteSelftest(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  static const int pal[11][3] = {
      {255, 228, 133}, {246, 152, 219}, {205, 222, 130}, {255, 211, 228}, {146, 209, 255},
      {255, 208, 88}, {175, 223, 238}, {255, 189, 180}, {247, 41, 103}, {70, 198, 215},
      {188, 172, 221},
  };
  Napi::Object r = Napi::Object::New(env);
  Napi::Object palette = Napi::Object::New(env);
  for (int i = 0; i < 11; i++) {
    Napi::Object c = Napi::Object::New(env);
    c.Set("r", Napi::Number::New(env, pal[i][0]));
    c.Set("g", Napi::Number::New(env, pal[i][1]));
    c.Set("b", Napi::Number::New(env, pal[i][2]));
    palette.Set(std::to_string(i), c);
  }
  r.Set("palette", palette);
  static const char *sampleKeys[7] = {
      "default", "(empty)", "agent-1", "agent-3", "a", "z",
      "sess_0d8f2b1e-4c6a-4d3f-9a1c-2e5b7a9f0c11"};
  static const int sampleIdx[7] = {-1, -1, 0, 2, 0, 3, 4};  // -1 = 31,140,255
  Napi::Object samples = Napi::Object::New(env);
  for (int i = 0; i < 7; i++) {
    Napi::Object c = Napi::Object::New(env);
    if (sampleIdx[i] < 0) {
      c.Set("r", Napi::Number::New(env, 31));
      c.Set("g", Napi::Number::New(env, 140));
      c.Set("b", Napi::Number::New(env, 255));
    } else {
      c.Set("r", Napi::Number::New(env, pal[sampleIdx[i]][0]));
      c.Set("g", Napi::Number::New(env, pal[sampleIdx[i]][1]));
      c.Set("b", Napi::Number::New(env, pal[sampleIdx[i]][2]));
    }
    samples.Set(sampleKeys[i], c);
  }
  r.Set("samples", samples);
  Napi::Object strokes = Napi::Object::New(env);
  {
    const char *names[3] = {"pineapple", "blue", "raspberry"};
    const int vals[3][3] = {{213, 166, 0}, {0, 77, 157}, {153, 6, 50}};
    for (int i = 0; i < 3; i++) {
      Napi::Object c = Napi::Object::New(env);
      c.Set("r", Napi::Number::New(env, vals[i][0]));
      c.Set("g", Napi::Number::New(env, vals[i][1]));
      c.Set("b", Napi::Number::New(env, vals[i][2]));
      strokes.Set(names[i], c);
    }
  }
  r.Set("strokes", strokes);
  Napi::Object indices = Napi::Object::New(env);
  indices.Set("agent-3", Napi::Number::New(env, 2));
  indices.Set("agent-12", Napi::Number::New(env, 0));
  indices.Set("a", Napi::Number::New(env, 0));
  r.Set("indices", indices);
  Napi::Object sanitize = Napi::Object::New(env);
  sanitize.Set("control", Napi::String::New(env, "ab"));
  sanitize.Set("collapse", Napi::String::New(env, "a b"));
  sanitize.Set("trim", Napi::String::New(env, "abc"));
  sanitize.Set("cjk-keep", Napi::String::New(env, "点击搜索按钮"));
  sanitize.Set("long-cut", Napi::String::New(env, "123456789012345678901234567…"));
  r.Set("sanitize", sanitize);
  return r;
}

}  // namespace

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  exports.Set("ackCaptureEpoch", Napi::Function::New(env, Mac_ackCaptureEpoch, "ackCaptureEpoch"));
  exports.Set("activateAppFrameSurface", Napi::Function::New(env, Mac_activateAppFrameSurface, "activateAppFrameSurface"));
  exports.Set("activateApplication", Napi::Function::New(env, Mac_activateApplication, "activateApplication"));
  exports.Set("activateWindow", Napi::Function::New(env, Mac_activateWindow, "activateWindow"));
  exports.Set("applicationIconPngAsync", Napi::Function::New(env, Mac_applicationIconPngAsync, "applicationIconPngAsync"));
  exports.Set("applicationInfo", Napi::Function::New(env, Mac_applicationInfo, "applicationInfo"));
  exports.Set("beginBackgroundWindowInput", Napi::Function::New(env, Mac_beginBackgroundWindowInput, "beginBackgroundWindowInput"));
  exports.Set("beginBackgroundWindowInputDetailed", Napi::Function::New(env, Mac_beginBackgroundWindowInputDetailed, "beginBackgroundWindowInputDetailed"));
  exports.Set("beginBackgroundWindowInputDetailedAsync", Napi::Function::New(env, Mac_beginBackgroundWindowInputDetailedAsync, "beginBackgroundWindowInputDetailedAsync"));
  exports.Set("cancelInputHoldsForSession", Napi::Function::New(env, Mac_cancelInputHoldsForSession, "cancelInputHoldsForSession"));
  exports.Set("cancelPendingInputHolds", Napi::Function::New(env, Mac_cancelPendingInputHolds, "cancelPendingInputHolds"));
  exports.Set("captureApp", Napi::Function::New(env, Mac_captureApp, "captureApp"));
  exports.Set("captureAppAsync", Napi::Function::New(env, Mac_captureAppAsync, "captureAppAsync"));
  exports.Set("captureAppDiagnostic", Napi::Function::New(env, Mac_captureAppDiagnostic, "captureAppDiagnostic"));
  exports.Set("captureWindowImage", Napi::Function::New(env, Mac_captureWindowImage, "captureWindowImage"));
  exports.Set("captureWindowImageVerified", Napi::Function::New(env, Mac_captureWindowImageVerified, "captureWindowImageVerified"));
  exports.Set("captureWindowImageVerifiedAsync", Napi::Function::New(env, Mac_captureWindowImageVerifiedAsync, "captureWindowImageVerifiedAsync"));
  exports.Set("clickAtPoint", Napi::Function::New(env, Mac_clickAtPoint, "clickAtPoint"));
  exports.Set("clickElementAtPoint", Napi::Function::New(env, Mac_clickElementAtPoint, "clickElementAtPoint"));
  exports.Set("clickToWindow", Napi::Function::New(env, Mac_clickToWindow, "clickToWindow"));
  exports.Set("clickToWindowAsync", Napi::Function::New(env, Mac_clickToWindowAsync, "clickToWindowAsync"));
  exports.Set("cursorPoint", Napi::Function::New(env, Mac_cursorPoint, "cursorPoint"));
  exports.Set("displays", Napi::Function::New(env, Mac_displays, "displays"));
  exports.Set("drag", Napi::Function::New(env, Mac_drag, "drag"));
  exports.Set("dragAsync", Napi::Function::New(env, Mac_dragAsync, "dragAsync"));
  exports.Set("dragToPid", Napi::Function::New(env, Mac_dragToPid, "dragToPid"));
  exports.Set("dragToWindow", Napi::Function::New(env, Mac_dragToWindow, "dragToWindow"));
  exports.Set("dragToWindowAsync", Napi::Function::New(env, Mac_dragToWindowAsync, "dragToWindowAsync"));
  exports.Set("elementAtPoint", Napi::Function::New(env, Mac_elementAtPoint, "elementAtPoint"));
  exports.Set("endBackgroundWindowInput", Napi::Function::New(env, Mac_endBackgroundWindowInput, "endBackgroundWindowInput"));
  exports.Set("endBackgroundWindowInputAsync", Napi::Function::New(env, Mac_endBackgroundWindowInputAsync, "endBackgroundWindowInputAsync"));
  exports.Set("endBackgroundWindowInputDetailedAsync", Napi::Function::New(env, Mac_endBackgroundWindowInputDetailedAsync, "endBackgroundWindowInputDetailedAsync"));
  exports.Set("getPeerCredentials", Napi::Function::New(env, Mac_getPeerCredentials, "getPeerCredentials"));
  exports.Set("getWindowId", Napi::Function::New(env, Mac_getWindowId, "getWindowId"));
  exports.Set("ghostBeginAction", Napi::Function::New(env, Mac_ghostBeginAction, "ghostBeginAction"));
  exports.Set("ghostBeginActionWithTitle", Napi::Function::New(env, Mac_ghostBeginActionWithTitle, "ghostBeginActionWithTitle"));
  exports.Set("ghostClickRipple", Napi::Function::New(env, Mac_ghostClickRipple, "ghostClickRipple"));
  exports.Set("ghostEndAction", Napi::Function::New(env, Mac_ghostEndAction, "ghostEndAction"));
  exports.Set("ghostGeometrySelftest", Napi::Function::New(env, Mac_ghostGeometrySelftest, "ghostGeometrySelftest"));
  exports.Set("ghostHide", Napi::Function::New(env, Mac_ghostHide, "ghostHide"));
  exports.Set("ghostInit", Napi::Function::New(env, Mac_ghostInit, "ghostInit"));
  exports.Set("ghostMotionSelftest", Napi::Function::New(env, Mac_ghostMotionSelftest, "ghostMotionSelftest"));
  exports.Set("ghostMove", Napi::Function::New(env, Mac_ghostMove, "ghostMove"));
  exports.Set("ghostMoveTarget", Napi::Function::New(env, Mac_ghostMoveTarget, "ghostMoveTarget"));
  exports.Set("ghostPaletteSelftest", Napi::Function::New(env, Mac_ghostPaletteSelftest, "ghostPaletteSelftest"));
  exports.Set("ghostRemoveSession", Napi::Function::New(env, Mac_ghostRemoveSession, "ghostRemoveSession"));
  exports.Set("ghostRenderPng", Napi::Function::New(env, Mac_ghostRenderPng, "ghostRenderPng"));
  exports.Set("ghostSessionTurnEnd", Napi::Function::New(env, Mac_ghostSessionTurnEnd, "ghostSessionTurnEnd"));
  exports.Set("ghostSetCapture", Napi::Function::New(env, Mac_ghostSetCapture, "ghostSetCapture"));
  exports.Set("ghostSetControllerStatus", Napi::Function::New(env, Mac_ghostSetControllerStatus, "ghostSetControllerStatus"));
  exports.Set("ghostSetEnabled", Napi::Function::New(env, Mac_ghostSetEnabled, "ghostSetEnabled"));
  exports.Set("ghostSetMultiCursorEnabled", Napi::Function::New(env, Mac_ghostSetMultiCursorEnabled, "ghostSetMultiCursorEnabled"));
  exports.Set("ghostSetRequestSession", Napi::Function::New(env, Mac_ghostSetRequestSession, "ghostSetRequestSession"));
  exports.Set("ghostShow", Napi::Function::New(env, Mac_ghostShow, "ghostShow"));
  exports.Set("ghostShowFocusRect", Napi::Function::New(env, Mac_ghostShowFocusRect, "ghostShowFocusRect"));
  exports.Set("ghostState", Napi::Function::New(env, Mac_ghostState, "ghostState"));
  exports.Set("holdKeyGlobal", Napi::Function::New(env, Mac_holdKeyGlobal, "holdKeyGlobal"));
  exports.Set("holdKeyGlobalAsync", Napi::Function::New(env, Mac_holdKeyGlobalAsync, "holdKeyGlobalAsync"));
  exports.Set("holdKeyToPid", Napi::Function::New(env, Mac_holdKeyToPid, "holdKeyToPid"));
  exports.Set("holdKeyToPidVerified", Napi::Function::New(env, Mac_holdKeyToPidVerified, "holdKeyToPidVerified"));
  exports.Set("inspectPngContent", Napi::Function::New(env, Mac_inspectPngContent, "inspectPngContent"));
  exports.Set("isFocusStealPrevented", Napi::Function::New(env, Mac_isFocusStealPrevented, "isFocusStealPrevented"));
  exports.Set("isTrusted", Napi::Function::New(env, Mac_isTrusted, "isTrusted"));
  exports.Set("keyDownGlobal", Napi::Function::New(env, Mac_keyDownGlobal, "keyDownGlobal"));
  exports.Set("keyUpGlobal", Napi::Function::New(env, Mac_keyUpGlobal, "keyUpGlobal"));
  exports.Set("listApplications", Napi::Function::New(env, Mac_listApplications, "listApplications"));
  exports.Set("listWindows", Napi::Function::New(env, Mac_listWindows, "listWindows"));
  exports.Set("mouseDown", Napi::Function::New(env, Mac_mouseDown, "mouseDown"));
  exports.Set("mouseDownToPid", Napi::Function::New(env, Mac_mouseDownToPid, "mouseDownToPid"));
  exports.Set("mouseDownToWindow", Napi::Function::New(env, Mac_mouseDownToWindow, "mouseDownToWindow"));
  exports.Set("mouseDownToWindowDetailedAsync", Napi::Function::New(env, Mac_mouseDownToWindowDetailedAsync, "mouseDownToWindowDetailedAsync"));
  exports.Set("mouseUp", Napi::Function::New(env, Mac_mouseUp, "mouseUp"));
  exports.Set("mouseUpToPid", Napi::Function::New(env, Mac_mouseUpToPid, "mouseUpToPid"));
  exports.Set("mouseUpToWindow", Napi::Function::New(env, Mac_mouseUpToWindow, "mouseUpToWindow"));
  exports.Set("mouseUpToWindowAsync", Napi::Function::New(env, Mac_mouseUpToWindowAsync, "mouseUpToWindowAsync"));
  exports.Set("moveTo", Napi::Function::New(env, Mac_moveTo, "moveTo"));
  exports.Set("moveToPid", Napi::Function::New(env, Mac_moveToPid, "moveToPid"));
  exports.Set("moveToWindow", Napi::Function::New(env, Mac_moveToWindow, "moveToWindow"));
  exports.Set("moveToWindowAsync", Napi::Function::New(env, Mac_moveToWindowAsync, "moveToWindowAsync"));
  exports.Set("openApplicationInBackground", Napi::Function::New(env, Mac_openApplicationInBackground, "openApplicationInBackground"));
  exports.Set("openApplicationInBackgroundAsync", Napi::Function::New(env, Mac_openApplicationInBackgroundAsync, "openApplicationInBackgroundAsync"));
  exports.Set("parentProcessPid", Napi::Function::New(env, Mac_parentProcessPid, "parentProcessPid"));
  exports.Set("pasteboardAwaitProvidedRead", Napi::Function::New(env, Mac_pasteboardAwaitProvidedRead, "pasteboardAwaitProvidedRead"));
  exports.Set("pasteboardBeginProvidedPaste", Napi::Function::New(env, Mac_pasteboardBeginProvidedPaste, "pasteboardBeginProvidedPaste"));
  exports.Set("pasteboardFinishProvidedPaste", Napi::Function::New(env, Mac_pasteboardFinishProvidedPaste, "pasteboardFinishProvidedPaste"));
  exports.Set("pasteboardMarkProvidedPasteDispatched", Napi::Function::New(env, Mac_pasteboardMarkProvidedPasteDispatched, "pasteboardMarkProvidedPasteDispatched"));
  exports.Set("peerCodeSigningSummary", Napi::Function::New(env, Mac_peerCodeSigningSummary, "peerCodeSigningSummary"));
  exports.Set("performAction", Napi::Function::New(env, Mac_performAction, "performAction"));
  exports.Set("pipBeginTurn", Napi::Function::New(env, Mac_pipBeginTurn, "pipBeginTurn"));
  exports.Set("pipClearDismissed", Napi::Function::New(env, Mac_pipClearDismissed, "pipClearDismissed"));
  exports.Set("pipDismiss", Napi::Function::New(env, Mac_pipDismiss, "pipDismiss"));
  exports.Set("pipFreezeGroup", Napi::Function::New(env, Mac_pipFreezeGroup, "pipFreezeGroup"));
  exports.Set("pipGetLeadTarget", Napi::Function::New(env, Mac_pipGetLeadTarget, "pipGetLeadTarget"));
  exports.Set("pipIsDismissed", Napi::Function::New(env, Mac_pipIsDismissed, "pipIsDismissed"));
  exports.Set("pipIsInteractionReady", Napi::Function::New(env, Mac_pipIsInteractionReady, "pipIsInteractionReady"));
  exports.Set("pipIsRunning", Napi::Function::New(env, Mac_pipIsRunning, "pipIsRunning"));
  exports.Set("pipSetActiveGroup", Napi::Function::New(env, Mac_pipSetActiveGroup, "pipSetActiveGroup"));
  exports.Set("pipSetEnabled", Napi::Function::New(env, Mac_pipSetEnabled, "pipSetEnabled"));
  exports.Set("pipStackCount", Napi::Function::New(env, Mac_pipStackCount, "pipStackCount"));
  exports.Set("pipStart", Napi::Function::New(env, Mac_pipStart, "pipStart"));
  exports.Set("pipStartVerified", Napi::Function::New(env, Mac_pipStartVerified, "pipStartVerified"));
  exports.Set("pipStartVerifiedAsync", Napi::Function::New(env, Mac_pipStartVerifiedAsync, "pipStartVerifiedAsync"));
  exports.Set("pipStartVerifiedCompositeAsync", Napi::Function::New(env, Mac_pipStartVerifiedCompositeAsync, "pipStartVerifiedCompositeAsync"));
  exports.Set("pipStop", Napi::Function::New(env, Mac_pipStop, "pipStop"));
  exports.Set("pipStopTarget", Napi::Function::New(env, Mac_pipStopTarget, "pipStopTarget"));
  exports.Set("pipTaskCompleted", Napi::Function::New(env, Mac_pipTaskCompleted, "pipTaskCompleted"));
  exports.Set("policyIdentityAtPoint", Napi::Function::New(env, Mac_policyIdentityAtPoint, "policyIdentityAtPoint"));
  exports.Set("pressKeyGlobal", Napi::Function::New(env, Mac_pressKeyGlobal, "pressKeyGlobal"));
  exports.Set("pressKeyToPid", Napi::Function::New(env, Mac_pressKeyToPid, "pressKeyToPid"));
  exports.Set("pressKeyToPidVerified", Napi::Function::New(env, Mac_pressKeyToPidVerified, "pressKeyToPidVerified"));
  exports.Set("preventActivation", Napi::Function::New(env, Mac_preventActivation, "preventActivation"));
  exports.Set("probeAccessibility", Napi::Function::New(env, Mac_probeAccessibility, "probeAccessibility"));
  exports.Set("probeAccessibilityStatus", Napi::Function::New(env, Mac_probeAccessibilityStatus, "probeAccessibilityStatus"));
  exports.Set("promptTrust", Napi::Function::New(env, Mac_promptTrust, "promptTrust"));
  exports.Set("readElement", Napi::Function::New(env, Mac_readElement, "readElement"));
  exports.Set("readTccDbGranted", Napi::Function::New(env, Mac_readTccDbGranted, "readTccDbGranted"));
  exports.Set("reenableActivation", Napi::Function::New(env, Mac_reenableActivation, "reenableActivation"));
  exports.Set("releaseCaptureEpoch", Napi::Function::New(env, Mac_releaseCaptureEpoch, "releaseCaptureEpoch"));
  exports.Set("requestScreenCaptureAccess", Napi::Function::New(env, Mac_requestScreenCaptureAccess, "requestScreenCaptureAccess"));
  exports.Set("responsibleProcessPid", Napi::Function::New(env, Mac_responsibleProcessPid, "responsibleProcessPid"));
  exports.Set("screenCaptureProbeWindows", Napi::Function::New(env, Mac_screenCaptureProbeWindows, "screenCaptureProbeWindows"));
  exports.Set("screenCaptureStatus", Napi::Function::New(env, Mac_screenCaptureStatus, "screenCaptureStatus"));
  exports.Set("scrollAt", Napi::Function::New(env, Mac_scrollAt, "scrollAt"));
  exports.Set("scrollToPid", Napi::Function::New(env, Mac_scrollToPid, "scrollToPid"));
  exports.Set("scrollToWindow", Napi::Function::New(env, Mac_scrollToWindow, "scrollToWindow"));
  exports.Set("scrollToWindowAsync", Napi::Function::New(env, Mac_scrollToWindowAsync, "scrollToWindowAsync"));
  exports.Set("selectText", Napi::Function::New(env, Mac_selectText, "selectText"));
  exports.Set("setCpsActivationDisabled", Napi::Function::New(env, Mac_setCpsActivationDisabled, "setCpsActivationDisabled"));
  exports.Set("setFocused", Napi::Function::New(env, Mac_setFocused, "setFocused"));
  exports.Set("setValue", Napi::Function::New(env, Mac_setValue, "setValue"));
  exports.Set("terminateApplicationVerified", Napi::Function::New(env, Mac_terminateApplicationVerified, "terminateApplicationVerified"));
  exports.Set("typeTextGlobal", Napi::Function::New(env, Mac_typeTextGlobal, "typeTextGlobal"));
  exports.Set("typeTextToPid", Napi::Function::New(env, Mac_typeTextToPid, "typeTextToPid"));
  exports.Set("typeTextToPidVerified", Napi::Function::New(env, Mac_typeTextToPidVerified, "typeTextToPidVerified"));
  exports.Set("verifyProcessCodeSignature", Napi::Function::New(env, Mac_verifyProcessCodeSignature, "verifyProcessCodeSignature"));
  exports.Set("verifyProcessCodeSignatureWithAuditToken", Napi::Function::New(env, Mac_verifyProcessCodeSignatureWithAuditToken, "verifyProcessCodeSignatureWithAuditToken"));
  return exports
}

NODE_API_MODULE(ax_native, InitAll)
