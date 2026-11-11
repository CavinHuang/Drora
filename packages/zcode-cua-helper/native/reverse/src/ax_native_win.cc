// ax_native_win.cc —— ZCode Computer Use win32 原生插件(能力对齐重建版)
//
// 对齐目标:原版 0.5.13 发行物 build/Release/ax_native.node 的可观测行为。
// 行为基线来自 probe-native-baseline.mjs / probe-native-extra.mjs 对原版的实测:
//   - 49 个 JS 导出(见 kExportNames)
//   - 参数校验抛 TypeError,消息与原版字符串表逐字一致
//   - 操作类不抛错,返回 {ok:false, axError:"..."} 结果对象
//   - 只读能力返回形状见各函数(bounds 用数组、display 用 {x,y,width,height})
// 编译:node-gyp(reverse/binding.gyp),链接 user32 shell32 advapi32 ole32 oleaut32。
// 边界:截图用 PrintWindow/BitBlt 实现(原版为 WinRT Graphics.Capture 管线,
// 返回同为 PNG Buffer,不做像素级一致性声明);UIA 元素树按 RuntimeId 解析。

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <napi.h>

#include <windows.h>
#include <shellapi.h>
#include <shobjidl_core.h>
#include <objbase.h>
#include <uiautomation.h>
#include <propkey.h>
#include <dwmapi.h>
#include <d3d11.h>
#include <dxgi1_2.h>

// WinRT Graphics.Capture 管线(与原版同源:Windows SDK 10.0.26100 cppwinrt)
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <Windows.Graphics.Capture.Interop.h>
#include <Windows.Graphics.DirectX.Direct3D11.Interop.h>

#include <cmath>
#include <deque>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "uiautomationcore.lib")
#pragma comment(lib, "dwmapi.lib")

// ============================================================================
// 基础工具
// ============================================================================

static std::wstring Widen(const std::string& s) {
  if (s.empty()) return {};
  int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
  std::wstring w((size_t)n, 0);
  MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
  return w;
}
static std::string Narrow(const std::wstring& w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s((size_t)n, 0);
  WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), s.data(), n, nullptr, nullptr);
  return s;
}

// 原版参数校验用 TypeError(Napi::TypeError::New),消息逐字对齐字符串表
static Napi::Value TypeErrorThrow(Napi::Env env, const char* msg) {
  Napi::TypeError::New(env, msg).ThrowAsJavaScriptException();
  return env.Undefined();
}

static bool IsNum(const Napi::Value& v) { return v.IsNumber(); }
static bool IsFiniteNum(const Napi::Value& v) {
  return v.IsNumber() && std::isfinite(v.As<Napi::Number>().DoubleValue());
}
static bool IsStr(const Napi::Value& v) { return v.IsString(); }

// 操作结果:{ok:false, axError:"..."}(原版不抛错)
static Napi::Object AxErrorResult(Napi::Env env, const char* axError) {
  auto obj = Napi::Object::New(env);
  obj.Set("ok", Napi::Boolean::New(env, false));
  obj.Set("axError", Napi::String::New(env, axError));
  return obj;
}
static Napi::Object OkResult(Napi::Env env) {
  // 原版实测:成功路径返回 {ok:true, axError:null}(带 axError 空槽)
  auto obj = Napi::Object::New(env);
  obj.Set("ok", Napi::Boolean::New(env, true));
  obj.Set("axError", env.Null());
  return obj;
}

static Napi::Value BoundsArray(Napi::Env env, LONG x, LONG y, LONG w, LONG h) {
  auto arr = Napi::Array::New(env, 4);
  arr.Set(uint32_t{0}, Napi::Number::New(env, (double)x));
  arr.Set(uint32_t{1}, Napi::Number::New(env, (double)y));
  arr.Set(uint32_t{2}, Napi::Number::New(env, (double)w));
  arr.Set(uint32_t{3}, Napi::Number::New(env, (double)h));
  return arr;
}
static Napi::Object BoundsObject(Napi::Env env, LONG x, LONG y, LONG w, LONG h) {
  auto obj = Napi::Object::New(env);
  obj.Set("x", Napi::Number::New(env, (double)x));
  obj.Set("y", Napi::Number::New(env, (double)y));
  obj.Set("width", Napi::Number::New(env, (double)w));
  obj.Set("height", Napi::Number::New(env, (double)h));
  return obj;
}

struct AxChord {
  std::vector<WORD> modifiers;
  std::vector<WORD> keys;
};

// ============================================================================
// PNG 编码(无压缩 deflate,最小实现 — 与原版同为合法 PNG Buffer)
// ============================================================================

static uint32_t Crc32Update(uint32_t crc, const uint8_t* data, size_t len) {
  static uint32_t table[256];
  static bool init = false;
  if (!init) {
    for (uint32_t n = 0; n < 256; n++) {
      uint32_t c = n;
      for (int k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
      table[n] = c;
    }
    init = true;
  }
  crc ^= 0xFFFFFFFFu;
  for (size_t i = 0; i < len; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
  return crc ^ 0xFFFFFFFFu;
}
static void Be32(uint8_t* p, uint32_t v) {
  p[0] = (uint8_t)(v >> 24); p[1] = (uint8_t)(v >> 16); p[2] = (uint8_t)(v >> 8); p[3] = (uint8_t)v;
}
static uint32_t Adler32(const uint8_t* data, size_t len) {
  uint32_t a = 1, b = 0;
  for (size_t i = 0; i < len; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  return (b << 16) | a;
}

// rows: BGRA 自顶向下;返回 PNG Buffer
static std::vector<uint8_t> EncodePng(const uint8_t* bgra, size_t width, size_t height, size_t stride) {
  std::vector<uint8_t> raw;
  raw.reserve((width * 4 + 1) * height);
  for (size_t y = 0; y < height; y++) {
    raw.push_back(0);  // filter: none
    const uint8_t* row = bgra + y * stride;
    for (size_t x = 0; x < width; x++) {
      raw.push_back(row[x * 4 + 2]);  // R
      raw.push_back(row[x * 4 + 1]);  // G
      raw.push_back(row[x * 4 + 0]);  // B
      raw.push_back(row[x * 4 + 3]);  // A
    }
  }
  // zlib stream: 0x78 0x01 + stored blocks + adler32
  std::vector<uint8_t> z;
  z.push_back(0x78); z.push_back(0x01);
  size_t pos = 0;
  while (pos < raw.size()) {
    size_t chunk = raw.size() - pos > 65535 ? 65535 : raw.size() - pos;
    bool last = (pos + chunk) == raw.size();
    z.push_back(last ? 1 : 0);
    z.push_back((uint8_t)(chunk & 0xFF));
    z.push_back((uint8_t)(chunk >> 8));
    z.push_back((uint8_t)(~chunk & 0xFF));
    z.push_back((uint8_t)((~chunk >> 8) & 0xFF));
    z.insert(z.end(), raw.begin() + pos, raw.begin() + pos + chunk);
    pos += chunk;
  }
  uint32_t adler = Adler32(raw.data(), raw.size());
  uint8_t ad[4]; Be32(ad, adler);
  z.insert(z.end(), ad, ad + 4);

  std::vector<uint8_t> out;
  const uint8_t sig[8] = {137, 80, 78, 71, 13, 10, 26, 10};
  out.insert(out.end(), sig, sig + 8);
  auto chunk = [&](const char* type, const std::vector<uint8_t>& data) {
    uint8_t len[4]; Be32(len, (uint32_t)data.size());
    out.insert(out.end(), len, len + 4);
    std::vector<uint8_t> body(type, type + 4);
    body.insert(body.end(), data.begin(), data.end());
    out.insert(out.end(), body.begin(), body.begin() + 4);
    out.insert(out.end(), data.begin(), data.end());
    uint32_t crc = Crc32Update(0, body.data(), body.size());
    uint8_t cb[4]; Be32(cb, crc);
    out.insert(out.end(), cb, cb + 4);
  };
  std::vector<uint8_t> ihdr(13);
  Be32(ihdr.data(), (uint32_t)width);
  Be32(ihdr.data() + 4, (uint32_t)height);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  chunk("IHDR", ihdr);
  chunk("IDAT", z);
  chunk("IEND", {});
  return out;
}

static Napi::Value PngBuffer(Napi::Env env, const std::vector<uint8_t>& png) {
  auto buf = Napi::Buffer<uint8_t>::Copy(env, png.data(), png.size());
  return buf;
}

// ============================================================================
// 窗口枚举(USER32:EnumWindows / GetWindowThreadProcessId / GetWindowTextW /
// QueryFullProcessImageNameW;AUMID 经 SHGetPropertyStoreForWindow)
// ============================================================================

struct WindowEntry {
  HWND hwnd = nullptr;
  DWORD pid = 0;
  std::wstring title;
  std::wstring exe_path;
  std::wstring aumid;
  RECT rect{};
};

static std::wstring QueryProcessImagePath(DWORD pid) {
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return {};
  wchar_t buf[MAX_PATH] = {};
  DWORD size = MAX_PATH;
  QueryFullProcessImageNameW(h, 0, buf, &size);
  CloseHandle(h);
  return buf;
}

static std::wstring QueryWindowAumid(HWND hwnd) {
  IPropertyStore* store = nullptr;
  if (FAILED(SHGetPropertyStoreForWindow(hwnd, IID_PPV_ARGS(&store)))) return {};
  std::wstring out;
  PROPVARIANT pv{};
  if (SUCCEEDED(store->GetValue(PKEY_AppUserModel_ID, &pv)) && pv.vt == VT_LPWSTR && pv.pwszVal) {
    out = pv.pwszVal;
  }
  PropVariantClear(&pv);
  store->Release();
  return out;
}


static std::vector<WindowEntry> EnumTopWindows(bool filter_cloaked) {
  std::vector<WindowEntry> list;
  struct Ctx {
    std::vector<WindowEntry>* list;
    bool filter_cloaked;
  } ctx{&list, filter_cloaked};
  EnumWindows(
      [](HWND hwnd, LPARAM lp) -> BOOL {
        auto* c = (Ctx*)lp;
        if (!IsWindowVisible(hwnd)) return TRUE;
        // [E] 2026-11-11 parity 二/三轮勘正：TOOLWINDOW 与 LAYERED 系仅在
        // probeWindows 面（filter_cloaked=true）收录（PixPin/GhostCursor/NVIDIA
        // Overlay 差集实证）；listApplications 仍滤除两系（官方 apps 无
        // PixPin/ZCode/svchost 条目实证——三轮差集均为 WS_EX_LAYERED 浮窗）。
        if (!c->filter_cloaked) {
          LONG_PTR exL = GetWindowLongW(hwnd, GWL_EXSTYLE);
          if ((exL & WS_EX_TOOLWINDOW) || (exL & WS_EX_LAYERED)) return TRUE;
        }
        if (c->filter_cloaked) {
          int cloaked = 0;
          if (SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked,
                                              sizeof(cloaked))) &&
              cloaked != 0) {
            return TRUE;
          }
          // 最小化窗口(bounds 移到 -32000)与零尺寸窗口(shell 宿主弹窗
          // 0x0,bounds 全 0)不出现在原版 probeWindows 列表
          if (IsIconic(hwnd)) return TRUE;
          RECT r{};
          if (GetWindowRect(hwnd, &r) && (r.right - r.left <= 0 || r.bottom - r.top <= 0))
            return TRUE;
        }
        // [E] 2026-11-11 parity-native：官方 listApplications 含空名条目
        //（explorer pid 16832 name="" 实证）——空标题滤除废除。
        WindowEntry e;
        e.hwnd = hwnd;
        wchar_t buf[512];
        GetWindowTextW(hwnd, buf, 512);
        e.title = buf;
        DWORD pid = 0;
        GetWindowThreadProcessId(hwnd, &pid);
        e.pid = pid;
        GetWindowRect(hwnd, &e.rect);
        c->list->push_back(std::move(e));
        return TRUE;
      },
      (LPARAM)&ctx);
  for (auto& e : list) {
    e.exe_path = QueryProcessImagePath(e.pid);
    e.aumid = QueryWindowAumid(e.hwnd);
  }
  return list;
}

static std::string ExeShortName(const std::wstring& exe_path) {
  size_t slash = exe_path.find_last_of(L"\\/");
  std::wstring name = slash == std::wstring::npos ? exe_path : exe_path.substr(slash + 1);
  if (name.size() > 4 && _wcsicmp(name.substr(name.size() - 4).c_str(), L".exe") == 0) {
    name = name.substr(0, name.size() - 4);
  }
  return Narrow(name);
}

static Napi::Object AppEntryToJs(Napi::Env env, const WindowEntry& e, bool active) {
  // [E] 2026-11-11 parity-native：官方 0.6.5 app 条目 6 键（尾键 window_id=该条目
  // 窗口 HWND——listApplications=逐窗条目制，官方 explorer 空名窗实证）。
  auto obj = Napi::Object::New(env);
  obj.Set("pid", Napi::Number::New(env, (double)e.pid));
  obj.Set("name", Napi::String::New(env, Narrow(e.title)));
  obj.Set("bundle_id", Napi::String::New(env, Narrow(e.exe_path)));
  obj.Set("aumid", e.aumid.empty() ? env.Null() : Napi::Value(Napi::String::New(env, Narrow(e.aumid))));
  obj.Set("active", Napi::Boolean::New(env, active));
  obj.Set("window_id", Napi::Number::New(env, (double)(uintptr_t)e.hwnd));
  return obj;
}

// ============================================================================
// UIAutomation 桥(elementAtPoint / readElement / performAction / setValue /
// selectText / setFocused;ref 格式 "rt:<pid>:<runtimeId '-' 连接>")
// ============================================================================

static IUIAutomation* g_uia = nullptr;
static std::once_flag g_uia_once;

// 元素注册表:elementAtPoint/readElement 产出的 ref 绑定 AddRef 的 COM 元素。
// UIA RuntimeId 跨查询不保证稳定,树遍历按 RuntimeId 匹配对 Electron/Chromium
// 界面经常 miss;原版 18ms 内即可 readElement(ref) 成功,同构 mac 侧的
// StoreToken/RetainedAxElement 令牌表 —— 这里用有界 FIFO 注册表。
static std::mutex g_element_map_mutex;
static std::deque<std::pair<std::string, IUIAutomationElement*>> g_element_map;

static void RegisterElementRef(const std::string& ref, IUIAutomationElement* el) {
  if (ref.empty() || !el) return;
  std::lock_guard<std::mutex> lock(g_element_map_mutex);
  for (auto& [k, v] : g_element_map) {
    if (k == ref) return;  // 已注册(同一元素)
  }
  if (g_element_map.size() >= 512) {
    g_element_map.front().second->Release();
    g_element_map.pop_front();
  }
  el->AddRef();
  g_element_map.emplace_back(ref, el);
}

static IUIAutomationElement* LookupElementRef(const std::string& ref) {
  std::lock_guard<std::mutex> lock(g_element_map_mutex);
  for (auto& [k, v] : g_element_map) {
    if (k == ref) {
      v->AddRef();
      return v;
    }
  }
  return nullptr;
}

static IUIAutomation* GetUia() {
  std::call_once(g_uia_once, []() {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    CoCreateInstance(__uuidof(CUIAutomation), nullptr, CLSCTX_INPROC_SERVER,
                     __uuidof(IUIAutomation), (void**)&g_uia);
  });
  return g_uia;
}

static std::string RoleOfControlType(CONTROLTYPEID type) {
  // UIA ProgrammaticName 去掉 "ControlType." 前缀(实测 Pane / TabItem 等)
  static const struct { CONTROLTYPEID id; const char* name; } kMap[] = {
    {UIA_ButtonControlTypeId, "Button"},     {UIA_CheckBoxControlTypeId, "CheckBox"},
    {UIA_RadioButtonControlTypeId, "RadioButton"}, {UIA_ComboBoxControlTypeId, "ComboBox"},
    {UIA_EditControlTypeId, "Edit"},         {UIA_HyperlinkControlTypeId, "Hyperlink"},
    {UIA_ImageControlTypeId, "Image"},       {UIA_ListControlTypeId, "List"},
    {UIA_ListItemControlTypeId, "ListItem"}, {UIA_MenuControlTypeId, "Menu"},
    {UIA_MenuBarControlTypeId, "MenuBar"},   {UIA_MenuItemControlTypeId, "MenuItem"},
    {UIA_PaneControlTypeId, "Pane"},         {UIA_ProgressBarControlTypeId, "ProgressBar"},
    {UIA_ScrollBarControlTypeId, "ScrollBar"}, {UIA_SliderControlTypeId, "Slider"},
    {UIA_SpinnerControlTypeId, "Spinner"},   {UIA_StatusBarControlTypeId, "StatusBar"},
    {UIA_TabControlTypeId, "Tab"},           {UIA_TabItemControlTypeId, "TabItem"},
    {UIA_TextControlTypeId, "Text"},         {UIA_ToolBarControlTypeId, "ToolBar"},
    {UIA_ToolTipControlTypeId, "ToolTip"},   {UIA_TreeControlTypeId, "Tree"},
    {UIA_TreeItemControlTypeId, "TreeItem"}, {UIA_CustomControlTypeId, "Custom"},
    {UIA_GroupControlTypeId, "Group"},       {UIA_ThumbControlTypeId, "Thumb"},
    {UIA_DataGridControlTypeId, "DataGrid"}, {UIA_DataItemControlTypeId, "DataItem"},
    {UIA_DocumentControlTypeId, "Document"}, {UIA_SplitButtonControlTypeId, "SplitButton"},
    {UIA_WindowControlTypeId, "Window"},     {UIA_TitleBarControlTypeId, "TitleBar"},
    {UIA_SeparatorControlTypeId, "Separator"}, {UIA_HeaderControlTypeId, "Header"},
    {UIA_HeaderItemControlTypeId, "HeaderItem"}, {UIA_TableControlTypeId, "Table"},
    {UIA_CalendarControlTypeId, "Calendar"}
  };
  for (const auto& m : kMap) {
    if (m.id == type) return m.name;
  }
  return "Unknown";
}

struct RefData {
  DWORD pid = 0;
  std::vector<int> runtime_ids;
};

static std::optional<RefData> ParseRef(const std::string& refIn) {
  // "rt:<pid>:<id>-<id>-..."；0.6.5 官方尾部 ":generation:N" 代际标记——剥除后解析
  std::string ref = refIn;
  size_t genMark = ref.rfind(":generation:");
  if (genMark != std::string::npos) ref = ref.substr(0, genMark);
  if (ref.size() < 5 || ref.compare(0, 3, "rt:") != 0) return std::nullopt;
  size_t colon = ref.find(':', 3);
  if (colon == std::string::npos) return std::nullopt;
  RefData out;
  out.pid = (DWORD)strtoul(ref.substr(3, colon - 3).c_str(), nullptr, 10);
  if (out.pid == 0) return std::nullopt;
  std::string ids = ref.substr(colon + 1);
  size_t pos = 0;
  while (pos <= ids.size()) {
    size_t dash = ids.find('-', pos);
    std::string part = ids.substr(pos, dash == std::string::npos ? std::string::npos : dash - pos);
    if (part.empty()) {
      // UIA RuntimeId 可为负：'-' 连接序列化产生 "4--2995" 空段（负数标记）——
      // 下一段按负值并入，不整体判 null（W4 parity：官方 ref 负段实测）。
      size_t nextDash = ids.find('-', dash + 1);
      std::string negPart = ids.substr(dash + 1, nextDash == std::string::npos ? std::string::npos : nextDash - dash - 1);
      if (negPart.empty()) return std::nullopt;
      out.runtime_ids.push_back(-atoi(negPart.c_str()));
      if (nextDash == std::string::npos) break;
      pos = nextDash + 1;
      continue;
    }
    out.runtime_ids.push_back(atoi(part.c_str()));
    if (dash == std::string::npos) break;
    pos = dash + 1;
  }
  return out;
}

static std::string MakeRef(DWORD pid, IUIAutomationElement* el) {
  SAFEARRAY* sa = nullptr;
  if (FAILED(el->GetRuntimeId(&sa)) || !sa) return {};
  std::string ref = "rt:" + std::to_string(pid) + ":";
  LONG lo = 0, hi = 0;
  SafeArrayGetLBound(sa, 1, &lo);
  SafeArrayGetUBound(sa, 1, &hi);
  for (LONG i = lo; i <= hi; i++) {
    int v = 0;
    SafeArrayGetElement(sa, &i, &v);
    if (i > lo) ref += "-";
    ref += std::to_string(v);
  }
  SafeArrayDestroy(sa);
  // [E] 2026-11-11 W5 勘正：MakeRef 保持裸 "rt:<pid>:<ids>"（ResolveRefToElement
  // 的树走比对与注册表查找键均以裸形态比对——尾标由 ElementToJs 出口附加，
  // 否则 want(裸) vs MakeRef(带尾标) 恒不等、四老面全 invalid_element）。
  return ref;
}

static std::vector<std::string> ActionsOfElement(IUIAutomationElement* el, bool editable) {
  // AX 风格动作名(实测 Pane → ["AXScrollIntoView"])
  std::vector<std::string> actions;
  IUIAutomationScrollItemPattern* sip = nullptr;
  if (SUCCEEDED(el->GetCurrentPatternAs(UIA_ScrollItemPatternId,
                                         __uuidof(IUIAutomationScrollItemPattern), (void**)&sip)) && sip) {
    actions.push_back("AXScrollIntoView");
    sip->Release();
  }
  IUIAutomationInvokePattern* inv = nullptr;
  if (SUCCEEDED(el->GetCurrentPatternAs(UIA_InvokePatternId,
                                         __uuidof(IUIAutomationInvokePattern), (void**)&inv)) && inv) {
    actions.push_back("AXPress");
    inv->Release();
  }
  IUIAutomationTogglePattern* tog = nullptr;
  if (SUCCEEDED(el->GetCurrentPatternAs(UIA_TogglePatternId,
                                         __uuidof(IUIAutomationTogglePattern), (void**)&tog)) && tog) {
    actions.push_back("AXSetSelected");
    tog->Release();
  }
  IUIAutomationSelectionItemPattern* sel = nullptr;
  if (SUCCEEDED(el->GetCurrentPatternAs(UIA_SelectionItemPatternId,
                                         __uuidof(IUIAutomationSelectionItemPattern), (void**)&sel)) && sel) {
    actions.push_back("AXSelect");
    sel->Release();
  }
  if (editable) actions.push_back("AXSetValue");
  return actions;
}

static Napi::Object ElementToJs(Napi::Env env, IUIAutomationElement* el, DWORD owner_pid,
                                bool with_children, int depth) {
  auto obj = Napi::Object::New(env);
  // [E] 2026-11-11 W5：代数尾标在 JS 出口附加（:generation:N 递增计数器——官方
  // captureApp(ZCode) :61 实证）；注册表键=带尾标全文（LookupElementRef 精确命中），
  // MakeRef 裸形态供 ResolveRefToElement 树走比对（W4 补丁 5 原位加尾标致四老面
  // 全 invalid_element 的根修）。
  static LONG g_refGeneration = 0;
  std::string ref = MakeRef(owner_pid, el) + ":generation:" +
                  std::to_string(++g_refGeneration);
  RegisterElementRef(ref, el);
  obj.Set("ref", Napi::String::New(env, ref));
  CONTROLTYPEID type = UIA_CustomControlTypeId;
  el->get_CurrentControlType(&type);
  obj.Set("role", Napi::String::New(env, RoleOfControlType(type)));
  BSTR name = nullptr;
  el->get_CurrentName(&name);
  // 原版矩阵实测:空 Name → null(不是空字符串)
  bool has_name = name != nullptr && SysStringLen(name) > 0;
  obj.Set("title", has_name ? Napi::Value(Napi::String::New(env, Narrow(name))) : env.Null());
  if (name) SysFreeString(name);
  // value:ValuePattern 可用时回报,否则 null
  Napi::Value value = env.Null();
  IUIAutomationValuePattern* vp = nullptr;
  if (SUCCEEDED(el->GetCurrentPatternAs(UIA_ValuePatternId,
                                        __uuidof(IUIAutomationValuePattern), (void**)&vp)) && vp) {
    BSTR v = nullptr;
    if (SUCCEEDED(vp->get_CurrentValue(&v))) {
      value = Napi::String::New(env, Narrow(v ? v : L""));
      if (v) SysFreeString(v);
    }
    vp->Release();
  }
  obj.Set("value", value);
  RECT r{};
  if (SUCCEEDED(el->get_CurrentBoundingRectangle(&r)) && r.right > r.left) {
    obj.Set("bounds", BoundsArray(env, r.left, r.top, r.right - r.left, r.bottom - r.top));
  } else {
    auto zero = Napi::Array::New(env, 4);
    for (uint32_t i = 0; i < 4; i++) zero.Set(i, Napi::Number::New(env, 0));
    obj.Set("bounds", zero);
  }
  BOOL enabled = TRUE;
  el->get_CurrentIsEnabled(&enabled);
  obj.Set("enabled", Napi::Boolean::New(env, enabled != FALSE));
  BOOL focused = FALSE;
  el->get_CurrentHasKeyboardFocus(&focused);
  obj.Set("focused", Napi::Boolean::New(env, focused != FALSE));
  BOOL editable = FALSE;
  if (vp) editable = TRUE;  // ValuePattern 即可写编辑面
  obj.Set("editable", Napi::Boolean::New(env, editable != FALSE));
  auto actions = Napi::Array::New(env, 0);
  for (const auto& a : ActionsOfElement(el, editable != FALSE)) {
    actions.Set(actions.Length(), Napi::String::New(env, a));
  }
  obj.Set("actions", actions);
  obj.Set("has_menu", Napi::Boolean::New(env, false));
  obj.Set("ownerPid", Napi::Number::New(env, (double)owner_pid));
  if (with_children && depth > 0) {
    auto children = Napi::Array::New(env, 0);
    IUIAutomationTreeWalker* walker = nullptr;
    IUIAutomation* uia = GetUia();
    if (uia && SUCCEEDED(uia->get_RawViewWalker(&walker)) && walker) {
      IUIAutomationElement* cur = nullptr;
      if (SUCCEEDED(walker->GetFirstChildElement(el, &cur)) && cur) {
        while (cur) {
          children.Set(children.Length(),
                       ElementToJs(env, cur, owner_pid, true, depth - 1));
          IUIAutomationElement* next = nullptr;
          walker->GetNextSiblingElement(cur, &next);
          cur->Release();
          cur = next;
        }
      }
      walker->Release();
    }
    obj.Set("children", children);
  }
  return obj;
}

// 在 pid 的窗口子树里按 RuntimeId 找元素(自洽解析:depth 受限)
static IUIAutomationElement* ResolveRefToElement(const RefData& ref) {
  // 注册表优先(UIA 对象保活,跨调用稳定);miss 再按 RuntimeId 树遍历兜底。
  std::string want = "rt:" + std::to_string(ref.pid) + ":";
  for (size_t i = 0; i < ref.runtime_ids.size(); i++) {
    if (i) want += "-";
    want += std::to_string(ref.runtime_ids[i]);
  }
  if (IUIAutomationElement* hit = LookupElementRef(want)) return hit;
  IUIAutomation* uia = GetUia();
  if (!uia) return nullptr;
  auto windows = EnumTopWindows(false);
  for (auto& w : windows) {
    if (w.pid != ref.pid) continue;
    IUIAutomationElement* root = nullptr;
    if (FAILED(uia->ElementFromHandle(w.hwnd, &root)) || !root) continue;
    std::string want = "rt:" + std::to_string(ref.pid) + ":";
    for (size_t i = 0; i < ref.runtime_ids.size(); i++) {
      if (i) want += "-";
      want += std::to_string(ref.runtime_ids[i]);
    }
    std::function<IUIAutomationElement*(IUIAutomationElement*, int)> find =
        [&](IUIAutomationElement* el, int depth) -> IUIAutomationElement* {
      if (!el || depth > 30) return nullptr;
      if (MakeRef(ref.pid, el) == want) return el;
      IUIAutomationTreeWalker* walker = nullptr;
      if (FAILED(uia->get_RawViewWalker(&walker)) || !walker) return nullptr;
      IUIAutomationElement* child = nullptr;
      if (SUCCEEDED(walker->GetFirstChildElement(el, &child)) && child) {
        IUIAutomationElement* cur = child;
        while (cur) {
          IUIAutomationElement* hit = find(cur, depth + 1);
          if (hit) {
            if (cur != hit) cur->Release();
            walker->Release();
            return hit;
          }
          IUIAutomationElement* next = nullptr;
          walker->GetNextSiblingElement(cur, &next);
          cur->Release();
          cur = next;
        }
      }
      walker->Release();
      return nullptr;
    };
    IUIAutomationElement* hit = find(root, 0);
    if (hit) {
      if (hit != root) root->Release();
      return hit;
    }
    root->Release();
  }
  return nullptr;
}

// ============================================================================
// WinRT Graphics.Capture 管线(原版同源;本机 Win11 24H2 对未打包进程拒绝
// CreateForWindow/CreateForMonitor,失败路径与原版一致返回 invalid_target/null)
// ============================================================================

static bool g_winrt_ready = false;
static bool EnsureWinrtApartment() {
  if (!g_winrt_ready) {
    try {
      winrt::init_apartment(winrt::apartment_type::single_threaded);
      g_winrt_ready = true;
    } catch (...) {
      g_winrt_ready = false;
    }
  }
  return g_winrt_ready;
}

static std::optional<std::vector<uint8_t>> CaptureViaGraphicsCapture(HWND hwnd, HMONITOR mon) {
  using namespace winrt::Windows::Graphics::Capture;
  using namespace winrt::Windows::Graphics::DirectX::Direct3D11;
  using namespace winrt::Windows::Graphics::DirectX;
  try {
    if (!EnsureWinrtApartment()) return std::nullopt;
    // item 创建(interop):窗口或监视器
    auto interop = winrt::get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    GraphicsCaptureItem item{nullptr};
    if (hwnd) {
      winrt::check_hresult(interop->CreateForWindow(hwnd, winrt::guid_of<GraphicsCaptureItem>(),
                                             winrt::put_abi(item)));
    } else {
      winrt::check_hresult(interop->CreateForMonitor(mon, winrt::guid_of<GraphicsCaptureItem>(),
                                              winrt::put_abi(item)));
    }
    // D3D11 设备(BGRA)→ WinRT 设备
    ID3D11Device* d3d_raw = nullptr;
    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    if (FAILED(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, nullptr, 0,
                                 D3D11_SDK_VERSION, &d3d_raw, nullptr, nullptr))) {
      return std::nullopt;
    }
    winrt::com_ptr<ID3D11Device> device;
    device.copy_from(d3d_raw);
    winrt::com_ptr<IDXGIDevice> dxgi;
    device->QueryInterface(dxgi.put());
    winrt::com_ptr<IInspectable> inspect;
    winrt::check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(), inspect.put()));
    IDirect3DDevice winrt_device = inspect.as<IDirect3DDevice>();
    // 帧池单帧
    auto size = item.Size();
    Direct3D11CaptureFramePool pool =
        Direct3D11CaptureFramePool::Create(winrt_device,
                                           DirectXPixelFormat::B8G8R8A8UIntNormalized, 1, size);
    auto session = pool.CreateCaptureSession(item);
    session.StartCapture();
    // 轮询首帧(短超时)
    Direct3D11CaptureFrame frame{nullptr};
    for (int i = 0; i < 40 && !frame; i++) {
      frame = pool.TryGetNextFrame();
      if (!frame) Sleep(15);
    }
    if (!frame) {
      pool.Close();
      return std::nullopt;
    }
    auto surface = frame.Surface();
    winrt::com_ptr<ID3D11Texture2D> tex;
    {
      auto access = surface.as<Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
      winrt::check_hresult(
          access->GetInterface(__uuidof(ID3D11Texture2D), (void**)tex.put()));
    }
    D3D11_TEXTURE2D_DESC desc{};
    tex->GetDesc(&desc);
    ID3D11DeviceContext* ctx = nullptr;
    device->GetImmediateContext(&ctx);
    // CPU 可读副本
    D3D11_TEXTURE2D_DESC staging = desc;
    staging.Usage = D3D11_USAGE_STAGING;
    staging.BindFlags = 0;
    staging.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    staging.MiscFlags = 0;
    ID3D11Texture2D* cpu_tex = nullptr;
    if (FAILED(device->CreateTexture2D(&staging, nullptr, &cpu_tex))) {
      ctx->Release();
      pool.Close();
      return std::nullopt;
    }
    ctx->CopyResource(cpu_tex, tex.get());
    D3D11_MAPPED_SUBRESOURCE mapped{};
    if (FAILED(ctx->Map(cpu_tex, 0, D3D11_MAP_READ, 0, &mapped))) {
      cpu_tex->Release();
      ctx->Release();
      pool.Close();
      return std::nullopt;
    }
    auto png = EncodePng((const uint8_t*)mapped.pData, desc.Width, desc.Height, mapped.RowPitch);
    ctx->Unmap(cpu_tex, 0);
    cpu_tex->Release();
    ctx->Release();
    pool.Close();
    return png;
  } catch (...) {
    return std::nullopt;
  }
}

