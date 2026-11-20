// Porta da portaria sobre o núcleo do legado (M50, etapa 5): leituras READ ONLY pelos repositórios de @sgh/legado; as
// gravações só do novo (SGH_HOT_*) numa transação SGH_ com a SGH_TRILHA junto (o escritor só das SGH_: nenhuma tabela
// do legado). Em dev sobre a cópia compartilhada, as gravações SGH_ são recusadas (`sghSoLeitura`), como nos outros
// módulos.
import {
  acompanhantesDaPortaria,
  bloqueiosDeVisita,
  bloquearVisitaSgh,
  buscarVisitantes,
  configurarTerminalSgh,
  contarVisitantesVencidos,
  definirRegraVisitaSgh,
  dominiosDaPortaria,
  encerrarAcompanhanteSgh,
  encerrarVisitaSgh,
  eventosDaCatraca,
  type Executor,
  expurgarVisitantesSgh,
  type FonteCatalogo,
  fotoDoVisitante,
  gravarTrilha,
  internadoParaPortaria,
  internadosParaPortaria,
  type Leitor,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  regrasDeVisita,
  registrarAcompanhanteSgh,
  registrarEventoCatracaSgh,
  registrarVisitaSgh,
  registrarVisitanteSgh,
  relogioRecepcao,
  revogarBloqueioSgh,
  somenteSgh,
  terminaisDaPortaria,
  unidadesDaPortaria,
  visitaDaPortaria,
  visitanteDaPortaria,
  visitasAbertas,
  visitasDoPeriodo,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoPortaria, METODOS_PORTA_PORTARIA, type PortaPortaria } from './porta.js';

export function portaPortariaLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaPortaria {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoPortaria) => ({ rede: c.rede, hospital: c.hospital, traceId: 'portaria' });
  const ler = <T>(c: ContextoPortaria, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
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
            'Neste ambiente de desenvolvimento o banco é só de leitura: a portaria não é gravada.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          registrarVisitante: (v) => registrarVisitanteSgh(e, { hospital: h, ...v }),
          expurgarVisitantes: (x) => expurgarVisitantesSgh(e, { hospital: h, ...x }),
          registrarVisita: (v, avaliar) => registrarVisitaSgh(e, { hospital: h, ...v }, avaliar),
          encerrarVisita: (x) => encerrarVisitaSgh(e, { hospital: h, ...x }),
          definirRegra: (r) => definirRegraVisitaSgh(e, { hospital: h, ...r }),
          bloquear: (b) => bloquearVisitaSgh(e, { hospital: h, ...b }),
          revogarBloqueio: (x) => revogarBloqueioSgh(e, { hospital: h, ...x }),
          registrarAcompanhante: (a) => registrarAcompanhanteSgh(e, { hospital: h, ...a }),
          encerrarAcompanhante: (x) => encerrarAcompanhanteSgh(e, { hospital: h, ...x }),
          configurarTerminal: (t) => configurarTerminalSgh(e, { hospital: h, ...t }),
          registrarEventoCatraca: (ev, avaliar) =>
            registrarEventoCatracaSgh(e, { hospital: h, ...ev }, avaliar),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    relogio: async (c) => (await ler(c, (l) => relogioRecepcao(l))).agora,
    dominios: (c) => ler(c, (l) => dominiosDaPortaria(l)),
    unidades: (c) => ler(c, (l) => unidadesDaPortaria(l)),
    internados: (c) => ler(c, (l) => internadosParaPortaria(l, c.hospital)),
    internado: (c, i) => ler(c, (l) => internadoParaPortaria(l, c.hospital, i)),
    regras: (c) => ler(c, (l) => regrasDeVisita(l, c.hospital)),
    bloqueios: (c, i) => ler(c, (l) => bloqueiosDeVisita(l, c.hospital, i ?? null)),
    visitante: (c, id) => ler(c, (l) => visitanteDaPortaria(l, c.hospital, id)),
    buscarVisitantes: (c, b) => ler(c, (l) => buscarVisitantes(l, c.hospital, b)),
    vencidos: (c, hoje) => ler(c, (l) => contarVisitantesVencidos(l, c.hospital, hoje)),
    abertas: (c) => ler(c, (l) => visitasAbertas(l, c.hospital)),
    visita: (c, id) => ler(c, (l) => visitaDaPortaria(l, c.hospital, id)),
    visitasDoPeriodo: (c, f) => ler(c, (l) => visitasDoPeriodo(l, c.hospital, f)),
    acompanhantes: (c, u) => ler(c, (l) => acompanhantesDaPortaria(l, c.hospital, u ?? null)),
    terminais: (c) => ler(c, (l) => terminaisDaPortaria(l, c.hospital)),
    eventos: (c, teto) => ler(c, (l) => eventosDaCatraca(l, c.hospital, teto ?? 50)),
    foto: (c, v) => ler(c, (l) => fotoDoVisitante(l, c.hospital, v)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaPortariaIndisponivel(): PortaPortaria {
  return portaIndisponivel<PortaPortaria>(METODOS_PORTA_PORTARIA);
}
