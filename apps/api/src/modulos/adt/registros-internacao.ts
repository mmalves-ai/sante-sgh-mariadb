// Registros da internação além do retrato da admissão (F3.4, 04-INT linhas 65, 67 e 68), sobre o banco do cliente:
//   - quem opera cada unidade (permissao_unidade_usuario): definida pelo cadastro da estrutura e conferida na
//     admissão, na transferência (unidade de destino) e na alta; a unidade sem regra fica com o cargo;
//   - os diagnósticos da internação (diagnostico_internacao): a entrada e o secundário nascem na admissão; os demais
//     (principal confirmado, secundários, causa externa) entram pela tela; nada é apagado;
//   - o acidente que motivou a internação (acidente_internacao), conferido na hora;
//   - a guia inicial e as prorrogações (guia_internacao), cada uma com a sua validade e quem autorizou; a internação
//     guarda o retrato da guia vigente, o histórico nunca é sobrescrito.
// As regras são as puras de @sgh/dominio-internacao (registros-internacao.ts); aqui ficam a leitura e a gravação.
import {
  conferirAcidente,
  conferirDiagnostico,
  conferirMotivo,
  corrigirGuia,
  decidirPermissaoUnidade,
  diagnosticosDaAdmissao,
  diariasAutorizadasTotal,
  type AcaoUnidade,
  type GuiaAutorizada,
  proximaGuia,
  TIPOS_ACIDENTE,
  TIPOS_DIAGNOSTICO_TELA,
} from '@sgh/dominio-internacao';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Leitor,
  type Operacao,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { FUSO_PADRAO, instanteCivil, relogioNoFuso } from '../exames/relogio.js';

type Linha = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const numOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);
const textoLivre = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? undefined : s))
    .optional();
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.');
const DATA_HORA = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Use a data e a hora.');

