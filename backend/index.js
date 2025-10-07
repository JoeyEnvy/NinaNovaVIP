import express from 'express';
for (const m of DB.members){
const t = m.tokens.find(x => x.token === token);
if (t) return { member: m, token: t };
}
return null;
}


// --- Health ---
app.get('/', (_,res)=>res.json({ ok:true }));


// --- Verify token (frontend calls this on /members.html) ---
app.get('/api/verify', (req,res)=>{
const token = String(req.query.token || '');
const hit = findByToken(token);
if (!hit) return res.json({ valid:false });
const { member, token: t } = hit;
const active = member.status === 'active' && (member.expiry || 0) > Date.now();
const valid = active && t.used === false && t.expires > Date.now();
return res.json({ valid });
});


// --- Resend link by email (no login needed) ---
app.post('/api/resend', async (req,res)=>{
const email = String(req.body.email || '').trim();
if (!email) return res.status(400).json({ ok:false, message:'Missing email' });
const member = DB.members.find(x => x.email.toLowerCase() === email.toLowerCase());
if (!member || member.status !== 'active' || (member.expiry||0) < Date.now()){
return res.json({ ok:false, message:'No active membership found' });
}
const { token } = makeToken(email, 7);
try{ await sendAccessEmail(email, token); return res.json({ ok:true }); }
catch(e){ console.error(e); return res.status(500).json({ ok:false, message:'Email failed' }); }
});


// --- Payment postback (simulate Epoch/CCBill). Replace mapping with real fields. ---
app.post('/api/postback', (req,res)=>{
// Example expected payload (map this to Epoch/CCBill real fields):
// { email, product: 'monthly'|'custom'|'vid001', action: 'signup'|'rebill'|'cancel' }
const { email, product, action } = req.body || {};
if (!email) return res.status(400).json({ ok:false });


let m = upsertMember(email);


if (product === 'monthly'){
if (action === 'signup' || action === 'rebill'){
m.status = 'active';
m.plan = 'monthly';
m.expiry = futureDays(30); // adjust to period from gateway
} else if (action === 'cancel'){
m.status = 'inactive';
}
} else {
// one-off purchase (custom video or single video id)
if (!m.purchases.includes(product)) m.purchases.push(product);
}


// Always create a fresh access token on successful signup/rebill/purchase
if (action === 'signup' || action === 'rebill' || action === 'purchase'){
const { token } = makeToken(email, 7);
sendAccessEmail(email, token).catch(console.error);
}


return res.json({ ok:true });
});


const port = process.env.PORT || 4000;
app.listen(port, ()=>console.log('NinaNovaVIP backend on', port));