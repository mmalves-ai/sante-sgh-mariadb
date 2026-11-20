// Ficha do M55, fatia F5, regra 11: contratualização SUS só com contrato e habilitação ativos; metas quantitativas por
// grupo SIGTAP e qualitativas por indicador, com periodicidade e escore; painel produção × meta com as parcelas.
import {
  type ApuracaoSus,
  type ContratoSus,
  esquemaApuracaoSus,
  esquemaContratoSus,
  esquemaMetaSus,
  FAIXAS_CUMPRIMENTO_SUS_PADRAO,
  type MetaSus,
  type ProducaoSigtapSus,
  rotuloDominioSus,
  AFERICOES_SUS,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  conferirApuracaoSus,
  conferirContratoSus,
  conferirContratoSusAtivo,
  conferirMetaSus,
  cumprimentoPct,
  faixaDoCumprimento,
  fonteDaProducaoSus,
  incentivosDaCompetencia,
  lerFaixasCumprimento,
  mesesEntre,
  metaDoPeriodo,
  metaValeNaCompetencia,
  periodoDaMeta,
  realizadoQuantitativo,
  repasseEstimadoSus,
  resultadoMetaSus,
  somarMeses,
} from './meta.js';

const FAIXAS = lerFaixasCumprimento(FAIXAS_CUMPRIMENTO_SUS_PADRAO) ?? [];

const contrato = (x: Partial<ContratoSus> = {}): ContratoSus => ({
  id: 1,
  numero: 'SINT-001/2026',
  esfera: 3,
  gestor: 'Secretaria Municipal de Saúde (sintética)',
  objeto: 'Prestação de serviços hospitalares ao SUS',
  inicio: '2026-01-01',
  fim: '2026-12-31',
  cnes: '0000001',
  habilitacao: 'Habilitação sintética 01',
  habilitacaoValidade: null,
  redeAssistencia: 2,
  valorPreMensalCentavos: 1_000_000,
  valorPosMensalCentavos: 500_000,
  parteQualitativaPct: 40,
  incentivos: [],
  observacao: null,
  situacao: 'ativo',
  motivoEncerramento: null,
  encerradoPor: null,
  encerradoEm: null,
  criadoPor: 'SINT.SUS',
  criadoEm: '2026-01-01T00:00:00.000Z',
  alteradoPor: null,
  alteradoEm: null,
  versao: 1,
  ...x,
});

const meta = (x: Partial<MetaSus> = {}): MetaSus => ({
  id: 10,
  contrato: 1,
  tipo: 'quantitativa',
  descricao: 'Consultas especializadas',
  periodicidade: 10,
  inicio: '202601',
  fim: null,
  pontos: 10,
  nivelSigtap: 'subgrupo',
  codigoSigtap: '0301',
  modalidade: 'ambulatorial',
  complexidade: 3,
  indicador: null,
  formato: null,
  sentido: null,
  unidade: null,
  afericao: null,
  valorMeta: 100,
  ativa: true,
  por: 'SINT.SUS',
  em: '2026-01-01T00:00:00.000Z',
  versao: 1,
  ...x,
});

const qualitativa = (x: Partial<MetaSus> = {}): MetaSus =>
  meta({
    id: 20,
    tipo: 'qualitativa',
    descricao: 'Taxa de ocupação',
    nivelSigtap: null,
    codigoSigtap: null,
    modalidade: null,
    complexidade: null,
    indicador: 2,
    formato: 6,
    sentido: 'maior',
    unidade: '%',
    afericao: 1,
    valorMeta: 85,
    ...x,
  });

const entradaContrato = (x: Record<string, unknown> = {}) =>
  esquemaContratoSus.parse({
    chave: 'contrato-sus-0001',
    numero: 'SINT-001/2026',
    esfera: 3,
    gestor: 'Secretaria Municipal de Saúde (sintética)',
    objeto: 'Prestação de serviços hospitalares',
    inicio: '2026-01-01',
    fim: '2026-12-31',
    valorPreMensalCentavos: 1_000_000,
    ...x,
  });

const entradaMeta = (x: Record<string, unknown> = {}) =>
  esquemaMetaSus.parse({
    chave: 'meta-sus-0001',
    tipo: 'quantitativa',
    descricao: 'Consultas especializadas',
    periodicidade: 10,
    inicio: '202601',
    nivelSigtap: 'subgrupo',
    codigoSigtap: '0301',
    modalidade: 'ambulatorial',
    valorMeta: 100,
    ...x,
  });