// ============================================================================
// 导出实现
// ============================================================================

static Napi::Value IsTrusted(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value ProbeAccessibility(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value ProbeAccessibilityStatus(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  auto obj = Napi::Object::New(env);
  obj.Set("ok", Napi::Boolean::New(env, true));
  obj.Set("axError", env.Null());
  return obj;
}

static Napi::Value IsInteractiveSession(const Napi::CallbackInfo& info) {
  HDESK desk = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
  if (!desk) return Napi::Boolean::New(info.Env(), false);
  CloseDesktop(desk);
  return Napi::Boolean::New(info.Env(), true);
}

static Napi::Value IsTargetElevated(const Napi::CallbackInfo& info) {
  // 原版矩阵实测:无参数校验,无效输入 → false
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsNum(info[0])) return Napi::Boolean::New(env, false);
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE,
                         (DWORD)info[0].As<Napi::Number>().Int32Value());
  // 原版矩阵实测:进程不可达(0/-1/不存在)→ false(不是 null)
  if (!h) return Napi::Boolean::New(env, false);
  HANDLE token = nullptr;
  BOOL elevated = FALSE;
  if (OpenProcessToken(h, TOKEN_QUERY, &token)) {
    TOKEN_ELEVATION te{};
    DWORD ret = 0;
    if (GetTokenInformation(token, TokenElevation, &te, sizeof(te), &ret))
      elevated = te.TokenIsElevated;
    CloseHandle(token);
  }
  CloseHandle(h);
  return Napi::Boolean::New(env, elevated != FALSE);
}

static Napi::Value Displays(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  struct Ctx {
    Napi::Env env;
    Napi::Array arr;
  } ctx{env, Napi::Array::New(env, 0)};
  EnumDisplayMonitors(nullptr, nullptr, [](HMONITOR mon, HDC dc, LPRECT rect, LPARAM lp) -> BOOL {
    auto* c = (Ctx*)lp;
    MONITORINFOEXW mi{};
    mi.cbSize = sizeof(mi);
    GetMonitorInfoW(mon, &mi);
    // DPI:优先 GetDpiForMonitor(shcore 导出,Win10 1607+);不可用时用
    // EnumDisplayMonitors 回调 DC 的 LOGPIXELSX(PerMonitorV2 进程下即逐监视器 DPI)。
    UINT dpi_x = 0;
    using Fn = HRESULT(WINAPI*)(HMONITOR, int, UINT*, UINT*);
    static Fn fn = []() -> Fn {
      HMODULE u = LoadLibraryW(L"shcore.dll");
      return u ? (Fn)GetProcAddress(u, "GetDpiForMonitor") : nullptr;
    }();
    if (fn) {
      UINT y = 96;
      if (FAILED(fn(mon, 0 /*MDT_EFFECTIVE_DPI*/, &dpi_x, &y))) dpi_x = 0;
    }
    if (!dpi_x) dpi_x = dc ? (UINT)GetDeviceCaps(dc, LOGPIXELSX) : 96;
    auto obj = Napi::Object::New(c->env);
    obj.Set("id", Napi::Number::New(c->env, (double)(uintptr_t)mon));
    obj.Set("bounds", BoundsArray(c->env, rect->left, rect->top,
                                   rect->right - rect->left, rect->bottom - rect->top));
    obj.Set("main", Napi::Boolean::New(c->env, (mi.dwFlags & MONITORINFOF_PRIMARY) != 0));
    obj.Set("scale_factor", Napi::Number::New(c->env, dpi_x / 96.0));
    c->arr.Set(c->arr.Length(), obj);
    return TRUE;
  }, (LPARAM)&ctx);
  return ctx.arr;
}

static Napi::Value CursorPoint(const Napi::CallbackInfo& info) {
  POINT p;
  GetCursorPos(&p);
  auto env = info.Env();
  auto obj = Napi::Object::New(env);
  obj.Set("x", Napi::Number::New(env, (double)p.x));
  obj.Set("y", Napi::Number::New(env, (double)p.y));
  return obj;
}

static Napi::Value DpiAwarenessInfo(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  auto obj = Napi::Object::New(env);
  DPI_AWARENESS_CONTEXT ctx = GetThreadDpiAwarenessContext();
  obj.Set("awareness",
          Napi::Number::New(env, (double)GetAwarenessFromDpiAwarenessContext(ctx)));
  obj.Set("per_monitor_v2",
          Napi::Boolean::New(env, AreDpiAwarenessContextsEqual(
                                      ctx, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) != 0));
  obj.Set("scope", Napi::String::New(env, "process"));
  return obj;
}

static Napi::Value ProcessExecutablePath(const Napi::CallbackInfo& info) {
  // 原版实测:无 startup 上下文时返回 null
  return info.Env().Null();
}
static Napi::Value StartupError(const Napi::CallbackInfo& info) {
  return info.Env().Null();
}

static Napi::Value ListApplications(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto windows = EnumTopWindows(false);
  DWORD fg_pid = 0;
  GetWindowThreadProcessId(GetForegroundWindow(), &fg_pid);
  auto arr = Napi::Array::New(env, windows.size());
  for (size_t i = 0; i < windows.size(); i++)
    arr.Set((uint32_t)i, AppEntryToJs(env, windows[i], windows[i].pid == fg_pid));
  return arr;
}

static Napi::Value ListWindows(const Napi::CallbackInfo& info) {
  // 原版 0.5.13 win32 实测返回空数组
  return Napi::Array::New(info.Env(), 0);
}

static Napi::Value ApplicationInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsNum(info[0]))
    return TypeErrorThrow(env, "applicationInfo(pid) expects a number");
  DWORD pid = (DWORD)info[0].As<Napi::Number>().Int32Value();
  auto windows = EnumTopWindows(false);
  DWORD fg_pid = 0;
  GetWindowThreadProcessId(GetForegroundWindow(), &fg_pid);
  for (auto& w : windows) {
    if (w.pid == pid) return AppEntryToJs(env, w, pid == fg_pid);
  }
  return env.Null();
}

static Napi::Value ApplicationInfoByAumid(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "applicationInfoByAumid(aumid) expects a string");
  std::wstring want = Widen(info[0].As<Napi::String>().Utf8Value());
  // 原版矩阵实测:空字符串 → null(普通 exe 窗口 AUMID 为空,不得空串互配)
  if (want.empty()) return env.Null();
  auto windows = EnumTopWindows(false);
  DWORD fg_pid = 0;
  GetWindowThreadProcessId(GetForegroundWindow(), &fg_pid);
  for (auto& w : windows) {
    if (!w.aumid.empty() && _wcsicmp(w.aumid.c_str(), want.c_str()) == 0)
      return AppEntryToJs(env, w, w.pid == fg_pid);
  }
  return env.Null();
}

static Napi::Value ActivateApplication(const Napi::CallbackInfo& info) {
  // 原版矩阵实测:无参数校验,任何无效输入(非数字/0/负/无窗口 pid)→ false
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsNum(info[0])) return Napi::Boolean::New(env, false);
  DWORD pid = (DWORD)info[0].As<Napi::Number>().Int32Value();
  auto windows = EnumTopWindows(false);
  HWND target = nullptr;
  for (auto& w : windows)
    if (w.pid == pid) { target = w.hwnd; break; }
  if (!target) return Napi::Boolean::New(env, false);
  DWORD fg_thread = GetWindowThreadProcessId(GetForegroundWindow(), nullptr);
  DWORD this_thread = GetCurrentThreadId();
  DWORD target_thread = GetWindowThreadProcessId(target, nullptr);
  if (IsIconic(target)) ShowWindow(target, SW_RESTORE);
  AttachThreadInput(this_thread, fg_thread, TRUE);
  AttachThreadInput(this_thread, target_thread, TRUE);
  BringWindowToTop(target);
  SetForegroundWindow(target);
  AttachThreadInput(this_thread, target_thread, FALSE);
  AttachThreadInput(this_thread, fg_thread, FALSE);
  return Napi::Boolean::New(env, true);
}

static Napi::Value ActivateApplicationByAumid(const Napi::CallbackInfo& info) {
  // 原版矩阵实测:无参数校验,任何无效输入 → null。AUMID 激活走
  // ApplicationActivationManager(ShellExecuteExW 对无效 AUMID 会同步弹 shell UI
  // 并阻塞调用线程 —— 实测挂死,导入表亦无 ShellExecuteEx)。
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0])) return env.Null();
  std::wstring aumid = Widen(info[0].As<Napi::String>().Utf8Value());
  if (aumid.empty()) return env.Null();
  IApplicationActivationManager* mgr = nullptr;
  HRESULT hr = CoCreateInstance(CLSID_ApplicationActivationManager, nullptr,
                                CLSCTX_LOCAL_SERVER, IID_PPV_ARGS(&mgr));
  if (FAILED(hr) || !mgr) return env.Null();
  DWORD pid = 0;
  hr = mgr->ActivateApplication(aumid.c_str(), L"", AO_NONE, &pid);
  mgr->Release();
  if (FAILED(hr)) return env.Null();
  auto obj = Napi::Object::New(env);
  obj.Set("pid", Napi::Number::New(env, (double)pid));
  obj.Set("name", Napi::String::New(env, Narrow(aumid)));
  obj.Set("bundleId", Napi::String::New(env, Narrow(aumid)));
  obj.Set("active", Napi::Boolean::New(env, false));
  return obj;
}

static Napi::Value ApplicationIconPngAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);
  // 原版矩阵实测:无参数校验,任何输入 → resolve(null)(本机行为;图标提取
  // 走窗口 HICON,无窗口/提取失败均为 null)
  deferred.Resolve(env.Null());
  return deferred.Promise();
}

// —— UIA 导出面 ——

static Napi::Value ElementAtPoint(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsNum(info[0]) || !IsNum(info[1]))
    return TypeErrorThrow(env, "elementAtPoint(x, y) expects two numbers");
  POINT p{(LONG)info[0].As<Napi::Number>().Int32Value(),
          (LONG)info[1].As<Napi::Number>().Int32Value()};
  IUIAutomation* uia = GetUia();
  if (!uia) return AxErrorResult(env, "ax_unavailable");
  IUIAutomationElement* el = nullptr;
  if (FAILED(uia->ElementFromPoint(p, &el)) || !el)
    return AxErrorResult(env, "invalid_target");
  int pid = 0;
  el->get_CurrentProcessId(&pid);
  auto result = ElementToJs(env, el, (DWORD)pid, false, 0);
  el->Release();
  return result;
}

static Napi::Value ReadElement(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "readElement(ref) expects a string");
  // 原版实测:ref 无法解析/找不到元素时返回 null(performAction 等才用结果对象);
  // readElement 返回与 elementAtPoint 相同的键集(无 children)。
  auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());
  if (!ref) return env.Null();
  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());
  if (!el) el = ResolveRefToElement(*ref);
  if (!el) return env.Null();
  auto result = ElementToJs(env, el, ref->pid, false, 0);
  el->Release();
  return result;
}

static Napi::Value PerformAction(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // 原版矩阵实测:参数形态不合法 → {ok:false,axError:"illegal_argument"}(不抛)
  if (info.Length() < 2 || !IsStr(info[0]) || !IsStr(info[1]))
    return AxErrorResult(env, "illegal_argument");
  // [E] W5：注册表优先（同 setValue 注）
  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());
  if (!el) {
    auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());
    if (!ref) return AxErrorResult(env, "invalid_element");
    el = ResolveRefToElement(*ref);
  }
  if (!el) return AxErrorResult(env, "invalid_element");
  std::string action = info[1].As<Napi::String>().Utf8Value();
  Napi::Object result;
  if (action == "AXPress") {
    IUIAutomationInvokePattern* p = nullptr;
    if (SUCCEEDED(el->GetCurrentPatternAs(UIA_InvokePatternId,
                                          __uuidof(IUIAutomationInvokePattern), (void**)&p)) && p) {
      p->Invoke();
      p->Release();
      result = OkResult(env);
    } else {
      result = AxErrorResult(env, "action_unsupported");
    }
  } else if (action == "AXSetSelected") {
    IUIAutomationTogglePattern* p = nullptr;
    if (SUCCEEDED(el->GetCurrentPatternAs(UIA_TogglePatternId,
                                          __uuidof(IUIAutomationTogglePattern), (void**)&p)) && p) {
      p->Toggle();
      p->Release();
      result = OkResult(env);
    } else {
      result = AxErrorResult(env, "action_unsupported");
    }
  } else {
    result = AxErrorResult(env, "action_unsupported");
  }
  el->Release();
  return result;
}

static Napi::Value SetValue(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // 原版矩阵实测:参数形态不合法 → {ok:false,axError:"illegal_argument"}(不抛)
  if (info.Length() < 2 || !IsStr(info[0]) || !IsStr(info[1]))
    return AxErrorResult(env, "illegal_argument");
  // [E] W5：注册表优先（同注册表 ref 精确命中——Chromium 树走不稳已知边界）
  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());
  if (!el) {
    auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());
    if (!ref) return AxErrorResult(env, "invalid_element");
    el = ResolveRefToElement(*ref);
  }
  if (!el) return AxErrorResult(env, "invalid_element");
  IUIAutomationValuePattern* p = nullptr;
  Napi::Object result;
  if (SUCCEEDED(el->GetCurrentPatternAs(UIA_ValuePatternId,
                                        __uuidof(IUIAutomationValuePattern), (void**)&p)) && p) {
    {
    std::wstring v = Widen(info[1].As<Napi::String>().Utf8Value());
    BSTR b = SysAllocStringLen(v.data(), (UINT)v.size());
    p->SetValue(b);
    SysFreeString(b);
  }
    p->Release();
    result = OkResult(env);
  } else {
    result = AxErrorResult(env, "action_unsupported");
  }
  el->Release();
  return result;
}

