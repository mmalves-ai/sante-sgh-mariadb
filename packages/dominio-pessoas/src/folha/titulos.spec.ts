import type { DestinoIntegracaoFolha, TotaisCalculoFolha } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  avisosDeLancamentoManual,
  conferirSomaTitulos,
  contaDosTitulos,
  custoPessoalPorCentro,
  documentoDoTituloFolha,
  esperadoDoFechamento,
  fatosDaFolha,
  fatosDoRetorno,
  montarPlanoTitulos,
  parcelasDoFechamento,
  parcelasDoRetorno,
  type ProcessoParaTitulos,
  referenteDoTituloFolha,
  type RotinaParaTitulos,
  SUGESTAO_CLASSIFICACAO_FOLHA,
  textoResumoPlano,
  vencimentoDoEncargo,
} from './titulos.js';

const totais = (x: Partial<TotaisCalculoFolha>): TotaisCalculoFolha => ({
  colaboradores: 1,
  proventos: 0,
  descontos: 0,
  liquido: 0,
  inss: 0,
  irrf: 0,
  fgts: 0,
  inssPatronal: 0,
  rat: 0,
  terceiros: 0,
  ...x,
});

// O cadastro de rotinas como a cópia mostra (2 = integra): o INSS dos segurados e o IRRF não contabilizam.
const ROTINAS: RotinaParaTitulos[] = [
  { id: 4, financeiro: true, contabilidade: true },
  { id: 6, financeiro: true, contabilidade: false },
  { id: 11, financeiro: true, contabilidade: false },
  { id: 12, financeiro: true, contabilidade: true },
  { id: 14, financeiro: true, contabilidade: false },
  { id: 15, financeiro: true, contabilidade: true },
  { id: 16, financeiro: true, contabilidade: false },
  { id: 17, financeiro: true, contabilidade: true },
  { id: 18, financeiro: true, contabilidade: false },
];

const dp = (destino: DestinoIntegracaoFolha['destino'], credor = 900): DestinoIntegracaoFolha => ({
  destino,
  credor,
  classificacao: SUGESTAO_CLASSIFICACAO_FOLHA[destino],
  diaVencimento: 20,
  mesesDepois: 1,
  contaContabil: '',
});
const DE_PARA = (['liquido-mensal', 'liquido-ferias', 'inss', 'inss-patronal', 'fgts', 'irrf'] as const).map(
  (d) => dp(d),
);

const PROCESSOS: ProcessoParaTitulos[] = [
  {
    id: 1,
    tipo: 'mensal',
    pagamento: '2026-10-05',
    totais: totais({
      proventos: 500_000,
      descontos: 80_000,
      liquido: 420_000,
      inss: 50_000,
      irrf: 30_000,
      fgts: 40_000,
      inssPatronal: 100_000,
      rat: 10_000,
      terceiros: 29_000,
    }),
  },
  {
    id: 2,
    tipo: 'ferias',
    pagamento: '2026-09-28',
    totais: totais({
      proventos: 120_000,
      descontos: 20_000,
      liquido: 100_000,
      inss: 15_000,
      irrf: 5_000,
      fgts: 9_600,
    }),
  },
  {
    id: 3,
    tipo: 'ferias',
    pagamento: '2026-09-28',
    totais: totais({ proventos: 60_000, descontos: 10_000, liquido: 50_000, inss: 10_000, fgts: 4_800 }),
  },
];

