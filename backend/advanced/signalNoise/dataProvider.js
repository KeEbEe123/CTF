"use strict";

const STATIC_FLAG = "CTF{signal_vs_noise_master}";
const cacheByKey = new Map();

function createSineRandom(startSeed) {
    let seed = Number(startSeed);
    if (!Number.isFinite(seed) || seed <= 0) {
        seed = 444;
    }

    return function nextRandom() {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    };
}

function deriveSeedFromFlag(flagValue) {
    const normalized = String(flagValue || "");
    let hash = 0;
    for (let index = 0; index < normalized.length; index += 1) {
        hash = ((hash * 31) + normalized.charCodeAt(index)) >>> 0;
    }
    return (hash || 444) + 444;
}

function randItem(arr, randomFn) {
    return arr[Math.floor(randomFn() * arr.length)];
}

function iso(t) {
    return t.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function splitFlagIntoFourParts(flagValue) {
    const normalizedFlag = String(flagValue || "").trim() || STATIC_FLAG;
    const totalLength = normalizedFlag.length;
    const baseLength = Math.floor(totalLength / 4);
    const remainder = totalLength % 4;

    const parts = [];
    let cursor = 0;
    for (let index = 0; index < 4; index += 1) {
        const partLength = baseLength + (index < remainder ? 1 : 0);
        const nextCursor = cursor + partLength;
        parts.push(normalizedFlag.slice(cursor, nextCursor));
        cursor = nextCursor;
    }

    while (parts.length < 4) {
        parts.push("");
    }

    return parts;
}

function deriveFlagFragments(flagValue) {
    const [part1, part2, part3, part4] = splitFlagIntoFourParts(flagValue);
    return {
        fragment1: Buffer.from(part1, "utf8").toString("base64"),
        fragment2: Buffer.from(part2, "utf8").toString("hex"),
        fragment3: Buffer.from(part3, "utf8").toString("base64"),
        fragment4: Buffer.from(part4, "utf8").toString("hex")
    };
}

function buildDataset(flagValue, randomSeed) {
    const random = createSineRandom(randomSeed);
    const baseTime = new Date("2026-11-01T08:00:00Z");

    const alerts = [];
    const accessLog = [];
    const authLog = [];
    const processLog = [];

    const noisyIp = "185.15.54.22";
    const realIp = "10.0.5.55";
    const normalIps = ["192.168.1.10", "192.168.1.15", "10.0.5.12", "172.16.0.5"];

    for (let i = 0; i < 300; i += 1) {
        const t = new Date(baseTime.getTime() + (random() * 3600000 * 4));
        const type = Math.floor(random() * 3);

        if (type === 0) {
            alerts.push({
                id: `ALR-${1000 + i}`,
                timestamp: iso(t),
                severity: "CRITICAL",
                ruleName: "SQL Injection Detected",
                sourceIP: noisyIp,
                user: "unknown",
                endpoint: "/api/login",
                description: "Harmless perimeter probe: Multiple SQLi payloads detected in HTTP POST parameters."
            });
            accessLog.push(`${noisyIp} - - [${iso(t)}] "POST /api/login HTTP/1.1" 404 512`);
        } else if (type === 1) {
            alerts.push({
                id: `ALR-${1000 + i}`,
                timestamp: iso(t),
                severity: "HIGH",
                ruleName: "SSH Brute Force",
                sourceIP: noisyIp,
                user: "root",
                endpoint: "srv-gateway-01",
                description: "Excessive failed SSH login attempts. False positive proxy rotation."
            });
            authLog.push(`${iso(t)} srv-gateway-01 sshd: Failed password for root from ${noisyIp} port 44322 ssh2`);
        } else {
            const ip = randItem(normalIps, random);
            accessLog.push(`${ip} - - [${iso(t)}] "GET /dashboard HTTP/1.1" 200 1024`);
            processLog.push(`${iso(t)} host-app-01 systemd[1]: Started session ${Math.floor(random() * 100)} of user web.`);
        }
    }

    const fragments = deriveFlagFragments(flagValue);

    const t1 = new Date(baseTime.getTime() + 8100000);
    authLog.push(`${iso(t1)} srv-internal-05 sshd: Accepted password for service_acct from ${realIp} port 42211 ssh2. marker=${fragments.fragment2}`);
    alerts.push({
        id: "ALR-9001",
        timestamp: iso(t1),
        severity: "LOW",
        ruleName: "Successful Login Off-Hours",
        sourceIP: realIp,
        user: "service_acct",
        endpoint: "srv-internal-05",
        description: `User authenticated normally. Session parameter: ${fragments.fragment1}`
    });

    const t2False = new Date(t1.getTime() + 60000);
    processLog.push(`${iso(t2False)} srv-internal-05 CRON[2241]: (root) CMD (/usr/bin/security_check.sh)`);
    alerts.push({
        id: "ALR-9001_FALSE",
        timestamp: iso(t2False),
        severity: "CRITICAL",
        ruleName: "Suspicious Cron Job Executed",
        sourceIP: "local",
        user: "root",
        endpoint: "srv-internal-05",
        description: "Unexpected bash script executed by root crontab."
    });

    const t2 = new Date(t1.getTime() + 120000);
    processLog.push(`${iso(t2)} srv-internal-05 sudo: service_acct : TTY=pts/0 ; PWD=/tmp ; USER=root ; COMMAND=/usr/bin/python3 /opt/metrics/export.py --key ${fragments.fragment3}`);

    const t3 = new Date(t2.getTime() + 180000);
    accessLog.push(`${realIp} - service_acct [${iso(t3)}] "GET /api/v2/internal/bridge?token=${fragments.fragment4} HTTP/1.1" 200 15440`);
    alerts.push({
        id: "ALR-9003",
        timestamp: iso(t3),
        severity: "LOW",
        ruleName: "Internal Component Ping",
        sourceIP: realIp,
        user: "service_acct",
        endpoint: "api-gw-01",
        description: "Routine internal ping."
    });

    const t4 = new Date(t3.getTime() + 120000);
    accessLog.push(`${realIp} - service_acct [${iso(t4)}] "POST /api/v2/external/syncer HTTP/1.1" 200 8500244`);
    alerts.push({
        id: "ALR-9004",
        timestamp: iso(t4),
        severity: "LOW",
        ruleName: "Large Chunk Transfer",
        sourceIP: realIp,
        user: "service_acct",
        endpoint: "api-gw-01",
        description: "Standard daily synchronization output."
    });

    alerts.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const sortByIso = (a, b) => {
        const ta = a.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
        const tb = b.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
        if (!ta || !tb) return 0;
        return new Date(ta[0]).getTime() - new Date(tb[0]).getTime();
    };

    accessLog.sort(sortByIso);
    authLog.sort(sortByIso);
    processLog.sort(sortByIso);

    return {
        alerts,
        logs: {
            "access.log": accessLog.join("\n") + "\n",
            "auth.log": authLog.join("\n") + "\n",
            "process.log": processLog.join("\n") + "\n"
        }
    };
}

function generateData(options = {}) {
    const providedFlag = options && typeof options.flag === "string" ? options.flag.trim() : "";
    const resolvedFlag = providedFlag || STATIC_FLAG;
    const cacheKey = providedFlag ? `dyn:${resolvedFlag}` : "static";

    if (cacheByKey.has(cacheKey)) {
        return cacheByKey.get(cacheKey);
    }

    const seed = providedFlag ? deriveSeedFromFlag(resolvedFlag) : 444;
    const dataset = buildDataset(resolvedFlag, seed);
    cacheByKey.set(cacheKey, dataset);
    return dataset;
}

module.exports = {
    STATIC_FLAG,
    generateData
};
