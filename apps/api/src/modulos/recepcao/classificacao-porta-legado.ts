// Porta da classificação de risco sobre o núcleo do legado (M44, etapa 1): leituras READ ONLY pelos repositórios de
// @sgh/legado; as gravações só do novo (protocolo, classificação, sinais, aviso de estouro) numa transação SGH_ com a
// SGH_TRILHA junto. O formulário de classificação do prontuário (E08) não passa por aqui: vai pelo registro clínico do
// M22 (executor), com a classificação na mesma transação. Em dev sobre a cópia compartilhada, as gravações SGH_ são
// recusadas (`sghSoLeitura`), como nos outros módulos.
import {
  incluirProtocoloSgh,
  protocoloDoPaciente,
  protocolosDoPeriodo,
  protocolosDosAtendimentos,
  publicarGerenciadoSgh,
  registrarEventoProtocoloSgh,
  versoesGerenciadas,
  avisosJaGravados,
  classificacoesDoPaciente,
  classificacoesDoPeriodo,
  classificacoesDosAtendimentos,
  classificacoesE08DoPaciente,
  classificarSgh,
  coresLegado,
  type Executor,
  type FonteCatalogo,
  gravarSinaisDaClassificacao,
  gravarTrilha,
  type Leitor,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  opcoesPrioridadeVistasE08,
  perguntaPrioridadeE08,
  publicarProtocoloSgh,
  registrarAvisoEstouro,
  relogioRecepcao,
  sinaisRecentesDoAtendimento,
  sinaisRecentesDosAtendimentos,
  somenteSgh,
  vinculoParaClassificacao,
  versaoProtocoloComConteudo,
  versoesProtocolo,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoClassificacao,
  METODOS_PORTA_CLASSIFICACAO,
  type PortaClassificacao,
} from './classificacao-porta.js';

const local = (t: string) => new Date(`${t.length === 10 ? `${t}T00:00:00` : t.slice(0, 19)}Z`);

export function portaClassificacaoLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaClassificacao {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoClassificacao) => ({
    rede: c.rede,
    hospital: c.hospital,
    traceId: 'classificacao',
  });
  const ler = <T>(c: ContextoClassificacao, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: a classificação não é gravada.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const r = await fn({
          publicarProtocolo: (p) => publicarProtocoloSgh(e, { hospital: c.hospital, ...p }),
          classificar: (x) => classificarSgh(e, { hospital: c.hospital, ...x }),
          registrarSinais: (x) => gravarSinaisDaClassificacao(e, { hospital: c.hospital, ...x }),
          avisarEstouro: (a) => registrarAvisoEstouro(e, { hospital: c.hospital, ...a }),
          registrarEvento: async (linha) => {
            await gravarTrilha(e, linha);
          },
          publicarGerenciado: (p) => publicarGerenciadoSgh(e, { hospital: c.hospital, ...p }),
          incluirProtocolo: (p) => incluirProtocoloSgh(e, { hospital: c.hospital, ...p }),
          registrarEventoProtocolo: (p) => registrarEventoProtocoloSgh(e, { hospital: c.hospital, ...p }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    relogio: (c) => ler(c, (l) => relogioRecepcao(l)),
    vinculo: (c, login) => ler(c, (l) => vinculoParaClassificacao(l, login)),
    versoes: (c) => ler(c, (l) => versoesProtocolo(l, c.hospital)),
    versao: (c, id) => ler(c, (l) => versaoProtocoloComConteudo(l, c.hospital, id)),
    classificacoes: (c, cabs) => ler(c, (l) => classificacoesDosAtendimentos(l, c.hospital, cabs)),
    classificacoesDoPaciente: (c, p) => ler(c, (l) => classificacoesDoPaciente(l, c.hospital, p)),
    classificacoesDoPeriodo: (c, i, f) =>
      ler(c, (l) => classificacoesDoPeriodo(l, c.hospital, local(i), local(f))),
    sinaisRecentes: (c, cab, desde) =>
      ler(c, (l) => sinaisRecentesDoAtendimento(l, c.hospital, Number(cab), local(desde))),
    sinaisRecentesDosAtendimentos: (c, itens) =>
      ler(c, async (l) => {
        const m = await sinaisRecentesDosAtendimentos(
          l,
          c.hospital,
          itens.map((i) => ({ atendimento: Number(i.cabecalho), desde: local(i.desde) })),
        );
        return new Map([...m].map(([k, v]) => [String(k), v]));
      }),
    historicoProntuario: (c, paciente) =>
      ler(c, async (l) => classificacoesE08DoPaciente(l, paciente, await perguntaPrioridadeE08(l))),
    opcoesPrioridadeVistas: (c) =>
      ler(c, async (l) => {
        const p = await perguntaPrioridadeE08(l);
        return p === null ? [] : opcoesPrioridadeVistasE08(l, p);
      }),
    coresLegado: (c) => ler(c, (l) => coresLegado(l)),
    avisosGravados: (c, chaves) => ler(c, (l) => avisosJaGravados(l, chaves)),
    versoesGerenciadas: (c) => ler(c, (l) => versoesGerenciadas(l, c.hospital)),
    protocolosDosAtendimentos: (c, cabs) => ler(c, (l) => protocolosDosAtendimentos(l, c.hospital, cabs)),
    protocolosDoPeriodo: (c, i, f) => ler(c, (l) => protocolosDoPeriodo(l, c.hospital, i, f)),
    protocoloDoPaciente: (c, id) => ler(c, (l) => protocoloDoPaciente(l, c.hospital, id)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaClassificacaoIndisponivel(): PortaClassificacao {
  return portaIndisponivel<PortaClassificacao>(METODOS_PORTA_CLASSIFICACAO);
}
