// Porta própria do aviso de estouro do tempo-alvo da classificação de risco (M44, etapa 1; regra 4; lote F2.2 05-15)
// sobre o banco do cliente, pelo @sgh/nucleo. Leitura (somente leitura, filtrada pelo estabelecimento e pelos
// excluídos): a chave `pa.classificacao` (liberacao_chave, recurso_prerequisito), os atendimentos abertos com
// classificação (atendimento), as etapas do pronto atendimento (atendimento_etapa_pa), as classificações concluídas com a
// cor do nível de prioridade (classificacao_risco, nivel_prioridade) e os avisos já gravados (aviso_estouro_classificacao).
// Gravação: UM aviso por classificação numa operação do Executor (trilha na mesma transação), sob a chave única do
// aviso: o segundo consumidor desiste sem erro.
// Melhoria: o instante é ISO com fuso (classificado_em e o relógio), não a hora local sem fuso; a classificação de outro
// estabelecimento é recusada na gravação; a cor vem do cadastro do nível de prioridade (nome_cor), nunca de código fixo.
import { randomUUID } from 'node:crypto';
import { CHAVE_LIBERACAO_CLASSIFICACAO, CODIGOS_COR_RISCO, type CorRisco } from '@sgh/contratos';
import { definirOperacao, type Executor, type Leitor, recusa } from '@sgh/nucleo';
import { z } from 'zod';
import {
  type AlvoEstabelecimento,
  conflitoConcorrente,
  estabelecimentosAtivos,
  type NucleoWorker,
  recursoLigadoAqui,
} from './servico-worker.js';

export interface EtapaPa {
  readonly etapa: string;
  readonly em: string;
}

export interface AtendimentoAberto {
  readonly id: number;
  readonly etapas: readonly EtapaPa[];
}

export interface ClassificacaoLida {
  readonly id: number;
  readonly atendimento: number;
  /** null: o nível de prioridade não tem cor do protocolo no cadastro. */
  readonly cor: CorRisco | null;
  readonly classificadoEm: string;
  readonly tempoAlvoMin: number;
}

export interface EstouroPendente {
  readonly chave: string;
  readonly classificacao: number;
  readonly atendimento: number;
  readonly prazoEm: string;
  readonly cor: CorRisco;
}

export interface PortaEstouro {
  estabelecimentos(): Promise<AlvoEstabelecimento[]>;
  ligada(est: AlvoEstabelecimento, agora: Date): Promise<boolean>;
  abertos(est: AlvoEstabelecimento): Promise<AtendimentoAberto[]>;
  classificacoes(est: AlvoEstabelecimento, atendimentos: readonly number[]): Promise<ClassificacaoLida[]>;
  avisosGravados(chaves: readonly string[]): Promise<Set<string>>;
  /** false: outro consumidor avisou antes ou está avisando agora. */
  registrarAviso(est: AlvoEstabelecimento, aviso: EstouroPendente): Promise<boolean>;
}

const n = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const LOTE = 500;
const em = (k: number) => Array.from({ length: k }, () => '?').join(', ');

function corDe(nomeCor: unknown, codigo: unknown): CorRisco | null {
  for (const v of [nomeCor, codigo]) {
    const c = String(v ?? '')
      .trim()
      .toLowerCase();
    if ((CODIGOS_COR_RISCO as readonly string[]).includes(c)) return c as CorRisco;
  }
  return null;
}

const ENTRADA = z.object({
  estabelecimento: z.number().int().positive(),
  classificacao: z.number().int().positive(),
  chave: z.string().min(1).max(80),
  prazoEm: z.string().min(20),
});

