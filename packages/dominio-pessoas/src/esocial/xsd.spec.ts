// Regra 9 da ficha do M53: cada evento montado pelo Sante SGH valida no XSD oficial do leiaute S-1.3 (pacote do eSocial
// versionado com SHA-256); evento fora do leiaute é recusado com a mensagem do validador.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ResultadoEventoEsocial, xmlDoEvento, xmlParaConferencia } from './comum.js';
import { montarS1000, montarS1005, montarS1010, montarS1020 } from './eventos-tabela.js';
import {
  montarS2200,
  montarS2205,
  montarS2206,
  montarS2230,
  montarS2299,
  montarS2300,
  montarS2399,
  montarS3000,
} from './eventos-trabalhador.js';
import { CPF, ctx, empregador, ficha, rubrica, trabalhador } from './fixtures-esocial.spec-util.js';
import {
  type ArquivoEsquemaEsocial,
  carregarEsquemasEsocial,
  ErroEsquemaEsocial,
  errosSemValores,
  esquemasDoLeiaute,
  pastaXsdEsocial,
  validarEventoNoXsd,
} from './xsd.js';

let esquemas: ArquivoEsquemaEsocial[];
beforeAll(async () => {
  esquemas = await esquemasDoLeiaute('v_S_01_03_00');
});

async function conferir(r: ResultadoEventoEsocial, raiz: string) {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) return;
  const v = await validarEventoNoXsd(xmlParaConferencia(r.raiz), raiz, esquemas);
  expect(v.erros).toEqual([]);
  expect(v.valido).toBe(true);
  expect(r.idEsocial).toMatch(/^ID1\d{8}0{6}\d{19}$/);
  return xmlDoEvento(r.raiz);
}

