/* Cortado — banker dashboard: status, requests, slot management. */
(function(CD){
  "use strict";
  var S = CD.State, esc = CD.esc, A = CD.actions;
  var WV = { step:"idle", chk:null, error:"", busy:false };    /* work-email verification (current bankers) */

  function workEmailCard(b){
    var hidden = b.status !== "verified";
    return '<div class="notice notice-warn" style="align-items:flex-start;">'
      + '<div style="flex:1; min-width:240px;">'
        + '<p><strong>Verify your work email now.</strong> '
          + (hidden ? 'Your profile stays hidden from students until you confirm that you can receive email at ' : 'Confirm that you can receive email at ')
          + '<strong>'+esc(b.workEmail || "your work email")+'</strong>. '
          + 'We send a separate code to that address — your login email and password are not affected.</p>'
        + (WV.step === "code"
            ? '<form data-form="wvVerify" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:12px;">'
              + '<input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" pattern="[0-9]{6,10}" required placeholder="Code from your work email" style="max-width:240px;">'
              + '<button class="btn btn-primary btn-sm" type="submit"'+(WV.busy ? ' disabled' : '')+'>Verify</button>'
              + '<button type="button" class="link-btn" data-action="wvSend">Send a new code</button>'
            + '</form>'
            : '')
        + (WV.error ? '<p class="field-error">'+esc(WV.error)+'</p>' : '')
      + '</div>'
      + (WV.step === "code" ? '' : '<button class="btn btn-primary btn-sm" data-action="wvSend"'+(WV.busy ? ' disabled' : '')+'>Send code</button>')
    + '</div>';
  }

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
    var net = confirmed.reduce(function(sum, bk){ return sum + bk.price; }, 0) * (1 - CD.FEE);
    var openCount = CD.openSlots(b).length;

    var notice = "";
    var current = CD.typeOf(b) === "current";
    if (b.status === "rejected"){
      notice = '<div class="notice notice-warn"><p><strong>Verification not successful.</strong> Your profile stays hidden. Please contact us if you think this is a mistake.</p></div>';
    } else if (current && !b.workEmailVerified){
      notice = workEmailCard(b);
    } else if (b.status === "pending"){
      notice = '<div class="notice notice-warn"><p><strong>Verification pending.</strong> '
        + (current
            ? 'Your work email is confirmed. Our team is checking your employer and will make your profile visible shortly.'
            : 'Your profile is hidden from students until our team has reviewed your LinkedIn profile. We will get in touch at your login address.')
        + '</p></div>';
    }

    var statusBadge = b.status==="verified"
      ? '<span class="badge badge-confirmed">Verified</span>'
      : (b.status==="rejected" ? '<span class="badge badge-declined">Not verified</span>' : '<span class="badge badge-pending">Pending</span>');

    var slotsSorted = b.slots.slice().sort(function(x,y){ return new Date(x.start) - new Date(y.start); });
    var now = Date.now();

    body.innerHTML = notice
      + '<div class="dash-stats">'
        + '<div class="dash-stat"><b class="mono">'+pending.length+'</b><span>Pending requests</span></div>'
        + '<div class="dash-stat"><b class="mono">'+confirmed.length+'</b><span>Confirmed sessions</span></div>'
        + '<div class="dash-stat"><b class="mono">'+CD.money(b.currency, net)+'</b><span>Upcoming earnings (after 12% fee)</span></div>'
        + '<div class="dash-stat"><b class="mono">'+openCount+'</b><span>Open slots left</span></div>'
      + '</div>'
      + '<div class="card" style="margin-bottom:28px; display:flex; gap:16px; align-items:flex-start;">'
        + CD.avatar(b,"lg")
        + '<div>'
          + '<h3 style="font-size:19px;">'+esc(CD.headline(b))+' '+statusBadge+'</h3>'
          + '<p style="color:var(--ink-soft); font-size:14px; margin-top:3px;">'+esc(b.employer)+' · '+esc(b.location)+(CD.typeOf(b)==="former" && b.period ? ' · '+esc(b.period) : '')+'</p>'
          + '<p style="color:var(--ink-faint); font-size:13px; margin-top:3px;">'+CD.fmtPrice(b)+' / '+b.duration+' min · Profile '+esc(b.handle||"")+'</p>'
          + '<p style="color:var(--ink-faint); font-size:13px; margin-top:3px;">Private, not shown publicly: '+esc(b.name || (S.session && S.session.name) || "")+'</p>'
          + (current ? '<p style="font-size:13px; margin-top:3px; color:'+(b.workEmailVerified ? 'var(--green)' : 'var(--amber)')+';">Work email: '+(b.workEmailVerified ? CD.icon("shield-check")+' verified' : 'not verified yet')+'</p>' : '')
          + '<div class="tag-row" style="margin-top:10px;">'+ b.tags.map(function(t){ return '<span class="tag tag-accent">'+esc(t)+'</span>'; }).join('') +'</div>'
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
              } else if (bk.status==="confirmed"){
                actions = '<button class="btn btn-danger btn-sm" data-action="setBooking" data-id="'+esc(bk.id)+'" data-status="cancelled">Cancel</button>';
              }
              return (
                '<div class="booking-row">'
                  + '<div class="booking-info">'
                    + '<div class="who">'+esc(bk.studentName || ("Student " + (bk.studentHandle || "")))+' <span style="color:var(--ink-faint); font-weight:400;">· '+esc(bk.university)+(bk.studentMarket ? ' · target '+esc(bk.studentMarket) : '')+'</span></div>'
                    + '<div class="meta">'+esc(CD.fmtSlot(bk.slotStart))+(bk.message ? ' · "'+esc(bk.message)+'"' : '')+'</div>'
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

  A.wvSend = function(){
    var b = CD.myBanker();
    if (!b || WV.busy) return;
    WV.busy = true; WV.error = "";
    CD.renderDashboard();
    CD.store.startWorkCheck(b.workEmail).then(function(chk){
      WV.chk = chk; WV.step = "code"; WV.busy = false;
      CD.toast("Code sent to " + chk.email + ".");
      CD.renderDashboard();
    }, function(err){
      WV.busy = false; WV.error = CD.errMsg(err);
      CD.renderDashboard();
    });
  };

  CD.forms.wvVerify = function(f){
    if (!WV.chk || WV.busy) return;
    WV.busy = true; WV.error = "";
    CD.store.completeWorkCheck(WV.chk, f.elements["code"].value.trim()).then(function(res){
      WV.step = "idle"; WV.chk = null; WV.busy = false;
      CD.store.track("work_email_verified", { auto: !!(res && res.auto_verified) });
      CD.toast(res && res.auto_verified ? "Verified — your profile is now live." : "Work email confirmed. We will review your employer.");
      return CD.store.load();
    }).then(function(){ CD.renderNav(); CD.refresh(); }, function(err){
      WV.busy = false; WV.error = CD.errMsg(err);
      CD.renderDashboard();
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
