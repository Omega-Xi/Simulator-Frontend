document.addEventListener("DOMContentLoaded", async () => {
  const launch = document.getElementById("launchBtn");
  launch.addEventListener("click", async () => {
    const ok = await ensureAuthenticated(false);
    if(ok){ window.location.href = "dashboard.html"; return; }
    showToast("Please sign in before launching the trading terminal.", "error");
    setTimeout(()=> window.location.href = "signin.html", 700);
  });
  setInterval(()=>{ const el = document.getElementById("uptimeStat"); if(el) el.textContent = `${(99.97 + Math.random()*0.029).toFixed(2)}%`; }, 5000);
});