function estabelecimento(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
const recusaCampo = (codigo: string, motivo: string, campo: string) =>
  recusa(codigo, motivo, { campos: [campo] });

async function fuso(tx: Pick<TxOperacao, 'uma'>, est: number): Promise<string> {
  const l = await tx.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return l?.fuso_horario || FUSO_PADRAO;
}
/** "AAAA-MM-DDTHH:MM" no fuso do estabelecimento. */
const civil = (f: string, d: Date) => {
  const r = relogioNoFuso(f, d);
  return `${r.hoje}T${r.hora}`;
};

/** A internação do estabelecimento, travada (serializa a sequência dos registros). Cancelada é recusa. */
async function internacaoDoEstabelecimento(tx: TxOperacao, est: number, id: number): Promise<Linha> {
  const [i] = await tx.consultarParaAtualizar(
    `SELECT id, situacao, data_hora_entrada, unidade_internacao_id, versao
       FROM internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!i)
    throw new ErroOperacao(
      404,
      'registro-inexistente',
      'Internação não encontrada',
      'A internação não existe neste estabelecimento.',
    );
  if (i['situacao'] === 'cancelada') throw recusa('internacao-cancelada', 'A internação foi excluída.');
  return i;
}

// ── Quem opera a unidade ─────────────────────────────────────────────────────────────────────────

const COLUNA_ACAO: Readonly<Record<AcaoUnidade, string>> = {
  admitir: 'pode_admitir',
  transferir: 'pode_transferir',
  darAlta: 'pode_dar_alta',
};

/**
 * O acesso total da sessão (administrador da plataforma, ADR 0022), quando o contexto da operação o traz. Nenhuma
 * coluna do banco do cliente concede isto: vem só da sessão da plataforma.
 */
export const acessoTotalDe = (ctx: object): boolean =>
  (ctx as { readonly acessoTotal?: unknown }).acessoTotal === true;

/** A linha da tabela compartilhada tem alguma permissão de material da unidade (fora da internação). */
const COLUNAS_MATERIAL = [
  'pode_solicitar_material_setor',
  'pode_solicitar_material_paciente',
  'pode_movimentar_estoque',
  'pode_confirmar_recebimento',
] as const;
const temPermissaoDeMaterial = (a: Linha): boolean =>
  a['setor_funcional_id'] !== null && a['setor_funcional_id'] !== undefined
    ? true
    : COLUNAS_MATERIAL.some((c) => Boolean(a[c]));

/**
 * Recusa a ação quando a unidade tem operadores de internação definidos e o usuário não está liberado para ela. As
 * linhas que só liberam material (a mesma tabela) não contam; o acesso total da sessão passa.
 */
export async function exigirOperadorDaUnidade(
  tx: Pick<TxOperacao, 'consultar'>,
  unidade: number | null,
  usuario: number | null,
  acao: AcaoUnidade,
  acessoTotal = false,
): Promise<void> {
  if (unidade === null || acessoTotal) return;
  const regras = await tx.consultar(
    `SELECT usuario_id, pode_admitir, pode_transferir, pode_dar_alta
       FROM permissao_unidade_usuario
      WHERE unidade_internacao_id = ? AND excluido_em IS NULL
        AND (pode_admitir OR pode_transferir OR pode_dar_alta)`,
    [unidade],
  );
  const d = decidirPermissaoUnidade(
    regras.map((r) => ({
      usuario: num(r['usuario_id']),
      podeAdmitir: Boolean(r['pode_admitir']),
      podeTransferir: Boolean(r['pode_transferir']),
      podeDarAlta: Boolean(r['pode_dar_alta']),
    })),
    usuario,
    acao,
    { acessoTotal },
  );
  if (!d.permitido) throw recusa('unidade-sem-permissao', d.motivo, { campos: [COLUNA_ACAO[acao]] });
}

export const esquemaDefinirOperadoresUnidade = z
  .object({
    unidade: z.number().int().positive(),
    operadores: z
      .array(
        z
          .object({
            usuario: z.number().int().positive(),
            podeAdmitir: z.boolean(),
            podeTransferir: z.boolean(),
            podeDarAlta: z.boolean(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
type DefinirOperadoresEntrada = z.infer<typeof esquemaDefinirOperadoresUnidade>;

/**
 * Define quem opera a unidade (lista inteira de uma vez, como a tela mostra): inclui os novos, altera os que mudaram
 * e retira (exclusão lógica) os que saíram da lista. Lista vazia devolve a unidade ao controle só pelo cargo.
 */
const definirOperadoresUnidade = definirOperacao<DefinirOperadoresEntrada, ResultadoOperacao>({
  nome: 'internacao.definir-operadores-unidade',
  tabelas: ['permissao_unidade_usuario'],
  entrada: esquemaDefinirOperadoresUnidade,
  async gravar(tx, e, ctx) {
    const est = estabelecimento(ctx);
    const u = await tx.uma('SELECT id FROM unidade_internacao WHERE id = ? AND estabelecimento_id = ?', [
      e.unidade,
      est,
    ]);
    if (!u)
      throw recusaCampo(
        'unidade-inexistente',
        'A unidade de internação não existe neste estabelecimento.',
        'unidade',
      );
    const repetido = e.operadores.find(
      (o, i) => e.operadores.findIndex((x) => x.usuario === o.usuario) !== i,
    );
    if (repetido)
      throw recusaCampo('usuario-repetido', 'O mesmo usuário aparece duas vezes na lista.', 'operadores');
    for (const o of e.operadores) {
      const us = await tx.uma('SELECT id FROM usuario WHERE id = ?', [o.usuario]);
      if (!us) throw recusaCampo('usuario-inexistente', 'Um dos usuários da lista não existe.', 'operadores');
    }
    const atuais = await tx.consultarParaAtualizar(
      `SELECT id, usuario_id, versao, excluido_em, pode_admitir, pode_transferir, pode_dar_alta, setor_funcional_id,
              ${COLUNAS_MATERIAL.join(', ')}
         FROM permissao_unidade_usuario WHERE unidade_internacao_id = ?`,
      [e.unidade],
    );
    const porUsuario = new Map(atuais.map((a) => [num(a['usuario_id']), a]));
    let incluidos = 0;
    let alterados = 0;
    let retirados = 0;
    for (const o of e.operadores) {
      const valores = {
        pode_admitir: o.podeAdmitir,
        pode_transferir: o.podeTransferir,
        pode_dar_alta: o.podeDarAlta,
      };
      const a = porUsuario.get(o.usuario);
      if (!a) {
        await tx.incluir('permissao_unidade_usuario', {
          usuario_id: o.usuario,
          unidade_internacao_id: e.unidade,
          ...valores,
        });
        incluidos++;
      } else if (
        a['excluido_em'] !== null ||
        Boolean(a['pode_admitir']) !== o.podeAdmitir ||
        Boolean(a['pode_transferir']) !== o.podeTransferir ||
        Boolean(a['pode_dar_alta']) !== o.podeDarAlta
      ) {
        await tx.alterar('permissao_unidade_usuario', num(a['id']), num(a['versao']), {
          ...valores,
          excluido_em: null,
          excluido_por: null,
        });
        alterados++;
      }
    }
    // Quem saiu da lista perde só as ações da internação; a linha é retirada (exclusão lógica) apenas quando não
    // guarda também permissões de material da unidade, que são de outra função e continuam valendo.
    const naLista = new Set(e.operadores.map((o) => o.usuario));
    for (const a of atuais)
      if (
        a['excluido_em'] === null &&
        !naLista.has(num(a['usuario_id'])) &&
        (Boolean(a['pode_admitir']) || Boolean(a['pode_transferir']) || Boolean(a['pode_dar_alta']))
      ) {
        await tx.alterar('permissao_unidade_usuario', num(a['id']), num(a['versao']), {
          pode_admitir: false,
          pode_transferir: false,
          pode_dar_alta: false,
          ...(temPermissaoDeMaterial(a) ? {} : { excluido_em: new Date(), excluido_por: ctx.usuario }),
        });
        retirados++;
      }
    return { unidade: e.unidade, incluidos, alterados, retirados };
  },
  alvo: (e) => ({ tabela: 'unidade_internacao', id: e.unidade }),
});

// ── Diagnósticos ─────────────────────────────────────────────────────────────────────────────────

/** Grava os diagnósticos que nascem com a admissão (entrada e secundário), na transação da admissão. */
export async function gravarDiagnosticosDaAdmissao(
  tx: TxOperacao,
  internacao: number,
  cidPrincipal: number,
  cidSecundario: number | null | undefined,
  registradoEm: Date,
  profissional: number | null,
): Promise<void> {
  const codigoDe = async (id: number) =>
    (await tx.uma<{ codigo_termo: string }>('SELECT codigo_termo FROM termo_terminologia WHERE id = ?', [id]))
      ?.codigo_termo ?? '';
  const r = diagnosticosDaAdmissao(
    { cid: cidPrincipal, codigo: await codigoDe(cidPrincipal) },
    cidSecundario ? { cid: cidSecundario, codigo: await codigoDe(cidSecundario) } : null,
  );
  if (!r.ok) throw recusaCampo('diagnostico-invalido', r.motivo, r.campo);
  for (const d of r.valor)
    await tx.incluir('diagnostico_internacao', {
      internacao_id: internacao,
      sequencia: d.sequencia,
      cid_termo_terminologia_id: d.cid,
      tipo: d.tipo,
      registrado_em: registradoEm,
      profissional_id: profissional,
    });
}

export const esquemaRegistrarDiagnostico = z
  .object({
    internacao: z.number().int().positive(),
    cid: z.number().int().positive(),
    tipo: z.enum(TIPOS_DIAGNOSTICO_TELA as unknown as [string, ...string[]]),
    observacao: textoLivre(1000),
  })
  .strict();
type RegistrarDiagnosticoEntrada = z.infer<typeof esquemaRegistrarDiagnostico>;

const registrarDiagnostico = definirOperacao<RegistrarDiagnosticoEntrada, ResultadoOperacao>({
  nome: 'internacao.registrar-diagnostico',
  tabelas: ['diagnostico_internacao'],
  entrada: esquemaRegistrarDiagnostico,
  acao: 'inclusao',
  async gravar(tx, e, ctx) {
    const est = estabelecimento(ctx);
    await internacaoDoEstabelecimento(tx, est, e.internacao);
    const t = await tx.uma<{ codigo_termo: string }>(
      `SELECT t.codigo_termo FROM termo_terminologia t JOIN terminologia tt ON tt.id = t.terminologia_id
        WHERE t.id = ? AND tt.codigo = 'cid10'`,
      [e.cid],
    );
    if (!t) throw recusaCampo('cid-inexistente', 'Escolha o CID-10 na busca.', 'cid');
    // Os vigentes: sem os retirados (lançados por engano) e sem os principais já substituídos.
    const existentes = await tx.consultar(
      `SELECT id, versao, cid_termo_terminologia_id AS cid, tipo, sequencia FROM diagnostico_internacao
        WHERE internacao_id = ? AND excluido_em IS NULL AND substituido_em IS NULL`,
      [e.internacao],
    );
    const todos = await tx.consultar('SELECT sequencia FROM diagnostico_internacao WHERE internacao_id = ?', [
      e.internacao,
    ]);
    const r = conferirDiagnostico(
      existentes.map((x) => ({
        cid: num(x['cid']),
        tipo: String(x['tipo']),
        sequencia: num(x['sequencia']),
      })),
      { cid: e.cid, codigo: t.codigo_termo, tipo: e.tipo as never },
    );
    if (!r.ok) throw recusaCampo('diagnostico-invalido', r.motivo, r.campo);
    const sequencia = todos.reduce((m, x) => Math.max(m, num(x['sequencia'])), 0) + 1;
    // O profissional do usuário no estabelecimento (vínculo vigente), quando houver: quem registrou o diagnóstico.
    const prof = await tx.uma<{ id: number }>(
      `SELECT v.profissional_id AS id FROM usuario_vinculo_profissional v
        WHERE v.usuario_id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
          AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
        ORDER BY v.vigencia_inicio DESC LIMIT 1`,
      [ctx.usuario, est],
    );
    const id = await tx.incluir('diagnostico_internacao', {
      internacao_id: e.internacao,
      sequencia,
      cid_termo_terminologia_id: e.cid,
      tipo: e.tipo,
      registrado_em: new Date(),
      profissional_id: prof ? num(prof.id) : null,
      observacao: e.observacao ?? null,
    });
    // Um principal vigente só: o anterior fica no histórico, marcado como substituído pelo novo.
    const anterior = existentes.find((x) => num(x['sequencia']) === r.valor.substitui);
    if (anterior)
      await tx.alterar('diagnostico_internacao', num(anterior['id']), num(anterior['versao']), {
        substituido_em: new Date(),
        substituido_por_diagnostico_id: id,
      });
    return {
      internacao: e.internacao,
      diagnostico: id,
      sequencia,
      ...(anterior ? { substituiu: num(anterior['sequencia']) } : {}),
    };
  },
  alvo: (e) => ({ tabela: 'internacao', id: e.internacao }),
});

export const esquemaRetirarDiagnostico = z
  .object({
    internacao: z.number().int().positive(),
    sequencia: z.number().int().positive(),
    motivo: z.string().trim().max(400),
  })
  .strict();
type RetirarDiagnosticoEntrada = z.infer<typeof esquemaRetirarDiagnostico>;

/**
 * Retira o diagnóstico lançado por engano: exclusão lógica com quem, quando e o motivo, nunca DELETE. O registro fica
 * na leitura como "retirado", separado dos vigentes.
 */
const retirarDiagnostico = definirOperacao<RetirarDiagnosticoEntrada, ResultadoOperacao>({
  nome: 'internacao.retirar-diagnostico',
  tabelas: ['diagnostico_internacao'],
  entrada: esquemaRetirarDiagnostico,
  async gravar(tx, e, ctx) {
    const est = estabelecimento(ctx);
    await internacaoDoEstabelecimento(tx, est, e.internacao);
    const m = conferirMotivo(e.motivo);
    if (!m.ok) throw recusaCampo('motivo-obrigatorio', m.motivo, m.campo);
    const [d] = await tx.consultarParaAtualizar(
      'SELECT id, versao, excluido_em FROM diagnostico_internacao WHERE internacao_id = ? AND sequencia = ?',
      [e.internacao, e.sequencia],
    );
    if (!d)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Diagnóstico não encontrado',
        'O diagnóstico não existe nesta internação.',
      );
    if (d['excluido_em'] !== null) throw recusa('diagnostico-retirado', 'O diagnóstico já foi retirado.');
    await tx.alterar('diagnostico_internacao', num(d['id']), num(d['versao']), {
      excluido_em: new Date(),
      excluido_por: ctx.usuario,
      motivo_retirada: m.valor,
    });
    return { internacao: e.internacao, sequencia: e.sequencia };
  },
  alvo: (e) => ({ tabela: 'internacao', id: e.internacao }),
  trilha: (e) => ({ motivo: e.motivo.slice(0, 200) }),
});

// ── Acidente ─────────────────────────────────────────────────────────────────────────────────────

export const esquemaRegistrarAcidente = z
  .object({
    internacao: z.number().int().positive(),
    tipo: z.enum(TIPOS_ACIDENTE),
    ocorridoEm: DATA_HORA.optional(),
    local: textoLivre(255),
    municipio: z.number().int().positive().optional(),
    empregadorCnpj: z
      .string()
      .transform((s) => s.replace(/\D/g, ''))
      .optional()
      .transform((s) => (s ? s : undefined)),
    empregadorNome: textoLivre(150),
    vinculo: z
      .enum([
        'empregado',
        'empregado_domestico',
        'avulso',
        'segurado_especial',
        'contribuinte_individual',
        'servidor_publico',
        'desempregado',
        'nao_segurado',
        'outro',
      ])
      .optional(),
    ocupacao: z.number().int().positive().optional(),
    numeroComunicacao: textoLivre(30),
    comunicacaoEmitidaEm: DATA.optional(),
    boletimOcorrencia: textoLivre(50),
    descricao: textoLivre(2000),
  })
  .strict();
type RegistrarAcidenteEntrada = z.infer<typeof esquemaRegistrarAcidente>;

const registrarAcidente = definirOperacao<RegistrarAcidenteEntrada, ResultadoOperacao>({
  nome: 'internacao.registrar-acidente',
  tabelas: ['acidente_internacao'],
  entrada: esquemaRegistrarAcidente,
  acao: 'inclusao',
  async gravar(tx, e, ctx) {
    const est = estabelecimento(ctx);
    const i = await internacaoDoEstabelecimento(tx, est, e.internacao);
    const f = await fuso(tx, est);
    const r = conferirAcidente(e, civil(f, i['data_hora_entrada'] as Date));
    if (!r.ok) throw recusaCampo('acidente-invalido', r.motivo, r.campo);
    if (e.municipio && !(await tx.uma('SELECT id FROM municipio_ibge WHERE id = ?', [e.municipio])))
      throw recusaCampo('municipio-inexistente', 'Escolha o município na busca.', 'municipio');
    if (e.ocupacao && !(await tx.uma('SELECT id FROM ocupacao_cbo WHERE id = ?', [e.ocupacao])))
      throw recusaCampo('ocupacao-inexistente', 'Escolha a ocupação na busca.', 'ocupacao');
    const seq = await tx.uma<{ s: number }>(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM acidente_internacao WHERE internacao_id = ?',
      [e.internacao],
    );
    const sequencia = num(seq?.s ?? 1);
    const id = await tx.incluir('acidente_internacao', {
      internacao_id: e.internacao,
      sequencia,
      tipo_acidente: e.tipo,
      ocorrido_em: e.ocorridoEm
        ? instanteCivil(e.ocorridoEm.slice(0, 10), e.ocorridoEm.slice(11, 16), f)
        : null,
      local_ocorrencia: e.local ?? null,
      municipio_ibge_id: e.municipio ?? null,
      empregador_cnpj: e.empregadorCnpj ?? null,
      empregador_nome: e.empregadorNome ?? null,
      vinculo_previdenciario: e.vinculo ?? null,
      ocupacao_cbo_id: e.ocupacao ?? null,
      numero_comunicacao_acidente: e.numeroComunicacao ?? null,
      comunicacao_emitida_em: e.comunicacaoEmitidaEm ?? null,
      boletim_ocorrencia: e.boletimOcorrencia ?? null,
      descricao: e.descricao ?? null,
    });
    return { internacao: e.internacao, acidente: id, sequencia };
  },
  alvo: (e) => ({ tabela: 'internacao', id: e.internacao }),
});

// ── Guias (inicial e prorrogações) ───────────────────────────────────────────────────────────────

export interface GuiaNova {
  readonly internacao: number;
  readonly conta: number | null;
  readonly guia: string;
  readonly senha?: string | undefined;
  readonly validadeDias: number;
  readonly inicio?: string | undefined;
  readonly autorizador?: string | undefined;
  readonly observacao?: string | undefined;
}

/**
 * Grava a próxima guia do histórico (inicial ou prorrogação) com a validade calculada; devolve a guia para o retrato da
 * internação. Chamada pela operação de registrar a guia, na mesma transação.
 */
export async function gravarGuiaNoHistorico(
  tx: TxOperacao,
  est: number,
  entradaEm: Date,
  g: GuiaNova,
): Promise<GuiaAutorizada & { diariasTotais: number }> {
  const f = await fuso(tx, est);
  const h = (await historicoDeGuias(tx, g.internacao)).map((x) => x.guia);
  const r = proximaGuia(h, { diarias: g.validadeDias, inicio: g.inicio }, civil(f, entradaEm));
  if (!r.ok) throw recusaCampo('guia-invalida', r.motivo, r.campo);
  if (g.conta !== null) {
    const c = await tx.uma('SELECT id FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ?', [
      g.conta,
      est,
    ]);
    if (!c)
      throw recusaCampo('conta-inexistente', 'A conta da guia não existe neste estabelecimento.', 'conta');
  }
  await tx.incluir('guia_internacao', {
    internacao_id: g.internacao,
    conta_hospitalar_id: g.conta,
    sequencia: r.valor.sequencia,
    tipo: r.valor.tipo,
    numero_guia: g.guia,
    senha: g.senha ?? null,
    diarias_autorizadas: r.valor.diarias,
    inicio_validade: r.valor.inicio,
    fim_validade: r.valor.fim,
    autorizador_nome: g.autorizador ?? null,
    observacao: g.observacao ?? null,
  });
  return { ...r.valor, diariasTotais: diariasAutorizadasTotal([...h, r.valor]) };
}

async function historicoDeGuias(
  tx: Pick<TxOperacao, 'consultar'>,
  internacao: number,
): Promise<{ id: number; versao: number; guia: GuiaAutorizada }[]> {
  const l = await tx.consultar(
    `SELECT id, versao, sequencia, tipo, inicio_validade, fim_validade, diarias_autorizadas
       FROM guia_internacao WHERE internacao_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
    [internacao],
  );
  return l.map((x) => ({
    id: num(x['id']),
    versao: num(x['versao']),
    guia: {
      sequencia: num(x['sequencia']),
      tipo: x['tipo'] === 'inicial' ? 'inicial' : 'prorrogacao',
      inicio: dataIso(x['inicio_validade'])!,
      fim: dataIso(x['fim_validade'])!,
      diarias: num(x['diarias_autorizadas']),
    },
  }));
}

export const esquemaCorrigirGuia = z
  .object({
    internacao: z.number().int().positive(),
    sequencia: z.number().int().positive(),
    guia: z.string().trim().min(1, 'Informe o número da guia.').max(20),
    senha: textoLivre(20),
    autorizador: textoLivre(150),
    validadeDias: z.number().int().min(1).max(999).optional(),
    inicio: DATA.optional(),
    motivo: z.string().trim().max(400),
  })
  .strict();
type CorrigirGuiaEntrada = z.infer<typeof esquemaCorrigirGuia>;

/**
 * Corrige uma guia do histórico (número, senha, autorizador e, só na última, o período), com motivo: a linha muda de
 * versão (a trilha guarda o antes e o depois), sem linha nova e sem somar diárias. O retrato da internação segue a
 * guia vigente (a última) e o total autorizado.
 */
const corrigirGuiaOp = definirOperacao<CorrigirGuiaEntrada, ResultadoOperacao>({
  nome: 'internacao.corrigir-guia',
  tabelas: ['guia_internacao', 'internacao'],
  entrada: esquemaCorrigirGuia,
  async gravar(tx, e, ctx) {
    const est = estabelecimento(ctx);
    const i = await internacaoDoEstabelecimento(tx, est, e.internacao);
    const m = conferirMotivo(e.motivo);
    if (!m.ok) throw recusaCampo('motivo-obrigatorio', m.motivo, m.campo);
    const h = await historicoDeGuias(tx, e.internacao);
    const alvo = h.find((x) => x.guia.sequencia === e.sequencia);
    if (!alvo)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Guia não encontrada',
        'A guia não existe nesta internação.',
      );
    const f = await fuso(tx, est);
    const r = corrigirGuia(
      h.map((x) => x.guia),
      e.sequencia,
      { diarias: e.validadeDias, inicio: e.inicio },
      civil(f, i['data_hora_entrada'] as Date),
    );
    if (!r.ok) throw recusaCampo('guia-invalida', r.motivo, r.campo);
    await tx.alterar('guia_internacao', alvo.id, alvo.versao, {
      numero_guia: e.guia,
      senha: e.senha ?? null,
      autorizador_nome: e.autorizador ?? null,
      diarias_autorizadas: r.valor.diarias,
      inicio_validade: r.valor.inicio,
      fim_validade: r.valor.fim,
      motivo_retificacao: m.valor,
    });
    const novas = h.map((x) => (x.guia.sequencia === e.sequencia ? r.valor : x.guia));
    const ultima = h[h.length - 1]!;
    const retrato = await tx.uma<{ versao: number }>('SELECT versao FROM internacao WHERE id = ?', [
      e.internacao,
    ]);
    await tx.alterar('internacao', e.internacao, num(retrato?.versao), {
      ...(ultima.guia.sequencia === e.sequencia
        ? { numero_guia: e.guia, senha_autorizacao: e.senha ?? null }
        : {}),
      diarias_autorizadas: diariasAutorizadasTotal(novas),
    });
    return { internacao: e.internacao, sequencia: e.sequencia };
  },
  alvo: (e) => ({ tabela: 'internacao', id: e.internacao }),
  trilha: (e) => ({ motivo: e.motivo.slice(0, 200) }),
});

