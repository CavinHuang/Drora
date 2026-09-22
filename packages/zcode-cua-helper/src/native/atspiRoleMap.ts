var ATSPI_ROLE_TO_KIND = {
  "push button": "button",
  "toggle button": "button",
  "check box": "checkbox",
  "check menu item": "menuitem",
  "radio button": "radio",
  "radio menu item": "menuitem",
  "menu item": "menuitem",
  menu: "menuitem",
  // GTK4's new a11y backend (and libadwaita AdwSwitchRow) can expose a GtkSwitch under a
  // dedicated "switch" role instead of the historic "toggle button". Map it to the neutral
  // "switch" kind (the same kind macOS derives from AXSwitch) so the model recognises
  // System Settings-style toggles. Harmless on toolkits that still report "toggle button"
  // (this entry simply never fires there — that role keeps mapping to "button").
  switch: "switch",
  link: "link",
  entry: "textfield",
  // editable "text" (TextView) overrides this to "textarea" below in the snapshot builder;
  // non-editable "text" downgrades to the readable "text" kind.
  text: "textfield",
  "password text": "securefield",
  "combo box": "combobox",
  slider: "slider",
  "spin button": "stepper",
  "table cell": "cell",
  "table row": "row",
  "list item": "cell",
  "page tab": "tab",
  label: "text",
  static: "text",
  heading: "text",
  paragraph: "text",
  // VTE/gnome-terminal exposes its scrollback as a "terminal" role with a Text interface (but
  // NO EditableText — it is not typeable via AT-SPI). Surfacing it as readable "text" lets the
  // model READ the terminal's recent output, which is otherwise invisible (the role is not
  // actionable, so without this entry the BFS drops it and the model cannot see command output).
  terminal: "text",
};
export function roleToKind2(role) {
  return ATSPI_ROLE_TO_KIND[role.toLowerCase()] ?? "";
}
