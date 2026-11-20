// Porta do balanço hídrico sobre o núcleo do legado (M45, etapa 3): leituras READ ONLY pelos repositórios de
// @sgh/legado; as gravações só do novo (SGH_PEP_BALANCO e SGH_PEP_BALANCO_FECH) numa transação SGH_ com a SGH_TRILHA
// junto (o escritor só das SGH_: nenhuma tabela do legado). Em dev sobre a cópia compartilhada, as gravações SGH_ são
// recusadas (`sghSoLeitura`), como nos outros módulos.
import {
  checagensParaBalanco,
  dominiosDoBalanco,
  entradaDoAtendimento,
  estornarBalancoSgh,
  type Executor,
  fechamentosDoBalanco,
  fecharBalancoSgh,
  type FonteCatalogo,
  gravarTrilha,
  internadoDoAtendimento,
  lancamentoDoBalanco,
  lancamentosDoBalanco,
  lancarBalancoSgh,
  type Leitor,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  origensJaLancadas,
  relogioRecepcao,
  sinaisParaBalanco,
  somenteSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoBalanco, METODOS_PORTA_BALANCO, type PortaBalanco } from './balanco-porta.js';

export function portaBalancoLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaBalanco {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoBalanco) => ({ rede: c.rede, hospital: c.hospital, traceId: 'balanco' });
  const ler = <T>(c: ContextoBalanco, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
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
            'Neste ambiente de desenvolvimento o banco é só de leitura: o balanço não é gravado.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          lancar: (l) => lancarBalancoSgh(e, { hospital: h, ...l }),
          estornar: (x) => estornarBalancoSgh(e, { hospital: h, ...x }),
          fechar: (f) => fecharBalancoSgh(e, { hospital: h, ...f }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    relogio: async (c) => (await ler(c, (l) => relogioRecepcao(l))).agora,
    internado: (c, a) => ler(c, (l) => internadoDoAtendimento(l, a)),
    entrada: (c, a) => ler(c, (l) => entradaDoAtendimento(l, a)),
    dominios: (c) => ler(c, (l) => dominiosDoBalanco(l)),
    checagens: (c, o) => ler(c, (l) => checagensParaBalanco(l, { hospital: c.hospital, ...o })),
    lancamentos: (c, o) => ler(c, (l) => lancamentosDoBalanco(l, { hospital: c.hospital, ...o })),
    lancamento: (c, id) => ler(c, (l) => lancamentoDoBalanco(l, c.hospital, id)),
    origensLancadas: (c, o) => ler(c, (l) => origensJaLancadas(l, { hospital: c.hospital, ...o })),
    fechamentos: (c, a) => ler(c, (l) => fechamentosDoBalanco(l, c.hospital, a)),
    sinais: (c, o) => ler(c, (l) => sinaisParaBalanco(l, { hospital: c.hospital, ...o })),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaBalancoIndisponivel(): PortaBalanco {
  return portaIndisponivel<PortaBalanco>(METODOS_PORTA_BALANCO);
}
