#!/usr/bin/env node

// src/cli.ts
import { execSync as execSync2 } from "child_process";
import fs5 from "fs";
import path5 from "path";
import React4 from "react";
import { render } from "ink";
import Docker2 from "dockerode";

// src/config.ts
import fs2 from "fs";
import path2 from "path";

// src/log.ts
import fs from "fs";
import path from "path";
var RESET = "\x1B[0m";
var BOLD = "\x1B[1m";
var RED = "\x1B[31m";
var GREEN = "\x1B[32m";
var YELLOW = "\x1B[33m";
var CYAN = "\x1B[36m";
var BLUE = "\x1B[0;34m";
var logPhase = (msg) => {
  console.error(`
${BLUE}\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550${RESET}`);
  console.error(`${BLUE}  ${msg}${RESET}`);
  console.error(`${BLUE}\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550${RESET}
`);
};
var logStep = (msg) => console.error(`${CYAN}\u25B8 ${msg}${RESET}`);
var logOK = (msg) => console.error(`${GREEN}\u2713 ${msg}${RESET}`);
var logWarn = (msg) => console.error(`${YELLOW}\u26A0 ${msg}${RESET}`);
var logErr = (msg) => console.error(`${RED}\u2717 ${msg}${RESET}`);
function localTimestamp(fmt) {
  const d = /* @__PURE__ */ new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return fmt === "file" ? `${date}-${time}` : `${date} ${time.replace(/(..)(..)(..)/, "$1:$2:$3")}`;
}
function createSessionLog(projectRoot) {
  const logDir = path.join(projectRoot, ".cook", "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const ts = localTimestamp("file");
  const logPath = path.join(logDir, `${ts}.md`);
  fs.writeFileSync(logPath, "");
  return logPath;
}
function appendToLog(logFile, step, iteration, output) {
  const timestamp = localTimestamp("log");
  fs.appendFileSync(logFile, `## [${step} ${iteration}] ${timestamp}

${output}

---

`);
}

// src/config.ts
function loadConfig(projectRoot) {
  const configPath = path2.join(projectRoot, ".cook.config.json");
  const defaults = { network: { mode: "default", allowedHosts: [] }, env: [] };
  let raw;
  try {
    raw = fs2.readFileSync(configPath, "utf8");
  } catch {
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      network: { ...defaults.network, ...parsed.network },
      env: parsed.env ?? defaults.env
    };
  } catch (err) {
    logWarn(`Malformed .cook.config.json: ${err}`);
    return defaults;
  }
}

