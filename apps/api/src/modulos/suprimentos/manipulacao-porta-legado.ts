// Porta da manipulação (M46, etapa 4) sobre o núcleo do legado: leituras READ ONLY pelos repositórios de @sgh/legado; a
// abertura e a conferência numa transação SGH_ com a SGH_TRILHA junto (o escritor só das SGH_); a baixa do insumo pelo
// EXECUTOR (suprimentos.registrarSaida, com a ordem ligada no registro próprio da mesma transação). Em dev sobre a cópia
// compartilhada, o executor só de leitura e as gravações SGH_ recusam (`sghSoLeitura`), como nos outros módulos.
// `portaManipulacaoNaTransacao`: a mesma porta sobre UMA transação aberta (os testes de integração na cópia, desfeita).
import {
  abrirOrdemManipulacaoSgh,
  avaliacaoDoItemPrescrito,
  capelasManipulacao,
  conferirManipulacaoSgh,
  type Escritor,
  type Executor,
  type FonteCatalogo,
  gravarTrilha,
  itensAManipular,
  type Leitor,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  ordemEmCursoDoItem,
  ordemManipulacao,
  ordemManipulacaoPelaChave,
  ordensManipulacaoDoPeriodo,
  somenteSgh,
  vinculosEspecialidadeDoLogin,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type GravadorManipulacao,
  METODOS_PORTA_MANIPULACAO,
  type PortaManipulacao,
} from './manipulacao-porta.js';

function gravador(e: Escritor, hospital: string): GravadorManipulacao {
  return {
    ordem: (id) => ordemManipulacao(e, hospital, id, { travar: true }),
    ordemPelaChave: (chave) => ordemManipulacaoPelaChave(e, hospital, chave),
    avaliacao: (item) => avaliacaoDoItemPrescrito(e, hospital, item),
    ordemEmCurso: (item) => ordemEmCursoDoItem(e, hospital, item),
    abrir: (o) => abrirOrdemManipulacaoSgh(e, { hospital, ...o }),
    conferir: (c) => conferirManipulacaoSgh(e, { hospital, ...c }),
  };
}

type Ler = <T>(c: ContextoPortaM18, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaManipulacao, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    itensAManipular: (c, desde) => ler(c, (l) => itensAManipular(l, c.hospital, desde)),
    avaliacao: (c, item) => ler(c, (l) => avaliacaoDoItemPrescrito(l, c.hospital, item)),
    ordens: (c, de, ate) => ler(c, (l) => ordensManipulacaoDoPeriodo(l, c.hospital, de, ate)),
    ordem: (c, id) => ler(c, (l) => ordemManipulacao(l, c.hospital, id)),
    capelas: (c) => ler(c, (l) => capelasManipulacao(l)),
    vinculos: (c, login) => ler(c, (l) => vinculosEspecialidadeDoLogin(l, login)),
  };
}

export function portaManipulacaoLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  opcoes: { metricas?: MetricasExecutor; executor?: Executor; sghSoLeitura?: boolean } = {},
): PortaManipulacao {
  const executor =
    opcoes.executor ??
    nucleo.criarExecutor({ catalogo, ...(opcoes.metricas ? { metricas: opcoes.metricas } : {}) });
  const ctx = (c: ContextoPortaM18) => ({ rede: c.rede, hospital: c.hospital, traceId: 'manipulacao' });
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

/** A porta sobre uma transação aberta (testes de integração na cópia, desfeita no fim). */
export function portaManipulacaoNaTransacao(e: Escritor, executor: Executor): PortaManipulacao {
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
    ...leituras((_c, fn) => fn(e as unknown as Leitor)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaManipulacaoIndisponivel(): PortaManipulacao {
  return portaIndisponivel<PortaManipulacao>(METODOS_PORTA_MANIPULACAO);
}
