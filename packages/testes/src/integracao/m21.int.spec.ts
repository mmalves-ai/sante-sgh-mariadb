// Internação, leitos e higienização sobre a cópia (ficha do M21, seção 10), sempre em transação desfeita e sob a trava
// da cópia:
//   - duas admissões no mesmo leito: a segunda recebe "leito ocupado em outro terminal"; a primeira tem a conta, o
//     período aberto e a ocupação feitos pelos gatilhos (a prova pós-escrita confere);
//   - outro terminal segurando o leito (como o outro sistema no meio da admissão): LOCK TIMEOUT vira "registro em
//     edição em outro terminal", nada gravado;
//   - transferência: o destino ocupado é recusado; para o livre, o trecho de origem fecha e o de destino abre; com o
//     destino travado por outro terminal, "registro em edição" (origem e destino travados em ordem fixa);
//   - o outro sistema (simulado) ocupa o leito bloqueado no novo: o mapa operacional mostra o conflito (regra 8);
//   - a exceção de gatilho do banco chega em português (o segundo período aberto: E_LOC_EXISTENTE_SEM_SAIDA); o banco
//     externo de TRG_RICADINT_AU neutralizado na cópia.
// Massa sintética marcada; saída só com contagens e códigos (nenhum nome).
import {
  abrirEstadoLeito,
  carregarDominiosVistos,
  devolucoesAtrasadas,
  ErroOperacao,
  estadosDoMapa,
  internacoesDaLista,
  lerLeiturasPainel,
  operacao,
  problemaDoLegado,
  profissionalLimpezaDoLogin,
  relatorioIncoerencias,
  solicitacoesDaFila,
} from '@sgh/legado';
import { chaveTextoLeito, type InternarEntrada, TIPOS_INTENSIVA_PADRAO } from '@sgh/contratos';
import { montarMapaOperacional, montarPainel } from '@sgh/dominio-internacao';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  estadoDoNovoFora,
  limpezaComoDoOutroSistema,
  outroSistemaAbreSegundoPeriodo,
} from '../massa/internacao-outro-sistema.js';
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
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).name}`;
  }
}

function entrada(a: ApoioInternacao, paciente: number, leito: LeitoLivre): InternarEntrada {
  return {
    paciente,
    leito,
    convenio: a.convenio,
    matricula: '900000000121',
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

describe.skipIf(!PODE_ESCREVER)('internação, leitos e higienização na cópia (transação desfeita)', () => {
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
      ritransf: await contar(l, 'SELECT COUNT(*) N FROM RITRANSF'),
      rictrloc: await contar(l, 'SELECT COUNT(*) N FROM RICTRLOC'),
      ocupados: await contar(l, 'SELECT COUNT(*) N FROM RILEITOS WHERE REG > 0'),
      estados: await contar(l, 'SELECT COUNT(*) N FROM SGH_INT_LEITO_ESTADO'),
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
  const versaoDe = async (e: Escritor, reg: number) => {
    const [v] = await e.consultar(
      'SELECT CAST(DATA_HORA_ULTIMA_ATUALIZACAO AS VARCHAR(30)) V FROM RICADINT WHERE REG = ?',
      [reg],
      { teto: 1 },
    );
    return String(v?.['V'] ?? '');
  };

  /** Outro terminal segura a linha do leito (WITH LOCK) enquanto `fn` grava; devolve o código da gravação. */
  async function comLeitoTravado(l: LeitoLivre, fn: (e: Escritor) => Promise<unknown>): Promise<string> {
    let soltar: () => void = () => undefined;
    let pronto: () => void = () => undefined;
    const travada = new Promise<void>((r) => (pronto = r));
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await e.consultar(
        'SELECT REG FROM RILEITOS WHERE BLOCO = ? AND ACOMOD = ? AND LEITO = ? WITH LOCK',
        [l.bloco, l.acomodacao, l.leito],
        {
          teto: 1,
        },
      );
      pronto();
      await new Promise<void>((r) => (soltar = r));
    });
    await travada;
    try {
      return await codigo(a.nucleo.desfazendoNaCopia(ctx(a), fn));
    } finally {
      soltar();
      await segurando;
    }
  }

  it('duas admissões no mesmo leito: a segunda recebe "leito ocupado"; a primeira com os efeitos dos gatilhos', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await preparo(e);
      const leito = await leitoLivre(e, { tipo: 1 });
      const pac1 = await p.paciente();
      const pac2 = await p.paciente();
      const primeira = await p.exec('internacao.internar', entrada(p.apoio, pac1, leito));
      const reg = num(primeira.resultado['reg']);
      const segunda = await codigo(p.exec('internacao.internar', entrada(p.apoio, pac2, leito)));
      const [x] = await e.consultar(
        `SELECT (SELECT COUNT(*) FROM ATCABECATEND WHERE COD_ATENDIMENTO = ? AND TP_ATENDIMENTO = 'I') CAB,
            (SELECT COUNT(*) FROM RICONTAS WHERE REG = ?) CONTA,
            (SELECT COUNT(*) FROM RICTRLOC WHERE REG = ? AND SAIDA = DATE '1899-12-30') TRECHO,
            (SELECT REG FROM RILEITOS WHERE BLOCO = ? AND ACOMOD = ? AND LEITO = ?) OCUPA,
            (SELECT COUNT(*) FROM SGH_INT_ENCAMINHAMENTO WHERE REG = ?) ENC
           FROM RDB$DATABASE`,
        [reg, reg, reg, leito.bloco, leito.acomodacao, leito.leito, reg],
        { teto: 1 },
      );
      return {
        segunda,
        cabecalho: num(x?.['CAB']),
        contas: num(x?.['CONTA']) >= 1,
        trechoAberto: num(x?.['TRECHO']),
        ocupacaoIgual: num(x?.['OCUPA']) === reg,
        encaminhamento: num(x?.['ENC']),
      };
    });
    expect(r).toEqual({
      segunda: 'leito-ocupado',
      cabecalho: 1,
      contas: true,
      trechoAberto: 1,
      ocupacaoIgual: true,
      encaminhamento: 1,
    });
    expect(await retrato()).toEqual(antes);
    console.log(`[${a.cod}] duas admissões: ${JSON.stringify(r)}`);
  }, 600_000);

  it('LOCK TIMEOUT: outro terminal segura o leito e a admissão devolve "registro em edição", nada gravado', async () => {
    const antes = await retrato();
    const leito = await a.nucleo.desfazendoNaCopia(ctx(a), (e) => leitoLivre(e, { tipo: 1 }));
    const c = await comLeitoTravado(leito, async (e) => {
      const p = await preparo(e);
      const pac = await p.paciente();
      await p.exec('internacao.internar', entrada(p.apoio, pac, leito));
    });
    expect(c).toBe('registro-em-edicao');
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('transferência: destino ocupado recusado; o livre fecha e abre os trechos; destino travado: registro em edição', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await preparo(e);
      const l1 = await leitoLivre(e, { tipo: 1 });
      // Os leitos livres da enfermaria são poucos na cópia: o ocupado é um apartamento e o destino livre, a UTI.
      const l2 = await leitoLivre(e, { tipo: 2 });
      const l3 = await leitoLivre(e, { tipo: 3 });
      const reg1 = num(
        (await p.exec('internacao.internar', entrada(p.apoio, await p.paciente(), l1))).resultado['reg'],
      );
      await p.exec('internacao.internar', entrada(p.apoio, await p.paciente(), l2));
      const ocupado = await codigo(
        p.exec('internacao.transferirLeito', {
          internacao: reg1,
          destino: l2,
          versao: await versaoDe(e, reg1),
        }),
      );
      const livre = await codigo(
        p.exec('internacao.transferirLeito', {
          internacao: reg1,
          destino: l3,
          versao: await versaoDe(e, reg1),
        }),
      );
      const [x] = await e.consultar(
        `SELECT (SELECT COUNT(*) FROM RICTRLOC WHERE REG = ?) T,
            (SELECT COUNT(*) FROM RICTRLOC WHERE REG = ? AND SAIDA = DATE '1899-12-30' AND BLOCO = ? AND ACOMOD = ? AND LEITO = ?) ABERTO,
            (SELECT REG FROM RILEITOS WHERE BLOCO = ? AND ACOMOD = ? AND LEITO = ?) ORIGEM,
            (SELECT COUNT(*) FROM RITRANSF WHERE REG = ?) TR
           FROM RDB$DATABASE`,
        [reg1, reg1, l3.bloco, l3.acomodacao, l3.leito, l1.bloco, l1.acomodacao, l1.leito, reg1],
        { teto: 1 },
      );
      return {
        ocupado,
        livre,
        trechos: num(x?.['T']),
        abertoNoDestino: num(x?.['ABERTO']),
        origemLivre: num(x?.['ORIGEM']) === 0,
        transferencias: num(x?.['TR']),
      };
    });
    expect(r).toEqual({
      ocupado: 'leito-ocupado',
      livre: 'gravou',
      trechos: 2,
      abertoNoDestino: 1,
      origemLivre: true,
      transferencias: 1,
    });
    const destino = await a.nucleo.desfazendoNaCopia(ctx(a), (e) => leitoLivre(e, { tipo: 2 }));
    const travada = await comLeitoTravado(destino, async (e) => {
      const p = await preparo(e);
      const origem = await leitoLivre(e, { tipo: 1 });
      const reg = num(
        (await p.exec('internacao.internar', entrada(p.apoio, await p.paciente(), origem))).resultado['reg'],
      );
      await p.exec('internacao.transferirLeito', {
        internacao: reg,
        destino,
        versao: await versaoDe(e, reg),
      });
    });
    expect(travada).toBe('registro-em-edicao');
    expect(await retrato()).toEqual(antes);
    console.log(`[${a.cod}] transferência: ${JSON.stringify(r)}`);
  }, 900_000);

  it('o outro sistema ocupa o leito bloqueado no novo: o mapa mostra o conflito (o outro sistema não é impedido)', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await preparo(e);
      const leito = await leitoLivre(e, { tipo: 1 });
      const bloqueio = await abrirEstadoLeito(e, {
        hospital: a.cod,
        leito,
        estado: 'bloqueio',
        motivo: 'manutencao',
        usuario: p.login,
      });
      const mapa = async () => {
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
        ).leitos.find((x) => x.chave === chaveTextoLeito(leito));
      };
      const antesDeOcupar = await mapa();
      const pacienteId = await p.paciente();
      // D-MAPA-21 dentro da transação: a admissão pelo novo relê o estado do leito sob a trava e recusa o bloqueado.
      const pelaReceita = await codigo(p.exec('internacao.internar', entrada(p.apoio, pacienteId, leito)));
      // O escritor do outro sistema grava a internação como sempre gravou: não conhece o estado do novo. Simulado com a
      // mesma receita com o bloqueio fora de vista (FIM_EM preenchido) só durante a gravação, e reaberto logo depois.
      await estadoDoNovoFora(e, bloqueio);
      const reg = num(
        (await p.exec('internacao.internar', entrada(p.apoio, pacienteId, leito))).resultado['reg'],
      );
      await estadoDoNovoFora(e, bloqueio, true);
      const depois = await mapa();
      return {
        antes: antesDeOcupar?.situacao,
        admissivelAntes: antesDeOcupar?.admissivel,
        pelaReceita,
        depois: depois?.situacao,
        conflitoDaInternacao: depois?.conflito?.internacao === reg,
        registrado: depois?.conflito?.registrado,
      };
    });
    expect(r).toEqual({
      antes: 'bloqueado',
      admissivelAntes: false,
      pelaReceita: 'leito-indisponivel',
      depois: 'conflito',
      conflitoDaInternacao: true,
      registrado: false,
    });
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('exceção de gatilho em português (segundo período aberto); banco externo de TRG_RICADINT_AU neutralizado', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await preparo(e);
      const leito = await leitoLivre(e, { tipo: 1 });
      const reg = num(
        (await p.exec('internacao.internar', entrada(p.apoio, await p.paciente(), leito))).resultado['reg'],
      );
      // O outro sistema tentando abrir um segundo período sem fechar o primeiro: o gatilho recusa.
      const erro = await outroSistemaAbreSegundoPeriodo(e, reg);
      const t = erro ? problemaDoLegado(erro).problema : null;
      const [banco] = await e.consultar(
        `SELECT COUNT(*) N, SUM(IIF(CAMINHO CONTAINING '127.0.0.1' OR CAMINHO CONTAINING 'localhost'
            OR TRIM(COALESCE(CAMINHO, '')) = '', 1, 0)) L FROM TBINFBANCO`,
        [],
        { teto: 1 },
      );
      return {
        codigo: t?.codigo ?? 'gravou',
        emPortugues: /período de leito aberto/.test(t?.detail ?? ''),
        bancos: num(banco?.['N']),
        neutralizados: num(banco?.['L']),
      };
    });
    expect(r).toEqual({
      codigo: 'periodo-aberto',
      emPortugues: true,
      bancos: r.neutralizados,
      neutralizados: r.bancos,
    });
    expect(await retrato()).toEqual(antes);
    console.log(`[${a.cod}] gatilho e banco externo: ${JSON.stringify(r)}`);
  }, 600_000);
  it('a limpeza pedida pela alta do outro sistema entra na fila (janela) e põe o leito em higienização no mapa', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await preparo(e);
      const leito = await leitoLivre(e, { tipo: 1 });
      const sol = num(
        (await p.exec('hotelaria.solicitarLimpeza', { leito, tipoLimpeza: 4, origem: 'manual' })).resultado[
          'solicitacao'
        ],
      );
      // Como o outro sistema grava (a alta dada lá): a solicitação e a execução na situação 1, sem nada do novo.
      await limpezaComoDoOutroSistema(e, a.cod, sol, leito);
      const t0 = performance.now();
      const semJanela = await solicitacoesDaFila(e, a.cod, { janelaHoras: 0 });
      const comJanela = await solicitacoesDaFila(e, a.cod, { janelaHoras: 24 });
      const es = await estadosDoMapa(e, a.cod, { janelaHoras: 24 });
      const ms = performance.now() - t0;
      const chave = chaveTextoLeito(leito);
      return {
        foraSemJanela: !semJanela.itens.some((x) => x.solicitacao === sol),
        naFila: comJanela.itens.find((x) => x.solicitacao === sol)?.doOutroSistema === true,
        higienizacaoNoMapa: es.estados.some((x) => x.chave === chave && x.estado === 'higienizacao'),
        limpezaNoMapa: es.limpezas.some((x) => x.chave === chave && x.solicitacao === sol),
        rapido: ms < 30_000,
      };
    });
    expect(r).toEqual({
      foraSemJanela: true,
      naFila: true,
      higienizacaoNoMapa: true,
      limpezaNoMapa: true,
      rapido: true,
    });
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('leituras novas da correção: devoluções atrasadas, internações com alta, incoerências e o profissional do login', async () => {
    const t0 = performance.now();
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const atrasadas = await devolucoesAtrasadas(l, a.cod, { setorSame: 1, prazoDias: 7 });
      const comAlta = await internacoesDaLista(l, {
        intensivas: [...TIPOS_INTENSIVA_PADRAO],
        situacao: 'alta',
        altaDe: '2026-07-01',
        altaAte: '2026-07-31',
      });
      const inc = await relatorioIncoerencias(l);
      const prof = await profissionalLimpezaDoLogin(l, 'SGH.NINGUEM.SINTETICO');
      return {
        atrasadasOk: atrasadas.itens.every((x) => x.conta > 0 && x.diasAtraso >= 0),
        semNome: atrasadas.itens.every(
          (x) => Object.keys(x).sort().join(',') === 'cobrada,conta,desde,diasAtraso,movimento,prazo,setor',
        ),
        altaOk: comAlta.itens.every(
          (x) => x.alta !== null && x.alta >= '2026-07-01' && x.alta <= '2026-07-31',
        ),
        listaAteTeto:
          inc.listaAltaAntes.length <= 200 &&
          inc.listaAltaAntes.length === Math.min(200, inc.altaAntesDaEntrada.length),
        prof,
      };
    });
    expect(r).toEqual({ atrasadasOk: true, semNome: true, altaOk: true, listaAteTeto: true, prof: null });
    expect(performance.now() - t0).toBeLessThan(120_000);
  }, 600_000);
});
