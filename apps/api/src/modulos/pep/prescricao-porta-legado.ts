// Porta da prescrição sobre o núcleo do legado (M24): leituras em transação curta READ ONLY, as gravações pelo
// EXECUTOR do M04 (as receitas da prescrição) e os registros só do novo pelo escritor SGH_ do núcleo. Em dev sobre a
// cópia compartilhada, o executor só de leitura recusa a gravação com o motivo (como o cadastro do M11).
import {
  agoraDoBanco,
  alergiasAtivas,
  dadosClinicosDoPaciente,
  atendimentoDaPrescricao,
  atendimentosDoPaciente,
  itensParaIndiceDeBusca,
  profissionalDoUsuario,
  cabecalhoDaPrescricao,
  cabecalhoDocumento,
  cancelarFutura,
  coassinarPrescricao,
  consultarCadastroPrescricao,
  decisoesDaPrescricao,
  dietaAtivaDeOutro,
  dominiosDoEditor,
  type Executor,
  fichasAntimicrobiano,
  fichasAntimicrobianoAntigas,
  type FonteCatalogo,
  futurasDoAtendimento,
  gradesPorClasse,
  gravarGradeClasse,
  gravarVersaoRegra,
  hashLegadoDaPrescricao,
  horariosDasDietas,
  horariosRelativos,
  interacoesDosPrincipios,
  itensDaPrescricao,
  itensDoProtocolo,
  kitsDoProduto,
  type Leitor,
  marcasDoNovo,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  parametrosDaPrescricao,
  planejamentosAntigos,
  prescricoesDoAtendimento,
  prescritoresDoUsuario,
  produtosAtivosNoPeriodo,
  produtosDoCadastro,
  programarFutura,
  protocolosDePrescricao,
  provaDaPrescricao,
  reconciliacoesDoAtendimento,
  regrasAlerta,
  regrasDeHorario,
  registrarFichaAntimicrobiano,
  registrarReconciliacao,
  retratosAtuais,
  vencemAte,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPrescricao, PortaPrescricao } from './prescricao-porta.js';

const p2 = (n: number) => String(n).padStart(2, '0');
function localIso(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
function dataLocal(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) throw new ErroProblema('entrada-invalida', 400, 'Data inválida');
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  );
}

