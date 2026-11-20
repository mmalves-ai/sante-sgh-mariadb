// Regra 7 da ficha do M09 e critério de aceite (`pnpm nx test dominio-faturamento`): lotes de prova de
// consulta, SP/SADT, resumo de internação e recurso de glosa válidos no XSD oficial 04.03.00 (libxml2);
// hash do epílogo conferido; testes negativos recusados. Massa sintética (fixtures.spec-util.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { cabecalho, consulta, recurso, resumoInternacao, spSadt } from './fixtures.spec-util.js';
import {
  conferirHashEpilogo,
  dinheiro,
  ErroLoteTiss,
  hashEpilogo,
  type MensagemTiss,
  mensagemLoteGuias,
  mensagemRecursoGlosa,
  PADRAO_TISS,
  VERSAO_TISS,
} from './lote.js';
import { md5Hex } from './md5.js';
import {
  type ArquivoEsquema,
  carregarEsquemas,
  conferirLote,
  exigirProducaoParaEnvio,
  iso88591,
  validarNoXsd,
} from './validacao.js';
import { el, ErroXmlTiss, latin1 } from './xml.js';

let esquemas: ArquivoEsquema[];
beforeAll(async () => {
  esquemas = await carregarEsquemas();
});

function adulterar(m: MensagemTiss, de: string | RegExp, para: string): MensagemTiss {
  const xml = m.xml.replace(de, para);
  return { ...m, xml, bytes: latin1(xml) };
}

describe('lotes de prova TISS 04.03.00 no XSD oficial', () => {
  it.each([
    ['consulta', () => mensagemLoteGuias(cabecalho, '1001', [consulta])],
    ['SP/SADT', () => mensagemLoteGuias(cabecalho, '1002', [spSadt])],
    ['resumo de internação', () => mensagemLoteGuias(cabecalho, '1003', [resumoInternacao])],
    ['recurso de glosa', () => mensagemRecursoGlosa(cabecalho, recurso)],
  ])('%s: válido no XSD, hash conferido, "pronto"', async (_, gerar) => {
    const m = gerar();
    expect(m.versao).toBe(VERSAO_TISS);
    expect(m.xml).toContain(`<ans:Padrao>${PADRAO_TISS}</ans:Padrao>`);
    expect(m.xml.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true);
    const v = await validarNoXsd(m.bytes, esquemas);
    expect(v.erros).toEqual([]);
    expect(v.valido).toBe(true);
    expect(conferirHashEpilogo(m.xml)).toMatchObject({ confere: true, informado: m.hash });
    expect(await conferirLote(m, esquemas)).toEqual({
      estado: 'pronto',
      versao: VERSAO_TISS,
      hash: m.hash,
      erros: [],
    });
  });

  it('acentos vão em ISO-8859-1 e o hash usa os mesmos bytes', () => {
    const m = mensagemLoteGuias(cabecalho, '1002', [spSadt]);
    expect(m.bytes.includes(0xcd)).toBe(true); // "Í" de FICTÍCIO em ISO-8859-1
    expect(iso88591(m.bytes)).toBe(m.xml);
  });
});

