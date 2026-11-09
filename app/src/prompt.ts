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

export interface VoiceEditValue {
  name: string;
  desc: string;
}

export function askVoiceEdit(
  name: string,
  desc: string
): Promise<VoiceEditValue | null> {
  return new Promise((resolve) => {
    const mask = document.createElement("div");
    mask.className = "modal-mask";
    mask.style.zIndex = "200";

    const modal = document.createElement("div");
    modal.className = "modal prompt-modal voice-edit-modal";

    const head = document.createElement("div");
    head.className = "modal-head";
    const headText = document.createElement("div");
    const titleEl = document.createElement("div");
    titleEl.className = "modal-title";
    titleEl.textContent = "编辑音色";
    const descEl = document.createElement("div");
    descEl.className = "modal-desc";
    descEl.textContent = "名称和介绍一起改，保存后立即更新音色库。";
    headText.append(titleEl, descEl);
    head.appendChild(headText);

    const body = document.createElement("div");
    body.className = "modal-body";

    const nameField = document.createElement("div");
    nameField.className = "prompt-field";
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "音色名称";
    const nameInput = document.createElement("input");
    nameInput.className = "input";
    nameInput.value = name;
    nameField.append(nameLabel, nameInput);

    const descField = document.createElement("div");
    descField.className = "prompt-field";
    const descLabel = document.createElement("label");
    descLabel.textContent = "音色介绍";
    const descInput = document.createElement("textarea");
    descInput.className = "input prompt-desc";
    descInput.value = desc;
    descField.append(descLabel, descInput);
    body.append(nameField, descField);

    const foot = document.createElement("div");
    foot.className = "modal-foot";
    const cancel = document.createElement("button");
    cancel.className = "btn";
    cancel.textContent = "取消";
    const ok = document.createElement("button");
    ok.className = "btn primary";
    ok.textContent = "保存";
    foot.append(cancel, ok);
    modal.append(head, body, foot);
    mask.appendChild(modal);
    document.body.appendChild(mask);

    const close = (value: VoiceEditValue | null) => {
      mask.remove();
      resolve(value);
    };

    cancel.onclick = () => close(null);
    ok.onclick = () => {
      const nextName = nameInput.value.trim();
      if (!nextName) {
        nameInput.focus();
        return;
      }
      close({ name: nextName, desc: descInput.value.trim() });
    };
    mask.onclick = (event) => {
      if (event.target === mask) close(null);
    };
    modal.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(null);
      }
    };

    nameInput.focus();
    nameInput.select();
  });
}
