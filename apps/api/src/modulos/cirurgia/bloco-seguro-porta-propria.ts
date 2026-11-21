// Porta da cirurgia segura e do rastreio no bloco (M46.2) sobre o banco do cliente, pelo @sgh/nucleo: leituras somente
// leitura em checklist_cirurgia_segura (+ confirmacao_checklist_cirurgia, item_checklist_cirurgia),
// movimento_paciente_bloco e nos cadastros do bloco (local_bloco, tipo_movimento_bloco). Toda leitura filtra o
// estabelecimento da sessão e os registros excluídos; os cadastros do bloco são da rede inteira.
// Melhoria: o checklist responde por momento e por item do modelo versionado (modelo_checklist_cirurgia), com quem
// confirmou cada item; o rastreio registra o local anterior, a sala e o responsável em colunas próprias.
// Pendência registrada (pedidos do lote 03-01, saida/03-01.json): as GRAVAÇÕES do checklist e do rastreio recusam com
// 409 modelo-pendente (o checklist exige o ato cirúrgico, que só nasce no registro; o rastreio exige a unidade cirúrgica
// e o atendimento do agendamento e não tem o destino da saída nem a chave do pedido); o código do painel para
// familiares não tem tabela, e o painel fica sem linhas até o DDL.
import { ErroOperacao, type Leitor, recusa } from '@sgh/nucleo';
import type { TipoMovimentoBloco } from '@sgh/contratos';
import { MOMENTO_CHECKLIST, RESPOSTA_CHECKLIST, SITUACAO_CHECKLIST } from './vocabulario-banco.js';
import { type ContextoPortaM18, type LiberacaoGravacao, portaIndisponivel } from '../exames/public-api.js';
import { civil, FUSO_PADRAO, instante, lista, n, nn, texto, textoOuNulo, verdadeiro } from './banco-apoio.js';
import {
  type GravadorBlocoSeguro,
  METODOS_PORTA_BLOCO_SEGURO,
  type PortaBlocoSeguro,
} from './bloco-seguro-porta.js';
import { contextoDe, type NucleoCirurgia } from './porta-propria.js';
import type { ChecklistDaCirurgia, CodigoDoPainel, DominiosRastreio, MovimentoDoBloco } from './tipos.js';

type Linha = Record<string, unknown>;
export const MOTIVO_BLOCO_PENDENTE =
  'As gravações do checklist de cirurgia segura e do rastreio no banco próprio aguardam o modelo (checklist ligado ao agendamento antes do ato, destino da saída e chave do pedido no rastreio): a tela fica em consulta.';

export class PortaBlocoSeguroPropria implements PortaBlocoSeguro {
  readonly destino = 'banco' as const;
  constructor(private readonly nucleo: Pick<NucleoCirurgia, 'lerSomente'>) {}

