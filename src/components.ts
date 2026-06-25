export type IconName =
  | "bars"
  | "calendar"
  | "chevronLeft"
  | "chevronRight"
  | "clock"
  | "cloud"
  | "gauge"
  | "grid"
  | "link"
  | "pulse"
  | "refresh"
  | "save"
  | "settings"
  | "shuffle"
  | "timer"
  | "user";

const icons: Record<IconName, string> = {
  bars: '<path d="M5 19V11"/><path d="M12 19V5"/><path d="M19 19V8"/>',
  calendar:
    '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M4 10h16"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 8.4 4.8 4.8 0 0 0 7 18Z"/>',
  gauge: '<path d="M4 15a8 8 0 1 1 16 0"/><path d="m12 15 4-5"/><path d="M12 15h.01"/>',
  grid:
    '<rect x="4" y="4" width="5" height="5" rx="1"/><rect x="15" y="4" width="5" height="5" rx="1"/><rect x="4" y="15" width="5" height="5" rx="1"/><rect x="15" y="15" width="5" height="5" rx="1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1 0l1.4-1.4a5 5 0 0 0-7.1-7.1L10.6 5.3"/><path d="M14 11a5 5 0 0 0-7.1 0l-1.4 1.4a5 5 0 0 0 7.1 7.1l.8-.8"/>',
  pulse: '<path d="M4 13h4l2-7 4 14 2-7h4"/>',
  refresh:
    '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18 9a6 6 0 0 0-10-3.5L4 9"/><path d="M6 15a6 6 0 0 0 10 3.5l4-3.5"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  settings:
    '<path d="M12.2 2h-.4l-.7 2.6a7.5 7.5 0 0 0-1.7.7L7 4 4 7l1.3 2.4a7.5 7.5 0 0 0-.7 1.7L2 11.8v.4l2.6.7c.2.6.4 1.2.7 1.7L4 17l3 3 2.4-1.3c.5.3 1.1.5 1.7.7l.7 2.6h.4l.7-2.6c.6-.2 1.2-.4 1.7-.7L17 20l3-3-1.3-2.4c.3-.5.5-1.1.7-1.7l2.6-.7v-.4l-2.6-.7a7.5 7.5 0 0 0-.7-1.7L20 7l-3-3-2.4 1.3a7.5 7.5 0 0 0-1.7-.7L12.2 2Z"/><circle cx="12" cy="12" r="3"/>',
  shuffle:
    '<path d="M4 7h3c4 0 5 10 9 10h4"/><path d="M16 13l4 4-4 4"/><path d="M4 17h3c1.8 0 3-1.8 4.1-3.8"/><path d="M16 3l4 4-4 4"/><path d="M14 7h6"/>',
  timer: '<path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
  user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
};

export function icon(name: IconName) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
}

export function checkbox(name: string, label: string, checked: boolean) {
  return `
    <label class="check">
      <input name="${escapeAttr(name)}" type="checkbox" ${checked ? "checked" : ""} />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

export function emptyTableRow(message: string, colspan: number) {
  return `
    <tr>
      <td class="empty-row" colspan="${colspan}">${escapeHtml(message)}</td>
    </tr>
  `;
}

export function filterOptions(values: string[], selected: string, label = (value: string) => value) {
  return values
    .map((value) => {
      const text = label(value);
      const suffix = text === value ? "" : ` - ${text}`;
      return `<option value="${escapeAttr(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(value + suffix)}</option>`;
    })
    .join("");
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function escapeAttr(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
