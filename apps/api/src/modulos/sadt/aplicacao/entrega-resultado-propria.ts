// Entrega de resultados no banco do cliente (F3.5, 05-SADT linha 21): o prazo de entrega por setor e exame, o
// protocolo de entrega no balcão (visão por paciente: o que está pronto, o que já saiu e a previsão do que falta) e a
// publicação no portal conforme o perfil (setores, dias de visibilidade) e o exame restrito. A regra mora em
// @sgh/dominio-sadt (portal/entrega.ts); aqui fica a leitura do cadastro e a gravação do que a regra decide, com a
// trilha na mesma transação. Nada se apaga: o prazo, a restrição e o perfil são desativados e o protocolo é cancelado
// com motivo.
import {
  ATENDIMENTOS_PRAZO,
  type AtendimentoPrazo,
  conferirCancelamentoEntrega,
  conferirEntrega,
  conferirPerfilPortal,
  conferirPrazo,
  conferirRestricaoPortal,
  escolherPrazo,
  type PerfilPortal,
  type PrazoEntrega,
  preverEntrega,
  PRIORIDADES_PRAZO,
  type PrioridadePrazo,
  publicacaoNoPortal,
  PUBLICOS_PORTAL,
  type PublicoPortal,
  RecusaEntrega,
  REGRAS_RESTRICAO_PORTAL,
  type RegraRestricaoPortal,
  restricaoVigente,
  type SituacaoPrazo,
  situacaoDoPrazo,
} from '@sgh/dominio-sadt';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FUSO_PADRAO, relogioNoFuso } from '../../exames/relogio.js';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const tn = (v: unknown) => (v === null || v === undefined ? null : String(v));
const sim = (v: unknown) => Boolean(Number(v ?? 0));
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const instante = (v: unknown): Date => (v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`));
const instanteOuNulo = (v: unknown): Date | null => (v === null || v === undefined ? null : instante(v));
const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

const TABELAS = [
  'prazo_entrega_exame',
  'exame_restricao_portal',
  'perfil_portal_resultado',
  'perfil_portal_setor',
  'entrega_resultado',
  'entrega_resultado_item',
  'item_exame_evento',
  'sequencia_negocio',
] as const;
export const TIPO_NUMERO_ENTREGA = 'entrega_resultado';
const PREFIXO_NUMERO_ENTREGA = 'ER-';
const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'] as const;

// ── Entradas ───────────────────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const esquemaPrazoEntrega = z.object({
  exame: id,
  setor: id.nullable().default(null),
  setorSolicitante: id.nullable().default(null),
  material: id.nullable().default(null),
  prioridade: z.enum(PRIORIDADES_PRAZO).default('rotina'),
  tipoAtendimento: z.enum(ATENDIMENTOS_PRAZO).nullable().default(null),
  prazoDias: z.number().int().min(0).max(365).default(0),
  prazoMinutos: z.number().int().min(0).max(525_600).nullable().default(null),
  tempoMedioMinutos: z.number().int().min(0).max(525_600).nullable().default(null),
  horarioCorte: hora.nullable().default(null),
  diasDaSemana: z.array(z.boolean()).length(7).default([true, true, true, true, true, true, true]),
});

export const esquemaRestricaoPortal = z.object({
  exame: id,
  regra: z.enum(REGRAS_RESTRICAO_PORTAL).default('nunca_publicar'),
  diasCarencia: z.number().int().min(1).max(365).nullable().default(null),
  motivo: z.string().trim().max(500).nullable().default(null),
  /** Vale em todos os estabelecimentos do cliente (só o administrador); senão, só no da sessão. */
  global: z.boolean().default(false),
});

export const esquemaPerfilPortal = z.object({
  /** Com o id, altera o perfil (a versão lida vem junto); sem ele, inclui. */
  id: id.nullable().default(null),
  versao: z.number().int().positive().nullable().default(null),
  codigo: z.string().trim().min(2).max(30),
  descricao: z.string().trim().min(3).max(150),
  publico: z.enum(PUBLICOS_PORTAL),
  setores: z.array(id).max(200).default([]),
  ocultaExameRestrito: z.boolean().default(true),
  diasVisibilidade: z.number().int().min(1).max(36_500).nullable().default(null),
  periodoPadrao: z
    .enum(['hoje', 'ontem', 'ultimos_7_dias', 'ultimos_30_dias', 'todos'])
    .default('ultimos_30_dias'),
  atualizacaoMinutos: z.number().int().min(1).max(1440).nullable().default(null),
  visualizaImagem: z.boolean().default(false),
  permiteDependente: z.boolean().default(false),
  global: z.boolean().default(false),
});

export const esquemaRegistrarEntrega = z.object({
  paciente: id,
  itens: z.array(id).min(1).max(200),
  forma: id.nullable().default(null),
  retiradoPeloPaciente: z.boolean().default(true),
  nomeResponsavel: z.string().trim().max(150).nullable().default(null),
  parentesco: id.nullable().default(null),
  cpfResponsavel: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .nullable()
    .default(null),
  documentoResponsavel: z.string().trim().max(30).nullable().default(null),
  telefoneResponsavel: z.string().trim().max(20).nullable().default(null),
  observacao: z.string().trim().max(500).nullable().default(null),
});

export const esquemaCancelarEntrega = z.object({ motivo: z.string().trim().min(1).max(500) });

// ── Saídas ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PrazoCadastrado extends PrazoEntrega {
  readonly exameNome: string;
  readonly tempoMedioMinutos: number | null;
  readonly ativo: boolean;
}
export interface RestricaoCadastrada {
  readonly id: number;
  readonly exame: number;
  readonly exameNome: string;
  readonly regra: RegraRestricaoPortal;
  readonly diasCarencia: number | null;
  readonly motivo: string | null;
  readonly global: boolean;
  readonly ativo: boolean;
}
export interface PerfilCadastrado extends PerfilPortal {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly publico: PublicoPortal;
  readonly periodoPadrao: string;
  readonly atualizacaoMinutos: number | null;
  readonly visualizaImagem: boolean;
  readonly permiteDependente: boolean;
  readonly global: boolean;
  readonly ativo: boolean;
}
type Opcao = { id: number; nome: string };
export interface CadastroEntrega {
  readonly prazos: readonly PrazoCadastrado[];
  readonly restricoes: readonly RestricaoCadastrada[];
  readonly perfis: readonly PerfilCadastrado[];
  readonly setores: readonly Opcao[];
  readonly setoresSolicitantes: readonly Opcao[];
  readonly materiais: readonly Opcao[];
}

export interface ExameNoBalcao {
  readonly item: number;
  readonly pedido: string;
  readonly exame: string;
  readonly setor: string | null;
  readonly pedidoEm: string;
  readonly liberado: boolean;
  /** Previsão de entrega (data civil do estabelecimento), do pedido ou calculada pelo prazo cadastrado. */
  readonly previsto: string | null;
  readonly situacaoPrazo: SituacaoPrazo;
}
export interface ProtocoloEntrega {
  readonly id: number;
  readonly numero: string;
  readonly situacao: 'entregue' | 'cancelada';
  readonly entregueEm: string;
  readonly entreguePor: string | null;
  readonly forma: string | null;
  readonly retiradoPeloPaciente: boolean;
  readonly nomeResponsavel: string | null;
  readonly documentoResponsavel: string | null;
  readonly motivoCancelamento: string | null;
  readonly observacao: string | null;
  readonly exames: readonly { item: number; exame: string; pedido: string }[];
}
export interface BalcaoDoPaciente {
  readonly paciente: { id: number; nome: string; nascimento: string | null } | null;
  /** Liberados e ainda não entregues: é o que sai agora. */
  readonly prontos: readonly ExameNoBalcao[];
  /** Pedidos ainda sem resultado liberado, com a previsão. */
  readonly aguardando: readonly ExameNoBalcao[];
  readonly entregas: readonly ProtocoloEntrega[];
  readonly formas: readonly Opcao[];
  readonly parentescos: readonly Opcao[];
}

export interface OpcoesDaEntrega {
  readonly administrador: boolean;
}
const SEM_ALCANCE_GLOBAL = 'Só o administrador cadastra ou desativa o que vale em todos os estabelecimentos.';

function daRegra<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RecusaEntrega) throw recusa(e.codigo, e.message);
    throw e;
  }
}

const prazoDe = (r: Linha): PrazoEntrega => ({
  id: n(r['id']),
  exame: n(r['exame_id']),
  setor: nn(r['setor_diagnostico_id']),
  setorSolicitante: nn(r['setor_funcional_id']),
  material: nn(r['material_biologico_id']),
  prioridade: texto(r['prioridade']) as PrioridadePrazo,
  tipoAtendimento: tn(r['tipo_atendimento']) as AtendimentoPrazo | null,
  prazoDias: n(r['prazo_dias']),
  prazoMinutos: nn(r['prazo_minutos']),
  horarioCorte:
    r['horario_corte'] === null || r['horario_corte'] === undefined
      ? null
      : texto(r['horario_corte']).slice(0, 5),
  diasDaSemana: DIAS.map((d) => sim(r[`realiza_${d}`])),
});

/** A prioridade do pedido no vocabulário do prazo. */
const prioridadeDoPedido = (p: string, urgente: boolean): PrioridadePrazo =>
  p === 'emergencia' ? 'emergencia' : p === 'urgente' || urgente ? 'urgencia' : 'rotina';
const atendimentoDoTipoBase = (t: string | null): AtendimentoPrazo | null => {
  const v = t === 'ambulatorio' ? 'ambulatorial' : t;
  return (ATENDIMENTOS_PRAZO as readonly string[]).includes(v ?? '') ? (v as AtendimentoPrazo) : null;
};

const SQL_ITENS_DO_PACIENTE = `
  SELECT ei.id AS item, ei.exame_id, ei.situacao, ei.urgente, ei.previsto_em, ei.material_biologico_id,
         COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id) AS setor, sd.nome AS setor_nome, e.nome AS exame_nome,
         r.numero AS pedido, r.prioridade, r.solicitado_em, a.setor_funcional_id, ca.tipo_base,
         COALESCE(ei.liberado_em, (SELECT MAX(re.liberado_em) FROM resultado_exame re
                                    WHERE re.exame_item_id = ei.id AND re.excluido_em IS NULL
                                      AND re.situacao IN ('liberado', 'retificado'))) AS liberado_em,
         EXISTS (SELECT 1 FROM entrega_resultado_item x JOIN entrega_resultado er ON er.id = x.entrega_resultado_id
                  WHERE x.exame_item_id = ei.id AND x.excluido_em IS NULL AND er.situacao = 'entregue'
                    AND er.excluido_em IS NULL) AS entregue
    FROM exame_item ei
    JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id AND r.excluido_em IS NULL
    JOIN exame e ON e.id = ei.exame_id
    LEFT JOIN setor_diagnostico sd ON sd.id = COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id)
    LEFT JOIN atendimento a ON a.id = r.atendimento_id
    LEFT JOIN categoria_atendimento ca ON ca.id = a.categoria_atendimento_id
   WHERE r.estabelecimento_id = ? AND ei.excluido_em IS NULL AND ei.situacao NOT IN ('cancelado', 'recusado')`;

export class ServicoEntregaResultado {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSadt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ctxNucleo(c: ContextoSadt): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: (c.correlacao || 'sadt').slice(0, 64),
    };
  }

  private est(c: ContextoSadt): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private async gravar(
    c: ContextoSadt,
    nome: string,
    tabela: string,
    fn: (tx: TxOperacao, est: number) => Promise<number>,
    motivo: string | null = null,
  ): Promise<{ id: number }> {
    const est = this.est(c);
    let gravado: number | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        gravado = await fn(tx, est);
        return { id: gravado };
      },
      alvo: () => ({ tabela, id: gravado }),
      trilha: () => ({ dados: { evento: nome }, motivo }),
    });
    const chave = `sadt-entrega:${c.chaveIdempotencia ?? randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    return { id: gravado ?? n(r.resultado['id']) };
  }

  // ── Cadastro: prazo, exame restrito e perfil do portal ───────────────────────────────────────────────────────

  cadastro(c: ContextoSadt): Promise<CadastroEntrega> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const prazos = (
        await l.consultar(
          `SELECT p.*, e.nome AS exame_nome FROM prazo_entrega_exame p JOIN exame e ON e.id = p.exame_id
            WHERE p.estabelecimento_id = ? ORDER BY p.ativo DESC, e.nome, p.id DESC LIMIT 1000`,
          [est],
        )
      ).map((r) => ({
        ...prazoDe(r),
        exameNome: texto(r['exame_nome']),
        tempoMedioMinutos: nn(r['tempo_medio_minutos']),
        ativo: sim(r['ativo']),
      }));
      const restricoes = (
        await l.consultar(
          `SELECT x.*, e.nome AS exame_nome FROM exame_restricao_portal x JOIN exame e ON e.id = x.exame_id
            WHERE x.estabelecimento_id = ? OR x.estabelecimento_id IS NULL ORDER BY x.ativo DESC, e.nome LIMIT 1000`,
          [est],
        )
      ).map((r) => ({
        id: n(r['id']),
        exame: n(r['exame_id']),
        exameNome: texto(r['exame_nome']),
        regra: texto(r['regra']) as RegraRestricaoPortal,
        diasCarencia: nn(r['dias_carencia']),
        motivo: tn(r['motivo']),
        global: r['estabelecimento_id'] === null || r['estabelecimento_id'] === undefined,
        ativo: sim(r['ativo']),
      }));
      const perfisL = await l.consultar(
        `SELECT * FROM perfil_portal_resultado WHERE estabelecimento_id = ? OR estabelecimento_id IS NULL
          ORDER BY ativo DESC, descricao LIMIT 500`,
        [est],
      );
      const setoresDosPerfis = await setoresPorPerfil(
        l,
        perfisL.map((r) => n(r['id'])),
      );
      const perfis = perfisL.map((r) => perfilDe(r, setoresDosPerfis.get(n(r['id'])) ?? []));
      const opcao = (r: Linha) => ({ id: n(r['id']), nome: texto(r['nome']) });
      const setores = (
        await l.consultar(
          'SELECT id, nome FROM setor_diagnostico WHERE estabelecimento_id = ? AND ativo = TRUE ORDER BY nome LIMIT 2000',
          [est],
        )
      ).map(opcao);
      const setoresSolicitantes = (
        await l.consultar(
          'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND ativo = TRUE ORDER BY nome LIMIT 2000',
          [est],
        )
      ).map(opcao);
      const materiais = (
        await l.consultar(
          'SELECT id, descricao AS nome FROM material_biologico WHERE ativo = TRUE ORDER BY descricao LIMIT 2000',
          [],
        )
      ).map(opcao);
      return { prazos, restricoes, perfis, setores, setoresSolicitantes, materiais };
    });
  }

  async incluirPrazo(c: ContextoSadt, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaPrazoEntrega.parse(entrada);
    daRegra(() => conferirPrazo(e));
    return this.gravar(c, 'sadt.entrega.prazo.incluido', 'prazo_entrega_exame', async (tx, est) => {
      await exameExiste(tx, e.exame);
      if (e.setor !== null) await setorDoEstabelecimento(tx, e.setor, est);
      // Um prazo ativo por combinação: o novo substitui o anterior (que fica no histórico, desativado).
      const iguais = await tx.consultar(
        `SELECT id, versao FROM prazo_entrega_exame
          WHERE estabelecimento_id = ? AND exame_id = ? AND prioridade = ? AND ativo = TRUE
            AND setor_diagnostico_id <=> ? AND setor_funcional_id <=> ? AND material_biologico_id <=> ?
            AND tipo_atendimento <=> ?`,
        [est, e.exame, e.prioridade, e.setor, e.setorSolicitante, e.material, e.tipoAtendimento],
      );
      for (const r of iguais)
        await tx.alterar('prazo_entrega_exame', n(r['id']), n(r['versao']), { ativo: false });
      const dias = Object.fromEntries(DIAS.map((d, i) => [`realiza_${d}`, e.diasDaSemana[i] === true]));
      return tx.incluir('prazo_entrega_exame', {
        estabelecimento_id: est,
        exame_id: e.exame,
        setor_diagnostico_id: e.setor,
        setor_funcional_id: e.setorSolicitante,
        material_biologico_id: e.material,
        prioridade: e.prioridade,
        tipo_atendimento: e.tipoAtendimento,
        prazo_dias: e.prazoDias,
        prazo_minutos: e.prazoMinutos,
        tempo_medio_minutos: e.tempoMedioMinutos,
        horario_corte: e.horarioCorte === null ? null : `${e.horarioCorte}:00`,
        ...dias,
        ativo: true,
      });
    });
  }

  async incluirRestricao(
    c: ContextoSadt,
    entrada: unknown,
    o: OpcoesDaEntrega = { administrador: false },
  ): Promise<{ id: number }> {
    const e = esquemaRestricaoPortal.parse(entrada);
    if (e.global && !o.administrador) throw recusa('sem-permissao-global', SEM_ALCANCE_GLOBAL);
    daRegra(() => conferirRestricaoPortal(e));
    return this.gravar(c, 'sadt.entrega.restricao.incluida', 'exame_restricao_portal', async (tx, est) => {
      await exameExiste(tx, e.exame);
      const alcance = e.global ? null : est;
      const valores = { regra: e.regra, dias_carencia: e.diasCarencia, motivo: e.motivo, ativo: true };
      // Uma restrição por exame e alcance: a que já existe é atualizada (e reativada), com a trilha da mudança.
      const atual = await tx.uma(
        'SELECT id, versao FROM exame_restricao_portal WHERE exame_id = ? AND estabelecimento_id <=> ?',
        [e.exame, alcance],
      );
      if (atual) {
        await tx.alterar('exame_restricao_portal', n(atual['id']), n(atual['versao']), valores);
        return n(atual['id']);
      }
      return tx.incluir('exame_restricao_portal', {
        estabelecimento_id: alcance,
        exame_id: e.exame,
        ...valores,
      });
    });
  }

  async salvarPerfil(
    c: ContextoSadt,
    entrada: unknown,
    o: OpcoesDaEntrega = { administrador: false },
  ): Promise<{ id: number }> {
    const e = esquemaPerfilPortal.parse(entrada);
    if (e.global && !o.administrador) throw recusa('sem-permissao-global', SEM_ALCANCE_GLOBAL);
    daRegra(() => conferirPerfilPortal(e));
    return this.gravar(
      c,
      e.id === null ? 'sadt.entrega.perfil.incluido' : 'sadt.entrega.perfil.alterado',
      'perfil_portal_resultado',
      async (tx, est) => {
        for (const s of e.setores) await setorDoEstabelecimento(tx, s, est);
        const repetido = await tx.uma('SELECT id FROM perfil_portal_resultado WHERE codigo = ? AND id <> ?', [
          e.codigo,
          e.id ?? 0,
        ]);
        if (repetido)
          throw recusa('perfil-codigo-repetido', 'Já existe um perfil do portal com este código.');
        const valores = {
          codigo: e.codigo,
          descricao: e.descricao,
          publico: e.publico,
          estabelecimento_id: e.global ? null : est,
          oculta_exame_restrito: e.ocultaExameRestrito,
          dias_visibilidade: e.diasVisibilidade,
          periodo_padrao: e.periodoPadrao,
          atualizacao_automatica_minutos: e.atualizacaoMinutos,
          visualiza_imagem: e.visualizaImagem,
          permite_dependente: e.permiteDependente,
          ativo: true,
        };
        let perfil: number;
        if (e.id === null) perfil = await tx.incluir('perfil_portal_resultado', valores);
        else {
          const atual = await perfilDoAlcance(tx, e.id, est, o);
          await tx.alterar('perfil_portal_resultado', e.id, e.versao ?? n(atual['versao']), valores);
          perfil = e.id;
        }
        // Os setores do perfil: o que saiu é excluído logicamente; o que voltou é reativado; o novo é incluído.
        const atuais = await tx.consultar(
          'SELECT id, versao, setor_diagnostico_id, excluido_em FROM perfil_portal_setor WHERE perfil_portal_resultado_id = ?',
          [perfil],
        );
        const querem = new Set(e.setores);
        for (const r of atuais) {
          const setor = n(r['setor_diagnostico_id']);
          const vivo = r['excluido_em'] === null || r['excluido_em'] === undefined;
          if (vivo && !querem.has(setor))
            await tx.alterar('perfil_portal_setor', n(r['id']), n(r['versao']), {
              excluido_em: new Date(),
              excluido_por: c.usuario ?? null,
            });
          else if (!vivo && querem.has(setor))
            await tx.alterar('perfil_portal_setor', n(r['id']), n(r['versao']), {
              excluido_em: null,
              excluido_por: null,
            });
          querem.delete(setor);
        }
        for (const s of querem)
          await tx.incluir('perfil_portal_setor', {
            perfil_portal_resultado_id: perfil,
            setor_diagnostico_id: s,
          });
        return perfil;
      },
    );
  }

  /** Desativa o prazo, a restrição ou o perfil (nunca apaga). */
  async desativar(
    c: ContextoSadt,
    tipo: 'prazo' | 'restricao' | 'perfil',
    alvo: number,
    o: OpcoesDaEntrega = { administrador: false },
  ): Promise<{ id: number }> {
    const tabela = TABELAS_DO_CADASTRO[tipo];
    return this.gravar(c, `sadt.entrega.${tipo}.desativado`, tabela, async (tx, est) => {
      const r = await tx.uma(
        tipo === 'prazo'
          ? `SELECT id, versao, ativo, estabelecimento_id FROM ${tabela} WHERE id = ? AND estabelecimento_id = ?`
          : `SELECT id, versao, ativo, estabelecimento_id FROM ${tabela}
              WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)`,
        [alvo, est],
      );
      if (!r) throw recusa('nao-encontrado', 'O registro não existe neste estabelecimento.');
      if (r['estabelecimento_id'] === null && !o.administrador)
        throw recusa('sem-permissao-global', SEM_ALCANCE_GLOBAL);
      if (!sim(r['ativo'])) throw recusa('ja-inativo', 'O registro já está desativado.');
      await tx.alterar(tabela, alvo, n(r['versao']), { ativo: false });
      return alvo;
    });
  }

  // ── Balcão: a visão por paciente ─────────────────────────────────────────────────────────────────────────────

  /**
   * O balcão acha o paciente pelo número do pedido de exames ou do atendimento (o que ele traz no comprovante) e vê,
   * de uma vez, tudo o que é dele: o que está pronto para sair, o que ainda falta (com a previsão) e o que já saiu.
   */
  balcao(c: ContextoSadt, busca: string): Promise<BalcaoDoPaciente> {
    const est = this.est(c);
    const termo = busca.trim().slice(0, 30);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const opcoes = await opcoesDoBalcao(l);
      if (termo === '') return { paciente: null, prontos: [], aguardando: [], entregas: [], ...opcoes };
      const achado =
        (await l.uma(
          'SELECT paciente_id AS p FROM requisicao_exame WHERE estabelecimento_id = ? AND numero = ? AND excluido_em IS NULL',
          [est, termo],
        )) ??
        (await l.uma('SELECT paciente_id AS p FROM atendimento WHERE estabelecimento_id = ? AND numero = ?', [
          est,
          termo,
        ]));
      if (!achado) return { paciente: null, prontos: [], aguardando: [], entregas: [], ...opcoes };
      const paciente = n(achado['p']);
      const pf = await l.uma(
        `SELECT pf.nome, pf.nome_social, pf.usa_nome_social, pf.data_nascimento
           FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = ?`,
        [paciente],
      );
      const fuso = await fusoDe(l, est);
      const civil = (d: Date) => {
        const r = relogioNoFuso(fuso, d);
        return `${r.hoje}T${r.hora}`;
      };
      const agora = civil(new Date());
      const itens = await l.consultar(
        `${SQL_ITENS_DO_PACIENTE} AND r.paciente_id = ? ORDER BY r.solicitado_em DESC, ei.sequencia LIMIT 500`,
        [est, paciente],
      );
      const prazos = await prazosDosExames(l, est, [...new Set(itens.map((r) => n(r['exame_id'])))]);
      const prontos: ExameNoBalcao[] = [];
      const aguardando: ExameNoBalcao[] = [];
      for (const r of itens) {
        if (sim(r['entregue'])) continue;
        const liberadoEm = instanteOuNulo(r['liberado_em']);
        const liberado = liberadoEm !== null && ['liberado', 'entregue'].includes(texto(r['situacao']));
        const pedidoEm = civil(instante(r['solicitado_em']));
        const previstoDoPedido = instanteOuNulo(r['previsto_em']);
        const prazo = escolherPrazo(prazos, {
          exame: n(r['exame_id']),
          setor: nn(r['setor']),
          setorSolicitante: nn(r['setor_funcional_id']),
          material: nn(r['material_biologico_id']),
          prioridade: prioridadeDoPedido(texto(r['prioridade']), sim(r['urgente'])),
          tipoAtendimento: atendimentoDoTipoBase(tn(r['tipo_base'])),
        });
        const previsto = previstoDoPedido
          ? civil(previstoDoPedido)
          : prazo
            ? preverEntrega(prazo, pedidoEm)
            : null;
        const linha: ExameNoBalcao = {
          item: n(r['item']),
          pedido: texto(r['pedido']),
          exame: texto(r['exame_nome']),
          setor: tn(r['setor_nome']),
          pedidoEm,
          liberado,
          previsto,
          situacaoPrazo: situacaoDoPrazo(previsto, agora, liberado && liberadoEm ? civil(liberadoEm) : null),
        };
        (liberado ? prontos : aguardando).push(linha);
      }
      const entregas = await protocolos(l, est, 'er.paciente_id = ?', [paciente], civil);
      return {
        paciente: {
          id: paciente,
          nome:
            sim(pf?.['usa_nome_social']) && pf?.['nome_social']
              ? texto(pf['nome_social'])
              : texto(pf?.['nome']),
          nascimento: dataIso(pf?.['data_nascimento']),
        },
        prontos,
        aguardando,
        entregas,
        ...opcoes,
      };
    });
  }

  /** O protocolo de entrega para a impressão (do estabelecimento da sessão). */
  protocolo(c: ContextoSadt, entrega: number): Promise<ProtocoloEntrega | null> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const fuso = await fusoDe(l, est);
      const civil = (d: Date) => {
        const r = relogioNoFuso(fuso, d);
        return `${r.hoje}T${r.hora}`;
      };
      return (await protocolos(l, est, 'er.id = ?', [entrega], civil))[0] ?? null;
    });
  }

  /** Registra a entrega no balcão: um protocolo numerado com os exames entregues e quem retirou. */
  async registrar(c: ContextoSadt, entrada: unknown): Promise<{ id: number; numero: string }> {
    const e = esquemaRegistrarEntrega.parse(entrada);
    const cpf = e.cpfResponsavel && e.cpfResponsavel !== '' ? e.cpfResponsavel : null;
    let numero = '';
    const r = await this.gravar(c, 'sadt.entrega.registrada', 'entrega_resultado', async (tx, est) => {
      if (c.usuario === null || c.usuario === undefined)
        throw recusa('sem-usuario', 'A entrega precisa do usuário que entregou.');
      // Trava os exames da entrega: dois balcões não entregam o mesmo exame ao mesmo tempo.
      await tx.consultarParaAtualizar(`SELECT id FROM exame_item WHERE id IN (${lista(e.itens.length)})`, [
        ...e.itens,
      ]);
      const itens = await tx.consultar(
        `${SQL_ITENS_DO_PACIENTE} AND r.paciente_id = ? AND ei.id IN (${lista(e.itens.length)})`,
        [est, e.paciente, ...e.itens],
      );
      const lidos = new Map(itens.map((x) => [n(x['item']), x]));
      if (e.itens.some((i) => !lidos.has(i)))
        throw recusa('entrega-item-de-outro', 'Há exame que não é deste paciente neste estabelecimento.');
      daRegra(() =>
        conferirEntrega({
          retiradoPeloPaciente: e.retiradoPeloPaciente,
          nomeResponsavel: e.nomeResponsavel,
          cpfResponsavel: cpf,
          documentoResponsavel: e.documentoResponsavel,
          itens: e.itens.map((i) => {
            const x = lidos.get(i)!;
            return {
              item: i,
              liberado: x['liberado_em'] !== null && ['liberado', 'entregue'].includes(texto(x['situacao'])),
              jaEntregue: sim(x['entregue']),
            };
          }),
        }),
      );
      if (e.forma !== null) {
        const f = await tx.uma('SELECT id FROM forma_entrega_resultado WHERE id = ? AND ativo = TRUE', [
          e.forma,
        ]);
        if (!f) throw recusa('forma-inexistente', 'A forma de entrega não existe.');
      }
      const agora = new Date();
      // A primeira entrega do estabelecimento cria a numeração (ninguém precisa configurá-la antes).
      await garantirSequencia(
        tx,
        { tipo: TIPO_NUMERO_ENTREGA, estabelecimento: est, prefixo: PREFIXO_NUMERO_ENTREGA },
        { usuario: c.usuario, agora },
      );
      numero = (await tx.proximoNumero(TIPO_NUMERO_ENTREGA)).formatado;
      const setores = new Set(e.itens.map((i) => nn(lidos.get(i)!['setor'])));
      const terceiro = !e.retiradoPeloPaciente;
      const entrega = await tx.incluir('entrega_resultado', {
        estabelecimento_id: est,
        numero,
        paciente_id: e.paciente,
        setor_diagnostico_id: setores.size === 1 ? [...setores][0] : null,
        forma_entrega_resultado_id: e.forma,
        protocolado_em: agora,
        entregue_em: agora,
        entregue_por_usuario_id: c.usuario,
        retirado_pelo_paciente: e.retiradoPeloPaciente,
        nome_responsavel: terceiro ? e.nomeResponsavel : null,
        tipo_parentesco_id: terceiro ? e.parentesco : null,
        cpf_responsavel: terceiro ? cpf : null,
        documento_responsavel: terceiro ? e.documentoResponsavel : null,
        telefone_responsavel: terceiro ? e.telefoneResponsavel : null,
        situacao: 'entregue',
        observacao: e.observacao,
      });
      let seq = 0;
      for (const i of e.itens) {
        const x = lidos.get(i)!;
        const laudo = await tx.uma(
          `SELECT id FROM laudo_diagnostico WHERE exame_item_id = ? AND excluido_em IS NULL
              AND situacao IN ('assinado', 'emitido', 'retificado') ORDER BY id DESC LIMIT 1`,
          [i],
        );
        seq += 1;
        await tx.incluir('entrega_resultado_item', {
          entrega_resultado_id: entrega,
          sequencia: seq,
          exame_item_id: i,
          laudo_diagnostico_id: laudo ? n(laudo['id']) : null,
        });
        // O histórico do exame ganha o fato da entrega (a situação do exame não muda).
        await tx.incluir('item_exame_evento', {
          exame_item_id: i,
          ocorrido_em: agora,
          usuario_id: c.usuario,
          evento: 'entregue',
          situacao_anterior: texto(x['situacao']),
          situacao_nova: texto(x['situacao']),
          motivo: `Protocolo de entrega ${numero}`,
          setor_diagnostico_id: nn(x['setor']),
        });
      }
      return entrega;
    });
    if (numero === '') {
      // Repetição pela mesma chave: o protocolo já gravado.
      const p = await this.nucleo.lerSomente(this.ctxNucleo(c), (l) =>
        l.uma('SELECT numero FROM entrega_resultado WHERE id = ?', [r.id]),
      );
      numero = texto(p?.['numero']);
    }
    return { id: r.id, numero };
  }

  /** Cancela o protocolo com o motivo (fica no histórico; os exames voltam a ficar prontos para a entrega). */
  async cancelar(c: ContextoSadt, entrega: number, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaCancelarEntrega.parse(entrada);
    return this.gravar(
      c,
      'sadt.entrega.cancelada',
      'entrega_resultado',
      async (tx, est) => {
        const r = await tx.uma(
          'SELECT id, versao, situacao FROM entrega_resultado WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [entrega, est],
        );
        if (!r) throw recusa('nao-encontrado', 'O protocolo não existe neste estabelecimento.');
        daRegra(() => conferirCancelamentoEntrega(texto(r['situacao']), e.motivo));
        await tx.alterar('entrega_resultado', entrega, n(r['versao']), {
          situacao: 'cancelada',
          cancelado_em: new Date(),
          motivo_cancelamento: e.motivo,
        });
        return entrega;
      },
      e.motivo,
    );
  }

  // ── Portal: o que o perfil pode ver ──────────────────────────────────────────────────────────────────────────

  /**
   * Das liberações publicadas, as que este público do portal pode ver agora: os setores e os dias de visibilidade do
   * perfil cadastrado e a restrição do exame (nunca publica, só depois da entrega no balcão, só depois da carência).
   * Sem perfil e sem restrição cadastrados, tudo o que já era publicado segue visível.
   */
  publicaveisNoPortal(
    c: ContextoSadt,
    publico: PublicoPortal,
    liberacoes: readonly number[],
  ): Promise<Set<number>> {
    const est = this.est(c);
    if (liberacoes.length === 0) return Promise.resolve(new Set());
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const pr = await l.uma(
        `SELECT * FROM perfil_portal_resultado WHERE ativo = TRUE AND publico = ?
            AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
          ORDER BY (estabelecimento_id IS NULL), id DESC LIMIT 1`,
        [publico, est],
      );
      const perfil = pr
        ? perfilDe(pr, (await setoresPorPerfil(l, [n(pr['id'])])).get(n(pr['id'])) ?? [])
        : null;
      const linhas = await l.consultar(
        `SELECT lp.id, ei.id AS item, ei.exame_id, COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id) AS setor,
                COALESCE(re.liberado_em, lp.liberado_em) AS liberado_em,
                EXISTS (SELECT 1 FROM entrega_resultado_item x JOIN entrega_resultado er ON er.id = x.entrega_resultado_id
                         WHERE x.exame_item_id = ei.id AND x.excluido_em IS NULL AND er.situacao = 'entregue'
                           AND er.excluido_em IS NULL) AS entregue
           FROM liberacao_resultado_portal lp
           JOIN resultado_exame re ON re.id = lp.resultado_exame_id
           JOIN exame_item ei ON ei.id = re.exame_item_id
           JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          WHERE lp.estabelecimento_id = ? AND lp.id IN (${lista(liberacoes.length)})`,
        [est, ...liberacoes],
      );
      const exames = [...new Set(linhas.map((r) => n(r['exame_id'])))];
      const restricoes =
        exames.length === 0
          ? []
          : await l.consultar(
              `SELECT exame_id, regra, dias_carencia, estabelecimento_id FROM exame_restricao_portal
                WHERE ativo = TRUE AND exame_id IN (${lista(exames.length)})
                  AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)`,
              [...exames, est],
            );
      const agora = new Date();
      const visiveis = new Set<number>();
      for (const r of linhas) {
        const restricao = restricaoVigente(
          restricoes
            .filter((x) => n(x['exame_id']) === n(r['exame_id']))
            .map((x) => ({
              regra: texto(x['regra']) as RegraRestricaoPortal,
              diasCarencia: nn(x['dias_carencia']),
              global: x['estabelecimento_id'] === null || x['estabelecimento_id'] === undefined,
            })),
        );
        const d = publicacaoNoPortal(
          perfil,
          restricao,
          {
            setor: nn(r['setor']),
            liberadoEm: instante(r['liberado_em']),
            entreguePresencialmente: sim(r['entregue']),
          },
          agora,
        );
        if (d.publica) visiveis.add(n(r['id']));
      }
      return visiveis;
    });
  }
}

