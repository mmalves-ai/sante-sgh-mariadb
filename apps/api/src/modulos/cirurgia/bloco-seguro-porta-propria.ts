// Porta da cirurgia segura e do rastreio no bloco (M46.2) sobre o banco do cliente, pelo @sgh/nucleo: leituras somente
// leitura em checklist_cirurgia_segura (+ confirmacao_checklist_cirurgia, item_checklist_cirurgia),
// movimento_paciente_bloco e nos cadastros do bloco (local_bloco, tipo_movimento_bloco). Toda leitura filtra o
// estabelecimento da sessão e os registros excluídos; os cadastros do bloco são da rede inteira.
// Melhoria: o checklist responde por momento e por item do modelo versionado (modelo_checklist_cirurgia), com quem
// confirmou cada item; o rastreio registra o local anterior, a sala e o responsável em colunas próprias. O checklist é
// aberto pelo agendamento antes do ato e liga-se ao ato quando ele é registrado. As gravações vão pelo Executor
// (gravarSgh), com a trilha, a idempotência do pedido e a mudança de estado do agendamento na mesma transação. O painel
// da família lê codigo_painel_familia.
import { type Executor, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import type { TipoMovimentoBloco } from '@sgh/contratos';
import { MOMENTO_CHECKLIST, RESPOSTA_CHECKLIST, SITUACAO_CHECKLIST } from './vocabulario-banco.js';
import {
  type ContextoPortaM18,
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from '../exames/public-api.js';
import {
  agendamentoRelido,
  anotarChave,
  type EscritaDoBloco,
  gravarDiretoNoBloco,
  idDoCadastro,
  jaGravadoPelaChave,
} from './anestesia-porta-propria.js';
import {
  civil,
  dataOuNulo,
  FUSO_PADRAO,
  instante,
  lista,
  n,
  nn,
  texto,
  textoOuNulo,
  verdadeiro,
} from './banco-apoio.js';
import {
  type GravadorBlocoSeguro,
  METODOS_PORTA_BLOCO_SEGURO,
  type PortaBlocoSeguro,
} from './bloco-seguro-porta.js';
import { gravadorCirurgia, TABELAS_AGENDA } from './operacoes.js';
import { contextoDe, type NucleoCirurgia } from './porta-propria.js';
import type { ContextoGravacaoCirurgia } from './porta.js';
import type { ChecklistDaCirurgia, CodigoDoPainel, DominiosRastreio, MovimentoDoBloco } from './tipos.js';

type Linha = Record<string, unknown>;
export const TABELAS_BLOCO_SEGURO = [
  'checklist_cirurgia_segura',
  'confirmacao_checklist_cirurgia',
  'movimento_paciente_bloco',
  'codigo_painel_familia',
  ...TABELAS_AGENDA,
] as const;

const checklistMudou = () =>
  recusa('checklist-mudou', 'O checklist mudou em outro aparelho: recarregue e confira.');

/** O gravador do checklist e do rastreio sobre a transação do Executor. */
function gravadorBlocoSeguro(
  tx: TxOperacao,
  est: number,
  fuso: string,
  escrita: EscritaDoBloco,
  leitura: {
    checklists: (
      l: Leitor,
      est: number,
      fuso: string,
      ags: readonly number[],
    ) => Promise<Map<number, ChecklistDaCirurgia>>;
    movimentos: (
      l: Leitor,
      est: number,
      fuso: string,
      ags: readonly number[],
    ) => Promise<Map<number, MovimentoDoBloco[]>>;
  },
): GravadorBlocoSeguro {
  const anotar = (tabela: string, id: number) => {
    escrita.ultima = { tabela, id };
    return id;
  };
  const quando = (v: string) => instante(v, fuso);
  /** O profissional do usuário da sessão no estabelecimento (vínculo vigente), ou null. */
  const profissionalDaSessao = async (): Promise<number | null> => {
    const r = await tx.uma<{ p: number }>(
      `SELECT v.profissional_id AS p FROM usuario_vinculo_profissional v
        WHERE v.usuario_id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
          AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
        ORDER BY v.id LIMIT 1`,
      [tx.contexto.usuario, est],
    );
    return r ? n(r.p) : null;
  };
  const exigirProfissional = async (p: number | null) => {
    const id = p ?? (await profissionalDaSessao());
    if (id === null)
      throw recusa(
        'sem-registro-profissional',
        'A confirmação do checklist é do profissional com vínculo ativo.',
      );
    return id;
  };
  /** O checklist do estabelecimento travado; a versão vista tem de ser a gravada. */
  const travado = async (id: number, versaoVista: number) => {
    const k =
      (
        await tx.consultarParaAtualizar(
          `SELECT c.* FROM checklist_cirurgia_segura c
         LEFT JOIN ato_cirurgico t ON t.id = c.ato_cirurgico_id
         JOIN agendamento_cirurgico a ON a.id = COALESCE(c.agendamento_cirurgico_id, t.agendamento_cirurgico_id)
        WHERE c.id = ? AND a.estabelecimento_id = ? AND c.excluido_em IS NULL`,
          [id, est],
        )
      )[0] ?? null;
    if (!k || n(k['versao']) !== versaoVista) throw checklistMudou();
    return k;
  };
  return {
    agendamentoNaTransacao: (agendamento) => agendamentoRelido(tx, est, agendamento),

    async checklist(agendamento) {
      await tx.consultarParaAtualizar(
        'SELECT id FROM checklist_cirurgia_segura WHERE agendamento_cirurgico_id = ? AND excluido_em IS NULL',
        [agendamento],
      );
      return (await leitura.checklists(tx, est, fuso, [agendamento])).get(agendamento) ?? null;
    },

    confirmacaoPelaChave: (chave, item) =>
      jaGravadoPelaChave<{ id: number; checklist: number }>(tx, 'bloco.confirmacao', `${chave}:${item}`),

    movimentoPelaChave: (chave) =>
      jaGravadoPelaChave<{ id: number; agendamento: number; sequencia: number }>(
        tx,
        'bloco.movimento',
        chave,
      ),

    async abrirChecklist(a) {
      const ja =
        (
          await tx.consultarParaAtualizar(
            `SELECT c.id FROM checklist_cirurgia_segura c LEFT JOIN ato_cirurgico t ON t.id = c.ato_cirurgico_id
          WHERE COALESCE(c.agendamento_cirurgico_id, t.agendamento_cirurgico_id) = ? AND c.excluido_em IS NULL`,
            [a.agendamento],
          )
        )[0] ?? null;
      if (ja)
        throw recusa('checklist-mudou', 'O checklist foi aberto em outro aparelho: recarregue e confira.');
      const ag =
        (
          await tx.consultarParaAtualizar(
            'SELECT id FROM agendamento_cirurgico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [a.agendamento, est],
          )
        )[0] ?? null;
      if (!ag) throw recusa('registro-inexistente', 'O agendamento não existe neste estabelecimento.');
      const modelo = await tx.uma(
        `SELECT id FROM modelo_checklist_cirurgia WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE
            AND tipo = 'cirurgia_segura'`,
        [a.lista, est],
      );
      if (!modelo)
        throw recusa('cadastro-inexistente', 'O modelo do checklist não está ativo neste estabelecimento.');
      const id = await tx.incluir('checklist_cirurgia_segura', {
        agendamento_cirurgico_id: a.agendamento,
        modelo_checklist_cirurgia_id: a.lista,
        situacao: 'em_andamento',
      });
      anotar('checklist_cirurgia_segura', id);
      return { id, versao: 1 };
    },

    async confirmarItens(x) {
      const primeiro = x.itens[0]?.item ?? '';
      const ja = await jaGravadoPelaChave<{ id: number; checklist: number }>(
        tx,
        'bloco.confirmacao',
        x.chave ? `${x.chave}:${primeiro}` : null,
      );
      if (ja) {
        if (ja.checklist !== x.checklist)
          throw recusa('chave-reutilizada', 'A chave do pedido já foi usada em outro checklist.');
        return { ids: [ja.id], versao: x.versaoVista, repetida: true };
      }
      const k = await travado(x.checklist, x.versaoVista);
      const profissional = await exigirProfissional(x.profissional);
      const momento = MOMENTO_CHECKLIST.paraBanco(x.momento);
      let seq = n(
        (
          await tx.uma<{ s: number | null }>(
            'SELECT MAX(sequencia) AS s FROM confirmacao_checklist_cirurgia WHERE checklist_cirurgia_segura_id = ?',
            [x.checklist],
          )
        )?.s,
      );
      const ids: number[] = [];
      for (const i of x.itens) {
        const item = await tx.uma<{ id: number }>(
          'SELECT id FROM item_checklist_cirurgia WHERE modelo_checklist_cirurgia_id = ? AND codigo = ? AND momento = ? AND ativo = TRUE',
          [k['modelo_checklist_cirurgia_id'], i.item, momento],
        );
        if (!item)
          throw recusa('checklist-item-invalido', `O item "${i.item}" não é deste momento do checklist.`);
        const anterior = await tx.uma(
          'SELECT id, versao FROM confirmacao_checklist_cirurgia WHERE checklist_cirurgia_segura_id = ? AND item_checklist_cirurgia_id = ? AND excluido_em IS NULL',
          [x.checklist, item.id],
        );
        const valores = {
          resposta: RESPOSTA_CHECKLIST.paraBanco(i.resposta),
          profissional_id: profissional,
          confirmado_em: quando(x.em),
          observacao: i.observacao,
        };
        let id: number;
        if (anterior) {
          // A resposta corrigida no mesmo momento substitui a anterior (uma por item; a trilha guarda a anterior).
          await tx.alterar(
            'confirmacao_checklist_cirurgia',
            n(anterior['id']),
            n(anterior['versao']),
            valores,
          );
          id = n(anterior['id']);
        } else
          id = await tx.incluir('confirmacao_checklist_cirurgia', {
            checklist_cirurgia_segura_id: x.checklist,
            sequencia: ++seq,
            item_checklist_cirurgia_id: n(item.id),
            ...valores,
          });
        ids.push(id);
        if (x.chave)
          await anotarChave(tx, 'bloco.confirmacao', `${x.chave}:${i.item}`, { id, checklist: x.checklist });
      }
      const versao = await tx.alterar('checklist_cirurgia_segura', x.checklist, x.versaoVista, {});
      anotar('confirmacao_checklist_cirurgia', ids[ids.length - 1] ?? x.checklist);
      return { ids, versao, repetida: false };
    },

    async concluirMomento(x) {
      const k = await travado(x.checklist, x.versaoVista);
      const profissional = await exigirProfissional(null);
      const em = quando(x.em);
      const valores: Record<string, unknown> = {};
      const coluna = { inducao: 'inducao', incisao: 'incisao', saida: 'saida' }[
        MOMENTO_CHECKLIST.paraBanco(x.momento)
      ];
      valores[`${coluna}_concluida_em`] = em;
      valores[`${coluna}_profissional_id`] = profissional;
      if (coluna === 'saida' && texto(k['situacao']) === 'em_andamento') valores['situacao'] = 'concluido';
      if (x.cirurgia && k['ato_cirurgico_id'] === null) {
        // Liga o ato registrado do mesmo atendimento, na mesma sala e no mesmo dia (sem outro checklist).
        const dia = x.cirurgia.dataHora.slice(0, 10);
        const ato = await tx.uma<{ id: number }>(
          `SELECT t.id FROM ato_cirurgico t WHERE t.estabelecimento_id = ? AND t.atendimento_id = ? AND t.sala_cirurgica_id = ?
              AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'
              AND COALESCE(t.inicio_cirurgia_em, t.entrada_sala_em) >= ? AND COALESCE(t.inicio_cirurgia_em, t.entrada_sala_em) < ?
              AND NOT EXISTS (SELECT 1 FROM checklist_cirurgia_segura c WHERE c.ato_cirurgico_id = t.id)
            ORDER BY t.id DESC LIMIT 1`,
          [
            est,
            x.cirurgia.reg,
            x.cirurgia.sala,
            instante(`${dia} 00:00`, fuso),
            instante(`${dia} 23:59`, fuso, 1),
          ],
        );
        if (ato) valores['ato_cirurgico_id'] = n(ato.id);
      }
      anotar('checklist_cirurgia_segura', x.checklist);
      return { versao: await tx.alterar('checklist_cirurgia_segura', x.checklist, x.versaoVista, valores) };
    },

    async registrarExcecao(x) {
      await travado(x.checklist, x.versaoVista);
      anotar('checklist_cirurgia_segura', x.checklist);
      // A exceção da urgência dispensa o checklist com a justificativa (quem e quando vão à trilha da alteração).
      const versao = await tx.alterar('checklist_cirurgia_segura', x.checklist, x.versaoVista, {
        situacao: 'dispensado',
        dispensado_urgencia: true,
        justificativa_dispensa: x.motivo,
      });
      return { versao };
    },

    movimentos: async (agendamento) =>
      (await leitura.movimentos(tx, est, fuso, [agendamento])).get(agendamento) ?? [],

    async estadoDoAgendamento(agendamento) {
      const r = await agendamentoRelido(tx, est, agendamento);
      return r.existe && r.estado ? { id: agendamento, estado: r.estado } : null;
    },

    async mover(m) {
      const ja = await jaGravadoPelaChave<{ id: number; agendamento: number; sequencia: number }>(
        tx,
        'bloco.movimento',
        m.chave,
      );
      if (ja) {
        if (ja.agendamento !== m.agendamento)
          throw recusa('chave-reutilizada', 'A chave do pedido já foi usada em outro paciente.');
        return { id: ja.id, sequencia: ja.sequencia, repetida: true, codigo: null };
      }
      const ag =
        (
          await tx.consultarParaAtualizar(
            `SELECT a.id, a.atendimento_id, a.paciente_id, s.unidade_cirurgica_id FROM agendamento_cirurgico a
           JOIN sala_cirurgica s ON s.id = a.sala_cirurgica_id
          WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
            [m.agendamento, est],
          )
        )[0] ?? null;
      if (!ag) throw recusa('registro-inexistente', 'O agendamento não existe neste estabelecimento.');
      const ultimo = n(
        (
          await tx.uma<{ q: number }>(
            'SELECT COUNT(*) AS q FROM movimento_paciente_bloco WHERE agendamento_cirurgico_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [m.agendamento, est],
          )
        )?.q,
      );
      if (ultimo !== m.ultimoVisto)
        throw recusa('rastreio-mudou', 'O paciente foi movido em outro aparelho: recarregue e confira.');
      const atendimento = m.reg > 0 ? m.reg : nn(ag['atendimento_id']);
      const paciente = m.paciente ?? nn(ag['paciente_id']);
      if (atendimento === null || paciente === null)
        throw recusa(
          'rastreio-sem-atendimento',
          'O agendamento não tem o atendimento e o paciente do rastreio.',
        );
      // Na saída o local é o de onde o paciente sai (o anterior): o modelo guarda sempre o local do movimento.
      const local = m.local ?? m.localAnterior;
      if (local === null)
        throw recusa('local-obrigatorio', 'Informe o local do bloco do movimento.', { campos: ['local'] });
      const usuario = tx.contexto.usuario;
      if (usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
      const id = await tx.incluir('movimento_paciente_bloco', {
        estabelecimento_id: est,
        unidade_cirurgica_id: n(ag['unidade_cirurgica_id']),
        paciente_id: paciente,
        atendimento_id: atendimento,
        agendamento_cirurgico_id: m.agendamento,
        tipo_movimento_bloco_id: await idDoCadastro(
          tx,
          'tipo_movimento_bloco',
          m.tipo,
          'O tipo de movimento',
        ),
        local_bloco_id: local,
        anterior_local_bloco_id: m.localAnterior,
        sala_cirurgica_id: m.salaCirurgica,
        ocorrido_em: quando(m.em),
        responsavel_usuario_id: usuario,
        destino_saida: m.destino,
        observacao: m.observacao,
      });
      anotar('movimento_paciente_bloco', id);
      let codigo: string | null = null;
      if (m.codigo) {
        const doDia = await tx.uma<{ codigo: string }>(
          'SELECT codigo FROM codigo_painel_familia WHERE agendamento_cirurgico_id = ? AND dia = ? AND excluido_em IS NULL',
          [m.agendamento, m.codigo.dia],
        );
        if (doDia) codigo = texto(doDia.codigo);
        else {
          for (let t = 0; t < 8 && !codigo; t++) {
            const k = m.codigo.sortear();
            const usado = await tx.uma(
              'SELECT id FROM codigo_painel_familia WHERE estabelecimento_id = ? AND dia = ? AND codigo = ?',
              [est, m.codigo.dia, k],
            );
            if (!usado) codigo = k;
          }
          if (!codigo) throw recusa('rastreio-mudou', 'Não foi possível sortear o código do painel.');
          await tx.incluir('codigo_painel_familia', {
            estabelecimento_id: est,
            agendamento_cirurgico_id: m.agendamento,
            dia: m.codigo.dia,
            codigo,
            valido_ate: quando(m.codigo.validoAte),
          });
        }
      }
      if (m.estadoAgendamento)
        await gravadorCirurgia(tx).mudarEstado({
          id: m.estadoAgendamento.id,
          estado: m.estadoAgendamento.estado,
          usuario: m.usuario,
        });
      await anotarChave(tx, 'bloco.movimento', m.chave, {
        id,
        agendamento: m.agendamento,
        sequencia: ultimo + 1,
      });
      return { id, sequencia: ultimo + 1, repetida: false, codigo };
    },
  };
}

export class PortaBlocoSeguroPropria implements PortaBlocoSeguro {
  readonly destino = 'banco' as const;
  private executorCriado: Executor | null;

  constructor(
    private readonly nucleo: Pick<NucleoCirurgia, 'lerSomente'> &
      Partial<Pick<NucleoCirurgia, 'criarExecutor'>>,
    executorPronto?: Executor,
  ) {
    this.executorCriado = executorPronto ?? null;
  }

  /** O Executor nasce na primeira gravação (a porta só de leitura não precisa dele). */
  private get executor(): Executor {
    if (!this.executorCriado) {
      if (!this.nucleo.criarExecutor) throw new Error('Porta sem o núcleo de gravação.');
      this.executorCriado = this.nucleo.criarExecutor();
    }
    return this.executorCriado;
  }

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

  async podeGravar(c: ContextoPortaM18): Promise<LiberacaoGravacao> {
    if (c.estabelecimento === null)
      return { pode: false, codigo: 'sem-estabelecimento', motivo: 'Escolha o estabelecimento da sessão.' };
    return { pode: true, codigo: null, motivo: null };
  }
  executar(_c: ContextoPortaM18, op: string): Promise<never> {
    return Promise.reject(
      recusa('operacao-desconhecida', `Operação ${op} sem gravação pelo Executor no bloco.`),
    );
  }

  /** Gravação direta do checklist e do rastreio, pelo Executor, com a trilha e a idempotência na mesma transação. */
  gravarSgh<T>(
    c: ContextoGravacaoCirurgia,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao) | null,
    fn: (g: GravadorBlocoSeguro) => Promise<T>,
  ): Promise<T> {
    return gravarDiretoNoBloco(
      this.executor,
      c,
      {
        nome: 'bloco.gravacao-direta',
        tabelas: TABELAS_BLOCO_SEGURO,
        tabelaPadrao: 'checklist_cirurgia_segura',
        trilha,
        gravador: (tx, est, fuso, escrita) =>
          gravadorBlocoSeguro(tx, est, fuso, escrita, {
            checklists: (l, e, f, ags) => this.checklistsDe(l, e, f, ags),
            movimentos: (l, e, f, ags) => this.movimentosPorAgendamento(l, e, f, ags),
          }),
      },
      fn,
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
      // O checklist é aberto pelo agendamento antes do ato (c.agendamento_cirurgico_id, 08_CC/04) ou pelo ato: o
      // agendamento é o do checklist ou, sem ele, o do ato; sala, atendimento e paciente vêm do ato e, antes dele, do
      // agendamento. Colunas nomeadas (c.* já traz agendamento_cirurgico_id: o driver recusa nome repetido).
      `SELECT c.*, a.id AS agendamento_id, COALESCE(t.sala_cirurgica_id, a.sala_cirurgica_id) AS sala_id,
              COALESCE(t.atendimento_id, a.atendimento_id) AS atendimento_ref,
              COALESCE(t.paciente_id, a.paciente_id) AS paciente_ref, a.inicio_previsto_em
         FROM checklist_cirurgia_segura c LEFT JOIN ato_cirurgico t ON t.id = c.ato_cirurgico_id AND t.excluido_em IS NULL
         JOIN agendamento_cirurgico a ON a.id = COALESCE(c.agendamento_cirurgico_id, t.agendamento_cirurgico_id)
        WHERE a.estabelecimento_id = ? AND a.id IN (${lista(ags.length)})
          AND c.excluido_em IS NULL AND (c.ato_cirurgico_id IS NULL OR t.id IS NOT NULL)`,
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
      const ag = n(x['agendamento_id']);
      m.set(ag, {
        id,
        agendamento: ag,
        sala: n(x['sala_id']),
        dataHora: (civil(x['inicio_previsto_em'], fuso) ?? '').replace(' ', 'T'),
        reg: n(x['atendimento_ref']),
        paciente: nn(x['paciente_ref']),
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
        destino: (textoOuNulo(x['destino_saida']) as MovimentoDoBloco['destino']) ?? null,
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

  /** Os códigos do painel para familiares ainda válidos em `agora` (o mais recente de cada agendamento). */
  codigos(
    c: ContextoPortaM18,
    agora: string,
    agendamentos?: readonly number[],
  ): Promise<Map<number, CodigoDoPainel>> {
    if (agendamentos && agendamentos.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est, fuso) => {
      const filtro = agendamentos ? ` AND agendamento_cirurgico_id IN (${lista(agendamentos.length)})` : '';
      const r = await l.consultar(
        `SELECT agendamento_cirurgico_id, dia, codigo, valido_ate FROM codigo_painel_familia
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND valido_ate >= ?${filtro}
          ORDER BY dia, id LIMIT 2000`,
        [est, instante(agora, fuso), ...(agendamentos ?? [])],
      );
      const m = new Map<number, CodigoDoPainel>();
      for (const x of r)
        m.set(n(x['agendamento_cirurgico_id']), {
          agendamento: n(x['agendamento_cirurgico_id']),
          dia: dataOuNulo(x['dia']) ?? '',
          codigo: texto(x['codigo']),
          validoAte: (civil(x['valido_ate'], fuso) ?? '').replace(' ', 'T'),
        });
      return m;
    });
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaBlocoSeguroIndisponivel(): PortaBlocoSeguro {
  return portaIndisponivel<PortaBlocoSeguro>(METODOS_PORTA_BLOCO_SEGURO);
}
