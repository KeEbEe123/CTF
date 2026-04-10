(() => {
  const yearNodes = document.querySelectorAll("#year");
  const currentYear = new Date().getFullYear();
  yearNodes.forEach((node) => {
    node.textContent = String(currentYear);
  });

  const currentPage = document.body.dataset.page;
  const activeLink = currentPage ? document.querySelector(`[data-nav="${currentPage}"]`) : null;
  if (activeLink) {
    activeLink.classList.add("active");
  }

  const signInForm = document.getElementById("signin-form");
  const signInNotice = document.getElementById("signin-notice");
  if (signInForm && signInNotice) {
    signInForm.addEventListener("submit", (event) => {
      event.preventDefault();
      signInNotice.textContent =
        "Demo portal: authentication is unavailable in this training environment.";
      signInNotice.classList.add("inline-notice");
    });
  }

  const supportForm = document.getElementById("support-form");
  const supportNotice = document.getElementById("support-notice");
  if (supportForm && supportNotice) {
    supportForm.addEventListener("submit", (event) => {
      event.preventDefault();
      supportNotice.textContent =
        "Request captured for demo preview. In production this would open a support ticket.";
      supportNotice.classList.add("inline-notice");
    });
  }
})();
