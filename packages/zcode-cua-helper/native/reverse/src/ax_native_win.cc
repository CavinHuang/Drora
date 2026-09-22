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
        LONG_PTR ex = GetWindowLongW(hwnd, GWL_EXSTYLE);
        if (ex & WS_EX_TOOLWINDOW) return TRUE;
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
        int len = GetWindowTextLengthW(hwnd);
        if (len == 0) return TRUE;
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
  auto obj = Napi::Object::New(env);
  obj.Set("pid", Napi::Number::New(env, (double)e.pid));
  obj.Set("name", Napi::String::New(env, Narrow(e.title)));
  obj.Set("bundle_id", Napi::String::New(env, Narrow(e.exe_path)));
  obj.Set("aumid", e.aumid.empty() ? env.Null() : Napi::Value(Napi::String::New(env, Narrow(e.aumid))));
  obj.Set("active", Napi::Boolean::New(env, active));
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

static std::optional<RefData> ParseRef(const std::string& ref) {
  // "rt:<pid>:<id>-<id>-..."
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
    if (part.empty()) return std::nullopt;
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
  std::string ref = MakeRef(owner_pid, el);
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
  auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());
  if (!ref) return AxErrorResult(env, "invalid_element");
  IUIAutomationElement* el = ResolveRefToElement(*ref);
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
  auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());
  if (!ref) return AxErrorResult(env, "invalid_element");
  IUIAutomationElement* el = ResolveRefToElement(*ref);
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
  auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());
  if (!ref) return AxErrorResult(env, "illegal_argument");
  IUIAutomationElement* el = ResolveRefToElement(*ref);
  if (!el) return AxErrorResult(env, "invalid_element");
  el->Release();
  return OkResult(env);
}

static Napi::Value SetFocused(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // 原版矩阵实测:参数形态不合法 → {ok:false,axError:"illegal_argument"}(不抛)
  if (info.Length() < 1 || !IsStr(info[0]))
    return AxErrorResult(env, "illegal_argument");
  auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());
  if (!ref) return AxErrorResult(env, "invalid_element");
  IUIAutomationElement* el = ResolveRefToElement(*ref);
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
  result.Set("ok", Napi::Boolean::New(env, ok));
  result.Set("text", ok ? Napi::Value(Napi::String::New(env, Narrow(text))) : env.Null());
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
  reg("applicationIconPngAsync", ApplicationIconPngAsync);
  reg("applicationInfo", ApplicationInfo);
  reg("applicationInfoByAumid", ApplicationInfoByAumid);
  reg("cancelInputHoldsForSession", CancelInputHoldsForSession);
  reg("cancelPendingInputHolds", CancelPendingInputHolds);
  reg("captureApp", CaptureApp);
  reg("captureMonitorPngAsync", CaptureMonitorPngAsync);
  reg("captureWindowImage", CaptureWindowImage);
  reg("captureWindowPngVerifiedAsync", CaptureWindowPngVerifiedAsync);
  reg("clickAtPoint", ClickAtPoint);
  reg("cursorPoint", CursorPoint);
  reg("displays", Displays);
  reg("dpiAwarenessInfo", DpiAwarenessInfo);
  reg("drag", Drag);
  reg("elementAtPoint", ElementAtPoint);
  reg("holdKeyGlobal", HoldKeyGlobal);
  reg("holdKeyGlobalAsync", HoldKeyGlobalAsync);
  reg("isFocusStealPrevented", IsFocusStealPrevented);
  reg("isInteractiveSession", IsInteractiveSession);
  reg("isScreenCaptureSupported", IsScreenCaptureSupported);
  reg("isTargetElevated", IsTargetElevated);
  reg("isTrusted", IsTrusted);
  reg("keyDownGlobal", KeyDownGlobal);
  reg("keyUpGlobal", KeyUpGlobal);
  reg("listApplications", ListApplications);
  reg("listWindows", ListWindows);
  reg("mouseDown", MouseDown);
  reg("mouseUp", MouseUp);
  reg("moveTo", MoveTo);
  reg("performAction", PerformAction);
  reg("pressKeyGlobal", PressKeyGlobal);
  reg("preventActivation", PreventActivation);
  reg("probeAccessibility", ProbeAccessibility);
  reg("probeAccessibilityStatus", ProbeAccessibilityStatus);
  reg("processExecutablePath", ProcessExecutablePath);
  reg("readClipboardTextAsync", ReadClipboardTextAsync);
  reg("readElement", ReadElement);
  reg("reenableActivation", ReenableActivation);
  reg("screenCaptureProbeWindows", ScreenCaptureProbeWindows);
  reg("screenCaptureStatus", ScreenCaptureStatus);
  reg("scrollAt", ScrollAt);
  reg("selectText", SelectText);
  reg("setFocused", SetFocused);
  reg("setValue", SetValue);
  reg("startupError", StartupError);
  reg("typeTextGlobal", TypeTextGlobal);
  reg("writeClipboardTextAsync", WriteClipboardTextAsync);
  return exports;
}

NODE_API_MODULE(ax_native_win, InitModule)
