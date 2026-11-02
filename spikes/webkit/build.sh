#!/bin/sh
# Build the WKWebView spike tool (no Xcode project needed).
set -e
cd "$(dirname "$0")"
mkdir -p .build
swiftc -O -swift-version 5 -framework AppKit -framework WebKit -framework ScreenCaptureKit Sources/wkspike/main.swift -o .build/wkspike
echo ".build/wkspike"
