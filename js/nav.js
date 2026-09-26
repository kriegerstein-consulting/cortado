/* Cortado — navigation: role-dependent nav, view routing, account menu, global event delegation. */
(function(CD){
  "use strict";
  var S = CD.State, esc = CD.esc, A = CD.actions;

  function homeView(){
    if (!S.session) return "home";
    return S.session.activeRole === "banker" ? "dashboard" : "marketplace";
  }

  CD.toast = function(msg){
    var box = document.getElementById("toasts");
    if (!box){
      box = document.createElement("div");
      box.id = "toasts"; box.className = "toasts";
      document.body.appendChild(box);
    }
    var t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function(){ t.remove(); }, 3600);
  };

  /* ---------------- nav rendering ---------------- */
  CD.renderNav = function(){
    var s = S.session, view = CD.ui.view, tabs;
    if (!s) tabs = [["marketplace","Browse Bankers"]];
    else if (s.activeRole === "banker") tabs = [["dashboard","Dashboard"],["marketplace","Browse Bankers"]];
    else tabs = [["marketplace","Browse Bankers"],["bookings","My Bookings"]];

    document.getElementById("navtabs").innerHTML = tabs.map(function(t){
      return '<button class="navtab'+(view===t[0] ? ' active' : '')+'" data-action="go" data-view="'+t[0]+'">'+t[1]+'</button>';
    }).join('');

    var right;
    if (!s){
      right = '<button class="btn btn-ghost btn-sm" data-action="login">Log in</button>'
            + '<button class="btn btn-primary btn-sm" data-action="start">Get started</button>';
    } else {
      right = "";
      if (s.roles.student && s.roles.banker){
        right += '<div class="role-switch">'
          + '<button class="'+(s.activeRole==="student" ? 'active' : '')+'" data-action="switchRole" data-role="student">Student</button>'
          + '<button class="'+(s.activeRole==="banker" ? 'active' : '')+'" data-action="switchRole" data-role="banker">Banker</button>'
          + '</div>';
      }
      right += '<div class="acct"><button class="acct-btn" data-action="toggleMenu" aria-label="Account menu">'+esc(CD.initials(s.name))+'</button>';
      if (CD.ui.menuOpen){
        right += '<div class="acct-menu">'
          + '<div class="acct-head"><b>'+esc(s.name)+'</b><span>'+esc(s.email)+'</span>'+(s.emailVerified ? ' <span class="verified" title="Email verified">'+CD.icon("shield-check")+'</span>' : '')+'</div>'
          + (!s.roles.student ? '<button data-action="becomeStudent">Also request chats as a student</button>' : '')
          + (!s.roles.banker ? '<button data-action="becomeBanker">Also offer chats as a banker</button>' : '')
          + '<button data-action="signOut">Sign out</button>'
          + '</div>';
      }
      right += '</div>';
    }
    document.getElementById("navRight").innerHTML = right;
  };

  /* ---------------- routing ---------------- */
  CD.showView = function(name){
    var s = S.session;
    if (name === "home" && s) name = homeView();

    /* role guards: send people to the onboarding step they are missing */
    if (name === "bookings" && !CD.hasRole("student"))
      return CD.startOnboarding({ roles:["student"], resume:{ view:"bookings" } });
    if (name === "dashboard" && !CD.hasRole("banker"))
      return CD.startOnboarding({ roles:["banker"], resume:{ view:"dashboard" } });

    /* keep the active role in sync with where the user is going */
    if (s && name === "bookings" && s.activeRole !== "student"){ s.activeRole = "student"; CD.store.saveSession(); }
    if (s && name === "dashboard" && s.activeRole !== "banker"){ s.activeRole = "banker"; CD.store.saveSession(); }

    CD.ui.view = name;
    CD.ui.menuOpen = false;
    document.querySelectorAll(".view").forEach(function(el){ el.hidden = el.getAttribute("data-view") !== name; });
    CD.renderNav();
    window.scrollTo(0, 0);
    CD.refresh();

    /* show the cached data right away, then refresh it from the database if it is getting old */
    if (name !== "welcome" && Date.now() - CD.store.loadedAt > 5000){
      CD.store.load().then(function(){
        CD.renderNav();
        if (CD.ui.view === name) CD.refresh();
      }, function(){});
    }
  };

  CD.refresh = function(){
    var v = CD.ui.view;
    if (v === "home") CD.renderHome();
    if (v === "marketplace") CD.renderMarketplace();
    if (v === "bookings") CD.renderBookings();
    if (v === "dashboard") CD.renderDashboard();
  };

  /* ---------------- actions ---------------- */
  A.go = function(el){ CD.showView(el.getAttribute("data-view")); };
  A.logo = function(){ CD.showView(homeView()); };
  A.start = function(){ CD.startOnboarding({}); };
  A.login = function(){ CD.startLogin(); };

  A.becomeBanker = function(){
    if (CD.hasRole("banker")){ CD.showView("dashboard"); return; }
    CD.startOnboarding({ roles:["banker"], resume:{ view:"dashboard" } });
  };
  A.becomeStudent = function(){
    if (CD.hasRole("student")){ CD.showView("marketplace"); return; }
    CD.startOnboarding({ roles:["student"], resume:{ view:"marketplace" } });
  };

  A.switchRole = function(el){
    var r = el.getAttribute("data-role");
    if (!S.session || !S.session.roles[r]) return;
    S.session.activeRole = r;
    CD.store.saveSession();
    CD.showView(r === "banker" ? "dashboard" : "marketplace");
  };

  A.toggleMenu = function(){ CD.ui.menuOpen = !CD.ui.menuOpen; CD.renderNav(); };

  A.signOut = function(){
    CD.ui.menuOpen = false;
    CD.store.signOut().then(function(){
      CD.toast("Signed out.");
      return CD.store.load();
    }).then(function(){ CD.showView("home"); }, function(err){ CD.toast(CD.errMsg(err)); });
  };

  /* ---------------- global event delegation ---------------- */
  document.addEventListener("click", function(e){
    if (CD.ui.menuOpen && !e.target.closest(".acct")){ CD.ui.menuOpen = false; CD.renderNav(); }
    var el = e.target.closest("[data-action]");
    if (!el) return;
    var fn = A[el.getAttribute("data-action")];
    if (fn) fn(el, e);
  });

  document.addEventListener("submit", function(e){
    var name = e.target.getAttribute && e.target.getAttribute("data-form");
    if (!name || !CD.forms[name]) return;
    e.preventDefault();
    CD.forms[name](e.target);
  });

  document.addEventListener("change", function(e){
    var name = e.target.getAttribute && e.target.getAttribute("data-change");
    if (name && CD.changes[name]) CD.changes[name](e.target);
  });

  document.addEventListener("keydown", function(e){
    if (e.key !== "Escape") return;
    CD.closeModal();
    if (CD.ui.menuOpen){ CD.ui.menuOpen = false; CD.renderNav(); }
  });
})(window.CD);
