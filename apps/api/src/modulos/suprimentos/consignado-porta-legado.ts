// Porta do consignado (M46, etapa 4) sobre o núcleo do legado: leituras READ ONLY pelos repositórios de @sgh/legado; os
// movimentos numa transação SGH_ com a SGH_TRILHA junto (o escritor só das SGH_). Em dev sobre a cópia compartilhada as
// gravações recusam (`sghSoLeitura`), como nos outros módulos. `portaConsignadoNaTransacao`: a mesma porta sobre UMA
// transação aberta (os testes de integração na cópia, desfeita).
import {
  buscarItensEstoque,
  classeDoItem,
  consumosConsignados,
  type Escritor,
  fornecedorExiste,
  gravarMovimentosConsignadoSgh,
  gravarTrilha,
  itemConsignado,
  type Leitor,
  movimentosConsignado,
  movimentosConsignadoPelaChave,
  nomesConsignado,
  notaEntradaConsignado,
  notasEntradaConsignado,
  type NucleoLegado,
  saldoCadastroConsignado,
  saldoConsignadoTravadoSgh,
  saldosConsignado,
  somenteSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type GravadorConsignado,
  METODOS_PORTA_CONSIGNADO,
  type PortaConsignado,
} from './consignado-porta.js';

function gravador(e: Escritor, hospital: string): GravadorConsignado {
  return {
    movimentosPelaChave: (chave) => movimentosConsignadoPelaChave(e, hospital, chave),
    consumos: async (ids) => (await consumosConsignados(e, hospital, { ids, travar: true })).itens,
    saldoTravado: (fornecedor, item, usuario) =>
      saldoConsignadoTravadoSgh(e, { hospital, fornecedor, item, usuario }),
    gravar: (m) => gravarMovimentosConsignadoSgh(e, { hospital, ...m }),
  };
}

type Ler = <T>(c: ContextoPortaM18, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaConsignado, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    movimentos: (c, fornecedor) => ler(c, (l) => movimentosConsignado(l, c.hospital, { fornecedor })),
    consumos: (c, fornecedor) => ler(c, (l) => consumosConsignados(l, c.hospital, { fornecedor })),
    saldos: (c, fornecedor) => ler(c, (l) => saldosConsignado(l, c.hospital, { fornecedor })),
    saldoCadastro: (c) => ler(c, (l) => saldoCadastroConsignado(l)),
    nomes: (c, fs, is) => ler(c, (l) => nomesConsignado(l, fs, is)),
    notaEntrada: (c, nf, item) => ler(c, (l) => notaEntradaConsignado(l, nf, item)),
    notasEntrada: (c, f, item) => ler(c, (l) => notasEntradaConsignado(l, f, item)),
    fornecedorExiste: (c, f) => ler(c, (l) => fornecedorExiste(l, f)),
    classeDoItem: (c, item) => ler(c, (l) => classeDoItem(l, item)),
    referenciaConsignada: (c, item) => ler(c, (l) => itemConsignado(l, item)),
    buscarItens: (c, termo) => ler(c, (l) => buscarItensEstoque(l, termo)),
  };
}

const semExecutor = () =>
  Promise.reject(
    new ErroProblema(
      'operacao-bloqueada',
      409,
      'Operação indisponível',
      'O consignado não grava pelo estoque.',
    ),
  );

export function portaConsignadoLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaConsignado {
  const ctx = (c: ContextoPortaM18) => ({ rede: c.rede, hospital: c.hospital, traceId: 'consignado' });
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semExecutor,
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
export function portaConsignadoNaTransacao(e: Escritor): PortaConsignado {
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semExecutor,
    async gravarSgh(c, trilha, fn) {
      const r = await fn(gravador(e, c.hospital));
      await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaConsignadoIndisponivel(): PortaConsignado {
  return portaIndisponivel<PortaConsignado>(METODOS_PORTA_CONSIGNADO);
}
