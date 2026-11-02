import Foundation
import Testing
@testable import SageTalkCore

/// Collects supervisor events in the background.
actor SupervisorLog {
    private(set) var events: [SupervisorEvent] = []
    func append(_ e: SupervisorEvent) { events.append(e) }
    func wait(count: Int, timeout: Duration = .seconds(5)) async -> [SupervisorEvent] {
        let clock = ContinuousClock(), end = clock.now + timeout
        while clock.now < end, events.count < count { try? await Task.sleep(for: .milliseconds(10)) }
        return events
    }
    static func watching(_ s: SidecarSupervisor) -> SupervisorLog {
        let log = SupervisorLog()
        Task { for await e in s.events { await log.append(e) } }
        return log
    }
}

@Suite struct SidecarSupervisorTests {
    let crash = SidecarTermination(reason: .uncaughtSignal, status: 9)

    @Test func policyRestartsOnlyUnexpectedExitsWithinBudget() {
        let p = RestartPolicy()
        #expect(p.shouldRestart(after: crash, restartsSoFar: 0))
        #expect(!p.shouldRestart(after: crash, restartsSoFar: 1))
        #expect(!p.shouldRestart(after: SidecarTermination(reason: .exit, status: 0, expected: true), restartsSoFar: 0))
        #expect(RestartPolicy(maxRestarts: 3).shouldRestart(after: crash, restartsSoFar: 2))
    }

    @Test func restartsOnceAfterACrashAndReopensTheTalk() async throws {
        let f = FakeFactory { $0.onRequest = scriptedSidecar }
        let sup = SidecarSupervisor(client: SidecarClient(transport: f.make))
        let log = SupervisorLog.watching(sup)
        let opened = try await sup.open(URL(fileURLWithPath: "/t"))
        #expect(opened.kind == .beatFormat)

        f.last.exit(crash)
        let ev = await log.wait(count: 2)
        #expect(ev.first == .crashed(crash, willRestart: true))
        guard case .restarted(let r)? = ev.dropFirst().first else { Issue.record("no restart: \(ev)"); return }
        #expect(r?.holds?.count == 1)
        #expect(f.transports.count == 2)
        #expect(f.last.sent.map(\.method) == ["talk.open"])
        #expect(await sup.restartCount == 1)
        #expect(try await sup.client.ping().pong)
    }

    @Test func givesUpAfterASecondCrash() async throws {
        let f = FakeFactory { $0.onRequest = scriptedSidecar }
        let sup = SidecarSupervisor(client: SidecarClient(transport: f.make))
        let log = SupervisorLog.watching(sup)
        _ = try await sup.open(URL(fileURLWithPath: "/t"))
        f.last.exit(crash)
        _ = await log.wait(count: 2)
        f.last.exit(crash)
        let ev = await log.wait(count: 4)
        #expect(ev.count == 4)
        #expect(ev[2] == .crashed(crash, willRestart: false))
        if case .failed = ev[3] {} else { Issue.record("expected .failed, got \(ev[3])") }
        #expect(f.transports.count == 2)
        #expect(await !sup.client.isRunning)
    }

    @Test func forwardsNotifications() async throws {
        let f = FakeFactory { $0.onRequest = scriptedSidecar }
        let sup = SidecarSupervisor(client: SidecarClient(transport: f.make))
        let log = SupervisorLog.watching(sup)
        try await sup.start()
        f.last.emit(.notification("talk.built", params: ["ok": true, "diagnostics": [], "ms": 3, "trigger": "change"]))
        let ev = await log.wait(count: 1)
        guard case .notification(let m, let p)? = ev.first else { Issue.record("\(ev)"); return }
        #expect(m == "talk.built")
        let built: SidecarProtocol.BuiltParams = try #require(try p?.decode())
        #expect(built.trigger == .change)
    }

    @Test func shutdownStopsWithoutRestarting() async throws {
        let f = FakeFactory { $0.onRequest = scriptedSidecar }
        let sup = SidecarSupervisor(client: SidecarClient(transport: f.make))
        let log = SupervisorLog.watching(sup)
        try await sup.start()
        await sup.shutdown()
        #expect(f.last.sent.map(\.method) == ["app.shutdown"])
        #expect(f.last.inputClosed)
        #expect(await !sup.client.isRunning)
        try await Task.sleep(for: .milliseconds(100))
        #expect(await log.events.isEmpty)
        #expect(f.transports.count == 1)
    }

