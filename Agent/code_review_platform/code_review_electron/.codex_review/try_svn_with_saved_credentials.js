const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const credPath = '/Users/chenghao/Library/Application Support/code-review-electron/remembered-credentials.bin';
const url = 'https://192.168.0.233/svn/src_power/智能电源/PCB_30257AV251/SST23-0257A-VXXX@3493';
const failures = 'unknown-ca,cn-mismatch,expired,not-yet-valid,other';

function runSvn(args, password) {
  const result = spawnSync('svn', args, {
    input: password + '\n',
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1024 * 1024
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error ? result.error.message : ''
  };
}

try {
  const encrypted = fs.readFileSync(credPath);
  const raw = safeStorage.decryptString(encrypted);
  const parsed = JSON.parse(raw);
  const username = parsed.svn_username;
  const password = parsed.svn_password;
  if (!username || !password) {
    console.log('NO_SVN_CREDENTIAL');
    app.quit();
    return;
  }
  const common = [
    '--username', username,
    '--password-from-stdin',
    '--no-auth-cache',
    '--non-interactive',
    '--trust-server-cert-failures=' + failures
  ];
  const info = runSvn(['info', '-r', '3493', ...common, url], password);
  console.log(JSON.stringify({
    step: 'info_with_saved_credentials',
    status: info.status,
    signal: info.signal,
    stdout: info.stdout.slice(0, 2000),
    stderr: info.stderr.slice(0, 2000),
    error: info.error
  }, null, 2));
  if (info.status === 0) {
    const log = runSvn(['log', '-v', '-r', '3493', ...common, url], password);
    console.log(JSON.stringify({
      step: 'log_with_saved_credentials',
      status: log.status,
      signal: log.signal,
      stdout: log.stdout.slice(0, 4000),
      stderr: log.stderr.slice(0, 2000),
      error: log.error
    }, null, 2));
  }
} catch (error) {
  console.log(JSON.stringify({ step: 'credential_or_svn_attempt', error: error && error.message ? error.message : String(error) }, null, 2));
} finally {
  app.quit();
}
