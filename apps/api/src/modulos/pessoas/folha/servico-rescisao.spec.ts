// M53.5: o serviço da rescisão sobre as portas EM MEMÓRIA (dados SINTÉTICOS; nada conecta a banco): a recusa sem
// desligamento, a fila dos desligados com a modalidade sugerida, a prévia e a rescisão gravada (processamento `rescisao`
// com a rescisão registrada), os valores só com o salário (detalhe, lista e processamento), a substituição no recálculo,
// o cancelamento (o processamento descartado junto; não pela rota do cálculo), as férias programadas canceladas ao
// gravar, a pendência da folha mensal que já pagou o mês e a chave desligada.
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
import { ServicoCalculoFolha } from './servico-calculo.js';
import { ServicoFeriasFolha } from './servico-ferias.js';
import {
  MOTIVO_FERIAS_NA_RESCISAO,
  MENSAGEM_RECUSA_RESCISAO,
  ServicoRescisaoFolha,
} from './servico-rescisao.js';

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

let k = 0;
function sessao(pode: (p: string) => boolean = () => true): SessaoCadastro {
  return {
    req: {
      headers: { 'idempotency-key': `m53-rescisao-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null } },
    } as never,
    hospital: 'pc',
    rede: 'rede-sintetica',
    login: 'SINT.DP.RESCISAO',
    porta: { rede: 'rede-sintetica', hospital: 'pc' },
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
    eventosDaCompetencia: async (_c: unknown, competencia: string): Promise<EventoPeriodoLidoSgh[]> =>
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
  const rescisao = new ServicoRescisaoFolha(
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
  return { pessoas, porta, folha, rh, calculo, ferias, rescisao, trilha, fechados, relogio };
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

async function desligar(m: ReturnType<typeof montar>, v: number, data: string, tipoRescisao = 2) {
  const c = { rede: 'rede-sintetica', hospital: 'pc' };
  const lido = await m.pessoas.vinculo(c, v);
  await m.pessoas.gravarSgh(c, {} as never, async (g) => {
    await g.desligarVinculo({
      id: v,
      versao: lido!.versao,
      data,
      tipoRescisao,
      motivo: 'Desligamento sintético do teste.',
      por: 'SINT.RH',
    } as never);
  });
}

const base = (vinculo: number) => ({
  vinculo,
  empresa: 1,
  modalidade: 'sem-justa-causa' as const,
  aviso: 'indenizado' as const,
  termo: null,
  saldoFgts: 1_000_000,
  pagamento: null,
  simular: false,
});

describe('rescisão (serviço)', () => {
  it('recusa sem desligamento → fila → prévia → gravada → detalhe → recálculo substitui → cancelamento', async () => {
    const m = montar();
    const v = await admitir(m, '2025-01-05');
    m.fechados.add(v);
    const s = sessao();
    const semSalario = sessao((p) => p !== 'pessoas.salario.ler');

    const apoio = await m.rescisao.apoioTela(s);
    expect(apoio.acoes).toEqual({ calcular: true, verSalario: true, motivo: null });
    expect(apoio.modalidades).toHaveLength(10);
    expect(apoio.modalidades.find((x) => x.modalidade === 'pedido-demissao')?.avisos).toEqual([
      'trabalhado',
      'dispensado',
      'nao-cumprido',
    ]);
    expect(apoio.tiposRescisao[0]).toEqual({
      id: 1,
      nome: 'Demissão sem justa causa',
      modalidade: 'sem-justa-causa',
    });

    const ativo = await m.rescisao.calcular(s, base(v)).catch((e: ErroProblema) => e);
    expect(ativo).toBeInstanceOf(ErroProblema);
    expect((ativo as ErroProblema).extras['codigo']).toBe('vinculo-ativo');
    expect((ativo as ErroProblema).detalhe).toBe(MENSAGEM_RECUSA_RESCISAO['vinculo-ativo']);

    await desligar(m, v, '2026-10-20', 1);
    const fila = await m.rescisao.desligados(s, { de: '2026-10-01', ate: '2026-10-31' });
    expect(fila.itens).toEqual([
      expect.objectContaining({
        vinculo: v,
        desligamento: '2026-10-20',
        tipoRescisao: 1,
        modalidadeSugerida: 'sem-justa-causa',
        rescisao: null,
      }),
    ]);
    expect(await codigo(m.rescisao.calcular(s, { ...base(v), aviso: 'nenhum' }))).toBe('aviso-invalido');

    const previa = await m.rescisao.calcular(s, { ...base(v), simular: true });
    expect(previa).toMatchObject({ calculado: false, simulado: true, rescisao: null, pendencias: [] });
    expect(previa.apuracao).toMatchObject({
      diasAviso: 33,
      diasIndenizados: 33,
      projecao: '2026-11-22',
      diasSaldo: 20,
    });
    expect(valor(previa.linhas, 'avisoIndenizado')).toBe(330_000);
    expect(previa.conferencia?.ok).toBe(true);
    expect(await m.porta.rescisoes(s.porta, { vinculo: v })).toEqual([]);

    const r = await m.rescisao.calcular(s, base(v));
    expect(r.calculado).toBe(true);
    expect(r.rescisao).toMatchObject({
      vinculo: v,
      situacao: 'calculada',
      modalidade: 'sem-justa-causa',
      aviso: 'indenizado',
      diasAviso: 33,
      projecao: '2026-11-22',
      pagamento: '2026-10-30',
      tipoRescisao: 1,
      saldoFgtsInformado: true,
    });
    expect(r.rescisao?.multaFgts).toBe(r.apuracao?.multaFgts);
    expect(r.processo).toMatchObject({ tipo: 'rescisao', competencia: '2026-10', pagamento: '2026-10-30' });
    expect(m.trilha.eventos.map((x) => x.evento)).toContain('pessoas.rescisao.calculada');

    const d = await m.rescisao.detalhe(s, r.rescisao!.id);
    expect(d.linhas.length).toBeGreaterThan(5);
    expect(d.linhasOcultas).toBe(false);
    const oculto = await m.rescisao.detalhe(semSalario, r.rescisao!.id);
    expect(oculto).toMatchObject({ linhas: [], linhasOcultas: true });
    expect(oculto.processo).not.toHaveProperty('totais');
    // D-PERM-SAL-535: o saldo e a multa do FGTS revelam a remuneração; sem o salário saem null no detalhe e na lista.
    expect(d.rescisao.multaFgts).toBe(r.apuracao?.multaFgts);
    expect(d.rescisao.saldoFgts).toBe(r.apuracao?.saldoFgts);
    expect(d.rescisao.saldoFgts).not.toBeNull();
    expect(oculto.rescisao).toMatchObject({ saldoFgts: null, multaFgts: null });
    const listaOculta = (await m.rescisao.listar(semSalario, { vinculo: v })).itens;
    expect(listaOculta.length).toBeGreaterThan(0);
    for (const x of listaOculta) expect(x).toMatchObject({ saldoFgts: null, multaFgts: null });
    expect((await m.rescisao.listar(s, { vinculo: v })).itens[0]?.multaFgts).toBe(r.apuracao?.multaFgts);
    const termo = await m.rescisao.termo(s, r.rescisao!.id);
    expect(termo.detalhe.linhas.length).toBe(d.linhas.length);
    expect(await codigo(m.rescisao.termo(semSalario, r.rescisao!.id))).toBe('sem-permissao');
    // A lista dos processamentos e o detalhe do cálculo seguem a permissão do salário (um colaborador só).
    expect((await m.calculo.listarProcessos(semSalario, {})).itens.map((p) => p.tipo)).not.toContain(
      'rescisao',
    );
    expect(await codigo(m.calculo.detalhe(semSalario, r.processo!.id))).toBe('sem-permissao');
    expect(await codigo(m.calculo.descartar(s, r.processo!.id, { versao: 0, motivo: 'Pelo cálculo' }))).toBe(
      'termo-de-rescisao',
    );
    expect((await m.rescisao.desligados(s, { de: '2026-10-01', ate: '2026-10-31' })).itens[0]?.rescisao).toBe(
      r.rescisao!.id,
    );

    const outra = await m.rescisao.calcular(s, { ...base(v), modalidade: 'acordo' });
    expect(outra.substituida).toBe(r.rescisao!.id);
    expect(outra.rescisao?.diasIndenizados).toBe(16);
    const antiga = await m.porta.rescisaoPorId(s.porta, r.rescisao!.id);
    expect(antiga?.situacao).toBe('substituida');
    expect((await m.porta.processo(s.porta, r.processo!.id))?.situacao).toBe('substituida');
    expect((await m.rescisao.listar(s, { vinculo: v })).itens.map((x) => x.situacao)).toEqual([
      'calculada',
      'substituida',
    ]);

    expect(
      await codigo(m.rescisao.cancelar(s, outra.rescisao!.id, { versao: 9, motivo: 'Versão velha' })),
    ).toBe('desatualizado');
    const can = await m.rescisao.cancelar(s, outra.rescisao!.id, {
      versao: 0,
      motivo: 'Desligamento revisto',
    });
    expect(can.ok).toBe(true);
    expect((await m.porta.rescisaoPorId(s.porta, outra.rescisao!.id))?.situacao).toBe('cancelada');
    expect((await m.porta.processo(s.porta, outra.processo!.id))?.situacao).toBe('descartada');
    expect(await codigo(m.rescisao.cancelar(s, outra.rescisao!.id, { versao: 1, motivo: 'De novo' }))).toBe(
      'nao-calculada',
    );
    expect(await codigo(m.rescisao.detalhe(s, 99_999))).toBe('nao-encontrado');
  });

  it('as férias programadas sem recibo saem indenizadas e a programação é cancelada ao gravar', async () => {
    const m = montar();
    const v = await admitir(m, '2025-01-05');
    m.fechados.add(v);
    const s = sessao();
    const prog = await m.ferias.programar(s, {
      vinculo: v,
      empresa: 1,
      aquisitivoInicio: '2025-01-05',
      inicio: '2026-11-30',
      dias: 30,
      abono: 0,
      adiantarDecimo: false,
    });
    await desligar(m, v, '2026-10-20');
    const r = await m.rescisao.calcular(s, base(v));
    expect(r.avisos.map((a) => a.codigo)).toContain('ferias-programadas');
    expect(valor(r.linhas, 'feriasVencidas')).toBe(300_000);
    const f = await m.porta.feriasPorId(s.porta, prog.id);
    expect(f).toMatchObject({ situacao: 'cancelada', motivo: MOTIVO_FERIAS_NA_RESCISAO });
  });

  it('a folha mensal que já pagou o mês do desligamento barra a gravação (na-folha-mensal)', async () => {
    const m = montar();
    const v = await admitir(m, '2025-01-05');
    m.fechados.add(v);
    const s = sessao();
    const mensal = await m.calculo.calcular(s, { empresa: 1, competencia: '2026-09', simular: false });
    expect(mensal.calculado).toBe(true);
    await desligar(m, v, '2026-09-20');
    const r = await m.rescisao.calcular(s, base(v));
    expect(r.calculado).toBe(false);
    expect(r.pendencias.map((p) => p.codigo)).toEqual(['na-folha-mensal']);
    expect(r.linhas.length).toBeGreaterThan(0);
    expect(await m.porta.rescisoes(s.porta, { vinculo: v })).toEqual([]);
  });

  it('chave desligada: a prévia sai, a gravação e o cancelamento recusam; ponto aberto vira aviso', async () => {
    const m = montar(false);
    const s = sessao();
    const v = (
      await m.rh.admitir(s, {
        cpf: C.nova.cpf,
        nome: 'PESSOA NOVA SINTETICA',
        profissional: null,
        tipo: 'clt',
        admissao: '2025-01-05',
        cargo: 'Auxiliar administrativo',
        funcao: null,
        cargaSemanalHoras: 44,
        lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 3' },
        matricula: null,
        usuario: null,
      })
    ).id;
    await desligar(m, v, '2026-10-20');
    const p = await m.rescisao.calcular(s, { ...base(v), simular: true });
    expect(p.calculado).toBe(false);
    expect(p.pendencias.map((x) => x.codigo)).toEqual(['sem-parametros', 'sem-salario']);
    expect(p.avisos.map((a) => a.codigo)).toContain('ponto-nao-fechado');
    await expect(m.rescisao.calcular(s, base(v))).rejects.toBeInstanceOf(ErroProblema);
    await expect(m.rescisao.cancelar(s, 1, { versao: 0, motivo: 'Sem chave' })).rejects.toBeInstanceOf(
      ErroProblema,
    );
    expect(await m.porta.rescisoes(s.porta, {})).toEqual([]);
  });
});
