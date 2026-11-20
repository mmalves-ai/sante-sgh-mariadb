// Porta do estoque sobre o núcleo do legado (M28): leituras READ ONLY pelos repositórios de @sgh/legado; gravações pelo
// EXECUTOR (receitas suprimentos.*, com a trilha na mesma transação); as só do novo em transação SGH_ com a SGH_TRILHA
// junto. Em dev sobre a cópia compartilhada, o executor só de leitura recusa as gravações (como nos outros módulos).
// `portaSuprimentosNaTransacao`: a mesma porta sobre UMA transação aberta (os testes de integração na cópia, desfeita).
import {
  abrirInventarioSgh,
  aprovarPedidoSgh,
  buscarItensEstoque,
  cancelarTransferenciaSgh,
  centrosCustoEstoque,
  conferirCarrinhoSgh,
  consumoEstoque,
  consumoMensalPorItem,
  decidirInventarioSgh,
  autorizarRequisicaoSgh,
  definirPontoPedidoSgh,
  documentoEstoque,
  documentosEstoque,
  emPedidoPorItem,
  enviarTransferenciaSgh,
  envioDeTransferencia,
  type Escritor,
  escopoUsuarioEstoque,
  estoqueInicial,
  type Executor,
  fechamentosEstoque,
  fichaItemEstoque,
  fornecedoresEstoque,
  prestadoresEstoque,
  terceirosEstoque,
  type FonteCatalogo,
  gravarTrilha,
  historicoCompras,
  inventarioLido,
  inventariosAbertos,
  itensPorCodigo,
  kitRastreavel,
  kitsPadrao,
  kitsRastreaveis,
  type Leitor,
  locaisEstoque,
  lotesDoLocal,
  lotesDoPaciente,
  mesesFechados,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  parametrosEstoque,
  pedidoCompra,
  pedidosCompra,
  pontosPedidoDefinidos,
  posicaoMensal,
  rastreioLote,
  recalculosEstoque,
  registrarContagemSgh,
  registrarDivergenciaSgh,
  relogioEstoque,
  requisicoesPendentes,
  saldosEstoque,
  transferenciasEnviadas,
  usuariosEstoque,
  documentosDoDiaPorSistema,
  efeitosDosDocumentosDoNovo,
  horariosDispensadosDoDia,
  requisicoesPendentesPorLocal,
  usoEstoquePorLocal,
  itensMovidosPeloNovo,
  leiturasNumericas,
  documentosDoNovoNoDia,
  unidadesAtendidasPorLocal,
  prescricoesDoNovoPorUnidade,
} from '@sgh/legado';
import { DIAS_PRESCRICAO_EM_USO } from '@sgh/contratos';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoSuprimentos,
  type GravadorSghSuprimentos,
  METODOS_PORTA_SUPRIMENTOS,
  type PortaSuprimentos,
} from './porta.js';

/** O gravador SGH_ sobre o escritor da transação (o estabelecimento do contexto). */
function gravador(e: Escritor, hospital: string): GravadorSghSuprimentos {
  return {
    aprovarPedido: (a) => aprovarPedidoSgh(e, { hospital, ...a }),
    enviarTransferencia: (t) => enviarTransferenciaSgh(e, { hospital, ...t }),
    cancelarTransferencia: (r) => cancelarTransferenciaSgh(e, { hospital, ...r }),
    registrarDivergencia: (r) => registrarDivergenciaSgh(e, { hospital, ...r }),
    abrirInventario: (i) => abrirInventarioSgh(e, { hospital, ...i }),
    registrarContagem: (c) => registrarContagemSgh(e, { hospital, ...c }),
    decidirInventario: (d) => decidirInventarioSgh(e, { hospital, ...d }),
    conferirCarrinho: (c) => conferirCarrinhoSgh(e, { hospital, ...c }),
    definirPontoPedido: (p) => definirPontoPedidoSgh(e, { hospital, ...p }),
    autorizarRequisicao: (a) => autorizarRequisicaoSgh(e, { hospital, ...a }),
  };
}

type Ler = <T>(c: ContextoSuprimentos, fn: (l: Leitor) => Promise<T>) => Promise<T>;

