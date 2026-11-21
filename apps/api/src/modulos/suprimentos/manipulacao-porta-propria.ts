// Porta da manipulação (M46, etapa 4) sobre o banco do cliente, pelo @sgh/nucleo: as capelas do estabelecimento com
// os grupos de manipulação (capela_manipulacao, capela_manipulacao_grupo, grupo_manipulacao), somente leitura.
// Melhoria: a capela "funcionando" vem da situação do cadastro (disponível ou em uso; manutenção e inativa não), e
// "manipulando" da situação em uso, sem marcas S/N.
// A avaliação farmacêutica do item prescrito vem de avaliacao_farmaceutica e avaliacao_farmaceutica_item (06_PEP), do
// estabelecimento da sessão: pendente ou em avaliação = "pendente"; concluída = "decidido", com o parecer do item
// (aprovado ou aprovado com ressalva = "valido"; recusado = "invalido"; substituído = "substituido"); o produto é o
// insumo do item prescritível.
// Pendências (pedido do lote 03-14; a tela recebe o motivo, nada em silêncio): a lista de itens a manipular, as ordens
// (contrato pela saída antiga, ano/mês/documento, e pelo login), os vínculos do login e as gravações (abertura e
// conferência da ordem) respondem 409 modelo-pendente; a baixa do insumo depende da saída do estoque no banco.
import {
  type ContextoNucleo,
  type ContextoOperacao,
  type Leitor,
  type NucleoProprio,
  recusa,
} from '@sgh/nucleo';
import { type LiberacaoGravacao, portaIndisponivel } from '../exames/public-api.js';
import type { CapelaManipulacao } from '@sgh/contratos';
import type { AvaliacaoDoItem } from './manipulacao-porta.js';
import { contextoNucleo, modeloPendente } from './operacoes.js';
import { METODOS_PORTA_MANIPULACAO, type PortaManipulacao } from './manipulacao-porta.js';

export type NucleoManipulacao = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** O que o banco ainda não atende na manipulação, com o que falta (pedido do lote 03-14). */
export const MANIPULACAO_PENDENTE: Readonly<Record<string, string>> = {
  itensAManipular:
    'a fila de itens prescritos a manipular (avaliacao_farmaceutica_item com o leito, as iniciais e a ordem_manipulacao do item)',
  ordens: 'as ordens de manipulação (contrato pela saída antiga e pelo login)',
  ordem: 'a ordem de manipulação (contrato pela saída antiga e pelo login)',
  vinculos: 'os vínculos profissionais do login (por id de usuário)',
  gravacao:
    'a abertura e a conferência da ordem de manipulação (ordem_manipulacao e conferencia_manipulacao)',
  executar: 'a baixa do insumo da manipulação (saída do estoque no banco)',
};

const falta = (m: string): Promise<never> => Promise.reject(modeloPendente(MANIPULACAO_PENDENTE[m] ?? m));
type Linha = Record<string, unknown>;

export class PortaManipulacaoPropria implements PortaManipulacao {
  readonly destino = 'banco' as const;
  constructor(private readonly nucleo: NucleoManipulacao) {}

  private ler<T>(c: ContextoNucleo, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoNucleo(c, 'manipulacao'), (l) => fn(l, est));
  }

  async podeGravar(): Promise<LiberacaoGravacao> {
    return {
      pode: false,
      codigo: 'operacao-nao-liberada',
      motivo: `Operação desligada no banco: ${MANIPULACAO_PENDENTE['executar']}.`,
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  executar(_c: ContextoNucleo, _op: string, _e: unknown, _ctx: ContextoOperacao): Promise<never> {
    return falta('executar');
  }
  gravarSgh<T>(): Promise<T> {
    return falta('gravacao');
  }

  capelas(c: ContextoNucleo): Promise<CapelaManipulacao[]> {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar<Linha>(
        `SELECT c.id, c.nome, c.situacao, g.id AS grupo_id, g.descricao AS grupo_nome
           FROM capela_manipulacao c
           LEFT JOIN capela_manipulacao_grupo cg ON cg.capela_manipulacao_id = c.id AND cg.excluido_em IS NULL
           LEFT JOIN grupo_manipulacao g ON g.id = cg.grupo_manipulacao_id AND g.ativo = TRUE
          WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.situacao <> 'inativa'
          ORDER BY c.nome, c.id, g.descricao`,
        [est],
      );
      const porId = new Map<
        number,
        {
          id: number;
          nome: string;
          funcionando: boolean;
          manipulando: boolean;
          grupos: { id: number; nome: string }[];
        }
      >();
      for (const r of linhas) {
        const id = Number(r['id']);
        let x = porId.get(id);
        if (!x) {
          const situacao = String(r['situacao']);
          x = {
            id,
            nome: String(r['nome']),
            funcionando: situacao === 'disponivel' || situacao === 'em_uso',
            manipulando: situacao === 'em_uso',
            grupos: [],
          };
          porId.set(id, x);
        }
        if (r['grupo_id'] !== null && r['grupo_id'] !== undefined)
          x.grupos.push({ id: Number(r['grupo_id']), nome: String(r['grupo_nome']) });
      }
      return [...porId.values()];
    });
  }

  itensAManipular(): Promise<never> {
    return falta('itensAManipular');
  }
  /** A avaliação farmacêutica mais recente do item prescrito no estabelecimento da sessão, ou null. */
  avaliacao(c: ContextoNucleo, itemPrescrito: number): Promise<AvaliacaoDoItem | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(
        `SELECT afi.id, af.id AS avaliacao_id, af.situacao, afi.parecer, ip.insumo_id
           FROM avaliacao_farmaceutica_item afi
           JOIN avaliacao_farmaceutica af ON af.id = afi.avaliacao_farmaceutica_id AND af.excluido_em IS NULL
           JOIN prescricao_item pi ON pi.id = afi.prescricao_item_id
           LEFT JOIN item_prescritivel ip ON ip.id = pi.item_prescritivel_id
          WHERE afi.prescricao_item_id = ? AND af.estabelecimento_id = ? AND afi.excluido_em IS NULL
          ORDER BY afi.avaliado_em DESC, afi.id DESC LIMIT 1`,
        [itemPrescrito, est],
      );
      if (!r) return null;
      const aberta = ['pendente', 'em_avaliacao'].includes(String(r['situacao']));
      const parecer = String(r['parecer']);
      const decisao = aberta
        ? null
        : parecer === 'aprovado' || parecer === 'aprovado_com_ressalva'
          ? 'valido'
          : parecer === 'recusado'
            ? 'invalido'
            : 'substituido';
      return {
        id: Number(r['id']),
        estado: aberta ? 'pendente' : 'decidido',
        decisao,
        reg: Number(r['avaliacao_id']),
        produto: r['insumo_id'] === null || r['insumo_id'] === undefined ? null : Number(r['insumo_id']),
      };
    });
  }
  ordens(): Promise<never> {
    return falta('ordens');
  }
  ordem(): Promise<never> {
    return falta('ordem');
  }
  vinculos(): Promise<never> {
    return falta('vinculos');
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaManipulacaoIndisponivel(): PortaManipulacao {
  return portaIndisponivel<PortaManipulacao>(METODOS_PORTA_MANIPULACAO);
}
