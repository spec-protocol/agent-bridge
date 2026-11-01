import chalk from "chalk";
import figlet from "figlet";
import gradient from "gradient-string";
import stringWidth from "string-width";

const LOGO_TEXT = "BRIDGE";
const SUBTITLE = "agent-bridge — local MCP bridge";
const HINT = "Run 'agent-bridge --help' to see the commands";

function centerLine(text: string, width: number): string {
  const textWidth = stringWidth(text);
  if (textWidth >= width) return text;
  const pad = Math.max(0, Math.floor((width - textWidth) / 2));
  return " ".repeat(pad) + text;
}

function renderLogo(): string {
  try {
    return figlet.textSync(LOGO_TEXT, {
      font: "ANSI Shadow",
      horizontalLayout: "fitted",
    });
  } catch {
    return figlet.textSync(LOGO_TEXT, { font: "Standard" });
  }
}

export function printBanner(options?: { hint?: boolean }): void {
  const cols = process.stdout.columns || 80;
  const showHint = options?.hint !== false;

  console.log("");
  const rawLogo = renderLogo();
  const gradientFn = gradient(["#5B9BD5", "#9DC3E6", "#FFFFFF"]);
  for (const line of rawLogo.split("\n")) {
    console.log(centerLine(gradientFn(line), cols));
  }

  console.log("");
  console.log(centerLine(chalk.hex("#E8A838").italic(SUBTITLE), cols));

  if (showHint) {
    console.log("");
    console.log(centerLine(chalk.gray(HINT), cols));
    console.log("");
  }
}
