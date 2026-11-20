// A porta da gestão da qualidade sobre o núcleo do legado (a cópia; M48, etapa 5): leituras numa transação só de
// leitura; gravações só SGH_ (somenteSgh recusa tabela do legado) com a SGH_TRILHA na mesma transação.
import * as L from '@sgh/legado';
import { type Escritor, gravarTrilha, type Leitor, type NucleoLegado, somenteSgh } from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoGestao,
  type GravadorGestao,
  METODOS_PORTA_GESTAO,
  type PortaGestao,
} from './porta-gestao.js';

type Leituras = Omit<PortaGestao, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'>;

function gravador(e: Escritor, h: string): GravadorGestao {
  return {
    publicarDocumento: (x) => L.publicarDocumentoSgh(e, { hospital: h, ...x }),
    retirarDocumento: (x) => L.retirarDocumentoSgh(e, { hospital: h, ...x }),
    registrarCiencia: (x) => L.registrarCienciaSgh(e, { hospital: h, ...x }),
    registrarAnaliseIndicador: (x) => L.registrarAnaliseIndicadorSgh(e, { hospital: h, ...x }),
    registrarAuditoria: (x) => L.registrarAuditoriaSgh(e, { hospital: h, ...x }),
    registrarComissao: (x) => L.registrarComissaoSgh(e, { hospital: h, ...x }),
    registrarReuniaoComissao: (x) => L.registrarReuniaoComissaoSgh(e, { hospital: h, ...x }),
    registrarRisco: (x) => L.registrarRiscoSgh(e, { hospital: h, ...x }),
    registrarNaoConformidade: (x) => L.registrarNaoConformidadeSgh(e, { hospital: h, ...x }),
    registrarManifestacao: (x) => L.registrarManifestacaoSgh(e, { hospital: h, ...x }),
    encaminharManifestacao: (x) => L.encaminharManifestacaoSgh(e, { hospital: h, ...x }),
    responderManifestacao: (x) => L.responderManifestacaoSgh(e, { hospital: h, ...x }),
    gerarEnvioRegulatorio: (x) => L.gerarEnvioRegulatorioSgh(e, { hospital: h, ...x }),
    registrarTransmissaoEnvio: (x) => L.registrarTransmissaoEnvioSgh(e, { hospital: h, ...x }),
    alterarAuditoria: (x) => L.alterarAuditoriaSgh(e, { hospital: h, ...x }),
    cancelarAuditoria: (x) => L.cancelarAuditoriaSgh(e, { hospital: h, ...x }),
    retificarAta: (x) => L.retificarAtaSgh(e, { hospital: h, ...x }),
    assinarAta: (x) => L.assinarAtaSgh(e, { hospital: h, ...x }),
    cancelarReuniao: (x) => L.cancelarReuniaoSgh(e, { hospital: h, ...x }),
    cancelarNaoConformidade: (x) => L.cancelarNaoConformidadeSgh(e, { hospital: h, ...x }),
    corrigirManifestacao: (x) => L.corrigirManifestacaoSgh(e, { hospital: h, ...x }),
    cancelarManifestacao: (x) => L.cancelarManifestacaoSgh(e, { hospital: h, ...x }),
    publicarChecklistRevisao: (x) => L.publicarChecklistRevisaoSgh(e, { hospital: h, ...x }),
    inativarChecklistRevisao: (x) => L.inativarChecklistRevisaoSgh(e, { hospital: h, ...x }),
    sortearRevisao: (x) => L.sortearRevisaoSgh(e, { hospital: h, ...x }),
    cancelarSorteioRevisao: (x) => L.cancelarSorteioRevisaoSgh(e, { hospital: h, ...x }),
    revisarProntuario: (x) => L.revisarProntuarioSgh(e, { hospital: h, ...x }),
    avalRevisao: (x) => L.avalRevisaoSgh(e, { hospital: h, ...x }),
    responderPendenciaRevisao: (x) => L.responderPendenciaRevisaoSgh(e, { hospital: h, ...x }),
    cancelarPendenciaRevisao: (x) => L.cancelarPendenciaRevisaoSgh(e, { hospital: h, ...x }),
  };
}