const TABELAS_DO_CADASTRO = {
  prazo: 'prazo_entrega_exame',
  restricao: 'exame_restricao_portal',
  perfil: 'perfil_portal_resultado',
} as const;
export type TipoCadastroEntrega = keyof typeof TABELAS_DO_CADASTRO;
export const TIPOS_CADASTRO_ENTREGA = Object.keys(TABELAS_DO_CADASTRO) as TipoCadastroEntrega[];

const perfilDe = (r: Linha, setores: readonly number[]): PerfilCadastrado => ({
  id: n(r['id']),
  versao: n(r['versao']),
  codigo: texto(r['codigo']),
  descricao: texto(r['descricao']),
  publico: texto(r['publico']) as PublicoPortal,
  setores,
  ocultaExameRestrito: sim(r['oculta_exame_restrito']),
  diasVisibilidade: nn(r['dias_visibilidade']),
  periodoPadrao: texto(r['periodo_padrao']),
  atualizacaoMinutos: nn(r['atualizacao_automatica_minutos']),
  visualizaImagem: sim(r['visualiza_imagem']),
  permiteDependente: sim(r['permite_dependente']),
  global: r['estabelecimento_id'] === null || r['estabelecimento_id'] === undefined,
  ativo: sim(r['ativo']),
});

async function setoresPorPerfil(l: Leitor, perfis: readonly number[]): Promise<Map<number, number[]>> {
  const saida = new Map<number, number[]>();
  if (perfis.length === 0) return saida;
  const linhas = await l.consultar(
    `SELECT perfil_portal_resultado_id AS p, setor_diagnostico_id AS s FROM perfil_portal_setor
      WHERE excluido_em IS NULL AND perfil_portal_resultado_id IN (${lista(perfis.length)}) ORDER BY setor_diagnostico_id`,
    [...perfis],
  );
  for (const r of linhas) saida.set(n(r['p']), [...(saida.get(n(r['p'])) ?? []), n(r['s'])]);
  return saida;
}

