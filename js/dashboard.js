/* Cortado — banker dashboard: donations raised, ratings, requests, slot management. */
(function(CD){
  "use strict";
  var S = CD.State, esc = CD.esc, A = CD.actions;
  CD.renderDashboard = function(){
    var b = CD.myBanker(), body = document.getElementById("dashboardBody");
    if (!b){
      body.innerHTML = '<div class="empty-state"><div class="glyph">'+CD.icon("inbox")+'</div><h3>No banker profile yet</h3><p>Create one to start receiving requests.</p><button class="btn btn-primary" data-action="becomeBanker">Create a profile</button></div>';
      return;
    }

    var mine = S.bookings.filter(function(bk){ return bk.bankerId===b.id && !bk.viewerIsStudent; })
                         .sort(function(x,y){ return y.createdAt - x.createdAt; });
    var confirmed = mine.filter(function(bk){ return bk.status==="confirmed"; });
    var pending = mine.filter(function(bk){ return bk.status==="requested"; });
    /* confirmed chats that already took place count as raised; upcoming ones as pledged */
    var now = Date.now();
    function sum(list){ return list.reduce(function(t, bk){ return t + bk.price; }, 0); }
    var raised = sum(confirmed.filter(function(bk){ return new Date(bk.slotStart).getTime() <= now; }));
    var pledged = sum(confirmed.filter(function(bk){ return new Date(bk.slotStart).getTime() > now; }));
    var openCount = CD.openSlots(b).length;
    var charity = CD.findCharity(b.charityId);

    var notice = b.status === "rejected"
      ? '<div class="notice notice-warn"><p><strong>Your profile is hidden.</strong> Our team has paused it, for example after a report or repeated poor ratings. Please contact us if you think this is a mistake.</p></div>'
      : '';

    var statusBadge = b.status==="rejected"
      ? '<span class="badge badge-declined">Hidden</span>'
      : '<span class="badge badge-confirmed">Live</span>';

    var slotsSorted = b.slots.slice().sort(function(x,y){ return new Date(x.start) - new Date(y.start); });

    body.innerHTML = notice
      + '<div class="dash-stats">'
        + '<div class="dash-stat"><b class="mono">'+pending.length+'</b><span>Pending requests</span></div>'
        + '<div class="dash-stat"><b class="mono">'+confirmed.length+'</b><span>Confirmed sessions</span></div>'
        + '<div class="dash-stat dash-stat-brand"><b class="mono">'+CD.money(b.currency, raised)+'</b><span>Raised for '+esc(charity ? charity.name : "charity")+(pledged ? ' · '+CD.money(b.currency, pledged)+' pledged' : '')+'</span></div>'
        + '<div class="dash-stat"><b class="mono">'+(b.chats ? b.rating.toFixed(1) : '–')+'</b><span>'+(b.chats ? 'Average rating · '+b.chats+(b.chats===1 ? ' rating' : ' ratings') : 'No ratings yet')+'</span></div>'
        + '<div class="dash-stat"><b class="mono">'+openCount+'</b><span>Open slots left</span></div>'
      + '</div>'
      + '<div class="card" style="margin-bottom:28px; display:flex; gap:16px; align-items:flex-start;">'
        + CD.avatar(b,"lg")
        + '<div>'
          + '<h3 style="font-size:19px;">'+esc(CD.headline(b))+' '+statusBadge+'</h3>'
          + '<p style="color:var(--ink-soft); font-size:14px; margin-top:3px;">'+esc(b.employer)+' · '+esc(b.location)+(CD.typeOf(b)==="former" && b.period ? ' · '+esc(b.period) : '')+'</p>'
          + '<p style="color:var(--ink-faint); font-size:13px; margin-top:3px;">'+CD.fmtPrice(b)+' donation / '+b.duration+' min · Profile '+esc(b.handle||"")+'</p>'
          + '<p style="color:var(--ink-faint); font-size:13px; margin-top:3px;">Private, not shown publicly: '+esc(b.name || (S.session && S.session.name) || "")+'</p>'
          + '<div class="tag-row" style="margin-top:10px;">'+ b.tags.map(function(t){ return '<span class="tag tag-accent">'+esc(t)+'</span>'; }).join('') +'</div>'
          + '<div style="margin-top:12px;">'+CD.ratingLine(b)+'</div>'
          + '<form class="charity-change" data-form="charity">'
            + '<label for="dCharity">Your chats support</label>'
            + '<select id="dCharity" name="charity">'
              + S.charities.map(function(c){ return '<option value="'+esc(c.id)+'"'+(c.id===b.charityId ? ' selected' : '')+'>'+esc(c.name)+'</option>'; }).join('')
            + '</select>'
            + '<button class="btn btn-outline btn-sm" type="submit">Save</button>'
          + '</form>'
          + '<p class="hint" style="font-size:12.5px; color:var(--ink-faint); margin-top:6px;">A change applies to new requests; existing ones keep their charity.</p>'
        + '</div>'
      + '</div>'
      + '<h3 style="font-size:16px; margin-bottom:14px;">Session requests</h3>'
      + (mine.length
          ? '<div class="booking-list" style="margin-bottom:32px;">' + mine.map(function(bk){
              var actions = "";
              var who = CD.counterpart(bk);
              if (bk.status==="requested"){
                actions = '<button class="btn btn-primary btn-sm" data-action="setBooking" data-id="'+esc(bk.id)+'" data-status="confirmed">Confirm</button>'
                        + '<button class="btn btn-danger btn-sm" data-action="setBooking" data-id="'+esc(bk.id)+'" data-status="declined">Decline</button>';
              } else if (bk.status==="confirmed" && new Date(bk.slotStart).getTime() > now){
                actions = '<button class="btn btn-danger btn-sm" data-action="setBooking" data-id="'+esc(bk.id)+'" data-status="cancelled">Cancel</button>';
              }
              return (
                '<div class="booking-row">'
                  + '<div class="booking-info">'
                    + '<div class="who">'+esc(bk.studentName || ("Student " + (bk.studentHandle || "")))+' <span style="color:var(--ink-faint); font-weight:400;">· '+esc(bk.university)+(bk.studentMarket ? ' · target '+esc(bk.studentMarket) : '')+'</span></div>'
                    + '<div class="meta">'+esc(CD.fmtSlot(bk.slotStart))+' · '+CD.money(bk.currency, bk.price)+' to '+esc(bk.charityName || "charity")+(bk.message ? ' · "'+esc(bk.message)+'"' : '')+'</div>'
                    + (bk.reviewRating ? '<div class="my-review">Rated '+CD.stars(bk.reviewRating)+(bk.reviewComment ? ' <span>"'+esc(bk.reviewComment)+'"</span>' : '')+'</div>' : '')
                    + (who && who.email ? '<div class="contact">Contact: <b>'+esc(who.email)+'</b></div>' : '')
                  + '</div>'
                  + '<span class="badge badge-'+bk.status+'">'+CD.STATUS_LABEL[bk.status]+'</span>'
                  + '<div class="booking-actions">'+actions+'</div>'
                + '</div>'
              );
            }).join('') + '</div>'
          : '<div class="empty-state" style="margin-bottom:32px;"><div class="glyph">'+CD.icon("inbox")+'</div><h3>No requests yet</h3><p>Requests from students will appear here once your profile is live and someone books a slot.</p></div>')
      + '<h3 style="font-size:16px; margin-bottom:14px;">Your time slots</h3>'
      + '<div class="slot-manage">'
        + slotsSorted.map(function(sl){
            var past = new Date(sl.start).getTime() <= now;
            var state = sl.taken ? "Booked" : (past ? "Past" : "Open");
            return '<div class="slot-row"><span>'+esc(CD.fmtSlot(sl.start))+'</span><span style="display:flex; align-items:center; gap:10px;"><span class="state">'+state+'</span>'
              + (!sl.taken ? '<button class="btn btn-danger btn-sm" data-action="removeSlot" data-id="'+esc(sl.id)+'">Remove</button>' : '')
              + '</span></div>';
          }).join('')
      + '</div>'
      + '<form class="add-slot" data-form="addSlot">'
        + '<input class="input" type="datetime-local" name="start" required min="'+CD.toLocalInput(new Date())+'">'
        + '<button class="btn btn-outline" type="submit">Add slot</button>'
      + '</form>';
  };

  CD.forms.charity = function(f){
    var b = CD.myBanker();
    if (!b) return;
    var id = f.elements["charity"].value, btn = f.querySelector('button[type="submit"]');
    if (id === b.charityId) return;
    if (btn) btn.disabled = true;
    CD.store.setCharity(b.id, id).then(function(){
      CD.store.track("charity_changed", { charity: id });
      CD.toast("Saved — new requests now support " + ((CD.findCharity(id) || {}).name || "this charity") + ".");
      return CD.store.load();
    }).then(function(){ CD.refresh(); }, function(err){
      if (btn) btn.disabled = false;
      CD.toast(CD.errMsg(err));
    });
  };

  A.removeSlot = function(el){
    el.disabled = true;
    CD.store.removeSlot(el.getAttribute("data-id")).then(function(){
      return CD.store.load();
    }).then(function(){ CD.refresh(); }, function(err){
      el.disabled = false;
      CD.toast(CD.errMsg(err));
    });
  };

  CD.forms.addSlot = function(f){
    var b = CD.myBanker();
    if (!b) return;
    var v = f.elements["start"].value;
    if (!v || new Date(v).getTime() <= Date.now()){ CD.toast("Pick a time in the future."); return; }
    var btn = f.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    CD.store.addSlot(b.id, new Date(v).toISOString()).then(function(){
      return CD.store.load();
    }).then(function(){ CD.refresh(); }, function(err){
      if (btn) btn.disabled = false;
      CD.toast(CD.errMsg(err));
    });
  };
})(window.CD);
