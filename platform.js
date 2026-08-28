/**
 * ItalPont shared Web + Android + iPhone platform helper.
 * The application itself remains one shared HTML/CSS/JS codebase.
 */
(() => {
  const isNative = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function"
    ? window.Capacitor.isNativePlatform()
    : window.Capacitor?.isNative);

  const platform = window.Capacitor?.getPlatform?.() || (isNative ? "android" : "web");

  window.ItalPontPlatform = {
    isNative,
    platform,
    isAndroid: platform === "android",
    isIOS: platform === "ios",
    isWeb: platform === "web"
  };

  document.documentElement.dataset.platform = platform;
  if (isNative) document.documentElement.classList.add("native-app");
})();
