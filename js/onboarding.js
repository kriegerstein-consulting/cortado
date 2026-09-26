/* Cortado — onboarding, login and password reset.
   Sign up: role → you (name, email, password) → verify (code sent to the login email) → [student] → [banker1 → banker2 → banker3].
   Log in:  login (email + password); an unconfirmed account is sent to verify first.
   Reset:   forgot (email) → reset (code + new password).
   Accounts are Supabase Auth users; profile data lives in the database. */
(function(CD){
  "use strict";
  var S = CD.State, esc = CD.esc, A = CD.actions;
  var onb = null;

  function v(x){ return esc(x == null ? "" : x); }

  function steps(){
    if (onb.mode === "login") return onb.needVerify ? ["login", "verify"] : ["login"];
    if (onb.mode === "reset") return ["forgot", "reset"];
    var st = [];
    if (onb.askRole) st.push("role");
    if (onb.needAuth){ st.push("you"); if (!onb.confirmed) st.push("verify"); }
    else if (!S.session) st.push("you");               /* signed in, but no profile yet: only the name is missing */
    if (onb.roles.student) st.push("student");
    if (onb.roles.banker) st.push("banker1", "banker2", "banker3");
    return st;
  }

  function tagBoxes(selected){
    return CD.TAGS.map(function(t){
      return '<label class="checkbox"><input type="checkbox" name="tags" value="'+esc(t)+'"'+(selected.indexOf(t)!==-1 ? ' checked' : '')+'>'+esc(t)+'</label>';
    }).join('');
  }
  function checkedTags(f){
    return Array.prototype.map.call(f.querySelectorAll('input[name="tags"]:checked'), function(el){ return el.value; });
  }

  function isLast(){ var st = steps(); return st.indexOf(onb.step) === st.length - 1; }
  function actionsHtml(override, backLabel){
    var label = override || (isLast() ? (onb.roles.banker ? "Create my profile" : "Get started") : "Continue");
    return (onb.error ? '<p class="field-error" style="margin:0 0 12px;">'+esc(onb.error)+'</p>' : '')
      + '<div class="onb-actions"><button type="button" class="btn btn-ghost" data-action="onbBack">'+(backLabel || "Back")+'</button><button type="submit" class="btn btn-primary">'+label+'</button></div>';
  }

  /* ---------------- step templates ---------------- */
  function roleCard(role, icon, title, text){
    return '<button type="button" class="role-card'+(onb.roles[role] ? ' selected' : '')+'" data-action="toggleRole" data-role="'+role+'">'
      + '<span class="rc-check">'+CD.icon("check")+'</span><span class="rc-icon">'+CD.icon(icon)+'</span><h3>'+title+'</h3><p>'+text+'</p></button>';
  }

  function typeCard(type, title, text, selected){
    return '<button type="button" class="role-card'+(selected ? ' selected' : '')+'" data-action="setBankerType" data-type="'+type+'">'
      + '<span class="rc-check">'+CD.icon("check")+'</span><h3 style="font-size:16px;">'+title+'</h3><p>'+text+'</p></button>';
  }

  var VIEW = {
    role: function(){
      var none = !onb.roles.student && !onb.roles.banker;
      return '<span class="eyebrow">Welcome</span>'
        + '<h2>How will you use Cortado?</h2>'
        + '<p class="onb-sub">Pick one or both — you can add the other later.</p>'
        + '<div class="role-cards">'
          + roleCard("student", "cap", "I'm a student", "Browse verified bankers and request a 1:1 chat about the job, the recruiting process and interview prep.")
          + roleCard("banker", "briefcase", "I'm a banker", "Offer paid 30–60 minute chats on your own terms and keep 88% of every booking.")
        + '</div>'
        + '<div class="onb-actions"><button type="button" class="btn btn-primary" data-action="onbNext"'+(none ? ' disabled' : '')+'>Continue</button></div>'
        + '<p style="text-align:center; margin-top:14px;"><button type="button" class="link-btn" data-action="go" data-view="marketplace">Just looking around for now</button></p>'
        + '<p style="text-align:center; margin-top:4px; font-size:13.5px; color:var(--ink-soft);">Already have an account? <button type="button" class="link-btn" data-action="login">Log in</button></p>';
    },

    login: function(){
      return '<h2>Log in</h2><p class="onb-sub">Welcome back. Enter your email and password.</p>'
        + '<form class="card" data-form="onb">'
          + '<div class="field"><label for="fEmail">Email</label><input class="input" type="email" id="fEmail" name="email" required autocomplete="email" value="'+v(onb.data.email)+'" placeholder="you@example.com"></div>'
          + '<div class="field"><label for="fPw">Password</label><input class="input" type="password" id="fPw" name="password" required autocomplete="current-password">'
            + '<p class="hint"><button type="button" class="link-btn" data-action="forgot" style="padding:0;">Forgot your password?</button></p></div>'
          + actionsHtml("Log in", "Cancel")
        + '</form>'
        + '<p style="text-align:center; margin-top:16px; font-size:13.5px; color:var(--ink-soft);">New here? <button type="button" class="link-btn" data-action="start">Create an account</button></p>';
    },

    you: function(){
      var d = onb.data, signedIn = !onb.needAuth;
      return '<h2>First, who are you?</h2><p class="onb-sub">One account for everything. If you offer chats, your name stays private until you confirm a request.</p>'
        + '<form class="card" data-form="onb">'
          + '<div class="field"><label for="fFullName">Full name</label><input class="input" id="fFullName" name="fullName" required autocomplete="name" value="'+v(d.name)+'" placeholder="e.g. Jordan Weber"></div>'
          + '<div class="field"><label for="fEmail">Email</label><input class="input" type="email" id="fEmail" name="email" required autocomplete="email"'+(signedIn ? ' readonly' : '')+' value="'+v(d.email)+'" placeholder="you@example.com">'
            + '<p class="hint">'+(signedIn ? 'You are signed in with this address.' : 'We send a code to confirm this address. Use your university email if you have one. Bankers verify their employer separately with their work email.')+'</p></div>'
          + (signedIn ? '' : '<div class="field"><label for="fPw">Password</label><input class="input" type="password" id="fPw" name="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"><p class="hint">Use a password you do not use anywhere else.</p></div>')
          + actionsHtml()
        + '</form>';
    },

    verify: function(){
      var d = onb.data;
      return '<h2>Check your email</h2><p class="onb-sub">We sent a code to <strong>'+v(d.email)+'</strong>. Enter it below to confirm that this address is yours.</p>'
        + '<form class="card" data-form="onb">'
          + '<div class="field"><label for="fCode">Verification code</label>'
            + '<input class="input code-input" id="fCode" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" pattern="[0-9]{6,10}" required placeholder="Enter code">'
          + '</div>'
          + actionsHtml("Verify email")
          + '<p style="text-align:center; margin-top:14px;"><button type="button" class="link-btn" data-action="resendCode">Send a new code</button></p>'
        + '</form>';
    },

    forgot: function(){
      return '<h2>Reset your password</h2><p class="onb-sub">Enter your email and we will send you a code to set a new password.</p>'
        + '<form class="card" data-form="onb">'
          + '<div class="field"><label for="fEmail">Email</label><input class="input" type="email" id="fEmail" name="email" required autocomplete="email" value="'+v(onb.data.email)+'" placeholder="you@example.com"></div>'
          + actionsHtml("Send code", "Cancel")
        + '</form>';
    },

    reset: function(){
      return '<h2>Set a new password</h2><p class="onb-sub">We sent a code to <strong>'+v(onb.data.email)+'</strong>. Enter it together with your new password.</p>'
        + '<form class="card" data-form="onb">'
          + '<div class="field"><label for="fCode">Code</label><input class="input code-input" id="fCode" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" pattern="[0-9]{6,10}" required placeholder="Enter code"></div>'
          + '<div class="field"><label for="fPw">New password</label><input class="input" type="password" id="fPw" name="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></div>'
          + actionsHtml("Save password")
          + '<p style="text-align:center; margin-top:14px;"><button type="button" class="link-btn" data-action="resendCode">Send a new code</button></p>'
        + '</form>';
    },

    student: function(){
      var d = onb.data.student;
      return '<h2>What are you aiming for?</h2><p class="onb-sub">We use this to show the most relevant bankers first. Bankers see your name, university and target market when you request a chat. Your email is shared only if they confirm.</p>'
        + '<form class="card" data-form="onb">'
          + '<div class="field-row">'
            + '<div class="field"><label for="fUni">University</label><input class="input" id="fUni" name="university" required value="'+v(d.university)+'" placeholder="e.g. Frankfurt School"></div>'
            + '<div class="field"><label for="fMarket">Target market</label><select id="fMarket" name="market" required>'
              + '<option value="">Select…</option>'
              + CD.MARKETS.map(function(m){ return '<option value="'+esc(m)+'"'+(d.market===m?' selected':'')+'>'+esc(m)+'</option>'; }).join('')
            + '</select></div>'
          + '</div>'
          + '<fieldset><legend>Areas of interest (optional)</legend><div class="checkbox-grid">'+tagBoxes(d.tags)+'</div></fieldset>'
          + actionsHtml()
        + '</form>';
    },

    banker1: function(){
      var d = onb.data.banker, cur = d.type !== "former";
      return '<h2>About you</h2><p class="onb-sub">This is shown on your public profile. Your name and contact details are not — they are shared only once you confirm a request.</p>'
        + '<form class="card" data-form="onb">'
          + '<fieldset><legend>Do you currently work at a bank or firm?</legend><div class="role-cards" style="margin-bottom:0;">'
            + typeCard("current", "Yes, I work there now", "Current banker. Verified with a one-time code sent to your work email.", cur)
            + typeCard("former", "No, I have past experience", "Former employee, analyst or intern — e.g. 3 years in New York, now studying. Verified via your LinkedIn profile.", !cur)
          + '</div></fieldset>'
          + '<div class="field-row">'
            + '<div class="field"><label for="fEmployer">'+(cur ? 'Current employer' : 'Former employer')+'</label><input class="input" id="fEmployer" name="employer" required value="'+v(d.employer)+'" placeholder="'+(cur ? 'e.g. Goldman Sachs' : 'e.g. Deutsche Bank')+'"></div>'
            + '<div class="field"><label for="fRole">'+(cur ? 'Role / title' : 'Most recent role')+'</label><input class="input" id="fRole" name="role" required value="'+v(d.role)+'" placeholder="'+(cur ? 'e.g. Vice President, M&amp;A' : 'e.g. Analyst, Sales &amp; Trading')+'"></div>'
          + '</div>'
          + '<div class="field-row">'
            + '<div class="field"><label for="fLoc">'+(cur ? 'Location' : 'Where you worked')+'</label><input class="input" id="fLoc" name="location" required value="'+v(d.location)+'" placeholder="'+(cur ? 'e.g. London, UK' : 'e.g. New York, USA')+'"></div>'
            + '<div class="field"><label for="fYears">Years of experience</label><input class="input" type="number" min="0" max="50" id="fYears" name="years" required value="'+v(d.years)+'" placeholder="3"></div>'
          + '</div>'
          + (cur
              ? '<div class="field"><label for="fWorkMail">Work email</label><input class="input" type="email" id="fWorkMail" name="workEmail" required value="'+v(d.workEmail)+'" placeholder="you@yourbank.com"><p class="hint">Used only to verify your employer with a one-time code. Never shown publicly.</p></div>'
              : '<div class="field"><label for="fPeriod">Period</label><input class="input" id="fPeriod" name="period" required value="'+v(d.period)+'" placeholder="e.g. 2022–2025"><p class="hint">Shown on your profile so students know how recent your experience is.</p></div>')
          + '<div class="field"><label for="fLinkedin">LinkedIn URL'+(cur ? ' (optional)' : '')+'</label><input class="input" id="fLinkedin" name="linkedin"'+(cur ? '' : ' required')+' value="'+v(d.linkedin)+'" placeholder="linkedin.com/in/…">'+'<p class="hint">'+(cur ? 'Used only for verification.' : 'We check this manually before your profile goes live.')+' Never shown publicly.</p>'+'</div>'
          + actionsHtml()
        + '</form>';
    },

    banker2: function(){
      var d = onb.data.banker, min = CD.toLocalInput(new Date());
      return '<h2>Your offer</h2><p class="onb-sub">You set the price, length and exact time slots — nothing is booked without your say-so.</p>'
        + '<form class="card" data-form="onb">'
          + '<div class="field-row-3">'
            + '<div class="field"><label for="fDur">Session length</label><select id="fDur" name="duration">'
              + ["30","45","60"].map(function(m){ return '<option value="'+m+'"'+(d.duration===m?' selected':'')+'>'+m+' minutes</option>'; }).join('')
            + '</select></div>'
            + '<div class="field"><label for="fPrice">Price per session</label><div style="display:flex; gap:6px;">'
              + '<select name="currency" style="width:84px; flex:none;">'
                + [["USD","$"],["EUR","€"],["GBP","£"],["CHF","CHF"]].map(function(c){ return '<option value="'+c[0]+'"'+(d.currency===c[0]?' selected':'')+'>'+c[1]+'</option>'; }).join('')
              + '</select>'
              + '<input class="input" type="number" min="5" max="500" id="fPrice" name="price" required value="'+v(d.price)+'" placeholder="60">'
            + '</div><p class="hint">You keep 88%.</p></div>'
          + '</div>'
          + '<fieldset><legend>Areas of expertise (pick a few)</legend><div class="checkbox-grid">'+tagBoxes(d.tags)+'</div></fieldset>'
          + '<div class="field"><label for="fLang">Languages spoken</label><input class="input" id="fLang" name="languages" required value="'+v(d.languages)+'" placeholder="e.g. English, French"></div>'
          + '<div class="field"><label for="fBio">Short bio</label><textarea id="fBio" name="bio" required maxlength="320" placeholder="How you broke in, what you can help with, and who should book you.">'+v(d.bio)+'</textarea><p class="hint">Shown on your public profile. Max 320 characters. Please do not include your name or contact details.</p></div>'
          + '<fieldset><legend>Open time slots (1–3)</legend>'
            + '<div class="field"><input class="input" type="datetime-local" name="slot0" required min="'+min+'" value="'+v(d.slots[0])+'"></div>'
            + '<div class="field-row">'
              + '<input class="input" type="datetime-local" name="slot1" min="'+min+'" value="'+v(d.slots[1])+'">'
              + '<input class="input" type="datetime-local" name="slot2" min="'+min+'" value="'+v(d.slots[2])+'">'
            + '</div>'
          + '</fieldset>'
          + actionsHtml()
        + '</form>';
    },

    banker3: function(){
      var d = onb.data.banker, cur = d.type !== "former";
      return '<h2>Compliance &amp; verification</h2><p class="onb-sub">The last step before your profile can go live.</p>'
        + '<form class="card" data-form="onb">'
          + '<div class="side-note" style="margin-bottom:20px;"><h4>What happens next</h4><ul>'
            + (cur ? '<li>We verify your employer with a one-time code sent to your work email.</li>'
                   : '<li>We review your LinkedIn profile manually to verify your experience.</li>')
            + '<li>Once verified, your profile goes live and students can request your open slots.</li>'
            + (cur ? '' : '<li>Your profile is labelled <strong>Former</strong> so students know it is first-hand experience from past roles.</li>')
            + '<li>Your name and contact details stay private until you confirm a request.</li>'
            + '<li>Sessions are career and recruiting conversations only.</li>'
          + '</ul></div>'
          + '<div class="field"><label class="consent-box"><input type="checkbox" name="compliance" required'+(d.compliance?' checked':'')+'><span>'
            + (cur ? 'I confirm this profile complies with my employer\'s outside-activity / compliance policy, and that I will not share confidential, non-public, or client-specific information during sessions.'
                   : 'I confirm that I will not share confidential, non-public, or client-specific information from any current or former employer during sessions, and that this profile does not breach any NDA or other obligation I am bound by.')
            + '</span></label></div>'
          + actionsHtml()
        + '</form>';
    }
  };

  function readBanker1(f){
    var d = onb.data.banker, e = f.elements;
    d.employer = e["employer"].value.trim();
    d.role = e["role"].value.trim();
    d.location = e["location"].value.trim();
    d.years = e["years"].value;
    d.linkedin = e["linkedin"].value.trim();
    if (e["workEmail"]) d.workEmail = e["workEmail"].value.trim();
    if (e["period"]) d.period = e["period"].value.trim();
  }

  /* ---------------- saving each step ----------------
     Return true to continue, false to stay (after showing a message), or a string for a special outcome.
     May be async; thrown errors are shown inline. */
  var SAVE = {
    login: async function(f){
      var email = f.elements["email"].value.trim();
      onb.data.email = email;
      try {
        await CD.store.signIn(email, f.elements["password"].value);
      } catch (e) {
        if (e && /email not confirmed/i.test(e.message || "")){       /* registered but never confirmed: send a fresh code */
          await CD.store.resendSignup(email);
          onb.needVerify = true; onb.verifyType = "signup";
          return true;
        }
        throw e;
      }
      await CD.store.load();
      return S.session ? "done" : "onboard";
    },
    you: async function(f){
      onb.data.name = f.elements["fullName"].value.trim();
      onb.data.email = f.elements["email"].value.trim();
      if (onb.needAuth){
        var res = await CD.store.signUp(onb.data.email, f.elements["password"].value);
        onb.verifyType = "signup";
        if (res.confirmed){ onb.confirmed = true; await CD.store.load(); }   /* email confirmation switched off in the project */
      }
      return true;
    },
    verify: async function(f){
      await CD.store.verifyCode(onb.data.email, f.elements["code"].value.trim(), onb.verifyType || "signup");
      await CD.store.load();
      if (S.session) return "done";                       /* existing account: straight in */
      if (onb.mode === "login") return "onboard";        /* confirmed, but never finished signing up */
      return true;
    },
    forgot: async function(f){
      onb.data.email = f.elements["email"].value.trim();
      await CD.store.sendReset(onb.data.email);
      return true;
    },
    reset: async function(f){
      await CD.store.verifyCode(onb.data.email, f.elements["code"].value.trim(), "recovery");
      await CD.store.updatePassword(f.elements["password"].value);
      await CD.store.load();
      return S.session ? "done" : "onboard";
    },
    student: function(f){
      var d = onb.data.student;
      d.university = f.elements["university"].value.trim();
      d.market = f.elements["market"].value;
      d.tags = checkedTags(f);
      return true;
    },
    banker1: function(f){
      readBanker1(f);
      return true;
    },
    banker2: function(f){
      var d = onb.data.banker;
      d.duration = f.elements["duration"].value;
      d.currency = f.elements["currency"].value;
      d.price = f.elements["price"].value;
      d.tags = checkedTags(f);
      d.languages = f.elements["languages"].value.trim();
      d.bio = f.elements["bio"].value.trim();
      d.slots = [f.elements["slot0"].value, f.elements["slot1"].value, f.elements["slot2"].value];
      if (!d.tags.length){ CD.toast("Please select at least one area of expertise."); return false; }
      var named = onb.data.name.split(/\s+/).filter(function(part){ return part.length >= 3; }).some(function(part){
        return new RegExp("\\b" + part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(d.bio);
      });
      if (named){ CD.toast("Please remove your name from the bio — it is shared only after a confirmed request."); return false; }
      var now = Date.now();
      var bad = d.slots.some(function(s){ return s && new Date(s).getTime() <= now; });
      if (bad){ CD.toast("Time slots must be in the future."); return false; }
      return true;
    },
    banker3: function(f){
      onb.data.banker.compliance = f.elements["compliance"].checked;
      return onb.data.banker.compliance;
    }
  };

  /* ---------------- flow ---------------- */
  function render(){
    var body = document.getElementById("onbBody");
    var st = steps(), i = st.indexOf(onb.step);
    var head = "";
    if (onb.mode === "signup" && onb.step !== "role"){
      head = '<div class="step-count">Step '+(i+1)+' of '+st.length+'</div><div class="stepper">'
        + st.map(function(_, n){ return '<i'+(n <= i ? ' class="done"' : '')+'></i>'; }).join('') + '</div>';
    }
    body.innerHTML = head + VIEW[onb.step]();
  }

  function go(step){
    onb.step = step;
    onb.error = "";
    render();
    window.scrollTo(0, 0);
  }

  function move(delta){
    var st = steps(), i = st.indexOf(onb.step) + delta;
    if (i < 0){ onb = null; CD.showView("home"); return; }
    if (i >= st.length){ finish(); return; }
    go(st[i]);
  }

  function newOnb(mode, opts){
    var s = S.session;
    return {
      mode: mode,
      askRole: !(opts && opts.roles),
      needAuth: !CD.store.user,
      resume: (opts && opts.resume) || null,
      roles: { student:false, banker:false },
      step: null, error: "", busy: false, needVerify: false, confirmed: false, verifyType: "signup",
      data: {
        name: s ? s.name : "", email: s ? s.email : (CD.store.user ? CD.store.user.email : ""),
        student: { university:"", market:"", tags:[] },
        banker: { type:"current", period:"", employer:"", role:"", location:"", years:"", workEmail:"", linkedin:"", currency:"USD", price:"", duration:"30", tags:[], languages:"", bio:"", slots:["","",""], compliance:false }
      }
    };
  }

  CD.startOnboarding = function(opts){
    onb = newOnb("signup", opts);
    ((opts && opts.roles) || []).forEach(function(r){ onb.roles[r] = true; });
    onb.step = steps()[0];
    CD.ui.menuOpen = false;
    render();
    CD.showView("welcome");
  };

  CD.startLogin = function(){
    onb = newOnb("login", {});
    onb.step = "login";
    CD.ui.menuOpen = false;
    render();
    CD.showView("welcome");
  };

  function startReset(email){
    onb = newOnb("reset", {});
    onb.data.email = email || "";
    onb.step = "forgot";
    render();
    CD.showView("welcome");
  }

  /* signed in with a complete profile: continue where the user was heading */
  function enter(resume, message){
    onb = null;
    CD.toast(message);
    CD.renderNav();
    if (resume && resume.bankerId){
      CD.showView("marketplace");
      CD.openProfile(resume.bankerId);
      CD.pickSlot(resume.slotId);
    } else if (resume && resume.view){
      CD.showView(resume.view);
    } else {
      CD.showView("home");
    }
  }

  async function finish(){
    var d = onb.data, s = S.session, resume = onb.resume;
    onb.busy = true;
    var btn = document.querySelector('form[data-form="onb"] button[type="submit"]');
    if (btn){ btn.disabled = true; btn.textContent = "Creating…"; }

    try {
      var prev = s && s.student;
      var name = (s && s.name) || d.name;
      var st = d.student;
      await CD.store.saveProfile({
        name: name,
        is_student: !!(onb.roles.student || (s && s.roles.student)),
        is_banker: !!(onb.roles.banker || (s && s.roles.banker)),
        university: onb.roles.student ? st.university : (prev ? prev.university : null),
        market: (onb.roles.student ? st.market : (prev ? prev.market : "")) || null,
        interest_tags: onb.roles.student ? st.tags : (prev ? prev.tags : [])
      });

      if (onb.roles.banker){
        var bd = d.banker, former = bd.type === "former";
        await CD.store.createBanker({
          type: former ? "former" : "current",
          employer: bd.employer, role: bd.role, location: bd.location,
          period: former ? bd.period : null,
          years: Number(bd.years) || 0, currency: bd.currency, price: Number(bd.price) || 0, duration: Number(bd.duration),
          tags: bd.tags,
          languages: bd.languages.split(",").map(function(x){ return x.trim(); }).filter(Boolean),
          bio: bd.bio
        }, {
          full_name: name,
          work_email: former ? null : bd.workEmail,
          linkedin: bd.linkedin || null
        }, bd.slots.filter(Boolean).map(function(x){ return new Date(x).toISOString(); }));
      }
      await CD.store.load();
    } catch (err) {
      onb.busy = false;
      onb.error = CD.errMsg(err);
      CD.store.load().catch(function(){});               /* pick up whatever was saved before the failure */
      render();
      return;
    }

    var toBanker = !onb.roles.student || !!(resume && resume.view === "dashboard");
    if (S.session){
      S.session.activeRole = toBanker && S.session.roles.banker ? "banker" : "student";
      if (!S.session.roles[S.session.activeRole]) S.session.activeRole = S.session.roles.student ? "student" : "banker";
      CD.store.saveSession();
    }
    CD.store.track("signup_completed", { student: !!onb.roles.student, banker: !!onb.roles.banker });
    var first = ((S.session && S.session.name) || name || "").split(" ")[0];
    enter(resume || { view: toBanker ? "dashboard" : "marketplace" }, toBanker ? "Profile created — verification pending." : "You're all set, " + first + ".");
  }

  CD.forms.onb = function(f){
    if (!onb || onb.busy) return;
    var step = onb.step, btn = f.querySelector('button[type="submit"]');
    var label = btn ? btn.textContent : "";
    function restore(){ if (btn){ btn.disabled = false; btn.textContent = label; } }
    onb.busy = true;
    if (btn){ btn.disabled = true; btn.textContent = "Please wait…"; }

    Promise.resolve().then(function(){ return SAVE[step](f); }).then(function(res){
      onb.busy = false;
      if (res === "done"){
        enter(onb.resume, onb.mode === "reset" ? "Password updated." : "Welcome back.");
      } else if (res === "onboard"){
        onb.mode = "signup"; onb.askRole = true; onb.needAuth = false; onb.confirmed = true;
        go("role");
      } else if (res){
        onb.error = "";
        move(1);
      } else {
        restore();
      }
    }, function(err){
      onb.busy = false;
      onb.error = CD.errMsg(err);
      render();
    });
  };

  A.toggleRole = function(el){
    if (!onb) return;
    var r = el.getAttribute("data-role");
    onb.roles[r] = !onb.roles[r];
    render();
  };
  A.setBankerType = function(el){
    if (!onb) return;
    var f = document.querySelector('form[data-form="onb"]');
    if (f) readBanker1(f);
    onb.data.banker.type = el.getAttribute("data-type");
    render();
  };
  A.resendCode = function(){
    if (!onb) return;
    var email = onb.data.email;
    var send = onb.mode === "reset" ? CD.store.sendReset(email) : CD.store.resendSignup(email);
    send.then(function(){
      onb.error = "";
      CD.toast("New code sent to " + email + ".");
    }, function(err){
      onb.error = CD.errMsg(err);
      render();
    });
  };
  A.forgot = function(){
    var f = document.querySelector('form[data-form="onb"]');
    startReset(f && f.elements["email"] ? f.elements["email"].value.trim() : "");
  };
  A.onbNext = function(){
    if (onb && (onb.roles.student || onb.roles.banker)) move(1);
  };
  A.onbBack = function(){ if (onb) move(-1); };
})(window.CD);
