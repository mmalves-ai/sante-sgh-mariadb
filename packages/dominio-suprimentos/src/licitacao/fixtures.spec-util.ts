// Fixtures sintéticas do processo formal de compra (M55, etapa 4): nenhum dado real.
import {
  type ItemLicitacao,
  type LicitacaoGravada,
  PARAMETROS_LICITACAO_PADRAO,
  type PropostaLicitacao,
} from '@sgh/contratos';
import type { EstadoLicitacao } from '../index.js';

export function processo(x: Partial<LicitacaoGravada> = {}): LicitacaoGravada {
  return {
    id: 1,
    numero: '1/2026',
    regime: 'lei-14133',
    modalidade: 'pregao-eletronico',
    criterio: 'menor-preco',
    natureza: 'bens',
    objeto: 'Aquisição de luvas de procedimento',
    justificativa: 'Reposição do estoque do semestre para todos os setores',
    fundamento: null,
    pesoTecnica: null,
    sigiloso: false,
    metodoEstimativa: 'mediana',
    valorEstimado: null,
    agente: 'AGENTE',
    centroCusto: null,
    etapa: 'planejamento',
    dataPublicacao: null,
    dataAbertura: null,
    dataJulgamento: null,
    julgadoPor: null,
    homologadoPor: null,
    homologadoEm: null,
    versao: 1,
    usuario: 'AGENTE',
    criadoEm: '2026-10-01T10:00:00.000Z',
    ...x,
  };
}

export function item(id: number, x: Partial<ItemLicitacao> = {}): ItemLicitacao {
  return {
    id,
    numero: id,
    descricao: `Item ${id}`,
    itemEstoque: null,
    unidade: 'CX',
    quantidade: 10,
    valorEstimado: 10,
    resultado: null,
    vencedor: null,
    valorAdjudicado: null,
    ...x,
  };
}

let seq = 100;
export function proposta(
  itemId: number,
  fornecedor: number,
  valor: number,
  x: Partial<PropostaLicitacao> = {},
): PropostaLicitacao {
  return {
    id: ++seq,
    item: itemId,
    fornecedor,
    fornecedorNome: `Fornecedor ${fornecedor}`,
    valor,
    lance: null,
    notaTecnica: null,
    marca: null,
    situacao: 'valida',
    motivo: null,
    ...x,
  };
}

export function estado(x: Partial<EstadoLicitacao> = {}): EstadoLicitacao {
  return {
    processo: processo(),
    itens: [item(1)],
    precos: [],
    propostas: [],
    eventos: [],
    hoje: '2026-10-29',
    parametros: PARAMETROS_LICITACAO_PADRAO,
    ...x,
  };
}
