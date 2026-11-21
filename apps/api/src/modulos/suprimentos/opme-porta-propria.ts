// Porta do OPME (M46, etapa 3) sobre o banco do cliente, pelo @sgh/nucleo: o cadastro do item (insumo com a marca de
// OPME e de consignado, da rede inteira) e o local com saldo de OPME no estabelecimento (saldo_estoque), somente
// leitura.
// Melhoria: "é OPME" vem da marca do cadastro do insumo (insumo.opme), não de um número de classe; o local sugerido
// conta o saldo próprio e o consignado do estabelecimento da sessão.
// Pendências (pedido do lote 03-14; a tela recebe o motivo, nada em silêncio): a solicitação e as etapas
// (solicitacao_opme é cabeçalho com itens; o contrato da tela é por item e pela chave antiga do pedido e da nota),
// o consumo em sala (consumo_opme; contrato pela saída antiga e pelo lançamento da conta), o rastreio reverso, os
// itens com saldo e lotes, os fornecedores e os itens da conta respondem 409 modelo-pendente.
import {
  type ContextoNucleo,
  type ContextoOperacao,
  type Leitor,
  type NucleoProprio,
  recusa,
} from '@sgh/nucleo';
import { type LiberacaoGravacao, portaIndisponivel } from '../exames/public-api.js';
import { CLASSE_OPME } from '@sgh/contratos';
import { contextoNucleo, modeloPendente } from './operacoes.js';
import { METODOS_PORTA_OPME, type PortaOpme } from './opme-porta.js';

export type NucleoOpme = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** O que o banco ainda não atende no OPME, com o que falta (pedido do lote 03-14). */
export const OPME_PENDENTE: Readonly<Record<string, string>> = {
  solicitacoesDosAgendamentos: 'as solicitações de OPME do agendamento (contrato por item da solicitação)',
  solicitacoesDoPeriodo: 'as solicitações de OPME do período (contrato por item da solicitação)',
  solicitacao: 'a solicitação de OPME (contrato por item da solicitação)',
  consumosDosAgendamentos: 'os consumos de OPME do agendamento (contrato pela saída antiga)',
  consumosDoPeriodo: 'os consumos de OPME do período (contrato pela saída antiga)',
  consumo: 'o consumo de OPME (contrato pela saída antiga)',
  consumoPelaChave: 'o consumo de OPME pela chave do pedido',
  localDaSaida: 'o local da saída do consumo (documento_estoque por id)',
  documentosCompra: 'o fornecedor, o pedido e a nota das etapas (contrato pela chave antiga)',
  fornecedores: 'a busca de fornecedores (empresa_fornecedora)',
  itens: 'os itens de OPME com saldo e lotes',
  rastreioReverso: 'o rastreio reverso do OPME',
  itensDaConta: 'os itens de OPME lançados na conta',
  gravacao: 'a solicitação e as etapas do OPME (solicitacao_opme e solicitacao_opme_item)',
  executar: 'o consumo em sala e a devolução do OPME (saída do estoque no banco e consumo_opme)',
};

const falta = (m: string): Promise<never> => Promise.reject(modeloPendente(OPME_PENDENTE[m] ?? m));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1' || v === 1n;

export class PortaOpmePropria implements PortaOpme {
  readonly destino = 'banco' as const;
  constructor(private readonly nucleo: NucleoOpme) {}

  private ler<T>(c: ContextoNucleo, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoNucleo(c, 'opme'), (l) => fn(l, est));
  }

  async podeGravar(): Promise<LiberacaoGravacao> {
    return {
      pode: false,
      codigo: 'operacao-nao-liberada',
      motivo: `Operação desligada no banco: ${OPME_PENDENTE['executar']}.`,
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  executar(_c: ContextoNucleo, _op: string, _e: unknown, _ctx: ContextoOperacao): Promise<never> {
    return falta('executar');
  }
  gravarSgh<T>(): Promise<T> {
    return falta('gravacao');
  }

  /** A classe de OPME quando o insumo tem a marca de OPME; fora do OPME ou inexistente: null (a tela recusa). */
  classeDoItem(c: ContextoNucleo, item: number): Promise<number | null> {
    return this.ler(c, async (l) => {
      // Cadastro do insumo: da rede inteira (sem estabelecimento).
      const r = await l.uma<{ opme: unknown }>(
        'SELECT opme FROM insumo WHERE id = ? AND excluido_em IS NULL',
        [item],
      );
      return r && verdadeiro(r.opme) ? CLASSE_OPME : null;
    });
  }

  itemConsignado(c: ContextoNucleo, item: number): Promise<boolean> {
    return this.ler(c, async (l) => {
      const r = await l.uma<{ consignado: unknown }>(
        'SELECT consignado FROM insumo WHERE id = ? AND excluido_em IS NULL',
        [item],
      );
      return !!r && verdadeiro(r.consignado);
    });
  }

  /** O primeiro dos locais (na ordem dada) do estabelecimento com saldo de OPME, próprio ou consignado. */
  localComSaldo(c: ContextoNucleo, locais: readonly number[]): Promise<number | null> {
    const ids = [...new Set(locais.filter((x) => Number.isInteger(x) && x > 0))];
    if (!ids.length) return Promise.resolve(null);
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar<{ local_estoque_id: unknown }>(
        `SELECT DISTINCT s.local_estoque_id
           FROM saldo_estoque s
           JOIN insumo i ON i.id = s.insumo_id AND i.opme = TRUE AND i.excluido_em IS NULL
           JOIN local_estoque le ON le.id = s.local_estoque_id AND le.estabelecimento_id = ? AND le.excluido_em IS NULL
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL AND (s.quantidade > 0 OR s.quantidade_consignada > 0)
            AND s.local_estoque_id IN (${ids.map(() => '?').join(', ')})`,
        [est, est, ...ids],
      );
      const com = new Set(linhas.map((r) => Number(r.local_estoque_id)));
      return locais.find((x) => com.has(x)) ?? null;
    });
  }

  solicitacoesDosAgendamentos(): Promise<never> {
    return falta('solicitacoesDosAgendamentos');
  }
  solicitacoesDoPeriodo(): Promise<never> {
    return falta('solicitacoesDoPeriodo');
  }
  solicitacao(): Promise<never> {
    return falta('solicitacao');
  }
  consumosDosAgendamentos(): Promise<never> {
    return falta('consumosDosAgendamentos');
  }
  consumosDoPeriodo(): Promise<never> {
    return falta('consumosDoPeriodo');
  }
  consumo(): Promise<never> {
    return falta('consumo');
  }
  consumoPelaChave(): Promise<never> {
    return falta('consumoPelaChave');
  }
  localDaSaida(): Promise<never> {
    return falta('localDaSaida');
  }
  documentosCompra(): Promise<never> {
    return falta('documentosCompra');
  }
  fornecedores(): Promise<never> {
    return falta('fornecedores');
  }
  itens(): Promise<never> {
    return falta('itens');
  }
  rastreioReverso(): Promise<never> {
    return falta('rastreioReverso');
  }
  itensDaConta(): Promise<never> {
    return falta('itensDaConta');
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaOpmeIndisponivel(): PortaOpme {
  return portaIndisponivel<PortaOpme>(METODOS_PORTA_OPME);
}
