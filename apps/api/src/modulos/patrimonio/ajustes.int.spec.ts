// W0-08, parte 7b (M1): os ajustes do bem (SGH_PAT_AJUSTE e SGH_PAT_AJUSTE_ESTORNO, script 1105) na cópia de dev, numa
// transação SEMPRE desfeita, com dados SINTÉTICOS numa empresa que não existe (9808), para não cruzar com cálculos de
// verdade: duas cotas calculadas; o impairment recusado sem a regra contábil do tipo (as contas) e gravado com ela; a
// cota seguinte recalculada sobre o valor recuperável na vida restante (prospectivo) com as cotas passadas intactas; o
// estorno do ajuste recusado enquanto houver cota depois dele e o estorno da depreciação anterior ao ajuste recusado;
// o estorno do ajuste depois de estornada a cota; a revisão de vida útil e a cota seguinte nela. Achado 6 (1109): o
// laudo é o PDF anexado ao bem (SGH_PAT_LAUDO); o ajuste com laudo que não é deste bem é recusado (laudo-inexistente).
// Só tabelas SGH_.
import {
  impedimentoDoEstorno,
  impedimentoDoEstornoAjuste,
  planejarAjuste,
  planoDaDepreciacao,
  resumoDoCalculo,
} from '@sgh/dominio-patrimonio';
import type { RegistrarAjusteBem } from '@sgh/contratos';
import {
  anexarLaudoBemSgh,
  calcularDepreciacaoSgh,
  ErroOperacao,
  type Escritor,
  escritasDaTransacao,
  estornarAjusteBemSgh,
  estornarDepreciacaoSgh,
  type Leitor,
  lerAjustesDoBem,
  lerBem,
  registrarAjusteBemSgh,
  type SituacaoAjusteLida,
  somenteSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../acesso/aplicacao/copia.spec-util.js';

const USUARIO = 'SGH.TESTE.W008';
const CENTRO = 2_000_110_201;
const EMPRESA = 9808;
const PAR = { aplicarCoeficiente: false, considerarResidual: true };

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (x) {
    if (x instanceof ErroOperacao) return x.problema.codigo ?? 'sem-codigo';
    return String(x);
  }
}

const retrato = async (l: Leitor) => {
  const r: Record<string, string> = {};
  for (const t of [
    'SGH_PAT_AJUSTE',
    'SGH_PAT_AJUSTE_ESTORNO',
    'SGH_PAT_BEM',
    'SGH_PAT_CALCULO',
    'SGH_CTB_REGRA',
  ]) {
    const [x] = await l.consultar(`SELECT COUNT(*) N, MAX(ID) M FROM ${t}`, [], { teto: 1 });
    r[t] = `${String(x?.['N'])}/${String(x?.['M'])}`;
  }
  return JSON.stringify(r);
};

const calcular = (e: Escritor, competencia: string) =>
  calcularDepreciacaoSgh(e, { empresa: EMPRESA, competencia }, USUARIO, ({ bens }) => {
    const plano = planoDaDepreciacao(bens, competencia, PAR);
    return {
      impedimentos: [],
      cotas: plano.cotas,
      ignorados: plano.semCota.length,
      totalCent: plano.totalCent,
      resumo: resumoDoCalculo(plano),
    };
  });

const estornarDep = (e: Escritor, competencia: string) =>
  estornarDepreciacaoSgh(
    e,
    { empresa: EMPRESA, competencia, motivo: 'calculo refeito no teste', origem: 'patrimonio/teste' },
    USUARIO,
    (s) => impedimentoDoEstorno(competencia, s),
  );

const planejar = (x: RegistrarAjusteBem, hoje: string) => (s: SituacaoAjusteLida) =>
  planejarAjuste(x, {
    bem: {
      valorCent: s.bem.valorCent,
      residualCent: s.bem.residualCent,
      vidaUtilMeses: s.bem.vidaUtilMeses,
      coeficiente: s.bem.coeficiente?.percentual ?? null,
      inicioDepreciacao: s.bem.inicioDepreciacao,
      depreciavel: s.bem.depreciavel,
      situacao: s.bem.situacao,
      acumuladaCent: s.bem.acumuladaCent,
      marco: s.marco,
    },
    ultimaCalculada: s.ultimaCalculada,
    hoje,
    contasConfiguradas: s.contasConfiguradas,
    lotesExportados: s.lotesExportados,
  });

async function cotasDoBem(l: Leitor, bem: number) {
  const ls = await l.consultar(
    `SELECT d.COMPETENCIA, d.VALOR_CENT, d.BASE_CENT,
            (SELECT COUNT(*) FROM SGH_PAT_CALCULO_ESTORNO z WHERE z.ID_CALCULO = d.ID_CALCULO) EST
       FROM SGH_PAT_DEPRECIACAO d WHERE d.HOSPITAL = ? AND d.ID_BEM = ? ORDER BY d.ID`,
    [l.hospital, bem],
    { teto: 50 },
  );
  return ls.map(
    (x) =>
      `${String(x['COMPETENCIA']).trim()}:${String(x['VALOR_CENT'])}${Number(x['EST']) > 0 ? ':estornada' : ''}`,
  );
}

