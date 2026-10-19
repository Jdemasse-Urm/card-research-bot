// PIN screen for devices on the home network.
"use strict";
    document.getElementById("f").onsubmit = async (e) => {
      e.preventDefault();
      const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: document.getElementById("pin").value }) });
      if (r.ok) location.reload();
      else document.getElementById("msg").textContent = (await r.json().catch(() => ({}))).error || "Wrong PIN — try again.";
    };