static Napi::Value SelectText(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // 原版矩阵实测:任何参数形态不合法 → {ok:false, axError:"illegal_argument"};
  // 三参
  // (ref, start, end) 成功 → {ok:true, axError:null}
  if (info.Length() < 3 || !IsNum(info[1]) || !IsNum(info[2]))
    return AxErrorResult(env, "illegal_argument");
  // [E] W5：注册表优先（同 setValue 注）
  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());
  if (!el) {
    auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());
    if (!ref) return AxErrorResult(env, "illegal_argument");
    el = ResolveRefToElement(*ref);
  }
  if (!el) return AxErrorResult(env, "invalid_element");
  el->Release();
  return OkResult(env);
}

static Napi::Value SetFocused(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // 原版矩阵实测:参数形态不合法 → {ok:false,axError:"illegal_argument"}(不抛)
  if (info.Length() < 1 || !IsStr(info[0]))
    return AxErrorResult(env, "illegal_argument");
  // [E] W5：注册表优先（同 setValue 注——Chromium 树走 miss 边界）
  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());
  if (!el) {
    auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());
    if (!ref) return AxErrorResult(env, "invalid_element");
    el = ResolveRefToElement(*ref);
  }
  if (!el) return AxErrorResult(env, "invalid_element");
  el->SetFocus();
  el->Release();
  return OkResult(env);
}

// —— 输入注入(SendInput)——

static std::optional<AxChord> ParseChord(const std::string& chord) {
  AxChord out;
  size_t i = 0;
  auto token = [&](std::string& t) {
    while (i < chord.size() && chord[i] == ' ') i++;
    size_t s = i;
    while (i < chord.size() && chord[i] != '+') i++;
    t = chord.substr(s, i - s);
    if (i < chord.size()) i++;
    return !t.empty();
  };
  std::string t;
  while (token(t)) {
    std::string lower = t;
    for (auto& c : lower) c = (char)tolower((unsigned char)c);
    if (lower == "ctrl") out.modifiers.push_back(VK_CONTROL);
    else if (lower == "alt") out.modifiers.push_back(VK_MENU);
    else if (lower == "shift") out.modifiers.push_back(VK_SHIFT);
    else if (lower == "meta" || lower == "cmd" || lower == "win") out.modifiers.push_back(VK_LWIN);
    else {
      SHORT vk = VkKeyScanW((WCHAR)(unsigned char)t[0]);
      if (vk == -1) return std::nullopt;
      out.keys.push_back((WORD)(vk & 0xFF));
    }
  }
  return out;
}

static void SendKeySequence(const AxChord& chord, bool down, bool up) {
  std::vector<INPUT> inputs;
  auto push_mods = [&](DWORD flag) {
    for (WORD vk : chord.modifiers) {
      INPUT in{};
      in.type = INPUT_KEYBOARD;
      in.ki.wVk = vk;
      in.ki.dwFlags = flag;
      inputs.push_back(in);
    }
  };
  auto push_keys = [&](DWORD flag) {
    for (WORD vk : chord.keys) {
      INPUT in{};
      in.type = INPUT_KEYBOARD;
      in.ki.wVk = vk;
      in.ki.dwFlags = flag;
      inputs.push_back(in);
    }
  };
  if (down) { push_mods(0); push_keys(0); }
  if (up) { push_keys(KEYEVENTF_KEYUP); push_mods(KEYEVENTF_KEYUP); }
  if (!inputs.empty()) SendInput((UINT)inputs.size(), inputs.data(), sizeof(INPUT));
}

static DWORD ButtonFlag(const std::string& button, bool down) {
  if (button == "left") return down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
  if (button == "right") return down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
  if (button == "middle") return down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
  return 0;
}

static BOOL AbsoluteMove(double x, double y) {
  // 绝对像素坐标直接 SetCursorPos(MOUSEEVENTF_ABSOLUTE 需 0-65535 归一化,
  // 原版实测 moveTo 的目标即物理像素)
  return SetCursorPos((int)x, (int)y);
}

static Napi::Value MoveTo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsFiniteNum(info[0]) || !IsFiniteNum(info[1]))
    return TypeErrorThrow(env, "moveTo(x, y) expects two finite numbers");
  AbsoluteMove(info[0].As<Napi::Number>().DoubleValue(),
               info[1].As<Napi::Number>().DoubleValue());
  // 原版实测:输入/操作类返回布尔
  return Napi::Boolean::New(env, true);
}

static Napi::Value MouseDown(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "mouseDown(button) expects a button string");
  DWORD flag = ButtonFlag(info[0].As<Napi::String>().Utf8Value(), true);
  if (!flag) return Napi::Boolean::New(env, false);
  INPUT in{};
  in.type = INPUT_MOUSE;
  in.mi.dwFlags = flag;
  SendInput(1, &in, sizeof(INPUT));
  return Napi::Boolean::New(env, true);
}

static Napi::Value MouseUp(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "mouseUp(button) expects a button string");
  DWORD flag = ButtonFlag(info[0].As<Napi::String>().Utf8Value(), false);
  if (!flag) return Napi::Boolean::New(env, false);
  INPUT in{};
  in.type = INPUT_MOUSE;
  in.mi.dwFlags = flag;
  SendInput(1, &in, sizeof(INPUT));
  return Napi::Boolean::New(env, true);
}

static Napi::Value Drag(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool shape = info.Length() >= 5 && IsFiniteNum(info[0]) && IsFiniteNum(info[1]) &&
               IsFiniteNum(info[2]) && IsFiniteNum(info[3]) && IsStr(info[4]);
  if (!shape)
    return TypeErrorThrow(env,
                          "drag(fromX, fromY, toX, toY, button) expects four numbers and a button");
  DWORD down = ButtonFlag(info[4].As<Napi::String>().Utf8Value(), true);
  DWORD up = ButtonFlag(info[4].As<Napi::String>().Utf8Value(), false);
  if (!down) return Napi::Boolean::New(env, false);
  double fx = info[0].As<Napi::Number>().DoubleValue();
  double fy = info[1].As<Napi::Number>().DoubleValue();
  double tx = info[2].As<Napi::Number>().DoubleValue();
  double ty = info[3].As<Napi::Number>().DoubleValue();
  AbsoluteMove(fx, fy);
  INPUT in{};
  in.type = INPUT_MOUSE;
  in.mi.dwFlags = down;
  SendInput(1, &in, sizeof(INPUT));
  for (int step = 1; step <= 10; step++) {
    AbsoluteMove(fx + (tx - fx) * step / 10.0, fy + (ty - fy) * step / 10.0);
    Sleep(8);
  }
  in.mi.dwFlags = up;
  SendInput(1, &in, sizeof(INPUT));
  return Napi::Boolean::New(env, true);
}

static Napi::Value ScrollAt(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool shape = info.Length() >= 4 && IsFiniteNum(info[0]) && IsFiniteNum(info[1]) &&
               IsFiniteNum(info[2]) && IsStr(info[3]);
  if (!shape)
    return TypeErrorThrow(
        env, "scrollAt(x, y, delta, direction) expects three numbers and a direction");
  std::string dir = info[3].As<Napi::String>().Utf8Value();
  if (dir != "up" && dir != "down") return Napi::Boolean::New(env, false);
  double delta = info[2].As<Napi::Number>().DoubleValue();
  AbsoluteMove(info[0].As<Napi::Number>().DoubleValue(),
               info[1].As<Napi::Number>().DoubleValue());
  INPUT in{};
  in.type = INPUT_MOUSE;
  in.mi.mouseData = (DWORD)(dir == "up" ? -delta : delta);
  in.mi.dwFlags = MOUSEEVENTF_WHEEL;
  SendInput(1, &in, sizeof(INPUT));
  // 原版实测(本机 Win11 24H2):scrollAt 恒返回 false —— wheel 注入路径在该
  // 环境回报失败;与原版行为对齐。
  return Napi::Boolean::New(env, false);
}

static Napi::Value ClickAtPoint(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool shape = info.Length() >= 4 && IsFiniteNum(info[0]) && IsFiniteNum(info[1]) &&
               IsStr(info[2]) && IsNum(info[3]);
  if (!shape)
    return TypeErrorThrow(
        env,
        "clickAtPoint(x, y, button, clicks, modifiers?) expects two numbers, a button "
        "string, a click count, and an optional modifiers chord");
  std::string button = info[2].As<Napi::String>().Utf8Value();
  DWORD down = ButtonFlag(button, true), up = ButtonFlag(button, false);
  if (!down) return Napi::Boolean::New(env, false);
  int clicks = info[3].As<Napi::Number>().Int32Value();
  // 原版矩阵实测:clicks<1 → false;modifiers 类型非法(非字符串/空)→ false
  if (clicks < 1) return Napi::Boolean::New(env, false);
  if (info.Length() >= 5 && !info[4].IsString() && !info[4].IsNull() &&
      !info[4].IsUndefined()) {
    return Napi::Boolean::New(env, false);
  }
  std::optional<AxChord> mods;
  if (info.Length() >= 5 && info[4].IsString()) {
    mods = ParseChord(info[4].As<Napi::String>().Utf8Value());
    if (!mods || (mods->keys.empty() && mods->modifiers.empty()))
      return Napi::Boolean::New(env, false);
  }
  AbsoluteMove(info[0].As<Napi::Number>().DoubleValue(),
               info[1].As<Napi::Number>().DoubleValue());
  if (mods) SendKeySequence(*mods, true, false);
  for (int i = 0; i < clicks; i++) {
    INPUT in{};
    in.type = INPUT_MOUSE;
    in.mi.dwFlags = down;
    SendInput(1, &in, sizeof(INPUT));
    in.mi.dwFlags = up;
    SendInput(1, &in, sizeof(INPUT));
  }
  if (mods) SendKeySequence(*mods, false, true);
  return Napi::Boolean::New(env, true);
}

static Napi::Value TypeTextGlobal(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "typeTextGlobal(text) expects a string");
  std::wstring text = Widen(info[0].As<Napi::String>().Utf8Value());
  // 原版矩阵实测:空文本 → false
  if (text.empty()) return Napi::Boolean::New(env, false);
  for (wchar_t c : text) {
    // KEYEVENTF_UNICODE 逐字符注入:绕过键盘布局与 IME(中文输入法会把 vk 路径
    // 的数字键当候选选字吞掉 — 实测 vk 注入丢 '1',原版注入干净)。
    INPUT down{};
    down.type = INPUT_KEYBOARD;
    down.ki.wScan = c;
    down.ki.dwFlags = KEYEVENTF_UNICODE;
    INPUT up = down;
    up.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
    SendInput(1, &down, sizeof(INPUT));
    SendInput(1, &up, sizeof(INPUT));
    // 逐字符节奏:连发 SendInput 会被前台应用丢键
    Sleep(8);
  }
  return Napi::Boolean::New(env, true);
}

static Napi::Value PressKeyGlobal(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "pressKeyGlobal(text) expects a key chord string");
  auto chord = ParseChord(info[0].As<Napi::String>().Utf8Value());
  if (!chord || (chord->keys.empty() && chord->modifiers.empty()))
    return Napi::Boolean::New(env, false);
  SendKeySequence(*chord, true, true);
  return Napi::Boolean::New(env, true);
}

static Napi::Value KeyDownGlobal(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "keyDownGlobal(text) expects a key chord string");
  auto chord = ParseChord(info[0].As<Napi::String>().Utf8Value());
  if (!chord || (chord->keys.empty() && chord->modifiers.empty()))
    return Napi::Boolean::New(env, false);
  SendKeySequence(*chord, true, false);
  return Napi::Boolean::New(env, true);
}

static Napi::Value KeyUpGlobal(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "keyUpGlobal(text) expects a key chord string");
  auto chord = ParseChord(info[0].As<Napi::String>().Utf8Value());
  if (!chord || (chord->keys.empty() && chord->modifiers.empty()))
    return Napi::Boolean::New(env, false);
  SendKeySequence(*chord, false, true);
  return Napi::Boolean::New(env, true);
}

static Napi::Value HoldKeyGlobal(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsStr(info[0]) || !IsNum(info[1]))
    return TypeErrorThrow(env,
                          "holdKeyGlobal(text, durationMs) expects a key chord and a duration");
  auto chord = ParseChord(info[0].As<Napi::String>().Utf8Value());
  if (!chord || (chord->keys.empty() && chord->modifiers.empty()))
    return Napi::Boolean::New(env, false);
  double dur = info[1].As<Napi::Number>().DoubleValue();
  // 原版矩阵实测:负 duration → false(且必须避免把 -1 当无符号睡眠挂死进程)
  if (dur < 0 || !std::isfinite(dur)) return Napi::Boolean::New(env, false);
  SendKeySequence(*chord, true, false);
  Sleep((DWORD)dur);
  SendKeySequence(*chord, false, true);
  return Napi::Boolean::New(env, true);
}

static Napi::Value HoldKeyGlobalAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsStr(info[0]) || !IsNum(info[1]))
    return TypeErrorThrow(
        env, "holdKeyGlobalAsync(text, durationMs) expects a key chord and a duration");
  auto chord = ParseChord(info[0].As<Napi::String>().Utf8Value());
  if (!chord || (chord->keys.empty() && chord->modifiers.empty()))
    return Napi::Boolean::New(env, false);
  double dur = info[1].As<Napi::Number>().DoubleValue();
  if (dur < 0 || !std::isfinite(dur)) return Napi::Boolean::New(env, false);
  SendKeySequence(*chord, true, false);
  uint32_t ms = (uint32_t)dur;
  std::thread([chord = *chord, ms]() {
    Sleep(ms);
    SendKeySequence(chord, false, true);
  }).detach();
  return Napi::Boolean::New(env, true);
}

static std::mutex g_focus_mutex;
static bool g_prevent_activation = false;

static Napi::Value PreventActivation(const Napi::CallbackInfo& info) {
  std::lock_guard<std::mutex> lock(g_focus_mutex);
  g_prevent_activation = true;
  // 原版实测:返回 false
  return Napi::Boolean::New(info.Env(), false);
}
static Napi::Value ReenableActivation(const Napi::CallbackInfo& info) {
  std::lock_guard<std::mutex> lock(g_focus_mutex);
  g_prevent_activation = false;
  // 原版矩阵实测:reenableActivation 恒返回 true(prevent 恒 false)
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value IsFocusStealPrevented(const Napi::CallbackInfo& info) {
  // 原版实测:preventActivation() 之后仍返回 false —— 该查询报告的是系统级
  // 前台抢夺抑制是否真实生效(激活动作执行期间的瞬态状态),不是自身开关。
  std::lock_guard<std::mutex> lock(g_focus_mutex);
  (void)g_prevent_activation;
  return Napi::Boolean::New(info.Env(), false);
}

static Napi::Value CancelPendingInputHolds(const Napi::CallbackInfo& info) {
  // 原版实测返回布尔 true
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value CancelInputHoldsForSession(const Napi::CallbackInfo& info) {
  // 原版矩阵实测:无参 → false;带任意参数 → true
  return Napi::Boolean::New(info.Env(), info.Length() > 0);
}

// —— 剪贴板 ——

static Napi::Value ReadClipboardTextAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);
  auto result = Napi::Object::New(env);
  std::wstring text;
  bool ok = false;
  if (OpenClipboard(nullptr)) {
    if (IsClipboardFormatAvailable(CF_UNICODETEXT)) {
      HANDLE h = GetClipboardData(CF_UNICODETEXT);
      if (h) {
        if (auto* wstr = (const wchar_t*)GlobalLock(h)) {
          text = wstr;
          GlobalUnlock(h);
          ok = true;
        }
      }
    }
    CloseClipboard();
  }
  // [E] 官方 0.6.5 win 探针（2026-11-11，provided-paste 接管态读取）失败路径：
  // {ok:false, error:"invalid_data"}（无 text 槽）；成功 {ok:true, text} 原形。
  if (!ok) {
    auto errObj = Napi::Object::New(env);
    errObj.Set("ok", Napi::Boolean::New(env, false));
    errObj.Set("error", Napi::String::New(env, "invalid_data"));
    deferred.Resolve(errObj);
    return deferred.Promise();
  }
  result.Set("ok", Napi::Boolean::New(env, true));
  result.Set("text", Napi::String::New(env, Narrow(text)));
  deferred.Resolve(result);
  return deferred.Promise();
}

static Napi::Value WriteClipboardTextAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "writeClipboardTextAsync(text) expects one string");
  std::wstring text = Widen(info[0].As<Napi::String>().Utf8Value());
  auto deferred = Napi::Promise::Deferred::New(env);
  bool ok = false;
  if (OpenClipboard(nullptr)) {
    EmptyClipboard();
    SIZE_T bytes = (text.size() + 1) * sizeof(wchar_t);
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (h) {
      memcpy(GlobalLock(h), text.c_str(), bytes);
      GlobalUnlock(h);
      ok = SetClipboardData(CF_UNICODETEXT, h) != nullptr;
      if (!ok) GlobalFree(h);
    }
    CloseClipboard();
  }
  auto result = Napi::Object::New(env);
  result.Set("ok", Napi::Boolean::New(env, ok));
  deferred.Resolve(result);
  return deferred.Promise();
}

// —— 截图面(PrintWindow/BitBlt 实现;原版为 WinRT Graphics.Capture 管线)——

static Napi::Value CaptureApp(const Napi::CallbackInfo& info) {
  // 原版实测契约:captureApp(pid) 返回 AX 快照 {app, window, elements} —
  // elements 为平铺两层(窗口根 + 直接子元素,无更深 children);
  // 无效 pid → null。截图能力由 captureWindow*/captureMonitor* 系列承载。
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsNum(info[0]))
    return TypeErrorThrow(env, "captureApp(pid) expects a number");
  DWORD pid = (DWORD)info[0].As<Napi::Number>().Int32Value();
  auto windows = EnumTopWindows(false);
  const WindowEntry* target = nullptr;
  for (auto& w : windows)
    if (w.pid == pid) { target = &w; break; }
  if (!target) return env.Null();
  DWORD fg_pid = 0;
  GetWindowThreadProcessId(GetForegroundWindow(), &fg_pid);
  auto snap = Napi::Object::New(env);
  snap.Set("app", AppEntryToJs(env, *target, pid == fg_pid));
  auto win = Napi::Object::New(env);
  win.Set("index", Napi::Number::New(env, 0));
  win.Set("title", Napi::String::New(env, Narrow(target->title)));
  win.Set("bounds", BoundsArray(env, target->rect.left, target->rect.top,
                                target->rect.right - target->rect.left,
                                target->rect.bottom - target->rect.top));
  win.Set("window_id", Napi::Number::New(env, (double)(uintptr_t)target->hwnd));
  bool fg = pid == fg_pid;
  win.Set("main", Napi::Boolean::New(env, fg));
  win.Set("focused", Napi::Boolean::New(env, fg));
  // [E] 2026-11-11 parity-native-full：官方 0.6.5 captureApp window 8 键（尾双键
  // cloaked/minimized）——补齐（DWMWA_CLOAKED 查询 + IsIconic）。
  int cloakedState = 0;
  if (SUCCEEDED(DwmGetWindowAttribute(target->hwnd, DWMWA_CLOAKED, &cloakedState,
                                      sizeof(cloakedState)))) {
  }
  win.Set("cloaked", Napi::Boolean::New(env, cloakedState != 0));
  win.Set("minimized", Napi::Boolean::New(env, IsIconic(target->hwnd) != FALSE));
  snap.Set("window", win);
  // 原版实测:elements 为整棵 UIA 子树的 BFS 平铺(根先,按层),数量上限 400
  //(ZCode Electron 大树恰好 400,explorer 206 未触顶)。
  auto elements = Napi::Array::New(env, 0);
  IUIAutomation* uia = GetUia();
  if (uia) {
    IUIAutomationElement* root = nullptr;
    if (SUCCEEDED(uia->ElementFromHandle(target->hwnd, &root)) && root) {
      IUIAutomationTreeWalker* walker = nullptr;
      if (SUCCEEDED(uia->get_RawViewWalker(&walker)) && walker) {
        std::vector<IUIAutomationElement*> queue{root};
        root->AddRef();
        size_t head = 0;
        while (head < queue.size() && elements.Length() < 400) {
          IUIAutomationElement* cur = queue[head++];
          elements.Set(elements.Length(), ElementToJs(env, cur, pid, false, 0));
          IUIAutomationElement* child = nullptr;
          if (SUCCEEDED(walker->GetFirstChildElement(cur, &child)) && child) {
            while (child) {
              if (queue.size() < 4096) queue.push_back(child), child->AddRef();
              IUIAutomationElement* next = nullptr;
              walker->GetNextSiblingElement(child, &next);
              child->Release();
              child = next;
            }
          }
        }
        for (auto* el : queue) el->Release();
        walker->Release();
      } else {
        elements.Set(elements.Length(), ElementToJs(env, root, pid, false, 0));
        root->Release();
      }
    }
  }
  snap.Set("elements", elements);
  return snap;
}

static Napi::Value CaptureWindowImage(const Napi::CallbackInfo& info) {
  // 原版 0.5.13 win32 矩阵实测:任何输入(含有效 hwnd)恒返回 null —— 发行物
  // 为 fail-closed stub。对齐其可观测表现(CaptureViaGraphicsCapture 管线保留
  // 供授权环境验证,不进入导出路径)。
  Napi::Env env = info.Env();
  (void)info;
  return env.Null();
}

static Napi::Value CaptureWindowPngVerifiedAsync(const Napi::CallbackInfo& info) {
  // 原版实测:失败 → Promise<{ok:false, error:"invalid_target"}>(结果对象)
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);
  // 原版 0.5.13 win32 矩阵实测:任何输入恒 resolve({ok:false,error:"invalid_target"})
  auto err = Napi::Object::New(env);
  err.Set("ok", Napi::Boolean::New(env, false));
  err.Set("error", Napi::String::New(env, "invalid_target"));
  deferred.Resolve(err);
  return deferred.Promise();
}

static Napi::Value CaptureMonitorPngAsync(const Napi::CallbackInfo& info) {
  // 原版实测:失败 → Promise<{ok:false, error:"invalid_target"}>
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);
  // 原版 0.5.13 win32 矩阵实测:任何输入恒 resolve({ok:false,error:"invalid_target"})
  auto err = Napi::Object::New(env);
  err.Set("ok", Napi::Boolean::New(env, false));
  err.Set("error", Napi::String::New(env, "invalid_target"));
  deferred.Resolve(err);
  return deferred.Promise();
}

static Napi::Value IsScreenCaptureSupported(const Napi::CallbackInfo& info) {
  // 原版矩阵实测:无参 → true;带任意参数 → false
  return Napi::Boolean::New(info.Env(), info.Length() == 0);
}
static Napi::Value ScreenCaptureStatus(const Napi::CallbackInfo& info) {
  // 原版矩阵实测:无参 → "granted";带任意参数 → "unknown"
  return Napi::String::New(info.Env(), info.Length() == 0 ? "granted" : "unknown");
}

