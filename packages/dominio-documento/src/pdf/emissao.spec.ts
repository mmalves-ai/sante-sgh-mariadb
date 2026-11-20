import { describe, expect, it } from 'vitest';
import {
  chaveObjeto,
  type EmissaoDocumento,
  ErroEmissao,
  exigirMotivo,
  novoIdentificadorQr,
  proximaVia,
  rotuloVia,
  sha256Hex,
  validacaoPublica,
} from './emissao.js';
import { escaparHtml, fonteEmbutida, htmlDocumento, rodapeCertificacaoSbis } from './modelo.js';
import { qrSvg, urlValidacao } from './qr.js';

const original: EmissaoDocumento = {
  id: '00000000-0000-4000-8000-000000000001',
  rede: 'rede-teste',
  estabelecimento: 'zz',
  modelo: 'prova',
  versaoModelo: '1',
  origem: { tipo: 'paciente', idLegado: 900001 },
  via: 1,
  idOriginal: null,
  motivoReemissao: null,
  sha256: 'a'.repeat(64),
  chaveObjeto: 'rede-teste/zz/documentos/prova/00000000-0000-4000-8000-000000000001/via-1.pdf',
  identificadorQr: 'AAAAAAAAAAAAAAAAAAAAAA',
  autor: 'USUARIO_TESTE',
  emitidoEm: '2026-10-19T12:00:00.000Z',
  versaoS3: 'v-1',
};

describe('emissão, 2ª via e validação pública (regra 9)', () => {
  it('chave única por emissão e via, com o código da rede', () => {
    expect(chaveObjeto(original)).toBe(original.chaveObjeto);
    expect(chaveObjeto({ ...original, via: 2 })).toMatch(/via-2\.pdf$/);
    expect(() => chaveObjeto({ ...original, rede: 'Rede Teste' })).toThrow(ErroEmissao);
    expect(() => chaveObjeto({ ...original, id: 'x' })).toThrow(/Identificador/);
    // Segmentos no tamanho das colunas: estabelecimento até 20, rede até 63, modelo até 40.
    expect(chaveObjeto({ ...original, estabelecimento: 'e'.repeat(20) })).toContain('e'.repeat(20));
    expect(() => chaveObjeto({ ...original, estabelecimento: 'e'.repeat(21) })).toThrow(/estabelecimento/);
    expect(chaveObjeto({ ...original, rede: 'r'.repeat(63) })).toContain('r'.repeat(63));
    expect(() => chaveObjeto({ ...original, rede: 'r'.repeat(64) })).toThrow(/rede/);
    expect(() => chaveObjeto({ ...original, modelo: 'm'.repeat(41) })).toThrow(/modelo/);
    expect(() => chaveObjeto({ ...original, via: 0 })).toThrow(/Via/);
  });

  it('reemissão é nova via marcada, com motivo, a partir da 1ª via', () => {
    expect(rotuloVia(1)).toBeNull();
    expect(rotuloVia(2)).toBe('2ª via');
    expect(() => rotuloVia(0)).toThrow(ErroEmissao);
    const segunda = {
      ...original,
      id: '00000000-0000-4000-8000-000000000002',
      via: 2,
      idOriginal: original.id,
    };
    expect(proximaVia(original, [original])).toBe(2);
    expect(proximaVia(original, [original, segunda])).toBe(3);
    expect(() => proximaVia(segunda, [])).toThrow(/1ª via/);
    expect(exigirMotivo('  Extravio do original ')).toBe('Extravio do original');
    expect(() => exigirMotivo('')).toThrow(/motivo/);
    expect(() => exigirMotivo('x'.repeat(201))).toThrow(/200/);
  });

  it('página pública mostra só existência, data, estabelecimento, hash e via', () => {
    expect(validacaoPublica(null, () => 'X')).toEqual({ existe: false });
    const v = validacaoPublica(original, (c) => `Estabelecimento ${c}`);
    expect(v).toEqual({
      existe: true,
      emitidoEm: original.emitidoEm,
      estabelecimento: 'Estabelecimento zz',
      sha256: original.sha256,
      via: 1,
    });
    expect(JSON.stringify(v)).not.toContain('900001');
  });

  it('hash e identificador do QR', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const id = novoIdentificadorQr();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(novoIdentificadorQr(() => new Uint8Array(16).fill(255))).toBe('_____________________w');
  });
});

