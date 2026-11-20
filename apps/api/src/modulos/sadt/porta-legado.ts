// Porta do SADT sobre o núcleo do legado (M26): leituras READ ONLY pelos repositórios de @sgh/legado; gravações pelo
// EXECUTOR (receitas sadt.*, com a trilha na mesma transação); as só do novo em transação SGH_ com a SGH_TRILHA junto.
// Em dev sobre a cópia compartilhada, o executor só de leitura recusa as gravações (como nos outros módulos).
// `portaSadtNaTransacao`: a mesma porta sobre UMA transação aberta (os testes de integração na cópia, sempre desfeita).
import {
  acessoDoMedico,
  acessoPorId,
  acessoPorProtocolo,
  amostraPorCodigo,
  amostraPorId,
  amostrasDoDia,
  apoioSadt,
  atosPublicadosNoPortal,
  atendimentoDosExames,
  atendimentoParaLancamento,
  atendimentosPorNumero,
  autocadastrosPortal,
  avisarCriticosDaLiberacao,
  avisosCriticos,
  buscarProfissionaisSadt,
  buscarSolicitantesExternos,
  comunicarAviso,
  conferenciaDoExame,
  criarProtocoloPortal,
  decidirAutocadastro,
  elementosDoCadastro,
  escalonarAviso,
  type Escritor,
  exameSadt,
  examesDoSetor,
  examesSadtPorId,
  type Executor,
  filaDeLiberacao,
  type FonteCatalogo,
  gravarTrilha,
  gravarValorCritico,
  impressaoDosExames,
  indicadoresSadt,
  laudoParaEmitir,
  laudoPortalAberto,
  laudosDoExame,
  laudosPortalDoMedico,
  laudosPortalDoPaciente,
  type Leitor,
  liberacaoVigente,
  liberadosComCriticoDesde,
  listaDeColeta,
  mapaDeTrabalho,
  marcarOrcamentoConvertido,
  type MetricasExecutor,
  mudarEstadoAmostra,
  nascimentoDoPaciente,
  type NucleoLegado,
  operacao,
  orcamentoPorId,
  orcamentos,
  pacienteDoAtendimento,
  parametrosDoSetor,
  registrarAutocadastro,
  registrarColeta,
  registrarLaudoEmitido,
  registrarLeituraResultado,
  registrarOrcamento,
  registrarTentativaPortal,
  relogioRecepcao,
  requisicoesDoDia,
  responsavelDoAtendimento,
  resultadoParaDigitacao,
  validarLaudo,
  valoresCriticos,
  vinculosDoLogin,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoSadt, type GravadorSghSadt, METODOS_PORTA_SADT, type PortaSadt } from './porta.js';

/** O gravador SGH_ sobre o escritor da transação (o estabelecimento do contexto). */
function gravador(e: Escritor, hospital: string): GravadorSghSadt {
  return {
    registrarColeta: (a) => registrarColeta(e, { hospital, ...a }),
    mudarEstadoAmostra: (r) => mudarEstadoAmostra(e, { hospital, ...r }),
    gravarValorCritico: (f) => gravarValorCritico(e, { hospital, ...f }),
    avisarCriticos: (a) => avisarCriticosDaLiberacao(e, { hospital, ...a }),
    comunicarAviso: (r) => comunicarAviso(e, { hospital, ...r }),
    escalonarAviso: (r) => escalonarAviso(e, { hospital, ...r }),
    registrarLeitura: (r) => registrarLeituraResultado(e, { hospital, ...r }),
    registrarOrcamento: (o) => registrarOrcamento(e, { hospital, ...o }),
    marcarOrcamentoConvertido: (r) => marcarOrcamentoConvertido(e, { hospital, ...r }),
    registrarLaudoEmitido: (r) => registrarLaudoEmitido(e, { hospital, ...r }),
    criarProtocoloPortal: (r) => criarProtocoloPortal(e, { hospital, ...r }),
    registrarAutocadastro: (r) => registrarAutocadastro(e, { hospital, ...r }),
    decidirAutocadastro: (r) => decidirAutocadastro(e, { hospital, ...r }),
    registrarTentativaPortal: (r) => registrarTentativaPortal(e, { hospital, ...r }),
  };
}

type Ler = <T>(c: ContextoSadt, fn: (l: Leitor) => Promise<T>) => Promise<T>;

