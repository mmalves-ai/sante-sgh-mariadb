// Soroteca no banco do cliente (F8, 05-SADT linha 9): cadastro dos equipamentos (geladeira, freezer) e dos suportes
// (rack, caixa) com linhas e colunas, regras de prazo de descarte, guarda da amostra na posição (a primeira livre é
// sugerida), retirada com motivo do cadastro, devolução da retirada provisória e expurgo das vencidas. A regra mora em
// @sgh/dominio-sadt (amostra/soroteca.ts); aqui fica só a leitura e a gravação do que a regra decide, pelo Executor
// (trilha na mesma transação, chave de idempotência da tela). Nada se apaga: o expurgo marca o descarte, cada passo
// vira um movimento_guarda_amostra com o responsável, e o cadastro que sai de uso é desativado.
import {
  conferirDevolucao,
  conferirEquipamento,
  conferirExpurgo,
  conferirGuarda,
  conferirMotivoExpurgo,
  conferirPosicao,
  conferirRegraDescarte,
  conferirRetirada,
  conferirSuporte,
  descartePrevisto,
  type FinalidadeRetirada,
  type MotivoRetirada,
  type Posicao,
  primeiraPosicaoLivre,
  type RegraDescarte,
  regraDescarteAplicavel,
  RecusaSoroteca,
  type SituacaoGuarda,
  vencidasParaExpurgo,
} from '@sgh/dominio-sadt';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
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
const textoOu = (v: unknown) => (v === null || v === undefined ? null : String(v));
const sim = (v: unknown) => Boolean(Number(v ?? 0));
const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const instanteIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(`${String(v).replace(' ', 'T')}Z`).toISOString();

// ── Entradas ────────────────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
const pequeno = z.number().int().min(1).max(999);
const textoCurto = (max: number) => z.string().trim().min(1).max(max);

export const esquemaEquipamento = z.object({
  codigo: textoCurto(30),
  descricao: textoCurto(150),
  tipo: z.enum(['geladeira', 'freezer', 'ultracongelador', 'nitrogenio', 'armario', 'outro']),
  setor: id.nullable().default(null),
  quantidadePrateleiras: pequeno.nullable().default(null),
  temperaturaMinima: z.number().min(-273).max(100).nullable().default(null),
  temperaturaMaxima: z.number().min(-273).max(100).nullable().default(null),
});

export const esquemaSuporte = z.object({
  equipamento: id,
  codigo: textoCurto(30),
  descricao: textoCurto(150),
  tipo: z.enum(['rack', 'caixa', 'estante', 'bandeja']).default('rack'),
  prateleira: pequeno.nullable().default(null),
  quantidadeLinhas: z.number().int().min(1).max(100),
  quantidadeColunas: z.number().int().min(1).max(100),
});

export const esquemaRegraDescarte = z.object({
  descricao: textoCurto(255),
  abrangencia: z.enum(['geral', 'exame', 'resultado', 'fonte_pagadora']),
  exame: id.nullable().default(null),
  comparador: z
    .enum(['igual', 'diferente', 'menor', 'menor_igual', 'maior', 'maior_igual', 'entre', 'contem'])
    .nullable()
    .default(null),
  valorTexto: z.string().trim().max(200).nullable().default(null),
  fontePagadora: id.nullable().default(null),
  diasGuarda: z.number().int().min(1).max(36_500),
  prioridade: z.number().int().min(0).max(999).default(0),
});

export const esquemaGuardar = z.object({
  /** Código da etiqueta lido na bancada. */
  codigo: textoCurto(30),
  equipamento: id,
  suporte: id.nullable().default(null),
  prateleira: pequeno.nullable().default(null),
  linha: pequeno.nullable().default(null),
  coluna: pequeno.nullable().default(null),
  tipoMaterial: z.enum(['soro', 'plasma', 'sangue_total', 'lamina', 'bloco', 'outro']).default('soro'),
  observacao: z.string().trim().max(500).nullable().default(null),
});

export const esquemaRetirar = z.object({
  motivo: id,
  observacao: z.string().trim().max(500).nullable().default(null),
});

export const esquemaDevolver = z.object({
  suporte: id.nullable().default(null),
  linha: pequeno.nullable().default(null),
  coluna: pequeno.nullable().default(null),
  observacao: z.string().trim().max(500).nullable().default(null),
});

export const esquemaExpurgo = z.object({
  guardas: z.array(id).min(1).max(500),
  motivo: id,
  observacao: z.string().trim().max(500).nullable().default(null),
});

