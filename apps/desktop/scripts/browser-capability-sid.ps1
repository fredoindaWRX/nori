# Resolve the exact Chromium content network capability, not an arbitrary SID.
if (-not ('NoriBrowserCapabilityNative' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class NoriBrowserCapabilityNative {
    [DllImport("KernelBase.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeriveCapabilitySidsFromName(string name,
        out IntPtr groups, out uint groupCount, out IntPtr capabilities, out uint capabilityCount);
    [DllImport("Kernel32.dll")] private static extern IntPtr LocalFree(IntPtr pointer);
    private static void FreeArray(IntPtr array, uint count) {
        if (array == IntPtr.Zero) return;
        for (uint i=0;i<count;i++) LocalFree(Marshal.ReadIntPtr(array,checked((int)i*IntPtr.Size)));
        LocalFree(array);
    }
    public static string GetNetworkSid() {
        IntPtr groups=IntPtr.Zero, capabilities=IntPtr.Zero;
        uint groupCount=0, capabilityCount=0;
        try {
            if (!DeriveCapabilitySidsFromName("lpacContentNetworkService", out groups, out groupCount,
                out capabilities, out capabilityCount)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (capabilityCount != 1 || capabilities == IntPtr.Zero)
                throw new InvalidOperationException("Unexpected Chromium capability identity count");
            return new SecurityIdentifier(Marshal.ReadIntPtr(capabilities)).Value;
        } finally { FreeArray(groups,groupCount); FreeArray(capabilities,capabilityCount); }
    }
}
'@
}
