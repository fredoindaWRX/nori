using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Nori.ProcessOwnership {
    // Exact handles only. Not an OS sandbox against brokered/WMI execution.
    // Windows 10+ JOB_LIST associates at creation; there is no attach fallback.
    public sealed class OwnedJob : IDisposable {
        [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
        struct StartupInfo {
            public int cb; public string reserved, desktop, title;
            public uint x,y,xSize,ySize,xChars,yChars,fill,flags;
            public ushort show,reservedBytes; public IntPtr reservedPointer,input,output,error;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct StartupInfoEx { public StartupInfo info; public IntPtr attributes; }
        [StructLayout(LayoutKind.Sequential)]
        struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
        [StructLayout(LayoutKind.Sequential)]
        struct BasicLimits {
            public long processTime,jobTime; public uint flags;
            public UIntPtr minWorking,maxWorking; public uint activeLimit;
            public UIntPtr affinity; public uint priority,scheduling;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
        [StructLayout(LayoutKind.Sequential)]
        struct ExtendedLimits {
            public BasicLimits basic; public IoCounters io;
            public UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct Accounting {
            public long user,kernel,periodUser,periodKernel;
            public uint pageFaults,total,active,terminated;
        }
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
        static extern IntPtr CreateJobObjectW(IntPtr security,string name);
        [DllImport("kernel32.dll",SetLastError=true)]
        [return:MarshalAs(UnmanagedType.Bool)]
        static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimits data,uint size);
        [DllImport("kernel32.dll",SetLastError=true)]
        [return:MarshalAs(UnmanagedType.Bool)]
        static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting data,uint size,IntPtr returned);
        [DllImport("kernel32.dll",EntryPoint="QueryInformationJobObject",SetLastError=true)]
        [return:MarshalAs(UnmanagedType.Bool)]
        static extern bool QueryJobBuffer(IntPtr job,int kind,IntPtr data,uint size,out uint returned);
        [DllImport("kernel32.dll",SetLastError=true)]
        [return:MarshalAs(UnmanagedType.Bool)]
        static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref UIntPtr size);
        [DllImport("kernel32.dll",SetLastError=true)]
        [return:MarshalAs(UnmanagedType.Bool)]
        static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,UIntPtr key,IntPtr value,UIntPtr size,IntPtr old,IntPtr returned);
        [DllImport("kernel32.dll")]
        static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
        [return:MarshalAs(UnmanagedType.Bool)]
        static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,
            [MarshalAs(UnmanagedType.Bool)]bool inherit,uint flags,IntPtr environment,string cwd,ref StartupInfoEx startup,out ProcessInfo process);
        [DllImport("kernel32.dll",SetLastError=true)]
        [return:MarshalAs(UnmanagedType.Bool)]
        static extern bool IsProcessInJob(IntPtr process,IntPtr job,[MarshalAs(UnmanagedType.Bool)]out bool belongs);
        [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
        [DllImport("kernel32.dll",SetLastError=true)]
        [return:MarshalAs(UnmanagedType.Bool)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
        [DllImport("kernel32.dll",SetLastError=true)]
        [return:MarshalAs(UnmanagedType.Bool)] static extern bool TerminateJobObject(IntPtr job,uint code);
        [DllImport("kernel32.dll",SetLastError=true)]
        [return:MarshalAs(UnmanagedType.Bool)] static extern bool TerminateProcess(IntPtr process,uint code);
        [DllImport("kernel32.dll",SetLastError=true)]
        [return:MarshalAs(UnmanagedType.Bool)] static extern bool CloseHandle(IntPtr handle);

        IntPtr job=IntPtr.Zero,process=IntPtr.Zero,thread=IntPtr.Zero;
        bool resumed,disposed;
        public uint RootPid { get; private set; }
        static Exception NativeError(string operation) { return new Win32Exception(Marshal.GetLastWin32Error(),operation); }
        static void Require(bool result,string operation) { if(!result)throw NativeError(operation); }
        void Open() { if(disposed||job==IntPtr.Zero||process==IntPtr.Zero)throw new InvalidOperationException("Owned Job is closed"); }

        public static string QuoteArgument(string argument) {
            if(argument==null||argument.IndexOf('\0')>=0)throw new ArgumentException("Invalid Windows argument");
            var result=new StringBuilder("\""); int slashes=0;
            foreach(char value in argument) {
                if(value=='\\') { slashes++; continue; }
                if(value=='\"') { result.Append('\\',slashes*2+1);result.Append(value); }
                else { result.Append('\\',slashes);result.Append(value); }
                slashes=0;
            }
            result.Append('\\',slashes*2);result.Append('"');return result.ToString();
        }
        public static System.Threading.Tasks.Task<string> ReadControl() {
            // Console's synchronized TextReader can implement ReadLineAsync
            // synchronously on .NET Framework. Never block the accounting loop.
            return System.Threading.Tasks.Task.Factory.StartNew(()=>Console.In.ReadLine());
        }

        public OwnedJob(string executable,string[] arguments,string cwd,bool invalidJobHandleForTest)
            : this(executable,arguments,cwd,invalidJobHandleForTest,null) { }

        // Explicit launch environment avoids mutating this controller's global
        // environment to pass a per-session key. The block is copied at process
        // creation and freed before resume; no credential appears in argv.
        public OwnedJob(string executable,string[] arguments,string cwd,bool invalidJobHandleForTest,
            IDictionary<string,string> environment) {
            if(!Path.IsPathRooted(executable)||!File.Exists(executable)||!Path.IsPathRooted(cwd)||!Directory.Exists(cwd))
                throw new ArgumentException("Explicit existing executable and working directory required");
            if(arguments==null||arguments.Length>128)throw new ArgumentException("Bounded argv required");
            var command=new StringBuilder(QuoteArgument(executable));
            foreach(string argument in arguments)command.Append(' ').Append(QuoteArgument(argument));
            if(command.Length>=32767)throw new ArgumentException("Windows command line exceeds limit");
            IntPtr attributes=IntPtr.Zero,jobValue=IntPtr.Zero,environmentBlock=IntPtr.Zero;bool attributesInitialized=false;
            try {
                if(environment!=null) {
                    var ordered=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
                    foreach(var pair in environment) {
                        if(String.IsNullOrEmpty(pair.Key)||pair.Key.IndexOf('=')>=0||pair.Key.IndexOf('\0')>=0||
                            pair.Value==null||pair.Value.IndexOf('\0')>=0||ordered.ContainsKey(pair.Key))
                            throw new ArgumentException("Invalid explicit Windows environment");
                        ordered.Add(pair.Key,pair.Value);
                    }
                    var block=new StringBuilder();
                    foreach(var pair in ordered)block.Append(pair.Key).Append('=').Append(pair.Value).Append('\0');
                    block.Append('\0');
                    if(ordered.Count==0)block.Append('\0');
                    if(block.Length>131072)throw new ArgumentException("Explicit Windows environment exceeds bound");
                    environmentBlock=Marshal.StringToHGlobalUni(block.ToString());
                }
                job=CreateJobObjectW(IntPtr.Zero,null); if(job==IntPtr.Zero)throw NativeError("Create owned Job");
                var limits=new ExtendedLimits();limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE; NO breakaway/UI limits.
                Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits))),"Set owned Job limits");
                UIntPtr size=UIntPtr.Zero;
                bool sized=InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
                if(sized||Marshal.GetLastWin32Error()!=122||size.ToUInt64()==0||size.ToUInt64()>65536)
                    throw new InvalidOperationException("Owned Job attribute sizing refused");
                attributes=Marshal.AllocHGlobal(checked((int)size.ToUInt64()));
                Require(InitializeProcThreadAttributeList(attributes,1,0,ref size),"Initialize owned Job attributes");
                attributesInitialized=true;
                jobValue=Marshal.AllocHGlobal(IntPtr.Size);
                Marshal.WriteIntPtr(jobValue,invalidJobHandleForTest?new IntPtr(-1):job);
                Require(UpdateProcThreadAttribute(attributes,0,new UIntPtr(0x0002000D),jobValue,new UIntPtr((uint)IntPtr.Size),IntPtr.Zero,IntPtr.Zero),
                    "Associate owned Job at process creation");
                var startup=new StartupInfoEx();startup.info.cb=Marshal.SizeOf(typeof(StartupInfoEx));
                startup.info.flags=1;startup.info.show=0;startup.attributes=attributes;
                ProcessInfo created;
                Require(CreateProcessW(executable,command,IntPtr.Zero,IntPtr.Zero,false,
                    0x00000004|0x00080000|0x08000000|(environment!=null?0x00000400u:0u),
                    environmentBlock,cwd,ref startup,out created),"Create owned suspended process");
                process=created.process;thread=created.thread;RootPid=created.pid;
                bool belongs;
                Require(IsProcessInJob(process,job,out belongs),"Check creation-time Job membership");
                if(!belongs)throw new InvalidOperationException("Owned process was not associated at creation");
            }catch {
                if(process!=IntPtr.Zero) {
                    // Exact created handle, never PID adoption. This exceptional
                    // path does not resume the child or report successful launch.
                    if(TerminateProcess(process,125))WaitForSingleObject(process,5000);
                }
                Dispose();throw;
            }finally {
                if(attributesInitialized)DeleteProcThreadAttributeList(attributes);
                if(attributes!=IntPtr.Zero)Marshal.FreeHGlobal(attributes);
                if(jobValue!=IntPtr.Zero)Marshal.FreeHGlobal(jobValue);
                if(environmentBlock!=IntPtr.Zero)Marshal.FreeHGlobal(environmentBlock);
            }
        }
        public void Resume() {
            Open();if(resumed)throw new InvalidOperationException("Owned process already resumed");
            uint count=ResumeThread(thread);
            if(count!=1)throw count==UInt32.MaxValue?NativeError("Resume owned process"):new InvalidOperationException("Unexpected suspend count");
            resumed=true;
        }
        public bool RootExited {
            get {
                Open();uint result=WaitForSingleObject(process,0);
                if(result==0)return true;
                if(result==258)return false;
                throw NativeError("Wait owned process handle");
            }
        }
        public uint RootExitCode {
            get { if(!RootExited)throw new InvalidOperationException("Owned process still running");uint code;Require(GetExitCodeProcess(process,out code),"Read owned exit code");return code; }
        }
        public uint ActiveProcesses(bool invalidQueryHandleForTest) {
            Open();Accounting data;
            Require(QueryInformationJobObject(invalidQueryHandleForTest?new IntPtr(-1):job,1,out data,
                (uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero),"Query owned Job accounting");
            return data.active;
        }
        public uint TotalProcesses {
            get { Open();Accounting data;Require(QueryInformationJobObject(job,1,out data,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero),"Query owned Job total");return data.total; }
        }
        public uint[] ProcessIds() {
            Open();
            // Read-only membership of THIS exact retained Job, including its
            // nested jobs. IDs are never used to adopt or terminate processes.
            for(int capacity=64;capacity<=8192;capacity*=2) {
                int size=checked(8+capacity*IntPtr.Size);
                IntPtr buffer=Marshal.AllocHGlobal(size);
                try {
                    uint returned;
                    if(!QueryJobBuffer(job,3,buffer,(uint)size,out returned)) {
                        if(Marshal.GetLastWin32Error()==234)continue;
                        throw NativeError("Read exact Job membership");
                    }
                    int count=Marshal.ReadInt32(buffer,4);
                    int assigned=Marshal.ReadInt32(buffer,0);
                    if(count<0||count>capacity||returned<(uint)(8+count*IntPtr.Size)||returned>(uint)size)
                        throw new InvalidOperationException("Invalid Job membership count or byte extent");
                    if(assigned<count||assigned<0)throw new InvalidOperationException("Invalid Job assigned count");
                    if(count<assigned)continue; // Complete snapshot only, never accept a truncated list.
                    var ids=new uint[count];
                    for(int index=0;index<count;index++) {
                        long id=Marshal.ReadIntPtr(buffer,8+index*IntPtr.Size).ToInt64();
                        if(id<1||id>UInt32.MaxValue)throw new InvalidOperationException("Invalid Job process identity");
                        ids[index]=(uint)id;
                    }
                    return ids;
                } finally { Marshal.FreeHGlobal(buffer); }
            }
            throw new InvalidOperationException("Owned Job membership exceeded bound");
        }
        public void TerminateAndDrain(int timeoutMs) {
            Open();if(timeoutMs<1||timeoutMs>30000)throw new ArgumentException("Invalid owned drain deadline");
            Require(TerminateJobObject(job,125),"Terminate exact owned Job");
            var deadline=DateTime.UtcNow.AddMilliseconds(timeoutMs);
            do {
                if(RootExited&&ActiveProcesses(false)==0)return;
                Thread.Sleep(10);
            }while(DateTime.UtcNow<deadline);
            throw new TimeoutException("Owned Job did not drain");
        }
        public void Dispose() {
            if(disposed)return;
            // Closing a Job requests forced cleanup, not proof of quiescence.
            // Callers may release state only after explicit handle+accounting checks.
            if(thread!=IntPtr.Zero) { CloseHandle(thread);thread=IntPtr.Zero; }
            if(process!=IntPtr.Zero) { CloseHandle(process);process=IntPtr.Zero; }
            if(job!=IntPtr.Zero) { CloseHandle(job);job=IntPtr.Zero; }
            disposed=true;
        }
    }
}