    @Test func locatorPrefersTheEnvironmentThenTheBakedPath() throws {
        let fm = FileManager.default
        let base = fm.temporaryDirectory.appendingPathComponent("sage-loc-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: base) }
        func repo(_ name: String) throws -> URL {
            let r = base.appendingPathComponent(name)
            try fm.createDirectory(at: r.appendingPathComponent("packages/sidecar/src"), withIntermediateDirectories: true)
            try Data().write(to: r.appendingPathComponent("packages/sidecar/src/main.ts"))
            return r
        }
        let envRepo = try repo("env"), bakedRepo = try repo("baked")
        let resources = base.appendingPathComponent("Resources")
        try fm.createDirectory(at: resources, withIntermediateDirectories: true)
        try Data((bakedRepo.path + "\n").utf8).write(to: resources.appendingPathComponent(SidecarLocator.repoPathResource))

        #expect(SidecarLocator.repoRoot(environment: ["SAGE_REPO": envRepo.path], resources: resources, executable: nil)?.path
                == envRepo.standardizedFileURL.path)
        #expect(SidecarLocator.repoRoot(environment: [:], resources: resources, executable: nil)?.path
                == bakedRepo.standardizedFileURL.path)
        // A stale env var falls through to the baked path.
        #expect(SidecarLocator.repoRoot(environment: ["SAGE_REPO": "/nope"], resources: resources, executable: nil)?.path
                == bakedRepo.standardizedFileURL.path)
        // swift run: the executable sits under apps/mac/.build/<arch>/debug inside the repo.
        let exe = envRepo.appendingPathComponent("apps/mac/.build/arm64/debug/SageTalk")
        #expect(SidecarLocator.repoRoot(environment: [:], resources: nil, executable: exe)?.path
                == envRepo.standardizedFileURL.path)
        #expect(SidecarLocator.repoRoot(environment: [:], resources: nil, executable: nil) == nil)
    }

    @Test func locatorFindsNodeFromTheEnvironment() {
        let n = SidecarLocator.node(environment: ["SAGE_NODE": "/bin/sh"], resources: nil)
        #expect(n?.path == "/bin/sh")
    }

    /// A packaged app runs its own sidecar (node + dist/main.mjs inside Resources), with no
    /// repository anywhere; SAGE_REPO naming a real checkout still wins (development).
    @Test func locatorPrefersTheBundledSidecar() throws {
        let fm = FileManager.default
        let base = fm.temporaryDirectory.appendingPathComponent("sage-bundled-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: base) }
        let resources = base.appendingPathComponent("SAGE Talk.app/Contents/Resources")
        let side = resources.appendingPathComponent("sidecar")
        try fm.createDirectory(at: side.appendingPathComponent("dist"), withIntermediateDirectories: true)
        try fm.createDirectory(at: resources.appendingPathComponent("node/bin"), withIntermediateDirectories: true)
        try Data().write(to: side.appendingPathComponent("dist/main.mjs"))
        let node = resources.appendingPathComponent("node/bin/node")
        try Data("#!/bin/sh\n".utf8).write(to: node)

        // Not executable, no manifest: not a bundle.
        #expect(!SidecarConfiguration.Bundled.present(in: resources))
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: node.path)
        #expect(!SidecarConfiguration.Bundled.present(in: resources))
        try Data("{}".utf8).write(to: side.appendingPathComponent("manifest.json"))
        #expect(SidecarConfiguration.Bundled.present(in: resources))

        let config = try SidecarLocator.configuration(environment: ["PATH": ""], resources: resources, executable: nil).get()
        #expect(config.mode == .bundled)
        #expect(config.executable.path == node.path)
        #expect(config.arguments == [side.appendingPathComponent("dist/main.mjs").path])
        #expect(config.currentDirectory?.path == side.path)
        #expect(config.environment == nil)

        // A stale SAGE_REPO does not pull a packaged app out of its bundle.
        #expect(SidecarLocator.usesBundle(environment: ["SAGE_REPO": "/nope"], resources: resources))
        let repo = base.appendingPathComponent("checkout")
        try fm.createDirectory(at: repo.appendingPathComponent("packages/sidecar/src"), withIntermediateDirectories: true)
        try Data().write(to: repo.appendingPathComponent("packages/sidecar/src/main.ts"))
        let dev = try SidecarLocator.configuration(environment: ["SAGE_REPO": repo.path, "SAGE_NODE": "/bin/sh"], resources: resources, executable: nil).get()
        #expect(dev.mode == .development)
        #expect(dev.currentDirectory?.path == repo.appendingPathComponent("packages/sidecar").standardizedFileURL.path)
    }
}
