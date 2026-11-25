// Cotas e prazos de marcação (02-AGE linha 47) sobre cota_marcacao e prazo_aviso_marcacao, e a trava aplicada pela
// porta da agenda na marcação (mesma transação): a restrição da agenda (agenda_restricao, pela agenda estruturada),
// o prazo de aviso e a cota por período e recorte, com a ação ao esgotar. A regra é do domínio (@sgh/dominio-agenda:
// validarCota, validarPrazo, cotaAlcanca, janelaDaCota, decidirCotas, prazoQueVale, decidirPrazo,
// restricaoNaMarcacao); aqui ficam a leitura, a contagem no banco e as gravações pelo executor (trilha na mesma
// transação). Nada se apaga: a cota e o prazo deixam de valer com "ativo = falso" e a trilha guarda o histórico.
import {
  ACOES_COTA,
  type CotaMarcacao,
  cotaAlcanca,
  decidirCotas,
  decidirPrazo,
  janelaDaCota,
  limiteDaCota,
  PERIODICIDADES_COTA,
  type PrazoAviso,
  prazoQueVale,
  restricaoNaMarcacao,
  validarCota,
  validarPrazo,
} from '@sgh/dominio-agenda';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { lerAgendaEstruturada } from '@sgh/persistencia';
import { z } from 'zod';
import type { NucleoAgenda } from './porta-propria.js';

const num = (v: unknown): number => Number(v);
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const bool = (v: unknown) => Boolean(Number(v));

type Consulta = Pick<Leitor, 'consultar' | 'uma'>;

/** A entrada sem o id e a versão (o domínio valida só os dados). */
function semChave<T extends { id?: number | undefined; versao?: number | undefined }>(
  e: T,
): Omit<T, 'id' | 'versao'> {
  const r: Partial<T> = { ...e };
  delete r.id;
  delete r.versao;
  return r as Omit<T, 'id' | 'versao'>;
}

const dataTexto = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const idOuNulo = z.number().int().positive().nullable();

export const esquemaSalvarCota = z
  .object({
    id: z.number().int().positive().optional(),
    /** Versão que a tela leu (obrigatória na alteração): diferente da do banco, 409 conflito-versao. */
    versao: z.number().int().positive().optional(),
    agenda: idOuNulo,
    fontePagadora: idOuNulo,
    especialidade: idOuNulo,
    tipoMarcacao: idOuNulo,
    item: idOuNulo,
    periodicidade: z.enum(PERIODICIDADES_COTA),
    vigenciaInicio: dataTexto,
    vigenciaFim: dataTexto.nullable(),
    quantidadeMaxima: z.number().int().min(0).max(1_000_000).nullable(),
    percentualMaximo: z.number().min(0).max(100).nullable(),
    acao: z.enum(ACOES_COTA),
    ativo: z.boolean(),
  })
  .strict()
  .refine((e) => e.id === undefined || e.versao !== undefined, {
    message: 'Informe a versão da cota que está sendo alterada.',
    path: ['versao'],
  });
export type EntradaSalvarCota = z.infer<typeof esquemaSalvarCota>;

export const esquemaSalvarPrazo = z
  .object({
    id: z.number().int().positive().optional(),
    versao: z.number().int().positive().optional(),
    agenda: idOuNulo,
    item: idOuNulo,
    antecedenciaMinimaHoras: z.number().int().min(0).max(8760),
    antecedenciaMaximaDias: z.number().int().min(1).max(3650).nullable(),
    textoAviso: z.string().max(1000).nullable(),
    vigenciaInicio: dataTexto.nullable(),
    vigenciaFim: dataTexto.nullable(),
    ativo: z.boolean(),
  })
  .strict()
  .refine((e) => e.id === undefined || e.versao !== undefined, {
    message: 'Informe a versão do prazo que está sendo alterado.',
    path: ['versao'],
  });
export type EntradaSalvarPrazo = z.infer<typeof esquemaSalvarPrazo>;