  private ler<T>(c: ContextoPortaM18, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), async (l) => {
      const f = await l.uma<{ fuso_horario: string | null }>(
        'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
        [est],
      );
      return fn(l, est, f?.fuso_horario || FUSO_PADRAO);
    });
  }

  async podeGravar(): Promise<LiberacaoGravacao> {
    return { pode: false, codigo: 'modelo-pendente', motivo: MOTIVO_BLOCO_PENDENTE };
  }
  executar(_c: ContextoPortaM18, op: string): Promise<never> {
    return Promise.reject(
      recusa('operacao-desconhecida', `Operação ${op} sem gravação pelo Executor no bloco.`),
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta; a gravação aguarda o modelo
  gravarSgh<T>(_c: ContextoPortaM18, _t: unknown, _fn: (g: GravadorBlocoSeguro) => Promise<T>): Promise<T> {
    return Promise.reject(
      new ErroOperacao(409, 'modelo-pendente', 'Gravação aguardando o modelo', MOTIVO_BLOCO_PENDENTE),
    );
  }

  dominios(c: ContextoPortaM18): Promise<DominiosRastreio> {
    // Cadastros do bloco: rede inteira.
    return this.ler(c, async (l) => ({
      locais: (
        await l.consultar('SELECT id, descricao, ativo FROM local_bloco ORDER BY ordem, descricao')
      ).map((x) => ({
        id: n(x['id']),
        nome: texto(x['descricao']),
        ativo: verdadeiro(x['ativo']),
      })),
      tipos: (
        await l.consultar('SELECT id, descricao, ativo FROM tipo_movimento_bloco ORDER BY descricao')
      ).map((x) => ({
        id: n(x['id']),
        nome: texto(x['descricao']),
        ativo: verdadeiro(x['ativo']),
      })),
    }));
  }

  private async checklistsDe(
    l: Leitor,
    est: number,
    fuso: string,
    ags: readonly number[],
  ): Promise<Map<number, ChecklistDaCirurgia>> {
    const m = new Map<number, ChecklistDaCirurgia>();
    if (ags.length === 0) return m;
    const cs = await l.consultar(
      `SELECT c.*, t.agendamento_cirurgico_id, t.sala_cirurgica_id, t.atendimento_id, t.paciente_id, a.inicio_previsto_em
         FROM checklist_cirurgia_segura c JOIN ato_cirurgico t ON t.id = c.ato_cirurgico_id
         LEFT JOIN agendamento_cirurgico a ON a.id = t.agendamento_cirurgico_id
        WHERE t.estabelecimento_id = ? AND t.agendamento_cirurgico_id IN (${lista(ags.length)})
          AND c.excluido_em IS NULL AND t.excluido_em IS NULL`,
      [est, ...ags],
    );
    if (cs.length === 0) return m;
    const ids = cs.map((x) => n(x['id']));
    const conf = await l.consultar(
      `SELECT x.id, x.checklist_cirurgia_segura_id, x.resposta, x.observacao, x.confirmado_em, x.profissional_id, i.codigo, i.momento, u.login
         FROM confirmacao_checklist_cirurgia x JOIN item_checklist_cirurgia i ON i.id = x.item_checklist_cirurgia_id
         LEFT JOIN usuario u ON u.id = x.criado_por
        WHERE x.checklist_cirurgia_segura_id IN (${lista(ids.length)}) AND x.excluido_em IS NULL ORDER BY x.sequencia`,
      ids,
    );
    const por = (v: unknown) => (v === null || v === undefined ? null : String(v));
    for (const x of cs) {
      const id = n(x['id']);
      const ag = n(x['agendamento_cirurgico_id']);
      m.set(ag, {
        id,
        agendamento: ag,
        sala: n(x['sala_cirurgica_id']),
        dataHora: (civil(x['inicio_previsto_em'], fuso) ?? '').replace(' ', 'T'),
        reg: n(x['atendimento_id']),
        paciente: nn(x['paciente_id']),
        cirurgia: n(x['ato_cirurgico_id']),
        registroProntuario: null,
        lista: n(x['modelo_checklist_cirurgia_id']),
        versao: n(x['versao']),
        situacao: SITUACAO_CHECKLIST.doBanco(texto(x['situacao'])),
        inducaoEm: civil(x['inducao_concluida_em'], fuso),
        inducaoPor: por(x['inducao_profissional_id']),
        timeoutEm: civil(x['incisao_concluida_em'], fuso),
        timeoutPor: por(x['incisao_profissional_id']),
        saidaEm: civil(x['saida_concluida_em'], fuso),
        saidaPor: por(x['saida_profissional_id']),
        excecaoEm: verdadeiro(x['dispensado_urgencia'])
          ? civil(x['alterado_em'] ?? x['criado_em'], fuso)
          : null,
        excecaoPor: null,
        excecaoMotivo: textoOuNulo(x['justificativa_dispensa']),
        confirmacoes: conf
          .filter((y) => n(y['checklist_cirurgia_segura_id']) === id)
          .map((y) => ({
            id: n(y['id']),
            momento: MOMENTO_CHECKLIST.doBanco(texto(y['momento'])),
            item: texto(y['codigo']),
            resposta: RESPOSTA_CHECKLIST.doBanco(texto(y['resposta'])),
            observacao: textoOuNulo(y['observacao']),
            em: civil(y['confirmado_em'], fuso) ?? '',
            usuario: texto(y['login']),
            profissional: nn(y['profissional_id']),
          })),
      });
    }
    return m;
  }

  checklist(c: ContextoPortaM18, agendamento: number): Promise<ChecklistDaCirurgia | null> {
    return this.ler(
      c,
      async (l, est, fuso) => (await this.checklistsDe(l, est, fuso, [agendamento])).get(agendamento) ?? null,
    );
  }
  checklists(
    c: ContextoPortaM18,
    agendamentos: readonly number[],
  ): Promise<Map<number, ChecklistDaCirurgia>> {
    if (agendamentos.length === 0) return Promise.resolve(new Map());
    return this.ler(c, (l, est, fuso) => this.checklistsDe(l, est, fuso, agendamentos));
  }

  private async movimentosPorAgendamento(
    l: Leitor,
    est: number,
    fuso: string,
    ags: readonly number[],
  ): Promise<Map<number, MovimentoDoBloco[]>> {
    const m = new Map<number, MovimentoDoBloco[]>();
    if (ags.length === 0) return m;
    const r = await l.consultar(
      `SELECT mv.*, tm.codigo AS tipo, u.login, a.inicio_previsto_em, a.sala_cirurgica_id AS sala_agendada
         FROM movimento_paciente_bloco mv
         JOIN tipo_movimento_bloco tm ON tm.id = mv.tipo_movimento_bloco_id
         JOIN agendamento_cirurgico a ON a.id = mv.agendamento_cirurgico_id
         LEFT JOIN usuario u ON u.id = mv.responsavel_usuario_id
        WHERE mv.estabelecimento_id = ? AND mv.agendamento_cirurgico_id IN (${lista(ags.length)}) AND mv.excluido_em IS NULL
        ORDER BY mv.ocorrido_em, mv.id`,
      [est, ...ags],
    );
    for (const x of r as Linha[]) {
      const ag = n(x['agendamento_cirurgico_id']);
      const doAg = m.get(ag) ?? [];
      doAg.push({
        id: n(x['id']),
        agendamento: ag,
        sala: n(x['sala_agendada']),
        dataHora: (civil(x['inicio_previsto_em'], fuso) ?? '').replace(' ', 'T'),
        reg: n(x['atendimento_id']),
        paciente: nn(x['paciente_id']),
        sequencia: doAg.length + 1,
        tipo: texto(x['tipo']) as TipoMovimentoBloco,
        local: nn(x['local_bloco_id']),
        localAnterior: nn(x['anterior_local_bloco_id']),
        salaCirurgica: nn(x['sala_cirurgica_id']),
        em: civil(x['ocorrido_em'], fuso) ?? '',
        destino: null,
        observacao: textoOuNulo(x['observacao']),
        usuario: texto(x['login']),
      });
      m.set(ag, doAg);
    }
    return m;
  }

  movimentos(c: ContextoPortaM18, agendamento: number): Promise<MovimentoDoBloco[]> {
    return this.ler(
      c,
      async (l, est, fuso) =>
        (await this.movimentosPorAgendamento(l, est, fuso, [agendamento])).get(agendamento) ?? [],
    );
  }
  movimentosDe(c: ContextoPortaM18, agendamentos: readonly number[]) {
    return this.ler(c, (l, est, fuso) => this.movimentosPorAgendamento(l, est, fuso, agendamentos));
  }

  movidosDesde(c: ContextoPortaM18, desde: string): Promise<number[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT DISTINCT agendamento_cirurgico_id FROM movimento_paciente_bloco
            WHERE estabelecimento_id = ? AND ocorrido_em >= ? AND agendamento_cirurgico_id IS NOT NULL AND excluido_em IS NULL LIMIT 500`,
          [est, instante(desde, fuso)],
        )
      ).map((x) => n(x['agendamento_cirurgico_id'])),
    );
  }

  /** O código do painel para familiares não tem tabela no modelo (pedido de DDL): o painel fica sem linhas. */
  async codigos(): Promise<Map<number, CodigoDoPainel>> {
    return new Map();
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaBlocoSeguroIndisponivel(): PortaBlocoSeguro {
  return portaIndisponivel<PortaBlocoSeguro>(METODOS_PORTA_BLOCO_SEGURO);
}