/** As operações desta função pelo nome da tela (somadas às da internação). */
export const OPERACOES_REGISTROS_INTERNACAO: Readonly<Record<string, Operacao<never, ResultadoOperacao>>> = {
  'internacao.registrarDiagnostico': registrarDiagnostico as never,
  'internacao.registrarAcidente': registrarAcidente as never,
  'internacao.definirOperadoresUnidade': definirOperadoresUnidade as never,
  'internacao.retirarDiagnostico': retirarDiagnostico as never,
  'internacao.corrigirGuia': corrigirGuiaOp as never,
};

/** A permissão de agir de cada operação desta função. */
export const PERMISSOES_REGISTROS_INTERNACAO: Readonly<Record<string, string>> = {
  'internacao.registrarDiagnostico': 'internacao.internacao.criar',
  'internacao.registrarAcidente': 'internacao.internacao.criar',
  'internacao.definirOperadoresUnidade': 'organizacao.leito.editar',
  'internacao.retirarDiagnostico': 'internacao.internacao.criar',
  'internacao.corrigirGuia': 'internacao.guia.editar',
};

// ── Leituras ─────────────────────────────────────────────────────────────────────────────────────

export interface RegistrosDaInternacao {
  readonly diagnosticos: {
    sequencia: number;
    tipo: string;
    cid: number;
    codigo: string;
    nome: string;
    registradoEm: string;
    observacao: string | null;
    /** vigente, substituido (principal trocado por outro) ou retirado (lançado por engano, com o motivo). */
    situacao: 'vigente' | 'substituido' | 'retirado';
    motivoRetirada: string | null;
  }[];
  readonly acidentes: {
    sequencia: number;
    tipo: string;
    ocorridoEm: string | null;
    empregadorCnpj: string | null;
    empregadorNome: string | null;
    numeroComunicacao: string | null;
    comunicacaoEmitidaEm: string | null;
    local: string | null;
  }[];
  readonly guias: {
    sequencia: number;
    tipo: string;
    guia: string;
    senha: string | null;
    diarias: number;
    inicio: string;
    fim: string;
    autorizador: string | null;
    conta: number | null;
    registradaEm: string;
    motivoCorrecao: string | null;
  }[];
  readonly diariasAutorizadas: number;
}

