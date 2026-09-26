/* Cortado — marketplace: banker cards, browse, profile/booking modal, student bookings. */
(function(CD){
  "use strict";
  var S = CD.State, esc = CD.esc, A = CD.actions;
  var M = { banker:null, slotId:null, step:null };

  CD.STATUS_LABEL = { requested:"Requested", confirmed:"Confirmed", declined:"Declined", cancelled:"Cancelled" };

  function listed(){ return S.bankers.filter(function(b){ return b.status==="verified"; }); }

  CD.avatar = function(b, size){
    var cls = size==="lg" ? "avatar avatar-lg" : "avatar";
    return '<div class="'+cls+'">'+CD.icon("briefcase")+'</div>';
  };

  CD.verifiedBadge = function(){ return '<span class="verified" title="Employer verified">'+CD.icon("shield-check")+'</span>'; };

  function interestMatches(b){
    var s = S.session;
    if (!s || !s.student || !s.student.tags) return [];
    return b.tags.filter(function(t){ return s.student.tags.indexOf(t) !== -1; });
  }

  CD.bankerCard = function(b, opts){
    opts = opts || {};
    var open = CD.openSlots(b).length;
    var former = CD.typeOf(b) === "former";
    var badge = opts.ribbon ? '<span class="ribbon-badge">'+esc(opts.ribbon)+'</span>'
              : (opts.isNew ? '<span class="new-badge">NEW</span>' : '');
    var rating = (b.chats > 0 && b.rating)
      ? '<div class="rating"><b>'+b.rating.toFixed(1)+'</b><span>· '+b.chats+' conversations</span></div>'
      : '';
    return (
      '<div class="banker-card">'
      + badge
      + '<div class="banker-top">'
        + CD.avatar(b)
        + '<div class="banker-id">'
          + '<div class="name">'+esc(CD.headline(b))+'</div>'
          + '<div class="role">'+esc(b.employer)+' '+(b.status==="verified" && !former ? CD.verifiedBadge() : '')+'</div>'
          + '<div class="loc">'+esc(b.location)+(former && b.period ? ' · '+esc(b.period) : '')+' · '+b.years+' yrs</div>'
        + '</div>'
      + '</div>'
      + rating
      + '<div class="tag-row">'+ (former ? '<span class="tag tag-former">Former</span>' : '') + b.tags.slice(0, former ? 1 : 2).map(function(t){ return '<span class="tag tag-accent">'+esc(t)+'</span>'; }).join('') +'</div>'
      + '<div class="banker-bottom">'
        + '<div class="price">'+CD.fmtPrice(b)+' <span>/ '+b.duration+' min</span></div>'
        + '<button class="btn btn-outline btn-sm" data-action="openProfile" data-id="'+esc(b.id)+'" '+(open===0?'disabled':'')+'>'+(open===0?'Fully booked':'View profile')+'</button>'
      + '</div>'
    + '</div>'
    );
  }

  function cardFor(b, extra){
    var o = extra || {};
    if (S.session && S.session.bankerId === b.id) o.ribbon = "Your profile";
    return CD.bankerCard(b, o);
  }

  /* ---------------- home + marketplace ---------------- */
  CD.renderHome = function(){
    var l = listed();
    var hero = document.getElementById("heroCard");
    if (l.length){
      var open = CD.openSlots(l[0]).length;
      hero.hidden = false;
      hero.innerHTML = '<div class="hero-card-label">'+CD.icon("check")+'Open now · '+open+(open===1 ? ' slot' : ' slots')+'</div>' + cardFor(l[0]);
    } else {
      hero.hidden = true;
    }
    var top = l.slice(0, 3);
    document.getElementById("featuredSection").hidden = !top.length;
    document.getElementById("featuredGrid").innerHTML = top.map(function(b){ return cardFor(b); }).join('');
  };

  CD.renderMarketplace = function(){
    var q = (document.getElementById("searchInput").value || "").toLowerCase();
    var tag = document.getElementById("filterTag").value;
    var sort = document.getElementById("filterSort").value;
    var type = document.getElementById("filterType").value;
    var mine = (S.session && S.session.student && S.session.student.tags) || [];

    var list = listed().filter(function(b){
      var hay = (b.employer+" "+b.location+" "+b.role+" "+b.tags.join(" ")).toLowerCase();
      return (!q || hay.indexOf(q) !== -1) && (!tag || b.tags.indexOf(tag) !== -1) && (!type || CD.typeOf(b) === type);
    });

    list.sort(function(a,b){
      if (sort==="price-asc") return a.price - b.price;
      if (sort==="price-desc") return b.price - a.price;
      if (sort==="new") return b.createdAt - a.createdAt;
      var d = interestMatches(b).length - interestMatches(a).length;
      return d !== 0 ? d : (b.rating||0) - (a.rating||0);
    });

    var boosted = sort==="rating" && mine.length ? " · your interests first" : "";
    document.getElementById("resultCount").textContent = list.length + (list.length===1 ? " banker" : " bankers") + " found" + boosted;
    document.getElementById("marketplaceGrid").innerHTML = list.length
      ? list.map(function(b){
          return cardFor(b, { isNew: Date.now() - b.createdAt < 14 * 864e5, ribbon: (sort==="rating" && interestMatches(b).length) ? "Interest match" : null });
        }).join('')
      : (listed().length
          ? '<div class="empty-state" style="grid-column:1/-1;"><div class="glyph">'+CD.icon("search")+'</div><h3>No bankers match those filters</h3><p>Try clearing the search or a filter.</p></div>'
          : '<div class="empty-state" style="grid-column:1/-1;"><div class="glyph">'+CD.icon("briefcase")+'</div><h3>No bankers are listed yet</h3><p>Cortado is just getting started. Bankers appear here as soon as they are verified — or be one of the first.</p><button class="btn btn-primary" data-action="becomeBanker">Offer your experience</button></div>');
  };

  CD.initMarket = function(){
    var sel = document.getElementById("filterTag");
    CD.TAGS.forEach(function(t){
      var o = document.createElement("option");
      o.value = t; o.textContent = t;
      sel.appendChild(o);
    });
    ["searchInput","filterTag","filterType","filterSort"].forEach(function(id){
      var el = document.getElementById(id);
      el.addEventListener(id==="searchInput" ? "input" : "change", CD.renderMarketplace);
    });
    var overlay = document.getElementById("overlay");
    overlay.addEventListener("click", function(e){ if (e.target === overlay) CD.closeModal(); });
  };

  /* ---------------- profile + booking-request modal ---------------- */
  function findSlot(b, id){ return b.slots.filter(function(s){ return s.id===id; })[0]; }

  CD.openProfile = function(bankerId){
    var b = CD.findBanker(bankerId);
    if (!b) return;
    M.banker = b; M.step = "profile"; M.slotId = null;
    renderModal();
    document.getElementById("overlay").hidden = false;
    document.body.style.overflow = "hidden";
  };

  CD.closeModal = function(){
    document.getElementById("overlay").hidden = true;
    document.body.style.overflow = "";
    M.banker = null; M.step = null; M.slotId = null;
  };

  CD.pickSlot = function(slotId){
    var b = M.banker;
    if (!b) return;
    if (S.session && S.session.bankerId === b.id){ CD.toast("That's your own profile."); return; }
    if (!CD.hasRole("student")){
      /* booking needs a student profile: onboard first, then come back to this slot */
      CD.closeModal();
      CD.startOnboarding({ roles:["student"], resume:{ bankerId:b.id, slotId:slotId } });
      return;
    }
    if (!findSlot(b, slotId)) return;
    M.slotId = slotId; M.step = "request";
    renderModal();
  };

  function renderModal(){
    var b = M.banker, body = document.getElementById("modalBody");
    if (!b){ body.innerHTML = ""; return; }

    if (M.step === "profile"){
      var slots = CD.openSlots(b);
      var former = CD.typeOf(b) === "former";
      body.innerHTML =
        '<div style="display:flex; gap:14px; align-items:flex-start; margin-bottom:6px;">'
          + CD.avatar(b,"lg")
          + '<div>'
            + '<h3>'+esc(CD.headline(b))+'</h3>'
            + '<p style="color:var(--ink-soft); font-size:14px; margin-top:2px;">'+esc(b.employer)+' '+(former ? '' : CD.verifiedBadge())+'</p>'
            + '<p style="color:var(--ink-faint); font-size:12.5px; margin-top:2px;">'+esc(b.location)+(former && b.period ? ' · '+esc(b.period) : '')+' · '+b.years+' yrs experience'+(b.handle ? ' · Profile '+esc(b.handle) : '')+'</p>'
          + '</div>'
        + '</div>'
        + '<div class="rating" style="margin:14px 0;">'+(b.chats > 0 && b.rating ? '<b>'+b.rating.toFixed(1)+'</b><span>· '+b.chats+' conversations · </span>' : '')+'<span>Replies '+esc(b.response)+'</span></div>'
        + '<p style="font-size:14.5px; color:var(--ink); margin-bottom:14px;">'+esc(b.bio)+'</p>'
        + '<div class="tag-row" style="margin-bottom:14px;">'+ (former ? '<span class="tag tag-former">Former</span>' : '') + b.tags.map(function(t){ return '<span class="tag tag-accent">'+esc(t)+'</span>'; }).join('') +'</div>'
        + (former ? '<p class="disclosure-note" style="margin-bottom:14px;">'+CD.icon("info")+'<span>Former banker — shares first-hand experience from past roles, not current inside information.</span></p>' : '')
        + '<p style="font-size:13px; color:var(--ink-soft); margin-bottom:14px;"><strong>Speaks:</strong> '+esc(b.languages.join(", "))+'</p>'
        + '<p class="disclosure-note">'+CD.icon("info")+'<span>Career and recruiting conversations only — no confidential deal, client or trade information is shared.</span></p>'
        + '<div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:16px; margin-top:14px;">'
          + '<span style="font-weight:600;">Open time slots</span><span class="price">'+CD.fmtPrice(b)+' <span>/ '+b.duration+' min</span></span>'
        + '</div>'
        + '<div class="slot-list">'
          + (slots.length ? slots.map(function(s){
              return '<button type="button" class="slot-btn" data-action="pickSlot" data-id="'+esc(s.id)+'"><span>'+esc(CD.fmtSlot(s.start))+'</span><span class="go">Request this slot</span></button>';
            }).join('') : '<p style="color:var(--ink-faint); font-size:13.5px;">No open slots right now — check back soon.</p>')
        + '</div>';
      return;
    }

    if (M.step === "request"){
      var slot = findSlot(b, M.slotId), s = S.session;
      if (!slot || !s){ M.step = "profile"; renderModal(); return; }
      body.innerHTML =
        '<h3>Request a chat</h3>'
        + '<div class="order-summary" style="margin-top:14px;">'
          + '<div class="order-row"><span>Banker</span><span>'+esc(CD.headline(b))+' · '+esc(b.employer)+'</span></div>'
          + '<div class="order-row"><span>Time</span><span>'+esc(CD.fmtSlot(slot.start))+'</span></div>'
          + '<div class="order-row"><span>Duration</span><span>'+b.duration+' minutes</span></div>'
          + '<div class="order-row"><span>You</span><span>'+esc(s.name)+(s.student && s.student.university ? ' · '+esc(s.student.university) : '')+'</span></div>'
          + '<div class="order-row total"><span>Price</span><span>'+CD.fmtPrice(b)+'</span></div>'
        + '</div>'
        + '<form data-form="request">'
          + '<div class="field"><label for="reqMsg">What do you want to ask about? (optional)</label><textarea id="reqMsg" name="message" placeholder="e.g. How to prepare for superday interviews"></textarea></div>'
          + '<p class="disclosure-note" style="margin-bottom:16px;">'+CD.icon("info")+'<span>The banker sees your name, university and target market. Your email is shared only if they confirm. Prototype: no payment is taken.</span></p>'
          + '<button class="btn btn-primary btn-block" type="submit">Send booking request</button>'
          + '<button class="btn btn-ghost btn-block" type="button" style="margin-top:8px;" data-action="modalBack">Back</button>'
        + '</form>';
      return;
    }

    if (M.step === "success"){
      body.innerHTML =
        '<div class="success-box">'
          + '<div class="glyph">'+CD.icon("check")+'</div>'
          + '<h3>Request sent</h3>'
          + '<p>The banker will confirm your slot. Once confirmed, you see the banker\'s name and contact details. In this prototype no email is sent — follow the status under My Bookings.</p>'
          + '<div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">'
            + '<button class="btn btn-primary" data-action="modalToBookings">View my bookings</button>'
            + '<button class="btn btn-ghost" data-action="closeModal">Close</button>'
          + '</div>'
        + '</div>';
    }
  }

  CD.forms.request = function(f){
    var b = M.banker;
    var slot = b && findSlot(b, M.slotId);
    if (!slot || slot.taken){
      CD.toast("That slot was just taken.");
      M.step = "profile"; renderModal();
      return;
    }
    var btn = f.querySelector('button[type="submit"]');
    if (btn){ btn.disabled = true; btn.textContent = "Sending…"; }
    var bankerId = b.id;

    CD.store.requestBooking(slot.id, f.elements["message"].value.trim()).then(function(){
      CD.store.track("booking_requested", { banker_type: CD.typeOf(b) });
      return CD.store.load();
    }).then(function(){
      M.banker = CD.findBanker(bankerId) || b;
      M.step = "success"; renderModal();
      CD.refresh();
    }, function(err){
      CD.toast(CD.errMsg(err));
      CD.store.load().then(function(){
        M.banker = CD.findBanker(bankerId) || b;
        M.step = "profile"; renderModal();
        CD.refresh();
      }, function(){ if (btn){ btn.disabled = false; btn.textContent = "Send booking request"; } });
    });
  };

  A.openProfile = function(el){ CD.openProfile(el.getAttribute("data-id")); };
  A.pickSlot = function(el){ CD.pickSlot(el.getAttribute("data-id")); };
  A.closeModal = function(){ CD.closeModal(); };
  A.modalBack = function(){ M.step = "profile"; renderModal(); };
  A.modalToBookings = function(){ CD.closeModal(); CD.showView("bookings"); };

  /* ---------------- bookings (student view) ---------------- */
  CD.renderBookings = function(){
    var el = document.getElementById("bookingsList");
    var mine = S.bookings.filter(function(bk){ return bk.viewerIsStudent; });
    if (!mine.length){
      el.innerHTML = '<div class="empty-state"><div class="glyph">'+CD.icon("inbox")+'</div><h3>No requests yet</h3><p>Once you request a conversation, it will show up here.</p><button class="btn btn-primary" data-action="go" data-view="marketplace">Browse bankers</button></div>';
      return;
    }
    el.innerHTML = '<div class="booking-list">' + mine.map(function(bk){
      var active = bk.status==="requested" || bk.status==="confirmed";
      var who = CD.counterpart(bk, "student");
      return (
        '<div class="booking-row">'
          + '<div class="booking-info">'
            + '<div class="who">'+esc(bk.bankerRole)+' <span style="color:var(--ink-faint); font-weight:400;">· '+esc(bk.bankerEmployer)+'</span></div>'
            + '<div class="meta">'+esc(CD.fmtSlot(bk.slotStart))+' · '+bk.duration+' min · '+CD.money(bk.currency, bk.price)+'</div>'
            + (who ? '<div class="contact"><b>'+esc(who.name)+'</b>'+(who.email ? ' · '+esc(who.email) : '')+'</div>' : '')
          + '</div>'
          + '<span class="badge badge-'+bk.status+'">'+CD.STATUS_LABEL[bk.status]+'</span>'
          + '<div class="booking-actions">'
            + (active ? '<button class="btn btn-danger btn-sm" data-action="setBooking" data-id="'+esc(bk.id)+'" data-status="cancelled">Cancel</button>' : '')
          + '</div>'
        + '</div>'
      );
    }).join('') + '</div>';
  };

  /* shared by student (cancel) and banker (confirm / decline / cancel); permissions are checked in the database */
  A.setBooking = function(el){
    var id = el.getAttribute("data-id"), status = el.getAttribute("data-status");
    el.disabled = true;
    CD.store.setBookingStatus(id, status).then(function(){
      if (status === "confirmed") CD.store.track("booking_confirmed");
      CD.toast("Request " + status + ".");
      return CD.store.load();
    }).then(function(){ CD.refresh(); }, function(err){
      el.disabled = false;
      CD.toast(CD.errMsg(err));
    });
  };
})(window.CD);