// src/template.ts
import fs3 from "fs";
import path3 from "path";
var DEFAULT_COOK_MD = `# COOK.md

## Project Instructions

[Edit this section with your project's conventions, coding standards, etc.]

## Agent Loop

Step: **\${step}** | Iteration: \${iteration}/\${maxIterations}

### Task
\${prompt}

\${lastMessage ? '### Previous Output\\n' + lastMessage : ''}

### History
Session log: \${logFile}
Read the session log for full context from previous steps.
`;
var cachedTemplateSrc = null;
var cachedTemplateFn = null;
function renderTemplate(cookMD, ctx) {
  const escaped = cookMD.replace(/`/g, "\\`").replace(/\$(?!\{)/g, "\\$");
  try {
    let fn;
    if (cachedTemplateSrc === escaped && cachedTemplateFn) {
      fn = cachedTemplateFn;
    } else {
      fn = new Function(
        ...Object.keys(ctx),
        `return \`${escaped}\``
      );
      cachedTemplateSrc = escaped;
      cachedTemplateFn = fn;
    }
    return fn(...Object.values(ctx));
  } catch (err) {
    throw new Error(
      `Template error in COOK.md: ${err instanceof SyntaxError ? err.message : err}
Hint: Backticks and bare $ are escaped automatically.
For a literal \${...} in output, use \\\${...} in COOK.md.`
    );
  }
}
function loadCookMD(projectRoot) {
  try {
    return fs3.readFileSync(path3.join(projectRoot, "COOK.md"), "utf8");
  } catch {
    return DEFAULT_COOK_MD;
  }
}

// src/sandbox.ts
import Docker from "dockerode";
import { pack } from "tar-stream";
import { PassThrough } from "stream";
import { createHash } from "crypto";
import { execSync } from "child_process";
import fs4 from "fs";
import path4 from "path";
import os from "os";

// src/line-buffer.ts
var LineBuffer = class {
  partial = "";
  push(chunk) {
    this.partial += chunk;
    const parts = this.partial.split("\n");
    this.partial = parts.pop();
    return parts;
  }
  flush() {
    if (this.partial) {
      const last = this.partial;
      this.partial = "";
      return [last];
    }
    return [];
  }
};

// src/sandbox.ts
var BASE_DOCKERFILE = `FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code
RUN apt-get update && apt-get install -y git iptables && rm -rf /var/lib/apt/lists/*
`;
var BASE_IMAGE_NAME = "cook-sandbox";
function createTarWithDockerfile(dockerfile) {
  const p = pack();
  p.entry({ name: "Dockerfile", size: Buffer.byteLength(dockerfile) }, dockerfile);
  p.finalize();
  return p;
}
function createTarWithFile(filename, data) {
  const p = pack();
  p.entry({ name: filename, size: data.length }, data);
  p.finalize();
  return p;
}
async function imageExists(docker, imageName) {
  try {
    await docker.getImage(imageName).inspect();
    return true;
  } catch {
    return false;
  }
}
async function containerExec(container, user, cmd) {
  const exec = await container.exec({
    Cmd: cmd,
    User: user,
    AttachStdout: true,
    AttachStderr: true
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  stream.resume();
  await new Promise((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  stream.destroy();
  const inspect = await exec.inspect();
  if (inspect.ExitCode !== 0) {
    throw new Error(`Setup command exited ${inspect.ExitCode}: ${cmd.join(" ")}`);
  }
}
async function ensureBaseImage(docker) {
  const exists = await imageExists(docker, BASE_IMAGE_NAME);
  if (exists) return;
  logStep("Building sandbox image (first run)...");
  await buildImage(docker, BASE_IMAGE_NAME, BASE_DOCKERFILE, false);
}
async function buildImage(docker, imageName, dockerfile, verbose) {
  const tarStream = createTarWithDockerfile(dockerfile);
  const stream = await docker.buildImage(tarStream, {
    t: imageName,
    rm: true
  });
  if (verbose) {
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve(), (event) => {
        if (event.stream) process.stderr.write(event.stream);
      });
    });
  } else {
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve());
    });
  }
  logOK(`Image ${imageName} built`);
}
function getProjectImageTag(projectRoot) {
  const dockerfilePath = path4.join(projectRoot, ".cook.Dockerfile");
  let data;
  try {
    data = fs4.readFileSync(dockerfilePath);
  } catch {
    return null;
  }
  const hash = createHash("sha256").update(data).digest("hex").slice(0, 12);
  const projectName = path4.basename(projectRoot);
  return {
    imageName: `cook-project-${projectName}:${hash}`,
    dockerfile: data.toString()
  };
}
async function cleanupStaleContainers(docker, projectRoot) {
  const containers = await docker.listContainers({ all: true });
  for (const info of containers) {
    if (info.Labels["cook.project"] !== projectRoot) continue;
    for (const name of info.Names) {
      if (name.startsWith("/cook-")) {
        const container = docker.getContainer(info.Id);
        await container.remove({ force: true }).catch(() => {
        });
      }
    }
  }
}
async function copyFileToContainer(container, hostPath, containerPath) {
  let data;
  try {
    data = fs4.readFileSync(hostPath);
  } catch {
    return;
  }
  const dir = path4.dirname(containerPath);
  const filename = path4.basename(containerPath);
  const tarStream = createTarWithFile(filename, data);
  await container.putArchive(tarStream, { path: dir });
}
async function copyAuthFiles(container, userSpec) {
  await containerExec(container, "root", ["mkdir", "-p", "/home/cook/.claude"]);
  const home = os.homedir();
  await copyFileToContainer(container, path4.join(home, ".claude.json"), "/home/cook/.claude.json");
  await copyFileToContainer(container, path4.join(home, ".claude", ".credentials.json"), "/home/cook/.claude/.credentials.json");
  await containerExec(container, "root", ["chown", "-R", userSpec, "/home/cook"]);
}
function gitConfig(key, fallback) {
  try {
    const out = execSync(`git config ${key}`, { encoding: "utf8" }).trim();
    return out || fallback;
  } catch {
    return fallback;
  }
}
function generateIptablesScript(allowedHosts) {
  const hosts = ["api.anthropic.com", ...allowedHosts];
  const hostList = hosts.join(" ");
  return `set -e
ALLOWED_IPS=""
for host in ${hostList}; do
    ips=$(getent hosts "$host" 2>/dev/null | awk '{print $1}' || true)
    ALLOWED_IPS="$ALLOWED_IPS $ips"
done
iptables -P OUTPUT DROP
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p udp -d 127.0.0.11 --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp -d 127.0.0.11 --dport 53 -j ACCEPT
for ip in $ALLOWED_IPS; do
    iptables -A OUTPUT -p tcp -d "$ip" --dport 443 -j ACCEPT
done`;
}
async function runClaude(container, docker, model, prompt, userSpec, env, workingDir, onLine) {
  const promptFile = `cook-prompt-${Date.now()}.txt`;
  const promptBuf = Buffer.from(prompt);
  const promptTar = createTarWithFile(promptFile, promptBuf);
  await container.putArchive(promptTar, { path: "/tmp" });
  const exec = await container.exec({
    Cmd: ["sh", "-c", `claude --model "$COOK_MODEL" --dangerously-skip-permissions -p < /tmp/${promptFile}; rc=$?; rm -f /tmp/${promptFile}; exit $rc`],
    Env: [...env, "HOME=/home/cook", `COOK_MODEL=${model}`],
    User: userSpec,
    WorkingDir: workingDir,
    AttachStdout: true,
    AttachStderr: true
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  docker.modem.demuxStream(stream, stdout, stderr);
  let output = "";
  const lineBuffer = new LineBuffer();
  stdout.on("data", (chunk) => {
    const text = chunk.toString();
    output += text;
    for (const line of lineBuffer.push(text)) {
      onLine(line);
    }
  });
  const stderrChunks = [];
  stderr.on("data", (chunk) => {
    stderrChunks.push(chunk);
  });
  await new Promise((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  stdout.destroy();
  stderr.destroy();
  stream.destroy();
  for (const line of lineBuffer.flush()) {
    onLine(line);
  }
  const inspect = await exec.inspect();
  if (inspect.ExitCode !== 0) {
    const stderrText = Buffer.concat(stderrChunks).toString();
    const err = new Error(`Claude exited ${inspect.ExitCode}: ${stderrText}`);
    err.stdout = output;
    throw err;
  }
  return output;
}
var Sandbox = class {
  constructor(docker, container, userSpec, env, projectRoot) {
    this.docker = docker;
    this.container = container;
    this.userSpec = userSpec;
    this.env = env;
    this.projectRoot = projectRoot;
  }
  async runClaude(model, prompt, onLine) {
    return runClaude(this.container, this.docker, model, prompt, this.userSpec, this.env, this.projectRoot, onLine);
  }
  async stop() {
    await this.container.remove({ force: true }).catch(() => {
    });
    logOK("Sandbox stopped");
  }
};
async function startSandbox(docker, projectRoot, config) {
  try {
    await docker.ping();
  } catch {
    console.error("Error: Docker daemon is not running. Start Docker and try again.");
    process.exit(1);
  }
  await cleanupStaleContainers(docker, projectRoot);
  await ensureBaseImage(docker);
  const projImage = getProjectImageTag(projectRoot);
  let imageName = BASE_IMAGE_NAME;
  if (projImage) {
    const exists = await imageExists(docker, projImage.imageName);
    if (!exists) {
      logStep("Building project-specific sandbox image...");
      await buildImage(docker, projImage.imageName, projImage.dockerfile, true);
    }
    imageName = projImage.imageName;
  }
  const uid = process.getuid().toString();
  const gid = process.getgid().toString();
  const userSpec = `${uid}:${gid}`;
  const gitName = gitConfig("user.name", "cook");
  const gitEmail = gitConfig("user.email", "cook@localhost");
  const env = [
    `GIT_AUTHOR_NAME=${gitName}`,
    `GIT_AUTHOR_EMAIL=${gitEmail}`,
    `GIT_COMMITTER_NAME=${gitName}`,
    `GIT_COMMITTER_EMAIL=${gitEmail}`
  ];
  for (const varName of config.env) {
    const val = process.env[varName];
    if (val !== void 0) env.push(`${varName}=${val}`);
  }
  const containerName = `cook-${process.pid}`;
  const container = await docker.createContainer({
    name: containerName,
    Image: imageName,
    Cmd: ["sleep", "infinity"],
    Labels: { "cook.project": projectRoot },
    HostConfig: {
      Binds: [`${projectRoot}:${projectRoot}`],
      CapAdd: config.network.mode === "restricted" ? ["NET_ADMIN"] : []
    }
  });
  try {
    await container.start();
  } catch (err) {
    await container.remove({ force: true }).catch(() => {
    });
    throw err;
  }
  const setupCmd = `groupadd -g ${gid} -o cookgroup 2>/dev/null || true; useradd -m -s /bin/bash -u ${uid} -g ${gid} -o cook 2>/dev/null || true`;
  await containerExec(container, "root", ["bash", "-c", setupCmd]);
  await copyAuthFiles(container, userSpec);
  if (config.network.mode === "restricted") {
    logStep("Applying network restrictions...");
    const script = generateIptablesScript(config.network.allowedHosts);
    await containerExec(container, "root", ["sh", "-c", script]);
    const allHosts = ["api.anthropic.com", ...config.network.allowedHosts];
    logOK(`Network restricted to: ${allHosts.join(", ")}`);
  }
  logOK(`Sandbox started (container: ${containerName})`);
  return new Sandbox(docker, container, userSpec, env, projectRoot);
}
async function rebuildBaseImage() {
  const docker = new Docker();
  logStep("Removing existing cook-sandbox image...");
  try {
    await docker.getImage(BASE_IMAGE_NAME).remove({ force: true });
  } catch {
  }
  logStep("Building cook-sandbox image...");
  await buildImage(docker, BASE_IMAGE_NAME, BASE_DOCKERFILE, false);
  logOK("Sandbox image rebuilt");
}

// src/loop.ts
import { EventEmitter } from "events";
var DONE_KEYWORDS = ["DONE", "PASS", "COMPLETE", "APPROVE", "ACCEPT"];
var ITERATE_KEYWORDS = ["ITERATE", "REVISE", "RETRY"];
function parseGateVerdict(output) {
  for (const line of output.split("\n")) {
    const upper = line.trim().toUpperCase();
    if (DONE_KEYWORDS.some((kw) => upper.startsWith(kw))) return "DONE";
    if (ITERATE_KEYWORDS.some((kw) => upper.startsWith(kw))) return "ITERATE";
  }
  return "ITERATE";
}
var loopEvents = new EventEmitter();
async function agentLoop(sandbox2, config, cookMD, events) {
  const logFile = createSessionLog(config.projectRoot);
  events.emit("logFile", logFile);
  let lastMessage = "";
  for (let i = 1; i <= config.maxIterations; i++) {
    const steps = [
      { name: "work", prompt: config.workPrompt },
      { name: "review", prompt: config.reviewPrompt },
      { name: "gate", prompt: config.gatePrompt }
    ];
    for (const step of steps) {
      events.emit("step", { step: step.name, iteration: i });
      let output;
      try {
        const prompt = renderTemplate(cookMD, {
          step: step.name,
          prompt: step.prompt,
          lastMessage,
          iteration: i,
          maxIterations: config.maxIterations,
          logFile
        });
        output = await sandbox2.runClaude(config.model, prompt, (line) => {
          events.emit("line", line);
        });
      } catch (err) {
        events.emit("error", `${step.name} step failed (iteration ${i}): ${err}`);
        return;
      }
      lastMessage = output;
      try {
        appendToLog(logFile, step.name, i, output);
      } catch (err) {
        console.error(`Warning: failed to write session log: ${err}`);
      }
    }
    const verdict = parseGateVerdict(lastMessage);
    if (verdict === "DONE") {
      logOK("Gate: DONE \u2014 loop complete");
      events.emit("done");
      return;
    }
    if (i < config.maxIterations) {
      logWarn(`Gate: ITERATE \u2014 continuing to iteration ${i + 1}`);
    }
  }
  logWarn(`Gate: max iterations (${config.maxIterations}) reached \u2014 stopping`);
  events.emit("done");
}

// src/ui/App.tsx
import { useState, useEffect } from "react";
import { Box as Box2, Text as Text3, useApp } from "ink";

// src/ui/LogStream.tsx
import "react";
import { Static, Text } from "ink";
import { jsx } from "react/jsx-runtime";
function LogStream({ lines }) {
  return /* @__PURE__ */ jsx(Static, { items: lines, children: (line, index) => /* @__PURE__ */ jsx(Text, { children: line }, index) });
}

// src/ui/StatusBar.tsx
import "react";
import { Box, Text as Text2, useStdout } from "ink";
import { jsx as jsx2 } from "react/jsx-runtime";
function formatElapsed(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}
function StatusBar({ step, iteration, maxIterations, model, elapsed, logFile, done }) {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const status = done ? "done" : `${step} ${iteration}/${maxIterations}`;
  const bar = `${status} | ${model} | ${formatElapsed(elapsed)} | ${logFile}`;
  return /* @__PURE__ */ jsx2(Box, { borderStyle: "single", width, children: /* @__PURE__ */ jsx2(Text2, { children: bar }) });
}

// src/ui/App.tsx
import { jsx as jsx3, jsxs } from "react/jsx-runtime";
function App({ maxIterations, model }) {
  const { exit } = useApp();
  const [state, setState] = useState({
    step: "starting",
    iteration: 1,
    maxIterations,
    model,
    startTime: Date.now(),
    logFile: "",
    logLines: [],
    done: false,
    error: null
  });
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const onLogFile = (logFile) => setState((s) => ({ ...s, logFile }));
    const onStep = ({ step, iteration }) => setState((s) => ({ ...s, step, iteration }));
    const onLine = (line) => setState((s) => ({ ...s, logLines: [...s.logLines, line] }));
    const onDone = () => setState((s) => ({ ...s, done: true }));
    const onError = (err) => setState((s) => ({ ...s, error: err }));
    loopEvents.on("logFile", onLogFile);
    loopEvents.on("step", onStep);
    loopEvents.on("line", onLine);
    loopEvents.on("done", onDone);
    loopEvents.on("error", onError);
    return () => {
      loopEvents.off("logFile", onLogFile);
      loopEvents.off("step", onStep);
      loopEvents.off("line", onLine);
      loopEvents.off("done", onDone);
      loopEvents.off("error", onError);
    };
  }, []);
  useEffect(() => {
    if (state.done || state.error) exit();
  }, [state.done, state.error, exit]);
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - state.startTime) / 1e3));
    }, 1e3);
    return () => clearInterval(timer);
  }, [state.startTime]);
  return /* @__PURE__ */ jsxs(Box2, { flexDirection: "column", height: "100%", children: [
    /* @__PURE__ */ jsx3(LogStream, { lines: state.logLines }),
    state.error && /* @__PURE__ */ jsx3(Box2, { marginTop: 1, children: /* @__PURE__ */ jsxs(Text3, { color: "red", bold: true, children: [
      "Error: ",
      state.error
    ] }) }),
    /* @__PURE__ */ jsx3(
      StatusBar,
      {
        step: state.step,
        iteration: state.iteration,
        maxIterations: state.maxIterations,
        model: state.model,
        elapsed,
        logFile: state.logFile,
        done: state.done
      }
    )
  ] });
}

