// Segurança (ficha do M15, seção 10): XML com entidade externa recusado; entidades só as predefinidas.
import { describe, expect, it } from 'vitest';
import { decodificarEntidades, ErroXml, filho, lerXml, procurar, soTexto, textoXml } from './xml-seguro.js';

describe('leitor de XML seguro', () => {
  it('lê elementos, atributos, texto, CDATA e comentários', () => {
    const r = lerXml(
      '<?xml version="1.0"?><!-- c --><a x="1" y=\'2\'><b>t &amp; u &#233;&#xE9;</b><c/><d><![CDATA[<cru>]]></d></a>',
    );
    expect(r.nome).toBe('a');
    expect(r.atributos).toEqual({ x: '1', y: '2' });
    expect(textoXml(filho(r, 'b'))).toBe('t & u éé');
    expect(textoXml(filho(r, 'd'))).toBe('<cru>');
    expect(filho(r, 'c')?.filhos).toEqual([]);
    expect(soTexto(filho(r, 'b')!)).toBe(true);
    expect(procurar(r, 'c')?.nome).toBe('c');
    expect(procurar(r, 'z')).toBeNull();
  });

  it('recusa DOCTYPE e entidade externa', () => {
    expect(() =>
      lerXml('<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>'),
    ).toThrow(ErroXml);
    expect(() => lerXml('<a><!ENTITY x "y"></a>')).toThrow(/entidade/i);
  });

  it('recusa entidade desconhecida e referência inválida', () => {
    expect(() => decodificarEntidades('&nbsp;')).toThrow(ErroXml);
    expect(() => decodificarEntidades('&#xD800;')).toThrow(ErroXml);
    expect(decodificarEntidades('&lt;&gt;&quot;&apos;')).toBe('<>"\'');
  });

  it('recusa documento malformado', () => {
    for (const x of [
      '<a><b></a>',
      '<a>',
      'texto',
      '<a></a><b></b>',
      '<a x=1></a>',
      '<a x></a>',
      '<1/>',
      '<a><!x></a>',
    ])
      expect(() => lerXml(x), x).toThrow(ErroXml);
  });
});
