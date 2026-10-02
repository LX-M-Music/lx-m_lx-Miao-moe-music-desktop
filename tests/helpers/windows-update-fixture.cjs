const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')

function compileProbe(directory, mode = 'confirm') {
  const source = path.join(directory, mode + '.cs')
  const executable = path.join(directory, mode + '.exe')
  fs.writeFileSync(source, `using System;
using System.IO;
using System.Diagnostics;
using System.Collections.Generic;
using System.Web.Script.Serialization;
class UpdateProbe {
  static void Main() {
    string root = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
    var json = new JavaScriptSerializer();
    var marker = new Dictionary<string, object>();
    marker["pid"] = Process.GetCurrentProcess().Id;
    marker["cwd"] = Directory.GetCurrentDirectory();
    marker["executable"] = Process.GetCurrentProcess().MainModule.FileName;
    marker["portable"] = Environment.GetEnvironmentVariable("PORTABLE_EXECUTABLE_FILE");
    marker["planFile"] = Environment.GetEnvironmentVariable("LX_M_UPDATE_CONFIRM");
    File.WriteAllText(Path.Combine(root, "started-${mode}.json"), json.Serialize(marker));
    if ("${mode}" == "fail") return;
    string planFile = Environment.GetEnvironmentVariable("LX_M_UPDATE_CONFIRM");
    if (planFile != null && "${mode}" != "old" && "${mode}" != "noack") {
      var plan = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(planFile));
      var ack = new Dictionary<string, object>();
      ack["nonce"] = "${mode}" == "badack" ? "invalid" : plan["nonce"];
      ack["version"] = plan["version"];
      File.WriteAllText(planFile + ".ack", json.Serialize(ack));
    }
    System.Threading.Thread.Sleep(5000);
  }
}`)
  const result = spawnSync(csc, ['/nologo', '/platform:x64', '/target:winexe', '/r:System.Web.Extensions.dll', '/out:' + executable, source], { windowsHide: true, encoding: 'utf8', timeout: 30000 })
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr)
  return executable
}

function safeRemove(root, prefix) {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
  assert(path.basename(root).startsWith(prefix))
  return fs.promises.rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
}

module.exports = { sha256, csc, compileProbe, safeRemove }