export const TIPOS_CADASTRO_SOROTECA = {
  equipamento: 'equipamento_guarda_amostra',
  suporte: 'suporte_guarda_amostra',
  regra: 'regra_descarte_amostra',
} as const;
export type TipoCadastroSoroteca = keyof typeof TIPOS_CADASTRO_SOROTECA;

export const TABELAS_SOROTECA = [
  'equipamento_guarda_amostra',
  'suporte_guarda_amostra',
  'regra_descarte_amostra',
  'guarda_amostra',
  'movimento_guarda_amostra',
] as const;

// ── Leitura ─────────────────────────────────────────────────────────────────────────────────────────────────

const regraDe = (r: Linha): RegraDescarte & { descricao: string } => ({
  id: n(r['id']),
  descricao: texto(r['descricao']),
  abrangencia: texto(r['abrangencia']) as RegraDescarte['abrangencia'],
  exame: nn(r['exame_id']),
  comparador: textoOu(r['comparador']) as RegraDescarte['comparador'],
  valorTexto: textoOu(r['valor_texto']),
  fontePagadora: nn(r['fonte_pagadora_id']),
  diasGuarda: n(r['dias_guarda']),
  prioridade: n(r['prioridade']),
  ativo: sim(r['ativo']),
});

const motivoDe = (r: Linha | undefined | null): MotivoRetirada | null =>
  r
    ? {
        ativo: sim(r['ativo']),
        definitiva: sim(r['definitiva']),
        finalidade: texto(r['finalidade']) as FinalidadeRetirada,
      }
    : null;

const SQL_GUARDA = `SELECT g.id, g.amostra_biologica_id, g.equipamento_guarda_amostra_id, g.suporte_guarda_amostra_id,
       g.tipo_material, g.prateleira, g.linha, g.coluna, g.guardado_em, g.descarte_previsto_em, g.situacao,
       g.retirado_em, g.descartado_em, g.motivo_retirada_amostra_id, a.codigo_barras, eq.descricao AS equipamento,
       s.codigo AS suporte, r.paciente_id
  FROM guarda_amostra g
  JOIN amostra_biologica a ON a.id = g.amostra_biologica_id
  JOIN equipamento_guarda_amostra eq ON eq.id = g.equipamento_guarda_amostra_id
  LEFT JOIN suporte_guarda_amostra s ON s.id = g.suporte_guarda_amostra_id
  LEFT JOIN requisicao_exame r ON r.id = a.requisicao_exame_id`;

const guardaDe = (r: Linha) => ({
  id: n(r['id']),
  amostra: n(r['amostra_biologica_id']),
  codigo: texto(r['codigo_barras']),
  paciente: nn(r['paciente_id']),
  equipamento: n(r['equipamento_guarda_amostra_id']),
  equipamentoDescricao: texto(r['equipamento']),
  suporte: nn(r['suporte_guarda_amostra_id']),
  suporteCodigo: textoOu(r['suporte']),
  tipoMaterial: texto(r['tipo_material']),
  prateleira: nn(r['prateleira']),
  linha: nn(r['linha']),
  coluna: nn(r['coluna']),
  guardadoEm: instanteIso(r['guardado_em']) ?? '',
  descartePrevistoEm: dataIso(r['descarte_previsto_em']),
  situacao: texto(r['situacao']) as SituacaoGuarda,
  retiradoEm: instanteIso(r['retirado_em']),
  descartadoEm: instanteIso(r['descartado_em']),
});
export type GuardaAmostra = ReturnType<typeof guardaDe>;

export interface PainelSoroteca {
  readonly hoje: string;
  readonly equipamentos: {
    id: number;
    codigo: string;
    descricao: string;
    tipo: string;
    temperaturaMinima: number | null;
    temperaturaMaxima: number | null;
    ativo: boolean;
    guardadas: number;
  }[];
  readonly suportes: {
    id: number;
    equipamento: number | null;
    codigo: string;
    descricao: string;
    tipo: string;
    prateleira: number | null;
    quantidadeLinhas: number;
    quantidadeColunas: number;
    ativo: boolean;
    ocupadas: Posicao[];
    sugerida: Posicao | null;
  }[];
  readonly regras: (RegraDescarte & { descricao: string })[];
  readonly motivos: {
    id: number;
    codigo: string;
    descricao: string;
    finalidade: string;
    definitiva: boolean;
  }[];
  readonly guardas: GuardaAmostra[];
  readonly vencidas: GuardaAmostra[];
}

