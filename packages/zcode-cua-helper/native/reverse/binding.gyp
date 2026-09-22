{
  "variables": {
    "win_sdk%": "C:/Program Files (x86)/Windows Kits/10/Include/10.0.26100.0"
  },
  "targets": [
    {
      "target_name": "ax_native_win",
      "sources": ["src/ax_native_win.cc"],
      "include_dirs": [
        "node_modules/node-addon-api",
        "<(win_sdk)/cppwinrt",
        "<(win_sdk)/um",
        "<(win_sdk)/shared"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=9"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/utf-8", "/permissive-"]
        }
      },
      "conditions": [
        [
          "OS=='win'",
          {
            "msvs_settings": {
              "VCLinkerTool": {
                "AdditionalDependencies": [
                  "user32.lib",
                  "shell32.lib",
                  "advapi32.lib",
                  "ole32.lib",
                  "oleaut32.lib",
                  "uiautomationcore.lib",
                  "gdi32.lib",
                  "d3d11.lib",
                  "dxgi.lib",
                  "windowsapp.lib",
                  "runtimeobject.lib"
                ]
              }
            }
          }
        ]
      ]
    }
  ]
}
