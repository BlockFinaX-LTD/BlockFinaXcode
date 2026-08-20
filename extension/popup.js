const F = ["endpoint", "token", "intent", "auto"];
const el = id => document.getElementById(id);

chrome.storage.local.get(F, s => {
  el("endpoint").value = s.endpoint || "";
  el("token").value = s.token || "";
  el("intent").value = s.intent || "reply";
  el("auto").checked = !!s.auto;
});

el("save").addEventListener("click", () => {
  chrome.storage.local.set({
    endpoint: el("endpoint").value.trim(),
    token: el("token").value.trim(),
    intent: el("intent").value,
    auto: el("auto").checked,
  }, () => {
    el("saved").textContent = "Saved";
    setTimeout(() => (el("saved").textContent = ""), 1800);
  });
});
