document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("signupForm");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const payload = { NAME:$("#name").value.trim(), EMAIL:$("#email").value.trim(), PASSWORD:$("#password").value, MARGINENABLED:$("#margin").checked };
    if(!payload.NAME || !payload.EMAIL || !payload.PASSWORD){ showToast("Please complete all fields.", "error"); return; }
    const btn = form.querySelector("button[type='submit']"); btn.disabled=true; btn.textContent="Creating...";
    try{
      const res = await fetch(`${base_url}/api/account/signup`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
      if(!res.ok) throw new Error(await readErrorMessage(res));
      sessionStorage.setItem("pendingEmail", payload.EMAIL);
      showToast("Account created. Check your email and wait for approval.", "success");
      setTimeout(()=> window.location.href = `pending-approval.html?email=${encodeURIComponent(payload.EMAIL)}`, 900);
    }catch(err){ showToast(err.message || "Signup failed.", "error"); }
    finally{ btn.disabled=false; btn.textContent="Create Account"; }
  });
});