export async function lerRegistrosDaInternacao(
  l: Leitor,
  est: number,
  fusoEst: string,
  internacao: number,
): Promise<RegistrosDaInternacao | null> {
  const i = await l.uma(
    'SELECT id FROM internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [internacao, est],
  );
  if (!i) return null;
  const [d, a, g] = await Promise.all([
    l.consultar(
      `SELECT d.sequencia, d.tipo, d.cid_termo_terminologia_id AS cid, t.codigo_termo AS codigo, t.descricao AS nome,
              d.registrado_em, d.observacao, d.excluido_em, d.substituido_em, d.motivo_retirada
         FROM diagnostico_internacao d JOIN termo_terminologia t ON t.id = d.cid_termo_terminologia_id
        WHERE d.internacao_id = ? ORDER BY d.sequencia`,
      [internacao],
    ),
    l.consultar(
      `SELECT sequencia, tipo_acidente, ocorrido_em, empregador_cnpj, empregador_nome, numero_comunicacao_acidente,
              comunicacao_emitida_em, local_ocorrencia
         FROM acidente_internacao WHERE internacao_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
      [internacao],
    ),
    l.consultar(
      `SELECT sequencia, tipo, numero_guia, senha, diarias_autorizadas, inicio_validade, fim_validade, autorizador_nome,
              conta_hospitalar_id, criado_em, motivo_retificacao
         FROM guia_internacao WHERE internacao_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
      [internacao],
    ),
  ]);
  const quando = (v: unknown) => (v instanceof Date ? civil(fusoEst, v) : v === null ? null : String(v));
  const guias = g.map((x) => ({
    sequencia: num(x['sequencia']),
    tipo: String(x['tipo']),
    guia: String(x['numero_guia']),
    senha: (x['senha'] as string | null) ?? null,
    diarias: num(x['diarias_autorizadas']),
    inicio: dataIso(x['inicio_validade'])!,
    fim: dataIso(x['fim_validade'])!,
    autorizador: (x['autorizador_nome'] as string | null) ?? null,
    conta: numOuNulo(x['conta_hospitalar_id']),
    registradaEm: quando(x['criado_em']) ?? '',
    motivoCorrecao: (x['motivo_retificacao'] as string | null) ?? null,
  }));
  return {
    diagnosticos: d.map((x) => ({
      sequencia: num(x['sequencia']),
      tipo: String(x['tipo']),
      cid: num(x['cid']),
      codigo: String(x['codigo']),
      nome: String(x['nome'] ?? ''),
      registradoEm: quando(x['registrado_em']) ?? '',
      observacao: (x['observacao'] as string | null) ?? null,
      situacao: (x['excluido_em'] !== null && x['excluido_em'] !== undefined
        ? 'retirado'
        : x['substituido_em'] !== null && x['substituido_em'] !== undefined
          ? 'substituido'
          : 'vigente') as 'vigente' | 'substituido' | 'retirado',
      motivoRetirada: (x['motivo_retirada'] as string | null) ?? null,
    })),
    acidentes: a.map((x) => ({
      sequencia: num(x['sequencia']),
      tipo: String(x['tipo_acidente']),
      ocorridoEm: quando(x['ocorrido_em']),
      empregadorCnpj: (x['empregador_cnpj'] as string | null) ?? null,
      empregadorNome: (x['empregador_nome'] as string | null) ?? null,
      numeroComunicacao: (x['numero_comunicacao_acidente'] as string | null) ?? null,
      comunicacaoEmitidaEm: dataIso(x['comunicacao_emitida_em']),
      local: (x['local_ocorrencia'] as string | null) ?? null,
    })),
    guias,
    diariasAutorizadas: diariasAutorizadasTotal(guias),
  };
}