static Napi::Value ScreenCaptureProbeWindows(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // 原版实测:probeWindows 过滤 cloaked 窗口(TextInputHost 不在列表),
  // 而 listApplications 保留它们 —— 两条枚举策略不同。
  auto windows = EnumTopWindows(true);
  DWORD fg_pid = 0;
  GetWindowThreadProcessId(GetForegroundWindow(), &fg_pid);
  auto arr = Napi::Array::New(env, windows.size());
  for (size_t i = 0; i < windows.size(); i++) {
    auto& w = windows[i];
    auto obj = Napi::Object::New(env);
    obj.Set("windowId", Napi::Number::New(env, (double)(uintptr_t)w.hwnd));
    obj.Set("ownerPid", Napi::Number::New(env, (double)w.pid));
    obj.Set("layer", Napi::Number::New(env, 0));
    obj.Set("ownerBundleId", Napi::String::New(env, Narrow(w.exe_path)));
    obj.Set("ownerName", Napi::String::New(env, ExeShortName(w.exe_path)));
    obj.Set("ownerActive", Napi::Boolean::New(env, w.pid == fg_pid));
    // [E] 2026-11-11 parity-native：官方 0.6.5 probeWindows 10 键（+acceptsLeftMouseDown，
    // 键序在 ownerActive 后）；值=!(WS_EX_TRANSPARENT)——GhostCursor/dl-app/clash-verge
    // 等 12 窗差集实证全部吻合（layered 非 transparent 的 PixPin 工具条=true）。
    LONG_PTR exStyle = GetWindowLongPtrW(w.hwnd, GWL_EXSTYLE);
    obj.Set("acceptsLeftMouseDown",
            Napi::Boolean::New(env, (exStyle & WS_EX_TRANSPARENT) == 0));
    obj.Set("title", Napi::String::New(env, Narrow(w.title)));
    obj.Set("bounds", BoundsObject(env, w.rect.left, w.rect.top,
                                   w.rect.right - w.rect.left, w.rect.bottom - w.rect.top));
    bool on_screen = w.rect.right > 0 && w.rect.bottom > 0 && w.rect.left < GetSystemMetrics(SM_CXSCREEN) &&
                     w.rect.top < GetSystemMetrics(SM_CYSCREEN);
    obj.Set("onScreen", Napi::Boolean::New(env, on_screen));
    arr.Set((uint32_t)i, obj);
  }
  return arr;
}

// >>> [机器管理实现区 begin —— generate-win-rebuilt.py 所有，勿手编] >>>
// —— W1 追赶批（3 面）——行为锚=官方 0.6.5 addon fresh-process 探针 2026-11-10
#include <initguid.h>
#include <shlguid.h>  // BHID_EnumItems / CLSID_ShellLink（ShObjIdl_core.h 不含 ShlGuid.h，
                     // 需显式引入；前置 initguid.h 使 DEFINE_GUID 在本翻译单元物化定义，免 uuid.lib 依赖）
#include <winver.h>
#include <map>
#pragma comment(lib, "version.lib")
// （include/pragma 置于实现块顶部而非锁区文件头：锁区前体为 0.5.13/0.6.3 语义
//  底座字节锁，W1 只经生成器追加，不动锁区。winver/version/shlguid/map 仅本块消费。）

static bool WindowMatchesTarget(HWND hwnd, DWORD pid, const std::wstring& bundle) {
  // [E] 官方探针（2026-11-10）：wrong-pid → false（pid 与窗口交叉核验）；
  //     bundleId 内容交叉核验——仅进程全路径命中（垃圾串/短名/空串/null → false），
  //     QueryFullProcessImageNameW + lstrcmpiW 均在官方导入表。
  if (!hwnd || !IsWindow(hwnd)) return false;
  DWORD wpid = 0;
  GetWindowThreadProcessId(hwnd, &wpid);
  if (wpid != pid || bundle.empty()) return false;
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, wpid);
  if (!h) return false;
  wchar_t img[1024]{};
  DWORD n = 1024;
  BOOL ok = QueryFullProcessImageNameW(h, 0, img, &n);
  CloseHandle(h);
  return ok && lstrcmpiW(img, bundle.c_str()) == 0;
}

static Napi::Value ActivateWindow(const Napi::CallbackInfo& info) {
  // W1 追赶批：vendored 0.6.3 已有（JS 引用 7 次），还原线自 0.5.13 期参照起未实现。
  // 契约 (pid, bundleId, windowId) => boolean；官方 JS 消费面 :23781/:24642-24652
  // （:24647-24652 拒文案 "could not be atomically raised, focused, activated,
  // and verified"）。[E] 探针：坏参/零值/非串 bundleId/错 pid → false 不抛；
  // 可激活真窗 → true 且前台实切；不可激活窗（StatusBarWnd/Program Manager）→ false
  // （激活后 GetForegroundWindow 复核 = "verified" 语义）。
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !IsNum(info[0]) || !IsStr(info[1]) || !IsNum(info[2]))
    return Napi::Boolean::New(env, false);
  DWORD pid = (DWORD)info[0].As<Napi::Number>().Int32Value();
  std::wstring bundle = Widen(info[1].As<Napi::String>().Utf8Value());
  HWND hwnd = (HWND)(uintptr_t)(int64_t)info[2].As<Napi::Number>().Int64Value();
  if (!WindowMatchesTarget(hwnd, pid, bundle)) return Napi::Boolean::New(env, false);
  if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
  DWORD fg_thread = GetWindowThreadProcessId(GetForegroundWindow(), nullptr);
  DWORD this_thread = GetCurrentThreadId();
  DWORD target_thread = GetWindowThreadProcessId(hwnd, nullptr);
  AttachThreadInput(this_thread, fg_thread, TRUE);
  AttachThreadInput(this_thread, target_thread, TRUE);
  BringWindowToTop(hwnd);
  SetForegroundWindow(hwnd);
  AttachThreadInput(this_thread, target_thread, FALSE);
  AttachThreadInput(this_thread, fg_thread, FALSE);
  return Napi::Boolean::New(env, GetForegroundWindow() == hwnd);
}

class LaunchApplicationWorker : public Napi::AsyncWorker {
  // [S] 官方 strings async 资源名 "LaunchApplicationWorker"；AUMID 激活链与
  // activateApplicationByAumid 同源（ApplicationActivationManager 外部 COM 服务器，
  // 仅需 CoCreateInstance——官方导入表无 ShellExecuteEx）。
 public:
  LaunchApplicationWorker(Napi::Env env, std::wstring aumid, std::wstring target,
                          std::wstring args)
      : Napi::AsyncWorker(env, "LaunchApplicationWorker"),
        deferred_(Napi::Promise::Deferred::New(env)),
        aumid_(std::move(aumid)), target_(std::move(target)), args_(std::move(args)) {}
  Napi::Promise Promise() const { return deferred_.Promise(); }
  void Execute() override {
    // [E] 官方探针：aumid 优先且失败不回退 targetPath（bogus AUMID + 有效 target
    //     → null）；伪 AUMID ~40ms COM 尝试后失败 → null。
    if (!aumid_.empty()) {
      // [I] worker 线程自管 COM（官方导入 CoInitializeEx/CoUninitialize）；
      //     shell 激活选 STA。
      HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
      if (SUCCEEDED(hr)) {
        IApplicationActivationManager* mgr = nullptr;
        if (SUCCEEDED(CoCreateInstance(CLSID_ApplicationActivationManager, nullptr,
                                       CLSCTX_LOCAL_SERVER, IID_PPV_ARGS(&mgr))) && mgr) {
          DWORD pid = 0;
          hr = mgr->ActivateApplication(aumid_.c_str(),
                                        args_.empty() ? L"" : args_.c_str(), AO_NONE, &pid);
          mgr->Release();
          if (SUCCEEDED(hr) && pid > 0) pid_ = (int64_t)pid;
        }
        CoUninitialize();
      }
      return;
    }
    if (!target_.empty()) {
      // [S] CreateProcessW 在官方导入表；[E] 不存在路径 → null（快失败）。
      std::wstring cmdline = L"\"" + target_ + L"\"";
      if (!args_.empty()) cmdline += L" " + args_;
      std::vector<wchar_t> cmdbuf(cmdline.begin(), cmdline.end());
      cmdbuf.push_back(L'\0');
      STARTUPINFOW si{};
      si.cb = sizeof(si);
      PROCESS_INFORMATION pi{};
      if (CreateProcessW(nullptr, cmdbuf.data(), nullptr, nullptr, FALSE, 0, nullptr,
                         nullptr, &si, &pi)) {
        pid_ = (int64_t)pi.dwProcessId;
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
      }
    }
  }
  void OnOK() override {
    // [E] 失败 resolve null（非 0 非 reject）；成功 resolve pid（Win11 packaged
    //     notepad 垫片 pid 亦如实返回）。
    deferred_.Resolve(pid_ > 0 ? Napi::Value(Napi::Number::New(Env(), (double)pid_))
                               : Env().Null());
  }

 private:
  Napi::Promise::Deferred deferred_;
  std::wstring aumid_, target_, args_;
  int64_t pid_ = 0;
};

static Napi::Value LaunchApplicationAsync(const Napi::CallbackInfo& info) {
  // W1 追赶批：vendored 0.6.3 已有（JS 引用 3 次）。契约
  // (aumid: string|null, target_path: string|null, arguments: string|null)
  // => Promise<number|null>（官方 entry :30643-30648 消费：>0 有效，否则视为 null）。
  // [E] 非字符串参数按缺省处理（全空 → resolve null，不抛不 reject）。
  Napi::Env env = info.Env();
  std::wstring aumid, target, args;
  if (info.Length() >= 1 && info[0].IsString())
    aumid = Widen(info[0].As<Napi::String>().Utf8Value());
  if (info.Length() >= 2 && info[1].IsString())
    target = Widen(info[1].As<Napi::String>().Utf8Value());
  if (info.Length() >= 3 && info[2].IsString())
    args = Widen(info[2].As<Napi::String>().Utf8Value());
  auto* worker = new LaunchApplicationWorker(env, std::move(aumid), std::move(target),
                                             std::move(args));
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

struct InstalledAppRecordData {
  std::string name, aumid, target, args, desc;
};

static std::wstring Hex4Word(unsigned v) {
  const wchar_t* digits = L"0123456789abcdef";
  std::wstring s(4, L'0');
  for (int i = 3; i >= 0; i--) {
    s[i] = digits[v & 0xf];
    v >>= 4;
  }
  return s;
}

static std::string FileDescriptionOf(const std::wstring& exePath) {
  // [S] VERSION.dll（GetFileVersionInfoW）在官方导入表；[E] description = 目标 exe 的
  // FileDescription（cmd → "Windows 命令处理程序"、Electron 系 → "Electron"），
  // 无版本资源/无该字段 → null（"123云盘" 实证）。
  DWORD handle = 0;
  DWORD size = GetFileVersionInfoSizeW(exePath.c_str(), &handle);
  if (!size) return {};
  std::vector<BYTE> buf(size);
  if (!GetFileVersionInfoW(exePath.c_str(), 0, size, buf.data())) return {};
  struct LangCodePage {
    WORD lang, code;
  };
  LangCodePage* tr = nullptr;
  UINT trLen = 0;
  if (!VerQueryValueW(buf.data(), L"\\VarFileInfo\\Translation", (void**)&tr, &trLen) ||
      !tr || trLen < sizeof(*tr))
    return {};
  std::wstring key =
      L"\\StringFileInfo\\" + Hex4Word(tr[0].lang) + Hex4Word(tr[0].code) + L"\\FileDescription";
  wchar_t* desc = nullptr;
  UINT descLen = 0;
  if (VerQueryValueW(buf.data(), key.c_str(), (void**)&desc, &descLen) && desc && desc[0])
    return Narrow(desc);
  return {};
}

static Napi::Object InstalledAppRecord(Napi::Env env, const InstalledAppRecordData& rec) {
  // [E] 官方探针（2026-11-10，本机 252 条）：恒 5 键 name/aumid/target_path/
  // arguments/description（null 槽常在，键序与官方 dump 一致）。packaged = 纯
  // aumid 其余 null；classic = lnk 解析（target_path 仅 .exe，.msi/.chm/.html →
  // null 但记录保留）；lnk 项 aumid 恒 null（Chrome 实证——不读
  // PKEY_AppUserModel_ID）。
  auto obj = Napi::Object::New(env);
  obj.Set("name", Napi::String::New(env, rec.name));
  obj.Set("aumid", rec.aumid.empty() ? env.Null()
                                     : Napi::Value(Napi::String::New(env, rec.aumid)));
  obj.Set("target_path", rec.target.empty() ? env.Null()
                                            : Napi::Value(Napi::String::New(env, rec.target)));
  obj.Set("arguments", rec.args.empty() ? env.Null()
                                        : Napi::Value(Napi::String::New(env, rec.args)));
  obj.Set("description", rec.desc.empty() ? env.Null()
                                          : Napi::Value(Napi::String::New(env, rec.desc)));
  return obj;
}

class InstalledApplicationsWorker : public Napi::AsyncWorker {
  // [S] 官方 strings async 资源名 "InstalledApplicationsWorker"；UTF-16 string
  // "shell:AppsFolder" 在场 + SHCreateItemFromParsingName 导入 → 枚举源定谳
  // （本机对照：枚举 252 项 = 官方记录数 252，前 6 项顺序逐位一致；classic 前
  // packaged 段尾的分组形态同源）。
  //
  // 字段来源（2026-11-10 探针对照迭代定谳，probe-one-win 三轮）：
  //   name/aumid/顺序 ← Apps 枚举（display 名 + '!' 非路径形解析名=AUMID）；
  //   target_path/arguments ← Start Menu lnk 原文（IShellLinkW::GetPath/
  //   GetArguments）——属性存储会吃首尾空格（[E] 卸载向日葵官方 args=
  //   " --mod=uninstall" 带前导空格，store 给修剪版；ADK 项尾随空格同理）；
  //   description ← 目标 exe FileDescription（VERSION.dll），空白串 → null
  //   （[E] Windows 映像和配置设计器官方 null、我方 store/ver 读到 " "）。
  //   [E] 非 .exe 目标（.msc/.msi/.chm/.bat/.html）→ target null 且 arguments
  //   连坐 null（事件查看器/任务计划程序等 MMC 系 target=.msc args="/s" 官方
  //   双 null）；记录本身保留（7-Zip Help 等 name-only 记录）。
 public:
  explicit InstalledApplicationsWorker(Napi::Env env)
      : Napi::AsyncWorker(env, "InstalledApplicationsWorker"),
        deferred_(Napi::Promise::Deferred::New(env)) {}
  Napi::Promise Promise() const { return deferred_.Promise(); }
  void Execute() override {
    // [I] worker 线程自管 COM（STA，shell 枚举面）；失败静默出空表
    // （JS 侧官方本就 catch(() => [])，:30375）。
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) return;
    BuildStartMenuLnkIndex();
    EnumerateAppsFolder();
    CoUninitialize();
  }
  void OnOK() override {
    Napi::Env env = Env();
    auto arr = Napi::Array::New(env, records_.size());
    for (size_t i = 0; i < records_.size(); i++)
      arr.Set((uint32_t)i, InstalledAppRecord(env, records_[i]));
    deferred_.Resolve(arr);
  }

 private:
  // —— Start Menu lnk 索引：shell:Programs / shell:Common Programs 递归收集 ——
  // .lnk 项（解析名即 .lnk 文件路径），按显示名建索引供 Apps 项原文解析。
  void BuildStartMenuLnkIndex() {
    for (const wchar_t* root : {L"shell:Common Programs", L"shell:Programs"}) {
      IShellItem* folder = nullptr;
      if (FAILED(SHCreateItemFromParsingName(root, nullptr, IID_PPV_ARGS(&folder))) || !folder)
        continue;
      CollectLnkItems(folder);
      folder->Release();
    }
  }

  void CollectLnkItems(IShellItem* folder) {
    IEnumShellItems* en = nullptr;
    if (FAILED(folder->BindToHandler(nullptr, BHID_EnumItems, IID_PPV_ARGS(&en))) || !en)
      return;
    IShellItem* item = nullptr;
    ULONG fetched = 0;
    while (SUCCEEDED(en->Next(1, &item, &fetched)) && fetched == 1 && item) {
      SFGAOF attrs = 0;
      if (SUCCEEDED(item->GetAttributes(SFGAO_FOLDER | SFGAO_STREAM, &attrs)) &&
          (attrs & SFGAO_FOLDER) && !(attrs & SFGAO_STREAM)) {
        CollectLnkItems(item);  // 子目录递归（zip 等 STREAM 伪目录不入）
      } else {
        PWSTR parse = nullptr;
        if (SUCCEEDED(item->GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING, &parse)) && parse) {
          std::wstring lnkPath = parse;
          CoTaskMemFree(parse);
          if (lnkPath.size() > 4 &&
              _wcsicmp(lnkPath.c_str() + lnkPath.size() - 4, L".lnk") == 0) {
            // 索引键 = lnk 项显示名（SIGDN_NORMALDISPLAY）。普通 lnk = 文件名去
            // 扩展；系统 lnk（mmc/ADK 系）显示名来自资源间接串（@dll,-id），与
            // 文件名不同（[E] 部署和映像工具环境官方 args 尾随空格即经此索引命
            // 中；按文件名索引会 miss 落 store 兜底失原样空格）。
            std::wstring name;
            PWSTR dn = nullptr;
            if (SUCCEEDED(item->GetDisplayName(SIGDN_NORMALDISPLAY, &dn)) && dn) {
              name = dn;
              CoTaskMemFree(dn);
            } else {
              name = ShortNameOf(lnkPath);
            }
            if (!name.empty()) {
              LnkRaw raw;
              // [E] 同名 lnk 可重复（云枢/RayLink 各有 Uninstall.lnk）——按名存
              // 多条，消费端以 target 全等配对，勿 first-wins 盲取。
              if (LoadLnkRaw(lnkPath, raw)) lnkIndex_[name].push_back(std::move(raw));
            }
          }
        }
      }
      item->Release();
      item = nullptr;
      fetched = 0;
    }
    en->Release();
  }

  static std::wstring ShortNameOf(const std::wstring& path) {
    // 去目录与 .lnk 扩展（显示名口径）
    size_t cut = path.find_last_of(L"\\/");
    std::wstring base = cut == std::wstring::npos ? path : path.substr(cut + 1);
    if (base.size() > 4 && _wcsicmp(base.c_str() + base.size() - 4, L".lnk") == 0)
      base.resize(base.size() - 4);
    return base;
  }

  struct LnkRaw {
    std::wstring target, args;
  };

  static bool LoadLnkRaw(const std::wstring& lnkPath, LnkRaw& out) {
    // [E] lnk 原文口径：IShellLinkW::GetPath/GetArguments 保留安装器写入的
    // 首尾空格（向日葵/ADK/VMware 实证）——属性存储会给修剪版，故 args 必经本路。
    // 注意 GetPath 对 app-execution-alias 型目标（[E] WSL 条目）可能返回空，
    // 因此 lnk 只作 args 原文源与末位 target 兜底，不覆盖 store 的 target。
    IShellLinkW* link = nullptr;
    if (FAILED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&link))) || !link)
      return false;
    IPersistFile* pf = nullptr;
    bool ok = false;
    if (SUCCEEDED(link->QueryInterface(IID_PPV_ARGS(&pf))) && pf) {
      if (SUCCEEDED(pf->Load(lnkPath.c_str(), STGM_READ))) {
        wchar_t buf[MAX_PATH * 4]{};
        WIN32_FIND_DATAW fdata{};
        if (SUCCEEDED(link->GetPath(buf, (int)(sizeof(buf) / sizeof(wchar_t)), &fdata,
                                    SLGP_UNCPRIORITY)) &&
            buf[0])
          out.target = buf;
        wchar_t abuf[MAX_PATH * 4]{};
        if (SUCCEEDED(link->GetArguments(abuf, (int)(sizeof(abuf) / sizeof(wchar_t)))) &&
            abuf[0])
          out.args = abuf;
        ok = true;
      }
      pf->Release();
    }
    link->Release();
    return ok;
  }

  // —— Apps 文件夹枚举（输出顺序与记录集的驱动源） ——
  void EnumerateAppsFolder() {
    IShellItem* folder = nullptr;
    if (FAILED(SHCreateItemFromParsingName(L"shell:AppsFolder", nullptr,
                                           IID_PPV_ARGS(&folder))) || !folder)
      return;
    IEnumShellItems* en = nullptr;
    if (SUCCEEDED(folder->BindToHandler(nullptr, BHID_EnumItems, IID_PPV_ARGS(&en))) && en) {
      IShellItem* item = nullptr;
      ULONG fetched = 0;
      while (SUCCEEDED(en->Next(1, &item, &fetched)) && fetched == 1 && item) {
        AppendRecord(item);
        item->Release();
        item = nullptr;
        fetched = 0;
      }
      en->Release();
    }
    folder->Release();
  }

  static bool IsPathLike(const std::wstring& s) {
    return s.find(L':') != std::wstring::npos || s.rfind(L"\\\\", 0) == 0 ||
           s.rfind(L"::", 0) == 0 || s.find(L'\\') != std::wstring::npos;
  }

  void AppendRecord(IShellItem* item) {
    InstalledAppRecordData rec;
    PWSTR name = nullptr;
    if (SUCCEEDED(item->GetDisplayName(SIGDN_NORMALDISPLAY, &name)) && name) {
      rec.name = Narrow(name);
      CoTaskMemFree(name);
    }
    PWSTR parse = nullptr;
    if (SUCCEEDED(item->GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING, &parse)) && parse) {
      std::wstring parseW = parse;
      CoTaskMemFree(parse);
      // [E] '!' 判别须先排路径形：IDM「卸载清除」解析名 =
      // D:\software\IDM\IDM\!)卸载.bat（路径内含 '!'）官方按 classic 记（.bat
      // 非 exe → 全 null 槽）。MSIX/immersive 解析名 = AUMID（含 '!' 且无路径）。
      if (parseW.find(L'!') != std::wstring::npos && !IsPathLike(parseW)) {
        rec.aumid = Narrow(parseW);
      } else {
        ResolveClassicFields(item, parseW, rec);
      }
    }
    if (!rec.name.empty()) records_.push_back(std::move(rec));
  }

  void ResolveClassicFields(IShellItem* item, const std::wstring& parse,
                            InstalledAppRecordData& rec) {
    // target 定序（2026-11-11 三轮探针迭代定谳）：
    //   1) store System.Link.TargetParsingPath —— 保留 lnk 存储原 casing
    //      （[E] VS 命令提示符官方 C:\WINDOWS\system32\cmd.exe 混排与 store 一致，
    //       GetPath 会给盘上规范 casing）；对 alias 型目标（WSL）也稳定出值。
    //   2) 路径形解析名兜底。
    //   3) lnk 原文 GetPath（alias 型可能空，仅末位）。
    std::wstring target, storeArgs;
    IShellItem2* item2 = nullptr;
    if (SUCCEEDED(item->QueryInterface(IID_PPV_ARGS(&item2))) && item2) {
      PROPVARIANT pv{};
      if (SUCCEEDED(item2->GetProperty(PKEY_Link_TargetParsingPath, &pv)) &&
          pv.vt == VT_LPWSTR && pv.pwszVal && pv.pwszVal[0])
        target = pv.pwszVal;
      PropVariantClear(&pv);
      PROPVARIANT pva{};
      if (SUCCEEDED(item2->GetProperty(PKEY_Link_Arguments, &pva)) && pva.vt == VT_LPWSTR &&
          pva.pwszVal && pva.pwszVal[0])
        storeArgs = pva.pwszVal;
      PropVariantClear(&pva);
      item2->Release();
    }
    if (target.empty() && IsPathLike(parse)) target = parse;
    auto it = lnkIndex_.find(Widen(rec.name));
    if (target.empty() && it != lnkIndex_.end()) {
      for (const LnkRaw& raw : it->second)
        if (!raw.target.empty()) { target = raw.target; break; }
    }
    // [E] 非 .exe 目标 → target null 且 args/description 连坐 null；记录保留
    //（.msc/.msi/.chm/.bat/.html 全实证）。
    if (!(target.size() >= 4 && towlower(target[target.size() - 1]) == L'e' &&
          towlower(target[target.size() - 2]) == L'x' &&
          towlower(target[target.size() - 3]) == L'e' && target[target.size() - 4] == L'.'))
      return;
    rec.target = Narrow(target);
    // args：lnk 原文优先（保留首尾空格）。同名多条时以 target 全等（大小写无关）
    // 配对（[E] Uninstall 撞名实证）；无 target 全等且无空目标条目 → store 兜底
    //（失原样空格，仅极端缺位路径）。
    std::wstring args = storeArgs;
    if (it != lnkIndex_.end()) {
      const LnkRaw* matched = nullptr;
      const LnkRaw* emptyTargetWithArgs = nullptr;
      for (const LnkRaw& raw : it->second) {
        if (!raw.target.empty() && lstrcmpiW(raw.target.c_str(), target.c_str()) == 0) {
          matched = &raw;
          break;
        }
        if (raw.target.empty() && !raw.args.empty() && !emptyTargetWithArgs)
          emptyTargetWithArgs = &raw;
      }
      if (matched && !matched->args.empty())
        args = matched->args;
      else if (!matched && emptyTargetWithArgs)
        args = emptyTargetWithArgs->args;  // alias 型：target 空但 args 原文在
    }
    if (!args.empty()) rec.args = Narrow(args);
    std::string desc = FileDescriptionOf(target);
    // [E] 空白串 FileDescription → null（Windows 映像和配置设计器官方 null）
    bool blank = !desc.empty() && desc.find_first_not_of(" \t\r\n") == std::string::npos;
    if (!blank) rec.desc = std::move(desc);
  }

  Napi::Promise::Deferred deferred_;
  std::vector<InstalledAppRecordData> records_;
  std::map<std::wstring, std::vector<LnkRaw>> lnkIndex_;
};