const producao: ProducaoSigtapSus[] = [
  { competencia: '202604', modalidade: 'ambulatorial', codigo: '0301010072', quantidade: 90 },
  { competencia: '202605', modalidade: 'ambulatorial', codigo: '0301010072', quantidade: 100 },
  { competencia: '202606', modalidade: 'ambulatorial', codigo: '0301060029', quantidade: 80 },
  { competencia: '202606', modalidade: 'hospitalar', codigo: '0301060029', quantidade: 50 },
  { competencia: '202606', modalidade: 'ambulatorial', codigo: '0202010031', quantidade: 999 },
  { competencia: '202607', modalidade: 'ambulatorial', codigo: '0301010072', quantidade: 999 },
];

describe('competências', () => {
  it('soma meses e conta a distância', () => {
    expect(somarMeses('202611', 3)).toBe('202702');
    expect(somarMeses('202601', -1)).toBe('202512');
    expect(mesesEntre('202511', '202602')).toBe(3);
  });
});

describe('faixas de cumprimento (parâmetro)', () => {
  it('lê o padrão de mercado: quatro faixas do escore Ótimo ao Ruim', () => {
    expect(FAIXAS.map((f) => [f.minimoPct, f.escore, f.repassePct])).toEqual([
      [95, 4, 100],
      [85, 3, 90],
      [70, 2, 70],
      [0, 1, 0],
    ]);
    expect(faixaDoCumprimento(120, FAIXAS).escore).toBe(4);
    expect(faixaDoCumprimento(94.99, FAIXAS).escore).toBe(3);
    expect(faixaDoCumprimento(70, FAIXAS).escore).toBe(2);
    expect(faixaDoCumprimento(10, FAIXAS).escore).toBe(1);
  });
  it('recusa faixas fora de ordem, repasse crescente, acima de 100% ou sem o 0', () => {
    expect(lerFaixasCumprimento('95:100,85:90,70:70')).toBeNull();
    expect(lerFaixasCumprimento('85:100,95:90,70:70,0:0')).toBeNull();
    expect(lerFaixasCumprimento('95:90,85:100,70:70,0:0')).toBeNull();
    expect(lerFaixasCumprimento('95:120,85:90,70:70,0:0')).toBeNull();
    expect(lerFaixasCumprimento('95:100,85:90,70:70,10:0')).toBeNull();
    expect(lerFaixasCumprimento('95:100,85:x,70:70,0:0')).toBeNull();
    expect(lerFaixasCumprimento('95:100,85,70:70,0:0')).toBeNull();
  });
});

describe('contrato com o gestor', () => {
  it('aceita o cadastro completo', () => {
    expect(conferirContratoSus(entradaContrato(), { numeroDuplicado: false })).toEqual([]);
  });
  it('recusa vigência invertida, número repetido, orçamento zerado e parte qualitativa sem pré-fixado', () => {
    const r = conferirContratoSus(
      entradaContrato({ fim: '2025-12-31', valorPreMensalCentavos: 0, valorPosMensalCentavos: 0 }),
      { numeroDuplicado: true },
    );
    expect(r.map((x) => x.codigo)).toEqual([
      'fim-antes-do-inicio',
      'numero-duplicado',
      'orcamento-zerado',
      'parte-qualitativa-sem-pre',
    ]);
    expect(r[0]?.mensagem).toContain('fim da vigência');
  });
  it('recusa incentivo fora da vigência e repetido', () => {
    const inc = { nome: 'Incentivo sintético', valorMensalCentavos: 10_000, inicio: '2026-02-01' };
    const r = conferirContratoSus(
      entradaContrato({
        incentivos: [
          { ...inc, incentivo: 0 },
          { ...inc, incentivo: 0, nome: 'incentivo sintético' },
          { ...inc, nome: 'Outro', inicio: '2025-06-01' },
          { ...inc, nome: 'Com código', incentivo: 7 },
          { ...inc, nome: 'Com código de novo', incentivo: 7, fim: '2027-01-31' },
        ],
      }),
      { numeroDuplicado: false },
    );
    expect(r.map((x) => [x.codigo, x.campos?.[0]])).toEqual([
      ['incentivo-repetido', 'incentivos.1'],
      ['incentivo-fora-da-vigencia', 'incentivos.2'],
      ['incentivo-fora-da-vigencia', 'incentivos.4'],
      ['incentivo-repetido', 'incentivos.4'],
    ]);
  });
  it('regra 11: só com contrato vigente, CNES e habilitação SUS ativos', () => {
    expect(conferirContratoSusAtivo(contrato(), '2026-06-15', '0000001')).toEqual([]);
    expect(conferirContratoSusAtivo(contrato(), '2026-06-15', null)).toEqual([]);
    expect(
      conferirContratoSusAtivo(contrato({ situacao: 'encerrado' }), '2026-06-15', null).map((x) => x.codigo),
    ).toEqual(['contrato-encerrado']);
    expect(
      conferirContratoSusAtivo(contrato({ cnes: null, habilitacao: null }), '2027-01-02', null).map(
        (x) => x.codigo,
      ),
    ).toEqual(['contrato-nao-vigente', 'cnes-ausente', 'habilitacao-ausente']);
    expect(
      conferirContratoSusAtivo(contrato({ habilitacaoValidade: '2026-05-31' }), '2026-06-15', '0000002').map(
        (x) => x.codigo,
      ),
    ).toEqual(['cnes-divergente', 'habilitacao-vencida']);
  });
  it('incentivos da competência com a soma impressa', () => {
    const c = contrato({
      incentivos: [
        { incentivo: null, nome: 'A', valorMensalCentavos: 10_000, inicio: '2026-01-01', fim: null },
        { incentivo: null, nome: 'B', valorMensalCentavos: 5_050, inicio: '2026-07-01', fim: '2026-08-31' },
      ],
    });
    expect(incentivosDaCompetencia(c, '202607')).toEqual({
      totalCentavos: 15_050,
      conta: ['incentivos = A R$ 100,00 + B R$ 50,50 = R$ 150,50'],
    });
    expect(incentivosDaCompetencia(c, '202701').totalCentavos).toBe(0);
  });
});

