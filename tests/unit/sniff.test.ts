import { describe, it, expect } from 'vitest';
import { sniff, checkContent, canonicalMime } from '@/server/storage/sniff';
import { safeFilename, extensionOf } from '@/server/services/files';

/**
 * Content sniffing — step 4 of the upload pipeline.
 *
 * This is the check that matters. An extension and a declared MIME type are
 * both supplied by the uploader, so agreeing with each other proves only that
 * they spelled things consistently. The first bytes of the file are the one
 * part of the request that has to be genuine for anything downstream to open
 * it, and these tests are what keep that check honest.
 */

// Real headers, not approximations — a wrong constant here would make the
// whole suite green against a sniffer that does not work.
const PDF = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const DWG = Buffer.from('AC1027\x00\x00\x00\x00', 'latin1');
const DXF_ASCII = Buffer.from('  0\r\nSECTION\r\n  2\r\nHEADER\r\n', 'latin1');
const DXF_BINARY = Buffer.from('AutoCAD Binary DXF\r\n\x1a\x00', 'latin1');

/** A Windows executable. The thing an upload endpoint exists to refuse. */
const PE_BINARY = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>', 'latin1');

describe('sniff', () => {
  it.each([
    ['pdf', PDF],
    ['png', PNG],
    ['jpeg', JPEG],
    ['zip', ZIP],
    ['dwg', DWG],
    ['dxf', DXF_ASCII],
    ['dxf', DXF_BINARY],
  ])('identifies %s from its header', (expected, buf) => {
    expect(sniff(buf)).toBe(expected);
  });

  it('returns null for anything it does not recognise', () => {
    // Null is a refusal, not "unknown, allow it" — see checkContent below.
    expect(sniff(PE_BINARY)).toBeNull();
    expect(sniff(HTML)).toBeNull();
    expect(sniff(Buffer.from('just some text'))).toBeNull();
    expect(sniff(Buffer.alloc(0))).toBeNull();
  });

  it('recognises the older DWG version stamps', () => {
    expect(sniff(Buffer.from('AC1015....', 'latin1'))).toBe('dwg');
    expect(sniff(Buffer.from('AC1032....', 'latin1'))).toBe('dwg');
  });
});

describe('checkContent', () => {
  it('accepts a genuine PDF declared as one', () => {
    const result = checkContent(PDF, 'application/pdf', 'pdf');
    expect(result).toEqual({ ok: true, kind: 'pdf' });
  });

  it('REFUSES an executable renamed to .pdf', () => {
    // The attack this whole step exists for.
    const result = checkContent(PE_BINARY, 'application/pdf', 'pdf');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/could not be recognised/i);
  });

  it('REFUSES HTML renamed to .pdf', () => {
    // Stored HTML served back at a browser is a same-origin script.
    const result = checkContent(HTML, 'application/pdf', 'pdf');
    expect(result.ok).toBe(false);
  });

  it('refuses a real PNG wearing a .pdf extension', () => {
    const result = checkContent(PNG, 'application/pdf', 'pdf');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/contents are a PNG image/i);
  });

  it('refuses a real PDF declared as something else entirely', () => {
    const result = checkContent(PDF, 'image/png', 'pdf');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/sent as image\/png/i);
  });

  it('refuses an extension that is not accepted at all', () => {
    const result = checkContent(PDF, 'application/pdf', 'exe');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/not accepted/i);
  });

  it('tolerates the many MIME types browsers invent for CAD files', () => {
    // The same .dwg arrives as different types depending on the machine, so
    // the declared value is a weak hint and the bytes decide.
    for (const declared of [
      'application/acad',
      'image/vnd.dwg',
      'application/octet-stream',
      'drawing/x-dwg',
    ]) {
      expect(checkContent(DWG, declared, 'dwg').ok, declared).toBe(true);
    }
  });

  it('still refuses a fake even when the declared type is octet-stream', () => {
    // octet-stream means "unspecified", not "trust me".
    expect(checkContent(PE_BINARY, 'application/octet-stream', 'dwg').ok).toBe(false);
  });

  it('accepts both DXF flavours', () => {
    expect(checkContent(DXF_ASCII, 'application/dxf', 'dxf').ok).toBe(true);
    expect(checkContent(DXF_BINARY, 'image/vnd.dxf', 'dxf').ok).toBe(true);
  });

  it('derives the stored MIME from the bytes, not the request', () => {
    // What comes back on download is therefore decided by what the file is.
    expect(canonicalMime('pdf')).toBe('application/pdf');
    expect(canonicalMime('dwg')).toBe('image/vnd.dwg');
    expect(canonicalMime('dxf')).toBe('image/vnd.dxf');
  });
});

describe('safeFilename', () => {
  it('leaves an ordinary drawing name alone', () => {
    // Regression: an earlier version of the sanitiser mangled this to almost
    // nothing, because a broken character class stripped lowercase letters.
    expect(safeFilename('site-plan-v1.pdf')).toBe('site-plan-v1.pdf');
    expect(safeFilename('Ground Floor Plan.dwg')).toBe('Ground Floor Plan.dwg');
  });

  it('neutralises path separators rather than deleting them', () => {
    // Deleting them would turn a/b/c.pdf into abc.pdf and hide the attempt.
    expect(safeFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeFilename('a/b/c.pdf')).toBe('a_b_c.pdf');
    expect(safeFilename('a\\b\\c.pdf')).toBe('a_b_c.pdf');
  });

  it('strips quotes, which would break a Content-Disposition header', () => {
    expect(safeFilename('plan".pdf')).not.toContain('"');
    expect(safeFilename("plan'.pdf")).not.toContain("'");
  });

  it('never returns an empty name', () => {
    expect(safeFilename('')).toBe('upload');
    expect(safeFilename('   ')).toBe('upload');
  });

  it('caps the length', () => {
    expect(safeFilename('x'.repeat(500)).length).toBeLessThanOrEqual(180);
  });

  it('reads extensions case-insensitively', () => {
    expect(extensionOf('PLAN.PDF')).toBe('pdf');
    expect(extensionOf('plan.DwG')).toBe('dwg');
    expect(extensionOf('noextension')).toBe('');
  });
});
