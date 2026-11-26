// Regra própria do plano da fonte pagadora na recepção (02-CAD linha 24), no banco do cliente
// (regra_atendimento_fonte_pagadora; teto e pendência pela migração 04_REC/92_regra_plano_teto_pendencia). A regra é
// do domínio (@sgh/dominio-recepcao, regra-plano): a porta lê as regras da fonte, escolhe a mais específica (plano,
// plano superior, categoria do atendimento, estabelecimento) e aplica a crítica na mesma transação da abertura.
// - Incluir: a regra nova vale para o estabelecimento da sessão (ou para todos). A anterior com a mesma chave que ainda
//   vale no novo início encerra na véspera; a que começa no mesmo dia ou depois recusa (nada se apaga).
// - Encerrar: só a vigência, pela versão; nunca antes da véspera de hoje (o histórico não muda).
// - Prévia: a mesma crítica da abertura, sem gravar, para a recepção e quem configura conferirem na hora.
import {
  type ChaveRegraPlano,
  criticarAberturaPlano,
  type DadosAberturaPlano,
  escolherRegraPlano,
  inicioPeriodoTeto,
  PENDENCIAS_PLANO,
  type PendenciaPlano,
  type RegraPlano,
  type ResultadoCriticaPlano,
  validarEncerramentoRegraPlano,
  validarRegraPlano,
} from '@sgh/dominio-recepcao';
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
import { z } from 'zod';

const TABELA = 'regra_atendimento_fonte_pagadora';
const COLUNAS = `id, fonte_pagadora_id, plano_fonte_pagadora_id, categoria_atendimento_id, estabelecimento_id,
  especialidade_medica_id, servico_atendimento_id, unidade_assistencial_id,
  exige_carteira, exige_validade_carteira, exige_titular, exige_guia, exige_senha_autorizacao, exige_codigo_validacao,
  tamanho_carteira, prefixo_carteira, permite_dependentes, prazo_retorno_dias, documentos_exigidos, orientacao_recepcao,
  teto_atendimentos, teto_periodo_dias, teto_bloqueia, pendencia, pendencia_motivo, vigencia_inicio, vigencia_fim,
  versao`;

const num = (v: unknown): number => Number(v);
const numN = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txtN = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1';
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);