export interface CotaLida extends CotaMarcacao {
  readonly id: number;
  readonly versao: number;
  /** Uso na janela de hoje (só a cota ativa e vigente hoje): marcações, limite e o intervalo contado. */
  readonly uso: { usadas: number; limite: number; inicio: string; fim: string } | null;
}
export interface PrazoLido extends PrazoAviso {
  readonly id: number;
  readonly versao: number;
}
export interface OpcaoCota {
  readonly id: number;
  readonly nome: string;
}
export interface OpcoesCota {
  readonly agenda: OpcaoCota[];
  readonly fontePagadora: OpcaoCota[];
  readonly especialidade: OpcaoCota[];
  readonly tipoMarcacao: OpcaoCota[];
  readonly item: OpcaoCota[];
}

const COLUNAS_COTA = `id, versao, agenda_servico_id, fonte_pagadora_id, especialidade_medica_id, tipo_marcacao_id,
  item_agendavel_id, periodicidade, vigencia_inicio, vigencia_fim, quantidade_maxima, percentual_maximo,
  acao_ao_esgotar, ativo`;
const COLUNAS_PRAZO = `id, versao, agenda_servico_id, item_agendavel_id, antecedencia_minima_horas,
  antecedencia_maxima_dias, texto_aviso, vigencia_inicio, vigencia_fim, ativo`;

const cotaDe = (x: Linha): CotaMarcacao & { id: number; versao: number } => ({
  id: num(x['id']),
  versao: num(x['versao']),
  agenda: numOuNulo(x['agenda_servico_id']),
  fontePagadora: numOuNulo(x['fonte_pagadora_id']),
  especialidade: numOuNulo(x['especialidade_medica_id']),
  tipoMarcacao: numOuNulo(x['tipo_marcacao_id']),
  item: numOuNulo(x['item_agendavel_id']),
  periodicidade: String(x['periodicidade']) as CotaMarcacao['periodicidade'],
  vigenciaInicio: dataIso(x['vigencia_inicio']) ?? '',
  vigenciaFim: dataIso(x['vigencia_fim']),
  quantidadeMaxima: numOuNulo(x['quantidade_maxima']),
  percentualMaximo: numOuNulo(x['percentual_maximo']),
  acao: String(x['acao_ao_esgotar']) as CotaMarcacao['acao'],
  ativo: bool(x['ativo']),
});
const prazoDe = (x: Linha): PrazoLido => ({
  id: num(x['id']),
  versao: num(x['versao']),
  agenda: numOuNulo(x['agenda_servico_id']),
  item: numOuNulo(x['item_agendavel_id']),
  antecedenciaMinimaHoras: num(x['antecedencia_minima_horas']),
  antecedenciaMaximaDias: numOuNulo(x['antecedencia_maxima_dias']),
  textoAviso: x['texto_aviso'] == null ? null : String(x['texto_aviso']),
  vigenciaInicio: dataIso(x['vigencia_inicio']),
  vigenciaFim: dataIso(x['vigencia_fim']),
  ativo: bool(x['ativo']),
});

/** Marcações (sem as canceladas) e vagas da grade na janela, no recorte da cota. */
export async function usoDaCota(
  l: Consulta,
  estabelecimento: number,
  c: CotaMarcacao,
  janela: { inicio: string; fim: string },
): Promise<{ usadas: number; vagas: number }> {
  const filtros: string[] = [];
  const valores: unknown[] = [];
  const filtrar = (sql: string, v: number | null) => {
    if (v === null) return;
    filtros.push(sql);
    valores.push(v);
  };
  filtrar(' AND h.agenda_servico_id = ?', c.agenda);
  filtrar(' AND m.fonte_pagadora_id = ?', c.fontePagadora);
  filtrar(' AND m.especialidade_medica_id = ?', c.especialidade);
  filtrar(' AND m.tipo_marcacao_id = ?', c.tipoMarcacao);
  filtrar(' AND m.item_agendavel_id = ?', c.item);
  const recorte = filtros.join('');
  const [u] = await l.consultar(
    `SELECT COUNT(*) AS n FROM marcacao_horario m
       JOIN horario_agenda h ON h.id = m.horario_agenda_id
       JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
      WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND s.significado <> 'cancelada'
        AND h.data_referencia BETWEEN ? AND ?${recorte}`,
    [estabelecimento, janela.inicio, janela.fim, ...valores],
  );
  let vagas = 0;
  if (c.percentualMaximo !== null) {
    const fv: string[] = [];
    const vv: unknown[] = [];
    if (c.agenda !== null) {
      fv.push(' AND h.agenda_servico_id = ?');
      vv.push(c.agenda);
    }
    if (c.especialidade !== null) {
      fv.push(
        ' AND h.agenda_servico_id IN (SELECT ae.agenda_servico_id FROM agenda_especialidade ae WHERE ae.especialidade_medica_id = ? AND ae.excluido_em IS NULL)',
      );
      vv.push(c.especialidade);
    }
    const daGrade = fv.join('');
    const [v] = await l.consultar(
      `SELECT COALESCE(SUM(h.vagas), 0) AS n FROM horario_agenda h
        WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL AND h.encaixe_ordem = 0
          AND h.situacao <> 'bloqueado' AND h.data_referencia BETWEEN ? AND ?${daGrade}`,
      [estabelecimento, janela.inicio, janela.fim, ...vv],
    );
    vagas = num(v?.['n'] ?? 0);
  }
  return { usadas: num(u?.['n'] ?? 0), vagas };
}

