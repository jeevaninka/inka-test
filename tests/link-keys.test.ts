import { describe, expect, it } from 'vitest';
import {
  buildImportedCaseIndex,
  customFieldsOf,
  datadogTestLinkKey,
  getDatadogLinkKeys,
  getExternalLinkKeys,
  getPostmanLinkKeys,
  postmanFolderLinkKey,
  postmanRequestLinkKey,
} from '@/lib/integrations/link-keys';

describe('link-keys', () => {
  it('reads custom fields from either casing', () => {
    const fields = { _postman: { collectionUid: 'c1' } };
    expect(customFieldsOf({ customFields: fields })).toEqual(fields);
    expect(customFieldsOf({ custom_fields: fields })).toEqual(fields);
    expect(customFieldsOf(null)).toEqual({});
  });

  it('derives a request key for independent Postman imports', () => {
    const keys = getPostmanLinkKeys({
      customFields: {
        _postman: { collectionUid: 'col-1', requestId: 'req-1', folderId: 'fold-1' },
      },
    });
    expect(keys.requestKeys).toEqual([postmanRequestLinkKey('col-1', 'req-1')]);
    // An independent import must not mark the whole folder as imported.
    expect(keys.folderKeys).toEqual([]);
  });

  it('derives a folder key for journey imports and legacy rows', () => {
    const journey = getPostmanLinkKeys({
      customFields: {
        _postman: { collectionUid: 'col-1', folderId: 'fold-1' },
      },
    });
    expect(journey.requestKeys).toEqual([]);
    expect(journey.folderKeys).toEqual([postmanFolderLinkKey('col-1', 'fold-1')]);
  });

  it('marks every request covered by a flow as imported', () => {
    const keys = getPostmanLinkKeys({
      customFields: {
        _postman: {
          collectionUid: 'col-1',
          requestIds: ['req-1', 'req-2'],
          linkKey: 'postman:col-1:flow:req-1,req-2',
        },
      },
    });
    expect(keys.requestKeys).toEqual([
      'postman:col-1:flow:req-1,req-2',
      postmanRequestLinkKey('col-1', 'req-1'),
      postmanRequestLinkKey('col-1', 'req-2'),
    ]);
    expect(keys.folderKeys).toEqual([]);
  });

  it('keeps the folder key plus covered requests for a full-folder flow', () => {
    const keys = getPostmanLinkKeys({
      customFields: {
        _postman: {
          collectionUid: 'col-1',
          folderId: 'fold-1',
          requestIds: ['req-1', 'req-2'],
        },
      },
    });
    expect(keys.folderKeys).toEqual([postmanFolderLinkKey('col-1', 'fold-1')]);
    expect(keys.requestKeys).toEqual([
      postmanRequestLinkKey('col-1', 'req-1'),
      postmanRequestLinkKey('col-1', 'req-2'),
    ]);
  });

  it('prefers a stored linkKey classification', () => {
    const keys = getPostmanLinkKeys({
      customFields: {
        _postman: { linkKey: 'postman:col-1:folder:fold-9', collectionUid: 'col-1' },
      },
    });
    expect(keys.folderKeys).toEqual(['postman:col-1:folder:fold-9']);
    expect(keys.requestKeys).toEqual([]);
  });

  it('returns no keys for legacy combined Datadog cases', () => {
    const keys = getDatadogLinkKeys({
      customFields: {
        _datadog: { linkKey: 'datadog:abc-123', publicIds: ['abc-123', 'def-456'] },
      },
    });
    expect(keys).toEqual([]);
  });

  it('uses the single Datadog public id for a linked case', () => {
    const keys = getDatadogLinkKeys({
      customFields: {
        _datadog: { linkKey: 'datadog:abc-123', publicIds: ['def-456'] },
      },
    });
    expect(keys).toEqual([datadogTestLinkKey('def-456')]);
  });

  it('uses a stored Datadog link key when publicIds is absent', () => {
    const keys = getDatadogLinkKeys({
      customFields: { _datadog: { linkKey: 'datadog:abc-123' } },
    });
    expect(keys).toEqual([datadogTestLinkKey('abc-123')]);
  });

  it('parses legacy JSON string custom fields', () => {
    const keys = getExternalLinkKeys({
      custom_fields: JSON.stringify({
        _datadog: { publicIds: ['xyz-789'] },
      }),
    });
    expect(keys).toEqual([datadogTestLinkKey('xyz-789')]);
  });

  it('builds a key -> case index without overwriting the first match', () => {
    const index = buildImportedCaseIndex([
      {
        id: 'case-1',
        displayId: 'INK-1',
        title: 'First',
        customFields: { _datadog: { publicIds: ['abc'] } },
      },
      {
        id: 'case-2',
        display_id: 'INK-2',
        title: 'Second',
        customFields: { _datadog: { publicIds: ['def'] } },
      },
      {
        id: 'case-3',
        display_id: 'INK-3',
        title: 'Legacy combined',
        customFields: { _datadog: { publicIds: ['abc', 'ghi'] } },
      },
    ]);

    expect(index.get('datadog:abc')?.displayId).toBe('INK-1');
    expect(index.get('datadog:def')?.displayId).toBe('INK-2');
    expect(index.get('datadog:ghi')).toBeUndefined();
  });

  it('returns no keys for untracked cases', () => {
    expect(getExternalLinkKeys({ customFields: {} })).toEqual([]);
    expect(getExternalLinkKeys({})).toEqual([]);
  });
});