export class PortaEstouroPropria implements PortaEstouro {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoWorker,
    readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(est: number | null, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, estabelecimento: est, correlacao: 'classificacao-estouro' }, fn);
  }

  estabelecimentos(): Promise<AlvoEstabelecimento[]> {
    return this.ler(null, (l) => estabelecimentosAtivos(l, this.cliente));
  }

  ligada(est: AlvoEstabelecimento, agora: Date): Promise<boolean> {
    return this.ler(est.id, (l) => recursoLigadoAqui(l, CHAVE_LIBERACAO_CLASSIFICACAO, est.id, agora));
  }

  abertos(est: AlvoEstabelecimento): Promise<AtendimentoAberto[]> {
    return this.ler(est.id, async (l) => {
      const ats = await l.consultar(
        `SELECT a.id FROM atendimento a
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.saida_em IS NULL
            AND a.situacao IN ('aberto', 'em_atendimento', 'em_observacao')
            AND EXISTS (SELECT 1 FROM classificacao_risco c
                         WHERE c.atendimento_id = a.id AND c.estabelecimento_id = a.estabelecimento_id
                           AND c.excluido_em IS NULL)
          ORDER BY a.id`,
        [est.id],
        { teto: 20_000 },
      );
      const ids = ats.map((a) => n(a['id']));
      const etapas = new Map<number, EtapaPa[]>();
      for (let i = 0; i < ids.length; i += LOTE) {
        const parte = ids.slice(i, i + LOTE);
        for (const r of await l.consultar(
          `SELECT atendimento_id, etapa, ocorrida_em FROM atendimento_etapa_pa
            WHERE atendimento_id IN (${em(parte.length)}) AND excluido_em IS NULL ORDER BY ocorrida_em, id`,
          parte,
          { teto: 50_000 },
        )) {
          const k = n(r['atendimento_id']);
          etapas.set(k, [...(etapas.get(k) ?? []), { etapa: String(r['etapa']), em: iso(r['ocorrida_em']) }]);
        }
      }
      return ids.map((id) => ({ id, etapas: etapas.get(id) ?? [] }));
    });
  }

  classificacoes(est: AlvoEstabelecimento, atendimentos: readonly number[]): Promise<ClassificacaoLida[]> {
    if (atendimentos.length === 0) return Promise.resolve([]);
    return this.ler(est.id, async (l) => {
      const r: ClassificacaoLida[] = [];
      for (let i = 0; i < atendimentos.length; i += LOTE) {
        const parte = atendimentos.slice(i, i + LOTE);
        for (const x of await l.consultar(
          `SELECT c.id, c.atendimento_id, c.classificado_em, c.tempo_alvo_minutos, np.nome_cor, np.codigo
             FROM classificacao_risco c JOIN nivel_prioridade np ON np.id = c.nivel_prioridade_id
            WHERE c.estabelecimento_id = ? AND c.atendimento_id IN (${em(parte.length)}) AND c.excluido_em IS NULL
              AND c.situacao IN ('concluida', 'reclassificada') AND c.classificado_em IS NOT NULL
            ORDER BY c.classificado_em, c.id`,
          [est.id, ...parte],
          { teto: 50_000 },
        ))
          r.push({
            id: n(x['id']),
            atendimento: n(x['atendimento_id']),
            cor: corDe(x['nome_cor'], x['codigo']),
            classificadoEm: iso(x['classificado_em']),
            tempoAlvoMin: n(x['tempo_alvo_minutos']),
          });
      }
      return r;
    });
  }

  avisosGravados(chaves: readonly string[]): Promise<Set<string>> {
    if (chaves.length === 0) return Promise.resolve(new Set());
    return this.ler(null, async (l) => {
      const s = new Set<string>();
      for (let i = 0; i < chaves.length; i += LOTE) {
        const parte = chaves.slice(i, i + LOTE);
        for (const r of await l.consultar(
          `SELECT chave FROM aviso_estouro_classificacao WHERE chave IN (${em(parte.length)})`,
          parte,
          { teto: LOTE },
        ))
          s.add(String(r['chave']));
      }
      return s;
    });
  }

  async registrarAviso(est: AlvoEstabelecimento, aviso: EstouroPendente): Promise<boolean> {
    const op = definirOperacao<z.infer<typeof ENTRADA>, { gravado: boolean }>({
      nome: 'recepcao.classificacao.estourada',
      tabelas: ['aviso_estouro_classificacao'],
      entrada: ENTRADA,
      gravar: async (tx, e) => {
        const c = await tx.uma(
          'SELECT id FROM classificacao_risco WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.classificacao, e.estabelecimento],
        );
        if (!c) throw recusa('classificacao-outro-estabelecimento', 'A classificação não existe neste estabelecimento.');
        const ja = await tx.consultarParaAtualizar('SELECT id FROM aviso_estouro_classificacao WHERE chave = ?', [e.chave], {
          teto: 1,
        });
        if (ja.length > 0) return { gravado: false };
        await tx.incluir('aviso_estouro_classificacao', {
          classificacao_risco_id: e.classificacao,
          chave: e.chave,
          prazo_em: new Date(e.prazoEm),
          avisado_em: new Date(),
        });
        return { gravado: true };
      },
      alvo: (e) => ({ tabela: 'classificacao_risco', id: e.classificacao }),
    });
    try {
      const r = await this.executor.executar(
        op,
        this.cliente,
        { estabelecimento: est.id, classificacao: aviso.classificacao, chave: aviso.chave, prazoEm: aviso.prazoEm },
        {
          cliente: this.cliente,
          estabelecimento: est.id,
          usuario: null,
          correlacao: aviso.chave.slice(0, 64),
          chaveIdempotencia: `worker.estouro.${aviso.classificacao}.${randomUUID()}`,
        },
      );
      return r.resultado.gravado;
    } catch (x) {
      if (conflitoConcorrente(x)) return false;
      throw x;
    }
  }
}
