// M53-F6: os periódicos (S-1200, S-1210, S-1298, S-1299) e o S-3000 de periódico validam no XSD do leiaute S-1.3
// (regra 9); a situação do período, a contagem e o que barra o S-1299 (regra 1). Dados sintéticos.
import { beforeAll, describe, expect, it } from 'vitest';
import { type ResultadoEventoEsocial, xmlDoEvento, xmlParaConferencia } from './comum.js';
import {
  contarPeriodico,
  ideDmDevDoProcesso,
  itensDaRemuneracao,
  montarS1200,
  montarS1210,
  montarS1298,
  montarS1299,
  pendenciasFechamentoEsocial,
  periodoDoPagamento,
  situacaoDoPeriodo,
  tpPgtoDoTipo,
} from './eventos-periodicos.js';
import { montarS3000 } from './eventos-trabalhador.js';
import { CPF, ctx, empregador, ficha, trabalhador } from './fixtures-esocial.spec-util.js';
import { type ArquivoEsquemaEsocial, esquemasDoLeiaute, validarEventoNoXsd } from './xsd.js';

let esquemas: ArquivoEsquemaEsocial[];
beforeAll(async () => {
  esquemas = await esquemasDoLeiaute('v_S_01_03_00');
});

async function conferir(r: ResultadoEventoEsocial, raiz: string) {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) return '';
  const v = await validarEventoNoXsd(xmlParaConferencia(r.raiz), raiz, esquemas);
  expect(v.erros).toEqual([]);
  expect(v.valido).toBe(true);
  return xmlDoEvento(r.raiz);
}

const dm = (
  ideDmDev: string,
  itens = [
    { codigo: '1', valor: 512_345 },
    { codigo: '901', valor: 40_000 },
  ],
) => ({
  ideDmDev,
  processo: 7,
  tipo: 'mensal' as const,
  itens,
});

describe('S-1200 remuneração do trabalhador', () => {
  it('valida no mensal (folha e férias) e no anual (13º), com o grau de exposição do empregado', async () => {
    const xml = await conferir(
      montarS1200(
        ctx,
        empregador,
        trabalhador,
        { apuracao: 'mensal', periodo: '2026-09' },
        [dm('M7'), dm('F9')],
        null,
      ),
      'evtRemun',
    );
    expect(xml).toContain('<indApuracao>1</indApuracao><perApur>2026-09</perApur>');
    expect(xml).toContain(`<cpfTrab>${CPF}</cpfTrab>`);
    expect(xml).toContain('<ideDmDev>M7</ideDmDev><codCateg>101</codCateg>');
    expect(xml).toContain('<matricula>000123</matricula>');
    expect(xml).toContain('<vrRubr>5123.45</vrRubr><indApurIR>0</indApurIR>');
    expect(xml).toContain('<infoAgNocivo><grauExp>1</grauExp></infoAgNocivo>');
    const anual = await conferir(
      montarS1200(ctx, empregador, trabalhador, { apuracao: 'anual', periodo: '2026' }, [dm('D11')], null),
      'evtRemun',
    );
    expect(anual).toContain('<indApuracao>2</indApuracao><perApur>2026</perApur>');
  });

  it('retificação leva indRetif 2 e o recibo; estagiário sai sem matrícula e sem o grau de exposição', async () => {
    const ret = await conferir(
      montarS1200(
        ctx,
        empregador,
        trabalhador,
        { apuracao: 'mensal', periodo: '2026-09' },
        [dm('M7')],
        '1.1.0000000000000000001',
      ),
      'evtRemun',
    );
    expect(ret).toContain('<indRetif>2</indRetif><nrRecibo>1.1.0000000000000000001</nrRecibo>');
    const est = await conferir(
      montarS1200(
        ctx,
        empregador,
        { ...trabalhador, matricula: null, ficha: { ...ficha, categoria: '901' } },
        { apuracao: 'mensal', periodo: '2026-09' },
        [dm('M7')],
        null,
      ),
      'evtRemun',
    );
    expect(est).not.toContain('<matricula>');
    expect(est).not.toContain('infoAgNocivo');
  });

  it('sem rubrica com valor, sem ficha ou com demonstrativo repetido: pendência, nenhum XML', () => {
    const r = montarS1200(
      ctx,
      empregador,
      { ...trabalhador, ficha: null },
      { apuracao: 'mensal', periodo: '2026-09' },
      [dm('M7', []), dm('M7', [])],
      null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pendencias.map((p) => p.codigo)).toEqual(['ficha-ausente', 'sem-remuneracao']);
    const rep = montarS1200(
      ctx,
      empregador,
      trabalhador,
      { apuracao: 'mensal', periodo: '2026-09' },
      [dm('M7'), dm('M7')],
      null,
    );
    expect(rep.ok).toBe(false);
    if (!rep.ok) expect(rep.pendencias.map((p) => p.codigo)).toEqual(['demonstrativo-repetido']);
  });

  it('itens: proventos e descontos com rubrica, somados por código; bases e encargos ficam fora', () => {
    expect(
      itensDaRemuneracao([
        { tipo: 'provento', codigoRubrica: 1, valor: 100 },
        { tipo: 'provento', codigoRubrica: 1, valor: 50 },
        { tipo: 'desconto', codigoRubrica: 901, valor: 20 },
        { tipo: 'base', codigoRubrica: null, valor: 999 },
        { tipo: 'informativa', codigoRubrica: 5, valor: 1 },
        { tipo: 'provento', codigoRubrica: 12, valor: 0 },
      ]),
    ).toEqual([
      { codigo: '1', valor: 150 },
      { codigo: '901', valor: 20 },
    ]);
  });

  it('identificador do demonstrativo por tipo; a rescisão usa o da S-2299', () => {
    expect(ideDmDevDoProcesso('mensal', 7, null)).toBe('M7');
    expect(ideDmDevDoProcesso('ferias', 9, null)).toBe('F9');
    expect(ideDmDevDoProcesso('decimo2', 11, null)).toBe('D11');
    expect(ideDmDevDoProcesso('rescisao', 13, 4)).toBe('R4');
    expect(() => ideDmDevDoProcesso('rescisao', 13, null)).toThrow();
  });
});