describe('meta no contrato', () => {
  const vigente = contrato();
  it('aceita a quantitativa por subgrupo e a qualitativa por indicador', () => {
    expect(conferirMetaSus(entradaMeta(), vigente, { sigtapExiste: true })).toEqual([]);
    const q = entradaMeta({
      tipo: 'qualitativa',
      nivelSigtap: null,
      codigoSigtap: null,
      modalidade: null,
      indicador: 2,
      formato: 6,
      sentido: 'menor',
      unidade: '%',
      afericao: 1,
      valorMeta: 3.5,
    });
    expect(conferirMetaSus(q, vigente, { sigtapExiste: false })).toEqual([]);
  });
  it('recusa periodicidade submensal ou desconhecida e meta fora da vigência', () => {
    expect(
      conferirMetaSus(entradaMeta({ periodicidade: 8 }), vigente, { sigtapExiste: true }).map(
        (x) => x.codigo,
      ),
    ).toEqual(['periodicidade-submensal']);
    expect(
      conferirMetaSus(entradaMeta({ periodicidade: 99, inicio: '202512' }), vigente, {
        sigtapExiste: true,
      }).map((x) => x.codigo),
    ).toEqual(['periodicidade-invalida', 'meta-fora-da-vigencia']);
    expect(
      conferirMetaSus(entradaMeta({ fim: '202701' }), vigente, { sigtapExiste: true }).map((x) => x.codigo),
    ).toEqual(['meta-fora-da-vigencia']);
  });
  it('recusa a quantitativa sem SIGTAP, com tamanho errado, inexistente ou com campos de qualitativa', () => {
    const cod = (x: Record<string, unknown>, existe = true) =>
      conferirMetaSus(entradaMeta(x), vigente, { sigtapExiste: existe }).map((r) => r.codigo);
    expect(cod({ codigoSigtap: null })).toEqual(['sigtap-obrigatorio']);
    expect(cod({ codigoSigtap: '03' })).toEqual(['sigtap-tamanho']);
    expect(cod({}, false)).toEqual(['sigtap-inexistente']);
    expect(cod({ indicador: 2 })).toEqual(['campos-de-outro-tipo']);
  });
  it('recusa a qualitativa sem indicador, sem formato, sim ou não fora da regra e inteira com decimal', () => {
    const base = {
      tipo: 'qualitativa',
      nivelSigtap: null,
      codigoSigtap: null,
      modalidade: null,
      indicador: 2,
      formato: 6,
      sentido: 'maior',
    };
    const cod = (x: Record<string, unknown>) =>
      conferirMetaSus(entradaMeta({ ...base, ...x }), vigente, { sigtapExiste: false }).map((r) => r.codigo);
    expect(cod({ indicador: null, formato: null })).toEqual(['indicador-obrigatorio', 'formato-obrigatorio']);
    expect(cod({ formato: 2, valorMeta: 2 })).toEqual(['meta-sim-nao']);
    expect(cod({ formato: 2, valorMeta: 1, sentido: 'menor' })).toEqual(['meta-sim-nao']);
    expect(cod({ formato: 7, valorMeta: 2.5 })).toEqual(['meta-inteira']);
    expect(cod({ modalidade: 'todas' })).toEqual(['campos-de-outro-tipo']);
  });
  it('contrato encerrado não recebe meta', () => {
    expect(
      conferirMetaSus(entradaMeta(), contrato({ situacao: 'encerrado' }), { sigtapExiste: true }).map(
        (x) => x.codigo,
      ),
    ).toEqual(['contrato-encerrado']);
  });
  it('vale na competência só ativa e entre o início e o fim', () => {
    expect(metaValeNaCompetencia(meta(), '202606')).toBe(true);
    expect(metaValeNaCompetencia(meta({ ativa: false }), '202606')).toBe(false);
    expect(metaValeNaCompetencia(meta({ fim: '202605' }), '202606')).toBe(false);
    expect(metaValeNaCompetencia(meta(), '202512')).toBe(false);
  });
});

