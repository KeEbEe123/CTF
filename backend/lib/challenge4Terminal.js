const targetHost = "192.168.56.101";

const ftpRemoteFiles = {
  "readme.txt": [
    "Welcome to the backup server.",
    "",
    "Audit token: CTF{nmap_finds_truth}"
  ].join("\n"),
  "logs.txt": [
    "2026-03-16 07:10:31 ftp daemon started",
    "2026-03-16 07:11:08 anonymous login accepted",
    "2026-03-16 07:12:54 file sync check complete"
  ].join("\n"),
  "backup.zip": "[binary archive placeholder] backup package is not readable in this terminal."
};

const localBaseFiles = {
  "recon_notes.txt": [
    "Network audit checklist:",
    "- identify live host",
    "- enumerate open services",
    "- inspect exposed resources safely"
  ].join("\n")
};

function buildReadmeContent(flagValue) {
  return [
    "Welcome to the backup server.",
    "",
    `Audit token: ${flagValue}`
  ].join("\n");
}

function getRemoteFilesForState(state) {
  const dynamicFlag = String(state && state.dynamicFlag ? state.dynamicFlag : "").trim();
  const dynamicFlagEnabled = Boolean(state && state.dynamicFlagEnabled);

  if (!dynamicFlagEnabled || !dynamicFlag) {
    return ftpRemoteFiles;
  }

  return {
    ...ftpRemoteFiles,
    "readme.txt": buildReadmeContent(dynamicFlag)
  };
}

function createTerminalState() {
  return {
    commandHistory: [],
    ftp: {
      connected: false,
      host: null
    },
    localFiles: { ...localBaseFiles },
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

function formatPrompt(state) {
  if (state.ftp.connected) {
    return "ftp>";
  }
  return "kali@ctf-lab:~$";
}

function usage(command) {
  const usageMap = {
    nmap: "Usage: nmap -sV <target>",
    ftp: "Usage: ftp <target>",
    ls: "Usage: ls",
    get: "Usage: get <filename>",
    cat: "Usage: cat <filename>"
  };

  return [usageMap[command] || "Invalid command usage."];
}

function renderHelp() {
  return [
    "Available commands:",
    "help            Show this help message",
    "nmap -sV <ip>   Run a service version scan",
    "ftp <ip>        Connect to FTP service",
    "ls              List files",
    "get <file>      Download a file (FTP mode)",
    "cat <file>      Show file contents (local)",
    "clear           Clear terminal output",
    "history         Show command history",
    "whoami          Show active user"
  ];
}

function executeNmap(args) {
  const target = args.find((arg) => !arg.startsWith("-"));
  if (!target) {
    return { output: usage("nmap") };
  }

  if (target !== targetHost) {
    return {
      output: [
        "Starting Nmap 7.94 ( https://nmap.org )",
        `Nmap scan report for ${target}`,
        "Host seems down. If it is really up, try -Pn.",
        "Nmap done: 1 IP address (0 hosts up) scanned."
      ]
    };
  }

  return {
    output: [
      "Starting Nmap 7.94 ( https://nmap.org )",
      `Nmap scan report for ${targetHost}`,
      "Host is up (0.00052s latency).",
      "PORT   STATE SERVICE VERSION",
      "21/tcp open  ftp     vsftpd",
      "80/tcp open  http    Apache httpd",
      "Nmap done: 1 IP address (1 host up) scanned in 0.14 seconds"
    ]
  };
}

function executeFtp(state, args) {
  const host = args[0];
  if (!host) {
    return { output: usage("ftp") };
  }

  if (host !== targetHost) {
    return { output: [`ftp: connect to '${host}': Connection refused`] };
  }

  state.ftp.connected = true;
  state.ftp.host = host;

  return {
    output: [
      `Connected to ${targetHost}`,
      "Name: anonymous",
      "230 Login successful.",
      "Remote system type is UNIX.",
      "Using binary mode to transfer files."
    ]
  };
}

function executeLs(state) {
  if (state.ftp.connected) {
    const remoteFiles = getRemoteFilesForState(state);
    return { output: Object.keys(remoteFiles).sort((a, b) => a.localeCompare(b)) };
  }

  const names = Object.keys(state.localFiles).sort((a, b) => a.localeCompare(b));
  return { output: [names.join("  ")] };
}

function executeGet(state, args) {
  if (!state.ftp.connected) {
    return { output: ["get: not connected to any FTP server. Use 'ftp <target>' first."] };
  }

  const filename = args[0];
  if (!filename) {
    return { output: usage("get") };
  }

  const remoteFiles = getRemoteFilesForState(state);

  if (!Object.prototype.hasOwnProperty.call(remoteFiles, filename)) {
    return { output: [`550 Failed to open file ${filename}.`] };
  }

  state.localFiles[filename] = remoteFiles[filename];
  return {
    output: [`Downloading ${filename}...`, "Transfer complete."]
  };
}

function executeCat(state, args) {
  const filename = args[0];
  if (!filename) {
    return { output: usage("cat") };
  }

  if (Object.prototype.hasOwnProperty.call(state.localFiles, filename)) {
    return { output: state.localFiles[filename].split(/\r?\n/) };
  }

  const remoteFiles = getRemoteFilesForState(state);
  if (state.ftp.connected && Object.prototype.hasOwnProperty.call(remoteFiles, filename)) {
    return { output: [`cat: ${filename}: file not available locally. Use 'get ${filename}' first.`] };
  }

  return { output: [`cat: ${filename}: No such file or directory`] };
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
  if (!tokens.length) {
    return { output: [] };
  }

  const name = tokens[0].toLowerCase();
  const args = tokens.slice(1);

  switch (name) {
    case "help":
      return { output: renderHelp() };
    case "whoami":
      return { output: ["kali"] };
    case "nmap":
      return executeNmap(args);
    case "ftp":
      return executeFtp(state, args);
    case "ls":
      return executeLs(state);
    case "get":
      return executeGet(state, args);
    case "cat":
      return executeCat(state, args);
    case "history":
      return executeHistory(state);
    case "clear":
      return { output: [], clear: true };
    default:
      return { output: ["Command not allowed in this training environment."] };
  }
}

module.exports = {
  createTerminalState,
  executeTerminalCommand,
  formatPrompt,
  targetHost
};
