function dir(children = {}) {
  return { type: "dir", children };
}

function file(content) {
  return { type: "file", content };
}

const virtualRoot = dir({
  home: dir({
    student: dir({
      "notes.txt": file(
        [
          "Ops lab reminder:",
          "- review backup retention policy",
          "- clear stale cache snapshots",
          "- sync weekly report draft"
        ].join("\n")
      ),
      projects: dir({
        "readme.txt": file(
          [
            "Northstar training workspace",
            "Current tasks:",
            "1. validate ticket tags",
            "2. archive old snapshots"
          ].join("\n")
        )
      }),
      ".cache": dir({
        logs: dir({
          ".backup": dir({
            ".data": file(
              [
                "system cache initialized",
                "log rotation completed",
                "audit note: CTF{linux_master}",
                "backup marker synced"
              ].join("\n")
            )
          })
        })
      })
    })
  }),
  var: dir({
    log: dir({
      "app.log": file(
        [
          "2026-03-16 08:20:01 INFO worker heartbeat ok",
          "2026-03-16 08:20:15 INFO queue size stable",
          "2026-03-16 08:20:44 INFO rotation policy active"
        ].join("\n")
      )
    })
  }),
  etc: dir({
    hostname: file("ctf-lab\n"),
    issue: file("Linux training environment for beginner filesystem investigation.\n")
  }),
  tmp: dir({})
});

const hiddenFlagFilePath = "/home/student/.cache/logs/.backup/.data";

function buildHiddenFlagFileContent(flagValue) {
  return [
    "system cache initialized",
    "log rotation completed",
    `audit note: ${flagValue}`,
    "backup marker synced"
  ].join("\n");
}

function createTerminalState() {
  return {
    cwd: "/home/student",
    commandHistory: [],
    dynamicFlag: null,
    dynamicFlagEnabled: false
  };
}