// src/cli.ts
var DEFAULT_REVIEW_PROMPT = `Review the work done in the previous step.
Check the session log for what changed.
Identify issues categorized as High, Medium, or Low severity.`;
var DEFAULT_GATE_PROMPT = `Based on the review, respond with exactly DONE or ITERATE
on its own line, followed by a brief reason.

DONE if: the work is complete and no High severity issues remain.
ITERATE if: there are High severity issues or the work is incomplete.`;
var DEFAULT_COOK_CONFIG_JSON = `{
  "network": {
    "mode": "default",
    "allowedHosts": []
  },
  "env": []
}
`;
var DEFAULT_COOK_DOCKERFILE = `FROM cook-sandbox
# Add project-specific dependencies below.
# Examples:
#   RUN apt-get update && apt-get install -y python3 python3-pip
#   RUN npm install -g typescript
`;
var sandbox = null;
var inkInstance = null;
async function cleanup() {
  if (inkInstance) {
    inkInstance.unmount();
    inkInstance = null;
  }
  if (sandbox) {
    await sandbox.stop();
    sandbox = null;
  }
}
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(1);
});
process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(1);
});
function findProjectRoot() {
  try {
    return execSync2("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  } catch {
    console.error("Error: not inside a git repository. Run cook from within a git repo.");
    process.exit(1);
  }
}
function usage() {
  console.error(`${BOLD}cook${RESET} \u2014 sandboxed agent loop

${BOLD}Usage:${RESET}
  cook "work"                     Run the work\u2192review\u2192gate loop
  cook "work" "review" "gate"    Custom prompts for each step
  cook "work" 5                  Run with 5 max iterations
  cook "work" "review" "gate" 5  All custom prompts + iterations
  cook init                       Set up COOK.md, config, and Dockerfile
  cook rebuild                    Rebuild the sandbox Docker image

${BOLD}Options:${RESET}
  --work PROMPT                   Override work step prompt
  --review PROMPT                 Override review step prompt
  --gate PROMPT                   Override gate step prompt
  --max-iterations N              Max review iterations (default: 3)
  --model MODEL                   Claude model (default: opus)
  -h, --help                      Show this help`);
  process.exit(1);
}
function cmdInit(projectRoot) {
  logPhase("Initialize project for cook");
  const files = [
    { path: "COOK.md", content: DEFAULT_COOK_MD },
    { path: ".cook.config.json", content: DEFAULT_COOK_CONFIG_JSON },
    { path: ".cook.Dockerfile", content: DEFAULT_COOK_DOCKERFILE }
  ];
  for (const file of files) {
    const fullPath = path5.join(projectRoot, file.path);
    if (fs5.existsSync(fullPath)) {
      logOK(`${file.path} already exists`);
    } else {
      try {
        fs5.writeFileSync(fullPath, file.content);
        logOK(`${file.path} created`);
      } catch (err) {
        logErr(`Failed to create ${file.path}: ${err}`);
      }
    }
  }
  fs5.mkdirSync(path5.join(projectRoot, ".cook", "logs"), { recursive: true });
  logOK("Project initialized for cook");
  logStep(`Edit COOK.md to customize the agent loop prompts`);
  logStep(`Edit .cook.config.json to configure network restrictions and env vars`);
  logStep(`Edit .cook.Dockerfile to add project-specific dependencies`);
}
async function cmdRebuild() {
  logPhase("Rebuild sandbox image");
  await rebuildBaseImage();
}
function parseArgs(args2) {
  const VALUE_FLAGS = /* @__PURE__ */ new Set(["--work", "--review", "--gate", "--model", "--max-iterations"]);
  const flags = {};
  const positional = [];
  let i = 0;
  while (i < args2.length) {
    if (args2[i].startsWith("--")) {
      const flag = args2[i];
      if (flag.includes("=")) {
        const [key, ...rest] = flag.split("=");
        flags[key] = rest.join("=");
      } else if (VALUE_FLAGS.has(flag) && i + 1 < args2.length) {
        flags[flag] = args2[i + 1];
        i++;
      } else {
        flags[flag] = "true";
      }
    } else {
      positional.push(args2[i]);
    }
    i++;
  }
  let maxIterations = flags["--max-iterations"] ? parseInt(flags["--max-iterations"], 10) : 3;
  const prompts = [...positional];
  if (prompts.length > 1) {
    const last = prompts[prompts.length - 1];
    const n = parseInt(last, 10);
    if (!isNaN(n) && n.toString() === last) {
      maxIterations = n;
      prompts.pop();
    }
  }
  const workPrompt = flags["--work"] ?? prompts[0] ?? "";
  const reviewPrompt = flags["--review"] ?? prompts[1] ?? DEFAULT_REVIEW_PROMPT;
  const gatePrompt = flags["--gate"] ?? prompts[2] ?? DEFAULT_GATE_PROMPT;
  const model = flags["--model"] ?? "opus";
  return { workPrompt, reviewPrompt, gatePrompt, maxIterations, model };
}
async function runLoop(args2) {
  const projectRoot = findProjectRoot();
  const parsed = parseArgs(args2);
  if (!parsed.workPrompt) {
    usage();
  }
  const config = loadConfig(projectRoot);
  console.error(`${BOLD}cook${RESET} \u2014 agent loop`);
  console.error(`  Model:      ${parsed.model}`);
  console.error(`  Iterations: ${parsed.maxIterations}`);
  console.error(`  Project:    ${projectRoot}`);
  const docker = new Docker2();
  try {
    sandbox = await startSandbox(docker, projectRoot, config);
  } catch (err) {
    logErr(`Sandbox failed: ${err}`);
    process.exit(1);
  }
  try {
    const cookMD = loadCookMD(projectRoot);
    const { unmount, waitUntilExit } = render(
      React4.createElement(App, { maxIterations: parsed.maxIterations, model: parsed.model }),
      { exitOnCtrlC: false }
    );
    inkInstance = { unmount };
    await agentLoop(sandbox, {
      workPrompt: parsed.workPrompt,
      reviewPrompt: parsed.reviewPrompt,
      gatePrompt: parsed.gatePrompt,
      maxIterations: parsed.maxIterations,
      model: parsed.model,
      projectRoot
    }, cookMD, loopEvents);
    await waitUntilExit();
  } finally {
    await cleanup();
  }
}
var args = process.argv.slice(2);
var command = args[0];
async function main() {
  switch (command) {
    case "init":
      cmdInit(findProjectRoot());
      break;
    case "rebuild":
      await cmdRebuild();
      break;
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    case void 0:
      usage();
      break;
    default:
      await runLoop(args);
      break;
  }
}
main().catch((err) => {
  logErr(String(err));
  process.exit(1);
});
