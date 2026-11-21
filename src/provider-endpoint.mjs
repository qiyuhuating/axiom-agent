export function providerEndpoint(value) {
  const url = typeof value === "string" ? URL.parse(value) : null;
  if (!url) throw Error("Invalid API endpoint");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error(
      "Provider endpoint requires HTTPS or loopback HTTP, without URL credentials, query or fragment",
    );
  return url;
}