function tokenize(command) {
  const tokens = [];
  let current = "";
  let quote = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function toAbsolutePath(cwd, rawPath) {
  if (!rawPath || rawPath === ".") {
    return cwd;
  }

  let target = rawPath.trim();
  if (target.startsWith("~")) {
    target = target.replace(/^~/, "/home/student");
  }

  const segments = [];
  const source = target.startsWith("/") ? target : `${cwd}/${target}`;

  source.split("/").forEach((segment) => {
    if (!segment || segment === ".") {
      return;
    }
    if (segment === "..") {
      segments.pop();
      return;
    }
    segments.push(segment);
  });

  return `/${segments.join("/")}`;
}

function baseName(absolutePath) {
  if (absolutePath === "/") {
    return "/";
  }
  const parts = absolutePath.split("/").filter(Boolean);
  return parts[parts.length - 1] || "/";
}

function resolveNode(absolutePath) {
  if (absolutePath === "/") {
    return virtualRoot;
  }

  const segments = absolutePath.split("/").filter(Boolean);
  let current = virtualRoot;
  for (const segment of segments) {
    if (current.type !== "dir" || !current.children[segment]) {
      return null;
    }
    current = current.children[segment];
  }

  return current;
}

function getEffectiveFileContent(state, absolutePath, node) {
  if (!node || node.type !== "file") {
    return "";
  }

  const dynamicFlag = String(state && state.dynamicFlag ? state.dynamicFlag : "").trim();
  const dynamicFlagEnabled = Boolean(state && state.dynamicFlagEnabled);

  if (dynamicFlagEnabled && dynamicFlag && absolutePath === hiddenFlagFilePath) {
    return buildHiddenFlagFileContent(dynamicFlag);
  }

  return String(node.content || "");
}

function listChildren(node, showHidden) {
  const names = Object.keys(node.children).sort((a, b) => a.localeCompare(b));
  const visible = showHidden ? names : names.filter((name) => !name.startsWith("."));

  return visible.map((name) => {
    const child = node.children[name];
    return child.type === "dir" ? `${name}/` : name;
  });
}

function pathPatternToRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const wildcard = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${wildcard}$`);
}

function walk(nodePath, node, callback) {
  callback(nodePath, node);
  if (node.type !== "dir") {
    return;
  }

  Object.keys(node.children).forEach((name) => {
    const child = node.children[name];
    const childPath = nodePath === "/" ? `/${name}` : `${nodePath}/${name}`;
    walk(childPath, child, callback);
  });
}

function usage(command) {
  const usageMap = {
    ls: "Usage: ls [-a] [path]",
    cd: "Usage: cd [path]",
    cat: "Usage: cat <path>",
    find: "Usage: find [path] -name <pattern>",
    grep: "Usage: grep -r <term> <path>",
    echo: "Usage: echo <text>"
  };
  return [usageMap[command] || "Invalid command usage."];
}

function renderHelp() {
  return [
    "Available commands:",
    "help           Show this help message",
    "ls [-a] [path] List files or directories",
    "cd [path]      Change directory",
    "pwd            Print current directory",
    "cat <path>     Show file contents",
    "find [p] -name Search for file/directory names",
    "grep -r t p    Recursively search file contents",
    "clear          Clear terminal output",
    "history        Show entered commands",
    "whoami         Show current user",
    "echo <text>    Print text"
  ];
}

function executeLs(state, args) {
  let showHidden = false;
  let targetArg = null;

  for (const arg of args) {
    if (arg.startsWith("-")) {
      if (arg.includes("a")) {
        showHidden = true;
      }
      continue;
    }

    if (!targetArg) {
      targetArg = arg;
    } else {
      return { output: usage("ls") };
    }
  }

  const targetPath = toAbsolutePath(state.cwd, targetArg || state.cwd);
  const node = resolveNode(targetPath);
  if (!node) {
    return { output: [`ls: cannot access '${targetArg || targetPath}': No such file or directory`] };
  }

  if (node.type === "file") {
    return { output: [baseName(targetPath)] };
  }

  const entries = listChildren(node, showHidden);
  return { output: [entries.join("  ")] };
}

function executeCd(state, args) {
  const target = args[0] || "~";
  const nextPath = toAbsolutePath(state.cwd, target);
  const node = resolveNode(nextPath);

  if (!node) {
    return { output: [`cd: ${target}: No such file or directory`] };
  }
  if (node.type !== "dir") {
    return { output: [`cd: ${target}: Not a directory`] };
  }

  state.cwd = nextPath;
  return { output: [] };
}

function executeCat(state, args) {
  if (args.length !== 1) {
    return { output: usage("cat") };
  }

  const targetPath = toAbsolutePath(state.cwd, args[0]);
  const node = resolveNode(targetPath);
  if (!node) {
    return { output: [`cat: ${args[0]}: No such file or directory`] };
  }
  if (node.type !== "file") {
    return { output: [`cat: ${args[0]}: Is a directory`] };
  }

  const content = getEffectiveFileContent(state, targetPath, node);
  return { output: content.split(/\r?\n/) };
}

function executeFind(state, args) {
  const nameIndex = args.indexOf("-name");
  if (nameIndex === -1) {
    return { output: usage("find") };
  }

  if (nameIndex > 1) {
    return { output: usage("find") };
  }

  const startArg = nameIndex === 1 ? args[0] : state.cwd;
  const pattern = args[nameIndex + 1];
  if (!pattern) {
    return { output: usage("find") };
  }

  const startPath = toAbsolutePath(state.cwd, startArg);
  const startNode = resolveNode(startPath);
  if (!startNode) {
    return { output: [`find: '${startArg}': No such file or directory`] };
  }

  const matcher = pathPatternToRegex(pattern);
  const matches = [];

  walk(startPath, startNode, (candidatePath) => {
    if (matcher.test(baseName(candidatePath))) {
      matches.push(candidatePath);
    }
  });

  if (matches.length === 0) {
    return { output: ["find: no matches found"] };
  }

  return { output: matches };
}

function executeGrep(state, args) {
  if (args[0] !== "-r") {
    return { output: usage("grep") };
  }

  const term = args[1];
  const pathArg = args[2] || state.cwd;
  if (!term) {
    return { output: usage("grep") };
  }

  const startPath = toAbsolutePath(state.cwd, pathArg);
  const startNode = resolveNode(startPath);
  if (!startNode) {
    return { output: [`grep: ${pathArg}: No such file or directory`] };
  }

  const matches = [];
  walk(startPath, startNode, (candidatePath, node) => {
    if (node.type !== "file") {
      return;
    }

    const lines = getEffectiveFileContent(state, candidatePath, node).split(/\r?\n/);
    lines.forEach((line, lineIndex) => {
      if (line.includes(term)) {
        matches.push(`${candidatePath}:${lineIndex + 1}:${line}`);
      }
    });
  });

  if (matches.length === 0) {
    return { output: ["grep: no matches found"] };
  }

  return { output: matches };
}

function executeHistory(state) {
  if (!state.commandHistory.length) {
    return { output: ["(no commands yet)"] };
  }

  return {
    output: state.commandHistory.map((command, index) => `${index + 1}  ${command}`)
  };
}

function executeTerminalCommand(state, rawCommand) {
  const command = rawCommand.trim();
  if (!command) {
    return { output: [] };
  }

  const tokens = tokenize(command);
  if (tokens.length === 0) {
    return { output: [] };
  }

  const name = tokens[0].toLowerCase();
  const args = tokens.slice(1);

  switch (name) {
    case "help":
      return { output: renderHelp() };
    case "pwd":
      return { output: [state.cwd] };
    case "ls":
      return executeLs(state, args);
    case "cd":
      return executeCd(state, args);
    case "cat":
      return executeCat(state, args);
    case "find":
      return executeFind(state, args);
    case "grep":
      return executeGrep(state, args);
    case "clear":
      return { output: [], clear: true };
    case "history":
      return executeHistory(state);
    case "whoami":
      return { output: ["student"] };
    case "echo":
      return { output: [args.join(" ")] };
    default:
      return { output: ["Command not allowed in this training environment."] };
  }
}

function formatPromptPath(cwd) {
  if (cwd === "/home/student") {
    return "~";
  }
  if (cwd.startsWith("/home/student/")) {
    return `~${cwd.slice("/home/student".length)}`;
  }
  return cwd;
}

module.exports = {
  createTerminalState,
  executeTerminalCommand,
  formatPromptPath
};
