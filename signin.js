const host = "44.195.136.91"
const base_url = `https://${host}:7239`;
document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("form");
  const passwordInput = document.getElementById("password");
  const toggle = document.getElementById("toggle");
  toggle.addEventListener("click",()=>{
    const isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    toggle.textContent = isHidden ? "🙈" : "👁️"; // change icon
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!email || !password) {
      showToast("Please fill in all fields.","error");
      return;
    }

    try {
      const response = await fetch(`${base_url}/api/account/signin?useCookie=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem("token", data.TOKEN);
        showToast("Sign-in successful!","success");
        form.reset();
        setTimeout(()=>{ window.location.href = "dashboard.html";},3000) // redirect
      } else {
        const error = await response.text();
        console.log(error);
        showToast(error,"error");
      }
    } catch (err) {
      console.error(err);
      showToast(err,"error");
    }
  });
});

function showToast(message,type){
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(()=> toast.classList.add("show"),50);
    setTimeout(()=>{
        toast.classList.remove("show");
        setTimeout(()=>toast.remove(),300);
    },3000);
}