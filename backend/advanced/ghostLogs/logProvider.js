"use strict";

const STATIC_FLAG = "CTF{ghost_log_reconstruction}";

function pad(n) {
    return String(n).padStart(2, "0");
}

function createSineRandom(startSeed) {
    let seed = Number(startSeed);
    if (!Number.isFinite(seed) || seed <= 0) {
        seed = 12345;
    }

    return function nextRandom() {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    };
}

const legacyRandom = createSineRandom(12345);

function randItem(arr, randomFn) {
    return arr[Math.floor(randomFn() * arr.length)];
}

function generateDate(baseTime, offsetMinutes, randomnessMinutes, randomFn) {
    return new Date(baseTime.getTime() + (offsetMinutes * 60000) + (randomFn() * randomnessMinutes * 60000));
}

function formatAccessLogDate(date) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${pad(date.getUTCDate())}/${months[date.getUTCMonth()]}/${date.getUTCFullYear()}:${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

function formatAuthLogDate(date) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[date.getUTCMonth()]} ${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function formatAppLogDate(date) {
    return date.toISOString().replace("Z", " +0000");
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
        fragment3: part3.split("").reverse().join(""),
        fragment4: Buffer.from(part4, "utf8").toString("hex")
    };
}

function deriveSeedFromText(text) {
    const normalized = String(text || "");
    let hash = 0;
    for (let index = 0; index < normalized.length; index += 1) {
        hash = ((hash * 31) + normalized.charCodeAt(index)) >>> 0;
    }
    return hash || 12345;
}

function buildDataset(flagValue, randomFn) {
    const baseTime = new Date("2026-10-15T10:00:00Z");

    const accessLog = [];
    const authLog = [];
    const auditLog = [];
    const appLog = [];

    const fakeIp = "198.51.100.77";
    const realIp = "203.0.113.42";
    const normalIps = ["10.0.0.5", "10.0.0.12", "192.168.1.100", "172.16.5.55"];

    for (let i = 0; i < 60; i += 1) {
        const t = generateDate(baseTime, i, 0.5, randomFn);
        accessLog.push(`${randItem(normalIps, randomFn)} - - [${formatAccessLogDate(t)}] "GET /index.html HTTP/1.1" 200 ${Math.floor(randomFn() * 5000)}`);
        if (randomFn() > 0.8) {
            authLog.push(`${formatAuthLogDate(new Date(t.getTime() + 120000))} server sshd[${Math.floor(randomFn() * 10000)}]: Accepted publickey for user from ${randItem(normalIps, randomFn)} port ${Math.floor(randomFn() * 60000)} ssh2`);
        }
    }

    for (let i = 0; i < 40; i += 1) {
        const t = generateDate(baseTime, 110 + (i * 0.5), 0.1, randomFn);
        accessLog.push(`${fakeIp} - - [${formatAccessLogDate(t)}] "GET /wp-login.php HTTP/1.1" 404 ${Math.floor(randomFn() * 500)}`);
        accessLog.push(`${fakeIp} - - [${formatAccessLogDate(t)}] "POST /admin.php HTTP/1.1" 403 234`);

        const authT = new Date(t.getTime() + 120000);
        authLog.push(`${formatAuthLogDate(authT)} server sshd[${Math.floor(randomFn() * 10000)}]: Failed password for root from ${fakeIp} port 33912 ssh2`);

        const auditT = new Date(t.getTime() - 180000);
        auditLog.push(`type=USER_ERR msg=audit(${auditT.getTime() / 1000}.000:334): op=login acct="root" exe="/usr/sbin/sshd" hostname=? addr=${fakeIp} terminal=ssh res=failed`);
    }

    const fragments = deriveFlagFragments(flagValue);
    const incTime = new Date("2026-10-15T12:00:00Z");

    const incTime1 = new Date(incTime.getTime() + 5000);
    accessLog.push(`${realIp} - - [${formatAccessLogDate(incTime1)}] "GET /api/system/backup?token=${fragments.fragment1} HTTP/1.1" 200 10244`);
    accessLog.push(`${realIp} - - [${formatAccessLogDate(new Date(incTime.getTime() + 6000))}] "GET /api/system/status HTTP/1.1" 200 45`);

    const incTime2 = new Date(incTime.getTime() + 10000);
    const authTime2 = new Date(incTime2.getTime() + 120000);
    authLog.push(`${formatAuthLogDate(authTime2)} server sshd[15002]: pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=${realIp}  user=admin msg=${fragments.fragment2}`);
    authLog.push(`${formatAuthLogDate(new Date(authTime2.getTime() + 1000))} server sshd[15002]: Connection closed by authenticated user admin ${realIp} port 49022 [preauth]`);

    const incTime3 = new Date(incTime.getTime() + 15000);
    const auditTime3 = new Date(incTime3.getTime() - 180000);
    auditLog.push(`type=EXECVE msg=audit(${auditTime3.getTime() / 1000}.123:555): argc=3 a0="bash" a1="-c" a2="echo ${fragments.fragment3} > /dev/null"`);
    auditLog.push(`type=SYSCALL msg=audit(${auditTime3.getTime() / 1000}.123:555): arch=c000003e syscall=59 success=yes exit=0 a0=1a2b3c a1=4d5e6f`);

    const incTime4 = new Date(incTime.getTime() + 20000);
    appLog.push(`[INFO] ${formatAppLogDate(new Date(incTime.getTime() - 50000))} - System health check passed.`);
    appLog.push(`[ERROR] ${formatAppLogDate(incTime4)} - Subsystem failure. Unable to parse metadata: ${fragments.fragment4} from ${realIp}`);
    appLog.push(`[WARN] ${formatAppLogDate(new Date(incTime.getTime() + 25000))} - Re-initializing parser module...`);

    accessLog.sort((a, b) => {
        const t1 = a.match(/\[(.*?)\]/)[1];
        const t2 = b.match(/\[(.*?)\]/)[1];
        return new Date(t1.replace(":", " ")).getTime() - new Date(t2.replace(":", " ")).getTime();
    });

    authLog.sort();

    auditLog.sort((a, b) => {
        const t1 = parseFloat(a.match(/audit\((.*?):/)[1]);
        const t2 = parseFloat(b.match(/audit\((.*?):/)[1]);
        return t1 - t2;
    });

    appLog.sort();

    return {
        "access.log": accessLog.join("\n") + "\n",
        "auth.log": authLog.join("\n") + "\n",
        "audit.log": auditLog.join("\n") + "\n",
        "app.log": appLog.join("\n") + "\n"
    };
}

function getDataset(options = {}) {
    const dynamicFlag = options && typeof options.flag === "string" ? options.flag.trim() : "";

    if (!dynamicFlag) {
        return buildDataset(STATIC_FLAG, legacyRandom);
    }

    const seededRandom = createSineRandom(deriveSeedFromText(dynamicFlag));
    return buildDataset(dynamicFlag, seededRandom);
}

module.exports = {
    STATIC_FLAG,
    getDataset
};
