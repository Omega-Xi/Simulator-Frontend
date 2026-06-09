const host = "44.195.136.91"
const base_url = `https://${host}:7239`;
document.addEventListener("DOMContentLoaded",()=>{
    const form = document.querySelector("form");
    const nameInput = document.getElementById("name");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const confirmPasswordInput = document.getElementById("confirm-password");
    const marginEnabledInput = document.getElementById("marginenabled");
    const toggleBtn = document.getElementById("toggle");
    toggleBtn.addEventListener("click",()=>{
        const isHidden = passwordInput.type === "password";
        passwordInput.type = isHidden ? "text" : "password";
        confirmPasswordInput.type = isHidden ? "text" : "password";
        toggleBtn.textContent = isHidden ? "🙈" : "👁️"; // change icon
    });
    form.addEventListener("submit",async (e)=>{
        e.preventDefault();
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();
        const confirmPassword = confirmPasswordInput.value.trim();
        const marginEnabled = marginEnabledInput.checked;
        // Restric Password Format
        if(password.length < 8 || password.length >20){
            showToast("Password must be between 8 and 20 characters.");
            return;
        }
        const regex = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&]).+$/;
        if(!regex.test(password)){
            showToast("Password must include uppercase, lowercase, number and special characters.");
            return;
        }
        if (password!==confirmPassword){
            showToast("Passwords do not Match");
            return;
        }
        console.log(`Name:${name}\nEmail:${email}\nPassword:${password}\nConfirm:${confirmPassword}\nMargin:${marginEnabled}`);
        // sign up logic
        try{
            const response= await fetch(`${base_url}/api/account/signup`,{
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, email, password, marginEnabled }),
            });
            if (response.ok){
                const data = await response.json();
                const userId = data.USERID;
                showToast(`Signed Up With ID :${userId} Please verify your email before signin.`);
                setTimeout(()=>{ window.location.href = "signin.html";},3000)
            }
            else{
                const error = await response.text();
                console.log(error);
                showToast(error,"error");
            }
        }catch(err){
            console.error(err);
            showToast(err,"error")
        }
        form.reset();
    });
});
function showToast(message,type="info"){
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