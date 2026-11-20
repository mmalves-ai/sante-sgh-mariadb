// Porta do prontuário de uso diário sobre o núcleo do legado (M23): leituras em transação curta READ ONLY, as
// gravações no banco do estabelecimento pelo EXECUTOR do M04 (as receitas do M23) e as só do novo pela transação
// SGH_ do núcleo (com a SGH_TRILHA na mesma transação). Em dev sobre a cópia compartilhada, o executor só de leitura
// recusa as gravações com o motivo (como o cadastro do M11); as gravações SGH_ também ficam recusadas ali.
import {
  agoraDoBanco,
  aceitarParecer,
  alergiasDoPaciente,
  anexosDoPaciente,
  arquivoDoAnexo,
  assinarDocumentos,
  atendimentosPep,
  cicloVigiaParecer,
  coassinarNoNovo,
  coassinaturasPendentes,
  completudeDoPainel,
  episodioDoAtendimento,
  cabecalhoDocumento,
  cancelarParecer,
  catalogoAlergias,
  catalogoExames,
  cienciasDoPaciente,
  documentoDaTrilha,
  documentoDoRegistroClinico,
  documentosDoPaciente,
  documentoSghPorId,
  documentoSghPorOrigem,
  documentosSghDoPaciente,
  emitirTcle,
  especialidades,
  especialidadesDoCbo,
  eventosDoPaciente,
  examesExternosDoPaciente,
  examesPorId,
  type Executor,
  fichasDeImpressao,
  filaDoParecer,
  fluxoPorId,
  type FonteCatalogo,
  gravarProblema,
  historicoPareceres,
  kitsDeExames,
  lerAtestado,
  lerExameExterno,
  lerReceita,
  type Leitor,
  type MetricasExecutor,
  modelosDeDocumentoEmUso,
  mudarSituacaoTcle,
  nomesDosPacientes,
  type NucleoLegado,
  obitoDoPaciente,
  ocupacoesDoProfissional,
  operacao,
  pacientePep,
  painelPacientes,
  pedidosDoPaciente,
  pendenciasDeAssinatura,
  preferenciasPainelLegado,
  problemasDoPaciente,
  profissionalDoUsuario,
  registrarCiencia,
  registrarEventoDoDocumento,
  registrarObito,
  registrarTransferencia,
  registrosParaAlergia,
  registrosSemAssinatura,
  resultadosDoPaciente,
  retratosAtuais,
  salvarRascunhoSumario,
  supervisaoPorId,
  sumariosDoAtendimento,
  tcleDoAtendimento,
  tclesDoPaciente,
  temposDoPaciente,
  tiposDeAnexo,
  tiposDeTermo,
  transferenciasDoAtendimento,
  unidadesDoPainel,
  USUARIO_VIGIA,
  versaoDasAlergiasAtivas,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoDocs, PortaDocumentos } from './documentos-porta.js';

