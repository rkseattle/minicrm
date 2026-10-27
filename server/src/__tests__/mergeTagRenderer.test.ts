import { describe, it, expect } from 'vitest';

import { renderTemplate } from '../services/mergeTagRenderer.js';

describe('renderTemplate', () => {
  it.each([
    ['contact', '{{contact.first_name}}', { 'contact.first_name': 'Ada' }],
    ['lead', '{{lead.company}}', { 'lead.company': 'Acme' }],
    ['account', '{{account.name}}', { 'account.name': 'Globex' }],
    ['deal', '{{deal.name}}', { 'deal.name': 'Renewal' }],
  ])('resolves a %s token in the subject and body', (_type, token, context) => {
    const value = Object.values(context)[0];

    const rendered = renderTemplate({ subject: `Hi ${token}`, body: `<p>${token}</p>` }, context);

    expect(rendered.subject).toBe(`Hi ${value}`);
    expect(rendered.bodyHtml).toBe(`<p>${value}</p>`);
    expect(rendered.unresolved).toEqual([]);
  });

  it('renders a token with no value as empty and reports it', () => {
    const rendered = renderTemplate(
      { subject: 'Hi {{contact.first_name}}', body: '<p>{{contact.first_name}}</p>' },
      { 'contact.first_name': null },
    );

    expect(rendered.subject).toBe('Hi ');
    expect(rendered.bodyHtml).toBe('<p></p>');
    expect(rendered.unresolved).toEqual(['contact.first_name']);
  });

  it('renders a token naming no known field as empty rather than leaving template syntax', () => {
    const rendered = renderTemplate({ subject: '{{contact.shoe_size}}', body: 'x' }, {});

    expect(rendered.subject).toBe('');
    expect(rendered.unresolved).toEqual(['contact.shoe_size']);
  });

  it('replaces every occurrence of a token used twice', () => {
    const rendered = renderTemplate(
      {
        subject: '{{contact.first_name}}',
        body: '{{contact.first_name}} and {{contact.first_name}}',
      },
      { 'contact.first_name': 'Ada' },
    );

    expect(rendered.bodyHtml).toBe('Ada and Ada');
  });

  it('tolerates whitespace inside the braces and any case in the path', () => {
    const rendered = renderTemplate(
      { subject: '{{ Contact.First_Name }}', body: '' },
      { 'contact.first_name': 'Ada' },
    );

    expect(rendered.subject).toBe('Ada');
  });

  it('keeps replacement metacharacters in a value literal', () => {
    const rendered = renderTemplate(
      { subject: '{{account.name}}', body: '{{account.name}}' },
      { 'account.name': "$& $1 $$ $' (a|b)*" },
    );

    expect(rendered.subject).toBe("$& $1 $$ $' (a|b)*");
  });

  it('keeps regex metacharacters in the template literal', () => {
    const rendered = renderTemplate(
      { subject: 'Price: $5.00 (approx.) [{{deal.name}}]', body: '.*+?^${}()|[]\\' },
      { 'deal.name': 'Renewal' },
    );

    expect(rendered.subject).toBe('Price: $5.00 (approx.) [Renewal]');
    expect(rendered.bodyHtml).toBe('.*+?^${}()|[]\\');
  });

  it('escapes a value placed into the HTML body, so a field cannot inject markup', () => {
    const rendered = renderTemplate(
      { subject: '{{contact.first_name}}', body: '<p>{{contact.first_name}}</p>' },
      { 'contact.first_name': '<img src=x onerror="alert(1)"> & \'quoted\'' },
    );

    expect(rendered.bodyHtml).toBe(
      '<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;</p>',
    );
    expect(rendered.subject).toBe('<img src=x onerror="alert(1)"> & \'quoted\'');
  });

  it('leaves text that only resembles a token untouched', () => {
    const rendered = renderTemplate(
      { subject: '{{ }} {{1abc}} {contact.first_name}', body: '' },
      {},
    );

    expect(rendered.subject).toBe('{{ }} {{1abc}} {contact.first_name}');
    expect(rendered.unresolved).toEqual([]);
  });

  it.each(['', '   '])('treats a value of %j as missing', (value) => {
    const rendered = renderTemplate(
      { subject: 'Hi {{contact.first_name}}', body: '' },
      { 'contact.first_name': value },
    );

    expect(rendered.subject).toBe('Hi ');
    expect(rendered.unresolved).toEqual(['contact.first_name']);
  });

  it.each(['{{constructor}}', '{{__proto__}}', '{{toString}}', '{{contact.constructor}}'])(
    'never reads %s off the object prototype, in the subject or the body',
    (token) => {
      const rendered = renderTemplate({ subject: token, body: `<p>${token}</p>` }, {});

      expect(rendered.subject).toBe('');
      expect(rendered.bodyHtml).toBe('<p></p>');
    },
  );

  it('uses the default an author wrote when the field is missing', () => {
    const rendered = renderTemplate(
      {
        subject: 'Hi {{contact.first_name | default: "there"}}',
        body: '<p>Hi {{ contact.first_name|default:"there" }},</p>',
      },
      { 'contact.first_name': null },
    );

    expect(rendered.subject).toBe('Hi there');
    expect(rendered.bodyHtml).toBe('<p>Hi there,</p>');
    expect(rendered.unresolved).toEqual([]);
  });

  it('prefers the field over its default when the field has a value', () => {
    const rendered = renderTemplate(
      { subject: '{{contact.first_name | default: "there"}}', body: '' },
      { 'contact.first_name': 'Ada' },
    );

    expect(rendered.subject).toBe('Ada');
  });

  it('escapes a default placed into the body like any other substituted text', () => {
    const rendered = renderTemplate(
      { subject: '', body: '{{contact.first_name | default: "<b>friend</b>"}}' },
      {},
    );

    expect(rendered.bodyHtml).toBe('&lt;b&gt;friend&lt;/b&gt;');
  });

  it('reports a field once however its tokens are cased', () => {
    const rendered = renderTemplate(
      { subject: '{{Contact.First_Name}} {{contact.first_name}}', body: '' },
      {},
    );

    expect(rendered.unresolved).toEqual(['contact.first_name']);
  });

  it('matches a context key whatever its case', () => {
    const rendered = renderTemplate(
      { subject: '{{contact.first_name}}', body: '' },
      { 'contact.First_Name': 'Ada' },
    );

    expect(rendered.subject).toBe('Ada');
  });

  it('accepts a single-quoted default, as Liquid does', () => {
    const rendered = renderTemplate(
      { subject: "Hi {{contact.first_name | default: 'there'}}", body: '' },
      {},
    );

    expect(rendered.subject).toBe('Hi there');
  });

  it('treats an empty default as a deliberate blank, not a gap to warn about', () => {
    const rendered = renderTemplate(
      { subject: 'Hi{{contact.first_name | default: ""}}', body: '' },
      {},
    );

    expect(rendered.subject).toBe('Hi');
    expect(rendered.unresolved).toEqual([]);
  });

  it('renders a token with an unsupported filter as empty and reports it, never as raw syntax', () => {
    const rendered = renderTemplate(
      { subject: 'Hi {{contact.first_name | upcase}}', body: '' },
      { 'contact.first_name': null },
    );

    expect(rendered.subject).toBe('Hi ');
    expect(rendered.unresolved).toEqual(['contact.first_name']);
  });

  it('still renders the value of a token with an unsupported filter', () => {
    const rendered = renderTemplate(
      { subject: '{{contact.first_name | upcase}}', body: '' },
      { 'contact.first_name': 'Ada' },
    );

    expect(rendered.subject).toBe('Ada');
  });
});
