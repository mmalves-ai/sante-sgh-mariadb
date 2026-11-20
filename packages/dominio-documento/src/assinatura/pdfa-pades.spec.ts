// Regra 8 do M49 (SBIS-38, SBIS-42, ICP-05) e regra 4 (SBIS-35): o PDF assinado é o PDF/A da prévia com uma revisão
// incremental (nenhum byte do original muda), o CMS destacado tem os atributos assinados certos e o carimbo do tempo, e
// a assinatura é validável FORA do sistema por biblioteca independente: o OpenSSL confere o SignedData sobre os bytes
// do /ByteRange com a raiz sintética, e o pdfsig (poppler) lê o PDF e diz "Signature is Valid". ICP, certificado e CPF
// SINTÉTICOS; PDF mínimo montado aqui (o do Gotenberg, PDF/A-2b, é provado na integração da API com o veraPDF).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { conferirAssinaturaHash } from './cadeia.js';
import {
  assinarHashRsa,
  carimbarSintetico,
  CPF_SINTETICO_SESSAO,
  criarRaizSintetica,
  emitirSintetico,
  NOME_RAIZ_SINTETICA,
} from './icp-sintetica.js';
import {
  atributosAssinados,
  dataPdf,
  ErroPades,
  fimDoDicionario,
  inserirCms,
  lerAssinaturaPdf,
  lerCms,
  montarCms,
  prepararPades,
  resumoDoByteRange,
  tokenDaRespostaCarimbo,
} from './pades.js';

const agora = new Date('2026-10-24T12:00:00Z');
const raiz = criarRaizSintetica(agora);
const titular = emitirSintetico(raiz, { cpf: CPF_SINTETICO_SESSAO }, agora);
const act = emitirSintetico(raiz, { cpf: null, carimbo: true }, agora);

/** PDF mínimo com tabela xref clássica (como o do Gotenberg), com ou sem /Annots na página. */
export function pdfMinimo(annots: 'nenhuma' | 'lista' | 'referencia' = 'nenhuma'): Uint8Array {
  const conteudo = 'BT /F1 12 Tf 72 720 Td (Atestado SINTETICO) Tj ET';
  const objs = [
    '<</Type /Catalog /Pages 2 0 R>>',
    '<</Type /Pages /Kids [3 0 R] /Count 1>>',
    `<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>${
      annots === 'lista' ? ' /Annots [6 0 R]' : annots === 'referencia' ? ' /Annots 7 0 R' : ''
    }>>`,
    `<</Length ${conteudo.length}>>\nstream\n${conteudo}\nendstream`,
    '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>',
    '<</Type /Annot /Subtype /Link /Rect [0 0 10 10] /F 4 /Border [0 0 0]>>',
    '[6 0 R]',
  ];
  let s = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(s.length);
    s += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f\r\n`;
  for (const o of offs) s += `${String(o).padStart(10, '0')} 00000 n\r\n`;
  s += `trailer\n<</Size ${objs.length + 1} /Root 1 0 R /ID [<0011AABB> <0011AABB>]>>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(s, 'latin1'));
}

function assinar(original: Uint8Array, carimbo: boolean) {
  const prep = prepararPades(original, { assinadoEm: agora });
  const attrs = atributosAssinados({ resumo: prep.resumo, certificado: titular.certificado });
  const assinatura = assinarHashRsa(titular.chave, Buffer.from(attrs.hash, 'hex'));
  const resp = carimbo
    ? carimbarSintetico(
        act,
        NOME_RAIZ_SINTETICA,
        { hash: Uint8Array.from(createHash('sha256').update(assinatura).digest()), nonce: null },
        agora,
      )
    : null;
  const cms = montarCms({
    atributos: attrs.der,
    assinatura,
    certificado: titular.certificado,
    cadeia: [raiz.certificado],
    carimbo: resp,
  });
  return { prep, attrs, assinatura, cms, pdf: inserirCms(prep, cms) };
}

