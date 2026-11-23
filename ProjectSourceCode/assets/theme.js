// Appearance settings (Profile -> Settings -> Appearance), applied before the
// page draws so there's no flash of the wrong theme. Loaded as a plain script
// in every page's <head>, before style.css.
//   <html data-theme="light|dark">  (no attribute = follow the system)
//   <html data-text="large">
(function () {
  var theme = null;
  var large = false;
  try {
    theme = localStorage.getItem("pickup-theme");
    large = localStorage.getItem("pickup-text") === "large";
  } catch (err) {
    // Storage can be blocked (private windows); use the defaults.
  }
  var root = document.documentElement;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  if (large) root.setAttribute("data-text", "large");
})();