describe('parcelas e plano do período fechado (regras 6 e 10)', () => {
  it('soma o líquido por tipo e data de pagamento e os encargos no período', () => {
    const ps = parcelasDoFechamento(PROCESSOS);
    expect(ps).toEqual([
      { destino: 'liquido-mensal', valor: 420_000, vencimento: '2026-10-05' },
      { destino: 'liquido-ferias', valor: 150_000, vencimento: '2026-09-28' },
      { destino: 'inss', valor: 75_000, vencimento: null },
      { destino: 'inss-patronal', valor: 139_000, vencimento: null },
      { destino: 'fgts', valor: 54_400, vencimento: null },
      { destino: 'irrf', valor: 35_000, vencimento: null },
    ]);
    const e = esperadoDoFechamento(PROCESSOS);
    expect(e).toEqual({ liquido: 570_000, encargos: 303_400 });
  });

  it('monta um título por destino e vencimento, com o documento, a conta impressa e sem pendência', () => {
    const plano = montarPlanoTitulos({
      apuracao: 'mensal',
      periodo: '2026-09',
      parcelas: parcelasDoFechamento(PROCESSOS),
      dePara: DE_PARA,
      rotinas: ROTINAS,
      emissao: '2026-09-28',
    });
    expect(plano.pendencias).toEqual([]);
    expect(plano.titulos.map((t) => [t.destino, t.vencimento, t.valor, t.documento, t.cenario])).toEqual([
      ['liquido-mensal', '2026-10-05', 420_000, 2026_09_0405, 'origem-folha'],
      ['liquido-ferias', '2026-09-28', 150_000, 2026_09_1128, 'origem-folha'],
      ['inss', '2026-10-20', 75_000, 2026_09_1620, 'origem-encargo'],
      ['inss-patronal', '2026-10-20', 139_000, 2026_09_1720, 'origem-encargo'],
      ['fgts', '2026-10-20', 54_400, 2026_09_1520, 'origem-encargo'],
      ['irrf', '2026-10-20', 35_000, 2026_09_1820, 'origem-encargo'],
    ]);
    expect(plano.total).toBe(873_400);
    expect(conferirSomaTitulos(plano.titulos, 570_000 + 303_400)).toBeNull();
    expect(conferirSomaTitulos(plano.titulos, 873_399)).toEqual({ codigo: 'soma-divergente', destino: null });
    expect(plano.conta).toBe(
      'líquido da folha mensal R$ 4.200,00 + líquido das férias R$ 1.500,00 + INSS dos segurados R$ 750,00 + INSS patronal, RAT e terceiros R$ 1.390,00 + FGTS R$ 544,00 + IRRF R$ 350,00 = R$ 8.734,00',
    );
    expect(plano.titulos[0]?.referente).toBe('Folha 09/2026: líquido da folha mensal');
  });

  it('aceita o vencimento ajustado na prévia e barra o vencimento antes da emissão', () => {
    const base = {
      apuracao: 'mensal' as const,
      periodo: '2026-09',
      parcelas: parcelasDoFechamento(PROCESSOS),
      dePara: DE_PARA,
      rotinas: ROTINAS,
      emissao: '2026-09-30',
    };
    const p = montarPlanoTitulos({ ...base, vencimentos: new Map([['fgts:2026-10-20', '2026-10-07']]) });
    const fgts = p.titulos.find((t) => t.destino === 'fgts');
    expect(fgts?.vencimento).toBe('2026-10-07');
    expect(fgts?.documento).toBe(2026_09_1507);
    // As férias vencem em 28/09, antes da emissão de 30/09.
    expect(p.pendencias).toEqual([{ codigo: 'vencimento-antes-da-emissao', destino: 'liquido-ferias' }]);
  });

  it('pende o destino sem de-para e a rotina que não integra ao financeiro', () => {
    const p = montarPlanoTitulos({
      apuracao: 'mensal',
      periodo: '2026-09',
      parcelas: parcelasDoFechamento(PROCESSOS),
      dePara: DE_PARA.filter((d) => d.destino !== 'irrf'),
      rotinas: ROTINAS.map((r) => (r.id === 15 ? { ...r, financeiro: false } : r)),
      emissao: '2026-09-01',
    });
    expect(p.pendencias).toEqual([
      { codigo: 'rotina-sem-financeiro', destino: 'fgts' },
      { codigo: 'sem-de-para', destino: 'irrf' },
    ]);
    expect(p.titulos.find((t) => t.destino === 'irrf')).toMatchObject({ credor: null, classificacao: null });
  });

  it('sem valor: nenhum título, pendência sem-titulos', () => {
    const p = montarPlanoTitulos({
      apuracao: 'mensal',
      periodo: '2026-09',
      parcelas: [{ destino: 'inss', valor: 0, vencimento: null }],
      dePara: DE_PARA,
      rotinas: ROTINAS,
      emissao: '2026-09-01',
    });
    expect(p.titulos).toEqual([]);
    expect(p.pendencias).toEqual([{ codigo: 'sem-titulos', destino: null }]);
    expect(p.conta).toBe('nenhum título = R$ 0,00');
    expect(contaDosTitulos([]).total).toBe(0);
  });
});

