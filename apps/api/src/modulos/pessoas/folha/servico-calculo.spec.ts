// M53.3: o serviço do cálculo mensal da folha sobre as portas EM MEMÓRIA (dados SINTÉTICOS; nada conecta a banco): as
// pendências que barram (sem parâmetros, ponto não fechado, sem salário), os parâmetros com a rubrica conferida pelo
// papel, o salário com a vigência dentro do vínculo, a prévia que não grava, o cálculo gravado com a prova da soma
// relida, o detalhe por colaborador e as linhas com a memória, o recálculo que substitui o anterior, o descarte (versão,
// situação) e a chave desligada. Nenhuma resposta leva CPF ou nome.
import type { ParametrosFolha, RubricaFolha, TabelaLegalFolha } from '@sgh/contratos';
import { PAPEIS_CALCULO_FOLHA, TIPO_DO_PAPEL } from '@sgh/contratos';
import type { ChaveGravada, EventoPeriodoLidoSgh, PrerequisitoGravado } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import type { PortaRealizado } from '../escala/porta-realizado.js';
import type { PortaPonto } from '../ponto/porta-ponto.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import type { PortaRubricas } from '../rubricas/porta-rubricas.js';
import { ServicoPessoas } from '../servico.js';
import { PortaCalculoFolhaMemoria } from './porta-calculo-memoria.js';
import { PortaFolhaMemoria } from './porta-folha-memoria.js';
import {
  colaboradorDoResumo,
  MENSAGEM_HOLERITE_FORA,
  resumoDoCalculo,
  ServicoCalculoFolha,
} from './servico-calculo.js';

