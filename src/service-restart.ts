import { spawnSync } from "node:child_process";
import chalk from "chalk";

export function restartBridge(): void {
  if (process.platform === "darwin") {
    const uid = process.getuid?.();
    if (uid === undefined) {
      console.log(chalk.yellow("⚠ Could not identify the user for launchctl."));
      return;
    }
    const result = spawnSync("launchctl", ["kickstart", "-k", `gui/${uid}/com.agent-bridge`], { stdio: "inherit" });
    if (result.status === 0) console.log(chalk.green("✓ Service restarted."));
    else console.log(chalk.yellow("⚠ LaunchAgent did not restart. If it is not up yet: ./scripts/install.sh --launchd"));
    return;
  }
  if (process.platform === "linux") {
    const result = spawnSync("systemctl", ["--user", "restart", "agent-bridge"], { stdio: "inherit" });
    if (result.status === 0) console.log(chalk.green("✓ Service restarted."));
    else console.log(chalk.yellow("⚠ systemd did not restart. If it is not up yet: ./scripts/install.sh --systemd"));
    return;
  }
  console.log(chalk.yellow("⚠ There is no automatic restart on this system. Start it again with agent-bridge serve."));
}
