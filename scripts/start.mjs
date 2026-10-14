import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const npmCommand = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npm";
const npmArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"];
const electronCommand = require("electron");

function run(command, args, env = process.env) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: "inherit",
            env,
        });
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
    });
}

const build = await run(npmCommand, npmArgs);
if (build.code !== 0) {
    process.exit(build.code ?? 1);
}

const electronEnv = { ...process.env };
delete electronEnv.ELECTRON_RUN_AS_NODE;

const app = await run(electronCommand, ["."], electronEnv);
if (app.signal) {
    process.kill(process.pid, app.signal);
}
process.exit(app.code ?? 1);
