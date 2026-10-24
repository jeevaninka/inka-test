import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/** Hard cap for imported document bodies (characters). */
const MAX_CHARS = 30000;

export interface DocMarkdown {
  /** Document title, when the provider exposes one. */
  title: string;
  /** Full markdown document, including title / source / last-updated header. */
  markdown: string;
}

let turndownInstance: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (turndownInstance) return turndownInstance;

  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    br: '\n',
  });

  service.use(gfm);

  // Registered after the plugin so these rules take precedence (turndown
  // unshifts every added rule).

  // Confluence wraps every cell in <p>, which would otherwise emit blank lines
  // and break tables; keep each cell on a single line.
  service.addRule('stableTableCell', {
    filter: ['th', 'td'],
    replacement(content, node) {
      const parent = node.parentNode;
      const index = parent
        ? Array.prototype.indexOf.call(parent.childNodes, node)
        : 0;
      const text = content
        .replace(/\r?\n+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .replace(/\|/g, '\\|');
      const prefix = index === 0 ? '| ' : ' ';
      return `${prefix}${text} |`;
    },
  });

  // "li containing p -> single line" plus indentation for nested lists.
  service.addRule('compactListItem', {
    filter: 'li',
    replacement(content, node, options) {
      const parent = node.parentNode;
      let prefix = `${options.bulletListMarker} `;

      if (parent && parent.nodeName === 'OL') {
        const startAttr = Number((parent as any).getAttribute?.('start') || 1);
        const start = Number.isFinite(startAttr) && startAttr > 0 ? startAttr : 1;
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${start + index}. `;
      }

      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')
        .replace(/\n{2,}/g, '\n')
        .replace(/\n/g, '\n    ');

      return `${prefix}${body}\n`;
    },
  });

  turndownInstance = service;
  return service;
}

function toMarkdown(html: string): string {
  if (!html || !html.trim()) return '';
  return getTurndown().turndown(html);
}

/* -------------------------------------------------------------------------- */
/* Shared post-processing                                                     */
/* -------------------------------------------------------------------------- */

const TOKEN_PREFIX = 'INKAMDTOKEN';
const TOKEN_SUFFIX = 'ENDINKAMD';

function cleanup(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let fenceChar: string | null = null;

  for (const raw of lines) {
    const fence = raw.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (!fenceChar) {
        fenceChar = fence[1][0];
        out.push(raw.replace(/\s+$/, ''));
        continue;
      }
      if (fence[1][0] === fenceChar) {
        fenceChar = null;
        out.push(raw.replace(/\s+$/, ''));
        continue;
      }
    }

    if (fenceChar) {
      // Inside fenced code: keep content verbatim.
      out.push(raw);
      continue;
    }

    let line = raw.replace(/\s+$/, '');
    line = line.replace(/^(\s*)[-*+]\s{2,}/, '$1- ');
    line = line.replace(/^(\s*)(\d+)[.)]\s{2,}/, '$1$2. ');
    line = line.replace(
      /^(\s*)(#{1,6})\s+(.*)$/,
      (_m, indent: string, hashes: string, text: string) =>
        `${indent}${hashes} ${text.trim().replace(/\\\./g, '.')}`.replace(/\s+$/, '')
    );
    line = line.replace(/^(\s*)(\d+)\\\.\s+/, '$1$2. ');
    line = line.replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ');
    if (/^\s*#{1,6}\s*$/.test(line)) continue; // empty heading
    out.push(line.replace(/\u00a0/g, ' '));
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function truncate(markdown: string): string {
  if (markdown.length <= MAX_CHARS) return markdown;
  const slice = markdown.slice(0, MAX_CHARS);
  const lastBreak = slice.lastIndexOf('\n');
  const body = (lastBreak > MAX_CHARS * 0.6 ? slice.slice(0, lastBreak) : slice)
    .replace(/\s+$/, '');
  return `${body}\n\n[Content truncated]`;
}

/* -------------------------------------------------------------------------- */
/* HTML -> Markdown (generic docs: Notion exports, Confluence HTML, etc.)      */
/* -------------------------------------------------------------------------- */

function normalizeTables($: CheerioAPI): void {
  $('table').each((_index, table) => {
    const tableEl = $(table);

    // GFM header detection breaks when a colgroup/caption precedes the rows.
    tableEl.find('colgroup, col').remove();

    // Cells are flattened to a single line, so headings inside them would leak
    // raw "###" markers; render them as bold text instead.
    tableEl.find('th, td').each((_cellIndex, cell) => {
      const cellEl = $(cell);
      cellEl.find('h1, h2, h3, h4, h5, h6').each((_headingIndex, heading) => {
        const text = $(heading).text().replace(/\s+/g, ' ').trim();
        if (text) $(heading).replaceWith(`<p><strong>${escapeHtmlText(text)}</strong></p>`);
        else $(heading).remove();
      });
      cellEl.find('hr').remove();
    });

    // Flatten thead/tbody/tfoot so the first row is a direct child of <table>.
    tableEl.children('thead, tbody, tfoot').each((_i, section) => {
      const rows = $(section).children('tr');
      if (rows.length) $(section).replaceWith(rows);
      else $(section).remove();
    });

    const rows = tableEl.children('tr');
    if (rows.length < 2) return;

    const firstRow = rows.first();
    if (firstRow.children('th').length === 0) {
      // GFM tables need a header row; promote the first row when missing.
      firstRow.children('td').each((_cellIndex, cell) => {
        const node = cell as any;
        node.name = 'th';
        node.tagName = 'th';
      });
    }
  });
}

export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return '';
  const $ = cheerio.load(`<div id="inka-doc-root">${html}</div>`);
  $('script, style, noscript').remove();
  normalizeTables($);
  const body = $('#inka-doc-root').html() || '';
  return truncate(cleanup(toMarkdown(body)));
}

/* -------------------------------------------------------------------------- */
/* Confluence storage format -> Markdown                                      */
/* -------------------------------------------------------------------------- */

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtmlText(value).replace(/"/g, '&quot;');
}

/**
 * Confluence storage format is XHTML-ish but served as HTML: self-closing
 * namespaced tags (`<ri:page ... />`) would otherwise swallow siblings, and
 * CDATA sections would leak their markers into the output.
 */
function normalizeStorageHtml(html: string): string {
  const withCdata = html.replace(
    /<!\[CDATA\[([\s\S]*?)\]\]>/g,
    (_match, inner: string) => escapeHtmlText(inner)
  );
  return withCdata.replace(
    /<((?:ac|ri):[A-Za-z0-9_-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)\s*\/>/g,
    '<$1$2></$1>'
  );
}

function elName(el: any): string {
  return String(el?.name || el?.tagName || '').toLowerCase();
}

function elementsByName($: CheerioAPI, names: string[]): any[] {
  const wanted = new Set(names);
  return $('*')
    .toArray()
    .filter((el: any) => wanted.has(elName(el)));
}

function childByName($: CheerioAPI, el: any, name: string): any | undefined {
  return $(el)
    .children()
    .toArray()
    .find((child: any) => elName(child) === name);
}

function childHtml($: CheerioAPI, el: any): string {
  return el ? $(el).html() || '' : '';
}

function fenceFor(code: string, language: string): string {
  const fence = code.includes('```') ? '````' : '```';
  return `${fence}${language}\n${code.replace(/\s+$/, '')}\n${fence}`;
}

function singleLine(markdown: string): string {
  return markdown
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Macros whose entire subtree is noise for an LLM prompt. */
const DROPPED_MACROS = new Set([
  'toc',
  'children',
  'pagetree',
  'anchor',
  'recently-updated',
  'recently-updated-dashboard',
  'livesearch',
  'contentbylabel',
  'content-report-table',
  'spaces',
  'space-details',
  'contributors',
  'contributors-summary',
  'change-history',
  'rss',
  'popularlabels',
  'related-labels',
  'navmap',
  'gallery',
]);

const NOTICE_MACROS = new Set(['info', 'note', 'tip', 'warning']);

function preprocessConfluence(
  $: CheerioAPI,
  addToken: (markdown: string) => string
): void {
  // Structured macros, innermost first so nested macros are already converted.
  const macros = elementsByName($, ['ac:structured-macro']);
  for (let i = macros.length - 1; i >= 0; i--) {
    const macro = macros[i];
    if (!macro.parent) continue;

    const name = String($(macro).attr('ac:name') || '').toLowerCase();
    const bodyEl =
      childByName($, macro, 'ac:rich-text-body') ??
      childByName($, macro, 'ac:plain-text-body');
    const bodyHtml = childHtml($, bodyEl);
    const bodyText = bodyEl ? $(bodyEl).text().trim() : '';

    const params = new Map<string, string>();
    $(macro)
      .children()
      .toArray()
      .filter((child: any) => elName(child) === 'ac:parameter')
      .forEach((param: any) => {
        const key = String($(param).attr('ac:name') || '').toLowerCase();
        params.set(key, $(param).text().trim());
      });

    const replaceWithToken = (markdown: string) => {
      $(macro).replaceWith(`<span>${addToken(markdown)}</span>`);
    };

    if (DROPPED_MACROS.has(name)) {
      $(macro).remove();
      continue;
    }

    if (NOTICE_MACROS.has(name)) {
      $(macro).replaceWith(
        `<blockquote><p><strong>Note:</strong></p><div>${bodyHtml}</div></blockquote>`
      );
      continue;
    }

    if (name === 'status') {
      const title = (params.get('title') || bodyText || '').trim();
      if (!title) {
        $(macro).remove();
      } else {
        replaceWithToken(`[${title}]`);
      }
      continue;
    }

    if (name === 'jira') {
      const key = (params.get('key') || bodyText || '').trim();
      if (!key) {
        $(macro).remove();
      } else {
        replaceWithToken(key);
      }
      continue;
    }

    if (name === 'expand' || name === 'panel') {
      const title = (params.get('title') || '').trim();
      const heading = title ? `<h4>${escapeHtmlText(title)}</h4>` : '';
      $(macro).replaceWith(`${heading}<div>${bodyHtml}</div>`);
      continue;
    }

    if (name === 'code' || name === 'noformat') {
      const language = (params.get('language') || '').toLowerCase().trim();
      const code = bodyEl ? $(bodyEl).text() : '';
      if (code.trim()) {
        replaceWithToken(fenceFor(code, language === 'none' ? '' : language));
      } else {
        $(macro).remove();
      }
      continue;
    }

    // Unknown macros: keep inner text, drop the wrapper.
    if (bodyEl) {
      $(macro).replaceWith(bodyHtml || '');
    } else {
      $(macro).remove();
    }
  }

  // ac:task-list -> markdown checklist.
  const taskLists = elementsByName($, ['ac:task-list']);
  for (let i = taskLists.length - 1; i >= 0; i--) {
    const list = taskLists[i];
    if (!list.parent) continue;
    const tasks = $(list)
      .children()
      .toArray()
      .filter((child: any) => elName(child) === 'ac:task');

    if (!tasks.length) {
      $(list).remove();
      continue;
    }

    const lines = tasks.map((task: any) => {
      const status = childByName($, task, 'ac:task-status');
      const body = childByName($, task, 'ac:task-body');
      const done = status
        ? $(status).text().trim().toLowerCase() === 'complete'
        : false;
      const bodyMarkdown = body ? singleLine(toMarkdown(childHtml($, body))) : '';
      return `- [${done ? 'x' : ' '}] ${bodyMarkdown}`.replace(/\s+$/, '');
    });

    $(list).replaceWith(`<p>${addToken(lines.join('\n'))}</p>`);
  }

  // ac:link -> page title / attachment name / real link.
  const links = elementsByName($, ['ac:link']);
  for (let i = links.length - 1; i >= 0; i--) {
    const link = links[i];
    if (!link.parent) continue;

    const page = childByName($, link, 'ri:page');
    const attachment = childByName($, link, 'ri:attachment');
    const target = childByName($, link, 'ri:url');
    const bodyEl =
      childByName($, link, 'ac:link-body') ??
      childByName($, link, 'ac:plain-text-link-body');
    const bodyText = bodyEl ? $(bodyEl).text().trim() : '';

    if (page) {
      const pageTitle = String($(page).attr('ri:content-title') || '').trim();
      const title = bodyText || pageTitle;
      if (title) {
        $(link).replaceWith(`<span>${addToken(title)}</span>`);
      } else {
        $(link).replaceWith(childHtml($, link) || '');
      }
      continue;
    }

    if (attachment) {
      const filename = String(
        $(attachment).attr('ri:filename') || bodyText || 'attachment'
      ).trim();
      $(link).replaceWith(`<span>${addToken(filename)}</span>`);
      continue;
    }

    if (target) {
      const href = String($(target).attr('ri:value') || '').trim();
      const text = bodyText || href;
      if (href) {
        $(link).replaceWith(
          `<a href="${escapeAttr(href)}">${escapeHtmlText(text)}</a>`
        );
      } else {
        $(link).replaceWith(escapeHtmlText(text));
      }
      continue;
    }

    $(link).replaceWith(childHtml($, link) || bodyText);
  }

  // ac:image -> readable placeholder.
  const images = elementsByName($, ['ac:image']);
  for (let i = images.length - 1; i >= 0; i--) {
    const image = images[i];
    if (!image.parent) continue;
    const attachment = childByName($, image, 'ri:attachment');
    const target = childByName($, image, 'ri:url');
    let placeholder = '';
    if (attachment) {
      const filename = String(
        $(attachment).attr('ri:filename') || 'attachment'
      ).trim();
      placeholder = `[Image: ${filename}]`;
    } else if (target) {
      const href = String($(target).attr('ri:value') || '').trim();
      if (href) placeholder = `[Image](${href})`;
    }
    if (placeholder) {
      $(image).replaceWith(`<span>${addToken(placeholder)}</span>`);
    } else {
      $(image).remove();
    }
  }

  // Noise elements.
  const noise = new Set(['ac:emoticon', 'ac:placeholder']);
  elementsByName($, [...noise]).forEach((el: any) => $(el).remove());

  // Any remaining namespaced wrapper: keep the text, drop the element.
  const leftovers = $('*')
    .toArray()
    .filter((el: any) => /^(ac|ri):/.test(elName(el)));
  for (let i = leftovers.length - 1; i >= 0; i--) {
    const el = leftovers[i];
    if (!el.parent) continue;
    const children = $(el).children();
    if (children.length) {
      $(el).replaceWith(children);
    } else {
      $(el).remove();
    }
  }

  // Table cells: join list items into a single "a; b" cell.
  $('td, th')
    .toArray()
    .forEach((cell: any) => {
      $(cell)
        .find('ul, ol')
        .toArray()
        .forEach((list: any) => {
          if (!list.parent) return;
          const items = $(list)
            .children('li')
            .toArray()
            .map((li: any) => $(li).text().replace(/\s+/g, ' ').trim())
            .filter(Boolean);
          $(list).replaceWith(items.join('; '));
        });
    });
}

export function confluenceStorageToMarkdown(storageHtml: string): string {
  if (!storageHtml || !storageHtml.trim()) return '';

  const tokens: string[] = [];
  const addToken = (markdown: string) => {
    tokens.push(markdown);
    return `${TOKEN_PREFIX}${tokens.length - 1}${TOKEN_SUFFIX}`;
  };

  const html = normalizeStorageHtml(storageHtml);
  const $ = cheerio.load(`<div id="inka-doc-root">${html}</div>`);
  preprocessConfluence($, addToken);
  normalizeTables($);
  const bodyHtml = $('#inka-doc-root').html() || '';
  let markdown = cleanup(toMarkdown(bodyHtml));

  tokens.forEach((value, index) => {
    markdown = markdown.split(`${TOKEN_PREFIX}${index}${TOKEN_SUFFIX}`).join(value);
  });

  return truncate(markdown.trim());
}

/* -------------------------------------------------------------------------- */
/* Notion blocks -> Markdown                                                  */
/* -------------------------------------------------------------------------- */

function notionRichText(richText: any[] | undefined): string {
  if (!Array.isArray(richText)) return '';
  return richText
    .map((item: any) => {
      const plain = String(item?.plain_text ?? item?.text?.content ?? '');
      if (!plain) return '';
      let text = plain;
      const annotations = item?.annotations || {};
      if (annotations.code) text = `\`${text}\``;
      if (annotations.bold) text = `**${text}**`;
      if (annotations.italic) text = `*${text}*`;
      if (annotations.strikethrough) text = `~~${text}~~`;
      if (item?.href) text = `[${text}](${item.href})`;
      return text;
    })
    .join('');
}

function notionLanguage(language: string | undefined): string {
  const value = String(language || '').toLowerCase().trim();
  return value === 'plain text' || value === 'plaintext' ? '' : value;
}

function notionTableMarkdown(blocks: any[]): string {
  const rows = blocks.filter((block: any) => block?.type === 'table_row');
  if (!rows.length) return '';
  const grid = rows.map((row: any) =>
    (row?.table_row?.cells || []).map((cell: any[]) =>
      notionRichText(cell).replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ').trim()
    )
  );
  const width = Math.max(...grid.map((cells: string[]) => cells.length));
  const renderRow = (cells: string[]) =>
    `| ${cells
      .concat(Array(Math.max(0, width - cells.length)).fill(''))
      .join(' | ')} |`;

  const lines = [renderRow(grid[0]), `| ${Array(width).fill('---').join(' | ')} |`];
  grid.slice(1).forEach((cells) => lines.push(renderRow(cells)));
  return lines.join('\n');
}

export function notionBlocksToMarkdown(blocks: any[], depth = 0): string {
  const lines: string[] = [];
  const indent = depth > 0 ? '  '.repeat(depth) : '';

  for (const block of blocks || []) {
    const type = String(block?.type || '');
    const value = block?.[type] || {};
    const children: any[] = Array.isArray(block?._children) ? block._children : [];
    const text = notionRichText(value.rich_text);

    switch (type) {
      case 'paragraph':
        if (text.trim()) lines.push(indent + text);
        break;
      case 'heading_1':
        if (text.trim()) lines.push('', `# ${text}`);
        break;
      case 'heading_2':
        if (text.trim()) lines.push('', `## ${text}`);
        break;
      case 'heading_3':
        if (text.trim()) lines.push('', `### ${text}`);
        break;
      case 'bulleted_list_item':
        lines.push(`${indent}- ${text}`);
        break;
      case 'numbered_list_item':
        lines.push(`${indent}1. ${text}`);
        break;
      case 'to_do':
        lines.push(`${indent}- [${value.checked ? 'x' : ' '}] ${text}`);
        break;
      case 'toggle':
        lines.push(`${indent}- **${text || 'Details'}**`);
        break;
      case 'quote':
        lines.push('', `> ${text}`);
        break;
      case 'callout':
        lines.push(
          '',
          `> ${value.icon?.emoji ? `${value.icon.emoji} ` : ''}${text}`
        );
        break;
      case 'divider':
        lines.push('', '---', '');
        break;
      case 'code':
        if (text.trim()) {
          lines.push('', fenceFor(text, notionLanguage(value.language)));
        }
        break;
      case 'image': {
        const url =
          value.type === 'external'
            ? value.external?.url
            : value.file?.url || '';
        const caption = notionRichText(value.caption).trim();
        if (url) lines.push('', `[Image: ${caption || 'image'}](${url})`);
        break;
      }
      case 'bookmark':
      case 'link_preview':
      case 'embed': {
        const url = String(value.url || '').trim();
        if (url) lines.push('', `[${text.trim() || url}](${url})`);
        break;
      }
      case 'child_page':
        if (value.title) lines.push('', `### ${value.title}`);
        break;
      case 'child_database':
        if (value.title) lines.push('', `### ${value.title}`);
        break;
      case 'table':
        lines.push('', notionTableMarkdown(children), '');
        break;
      case 'table_row':
        break;
      default:
        if (text.trim()) lines.push(indent + text);
        break;
    }

    if (children.length) {
      const listLike =
        type === 'bulleted_list_item' ||
        type === 'numbered_list_item' ||
        type === 'to_do' ||
        type === 'toggle';
      if (type === 'table' || type === 'table_row') continue;
      const childMarkdown = notionBlocksToMarkdown(children, listLike ? depth + 1 : depth);
      if (childMarkdown.trim()) lines.push(childMarkdown);
    }
  }

  return lines.join('\n');
}

export function notionBlocksToDocumentMarkdown(blocks: any[]): string {
  return truncate(cleanup(notionBlocksToMarkdown(blocks)));
}

/* -------------------------------------------------------------------------- */
/* Document assembly                                                          */
/* -------------------------------------------------------------------------- */

export function composeDocument(input: {
  title: string;
  sourceUrl?: string;
  lastUpdated?: string;
  body: string;
}): string {
  const title = input.title.trim() || 'Untitled document';
  const meta: string[] = [];
  if (input.sourceUrl?.trim()) meta.push(`Source: ${input.sourceUrl.trim()}`);
  if (input.lastUpdated?.trim()) meta.push(`Last updated: ${input.lastUpdated.trim()}`);

  const body = input.body.trim();
  return [`# ${title}`, '', ...meta, ...(meta.length ? [''] : []), body]
    .join('\n')
    .trim();
}
