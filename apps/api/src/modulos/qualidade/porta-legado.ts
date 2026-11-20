// Porta da notificação de incidentes (M48, etapa 1) sobre o núcleo do legado: leituras READ ONLY pelos repositórios de
// @sgh/legado (o contexto do atendimento pela PK, as unidades, os feriados, a conta do gestor, o relógio) e as
// gravações só do novo (SGH_QUA_*) numa transação SGH_ com a SGH_TRILHA junto (o escritor só das SGH_: nenhuma tabela
// do legado). Em dev sobre a cópia compartilhada, as gravações SGH_ são recusadas (`sghSoLeitura`), como nos outros
// módulos; a integração da etapa grava na cópia livre com ROLLBACK.
import {
  abrirQueixaTecnicaSgh,
  acoesAbertasDoResponsavelSgh,
  acoesDaNotificacaoSgh,
  alterarAcaoSgh,
  analiseDaNotificacaoSgh,
  andamentoQueixaTecnicaSgh,
  buscarItensEstoque,
  candidatosASugestaoSgh,
  contagemAcoesSgh,
  contagemAdesaoSgh,
  contagemAnalisesSgh,
  contagemNotificacoesSgh,
  eficaciaAcaoSgh,
  eventosDaQueixaSgh,
  historicoRiscosAssistenciais,
  incluirAcaoSgh,
  itensPorCodigo,
  protocolosDoPeriodo,
  queixasTecnicasSgh,
  queixaTecnicaSgh,
  rastreioReversoOpme,
  registrarAnaliseSgh,
  resolverSugestaoSgh,
  situacaoAcaoSgh,
  sugestoesResolvidasSgh,
  travarAcaoSgh,
  travarAnaliseSgh,
  travarQueixaTecnicaSgh,
  versoesGerenciadas,
  contextoDaNotificacao,
  descartarNotificacaoSgh,
  devolverAoNotificadorSgh,
  buscarUsuariosGestao,
  distribuirNotificacaoSgh,
  eventosDaNotificacaoSgh,
  feriadosDoPeriodo,
  gravarTrilha,
  type Escritor,
  type Leitor,
  lerContaAlvo,
  marcarNotivisaExportadaSgh,
  notificacaoPorProtocoloSgh,
  notificacaoSgh,
  notificacoesComPrazoSgh,
  notificacoesSgh,
  notificarIncidenteSgh,
  type NucleoLegado,
  registrarTranscricaoNotivisaSgh,
  relogioRecepcao,
  somenteSgh,
  travarNotificacaoSgh,
  triarNotificacaoSgh,
  unidadesParaNotificacao,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoQualidade,
  type GravadorQualidade,
  METODOS_PORTA_QUALIDADE,
  type PortaQualidade,
} from './porta.js';

type Leituras = Omit<PortaQualidade, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'>;

/**
 * As gravações SGH_ da notificação sobre o escritor já restrito às SGH_ (somenteSgh). `efeito.nenhum` fica verdadeiro
 * quando o reenvio pela chave do pedido achou a notificação já gravada: nada novo, então nenhuma linha de trilha (a
 * porta em memória faz o mesmo; a trilha não conta duas notificações onde há uma).
 */