function leituras(ler: <T>(c: ContextoGestao, fn: (l: Leitor) => Promise<T>) => Promise<T>): Leituras {
  return {
    relogio: async (c) => (await ler(c, (l) => L.relogioRecepcao(l))).agora.slice(0, 19),
    feriados: (c, de, ate) => ler(c, async (l) => [...(await L.feriadosDoPeriodo(l, de, ate))]),
    nomesPacientes: (c, ids) =>
      ler(c, async (l) => {
        const m = ids.length ? await L.pacientesParaAgravo(l, ids) : new Map();
        return new Map([...m].map(([id, p]) => [id, p.nome]));
      }),
    documentos: (c, f) => ler(c, (l) => L.documentosSgh(l, c.hospital, f)),
    documento: (c, id) => ler(c, (l) => L.documentoSgh(l, c.hospital, id)),
    documentosDoCodigo: (c, codigo) => ler(c, (l) => L.documentosDoCodigoSgh(l, c.hospital, codigo)),
    ciencias: (c, docs, usuario) => ler(c, (l) => L.cienciasSgh(l, c.hospital, docs, usuario)),
    cientes: (c, doc) => ler(c, (l) => L.cientesDoDocumentoSgh(l, c.hospital, doc)),
    analises: (c, comp) => ler(c, (l) => L.analisesIndicadorSgh(l, c.hospital, comp)),
    historicoAnalises: (c, ind) => ler(c, (l) => L.historicoAnalisesSgh(l, c.hospital, ind)),
    auditorias: (c, f) => ler(c, (l) => L.auditoriasSgh(l, c.hospital, f)),
    auditoria: (c, id) => ler(c, (l) => L.auditoriaSgh(l, c.hospital, id)),
    naoConformidadesPorOrigem: (c, o, ids) =>
      ler(c, (l) => L.naoConformidadesPorOrigemSgh(l, c.hospital, o, ids)),
    comissoes: (c) => ler(c, (l) => L.comissoesSgh(l, c.hospital)),
    comissao: (c, id) => ler(c, (l) => L.comissaoSgh(l, c.hospital, id)),
    reunioes: (c, id) => ler(c, (l) => L.reunioesComissaoSgh(l, c.hospital, id)),
    riscos: (c, f) => ler(c, (l) => L.riscosSgh(l, c.hospital, f)),
    risco: (c, id) => ler(c, (l) => L.riscoSgh(l, c.hospital, id)),
    naoConformidades: (c, f) => ler(c, (l) => L.naoConformidadesSgh(l, c.hospital, f)),
    naoConformidade: (c, id) => ler(c, (l) => L.naoConformidadeSgh(l, c.hospital, id)),
    manifestacoes: (c, f) => ler(c, (l) => L.manifestacoesSgh(l, c.hospital, f)),
    manifestacao: (c, id) => ler(c, (l) => L.manifestacaoSgh(l, c.hospital, id)),
    pesquisas: (c, de, ate) => ler(c, (l) => L.pesquisasSatisfacaoSgh(l, c.hospital, de, ate)),
    pesquisa: (c, id) => ler(c, (l) => L.pesquisaSatisfacaoSgh(l, c.hospital, id)),
    contagem: (c, agora, usuario) => ler(c, (l) => L.contagemGestaoSgh(l, c.hospital, agora, usuario)),
    envios: (c, desde) => ler(c, (l) => L.enviosRegulatoriosSgh(l, c.hospital, desde)),
    envio: (c, id) => ler(c, (l) => L.envioRegulatorioSgh(l, c.hospital, id)),
    incidentesNotivisa: (c, de, ate) => ler(c, (l) => L.incidentesParaNotivisaSgh(l, c.hospital, de, ate)),
    notificacaoExiste: (c, id) => ler(c, (l) => L.notificacaoExisteSgh(l, c.hospital, id)),
    reuniao: (c, id) => ler(c, (l) => L.reuniaoComissaoSgh(l, c.hospital, id)),
    versoes: (c, tabela, id) => ler(c, (l) => L.versoesQua(l, c.hospital, tabela, id)),
    dependentes: (c, tabela, id) => ler(c, (l) => L.dependentesQualidade(l, c.hospital, tabela, id)),
    notificacoesPorTipo: (c, de, ate) => ler(c, (l) => L.notificacoesPorTipoSgh(l, c.hospital, de, ate)),
    protocolosGerenciados: (c, i, f) =>
      ler(c, async (l) => ({
        versoes: await L.versoesGerenciadas(l, c.hospital),
        protocolos: await L.protocolosDoPeriodo(l, c.hospital, i, f),
      })),
    checklistsRevisao: (c, com) => ler(c, (l) => L.checklistsRevisaoSgh(l, c.hospital, com)),
    checklistRevisao: (c, id) => ler(c, (l) => L.checklistRevisaoSgh(l, c.hospital, id)),
    altasParaRevisao: (c, de, ate) => ler(c, (l) => L.altasParaRevisao(l, de, ate)),
    loginsDosMedicos: (c, rs) => ler(c, (l) => L.loginsDosMedicosRevisao(l, rs)),
    sorteiosRevisao: (c, com) => ler(c, (l) => L.sorteiosRevisaoSgh(l, c.hospital, com)),
    sorteioRevisao: (c, id) => ler(c, (l) => L.sorteioRevisaoSgh(l, c.hospital, id)),
    prontuariosDoSorteio: (c, id) => ler(c, (l) => L.prontuariosDoSorteioSgh(l, c.hospital, id)),
    prontuarioRevisao: (c, id) => ler(c, (l) => L.prontuarioRevisaoSgh(l, c.hospital, id)),
    pendenciasDosProntuarios: (c, ids) => ler(c, (l) => L.pendenciasDosProntuariosSgh(l, c.hospital, ids)),
    pendenciaRevisao: (c, id) => ler(c, (l) => L.pendenciaRevisaoSgh(l, c.hospital, id)),
    pendenciasDoLogin: (c, login) => ler(c, (l) => L.pendenciasDoLoginSgh(l, c.hospital, login)),
    revisoesDaCompetencia: (c, com, comp) =>
      ler(c, (l) => L.revisoesDaCompetenciaSgh(l, c.hospital, com, comp)),
    revisoesDaInternacao: (c, reg) => ler(c, (l) => L.revisoesDaInternacaoSgh(l, c.hospital, reg)),
  };
}