describe('período, meta do período e realizado', () => {
  it('trimestral desde janeiro: junho está no período de abril a junho', () => {
    const p = periodoDaMeta(meta(), '202606');
    expect(p).toEqual({
      inicio: '202604',
      fim: '202606',
      competencias: ['202604', '202605', '202606'],
      meses: 3,
    });
    expect(periodoDaMeta(meta(), '202512').inicio).toBe('202601');
    expect(periodoDaMeta(meta({ periodicidade: 99 }), '202606').meses).toBe(1);
    expect(metaDoPeriodo(meta(), p)).toBe(300);
    expect(metaDoPeriodo(qualitativa(), p)).toBe(85);
  });
  it('soma a produção pelo prefixo SIGTAP e pela modalidade da meta, por competência', () => {
    const p = periodoDaMeta(meta(), '202606');
    expect(realizadoQuantitativo(meta(), producao, p)).toEqual({
      total: 270,
      porCompetencia: [
        { competencia: '202604', quantidade: 90 },
        { competencia: '202605', quantidade: 100 },
        { competencia: '202606', quantidade: 80 },
      ],
    });
    expect(realizadoQuantitativo(meta({ modalidade: 'todas' }), producao, p).total).toBe(320);
    expect(realizadoQuantitativo(meta({ codigoSigtap: null }), producao, p).total).toBe(0);
  });
  it('cumprimento: realizado ÷ meta; "quanto menor, melhor" é meta ÷ realizado', () => {
    expect(cumprimentoPct(meta(), 300, 270)).toBe(90);
    expect(cumprimentoPct(meta(), 0, 10)).toBe(0);
    expect(cumprimentoPct(qualitativa({ sentido: 'menor' }), 3, 4)).toBe(75);
    expect(cumprimentoPct(qualitativa({ sentido: 'menor' }), 3, 2)).toBe(100);
  });
});

