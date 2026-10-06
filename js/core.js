/* Cortado — core: shared state, helpers and the Supabase data layer (CD.store).
   Classic scripts sharing one namespace (window.CD). The UI reads from the in-memory CD.State cache;
   CD.store loads it from Supabase and performs all writes. */
window.CD = { actions:{}, forms:{}, changes:{}, ui:{ view:"home", menuOpen:false } };

(function(CD){
  "use strict";

  CD.TAGS = ["M&A","ECM","DCM","Leveraged Finance","Private Equity","Sales & Trading","Corporate Banking","Restructuring","Venture Capital","Recruiting / Breaking In","MBA Admissions","CV / Resume Review"];
  CD.MARKETS = ["USA","UK","DACH","Other"];
  CD.CURRENCY_SYMBOL = { USD:"$", EUR:"€", GBP:"£", CHF:"CHF " };
  /* Cortado earns from ads only: the full donation goes to the banker's chosen charity */

  /* session: null (visitor / signed in without a profile) or
     { id, name, email, roles:{student,banker}, activeRole, student:{university,market,tags}|null, bankerId|null, emailVerified, handle } */
  CD.State = { bankers: [], bookings: [], charities: [], reviews: [], session: null };
  var S = CD.State;

  /* ---------------- helpers ---------------- */
  CD.esc = function(str){
    return String(str==null?"":str).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  };

  CD.initials = function(name){
    var parts = String(name).trim().split(/\s+/);
    var a = parts[0] ? parts[0][0] : "";
    var b = parts.length>1 ? parts[parts.length-1][0] : "";
    return (a+b).toUpperCase();
  };

  CD.money = function(currency, amount){
    var a = Math.round(amount*100)/100;
    return (CD.CURRENCY_SYMBOL[currency] || "") + (a % 1 ? a.toFixed(2) : a);
  };
  CD.fmtPrice = function(b){ return CD.money(b.currency, b.price); };

  CD.fmtSlot = function(iso){
    var d = new Date(iso);
    return d.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" }) + " · " +
           d.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });
  };

  CD.toLocalInput = function(d){
    function p(n){ return n<10 ? "0"+n : ""+n; }
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes());
  };

  CD.findBanker = function(id){
    return S.bankers.filter(function(b){ return b.id===id; })[0] || null;
  };
  CD.hasRole = function(role){ return !!(S.session && S.session.roles && S.session.roles[role]); };
  CD.myBanker = function(){ return S.session && S.session.bankerId ? CD.findBanker(S.session.bankerId) : null; };

  /* inline SVG icon from the sprite in index.html */
  CD.icon = function(name){ return '<svg class="ic" aria-hidden="true"><use href="#i-'+name+'"/></svg>'; };

  CD.findCharity = function(id){
    return S.charities.filter(function(c){ return c.id===id; })[0] || null;
  };
  CD.reviewsFor = function(bankerId){
    return S.reviews.filter(function(r){ return r.bankerId===bankerId; });
  };

  /* "current" = works at a bank now; "former" = past experience, labelled as such */
  CD.typeOf = function(b){ return b.type === "former" ? "former" : "current"; };

  /* public headline of a profile — never the person's name */
  CD.headline = function(b){ return (CD.typeOf(b) === "former" ? "Former " : "") + b.role; };

  /* name + email of the other party. The database only fills these once the request is confirmed. */
  CD.counterpart = function(bk){
    return bk.status === "confirmed" && bk.counterpartName ? { name: bk.counterpartName, email: bk.counterpartEmail || "" } : null;
  };

  /* open = not booked and still in the future */
  CD.openSlots = function(b){
    var now = Date.now();
    return b.slots
      .filter(function(s){ return !s.taken && new Date(s.start).getTime() > now; })
      .sort(function(a,b2){ return new Date(a.start) - new Date(b2.start); });
  };

  /* readable message for errors coming back from Supabase */
  CD.errMsg = function(e){
    var m = (e && (e.message || e.error_description)) || String(e || "Something went wrong");
    if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
    if (/password should be|weak|pwned|leaked|different from the old/i.test(m)) return "Please choose a stronger password: at least 8 characters and not a common one.";
    if (/signups? not allowed|user not found/i.test(m)) return "No account found for this email. Use “Get started” to create one.";
    if (/token has expired|invalid/i.test(m) && /token|otp|code/i.test(m)) return "That code is invalid or has expired. Request a new one.";
    if (/rate limit|only request this after|too many/i.test(m)) return "Too many attempts. Please wait a minute and try again.";
    if (/failed to fetch|network|load failed/i.test(m)) return "Network error. Check your connection and try again.";
    return m;
  };

  /* ================================================================ data layer */
  var ROLE_PREF = "cortado_role_pref";
  function getPref(){ try { return localStorage.getItem(ROLE_PREF); } catch(e){ return null; } }
  function setPref(v){ try { localStorage.setItem(ROLE_PREF, v); } catch(e){} }

  var db = null;
  function client(){
    if (!db){
      var c = window.CD_CONFIG;
      db = window.supabase.createClient(c.supabaseUrl, c.supabaseKey, {
        auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:false }
      });
    }
    return db;
  }

  function mapBanker(r){
    return {
      id:r.id, userId:r.user_id, handle:r.handle, type:r.type, status:r.status,
      employer:r.employer, role:r.role, location:r.location, period:r.period || "", years:r.years,
      currency:r.currency, price:Number(r.price), duration:r.duration,
      tags:r.tags || [], languages:r.languages || [], bio:r.bio, response:r.response,
      rating: r.rating == null ? null : Number(r.rating), chats:r.chats || 0, charityId:r.charity_id,
      createdAt:new Date(r.created_at).getTime(),
      slots:(r.slots || []).map(function(s){ return { id:s.id, start:s.start_at, taken:s.taken }; })
    };
  }

  function mapBooking(r){
    return {
      id:r.id, bankerId:r.banker_id, slotId:r.slot_id, status:r.status, slotStart:r.slot_start,
      price:Number(r.price), currency:r.currency, duration:r.duration, message:r.message || "",
      createdAt:new Date(r.created_at).getTime(),
      bankerRole:r.banker_headline, bankerEmployer:r.banker_employer, bankerHandle:r.banker_handle,
      studentHandle:r.student_handle, studentName:r.student_name || "", university:r.student_university || "", studentMarket:r.student_market || "",
      viewerIsStudent:!!r.viewer_is_student, counterpartName:r.counterpart_name, counterpartEmail:r.counterpart_email,
      charityName:r.charity_name || "", reviewRating:r.review_rating == null ? null : Number(r.review_rating), reviewComment:r.review_comment || ""
    };
  }

  async function doLoad(){
    var c = client();
    var sess = (await c.auth.getSession()).data.session;
    CD.store.user = sess ? sess.user : null;
    var uid = CD.store.user && CD.store.user.id;

    /* RLS returns verified profiles for everyone, plus the caller's own (any status) */
    var br = await c.from("banker_profiles").select("*, slots(id,start_at,taken)").order("created_at", { ascending:false });
    if (br.error) throw br.error;
    S.bankers = br.data.map(mapBanker);

    var ch = await c.from("charities").select("*").order("sort");
    if (ch.error) throw ch.error;
    S.charities = ch.data;

    /* public and anonymous: who wrote a review is not readable */
    var rv = await c.from("reviews").select("banker_id,rating,comment,created_at").order("created_at", { ascending:false }).limit(500);
    if (rv.error) throw rv.error;
    S.reviews = rv.data.map(function(r){ return { bankerId:r.banker_id, rating:r.rating, comment:r.comment || "", createdAt:new Date(r.created_at).getTime() }; });

    S.session = null; S.bookings = []; CD.store.hasProfileRow = false;
    if (!uid) return;

    var pr = await c.from("profiles").select("*").eq("id", uid).maybeSingle();
    if (pr.error) throw pr.error;
    var prof = pr.data;
    if (!prof) return;                                   /* signed in, onboarding not finished */
    CD.store.hasProfileRow = true;

    var own = S.bankers.filter(function(b){ return b.userId === uid; })[0] || null;
    if (own){
      var pv = await c.from("banker_private").select("full_name").eq("banker_id", own.id).maybeSingle();
      if (pv.data) own.name = pv.data.full_name;
    }

    var roles = { student: !!prof.is_student, banker: !!(prof.is_banker && own) };
    if (!roles.student && !roles.banker) return;         /* profile row without a usable role: let onboarding finish it */

    var pref = getPref();
    S.session = {
      id: uid, name: prof.name, email: CD.store.user.email, handle: prof.handle, emailVerified: true,
      roles: roles,
      activeRole: (pref && roles[pref]) ? pref : (roles.student ? "student" : "banker"),
      student: prof.is_student ? { university: prof.university || "", market: prof.market || "", tags: prof.interest_tags || [] } : null,
      bankerId: own ? own.id : null
    };

    var bk = await c.from("my_bookings").select("*").order("created_at", { ascending:false });
    if (bk.error) throw bk.error;
    S.bookings = bk.data.map(mapBooking);
  }

  var loading = null;
  CD.store = {
    user: null,             /* Supabase auth user, or null */
    hasProfileRow: false,
    loadedAt: 0,

    /* (re)load everything the UI needs; concurrent calls share one request */
    load: function(){
      if (!loading){
        loading = doLoad().then(function(){ loading = null; CD.store.loadedAt = Date.now(); },
                                function(e){ loading = null; throw e; });
      }
      return loading;
    },

    /* the chosen Student/Banker view is a per-device preference, not account data */
    saveSession: function(){ if (S.session) setPref(S.session.activeRole); },

    /* ---- auth: email + password, email confirmed with a code ---- */
    signUp: async function(email, password){
      var r = await client().auth.signUp({ email: email, password: password });
      if (r.error) throw r.error;
      var u = r.data.user;
      /* for an already registered address Supabase answers with an empty identity list instead of an error */
      if (u && u.identities && u.identities.length === 0) throw new Error("An account with this email already exists. Please log in instead.");
      return { confirmed: !!r.data.session };       /* a session right away means email confirmation is switched off */
    },
    signIn: async function(email, password){
      var r = await client().auth.signInWithPassword({ email: email, password: password });
      if (r.error) throw r.error;
    },
    resendSignup: async function(email){
      var r = await client().auth.resend({ type: "signup", email: email });
      if (r.error) throw r.error;
    },
    verifyCode: async function(email, token, type){
      var r = await client().auth.verifyOtp({ email: email, token: token, type: type || "signup" });
      if (r.error) throw r.error;
    },
    sendReset: async function(email){
      var r = await client().auth.resetPasswordForEmail(email);
      if (r.error) throw r.error;
    },
    updatePassword: async function(password){
      var r = await client().auth.updateUser({ password: password });
      if (r.error) throw r.error;
    },
    signOut: async function(){
      await client().auth.signOut();
      CD.store.user = null; S.session = null; S.bookings = [];
    },

    /* ---- profile + banker listing ---- */
    saveProfile: async function(p){
      var c = client(), uid = CD.store.user.id;
      var r = CD.store.hasProfileRow
        ? await c.from("profiles").update(p).eq("id", uid)
        : await c.from("profiles").insert(Object.assign({ id: uid }, p));
      if (r.error) throw r.error;
      CD.store.hasProfileRow = true;
    },

    /* idempotent: reuses an existing own listing, so a retry after a partial failure does not break */
    createBanker: async function(row, priv, slotIsos){
      var c = client(), uid = CD.store.user.id;
      var own = S.bankers.filter(function(b){ return b.userId === uid; })[0];
      var id = own ? own.id : null;
      if (!id){
        var ins = await c.from("banker_profiles").insert(Object.assign({ user_id: uid }, row)).select("id").single();
        if (ins.error) throw ins.error;
        id = ins.data.id;
      }
      var pv = await c.from("banker_private").upsert(Object.assign({ banker_id: id }, priv));
      if (pv.error) throw pv.error;
      if (slotIsos.length){
        var sl = await c.from("slots").insert(slotIsos.map(function(iso){ return { banker_id: id, start_at: iso }; }));
        if (sl.error) throw sl.error;
      }
      return id;
    },

    addSlot: async function(bankerId, iso){
      var r = await client().from("slots").insert({ banker_id: bankerId, start_at: iso });
      if (r.error) throw r.error;
    },
    removeSlot: async function(id){
      var r = await client().from("slots").delete().eq("id", id);
      if (r.error) throw r.error;
    },
    setCharity: async function(bankerId, charityId){
      var r = await client().from("banker_profiles").update({ charity_id: charityId }).eq("id", bankerId);
      if (r.error) throw r.error;
    },

    /* ---- bookings (atomic, permission-checked in the database) ---- */
    requestBooking: async function(slotId, message){
      var r = await client().rpc("request_booking", { p_slot_id: slotId, p_message: message || "" });
      if (r.error) throw r.error;
    },
    setBookingStatus: async function(id, status){
      var r = await client().rpc("set_booking_status", { p_booking_id: id, p_status: status });
      if (r.error) throw r.error;
    },

    /* ---- reviews: the student of a confirmed chat rates it once, after it has taken place ---- */
    submitReview: async function(bookingId, rating, comment){
      var r = await client().rpc("submit_review", { p_booking_id: bookingId, p_rating: rating, p_comment: comment || "" });
      if (r.error) throw r.error;
    },

    /* ---- product analytics for validation (fire and forget) ---- */
    track: function(name, props){
      var uid = CD.store.user ? CD.store.user.id : null;
      client().from("events").insert({ user_id: uid, name: name, props: props || {} }).then(function(){}, function(){});
    }
  };
})(window.CD);