describe('S-1210 pagamentos', () => {
  const pg = (over = {}) => ({
    dtPgto: '2026-10-05',
    tpPgto: 1 as const,
    perRef: '2026-09',
    ideDmDev: 'M7',
    vrLiq: 472_345,
    ...over,
  });

  it('valida com o pagamento da folha mensal e o da rescisão (tpPgto 2), no mês do pagamento', async () => {
    const xml = await conferir(
      montarS1210(
        ctx,
        empregador,
        trabalhador,
        '2026-10',
        [pg(), pg({ dtPgto: '2026-10-10', tpPgto: 2, perRef: '2026-10', ideDmDev: 'R4', vrLiq: 0 })],
        null,
      ),
      'evtPgtos',
    );
    expect(xml).toContain('<perApur>2026-10</perApur>');
    expect(xml).toContain(`<cpfBenef>${CPF}</cpfBenef>`);
    expect(xml).toContain(
      '<infoPgto><dtPgto>2026-10-05</dtPgto><tpPgto>1</tpPgto><perRef>2026-09</perRef><ideDmDev>M7</ideDmDev><vrLiq>4723.45</vrLiq></infoPgto>',
    );
  });

  it('não pede a ficha; recusa pagamento fora do mês e mês sem pagamento', () => {
    const r = montarS1210(ctx, empregador, { ...trabalhador, ficha: null }, '2026-10', [pg()], null);
    expect(r.ok).toBe(true);
    const fora = montarS1210(ctx, empregador, trabalhador, '2026-11', [pg()], null);
    expect(fora.ok).toBe(false);
    if (!fora.ok) expect(fora.pendencias.map((p) => p.codigo)).toEqual(['pagamento-fora-do-mes']);
    const vazio = montarS1210(ctx, empregador, trabalhador, '2026-10', [], null);
    if (!vazio.ok) expect(vazio.pendencias.map((p) => p.codigo)).toEqual(['sem-pagamento']);
  });

  it('tipo do pagamento e período do S-1210', () => {
    expect(tpPgtoDoTipo('mensal', '101')).toBe(1);
    expect(tpPgtoDoTipo('rescisao', '101')).toBe(2);
    expect(tpPgtoDoTipo('rescisao', '901')).toBe(3);
    expect(periodoDoPagamento('2026-10-05')).toBe('2026-10');
  });
});