function documentos(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  try {
    const x: unknown = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
}

export interface RegraPlanoVisao extends RegraPlano {
  readonly versao: number;
  readonly vigente: boolean;
}

function regraDaLinha(x: Linha, hoje: string): RegraPlanoVisao {
  const inicio = dataIso(x['vigencia_inicio']) ?? '';
  const fim = dataIso(x['vigencia_fim']);
  return {
    id: num(x['id']),
    fontePagadoraId: num(x['fonte_pagadora_id']),
    planoId: numN(x['plano_fonte_pagadora_id']),
    categoriaId: numN(x['categoria_atendimento_id']),
    estabelecimentoId: numN(x['estabelecimento_id']),
    especialidadeId: numN(x['especialidade_medica_id']),
    servicoId: numN(x['servico_atendimento_id']),
    setorId: numN(x['unidade_assistencial_id']),
    exigeCarteira: bool(x['exige_carteira']),
    exigeValidadeCarteira: bool(x['exige_validade_carteira']),
    exigeTitular: bool(x['exige_titular']),
    exigeGuia: bool(x['exige_guia']),
    exigeSenhaAutorizacao: bool(x['exige_senha_autorizacao']),
    exigeCodigoValidacao: bool(x['exige_codigo_validacao']),
    tamanhoCarteira: numN(x['tamanho_carteira']),
    prefixoCarteira: txtN(x['prefixo_carteira']),
    permiteDependentes: bool(x['permite_dependentes']),
    prazoRetornoDias: numN(x['prazo_retorno_dias']),
    documentosExigidos: documentos(x['documentos_exigidos']),
    orientacaoRecepcao: txtN(x['orientacao_recepcao']),
    tetoAtendimentos: numN(x['teto_atendimentos']),
    tetoPeriodoDias: numN(x['teto_periodo_dias']),
    tetoBloqueia: bool(x['teto_bloqueia']),
    pendencia: (txtN(x['pendencia']) ?? 'nenhuma') as PendenciaPlano,
    pendenciaMotivo: txtN(x['pendencia_motivo']),
    vigenciaInicio: inicio,
    vigenciaFim: fim,
    versao: num(x['versao']),
    vigente: inicio <= hoje && (fim === null || fim >= hoje),
  };
}

async function hojeDoBanco(l: Leitor): Promise<string> {
  const r = await l.uma<Linha>("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje", []);
  return r?.['hoje'] ? String(r['hoje']) : new Date().toISOString().slice(0, 10);
}

/** As regras da fonte pagadora (todas as vigências), as mais recentes primeiro. */
export async function lerRegrasDaFonte(l: Leitor, fonte: number, hoje: string): Promise<RegraPlanoVisao[]> {
  const ls = await l.consultar<Linha>(
    `SELECT ${COLUNAS} FROM regra_atendimento_fonte_pagadora WHERE fonte_pagadora_id = ?
      ORDER BY vigencia_inicio DESC, id DESC`,
    [fonte],
    { teto: 2000 },
  );
  return ls.map((x) => regraDaLinha(x, hoje));
}

/** O que a abertura (ou a prévia) sabe do atendimento. */
export interface PedidoCriticaPlano {
  readonly fontePagadoraId: number;
  readonly planoId: number | null;
  readonly categoriaId: number | null;
  readonly estabelecimentoId: number;
  /** 02-REC linha 37: especialidade, serviço e setor (unidade assistencial) do atendimento; ausente vale nulo. */
  readonly especialidadeId?: number | null;
  readonly servicoId?: number | null;
  readonly setorId?: number | null;
  readonly pacienteId: number | null;
  /** AAAA-MM-DD. */
  readonly data: string;
  readonly carteira: string | null;
  readonly validadeCarteira: string | null;
  readonly guia: string | null;
  readonly senhaAutorizacao: string | null;
  readonly validadeSenha: string | null;
}

export interface CriticaPlanoVisao extends ResultadoCriticaPlano {
  /** A regra aplicada (nula: o plano não tem regra própria vigente). */
  readonly regraId: number | null;
  readonly atendimentosNoPeriodo: number;
}

/** Lê as regras, escolhe a da chave e critica os dados; não grava. */
export async function criticarPlano(l: Leitor, p: PedidoCriticaPlano): Promise<CriticaPlanoVisao> {
  let planoSuperiorId: number | null = null;
  if (p.planoId !== null) {
    const pl = await l.uma<Linha>('SELECT plano_superior_id FROM plano_fonte_pagadora WHERE id = ?', [
      p.planoId,
    ]);
    planoSuperiorId = numN(pl?.['plano_superior_id']);
  }
  const chave: ChaveRegraPlano = {
    planoId: p.planoId,
    planoSuperiorId,
    categoriaId: p.categoriaId,
    estabelecimentoId: p.estabelecimentoId,
    especialidadeId: p.especialidadeId ?? null,
    servicoId: p.servicoId ?? null,
    setorId: p.setorId ?? null,
    data: p.data,
  };
  const regra = escolherRegraPlano(await lerRegrasDaFonte(l, p.fontePagadoraId, p.data), chave);
  let atendimentosNoPeriodo = 0;
  if (regra?.tetoPeriodoDias && p.pacienteId !== null) {
    const inicio = inicioPeriodoTeto(p.data, regra.tetoPeriodoDias);
    const porPlano = regra.planoId !== null && p.planoId !== null;
    const r = await l.uma<Linha>(
      `SELECT COUNT(*) AS n FROM atendimento a
         LEFT JOIN cobertura_atendimento c ON c.atendimento_id = a.id AND c.ordem = 1
        WHERE a.paciente_id = ? AND a.fonte_pagadora_id = ? AND a.situacao <> 'cancelado'
          AND a.entrada_em >= ? AND a.entrada_em < DATE_ADD(?, INTERVAL 1 DAY)
          AND (? = 0 OR c.plano_fonte_pagadora_id = ?)`,
      [p.pacienteId, p.fontePagadoraId, inicio, p.data, porPlano ? 1 : 0, p.planoId ?? 0],
    );
    atendimentosNoPeriodo = num(r?.['n'] ?? 0);
  }
  const dados: DadosAberturaPlano = {
    data: p.data,
    carteira: p.carteira,
    validadeCarteira: p.validadeCarteira,
    guia: p.guia,
    senhaAutorizacao: p.senhaAutorizacao,
    validadeSenha: p.validadeSenha,
    atendimentosNoPeriodo,
  };
  return { ...criticarAberturaPlano(regra, dados), regraId: regra?.id ?? null, atendimentosNoPeriodo };
}

/**
 * A crítica na abertura do atendimento, na transação dela: o primeiro bloqueio recusa (com o campo da tela e todos os
 * motivos); os alertas, os documentos e a orientação voltam para a recepção.
 */
export async function conferirRegraDoPlanoNaAbertura(
  tx: TxOperacao,
  p: PedidoCriticaPlano,
): Promise<CriticaPlanoVisao> {
  const c = await criticarPlano(tx, p);
  const b = c.bloqueios[0];
  if (b)
    throw recusa(b.codigo, c.bloqueios.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(c.bloqueios.map((x) => x.campo))],
    });
  return c;
}

