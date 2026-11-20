// NIR sobre a cópia (ficha do M44, seção 10, etapa 2), sempre em transação desfeita e sob a trava da cópia:
//   - reserva concorrente (regra 11): duas transações reservam o mesmo leito ao mesmo tempo; uma vence e a outra
//     recebe a recusa "leito reservado" (Problem Details), sem esperar;
//   - conflito da reserva (regra 12): o leito reservado no novo recusa a admissão pelo novo para outra solicitação; o
//     outro sistema (simulado) o ocupa mesmo assim; o mapa mostra o conflito com a reserva, e o registro do conflito
//     vale uma vez;
//   - admissão vinda do NIR: a mesma gravação da admissão; a solicitação conclui (internado, com a internação gerada) e
//     a reserva é consumida na MESMA transação; a solicitação cancelada antes recusa a admissão inteira;
//   - as leituras do NIR (fila, reservas, internados com os trechos, a calibragem agregada no banco nas três réguas,
//     as cirurgias que pedem UTI) respondem dentro do tempo-alvo proposto.
// Massa sintética marcada; saída só com contagens, códigos e tempos (nenhum nome).
import {
  carregarDominiosVistos,
  ErroOperacao,
  estadosDoMapa,
  histogramasPermanencia,
  internadosDoQuadro,
  lerLeiturasPainel,
  operacao,
  registrarConflitoReservaSgh,
  registrarReservaSgh,
  reservasVigentesNir,
  cirurgiasQuePedemUti,
  solicitacaoNir,
  solicitacoesAbertasNir,
  solicitarLeitoSgh,
  somenteSgh,
  transicionarSolicitacaoSgh,
} from '@sgh/legado';
import { chaveTextoLeito, type InternarEntrada, TIPOS_INTENSIVA_PADRAO } from '@sgh/contratos';
import { montarMapaOperacional, montarPainel } from '@sgh/dominio-internacao';
import { resolve } from 'node:path';
import { reservaDoNovoFora } from '../massa/internacao-outro-sistema.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apoioDaInternacao,
  type ApoioInternacao,
  leitoLivre,
  type LeitoLivre,
} from '../massa/reproducao-internacao.js';
import {
  cepCompleto,
  cpfLivre,
  loginLivre,
  pacienteSintetico,
  usuarioSintetico,
} from '../massa/sintetica.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).message}`;
  }
}

function entrada(a: ApoioInternacao, paciente: number, leito: LeitoLivre): InternarEntrada {
  return {
    paciente,
    leito,
    convenio: a.convenio,
    matricula: '900000000144',
    validadeCarteira: '2031-12-31',
    diariasAutorizadas: 1,
    acomodacaoPlano: 'ENFERMARIA',
    carater: 'urgencia',
    clinica: 'M',
    especialidade: a.especialidade,
    medicoAssistente: a.assistente,
    medicoSolicitante: a.solicitante,
    cidPrincipal: a.cid,
    procedimento: a.procedimento,
    centroCusto: a.centroCusto,
    unidade: 4,
    origem: 'ambulatorio',
    isolamento: false,
  };
}

const USUARIO = 'SGH.TESTE.NIR';

