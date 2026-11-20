// Porta do pós-fechamento sobre o núcleo do legado (M31): leituras READ ONLY pelos repositórios de @sgh/legado;
// gravações pelo EXECUTOR (receitas faturamento.*, com a trilha na mesma transação); as só do novo em transação SGH_
// com a SGH_TRILHA junto. Em dev sobre a cópia compartilhada, o executor só de leitura recusa as gravações (como nos
// outros módulos). `portaTissNaTransacao`: a mesma porta sobre UMA transação aberta (integração na cópia, desfeita).
import {
  contasBancariasDoEscopo,
  contasDaCompetencia,
  gravacoesDoNovoNoMes,
  lotesDaCompetencia,
  repasseDoMes,
  titulosDoMes,
  usoDoOutroSistemaPorGrupo,
  competencias,
  configuracaoTiss,
  contaDoItemTiss,
  contasProntasLote,
  convenioDaContaTiss,
  convenioDoLote,
  conveniosTiss,
  decidirGlosaSgh,
  demonstrativos,
  editarEndpointTissSgh,
  evidenciaDoItemGlosa,
  type Escritor,
  type Executor,
  type FonteCatalogo,
  gradeGlosa,
  gravarTrilha,
  guiasEmitidas,
  hojeDoBancoTiss,
  importarDemonstrativoSgh,
  itensDemonstrativo,
  itensGlosaDaConta,
  type Leitor,
  listarLotes,
  loteDetalhe,
  type MetricasExecutor,
  motivosGlosa,
  type NucleoLegado,
  operacao,
  painelGlosa,
  prazosEnvio,
  registrarMensagemTissSgh,
  resumoCompetencia,
  situacoesProtocolo,
  xmlDoLoteSgh,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoTiss, type GravadorSghTiss, METODOS_PORTA_TISS, type PortaTiss } from './porta.js';

function gravador(e: Escritor, hospital: string, rede: string): GravadorSghTiss {
  return {
    importarDemonstrativo: (d) => importarDemonstrativoSgh(e, { hospital, ...d }),
    decidirGlosa: (d) => decidirGlosaSgh(e, { hospital, rede, ...d }),
    editarEndpoint: (d) => editarEndpointTissSgh(e, { hospital, ...d }),
    registrarMensagem: (m) => registrarMensagemTissSgh(e, { hospital, ...m }),
  };
}

type Ler = <T>(c: ContextoTiss, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaTiss, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    hoje: (c) => ler(c, (l) => hojeDoBancoTiss(l)),
    convenios: (c) => ler(c, (l) => conveniosTiss(l)),
    contasProntas: (c, f) => ler(c, (l) => contasProntasLote(l, f)),
    guias: (c, f) => ler(c, (l) => guiasEmitidas(l, f)),
    lotes: (c, f) => ler(c, (l) => listarLotes(l, c.hospital, f)),
    lote: (c, id, hoje) => ler(c, (l) => loteDetalhe(l, c.hospital, id, hoje)),
    convenioDoLote: (c, id) => ler(c, (l) => convenioDoLote(l, id)),
    situacoesProtocolo: (c) => ler(c, (l) => situacoesProtocolo(l)),
    prazos: (c, o) => ler(c, (l) => prazosEnvio(l, o)),
    competencias: (c, f) => ler(c, (l) => competencias(l, f)),
    resumoCompetencia: (c, x) => ler(c, (l) => resumoCompetencia(l, x)),
    motivos: (c) => ler(c, (l) => motivosGlosa(l)),
    grade: (c, f) => ler(c, (l) => gradeGlosa(l, f)),
    itensDaConta: (c, conta, prazo) => ler(c, (l) => itensGlosaDaConta(l, c.hospital, conta, prazo)),
    evidenciaDoItem: (c, item) => ler(c, (l) => evidenciaDoItemGlosa(l, c.hospital, item)),
    convenioDaConta: (c, conta) => ler(c, (l) => convenioDaContaTiss(l, conta)),
    contaDoItem: (c, item) => ler(c, (l) => contaDoItemTiss(l, item)),
    demonstrativos: (c, f) => ler(c, (l) => demonstrativos(l, c.hospital, f)),
    demonstrativo: (c, id) => ler(c, (l) => itensDemonstrativo(l, c.hospital, id)),
    configuracao: (c) => ler(c, (l) => configuracaoTiss(l, c.hospital)),
    painel: (c, f) => ler(c, (l) => painelGlosa(l, { ...f, hospital: c.hospital })),
    xmlDoLote: (c, lote) => ler(c, (l) => xmlDoLoteSgh(l, c.hospital, lote)),
    // M42: uma leitura por bloco, na mesma transação READ ONLY (só agregados).
    acompanhamento: (c, f) =>
      ler(c, async (l) => {
        const filtro = { ano: f.ano, mes: f.mes, convenio: f.convenio, convenios: f.convenios };
        const contas = await contasDaCompetencia(l, filtro);
        const lotes = await lotesDaCompetencia(l, filtro);
        const titulos = f.titulos ? await titulosDoMes(l, f.ano, f.mes, f.contasBancarias) : null;
        const repasse = f.repasse ? await repasseDoMes(l, f.ano, f.mes) : null;
        const gravacoes = await gravacoesDoNovoNoMes(l, f.operacoes, f.ano, f.mes);
        const uso = f.uso ? await usoDoOutroSistemaPorGrupo(l, f.uso.grupos, f.uso.desde) : null;
        return { contas, lotes, titulos, repasse, gravacoes, uso };
      }),
    contasBancariasDoEscopo: (c, u) => ler(c, (l) => contasBancariasDoEscopo(l, u)),
  };
}

export function portaTissLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaTiss {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoTiss) => ({ rede: c.rede, hospital: c.hospital, traceId: 'tiss' });
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
        const r = await fn(gravador(e, c.hospital, c.rede));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      }),
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

export function portaTissNaTransacao(e: Escritor, executor: Executor): PortaTiss {
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx, { escritor: e });
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    async gravarSgh(c, trilha, fn) {
      const r = await fn(gravador(e, c.hospital, c.rede));
      await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaTissIndisponivel(): PortaTiss {
  return portaIndisponivel<PortaTiss>(METODOS_PORTA_TISS);
}
