export function askText(
  title: string,
  defaultValue = "",
  description = ""
): Promise<string | null> {
  return new Promise((resolve) => {
    const mask = document.createElement("div");
    mask.className = "modal-mask";
    mask.style.zIndex = "200";

    const modal = document.createElement("div");
    modal.className = "modal prompt-modal";

    const head = document.createElement("div");
    head.className = "modal-head";

    const headText = document.createElement("div");
    const titleEl = document.createElement("div");
    titleEl.className = "modal-title";
    titleEl.textContent = title;
    headText.appendChild(titleEl);

    if (description) {
      const desc = document.createElement("div");
      desc.className = "modal-desc";
      desc.textContent = description;
      headText.appendChild(desc);
    }

    head.appendChild(headText);

    const body = document.createElement("div");
    body.className = "modal-body";

    const input = document.createElement("input");
    input.className = "input";
    input.value = defaultValue;
    body.appendChild(input);

    const foot = document.createElement("div");
    foot.className = "modal-foot";

    const cancel = document.createElement("button");
    cancel.className = "btn";
    cancel.textContent = "取消";

    const ok = document.createElement("button");
    ok.className = "btn primary";
    ok.textContent = "确定";

    foot.append(cancel, ok);
    modal.append(head, body, foot);
    mask.appendChild(modal);
    document.body.appendChild(mask);

    const close = (value: string | null) => {
      mask.remove();
      resolve(value);
    };

    cancel.onclick = () => close(null);
    ok.onclick = () => close(input.value.trim() || null);
    mask.onclick = (event) => {
      if (event.target === mask) close(null);
    };

    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        ok.click();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        close(null);
      }
    };

    input.focus();
    input.select();
  });
}