// ── Gravação ─────────────────────────────────────────────────────────────────────────────────────────

const idP = z.number().int().positive();
const dataP = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const esquemaIncluirRegraPlano = z
  .object({
    acao: z.literal('incluir'),
    fonteId: idP,
    planoId: idP.nullable().default(null),
    categoriaId: idP.nullable().default(null),
    especialidadeId: idP.nullable().default(null),
    servicoId: idP.nullable().default(null),
    setorId: idP.nullable().default(null),
    todasUnidades: z.boolean().default(false),
    exigeCarteira: z.boolean().default(false),
    exigeValidadeCarteira: z.boolean().default(false),
    exigeTitular: z.boolean().default(false),
    exigeGuia: z.boolean().default(false),
    exigeSenhaAutorizacao: z.boolean().default(false),
    exigeCodigoValidacao: z.boolean().default(false),
    tamanhoCarteira: z.number().int().nullable().default(null),
    prefixoCarteira: z.string().max(10).nullable().default(null),
    permiteDependentes: z.boolean().default(true),
    prazoRetornoDias: z.number().int().nullable().default(null),
    documentosExigidos: z.array(z.string().max(80)).max(30).default([]),
    orientacaoRecepcao: z.string().max(2000).nullable().default(null),
    tetoAtendimentos: z.number().int().nullable().default(null),
    tetoPeriodoDias: z.number().int().nullable().default(null),
    tetoBloqueia: z.boolean().default(false),
    pendencia: z.enum(PENDENCIAS_PLANO).default('nenhuma'),
    pendenciaMotivo: z.string().max(500).nullable().default(null),
    vigenciaInicio: dataP,
    vigenciaFim: dataP.nullable().default(null),
  })
  .strict();

export const esquemaEncerrarRegraPlano = z
  .object({
    acao: z.literal('encerrar'),
    fonteId: idP,
    id: idP,
    versao: z.number().int().positive(),
    vigenciaFim: dataP,
  })
  .strict();

export const esquemaManterRegraPlano = z.discriminatedUnion('acao', [
  esquemaIncluirRegraPlano,
  esquemaEncerrarRegraPlano,
]);
export type EntradaManterRegraPlano = z.infer<typeof esquemaManterRegraPlano>;
type Incluir = z.infer<typeof esquemaIncluirRegraPlano>;
type Encerrar = z.infer<typeof esquemaEncerrarRegraPlano>;
type ResultadoManter = { id: number; versao: number; encerradas: number };

const vespera = (d: string): string => inicioPeriodoTeto(d, 2);
const nulo = (c: string) => `${c} <=> ?`;