/** As leituras da porta, sobre o leitor dado (a conexão de leitura ou a transação dos testes). */
function leituras(ler: Ler): Omit<PortaSuprimentos, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    relogio: (c) => ler(c, (l) => relogioEstoque(l)),
    locais: (c) => ler(c, (l) => locaisEstoque(l)),
    centrosCusto: (c) => ler(c, (l) => centrosCustoEstoque(l)),
    mesesFechados: (c) => ler(c, (l) => mesesFechados(l)),
    buscarItens: (c, termo) => ler(c, (l) => buscarItensEstoque(l, termo)),
    itens: (c, codigos) => ler(c, (l) => itensPorCodigo(l, codigos)),
    saldos: (c, f) => ler(c, (l) => saldosEstoque(l, f)),
    lotesDoLocal: (c, item, local, hoje, alerta) => ler(c, (l) => lotesDoLocal(l, item, local, hoje, alerta)),
    posicaoMensal: (c, item, hoje) => ler(c, (l) => posicaoMensal(l, item, hoje)),
    fichaItem: (c, item) => ler(c, (l) => fichaItemEstoque(l, item)),
    documentos: (c, f) => ler(c, (l) => documentosEstoque(l, f)),
    documento: (c, tipo, chave) => ler(c, (l) => documentoEstoque(l, c.hospital, tipo, chave)),
    requisicoes: (c, o) => ler(c, (l) => requisicoesPendentes(l, { ...o, hospital: c.hospital })),
    rastreio: (c, item, lote) => ler(c, (l) => rastreioLote(l, item, lote)),
    lotesDoPaciente: (c, atendimento) => ler(c, (l) => lotesDoPaciente(l, atendimento)),
    consumo: (c, competencia) => ler(c, (l) => consumoEstoque(l, competencia)),
    consumoMensalPorItem: (c, o) => ler(c, (l) => consumoMensalPorItem(l, o)),
    emPedidoPorItem: (c, desde) => ler(c, (l) => emPedidoPorItem(l, desde)),
    pedidos: (c, o) => ler(c, (l) => pedidosCompra(l, c.hospital, o)),
    pedido: (c, ano, doc) => ler(c, (l) => pedidoCompra(l, c.hospital, ano, doc)),
    historicoCompras: (c, item) => ler(c, (l) => historicoCompras(l, item)),
    fechamentos: (c, corrente) => ler(c, (l) => fechamentosEstoque(l, c.hospital, corrente)),
    recalculos: (c) => ler(c, (l) => recalculosEstoque(l)),
    parametros: (c, login) => ler(c, (l) => parametrosEstoque(l, login)),
    escopo: (c, login) => ler(c, (l) => escopoUsuarioEstoque(l, login)),
    usuarios: (c, termo) => ler(c, (l) => usuariosEstoque(l, termo)),
    fornecedores: (c, termo) => ler(c, (l) => fornecedoresEstoque(l, termo)),
    terceiros: (c, termo) => ler(c, (l) => terceirosEstoque(l, termo)),
    prestadores: (c, termo) => ler(c, (l) => prestadoresEstoque(l, termo)),
    kits: (c, hoje, alerta) => ler(c, (l) => kitsRastreaveis(l, c.hospital, hoje, alerta)),
    kit: (c, id, hoje, alerta) =>
      ler(c, async (l) => {
        try {
          return await kitRastreavel(l, c.hospital, id, hoje, alerta);
        } catch {
          return null;
        }
      }),
    kitsPadrao: (c) => ler(c, (l) => kitsPadrao(l)),
    inventarios: (c) => ler(c, (l) => inventariosAbertos(l, c.hospital)),
    inventario: (c, id, cego) => ler(c, (l) => inventarioLido(l, c.hospital, id, cego)),
    estoqueInicial: (c) => ler(c, (l) => estoqueInicial(l)),
    transferencias: (c, o) => ler(c, (l) => transferenciasEnviadas(l, c.hospital, o)),
    envio: (c, id) => ler(c, (l) => envioDeTransferencia(l, c.hospital, id)),
    pontosPedido: (c, local) => ler(c, (l) => pontosPedidoDefinidos(l, c.hospital, local)),
    onda3: (c, dia, hoje) =>
      ler(c, async (l) => {
        const docs = await documentosDoDiaPorSistema(l, c.hospital, dia);
        const efeitos = await efeitosDosDocumentosDoNovo(l, docs.doNovo);
        const dispensacoes = docs.doNovo.filter((d) => d.tipo === 'dispensacao').map((d) => d.id);
        return {
          documentos: docs.linhas,
          efeitos,
          horarios: await horariosDispensadosDoDia(l, dia, dispensacoes),
          requisicoes: await requisicoesPendentesPorLocal(l, hoje),
          uso: await usoEstoquePorLocal(l, hoje),
          cortada: docs.cortada,
        };
      }),
    onda3Numerica: (c, dia) =>
      ler(c, async (l) => {
        const { itens } = await documentosDoNovoNoDia(l, c.hospital, dia);
        // A dispensação entra pela saída que ela gera (os itens e o local dessa saída).
        const pares = await itensMovidosPeloNovo(l, itens);
        // O saldo do local na competência do dia (a mesma linha que a outra estação abre) e o preço médio de agora.
        return leiturasNumericas(l, { ano: Number(dia.slice(0, 4)), mes: Number(dia.slice(5, 7)) }, pares);
      }),
    onda3LerPares: (c, dia, pares) =>
      ler(c, (l) =>
        leiturasNumericas(l, { ano: Number(dia.slice(0, 4)), mes: Number(dia.slice(5, 7)) }, pares),
      ),
    onda3Regra1: (c, hoje) =>
      ler(c, async (l) => {
        const ano = Number(hoje.slice(0, 4));
        const mes = Number(hoje.slice(5, 7));
        const anterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
        return {
          atendidas: [
            ...(await unidadesAtendidasPorLocal(l, anterior)),
            ...(await unidadesAtendidasPorLocal(l, { ano, mes })),
          ],
          prescricoes: await prescricoesDoNovoPorUnidade(l, c.hospital, hoje, DIAS_PRESCRICAO_EM_USO),
        };
      }),
  };
}

export function portaSuprimentosLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaSuprimentos {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoSuprimentos) => ({ rede: c.rede, hospital: c.hospital, traceId: 'suprimentos' });
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
export function portaSuprimentosNaTransacao(e: Escritor, executor: Executor): PortaSuprimentos {
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
export function portaSuprimentosIndisponivel(): PortaSuprimentos {
  return portaIndisponivel<PortaSuprimentos>(METODOS_PORTA_SUPRIMENTOS);
}