describe('resultado da meta no período, com as parcelas', () => {
  it('quantitativa pela produção: 270 de 300 = 90%, escore Bom, 9 de 10 pontos', () => {
    const r = resultadoMetaSus(meta(), '202606', {
      producao,
      fonte: 'contas-sus',
      apuracao: null,
      faixas: FAIXAS,
    });
    expect(r).toMatchObject({
      metaPeriodo: 300,
      realizado: 270,
      cumprimentoPct: 90,
      escore: 3,
      pontosObtidos: 9,
      origem: 'contas-sus',
      apurada: false,
      apuracaoRegistrada: null,
    });
    expect(r.conta).toEqual([
      'meta do período = 100 por competência × 3 = 300',
      'realizado = 90 (202604) + 100 (202605) + 80 (202606) = 270',
      'cumprimento = 270 ÷ 300 × 100 = 90%',
      'pontos = 10 × 90% = 9',
    ]);
  });
  it('a apuração registrada vale no lugar da produção ao vivo', () => {
    const apuracao: ApuracaoSus = {
      id: 1,
      meta: 10,
      competencia: '202606',
      inicioPeriodo: '202604',
      metaPeriodo: 300,
      realizado: 330,
      cumprimentoPct: 110,
      escore: 4,
      origem: 'faturamento-sus',
      observacao: null,
      por: 'SINT.SUS',
      em: '2026-07-05T00:00:00.000Z',
      versao: 1,
    };
    const r = resultadoMetaSus(meta(), '202605', { producao, fonte: 'contas-sus', apuracao, faixas: FAIXAS });
    expect(r).toMatchObject({
      realizado: 330,
      cumprimentoPct: 110,
      escore: 4,
      pontosObtidos: 10,
      apurada: true,
      apuracaoRegistrada: { id: 1, versao: 1, observacao: null },
    });
    expect(r.conta[1]).toBe('realizado = 330 (apuração registrada)');
  });
  it('qualitativa sem apuração fica pendente; com apuração é tudo ou nada nos pontos', () => {
    const x = { producao, fonte: 'faturamento-sus' as const, faixas: FAIXAS };
    const pendente = resultadoMetaSus(qualitativa(), '202606', { ...x, apuracao: null });
    expect(pendente).toMatchObject({
      realizado: null,
      cumprimentoPct: null,
      escore: null,
      pontosObtidos: null,
    });
    expect(pendente.conta).toEqual([
      'meta do período = 85 %',
      'realizado = sem apuração registrada no período',
    ]);
    const ap = (realizado: number): ApuracaoSus => ({
      id: 2,
      meta: 20,
      competencia: '202606',
      inicioPeriodo: '202604',
      metaPeriodo: 85,
      realizado,
      cumprimentoPct: 0,
      escore: 1,
      origem: 'informado',
      observacao: null,
      por: 'SINT.SUS',
      em: '2026-07-05T00:00:00.000Z',
      versao: 1,
    });
    expect(resultadoMetaSus(qualitativa(), '202606', { ...x, apuracao: ap(80) })).toMatchObject({
      cumprimentoPct: 94.12,
      escore: 3,
      pontosObtidos: 0,
    });
    const menor = resultadoMetaSus(qualitativa({ sentido: 'menor', valorMeta: 3, unidade: null }), '202606', {
      ...x,
      apuracao: ap(2),
    });
    expect(menor).toMatchObject({ cumprimentoPct: 100, pontosObtidos: 10 });
    expect(menor.conta).toContain('cumprimento = 2 ≤ 3 = 100%');
    expect(menor.conta).toContain('pontos = 10 (cumprida)');
    const pior = resultadoMetaSus(qualitativa({ sentido: 'menor', valorMeta: 3 }), '202606', {
      ...x,
      apuracao: ap(6),
    });
    expect(pior.conta).toContain('cumprimento = 3 ÷ 6 × 100 = 50%');
    expect(pior.conta).toContain('pontos = 0 de 10 (não cumprida)');
  });
});

describe('apuração do período', () => {
  const ap = (x: Record<string, unknown> = {}) =>
    esquemaApuracaoSus.parse({ chave: 'apuracao-sus-01', competencia: '202606', ...x });
  it('quantitativa na última competência do período, depois dele', () => {
    expect(conferirApuracaoSus(ap(), meta(), '202607', { apuracaoExistente: false })).toEqual([]);
  });
  it('recusa competência que não fecha o período, futura, fora da meta, e realizado na quantitativa', () => {
    const cod = (e: ReturnType<typeof ap>, m: MetaSus, atual: string, existe = false) =>
      conferirApuracaoSus(e, m, atual, { apuracaoExistente: existe }).map((r) => r.codigo);
    expect(cod(ap({ competencia: '202605' }), meta(), '202607')).toEqual(['competencia-nao-fecha-periodo']);
    expect(cod(ap(), meta(), '202606')).toEqual(['competencia-futura']);
    expect(cod(ap(), meta({ fim: '202603' }), '202607')).toEqual(['competencia-nao-fecha-periodo']);
    expect(cod(ap({ realizado: 5 }), meta(), '202607')).toEqual(['realizado-de-meta-quantitativa']);
    expect(cod(ap(), meta(), '202607', true)).toEqual(['apuracao-repetida']);
    expect(cod(ap({ versaoVista: 1 }), meta(), '202607', true)).toEqual([]);
    expect(cod(ap(), meta({ ativa: false }), '202607')).toEqual(['meta-inativa']);
  });
  it('qualitativa pede o resultado; sim ou não só 0 ou 1', () => {
    const cod = (e: ReturnType<typeof ap>, m: MetaSus) =>
      conferirApuracaoSus(e, m, '202607', { apuracaoExistente: false }).map((r) => r.codigo);
    expect(cod(ap(), qualitativa())).toEqual(['realizado-obrigatorio']);
    expect(cod(ap({ realizado: 2 }), qualitativa({ formato: 2, valorMeta: 1 }))).toEqual([
      'realizado-sim-nao',
    ]);
    expect(cod(ap({ realizado: 1 }), qualitativa({ formato: 2, valorMeta: 1 }))).toEqual([]);
  });
});

