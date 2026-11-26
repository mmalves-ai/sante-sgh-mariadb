// M53.9 (F8): o serviço da integração da folha sobre as portas em memória (nada conecta): o de-para por vigência, a
// prévia de um período fechado (títulos por destino e vencimento, conta impressa, fatos e avisos), o lançamento pela
// ação `incluir-folha` (resumo conferido, vencimento ajustado, folha repetida), o retorno da folha externa e o custo de
// pessoal por centro de custo. A chave `pessoas.folha` desligada barra as gravações. Dados sintéticos.
import type { DestinoIntegracaoFolha, TotaisCalculoFolha } from '@sgh/contratos';
import { SUGESTAO_CLASSIFICACAO_FOLHA } from '@sgh/dominio-pessoas';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import type { PortaCalculoFolha } from './porta-calculo.js';
import type { PortaFolha } from './porta-folha.js';
import { PortaIntegracaoFolhaMemoria } from './porta-integracao-memoria.js';
import { ServicoIntegracaoFolha } from './servico-integracao.js';
import { type ChaveLiberacao, type PrerequisitoRecurso } from '../../config/public-api.js';
import { type FechamentoDaFolha } from './tipos-folha.js';

const CTX = {
  cliente: 'pc',
  estabelecimento: 1,
  usuario: null,
  correlacao: 'teste-folha',
  rede: 'rede-sintetica',
  hospital: 'pc',
};
const chave = (c: string): ChaveLiberacao => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoRecurso => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
let k = 0;
function sessao(pode: (p: string) => boolean = () => true): SessaoCadastro {
  return {
    req: {
      headers: { 'idempotency-key': `m53-integracao-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null, usuario: { id: '1', login: 'sintetico', ator: 'cliente' } } },
    } as never,
    hospital: 'pc',
    rede: 'rede-sintetica',
    login: 'SINT.DP.FOLHA',
    porta: CTX,
    pode,
  };
}
async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return (e as ErroProblema).extras['codigo'] ?? (e as ErroProblema).tipo;
}

const totais = (x: Partial<TotaisCalculoFolha>): TotaisCalculoFolha => ({
  colaboradores: 2,
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

const FECHAMENTO = (situacao: 'fechada' | 'reaberta' = 'fechada'): FechamentoDaFolha =>
  ({
    id: 70,
    empresa: 1,
    apuracao: 'mensal',
    periodo: '2026-09',
    numero: 1,
    situacao,
    pagamento: '2026-10-05',
    processos: [
      {
        id: 1,
        tipo: 'mensal',
        competencia: '2026-09',
        numero: 1,
        resumo: 'x',
        pagamento: '2026-10-05',
        colaboradores: 2,
        liquido: 420_000,
      },
    ],
    totais: {
      processos: 1,
      proventos: 500_000,
      descontos: 80_000,
      liquido: 420_000,
      inss: 50_000,
      irrf: 30_000,
      fgts: 40_000,
      encargos: 139_000,
    },
    resumo: 'r',
    fechadoPor: 'SINT.DP',
    fechadoEm: '2026-09-30T10:00:00',
    reabertoPor: null,
    reabertoEm: null,
    motivo: null,
    versao: 0,
  }) as FechamentoDaFolha;

function montar(chaves: readonly string[] = ['pessoas.folha'], situacao: 'fechada' | 'reaberta' = 'fechada') {
  const trilha = new RegistradorTrilhaMemoria();
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => chaves.map(chave),
    prerequisitosIniciais: () => chaves.map(cumprido),
  });
  const folha = {
    empresas: async () => [{ codigo: 1, rotulo: 'EMPRESA SINTETICA' }],
    relogio: async () => ({ hoje: '2026-09-30', agora: '2026-09-30T10:00:00' }),
    lotes: async () => [
      { id: 5, empresa: 1, competencia: '2026-08', sentido: 'recebido', situacao: 'conferido' },
      { id: 4, empresa: 1, competencia: '2026-08', sentido: 'exportado', situacao: 'gerado' },
      { id: 3, empresa: 1, competencia: '2025-12', sentido: 'recebido', situacao: 'conferido' },
    ],
  } as unknown as PortaFolha;
  const calculo = {
    fechamento: async (_c: unknown, id: number) => (id === 70 ? FECHAMENTO(situacao) : null),
    fechamentos: async (_c: unknown, f: { ano?: string }) => (f.ano === '2026' ? [FECHAMENTO(situacao)] : []),
    processo: async () => ({
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
    }),
    resumoVinculos: async () => [
      {
        vinculo: 1,
        centroCusto: 10,
        diasPagos: 30,
        proventos: 300_000,
        descontos: 50_000,
        porPapel: { fgts: 24_000, inssPatronal: 60_000, rat: 6_000, terceiros: 17_400 },
      },
      {
        vinculo: 2,
        centroCusto: 20,
        diasPagos: 30,
        proventos: 200_000,
        descontos: 30_000,
        porPapel: { fgts: 16_000, inssPatronal: 40_000, rat: 4_000, terceiros: 11_600 },
      },
    ],
  } as unknown as PortaCalculoFolha;
  const porta = new PortaIntegracaoFolhaMemoria();
  porta.agoraFixo = '2026-09-30T10:00:00';
  const servico = new ServicoIntegracaoFolha(porta, calculo, folha, trilha, config, null);
  return { servico, porta };
}

const dp = (destino: DestinoIntegracaoFolha['destino'], credor: number): DestinoIntegracaoFolha => ({
  destino,
  credor,
  classificacao: SUGESTAO_CLASSIFICACAO_FOLHA[destino],
  diaVencimento: 20,
  mesesDepois: 1,
  contaContabil: '',
});
const DE_PARA = [
  dp('liquido-mensal', 9001),
  dp('inss', 9002),
  dp('inss-patronal', 9002),
  dp('fgts', 9003),
  dp('irrf', 9004),
];

describe('ServicoIntegracaoFolha (M53.9)', () => {
  it('apoio: a falha na leitura do de-para sobe (nunca vira "sem de-para vigente")', async () => {
    const { servico, porta } = montar();
    porta.integracoes = async () => {
      throw new Error('falha de conexão');
    };
    await expect(servico.apoioTela(sessao(), 1)).rejects.toThrow('falha de conexão');
  });

  it('apoio: empresas, as 19 rotinas, os destinos com a rotina e a sugestão do perfil; sem de-para vigente', async () => {
    const { servico } = montar();
    const a = await servico.apoioTela(sessao(), null);
    expect(a.empresas).toEqual([{ codigo: 1, nome: 'EMPRESA SINTETICA' }]);
    expect(a.rotinas).toHaveLength(19);
    expect(a.destinos.find((d) => d.destino === 'fgts')?.rotina).toBe(15);
    expect(a.sugestao.find((d) => d.destino === 'liquido-mensal')?.classificacao).toEqual({
      grupo: 210,
      subgrupo: 1,
      item: 1,
    });
    expect(a.vigente).toBeNull();
    expect(a.credores).toEqual([]);
    expect(a.classificacoes.some((c) => c.grupo === 210 && c.subgrupo === 1 && c.item === 1)).toBe(true);
    expect(await codigo(servico.apoioTela(sessao(), 9))).toBe('nao-encontrado');
    // A busca de credores: por parte do nome ou pelo código.
    expect((await servico.credores(sessao(), { termo: 'previd' })).itens.map((c) => c.codigo)).toEqual([
      9002,
    ]);
    expect((await servico.credores(sessao(), { termo: 'x' })).itens).toEqual([]);
    expect((await servico.credores(sessao(), { termo: '9004' })).itens.map((c) => c.codigo)).toEqual([9004]);
  });

  it('de-para: grava a vigência, recusa início repetido e a chave desligada', async () => {
    const { servico } = montar();
    const v = await servico.gravarIntegracao(sessao(), {
      empresa: 1,
      inicio: '2026-09-01',
      destinos: DE_PARA,
    });
    expect(v.destinos.map((d) => [d.destino, d.rotina])).toEqual([
      ['liquido-mensal', 4],
      ['inss', 16],
      ['inss-patronal', 17],
      ['fgts', 15],
      ['irrf', 18],
    ]);
    expect(
      await codigo(
        servico.gravarIntegracao(sessao(), { empresa: 1, inicio: '2026-09-01', destinos: DE_PARA }),
      ),
    ).toBe('vigencia-repetida');
    const a = await servico.apoioTela(sessao(), 1);
    expect(a.vigente?.inicio).toBe('2026-09-01');
    expect(a.credores.map((c) => c.codigo)).toEqual([9001, 9002, 9003, 9004]);
    const desligado = montar([]).servico;
    expect(
      await codigo(
        desligado.gravarIntegracao(sessao(), { empresa: 1, inicio: '2026-09-01', destinos: DE_PARA }),
      ),
    ).toBe('recurso-desligado');
  });

  it('prévia do período fechado: um título por destino, a conta impressa, os fatos e o resumo', async () => {
    const { servico, porta } = montar();
    await servico.gravarIntegracao(sessao(), { empresa: 1, inicio: '2026-09-01', destinos: DE_PARA });
    porta.manuais.set(9003, 2);
    const p = await servico.previa(sessao(), { empresa: 1, origem: 'fechamento', id: 70 });
    expect(p.pendencias).toEqual([]);
    expect(p.podeLancar).toBe(true);
    expect(p.titulos.map((t) => [t.destino, t.credor, t.vencimento, t.valor])).toEqual([
      ['liquido-mensal', 9001, '2026-10-05', 420_000],
      ['inss', 9002, '2026-10-20', 50_000],
      ['inss-patronal', 9002, '2026-10-20', 139_000],
      ['fgts', 9003, '2026-10-20', 40_000],
      ['irrf', 9004, '2026-10-20', 30_000],
    ]);
    expect(p.total).toBe(679_000);
    expect(p.esperado).toBe(679_000);
    expect(p.conta).toContain('= R$ 6.790,00');
    expect(p.fatos.filter((f) => f.centroCusto === 10).map((f) => [f.rotina, f.valor])).toEqual([
      [4, 300_000],
      [15, 24_000],
      [17, 83_400],
    ]);
    expect(p.avisos).toEqual([{ codigo: 'possivel-lancamento-manual', destino: 'fgts', titulos: 2 }]);
    expect(p.resumo).toMatch(/^[0-9a-f]{64}$/);
    // Sem a permissão de lançar, a prévia sai, mas não pode lançar.
    expect(
      (
        await servico.previa(
          sessao((x) => x !== 'pessoas.integracao.lancar'),
          { empresa: 1, origem: 'fechamento', id: 70 },
        )
      ).podeLancar,
    ).toBe(false);
  });

  it('prévia sem de-para e do período reaberto: pendências que barram o lançamento', async () => {
    const { servico } = montar(['pessoas.folha'], 'reaberta');
    const p = await servico.previa(sessao(), { empresa: 1, origem: 'fechamento', id: 70 });
    expect(p.pendencias.map((x) => x.codigo)).toEqual(
      expect.arrayContaining(['origem-nao-fechada', 'sem-de-para']),
    );
    expect(p.podeLancar).toBe(false);
    expect(await codigo(servico.previa(sessao(), { empresa: 1, origem: 'fechamento', id: 71 }))).toBe(
      'nao-encontrado',
    );
    const r = await codigo(
      servico.lancar(sessao(), {
        empresa: 1,
        origem: 'fechamento',
        id: 70,
        resumo: p.resumo,
        emissao: '2026-09-30',
        vencimentos: [],
      }),
    );
    expect(r).toBe('titulos-com-pendencias');
  });

  it('lança com o resumo da prévia e o vencimento ajustado; repetir é recusado; o custo de pessoal sai dos fatos', async () => {
    const { servico } = montar();
    await servico.gravarIntegracao(sessao(), { empresa: 1, inicio: '2026-09-01', destinos: DE_PARA });
    const p = await servico.previa(sessao(), { empresa: 1, origem: 'fechamento', id: 70 });
    expect(
      await codigo(
        servico.lancar(sessao(), {
          empresa: 1,
          origem: 'fechamento',
          id: 70,
          resumo: 'f'.repeat(64),
          emissao: '2026-09-30',
          vencimentos: [],
        }),
      ),
    ).toBe('plano-mudou');
    const r = await servico.lancar(sessao(), {
      empresa: 1,
      origem: 'fechamento',
      id: 70,
      resumo: p.resumo,
      emissao: '2026-09-30',
      vencimentos: [{ chave: 'fgts:2026-10-20', vencimento: '2026-10-07' }],
    });
    expect(r.lancamento).toMatchObject({
      origem: 'fechamento',
      idOrigem: 70,
      total: 679_000,
      liquido: 420_000,
      encargos: 259_000,
      fatos: 6,
    });
    expect(r.lancamento.titulos.find((t) => t.destino === 'fgts')).toMatchObject({
      vencimento: '2026-10-07',
      documento: 2_026_091_507,
      pago: false,
    });
    expect(r.conta).toContain('FGTS R$ 400,00');
    const l = await servico.listar(sessao(), { empresa: 1, ano: 2026 });
    expect(l.itens).toHaveLength(1);
    // As origens do ano: o fechamento com o lançamento feito e o retorno recebido de 2026 (não o exportado nem o de 2025).
    const o = await servico.origens(sessao(), { empresa: 1, ano: 2026 });
    expect(o.itens.map((x) => [x.origem, x.id, x.periodo, x.lancamento])).toEqual([
      ['fechamento', 70, '2026-09', r.lancamento.id],
      ['interface', 5, '2026-08', null],
    ]);
    expect((await servico.detalhe(sessao(), r.lancamento.id)).titulos).toHaveLength(5);
    expect(await codigo(servico.detalhe(sessao(), 1))).toBe('nao-encontrado');
    // A prévia de novo mostra que já foi lançado; lançar de novo é recusado.
    const p2 = await servico.previa(sessao(), { empresa: 1, origem: 'fechamento', id: 70 });
    expect(p2.pendencias.map((x) => x.codigo)).toContain('ja-lancado');
    expect(
      await codigo(
        servico.lancar(sessao(), {
          empresa: 1,
          origem: 'fechamento',
          id: 70,
          resumo: p2.resumo,
          emissao: '2026-09-30',
          vencimentos: [],
        }),
      ),
    ).toBe('titulos-com-pendencias');
    const c = await servico.custo(sessao(), { empresa: 1, periodo: '2026-09' });
    expect(c.centros).toEqual([
      { centroCusto: 10, proventos: 300_000, encargos: 107_400, total: 407_400 },
      { centroCusto: 20, proventos: 200_000, encargos: 71_600, total: 271_600 },
    ]);
    expect(c.total).toBe(679_000);
    expect(c.lancamentos).toBe(1);
  });

  it('retorno da folha externa: conferido lança; encargo sem destino e divergente pendem', async () => {
    const { servico, porta } = montar();
    await servico.gravarIntegracao(sessao(), { empresa: 1, inicio: '2026-09-01', destinos: DE_PARA });
    const retorno = {
      id: 33,
      empresa: 1,
      competencia: '2026-08',
      sentido: 'recebido',
      situacao: 'conferido',
      liquido: 300_000,
      vencimentoLiquido: '2026-10-05',
      encargos: [{ tipo: 'inss' as const, valor: 40_000, vencimento: '2026-10-20' }],
      proventos: [{ centroCusto: 10, proventos: 350_000 }],
    };
    porta.semearRetorno(CTX, retorno);
    const p = await servico.previa(sessao(), { empresa: 1, origem: 'interface', id: 33 });
    expect(p.pendencias).toEqual([]);
    expect(p.titulos.map((t) => [t.destino, t.valor])).toEqual([
      ['liquido-mensal', 300_000],
      ['inss', 40_000],
    ]);
    const r = await servico.lancar(sessao(), {
      empresa: 1,
      origem: 'interface',
      id: 33,
      resumo: p.resumo,
      emissao: '2026-09-30',
      vencimentos: [],
    });
    expect(r.lancamento.total).toBe(340_000);
    expect(
      (await servico.previa(sessao(), { empresa: 1, origem: 'interface', id: 33 })).pendencias.map(
        (x) => x.codigo,
      ),
    ).toContain('ja-lancado');
    porta.semearRetorno(CTX, {
      ...retorno,
      id: 34,
      situacao: 'divergente',
      encargos: [{ tipo: 'outro', valor: 5, vencimento: null }],
    });
    expect(
      (await servico.previa(sessao(), { empresa: 1, origem: 'interface', id: 34 })).pendencias.map(
        (x) => x.codigo,
      ),
    ).toEqual(['lote-divergente', 'encargo-sem-destino', 'ja-lancado']); // o líquido da mesma competência e vencimento saiu no 33
    expect(await codigo(servico.previa(sessao(), { empresa: 1, origem: 'interface', id: 99 }))).toBe(
      'nao-encontrado',
    );
  });

  it('lançada com atraso: o vencimento que já passou não barra a prévia, mas o lançamento exige o vencimento novo', async () => {
    const { servico, porta } = montar();
    await servico.gravarIntegracao(sessao(), { empresa: 1, inicio: '2026-07-01', destinos: DE_PARA });
    // Hoje é 30/09/2026; o retorno de julho vence em agosto (já passou).
    porta.semearRetorno(CTX, {
      id: 35,
      empresa: 1,
      competencia: '2026-07',
      sentido: 'recebido',
      situacao: 'conferido',
      liquido: 300_000,
      vencimentoLiquido: '2026-08-05',
      encargos: [{ tipo: 'inss' as const, valor: 40_000, vencimento: '2026-08-20' }],
      proventos: [{ centroCusto: 10, proventos: 350_000 }],
    });
    const p = await servico.previa(sessao(), { empresa: 1, origem: 'interface', id: 35 });
    expect(p.pendencias).toEqual([]);
    expect(p.podeLancar).toBe(true);
    const base = {
      empresa: 1,
      origem: 'interface' as const,
      id: 35,
      resumo: p.resumo,
      emissao: '2026-09-30',
    };
    expect(await codigo(servico.lancar(sessao(), { ...base, vencimentos: [] }))).toBe(
      'titulos-com-pendencias',
    );
    const r = await servico.lancar(sessao(), {
      ...base,
      vencimentos: [
        { chave: 'liquido-mensal:2026-08-05', vencimento: '2026-10-01' },
        { chave: 'inss:2026-08-20', vencimento: '2026-10-20' },
      ],
    });
    expect(r.lancamento.titulos.map((t) => [t.destino, t.vencimento])).toEqual([
      ['liquido-mensal', '2026-10-01'],
      ['inss', '2026-10-20'],
    ]);
  });
});