const idadeEm = (nascimento: string | null, data: string): number | null => {
  if (!nascimento) return null;
  const [an, mn, dn] = nascimento.split('-').map(Number) as [number, number, number];
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  return a - an - (m < mn || (m === mn && d < dn) ? 1 : 0);
};
const SEXO_POR_SIGLA: Record<string, 'feminino' | 'masculino'> = { F: 'feminino', M: 'masculino' };

export interface MarcacaoAConferir {
  readonly estabelecimento: number;
  readonly agenda: number;
  /** Dia do horário (AAAA-MM-DD). */
  readonly data: string;
  readonly inicio: Date;
  readonly agora: Date;
  readonly paciente: number | null;
  readonly preCadastro: number | null;
  /** Nascimento conhecido (paciente ou pré-cadastro), AAAA-MM-DD. */
  readonly nascimento: string | null;
  readonly fontePagadora: number;
  readonly especialidade: number | null;
  readonly tipoMarcacao: number | null;
  readonly item?: number | null;
  readonly retorno: boolean;
  readonly encaixe: boolean;
  readonly administrador: boolean;
}

/**
 * Trava da marcação (02-AGE 47), dentro da transação: restrição da agenda, prazo de aviso e cota. Recusa com o
 * código do domínio; o que passa com aviso (regra estimada, cota que só alerta, texto do prazo) volta como alerta.
 * As cotas que alcançam a marcação são travadas (FOR UPDATE) antes da contagem: duas marcações na mesma cota não
 * passam juntas do limite.
 */
