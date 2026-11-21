// M53.4: o serviço de férias e 13º sobre as portas EM MEMÓRIA (dados SINTÉTICOS; nada conecta a banco): o saldo dos
// períodos, a programação conferida (recusa com o motivo da CLT), a prévia e o recibo gravado (processamento `ferias`),
// os valores só com o salário, o cancelamento (permissão e recibo descartado junto), os dias de férias na folha mensal,
// a 1ª parcela e a parcela final do 13º (substituição, desconto do adiantamento, recusas da ordem) e a chave desligada.
import type { ParametrosFolha, RubricaFolha, TabelaLegalFolha } from '@sgh/contratos';
import { PAPEIS_CALCULO_FOLHA, TIPO_DO_PAPEL } from '@sgh/contratos';
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
import { feriasDoMes, ServicoCalculoFolha } from './servico-calculo.js';
import { MENSAGEM_FERIAS_FORA, MENSAGEM_RECUSA_FERIAS, ServicoFeriasFolha } from './servico-ferias.js';
import { type ChaveLiberacao, type PrerequisitoRecurso } from '../../config/public-api.js';
import { type EventoDoPeriodo } from '../ponto/tipos-ponto.js';

const C = PESSOAS_SINTETICAS_M52;
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
const cifra = new CifraCpf(Buffer.alloc(32, 7));