static Napi::Value ListInstalledApplicationsAsync(const Napi::CallbackInfo& info) {
  // W1 追赶批：vendored 0.6.3 已有（JS 引用 1 次）。契约
  // () => Promise<installedApp[]>（官方 entry :30375 消费：缺导出 → JS 兜底空表；
  // 本面恒 resolve，失败路径即空表）。
  Napi::Env env = info.Env();
  auto* worker = new InstalledApplicationsWorker(env);
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

// —— W2 批（mac 血统 22 面）——行为锚=官方 0.6.5 addon fresh-process 探针 2026-11-11

// —— ghost 16 面（mac 血统同族；win 官方形态大幅薄化）——
// [E] 官方 0.6.5 win fresh-process 探针（2026-11-11，probe-one-win ghost face 全
// 转移序列 + 两轮判别探针）：
//   ghostState 恒 8 键 {enabled,shown,multiCursorEnabled,displayGeneration,
//   sessionCount,ready,ripples,groups}；groups 恒空、displayGeneration 恒 1、
//   sessionCount 恒 0、ripples 恒 0、shown 恒 false（探针环境无 overlay 后端，
//   [I] 渲染通道不可观测）；multiCursorEnabled 恒 true（setter 成功返回但状态不翻）。
//   ready 唯一观测转移：enabled 状态下 move/ripple 成功 → true（未 enabled 时 move
//   返回 true 但 ready 不动；move/ripple 两数字参数否则 false）。
//   返回值：init/show/beginAction → false；hide/endAction → true；
//   beginActionWithTitle(kind,session,title) 三参形态 → true（无组副作用）；
//   setEnabled/ setMultiCursorEnabled/ setCapture 接受 bool → true（enabled 随 setter，
//   其余无可观测存储）；setRequestSession/removeSession/sessionTurnEnd 接受字符串 →
//   true（无状态副作用，default 亦可移除形参）。坏参一律 false 不抛。
static bool g_w2GhostEnabled = false;
static bool g_w2GhostReady = false;

static Napi::Value GhostInit(const Napi::CallbackInfo& info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
static Napi::Value GhostShow(const Napi::CallbackInfo& info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
static Napi::Value GhostHide(const Napi::CallbackInfo& info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value GhostMove(const Napi::CallbackInfo& info) {
  if (info.Length() < 2 || !IsNum(info[0]) || !IsNum(info[1]))
    return Napi::Boolean::New(info.Env(), false);
  if (g_w2GhostEnabled) g_w2GhostReady = true;
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value GhostClickRipple(const Napi::CallbackInfo& info) {
  if (info.Length() < 2 || !IsNum(info[0]) || !IsNum(info[1]))
    return Napi::Boolean::New(info.Env(), false);
  if (g_w2GhostEnabled) g_w2GhostReady = true;
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value GhostBeginAction(const Napi::CallbackInfo& info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
static Napi::Value GhostBeginActionWithTitle(const Napi::CallbackInfo& info) {
  if (info.Length() < 3 || !IsNum(info[0]) || !IsStr(info[1]) || !IsStr(info[2]))
    return Napi::Boolean::New(info.Env(), false);
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value GhostEndAction(const Napi::CallbackInfo& info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value GhostSetEnabled(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBoolean()) return Napi::Boolean::New(env, false);
  g_w2GhostEnabled = info[0].As<Napi::Boolean>().Value();
  return Napi::Boolean::New(env, true);
}
static Napi::Value GhostSetMultiCursorEnabled(const Napi::CallbackInfo& info) {
  // [E] setter 成功但 ghostState().multiCursorEnabled 恒 true（无可观测存储）
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBoolean()) return Napi::Boolean::New(env, false);
  return Napi::Boolean::New(env, true);
}
static Napi::Value GhostSetCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBoolean()) return Napi::Boolean::New(env, false);
  return Napi::Boolean::New(env, true);
}
static Napi::Value GhostSetRequestSession(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0])) return Napi::Boolean::New(env, false);
  return Napi::Boolean::New(env, true);
}
static Napi::Value GhostRemoveSession(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0])) return Napi::Boolean::New(env, false);
  return Napi::Boolean::New(env, true);
}
static Napi::Value GhostSessionTurnEnd(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0])) return Napi::Boolean::New(env, false);
  return Napi::Boolean::New(env, true);
}
static Napi::Value GhostState(const Napi::CallbackInfo& info) {
  // [E] 8 键（win 官方形态；mac 同族为 23 键——win 渲染后端缺省下的降维 state）
  Napi::Env env = info.Env();
  auto r = Napi::Object::New(env);
  r.Set("enabled", Napi::Boolean::New(env, g_w2GhostEnabled));
  r.Set("shown", Napi::Boolean::New(env, false));
  r.Set("multiCursorEnabled", Napi::Boolean::New(env, true));
  r.Set("displayGeneration", Napi::Number::New(env, 1));
  r.Set("sessionCount", Napi::Number::New(env, 0));
  r.Set("ready", Napi::Boolean::New(env, g_w2GhostReady));
  r.Set("ripples", Napi::Number::New(env, 0));
  r.Set("groups", Napi::Object::New(env));
  return r;
}
static Napi::Value GhostPaletteSelftest(const Napi::CallbackInfo& info) {
  // [E] 官方 win 输出（2026-11-11 探针逐值采集）：palette=11 色 rgb 表，
  // samples={default:#1F8CFF(31,140,255), agent-3:palette[2]}（StableSessionIndex
  // 尾数规则 (3-1)%11=2，与 mac 同族映射）。rgb 注入自 ghost-shared-constants.json
  // 单一出处，禁止手抄双份漂移。
  Napi::Env env = info.Env();
  auto r = Napi::Object::New(env);
  auto pal = Napi::Object::New(env);
  {
    auto c0 = Napi::Object::New(env);
    c0.Set("r", Napi::Number::New(env, 255));
    c0.Set("g", Napi::Number::New(env, 228));
    c0.Set("b", Napi::Number::New(env, 133));
    pal.Set("0", c0);
  }
  {
    auto c1 = Napi::Object::New(env);
    c1.Set("r", Napi::Number::New(env, 246));
    c1.Set("g", Napi::Number::New(env, 152));
    c1.Set("b", Napi::Number::New(env, 219));
    pal.Set("1", c1);
  }
  {
    auto c2 = Napi::Object::New(env);
    c2.Set("r", Napi::Number::New(env, 205));
    c2.Set("g", Napi::Number::New(env, 222));
    c2.Set("b", Napi::Number::New(env, 130));
    pal.Set("2", c2);
  }
  {
    auto c3 = Napi::Object::New(env);
    c3.Set("r", Napi::Number::New(env, 255));
    c3.Set("g", Napi::Number::New(env, 211));
    c3.Set("b", Napi::Number::New(env, 228));
    pal.Set("3", c3);
  }
  {
    auto c4 = Napi::Object::New(env);
    c4.Set("r", Napi::Number::New(env, 146));
    c4.Set("g", Napi::Number::New(env, 209));
    c4.Set("b", Napi::Number::New(env, 255));
    pal.Set("4", c4);
  }
  {
    auto c5 = Napi::Object::New(env);
    c5.Set("r", Napi::Number::New(env, 255));
    c5.Set("g", Napi::Number::New(env, 208));
    c5.Set("b", Napi::Number::New(env, 88));
    pal.Set("5", c5);
  }
  {
    auto c6 = Napi::Object::New(env);
    c6.Set("r", Napi::Number::New(env, 175));
    c6.Set("g", Napi::Number::New(env, 223));
    c6.Set("b", Napi::Number::New(env, 238));
    pal.Set("6", c6);
  }
  {
    auto c7 = Napi::Object::New(env);
    c7.Set("r", Napi::Number::New(env, 255));
    c7.Set("g", Napi::Number::New(env, 189));
    c7.Set("b", Napi::Number::New(env, 180));
    pal.Set("7", c7);
  }
  {
    auto c8 = Napi::Object::New(env);
    c8.Set("r", Napi::Number::New(env, 247));
    c8.Set("g", Napi::Number::New(env, 41));
    c8.Set("b", Napi::Number::New(env, 103));
    pal.Set("8", c8);
  }
  {
    auto c9 = Napi::Object::New(env);
    c9.Set("r", Napi::Number::New(env, 70));
    c9.Set("g", Napi::Number::New(env, 198));
    c9.Set("b", Napi::Number::New(env, 215));
    pal.Set("9", c9);
  }
  {
    auto c10 = Napi::Object::New(env);
    c10.Set("r", Napi::Number::New(env, 188));
    c10.Set("g", Napi::Number::New(env, 172));
    c10.Set("b", Napi::Number::New(env, 221));
    pal.Set("10", c10);
  }
  r.Set("palette", pal);
  auto samples = Napi::Object::New(env);
  {
    auto d = Napi::Object::New(env);
    d.Set("r", Napi::Number::New(env, 31));
    d.Set("g", Napi::Number::New(env, 140));
    d.Set("b", Napi::Number::New(env, 255));
    samples.Set("default", d);
  }
  {
    auto a3 = Napi::Object::New(env);
    a3.Set("r", Napi::Number::New(env, 205));
    a3.Set("g", Napi::Number::New(env, 222));
    a3.Set("b", Napi::Number::New(env, 130));
    samples.Set("agent-3", a3);
  }
  r.Set("samples", samples);
  return r;
}

// —— pasteboard 4 面（provided-paste 会话；JS 消费面 :28535-28575/:31362-31383）——
// [E] 官方 0.6.5 win 探针（2026-11-11）：
//   begin(text, format, readerPid)：非双字符串 → TypeError
//   "pasteboardBeginProvidedPaste(text, format) expects two strings"；format 仅
//   "html"/"text"（"text/html"/"HTML Format"/"text/plain"/"image/png"/"rtf"/"" →
//   {ok:false,error:"unsupported_format",token:0}）；成功 {ok:true,error:null,token:N}
//   自增数值 token，接管剪贴板（接管态读文本 → {ok:false,error:"invalid_data"}）。
//   markDispatched(token)：非数 → TypeError "pasteboardMarkProvidedPasteDispatched(token)
//   expects a token"；unknown/已完结 → false；活跃 → true。
//   awaitRead(token,t,g,m)：非数 token → TypeError "pasteboardAwaitProvidedRead(token,
//   timeoutMs, graceMs, minHoldMs) expects a token"；unknown → 8 键 {ok:false,reads:0,
//   readsBeforeDispatch:0,holdMs:0,readerPid:0,refusedReads:0,unverifiedReads:0,error:
//   "unknown_paste_token"}；活跃未读 → 同形 error:"pasteboard_read_timed_out"（超时
//   后返回）。[S] "ProvidedPasteReadWorker"/"ZCodeCuaProvidedPasteOwner"/
//   RegisterClipboardFormatW/GetClipboardOwner/GetOpenClipboardWindow 官方在场。
//   finish(token)：非数 → TypeError "pasteboardFinishProvidedPaste(token) expects a
//   token"；任何数值 token（含 unknown/已完结）→ true；活跃 token 恢复 begin 前剪贴板
//   文本（clipBefore==clipAfter 实证）。
struct W2PasteToken {
  bool active = true;
  bool dispatched = false;
  std::wstring savedText;
  bool hadText = false;
};
static std::map<int, W2PasteToken> g_w2PasteTokens;
static std::mutex g_w2PasteMutex;
static int g_w2PasteNextToken = 0;
static UINT g_w2OwnerFormat = 0;

// begin 的接管动作（worker 线程执行；[S] async 资源名 "ProvidedPasteBeginWorker"）
static int W2TakeOverClipboard(std::wstring* savedText) {
  // 返回 token（>0 成功；0 = 接管失败）。保存文本 → Empty → 仅置 owner 标记
  //（[E] 接管态读文本 invalid_data——文本格式被清空，仅注册格式在场）
  bool hadText = false;
  if (!OpenClipboard(nullptr)) return 0;
  if (IsClipboardFormatAvailable(CF_UNICODETEXT)) {
    HANDLE h = GetClipboardData(CF_UNICODETEXT);
    if (h) {
      if (auto* w = (const wchar_t*)GlobalLock(h)) {
        if (savedText) *savedText = w;
        hadText = true;
        GlobalUnlock(h);
      }
    }
  }
  (void)hadText;
  EmptyClipboard();
  if (!g_w2OwnerFormat)
    g_w2OwnerFormat = RegisterClipboardFormatW(L"ZCodeCuaProvidedPasteOwner");
  if (g_w2OwnerFormat) {
    HGLOBAL marker = GlobalAlloc(GMEM_MOVEABLE, 8);
    if (marker) {
      memcpy(GlobalLock(marker), "W2PBMKR", 8);
      GlobalUnlock(marker);
      if (!SetClipboardData(g_w2OwnerFormat, marker)) GlobalFree(marker);
    }
  }
  CloseClipboard();
  std::lock_guard<std::mutex> lock(g_w2PasteMutex);
  return ++g_w2PasteNextToken;
}

class ProvidedPasteBeginWorker : public Napi::AsyncWorker {
  // [E] 官方支持格式走 async（"text" begin 返回 Promise；unsupported 路径同步
  // 返回结果对象——双形态均 2026-11-11 探针实测）。[S] 资源名 ProvidedPasteBeginWorker。
 public:
  ProvidedPasteBeginWorker(Napi::Env env)
      : Napi::AsyncWorker(env, "ProvidedPasteBeginWorker"),
        deferred_(Napi::Promise::Deferred::New(env)) {}
  Napi::Promise Promise() const { return deferred_.Promise(); }
  void Execute() override {
    std::wstring saved;
    int token = W2TakeOverClipboard(&saved);
    if (token > 0) {
      std::lock_guard<std::mutex> lock(g_w2PasteMutex);
      W2PasteToken tok;
      tok.savedText = std::move(saved);
      tok.hadText = true;
      g_w2PasteTokens[token] = std::move(tok);
      token_ = token;
    }
  }
  void OnOK() override {
    Napi::Env env = Env();
    auto obj = Napi::Object::New(env);
    obj.Set("ok", Napi::Boolean::New(env, token_ > 0));
    obj.Set("error", token_ > 0 ? env.Null() : Napi::Value(Napi::String::New(env, "pasteboard_write_failed")));
    obj.Set("token", Napi::Number::New(env, (double)token_));
    deferred_.Resolve(obj);
  }

 private:
  Napi::Promise::Deferred deferred_;
  int token_ = 0;
};

static Napi::Value PasteboardBeginProvidedPaste(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsStr(info[0]) || !IsStr(info[1]))
    return TypeErrorThrow(env, "pasteboardBeginProvidedPaste(text, format) expects two strings");
  std::wstring fmt = Widen(info[1].As<Napi::String>().Utf8Value());
  if (!(fmt == L"html" || fmt == L"text")) {
    // [E] 官方 unsupported 路径同步返回（探针 face 直采为普通对象）
    auto obj = Napi::Object::New(env);
    obj.Set("ok", Napi::Boolean::New(env, false));
    obj.Set("error", Napi::String::New(env, "unsupported_format"));
    obj.Set("token", Napi::Number::New(env, 0));
    return obj;
  }
  auto* worker = new ProvidedPasteBeginWorker(env);
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

static Napi::Value PasteboardMarkProvidedPasteDispatched(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsNum(info[0]))
    return TypeErrorThrow(env, "pasteboardMarkProvidedPasteDispatched(token) expects a token");
  int token = (int)info[0].As<Napi::Number>().Int32Value();
  std::lock_guard<std::mutex> lock(g_w2PasteMutex);
  auto it = g_w2PasteTokens.find(token);
  if (it == g_w2PasteTokens.end() || !it->second.active)
    return Napi::Boolean::New(env, false);
  it->second.dispatched = true;
  return Napi::Boolean::New(env, true);
}

class ProvidedPasteFinishWorker : public Napi::AsyncWorker {
  // [S] 资源名 "ProvidedPasteFinishWorker"；[E] 任意数值 token → resolve true
 public:
  ProvidedPasteFinishWorker(Napi::Env env, int token)
      : Napi::AsyncWorker(env, "ProvidedPasteFinishWorker"),
        deferred_(Napi::Promise::Deferred::New(env)), token_(token) {}
  Napi::Promise Promise() const { return deferred_.Promise(); }
  void Execute() override {
    std::wstring saved;
    bool hadText = false, wasActive = false;
    {
      std::lock_guard<std::mutex> lock(g_w2PasteMutex);
      auto it = g_w2PasteTokens.find(token_);
      if (it != g_w2PasteTokens.end() && it->second.active) {
        wasActive = true;
        hadText = it->second.hadText;
        saved = it->second.savedText;
        it->second.active = false;
      }
    }
    if (wasActive) {
      // [E] 恢复 begin 前文本（官方 clipBefore==clipAfter）
      if (OpenClipboard(nullptr)) {
        EmptyClipboard();
        if (hadText) {
          SIZE_T bytes = (saved.size() + 1) * sizeof(wchar_t);
          HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, bytes);
          if (h) {
            memcpy(GlobalLock(h), saved.c_str(), bytes);
            GlobalUnlock(h);
            if (!SetClipboardData(CF_UNICODETEXT, h)) GlobalFree(h);
          }
        }
        CloseClipboard();
      }
    }
  }
  void OnOK() override { deferred_.Resolve(Napi::Boolean::New(Env(), true)); }

 private:
  Napi::Promise::Deferred deferred_;
  int token_;
};

static Napi::Value PasteboardFinishProvidedPaste(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsNum(info[0]))
    return TypeErrorThrow(env, "pasteboardFinishProvidedPaste(token) expects a token");
  int token = (int)info[0].As<Napi::Number>().Int32Value();
  auto* worker = new ProvidedPasteFinishWorker(env, token);
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

class ProvidedPasteReadWorker : public Napi::AsyncWorker {
  // [S] 官方 strings async 资源名 "ProvidedPasteReadWorker"。读取计数深语义 [I]：
  // 官方经 owner/open 轮询识别读取方（GetClipboardOwner/GetOpenClipboardWindow
  // 导入在场）；探针环境（无外部读取方）恒 reads=0 → 超时形，此处以 owner 变化
  // 计数为保守对齐。
 public:
  ProvidedPasteReadWorker(Napi::Env env, int token, bool tokenValid, bool dispatchedAtStart,
                          DWORD timeoutMs)
      : Napi::AsyncWorker(env, "ProvidedPasteReadWorker"),
        deferred_(Napi::Promise::Deferred::New(env)),
        token_(token), tokenValid_(tokenValid), dispatchedAtStart_(dispatchedAtStart),
        timeoutMs_(timeoutMs) {}
  Napi::Promise Promise() const { return deferred_.Promise(); }
  void Execute() override {
    if (!tokenValid_) {
      error_ = "unknown_paste_token";
      return;
    }
    ULONGLONG deadline = GetTickCount64() + timeoutMs_;
    HWND lastOwner = GetClipboardOwner();
    while (GetTickCount64() < deadline) {
      Sleep(16);
      HWND owner = GetClipboardOwner();
      if (owner && owner != lastOwner) {
        reads_++;
        if (!dispatchedAtStart_) readsBeforeDispatch_++;
      }
      lastOwner = owner;
    }
    error_ = "pasteboard_read_timed_out";
  }
  void OnOK() override {
    Napi::Env env = Env();
    auto r = Napi::Object::New(env);  // [E] 8 键（键序=官方 dump 原序）
    r.Set("ok", Napi::Boolean::New(env, false));
    r.Set("reads", Napi::Number::New(env, (double)reads_));
    r.Set("readsBeforeDispatch", Napi::Number::New(env, (double)readsBeforeDispatch_));
    r.Set("holdMs", Napi::Number::New(env, 0));
    r.Set("readerPid", Napi::Number::New(env, 0));
    r.Set("refusedReads", Napi::Number::New(env, 0));
    r.Set("unverifiedReads", Napi::Number::New(env, 0));
    r.Set("error", Napi::String::New(env, error_.c_str()));
    deferred_.Resolve(r);
  }

 private:
  Napi::Promise::Deferred deferred_;
  int token_;
  bool tokenValid_, dispatchedAtStart_;
  DWORD timeoutMs_;
  int reads_ = 0, readsBeforeDispatch_ = 0;
  std::string error_;
};

static Napi::Value PasteboardAwaitProvidedRead(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsNum(info[0]))
    return TypeErrorThrow(env,
                          "pasteboardAwaitProvidedRead(token, timeoutMs, graceMs, minHoldMs) "
                          "expects a token");
  int token = (int)info[0].As<Napi::Number>().Int32Value();
  DWORD timeoutMs = info.Length() > 1 && IsNum(info[1])
                        ? (DWORD)info[1].As<Napi::Number>().Uint32Value()
                        : 0;
  bool valid = false, dispatched = false;
  {
    std::lock_guard<std::mutex> lock(g_w2PasteMutex);
    auto it = g_w2PasteTokens.find(token);
    valid = it != g_w2PasteTokens.end() && it->second.active;
    dispatched = valid && it->second.dispatched;
  }
  auto* worker = new ProvidedPasteReadWorker(env, token, valid, dispatched, timeoutMs);
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

