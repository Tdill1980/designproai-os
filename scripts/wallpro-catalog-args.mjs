/**
 * THE RUNNER'S ARGUMENT PARSER, AS ITS OWN MODULE SO A TEST CAN EXECUTE IT.
 *
 * It lives here because of how it failed. The first dry run of the catalog
 * batch reached the droplet, resolved the runtime image, started the container
 * and then died on its own parser:
 *
 *     Error: Pass --email=<curator> (an admin/tester account).
 *
 * The parser accepted only `--email=value`; the workflow passes
 * `--email "value"`, the way every other probe in this repo passes arguments.
 * Twelve lock cases were green over it, because every one of them matched
 * STRINGS IN THE FILE and not one ever ran the parser against the argv the
 * workflow actually builds. That is the "a fixture laxer than the real thing
 * cannot catch a defect of the real thing" shape CLAUDE.md records five times.
 *
 * So both forms are accepted, and the lock executes this module against the
 * exact argument vector the workflow constructs.
 */

/** `--name value` and `--name=value` are the same argument. */
export function arg(argv, name, fallback = null) {
  const equals = argv.find(a => a.startsWith(`--${name}=`));
  if (equals) return equals.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  // A bare `--flag` followed by another flag is not a value.
  if (index >= 0 && index + 1 < argv.length && !argv[index + 1].startsWith('--')) return argv[index + 1];
  return fallback;
}

/** A valueless switch: present or absent, never `--flag false`. */
export function flag(argv, name) {
  return argv.includes(`--${name}`);
}