async function prazosDosExames(l: Leitor, est: number, exames: readonly number[]): Promise<PrazoEntrega[]> {
  if (exames.length === 0) return [];
  return (
    await l.consultar(
      `SELECT * FROM prazo_entrega_exame WHERE estabelecimento_id = ? AND ativo = TRUE
          AND exame_id IN (${lista(exames.length)})`,
      [est, ...exames],
    )
  ).map(prazoDe);
}

async function fusoDe(l: Leitor, est: number): Promise<string> {
  const f = await l.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  return texto(f?.['fuso_horario']) || FUSO_PADRAO;
}

async function opcoesDoBalcao(l: Leitor): Promise<{ formas: Opcao[]; parentescos: Opcao[] }> {
  const opcao = (r: Linha) => ({ id: n(r['id']), nome: texto(r['nome']) });
  const formas = (
    await l.consultar(
      "SELECT id, descricao AS nome FROM forma_entrega_resultado WHERE ativo = TRUE AND canal = 'presencial' ORDER BY descricao LIMIT 200",
      [],
    )
  ).map(opcao);
  const parentescos = (
    await l.consultar(
      'SELECT id, descricao AS nome FROM tipo_parentesco WHERE ativo = TRUE AND proprio_paciente = FALSE ORDER BY descricao LIMIT 200',
      [],
    )
  ).map(opcao);
  return { formas, parentescos };
}