describe('testes negativos recusados', () => {
  it('campo obrigatório ausente: o XSD recusa', async () => {
    const m = adulterar(
      mensagemLoteGuias(cabecalho, '1001', [consulta]),
      /<ans:numeroCarteira>[^<]*<\/ans:numeroCarteira>/,
      '',
    );
    const r = await conferirLote(m, esquemas);
    expect(r.estado).toBe('invalido');
    expect(r.erros.join(' ')).toMatch(/atendimentoRN|numeroCarteira/);
  });

  it('valor fora do domínio do XSD: recusado', async () => {
    const m = adulterar(
      mensagemLoteGuias(cabecalho, '1001', [consulta]),
      '<ans:tipoConsulta>1<',
      '<ans:tipoConsulta>9<',
    );
    expect((await validarNoXsd(m.bytes, esquemas)).valido).toBe(false);
  });

  it('versão diferente de 04.03.00 recusada (o XSD ainda aceita 4.01.00; a regra do novo não)', async () => {
    const m = adulterar(
      mensagemLoteGuias(cabecalho, '1001', [consulta]),
      `<ans:Padrao>${PADRAO_TISS}<`,
      '<ans:Padrao>4.01.00<',
    );
    expect((await validarNoXsd(m.bytes, esquemas)).valido).toBe(true);
    const r = await conferirLote(m, esquemas);
    expect(r.estado).toBe('invalido');
    expect(r.erros.some((e) => /4\.01\.00 recusado/.test(e))).toBe(true);
    const outra = await conferirLote(
      { ...mensagemLoteGuias(cabecalho, '1', [consulta]), versao: '04.01.00' as never },
      esquemas,
    );
    expect(outra.erros[0]).toMatch(/versão 04.01.00 recusada/);
  });

  it('hash do epílogo adulterado ou conteúdo mudado depois do hash: recusado', async () => {
    const m = mensagemLoteGuias(cabecalho, '1001', [consulta]);
    const hashErrado = adulterar(m, /<ans:hash>[0-9a-f]+</, '<ans:hash>00000000000000000000000000000000<');
    expect((await conferirLote(hashErrado, esquemas)).erros).toContain('hash do epílogo não confere');
    const conteudo = adulterar(m, '<ans:valorProcedimento>150.00<', '<ans:valorProcedimento>151.00<');
    expect(conferirHashEpilogo(conteudo.xml).confere).toBe(false);
    expect(conferirHashEpilogo('<x/>')).toMatchObject({ confere: false, informado: null });
  });

  it('XSD alterado: a validação é recusada antes de rodar', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, rmSync } =
      await import('node:fs');
    const { join, resolve } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    // Pasta temporária dentro do repositório (.tmp, POL-4), apagada no fim, mesmo fora do wrapper ./pnpm.
    const base = resolve(import.meta.dirname, '../../../../.tmp');
    mkdirSync(base, { recursive: true });
    const pasta = mkdtempSync(join(base, 'xsd-'));
    try {
      const origem = new URL('./xsd/04.03.00/', import.meta.url);
      for (const f of readdirSync(origem)) copyFileSync(new URL(f, origem), join(pasta, f));
      writeFileSync(join(pasta, 'tissGuiasV4_03_00.xsd'), '<!-- alterado -->');
      await expect(carregarEsquemas(pathToFileURL(pasta + '/'))).rejects.toThrow(/alterado/);
      writeFileSync(join(pasta, 'SHA256SUMS'), 'linha ruim\n');
      await expect(carregarEsquemas(pathToFileURL(pasta + '/'))).rejects.toThrow(/inválida/);
      writeFileSync(join(pasta, 'SHA256SUMS'), `${'0'.repeat(64)}  outro.xsd\n`);
      await expect(carregarEsquemas(pathToFileURL(pasta + '/'))).rejects.toThrow(/fora do SHA256SUMS/);
      await expect(validarNoXsd(new Uint8Array(), [])).rejects.toThrow(/ausente/);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('ISO-8859-1 byte a byte (não o windows-1252 do TextDecoder latin1)', () => {
    const bytes = Uint8Array.from([0x41, 0x80, 0x93, 0xe7, 0xff]);
    expect([...iso88591(bytes)].map((c) => c.charCodeAt(0))).toEqual([0x41, 0x80, 0x93, 0xe7, 0xff]);
    expect(new TextDecoder('latin1').decode(bytes)).toContain('€'); // o que não se usa
  });

  it('regras do gerador: lote vazio, tipos misturados, valor inválido e caractere fora do ISO-8859-1', () => {
    expect(() => mensagemLoteGuias(cabecalho, '1', [])).toThrow(ErroLoteTiss);
    expect(() => mensagemLoteGuias(cabecalho, '1', [consulta, spSadt])).toThrow(/um só tipo/);
    expect(() => mensagemRecursoGlosa(cabecalho, { ...recurso, guias: [] })).toThrow(ErroLoteTiss);
    expect(() => dinheiro(-1)).toThrow(ErroLoteTiss);
    expect(() => dinheiro(Number.NaN)).toThrow(ErroLoteTiss);
    expect(dinheiro(12.345)).toBe('12.35');
    expect(() => mensagemLoteGuias(cabecalho, '1', [{ ...consulta, numeroGuiaPrestador: 'GUIA–1' }])).toThrow(
      ErroXmlTiss,
    );
    expect(() => latin1('\u0080')).toThrow(ErroXmlTiss);
    expect(() => mensagemLoteGuias(cabecalho, '1', [{ ...spSadt, itens: [] }])).not.toThrow();
  });

  it('nada é enviado fora de produção (regra 1.10)', () => {
    for (const a of ['dev', 'ci', 'homolog', 'treino', ''])
      expect(() => exigirProducaoParaEnvio(a)).toThrow(/regra 1.10/);
    expect(() => exigirProducaoParaEnvio('producao')).not.toThrow();
  });
});

describe('hash do epílogo e MD5', () => {
  it('MD5 confere com os vetores da RFC 1321', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(md5Hex(enc(''))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex(enc('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex(enc('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5Hex(enc('1234567890'.repeat(8)))).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('hash = MD5 dos valores do cabeçalho ao fim do corpo, sem tags', () => {
    const h = hashEpilogo(el('a', 'x', el('b', 'Á')), el('c', '1'));
    expect(h).toBe(md5Hex(Uint8Array.from([0x78, 0xc1, 0x31])));
  });
});