const p2 = (n: number) => String(n).padStart(2, '0');
function localIso(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

export function portaDocumentosLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
  opcoes: { readonly sghSoLeitura?: boolean } = {},
): PortaDocumentos {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ler = <T>(c: ContextoDocs, fn: (l: Leitor) => Promise<T>) =>
    nucleo.lerSomente({ rede: c.rede, hospital: c.hospital, traceId: 'pep-documentos' }, fn);
  const sgh = <T>(
    c: { rede: string; hospital: string; traceId: string },
    fn: Parameters<NucleoLegado['gravarSgh']>[1],
  ) => {
    if (opcoes.sghSoLeitura)
      return Promise.reject(
        new ErroProblema(
          'operacao-bloqueada',
          403,
          'Gravação desligada nesta sessão de desenvolvimento',
          'Em desenvolvimento sobre a cópia compartilhada, o prontuário é só consulta: a gravação real roda em homologação ou treino, com o login real.',
        ),
      ) as Promise<T>;
    return nucleo.gravarSgh(c, fn) as Promise<T>;
  };
  return {
    destino: 'legado',
    agora: (c) => ler(c, async (l) => localIso(await agoraDoBanco(l))),
    profissional: (c, login) =>
      ler(c, async (l) => {
        const p = await profissionalDoUsuario(l, login);
        return p ? { ...p, ocupacoes: await ocupacoesDoProfissional(l, p.cbos) } : null;
      }),
    ocupacaoDoCbo: (c, cbo) =>
      ler(c, async (l) => (await ocupacoesDoProfissional(l, [cbo]))[0]?.codigo ?? null),
    painel: (c, f) => ler(c, (l) => painelPacientes(l, f)),
    episodio: (c, atendimento) => ler(c, (l) => episodioDoAtendimento(l, atendimento)),
    completudePainel: (c, pacientes, atendimentos, desde) =>
      ler(c, (l) => completudeDoPainel(l, c.hospital, pacientes, atendimentos, desde)),
    unidades: (c) => ler(c, (l) => unidadesDoPainel(l)),
    preferenciasLegado: (c, login) => ler(c, (l) => preferenciasPainelLegado(l, login)),
    paciente: (c, id) => ler(c, (l) => pacientePep(l, id)),
    nomes: (c, ids) => ler(c, (l) => nomesDosPacientes(l, ids)),
    atendimentos: (c, paciente) => ler(c, (l) => atendimentosPep(l, paciente)),
    retratos: (c, atendimento, paciente) => ler(c, (l) => retratosAtuais(l, atendimento, paciente)),
    eventos: (c, paciente, periodo, tipos, limite) =>
      ler(c, (l) => eventosDoPaciente(l, paciente, periodo, tipos, limite)),
    lerReceita: (c, id) => ler(c, (l) => lerReceita(l, id)),
    lerAtestado: (c, id) => ler(c, (l) => lerAtestado(l, id)),
    lerExameExterno: (c, id) => ler(c, (l) => lerExameExterno(l, id)),
    documentoDaTrilha: (c, tipoAto, origem) => ler(c, (l) => documentoDaTrilha(l, tipoAto, origem)),
    documentos: (c, paciente, familia) => ler(c, (l) => documentosDoPaciente(l, paciente, familia)),
    fichas: (c) => ler(c, (l) => fichasDeImpressao(l)),
    modelosEmUso: (c, desde) => ler(c, (l) => modelosDeDocumentoEmUso(l, desde)),
    cabecalhoDocumento: (c, retratos, cbo, situacao, tipoAto) =>
      ler(c, (l) => cabecalhoDocumento(l, retratos, cbo, situacao, tipoAto)),
    alergias: (c, paciente) => ler(c, (l) => alergiasDoPaciente(l, paciente)),
    catalogoAlergias: (c) => ler(c, (l) => catalogoAlergias(l)),
    registrosParaAlergia: (c, atendimento, cbos) =>
      ler(c, (l) => registrosParaAlergia(l, c.hospital, atendimento, cbos)),
    versaoAlergias: (c, paciente) => ler(c, (l) => versaoDasAlergiasAtivas(l, paciente)),
    catalogoExames: (c, termo) => ler(c, (l) => catalogoExames(l, termo)),
    examesPorId: (c, ids) => ler(c, (l) => examesPorId(l, ids)),
    kits: (c) => ler(c, (l) => kitsDeExames(l)),
    pedidos: (c, paciente) => ler(c, (l) => pedidosDoPaciente(l, paciente)),
    resultados: (c, paciente) => ler(c, (l) => resultadosDoPaciente(l, paciente)),
    examesExternos: (c, paciente) => ler(c, (l) => examesExternosDoPaciente(l, paciente)),
    anexos: (c, paciente) => ler(c, (l) => anexosDoPaciente(l, paciente)),
    arquivoAnexo: (c, id) => ler(c, (l) => arquivoDoAnexo(l, id)),
    tiposTermo: (c) => ler(c, (l) => tiposDeTermo(l)),
    tiposAnexo: (c) => ler(c, (l) => tiposDeAnexo(l)),
    tcleHerdado: (c, atendimento) => ler(c, (l) => tcleDoAtendimento(l, atendimento)),
    tempos: (c, paciente) => ler(c, (l) => temposDoPaciente(l, paciente)),
    historicoPareceres: (c, paciente) => ler(c, (l) => historicoPareceres(l, paciente)),
    especialidades: (c) => ler(c, (l) => especialidades(l)),
    especialidadesDoCbo: (c, cbos) => ler(c, (l) => especialidadesDoCbo(l, cbos)),
    documentosSgh: (c, paciente) => ler(c, (l) => documentosSghDoPaciente(l, c.hospital, paciente)),
    documentoSgh: (c, id) => ler(c, (l) => documentoSghPorId(l, c.hospital, id)),
    documentoSghDaOrigem: (c, tabela, id) => ler(c, (l) => documentoSghPorOrigem(l, c.hospital, tabela, id)),
    pendencias: (c, login) => ler(c, (l) => pendenciasDeAssinatura(l, c.hospital, login)),
    coassinaturas: (c, preceptor) => ler(c, (l) => coassinaturasPendentes(l, c.hospital, preceptor)),
    supervisao: (c, id) => ler(c, (l) => supervisaoPorId(l, c.hospital, id)),
    coassinarNoNovo: (c, x) => sgh(c, (e) => coassinarNoNovo(e, c, x)),
    registrosSemAssinatura: (c, login) => ler(c, (l) => registrosSemAssinatura(l, c.hospital, login)),
    problemas: (c, paciente) => ler(c, (l) => problemasDoPaciente(l, c.hospital, paciente)),
    tcles: (c, paciente) => ler(c, (l) => tclesDoPaciente(l, c.hospital, paciente)),
    sumarios: (c, atendimento) => ler(c, (l) => sumariosDoAtendimento(l, c.hospital, atendimento)),
    transferencias: (c, atendimento) =>
      ler(c, (l) => transferenciasDoAtendimento(l, c.hospital, atendimento)),
    obito: (c, paciente) => ler(c, (l) => obitoDoPaciente(l, c.hospital, paciente)),
    ciencias: (c, paciente) => ler(c, (l) => cienciasDoPaciente(l, c.hospital, paciente)),
    fila: (c, f) => ler(c, (l) => filaDoParecer(l, c.hospital, f)),
    fluxo: (c, id) => ler(c, (l) => fluxoPorId(l, c.hospital, id)),
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, ctx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, ctx);
      return { ...r.resultado, trilha: r.trilha };
    },
    gravarProblema: (c, p) => sgh(c, (e) => gravarProblema(e, c, p)),
    registrarCiencia: (c, x) => sgh(c, (e) => registrarCiencia(e, c, x)),
    aceitarParecer: (c, id) => sgh(c, (e) => aceitarParecer(e, c, id)),
    cancelarParecer: (c, id, motivo) => sgh(c, (e) => cancelarParecer(e, c, id, motivo)),
    emitirTcle: (c, t) => sgh(c, (e) => emitirTcle(e, c, t)),
    mudarSituacaoTcle: (c, m) => sgh(c, (e) => mudarSituacaoTcle(e, c, m)),
    salvarRascunhoSumario: (c, s) => sgh(c, (e) => salvarRascunhoSumario(e, c, s)),
    registrarTransferencia: (c, t) => sgh(c, (e) => registrarTransferencia(e, c, t)),
    registrarObito: (c, o) => sgh(c, (e) => registrarObito(e, c, o)),
    assinar: (c, itens, como) => sgh(c, (e) => assinarDocumentos(e, c, itens, como === true)),
    documentoDoRegistroClinico: (c, r) => sgh(c, (e) => documentoDoRegistroClinico(e, c, r)),
    registrarEventoDocumento: (c, ev) => sgh(c, (e) => registrarEventoDoDocumento(e, c, ev)),
    async trazerPedidosDoLegado(c) {
      const ctx = { ...c, traceId: 'vigia-parecer', usuarioLegado: USUARIO_VIGIA };
      const r = await cicloVigiaParecer(
        (fn) => ler(c, fn),
        (fn) => sgh(ctx, fn),
        ctx,
      );
      return r.incluidos;
    },
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaDocumentosIndisponivel(): PortaDocumentos {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  return new Proxy({ destino: 'legado' } as PortaDocumentos, {
    get(alvo, chave) {
      if (chave === 'destino') return alvo.destino;
      // Ganchos do ciclo de vida do Nest (onModuleInit…), `then` e símbolos: não são da porta.
      if (
        typeof chave !== 'string' ||
        chave === 'then' ||
        /^(on[A-Z]|before[A-Z]|toJSON$|constructor$)/.test(chave)
      )
        return undefined;
      return recusa;
    },
  });
}