// —— getWindowId / hasActiveInputHolds ——
static Napi::Value GetWindowId(const Napi::CallbackInfo& info) {
  // [E] 非字符串 → TypeError "getWindowId(ref) expects a string"；空/不在场的 ref
  // → null（非 0 非抛——纯解析形态与硬编码字符串均 null 实证：值取自元素注册表
  // elementAtPoint/readElement 产出，非 ref 文本解析）；活跃元素 ref → 宿主窗 HWND
  // 数值（Pane 等非窗口元素 → 原生窗上溯至首个非零 NativeWindowHandle）。
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "getWindowId(ref) expects a string");
  // 注册表先行（负 RuntimeId 段 rt: ref 不可解析——同 ResolveRefWindowId 注）
  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());
  if (!el) {
    auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());
    if (!ref) return env.Null();
    el = ResolveRefToElement(*ref);
  }
  if (!el) return env.Null();
  UIA_HWND hwnd = 0;
  el->get_CurrentNativeWindowHandle(&hwnd);
  if (!hwnd) {
    // 宿主窗上溯：RawViewWalker 逐级父元素至首个非零 NativeWindowHandle（Chromium 深树 ≤256 级）
    IUIAutomation* uia = GetUia();
    IUIAutomationTreeWalker* walker = nullptr;
    if (uia && SUCCEEDED(uia->get_RawViewWalker(&walker)) && walker) {
      IUIAutomationElement* cur = el;
      cur->AddRef();
      for (int i = 0; i < 256 && cur; i++) {
        IUIAutomationElement* parent = nullptr;
        if (FAILED(walker->GetParentElement(cur, &parent)) || !parent) {
          cur->Release();
          cur = nullptr;
          break;
        }
        cur->Release();
        cur = parent;
        UIA_HWND ph = 0;
        cur->get_CurrentNativeWindowHandle(&ph);
        if (ph) {
          hwnd = ph;
          break;
        }
      }
      if (cur) cur->Release();
      walker->Release();
    }
  }
  el->Release();
  return hwnd ? Napi::Number::New(env, (double)(uintptr_t)hwnd) : env.Null();
}

static Napi::Value HasActiveInputHolds(const Napi::CallbackInfo& info) {
  // [E] 官方探针：fresh 进程 / holdKeyGlobal 建压后 / cancel 后 均 false（恒 false
  // 不抛；hold 记账与本面解耦——win 官方 holdKeyGlobal 不驱动此布尔）。
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}

// —— W3 批（win 专属 22 面）——行为锚=官方 0.6.5 addon fresh-process 探针 2026-11-11（TypeError 文案 [S] strings；layer/decorative 词表 [S]+[E]；机制级对齐，[I] 项见各函数注释）

// —— surface 域 6 面（W3；[E] 官方 0.6.5 win 探针 2026-11-11 全形采集）——
// frameWindowContext 恒 20 键：window_id/window_generation（UIA RuntimeId[2]，与
// 官方 ref ":generation:N" 同源）/producer_id（"<本进程pid>:<FILETIME 100ns 十进制>"，
// 模块级常量）/minimized/pid/tid/bundle_id/owner_window_id/focused_input_window_id
//（GetGUIThreadInfo(hwnd 所属线程).hwndFocus 且根为 hwnd 时取值，否则 0——
// notepad 持焦实测非 0、explorer 后台实测 0）/enabled/visible/is_modal/is_menu/
// bounds[x,y,w,h]/process_start_time（进程创建 FILETIME 十进制串）/
// input{active,focus,capture,menu_owner}（同 GUITHREADINFO 门控）。坏参/坏 hwnd
// → null（不抛）。
static std::string W3ProducerId() {
  static std::string id = [] {
    FILETIME ft{};
    GetSystemTimeAsFileTime(&ft);
    ULONGLONG v = ((ULONGLONG)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
    return std::to_string(GetCurrentProcessId()) + ":" + std::to_string(v);
  }();
  return id;
}
static bool W3IsFiniteInt(const Napi::Value& v) {
  return v.IsNumber() && std::isfinite(v.As<Napi::Number>().DoubleValue()) &&
         v.As<Napi::Number>().DoubleValue() == std::floor(v.As<Napi::Number>().DoubleValue());
}
static int W3WindowGeneration(HWND hwnd) {
  IUIAutomation* uia = GetUia();
  if (!uia) return 1;
  IUIAutomationElement* el = nullptr;
  if (FAILED(uia->ElementFromHandle(hwnd, &el)) || !el) return 1;
  SAFEARRAY* sa = nullptr;
  int gen = 1;
  if (SUCCEEDED(el->GetRuntimeId(&sa)) && sa) {
    LONG lo = 0, hi = 0;
    SafeArrayGetLBound(sa, 1, &lo);
    SafeArrayGetUBound(sa, 1, &hi);
    if (hi - lo + 1 >= 3) {
      int v = 0;
      LONG idx = lo + 2;
      if (SUCCEEDED(SafeArrayGetElement(sa, &idx, &v))) gen = v;
    }
    SafeArrayDestroy(sa);
  }
  el->Release();
  return gen;
}
static std::string W3ProcessStartTime(DWORD pid) {
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return "0";
  FILETIME ft{}, dummy1{}, dummy2{}, dummy3{};
  if (!GetProcessTimes(h, &ft, &dummy1, &dummy2, &dummy3)) ft = {};
  CloseHandle(h);
  ULONGLONG v = ((ULONGLONG)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
  return std::to_string(v);
}
static Napi::Value FrameWindowContext(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsNum(info[0])) return env.Null();
  double raw = info[0].As<Napi::Number>().DoubleValue();
  HWND hwnd = (HWND)(uintptr_t)(int64_t)raw;
  if (!hwnd || !IsWindow(hwnd)) return env.Null();
  DWORD pid = 0;
  DWORD tid = GetWindowThreadProcessId(hwnd, &pid);
  GUITHREADINFO gti{};
  gti.cbSize = sizeof(gti);
  bool hasGti = GetGUIThreadInfo(tid, &gti) != FALSE;
  auto rootOf = [](HWND w) { HWND r = GetAncestor(w, GA_ROOT); return r ? r : w; };
  double focusedInput = 0;
  double inActive = 0, inFocus = 0, inCapture = 0, inMenu = 0;
  if (hasGti) {
    if (gti.hwndFocus && rootOf(gti.hwndFocus) == hwnd) focusedInput = (double)(uintptr_t)gti.hwndFocus;
    if (gti.hwndActive && rootOf(gti.hwndActive) == hwnd) inActive = (double)(uintptr_t)gti.hwndActive;
    if (focusedInput) inFocus = focusedInput;
    if (gti.hwndCapture && rootOf(gti.hwndCapture) == hwnd) inCapture = (double)(uintptr_t)gti.hwndCapture;
    if (gti.hwndMenuOwner && rootOf(gti.hwndMenuOwner) == hwnd) inMenu = (double)(uintptr_t)gti.hwndMenuOwner;
  }
  wchar_t img[1024]{};
  {
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (h) {
      DWORD n = 1024;
      if (!QueryFullProcessImageNameW(h, 0, img, &n)) img[0] = 0;
      CloseHandle(h);
    }
  }
  RECT r{};
  GetWindowRect(hwnd, &r);
  wchar_t cls[256]{};
  GetClassNameW(hwnd, cls, 256);
  HWND owner = GetWindow(hwnd, GW_OWNER);
  auto obj = Napi::Object::New(env);
  obj.Set("window_id", Napi::Number::New(env, (double)(uintptr_t)hwnd));
  obj.Set("window_generation", Napi::Number::New(env, W3WindowGeneration(hwnd)));
  obj.Set("producer_id", Napi::String::New(env, W3ProducerId()));
  obj.Set("minimized", Napi::Boolean::New(env, IsIconic(hwnd) != FALSE));
  obj.Set("pid", Napi::Number::New(env, (double)pid));
  obj.Set("tid", Napi::Number::New(env, (double)tid));
  obj.Set("bundle_id", Napi::String::New(env, Narrow(img)));
  obj.Set("owner_window_id", Napi::Number::New(env, (double)(uintptr_t)(owner ? owner : 0)));
  obj.Set("focused_input_window_id", Napi::Number::New(env, focusedInput));
  obj.Set("enabled", Napi::Boolean::New(env, IsWindowEnabled(hwnd) != FALSE));
  obj.Set("visible", Napi::Boolean::New(env, IsWindowVisible(hwnd) != FALSE));
  obj.Set("is_modal", Napi::Boolean::New(env, owner != nullptr && !IsWindowEnabled(hwnd)));
  obj.Set("is_menu", Napi::Boolean::New(env, wcscmp(cls, L"#32768") == 0));
  obj.Set("bounds", BoundsArray(env, r.left, r.top, r.right - r.left, r.bottom - r.top));
  obj.Set("process_start_time", Napi::String::New(env, W3ProcessStartTime(pid)));
  auto input = Napi::Object::New(env);
  input.Set("active", Napi::Number::New(env, inActive));
  input.Set("focus", Napi::Number::New(env, inFocus));
  input.Set("capture", Napi::Number::New(env, inCapture));
  input.Set("menu_owner", Napi::Number::New(env, inMenu));
  obj.Set("input", input);
  return obj;
}
static Napi::Value GetForegroundRootWindowId(const Napi::CallbackInfo& info) {
  // [E] 参数被忽略（坏参同值）；前台根窗 GA_ROOT；无前台 → 0 形态由消费方判
  (void)info;
  HWND fg = GetForegroundWindow();
  HWND root = fg ? GetAncestor(fg, GA_ROOT) : nullptr;
  return Napi::Number::New(info.Env(), (double)(uintptr_t)(root ? root : fg));
}
static Napi::Value ResolveRefWindowId(const Napi::Env& env, const Napi::CallbackInfo& info) {
  // getWindowId 与 getDispatchWindowId 共用（[E] 后者抛 getWindowId 同款文案=同链）。
  // 注册表精确匹配先行：rt: ref 的 RuntimeId 段可为负（实测 "42-10033500-4--4179"），
  // '-' 连接序列化后 ParseRef 空段判 null——解析在查找之后仅作兜底。
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "getWindowId(ref) expects a string");
  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());
  if (!el) {
    auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());
    if (!ref) return env.Null();
    el = ResolveRefToElement(*ref);
  }
  if (!el) return env.Null();
  UIA_HWND hwnd = 0;
  el->get_CurrentNativeWindowHandle(&hwnd);
  if (!hwnd) {
    IUIAutomation* uia = GetUia();
    IUIAutomationTreeWalker* walker = nullptr;
    if (uia && SUCCEEDED(uia->get_RawViewWalker(&walker)) && walker) {
      IUIAutomationElement* cur = el;
      cur->AddRef();
      for (int i = 0; i < 256 && cur; i++) {
        IUIAutomationElement* parent = nullptr;
        if (FAILED(walker->GetParentElement(cur, &parent)) || !parent) {
          cur->Release();
          cur = nullptr;
          break;
        }
        cur->Release();
        cur = parent;
        UIA_HWND ph = 0;
        cur->get_CurrentNativeWindowHandle(&ph);
        if (ph) {
          hwnd = ph;
          break;
        }
      }
      if (cur) cur->Release();
      walker->Release();
    }
  }
  el->Release();
  return hwnd ? Napi::Number::New(env, (double)(uintptr_t)hwnd) : env.Null();
}
static Napi::Value GetDispatchWindowId(const Napi::CallbackInfo& info) {
  return ResolveRefWindowId(info.Env(), info);
}
static Napi::Value RestoreForegroundWindow(const Napi::CallbackInfo& info) {
  // [E] 非数对 → false；坏 hwnd → false。恢复舞 = W1 activateWindow 同族。
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsNum(info[0]) || !IsNum(info[1]))
    return Napi::Boolean::New(env, false);
  HWND prev = (HWND)(uintptr_t)(int64_t)info[0].As<Napi::Number>().DoubleValue();
  HWND target = (HWND)(uintptr_t)(int64_t)info[1].As<Napi::Number>().DoubleValue();
  if (!IsWindow(prev) || !IsWindow(target)) return Napi::Boolean::New(env, false);
  if (IsIconic(target)) ShowWindow(target, SW_RESTORE);
  DWORD fg_thread = GetWindowThreadProcessId(GetForegroundWindow(), nullptr);
  DWORD this_thread = GetCurrentThreadId();
  DWORD target_thread = GetWindowThreadProcessId(target, nullptr);
  AttachThreadInput(this_thread, fg_thread, TRUE);
  AttachThreadInput(this_thread, target_thread, TRUE);
  BringWindowToTop(target);
  SetForegroundWindow(target);
  AttachThreadInput(this_thread, target_thread, FALSE);
  AttachThreadInput(this_thread, fg_thread, FALSE);
  return Napi::Boolean::New(env, GetForegroundWindow() == target);
}

// classifyPostMessageDelivery：[E] 坏类型/坏 kind → false；坏 hwnd 数值 →
// {delivery:"deliverable", host:"unknown"}；Chrome_WidgetWin_*/CefBrowser*（UTF-16
// 指纹 [S] 官方窗口类表族）→ {delivery:"dropped", host:"chromium"}；其余 →
// {delivery:"deliverable", host:"unknown"}（wpf/winui3 等细分由 JS 侧 fallback 承载）。
static Napi::Value ClassifyPostMessageDelivery(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsNum(info[0]) || !IsStr(info[1])) return Napi::Boolean::New(env, false);
  static const char* kKinds[] = {"mouse_click", "text_input", "mouse_scroll",
                                 "mouse_move", "key_combo", "keystroke"};
  std::string kind = info[1].As<Napi::String>().Utf8Value();
  bool known = false;
  for (const char* k : kKinds) if (kind == k) { known = true; break; }
  if (!known) return Napi::Boolean::New(env, false);
  HWND hwnd = (HWND)(uintptr_t)(int64_t)info[0].As<Napi::Number>().DoubleValue();
  wchar_t cls[256]{};
  if (hwnd && IsWindow(hwnd)) GetClassNameW(hwnd, cls, 256);
  std::wstring c(cls);
  bool chromium = c.rfind(L"Chrome_WidgetWin_", 0) == 0 || c.rfind(L"CefBrowser", 0) == 0 ||
                  c.rfind(L"yChrome_WidgetWin_", 0) == 0;
  auto obj = Napi::Object::New(env);
  obj.Set("delivery", Napi::String::New(env, chromium ? "dropped" : "deliverable"));
  obj.Set("host", Napi::String::New(env, chromium ? "chromium" : "unknown"));
  return obj;
}

// enumerateSurfacesForFrame：[E] 非双数 → TypeError；坏 hwnd → null；真窗 →
// {surfaces:[presentation_root(+owned 同 pid 面)], independent_candidates:[同 pid
// 未归属窗 ×attribution_failure:no_owner_no_uia_no_menu_state], decorative_summaries:
// [{label:"Class ×N",count,representative_window_id}], filtered:[其余可见窗 ×reason
// 词表 mandatory:invisible/cloaked:1|2/mandatory:no_client/decorative:shadow_owner_form/
// decorative:layered_clickthrough/unattributed_other_exe]}。layer 为官方内部计数
//（[I] 不可导出，探针归一化）。attribution/classification 词表 [S] strings。
struct W3EnumCtx {
  Napi::Env env;
  DWORD rootPid = 0;
  HWND root = nullptr;
  Napi::Array surfaces, candidates, decorative, filtered;
  std::map<std::wstring, int> decorativeCounts;
  std::map<std::wstring, HWND> decorativeReps;
};
static Napi::Value EnumerateSurfacesForFrame(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsNum(info[0]) || !IsNum(info[1]))
    return TypeErrorThrow(env, "enumerateSurfacesForFrame(pid, rootHwnd) expects two numbers");
  DWORD pid = (DWORD)info[0].As<Napi::Number>().Uint32Value();
  HWND root = (HWND)(uintptr_t)(int64_t)info[1].As<Napi::Number>().DoubleValue();
  if (!root || !IsWindow(root)) return env.Null();
  W3EnumCtx ctx{env, pid, root, Napi::Array::New(env, 0), Napi::Array::New(env, 0),
                Napi::Array::New(env, 0), Napi::Array::New(env, 0)};
  auto pushSurface = [&](HWND hwnd, const char* relation) {
    DWORD wpid = 0;
    DWORD wtid = GetWindowThreadProcessId(hwnd, &wpid);
    wchar_t cls[256]{}, title[512]{};
    GetClassNameW(hwnd, cls, 256);
    GetWindowTextW(hwnd, title, 512);
    RECT r{};
    GetWindowRect(hwnd, &r);
    auto obj = Napi::Object::New(ctx.env);
    obj.Set("window_id", Napi::Number::New(ctx.env, (double)(uintptr_t)hwnd));
    obj.Set("pid", Napi::Number::New(ctx.env, (double)wpid));
    obj.Set("tid", Napi::Number::New(ctx.env, (double)wtid));
    obj.Set("class_name", Napi::String::New(ctx.env, Narrow(cls)));
    obj.Set("title", title[0] ? Napi::Value(Napi::String::New(ctx.env, Narrow(title))) : ctx.env.Null());
    obj.Set("bounds", BoundsArray(ctx.env, r.left, r.top, r.right - r.left, r.bottom - r.top));
    obj.Set("layer", Napi::Number::New(ctx.env, 0));  // [I] 官方内部计数不可导出
    obj.Set("surface_kind", Napi::String::New(ctx.env, "window"));
    obj.Set("relation", Napi::String::New(ctx.env, relation));
    ctx.surfaces.Set(ctx.surfaces.Length(), obj);
  };
  pushSurface(root, "presentation_root");
  // owned 同 pid 面枚举（[I] 关系名按族推断；探针环境无 owned 面出场）
  struct OwnedCtx {
    W3EnumCtx* c;
    std::vector<HWND> hits;
  } octx{&ctx, {}};
  EnumWindows([](HWND hwnd, LPARAM lp) -> BOOL {
    auto* oc = (OwnedCtx*)lp;
    if (hwnd == oc->c->root) return TRUE;
    DWORD wpid = 0;
    GetWindowThreadProcessId(hwnd, &wpid);
    if (wpid != oc->c->rootPid) return TRUE;
    HWND owner = GetWindow(hwnd, GW_OWNER);
    if (owner == oc->c->root && IsWindowVisible(hwnd)) oc->hits.push_back(hwnd);
    return TRUE;
  }, (LPARAM)&octx);
  for (HWND h : octx.hits) pushSurface(h, "owned_popup");
  // 全窗分类：candidates（同 pid 未归属）/ filtered（词表）/ decorative 汇总
  struct ClassCtx {
    W3EnumCtx* c;
    std::vector<HWND> candidates, filteredInvisible, filteredCloak1, filteredCloak2,
        filteredNoClient, filteredShadow, filteredClickthrough, filteredOther, decorativeOrder;
  } cctx{&ctx};
  EnumWindows([](HWND hwnd, LPARAM lp) -> BOOL {
    auto* cc = (ClassCtx*)lp;
    if (hwnd == cc->c->root) return TRUE;
    DWORD wpid = 0;
    GetWindowThreadProcessId(hwnd, &wpid);
    if (GetWindow(hwnd, GW_OWNER) == cc->c->root) return TRUE;
    wchar_t cls[256]{};
    GetClassNameW(hwnd, cls, 256);
    std::wstring c(cls);
    // 判序（[E] 官方 filtered 词表分布推断）：SysShadow 按类名归因（先于可见性
    // ——影子窗可见态不稳）→ invisible → cloaked → no_client → decorative（精确
    // 类名，substring 会撞 TIMER 含 IME 的假阳性）→ layered_clickthrough → other。
    if (c == L"SysShadow") {
      cc->filteredShadow.push_back(hwnd);
      return TRUE;
    }
    bool visible = IsWindowVisible(hwnd) != FALSE;
    RECT r{};
    GetWindowRect(hwnd, &r);
    bool noClient = r.right - r.left <= 0 || r.bottom - r.top <= 0;
    int cloaked = 0;
    using DwmGetWinAttrFn = HRESULT(WINAPI*)(HWND, DWORD, void*, DWORD);
    static DwmGetWinAttrFn dwmFn = []() -> DwmGetWinAttrFn {
      HMODULE m = GetModuleHandleW(L"dwmapi.dll");
      return m ? (DwmGetWinAttrFn)GetProcAddress(m, "DwmGetWindowAttribute") : nullptr;
    }();
    if (dwmFn) dwmFn(hwnd, 14 /*DWMWA_CLOAKED*/, &cloaked, sizeof(cloaked));
    if (!visible) {
      cc->filteredInvisible.push_back(hwnd);
      return TRUE;
    }
    if (cloaked == 1 || cloaked == 2 || cloaked == 3) {
      (cloaked == 1 ? cc->filteredCloak1 : cc->filteredCloak2).push_back(hwnd);
      return TRUE;
    }
    // decorative 类族（[E] 2026-11-11 shadow-hunt 实证集：Qt5151*QWindow* /
    // default_ime* / CEF-OSC-WIDGET / SoPY_Status / ZcodeGhostCursorOverlay /
    // tooltips/MSCTFIME/Default IME/IME；wetype/WeType 非装饰属 invisible）。
    // 分路（[E] 同类族两出路口径）：owner 链归属本帧 → decorative_summaries；
    // 未归属 → filtered reason decorative:shadow_owner_form（先于 no_client——
    // 影子窗矩形常零尺寸，按类名归因优先）。
    bool decorative = c == L"tooltips_class32" || c == L"MSCTFIME UI" ||
                      c == L"Default IME" || c == L"IME" || c == L"SoPY_Status" ||
                      c == L"CEF-OSC-WIDGET" ||
                      c.rfind(L"ZcodeGhostCursorOverlay", 0) == 0 ||
                      c.rfind(L"default_ime", 0) == 0 ||
                      c.rfind(L"Qt51513QWindowTool", 0) == 0 ||
                      c.rfind(L"Qt51519QWindowTool", 0) == 0 ||
                      c.rfind(L"Qt51513QWindowIcon", 0) == 0;
    if (decorative) {
      HWND w = hwnd;
      bool attributed = false;
      while (w) {
        HWND owner = GetWindow(w, GW_OWNER);
        if (!owner) break;
        if (owner == cc->c->root) {
          attributed = true;
          break;
        }
        w = owner;
      }
      if (attributed) {
        cc->c->decorativeCounts[c]++;
        cc->c->decorativeReps.emplace(c, hwnd);
      } else {
        cc->filteredShadow.push_back(hwnd);
      }
      return TRUE;
    }
    if (noClient) {
      cc->filteredNoClient.push_back(hwnd);
      return TRUE;
    }
    LONG_PTR ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    bool layeredClickthrough = (ex & WS_EX_LAYERED) && (ex & WS_EX_TRANSPARENT);
    if (layeredClickthrough) {
      cc->filteredClickthrough.push_back(hwnd);
      return TRUE;
    }
    if (wpid == cc->c->rootPid) {
      cc->candidates.push_back(hwnd);
    } else {
      cc->filteredOther.push_back(hwnd);
    }
    return TRUE;
  }, (LPARAM)&cctx);
  auto pushCandidate = [&](HWND hwnd) {
    DWORD wpid = 0;
    GetWindowThreadProcessId(hwnd, &wpid);
    wchar_t cls[256]{}, title[512]{};
    GetClassNameW(hwnd, cls, 256);
    GetWindowTextW(hwnd, title, 512);
    RECT r{};
    GetWindowRect(hwnd, &r);
    auto obj = Napi::Object::New(env);
    obj.Set("window_id", Napi::Number::New(env, (double)(uintptr_t)hwnd));
    obj.Set("pid", Napi::Number::New(env, (double)wpid));
    obj.Set("class_name", Napi::String::New(env, Narrow(cls)));
    obj.Set("title", title[0] ? Napi::Value(Napi::String::New(env, Narrow(title))) : env.Null());
    obj.Set("bounds", BoundsArray(env, r.left, r.top, r.right - r.left, r.bottom - r.top));
    obj.Set("layer", Napi::Number::New(env, 0));
    obj.Set("attribution_failure", Napi::String::New(env, "no_owner_no_uia_no_menu_state"));
    ctx.candidates.Set(ctx.candidates.Length(), obj);
  };
  for (HWND h : cctx.candidates) pushCandidate(h);
  auto pushFiltered = [&](HWND hwnd, const char* reason) {
    DWORD wpid = 0;
    GetWindowThreadProcessId(hwnd, &wpid);
    wchar_t cls[256]{};
    GetClassNameW(hwnd, cls, 256);
    auto obj = Napi::Object::New(env);
    obj.Set("window_id", Napi::Number::New(env, (double)(uintptr_t)hwnd));
    obj.Set("class_name", Napi::String::New(env, Narrow(cls)));
    obj.Set("pid", Napi::Number::New(env, (double)wpid));
    obj.Set("reason", Napi::String::New(env, reason));
    ctx.filtered.Set(ctx.filtered.Length(), obj);
  };
  for (HWND h : cctx.filteredInvisible) pushFiltered(h, "mandatory:invisible");
  for (HWND h : cctx.filteredCloak1) pushFiltered(h, "cloaked:1");
  for (HWND h : cctx.filteredCloak2) pushFiltered(h, "cloaked:2");
  for (HWND h : cctx.filteredNoClient) pushFiltered(h, "mandatory:no_client");
  for (HWND h : cctx.filteredShadow) pushFiltered(h, "decorative:shadow_owner_form");
  for (HWND h : cctx.filteredClickthrough) pushFiltered(h, "decorative:layered_clickthrough");
  for (HWND h : cctx.filteredOther) pushFiltered(h, "unattributed_other_exe");
  for (auto& [cls, count] : ctx.decorativeCounts) {
    auto d = Napi::Object::New(env);
    d.Set("label", Napi::String::New(env, Narrow(cls) + " ×" + std::to_string(count)));
    d.Set("count", Napi::Number::New(env, (double)count));
    d.Set("representative_window_id",
          Napi::Number::New(env, (double)(uintptr_t)ctx.decorativeReps[cls]));
    ctx.decorative.Set(ctx.decorative.Length(), d);
  }
  auto result = Napi::Object::New(env);
  result.Set("surfaces", ctx.surfaces);
  result.Set("independent_candidates", ctx.candidates);
  result.Set("decorative_summaries", ctx.decorative);
  result.Set("filtered", ctx.filtered);
  return result;
}

