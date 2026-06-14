// Telotrade shared API/auth helper
const TELO_HOST = window.TELOTRADE_API_HOST || "44.195.136.91";
const TELO_PORT = window.TELOTRADE_API_PORT || "7239";
const base_url = window.TELOTRADE_BASE_URL || `https://${TELO_HOST}:${TELO_PORT}`;
const ws_base_url = window.TELOTRADE_WS_URL || `wss://${TELO_HOST}:${TELO_PORT}/ws`;
let accessToken = sessionStorage.getItem("token") || null;
let refreshPromise = null;

function getAccessToken(){ return accessToken || sessionStorage.getItem("token"); }
function setAccessToken(token){ accessToken = token; if(token) sessionStorage.setItem("token", token); }
function clearAuth(){ accessToken = null; sessionStorage.removeItem("token"); localStorage.removeItem("token"); localStorage.removeItem("refreshToken"); }

async function readErrorMessage(response){
  const contentType = response.headers.get("content-type") || "";
  try{
    if(contentType.includes("application/json")){
      const data = await response.json();
      return data.MESSAGE || data.message || data.ERROR || data.error || (Array.isArray(data.ERRORS) ? data.ERRORS.join(", ") : JSON.stringify(data));
    }
    return await response.text();
  }catch{ return `HTTP ${response.status} - ${response.statusText}`; }
}

async function refreshAccessToken(){
  if(!refreshPromise){
    refreshPromise = fetch(`${base_url}/api/account/refresh?useCookie=true`, {
      method:"POST",
      credentials:"include"
    }).then(async res => {
      if(!res.ok) throw new Error(await readErrorMessage(res) || "Session expired");
      return res.json();
    }).then(data => {
      const token = data.TOKEN || data.token;
      if(!token) throw new Error("Refresh response did not include access token");
      setAccessToken(token);
      return token;
    }).finally(()=> refreshPromise = null);
  }
  return refreshPromise;
}

async function apiFetch(url, options = {}, retry = true){
  const token = getAccessToken();
  const headers = { ...(options.headers || {}) };
  if(token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { ...options, headers, credentials:"include" });
  if(response.status === 401 && retry){
    try{
      const newToken = await refreshAccessToken();
      return apiFetch(url, { ...options, headers:{ ...(options.headers || {}), Authorization:`Bearer ${newToken}` } }, false);
    }catch(err){ clearAuth(); throw err; }
  }
  return response;
}

async function ensureAuthenticated(redirect = true){
  if(getAccessToken()) return true;
  try{ await refreshAccessToken(); return true; }
  catch{ if(redirect) window.location.href = "signin.html"; return false; }
}

async function signOut(){
  try{ await apiFetch(`${base_url}/api/account/signout?useCookie=true`, { method:"POST" }, false); }
  finally{ clearAuth(); window.location.href = "signin.html"; }
}
