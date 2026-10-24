import { describe, expect, it } from 'vitest';
import {
  composeDocument,
  confluenceStorageToMarkdown,
  htmlToMarkdown,
  notionBlocksToDocumentMarkdown,
} from '@/lib/integrations/doc-markdown';

const STORAGE = `
<h2>Requirements</h2>
<table>
  <colgroup><col /><col /></colgroup>
  <tbody>
    <tr><th><p>Requirement</p></th><th><p>Priority</p></th></tr>
    <tr><td><p>Super Top-Up tab</p></td><td><p>P0</p></td></tr>
    <tr><td><p>Deductible chip</p></td><td><p>P1</p></td></tr>
  </tbody>
</table>
<h2>Acceptance criteria</h2>
<ul>
  <li><p>Criterion one</p></li>
  <li><p>Criterion two</p></li>
  <li><p>Criterion three</p></li>
</ul>
<p>Design: <a href="https://www.figma.com/design/abc123/Inka?node-id=1-2">Figma</a></p>
<p>&ldquo;Quoted&rdquo; text&nbsp;with&nbsp;entities &amp; it&#39;s fine.</p>
`;

describe('confluenceStorageToMarkdown', () => {
  const markdown = confluenceStorageToMarkdown(STORAGE);

  it('keeps requirement tables as GFM tables', () => {
    expect(markdown).toContain('| Requirement | Priority |');
    expect(markdown).toContain('| --- | --- |');
    expect(markdown).toContain('| Super Top-Up tab | P0 |');
  });

  it('renders acceptance criteria as one list item per line', () => {
    const criteria = markdown
      .split('\n')
      .filter((line) => line.startsWith('- Criterion'));
    expect(criteria).toEqual([
      '- Criterion one',
      '- Criterion two',
      '- Criterion three',
    ]);
  });

  it('preserves design links and status text', () => {
    expect(markdown).toContain(
      '[Figma](https://www.figma.com/design/abc123/Inka?node-id=1-2)'
    );
    expect(markdown).toContain('P0');
  });

  it('decodes HTML entities and collapses nbsp', () => {
    expect(markdown).toContain('“Quoted” text with entities & it\'s fine.');
    expect(markdown).not.toMatch(/&(ldquo|rdquo|nbsp|amp|#39);/);
  });
});

describe('confluence macros', () => {
  it('converts notices, statuses, jira keys, tasks, code and images', () => {
    const markdown = confluenceStorageToMarkdown(`
      <ac:structured-macro ac:name="info"><ac:rich-text-body><p>Heads up</p></ac:rich-text-body></ac:structured-macro>
      <p><ac:structured-macro ac:name="status"><ac:parameter ac:name="title">P0</ac:parameter></ac:structured-macro></p>
      <p><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">INK-427</ac:parameter></ac:structured-macro></p>
      <ac:task-list>
        <ac:task><ac:task-status>complete</ac:task-status><ac:task-body>Done</ac:task-body></ac:task>
        <ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>Pending</ac:task-body></ac:task>
      </ac:task-list>
      <ac:structured-macro ac:name="code"><ac:parameter ac:name="language">js</ac:parameter><ac:plain-text-body>const a = 1;</ac:plain-text-body></ac:structured-macro>
      <p><ac:image><ri:attachment ri:filename="mock.png" /></ac:image></p>
      <ac:structured-macro ac:name="toc"></ac:structured-macro>
      <p>See <ac:link><ri:page ri:content-title="Some Page" /></ac:link></p>
    `);

    expect(markdown).toContain('> **Note:**');
    expect(markdown).toContain('Heads up');
    expect(markdown).toContain('[P0]');
    expect(markdown).toContain('INK-427');
    expect(markdown).toContain('- [x] Done');
    expect(markdown).toContain('- [ ] Pending');
    expect(markdown).toContain('```js\nconst a = 1;\n```');
    expect(markdown).toContain('[Image: mock.png]');
    expect(markdown).toContain('See Some Page');
    expect(markdown).not.toContain('ac:');
  });

  it('joins list items inside table cells with a semicolon', () => {
    const markdown = confluenceStorageToMarkdown(`
      <table><tbody>
        <tr><th>Item</th><th>Notes</th></tr>
        <tr><td><ul><li>one</li><li>two</li></ul></td><td>ok</td></tr>
      </tbody></table>
    `);
    expect(markdown).toContain('| one; two | ok |');
  });
});

describe('htmlToMarkdown', () => {
  it('converts generic HTML documents (Notion exports, docs links)', () => {
    const markdown = htmlToMarkdown(
      '<h1>Title</h1><p>Body <strong>bold</strong></p><ul><li><p>a</p></li><li><p>b</p></li></ul>'
    );
    expect(markdown).toContain('# Title');
    expect(markdown).toContain('Body **bold**');
    expect(markdown).toContain('- a\n- b');
  });
});

describe('notionBlocksToDocumentMarkdown', () => {
  it('renders headings, lists, todos, code and tables', () => {
    const markdown = notionBlocksToDocumentMarkdown([
      {
        type: 'heading_2',
        heading_2: { rich_text: [{ plain_text: 'Scope' }] },
      },
      {
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ plain_text: 'First' }] },
      },
      {
        type: 'to_do',
        to_do: { rich_text: [{ plain_text: 'Ship it' }], checked: true },
      },
      {
        type: 'code',
        code: { rich_text: [{ plain_text: 'SELECT 1;' }], language: 'sql' },
      },
      {
        type: 'table',
        table: {},
        _children: [
          {
            type: 'table_row',
            table_row: {
              cells: [
                [{ plain_text: 'Name' }],
                [{ plain_text: 'Value' }],
              ],
            },
          },
          {
            type: 'table_row',
            table_row: {
              cells: [[{ plain_text: 'a' }], [{ plain_text: 'b' }]],
            },
          },
        ],
      },
    ]);

    expect(markdown).toContain('## Scope');
    expect(markdown).toContain('- First');
    expect(markdown).toContain('- [x] Ship it');
    expect(markdown).toContain('```sql\nSELECT 1;\n```');
    expect(markdown).toContain('| Name | Value |');
    expect(markdown).toContain('| a | b |');
  });
});

describe('composeDocument', () => {
  it('builds the title / source / last updated header', () => {
    const doc = composeDocument({
      title: 'PRD',
      sourceUrl: 'https://example.com/page',
      lastUpdated: '2026-07-02 12:03 UTC by Jane',
      body: 'Body text',
    });
    expect(doc).toBe(
      '# PRD\n\nSource: https://example.com/page\nLast updated: 2026-07-02 12:03 UTC by Jane\n\nBody text'
    );
  });

  it('omits empty metadata lines', () => {
    expect(composeDocument({ title: 'PRD', body: 'Body' })).toBe('# PRD\n\nBody');
  });
});