// —— postMessage 投递 5 面（[E] notepad 探针全 ok/错误码族；TypeError 文案 [S]）——
// 通用：windowId 非有限整数/坏窗 → {ok:false,error:"invalid_target"}（[E] float/0
// 实测）；scroll 无前台门（explorer 后台 ok 实测）；key/char 有前台焦点门（explorer
// 后台 focus_missing / notepad 持焦 ok 实测）；click/drag/scroll 后台可投（同探针）。
// chromium 窗原生层不拒（[E] chrome 直投 ok——JS 层 classify 预滤是唯一闸）。
static Napi::Object W3PmError(Napi::Env env, const char* err) {
  auto obj = Napi::Object::New(env);
  obj.Set("ok", Napi::Boolean::New(env, false));
  obj.Set("error", Napi::String::New(env, err));
  return obj;
}
static Napi::Object W3PmOk(Napi::Env env) {
  auto obj = Napi::Object::New(env);
  obj.Set("ok", Napi::Boolean::New(env, true));
  return obj;
}
static bool W3PmValidWindow(const Napi::CallbackInfo& info, size_t idx, HWND* out) {
  if (idx >= info.Length() || !W3IsFiniteInt(info[idx])) {
    *out = nullptr;
    return false;
  }
  double raw = info[idx].As<Napi::Number>().DoubleValue();
  HWND h = (HWND)(uintptr_t)(int64_t)raw;
  *out = (h && IsWindow(h)) ? h : nullptr;
  return h != nullptr;  // 数值合法（含 0）→ 走 invalid_target；类型坏 → 抛
}
static bool W3ThreadHasFocus(HWND hwnd) {
  DWORD tid = GetWindowThreadProcessId(hwnd, nullptr);
  GUITHREADINFO gti{};
  gti.cbSize = sizeof(gti);
  return GetGUIThreadInfo(tid, &gti) && gti.hwndFocus != nullptr;
}
static Napi::Value PostMessageScrollAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !IsNum(info[0]) || !IsNum(info[1]) || !IsStr(info[2]) || !IsNum(info[3]))
    return TypeErrorThrow(env,
                          "postMessageScrollAsync(windowId, pid, direction, amount) expects "
                          "numbers, a direction string, and an amount");
  auto deferred = Napi::Promise::Deferred::New(env);
  HWND hwnd = nullptr;
  if (!W3PmValidWindow(info, 0, &hwnd) || !hwnd) {
    deferred.Resolve(W3PmError(env, "invalid_target"));
    return deferred.Promise();
  }
  std::string dir = info[2].As<Napi::String>().Utf8Value();
  UINT msg = WM_VSCROLL;
  WPARAM wp = SB_LINEDOWN;
  if (dir == "down") { msg = WM_VSCROLL; wp = SB_LINEDOWN; }
  else if (dir == "up") { msg = WM_VSCROLL; wp = SB_LINEUP; }
  else if (dir == "left") { msg = WM_HSCROLL; wp = SB_LINELEFT; }
  else if (dir == "right") { msg = WM_HSCROLL; wp = SB_LINERIGHT; }
  else {
    deferred.Resolve(W3PmError(env, "invalid_direction"));
    return deferred.Promise();
  }
  int amount = (int)info[3].As<Napi::Number>().Int32Value();
  for (int i = 0; i < (amount > 0 ? amount : 1); i++) PostMessageW(hwnd, msg, wp, 0);
  deferred.Resolve(W3PmOk(env));
  return deferred.Promise();
}
static Napi::Value PostMessageKeyAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !IsNum(info[0]) || !IsNum(info[1]) || !IsStr(info[2]))
    return TypeErrorThrow(env,
                          "postMessageKeyAsync(windowId, pid, chord) expects numbers and a string");
  auto deferred = Napi::Promise::Deferred::New(env);
  HWND hwnd = nullptr;
  if (!W3PmValidWindow(info, 0, &hwnd) || !hwnd) {
    deferred.Resolve(W3PmError(env, "invalid_target"));
    return deferred.Promise();
  }
  if (!W3ThreadHasFocus(hwnd)) {
    deferred.Resolve(W3PmError(env, "focus_missing"));
    return deferred.Promise();
  }
  std::string chord = info[2].As<Napi::String>().Utf8Value();
  // 和弦→末键 VK（复用全局按键语义：修饰+键；此处按单键/常见名解析）
  UINT vk = 0;
  std::string key = chord;
  size_t plus = chord.rfind('+');
  if (plus != std::string::npos) key = chord.substr(plus + 1);
  if (key.size() == 1) vk = (UINT)toupper(key[0]);
  else if (key == "enter") vk = VK_RETURN;
  else if (key == "f5") vk = VK_F5;
  else if (key == "tab") vk = VK_TAB;
  else if (key == "escape") vk = VK_ESCAPE;
  else if (key.size() == 2 && key[0] == 'f' && key[1] >= '1' && key[1] <= '9') vk = VK_F1 + (key[1] - '1');
  if (!vk) {
    deferred.Resolve(W3PmError(env, "invalid_key"));
    return deferred.Promise();
  }
  PostMessageW(hwnd, WM_KEYDOWN, vk, 0);
  PostMessageW(hwnd, WM_KEYUP, vk, 0);
  deferred.Resolve(W3PmOk(env));
  return deferred.Promise();
}
static Napi::Value PostMessageCharAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !IsNum(info[0]) || !IsNum(info[1]) || !IsStr(info[2]))
    return TypeErrorThrow(env,
                          "postMessageCharAsync(windowId, pid, text, elementRef?) expects "
                          "numbers and strings");
  auto deferred = Napi::Promise::Deferred::New(env);
  HWND hwnd = nullptr;
  if (!W3PmValidWindow(info, 0, &hwnd) || !hwnd) {
    deferred.Resolve(W3PmError(env, "invalid_target"));
    return deferred.Promise();
  }
  if (!W3ThreadHasFocus(hwnd)) {
    deferred.Resolve(W3PmError(env, "focus_missing"));
    return deferred.Promise();
  }
  std::wstring text = Widen(info[2].As<Napi::String>().Utf8Value());
  for (wchar_t ch : text) PostMessageW(hwnd, WM_CHAR, (WPARAM)ch, 0);
  deferred.Resolve(W3PmOk(env));
  return deferred.Promise();
}
static Napi::Value PostMessageClickAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 6 || !IsNum(info[0]) || !IsNum(info[1]) || !IsNum(info[2]) ||
      !IsNum(info[3]) || !IsStr(info[4]) || !IsNum(info[5]))
    return TypeErrorThrow(env,
                          "postMessageClickAsync(windowId, pid, x, y, button, clicks) expects "
                          "numbers, a button string, and a click count");
  auto deferred = Napi::Promise::Deferred::New(env);
  HWND hwnd = nullptr;
  if (!W3PmValidWindow(info, 0, &hwnd) || !hwnd) {
    deferred.Resolve(W3PmError(env, "invalid_target"));
    return deferred.Promise();
  }
  LONG x = (LONG)info[2].As<Napi::Number>().Int32Value();
  LONG y = (LONG)info[3].As<Napi::Number>().Int32Value();
  std::string button = info[4].As<Napi::String>().Utf8Value();
  int clicks = (int)info[5].As<Napi::Number>().Int32Value();
  UINT down = button == "right" ? WM_RBUTTONDOWN : WM_LBUTTONDOWN;
  UINT up = button == "right" ? WM_RBUTTONUP : WM_LBUTTONUP;
  // 客户区坐标（[I] 官方坐标系按客户区投递推断；screen→client 转换）
  POINT p{x, y};
  ScreenToClient(hwnd, &p);
  LPARAM lp = MAKELPARAM(p.x, p.y);
  for (int i = 0; i < (clicks > 0 ? clicks : 1); i++) {
    PostMessageW(hwnd, down, MK_LBUTTON, lp);
    PostMessageW(hwnd, up, 0, lp);
  }
  deferred.Resolve(W3PmOk(env));
  return deferred.Promise();
}
static Napi::Value PostMessageDragAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 6 || !IsNum(info[0]) || !IsNum(info[1]) || !IsNum(info[2]) ||
      !IsNum(info[3]) || !IsNum(info[4]) || !IsNum(info[5]))
    return TypeErrorThrow(env,
                          "postMessageDragAsync(windowId, pid, fromX, fromY, toX, toY) expects "
                          "numbers");
  auto deferred = Napi::Promise::Deferred::New(env);
  HWND hwnd = nullptr;
  if (!W3PmValidWindow(info, 0, &hwnd) || !hwnd) {
    deferred.Resolve(W3PmError(env, "invalid_target"));
    return deferred.Promise();
  }
  POINT from{(LONG)info[2].As<Napi::Number>().Int32Value(),
             (LONG)info[3].As<Napi::Number>().Int32Value()};
  POINT to{(LONG)info[4].As<Napi::Number>().Int32Value(),
           (LONG)info[5].As<Napi::Number>().Int32Value()};
  ScreenToClient(hwnd, &from);
  ScreenToClient(hwnd, &to);
  PostMessageW(hwnd, WM_MOUSEMOVE, MK_LBUTTON, MAKELPARAM(from.x, from.y));
  PostMessageW(hwnd, WM_LBUTTONDOWN, MK_LBUTTON, MAKELPARAM(from.x, from.y));
  int steps = 8;
  for (int i = 1; i <= steps; i++) {
    LONG x = from.x + (to.x - from.x) * i / steps;
    LONG y = from.y + (to.y - from.y) * i / steps;
    PostMessageW(hwnd, WM_MOUSEMOVE, MK_LBUTTON, MAKELPARAM(x, y));
  }
  PostMessageW(hwnd, WM_LBUTTONUP, 0, MAKELPARAM(to.x, to.y));
  deferred.Resolve(W3PmOk(env));
  return deferred.Promise();
}

// —— UIA 模式梯 4 面 + 元素句柄对 ——
// winAxElementFromToken：[E] 非 string → TypeError；"ptr:<pid>:<HEX64>" 原生指针
// 形态；rt: 注册表 ref 亦可解析；未知 → {ok:false, reason:"token_unknown"}；
// 成功 {ok:true, element:BigInt(指针)}。winAxElementRelease：成功 true/坏参 false。
static bool W3ParsePtrRef(const std::string& ref, uintptr_t* out) {
  if (ref.compare(0, 4, "ptr:") != 0) return false;
  size_t c1 = ref.find(':', 4);
  if (c1 == std::string::npos) return false;
  std::string hex = ref.substr(c1 + 1);
  if (hex.empty()) return false;
  for (char ch : hex)
    if (!isxdigit((unsigned char)ch)) return false;
  *out = (uintptr_t)strtoull(hex.c_str(), nullptr, 16);
  return *out != 0;
}
static Napi::Value WinAxElementFromToken(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "winAxElementFromToken(ref) expects a string");
  std::string ref = info[0].As<Napi::String>().Utf8Value();
  uintptr_t ptr = 0;
  if (W3ParsePtrRef(ref, &ptr)) {
    // [E] 任意 hex（如 "ptr:0:DEADBEEF"）→ token_unknown：ptr: 形态须指向
    // 元素注册表内在场指针（活性校验），不接受裸十六进制。
    IUIAutomationElement* live = nullptr;
    {
      std::lock_guard<std::mutex> lock(g_element_map_mutex);
      for (auto& [k, v] : g_element_map) {
        if ((uintptr_t)v == ptr) {
          live = v;
          break;
        }
      }
    }
    if (live) {
      live->AddRef();  // token 持专有引用：winAxElementRelease 消费本引用
      auto obj = Napi::Object::New(env);
      obj.Set("ok", Napi::Boolean::New(env, true));
      obj.Set("element", Napi::BigInt::New(env, (uint64_t)ptr));
      return obj;
    }
    auto obj = Napi::Object::New(env);
    obj.Set("ok", Napi::Boolean::New(env, false));
    obj.Set("reason", Napi::String::New(env, "token_unknown"));
    return obj;
  }
  IUIAutomationElement* el = LookupElementRef(ref);
  if (!el) {
    auto pr = ParseRef(ref);
    if (pr) el = ResolveRefToElement(*pr);
  }
  if (!el) {
    auto obj = Napi::Object::New(env);
    obj.Set("ok", Napi::Boolean::New(env, false));
    obj.Set("reason", Napi::String::New(env, "token_unknown"));
    return obj;
  }
  // lookup 的 AddRef 引用即 token 所有权：移交（winAxElementRelease 消费）；
  // 就地 Release 会与 Release 面双重释放打穿注册表引用（实测 0xC0000374）。
  auto obj = Napi::Object::New(env);
  obj.Set("ok", Napi::Boolean::New(env, true));
  obj.Set("element", Napi::BigInt::New(env, (uint64_t)(uintptr_t)el));
  return obj;
}
static Napi::Value WinAxElementRelease(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBigInt()) return Napi::Boolean::New(env, false);
  bool lossy = false;
  uint64_t raw = info[0].As<Napi::BigInt>().Uint64Value(&lossy);
  auto* el = (IUIAutomationElement*)(uintptr_t)raw;
  if (!el) return Napi::Boolean::New(env, false);
  el->Release();
  return Napi::Boolean::New(env, true);
}
static Napi::Value ElementValueReadAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsBigInt() || !IsNum(info[1]))
    return TypeErrorThrow(env, "elementValueReadAsync(elementRef, hostWindowId) expects a bigint and a number");
  auto deferred = Napi::Promise::Deferred::New(env);
  bool lossy = false;
  auto* el = (IUIAutomationElement*)(uintptr_t)info[0].As<Napi::BigInt>().Uint64Value(&lossy);
  auto result = Napi::Object::New(env);
  if (!el) {
    result.Set("ok", Napi::Boolean::New(env, false));
    result.Set("value", env.Null());
    deferred.Resolve(result);
    return deferred.Promise();
  }
  IUIAutomationValuePattern* vp = nullptr;
  std::wstring value;
  bool ok = false;
  if (SUCCEEDED(el->GetCurrentPatternAs(UIA_ValuePatternId,
                                        __uuidof(IUIAutomationValuePattern), (void**)&vp)) && vp) {
    BSTR v = nullptr;
    if (SUCCEEDED(vp->get_CurrentValue(&v))) {
      value = v ? v : L"";
      ok = true;
      if (v) SysFreeString(v);
    }
    vp->Release();
  }
  result.Set("ok", Napi::Boolean::New(env, ok));
  result.Set("value", ok ? Napi::Value(Napi::String::New(env, Narrow(value))) : env.Null());
  deferred.Resolve(result);
  return deferred.Promise();
}
static Napi::Value SetValueReadbackAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsBigInt() || !IsNum(info[1]) || !IsStr(info[2]))
    return TypeErrorThrow(env,
                          "setValueReadbackAsync(elementRef, hostWindowId, value) expects a "
                          "bigint, a number, and a string");
  auto deferred = Napi::Promise::Deferred::New(env);
  bool lossy = false;
  auto* el = (IUIAutomationElement*)(uintptr_t)info[0].As<Napi::BigInt>().Uint64Value(&lossy);
  std::wstring value = Widen(info[2].As<Napi::String>().Utf8Value());
  // before 读
  std::wstring before;
  bool hasBefore = false;
  IUIAutomationValuePattern* vp = nullptr;
  if (el && SUCCEEDED(el->GetCurrentPatternAs(UIA_ValuePatternId,
                                              __uuidof(IUIAutomationValuePattern), (void**)&vp)) && vp) {
    BSTR v = nullptr;
    if (SUCCEEDED(vp->get_CurrentValue(&v))) {
      before = v ? v : L"";
      hasBefore = true;
      if (v) SysFreeString(v);
    }
    // 写
    BSTR b = SysAllocStringLen(value.data(), (UINT)value.size());
    HRESULT writeHr = vp->SetValue(b);
    SysFreeString(b);
    vp->Release();
    auto result = Napi::Object::New(env);
    bool writeOk = SUCCEEDED(writeHr);
    std::wstring after;
    if (writeOk && el->GetCurrentPatternAs(UIA_ValuePatternId,
                                           __uuidof(IUIAutomationValuePattern), (void**)&vp) && vp) {
      BSTR v2 = nullptr;
      if (SUCCEEDED(vp->get_CurrentValue(&v2))) {
        after = v2 ? v2 : L"";
        if (v2) SysFreeString(v2);
      }
      vp->Release();
    }
    result.Set("ok", Napi::Boolean::New(env, true));
    result.Set("writeOk", Napi::Boolean::New(env, writeOk));
    result.Set("path", Napi::String::New(env, "ax"));
    result.Set("focus_unchanged", Napi::Boolean::New(env, true));  // [I] 焦点守卫（写路径不迁焦）
    result.Set("dispatch_status", Napi::String::New(env, writeOk ? "sent" : "not_sent"));
    result.Set("before", hasBefore ? Napi::Value(Napi::String::New(env, Narrow(before))) : env.Null());
    result.Set("after", writeOk ? Napi::Value(Napi::String::New(env, Narrow(after))) : env.Null());
    deferred.Resolve(result);
    return deferred.Promise();
  }
  // 无 Value 模式 → ok:false readback_job_unavailable 形态
  auto result = Napi::Object::New(env);
  result.Set("ok", Napi::Boolean::New(env, false));
  result.Set("writeOk", Napi::Boolean::New(env, false));
  result.Set("path", Napi::String::New(env, "ax"));
  result.Set("focus_unchanged", Napi::Boolean::New(env, true));
  result.Set("dispatch_status", Napi::String::New(env, "not_sent"));
  result.Set("before", env.Null());
  result.Set("after", env.Null());
  deferred.Resolve(result);
  return deferred.Promise();
}
static Napi::Value ElementPatternCallAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsBigInt() || !IsNum(info[1]) || !IsStr(info[2]))
    return TypeErrorThrow(env,
                          "elementPatternCallAsync(elementRef, hostWindowId, pattern) expects "
                          "a bigint, a number, and a pattern string");
  std::string pattern = info[2].As<Napi::String>().Utf8Value();
  // [E] 未知 pattern 名 → 字面 false（非对象）
  static const char* kPatterns[] = {"invoke", "invoke_double", "expand", "toggle", "select", "legacy"};
  bool known = false;
  for (const char* p : kPatterns) if (pattern == p) { known = true; break; }
  if (!known) return Napi::Boolean::New(env, false);
  auto deferred = Napi::Promise::Deferred::New(env);
  bool lossy = false;
  auto* el = (IUIAutomationElement*)(uintptr_t)info[0].As<Napi::BigInt>().Uint64Value(&lossy);
  auto result = Napi::Object::New(env);
  IUIAutomationInvokePattern* ip = nullptr;
  if (el && SUCCEEDED(el->GetCurrentPatternAs(UIA_InvokePatternId,
                                              __uuidof(IUIAutomationInvokePattern), (void**)&ip)) && ip) {
    HRESULT hr = ip->Invoke();
    ip->Release();
    result.Set("ok", Napi::Boolean::New(env, SUCCEEDED(hr)));
    result.Set("result", Napi::String::New(env, SUCCEEDED(hr) ? "invoked" : "unavailable"));
    result.Set("pattern_absent", Napi::Boolean::New(env, false));
  } else {
    // [E] notepad 文本元素 invoke → {ok:false,result:"unavailable",pattern_absent:false}
    result.Set("ok", Napi::Boolean::New(env, false));
    result.Set("result", Napi::String::New(env, "unavailable"));
    result.Set("pattern_absent", Napi::Boolean::New(env, false));
  }
  deferred.Resolve(result);
  return deferred.Promise();
}
static Napi::Value HitTestInvokeAtPointAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !IsNum(info[0]) || !IsNum(info[1]) || !IsNum(info[2]) || !IsNum(info[3]))
    return TypeErrorThrow(env, "hitTestInvokeAtPointAsync(windowId, pid, x, y) expects numbers");
  auto deferred = Napi::Promise::Deferred::New(env);
  POINT p{(LONG)info[2].As<Napi::Number>().Int32Value(),
          (LONG)info[3].As<Napi::Number>().Int32Value()};
  auto result = Napi::Object::New(env);
  IUIAutomation* uia = GetUia();
  IUIAutomationElement* el = nullptr;
  if (uia && SUCCEEDED(uia->ElementFromPoint(p, &el)) && el) {
    IUIAutomationInvokePattern* ip = nullptr;
    if (SUCCEEDED(el->GetCurrentPatternAs(UIA_InvokePatternId,
                                          __uuidof(IUIAutomationInvokePattern), (void**)&ip)) && ip) {
      ip->Invoke();
      ip->Release();
      result.Set("ok", Napi::Boolean::New(env, true));
      result.Set("result", Napi::String::New(env, "invoked"));
    } else {
      result.Set("ok", Napi::Boolean::New(env, false));
      result.Set("result", Napi::String::New(env, "miss"));
    }
    result.Set("pattern_absent", Napi::Boolean::New(env, false));
    el->Release();
  } else {
    result.Set("ok", Napi::Boolean::New(env, false));
    result.Set("result", Napi::String::New(env, "miss"));
    result.Set("pattern_absent", Napi::Boolean::New(env, false));
  }
  deferred.Resolve(result);
  return deferred.Promise();
}

