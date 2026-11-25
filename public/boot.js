/* Basis boot (runs before first paint): theme, motion and language on <html>, so nothing flashes.
   Theme: ?theme=night|cotton, then localStorage "basis.theme", then prefers-color-scheme, then Night. */
(function () {
  var d = document.documentElement, q = new URLSearchParams(location.search), t = q.get("theme"), s = null;
  try { s = localStorage.getItem("basis.theme"); } catch (e) {}
  var norm = function (v) { return v === "cotton" || v === "light" ? "light" : v === "night" || v === "dark" ? "dark" : null; };
  var th = norm(t) || norm(s) || (window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  d.setAttribute("data-theme", th);
  var ms = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < ms.length; i++) ms[i].setAttribute("content", th === "light" ? "#F3F2EE" : "#0A0E1B");
  if (q.has("still")) d.classList.add("still");
  try { var ui = JSON.parse(localStorage.getItem("basis.ui") || "{}"); if (ui.motion === "reduce") d.classList.add("rm"); } catch (e) {}
  var l = null;
  try { l = localStorage.getItem("basis.lang"); } catch (e) {}
  if (l !== "en" && l !== "ru") l = ((navigator.languages && navigator.languages[0]) || navigator.language || "en").toLowerCase().indexOf("ru") === 0 ? "ru" : "en";
  d.lang = l;
})();
