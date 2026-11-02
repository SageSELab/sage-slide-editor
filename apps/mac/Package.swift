// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SageTalk",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "SageTalk", targets: ["SageTalk"]),
        .library(name: "SageTalkCore", targets: ["SageTalkCore"]),
    ],
    targets: [
        // AppKit-free logic: document model, sidecar RPC, view models. Unit-tested.
        .target(name: "SageTalkCore"),
        // The SwiftUI/AppKit app shell.
        .executableTarget(name: "SageTalk", dependencies: ["SageTalkCore"]),
        .testTarget(name: "SageTalkCoreTests", dependencies: ["SageTalkCore"]),
    ]
)
