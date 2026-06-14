document.addEventListener("DOMContentLoaded", () => {
  const emailInput = document.getElementById("email");
  emailInput.value = qs("email") || sessionStorage.getItem("pendingEmail") || "";
  async function postSimple(endpoint, success){
    const email = emailInput.value.trim(); if(!email){ showToast("Enter your email first.", "error"); return; }
    const res = await fetch(`${base_url}${endpoint}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ EMAIL:email }) });
    if(!res.ok) throw new Error(await readErrorMessage(res));
    showToast(success, "success");
  }
  $("#resendVerification").onclick = () => postSimple("/api/account/resend-verification", "Verification email requested.").catch(e=>showToast(e.message,"error"));
  $("#requestApproval").onclick = () => postSimple("/api/account/approval-request", "Approval request sent.").catch(e=>showToast(e.message,"error"));
});