function gravador(e: Escritor, h: string, efeito: { nenhum: boolean }): GravadorQualidade {
  return {
    notificar: async (x) => {
      const r = await notificarIncidenteSgh(e, { hospital: h, ...x });
      if (r.repetida) efeito.nenhum = true;
      return r;
    },
    travar: (id) => travarNotificacaoSgh(e, h, id),
    triar: (x) => triarNotificacaoSgh(e, { hospital: h, ...x }),
    descartar: (x) => descartarNotificacaoSgh(e, { hospital: h, ...x }),
    distribuir: (x) => distribuirNotificacaoSgh(e, { hospital: h, ...x }),
    devolver: (x) => devolverAoNotificadorSgh(e, { hospital: h, ...x }),
    notivisaExportada: (x) => marcarNotivisaExportadaSgh(e, { hospital: h, ...x }),
    transcricao: (x) => registrarTranscricaoNotivisaSgh(e, { hospital: h, ...x }),
    travarAnalise: (n) => travarAnaliseSgh(e, h, n),
    acoesNaTransacao: (n) => acoesDaNotificacaoSgh(e, h, n),
    registrarAnalise: (x) => registrarAnaliseSgh(e, { hospital: h, ...x }),
    travarAcao: (n, id) => travarAcaoSgh(e, h, n, id),
    incluirAcao: (x) => incluirAcaoSgh(e, { hospital: h, ...x }),
    alterarAcao: (x) => alterarAcaoSgh(e, { hospital: h, ...x }),
    situacaoAcao: (x) => situacaoAcaoSgh(e, { hospital: h, ...x }),
    eficaciaAcao: (x) => eficaciaAcaoSgh(e, { hospital: h, ...x }),
    resolverSugestao: (x) => resolverSugestaoSgh(e, { hospital: h, ...x }),
    abrirQueixa: (x) => abrirQueixaTecnicaSgh(e, { hospital: h, ...x }),
    travarQueixa: (id) => travarQueixaTecnicaSgh(e, h, id),
    andamentoQueixa: (x) => andamentoQueixaTecnicaSgh(e, { hospital: h, ...x }),
  };
}

/** Os expostos ao lote pelo rastreio reverso do M28/M46 (as saídas do lote; sem saída, os consumos em sala). */
async function expostosDoLote(l: Leitor, hospital: string, item: number, lote: string) {
  const r = await rastreioReversoOpme(l, hospital, { item, lote, serie: null });
  const expostos =
    r.saidasEstoque.length > 0
      ? r.saidasEstoque.map((x) => ({
          origem: x.origem,
          data: x.data,
          atendimento: x.atendimento,
          paciente: x.paciente,
          quantidade: x.quantidade,
        }))
      : r.expostos.map((x) => ({
          origem: 'consumo-em-sala' as const,
          data: x.dataHora.slice(0, 10),
          atendimento: x.atendimento,
          paciente: x.paciente,
          quantidade: x.quantidade,
        }));
  return { itemNome: r.itemNome, expostos, cortada: r.cortada };
}

