// Tencent Meeting-only native adapter. macOS 14+, public APIs only.
// Usage: meeting-native COMMAND '{"windowId":123,"expectedIdentifier":"wemeet://page/home"}'
// inspect: no action; optional ocr=true captures ONLY Tencent windows when permission exists.
// screenshot: windowId required; optional path (PNG), ocr=true. No full-display capture.
// raise/clickNormalized/key require a fresh windowId and expectedIdentifier page substring.
// clickNormalized additionally requires x/y in 0...1; key accepts key and optional text.
// This program never prompts for or changes permissions; callers must handle denied permissions.
// Apple APIs: developer.apple.com/documentation/applicationservices/1462085-axuielementcopyattributevalue
// developer.apple.com/documentation/screencapturekit/scscreenshotmanager
// developer.apple.com/documentation/vision/vnrecognizetextrequest
import Foundation
import AppKit
import ApplicationServices
import ScreenCaptureKit
import Vision
import ImageIO
import UniformTypeIdentifiers

private let bundleID = "com.tencent.meeting"
private let maxElements = 1200
private let maxDepth = 12
private struct NativeError: Error { let code: String; let message: String }
private func fail(_ code: String, _ message: String) -> NativeError { NativeError(code: code, message: message) }
private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success ? result : nil
}
private func string(_ element: AXUIElement, _ name: String) -> String {
    guard let value = attribute(element, name) else { return "" }
    if let text = value as? String { return String(text.prefix(2000)) }
    if let number = value as? NSNumber { return number.stringValue }
    return ""
}
private func elements(_ element: AXUIElement, _ name: String) -> [AXUIElement] {
    attribute(element, name) as? [AXUIElement] ?? []
}
private func rect(_ element: AXUIElement) -> CGRect? {
    guard let pos = attribute(element, kAXPositionAttribute), CFGetTypeID(pos) == AXValueGetTypeID(),
          let size = attribute(element, kAXSizeAttribute), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero; var dimensions = CGSize.zero
    guard AXValueGetValue(unsafeBitCast(pos, to: AXValue.self), .cgPoint, &point),
          AXValueGetValue(unsafeBitCast(size, to: AXValue.self), .cgSize, &dimensions) else { return nil }
    return CGRect(origin: point, size: dimensions)
}
private func describe(_ element: AXUIElement, depth: Int = 0) -> [String: Any] {
    var output: [String: Any] = ["role": string(element, kAXRoleAttribute), "title": string(element, kAXTitleAttribute),
        "value": string(element, kAXValueAttribute), "description": string(element, kAXDescriptionAttribute),
        "identifier": string(element, kAXIdentifierAttribute), "depth": depth]
    if let frame = rect(element) {
        output.merge(["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]) { _, b in b }
    }
    if let enabled = attribute(element, kAXEnabledAttribute) as? Bool { output["enabled"] = enabled }
    if let focused = attribute(element, kAXFocusedAttribute) as? Bool { output["focused"] = focused }
    return output
}
private func flatten(_ root: AXUIElement, count: inout Int) -> [[String: Any]] {
    var result: [[String: Any]] = []
    func visit(_ element: AXUIElement, _ depth: Int) {
        guard count < maxElements, depth <= maxDepth else { return }
        count += 1; result.append(describe(element, depth: depth))
        for child in elements(element, kAXChildrenAttribute).prefix(300) { visit(child, depth + 1) }
    }
    for child in elements(root, kAXChildrenAttribute).prefix(300) { visit(child, 1) }
    return result
}
private struct Window {
    let ax: AXUIElement
    let info: [String: Any]
    var id: CGWindowID? { (info["windowId"] as? NSNumber).map { CGWindowID($0.uint32Value) } }
}
private func application() throws -> NSRunningApplication {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else {
        throw fail("APP_NOT_RUNNING", "腾讯会议尚未运行。")
    }
    return app
}
private func windows(_ app: NSRunningApplication) -> [Window] {
    // WindowServer metadata is immediately restricted to Tencent's PID and never returned for other apps.
    let metadata = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? [])
        .filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier }
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(axApp, 1.5)
    let focusedWindow = attribute(axApp, kAXFocusedWindowAttribute)
    var count = 0
    return elements(axApp, kAXWindowsAttribute).prefix(30).map { element in
        var info = describe(element)
        info["focused"] = focusedWindow.map { CFEqual($0, element) } ?? false
        info["elements"] = flatten(element, count: &count)
        if let frame = rect(element) {
            let candidates = metadata.filter { entry in
                guard let bounds = entry[kCGWindowBounds as String] as? [String: Any],
                      let other = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return false }
                return abs(frame.minX - other.minX) < 3 && abs(frame.minY - other.minY) < 3 &&
                    abs(frame.width - other.width) < 3 && abs(frame.height - other.height) < 3
            }
            if candidates.count == 1 { info["windowId"] = candidates[0][kCGWindowNumber as String] }
            else if let exact = candidates.first(where: { ($0[kCGWindowName as String] as? String) == string(element, kAXTitleAttribute) }) {
                info["windowId"] = exact[kCGWindowNumber as String]
            }
        }
        return Window(ax: element, info: info)
    }
}
private func target(_ app: NSRunningApplication, _ args: [String: Any], requirePage: Bool) throws -> Window {
    guard AXIsProcessTrusted() else { throw fail("ACCESSIBILITY_REQUIRED", "执行器没有辅助功能权限。请在系统设置中授权启动它的终端或应用。") }
    guard let id = args["windowId"] as? NSNumber else { throw fail("WINDOW_ID_REQUIRED", "需要 inspect 返回的腾讯会议 windowId。") }
    guard let window = windows(app).first(where: { $0.id == CGWindowID(id.uint32Value) }) else {
        throw fail("WINDOW_CHANGED", "腾讯会议窗口已变化，请重新检查状态。")
    }
    if requirePage {
        guard let expected = args["expectedIdentifier"] as? String, expected.count >= 8, expected.count <= 300 else {
            throw fail("PAGE_GUARD_REQUIRED", "需要提供预期页面的 identifier，至少 8 个字符。")
        }
        let ids = [window.info["identifier"] as? String ?? ""] + ((window.info["elements"] as? [[String: Any]] ?? []).compactMap { $0["identifier"] as? String })
        guard ids.contains(where: { $0.contains(expected) }) else { throw fail("PAGE_CHANGED", "腾讯会议当前页面与预期不符，已停止操作。") }
    }
    return window
}
private func ensureFrontmost(_ app: NSRunningApplication, window: Window) throws {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else {
        throw fail("APP_NOT_FRONTMOST", "腾讯会议不在前台，请先唤起指定窗口。")
    }
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    guard let main = attribute(axApp, kAXFocusedWindowAttribute), CFGetTypeID(main) == AXUIElementGetTypeID(),
          CFEqual(main, window.ax) else { throw fail("WINDOW_NOT_FOCUSED", "目标腾讯会议窗口没有焦点，已停止操作。") }
}
private func recognized(_ image: CGImage) throws -> [[String: Any]] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: image).perform([request])
    return (request.results ?? []).prefix(160).compactMap { observation in
        guard let best = observation.topCandidates(1).first else { return nil }
        let b = observation.boundingBox
        return ["text": best.string, "confidence": best.confidence,
            "x": b.minX, "y": 1 - b.maxY, "width": b.width, "height": b.height]
    }
}
@available(macOS 14.0, *)
private func capture(_ app: NSRunningApplication, id: CGWindowID) async throws -> CGImage {
    guard CGPreflightScreenCaptureAccess() else { throw fail("SCREEN_RECORDING_REQUIRED", "尚未授予屏幕录制权限，不能截图或识别会议状态。") }
    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
    guard let window = content.windows.first(where: { $0.windowID == id && $0.owningApplication?.processID == app.processIdentifier && $0.owningApplication?.bundleIdentifier == bundleID }) else {
        throw fail("WINDOW_CHANGED", "指定腾讯会议窗口已不可截图，请重新检查状态。")
    }
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let config = SCStreamConfiguration()
    config.width = max(1, Int(window.frame.width * 2)); config.height = max(1, Int(window.frame.height * 2))
    config.showsCursor = false
    config.ignoreShadowsSingleWindow = true
    return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
}
@available(macOS 14.0, *)
private func execute(_ command: String, _ args: [String: Any]) async throws -> [String: Any] {
    if command == "inspect" {
        let apps = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
        var result: [String: Any] = ["running": !apps.isEmpty, "accessibilityTrusted": AXIsProcessTrusted(),
            "screenRecordingGranted": CGPreflightScreenCaptureAccess(), "bundleId": bundleID, "windows": []]
        guard let app = apps.first else { return result }
        result["pid"] = app.processIdentifier; result["frontmost"] = NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier
        guard AXIsProcessTrusted() else { result["error"] = ["code": "ACCESSIBILITY_REQUIRED", "message": "执行器没有辅助功能权限，无法检查腾讯会议界面。"] ; return result }
        var output = windows(app).map { $0.info }
        if args["ocr"] as? Bool == true {
            for index in output.indices {
                guard let id = output[index]["windowId"] as? NSNumber else { continue }
                do {
                    let frame = try await capture(app, id: CGWindowID(id.uint32Value))
                    output[index]["ocr"] = try recognized(frame)
                } catch let error as NativeError { output[index]["ocrError"] = ["code": error.code, "message": error.message] }
                catch { output[index]["ocrError"] = ["code": "CAPTURE_FAILED", "message": error.localizedDescription] }
            }
        }
        result["windows"] = output
        return result
    }
    let app = try application()
    let window = try target(app, args, requirePage: command != "screenshot")
    guard let id = window.id else { throw fail("WINDOW_ID_REQUIRED", "未能确认腾讯会议窗口编号。") }
    switch command {
    case "screenshot":
        let frame = try await capture(app, id: id)
        var result: [String: Any] = ["windowId": id, "width": frame.width, "height": frame.height]
        if let path = args["path"] as? String {
            guard path.hasPrefix("/"), path.lowercased().hasSuffix(".png") else { throw fail("INVALID_PATH", "截图路径必须是绝对 PNG 路径。") }
            let url = URL(fileURLWithPath: path)
            guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
                throw fail("WRITE_FAILED", "无法创建截图文件。")
            }
            CGImageDestinationAddImage(destination, frame, nil)
            guard CGImageDestinationFinalize(destination) else { throw fail("WRITE_FAILED", "截图写入失败。") }
            result["path"] = path
        }
        if args["ocr"] as? Bool == true { result["ocr"] = try recognized(frame) }
        return result
    case "raise":
        guard app.activate(options: []) else { throw fail("ACTIVATION_FAILED", "无法唤起腾讯会议。") }
        let error = AXUIElementPerformAction(window.ax, kAXRaiseAction as CFString)
        guard error == .success else { throw fail("RAISE_FAILED", "无法将指定腾讯会议窗口置于前台（\(error.rawValue)）。") }
        return ["windowId": id, "action": "raise", "submitted": true]
    case "clickNormalized":
        guard let x = args["x"] as? Double, let y = args["y"] as? Double,
              x.isFinite, y.isFinite, (0...1).contains(x), (0...1).contains(y),
              let frame = rect(window.ax), frame.width > 0, frame.height > 0 else {
            throw fail("INVALID_COORDINATES", "点击坐标必须在指定窗口的 0 到 1 范围内。")
        }
        try ensureFrontmost(app, window: window)
        let point = CGPoint(x: frame.minX + x * frame.width, y: frame.minY + y * frame.height)
        let source = CGEventSource(stateID: .privateState)
        guard let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left),
              let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
              let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else {
            throw fail("EVENT_FAILED", "无法生成点击事件。")
        }
        // Qt widgets may ignore per-PID mouse events. Use the public HID event tap only
        // after checking the exact Tencent window, page and focus. No permission is changed.
        move.flags = []; down.flags = []; up.flags = []
        down.setIntegerValueField(.mouseEventClickState, value: 1)
        up.setIntegerValueField(.mouseEventClickState, value: 1)
        move.post(tap: .cghidEventTap)
        try await Task.sleep(nanoseconds: 40_000_000)
        let currentWindow = try target(app, args, requirePage: true)
        try ensureFrontmost(app, window: currentWindow)
        guard rect(currentWindow.ax) == frame else { throw fail("WINDOW_CHANGED", "腾讯会议窗口位置已变化，已停止点击。") }
        down.post(tap: .cghidEventTap)
        // Always release the button, including if the caller cancels during this short pause.
        try? await Task.sleep(nanoseconds: 40_000_000)
        up.post(tap: .cghidEventTap)
        return ["windowId": id, "action": "clickNormalized", "submitted": true, "x": point.x, "y": point.y]
    case "key":
        try ensureFrontmost(app, window: window)
        let name = args["key"] as? String ?? ""
        let keys: [String: CGKeyCode] = ["return":36, "escape":53, "tab":48, "space":49, "delete":51, "selectAll":0, "text":0]
        guard let code = keys[name] else { throw fail("INVALID_KEY", "不支持此按键。") }
        let source = CGEventSource(stateID: .privateState)
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else { throw fail("EVENT_FAILED", "无法生成按键事件。") }
        if name == "selectAll" { down.flags = .maskCommand; up.flags = .maskCommand }
        if name == "text" {
            guard let text = args["text"] as? String, !text.isEmpty, text.count <= 200,
                  !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { throw fail("INVALID_TEXT", "输入文本应为 1 至 200 个字符，且不能包含控制字符。") }
            let utf16 = Array(text.utf16)
            down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
        }
        down.postToPid(app.processIdentifier); up.postToPid(app.processIdentifier)
        return ["windowId": id, "action": "key", "key": name, "submitted": true]
    default: throw fail("INVALID_COMMAND", "仅支持 inspect、screenshot、raise、clickNormalized、key。")
    }
}
@main
struct MeetingNative {
    @MainActor
    static func main() async {
        let args = CommandLine.arguments
        // Finder launch only explains the manual permission step. Explicit CLI commands never show UI.
        if args.count == 1 || (args.count == 2 && args[1].hasPrefix("-psn_")) {
            let app = NSApplication.shared
            app.setActivationPolicy(.accessory)
            let alert = NSAlert()
            alert.messageText = "龙虾脑会议执行器"
            alert.informativeText = "请打开系统设置 → 隐私与安全性 → 辅助功能，点击 +，选择此应用并打开开关。\n\n应用位置：\n\(Bundle.main.bundlePath)\n\n授权后回到龙虾脑网页重试会议任务。此提示不会修改系统权限或操作腾讯会议。"
            alert.addButton(withTitle: "知道了")
            app.activate(ignoringOtherApps: true)
            alert.runModal()
            return
        }
        var response: [String: Any]
        do {
            guard #available(macOS 14.0, *) else { throw fail("OS_UNSUPPORTED", "原生执行器需要 macOS 14 或更新版本。") }
            guard args.count >= 2, args.count <= 3 else { throw fail("INVALID_ARGUMENTS", "用法：meeting-native <command> '<JSON>'") }
            let object = try JSONSerialization.jsonObject(with: Data((args.count == 3 ? args[2] : "{}").utf8))
            guard let options = object as? [String: Any] else { throw fail("INVALID_ARGUMENTS", "参数必须为 JSON 对象。") }
            response = try await execute(args[1], options)
            response["ok"] = true
        } catch let error as NativeError { response = ["ok": false, "error": ["code": error.code, "message": error.message]] }
        catch { response = ["ok": false, "error": ["code": "NATIVE_ERROR", "message": error.localizedDescription]] }
        response["timestamp"] = ISO8601DateFormatter().string(from: Date())
        if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]), let json = String(data: data, encoding: .utf8) { print(json) }
        else { print("{\"ok\":false,\"error\":{\"code\":\"JSON_FAILED\",\"message\":\"无法编码结果。\"}}") }
    }
}
