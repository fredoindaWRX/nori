using System;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace Nori.ProcessOwnership {
    public sealed class DesktopSessionReport {
        public string Kind { get; private set; }
        public uint Sequence { get; private set; }
        public uint Flags { get; private set; }
        internal DesktopSessionReport(string kind, uint sequence, uint flags) {
            Kind = kind; Sequence = sequence; Flags = flags;
        }
    }

    // Authenticated reports from the ORIGINAL retained Job root only. This
    // endpoint neither owns/releases state leases nor proves physical Job drain.
    public sealed class DesktopSessionPipe : IDisposable {
        const uint FailedBit = 1, NormalBit = 2, CleanupBit = 4, OwnershipBit = 8;
        const uint BootBit = 16, RendererBit = 32, ReadyBits = BootBit | RendererBit;
        const int MaximumFrameBytes = 512;

        [StructLayout(LayoutKind.Sequential)]
        struct SecurityAttributes {
            public int length;
            public IntPtr descriptor;
            [MarshalAs(UnmanagedType.Bool)] public bool inherit;
        }
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(
            string text, uint revision, out IntPtr descriptor, out uint size);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern SafePipeHandle CreateNamedPipeW(string name, uint openMode, uint pipeMode,
            uint instances, uint outputBytes, uint inputBytes, uint timeout, ref SecurityAttributes security);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint pid);
        [DllImport("kernel32.dll")]
        static extern IntPtr LocalFree(IntPtr memory);

        readonly byte[] key = RandomSecret();
        readonly NamedPipeServerStream pipe;
        readonly byte[] readBuffer = new byte[MaximumFrameBytes];
        OwnedJob originalJob;
        int readOffset, readCount, busy, disposed;
        bool attachStarted, attached, quitNormal;
        uint readinessFlags;

        public string Nonce { get; private set; }
        public string Challenge { get; private set; }
        public string PipePath { get; private set; }
        public string PipeName { get; private set; }
        public string KeyHex { get { EnsureOpen(); return Hex(key); } }
        public uint ControllerPid { get; private set; }
        public uint GuiPid { get { EnsureBound(); return originalJob.RootPid; } }
        public uint LastSequence { get; private set; }
        public bool Failed { get; private set; }
        public bool Ready { get; private set; }
        public bool Quitting { get; private set; }
        public bool Terminal { get; private set; }
        public bool Faulted { get; private set; }

        public DesktopSessionPipe() {
            Nonce = Hex(RandomSecret()); Challenge = Hex(RandomSecret());
            PipeName = "nori-guardian-" + Nonce; PipePath = @"\\.\pipe\" + PipeName;
            ControllerPid = checked((uint)System.Diagnostics.Process.GetCurrentProcess().Id);
            IntPtr descriptor = IntPtr.Zero;
            SafePipeHandle handle = null;
            try {
                string sid = WindowsIdentity.GetCurrent().User.Value;
                uint size;
                // Protected DACL, current account and SYSTEM only. The handle
                // is never inherited; random name plus FIRST_PIPE_INSTANCE
                // refuses an existing namespace object instead of adopting it.
                if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    "D:P(A;;GA;;;" + sid + ")(A;;GA;;;SY)", 1, out descriptor, out size))
                    throw NativeError("Create private desktop pipe security");
                var security = new SecurityAttributes {
                    length = Marshal.SizeOf(typeof(SecurityAttributes)), descriptor = descriptor, inherit = false
                };
                handle = CreateNamedPipeW(PipePath, 0x00000003 | 0x00080000 | 0x40000000,
                    0x00000008, 1, MaximumFrameBytes, MaximumFrameBytes, 0, ref security);
                if (handle == null || handle.IsInvalid) throw NativeError("Create original desktop session pipe");
                // BYTE + WAIT + REJECT_REMOTE_CLIENTS, asynchronous native handle.
                pipe = new NamedPipeServerStream(PipeDirection.InOut, true, false, handle);
                handle = null; // Stream now owns the exact native handle.
            } catch {
                Array.Clear(key, 0, key.Length);
                if (handle != null) handle.Dispose();
                throw;
            } finally {
                if (descriptor != IntPtr.Zero) LocalFree(descriptor);
            }
        }

        static Exception NativeError(string operation) {
            return new Win32Exception(Marshal.GetLastWin32Error(), operation);
        }
        static byte[] RandomSecret() {
            var bytes = new byte[32];
            using (var random = RandomNumberGenerator.Create()) random.GetBytes(bytes);
            return bytes;
        }
        static string Hex(byte[] bytes) {
            var text = new StringBuilder(bytes.Length * 2);
            foreach (byte value in bytes) text.Append(value.ToString("x2", CultureInfo.InvariantCulture));
            return text.ToString();
        }
        static bool LowerHex64(string text) {
            if (text == null || text.Length != 64) return false;
            foreach (char value in text) if (!(value >= '0' && value <= '9') && !(value >= 'a' && value <= 'f')) return false;
            return true;
        }
        static uint Decimal(string text, bool positive) {
            uint value;
            if (String.IsNullOrEmpty(text) || (text.Length > 1 && text[0] == '0'))
                throw new InvalidDataException("Canonical unsigned decimal required");
            foreach (char digit in text) if (digit < '0' || digit > '9')
                throw new InvalidDataException("Canonical unsigned decimal required");
            if (!UInt32.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out value) || (positive && value == 0))
                throw new InvalidDataException("Bounded unsigned decimal required");
            return value;
        }
        void EnsureOpen() {
            if (Volatile.Read(ref disposed) != 0) throw new ObjectDisposedException("DesktopSessionPipe");
            if (Faulted) throw new InvalidOperationException("Desktop session pipe is faulted");
        }
        void EnsureBound() {
            EnsureOpen();
            if (originalJob == null) throw new InvalidOperationException("Original retained Job must be bound");
        }
        void EnterOperation() {
            EnsureBound();
            if (Interlocked.CompareExchange(ref busy, 1, 0) != 0)
                throw new InvalidOperationException("Desktop session operations must be serialized");
        }

        public void BindOriginalJob(OwnedJob job) {
            EnsureOpen();
            if (job == null || originalJob != null || attachStarted || Volatile.Read(ref busy) != 0)
                throw new InvalidOperationException("Bind exactly one original retained Job before attachment");
            if (job.RootExited) throw new InvalidOperationException("Original Job root has already exited");
            if (Interlocked.CompareExchange(ref originalJob, job, null) != null)
                throw new InvalidOperationException("Original retained Job is already bound");
        }

        public async Task AttachAsync(CancellationToken cancellation) {
            EnterOperation();
            try {
                if (attachStarted) throw new InvalidOperationException("Original GUI attachment is one-shot");
                attachStarted = true;
                // Disposing the native pipe interrupts already pending .NET
                // Framework I/O too; token cancellation alone is insufficient.
                using (cancellation.Register(() => Dispose())) {
                    cancellation.ThrowIfCancellationRequested();
                    await Task.Factory.FromAsync(pipe.BeginWaitForConnection, pipe.EndWaitForConnection, null).ConfigureAwait(false);
                    cancellation.ThrowIfCancellationRequested();
                    uint clientPid;
                    if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out clientPid))
                        throw NativeError("Read desktop pipe client identity");
                    // The PID is only a comparison with the still-live ORIGINAL
                    // process handle. It never adopts or opens a process by PID.
                    if (originalJob.RootExited || clientPid != originalJob.RootPid)
                        throw new InvalidDataException("Desktop session peer is not the original retained Job root");
                    await WriteAsync("challenge", 0, 0, cancellation).ConfigureAwait(false);
                    var report = Parse(await ReadFrameAsync(cancellation).ConfigureAwait(false));
                    if (report.Kind != "attached" || report.Sequence != 1 || report.Flags != 0)
                        throw new InvalidDataException("Exact initial GUI attachment required");
                    LastSequence = 1; attached = true;
                    await WriteAsync("ack", report.Sequence, report.Flags, cancellation).ConfigureAwait(false);
                }
            } catch {
                Faulted = true; Dispose();
                if (cancellation.IsCancellationRequested) throw new OperationCanceledException(cancellation);
                throw;
            } finally { Interlocked.Exchange(ref busy, 0); }
        }

        public async Task<DesktopSessionReport> ReadReportAsync(CancellationToken cancellation) {
            EnterOperation();
            try {
                if (!attached || Terminal) throw new InvalidOperationException("Attached nonterminal GUI session required");
                using (cancellation.Register(() => Dispose())) {
                    cancellation.ThrowIfCancellationRequested();
                    var report = Parse(await ReadFrameAsync(cancellation).ConfigureAwait(false));
                    ValidateTransition(report);
                    LastSequence = report.Sequence;
                    Failed = Failed || (report.Flags & FailedBit) != 0;
                    readinessFlags = report.Flags & ReadyBits;
                    if (report.Kind == "ready") Ready = true;
                    if (report.Kind == "quitting") {
                        Quitting = true; quitNormal = (report.Flags & NormalBit) != 0;
                    }
                    if (report.Kind == "terminal") Terminal = true;
                    await WriteAsync("ack", report.Sequence, report.Flags, cancellation).ConfigureAwait(false);
                    return report;
                }
            } catch {
                Faulted = true; Dispose();
                if (cancellation.IsCancellationRequested) throw new OperationCanceledException(cancellation);
                throw;
            } finally { Interlocked.Exchange(ref busy, 0); }
        }

        void ValidateTransition(DesktopSessionReport report) {
            if (LastSequence == UInt32.MaxValue || report.Sequence != LastSequence + 1)
                throw new InvalidDataException("Exact next desktop sequence required; replay or gap refused");
            uint flags = report.Flags;
            bool failed = (flags & FailedBit) != 0, normal = (flags & NormalBit) != 0;
            if (Failed && !failed) throw new InvalidDataException("Desktop failure is sticky");
            if ((flags & OwnershipBit) != 0 && (flags & CleanupBit) == 0)
                throw new InvalidDataException("Ownership release requires verified cleanup");
            if (normal && (!Ready || failed || (flags & ReadyBits) != ReadyBits))
                throw new InvalidDataException("Normal shutdown requires prior readiness and no failure");
            if ((flags & readinessFlags) != readinessFlags)
                throw new InvalidDataException("Desktop readiness observations cannot regress");
            if (report.Kind == "ready") {
                if (Ready || Quitting || flags != ReadyBits)
                    throw new InvalidDataException("Readiness is one-shot and exact");
            } else if (report.Kind == "quitting") {
                if (Quitting || (flags & (CleanupBit | OwnershipBit)) != 0)
                    throw new InvalidDataException("Quit starts once before physical cleanup reports");
            } else if (report.Kind == "terminal") {
                if (!Quitting || (normal && !quitNormal) || (quitNormal && !normal && !failed))
                    throw new InvalidDataException("Terminal outcome must follow the original quit disposition");
                if (normal && flags != 62)
                    throw new InvalidDataException("Clean terminal requires all physical and session flags");
            } else throw new InvalidDataException("Unexpected GUI session message kind");
        }

        DesktopSessionReport Parse(string frame) {
            string[] fields = frame.Split('|');
            if (fields.Length != 9 || fields[0] != "NG1" || !LowerHex64(fields[2]) || !LowerHex64(fields[3]) ||
                fields[2] != Nonce || fields[3] != Challenge || !LowerHex64(fields[8]))
                throw new InvalidDataException("Exact desktop session identity and frame required");
            uint controller = Decimal(fields[4], true), gui = Decimal(fields[5], true);
            uint sequence = Decimal(fields[6], false), flags = Decimal(fields[7], false);
            if (controller != ControllerPid || gui != originalJob.RootPid || flags > 63)
                throw new InvalidDataException("Desktop session process identity or flags differ");
            int macStart = frame.LastIndexOf('|');
            string expected = Mac(frame.Substring(0, macStart));
            int difference = 0;
            for (int index = 0; index < expected.Length; index++) difference |= expected[index] ^ fields[8][index];
            if (difference != 0) throw new InvalidDataException("Desktop session authentication refused");
            return new DesktopSessionReport(fields[1], sequence, flags);
        }
        string Mac(string prefix) {
            using (var hmac = new HMACSHA256(key)) return Hex(hmac.ComputeHash(Encoding.ASCII.GetBytes(prefix)));
        }
        async Task WriteAsync(string kind, uint sequence, uint flags, CancellationToken cancellation) {
            string prefix = String.Join("|", new[] { "NG1", kind, Nonce, Challenge,
                ControllerPid.ToString(CultureInfo.InvariantCulture), originalJob.RootPid.ToString(CultureInfo.InvariantCulture),
                sequence.ToString(CultureInfo.InvariantCulture), flags.ToString(CultureInfo.InvariantCulture) });
            byte[] bytes = Encoding.ASCII.GetBytes(prefix + "|" + Mac(prefix) + "\n");
            if (bytes.Length > MaximumFrameBytes) throw new InvalidDataException("Outgoing desktop frame exceeds bound");
            await pipe.WriteAsync(bytes, 0, bytes.Length, cancellation).ConfigureAwait(false);
        }
        async Task<string> ReadFrameAsync(CancellationToken cancellation) {
            var frame = new StringBuilder(MaximumFrameBytes);
            for (;;) {
                cancellation.ThrowIfCancellationRequested();
                if (readOffset == readCount) {
                    readCount = await pipe.ReadAsync(readBuffer, 0, readBuffer.Length, cancellation).ConfigureAwait(false);
                    readOffset = 0;
                    if (readCount == 0) throw new EndOfStreamException("Original GUI session control closed");
                }
                byte value = readBuffer[readOffset++];
                if (value == 10) return frame.ToString();
                if (value < 32 || value > 126 || frame.Length >= MaximumFrameBytes - 1)
                    throw new InvalidDataException("Desktop frame exceeds bound or contains noncanonical ASCII");
                frame.Append((char)value);
            }
        }
        public void Dispose() {
            if (Interlocked.Exchange(ref disposed, 1) != 0) return;
            pipe.Dispose();
            Array.Clear(key, 0, key.Length);
        }
    }
}
