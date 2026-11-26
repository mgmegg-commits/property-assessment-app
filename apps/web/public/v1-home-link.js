/*
 * Adds a "Follow-up" button to v1's home page, next to "Branding & settings".
 * v1's page is served unchanged; the server adds this one script to it.
 * v1 redraws its screens often, so the button is put back whenever it's gone.
 */
(() => {
  const add = () => {
    const branding = document.querySelector('.top .bar [data-act="openBranding"]');
    if (!branding || document.getElementById("crbFollowUp")) return;
    const link = document.createElement("a");
    link.id = "crbFollowUp";
    link.className = "btn ghost";
    link.href = "/follow-up";
    link.textContent = "Follow-up";
    branding.before(link);
  };
  new MutationObserver(add).observe(document.body, { childList: true, subtree: true });
  add();
})();
