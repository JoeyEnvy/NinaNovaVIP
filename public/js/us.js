/* ===========================================
   NINA NOVA VIP — UI CONTROLLER
   Handles modals, smooth scrolls, animations,
   mobile menu, and interactive elements
   =========================================== */

document.addEventListener("DOMContentLoaded", () => {
  initMobileMenu();
  initScrollAnimations();
  initModalSystem();
  initButtons();
  console.log("🎀 Nina Nova VIP UI loaded");
});

/* ================================
   MOBILE MENU
   ================================ */
function initMobileMenu() {
  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".nav-links");

  if (!toggle || !nav) return;

  toggle.addEventListener("click", () => {
    nav.classList.toggle("active");
    toggle.classList.toggle("open");
  });
}

/* ================================
   SCROLL REVEAL ANIMATIONS
   ================================ */
function initScrollAnimations() {
  const elements = document.querySelectorAll(".reveal");

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.2 });

  elements.forEach((el) => observer.observe(el));
}

/* ================================
   MODALS
   ================================ */
function initModalSystem() {
  const modals = document.querySelectorAll(".modal");
  const triggers = document.querySelectorAll("[data-modal]");
  const closeBtns = document.querySelectorAll(".modal-close");

  triggers.forEach((trigger) => {
    const target = document.querySelector(trigger.dataset.modal);
    if (!target) return;

    trigger.addEventListener("click", () => target.classList.add("open"));
  });

  closeBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.target.closest(".modal").classList.remove("open");
    });
  });

  window.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal")) e.target.classList.remove("open");
  });
}

/* ================================
   BUTTON HOVER EFFECTS
   ================================ */
function initButtons() {
  const btns = document.querySelectorAll(".btn");
  btns.forEach((btn) => {
    btn.addEventListener("mouseenter", () => btn.classList.add("hover"));
    btn.addEventListener("mouseleave", () => btn.classList.remove("hover"));
  });
}

/* ================================
   SMOOTH SCROLL
   ================================ */
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    e.preventDefault();
    document.querySelector(this.getAttribute("href")).scrollIntoView({
      behavior: "smooth"
    });
  });
});