function daRegra<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RecusaSoroteca) throw recusa(e.codigo, e.message);
    throw e;
  }
}

async function hojeDo(l: Leitor, est: number): Promise<string> {
  const f = await l.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  return relogioNoFuso(texto(f?.['fuso_horario']) || FUSO_PADRAO).hoje;
}

async function regrasAtivas(l: Leitor, est: number): Promise<(RegraDescarte & { descricao: string })[]> {
  return (
    await l.consultar(
      'SELECT * FROM regra_descarte_amostra WHERE estabelecimento_id = ? ORDER BY ativo DESC, prioridade DESC, id DESC LIMIT 500',
      [est],
    )
  ).map(regraDe);
}

export class ServicoSoroteca {
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
    fn: (tx: TxOperacao, est: number, usuario: number) => Promise<number>,
  ): Promise<{ id: number }> {
    const est = this.est(c);
    let gravado: number | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS_SOROTECA,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        const usuario = tx.contexto.usuario;
        if (usuario === null || usuario === undefined)
          throw recusa(
            'sem-usuario',
            'A soroteca registra quem guardou, retirou ou descartou: entre com o seu usuário.',
          );
        gravado = await fn(tx, est, usuario);
        return { id: gravado };
      },
      alvo: () => ({ tabela, id: gravado }),
      trilha: () => ({ dados: { evento: nome }, motivo: null }),
    });
    const chave = `sadt-soroteca:${c.chaveIdempotencia ?? randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    return { id: gravado ?? n(r.resultado['id']) };
  }

  /** Equipamentos, suportes com o mapa ocupado e a posição sugerida, regras, motivos, guardas ativas e vencidas. */
  painel(c: ContextoSadt): Promise<PainelSoroteca> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const hoje = await hojeDo(l, est);
      const equipamentos = (
        await l.consultar(
          `SELECT e.*, (SELECT COUNT(*) FROM guarda_amostra g
                         WHERE g.equipamento_guarda_amostra_id = e.id AND g.situacao = 'guardada') AS guardadas
             FROM equipamento_guarda_amostra e
            WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL ORDER BY e.ativo DESC, e.codigo LIMIT 500`,
          [est],
        )
      ).map((r) => ({
        id: n(r['id']),
        codigo: texto(r['codigo']),
        descricao: texto(r['descricao']),
        tipo: texto(r['tipo']),
        temperaturaMinima: nn(r['temperatura_minima']),
        temperaturaMaxima: nn(r['temperatura_maxima']),
        ativo: sim(r['ativo']),
        guardadas: n(r['guardadas']),
      }));
      const ocupacao = await l.consultar(
        `SELECT g.suporte_guarda_amostra_id, g.linha, g.coluna FROM guarda_amostra g
          WHERE g.estabelecimento_id = ? AND g.situacao = 'guardada' AND g.suporte_guarda_amostra_id IS NOT NULL
            AND g.linha IS NOT NULL AND g.coluna IS NOT NULL`,
        [est],
      );
      const suportes = (
        await l.consultar(
          `SELECT * FROM suporte_guarda_amostra WHERE estabelecimento_id = ? AND excluido_em IS NULL
            ORDER BY ativo DESC, codigo LIMIT 1000`,
          [est],
        )
      ).map((r) => {
        const ocupadas = ocupacao
          .filter((o) => n(o['suporte_guarda_amostra_id']) === n(r['id']))
          .map((o) => ({ linha: n(o['linha']), coluna: n(o['coluna']) }));
        const dim = {
          quantidadeLinhas: n(r['quantidade_linhas']),
          quantidadeColunas: n(r['quantidade_colunas']),
        };
        return {
          id: n(r['id']),
          equipamento: nn(r['equipamento_guarda_amostra_id']),
          codigo: texto(r['codigo']),
          descricao: texto(r['descricao']),
          tipo: texto(r['tipo']),
          prateleira: nn(r['prateleira']),
          ...dim,
          ativo: sim(r['ativo']),
          ocupadas,
          sugerida: primeiraPosicaoLivre(dim, ocupadas),
        };
      });
      const motivos = (
        await l.consultar(
          'SELECT id, codigo, descricao, finalidade, definitiva FROM motivo_retirada_amostra WHERE ativo = TRUE ORDER BY descricao LIMIT 500',
          [],
        )
      ).map((r) => ({
        id: n(r['id']),
        codigo: texto(r['codigo']),
        descricao: texto(r['descricao']),
        finalidade: texto(r['finalidade']),
        definitiva: sim(r['definitiva']),
      }));
      const guardas = (
        await l.consultar(
          `${SQL_GUARDA} WHERE g.estabelecimento_id = ? AND g.situacao IN ('guardada','retirada') AND g.excluido_em IS NULL
            ORDER BY g.descarte_previsto_em IS NULL, g.descarte_previsto_em, g.id LIMIT 1000`,
          [est],
        )
      ).map(guardaDe);
      return {
        hoje,
        equipamentos,
        suportes,
        regras: await regrasAtivas(l, est),
        motivos,
        guardas,
        vencidas: vencidasParaExpurgo(guardas, hoje),
      };
    });
  }

  /** A amostra pela etiqueta: a guarda atual, o histórico de movimentos e as outras amostras guardadas do paciente. */
  amostra(c: ContextoSadt, codigo: string) {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const a = await l.uma(
        `SELECT a.id, a.codigo_barras, a.situacao, r.paciente_id FROM amostra_biologica a
           LEFT JOIN requisicao_exame r ON r.id = a.requisicao_exame_id
          WHERE a.estabelecimento_id = ? AND a.codigo_barras = ? AND a.excluido_em IS NULL`,
        [est, codigo.trim()],
      );
      if (!a) throw recusa('nao-encontrado', 'Nenhuma amostra com esse código neste estabelecimento.');
      const guardas = (
        await l.consultar(`${SQL_GUARDA} WHERE g.amostra_biologica_id = ? ORDER BY g.id DESC`, [n(a['id'])])
      ).map(guardaDe);
      const movimentos = guardas.length
        ? (
            await l.consultar(
              `SELECT m.guarda_amostra_id, m.tipo_movimento, m.ocorrido_em, m.linha, m.coluna, m.observacao,
                      mo.descricao AS motivo, u.nome AS usuario
                 FROM movimento_guarda_amostra m
                 LEFT JOIN motivo_retirada_amostra mo ON mo.id = m.motivo_retirada_amostra_id
                 LEFT JOIN usuario u ON u.id = m.usuario_id
                WHERE m.guarda_amostra_id IN (${guardas.map(() => '?').join(', ')})
                ORDER BY m.ocorrido_em DESC, m.id DESC`,
              guardas.map((g) => g.id),
            )
          ).map((m) => ({
            guarda: n(m['guarda_amostra_id']),
            tipo: texto(m['tipo_movimento']),
            em: instanteIso(m['ocorrido_em']) ?? '',
            linha: nn(m['linha']),
            coluna: nn(m['coluna']),
            motivo: textoOu(m['motivo']),
            por: textoOu(m['usuario']),
            observacao: textoOu(m['observacao']),
          }))
        : [];
      const paciente = nn(a['paciente_id']);
      const doPaciente =
        paciente === null
          ? []
          : (
              await l.consultar(
                `${SQL_GUARDA} WHERE g.estabelecimento_id = ? AND r.paciente_id = ? AND g.situacao IN ('guardada','retirada')
                   AND g.amostra_biologica_id <> ? ORDER BY g.id DESC LIMIT 100`,
                [est, paciente, n(a['id'])],
              )
            ).map(guardaDe);
      const hoje = await hojeDo(l, est);
      const ctxDescarte = await contextoDescarte(l, n(a['id']));
      const regra = regraDescarteAplicavel(await regrasAtivas(l, est), ctxDescarte);
      return {
        id: n(a['id']),
        codigo: texto(a['codigo_barras']),
        situacao: texto(a['situacao']),
        guardas,
        movimentos,
        doPaciente,
        prazo: {
          regra: regra?.id ?? null,
          dias: regra?.diasGuarda ?? null,
          descarteSeGuardarHoje: descartePrevisto(hoje, regra),
        },
      };
    });
  }

  async incluirEquipamento(c: ContextoSadt, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaEquipamento.parse(entrada);
    daRegra(() => conferirEquipamento(e));
    return this.gravar(
      c,
      'sadt.soroteca.equipamento.incluido',
      'equipamento_guarda_amostra',
      async (tx, est) => {
        await codigoLivre(tx, 'equipamento_guarda_amostra', est, e.codigo);
        if (e.setor !== null) {
          const s = await tx.uma('SELECT id FROM setor_diagnostico WHERE id = ? AND estabelecimento_id = ?', [
            e.setor,
            est,
          ]);
          if (!s) throw recusa('setor-inexistente', 'O setor não existe neste estabelecimento.');
        }
        return tx.incluir('equipamento_guarda_amostra', {
          estabelecimento_id: est,
          codigo: e.codigo,
          descricao: e.descricao,
          tipo: e.tipo,
          setor_diagnostico_id: e.setor,
          quantidade_prateleiras: e.quantidadePrateleiras,
          temperatura_minima: e.temperaturaMinima,
          temperatura_maxima: e.temperaturaMaxima,
          ativo: true,
        });
      },
    );
  }

  async incluirSuporte(c: ContextoSadt, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaSuporte.parse(entrada);
    daRegra(() => conferirSuporte(e));
    return this.gravar(c, 'sadt.soroteca.suporte.incluido', 'suporte_guarda_amostra', async (tx, est) => {
      await codigoLivre(tx, 'suporte_guarda_amostra', est, e.codigo);
      await equipamentoAtivo(tx, est, e.equipamento);
      return tx.incluir('suporte_guarda_amostra', {
        estabelecimento_id: est,
        equipamento_guarda_amostra_id: e.equipamento,
        codigo: e.codigo,
        descricao: e.descricao,
        tipo: e.tipo,
        prateleira: e.prateleira,
        quantidade_linhas: e.quantidadeLinhas,
        quantidade_colunas: e.quantidadeColunas,
        ativo: true,
      });
    });
  }

  async incluirRegra(c: ContextoSadt, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaRegraDescarte.parse(entrada);
    daRegra(() => conferirRegraDescarte(e));
    return this.gravar(c, 'sadt.soroteca.regra.incluida', 'regra_descarte_amostra', async (tx, est) => {
      if (
        e.exame !== null &&
        !(await tx.uma('SELECT id FROM exame WHERE id = ? AND excluido_em IS NULL', [e.exame]))
      )
        throw recusa('exame-inexistente', 'O exame não existe.');
      if (
        e.fontePagadora !== null &&
        !(await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ?', [e.fontePagadora]))
      )
        throw recusa('fonte-inexistente', 'A fonte pagadora não existe.');
      const usaExame = e.abrangencia === 'exame' || e.abrangencia === 'resultado';
      return tx.incluir('regra_descarte_amostra', {
        estabelecimento_id: est,
        descricao: e.descricao,
        abrangencia: e.abrangencia,
        exame_id: usaExame ? e.exame : null,
        comparador: e.abrangencia === 'resultado' ? e.comparador : null,
        valor_texto: e.abrangencia === 'resultado' ? e.valorTexto : null,
        fonte_pagadora_id: e.abrangencia === 'fonte_pagadora' ? e.fontePagadora : null,
        dias_guarda: e.diasGuarda,
        prioridade: e.prioridade,
        ativo: true,
      });
    });
  }

  /** Desativa o cadastro (nunca apaga). O equipamento ou suporte com amostra guardada não sai de uso. */
  async desativar(c: ContextoSadt, tipo: TipoCadastroSoroteca, alvo: number): Promise<{ id: number }> {
    const tabela = TIPOS_CADASTRO_SOROTECA[tipo];
    return this.gravar(c, `sadt.soroteca.${tipo}.desativado`, tabela, async (tx, est) => {
      const r = await tx.uma(
        `SELECT id, versao, ativo FROM ${tabela} WHERE id = ? AND estabelecimento_id = ?`,
        [alvo, est],
      );
      if (!r) throw recusa('nao-encontrado', 'O cadastro não existe neste estabelecimento.');
      if (!sim(r['ativo'])) throw recusa('ja-inativo', 'O cadastro já está desativado.');
      if (tipo !== 'regra') {
        const coluna = tipo === 'equipamento' ? 'equipamento_guarda_amostra_id' : 'suporte_guarda_amostra_id';
        const ocupado = await tx.uma(
          `SELECT COUNT(*) AS q FROM guarda_amostra WHERE ${coluna} = ? AND situacao = 'guardada'`,
          [alvo],
        );
        if (n(ocupado?.['q']) > 0)
          throw recusa(
            'com-amostras',
            `Ainda há ${n(ocupado?.['q'])} amostra(s) guardada(s): retire ou descarte antes.`,
          );
      }
      await tx.alterar(tabela, alvo, n(r['versao']), { ativo: false });
      return alvo;
    });
  }

  /** Guarda a amostra lida pela etiqueta; sem posição informada, vai para a primeira livre do suporte. */
  async guardar(c: ContextoSadt, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaGuardar.parse(entrada);
    return this.gravar(c, 'sadt.soroteca.guardar', 'guarda_amostra', async (tx, est, usuario) => {
      const [a] = await tx.consultarParaAtualizar(
        `SELECT id, situacao FROM amostra_biologica WHERE estabelecimento_id = ? AND codigo_barras = ? AND excluido_em IS NULL`,
        [est, e.codigo],
      );
      if (!a) throw recusa('nao-encontrado', 'Nenhuma amostra com esse código neste estabelecimento.');
      const ja = await tx.uma(
        `SELECT id FROM guarda_amostra WHERE amostra_biologica_id = ? AND situacao IN ('guardada','retirada')`,
        [n(a['id'])],
      );
      daRegra(() => conferirGuarda(texto(a['situacao']), Boolean(ja)));
      await equipamentoAtivo(tx, est, e.equipamento);
      const pos = await this.posicao(tx, est, e.equipamento, e.suporte, e.linha, e.coluna);
      const hoje = await hojeDo(tx, est);
      const regra = regraDescarteAplicavel(
        await regrasAtivas(tx, est),
        await contextoDescarte(tx, n(a['id'])),
      );
      const prazo = descartePrevisto(hoje, regra);
      const agora = new Date();
      const prateleira = e.prateleira ?? pos.prateleira;
      const guarda = await tx.incluir('guarda_amostra', {
        estabelecimento_id: est,
        amostra_biologica_id: n(a['id']),
        equipamento_guarda_amostra_id: e.equipamento,
        suporte_guarda_amostra_id: e.suporte,
        tipo_material: e.tipoMaterial,
        prateleira,
        linha: pos.linha,
        coluna: pos.coluna,
        guardado_em: agora,
        descarte_previsto_em: prazo,
        situacao: 'guardada',
      });
      await tx.incluir('movimento_guarda_amostra', {
        guarda_amostra_id: guarda,
        tipo_movimento: 'entrada',
        suporte_guarda_amostra_id: e.suporte,
        prateleira,
        linha: pos.linha,
        coluna: pos.coluna,
        descarte_previsto_em: prazo,
        observacao: e.observacao,
        dados: JSON.stringify({ regra: regra?.id ?? null, diasGuarda: regra?.diasGuarda ?? null }),
        ocorrido_em: agora,
        usuario_id: usuario,
      });
      return guarda;
    });
  }

  /** Retirada com motivo: a provisória (reteste, pesquisa) libera a posição e pode voltar; a definitiva encerra. */
  async retirar(c: ContextoSadt, guardaId: number, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaRetirar.parse(entrada);
    return this.gravar(c, 'sadt.soroteca.retirar', 'guarda_amostra', async (tx, est, usuario) => {
      const g = await guardaTravada(tx, est, guardaId);
      const m = await tx.uma(
        'SELECT ativo, definitiva, finalidade FROM motivo_retirada_amostra WHERE id = ?',
        [e.motivo],
      );
      daRegra(() => conferirRetirada(texto(g['situacao']) as SituacaoGuarda, motivoDe(m)));
      const agora = new Date();
      await tx.alterar('guarda_amostra', guardaId, n(g['versao']), {
        situacao: 'retirada',
        retirado_em: agora,
        motivo_retirada_amostra_id: e.motivo,
      });
      await tx.incluir('movimento_guarda_amostra', {
        guarda_amostra_id: guardaId,
        tipo_movimento: 'retirada',
        motivo_retirada_amostra_id: e.motivo,
        suporte_guarda_amostra_id: nn(g['suporte_guarda_amostra_id']),
        prateleira: nn(g['prateleira']),
        linha: nn(g['linha']),
        coluna: nn(g['coluna']),
        observacao: e.observacao,
        ocorrido_em: agora,
        usuario_id: usuario,
      });
      return guardaId;
    });
  }

  /** Devolução da retirada provisória: volta à mesma posição se livre; senão, à informada ou à primeira livre. */
  async devolver(c: ContextoSadt, guardaId: number, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaDevolver.parse(entrada);
    return this.gravar(c, 'sadt.soroteca.devolver', 'guarda_amostra', async (tx, est, usuario) => {
      const g = await guardaTravada(tx, est, guardaId);
      const m = await tx.uma(
        'SELECT ativo, definitiva, finalidade FROM motivo_retirada_amostra WHERE id = ?',
        [nn(g['motivo_retirada_amostra_id'])],
      );
      daRegra(() => conferirDevolucao(texto(g['situacao']) as SituacaoGuarda, motivoDe(m)));
      const suporte = e.suporte ?? nn(g['suporte_guarda_amostra_id']);
      const mesma = e.suporte === null && e.linha === null && e.coluna === null;
      const equip = n(g['equipamento_guarda_amostra_id']);
      let pos: { linha: number | null; coluna: number | null; prateleira: number | null };
      try {
        pos = await this.posicao(
          tx,
          est,
          equip,
          suporte,
          mesma ? nn(g['linha']) : e.linha,
          mesma ? nn(g['coluna']) : e.coluna,
        );
      } catch (x) {
        // A posição antiga foi ocupada na retirada: vai para a primeira livre do mesmo suporte.
        if (!mesma) throw x;
        pos = await this.posicao(tx, est, equip, suporte, null, null);
      }
      const agora = new Date();
      await tx.alterar('guarda_amostra', guardaId, n(g['versao']), {
        situacao: 'guardada',
        suporte_guarda_amostra_id: suporte,
        linha: pos.linha,
        coluna: pos.coluna,
        retirado_em: null,
        motivo_retirada_amostra_id: null,
      });
      await tx.incluir('movimento_guarda_amostra', {
        guarda_amostra_id: guardaId,
        tipo_movimento: 'devolucao',
        suporte_guarda_amostra_id: suporte,
        prateleira: nn(g['prateleira']),
        linha: pos.linha,
        coluna: pos.coluna,
        observacao: e.observacao,
        ocorrido_em: agora,
        usuario_id: usuario,
      });
      return guardaId;
    });
  }

  /** Expurgo das vencidas escolhidas: marca o descarte (sem apagar) com o motivo e um movimento por amostra. */
  async expurgar(c: ContextoSadt, entrada: unknown): Promise<{ id: number; descartadas: number }> {
    const e = esquemaExpurgo.parse(entrada);
    const escolhidas = [...new Set(e.guardas)];
    let descartadas = 0;
    const r = await this.gravar(c, 'sadt.soroteca.expurgar', 'guarda_amostra', async (tx, est, usuario) => {
      const m = await tx.uma(
        'SELECT ativo, definitiva, finalidade FROM motivo_retirada_amostra WHERE id = ?',
        [e.motivo],
      );
      daRegra(() => conferirMotivoExpurgo(motivoDe(m)));
      const linhas = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, descarte_previsto_em, suporte_guarda_amostra_id, prateleira, linha, coluna
           FROM guarda_amostra WHERE estabelecimento_id = ? AND id IN (${escolhidas.map(() => '?').join(', ')})`,
        [est, ...escolhidas],
      );
      const hoje = await hojeDo(tx, est);
      const vencidas = vencidasParaExpurgo(
        linhas.map((g) => ({
          id: n(g['id']),
          situacao: texto(g['situacao']) as SituacaoGuarda,
          descartePrevistoEm: dataIso(g['descarte_previsto_em']),
        })),
        hoje,
      );
      daRegra(() => conferirExpurgo(escolhidas, vencidas));
      const agora = new Date();
      for (const g of linhas) {
        const gid = n(g['id']);
        await tx.alterar('guarda_amostra', gid, n(g['versao']), {
          situacao: 'descartada',
          descartado_em: agora,
          motivo_retirada_amostra_id: e.motivo,
        });
        await tx.incluir('movimento_guarda_amostra', {
          guarda_amostra_id: gid,
          tipo_movimento: 'descarte',
          motivo_retirada_amostra_id: e.motivo,
          suporte_guarda_amostra_id: nn(g['suporte_guarda_amostra_id']),
          prateleira: nn(g['prateleira']),
          linha: nn(g['linha']),
          coluna: nn(g['coluna']),
          descarte_previsto_em: dataIso(g['descarte_previsto_em']),
          observacao: e.observacao,
          ocorrido_em: agora,
          usuario_id: usuario,
        });
        descartadas++;
      }
      return escolhidas[0] ?? 0;
    });
    return { id: r.id, descartadas: descartadas || escolhidas.length };
  }

  /** A posição no suporte (travado: duas guardas simultâneas não pegam a mesma); sem suporte, sem posição. */
  private async posicao(
    tx: TxOperacao,
    est: number,
    equipamento: number,
    suporte: number | null,
    linha: number | null,
    coluna: number | null,
  ): Promise<{ linha: number | null; coluna: number | null; prateleira: number | null }> {
    if (suporte === null) {
      if (linha !== null || coluna !== null)
        throw recusa('posicao-sem-suporte', 'Escolha o rack ou a caixa para informar a posição.');
      return { linha: null, coluna: null, prateleira: null };
    }
    const [s] = await tx.consultarParaAtualizar(
      `SELECT id, equipamento_guarda_amostra_id, quantidade_linhas, quantidade_colunas, prateleira, ativo
         FROM suporte_guarda_amostra WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [suporte, est],
    );
    if (!s || !sim(s['ativo']))
      throw recusa('suporte-inexistente', 'O rack ou caixa não existe ou está desativado.');
    if (
      nn(s['equipamento_guarda_amostra_id']) !== null &&
      n(s['equipamento_guarda_amostra_id']) !== equipamento
    )
      throw recusa('suporte-de-outro-equipamento', 'O rack ou caixa está em outro equipamento.');
    const dim = {
      quantidadeLinhas: n(s['quantidade_linhas']),
      quantidadeColunas: n(s['quantidade_colunas']),
    };
    const ocupadas = (
      await tx.consultar(
        `SELECT linha, coluna FROM guarda_amostra
          WHERE suporte_guarda_amostra_id = ? AND situacao = 'guardada' AND linha IS NOT NULL AND coluna IS NOT NULL`,
        [suporte],
      )
    ).map((o) => ({ linha: n(o['linha']), coluna: n(o['coluna']) }));
    let p: Posicao | null;
    if (linha === null && coluna === null) {
      p = primeiraPosicaoLivre(dim, ocupadas);
      if (!p) throw recusa('suporte-cheio', 'O rack ou caixa está cheio: escolha outro.');
    } else {
      p = { linha: linha ?? 0, coluna: coluna ?? 0 };
      const escolhida = p;
      daRegra(() => conferirPosicao(dim, escolhida, ocupadas));
    }
    return { ...p, prateleira: nn(s['prateleira']) };
  }
}

async function codigoLivre(
  l: Leitor,
  tabela: 'equipamento_guarda_amostra' | 'suporte_guarda_amostra',
  est: number,
  codigo: string,
): Promise<void> {
  const r = await l.uma(
    tabela === 'suporte_guarda_amostra'
      ? 'SELECT id FROM suporte_guarda_amostra WHERE estabelecimento_id = ? AND codigo = ?'
      : 'SELECT id FROM equipamento_guarda_amostra WHERE estabelecimento_id = ? AND codigo = ?',
    [est, codigo],
  );
  if (r) throw recusa('codigo-repetido', 'Já existe cadastro com esse código neste estabelecimento.');
}

async function equipamentoAtivo(l: Leitor, est: number, equipamento: number): Promise<void> {
  const r = await l.uma(
    'SELECT ativo FROM equipamento_guarda_amostra WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [equipamento, est],
  );
  if (!r || !sim(r['ativo']))
    throw recusa(
      'equipamento-inexistente',
      'O equipamento não existe neste estabelecimento ou está desativado.',
    );
}

async function guardaTravada(tx: TxOperacao, est: number, guarda: number): Promise<Linha> {
  const [g] = await tx.consultarParaAtualizar(
    'SELECT * FROM guarda_amostra WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [guarda, est],
  );
  if (!g) throw recusa('nao-encontrado', 'A guarda não existe neste estabelecimento.');
  return g;
}

/** Exames, fonte pagadora e resultados já digitados da amostra (o que a regra de descarte compara). */
async function contextoDescarte(l: Leitor, amostra: number) {
  const itens = await l.consultar(
    `SELECT ei.id AS item, ei.exame_id, r.fonte_pagadora_id
       FROM amostra_biologica_exame x
       JOIN exame_item ei ON ei.id = x.exame_item_id
       JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
      WHERE x.amostra_biologica_id = ?`,
    [amostra],
  );
  const resultados = itens.length
    ? (
        await l.consultar(
          `SELECT ei.exame_id, ra.valor_numerico, ra.valor_texto
             FROM resultado_exame re
             JOIN exame_item ei ON ei.id = re.exame_item_id
             JOIN resultado_analito ra ON ra.resultado_exame_id = re.id
            WHERE re.exame_item_id IN (${itens.map(() => '?').join(', ')})`,
          itens.map((i) => n(i['item'])),
        )
      ).map((x) => ({
        exame: n(x['exame_id']),
        valor:
          x['valor_texto'] !== null && x['valor_texto'] !== undefined
            ? texto(x['valor_texto'])
            : texto(x['valor_numerico']),
      }))
    : [];
  return {
    exames: [...new Set(itens.map((i) => n(i['exame_id'])))],
    fontePagadora: itens.length ? nn(itens[0]?.['fonte_pagadora_id']) : null,
    resultados,
  };
}
