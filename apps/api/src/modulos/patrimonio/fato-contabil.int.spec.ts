// Contrato de efeito da contabilização automática do patrimônio (C2-093, ADR 0003), contra o MariaDB real do cliente
// f22_o2 com massa SINTÉTICA: o cálculo da depreciação publica um fato `depreciacao` por cota, na mesma transação, no
// último dia da competência e pelo centro de custo do bem; o estorno do cálculo publica o estorno de cada fato (o
// original fica, nada apagado); o ajuste por impairment publica o fato da perda e o seu estorno o estorno do fato; a
// revisão de estimativa não gera fato. Os fatos nascem pendentes para a regra de contabilização publicada.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_PAT,
  contextoPat,
  encerrarMassaPatrimonio,
  type MassaPatrimonio,
  prepararMassaPatrimonio,
  SEM_BANCO_PAT,
  trilhaPat,
} from './massa.spec-util.js';
import { PortaPatrimonioPropria } from './porta-propria.js';

interface FatoLido {
  id: number;
  evento: string;
  entidade: string;
  entidadeId: number;
  data: string;
  competencia: string;
  valor: string;
  centro: number | null;
  estorno: number;
  estornado: number | null;
  situacao: string;
  campos: Record<string, unknown>;
}

describe.skipIf(SEM_BANCO_PAT)('fato contábil publicado pelo patrimônio (MariaDB, cliente f22_o2)', () => {
  let m: MassaPatrimonio | null = null;
  let porta: PortaPatrimonioPropria;
  let bem = 0;

  const fatos = (): Promise<FatoLido[]> =>
    m!.nucleo.lerSomente({ cliente: CLIENTE_PAT, correlacao: 'c2-093-fatos' }, async (l) =>
      (
        await l.consultar(
          `SELECT f.id, ev.codigo, f.entidade_origem, f.entidade_origem_id, DATE_FORMAT(f.data_fato, '%Y-%m-%d') AS d,
                  DATE_FORMAT(f.competencia, '%Y-%m-%d') AS c, f.valor, f.centro_custo_id, f.estorno,
                  f.estornado_fato_contabil_id, f.situacao, f.campos
             FROM fato_contabil f JOIN evento_contabil ev ON ev.id = f.evento_contabil_id
            WHERE f.estabelecimento_id = ? ORDER BY f.id`,
          [m!.est],
        )
      ).map((r: Record<string, unknown>) => ({
        id: Number(r['id']),
        evento: String(r['codigo']),
        entidade: String(r['entidade_origem']),
        entidadeId: Number(r['entidade_origem_id']),
        data: String(r['d']),
        competencia: String(r['c']),
        valor: String(r['valor']),
        centro: r['centro_custo_id'] == null ? null : Number(r['centro_custo_id']),
        estorno: Number(r['estorno']),
        estornado: r['estornado_fato_contabil_id'] == null ? null : Number(r['estornado_fato_contabil_id']),
        situacao: String(r['situacao']),
        campos: (typeof r['campos'] === 'string' ? JSON.parse(r['campos']) : r['campos']) as Record<
          string,
          unknown
        >,
      })),
    );

  beforeAll(async () => {
    m = await prepararMassaPatrimonio('F');
    porta = new PortaPatrimonioPropria(m.nucleo, CLIENTE_PAT);
    const [b] = await porta.cadastrar(
      contextoPat(m),
      {
        bens: [
          {
            empresa: 1,
            plaqueta: 'C2093-FT1',
            descricao: 'BEM SINTETICO DO FATO CONTABIL',
            grupo: 'maquinas',
            origem: m.origem,
            documento: 'termo',
            nota: null,
            itemNota: null,
            item: null,
            termo: { numero: 'T-FT', data: '2025-01-05', doador: '' },
            dataAquisicao: '2025-01-05',
            valorCent: 60_000_00,
            residualCent: 0,
            vidaUtilMeses: 60,
            coeficiente: null,
            inicioDepreciacao: '2025-02',
            depreciavel: true,
            centro: m.centro1,
            localDetalhe: null,
            tipoResponsavel: null,
            responsavel: null,
            marca: null,
            modelo: null,
            numeroSerie: null,
          },
        ],
        item: null,
      },
      'l0211p.patrimonio',
      (n) => `FT${n}`,
      trilhaPat(m, 'patrimonio.bem.cadastrado', 'bem_patrimonial', null),
    );
    bem = b!.id;
  });
  afterAll(async () => {
    await encerrarMassaPatrimonio(m);
  });

  it('depreciação: o cálculo publica o fato da cota e o estorno publica o estorno do fato, sem apagar o original', async () => {
    const c = contextoPat(m!);
    const r = await porta.bensParaDepreciar(c, 1, '2025-03');
    const alvo = r.bens.find((x) => x.id === bem)!;
    expect(alvo).toBeDefined();
    const trilha = trilhaPat(m!, 'patrimonio.depreciacao.calculada', 'calculo_depreciacao', null);
    const montar = () => ({
      impedimentos: [],
      cotas: [
        {
          bem: alvo.id,
          plaqueta: alvo.plaqueta,
          grupo: alvo.grupo,
          centro: alvo.centro,
          baseCent: alvo.valorCent,
          residualCent: alvo.residualCent,
          vidaUtilMeses: alvo.vidaUtilMeses,
          coeficiente: 1,
          acumuladaAntesCent: alvo.acumuladaCent,
          valorCent: 1_000_00,
        },
      ],
      ignorados: r.bens.length - 1,
      totalCent: 1_000_00,
      resumo: '',
    });
    const um = await porta.calcular(
      contextoPat(m!),
      { empresa: 1, competencia: '2025-03' },
      't',
      montar,
      trilha,
    );
    const cota = await m!.nucleo.lerSomente({ cliente: CLIENTE_PAT, correlacao: 'c2-093-cota' }, (l) =>
      l.uma<{ id: number }>('SELECT id FROM cota_depreciacao WHERE calculo_depreciacao_id = ?', [
        um.calculo.id,
      ]),
    );
    const depois = await fatos();
    expect(depois).toHaveLength(1);
    expect(depois[0]).toMatchObject({
      evento: 'depreciacao',
      entidade: 'cota_depreciacao',
      entidadeId: Number(cota!.id),
      data: '2025-03-31',
      competencia: '2025-03-01',
      valor: '1000.00',
      centro: m!.centro1,
      estorno: 0,
      situacao: 'pendente',
      campos: { grupoBem: 'maquinas', bem },
    });

    await porta.estornar(
      contextoPat(m!),
      { empresa: 1, competencia: '2025-03', motivo: 'Cálculo de teste', origem: 'tela' },
      't',
      () => null,
      trilha,
    );
    const estornados = await fatos();
    expect(estornados).toHaveLength(2);
    expect(estornados[0]!.id).toBe(depois[0]!.id);
    expect(estornados[1]).toMatchObject({
      evento: 'depreciacao',
      entidade: 'cota_depreciacao',
      entidadeId: Number(cota!.id),
      valor: '1000.00',
      centro: m!.centro1,
      estorno: 1,
      estornado: depois[0]!.id,
      situacao: 'pendente',
    });
    // Recalcular numa rodada nova publica o fato da cota nova; o estorno antigo continua.
    await porta.calcular(contextoPat(m!), { empresa: 1, competencia: '2025-03' }, 't', montar, trilha);
    const rodada2 = await fatos();
    expect(rodada2.filter((f) => f.estorno === 0)).toHaveLength(2);
    expect(rodada2.filter((f) => f.estorno === 1)).toHaveLength(1);
  });

  it('impairment publica o fato da perda e o estorno do ajuste o estorno do fato; revisão de estimativa não publica', async () => {
    const c = contextoPat(m!);
    const antes = (await fatos()).length;
    const trilha = trilhaPat(m!, 'patrimonio.ajuste.registrado', 'ajuste_valor_bem', bem);
    const ajuste = (tipo: 'impairment' | 'revisao-estimativa', motivo: string) =>
      porta.bem(c, bem).then((b) =>
        porta.registrarAjuste(
          contextoPat(m!),
          { bem, versao: b!.versao, motivo, hoje: '2026-11-21' },
          't',
          () => ({
            ajuste: {
              tipo,
              competenciaMarco: '2025-12',
              data: '2025-12-31',
              valorContabilAntesCent: 50_000_00,
              valorContabilDepoisCent: tipo === 'impairment' ? 40_000_00 : 50_000_00,
              acumuladaMarcoCent: 10_000_00,
              perdaCent: tipo === 'impairment' ? 10_000_00 : 0,
              residualCent: 0,
              vidaRestanteMeses: 49,
              valorJustoCent: null,
              laudo: null,
              origem: 'tela',
            },
          }),
          trilha,
        ),
      );
    const a = await ajuste('impairment', 'Teste de recuperabilidade sintético');
    const comPerda = await fatos();
    expect(comPerda).toHaveLength(antes + 1);
    expect(comPerda.at(-1)).toMatchObject({
      evento: 'impairment',
      entidade: 'ajuste_valor_bem',
      entidadeId: a.id,
      data: '2025-12-31',
      competencia: '2025-12-01',
      valor: '10000.00',
      centro: m!.centro1,
      estorno: 0,
      situacao: 'pendente',
      campos: { grupoBem: 'maquinas', bem },
    });
    await porta.estornarAjuste(
      contextoPat(m!),
      { ajuste: a.id, motivo: 'Registrado por engano', origem: 'tela', hoje: '2026-11-21' },
      't',
      () => null,
      trilha,
    );
    const estornado = await fatos();
    expect(estornado).toHaveLength(antes + 2);
    expect(estornado.at(-1)).toMatchObject({
      evento: 'impairment',
      entidadeId: a.id,
      data: '2026-11-21',
      competencia: '2026-11-01',
      valor: '10000.00',
      estorno: 1,
      estornado: comPerda.at(-1)!.id,
    });
    await ajuste('revisao-estimativa', 'Revisão de vida útil sintética');
    expect(await fatos()).toHaveLength(antes + 2);
  });
});