describe('repasse estimado da competência', () => {
  const c = contrato({
    incentivos: [
      { incentivo: null, nome: 'A', valorMensalCentavos: 20_000, inicio: '2026-01-01', fim: null },
    ],
  });
  const res = (pontosObtidos: number | null, tipo: 'quantitativa' | 'qualitativa', pontos = 10) =>
    ({
      ...resultadoMetaSus(tipo === 'quantitativa' ? meta() : qualitativa(), '202606', {
        producao: [],
        fonte: 'contas-sus',
        apuracao: null,
        faixas: FAIXAS,
      }),
      pontos,
      pontosObtidos,
    }) as const;
  it('divide o pré-fixado, paga cada parte pela faixa e soma os incentivos, com a conta', () => {
    const r = repasseEstimadoSus(
      c,
      '202606',
      [res(9, 'quantitativa'), res(10, 'quantitativa'), res(10, 'qualitativa'), res(0, 'qualitativa')],
      FAIXAS,
    );
    expect(
      r.partes.map((p) => [p.tipo, p.valorCentavos, p.cumprimentoPct, p.escore, p.repasseCentavos]),
    ).toEqual([
      ['quantitativa', 600_000, 95, 4, 600_000],
      ['qualitativa', 400_000, 50, 1, 0],
    ]);
    expect(r.totalEstimadoCentavos).toBe(620_000);
    expect(r.conta[0]).toBe(
      'pré-fixado mensal = R$ 10.000,00 = quantitativa R$ 6.000,00 (60%) + qualitativa R$ 4.000,00 (40%)',
    );
    expect(r.conta).toContain('total estimado = R$ 6.000,00 + R$ 0,00 + R$ 200,00 = R$ 6.200,00');
    expect(r.partes[0]?.conta).toContain(
      'cumprimento da parte = 19 ÷ 20 × 100 = 95% (faixa a partir de 95%: repasse 100%)',
    );
  });
  it('meta sem resultado deixa o total pendente; tipo sem meta paga a parte inteira', () => {
    const r = repasseEstimadoSus(c, '202606', [res(null, 'qualitativa')], FAIXAS);
    expect(r.partes[0]).toMatchObject({ repassePct: 100, repasseCentavos: 600_000 });
    expect(r.partes[1]).toMatchObject({ repassePct: null, repasseCentavos: null });
    expect(r.totalEstimadoCentavos).toBeNull();
    expect(r.conta).toContain('total estimado = pendente (há meta sem resultado no período)');
  });
  it('contrato só pós-fixado: as partes ficam sem valor', () => {
    const r = repasseEstimadoSus(
      contrato({ valorPreMensalCentavos: 0, parteQualitativaPct: 0 }),
      '202606',
      [res(5, 'quantitativa')],
      FAIXAS,
    );
    expect(r.partes[0]).toMatchObject({ valorCentavos: 0, repasseCentavos: 0 });
    expect(r.partes[0]?.conta).toContain('parte quantitativa: sem valor no contrato');
    expect(r.totalEstimadoCentavos).toBe(0);
    expect(r.conta.at(-1)).toBe(
      'pós-fixado estimado = R$ 5.000,00 (pago pela produção aprovada, fora do total)',
    );
  });
});

describe('fonte da produção e rótulos', () => {
  it('faturamento SUS quando ligado; senão as contas SUS', () => {
    expect(fonteDaProducaoSus(true)).toBe('faturamento-sus');
    expect(fonteDaProducaoSus(false)).toBe('contas-sus');
  });
  it('o rótulo do produto para a aferição do código 1', () => {
    expect(rotuloDominioSus(AFERICOES_SUS, 1)).toBe('Sistema de gestão do hospital');
    expect(rotuloDominioSus(AFERICOES_SUS, 9)).toBe('9');
    expect(rotuloDominioSus(AFERICOES_SUS, null)).toBe('');
  });
});
