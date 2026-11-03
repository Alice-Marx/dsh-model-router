using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

internal static class RemoteCodexLauncher {
    private const string Node = @"__NODE__";
    private const string Fixture = @"__FIXTURE__";

    private static string Quote(string value) {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '"', '\\' }) < 0) return value;
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var ch in value) {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"') { result.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; }
            result.Append('\\', slashes).Append(ch); slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    public static int Main(string[] args) {
        var start = new ProcessStartInfo {
            FileName = Node,
            Arguments = Quote(Fixture) + (args.Length == 0 ? "" : " " + string.Join(" ", Array.ConvertAll(args, Quote))),
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        using (var process = Process.Start(start)) {
            process.OutputDataReceived += (_, eventArgs) => { if (eventArgs.Data != null) { Console.Out.WriteLine(eventArgs.Data); Console.Out.Flush(); } };
            process.ErrorDataReceived += (_, eventArgs) => { if (eventArgs.Data != null) { Console.Error.WriteLine(eventArgs.Data); Console.Error.Flush(); } };
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            var input = Task.Run(async () => {
                try {
                    string line;
                    while ((line = await Console.In.ReadLineAsync()) != null) {
                        await process.StandardInput.WriteLineAsync(line);
                        await process.StandardInput.FlushAsync();
                    }
                }
                finally { process.StandardInput.Close(); }
            });
            process.WaitForExit();
            // The stdin relay is blocked waiting for its parent while the
            // child has already exited. It must not delay the real exit code
            // until the supervisor mistakes this completed launcher for a live task.
            return process.ExitCode;
        }
    }
}