describe('modelo HTML e QR', () => {
  it('QR só com o identificador e a URL pública por parâmetro', () => {
    expect(urlValidacao('https://rede.exemplo.invalid/', 'AAAAAAAAAAAAAAAAAAAAAA')).toBe(
      'https://rede.exemplo.invalid/api/publico/documentos/AAAAAAAAAAAAAAAAAAAAAA/validacao',
    );
    expect(() => urlValidacao('https://x.invalid', '../segredo')).toThrow(/QR/);
    const svg = qrSvg('https://x.invalid/a');
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain('fill="#000"');
    expect(qrSvg('https://x.invalid/a')).toBe(svg);
  });

  it('SBIS-42: rodapé "Sistema certificado SBIS nº" só com o certificado vigente', () => {
    const base = {
      titulo: 'T',
      produto: 'P',
      estabelecimento: 'E',
      emitidoEm: 'D',
      via: null,
      campos: [],
      qrSvg: '',
      identificadorQr: 'A',
      fontesCss: '',
    };
    expect(htmlDocumento(base)).not.toContain('SBIS');
    expect(htmlDocumento({ ...base, certificadoSbis: null })).not.toContain('SBIS');
    expect(htmlDocumento({ ...base, certificadoSbis: '  ' })).not.toContain('SBIS');
    const com = htmlDocumento({ ...base, certificadoSbis: 'NGS2-0001<x>' });
    expect(com).toMatch(/<footer>.*Sistema certificado SBIS nº NGS2-0001&lt;x&gt;\..*<\/footer>/);
    expect(rodapeCertificacaoSbis(' NGS2-0001 ')).toBe('Sistema certificado SBIS nº NGS2-0001.');
    expect(rodapeCertificacaoSbis(null)).toBe('');
  });

  it('documento autocontido, com 2ª via marcada e texto escapado', () => {
    const html = htmlDocumento({
      titulo: 'Documento de prova',
      produto: 'Produto <teste>',
      estabelecimento: 'Estabelecimento Fictício',
      emitidoEm: '19/10/2026 09:00',
      via: '2ª via',
      campos: [{ rotulo: 'Paciente', valor: 'Paciente Fictício & Cia' }],
      qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      identificadorQr: 'AAAA',
      fontesCss: fonteEmbutida('SGH Documento', new Uint8Array([1, 2, 3])),
    });
    expect(html).toContain('<div class="via">2ª via</div>');
    expect(html).toContain('Paciente Fictício &amp; Cia');
    expect(html).toContain('Produto &lt;teste&gt;');
    expect(html).toContain("src:url(data:font/woff2;base64,AQID) format('woff2')");
    expect(escaparHtml(`'"`)).toBe('&#39;&quot;');
    const semVia = htmlDocumento({
      titulo: 'T',
      produto: 'P',
      estabelecimento: 'E',
      emitidoEm: 'D',
      via: null,
      campos: [],
      qrSvg: '',
      identificadorQr: 'A',
      fontesCss: '',
      logoSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
    expect(semVia).not.toContain('class="via"');
    expect(() =>
      htmlDocumento({
        ...{
          titulo: 'T',
          produto: 'P',
          estabelecimento: 'E',
          emitidoEm: 'D',
          via: null,
          campos: [],
          qrSvg: '',
          identificadorQr: 'A',
        },
        fontesCss: '@font-face{src:url(https://fontes.invalid/x.woff2)}',
      }),
    ).toThrow(/externo/);
  });
});
