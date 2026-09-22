var CONTROL_TYPE_TO_KIND = Object.freeze({
  // Buttons (all collapse to button — parity with macOS AXButton/AXMenuButton).
  Button: "button",
  SplitButton: "button",
  // Menus (all collapse to menuitem — parity with macOS AXMenuItem/AXMenuBarItem).
  MenuItem: "menuitem",
  Menu: "menuitem",
  MenuBar: "menuitem",
  // Text entry.
  Edit: "textfield",
  Document: "textarea",
  Password: "securefield",
  // Selection / dropdowns.
  ComboBox: "combobox",
  CheckBox: "checkbox",
  RadioButton: "radio",
  // Navigation.
  Hyperlink: "link",
  // Range / progress.
  Slider: "slider",
  ProgressBar: "slider",
  // Static content.
  Text: "text",
  StatusBar: "text",
  Image: "image",
  // Rows (selectable items in List/Tree/DataGrid). The Python parity reference
  // treats ListItem/DataItem/TreeItem as the semantic "row" for click-target
  // purposes (zcode_cua/accessibility/filtering.py).
  ListItem: "row",
  DataItem: "row",
  TreeItem: "row",
  // Tabs.
  TabItem: "tab",
  // Unknown — excluded from re-resolution (broker treats kind:"" specially).
  Custom: "",
  // Containers — not actionable themselves; their children are.
  Pane: "",
  Window: "",
  Group: "",
});
export function uiaControlTypeToKind(controlType) {
  return CONTROL_TYPE_TO_KIND[controlType] ?? "";
}
var TEXT_ENTRY_KINDS2 = /* @__PURE__ */ new Set([
  "textfield",
  "textarea",
  "securefield",
  "combobox",
]);
export var VALUE_SET_KINDS2 = /* @__PURE__ */ new Set([...TEXT_ENTRY_KINDS2, "slider", "stepper"]);