export async function exigirRegrasDaMarcacao(tx: TxOperacao, p: MarcacaoAConferir): Promise<string[]> {
  const alertas: string[] = [];
  // Restrição da agenda (padrão e regras por convênio, plano e item).
  const estruturada = await lerAgendaEstruturada(tx, p.agenda, p.data);
  if (estruturada) {
    let sexo: 'feminino' | 'masculino' | null = null;
    const s =
      p.paciente !== null
        ? await tx.uma(
            `SELECT sx.sigla FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
               JOIN sexo sx ON sx.id = pf.sexo_id WHERE pa.id = ?`,
            [p.paciente],
          )
        : p.preCadastro !== null
          ? await tx.uma(
              'SELECT sx.sigla FROM pre_cadastro pc JOIN sexo sx ON sx.id = pc.sexo_id WHERE pc.id = ?',
              [p.preCadastro],
            )
          : null;
    if (s) sexo = SEXO_POR_SIGLA[String(s['sigla']).toUpperCase()] ?? null;
    const r = restricaoNaMarcacao(estruturada, {
      data: p.data,
      idadeAnos: idadeEm(p.nascimento, p.data),
      sexo,
      fontePagadoraId: p.fontePagadora,
      itemAgendavelId: p.item ?? null,
      retorno: p.retorno,
      encaixe: p.encaixe,
    });
    if (!r.ok) throw recusa(r.codigo, r.mensagem);
    alertas.push(...r.alertas);
  }
  // Prazo de aviso.
  const prazos = (
    await tx.consultar(
      `SELECT ${COLUNAS_PRAZO} FROM prazo_aviso_marcacao WHERE estabelecimento_id = ? AND ativo
         AND (agenda_servico_id IS NULL OR agenda_servico_id = ?)`,
      [p.estabelecimento, p.agenda],
    )
  ).map(prazoDe);
  const prazo = prazoQueVale(prazos, { agenda: p.agenda, item: p.item ?? null, data: p.data });
  const dp = decidirPrazo(prazo, {
    agora: p.agora.getTime(),
    inicio: p.inicio.getTime(),
    encaixe: p.encaixe,
    administrador: p.administrador,
  });
  if (!dp.ok) throw recusa(dp.codigo, dp.mensagem);
  if (dp.aviso) alertas.push(`Aviso ao paciente: ${dp.aviso}`);
  // Cota de marcação.
  const alvo = {
    agenda: p.agenda,
    fontePagadora: p.fontePagadora,
    especialidade: p.especialidade,
    tipoMarcacao: p.tipoMarcacao,
    item: p.item ?? null,
    data: p.data,
  };
  const candidatas = (
    await tx.consultar(`SELECT ${COLUNAS_COTA} FROM cota_marcacao WHERE estabelecimento_id = ? AND ativo`, [
      p.estabelecimento,
    ])
  )
    .map(cotaDe)
    .filter((c) => cotaAlcanca(c, alvo));
  if (candidatas.length > 0) {
    const travadas = (
      await tx.consultarParaAtualizar(
        `SELECT ${COLUNAS_COTA} FROM cota_marcacao WHERE id IN (${candidatas.map(() => '?').join(', ')}) ORDER BY id`,
        candidatas.map((c) => c.id),
      )
    )
      .map(cotaDe)
      .filter((c) => cotaAlcanca(c, alvo));
    const usos = [];
    for (const c of travadas)
      usos.push({ cota: c, ...(await usoDaCota(tx, p.estabelecimento, c, janelaDaCota(c, p.data))) });
    const dc = decidirCotas(usos, { administrador: p.administrador });
    if (!dc.ok) throw recusa(dc.codigo, dc.mensagem);
    alertas.push(...dc.alertas);
  }
  return alertas;
}

export interface ContextoCotas {
  readonly hospital: string;
  readonly login: string;
}
type ContextoGravacaoCotas = ContextoCotas & {
  correlacao: string;
  chaveIdempotencia: string;
  enderecoIp?: string;
};

