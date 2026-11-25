using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Nori.ProcessOwnership.Tests {
    // Disposable acceptance host. No GUI, user profile, state lease or release.
    public static class DesktopSessionPipeFixture {
        static void Require(bool condition, string message) {
            if (!condition) throw new InvalidOperationException(message);
        }
        static IDictionary<string,string> EnvironmentFor(DesktopSessionPipe endpoint) {
            var values = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
            foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables()) {
                string name = (string)entry.Key;
                if (name.IndexOf('=') >= 0 || name.StartsWith("NORI_", StringComparison.OrdinalIgnoreCase) ||
                    name.Equals("NODE_OPTIONS", StringComparison.OrdinalIgnoreCase) ||
                    name.Equals("NODE_PATH", StringComparison.OrdinalIgnoreCase) ||
                    name.StartsWith("ELECTRON_", StringComparison.OrdinalIgnoreCase)) continue;
                values[name] = (string)entry.Value;
            }
            values["NORI_PIPE_FIXTURE_PATH"] = endpoint.PipePath;
            values["NORI_PIPE_FIXTURE_KEY"] = endpoint.KeyHex;
            values["NORI_PIPE_FIXTURE_NONCE"] = endpoint.Nonce;
            values["NORI_PIPE_FIXTURE_CONTROLLER"] = endpoint.ControllerPid.ToString();
            // Also safe if the caller's Node runtime is Electron's Node mode.
            values["ELECTRON_RUN_AS_NODE"] = "1";
            return values;
        }
        static Process WrongPeer(string executable, string script, IDictionary<string,string> environment, string cwd) {
            var start = new ProcessStartInfo(executable,
                OwnedJob.QuoteArgument(script) + " " + OwnedJob.QuoteArgument("wrong-peer"));
            start.WorkingDirectory = cwd; start.UseShellExecute = false; start.CreateNoWindow = true;
            start.EnvironmentVariables.Clear();
            foreach (var item in environment) start.EnvironmentVariables[item.Key] = item.Value;
            return Process.Start(start);
        }
        static async Task Run(string scenario, string executable, string script, string cwd) {
            using (var endpoint = new DesktopSessionPipe()) {
                var environment = EnvironmentFor(endpoint);
                using (var job = new OwnedJob(executable, new[] { script,
                    scenario == "wrong-peer" || scenario == "cancel-connect" ? "idle" : scenario }, cwd, false, environment)) {
                    endpoint.BindOriginalJob(job);
                    job.Resume();
                    using (var deadline = new CancellationTokenSource(5000)) {
                        Process wrongPeer = null;
                        try {
                            if (scenario == "cancel-connect" || scenario == "cancel-read") {
                                if (scenario == "cancel-read") await endpoint.AttachAsync(deadline.Token);
                                bool cancelled = false;
                                var watch = Stopwatch.StartNew();
                                using (var shortDeadline = new CancellationTokenSource(150)) {
                                    try {
                                        if (scenario == "cancel-connect") await endpoint.AttachAsync(shortDeadline.Token);
                                        else await endpoint.ReadReportAsync(shortDeadline.Token);
                                    } catch (OperationCanceledException) { cancelled = true; }
                                }
                                Require(cancelled && endpoint.Faulted && watch.ElapsedMilliseconds < 2000,
                                    "Pending native pipe I/O did not cancel promptly");
                                Require(!job.RootExited && job.ActiveProcesses(false) >= 1,
                                    "Endpoint cancellation mutated the retained Job");
                                Console.WriteLine("{\"scenario\":\"" + scenario + "\",\"passed\":true,\"cancelled\":true}");
                                return;
                            }
                            if (scenario == "wrong-peer") wrongPeer = WrongPeer(executable, script, environment, cwd);
                            bool refused = false;
                            try {
                                await endpoint.AttachAsync(deadline.Token);
                                if (scenario == "wrong-peer" || scenario == "wrong-mac")
                                    throw new InvalidOperationException("Unauthenticated attachment accepted");
                                if (scenario == "happy" || scenario == "late-failure") {
                                    var ready = await endpoint.ReadReportAsync(deadline.Token);
                                    var quitting = await endpoint.ReadReportAsync(deadline.Token);
                                    var terminal = await endpoint.ReadReportAsync(deadline.Token);
                                    Require(ready.Kind == "ready" && ready.Flags == 48 && endpoint.Ready, "Ready report differs");
                                    Require(quitting.Kind == "quitting" && quitting.Flags == 50, "Quit report differs");
                                    Require(terminal.Kind == "terminal" && terminal.Flags == (scenario == "happy" ? 62u : 61u), "Terminal report differs");
                                    Require(endpoint.Terminal && endpoint.Quitting && !endpoint.Faulted &&
                                        endpoint.Failed == (scenario == "late-failure") && endpoint.LastSequence == 4, "Terminal state differs");
                                } else if (scenario == "cancelled") {
                                    var quitting = await endpoint.ReadReportAsync(deadline.Token);
                                    var terminal = await endpoint.ReadReportAsync(deadline.Token);
                                    Require(quitting.Flags == 0 && terminal.Flags == 12 && endpoint.Terminal && !endpoint.Ready && !endpoint.Failed,
                                        "Cancelled outcome differs");
                                } else {
                                    if (scenario == "replay" || scenario == "skipped-sequence" || scenario == "ready-twice")
                                        await endpoint.ReadReportAsync(deadline.Token);
                                    if (scenario == "sticky-failure" || scenario == "normal-upgrade")
                                        await endpoint.ReadReportAsync(deadline.Token);
                                    await endpoint.ReadReportAsync(deadline.Token);
                                    throw new InvalidOperationException("Invalid report accepted");
                                }
                            } catch (InvalidDataException) {
                                refused = true;
                            }
                            bool rejectionExpected = scenario != "happy" && scenario != "late-failure" && scenario != "cancelled";
                            Require(refused == rejectionExpected, "Expected protocol rejection differs");
                            if (refused) Require(endpoint.Faulted, "Protocol rejection must fault endpoint");
                            if (!refused) {
                                var end = Stopwatch.StartNew();
                                while (!job.RootExited && end.ElapsedMilliseconds < 2000) await Task.Delay(10);
                                Require(job.RootExited && job.RootExitCode == 0 && job.ActiveProcesses(false) == 0,
                                    "Original Node peer did not finish cleanly");
                            }
                            Console.WriteLine("{\"scenario\":\"" + scenario + "\",\"passed\":true,\"rejected\":" +
                                (refused ? "true" : "false") + ",\"originalNodeRootPid\":" + job.RootPid + "}");
                        } finally {
                            if (wrongPeer != null) {
                                if (!wrongPeer.WaitForExit(1000)) { wrongPeer.Kill(); wrongPeer.WaitForExit(1000); }
                                wrongPeer.Dispose();
                            }
                            // Exact disposable fixture Job only. The endpoint
                            // itself never terminates, drains or releases it.
                            job.TerminateAndDrain(5000);
                        }
                    }
                }
            }
        }
        public static int Main(string[] args) {
            try {
                if (args.Length != 4) throw new ArgumentException("Scenario, Node executable, peer script and prepared fixture required");
                if (!Directory.Exists(args[3]) || !Path.GetFileName(args[3]).StartsWith(".native-desktop-session-pipe-"))
                    throw new ArgumentException("Fresh desktop-session pipe fixture required");
                Run(args[0], args[1], args[2], args[3]).GetAwaiter().GetResult();
                return 0;
            } catch (Exception error) {
                Console.Error.WriteLine(error.GetType().Name + ": " + error.Message);
                return 1;
            }
        }
    }
}
