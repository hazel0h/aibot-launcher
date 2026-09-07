const { execFileSync } = require('child_process');

const WSL_EXE = 'C:\\Windows\\System32\\wsl.exe';

function toWslPath(winPath) {
  // "D:\AIBOT\ClaudeAgents\Kine" -> "/mnt/d/AIBOT/ClaudeAgents/Kine"
  const drive = winPath[0].toLowerCase();
  const rest = winPath.slice(2).replace(/\\/g, '/');
  return `/mnt/${drive}${rest}`;
}

function detectWslHome() {
  try {
    return execFileSync(WSL_EXE, ['-e', 'bash', '-lc', 'echo $HOME'], { encoding: 'utf-8' }).trim();
  } catch (e) {
    return null;
  }
}

function wslPathExists(wslPath) {
  const safe = wslPath.replace(/'/g, `'\\''`);
  try {
    const out = execFileSync(WSL_EXE, ['-e', 'bash', '-lc', `test -d '${safe}' && ls -A '${safe}'`], {
      encoding: 'utf-8'
    });
    const files = out.split('\n').map((s) => s.trim()).filter(Boolean);
    return { exists: true, files };
  } catch (e) {
    return { exists: false, files: [] };
  }
}

function writeWslFile(dirPath, fileName, content) {
  const safeDir = dirPath.replace(/'/g, `'\\''`);
  const b64 = Buffer.from(content, 'utf-8').toString('base64');
  const script = `mkdir -p '${safeDir}' && echo '${b64}' | base64 -d > '${safeDir}/${fileName}' && chmod 600 '${safeDir}/${fileName}'`;
  execFileSync(WSL_EXE, ['-e', 'bash', '-lc', script]);
}

function readWslFile(dirPath, fileName) {
  const safePath = `${dirPath}/${fileName}`.replace(/'/g, `'\\''`);
  try {
    return execFileSync(WSL_EXE, ['-e', 'bash', '-lc', `cat '${safePath}'`], { encoding: 'utf-8' });
  } catch (e) {
    return null;
  }
}

module.exports = { WSL_EXE, toWslPath, detectWslHome, wslPathExists, writeWslFile, readWslFile };
