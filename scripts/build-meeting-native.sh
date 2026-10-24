#!/bin/sh
# Build the auditable native adapter; never request or change macOS permissions.
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_file="$project_dir/scripts/meeting-native.swift"
binary_file="$project_dir/.tooling/meeting-native"
app_dir="$project_dir/.tooling/龙虾脑会议执行器.app"
app_binary="$app_dir/Contents/MacOS/meeting-native"
mkdir -p "$project_dir/.tooling/swift-module-cache" "$app_dir/Contents/MacOS"
if [ -L "$binary_file" ] && [ -x "$app_binary" ] && [ "$app_binary" -nt "$source_file" ] && [ "$app_binary" -nt "$0" ]; then
  printf '%s\n' "$binary_file"
  exit 0
fi
if ! command -v swiftc >/dev/null 2>&1; then
  printf '%s\n' '缺少 Swift 编译器，请先安装 Apple Command Line Tools。' >&2
  exit 1
fi
sdk_dir=${MEETING_SWIFT_SDK:-}
if [ -z "$sdk_dir" ]; then
  # The stable SDK symlink can differ from xcrun's newest beta SDK on this Mac.
  if [ -d /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk ]; then
    sdk_dir=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk
  else
    sdk_dir=$(xcrun --sdk macosx --show-sdk-path)
  fi
fi
temporary_binary=$(mktemp "$project_dir/.tooling/.meeting-native-build-XXXXXX")
trap 'rm -f "$temporary_binary"' EXIT HUP INT TERM
swiftc -parse-as-library -O -sdk "$sdk_dir" -target "$(uname -m)-apple-macosx14.0" \
  -module-cache-path "$project_dir/.tooling/swift-module-cache" \
  -framework AppKit -framework ApplicationServices -framework ScreenCaptureKit \
  -framework Vision -framework ImageIO -framework UniformTypeIdentifiers \
  "$source_file" -o "$temporary_binary"
cat > "$app_dir/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.lobsterbrain.meeting-native</string>
<key>CFBundleName</key><string>龙虾脑会议执行器</string>
<key>CFBundleDisplayName</key><string>龙虾脑会议执行器</string>
<key>CFBundleExecutable</key><string>meeting-native</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.2.0</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
mv "$temporary_binary" "$app_binary"
chmod +x "$app_binary"
# Ad-hoc code signing makes the local app bundle inspectable without any developer account.
# It does not grant Accessibility, Screen Recording, or any other macOS permission.
/usr/bin/codesign --force --sign - --identifier local.lobsterbrain.meeting-native "$app_dir" >&2
ln -sfn '龙虾脑会议执行器.app/Contents/MacOS/meeting-native' "$binary_file"
printf '%s\n' "$binary_file"