async function incluirRegra(tx: TxOperacao, e: Incluir, est: number): Promise<ResultadoManter> {
  const proposta = {
    ...e,
    estabelecimentoId: e.todasUnidades ? null : est,
    prefixoCarteira: e.prefixoCarteira?.trim() || null,
    pendenciaMotivo: e.pendencia === 'nenhuma' ? null : e.pendenciaMotivo?.trim() || null,
    documentosExigidos: e.documentosExigidos.map((d) => d.trim()),
  };
  const erros = validarRegraPlano(proposta);
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos });
  if (!(await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL', [e.fonteId])))
    throw recusa('referencia-inexistente', 'A fonte pagadora não existe.', { campos: ['fonteId'] });
  if (
    e.planoId !== null &&
    !(await tx.uma(
      'SELECT id FROM plano_fonte_pagadora WHERE id = ? AND fonte_pagadora_id = ? AND excluido_em IS NULL',
      [e.planoId, e.fonteId],
    ))
  )
    throw recusa('referencia-inexistente', 'O plano não é dessa fonte pagadora.', { campos: ['planoId'] });
  if (
    e.categoriaId !== null &&
    !(await tx.uma('SELECT id FROM categoria_atendimento WHERE id = ?', [e.categoriaId]))
  )
    throw recusa('referencia-inexistente', 'A categoria de atendimento não existe.', {
      campos: ['categoriaId'],
    });
  // 02-REC linha 37: a especialidade, o serviço e o setor (do estabelecimento da sessão) têm de existir e estar ativos.
  const refs: [number | null, string, string, unknown[]][] = [
    [e.especialidadeId, 'especialidadeId', 'SELECT id FROM especialidade_medica WHERE id = ? AND ativo', []],
    [e.servicoId, 'servicoId', 'SELECT id FROM servico_atendimento WHERE id = ? AND ativo', []],
    [
      e.setorId,
      'setorId',
      'SELECT id FROM unidade_assistencial WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
      [est],
    ],
  ];
  for (const [id, campo, sql, mais] of refs)
    if (id !== null && !(await tx.uma(sql, [id, ...mais])))
      throw recusa('referencia-inexistente', 'A especialidade, o serviço ou o setor escolhido não existe.', {
        campos: [campo],
      });
  if (e.setorId !== null && e.todasUnidades)
    throw recusa('entrada-invalida', 'A regra de um setor vale só no estabelecimento dele.', {
      campos: ['setorId'],
    });
  const chave = {
    fonte_pagadora_id: e.fonteId,
    plano_fonte_pagadora_id: e.planoId,
    categoria_atendimento_id: e.categoriaId,
    estabelecimento_id: proposta.estabelecimentoId,
    especialidade_medica_id: e.especialidadeId,
    servico_atendimento_id: e.servicoId,
    unidade_assistencial_id: e.setorId,
  };
  const cols = Object.keys(chave) as (keyof typeof chave)[];
  const anteriores = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, vigencia_inicio FROM regra_atendimento_fonte_pagadora
      WHERE ${cols.map(nulo).join(' AND ')} AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
    [...cols.map((c) => chave[c]), e.vigenciaInicio],
  );
  let encerradas = 0;
  for (const r of anteriores) {
    if ((dataIso(r['vigencia_inicio']) ?? '') >= e.vigenciaInicio)
      throw recusa(
        'regra-sobreposta',
        'Já existe regra deste plano que começa nesta data ou depois: encerre-a ou escolha outro início.',
        { campos: ['vigenciaInicio'] },
      );
    await tx.alterar(TABELA, num(r['id']), num(r['versao']), { vigencia_fim: vespera(e.vigenciaInicio) });
    encerradas++;
  }
  const id = await tx.incluir(TABELA, {
    ...chave,
    exige_carteira: e.exigeCarteira,
    exige_validade_carteira: e.exigeValidadeCarteira,
    exige_titular: e.exigeTitular,
    exige_guia: e.exigeGuia,
    exige_senha_autorizacao: e.exigeSenhaAutorizacao,
    exige_codigo_validacao: e.exigeCodigoValidacao,
    tamanho_carteira: e.tamanhoCarteira,
    prefixo_carteira: proposta.prefixoCarteira,
    permite_dependentes: e.permiteDependentes,
    prazo_retorno_dias: e.prazoRetornoDias,
    documentos_exigidos: proposta.documentosExigidos.length
      ? JSON.stringify(proposta.documentosExigidos)
      : null,
    orientacao_recepcao: e.orientacaoRecepcao?.trim() || null,
    teto_atendimentos: e.tetoAtendimentos,
    teto_periodo_dias: e.tetoPeriodoDias,
    teto_bloqueia: e.tetoBloqueia,
    pendencia: e.pendencia,
    pendencia_motivo: proposta.pendenciaMotivo,
    vigencia_inicio: e.vigenciaInicio,
    vigencia_fim: e.vigenciaFim,
  });
  return { id, versao: 1, encerradas };
}