describe.skipIf(!PODE_ESCREVER)('ajustes do bem na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('impairment prospectivo, recusas, estorno e revisão de vida útil; ROLLBACK', async () => {
    const cod = a.cod;
    const ctx = { ...a.c, traceId: 'int-w008-ajuste' };
    const antes = await a.nucleo.lerSomente(ctx, retrato);
    const r = await a.nucleo.desfazendoNaCopia(ctx, async (e0) => {
      const e = somenteSgh(e0);
      // Bem sintético: R$ 1.200,00 em 12 meses desde 2026-01, sem residual (cota de R$ 100,00).
      const g = await e.executarRetornando(
        `INSERT INTO SGH_PAT_BEM (ID, HOSPITAL, EMPRESA, PLAQUETA, DESCRICAO, GRUPO, ID_GPORIGEM, DOCUMENTO,
           TERMO_NUMERO, TERMO_DATA, TERMO_DOADOR, DATA_AQUISICAO, VALOR_CENT, RESIDUAL_CENT, VIDA_UTIL_MESES,
           INICIO_DEPREC, DEPRECIAVEL, ID_TBCENCUS, CRIADO_POR, ALTERADO_POR)
         VALUES (NEXT VALUE FOR SGH_GEN_PAT_BEM, ?, ?, 'W008AJ1', 'BEM SINTETICO W008 AJUSTE', 'maquinas', 1, 'termo',
           'T-W008AJ', DATE '2025-12-20', 'DOADOR SINTETICO', DATE '2025-12-20', 120000, 0, 12, '2026-01', 'T', ?, ?,
           ?) RETURNING ID`,
        [cod, EMPRESA, CENTRO, USUARIO, USUARIO],
      );
      const bem = Number(g['ID']);
      await calcular(e, '2026-01');
      await calcular(e, '2026-02');
      const cotasAntes = await cotasDoBem(e, bem);
      const laudo = await anexarLaudoBemSgh(
        e,
        {
          bem,
          nome: 'laudo-w008.pdf',
          descricao: 'Teste de recuperabilidade W008',
          chave: `patrimonio/laudos/${'a'.repeat(64)}.pdf`,
          sha256: 'a'.repeat(64),
          tamanho: 1234,
        },
        USUARIO,
      );
      const imp = (versao: number, l = laudo.id): RegistrarAjusteBem => ({
        tipo: 'impairment',
        bem,
        versao,
        motivo: 'Laudo de recuperabilidade W008',
        recuperavelCent: 50000,
        laudo: l,
      });
      const v1 = (await lerBem(e, bem))?.versao ?? -1;
      const semConta = await codigoDe(
        registrarAjusteBemSgh(
          e,
          { bem, versao: v1, motivo: 'x laudo', hoje: '2026-03-10' },
          USUARIO,
          planejar(imp(v1), '2026-03-10'),
        ),
      );
      // A regra contábil vigente do tipo impairment (as contas da perda) para a empresa sintética.
      await e.executar(
        `INSERT INTO SGH_CTB_REGRA (ID, HOSPITAL, EMPRESA, ORIGEM, TIPO_FATO, NOME, VERSAO, VIGENCIA_INICIO, CONTEUDO,
           IMPRESSAO, JUSTIFICATIVA, PUBLICADA_POR)
         VALUES (NEXT VALUE FOR SGH_GEN_CTB_REGRA, ?, ?, 7, 'impairment', 'IMPAIRMENT W008', 1, DATE '2026-01-01', '{}',
           ?, 'regra sintetica do teste', ?)`,
        [cod, EMPRESA, '0'.repeat(64), USUARIO],
      );
      const velho = await codigoDe(
        registrarAjusteBemSgh(
          e,
          { bem, versao: v1 - 1, motivo: 'x laudo', hoje: '2026-03-10' },
          USUARIO,
          planejar(imp(v1 - 1), '2026-03-10'),
        ),
      );
      const laudoInexistente = await codigoDe(
        registrarAjusteBemSgh(
          e,
          { bem, versao: v1, motivo: 'x laudo', hoje: '2026-03-10' },
          USUARIO,
          planejar(imp(v1, laudo.id + 1_000_000), '2026-03-10'),
        ),
      );
      const impairment = await registrarAjusteBemSgh(
        e,
        { bem, versao: v1, motivo: 'Laudo de recuperabilidade W008', hoje: '2026-03-10' },
        USUARIO,
        planejar(imp(v1), '2026-03-10'),
      );
      await calcular(e, '2026-03');
      const cotasComImpairment = await cotasDoBem(e, bem);
      const estornoComCota = await codigoDe(
        estornarAjusteBemSgh(
          e,
          { ajuste: impairment.id, motivo: 'laudo refeito', origem: 'patrimonio/teste', hoje: '2026-03-20' },
          USUARIO,
          (s) =>
            impedimentoDoEstornoAjuste({
              ...s,
              ajuste: { ...s.ajuste, estornado: s.ajuste.estorno !== null },
            }),
        ),
      );
      await estornarDep(e, '2026-03');
      const depAntesDoAjuste = await codigoDe(estornarDep(e, '2026-02'));
      const estornado = await estornarAjusteBemSgh(
        e,
        { ajuste: impairment.id, motivo: 'laudo refeito', origem: 'patrimonio/teste', hoje: '2026-03-20' },
        USUARIO,
        (s) =>
          impedimentoDoEstornoAjuste({ ...s, ajuste: { ...s.ajuste, estornado: s.ajuste.estorno !== null } }),
      );
      const v2 = (await lerBem(e, bem))?.versao ?? -1;
      const rev: RegistrarAjusteBem = {
        tipo: 'revisao-estimativa',
        bem,
        versao: v2,
        motivo: 'Revisao da vida util W008',
        vidaRestanteMeses: 5,
        residualCent: 0,
        laudo: null,
      };
      const revisao = await registrarAjusteBemSgh(
        e,
        { bem, versao: v2, motivo: rev.motivo, hoje: '2026-03-21' },
        USUARIO,
        planejar(rev, '2026-03-21'),
      );
      await calcular(e, '2026-03');
      const cotasFinais = await cotasDoBem(e, bem);
      const ajustes = await lerAjustesDoBem(e, bem);
      const escritas = await escritasDaTransacao(e0);
      return {
        laudo,
        laudoInexistente,
        cotasAntes,
        semConta,
        velho,
        impairment,
        cotasComImpairment,
        estornoComCota,
        depAntesDoAjuste,
        estornado,
        revisao,
        cotasFinais,
        ajustes,
        escritas,
      };
    });
    const depois = await a.nucleo.lerSomente(ctx, retrato);
    expect(r.cotasAntes).toEqual(['2026-01:10000', '2026-02:10000']);
    expect(r.semConta).toBe('sem-conta');
    expect(r.velho).toBe('desatualizado');
    expect(r.laudo).toMatchObject({
      bem: expect.any(Number),
      sha256: 'a'.repeat(64),
      tamanho: 1234,
      enviadoPor: USUARIO,
    });
    expect(r.laudoInexistente).toBe('laudo-inexistente');
    expect(r.impairment).toMatchObject({
      tipo: 'impairment',
      competenciaMarco: '2026-02',
      data: '2026-03-10',
      valorContabilAntesCent: 100000,
      valorContabilDepoisCent: 50000,
      perdaCent: 50000,
      acumuladaMarcoCent: 20000,
      vidaRestanteMeses: 10,
      laudo: r.laudo.id,
      plaqueta: 'W008AJ1',
      estorno: null,
    });
    // Prospectivo: as cotas de jan e fev seguem R$ 100,00; a de março sai do recuperável na vida restante (500/10).
    expect(r.cotasComImpairment).toEqual(['2026-01:10000', '2026-02:10000', '2026-03:5000']);
    expect(r.estornoComCota).toBe('cota-posterior');
    expect(r.depAntesDoAjuste).toBe('ajuste-posterior');
    expect(r.estornado.estorno).toMatchObject({
      data: '2026-03-20',
      motivo: 'laudo refeito',
      origem: 'patrimonio/teste',
      estornadoPor: USUARIO,
    });
    // A revisão: R$ 1.000,00 de valor contábil em 5 meses (cota de R$ 200,00); o cálculo estornado continua visível.
    expect(r.revisao).toMatchObject({
      tipo: 'revisao-estimativa',
      valorContabilDepoisCent: 100000,
      perdaCent: 0,
    });
    expect(r.cotasFinais).toEqual([
      '2026-01:10000',
      '2026-02:10000',
      '2026-03:5000:estornada',
      '2026-03:20000',
    ]);
    expect(r.ajustes.map((a) => [a.tipo, a.estorno !== null])).toEqual([
      ['revisao-estimativa', false],
      ['impairment', true],
    ]);
    for (const x of r.escritas) expect(x.tabela).toMatch(/^SGH_(PAT_|CTB_REGRA$)/);
    console.log(
      `[w0-08 ajuste ${a.cod}] escritas: ${[...new Set(r.escritas.map((x) => x.tabela))].join(', ')}`,
    );
    expect(depois).toBe(antes);
  });
});