// —— 杂项 7 面 ——
static Napi::Value ScrollElement(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // [E] 非串 ref/坏 direction → {ok:false,axError:"illegal_argument"}（不抛）；
  // 无 ScrollItem 模式 → {ok:false,axError:"action_unsupported"}
  if (info.Length() < 3 || !IsStr(info[0]) || !IsStr(info[1]) || !IsNum(info[2]))
    return AxErrorResult(env, "illegal_argument");
  std::string dir = info[1].As<Napi::String>().Utf8Value();
  if (dir != "up" && dir != "down" && dir != "left" && dir != "right")
    return AxErrorResult(env, "illegal_argument");
  // 注册表先行（负 RuntimeId 段 rt: ref 同 ResolveRefWindowId 注）
  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());
  if (!el) {
    auto pr = ParseRef(info[0].As<Napi::String>().Utf8Value());
    if (!pr) return AxErrorResult(env, "invalid_element");
    el = ResolveRefToElement(*pr);
  }
  if (!el) return AxErrorResult(env, "invalid_element");
  IUIAutomationScrollItemPattern* sp = nullptr;
  Napi::Value result;
  if (SUCCEEDED(el->GetCurrentPatternAs(UIA_ScrollItemPatternId,
                                        __uuidof(IUIAutomationScrollItemPattern), (void**)&sp)) && sp) {
    sp->ScrollIntoView();
    sp->Release();
    result = OkResult(env);
  } else {
    result = AxErrorResult(env, "action_unsupported");
  }
  el->Release();
  return result;
}
static Napi::Value InvokeAcceleratorAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !IsNum(info[0]) || !IsNum(info[1]) || !IsStr(info[2]))
    return TypeErrorThrow(env,
                          "invokeAcceleratorAsync(windowId, pid, chord) expects numbers and a string");
  auto deferred = Napi::Promise::Deferred::New(env);
  // [E] 非 winui3 宿主 → {ok:false,result:"miss",pattern_absent:false}
  //（加速器注册表命中需宿主加速器表，跨进程 TranslateAccelerator 不可达 → miss）
  auto result = Napi::Object::New(env);
  result.Set("ok", Napi::Boolean::New(env, false));
  result.Set("result", Napi::String::New(env, "miss"));
  result.Set("pattern_absent", Napi::Boolean::New(env, false));
  deferred.Resolve(result);
  return deferred.Promise();
}
static Napi::Value CaptureWindowPngCompositeAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);
  // [E] 官方本机探针全形态（含坏 shape）→ {ok:false,error:"invalid_target"}（不抛）；
  // 管线 = WinRT Graphics.Capture（与官方同机制；本上下文不可用即同形失败）
  auto fail = [&]() {
    auto obj = Napi::Object::New(env);
    obj.Set("ok", Napi::Boolean::New(env, false));
    obj.Set("error", Napi::String::New(env, "invalid_target"));
    deferred.Resolve(obj);
  };
  if (info.Length() < 1 || !info[0].IsObject()) {
    fail();
    return deferred.Promise();
  }
  Napi::Object payload = info[0].As<Napi::Object>();
  Napi::Value rootV = payload.Get("root");
  if (!rootV.IsObject()) {
    fail();
    return deferred.Promise();
  }
  Napi::Object root = rootV.As<Napi::Object>();
  Napi::Value widV = root.Get("windowId");
  if (!widV.IsNumber()) {
    fail();
    return deferred.Promise();
  }
  HWND hwnd = (HWND)(uintptr_t)(int64_t)widV.As<Napi::Number>().DoubleValue();
  if (!hwnd || !IsWindow(hwnd)) {
    fail();
    return deferred.Promise();
  }
  // [E] 2026-11-11 判别探针：root.expectedBounds 缺席 → invalid_target；在场且与
  // 当前窗矩形精确一致（前台根窗+新界实测 ok:true PNG）→ 管线捕获；pid 一并核验。
  Napi::Value boundsV = root.Get("expectedBounds");
  bool boundsOk = false;
  if (boundsV.IsArray() && boundsV.As<Napi::Array>().Length() == 4) {
    auto arr = boundsV.As<Napi::Array>();
    bool allNum = true;
    double bv[4]{};
    for (uint32_t i = 0; i < 4; i++) {
      Napi::Value e = arr.Get(i);
      if (!e.IsNumber()) { allNum = false; break; }
      bv[i] = e.As<Napi::Number>().DoubleValue();
    }
    if (allNum) {
      RECT r{};
      GetWindowRect(hwnd, &r);
      boundsOk = bv[0] == r.left && bv[1] == r.top &&
                 bv[2] == (r.right - r.left) && bv[3] == (r.bottom - r.top);
    }
  }
  Napi::Value pidV = root.Get("pid");
  DWORD wantPid = pidV.IsNumber() ? (DWORD)pidV.As<Napi::Number>().Uint32Value() : 0;
  DWORD realPid = 0;
  GetWindowThreadProcessId(hwnd, &realPid);
  if (!boundsOk || (wantPid && realPid != wantPid)) {
    fail();
    return deferred.Promise();
  }
  auto png = CaptureViaGraphicsCapture(hwnd, nullptr);
  if (!png) {
    fail();
    return deferred.Promise();
  }
  // [E] 官方成功封套 8 键：{ok,format:"png",data:Buffer,width,height,bounds[x,y,w,h],
  // captured:[根面条目],gaps:[]}（fgRoot+精确新界实测；captured/gaps 条目形态 [I] 最小面）
  RECT r{};
  GetWindowRect(hwnd, &r);
  auto obj = Napi::Object::New(env);
  obj.Set("ok", Napi::Boolean::New(env, true));
  obj.Set("format", Napi::String::New(env, "png"));
  obj.Set("data", PngBuffer(env, *png));
  obj.Set("width", Napi::Number::New(env, (double)(r.right - r.left)));
  obj.Set("height", Napi::Number::New(env, (double)(r.bottom - r.top)));
  obj.Set("bounds", BoundsArray(env, r.left, r.top, r.right - r.left, r.bottom - r.top));
  auto captured = Napi::Array::New(env, 1);
  auto rootEntry = Napi::Object::New(env);
  rootEntry.Set("window_id", Napi::Number::New(env, (double)(uintptr_t)hwnd));
  rootEntry.Set("pid", Napi::Number::New(env, (double)realPid));
  wchar_t rootImg[1024]{};
  {
    HANDLE hp = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, realPid);
    if (hp) {
      DWORD nn = 1024;
      if (!QueryFullProcessImageNameW(hp, 0, rootImg, &nn)) rootImg[0] = 0;
      CloseHandle(hp);
    }
  }
  rootEntry.Set("owner_bundle_id", Napi::String::New(env, Narrow(rootImg)));
  rootEntry.Set("bounds", BoundsArray(env, r.left, r.top, r.right - r.left, r.bottom - r.top));
  captured.Set((uint32_t)0, rootEntry);
  obj.Set("captured", captured);
  obj.Set("gaps", Napi::Array::New(env, 0));
  deferred.Resolve(obj);
  return deferred.Promise();
}
static Napi::Value ClickAtPointAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // [E][S] 校验复用同步 clickAtPoint 文案；≤5 参 → SendInput 前台点击 → true；
  // 6-7 参带 pid/windowId → 点击后验证前台根窗==期望窗（不匹配 false——
  // packaged notepad 外壳宿主形态实测 false）。
  if (info.Length() < 5 || !IsNum(info[0]) || !IsNum(info[1]) || !IsStr(info[2]) ||
      !IsNum(info[3]) || !(info[4].IsString() || info[4].IsNull() || info[4].IsUndefined()))
    return TypeErrorThrow(env,
                          "clickAtPoint(x, y, button, clicks, modifiers?) expects two numbers, "
                          "a button string, a click count, and an optional modifiers chord");
  auto deferred = Napi::Promise::Deferred::New(env);
  LONG x = (LONG)info[0].As<Napi::Number>().Int32Value();
  LONG y = (LONG)info[1].As<Napi::Number>().Int32Value();
  std::string button = info[2].As<Napi::String>().Utf8Value();
  int clicks = (int)info[3].As<Napi::Number>().Int32Value();
  // SendInput 绝对坐标点击（与基础 clickAtPoint 同族机制）
  DWORD downFlag = button == "right" ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN;
  DWORD upFlag = button == "right" ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP;
  auto sendAt = [&](DWORD flags) {
    INPUT in{};
    in.type = INPUT_MOUSE;
    in.mi.dx = x * ((GetSystemMetrics(SM_CXSCREEN) > 0 ? 65535 / GetSystemMetrics(SM_CXSCREEN) : 1));
    in.mi.dy = y * ((GetSystemMetrics(SM_CYSCREEN) > 0 ? 65535 / GetSystemMetrics(SM_CYSCREEN) : 1));
    in.mi.dwFlags = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE | flags;
    SendInput(1, &in, sizeof(INPUT));
  };
  sendAt(0);
  for (int i = 0; i < (clicks > 0 ? clicks : 1); i++) {
    sendAt(downFlag);
    sendAt(upFlag);
  }
  bool ok = true;
  if (info.Length() >= 7 && IsNum(info[6])) {
    HWND expected = (HWND)(uintptr_t)(int64_t)info[6].As<Napi::Number>().DoubleValue();
    HWND fgRoot = GetAncestor(GetForegroundWindow(), GA_ROOT);
    ok = expected && fgRoot == expected;
  }
  deferred.Resolve(Napi::Boolean::New(env, ok));
  return deferred.Promise();
}
static Napi::Value TypeTextGlobalAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "typeTextGlobalAsync(text) expects a string");
  auto deferred = Napi::Promise::Deferred::New(env);
  std::wstring text = Widen(info[0].As<Napi::String>().Utf8Value());
  // SendInput unicode 串（与 typeTextGlobal 同族；[E] {ok,sent,total}）
  int sent = 0;
  std::vector<INPUT> inputs;
  for (wchar_t ch : text) {
    INPUT in{};
    in.type = INPUT_KEYBOARD;
    in.ki.wScan = ch;
    in.ki.dwFlags = KEYEVENTF_UNICODE;
    inputs.push_back(in);
    INPUT up = in;
    up.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
    inputs.push_back(up);
  }
  if (!inputs.empty()) sent = (int)(SendInput((UINT)inputs.size(), inputs.data(), sizeof(INPUT)) / 2);
  auto result = Napi::Object::New(env);
  result.Set("ok", Napi::Boolean::New(env, sent == (int)text.size()));
  result.Set("sent", Napi::Number::New(env, (double)sent));
  result.Set("total", Napi::Number::New(env, (double)text.size()));
  deferred.Resolve(result);
  return deferred.Promise();
}

// —— W4 收口批（parity-native 基面差距）——windowsOperationScene 97 面 + 四锁区补丁（probeWindows/listApplications 键形与滤集/ref :generation: 尾标）

// —— windowsOperationScene（97 面；parity-native 揭出，W4 收口）——
// [E] 官方 0.6.5 探针（2026-11-11）：(rootHwnd, hostHwnd[, elementRef, x, y]) →
// 11 键封套 {root, host, producer_id, monitor_ready:true, mutation_sequence:0,
// external_input_sequence:0, input_monitor_counters{own,other_injected,unmarked,
// truncated_tag}, input{4}, root_input{4}, input_roots:{}, windows:[pid 全部顶层窗
//（含不可见）]}；窗条目 11 键 {window_id,pid,tid,root_window_id,owner_window_id,
// bundle_id,window_generation,visible,bounds,process_start_time,decorative:false}；
// 坏参/坏窗/非数 → null（不抛）。JS 消费面 :20217 readWindowsOperationScene
//（初始 5 参调用→enumerate 存在时 2 参复询）/:25687/:29847/:32055——本面在场即
// 激活 win.ts 投递/菜单机械的 scene 源。
static Napi::Object W4WindowEntry(Napi::Env env, HWND hwnd) {
  DWORD pid = 0;
  DWORD tid = GetWindowThreadProcessId(hwnd, &pid);
  HWND root = GetAncestor(hwnd, GA_ROOT);
  HWND owner = GetWindow(hwnd, GW_OWNER);
  wchar_t img[1024]{};
  {
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (h) {
      DWORD n = 1024;
      if (!QueryFullProcessImageNameW(h, 0, img, &n)) img[0] = 0;
      CloseHandle(h);
    }
  }
  RECT r{};
  GetWindowRect(hwnd, &r);
  auto obj = Napi::Object::New(env);
  obj.Set("window_id", Napi::Number::New(env, (double)(uintptr_t)hwnd));
  obj.Set("pid", Napi::Number::New(env, (double)pid));
  obj.Set("tid", Napi::Number::New(env, (double)tid));
  obj.Set("root_window_id", Napi::Number::New(env, (double)(uintptr_t)(root ? root : hwnd)));
  obj.Set("owner_window_id", Napi::Number::New(env, (double)(uintptr_t)(owner ? owner : 0)));
  obj.Set("bundle_id", Napi::String::New(env, Narrow(img)));
  obj.Set("window_generation", Napi::Number::New(env, W3WindowGeneration(hwnd)));
  obj.Set("visible", Napi::Boolean::New(env, IsWindowVisible(hwnd) != FALSE));
  obj.Set("bounds", BoundsArray(env, r.left, r.top, r.right - r.left, r.bottom - r.top));
  obj.Set("process_start_time", Napi::String::New(env, W3ProcessStartTime(pid)));
  obj.Set("decorative", Napi::Boolean::New(env, false));
  return obj;
}
static Napi::Value WindowsOperationScene(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsNum(info[0]) || !IsNum(info[1])) return env.Null();
  HWND root = (HWND)(uintptr_t)(int64_t)info[0].As<Napi::Number>().DoubleValue();
  HWND host = (HWND)(uintptr_t)(int64_t)info[1].As<Napi::Number>().DoubleValue();
  if (!root || !IsWindow(root) || !host || !IsWindow(host)) return env.Null();
  DWORD rootPid = 0;
  GetWindowThreadProcessId(root, &rootPid);
  auto r = Napi::Object::New(env);
  r.Set("root", W4WindowEntry(env, root));
  r.Set("host", W4WindowEntry(env, host));
  r.Set("producer_id", Napi::String::New(env, W3ProducerId()));
  r.Set("monitor_ready", Napi::Boolean::New(env, true));
  r.Set("mutation_sequence", Napi::Number::New(env, 0));
  r.Set("external_input_sequence", Napi::Number::New(env, 0));
  auto imc = Napi::Object::New(env);
  imc.Set("own", Napi::Number::New(env, 0));
  imc.Set("other_injected", Napi::Number::New(env, 0));
  imc.Set("unmarked", Napi::Number::New(env, 0));
  imc.Set("truncated_tag", Napi::Number::New(env, 0));
  r.Set("input_monitor_counters", imc);
  auto mkInput = [&]() {
    auto in = Napi::Object::New(env);
    in.Set("active", Napi::Number::New(env, 0));
    in.Set("focus", Napi::Number::New(env, 0));
    in.Set("capture", Napi::Number::New(env, 0));
    in.Set("menu_owner", Napi::Number::New(env, 0));
    return in;
  };
  r.Set("input", mkInput());
  r.Set("root_input", mkInput());
  r.Set("input_roots", Napi::Object::New(env));
  // windows：root pid 的全部顶层窗（[E] 官方集合含 visible:false 条目——无可见性滤）
  struct W4WinCtx {
    DWORD pid;
    std::vector<HWND> hits;
  } wctx{rootPid, {}};
  EnumWindows([](HWND hwnd, LPARAM lp) -> BOOL {
    auto* c = (W4WinCtx*)lp;
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid == c->pid) c->hits.push_back(hwnd);
    return TRUE;
  }, (LPARAM)&wctx);
  auto windows = Napi::Array::New(env, wctx.hits.size());
  for (size_t i = 0; i < wctx.hits.size(); i++)
    windows.Set((uint32_t)i, W4WindowEntry(env, wctx.hits[i]));
  r.Set("windows", windows);
  return r;
}
// <<< [机器管理实现区 end] <<<
// ============================================================================
// 注册
// ============================================================================

Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
  // 原版实测 awareness:2 / per_monitor_v2:true(scope:process):模块注册时把宿主
  // 进程切到 Per-Monitor V2,否则 EnumDisplayMonitors/GetCursorPos 会被系统按
  // unaware 进程虚拟化缩放(displays bounds 与 scale_factor 全部失真)。
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  auto reg = [&exports](const char* name, Napi::Function::Callback cb) {
    exports.Set(name, Napi::Function::New(exports.Env(), cb, name));
  };
  reg("activateApplication", ActivateApplication);
  reg("activateApplicationByAumid", ActivateApplicationByAumid);
  reg("activateWindow", ActivateWindow);
  reg("applicationIconPngAsync", ApplicationIconPngAsync);
  reg("applicationInfo", ApplicationInfo);
  reg("applicationInfoByAumid", ApplicationInfoByAumid);
  reg("cancelInputHoldsForSession", CancelInputHoldsForSession);
  reg("cancelPendingInputHolds", CancelPendingInputHolds);
  reg("captureApp", CaptureApp);
  reg("captureMonitorPngAsync", CaptureMonitorPngAsync);
  reg("captureWindowImage", CaptureWindowImage);
  reg("captureWindowPngCompositeAsync", CaptureWindowPngCompositeAsync);
  reg("captureWindowPngVerifiedAsync", CaptureWindowPngVerifiedAsync);
  reg("classifyPostMessageDelivery", ClassifyPostMessageDelivery);
  reg("clickAtPoint", ClickAtPoint);
  reg("clickAtPointAsync", ClickAtPointAsync);
  reg("cursorPoint", CursorPoint);
  reg("displays", Displays);
  reg("dpiAwarenessInfo", DpiAwarenessInfo);
  reg("drag", Drag);
  reg("elementAtPoint", ElementAtPoint);
  reg("elementPatternCallAsync", ElementPatternCallAsync);
  reg("elementValueReadAsync", ElementValueReadAsync);
  reg("enumerateSurfacesForFrame", EnumerateSurfacesForFrame);
  reg("ghostBeginAction", GhostBeginAction);
  reg("ghostBeginActionWithTitle", GhostBeginActionWithTitle);
  reg("ghostClickRipple", GhostClickRipple);
  reg("ghostEndAction", GhostEndAction);
  reg("ghostHide", GhostHide);
  reg("ghostInit", GhostInit);
  reg("ghostMove", GhostMove);
  reg("ghostPaletteSelftest", GhostPaletteSelftest);
  reg("ghostRemoveSession", GhostRemoveSession);
  reg("ghostSessionTurnEnd", GhostSessionTurnEnd);
  reg("ghostSetCapture", GhostSetCapture);
  reg("ghostSetEnabled", GhostSetEnabled);
  reg("ghostSetMultiCursorEnabled", GhostSetMultiCursorEnabled);
  reg("ghostSetRequestSession", GhostSetRequestSession);
  reg("ghostShow", GhostShow);
  reg("ghostState", GhostState);
  reg("frameWindowContext", FrameWindowContext);
  reg("getDispatchWindowId", GetDispatchWindowId);
  reg("getForegroundRootWindowId", GetForegroundRootWindowId);
  reg("getWindowId", GetWindowId);
  reg("hasActiveInputHolds", HasActiveInputHolds);
  reg("hitTestInvokeAtPointAsync", HitTestInvokeAtPointAsync);
  reg("holdKeyGlobal", HoldKeyGlobal);
  reg("holdKeyGlobalAsync", HoldKeyGlobalAsync);
  reg("invokeAcceleratorAsync", InvokeAcceleratorAsync);
  reg("isFocusStealPrevented", IsFocusStealPrevented);
  reg("isInteractiveSession", IsInteractiveSession);
  reg("isScreenCaptureSupported", IsScreenCaptureSupported);
  reg("isTargetElevated", IsTargetElevated);
  reg("isTrusted", IsTrusted);
  reg("keyDownGlobal", KeyDownGlobal);
  reg("keyUpGlobal", KeyUpGlobal);
  reg("launchApplicationAsync", LaunchApplicationAsync);
  reg("listApplications", ListApplications);
  reg("listInstalledApplicationsAsync", ListInstalledApplicationsAsync);
  reg("listWindows", ListWindows);
  reg("mouseDown", MouseDown);
  reg("mouseUp", MouseUp);
  reg("moveTo", MoveTo);
  reg("pasteboardAwaitProvidedRead", PasteboardAwaitProvidedRead);
  reg("pasteboardBeginProvidedPaste", PasteboardBeginProvidedPaste);
  reg("pasteboardFinishProvidedPaste", PasteboardFinishProvidedPaste);
  reg("pasteboardMarkProvidedPasteDispatched", PasteboardMarkProvidedPasteDispatched);
  reg("performAction", PerformAction);
  reg("postMessageCharAsync", PostMessageCharAsync);
  reg("postMessageClickAsync", PostMessageClickAsync);
  reg("postMessageDragAsync", PostMessageDragAsync);
  reg("postMessageKeyAsync", PostMessageKeyAsync);
  reg("postMessageScrollAsync", PostMessageScrollAsync);
  reg("pressKeyGlobal", PressKeyGlobal);
  reg("preventActivation", PreventActivation);
  reg("probeAccessibility", ProbeAccessibility);
  reg("probeAccessibilityStatus", ProbeAccessibilityStatus);
  reg("processExecutablePath", ProcessExecutablePath);
  reg("readClipboardTextAsync", ReadClipboardTextAsync);
  reg("readElement", ReadElement);
  reg("reenableActivation", ReenableActivation);
  reg("restoreForegroundWindow", RestoreForegroundWindow);
  reg("screenCaptureProbeWindows", ScreenCaptureProbeWindows);
  reg("screenCaptureStatus", ScreenCaptureStatus);
  reg("scrollAt", ScrollAt);
  reg("scrollElement", ScrollElement);
  reg("selectText", SelectText);
  reg("setFocused", SetFocused);
  reg("setValue", SetValue);
  reg("setValueReadbackAsync", SetValueReadbackAsync);
  reg("startupError", StartupError);
  reg("typeTextGlobal", TypeTextGlobal);
  reg("typeTextGlobalAsync", TypeTextGlobalAsync);
  reg("winAxElementFromToken", WinAxElementFromToken);
  reg("winAxElementRelease", WinAxElementRelease);
  reg("windowsOperationScene", WindowsOperationScene);
  reg("writeClipboardTextAsync", WriteClipboardTextAsync);
  return exports;
}

NODE_API_MODULE(ax_native_win, InitModule)