describe.skipIf(!PODE_ESCREVER)('NIR na cópia (transação desfeita)', () => {
  let a: Ambiente;
  const tiposLogradouro =
    carregarDominiosVistos(resolve(import.meta.dirname, '../../../legado/src')).vistos('RICADPAC', 'TPLGR') ??
    new Set<string>();

  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      ricadint: await contar(l, 'SELECT MAX(REG) N FROM RICADINT'),
      solicitacoes: await contar(l, 'SELECT COUNT(*) N FROM SGH_INT_SOLIC_LEITO'),
      reservas: await contar(l, 'SELECT COUNT(*) N FROM SGH_INT_RESERVA_LEITO'),
    }));

  async function preparo(e: Escritor) {
    const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
    await a.executor.executar(
      operacao('acesso.criarUsuarioIntegracao'),
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, 'SGH.TESTE'),
      { escritor: e },
    );
    let seq = 0;
    const exec = (op: string, x: unknown) =>
      a.executor.executar(operacao(op), a.cod, x, ctxOperacao(a, login), { escritor: e });
    const paciente = async () => {
      const cpf = await cpfLivre(e, (Date.now() + 7919 * ++seq) % 90_000_000);
      const cep = await cepCompleto(e, tiposLogradouro);
      const r = await exec('cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep));
      return num(r.resultado['idPaciente']);
    };
    return { login, exec, paciente, apoio: await apoioDaInternacao(e) };
  }

  /** A solicitação com o leito reservado (só SGH_, na transação do teste). */
  async function reservada(e: Escritor, paciente: number, leito: LeitoLivre) {
    const s = somenteSgh(e);
    const solicitacao = await solicitarLeitoSgh(s, {
      hospital: a.cod,
      origem: 'eletiva',
      paciente,
      atendimento: null,
      cabecalho: null,
      internacao: null,
      cirurgia: null,
      prioridade: 'urgente',
      prazoMin: 240,
      perfil: { intensiva: false, precaucao: null, tiposAcomodacao: [] },
      clinica: 'M',
      especialidade: null,
      cid: null,
      justificativa: 'Indicacao SINTETICA M44 da integracao',
      situacaoLegado: 7,
      vinculo: 1,
      usuario: USUARIO,
    });
    const reserva = await registrarReservaSgh(s, {
      hospital: a.cod,
      solicitacao,
      leito,
      validadeMin: 120,
      excecao: null,
      usuario: USUARIO,
    });
    await transicionarSolicitacaoSgh(s, {
      hospital: a.cod,
      solicitacao,
      acao: 'reservar',
      de: 'solicitado',
      para: 'reservado',
      situacaoLegado: 5,
      reserva,
      usuario: USUARIO,
    });
    return { solicitacao, reserva };
  }

  const mapaDoLeito = async (e: Escritor, leito: LeitoLivre, solicitacao: number | null = null) => {
    const painel = montarPainel(await lerLeiturasPainel(e), {
      intensivas: [...TIPOS_INTENSIVA_PADRAO],
      agora: Date.now(),
      lidoEm: new Date().toISOString(),
      dadosAte: new Date().toISOString(),
      destino: 'legado',
    });
    const es = await estadosDoMapa(e, a.cod);
    return montarMapaOperacional(
      painel,
      es.estados,
      es.limpezas.map((x) => ({ ...x, atrasada: false })),
      es.atributos,
      es.reservas ?? [],
      solicitacao,
    ).leitos.find((x) => x.chave === chaveTextoLeito(leito));
  };

  it('reserva concorrente: uma vence, a outra recebe "leito reservado" depois da trava (regra 11)', async () => {
    const antes = await retrato();
    const leito = await a.nucleo.lerSomente(ctx(a), (l) => leitoLivre(l as unknown as Escritor, { tipo: 1 }));
    let soltar: () => void = () => undefined;
    let pronto: (v: string) => void = () => undefined;
    const primeiro = new Promise<string>((r) => (pronto = r));
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const r = await codigo(reservada(e, 990_000_001, leito));
      pronto(r);
      await new Promise<void>((x) => (soltar = x));
    });
    const r1 = await primeiro;
    const t0 = performance.now();
    const r2 = await a.nucleo.desfazendoNaCopia(ctx(a), (e) => codigo(reservada(e, 990_000_002, leito)));
    const ms = Math.round(performance.now() - t0);
    soltar();
    await segurando;
    console.log(`[${a.cod}] reserva concorrente: primeira ${r1}, segunda ${r2} em ${ms} ms`);
    expect([r1, r2]).toEqual(['gravou', 'leito-reservado']);
    expect(await retrato()).toEqual(antes);
  }, 300_000);

  it('conflito: o leito reservado recusa a admissão de outro; ocupado por fora, o mapa mostra o conflito (regra 12)', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await preparo(e);
      const leito = await leitoLivre(e, { tipo: 1 });
      const pac = await p.paciente();
      const { reserva } = await reservada(e, 990_000_003, leito);
      const reservadoAntes = await mapaDoLeito(e, leito);
      // A admissão pelo novo, sem a solicitação da reserva: recusada dentro da transação (o leito relido sob a trava).
      const pelaReceita = await codigo(p.exec('internacao.internar', entrada(p.apoio, pac, leito)));
      // O outro sistema não conhece a reserva do novo: a reserva fica fora de vista durante a gravação dele e volta.
      const chave = chaveTextoLeito(leito);
      await reservaDoNovoFora(e, reserva, chave);
      const reg = num((await p.exec('internacao.internar', entrada(p.apoio, pac, leito))).resultado['reg']);
      await reservaDoNovoFora(e, reserva, chave, true);
      const depois = await mapaDoLeito(e, leito);
      const primeiroRegistro = await registrarConflitoReservaSgh(somenteSgh(e), {
        hospital: a.cod,
        leito,
        reg,
      });
      const segundoRegistro = await registrarConflitoReservaSgh(somenteSgh(e), {
        hospital: a.cod,
        leito,
        reg,
      });
      const registrado = await mapaDoLeito(e, leito);
      return {
        antes: reservadoAntes?.situacao,
        admissivelAntes: reservadoAntes?.admissivel,
        pelaReceita,
        depois: depois?.situacao,
        reservaNoConflito: depois?.conflito?.reserva === reserva,
        conflitoDaInternacao: depois?.conflito?.internacao === reg,
        registros: [primeiroRegistro, segundoRegistro],
        registradoDepois: registrado?.conflito?.registrado,
      };
    });
    console.log(`[${a.cod}] conflito da reserva: ${JSON.stringify(r)}`);
    expect(r).toEqual({
      antes: 'reservado',
      admissivelAntes: false,
      pelaReceita: 'leito-reservado',
      depois: 'conflito',
      reservaNoConflito: true,
      conflitoDaInternacao: true,
      registros: [1, 0],
      registradoDepois: true,
    });
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('admissão vinda do NIR: a solicitação conclui e a reserva é consumida na mesma transação; a cancelada e a de outro paciente recusam', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await preparo(e);
      const leito = await leitoLivre(e, { tipo: 1 });
      const pac = await p.paciente();
      const { solicitacao } = await reservada(e, pac, leito);
      const admissivel = (await mapaDoLeito(e, leito, solicitacao))?.admissivel;
      const res = await p.exec('internacao.internar', {
        ...entrada(p.apoio, pac, leito),
        solicitacaoNir: solicitacao,
      });
      const reg = num(res.resultado['reg']);
      const s = await solicitacaoNir(e, a.cod, solicitacao);
      const vigentes = await reservasVigentesNir(e, a.cod);
      // Outra solicitação, cancelada antes da admissão: a admissão inteira é recusada (nada no legado).
      const leito2 = await leitoLivre(e, { tipo: 2 });
      const pac2 = await p.paciente();
      const r2 = await reservada(e, pac2, leito2);
      await transicionarSolicitacaoSgh(somenteSgh(e), {
        hospital: a.cod,
        solicitacao: r2.solicitacao,
        acao: 'cancelar',
        de: 'reservado',
        para: 'cancelado',
        motivo: 'Cancelada SINTETICA',
        usuario: USUARIO,
      });
      const maxAntes = await contar(e, 'SELECT MAX(REG) N FROM RICADINT');
      const recusada = await codigo(
        p.exec('internacao.internar', { ...entrada(p.apoio, pac2, leito2), solicitacaoNir: r2.solicitacao }),
      );
      const maxDepois = await contar(e, 'SELECT MAX(REG) N FROM RICADINT');
      // A solicitação reservada do paciente A usada na admissão do paciente B: recusada inteira (regra 11), a
      // solicitação de A segue reservada e o leito dela, com a reserva vigente.
      const leito3 = await leitoLivre(e, { tipo: 2, excluir: [leito2] });
      const r3 = await reservada(e, 990_000_004, leito3);
      const pacB = await p.paciente();
      const maxAntesB = await contar(e, 'SELECT MAX(REG) N FROM RICADINT');
      const deOutro = await codigo(
        p.exec('internacao.internar', { ...entrada(p.apoio, pacB, leito3), solicitacaoNir: r3.solicitacao }),
      );
      const maxDepoisB = await contar(e, 'SELECT MAX(REG) N FROM RICADINT');
      const s3 = await solicitacaoNir(e, a.cod, r3.solicitacao);
      const vigentes3 = await reservasVigentesNir(e, a.cod);
      return {
        deOutro,
        nadaNoLegadoDeOutro: maxAntesB === maxDepoisB,
        aSegueReservada: s3?.estado === 'reservado' && vigentes3.some((v) => v.id === r3.reserva),
        admissivel,
        estado: s?.estado,
        gerada: s?.regGerado === reg,
        reservaVigente: vigentes.some((v) => v.solicitacao === solicitacao),
        recusada,
        nadaNoLegado: maxAntes === maxDepois,
      };
    });
    console.log(`[${a.cod}] admissão vinda do NIR: ${JSON.stringify(r)}`);
    expect(r).toEqual({
      admissivel: true,
      estado: 'internado',
      gerada: true,
      reservaVigente: false,
      recusada: 'solicitacao-desatualizada',
      nadaNoLegado: true,
      deOutro: 'solicitacao-de-outro-paciente',
      nadaNoLegadoDeOutro: true,
      aSegueReservada: true,
    });
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('as leituras do NIR respondem dentro do tempo-alvo proposto (só contagens)', async () => {
    const medir = async <T>(fn: () => Promise<T>, nome = '') => {
      const t0 = performance.now();
      const r = await fn().catch((x: unknown) => {
        throw new Error(`${nome}: ${x instanceof Error ? x.message : String(x)}`);
      });
      return { r, ms: Math.round(performance.now() - t0) };
    };
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const fila = await medir(() => solicitacoesAbertasNir(l, a.cod), 'fila');
      const reservas = await medir(() => reservasVigentesNir(l, a.cod), 'reservas');
      const internados = await medir(() => internadosDoQuadro(l), 'internados');
      const cirurgias = await medir(() => cirurgiasQuePedemUti(l, a.cod), 'cirurgias');
      const calib = {} as Record<string, { ms: number; chaves: number; internacoes: number }>;
      for (const escopo of ['clinica', 'cid', 'procedimento'] as const) {
        const h = await medir(
          () =>
            histogramasPermanencia(l, {
              escopo,
              inicio: '2020-01-01',
              fim: '2026-12-31',
              intensivas: [...TIPOS_INTENSIVA_PADRAO],
            }),
          `calibragem ${escopo}`,
        );
        calib[escopo] = {
          ms: h.ms,
          chaves: new Set(h.r.portaria312.map((x) => x.chave)).size,
          internacoes: h.r.portaria312.reduce((s, x) => s + x.n, 0),
        };
      }
      return {
        fila: { ms: fila.ms, n: fila.r.itens.length },
        reservas: { ms: reservas.ms, n: reservas.r.length },
        internados: {
          ms: internados.ms,
          n: internados.r.itens.length,
          trechos: internados.r.itens.reduce((s, i) => s + i.trechos.length, 0),
        },
        cirurgias: { ms: cirurgias.ms, n: cirurgias.r.length < 5 ? '<5' : cirurgias.r.length },
        calib,
      };
    });
    console.log(`[${a.cod}] leituras do NIR: ${JSON.stringify(r)}`);
    expect(r.fila.ms).toBeLessThan(500);
    expect(r.reservas.ms).toBeLessThan(300);
    expect(r.internados.ms).toBeLessThan(1_000);
    expect(r.cirurgias.ms).toBeLessThan(500);
    for (const c of Object.values(r.calib)) expect(c.ms).toBeLessThan(10_000);
    // A régua da Portaria 312 cobre as mesmas internações em qualquer escopo (a agregação não perde linhas).
    expect(r.calib['clinica']?.internacoes).toBe(r.calib['cid']?.internacoes);
    expect(r.calib['clinica']?.internacoes).toBeGreaterThan(0);
  }, 600_000);
});
