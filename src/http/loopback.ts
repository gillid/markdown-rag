import { isIP } from "node:net";

const OWN_NAMES = ["localhost", "127.0.0.1", "[::1]"];
const MAPPED_LOOPBACK = /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/;

// The URL parser gives IPv4 shorthand (`127.1`) and every IPv6 spelling (`0:0:0:0:0:0:0:1`) one canonical form.
function canonicalHost(host: string): string {
  const bare = host
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "");
  try {
    return new URL(`http://${isIP(bare) === 6 ? `[${bare}]` : bare}`).hostname;
  } catch {
    return bare;
  }
}

/** The `Host` names a server bound to `host` answers to if that is this machine, or undefined if it is reachable from elsewhere. */
export function loopbackNames(host: string): string[] | undefined {
  const name = canonicalHost(host);
  const isLoopback =
    name === "localhost" ||
    name === "[::1]" ||
    MAPPED_LOOPBACK.test(name) ||
    (isIP(name) === 4 && name.startsWith("127."));
  return isLoopback ? [...new Set([...OWN_NAMES, name])] : undefined;
}
