/* Cortado — boot. */
(function(CD){
  "use strict";

  function init(){
    document.body.classList.add("booting");
    CD.initMarket();

    CD.store.load().catch(function(err){
      CD.toast(CD.errMsg(err));
    }).then(function(){
      document.body.classList.remove("booting");
      CD.showView("home");   /* members are routed to their role's start page */
    });

    var nav = document.getElementById("siteNav");
    window.addEventListener("scroll", function(){
      nav.classList.toggle("scrolled", window.scrollY > 8);
    }, { passive:true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.CD);
