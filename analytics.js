// Google Analytics 4 and Google Tag Manager. Leave an ID empty to turn that part off.
// GA4 is loaded directly here, so don't also add a GA4 tag inside Tag Manager (that would count
// every page view twice). Use Tag Manager for any other tags. Nothing runs on localhost or in
// Cloudflare preview builds.
(function () {
  var GA_ID = "G-KT1GPWNCYR";
  var GTM_ID = "GTM-M7L9FHZ9";
  var host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || /^[a-z0-9-]+-trailerfeed\./.test(host)) return;
  window.dataLayer = window.dataLayer || [];
  function load(src) {
    var s = document.createElement("script");
    s.async = true; s.src = src;
    document.head.appendChild(s);
  }
  if (GA_ID) {
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID);
    load("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID));
    // Count ticket and watch button clicks as "affiliate_click" (kind = tickets or watch), so GA4
    // shows which titles send people to Fandango and the streamers.
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a.btn-tickets, a.btn-watch");
      if (!a) return;
      var h1 = document.querySelector("h1");
      window.gtag("event", "affiliate_click", {
        link_kind: a.classList.contains("btn-tickets") ? "tickets" : "watch",
        link_text: a.textContent, link_url: a.href,
        item_name: (h1 && h1.childNodes[0] ? h1.childNodes[0].textContent : document.title).trim(),
        transport_type: "beacon"
      });
    });
  }
  if (GTM_ID) {
    window.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
    load("https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(GTM_ID));
  }
})();