export class CotasPrazosPropria {
  private readonly executor: Executor;
  private readonly cotaOp = definirOperacao<EntradaSalvarCota, { cota: number }>({
    nome: 'agenda.cota_marcacao_salvar',
    tabelas: ['cota_marcacao'],
    entrada: esquemaSalvarCota as unknown as z.ZodType<EntradaSalvarCota>,
    gravar: (tx, e, ctx) => this.gravarCota(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'cota_marcacao', id: r.cota }),
  });
  private readonly prazoOp = definirOperacao<EntradaSalvarPrazo, { prazo: number }>({
    nome: 'agenda.prazo_aviso_marcacao_salvar',
    tabelas: ['prazo_aviso_marcacao'],
    entrada: esquemaSalvarPrazo as unknown as z.ZodType<EntradaSalvarPrazo>,
    gravar: (tx, e, ctx) => this.gravarPrazo(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'prazo_aviso_marcacao', id: r.prazo }),
  });

  constructor(
    private readonly nucleo: NucleoAgenda,
    private readonly cliente: string,
    private readonly hoje: () => string = () => new Date().toISOString().slice(0, 10),
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private async quem(c: ContextoCotas): Promise<{ estabelecimento: number; usuario: number | null }> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'cota-prazo' }, async (l) => {
      const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        c.hospital,
      ]);
      if (!e)
        throw new ErroOperacao(
          403,
          'estabelecimento-desconhecido',
          'Estabelecimento',
          'O estabelecimento da sessão não existe no cliente.',
        );
      const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
      return { estabelecimento: num(e['id']), usuario: u ? num(u['id']) : null };
    });
  }

  /** Cotas (com o uso na janela de hoje) e prazos da unidade. */
  async listar(c: ContextoCotas): Promise<{ cotas: CotaLida[]; prazos: PrazoLido[] }> {
    const q = await this.quem(c);
    const hoje = this.hoje();
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'cota-prazo', estabelecimento: q.estabelecimento },
      async (l) => {
        const cs = (
          await l.consultar(
            `SELECT ${COLUNAS_COTA} FROM cota_marcacao WHERE estabelecimento_id = ? ORDER BY ativo DESC, id`,
            [q.estabelecimento],
          )
        ).map(cotaDe);
        const cotas: CotaLida[] = [];
        for (const k of cs) {
          const vigente =
            k.ativo && k.vigenciaInicio <= hoje && (k.vigenciaFim === null || k.vigenciaFim >= hoje);
          if (!vigente) {
            cotas.push({ ...k, uso: null });
            continue;
          }
          const janela = janelaDaCota(k, hoje);
          const u = await usoDaCota(l, q.estabelecimento, k, janela);
          cotas.push({ ...k, uso: { usadas: u.usadas, limite: limiteDaCota(k, u.vagas), ...janela } });
        }
        const prazos = (
          await l.consultar(
            `SELECT ${COLUNAS_PRAZO} FROM prazo_aviso_marcacao WHERE estabelecimento_id = ? ORDER BY ativo DESC, id`,
            [q.estabelecimento],
          )
        ).map(prazoDe);
        return { cotas, prazos };
      },
    );
  }

  /** Opções dos combos da tela (ativos; agendas da unidade). */
  async opcoes(c: ContextoCotas): Promise<OpcoesCota> {
    const q = await this.quem(c);
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'cota-prazo', estabelecimento: q.estabelecimento },
      async (l) => {
        const lista = async (sql: string, p: unknown[] = []) =>
          (await l.consultar(sql, p)).map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
        return {
          agenda: await lista(
            'SELECT id, nome FROM agenda_servico WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome LIMIT 500',
            [q.estabelecimento],
          ),
          fontePagadora: await lista(
            'SELECT id, nome FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome LIMIT 500',
          ),
          especialidade: await lista(
            'SELECT id, descricao AS nome FROM especialidade_medica WHERE ativo ORDER BY descricao LIMIT 500',
          ),
          tipoMarcacao: await lista(
            'SELECT id, descricao AS nome FROM tipo_marcacao WHERE ativo ORDER BY descricao LIMIT 100',
          ),
          item: await lista(
            'SELECT id, descricao AS nome FROM item_agendavel WHERE excluido_em IS NULL ORDER BY descricao LIMIT 500',
          ),
        };
      },
    );
  }

  private async contexto(c: ContextoGravacaoCotas): Promise<ContextoOperacao> {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa(
        'usuario-sem-conta',
        'Gravar a cota ou o prazo exige uma conta de usuário do cliente (o responsável fica no registro).',
      );
    return {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
  }

  async salvarCota(
    c: ContextoGravacaoCotas,
    entrada: unknown,
  ): Promise<{ resultado: { cota: number }; repetida: boolean }> {
    const r = await this.executor.executar(this.cotaOp, this.cliente, entrada, await this.contexto(c));
    return { resultado: r.resultado, repetida: r.repetida };
  }

  async salvarPrazo(
    c: ContextoGravacaoCotas,
    entrada: unknown,
  ): Promise<{ resultado: { prazo: number }; repetida: boolean }> {
    const r = await this.executor.executar(this.prazoOp, this.cliente, entrada, await this.contexto(c));
    return { resultado: r.resultado, repetida: r.repetida };
  }

  /** Os alvos existem; a agenda é da unidade. */
  private async conferirAlvos(
    tx: TxOperacao,
    est: number,
    a: {
      agenda?: number | null;
      fontePagadora?: number | null;
      especialidade?: number | null;
      tipoMarcacao?: number | null;
      item?: number | null;
    },
  ): Promise<void> {
    const falta = (campo: string) =>
      recusa('recorte-inexistente', 'Um item do recorte não existe ou não é desta unidade.', {
        campos: [campo],
      });
    if (a.agenda != null) {
      const x = await tx.uma(
        'SELECT estabelecimento_id FROM agenda_servico WHERE id = ? AND excluido_em IS NULL',
        [a.agenda],
      );
      if (!x || num(x['estabelecimento_id']) !== est) throw falta('agenda');
    }
    if (
      a.fontePagadora != null &&
      !(await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ?', [a.fontePagadora]))
    )
      throw falta('fontePagadora');
    if (
      a.especialidade != null &&
      !(await tx.uma('SELECT id FROM especialidade_medica WHERE id = ?', [a.especialidade]))
    )
      throw falta('especialidade');
    if (
      a.tipoMarcacao != null &&
      !(await tx.uma('SELECT id FROM tipo_marcacao WHERE id = ?', [a.tipoMarcacao]))
    )
      throw falta('tipoMarcacao');
    if (a.item != null && !(await tx.uma('SELECT id FROM item_agendavel WHERE id = ?', [a.item])))
      throw falta('item');
  }

  private async travar(
    tx: TxOperacao,
    tabela: 'cota_marcacao' | 'prazo_aviso_marcacao',
    id: number,
    est: number,
  ) {
    const [x] =
      tabela === 'cota_marcacao'
        ? await tx.consultarParaAtualizar(
            'SELECT id FROM cota_marcacao WHERE id = ? AND estabelecimento_id = ?',
            [id, est],
            {
              teto: 1,
            },
          )
        : await tx.consultarParaAtualizar(
            'SELECT id FROM prazo_aviso_marcacao WHERE id = ? AND estabelecimento_id = ?',
            [id, est],
            { teto: 1 },
          );
    if (!x)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Registro não encontrado',
        'O registro não existe mais.',
      );
  }

  private async gravarCota(
    tx: TxOperacao,
    e: EntradaSalvarCota,
    ctx: ContextoOperacao,
  ): Promise<{ cota: number }> {
    const est = Number(ctx.estabelecimento);
    const rv = validarCota(semChave(e));
    if (rv) throw recusa(rv.codigo, rv.mensagem, rv.campo ? { campos: [rv.campo] } : undefined);
    await this.conferirAlvos(tx, est, e);
    const valores = {
      agenda_servico_id: e.agenda,
      fonte_pagadora_id: e.fontePagadora,
      especialidade_medica_id: e.especialidade,
      tipo_marcacao_id: e.tipoMarcacao,
      item_agendavel_id: e.item,
      periodicidade: e.periodicidade,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
      quantidade_maxima: e.quantidadeMaxima,
      percentual_maximo: e.percentualMaximo,
      acao_ao_esgotar: e.acao,
      ativo: e.ativo,
    };
    if (e.id) {
      await this.travar(tx, 'cota_marcacao', e.id, est);
      await tx.alterar('cota_marcacao', e.id, e.versao!, valores);
      return { cota: e.id };
    }
    return { cota: await tx.incluir('cota_marcacao', { estabelecimento_id: est, ...valores }) };
  }

  private async gravarPrazo(
    tx: TxOperacao,
    e: EntradaSalvarPrazo,
    ctx: ContextoOperacao,
  ): Promise<{ prazo: number }> {
    const est = Number(ctx.estabelecimento);
    const texto = e.textoAviso?.trim() ? e.textoAviso.trim() : null;
    const rv = validarPrazo({ ...semChave(e), textoAviso: texto });
    if (rv) throw recusa(rv.codigo, rv.mensagem, rv.campo ? { campos: [rv.campo] } : undefined);
    await this.conferirAlvos(tx, est, { agenda: e.agenda, item: e.item });
    const valores = {
      agenda_servico_id: e.agenda,
      item_agendavel_id: e.item,
      antecedencia_minima_horas: e.antecedenciaMinimaHoras,
      antecedencia_maxima_dias: e.antecedenciaMaximaDias,
      texto_aviso: texto,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
      ativo: e.ativo,
    };
    if (e.id) {
      await this.travar(tx, 'prazo_aviso_marcacao', e.id, est);
      await tx.alterar('prazo_aviso_marcacao', e.id, e.versao!, valores);
      return { prazo: e.id };
    }
    return { prazo: await tx.incluir('prazo_aviso_marcacao', { estabelecimento_id: est, ...valores }) };
  }
}
