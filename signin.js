document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("signinForm");
  const passwordInput = document.getElementById("password");
  document.getElementById("toggle").addEventListener("click", () => {
    const hidden = passwordInput.type === "password";
    passwordInput.type = hidden ? "text" : "password";
    document.getElementById("toggle").textContent = hidden ? "🙈" : "👁️";
  });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = passwordInput.value;
    if(!email || !password){ showToast("Please fill in all fields.", "error"); return; }
    const btn = form.querySelector("button[type='submit']"); btn.disabled = true; btn.textContent = "Signing in...";
    try{
      const res = await fetch(`${base_url}/api/account/signin?useCookie=true`, { method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ EMAIL:email, PASSWORD:password }) });
      if(!res.ok) throw new Error(await readErrorMessage(res));
      const data = await res.json();
      setAccessToken(data.TOKEN || data.token);
      showToast("Sign-in successful.", "success");
      setTimeout(()=> window.location.href = "dashboard.html", 600);
    }catch(err){ showToast(err.message || "Sign-in failed.", "error"); }
    finally{ btn.disabled=false; btn.textContent="Sign In"; }
  });
});