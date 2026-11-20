// Porta da conta do paciente sobre o núcleo do legado (M30): leituras READ ONLY pelos repositórios de @sgh/legado;
// gravações pelo EXECUTOR (receitas faturamento.*, com a trilha na mesma transação); as só do novo em transação SGH_ com
// a SGH_TRILHA junto. Em dev sobre a cópia compartilhada, o executor só de leitura recusa as gravações (como nos outros
// módulos). `portaFaturamentoNaTransacao`: a mesma porta sobre UMA transação aberta (integração na cópia, desfeita).
import {
  abrirCaixaSgh,
  apoioPendenciasPacotes,
  auditoriaDaConta,
  baseContrato,
  caixasParticular,
  cirurgiasComConta,
  CONECTOR_SIMULADO,
  contaDaPendencia,
  contaDetalhe,
  convenioDaConta,
  convenioDoItem,
  decidirLancamentoTardioSgh,
  editarPacoteSgh,
  editarRegraFaturabilidadeSgh,
  emitirReciboSgh,
  type Escritor,
  type Executor,
  explicarItem,
  fecharCaixaSgh,
  type FonteCatalogo,
  gravarTrilha,
  hojeDoBancoFaturamento,
  itensDaConta,
  itensSigtap,
  type Leitor,
  lancamentosTardios,
  listarContasPaciente,
  listarConvenios,
  type MetricasExecutor,
  notaSala,
  type NucleoLegado,
  operacao,
  orcamentosParticular,
  pacotesVigentes,
  pagamentosParticular,
  painelLancamentos,
  receberParticularSgh,
  recibos,
  registrarEtapaSgh,
  registrarOrcamentoSgh,
  registrarPendenciaSgh,
  registrarVersaoAuditoriaSgh,
  regrasFaturabilidade,
  resolverPendenciaSgh,
  tiposPendencia,
  worklistFaturamento,
} from '@sgh/legado';
import { grupoDoItem, precoDaTabela } from '@sgh/dominio-faturamento';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoFaturamento,
  type GravadorSghFaturamento,
  METODOS_PORTA_FATURAMENTO,
  type PortaFaturamento,
} from './porta.js';

function gravador(e: Escritor, hospital: string): GravadorSghFaturamento {
  return {
    registrarPendencia: (p) => registrarPendenciaSgh(e, { hospital, ...p }),
    resolverPendencia: (r) => resolverPendenciaSgh(e, { hospital, ...r }),
    registrarEtapa: (x) => registrarEtapaSgh(e, { hospital, ...x }),
    decidirLancamentoTardio: (d) => decidirLancamentoTardioSgh(e, { hospital, ...d }),
    editarRegra: (r) => editarRegraFaturabilidadeSgh(e, { hospital, ...r }),
    editarPacote: (p) => editarPacoteSgh(e, { hospital, ...p }),
    registrarVersaoAuditoria: (v) => registrarVersaoAuditoriaSgh(e, { hospital, ...v }),
    registrarOrcamento: (o) => registrarOrcamentoSgh(e, { hospital, ...o }),
    abrirCaixa: (c) => abrirCaixaSgh(e, { hospital, ...c }),
    fecharCaixa: (c) => fecharCaixaSgh(e, { hospital, ...c }),
    receberParticular: ({ simulado, ...r }) =>
      receberParticularSgh(e, { hospital, ...r, conector: simulado ? CONECTOR_SIMULADO : null }),
    emitirRecibo: (r) => emitirReciboSgh(e, { hospital, ...r }),
  };
}

type Ler = <T>(c: ContextoFaturamento, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaFaturamento, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    hoje: (c) => ler(c, (l) => hojeDoBancoFaturamento(l)),
    convenios: (c) =>
      ler(c, async (l) => (await listarConvenios(l)).map((x) => ({ codigo: x.codigo, nome: x.nome }))),
    contas: (c, f, hoje) => ler(c, (l) => listarContasPaciente(l, c.hospital, f, hoje)),
    conta: (c, id, hoje) => ler(c, (l) => contaDetalhe(l, c.hospital, id, hoje)),
    itens: (c, conta, o) => ler(c, (l) => itensDaConta(l, c.hospital, conta, o)),
    explicar: (c, item) => ler(c, (l) => explicarItem(l, c.hospital, item)),
    contaDaPendencia: (c, id) => ler(c, (l) => contaDaPendencia(l, c.hospital, id)),
    convenioDaConta: (c, conta) => ler(c, (l) => convenioDaConta(l, conta)),
    convenioDoItem: (c, item) => ler(c, (l) => convenioDoItem(l, item)),
    sigtap: (c, conta) => ler(c, (l) => itensSigtap(l, conta)),
    painelLancamentos: (c, o) => ler(c, (l) => painelLancamentos(l, c.hospital, o)),
    tardios: (c, o) => ler(c, (l) => lancamentosTardios(l, c.hospital, o)),
    auditoria: (c, conta) => ler(c, (l) => auditoriaDaConta(l, c.hospital, conta)),
    tiposPendencia: (c) => ler(c, (l) => tiposPendencia(l)),
    apoioPacotes: (c) => ler(c, (l) => apoioPendenciasPacotes(l)),
    regras: (c) => ler(c, (l) => regrasFaturabilidade(l, c.hospital)),
    pacotes: (c) => ler(c, (l) => pacotesVigentes(l, c.hospital)),
    notaSala: (c, cirurgia) => ler(c, (l) => notaSala(l, c.hospital, cirurgia)),
    cirurgias: (c, desde) => ler(c, (l) => cirurgiasComConta(l, desde)),
    orcamentos: (c, hoje) => ler(c, (l) => orcamentosParticular(l, c.hospital, hoje)),
    caixas: (c, operador) => ler(c, (l) => caixasParticular(l, c.hospital, operador)),
    pagamentos: (c, f) => ler(c, (l) => pagamentosParticular(l, c.hospital, f)),
    recibos: (c, antigos) => ler(c, (l) => recibos(l, c.hospital, { antigos })),
    worklist: (c, o) => ler(c, (l) => worklistFaturamento(l, c.hospital, o)),
    simular: (c, s) =>
      ler(c, async (l) => {
        const grupo = grupoDoItem(s.tipo)!;
        const b = await baseContrato(l, {
          grupo,
          convenio: s.convenio,
          tipoConta: s.tipoConta,
          data: s.data,
          codigo: s.codigo,
        });
        if (!b) return { encontrado: false, nome: '', preco: null, vigencia: null };
        return {
          encontrado: true,
          nome: b.item.nome,
          preco: precoDaTabela(grupo, b.base, s.quantidade),
          vigencia: b.base.vigencia,
        };
      }),
  };
}

export function portaFaturamentoLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaFaturamento {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoFaturamento) => ({ rede: c.rede, hospital: c.hospital, traceId: 'faturamento' });
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

export function portaFaturamentoNaTransacao(e: Escritor, executor: Executor): PortaFaturamento {
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

export function portaFaturamentoIndisponivel(): PortaFaturamento {
  return portaIndisponivel<PortaFaturamento>(METODOS_PORTA_FATURAMENTO);
}
