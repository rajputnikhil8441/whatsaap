// Tiny DOM builder. Text is always set via text nodes, never innerHTML,
// so database content cannot inject markup.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(props || {})) {
    if (val === null || val === undefined || val === false) continue;
    if (key === 'class') el.className = val;
    else if (key === 'dataset') Object.assign(el.dataset, val);
    else if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2), val);
    else if (val === true) el.setAttribute(key, '');
    else el.setAttribute(key, val);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function setMeta({ title, description, canonical, image, robots, type = 'website' }) {
  document.title = title;
  const set = (selector, create, value) => {
    let el = document.head.querySelector(selector);
    if (!el) {
      el = create();
      document.head.append(el);
    }
    if (value === undefined || value === null) el.remove();
    else if (el.tagName === 'LINK') el.setAttribute('href', value);
    else el.setAttribute('content', value);
  };
  const meta = (attr, name) => () => {
    const m = document.createElement('meta');
    m.setAttribute(attr, name);
    return m;
  };
  set('meta[name="description"]', meta('name', 'description'), description);
  set('meta[name="robots"]', meta('name', 'robots'), robots);
  set('meta[property="og:title"]', meta('property', 'og:title'), title);
  set('meta[property="og:description"]', meta('property', 'og:description'), description);
  set('meta[property="og:type"]', meta('property', 'og:type'), type);
  set('meta[property="og:url"]', meta('property', 'og:url'), canonical);
  set('meta[property="og:image"]', meta('property', 'og:image'), image);
  set('meta[name="twitter:card"]', meta('name', 'twitter:card'), image ? 'summary_large_image' : 'summary');
  set('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), canonical);
}
