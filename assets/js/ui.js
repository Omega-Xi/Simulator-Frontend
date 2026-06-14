function $(selector, root = document){ return root.querySelector(selector); }
function $all(selector, root = document){ return [...root.querySelectorAll(selector)]; }
function money(value){ return `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits:2, maximumFractionDigits:2 })}`; }
function numberFmt(value){ return Number(value || 0).toLocaleString("en-IN"); }
function qs(name){ return new URLSearchParams(window.location.search).get(name); }
function showToast(message, type = "info"){
  let root = document.querySelector(".toast-root");
  if(!root){ root = document.createElement("div"); root.className = "toast-root"; document.body.appendChild(root); }
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const icon = type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-exclamation" : "fa-circle-info";
  toast.innerHTML = `<i class="fas ${icon}" style="margin-right:8px"></i>${message}`;
  root.appendChild(toast);
  requestAnimationFrame(()=> toast.classList.add("show"));
  setTimeout(()=>{ toast.classList.remove("show"); setTimeout(()=>toast.remove(),250); }, 3200);
}
function setText(selector, value){ const el = $(selector); if(el) el.textContent = value; }
function setHTML(selector, value){ const el = $(selector); if(el) el.innerHTML = value; }
function bindLogout(){ $all("[data-logout]").forEach(btn => btn.addEventListener("click", signOut)); }
function activeNav(page){ $all(".nav-links a").forEach(a => { if(a.getAttribute("href") === page) a.classList.add("active"); }); }
async function loadAccountSafe(){
  const res = await apiFetch(`${base_url}/api/account/details`, { method:"GET", headers:{ "Content-Type":"application/json" } });
  if(!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}