export interface OperadorDaUnidade {
  usuario: number;
  login: string;
  podeAdmitir: boolean;
  podeTransferir: boolean;
  podeDarAlta: boolean;
}

export async function lerOperadoresDaUnidade(
  l: Leitor,
  est: number,
  unidade: number,
): Promise<OperadorDaUnidade[] | null> {
  const u = await l.uma('SELECT id FROM unidade_internacao WHERE id = ? AND estabelecimento_id = ?', [
    unidade,
    est,
  ]);
  if (!u) return null;
  const r = await l.consultar(
    `SELECT p.usuario_id, u.login, p.pode_admitir, p.pode_transferir, p.pode_dar_alta
       FROM permissao_unidade_usuario p JOIN usuario u ON u.id = p.usuario_id
      WHERE p.unidade_internacao_id = ? AND p.excluido_em IS NULL
        AND (p.pode_admitir OR p.pode_transferir OR p.pode_dar_alta) ORDER BY u.login`,
    [unidade],
  );
  return r.map((x) => ({
    usuario: num(x['usuario_id']),
    login: String(x['login']),
    podeAdmitir: Boolean(x['pode_admitir']),
    podeTransferir: Boolean(x['pode_transferir']),
    podeDarAlta: Boolean(x['pode_dar_alta']),
  }));
}