describe('vencimento, documento e histórico', () => {
  it('vence no dia do de-para, no mês do período ou no seguinte, com o último dia do mês curto', () => {
    expect(vencimentoDoEncargo('mensal', '2026-09', 20, 1)).toBe('2026-10-20');
    expect(vencimentoDoEncargo('mensal', '2026-12', 7, 1)).toBe('2027-01-07');
    expect(vencimentoDoEncargo('mensal', '2026-01', 31, 1)).toBe('2026-02-28');
    expect(vencimentoDoEncargo('mensal', '2026-09', 10, 0)).toBe('2026-09-10');
    // O anual (13º) parte de dezembro.
    expect(vencimentoDoEncargo('anual', '2026', 20, 0)).toBe('2026-12-20');
    expect(vencimentoDoEncargo('anual', '2026', 20, 1)).toBe('2027-01-20');
  });

  it('documento AAAAMM·10000 + rotina·100 + dia; o anual usa o mês 13 e cabe no INTEGER', () => {
    expect(documentoDoTituloFolha('mensal', '2026-09', 4, '2026-10-05')).toBe(2_026_090_405);
    expect(documentoDoTituloFolha('anual', '2026', 14, '2026-12-18')).toBe(2_026_131_418);
    expect(documentoDoTituloFolha('anual', '2147', 18, '2147-12-31')).toBeLessThanOrEqual(2_147_483_647);
  });

  it('histórico curto e sem dado pessoal', () => {
    expect(referenteDoTituloFolha('liquido-decimo', 'anual', '2026')).toBe(
      'Folha 2026: líquido do 13º salário',
    );
    expect(referenteDoTituloFolha('inss-patronal', 'mensal', '2026-09').length).toBeLessThanOrEqual(60);
  });
});

describe('retorno conferido da folha externa', () => {
  it('líquido no vencimento do retorno; encargos por tipo e vencimento; "outro" fica sem destino', () => {
    const { parcelas, semDestino } = parcelasDoRetorno({
      liquido: 300_000,
      vencimentoLiquido: '2026-10-05',
      encargos: [
        { tipo: 'inss', valor: 40_000, vencimento: '2026-10-20' },
        { tipo: 'inss', valor: 5_000, vencimento: '2026-10-20' },
        { tipo: 'sindical', valor: 0, vencimento: '2026-10-10' },
        { tipo: 'outro', valor: 1_000, vencimento: '2026-10-10' },
        { tipo: 'fgts', valor: 24_000, vencimento: '2026-10-20' },
      ],
    });
    expect(parcelas).toEqual([
      { destino: 'liquido-mensal', valor: 300_000, vencimento: '2026-10-05' },
      { destino: 'inss', valor: 45_000, vencimento: '2026-10-20' },
      { destino: 'fgts', valor: 24_000, vencimento: '2026-10-20' },
    ]);
    expect(semDestino).toBe(1_000);
    expect(parcelasDoRetorno({ liquido: 0, vencimentoLiquido: null, encargos: [] }).parcelas).toEqual([]);
  });

  it('fatos do retorno: proventos por centro de custo da lotação (sem centro vai ao 0)', () => {
    expect(
      fatosDoRetorno(
        [
          { centroCusto: 12, proventos: 100 },
          { centroCusto: null, proventos: 50 },
          { centroCusto: 12, proventos: 30 },
          { centroCusto: 7, proventos: 0 },
        ],
        ROTINAS,
      ),
    ).toEqual([
      { rotina: 4, centroCusto: 0, natureza: 'provento', contabiliza: true, valor: 50 },
      { rotina: 4, centroCusto: 12, natureza: 'provento', contabiliza: true, valor: 130 },
    ]);
    expect(fatosDoRetorno([{ centroCusto: 1, proventos: 10 }], [])[0]?.contabiliza).toBe(false);
  });
});

