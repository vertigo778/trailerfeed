// Google Analytics 4. Paste your measurement ID (it looks like G-XXXXXXXXXX) between the quotes.
// Leave it empty to turn analytics off. It never runs on localhost or in Cloudflare preview builds.
(function () {
  var GA_ID = "";
  var host = location.hostname;
  if (!GA_ID || host === "localhost" || host === "127.0.0.1" || /^[a-z0-9-]+-trailerfeed\./.test(host)) return;
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", GA_ID, { anonymize_ip: true });
})();