let k = 0;
function sessao(pode: (p: string) => boolean = () => true): SessaoCadastro {
  return {
    req: {
      headers: { 'idempotency-key': `m53-ferias-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null } },
    } as never,
    hospital: 'pc',
    rede: 'rede-sintetica',
    login: 'SINT.DP.FERIAS',
    porta: {
      cliente: 'pc',
      estabelecimento: 1,
      usuario: null,
      correlacao: 'teste-folha',
      rede: 'rede-sintetica',
      hospital: 'pc',
    },
    pode,
  };
}

const TABELA: TabelaLegalFolha = {
  inicio: '2025-01-01',
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

const SEM_INCIDENCIA = [
  'salarioFamilia',
  'inss',
  'irrf',
  'fgts',
  'abonoPecuniario',
  'abonoTerco',
  'decimoDesconto',
];
const RUBRICAS: RubricaFolha[] = PAPEIS_CALCULO_FOLHA.map((p, i) => {
  const incide = !SEM_INCIDENCIA.includes(p) && TIPO_DO_PAPEL[p] !== 'desconto';
  return {
    id: i + 1,
    empresa: 1,
    codigo: (i + 1) * 10,
    descricao: `Rubrica sintética ${i + 1}`,
    tipo: TIPO_DO_PAPEL[p] === 'desconto' ? 'desconto' : p === 'fgts' ? 'base' : 'provento',
    referencia: 'valor',
    percentual: 0,
    prioridade: null,
    ativa: true,
    vigencia: { inicio: null, fim: null },
    usos: ['mensal'],
    incidencias: {
      inss: incide || ['faltas', 'atrasos'].includes(p),
      irrf: incide || ['faltas', 'atrasos'].includes(p),
      fgts: incide || ['faltas', 'atrasos'].includes(p),
    } as RubricaFolha['incidencias'],
    esocial: { inss: null, irrf: null, fgts: null, sindical: null },
    natureza: null,
  } as RubricaFolha;
});
const PARAM: ParametrosFolha = {
  empresa: 1,
  inicio: '2025-01-01',
  percentuais: {
    horaExtra50: 5000,
    horaExtra100: 10_000,
    adicionalNoturno: 2000,
    sobreaviso: 3333,
    periculosidade: 3000,
  },
  encargos: { inssPatronal: 2000, ratAjustado: 300, terceiros: 580, fgts: 800 },
  divisorHoras: null,
  rubricas: Object.fromEntries(PAPEIS_CALCULO_FOLHA.map((p, i) => [p, i + 1])) as ParametrosFolha['rubricas'],
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
  const porta = new PortaCalculoFolhaMemoria(pessoas);
  const relogio = (agora: string) => {
    folha.agoraFixo = agora;
    porta.agoraFixo = agora;
  };
  relogio('2026-10-25T10:00:00');
  const fechados = new Set<number>();
  const ponto = {
    eventosDaCompetencia: async (_c: unknown, competencia: string): Promise<EventoDoPeriodo[]> =>
      [...fechados].map((vinculo, i) => ({
        id: 100 + i,
        vinculo,
        competencia,
        acao: 'fechado' as const,
        ref: null,
        hash: null,
        totais: JSON.stringify({ eventos: {}, classes: {} }),
        concorda: null,
        texto: null,
        registradoPor: 'SINT.RH',
        registradoEm: '2026-10-01T10:00:00',
      })),
  } as unknown as PortaPonto;
  const realizado = {
    realizadosAprovados: async () => [],
    plantoesPorIds: async () => [],
  } as unknown as PortaRealizado;
  const rubricas = {
    rubricas: async () => RUBRICAS,
    tabelasLegais: async () => [TABELA],
    diasAfastamento: async () => [{ inicio: '2020-01-01', dias: 15 }],
  } as unknown as PortaRubricas;
  const calculo = new ServicoCalculoFolha(
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
  const ferias = new ServicoFeriasFolha(porta, folha, rubricas, pessoas, trilha, config, null);
  return { pessoas, porta, folha, rh, calculo, ferias, trilha, fechados, relogio };
}

async function admitir(m: ReturnType<typeof montar>, admissao: string) {
  const v = (
    await m.rh.admitir(sessao(), {
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
  await m.calculo.registrarParametros(sessao(), PARAM);
  await m.calculo.registrarSalario(sessao(), {
    vinculo: v,
    inicio: admissao,
    salario: 300_000,
    insalubridade: 0,
    periculosidade: false,
    motivo: 'Admissão sintética',
  });
  return v;
}

async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return (e as ErroProblema).extras['codigo'] ?? (e as ErroProblema).tipo;
}

const valor = (ls: readonly { papel: string; valor: number }[], papel: string) =>
  ls.find((l) => l.papel === papel)?.valor ?? 0;

describe('férias (serviço)', () => {
  it('saldo → programação recusada e aceita → prévia → recibo gravado → detalhe → cancelamento', async () => {
    const m = montar();
    const v = await admitir(m, '2025-01-05');
    const s = sessao();

    const apoio = await m.ferias.apoioTela(s);
    expect(apoio.acoes).toMatchObject({
      programar: true,
      calcularFerias: true,
      calcularDecimo: true,
      verSalario: true,
    });

    const saldo = await m.ferias.saldo(s, v);
    expect(saldo.temDireito).toBe(true);
    expect(saldo.periodos.map((p) => [p.inicio, p.situacao, p.saldo])).toEqual([
      ['2025-01-05', 'aberto', 30],
      ['2026-01-05', 'em-aquisicao', 30],
    ]);
    expect(saldo.periodos[0]!.avisos).toContain('competencias-sem-calculo');

    const nova = {
      vinculo: v,
      empresa: 1,
      aquisitivoInicio: '2025-01-05',
      dias: 20,
      abono: 10,
      adiantarDecimo: true,
    };
    const sexta = await m.ferias
      .programar(s, { ...nova, inicio: '2026-12-04' })
      .catch((e: ErroProblema) => e);
    expect(sexta).toBeInstanceOf(ErroProblema);
    expect((sexta as ErroProblema).extras['codigo']).toBe('vespera-de-descanso');
    expect((sexta as ErroProblema).detalhe).toBe(MENSAGEM_RECUSA_FERIAS['vespera-de-descanso']);
    expect(
      await codigo(m.ferias.programar(s, { ...nova, inicio: '2026-11-30', aquisitivoInicio: '2024-01-01' })),
    ).toBe('periodo-inexistente');

    const prog = await m.ferias.programar(s, { ...nova, inicio: '2026-11-30' });
    expect(prog.avisos).toEqual([]);
    expect(prog.ferias).toMatchObject({
      situacao: 'programada',
      inicio: '2026-11-30',
      fim: '2026-12-19',
      pagamento: '2026-11-28',
      dobra: 0,
      adiantarDecimo: true,
    });
    const id = prog.id;
    expect(
      (await m.ferias.listar(s, { de: '2026-12-01', ate: '2026-12-31' })).itens.map((f) => f.id),
    ).toEqual([id]);
    // A empresa da escala é filtrada no servidor (antes do teto).
    expect(
      (await m.ferias.listar(s, { empresa: 1, de: '2026-12-01', ate: '2026-12-31' })).itens.map((f) => f.id),
    ).toEqual([id]);
    expect((await m.ferias.listar(s, { empresa: 2, de: '2026-12-01', ate: '2026-12-31' })).itens).toEqual([]);

    const previa = await m.ferias.calcular(s, id, { versao: 0, simular: true });
    expect(previa).toMatchObject({ calculado: false, simulado: true, pendencias: [], processo: null });
    expect(valor(previa.linhas, 'feriasGozo')).toBe(200_000);
    expect(valor(previa.linhas, 'feriasTerco')).toBe(66_667);
    expect(valor(previa.linhas, 'abonoPecuniario')).toBe(100_000);
    expect(valor(previa.linhas, 'decimoAdiantamento')).toBe(150_000);
    expect(previa.avisos.map((a) => a.codigo)).toEqual(['competencias-sem-calculo']);
    expect(previa.conferencia?.ok).toBe(true);
    expect(await codigo(m.ferias.calcular(s, id, { versao: 3, simular: false }))).toBe('desatualizado');

    const r = await m.ferias.calcular(s, id, { versao: 0, simular: false });
    expect(r.calculado).toBe(true);
    expect(r.processo).toMatchObject({
      tipo: 'ferias',
      competencia: '2026-11',
      pagamento: '2026-11-28',
      numero: 1,
    });
    expect(r.ferias).toMatchObject({ situacao: 'calculada', processo: r.processo!.id, versao: 1 });
    expect(await codigo(m.ferias.calcular(s, id, { versao: 1, simular: false }))).toBe('nao-programada');
    // O recibo não sai pelo descarte do cálculo (sai pelo cancelamento das férias).
    expect(
      await codigo(m.calculo.descartar(s, r.processo!.id, { versao: 0, motivo: 'Teste sintético' })),
    ).toBe('recibo-de-ferias');

    const depois = await m.ferias.saldo(s, v);
    expect(depois.periodos[0]).toMatchObject({ gozados: 20, abono: 10, saldo: 0, situacao: 'quitado' });

    const det = await m.ferias.detalhe(s, id);
    expect(det.linhasOcultas).toBe(false);
    expect(valor(det.linhas, 'feriasGozo')).toBe(200_000);
    const semSalario = await m.ferias.detalhe(
      sessao((p) => p !== 'pessoas.salario.ler'),
      id,
    );
    expect(semSalario).toMatchObject({ linhas: [], linhasOcultas: true });
    // D-PERM-SAL-533: o recibo tem um colaborador só; sem o salário, nem os totais nem o resumo saem.
    expect(det.processo?.totais?.proventos).toBeGreaterThan(0);
    expect(semSalario.processo).toMatchObject({ id: r.processo!.id, numero: 1, situacao: 'calculada' });
    expect(semSalario.processo).not.toHaveProperty('totais');
    expect(semSalario.processo).not.toHaveProperty('resumo');
    // Pela porta do cálculo: o recibo não entra na lista e o detalhe é recusado a quem não consulta salário.
    const soFolha = sessao((p) => p !== 'pessoas.salario.ler');
    expect((await m.calculo.listarProcessos(s, {})).itens.map((p) => p.tipo)).toContain('ferias');
    expect((await m.calculo.listarProcessos(soFolha, {})).itens.map((p) => p.tipo)).not.toContain('ferias');
    expect((await m.calculo.listarProcessos(soFolha, { tipo: 'ferias' })).itens).toEqual([]);
    expect(await codigo(m.calculo.detalhe(soFolha, r.processo!.id))).toBe('sem-permissao');
    // A rota do descarte do 13º não descarta outro tipo de processamento.
    expect(
      await codigo(
        m.calculo.descartar(s, r.processo!.id, { versao: 0, motivo: 'Teste sintético' }, 'decimo'),
      ),
    ).toBe('nao-encontrado');
    expect((await m.calculo.detalhe(s, r.processo!.id)).processo.totais.proventos).toBeGreaterThan(0);

    // Cancelar o recibo calculado é de quem calcula; o recibo vai a descartado junto e os dias voltam ao saldo.
    const soProgramar = sessao((p) => p !== 'pessoas.ferias.calcular');
    expect(await codigo(m.ferias.cancelar(soProgramar, id, { versao: 1, motivo: 'Mudança de escala' }))).toBe(
      'sem-permissao',
    );
    await m.ferias.cancelar(s, id, { versao: 1, motivo: 'Mudança de escala' });
    expect((await m.calculo.listarProcessos(s, { tipo: 'ferias' })).itens[0]).toMatchObject({
      situacao: 'descartada',
      motivo: 'Mudança de escala',
    });
    expect((await m.ferias.saldo(s, v)).periodos[0]).toMatchObject({ saldo: 30, situacao: 'aberto' });
    expect(await codigo(m.ferias.cancelar(s, id, { versao: 2, motivo: 'De novo' }))).toBe('ja-cancelada');
    expect(m.trilha.eventos.map((l) => l.evento)).toEqual(
      expect.arrayContaining([
        'pessoas.ferias.programada',
        'pessoas.ferias.calculada',
        'pessoas.ferias.cancelada',
      ]),
    );
  });

  it('a folha mensal tira os dias do recibo gravado e soma a base do INSS no mês do início (D-FERMES-534)', async () => {
    const m = montar();
    const v = await admitir(m, '2025-01-05');
    m.fechados.add(v);
    const s = sessao();
    const { id } = await m.ferias.programar(s, {
      vinculo: v,
      empresa: 1,
      aquisitivoInicio: '2025-01-05',
      inicio: '2026-11-30',
      dias: 30,
      abono: 0,
      adiantarDecimo: false,
    });
    const r = await m.ferias.calcular(s, id, { versao: 0, simular: false });
    m.relogio('2027-01-05T10:00:00');
    const nov = await m.calculo.calcular(s, { empresa: 1, competencia: '2026-11', simular: false });
    expect(nov.pendencias).toEqual([]);
    const pNov = nov.processo!.id;
    const lsNov = (await m.calculo.linhasDoVinculo(s, pNov, v)).linhas;
    expect(lsNov.find((l) => l.papel === 'salario')).toMatchObject({ quantidade: 29, valor: 290_000 });
    expect(lsNov.find((l) => l.papel === 'inss')?.memoria).toMatch(/retido no recibo/);
    const dez = await m.calculo.calcular(s, { empresa: 1, competencia: '2026-12', simular: false });
    const lsDez = (await m.calculo.linhasDoVinculo(s, dez.processo!.id, v)).linhas;
    // Dezembro: 29 dias de férias (01 a 29) → 1 dia de salário; sem a base do recibo.
    expect(lsDez.find((l) => l.papel === 'salario')).toMatchObject({ quantidade: 1, valor: 10_000 });
    expect(lsDez.find((l) => l.papel === 'inss')?.memoria).not.toMatch(/recibo/);
    expect(r.processo?.competencia).toBe('2026-11');
    // A conta do mês, isolada.
    expect(
      feriasDoMes(
        [
          {
            vinculo: v,
            inicio: '2026-11-30',
            fim: '2026-12-29',
            competencia: '2026-11',
            baseInss: 400_000,
            inss: 37_341,
          },
        ],
        '2026-11',
        '2026-11-01',
        '2026-11-30',
      ).get(v),
    ).toEqual({ dias: 1, baseInss: 400_000, inss: 37_341 });
  });

  it('chave desligada: programar recusa; o autosserviço mostra só a frase', async () => {
    const m = montar(false);
    const s = sessao();
    const r = await m.ferias.minhas(s, 1);
    expect(r).toMatchObject({ disponivel: false, mensagem: MENSAGEM_FERIAS_FORA, saldo: null });
    await expect(
      m.ferias.programar(s, {
        vinculo: 1,
        empresa: 1,
        aquisitivoInicio: '2025-01-05',
        inicio: '2026-11-30',
        dias: 30,
        abono: 0,
        adiantarDecimo: false,
      }),
    ).rejects.toBeInstanceOf(ErroProblema);
  });
});

describe('13º salário (serviço)', () => {
  it('1ª parcela → recálculo substitui → parcela final desconta o adiantamento → a ordem das parcelas', async () => {
    const m = montar();
    const v = await admitir(m, '2026-01-01');
    const s = sessao();
    const um = { empresa: 1, ano: 2026, parcela: 1 as const, pagamento: '2026-11-20', simular: false };
    const p1 = await m.ferias.calcularDecimo(s, um);
    expect(p1).toMatchObject({ calculado: true, pendencias: [] });
    expect(p1.processo).toMatchObject({ tipo: 'decimo1', competencia: '2026-11', pagamento: '2026-11-20' });
    expect(p1.colaboradores.find((c) => c.vinculo === v)).toMatchObject({
      proventos: 150_000,
      diasPagos: 12,
    });
    const p1b = await m.ferias.calcularDecimo(s, { ...um, pagamento: '2026-11-25' });
    expect(p1b.substituido).toBe(p1.processo!.id);

    expect(
      (await m.ferias.calcularDecimo(s, { ...um, parcela: 2, pagamento: '2026-12-18' })).pendencias.map(
        (p) => p.codigo,
      ),
    ).toEqual(['competencia-futura']);
    m.relogio('2026-12-10T10:00:00');
    const p2 = await m.ferias.calcularDecimo(s, { ...um, parcela: 2, pagamento: '2026-12-18' });
    expect(p2.calculado).toBe(true);
    expect(p2.processo).toMatchObject({ tipo: 'decimo2', competencia: '2026-12' });
    expect(p2.avisos.map((a) => a.codigo)).toEqual(['competencias-sem-calculo']);
    const ls = (await m.calculo.linhasDoVinculo(s, p2.processo!.id, v)).linhas;
    expect(valor(ls, 'decimoTerceiro')).toBe(300_000);
    expect(valor(ls, 'decimoDesconto')).toBe(150_000);
    expect(valor(ls, 'inssDecimo')).toBe(25_341);
    expect(valor(ls, 'fgts')).toBe(12_000);
    const det = await m.calculo.detalhe(s, p2.processo!.id);
    expect(det.colaboradores[0]).toMatchObject({
      inss: 25_341,
      liquido: 300_000 - 150_000 - 25_341 - valor(ls, 'irrfDecimo'),
    });

    // Com a parcela final calculada, a 1ª não é refeita nem descartada.
    expect(await codigo(m.ferias.calcularDecimo(s, um))).toBe('parcela-final-calculada');
    expect(
      await codigo(m.calculo.descartar(s, p1b.processo!.id, { versao: 0, motivo: 'Teste sintético' })),
    ).toBe('parcela-final-calculada');

    const lista = await m.ferias.listarDecimo(s, { empresa: 1, ano: 2026 });
    expect(lista.itens.map((p) => [p.tipo, p.situacao])).toEqual([
      ['decimo2', 'calculada'],
      ['decimo1', 'calculada'],
      ['decimo1', 'substituida'],
    ]);
    // O descarte da parcela é da permissão do 13º: só a do cálculo mensal não basta; pela rota do 13º, só parcelas do 13º.
    const soFolhaCalcular = sessao((p) => p !== 'pessoas.decimo.calcular');
    const soDecimo = sessao((p) => p !== 'pessoas.folha.calcular');
    const motivo = { versao: 0, motivo: 'Teste sintético' };
    expect(await codigo(m.calculo.descartar(soFolhaCalcular, p2.processo!.id, motivo))).toBe('sem-permissao');
    expect(await codigo(m.calculo.descartar(soFolhaCalcular, p2.processo!.id, motivo, 'decimo'))).toBe(
      'sem-permissao',
    );
    const desc = await m.calculo.descartar(soDecimo, p2.processo!.id, motivo, 'decimo');
    expect(desc.ok).toBe(true);
    expect((await m.ferias.listarDecimo(s, { empresa: 1, ano: 2026 })).itens[0]).toMatchObject({
      tipo: 'decimo2',
      situacao: 'descartada',
    });

    // A folha mensal não confunde o 13º de dezembro com a folha do mês.
    expect((await m.calculo.listarProcessos(s, { competencia: '2026-12', tipo: 'mensal' })).itens).toEqual(
      [],
    );
  });

  it('prévia não grava; chave desligada recusa a gravação', async () => {
    const m = montar(false);
    const s = sessao();
    const previa = await m.ferias.calcularDecimo(s, {
      empresa: 1,
      ano: 2026,
      parcela: 1,
      pagamento: '2026-11-20',
      simular: true,
    });
    expect(previa).toMatchObject({ calculado: false, simulado: true });
    await expect(
      m.ferias.calcularDecimo(s, {
        empresa: 1,
        ano: 2026,
        parcela: 1,
        pagamento: '2026-11-20',
        simular: false,
      }),
    ).rejects.toBeInstanceOf(ErroProblema);
  });
});