async function protocolos(
  l: Leitor,
  est: number,
  filtro: string,
  p: readonly unknown[],
  civil: (d: Date) => string,
): Promise<ProtocoloEntrega[]> {
  const linhas = await l.consultar(
    `SELECT er.*, f.descricao AS forma, u.nome AS entregue_por
       FROM entrega_resultado er
       LEFT JOIN forma_entrega_resultado f ON f.id = er.forma_entrega_resultado_id
       LEFT JOIN usuario u ON u.id = er.entregue_por_usuario_id
      WHERE er.estabelecimento_id = ? AND er.excluido_em IS NULL AND ${filtro}
      ORDER BY er.entregue_em DESC, er.id DESC LIMIT 200`,
    [est, ...p],
  );
  if (linhas.length === 0) return [];
  const itens = await l.consultar(
    `SELECT x.entrega_resultado_id AS entrega, x.exame_item_id AS item, e.nome AS exame, r.numero AS pedido
       FROM entrega_resultado_item x JOIN exame_item ei ON ei.id = x.exame_item_id JOIN exame e ON e.id = ei.exame_id
       JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
      WHERE x.excluido_em IS NULL AND x.entrega_resultado_id IN (${lista(linhas.length)})
      ORDER BY x.entrega_resultado_id, x.sequencia`,
    linhas.map((r) => n(r['id'])),
  );
  return linhas.map((r) => ({
    id: n(r['id']),
    numero: texto(r['numero']),
    situacao: texto(r['situacao']) === 'cancelada' ? 'cancelada' : 'entregue',
    entregueEm: civil(instante(r['entregue_em'])),
    entreguePor: tn(r['entregue_por']),
    forma: tn(r['forma']),
    retiradoPeloPaciente: sim(r['retirado_pelo_paciente']),
    nomeResponsavel: tn(r['nome_responsavel']),
    documentoResponsavel: tn(r['cpf_responsavel']) ?? tn(r['documento_responsavel']),
    motivoCancelamento: tn(r['motivo_cancelamento']),
    observacao: tn(r['observacao']),
    exames: itens
      .filter((x) => n(x['entrega']) === n(r['id']))
      .map((x) => ({ item: n(x['item']), exame: texto(x['exame']), pedido: texto(x['pedido']) })),
  }));
}

async function exameExiste(l: Leitor, exame: number): Promise<void> {
  const e = await l.uma('SELECT id FROM exame WHERE id = ? AND excluido_em IS NULL', [exame]);
  if (!e) throw recusa('exame-inexistente', 'O exame não existe.');
}

async function setorDoEstabelecimento(l: Leitor, setor: number, est: number): Promise<void> {
  const s = await l.uma('SELECT id FROM setor_diagnostico WHERE id = ? AND estabelecimento_id = ?', [
    setor,
    est,
  ]);
  if (!s) throw recusa('setor-inexistente', 'O setor não existe neste estabelecimento.');
}

async function perfilDoAlcance(l: Leitor, perfil: number, est: number, o: OpcoesDaEntrega): Promise<Linha> {
  const r = await l.uma(
    'SELECT id, versao, estabelecimento_id FROM perfil_portal_resultado WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)',
    [perfil, est],
  );
  if (!r) throw recusa('nao-encontrado', 'O perfil não existe neste estabelecimento.');
  if (r['estabelecimento_id'] === null && !o.administrador)
    throw recusa('sem-permissao-global', SEM_ALCANCE_GLOBAL);
  return r;
}
