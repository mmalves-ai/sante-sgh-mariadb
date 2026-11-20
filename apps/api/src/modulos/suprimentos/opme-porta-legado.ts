// Porta do OPME (M46, etapa 3) sobre o núcleo do legado: leituras READ ONLY pelos repositórios de @sgh/legado; a
// solicitação e as etapas numa transação SGH_ com a SGH_TRILHA junto (o escritor só das SGH_); o consumo em sala e a
// devolução pelo EXECUTOR (suprimentos.registrarSaida e suprimentos.registrarDevolucao, com o rastreio no registro
// próprio da mesma transação). Em dev sobre a cópia compartilhada, o executor só de leitura e as gravações SGH_
// recusam (`sghSoLeitura`), como nos outros módulos. `portaOpmeNaTransacao`: a mesma porta sobre UMA transação aberta
// (os testes de integração na cópia, desfeita).
import {
  avancarEtapaOpmeSgh,
  classeDoItem,
  consumoOpme,
  consumoOpmePelaChave,
  consumosOpmeDoPeriodo,
  consumosOpmeDosAgendamentos,
  type Escritor,
  etapaOpmePelaChaveSgh,
  type Executor,
  type FonteCatalogo,
  gravarTrilha,
  itemConsignado,
  itensDaContaOpme,
  documentosCompraOpme,
  fornecedoresEstoque,
  itensOpme,
  localComSaldoOpme,
  localDaSaidaOpme,
  type Leitor,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  rastreioReversoOpme,
  solicitacaoOpme,
  solicitacoesOpmeDoPeriodo,
  solicitacoesOpmeDosAgendamentos,
  solicitarOpmeSgh,
  somenteSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type GravadorOpme, METODOS_PORTA_OPME, type PortaOpme } from './opme-porta.js';

function gravador(e: Escritor, hospital: string): GravadorOpme {
  return {
    solicitacao: (id) => solicitacaoOpme(e, hospital, id, { travar: true }),
    etapaPelaChave: (chave) => etapaOpmePelaChaveSgh(e, hospital, chave),
    solicitar: (s) => solicitarOpmeSgh(e, { hospital, ...s }),
    avancar: (x) => avancarEtapaOpmeSgh(e, { hospital, ...x }),
  };
}

type Ler = <T>(c: ContextoPortaM18, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaOpme, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    solicitacoesDosAgendamentos: (c, as) => ler(c, (l) => solicitacoesOpmeDosAgendamentos(l, c.hospital, as)),
    solicitacoesDoPeriodo: (c, de, ate) => ler(c, (l) => solicitacoesOpmeDoPeriodo(l, c.hospital, de, ate)),
    solicitacao: (c, id) => ler(c, (l) => solicitacaoOpme(l, c.hospital, id)),
    consumosDosAgendamentos: (c, as) => ler(c, (l) => consumosOpmeDosAgendamentos(l, c.hospital, as)),
    consumosDoPeriodo: (c, de, ate) => ler(c, (l) => consumosOpmeDoPeriodo(l, c.hospital, de, ate)),
    consumo: (c, id) => ler(c, (l) => consumoOpme(l, c.hospital, id)),
    consumoPelaChave: (c, chave) => ler(c, (l) => consumoOpmePelaChave(l, c.hospital, chave)),
    localDaSaida: (c, saida) => ler(c, (l) => localDaSaidaOpme(l, saida)),
    documentosCompra: (c, d) => ler(c, (l) => documentosCompraOpme(l, d)),
    localComSaldo: (c, locais) => ler(c, (l) => localComSaldoOpme(l, locais)),
    fornecedores: (c, termo) =>
      ler(c, async (l) => {
        const r = await fornecedoresEstoque(l, termo);
        return { itens: r.itens.map((f) => ({ codigo: f.codigo, nome: f.nome })), cortada: r.cortada };
      }),
    itens: (c, f) => ler(c, (l) => itensOpme(l, f)),
    classeDoItem: (c, item) => ler(c, (l) => classeDoItem(l, item)),
    itemConsignado: (c, item) => ler(c, (l) => itemConsignado(l, item)),
    rastreioReverso: (c, f) => ler(c, (l) => rastreioReversoOpme(l, c.hospital, f)),
    itensDaConta: (c, contas, itens) => ler(c, (l) => itensDaContaOpme(l, contas, itens)),
  };
}

export function portaOpmeLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  opcoes: { metricas?: MetricasExecutor; executor?: Executor; sghSoLeitura?: boolean } = {},
): PortaOpme {
  const executor =
    opcoes.executor ??
    nucleo.criarExecutor({ catalogo, ...(opcoes.metricas ? { metricas: opcoes.metricas } : {}) });
  const ctx = (c: ContextoPortaM18) => ({ rede: c.rede, hospital: c.hospital, traceId: 'opme' });
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
export function portaOpmeNaTransacao(e: Escritor, executor: Executor): PortaOpme {
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
export function portaOpmeIndisponivel(): PortaOpme {
  return portaIndisponivel<PortaOpme>(METODOS_PORTA_OPME);
}
