async function test() {
  for (const domain of ["vegamovies.ist", "vegamovies.nl", "vegamovies.gg", "vegamovies.to", "vegamovies.vip", "mkvcinemas.is", "hdhub4u.cat"]) {
    try {
      const res = await fetch(`https://${domain}/?s=reacher`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(3000)
      });
      console.log(domain, res.status);
    } catch (e) {
      console.log(domain, "failed:", e.message);
    }
  }
}
test();
