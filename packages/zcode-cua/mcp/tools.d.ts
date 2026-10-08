declare var TOOL_NAMES: string[];
declare var APP_ASSOCIATION_MODE_BY_TOOL: {
    list_apps: string;
    open_application: string;
    list_windows: string;
    get_app_state: string;
    screenshot: string;
    zoom: string;
    list_displays: string;
    switch_display: string;
    cursor_position: string;
    left_click: string;
    double_click: string;
    triple_click: string;
    right_click: string;
    middle_click: string;
    scroll: string;
    left_click_drag: string;
    mouse_move: string;
    left_mouse_down: string;
    left_mouse_up: string;
    type: string;
    set_value: string;
    select_text: string;
    key: string;
    hold_key: string;
    perform_action: string;
    request_access: string;
    stop_computer_control: string;
    wait: string;
    read_clipboard: string;
    write_clipboard: string;
};
declare var SCHEMA_BY_NAME: {
    list_apps: import("zod").ZodObject<{}, import("zod/v4/core").$strict>;
    open_application: import("zod").ZodObject<{
        app: import("zod").ZodPreprocess<import("zod").ZodUnion<readonly [import("zod").ZodObject<{
            bundle_id: import("zod").ZodString;
            name: import("zod").ZodOptional<import("zod").ZodString>;
            pid: import("zod").ZodOptional<import("zod").ZodNumber>;
            window_id: import("zod").ZodOptional<import("zod").ZodNumber>;
            url: import("zod").ZodOptional<import("zod").ZodString>;
            urls: import("zod").ZodOptional<import("zod").ZodPreprocess<any, unknown>>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            name: import("zod").ZodString;
            bundle_id: import("zod").ZodOptional<import("zod").ZodString>;
            pid: import("zod").ZodOptional<import("zod").ZodNumber>;
            window_id: import("zod").ZodOptional<import("zod").ZodNumber>;
            url: import("zod").ZodOptional<import("zod").ZodString>;
            urls: import("zod").ZodOptional<import("zod").ZodPreprocess<any, unknown>>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            pid: import("zod").ZodNumber;
            bundle_id: import("zod").ZodOptional<import("zod").ZodString>;
            name: import("zod").ZodOptional<import("zod").ZodString>;
            window_id: import("zod").ZodOptional<import("zod").ZodNumber>;
            url: import("zod").ZodOptional<import("zod").ZodString>;
            urls: import("zod").ZodOptional<import("zod").ZodPreprocess<any, unknown>>;
        }, import("zod/v4/core").$strict>]>, unknown>;
        activate: import("zod").ZodDefault<import("zod").ZodBoolean>;
        new_instance: import("zod").ZodDefault<import("zod").ZodBoolean>;
    }, import("zod/v4/core").$strict>;
    list_windows: import("zod").ZodObject<{
        app_ref: import("zod").ZodPipe<import("zod").ZodUnknown, import("zod").ZodTransform<any, unknown>>;
    }, import("zod/v4/core").$strict>;
    get_app_state: import("zod").ZodObject<{
        app_ref: import("zod").ZodPipe<import("zod").ZodUnknown, import("zod").ZodTransform<any, unknown>>;
        detail: import("zod").ZodDefault<import("zod").ZodEnum<{
            full: "full";
            compact: "compact";
        }>>;
        include_screenshot: import("zod").ZodDefault<import("zod").ZodBoolean>;
    }, import("zod/v4/core").$strict>;
    screenshot: import("zod").ZodObject<{}, import("zod/v4/core").$strict>;
    zoom: import("zod").ZodObject<{
        frame_id: import("zod").ZodOptional<import("zod").ZodString>;
        region: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodPreprocess<any, unknown>>>;
        target: import("zod").ZodUnknown | import("zod").ZodOptional<import("zod").ZodUnknown>;
    }, import("zod/v4/core").$strict>;
    list_displays: import("zod").ZodObject<{}, import("zod/v4/core").$strict>;
    switch_display: import("zod").ZodObject<{
        index: import("zod").ZodUnknown;
    }, import("zod/v4/core").$strict>;
    cursor_position: import("zod").ZodObject<{}, import("zod/v4/core").$strict>;
    left_click: import("zod").ZodObject<{
        target: import("zod").ZodUnknown;
        modifiers: import("zod").ZodDefault<import("zod").ZodString>;
        strategy: import("zod").ZodDefault<import("zod").ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
        app_ref: import("zod").ZodOptional<import("zod").ZodPipe<import("zod").ZodUnknown, import("zod").ZodTransform<any, unknown>>>;
    }, import("zod/v4/core").$strict>;
    double_click: import("zod").ZodObject<{
        target: import("zod").ZodUnknown;
        modifiers: import("zod").ZodDefault<import("zod").ZodString>;
        strategy: import("zod").ZodDefault<import("zod").ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
        app_ref: import("zod").ZodOptional<import("zod").ZodPipe<import("zod").ZodUnknown, import("zod").ZodTransform<any, unknown>>>;
    }, import("zod/v4/core").$strict>;
    triple_click: import("zod").ZodObject<{
        target: import("zod").ZodUnknown;
        modifiers: import("zod").ZodDefault<import("zod").ZodString>;
        strategy: import("zod").ZodDefault<import("zod").ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
        app_ref: import("zod").ZodOptional<import("zod").ZodPipe<import("zod").ZodUnknown, import("zod").ZodTransform<any, unknown>>>;
    }, import("zod/v4/core").$strict>;
    right_click: import("zod").ZodObject<{
        target: import("zod").ZodUnknown;
        modifiers: import("zod").ZodDefault<import("zod").ZodString>;
        strategy: import("zod").ZodDefault<import("zod").ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
        app_ref: import("zod").ZodOptional<import("zod").ZodPipe<import("zod").ZodUnknown, import("zod").ZodTransform<any, unknown>>>;
    }, import("zod/v4/core").$strict>;
    middle_click: import("zod").ZodObject<{
        target: import("zod").ZodUnknown;
        modifiers: import("zod").ZodDefault<import("zod").ZodString>;
        strategy: import("zod").ZodDefault<import("zod").ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
        app_ref: import("zod").ZodOptional<import("zod").ZodPipe<import("zod").ZodUnknown, import("zod").ZodTransform<any, unknown>>>;
    }, import("zod/v4/core").$strict>;
    scroll: import("zod").ZodObject<{
        target: import("zod").ZodUnknown;
        scroll_direction: import("zod").ZodEnum<{
            left: "left";
            right: "right";
            down: "down";
            up: "up";
        }>;
        scroll_amount: import("zod").ZodUnknown;
        strategy: import("zod").ZodDefault<import("zod").ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
        app_ref: import("zod").ZodOptional<import("zod").ZodPipe<import("zod").ZodUnknown, import("zod").ZodTransform<any, unknown>>>;
    }, import("zod/v4/core").$strict>;
    left_click_drag: import("zod").ZodObject<{
        from_target: import("zod").ZodUnknown;
        to: import("zod").ZodUnknown;
        modifiers: import("zod").ZodDefault<import("zod").ZodString>;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
        app_ref: import("zod").ZodOptional<import("zod").ZodPipe<import("zod").ZodUnknown, import("zod").ZodTransform<any, unknown>>>;
    }, import("zod/v4/core").$strict>;
    mouse_move: import("zod").ZodObject<{
        coordinate: import("zod").ZodUnknown | import("zod").ZodOptional<import("zod").ZodUnknown>;
        app_ref: import("zod").ZodOptional<import("zod").ZodPipe<import("zod").ZodUnknown, import("zod").ZodTransform<any, unknown>>>;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, import("zod/v4/core").$strict>;
    left_mouse_down: import("zod").ZodObject<{
        target: import("zod").ZodUnknown;
        app_ref: import("zod").ZodOptional<import("zod").ZodPipe<import("zod").ZodUnknown, import("zod").ZodTransform<any, unknown>>>;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, import("zod/v4/core").$strict>;
    left_mouse_up: import("zod").ZodObject<{
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, import("zod/v4/core").$strict>;
    type: import("zod").ZodObject<{
        text: import("zod").ZodString;
        target: import("zod").ZodOptional<import("zod").ZodUnknown>;
        app_ref: import("zod").ZodOptional<import("zod").ZodPipe<import("zod").ZodUnknown, import("zod").ZodTransform<any, unknown>>>;
        strategy: import("zod").ZodDefault<import("zod").ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, import("zod/v4/core").$strict>;
    set_value: import("zod").ZodObject<{
        target: import("zod").ZodUnknown;
        value: import("zod").ZodString;
        strategy: import("zod").ZodDefault<import("zod").ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, import("zod/v4/core").$strict>;
    select_text: import("zod").ZodObject<{
        target: import("zod").ZodUnknown;
        text_range: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodPreprocess<any, unknown>>>;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, import("zod/v4/core").$strict>;
    key: import("zod").ZodObject<{
        text: import("zod").ZodString;
        repeat: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodUnknown>>;
        app_ref: import("zod").ZodOptional<import("zod").ZodPipe<import("zod").ZodUnknown, import("zod").ZodTransform<any, unknown>>>;
        strategy: import("zod").ZodDefault<import("zod").ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, import("zod/v4/core").$strict>;
    hold_key: import("zod").ZodObject<{
        text: import("zod").ZodString;
        duration: import("zod").ZodUnknown;
        app_ref: import("zod").ZodOptional<import("zod").ZodPipe<import("zod").ZodUnknown, import("zod").ZodTransform<any, unknown>>>;
        strategy: import("zod").ZodDefault<import("zod").ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, import("zod/v4/core").$strict>;
    perform_action: import("zod").ZodObject<{
        target: import("zod").ZodUnknown;
        action: import("zod").ZodString;
        return_state: import("zod").ZodDefault<import("zod").ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, import("zod/v4/core").$strict>;
    request_access: import("zod").ZodObject<{
        capabilities: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodPreprocess<any, unknown>>>;
    }, import("zod/v4/core").$strict>;
    stop_computer_control: import("zod").ZodObject<{
        reason: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
    }, import("zod/v4/core").$strict>;
    wait: import("zod").ZodObject<{
        duration: import("zod").ZodUnknown;
    }, import("zod/v4/core").$strict>;
    read_clipboard: import("zod").ZodObject<{}, import("zod/v4/core").$strict>;
    write_clipboard: import("zod").ZodObject<{
        text: import("zod").ZodString;
    }, import("zod/v4/core").$strict>;
};
declare var TOOL_REGISTRY: {
    name: string;
    schema: any;
    annotations: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
    };
}[];
declare var TOOL_REGISTRY_MAP: Map<string, any>;
declare var TOOL_DEF_BY_NAME: Map<string, any>;
declare var KILL_SWITCH_EXEMPT: Set<string>;
declare var REQUEST_CONTEXT_META_KEY: string;
declare var SUBAGENT_RUNTIME_SCOPE: string;
declare var SUBAGENT_COMPUTER_USE_UNAVAILABLE_CODE: string;
declare var SUBAGENT_COMPUTER_USE_UNAVAILABLE_MESSAGE: string;
declare function withKillSwitchPreflight(name: any, handler: any, deps: any): (input: any, extra: any) => unknown;
export { APP_ASSOCIATION_MODE_BY_TOOL, KILL_SWITCH_EXEMPT, REQUEST_CONTEXT_META_KEY, SCHEMA_BY_NAME, SUBAGENT_COMPUTER_USE_UNAVAILABLE_CODE, SUBAGENT_COMPUTER_USE_UNAVAILABLE_MESSAGE, SUBAGENT_RUNTIME_SCOPE, TOOL_DEF_BY_NAME, TOOL_NAMES, TOOL_REGISTRY, TOOL_REGISTRY_MAP, withKillSwitchPreflight, };