export function portaGestaoLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaGestao {
  const ctx = (c: ContextoGestao) => ({ rede: c.rede, hospital: c.hospital, traceId: 'gestao-qualidade' });
  return {
    destino: 'legado',
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
        const r = await fn(gravador(e, c.hospital));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
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
export function portaGestaoNaTransacao(e: Escritor, hospital: string): PortaGestao {
  const naCopia = (c: ContextoGestao): ContextoGestao => ({ ...c, hospital });
  const base = leituras((_c, fn) => fn(e));
  const l = Object.fromEntries(
    Object.entries(base).map(([k, f]) => [
      k,
      (c: ContextoGestao, ...r: unknown[]) => (f as (...a: unknown[]) => unknown)(naCopia(c), ...r),
    ]),
  ) as Leituras;
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: (_c, op) => Promise.reject(new Error(`Operação ${op} sem receita do executor: só SGH_.`)),
    async gravarSgh(_c, trilha, fn) {
      const s = somenteSgh(e);
      const r = await fn(gravador(s, hospital));
      const linha = typeof trilha === 'function' ? trilha(r) : trilha;
      await gravarTrilha(s, { ...linha, hospital });
      return r;
    },
    ...l,
  };
}

export function portaGestaoIndisponivel(): PortaGestao {
  return portaIndisponivel<PortaGestao>(METODOS_PORTA_GESTAO);
}