describe('S-1299 fechamento e S-1298 reabertura', () => {
  it('validam no mensal e no anual (no anual, sem pagamentos)', async () => {
    const m = await conferir(
      montarS1299(
        ctx,
        empregador,
        { apuracao: 'mensal', periodo: '2026-09' },
        { remuneracao: true, pagamentos: true },
        [],
      ),
      'evtFechaEvPer',
    );
    expect(m).toContain('<evtRemun>S</evtRemun><evtPgtos>S</evtPgtos><evtComProd>N</evtComProd>');
    const a = await conferir(
      montarS1299(
        ctx,
        empregador,
        { apuracao: 'anual', periodo: '2026' },
        { remuneracao: true, pagamentos: true },
        [],
      ),
      'evtFechaEvPer',
    );
    expect(a).toContain('<indApuracao>2</indApuracao><perApur>2026</perApur>');
    expect(a).toContain('<evtPgtos>N</evtPgtos>');
    await conferir(
      montarS1298(ctx, empregador, { apuracao: 'mensal', periodo: '2026-09' }, []),
      'evtReabreEvPer',
    );
  });

  it('com pendência do período, nenhum XML', () => {
    const r = montarS1299(
      ctx,
      empregador,
      { apuracao: 'mensal', periodo: '2026-09' },
      { remuneracao: true, pagamentos: false },
      [{ codigo: 'folha-nao-fechada', mensagem: 'x' }],
    );
    expect(r.ok).toBe(false);
  });

  it('S-3000 exclui S-1200 e S-1210 com o CPF e o período; S-1299 não', async () => {
    const x = await conferir(
      montarS3000(
        ctx,
        empregador,
        {
          evento: 'S-1200',
          recibo: '1.1.0000000000000000001',
          cpf: CPF,
          dataReferencia: '2026',
          indApuracao: 2,
        },
        '2026-10-28',
      ),
      'evtExclusao',
    );
    expect(x).toContain('<ideFolhaPagto><indApuracao>2</indApuracao><perApur>2026</perApur></ideFolhaPagto>');
    const p = await conferir(
      montarS3000(
        ctx,
        empregador,
        { evento: 'S-1210', recibo: '1.1.0000000000000000002', cpf: CPF, dataReferencia: '2026-10' },
        '2026-10-28',
      ),
      'evtExclusao',
    );
    expect(p).toContain('<ideFolhaPagto><perApur>2026-10</perApur></ideFolhaPagto>');
    const f = montarS3000(
      ctx,
      empregador,
      { evento: 'S-1299', recibo: '1.1.0000000000000000003', cpf: null, dataReferencia: '2026-10' },
      '2026-10-28',
    );
    expect(f.ok).toBe(false);
  });
});

describe('situação do período e pendências do S-1299 (regra 1)', () => {
  const ev = (id: number, evento: string, situacao: string, vinculo: number | null = null) => ({
    id,
    evento,
    situacao,
    vinculo,
    criadoEm: `2026-10-0${id}T10:00:00`,
  });

  it('aberto, fechando, fechado e reabrindo pelo último S-1299 ou S-1298 em vigor', () => {
    expect(situacaoDoPeriodo([])).toEqual({ situacao: 'aberto', evento: null });
    expect(situacaoDoPeriodo([ev(1, 'S-1299', 'validado')]).situacao).toBe('fechando');
    expect(situacaoDoPeriodo([ev(1, 'S-1299', 'aceito')]).situacao).toBe('fechado');
    expect(situacaoDoPeriodo([ev(1, 'S-1299', 'aceito'), ev(2, 'S-1298', 'enviado')]).situacao).toBe(
      'reabrindo',
    );
    expect(situacaoDoPeriodo([ev(1, 'S-1299', 'aceito'), ev(2, 'S-1298', 'aceito')])).toEqual({
      situacao: 'aberto',
      evento: 2,
    });
    expect(situacaoDoPeriodo([ev(1, 'S-1299', 'rejeitado'), ev(2, 'S-1299', 'descartado')]).situacao).toBe(
      'aberto',
    );
  });

  it('contagem: por situação, aceitos entre os esperados e os sem evento', () => {
    const c = contarPeriodico(
      'S-1200',
      [3, 1, 2, 2],
      [ev(1, 'S-1200', 'aceito', 1), ev(2, 'S-1200', 'descartado', 2), ev(3, 'S-1210', 'aceito', 3)],
    );
    expect(c).toEqual({ esperados: 3, porSituacao: { aceito: 1 }, semEvento: [2, 3], aceitos: 1 });
  });

  it('o S-1299 espera a folha fechada, tudo aceito, nada em andamento e o autônomo do repasse declarado', () => {
    expect(
      pendenciasFechamentoEsocial({
        apuracao: 'mensal',
        folhaFechada: true,
        remuneracao: { esperados: 2, aceitos: 2 },
        pagamentos: { esperados: 2, aceitos: 2 },
        emAndamento: 0,
        repasse: 0,
        remuneracaoAutonomo: 0,
      }),
    ).toEqual([]);
    expect(
      pendenciasFechamentoEsocial({
        apuracao: 'mensal',
        folhaFechada: false,
        remuneracao: { esperados: 2, aceitos: 1 },
        pagamentos: { esperados: 2, aceitos: 0 },
        emAndamento: 1,
        repasse: 3,
        remuneracaoAutonomo: 0,
      }).map((p) => p.codigo),
    ).toEqual([
      'folha-nao-fechada',
      'remuneracao-pendente',
      'pagamento-pendente',
      'eventos-em-andamento',
      'repasse-sem-remuneracao',
    ]);
  });
});
