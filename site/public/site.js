for (const button of document.querySelectorAll("[data-copy-command]")) {
  button.hidden = false;
  button.addEventListener("click", async () => {
    const text = button.dataset.copyCommand;
    const status = button.closest("[data-copy-group]")?.querySelector("[data-copy-status]");
    if (!text || !status) return;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = `Copied: ${text}`;
    } catch {
      status.textContent = "Select the command above to copy it manually.";
    }
  });
}

const search = document.querySelector("[data-rule-search]");
const control = document.querySelector("[data-search-control]");
const count = document.querySelector("[data-rule-count]");
const empty = document.querySelector("[data-no-rules]");
const rules = [...document.querySelectorAll("[data-rule]")];
const texts = rules.map((rule) => `${rule.dataset.rule} ${rule.textContent ?? ""}`.toLowerCase());
if (search && control && count && empty) {
  control.hidden = false;
  search.addEventListener("input", () => {
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let visible = 0;
    rules.forEach((rule, index) => {
      const matches = terms.every((term) => texts[index].includes(term));
      rule.hidden = !matches;
      if (matches) visible += 1;
    });
    count.textContent = `${visible} of ${rules.length} documented rules`;
    empty.hidden = visible !== 0;
  });
}