async function encerrarRegra(tx: TxOperacao, e: Encerrar, est: number): Promise<ResultadoManter> {
  const r = await tx.uma<Linha>(
    `SELECT id, vigencia_inicio, vigencia_fim FROM regra_atendimento_fonte_pagadora
      WHERE id = ? AND fonte_pagadora_id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
    [e.id, e.fonteId, est],
  );
  if (!r) throw recusa('nao-encontrado', 'A regra não existe nesta fonte pagadora.', { campos: ['id'] });
  const erros = validarEncerramentoRegraPlano(
    dataIso(r['vigencia_inicio']) ?? '',
    dataIso(r['vigencia_fim']),
    e.vigenciaFim,
    await hojeDoBanco(tx),
  );
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos });
  const versao = await tx.alterar(TABELA, e.id, e.versao, { vigencia_fim: e.vigenciaFim });
  return { id: e.id, versao, encerradas: 0 };
}

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoRegraPlano {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

export interface ContextoRegraPlano {
  /** Código do estabelecimento da sessão. */
  readonly hospital: string;
  readonly login: string;
}

export interface Opcao {
  readonly id: number;
  readonly rotulo: string;
}

export interface RegrasPlanoDaFonte {
  readonly fonte: Opcao;
  readonly hoje: string;
  readonly planos: Opcao[];
  readonly categorias: Opcao[];
  /** 02-REC linha 37: as opções da chave por especialidade, serviço e setor. */
  readonly especialidades: Opcao[];
  readonly servicos: Opcao[];
  readonly setores: Opcao[];
  readonly regras: RegraPlanoVisao[];
}

export const esquemaPreviaRegraPlano = z
  .object({
    fonteId: idP,
    planoId: idP.nullable().default(null),
    categoriaId: idP.nullable().default(null),
    especialidadeId: idP.nullable().default(null),
    servicoId: idP.nullable().default(null),
    setorId: idP.nullable().default(null),
    pacienteId: idP.nullable().default(null),
    data: dataP.optional(),
    carteira: z.string().max(30).nullable().default(null),
    validadeCarteira: dataP.nullable().default(null),
    guia: z.string().max(30).nullable().default(null),
    senhaAutorizacao: z.string().max(30).nullable().default(null),
    validadeSenha: dataP.nullable().default(null),
  })
  .strict();
export type EntradaPreviaRegraPlano = z.infer<typeof esquemaPreviaRegraPlano>;

export class RegraPlanoPropria {
  private readonly executor: Executor;
  private readonly operacao = definirOperacao<EntradaManterRegraPlano, ResultadoManter>({
    nome: 'atendimento.manter_regra_plano',
    tabelas: [TABELA],
    entrada: esquemaManterRegraPlano as unknown as z.ZodType<EntradaManterRegraPlano>,
    gravar: (tx, e, ctx) => {
      const est = ctx.estabelecimento as number;
      return e.acao === 'incluir' ? incluirRegra(tx, e, est) : encerrarRegra(tx, e, est);
    },
    alvo: (_e, r) => ({ tabela: TABELA, id: r.id }),
  });

  constructor(
    private readonly nucleo: NucleoRegraPlano,
    private readonly cliente: string,
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'regra-plano' }, fn);
  }

  private async quem(
    l: Leitor,
    c: ContextoRegraPlano,
  ): Promise<{ estabelecimento: number; usuario: number | null }> {
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
  }

  /** As fontes pagadoras ativas, para escolher na tela. */
  fontes(): Promise<Opcao[]> {
    return this.ler(async (l) =>
      (
        await l.consultar<Linha>(
          "SELECT id, nome FROM fonte_pagadora WHERE excluido_em IS NULL AND situacao = 'ativa' ORDER BY nome",
          [],
          { teto: 2000 },
        )
      ).map((x) => ({ id: num(x['id']), rotulo: String(x['nome']) })),
    );
  }

  /** As regras da fonte, com os planos e as categorias para os combos. */
  regras(c: ContextoRegraPlano, fonte: number): Promise<RegrasPlanoDaFonte> {
    return this.ler(async (l) => {
      const { estabelecimento } = await this.quem(l, c);
      const f = await l.uma<Linha>(
        'SELECT id, nome FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL',
        [fonte],
      );
      if (!f) throw new ErroOperacao(404, 'nao-encontrado', 'Fonte pagadora', 'A fonte pagadora não existe.');
      const hoje = await hojeDoBanco(l);
      const planos = (
        await l.consultar<Linha>(
          `SELECT id, codigo, descricao FROM plano_fonte_pagadora
            WHERE fonte_pagadora_id = ? AND excluido_em IS NULL ORDER BY descricao`,
          [fonte],
          { teto: 2000 },
        )
      ).map((x) => ({ id: num(x['id']), rotulo: `${String(x['codigo'])} · ${String(x['descricao'])}` }));
      const categorias = (
        await l.consultar<Linha>(
          'SELECT id, descricao FROM categoria_atendimento WHERE ativo ORDER BY descricao',
          [],
          {
            teto: 200,
          },
        )
      ).map((x) => ({ id: num(x['id']), rotulo: String(x['descricao']) }));
      const opcoes = async (sql: string, ps: unknown[]) =>
        (await l.consultar<Linha>(sql, ps, { teto: 2000 })).map((x) => ({
          id: num(x['id']),
          rotulo: String(x['rotulo']),
        }));
      const especialidades = await opcoes(
        'SELECT id, descricao AS rotulo FROM especialidade_medica WHERE ativo ORDER BY descricao',
        [],
      );
      const servicos = await opcoes(
        'SELECT id, descricao AS rotulo FROM servico_atendimento WHERE ativo ORDER BY descricao',
        [],
      );
      const setores = await opcoes(
        'SELECT id, nome AS rotulo FROM unidade_assistencial WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY nome',
        [estabelecimento],
      );
      const regras = (await lerRegrasDaFonte(l, fonte, hoje)).filter(
        (r) => r.estabelecimentoId === null || r.estabelecimentoId === estabelecimento,
      );
      return {
        fonte: { id: num(f['id']), rotulo: String(f['nome']) },
        hoje,
        planos,
        categorias,
        especialidades,
        servicos,
        setores,
        regras,
      };
    });
  }

  /** A prévia da crítica da abertura (nada gravado). */
  previa(c: ContextoRegraPlano, e: EntradaPreviaRegraPlano): Promise<CriticaPlanoVisao> {
    return this.ler(async (l) => {
      const { estabelecimento } = await this.quem(l, c);
      return criticarPlano(l, {
        fontePagadoraId: e.fonteId,
        planoId: e.planoId,
        categoriaId: e.categoriaId,
        estabelecimentoId: estabelecimento,
        especialidadeId: e.especialidadeId,
        servicoId: e.servicoId,
        setorId: e.setorId,
        pacienteId: e.pacienteId,
        data: e.data ?? (await hojeDoBanco(l)),
        carteira: e.carteira,
        validadeCarteira: e.validadeCarteira,
        guia: e.guia,
        senhaAutorizacao: e.senhaAutorizacao,
        validadeSenha: e.validadeSenha,
      });
    });
  }

  async manter(
    c: ContextoRegraPlano & { correlacao: string; chaveIdempotencia: string; enderecoIp?: string },
    entrada: unknown,
  ): Promise<{ resultado: ResultadoManter; repetida: boolean }> {
    const q = await this.ler((l) => this.quem(l, c));
    if (q.usuario === null)
      throw recusa(
        'usuario-sem-conta',
        'Manter a regra do plano exige uma conta de usuário do cliente (o responsável fica no registro).',
      );
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(this.operacao, this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida };
  }
}
