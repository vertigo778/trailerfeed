// Google Analytics via Google Tag Manager. Put your container ID (GTM-XXXXXXX) or a GA4
// measurement ID (G-XXXXXXXXXX) between the quotes; leave it empty to turn analytics off.
// It never runs on localhost or in Cloudflare preview builds.
(function () {
  var ID = "GTM-M7L9FHZ9";
  var host = location.hostname;
  if (!ID || host === "localhost" || host === "127.0.0.1" || /^[a-z0-9-]+-trailerfeed\./.test(host)) return;
  window.dataLayer = window.dataLayer || [];
  var s = document.createElement("script");
  s.async = true;
  if (/^GTM-/.test(ID)) {
    // Tag Manager: GA4 and any other tags are set up inside the GTM container.
    window.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
    s.src = "https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(ID);
  } else {
    // A GA4 measurement ID loads Google Analytics directly.
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", ID);
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ID);
  }
  document.head.appendChild(s);
})();