/** As leituras (READ ONLY no legado; as SGH_ pelo estabelecimento da sessão). */
function leituras(ler: <T>(c: ContextoQualidade, fn: (l: Leitor) => Promise<T>) => Promise<T>): Leituras {
  return {
    relogio: async (c) => (await ler(c, (l) => relogioRecepcao(l))).agora.slice(0, 19),
    contexto: (c, atendimento) => ler(c, (l) => contextoDaNotificacao(l, atendimento)),
    unidades: (c) => ler(c, (l) => unidadesParaNotificacao(l)),
    feriados: (c, de, ate) => ler(c, async (l) => [...(await feriadosDoPeriodo(l, de, ate))]),
    usuarioAtivo: (c, login) =>
      ler(c, async (l) => {
        const u = await lerContaAlvo(l, login.trim().toUpperCase());
        return u !== null && u.ativo && !u.bloqueado;
      }),
    gestores: (c, termo) =>
      ler(c, async (l) =>
        (await buscarUsuariosGestao(l, termo))
          .filter((u) => u.ativo && !u.bloqueado)
          .slice(0, 20)
          .map((u) => ({ login: u.login, nome: u.nome })),
      ),
    notificacao: (c, id) => ler(c, (l) => notificacaoSgh(l, c.hospital, id)),
    porProtocolo: (c, p) => ler(c, (l) => notificacaoPorProtocoloSgh(l, c.hospital, p)),
    eventos: (c, id) => ler(c, (l) => eventosDaNotificacaoSgh(l, c.hospital, id)),
    lista: (c, f) => ler(c, (l) => notificacoesSgh(l, c.hospital, f)),
    comPrazo: (c) => ler(c, (l) => notificacoesComPrazoSgh(l, c.hospital)),
    analise: (c, n) => ler(c, (l) => analiseDaNotificacaoSgh(l, c.hospital, n)),
    acoes: (c, n) => ler(c, (l) => acoesDaNotificacaoSgh(l, c.hospital, n)),
    acoesDoResponsavel: (c, login) => ler(c, (l) => acoesAbertasDoResponsavelSgh(l, c.hospital, login)),
    queixas: (c, f) => ler(c, (l) => queixasTecnicasSgh(l, c.hospital, f)),
    queixa: (c, id) => ler(c, (l) => queixaTecnicaSgh(l, c.hospital, id)),
    eventosQueixa: (c, id) => ler(c, (l) => eventosDaQueixaSgh(l, c.hospital, id)),
    resolvidas: (c, rs) => ler(c, (l) => sugestoesResolvidasSgh(l, c.hospital, rs)),
    candidatos: (c, login, desde) => ler(c, (l) => candidatosASugestaoSgh(l, c.hospital, login, desde)),
    painelNotificacoes: (c, de, fim) => ler(c, (l) => contagemNotificacoesSgh(l, c.hospital, de, fim)),
    painelAnalises: (c, de, fim, hoje) => ler(c, (l) => contagemAnalisesSgh(l, c.hospital, de, fim, hoje)),
    painelAcoes: (c, hoje) => ler(c, (l) => contagemAcoesSgh(l, c.hospital, hoje)),
    painelAdesao: (c, de, fim, agora) => ler(c, (l) => contagemAdesaoSgh(l, c.hospital, de, fim, agora)),
    historicoRiscos: (c) => ler(c, (l) => historicoRiscosAssistenciais(l)),
    protocolosGerenciados: (c, i, f) =>
      ler(c, async (l) => ({
        versoes: await versoesGerenciadas(l, c.hospital),
        protocolos: await protocolosDoPeriodo(l, c.hospital, i, f),
      })),
    expostos: (c, item, lote) => ler(c, (l) => expostosDoLote(l, c.hospital, item, lote)),
    itens: (c, termo) =>
      ler(c, async (l) =>
        (await buscarItensEstoque(l, termo)).map((i) => ({ codigo: i.codigo, nome: i.nome })),
      ),
    nomesDosItens: (c, cs) =>
      ler(c, async (l) => new Map([...(await itensPorCodigo(l, cs))].map(([k, v]) => [k, v.nome]))),
  };
}

export function portaQualidadeLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaQualidade {
  const ctx = (c: ContextoQualidade) => ({ rede: c.rede, hospital: c.hospital, traceId: 'qualidade' });
  return {
    destino: 'legado',
    // Operações só do novo: nenhuma receita do executor (a liberação é a da funcionalidade, pela chave).
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: (_c, op) => Promise.reject(new Error(`Operação ${op} sem receita do executor: só SGH_.`)),
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: nada é gravado.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const efeito = { nenhum: false };
        const r = await fn(gravador(e, c.hospital, efeito));
        if (!efeito.nenhum) await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/**
 * A mesma porta sobre UMA transação já aberta (a integração na cópia, desfeita no fim): leituras e gravações SGH_ na
 * mesma transação, com a trilha junto; `hospital` troca o estabelecimento da sessão sintética pelo da cópia.
 */
export function portaQualidadeNaTransacao(e: Escritor, hospital: string): PortaQualidade {
  const naCopia = (c: ContextoQualidade): ContextoQualidade => ({ ...c, hospital });
  const base = leituras((_c, fn) => fn(e));
  const l = Object.fromEntries(
    Object.entries(base).map(([k, f]) => [
      k,
      (c: ContextoQualidade, ...r: unknown[]) => (f as (...a: unknown[]) => unknown)(naCopia(c), ...r),
    ]),
  ) as Leituras;
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: (_c, op) => Promise.reject(new Error(`Operação ${op} sem receita do executor: só SGH_.`)),
    async gravarSgh(_c, trilha, fn) {
      const s = somenteSgh(e);
      const efeito = { nenhum: false };
      const r = await fn(gravador(s, hospital, efeito));
      if (efeito.nenhum) return r;
      const linha = typeof trilha === 'function' ? trilha(r) : trilha;
      await gravarTrilha(s, { ...linha, hospital });
      return r;
    },
    ...l,
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaQualidadeIndisponivel(): PortaQualidade {
  return portaIndisponivel<PortaQualidade>(METODOS_PORTA_QUALIDADE);
}