const temOpenssl = spawnSync('openssl', ['version']).status === 0;
const temPdfsig = spawnSync('pdfsig', ['-v']).status === 0;
const pasta = mkdtempSync(join(tmpdir(), 'sgh-pades-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));
const pem = (der: Uint8Array) =>
  `-----BEGIN CERTIFICATE-----\n${Buffer.from(der)
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`;

describe('PAdES sobre o PDF/A da prévia (regras 4 e 8)', () => {
  it('a revisão incremental não muda nenhum byte do original e o /ByteRange cobre o arquivo inteiro menos o CMS', () => {
    const original = pdfMinimo();
    const { prep, pdf } = assinar(original, true);
    expect(Buffer.compare(Buffer.from(pdf.subarray(0, original.length)), Buffer.from(original))).toBe(0);
    const lido = lerAssinaturaPdf(pdf);
    expect(lido.cobreTudo).toBe(true);
    expect(lido.byteRange[0]).toBe(0);
    expect(Buffer.from(lido.resumo).equals(Buffer.from(prep.resumo))).toBe(true);
    const texto = Buffer.from(pdf).toString('latin1');
    expect(texto).toContain('/SubFilter /ETSI.CAdES.detached');
    expect(texto).toContain(`/M (${dataPdf(agora)})`);
    expect(texto).toContain('/AcroForm <</Fields [9 0 R] /SigFlags 3>>');
    expect(texto).toContain('/Annots [9 0 R]');
    expect(texto).toContain('/Prev ');
  });

  it('é determinística: a mesma prévia, o mesmo instante e o mesmo certificado dão o mesmo hash a assinar', () => {
    const a = prepararPades(pdfMinimo(), { assinadoEm: agora });
    const b = prepararPades(pdfMinimo(), { assinadoEm: agora });
    const c = prepararPades(pdfMinimo(), { assinadoEm: new Date(agora.getTime() + 1000) });
    const h = (p: typeof a) =>
      atributosAssinados({ resumo: p.resumo, certificado: titular.certificado }).hash;
    expect(h(a)).toBe(h(b));
    expect(h(a)).not.toBe(h(c));
  });

  it('os atributos assinados levam o messageDigest do /ByteRange; a assinatura crua confere com o hash deles', () => {
    const { attrs, assinatura, cms, prep } = assinar(pdfMinimo(), false);
    const l = lerCms(cms);
    expect(Buffer.from(l.resumo!).equals(Buffer.from(prep.resumo))).toBe(true);
    expect(Buffer.from(l.atributos).equals(Buffer.from(attrs.der))).toBe(true);
    expect(Buffer.from(l.assinatura).equals(Buffer.from(assinatura))).toBe(true);
    expect(Buffer.from(l.certificado!).equals(Buffer.from(titular.certificado))).toBe(true);
    expect(l.temCarimbo).toBe(false);
    expect(conferirAssinaturaHash(titular.certificado, Buffer.from(attrs.hash, 'hex'), assinatura)).toBe(
      true,
    );
  });

  it('AD-RT: o carimbo vai como atributo não assinado (o token, não a resposta inteira)', () => {
    const { cms } = assinar(pdfMinimo(), true);
    expect(lerCms(cms).temCarimbo).toBe(true);
    const resp = carimbarSintetico(
      act,
      NOME_RAIZ_SINTETICA,
      { hash: new Uint8Array(32), nonce: null },
      agora,
    );
    expect(tokenDaRespostaCarimbo(resp)[0]).toBe(0x30);
    expect(() => tokenDaRespostaCarimbo(Uint8Array.of(0x30, 0x02, 0x30, 0x00))).toThrow(ErroPades);
  });

  it('a política ICP-Brasil configurada entra como sigPolicyId; hash malformado é recusado', () => {
    const r = prepararPades(pdfMinimo(), { assinadoEm: agora });
    const com = atributosAssinados({
      resumo: r.resumo,
      certificado: titular.certificado,
      politica: { oid: '2.16.76.1.7.1.11.1.1', hashSha256: 'a'.repeat(64) },
    });
    const sem = atributosAssinados({ resumo: r.resumo, certificado: titular.certificado });
    expect(com.der.length).toBeGreaterThan(sem.der.length);
    expect(() =>
      atributosAssinados({
        resumo: r.resumo,
        certificado: titular.certificado,
        politica: { oid: '2.16.76.1.7.1.11.1.1', hashSha256: 'xyz' },
      }),
    ).toThrow(ErroPades);
    expect(() => atributosAssinados({ resumo: new Uint8Array(3), certificado: titular.certificado })).toThrow(
      ErroPades,
    );
  });

  it('página com lista de anotações e com anotações por referência', () => {
    for (const tipo of ['lista', 'referencia'] as const) {
      const { pdf } = assinar(pdfMinimo(tipo), true);
      const texto = Buffer.from(pdf).toString('latin1');
      expect(texto).toMatch(tipo === 'lista' ? /\/Annots \[9 0 R 6 0 R\]/ : /7 0 obj\n\[6 0 R 9 0 R\]/);
      expect(lerAssinaturaPdf(pdf).cobreTudo).toBe(true);
    }
  });

  it('recusa o que não é o PDF emitido aqui (sem PDF, xref em fluxo, já com formulário, CMS grande demais)', () => {
    expect(() => prepararPades(Uint8Array.from(Buffer.from('nao e pdf')), { assinadoEm: agora })).toThrow(
      ErroPades,
    );
    const fluxo = Buffer.from('%PDF-1.7\n1 0 obj\n<</Type /XRef>>\nendobj\nstartxref\n9\n%%EOF\n', 'latin1');
    expect(() => prepararPades(Uint8Array.from(fluxo), { assinadoEm: agora })).toThrow(/fluxo/);
    const { pdf } = assinar(pdfMinimo(), false);
    expect(() => prepararPades(pdf, { assinadoEm: agora })).toThrow(/AcroForm/);
    const p = prepararPades(pdfMinimo(), { assinadoEm: agora, tamanhoContents: 1024 });
    expect(() => inserirCms(p, new Uint8Array(4000))).toThrow(/não cabe/);
    expect(() => prepararPades(pdfMinimo(), { assinadoEm: agora, tamanhoContents: 11 })).toThrow(ErroPades);
    expect(() => lerAssinaturaPdf(pdfMinimo())).toThrow(ErroPades);
    expect(() => fimDoDicionario('abc', 0)).toThrow(ErroPades);
    expect(() => fimDoDicionario('<< (a\\) b) <0A> << >>', 0)).toThrow(/sem fim/);
    expect(fimDoDicionario('<< /A (x>>y) /B <0A> /C << >> >>', 0)).toBe(32);
  });

  it('o resumo do /ByteRange muda se um byte coberto muda (o documento não pode mudar depois de assinado)', () => {
    const { pdf, prep } = assinar(pdfMinimo(), true);
    const adulterado = Uint8Array.from(pdf);
    adulterado[30] = adulterado[30]! ^ 0x01;
    expect(Buffer.from(resumoDoByteRange(adulterado, prep.byteRange)).equals(Buffer.from(prep.resumo))).toBe(
      false,
    );
  });

  it.skipIf(!temOpenssl)(
    'OpenSSL (biblioteca independente) valida o SignedData sobre os bytes do /ByteRange',
    () => {
      const { pdf } = assinar(pdfMinimo(), true);
      const l = lerAssinaturaPdf(pdf);
      const br = l.byteRange;
      const coberto = Buffer.concat([
        Buffer.from(pdf.subarray(br[0], br[0] + br[1])),
        Buffer.from(pdf.subarray(br[2], br[2] + br[3])),
      ]);
      writeFileSync(join(pasta, 'cms.der'), l.cms);
      writeFileSync(join(pasta, 'conteudo.bin'), coberto);
      writeFileSync(join(pasta, 'raiz.pem'), pem(raiz.certificado));
      const r = spawnSync(
        'openssl',
        [
          'cms',
          '-verify',
          '-inform',
          'DER',
          '-in',
          join(pasta, 'cms.der'),
          '-binary',
          '-content',
          join(pasta, 'conteudo.bin'),
          '-CAfile',
          join(pasta, 'raiz.pem'),
          '-purpose',
          'any',
          '-out',
          '/dev/null',
        ],
        { encoding: 'utf8' },
      );
      expect(r.stderr).toContain('Verification successful');
      // Adulterado: a verificação falha.
      coberto[40] = coberto[40]! ^ 0x01;
      writeFileSync(join(pasta, 'conteudo.bin'), coberto);
      const ruim = spawnSync(
        'openssl',
        [
          'cms',
          '-verify',
          '-inform',
          'DER',
          '-in',
          join(pasta, 'cms.der'),
          '-binary',
          '-content',
          join(pasta, 'conteudo.bin'),
          '-CAfile',
          join(pasta, 'raiz.pem'),
          '-purpose',
          'any',
          '-out',
          '/dev/null',
        ],
        { encoding: 'utf8' },
      );
      expect(ruim.status).not.toBe(0);
    },
  );

  it.skipIf(!temPdfsig)('pdfsig (poppler, independente) lê a assinatura do PDF e diz que é válida', () => {
    const { pdf } = assinar(pdfMinimo(), true);
    writeFileSync(join(pasta, 'assinado.pdf'), pdf);
    const saida = execFileSync('pdfsig', [join(pasta, 'assinado.pdf')], { encoding: 'utf8' });
    expect(saida).toContain('Signature is Valid');
    expect(saida).toMatch(/ETSI\.CAdES\.detached|PAdES/);
    expect(saida).toContain('Total document signed');
  });
});
