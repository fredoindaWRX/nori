using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using Nori.ProcessOwnership;

// Disposable test worker only. No model, user profile, network, sensor or service.
public static class NoriJobFixture {
    public static int Main(string[] args) {
        if(args.Length<2)return 3;
        string root=Path.GetFullPath(args[0]),mode=args[1];
        if(!Path.GetFileName(root).StartsWith(".native-job-guardian-")||!Directory.Exists(root))return 4;
        File.WriteAllText(Path.Combine(root,mode+"-started.txt"),Process.GetCurrentProcess().Id.ToString());
        if(mode=="argv") {
            File.WriteAllLines(Path.Combine(root,"argv-base64.txt"),args.Skip(2).Select(value=>Convert.ToBase64String(Encoding.UTF8.GetBytes(value))).ToArray());return 0;
        }
        if(mode=="child") {
            Thread.Sleep(1400);File.WriteAllText(Path.Combine(root,"child-finished.txt"),"synthetic descendant completed");return 0;
        }
        if(mode=="delayed") {
            var start=new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,
                OwnedJob.QuoteArgument(root)+" "+OwnedJob.QuoteArgument("child"));
            start.UseShellExecute=false;start.CreateNoWindow=true;
            using(var child=Process.Start(start)) {
                for(int count=0;count<200&&!File.Exists(Path.Combine(root,"child-started.txt"));count++)Thread.Sleep(10);
                if(!File.Exists(Path.Combine(root,"child-started.txt")))return 5;
                File.WriteAllText(Path.Combine(root,"root-leaving.txt"),"descendant still working");
            }
            return 0;
        }
        if(mode=="hang") { Thread.Sleep(30000);return 0; }
        return 6;
    }
}