describe('fatos contábeis e custo de pessoal (regra 11)', () => {
  const fatos = fatosDaFolha(
    [
      {
        tipo: 'mensal',
        vinculos: [
          {
            centroCusto: 10,
            proventos: 300_000,
            porPapel: { fgts: 24_000, inssPatronal: 60_000, rat: 6_000, terceiros: 17_400 },
          },
          { centroCusto: 20, proventos: 200_000, porPapel: { fgts: 16_000, inssPatronal: 40_000 } },
          { centroCusto: 10, proventos: 0, porPapel: {} },
        ],
      },
      { tipo: 'ferias', vinculos: [{ centroCusto: 10, proventos: 120_000, porPapel: { fgts: 9_600 } }] },
      { tipo: 'rescisao', vinculos: [{ centroCusto: 20, proventos: 10_000, porPapel: {} }] },
    ],
    ROTINAS,
  );

  it('um fato por centro, rotina e natureza, com o "contabiliza" do cadastro de rotinas', () => {
    expect(fatos).toEqual([
      { rotina: 4, centroCusto: 10, natureza: 'provento', contabiliza: true, valor: 300_000 },
      { rotina: 11, centroCusto: 10, natureza: 'provento', contabiliza: false, valor: 120_000 },
      { rotina: 15, centroCusto: 10, natureza: 'encargo', contabiliza: true, valor: 33_600 },
      { rotina: 17, centroCusto: 10, natureza: 'encargo', contabiliza: true, valor: 83_400 },
      { rotina: 4, centroCusto: 20, natureza: 'provento', contabiliza: true, valor: 200_000 },
      { rotina: 12, centroCusto: 20, natureza: 'provento', contabiliza: true, valor: 10_000 },
      { rotina: 15, centroCusto: 20, natureza: 'encargo', contabiliza: true, valor: 16_000 },
      { rotina: 17, centroCusto: 20, natureza: 'encargo', contabiliza: true, valor: 40_000 },
    ]);
    expect(
      fatosDaFolha([{ tipo: 'decimo2', vinculos: [{ centroCusto: 1, proventos: 5, porPapel: {} }] }], []),
    ).toEqual([{ rotina: 14, centroCusto: 1, natureza: 'provento', contabiliza: false, valor: 5 }]);
  });

  it('custo de pessoal por centro = proventos + encargos da empresa', () => {
    expect(custoPessoalPorCentro(fatos)).toEqual([
      { centroCusto: 10, proventos: 420_000, encargos: 117_000, total: 537_000 },
      { centroCusto: 20, proventos: 210_000, encargos: 56_000, total: 266_000 },
    ]);
  });

  it('o resumo do plano muda com qualquer título ou fato', () => {
    const plano = montarPlanoTitulos({
      apuracao: 'mensal',
      periodo: '2026-09',
      parcelas: parcelasDoFechamento(PROCESSOS),
      dePara: DE_PARA,
      rotinas: ROTINAS,
      emissao: '2026-09-01',
    });
    const a = textoResumoPlano('fechamento', 1, plano.titulos, fatos);
    expect(textoResumoPlano('fechamento', 1, plano.titulos, fatos.slice(1))).not.toBe(a);
    expect(textoResumoPlano('fechamento', 2, plano.titulos, fatos)).not.toBe(a);
    const semDePara = montarPlanoTitulos({
      ...{
        apuracao: 'mensal' as const,
        periodo: '2026-09',
        parcelas: [{ destino: 'sindical' as const, valor: 5, vencimento: null }],
      },
      dePara: [],
      rotinas: ROTINAS,
      emissao: '2026-09-01',
    });
    expect(textoResumoPlano('interface', 1, semDePara.titulos, [])).toContain('sindical:2026-10-20|6|||');
  });

  it('avisos de possível lançamento manual só com título no mês', () => {
    expect(
      avisosDeLancamentoManual([
        { destino: 'inss', titulos: 0 },
        { destino: 'fgts', titulos: 2 },
      ]),
    ).toEqual([{ codigo: 'possivel-lancamento-manual', destino: 'fgts', titulos: 2 }]);
  });
});