/** As leituras da porta, sobre o leitor dado (a conexão de leitura ou a transação dos testes). */
function leituras(ler: Ler): Omit<PortaSadt, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    relogio: (c) => ler(c, (l) => relogioRecepcao(l)),
    examesDoSetor: (c, f) => ler(c, (l) => examesDoSetor(l, c.hospital, f)),
    exame: (c, id) => ler(c, (l) => exameSadt(l, c.hospital, id)),
    examesPorId: (c, ids) => ler(c, (l) => examesSadtPorId(l, c.hospital, ids)),
    coleta: (c, f) => ler(c, (l) => listaDeColeta(l, c.hospital, f)),
    mapa: (c, f) => ler(c, (l) => mapaDeTrabalho(l, c.hospital, f)),
    digitacao: (c, id) => ler(c, (l) => resultadoParaDigitacao(l, c.hospital, id)),
    conferencia: (c, id) => ler(c, (l) => conferenciaDoExame(l, c.hospital, id)),
    filaLiberacao: (c, f) => ler(c, (l) => filaDeLiberacao(l, c.hospital, f)),
    liberacaoVigente: (c, id) => ler(c, (l) => liberacaoVigente(l, id)),
    liberadosComCritico: (c, o) => ler(c, (l) => liberadosComCriticoDesde(l, c.hospital, o)),
    avisos: (c, o) => ler(c, (l) => avisosCriticos(l, c.hospital, o)),
    valoresCriticos: (c) => ler(c, (l) => valoresCriticos(l, c.hospital)),
    elementos: (c, exame) => ler(c, (l) => elementosDoCadastro(l, exame)),
    amostras: (c, o) => ler(c, (l) => amostrasDoDia(l, c.hospital, o)),
    amostraPorCodigo: (c, codigo) => ler(c, (l) => amostraPorCodigo(l, c.hospital, codigo)),
    amostraPorId: (c, id) => ler(c, (l) => amostraPorId(l, c.hospital, id)),
    atendimentoDosExames: (c, ids) => ler(c, (l) => atendimentoDosExames(l, ids)),
    laudosDoExame: (c, id) => ler(c, (l) => laudosDoExame(l, c.hospital, id)),
    impressaoDosExames: (c, ids) => ler(c, (l) => impressaoDosExames(l, ids, c.hospital)),
    validarLaudo: (c, codigo) => ler(c, (l) => validarLaudo(l, c.hospital, codigo)),
    laudoParaEmitir: (c, ids) => ler(c, (l) => laudoParaEmitir(l, c.hospital, ids)),
    requisicoes: (c, o) => ler(c, (l) => requisicoesDoDia(l, o)),
    atendimento: (c, a) => ler(c, (l) => atendimentoParaLancamento(l, a)),
    atendimentosPorNumero: (c, reg) => ler(c, (l) => atendimentosPorNumero(l, reg)),
    orcamentos: (c, o) => ler(c, (l) => orcamentos(l, c.hospital, o)),
    orcamento: (c, id, o) => ler(c, (l) => orcamentoPorId(l, c.hospital, id, o)),
    apoio: (c, setor) => ler(c, (l) => apoioSadt(l, setor)),
    vinculos: (c, login) => ler(c, (l) => vinculosDoLogin(l, login)),
    responsavelDoAtendimento: (c, a) => ler(c, (l) => responsavelDoAtendimento(l, a)),
    profissionais: (c, termo) => ler(c, (l) => buscarProfissionaisSadt(l, termo)),
    solicitantes: (c, o) => ler(c, (l) => buscarSolicitantesExternos(l, o)),
    parametros: (c, setor, usuario) => ler(c, (l) => parametrosDoSetor(l, setor, usuario)),
    indicadores: (c, o) => ler(c, (l) => indicadoresSadt(l, { ...o, hospital: c.hospital })),
    laudosPortalDoPaciente: (c, o) => ler(c, (l) => laudosPortalDoPaciente(l, o)),
    laudosPortalDoMedico: (c, o) => ler(c, (l) => laudosPortalDoMedico(l, o)),
    laudoPortal: (c, id) => ler(c, (l) => laudoPortalAberto(l, c.hospital, id)),
    pacienteDoAtendimento: (c, reg) => ler(c, (l) => pacienteDoAtendimento(l, reg)),
    nascimentoDoPaciente: (c, p) => ler(c, (l) => nascimentoDoPaciente(l, p)),
    acessoPorProtocolo: (c, r) => ler(c, (l) => acessoPorProtocolo(l, c.hospital, r)),
    acessoDoMedico: (c, m) => ler(c, (l) => acessoDoMedico(l, c.hospital, m)),
    acessoPorId: (c, id) => ler(c, (l) => acessoPorId(l, c.hospital, id)),
    autocadastros: (c, o) => ler(c, (l) => autocadastrosPortal(l, c.hospital, o)),
    atosPublicados: (c) => ler(c, (l) => atosPublicadosNoPortal(l)),
  };
}

export function portaSadtLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaSadt {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoSadt) => ({ rede: c.rede, hospital: c.hospital, traceId: 'sadt' });
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    gravarSgh: (c, trilha, fn) =>
      nucleo.gravarSgh(ctx(c), async (e) => {
        const r = await fn(gravador(e, c.hospital));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      }),
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/**
 * A porta sobre uma transação aberta (testes de integração na cópia, desfeita no fim): o executor grava no mesmo
 * escritor, as leituras enxergam o que a transação gravou e as gravações SGH_ vão na mesma transação.
 */
export function portaSadtNaTransacao(e: Escritor, executor: Executor): PortaSadt {
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx, { escritor: e });
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    async gravarSgh(c, trilha, fn) {
      const r = await fn(gravador(e, c.hospital));
      await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaSadtIndisponivel(): PortaSadt {
  return portaIndisponivel<PortaSadt>(METODOS_PORTA_SADT);
}