export function portaPrescricaoLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaPrescricao {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ler = <T>(c: ContextoPrescricao, fn: (l: Leitor) => Promise<T>) =>
    nucleo.lerSomente({ rede: c.rede, hospital: c.hospital, traceId: 'prescricao' }, fn);
  const sgh = <T>(c: ContextoPrescricao, fn: Parameters<NucleoLegado['gravarSgh']>[1]) =>
    nucleo.gravarSgh({ rede: c.rede, hospital: c.hospital, traceId: 'prescricao-sgh' }, fn) as Promise<T>;
  return {
    destino: 'legado',
    prescritores: (c, login) => ler(c, (l) => prescritoresDoUsuario(l, login)),
    atendimentos: (c, paciente) => ler(c, (l) => atendimentosDoPaciente(l, paciente)),
    atendimento: (c, id) => ler(c, (l) => atendimentoDaPrescricao(l, id)),
    retratos: (c, a, p) => ler(c, (l) => retratosAtuais(l, a, p)),
    regras: (c) => ler(c, (l) => regrasDeHorario(l)),
    relativos: (c) => ler(c, (l) => horariosRelativos(l)),
    horariosDieta: (c) => ler(c, (l) => horariosDasDietas(l)),
    dominios: (c) => ler(c, (l) => dominiosDoEditor(l)),
    produtos: (c, ids) => ler(c, (l) => produtosDoCadastro(l, ids)),
    itensParaIndice: (c) => ler(c, (l) => itensParaIndiceDeBusca(l)),
    kits: (c, produto) => ler(c, (l) => kitsDoProduto(l, produto)),
    cadastro: (c, secao, termo) => ler(c, (l) => consultarCadastroPrescricao(l, secao, termo)),
    protocolos: (c) => ler(c, (l) => protocolosDePrescricao(l)),
    especialidadesDoPrescritor: (c, login) =>
      ler(c, async (l) => [...((await profissionalDoUsuario(l, login))?.especialidades ?? [])]),
    itensDoProtocolo: (c, id) => ler(c, (l) => itensDoProtocolo(l, id)),
    prescricoes: (c, a) => ler(c, (l) => prescricoesDoAtendimento(l, a)),
    cabecalho: (c, id) => ler(c, (l) => cabecalhoDaPrescricao(l, id)),
    itens: (c, id) => ler(c, (l) => itensDaPrescricao(l, id)),
    alergias: (c, paciente) => ler(c, (l) => alergiasAtivas(l, paciente)),
    dadosClinicos: (c, paciente) => ler(c, (l) => dadosClinicosDoPaciente(l, paciente)),
    produtosAtivos: (c, a, i, f, x) =>
      ler(c, (l) => produtosAtivosNoPeriodo(l, a, dataLocal(i), dataLocal(f), x)),
    dietaDeOutro: (c, a, i, f, cbo) =>
      ler(c, (l) => dietaAtivaDeOutro(l, a, dataLocal(i), dataLocal(f), cbo)),
    parametrosLegado: (c) => ler(c, (l) => parametrosDaPrescricao(l)),
    regrasAlerta: (c) => ler(c, (l) => regrasAlerta(l, c.hospital)),
    interacoes: (c, p) => ler(c, (l) => interacoesDosPrincipios(l, c.hospital, p)),
    prova: (c, id) => ler(c, (l) => provaDaPrescricao(l, c.hospital, id)),
    hashAtual: (c, id) => ler(c, (l) => hashLegadoDaPrescricao(l, id)),
    marcas: (c, ids) => ler(c, (l) => marcasDoNovo(l, c.hospital, ids)),
    decisoes: (c, id) => ler(c, (l) => decisoesDaPrescricao(l, c.hospital, id)),
    futuras: (c, a) => ler(c, (l) => futurasDoAtendimento(l, c.hospital, a)),
    reconciliacoes: (c, a) => ler(c, (l) => reconciliacoesDoAtendimento(l, c.hospital, a)),
    fichas: (c, p) => ler(c, (l) => fichasAntimicrobiano(l, c.hospital, p === null ? {} : { paciente: p })),
    fichasAntigas: (c, p) => ler(c, (l) => fichasAntimicrobianoAntigas(l, p)),
    planejamentosAntigos: (c, p) => ler(c, (l) => planejamentosAntigos(l, p)),
    grades: (c) => ler(c, (l) => gradesPorClasse(l, c.hospital)),
    vencemAte: (c, a, b, u) => ler(c, (l) => vencemAte(l, dataLocal(a), dataLocal(b), u)),
    cabecalhoDocumento: (c, r, cbo) => ler(c, (l) => cabecalhoDocumento(l, r, cbo, 3)),
    agora: (c) => ler(c, async (l) => localIso(await agoraDoBanco(l))),
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async prescrever(c, op, e, ctx) {
      const r = await executor.executar(operacao(op), c.hospital, e, ctx);
      return { prescricao: Number(r.resultado['prescricao']), horarios: Number(r.resultado['horarios']) };
    },
    async incluirItem(c, e, ctx) {
      const r = await executor.executar(operacao('pep.incluirItem'), c.hospital, e, ctx);
      return { item: Number(r.resultado['item']) };
    },
    async suspenderItem(c, e, ctx) {
      const r = await executor.executar(operacao('pep.suspenderItem'), c.hospital, e, ctx);
      return { horarios: Number(r.resultado['horarios']) };
    },
    async suspenderPrescricao(c, e, ctx) {
      const r = await executor.executar(operacao('pep.suspenderPrescricao'), c.hospital, e, ctx);
      return { horarios: Number(r.resultado['horarios']) };
    },
    async coassinar(c, prescricao, usuario) {
      const hash = await ler(c, (l) => hashLegadoDaPrescricao(l, prescricao));
      await sgh(c, (e) =>
        coassinarPrescricao(e, { hospital: c.hospital, usuarioLegado: usuario }, prescricao, hash),
      );
    },
    gravarRegra: (c, autor, r) => sgh(c, (e) => gravarVersaoRegra(e, c.hospital, autor, r)),
    programarFutura: (c, u, f) => sgh(c, (e) => programarFutura(e, c.hospital, u, f)),
    cancelarFutura: async (c, u, paciente, id, motivo) => {
      await sgh(c, (e) => cancelarFutura(e, c.hospital, u, paciente, id, motivo));
    },
    registrarReconciliacao: (c, u, r) => sgh(c, (e) => registrarReconciliacao(e, c.hospital, u, r)),
    registrarFicha: (c, u, f) => sgh(c, (e) => registrarFichaAntimicrobiano(e, c.hospital, u, f)),
    gravarGrade: (c, a, g) => sgh(c, (e) => gravarGradeClasse(e, c.hospital, a, g)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaPrescricaoIndisponivel(): PortaPrescricao {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  return new Proxy({ destino: 'legado' } as PortaPrescricao, {
    // Os ganchos do Nest (onModuleInit, beforeApplicationShutdown…) e o `then` das promessas não são da porta.
    get: (alvo, chave) =>
      chave === 'destino'
        ? alvo.destino
        : typeof chave === 'string' && !/^(on[A-Z]|before[A-Z]|then$|constructor$|toJSON$)/.test(chave)
          ? recusa
          : undefined,
  });
}