const C = PESSOAS_SINTETICAS_M52;
const chave = (c: string): ChaveGravada => ({
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
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cifra = new CifraCpf(Buffer.alloc(32, 7));
const COMP = '2026-09';

let k = 0;
function sessao(pode: (p: string) => boolean = () => true): SessaoCadastro {
  return {
    req: {
      headers: { 'idempotency-key': `m53-calculo-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null } },
    } as never,
    hospital: 'pc',
    rede: 'rede-sintetica',
    login: 'SINT.DP.FOLHA',
    porta: { rede: 'rede-sintetica', hospital: 'pc' },
    pode,
  };
}

const TABELA: TabelaLegalFolha = {
  inicio: '2026-01-01',
  irrf: {
    faixas: [
      { de: 0, ate: 242_880, aliquota: 0, deducao: 0 },
      { de: 242_881, ate: 282_665, aliquota: 750, deducao: 18_216 },
      { de: 282_666, ate: 375_105, aliquota: 1500, deducao: 39_416 },
      { de: 375_106, ate: 466_468, aliquota: 2250, deducao: 67_549 },
      { de: 466_469, ate: null, aliquota: 2750, deducao: 90_873 },
    ],
    deducaoDependente: 18_959,
    descontoSimplificado: 60_720,
    reducao: {
      isencaoAte: 500_000,
      reducaoDe: 500_001,
      reducaoAte: 735_000,
      valor: 31_289,
      semReducaoAcimaDe: 735_000,
    },
  },
  inss: {
    faixas: [
      { de: 0, ate: 151_800, aliquota: 750, deducao: 0 },
      { de: 151_801, ate: 279_388, aliquota: 900, deducao: 0 },
      { de: 279_389, ate: 419_083, aliquota: 1200, deducao: 0 },
      { de: 419_084, ate: 815_741, aliquota: 1400, deducao: 0 },
    ],
    teto: 815_741,
  },
  salarioFamilia: [{ de: 0, ate: 190_604, cota: 6_504 }],
  salarioMinimo: 151_800,
  contribuinteIndividual: { aliquota: 2000, teto: 815_741 },
};

const rubrica = (id: number, tipo: RubricaFolha['tipo'], incide = true): RubricaFolha => ({
  id,
  empresa: 1,
  codigo: id * 10,
  descricao: `Rubrica sintética ${id}`,
  tipo,
  referencia: 'valor',
  percentual: 0,
  prioridade: null,
  ativa: true,
  vigencia: { inicio: null, fim: null },
  usos: ['mensal'],
  incidencias: { inss: incide, irrf: incide, fgts: incide } as RubricaFolha['incidencias'],
  esocial: { inss: null, irrf: null, fgts: null, sindical: null },
  natureza: null,
});
const RUBRICAS: RubricaFolha[] = PAPEIS_CALCULO_FOLHA.map((p, i) =>
  rubrica(
    i + 1,
    TIPO_DO_PAPEL[p] === 'desconto' ? 'desconto' : p === 'fgts' ? 'base' : 'provento',
    !['salarioFamilia', 'inss', 'irrf', 'fgts'].includes(p),
  ),
);
const PAPEL_ID = Object.fromEntries(
  PAPEIS_CALCULO_FOLHA.map((p, i) => [p, i + 1]),
) as ParametrosFolha['rubricas'];
const PARAM: ParametrosFolha = {
  empresa: 1,
  inicio: '2026-01-01',
  percentuais: {
    horaExtra50: 5000,
    horaExtra100: 10_000,
    adicionalNoturno: 2000,
    sobreaviso: 3333,
    periculosidade: 3000,
  },
  encargos: { inssPatronal: 2000, ratAjustado: 300, terceiros: 580, fgts: 800 },
  divisorHoras: null,
  rubricas: PAPEL_ID,
};

function montar(ligada = true) {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-10-25';
  const trilha = new RegistradorTrilhaMemoria();
  const recursos = ['pessoas.colaborador', ...(ligada ? ['pessoas.folha'] : [])];
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => recursos.map(chave),
    prerequisitosIniciais: () => recursos.map(cumprido),
  });
  const rh = new ServicoPessoas(pessoas, trilha, config, null, cifra);
  const folha = new PortaFolhaMemoria(pessoas);
  folha.agoraFixo = '2026-10-25T10:00:00';
  const porta = new PortaCalculoFolhaMemoria(pessoas);
  porta.agoraFixo = '2026-10-25T10:00:00';
  const fechados = new Map<number, { eventos: Record<string, number>; classes: Record<string, number> }>();
  const ponto = {
    eventosDaCompetencia: async (_c: unknown, competencia: string): Promise<EventoPeriodoLidoSgh[]> =>
      [...fechados.entries()].map(([vinculo, t], i) => ({
        id: 100 + i,
        vinculo,
        competencia,
        acao: 'fechado' as const,
        ref: null,
        hash: null,
        totais: JSON.stringify(t),
        concorda: null,
        texto: null,
        registradoPor: 'SINT.RH',
        registradoEm: '2026-10-01T10:00:00',
      })),
  } as unknown as PortaPonto;
  const plantoes: { vinculo: number; plantao: number; minutos: number; tipo: string }[] = [];
  const realizado = {
    realizadosAprovados: async () =>
      plantoes.map((p, i) => ({ id: i + 1, inicio: '2026-09-10T07:00', fim: '2026-09-10T19:00', ...p })),
    plantoesPorIds: async (_c: unknown, ids: readonly number[]) =>
      ids.map((plantao) => ({
        plantao,
        tipo: plantoes.find((p) => p.plantao === plantao)?.tipo ?? 'presencial',
      })),
  } as unknown as PortaRealizado;
  const rubricas = {
    rubricas: async () => RUBRICAS,
    tabelasLegais: async () => [TABELA],
    diasAfastamento: async () => [{ inicio: '2020-01-01', dias: 15 }],
  } as unknown as PortaRubricas;
  const servico = new ServicoCalculoFolha(
    porta,
    folha,
    rubricas,
    pessoas,
    ponto,
    realizado,
    trilha,
    config,
    null,
  );
  return { pessoas, porta, folha, rh, servico, trilha, fechados, plantoes };
}

async function admitir(rh: ServicoPessoas, admissao = '2026-01-01') {
  return (
    await rh.admitir(sessao(), {
      cpf: C.nova.cpf,
      nome: 'PESSOA NOVA SINTETICA',
      profissional: null,
      tipo: 'clt',
      admissao,
      cargo: 'Auxiliar administrativo',
      funcao: null,
      cargaSemanalHoras: 44,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 3' },
      matricula: null,
      usuario: null,
    })
  ).id;
}

async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return (e as ErroProblema).extras['codigo'] ?? (e as ErroProblema).tipo;
}

const SALARIO = {
  inicio: '2026-01-01',
  salario: 300_000,
  insalubridade: 0,
  periculosidade: false,
  motivo: 'Admissão sintética',
};

describe('cálculo mensal da folha (serviço)', () => {
  it('pendências → parâmetros e salário → prévia → cálculo gravado → detalhe e memória → recálculo → descarte', async () => {
    const m = montar();
    const v = await admitir(m.rh);
    const s = sessao();

    const apoio = await m.servico.apoioTela(s);
    expect(apoio).toMatchObject({
      hoje: '2026-10-25',
      competenciaSugerida: '2026-09',
      gravacao: { ligada: true },
      acoes: { calcular: true, salario: true, verSalario: true, parametros: true, motivo: null },
    });
    expect(apoio.papeis.find((p) => p.papel === 'inss')?.tipo).toBe('desconto');

    // Sem parâmetros, sem ponto fechado e sem salário: pendências, nada gravado.
    const pend = await m.servico.calcular(s, { empresa: 1, competencia: COMP, simular: false });
    expect(pend.calculado).toBe(false);
    expect(pend.pendencias.map((p) => p.codigo)).toEqual([
      'ponto-nao-fechado',
      'sem-parametros',
      'sem-salario',
    ]);
    expect((await m.servico.listarProcessos(s, {})).itens).toHaveLength(0);

    // Parâmetros: a rubrica precisa servir ao papel.
    expect(
      await codigo(m.servico.registrarParametros(s, { ...PARAM, rubricas: { ...PAPEL_ID, inss: 1 } })),
    ).toBe('rubrica-invalida');
    expect(await codigo(m.servico.registrarParametros(s, { ...PARAM, empresa: 9 }))).toBe('nao-encontrado');
    const par = await m.servico.registrarParametros(s, PARAM);
    expect(par.ok).toBe(true);
    expect(await codigo(m.servico.registrarParametros(s, PARAM))).toBe('vigencia-repetida');
    expect((await m.servico.listarParametros(s, 1)).itens.map((p) => p.inicio)).toEqual(['2026-01-01']);

    // Salário: dentro do vínculo.
    expect(
      await codigo(m.servico.registrarSalario(s, { ...SALARIO, vinculo: v, inicio: '2025-12-31' })),
    ).toBe('antes-da-admissao');
    expect(await codigo(m.servico.registrarSalario(s, { ...SALARIO, vinculo: 999_999 }))).toBe(
      'nao-encontrado',
    );
    await m.servico.registrarSalario(s, { ...SALARIO, vinculo: v });
    const sal = await m.servico.listarSalarios(s, v);
    expect(sal.itens).toHaveLength(1);
    expect(sal.itens[0]).toMatchObject({ salario: 300_000, registradoPor: 'SINT.DP.FOLHA' });
    expect(JSON.stringify(sal)).not.toContain(C.nova.cpf);

    // Ponto fechado com 2 h de hora extra e 1 plantão de sobreaviso de 12 h.
    m.fechados.set(v, { eventos: {}, classes: { '5': 120 } });
    m.plantoes.push({ vinculo: v, plantao: 77, minutos: 720, tipo: 'sobreaviso' });

    const previa = await m.servico.calcular(s, { empresa: 1, competencia: COMP, simular: true });
    expect(previa).toMatchObject({ calculado: false, simulado: true, processo: null, pendencias: [] });
    expect(previa.conferencia?.ok).toBe(true);
    expect((await m.servico.listarProcessos(s, {})).itens).toHaveLength(0);

    const g = await m.servico.calcular(s, { empresa: 1, competencia: COMP, simular: false });
    expect(g.calculado).toBe(true);
    expect(g.processo).toMatchObject({ numero: 1, situacao: 'calculada', competencia: COMP, foraDaFolha: 0 });
    expect(g.processo?.resumo).toMatch(/^[0-9a-f]{64}$/);
    const c = g.colaboradores[0]!;
    // Hora = 3.000 ÷ 220; 2 h × 150% = 40,91; sobreaviso 12 h × 33,33% = 54,54; DSR = 40,91 × 4 ÷ 26 = 6,29.
    expect(c.proventos).toBe(300_000 + 4_091 + 5_454 + 629);
    expect(g.totais?.liquido).toBe(c.liquido);
    expect(JSON.stringify(g)).not.toContain(C.nova.cpf);

    const det = await m.servico.detalhe(s, g.processo!.id);
    expect(det.conferencia.ok).toBe(true);
    expect(det.colaboradores).toEqual([{ ...c, matricula: det.colaboradores[0]!.matricula }]);
    const ls = await m.servico.linhasDoVinculo(s, g.processo!.id, v);
    expect(ls.linhas.find((l) => l.papel === 'horaExtra50')).toMatchObject({
      valor: 4_091,
      rubrica: 2,
      memoria: '2h00 × (R$ 3.000,00 ÷ 220 h) × 150%',
    });
    expect(await codigo(m.servico.linhasDoVinculo(s, g.processo!.id, 999_999))).toBe('nao-encontrado');
    expect(await codigo(m.servico.detalhe(s, 999_999))).toBe('nao-encontrado');
    // D-PERM-SAL-533: só com pessoas.folha.ler, os totais e a prova da soma ficam; a lista por colaborador e a memória, não.
    const consulta = sessao((p) => p !== 'pessoas.salario.ler');
    const detC = await m.servico.detalhe(consulta, g.processo!.id);
    expect(detC).toMatchObject({ colaboradores: [], colaboradoresOcultos: true, conferencia: { ok: true } });
    expect(det.colaboradoresOcultos).toBe(false);
    expect(await codigo(m.servico.linhasDoVinculo(consulta, g.processo!.id, v))).toBe('sem-permissao');

    // Recalcular substitui o anterior; o número sobe.
    const g2 = await m.servico.calcular(s, { empresa: 1, competencia: COMP, simular: false });
    expect(g2.processo?.numero).toBe(2);
    expect(g2.substituido).toBe(g.processo!.id);
    expect(g2.processo?.resumo).toBe(g.processo?.resumo);
    const lista = await m.servico.listarProcessos(s, { empresa: 1, competencia: COMP });
    expect(lista.itens.map((p) => [p.numero, p.situacao])).toEqual([
      [2, 'calculada'],
      [1, 'substituida'],
    ]);

    // Descarte: só o em vigor, pela versão lida.
    expect(
      await codigo(m.servico.descartar(s, g.processo!.id, { versao: 1, motivo: 'Teste sintético' })),
    ).toBe('nao-calculada');
    expect(
      await codigo(m.servico.descartar(s, g2.processo!.id, { versao: 9, motivo: 'Teste sintético' })),
    ).toBe('desatualizado');
    const d = await m.servico.descartar(s, g2.processo!.id, { versao: 0, motivo: 'Ponto corrigido' });
    expect(d.ok).toBe(true);
    const depois = await m.servico.listarProcessos(s, { empresa: 1, competencia: COMP });
    expect(depois.itens[0]).toMatchObject({
      situacao: 'descartada',
      motivo: 'Ponto corrigido',
      situacaoPor: 'SINT.DP.FOLHA',
    });
    // Depois do descarte, o cálculo seguinte é o número 3 e não substitui nada.
    const g3 = await m.servico.calcular(s, { empresa: 1, competencia: COMP, simular: false });
    expect(g3.processo?.numero).toBe(3);
    expect(g3.substituido).toBeNull();

    // Holerite do autosserviço: as linhas do vínculo no cálculo em vigor, sem os encargos da empresa.
    const h = await m.servico.holerite(s, v, COMP);
    expect(h).toMatchObject({ disponivel: true, calculado: true, competencia: COMP, vinculo: v });
    expect(h.linhas.some((l) => ['inssPatronal', 'rat', 'terceiros'].includes(l.papel))).toBe(false);
    expect(h.linhas.some((l) => l.papel === 'salario')).toBe(true);
    expect(h.liquido).toBe(h.proventos - h.descontos);
    expect(h.liquido).toBe(g3.colaboradores.find((x) => x.vinculo === v)!.liquido);
    expect(JSON.stringify(h)).not.toContain(C.nova.cpf);
    expect(await m.servico.holerite(s, v, '2026-08')).toMatchObject({ calculado: false, linhas: [] });
    expect(await m.servico.holerite(s, null, COMP)).toMatchObject({ calculado: false, vinculo: null });

    // D-MONTAGEM-533: uma montagem só; depois da trava, salários e parâmetros relidos na transação. Uma vigência nova do
    // salário entre a montagem e a trava recusa o cálculo (nada gravado).
    const antesMudar = (await m.servico.listarProcessos(s, { empresa: 1, competencia: COMP })).itens.length;
    const original = m.porta.gravarSgh.bind(m.porta);
    m.porta.gravarSgh = async (c, t, fn) => {
      m.porta.gravarSgh = original;
      await m.servico.registrarSalario(s, { ...SALARIO, vinculo: v, inicio: '2026-09-15', salario: 310_000 });
      return original(c, t, fn);
    };
    expect(await codigo(m.servico.calcular(s, { empresa: 1, competencia: COMP, simular: false }))).toBe(
      'calculo-mudou',
    );
    expect((await m.servico.listarProcessos(s, { empresa: 1, competencia: COMP })).itens).toHaveLength(
      antesMudar,
    );
  });

  it('chave desligada: só a prévia; gravações recusadas', async () => {
    const m = montar(false);
    const v = await admitir(m.rh);
    const s = sessao();
    expect((await m.servico.apoioTela(s)).acoes).toMatchObject({
      calcular: false,
      salario: false,
      parametros: false,
    });
    expect(await codigo(m.servico.registrarParametros(s, PARAM))).toBe('recurso-desligado');
    expect(await codigo(m.servico.registrarSalario(s, { ...SALARIO, vinculo: v }))).toBe('recurso-desligado');
    expect(await codigo(m.servico.calcular(s, { empresa: 1, competencia: COMP, simular: false }))).toBe(
      'recurso-desligado',
    );
    const previa = await m.servico.calcular(s, { empresa: 1, competencia: COMP, simular: true });
    expect(previa.simulado).toBe(true);
    // Desligada a folha, o holerite só diz onde consultar (nada pessoal é lido).
    expect(await m.servico.holerite(s, v, COMP)).toMatchObject({
      disponivel: false,
      calculado: false,
      mensagem: MENSAGEM_HOLERITE_FORA,
    });
  });

  it('perfil sem as permissões de ação: o apoio diz o motivo', async () => {
    const m = montar();
    const a = await m.servico.apoioTela(sessao((p) => p === 'pessoas.folha.ler'));
    expect(a.acoes).toMatchObject({ calcular: false, salario: false, verSalario: false, parametros: false });
    expect(a.acoes.motivo).toMatch(/perfil/);
  });

  it('auxiliares: resumo do processamento pelo banco e SHA-256 determinístico', () => {
    const r = colaboradorDoResumo(
      {
        vinculo: 1,
        centroCusto: 2,
        diasPagos: 30,
        proventos: 100,
        descontos: 30,
        porPapel: { inss: 10, inssPatronal: 20, rat: 3, terceiros: 5 },
      },
      'M1',
    );
    expect(r).toMatchObject({ liquido: 70, inss: 10, encargos: 28, baseInss: 0 });
    const vazio = {
      pendencias: [],
      colaboradores: [],
      totais: {
        colaboradores: 0,
        proventos: 0,
        descontos: 0,
        liquido: 0,
        inss: 0,
        irrf: 0,
        fgts: 0,
        inssPatronal: 0,
        rat: 0,
        terceiros: 0,
      },
      foraDaFolha: 0,
      tabelaLegal: '2026-01-01',
      parametros: '2026-01-01',
    };
    expect(resumoDoCalculo(1, COMP, vazio)).toBe(resumoDoCalculo(1, COMP, { ...vazio }));
    expect(resumoDoCalculo(1, COMP, vazio)).not.toBe(resumoDoCalculo(2, COMP, vazio));
  });
});