describe('XSD oficial do leiaute S-1.3 (regra 9)', () => {
  it('os eventos de tabela validam em inclusão, alteração e exclusão', async () => {
    for (const op of ['inclusao', 'alteracao', 'exclusao'] as const) {
      await conferir(montarS1000(ctx, empregador, op, '2026-11'), 'evtInfoEmpregador');
      await conferir(montarS1005(ctx, empregador, op, '2026-11'), 'evtTabEstab');
      await conferir(montarS1010(ctx, empregador, op, '2026-11', rubrica(), '1000'), 'evtTabRubrica');
      await conferir(montarS1020(ctx, empregador, op, '2026-11'), 'evtTabLotacao');
    }
  });

  it('S-1000 leva a raiz do CNPJ, o namespace do leiaute e nenhuma assinatura no XML gravado', async () => {
    const xml = await conferir(montarS1000(ctx, empregador, 'inclusao', '2026-11'), 'evtInfoEmpregador');
    expect(xml).toContain('xmlns="http://www.esocial.gov.br/schema/evt/evtInfoEmpregador/v_S_01_03_00"');
    expect(xml).toContain('<nrInsc>11222333</nrInsc>');
    expect(xml).toContain('<iniValid>2026-11</iniValid>');
    expect(xml).not.toContain('Signature');
  });

  it('os eventos do trabalhador validam (admissão, alterações, afastamento, desligamento, sem vínculo e exclusão)', async () => {
    await conferir(montarS2200(ctx, empregador, trabalhador, null), 'evtAdmissao');
    await conferir(montarS2200(ctx, empregador, trabalhador, '1.2.0000000000000000001'), 'evtAdmissao');
    await conferir(montarS2205(ctx, empregador, trabalhador, '2026-10-20', null), 'evtAltCadastral');
    await conferir(montarS2206(ctx, empregador, trabalhador, '2026-11-01', null), 'evtAltContratual');
    await conferir(
      montarS2230(
        ctx,
        empregador,
        trabalhador,
        { id: 1, motivo: 3, inicio: '2026-10-10', fim: '2026-10-25' },
        null,
      ),
      'evtAfastTemp',
    );
    await conferir(
      montarS2230(ctx, empregador, trabalhador, { id: 1, motivo: 7, inicio: '2026-10-10', fim: null }, null),
      'evtAfastTemp',
    );
    const linhas = [
      {
        papel: 'saldoSalario',
        tipo: 'provento',
        rubrica: 10,
        codigoRubrica: 1,
        quantidade: 10,
        unidade: 'dias',
        valor: 170_000,
        memoria: '',
      },
      {
        papel: 'inss',
        tipo: 'desconto',
        rubrica: 11,
        codigoRubrica: 900,
        quantidade: 0,
        unidade: 'valor',
        valor: 12_000,
        memoria: '',
      },
      {
        papel: 'baseInss',
        tipo: 'base',
        rubrica: null,
        codigoRubrica: null,
        quantidade: 0,
        unidade: 'valor',
        valor: 170_000,
        memoria: '',
      },
    ] as never;
    const xml = await conferir(
      montarS2299(
        ctx,
        empregador,
        { ...trabalhador, desligamento: '2026-10-20' },
        {
          id: 9,
          desligamento: '2026-10-20',
          modalidade: 'sem-justa-causa',
          diasIndenizados: 33,
          projecao: '2026-11-22',
          linhas,
        },
        null,
      ),
      'evtDeslig',
    );
    expect(xml).toContain('<mtvDeslig>02</mtvDeslig>');
    expect(xml).toContain('<indPagtoAPI>S</indPagtoAPI><dtProjFimAPI>2026-11-22</dtProjFimAPI>');
    expect(xml).toContain('<codRubr>1</codRubr><ideTabRubr>SGH</ideTabRubr><vrRubr>1700.00</vrRubr>');
    expect(xml).not.toContain('<vrRubr>1700.00</vrRubr></detVerbas><detVerbas><codRubr>null');
    await conferir(
      montarS2299(
        ctx,
        empregador,
        trabalhador,
        {
          id: 9,
          desligamento: '2026-10-20',
          modalidade: 'pedido-demissao',
          diasIndenizados: 0,
          projecao: '2026-10-20',
          linhas: [],
        },
        null,
      ),
      'evtDeslig',
    );
    const estagiario = {
      ...trabalhador,
      tipo: 'estagiario' as const,
      ficha: {
        ...ficha,
        categoria: '901',
        estagio: {
          natureza: 'O' as const,
          nivel: 2,
          terminoPrevisto: '2027-06-30',
          cnpjInstituicao: '44555666000171',
        },
      },
    };
    await conferir(montarS2300(ctx, empregador, estagiario, null), 'evtTSVInicio');
    await conferir(
      montarS2300(
        ctx,
        empregador,
        { ...estagiario, salario: null, ficha: { ...estagiario.ficha, categoria: '902', estagio: null } },
        null,
      ),
      'evtTSVInicio',
    );
    await conferir(montarS2399(ctx, empregador, estagiario, '2027-06-30', null), 'evtTSVTermino');
    await conferir(
      montarS3000(
        ctx,
        empregador,
        { evento: 'S-2200', recibo: '1.2.0000000000000000001', cpf: CPF, dataReferencia: '2026-10-01' },
        '2026-10-27',
      ),
      'evtExclusao',
    );
  });

  it('XML fora do leiaute é recusado com a mensagem do validador', async () => {
    const r = montarS1000(ctx, empregador, 'inclusao', '2026-11');
    if (!r.ok) throw new Error('montagem');
    const xml = xmlParaConferencia(r.raiz).replace('<classTrib>99</classTrib>', '<classTrib>9X</classTrib>');
    const v = await validarEventoNoXsd(xml, 'evtInfoEmpregador', esquemas);
    expect(v.valido).toBe(false);
    expect(v.erros.join(' ')).toContain('classTrib');
    // Sem a assinatura (o XML gravado), o XSD também recusa: ela é obrigatória no leiaute.
    const semAssinatura = await validarEventoNoXsd(xmlDoEvento(r.raiz), 'evtInfoEmpregador', esquemas);
    expect(semAssinatura.valido).toBe(false);
    await expect(validarEventoNoXsd(xml, 'evtInexistente', esquemas)).rejects.toThrow(ErroEsquemaEsocial);
  });

  it('as mensagens do validador não repetem o valor do campo (CPF, nome, nascimento sintéticos fora do leiaute)', async () => {
    const r = montarS2200(ctx, empregador, trabalhador, null);
    if (!r.ok) throw new Error('montagem');
    const nomeLongo = 'NOME SINTETICO '.repeat(10).trim();
    const xml = xmlParaConferencia(r.raiz)
      .replace(`<cpfTrab>${CPF}</cpfTrab>`, '<cpfTrab>1234567890X</cpfTrab>')
      .replace(/<nmTrab>[^<]*<\/nmTrab>/, `<nmTrab>${nomeLongo}</nmTrab>`)
      .replace(/<dtNascto>[^<]*<\/dtNascto>/, '<dtNascto>1990-13-45</dtNascto>');
    const v = await validarEventoNoXsd(xml, 'evtAdmissao', esquemas);
    expect(v.valido).toBe(false);
    const tudo = v.erros.join(' ');
    expect(tudo).toContain('cpfTrab');
    expect(tudo).toContain('pattern');
    expect(tudo).toContain('(valor omitido)');
    expect(tudo).not.toContain('1234567890X');
    expect(tudo).not.toContain('NOME SINTETICO');
    expect(tudo).not.toContain('1990-13-45');
    expect(tudo).not.toContain(CPF);
  });

  it('errosSemValores: tira o valor das facetas e do tipo; mantém elemento, faceta e regra', () => {
    expect(
      errosSemValores(
        "Element 'cpfTrab': [facet 'pattern'] The value '1234567890X' is not accepted by the pattern '\\d{11}'.",
      ),
    ).toBe(
      "Element 'cpfTrab': [facet 'pattern'] The value (valor omitido) is not accepted by the pattern '\\d{11}'.",
    );
    expect(
      errosSemValores("Element 'vrSalFx': 'abc' is not a valid value of the atomic type 'xs:decimal'."),
    ).toBe("Element 'vrSalFx': (valor omitido) is not a valid value of the atomic type 'xs:decimal'.");
    expect(
      errosSemValores(
        "Element 'nmTrab': [facet 'maxLength'] The value 'D'ÁVILA SINTETICA' has a length of '16'; this exceeds the allowed maximum length of '10'.",
      ),
    ).toBe(
      "Element 'nmTrab': [facet 'maxLength'] The value (valor omitido) has a length of '16'; this exceeds the allowed maximum length of '10'.",
    );
    expect(errosSemValores('Outro texto com 52998224725 no meio')).toBe(
      'Outro texto com (valor omitido) no meio',
    );
  });

  describe('pacote do XSD conferido pelo SHA-256', () => {
    let pasta: string;
    beforeAll(async () => {
      pasta = mkdtempSync(join(tmpdir(), 'xsd-esocial-'));
      cpSync(new URL(await pastaXsdEsocial('v_S_01_03_00')), pasta, { recursive: true });
    });
    afterAll(() => rmSync(pasta, { recursive: true, force: true }));

    it('arquivo alterado recusa a carga', async () => {
      writeFileSync(join(pasta, 'evtDeslig.xsd'), '<xs:schema/>');
      await expect(carregarEsquemasEsocial(pathToFileURL(`${pasta}/`))).rejects.toThrow(/alterado/);
    });

    it('manifesto sem o tipos.xsd ou com linha inválida é recusado', async () => {
      writeFileSync(join(pasta, 'SHA256SUMS'), `${'0'.repeat(64)}  evtDeslig.xsd\n`);
      await expect(carregarEsquemasEsocial(pathToFileURL(`${pasta}/`))).rejects.toThrow(/tipos\.xsd/);
      writeFileSync(join(pasta, 'SHA256SUMS'), 'linha torta\n');
      await expect(carregarEsquemasEsocial(pathToFileURL(`${pasta}/`))).rejects.toThrow(/inválida/);
    });

    it('a pasta da implantação (ESOCIAL_XSD_PASTA) é aceita quando tem o manifesto', async () => {
      const antes = process.env['ESOCIAL_XSD_PASTA'];
      process.env['ESOCIAL_XSD_PASTA'] = '/nao/existe';
      try {
        expect((await pastaXsdEsocial('v_S_01_03_00')).href).toContain('xsd/v_S_01_03_00');
      } finally {
        if (antes === undefined) delete process.env['ESOCIAL_XSD_PASTA'];
        else process.env['ESOCIAL_XSD_PASTA'] = antes;
      }
    });
  });
});
