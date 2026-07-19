const WINDOWS_DRIVE = /^[a-zA-Z]:/;
const MAX_PATH_LENGTH = 512;

export class GroundPathError extends Error {
  override name = "GroundPathError";
}

export function normalizeProjectPath(input: string): string {
  if (!input || input.length > MAX_PATH_LENGTH) {
    throw new GroundPathError("Path must contain between 1 and 512 characters");
  }
  if (input.includes("\0") || input.includes("\\")) {
    throw new GroundPathError("Paths cannot contain NUL or backslashes");
  }
  if (input.startsWith("/") || WINDOWS_DRIVE.test(input)) {
    throw new GroundPathError("Paths must be relative");
  }

  const normalized = input.normalize("NFC");
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new GroundPathError("Paths cannot contain empty, dot, or traversal segments");
  }
  return segments.join("/");
}

export function isProjectPath(input: string): boolean {
  try {
    normalizeProjectPath(input);
    return true;
  } catch {
    return false;
  }
}
