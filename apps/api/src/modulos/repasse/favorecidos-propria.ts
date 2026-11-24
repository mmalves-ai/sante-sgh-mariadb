// Favorecidos do repasse e prestadores terceiros no banco do cliente (F3.7, 06-FAT linha 46). As regras são as puras
// de @sgh/dominio-repasse (favorecido); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - favorecido: `favorecido_repasse` com o tipo, o alvo (empresa, cooperativa ou outro profissional), a conta de
//     crédito, a parte e a vigência; o anterior aberto do mesmo tipo e fonte termina no dia de antes (`vigencia_fim`,
//     nada apagado); soma das partes acima de 100%, alvo de outro tipo, conta inativa ou de outro credor: 422 sem gravar;
//   - a conta de crédito é do credor do tipo (donoDaConta): a do profissional, a do terceiro, a do fornecedor da empresa
//     ou da cooperativa; de outro credor, 422;
//   - as retenções da empresa, da cooperativa e do prestador vêm do enquadramento do fornecedor (retencoesDoFavorecido);
//   - encerrar o favorecido só antecipa o fim (validarEncerramento): `vigencia_fim` com a versão lida, nunca apagado;
//   - a conta do prestador terceiro: `conta_bancaria_credor` com `prestador_terceiro_id` e o documento do prestador;
//   - prestador terceiro: `prestador_terceiro` com documento, CNES, percentual e base do repasse; código, CPF ou CNPJ
//     repetidos no estabelecimento: 409; inativar grava `ativo` e `inativado_em` (nada apagado).
import {
  donoDaConta,
  type EnquadramentoDoFornecedor,
  type FavorecidoVigente,
  planejarFavorecido,
  retencoesDoFavorecido,
  validarEncerramento,
  TIPOS_FAVORECIDO,
  type TipoFavorecido,
  validarPrestadorTerceiro,
} from '@sgh/dominio-repasse';
import { ErroOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { civil } from '../exames/relogio.js';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_FAVORECIDOS_REPASSE = Symbol('PORTA_FAVORECIDOS_REPASSE');

type Linha = Record<string, unknown>;

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const versao = z.number().int().positive();
const dataTexto = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

const esquemaFavorecido = z
  .object({
    profissional: id,
    fontePagadora: id.nullable().default(null),
    tipo: z.enum(TIPOS_FAVORECIDO as [TipoFavorecido, ...TipoFavorecido[]]),
    pessoaJuridica: id.nullable().default(null),
    cooperativa: id.nullable().default(null),
    terceiroProfissional: id.nullable().default(null),
    contaBancaria: id.nullable().default(null),
    percentual: z.number().default(100),
    inicio: data,
    fim: data.nullable().default(null),
  })
  .strict();

const digitos = (n: number) =>
  z
    .string()
    .transform((s) => s.replace(/\D/g, ''))
    .refine((s) => s.length === n);

const esquemaPrestador = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    nome: z.string().trim().min(1).max(150),
    nomeCurto: z.string().trim().max(40).nullable().default(null),
    tipoPessoa: z.enum(['fisica', 'juridica']),
    cpf: digitos(11).nullable().default(null),
    cnpj: digitos(14).nullable().default(null),
    cnes: z.string().trim().nullable().default(null),
    profissional: id.nullable().default(null),
    cooperativa: id.nullable().default(null),
    percentualRepasse: z.number().nullable().default(null),
    baseRepasse: z.enum(['cobrado', 'recebido', 'misto']).default('cobrado'),
    geraCusto: z.boolean().default(false),
    anestesista: z.boolean().default(false),
    aceitaCessaoCredito: z.boolean().default(true),
    email: z.string().trim().max(254).nullable().default(null),
    telefone: z.string().trim().max(20).nullable().default(null),
    observacao: z.string().trim().max(1000).nullable().default(null),
  })
  .strict();

function favorecidoDe(x: Linha) {
  return {
    id: num(x['id']),
    profissional: num(x['profissional_id']),
    profissionalNome: txtOuNull(x['profissional_nome']),
    fontePagadora: numOuNull(x['fonte_pagadora_id']),
    fontePagadoraNome: txtOuNull(x['fonte_nome']),
    tipo: String(x['tipo_favorecido']) as TipoFavorecido,
    pessoaJuridica: numOuNull(x['favorecido_pessoa_juridica_id']),
    cooperativa: numOuNull(x['cooperativa_medica_id']),
    terceiroProfissional: numOuNull(x['favorecido_profissional_id']),
    alvoNome: txtOuNull(x['alvo_nome']),
    contaBancaria: numOuNull(x['conta_bancaria_credor_id']),
    percentual: num(x['percentual']),
    inicio: dataTexto(x['vigencia_inicio'])!,
    fim: dataTexto(x['vigencia_fim']),
    ativo: bool(x['ativo']),
    versao: num(x['versao']),
    fornecedor: numOuNull(x['fornecedor_id']),
  };
}

function prestadorDe(x: Linha) {
  return {
    id: num(x['id']),
    codigo: String(x['codigo']),
    nome: String(x['nome']),
    nomeCurto: txtOuNull(x['nome_curto']),
    tipoPessoa: String(x['tipo_pessoa']) as 'fisica' | 'juridica',
    cpf: txtOuNull(x['cpf']),
    cnpj: txtOuNull(x['cnpj']),
    cnes: txtOuNull(x['cnes']),
    profissional: numOuNull(x['profissional_id']),
    cooperativa: numOuNull(x['cooperativa_medica_id']),
    percentualRepasse: x['percentual_repasse'] === null ? null : num(x['percentual_repasse']),
    baseRepasse: String(x['base_repasse']),
    geraCusto: bool(x['gera_custo']),
    anestesista: bool(x['anestesista']),
    aceitaCessaoCredito: bool(x['aceita_cessao_credito']),
    email: txtOuNull(x['email']),
    telefone: txtOuNull(x['telefone']),
    ativo: bool(x['ativo']),
    inativadoEm: dataTexto(x['inativado_em']),
    versao: num(x['versao']),
    fornecedor: numOuNull(x['empresa_fornecedora_id']),
  };
}

export type FavorecidoRepasse = ReturnType<typeof favorecidoDe> & {
  retencoes: ReturnType<typeof retencoesDoFavorecido>;
};
export type PrestadorTerceiro = ReturnType<typeof prestadorDe>;

/** A conta pertence ao credor (um parâmetro: o id do alvo do tipo). */
const CONTA_DO_CREDOR: Record<TipoFavorecido | 'prestador_terceiro', string> = {
  proprio_profissional: 'cb.profissional_id = ?',
  terceiro_profissional: 'cb.profissional_id = ?',
  pessoa_juridica: `cb.empresa_fornecedora_id IN
      (SELECT ef.id FROM empresa_fornecedora ef WHERE ef.pessoa_juridica_id = ? AND ef.excluido_em IS NULL)`,
  cooperativa: `cb.empresa_fornecedora_id IN
      (SELECT ef.id FROM empresa_fornecedora ef JOIN cooperativa_medica cm ON cm.pessoa_juridica_id = ef.pessoa_juridica_id
        WHERE cm.id = ? AND ef.excluido_em IS NULL)`,
  prestador_terceiro: 'cb.prestador_terceiro_id = ?',
};

/** O id do credor dono da conta, pelo tipo do favorecido. */
const credorDoFavorecido = (e: {
  tipo: TipoFavorecido;
  profissional: number;
  pessoaJuridica: number | null;
  cooperativa: number | null;
  terceiroProfissional: number | null;
}): number =>
  ({
    profissional: e.profissional,
    terceiro_profissional: e.terceiroProfissional ?? 0,
    fornecedor_da_empresa: e.pessoaJuridica ?? 0,
    fornecedor_da_cooperativa: e.cooperativa ?? 0,
  })[donoDaConta(e.tipo)];

const SQL_FAVORECIDOS = `
  SELECT f.*, CONCAT_WS(' ', pf.nome) AS profissional_nome, fp.nome AS fonte_nome,
         COALESCE(pj.razao_social, cm.nome, pft.nome) AS alvo_nome,
         (SELECT ef.id FROM empresa_fornecedora ef
           WHERE ef.excluido_em IS NULL AND ef.pessoa_juridica_id = COALESCE(f.favorecido_pessoa_juridica_id, cm.pessoa_juridica_id)
           ORDER BY ef.id LIMIT 1) AS fornecedor_id
    FROM favorecido_repasse f
    JOIN profissional p ON p.id = f.profissional_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN fonte_pagadora fp ON fp.id = f.fonte_pagadora_id
    LEFT JOIN pessoa_juridica pj ON pj.id = f.favorecido_pessoa_juridica_id
    LEFT JOIN cooperativa_medica cm ON cm.id = f.cooperativa_medica_id
    LEFT JOIN profissional pt ON pt.id = f.favorecido_profissional_id
    LEFT JOIN pessoa_fisica pft ON pft.id = pt.pessoa_fisica_id
   WHERE f.estabelecimento_id = ?`;

export class PortaFavorecidosRepassePropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(
      nucleo,
      cliente,
      ['favorecido_repasse', 'prestador_terceiro', 'conta_bancaria_credor'],
      'repasse.favorecidos',
    );
  }

  // ── Favorecidos ────────────────────────────────────────────────────────────────────────────────────────

  /** Todos os favorecidos (vigentes e encerrados) do profissional, ou do estabelecimento, com as retenções de hoje. */
  listarFavorecidos(c: ContextoPortaPropria, profissional: number | null): Promise<FavorecidoRepasse[]> {
    return this.ler(c, 'favorecidos', async (l, est) => {
      const fs = (
        await l.consultar<Linha>(
          `${SQL_FAVORECIDOS} AND (? IS NULL OR f.profissional_id = ?)
            ORDER BY pf.nome, f.profissional_id, f.vigencia_inicio DESC, f.id DESC LIMIT 2000`,
          [est.id, profissional, profissional],
        )
      ).map(favorecidoDe);
      const enq = await this.enquadramentos(
        l,
        est.id,
        fs.map((f) => f.fornecedor),
      );
      const hoje = civil(new Date(), est.fuso).data;
      return fs.map((f) => ({
        ...f,
        retencoes: retencoesDoFavorecido(f.tipo, f.fornecedor, enq.get(f.fornecedor ?? 0) ?? [], hoje),
      }));
    });
  }

  /** Os enquadramentos tributários (o cadastro fiscal do contas a pagar) dos fornecedores, por fornecedor. */
  private async enquadramentos(
    l: { consultar<T>(sql: string, p: unknown[]): Promise<T[]> },
    est: number,
    fornecedores: readonly (number | null)[],
  ): Promise<Map<number, EnquadramentoDoFornecedor[]>> {
    const ids = [...new Set(fornecedores.filter((x): x is number => x !== null))];
    const m = new Map<number, EnquadramentoDoFornecedor[]>();
    if (!ids.length) return m;
    const linhas = await l.consultar<Linha>(
      `SELECT empresa_fornecedora_id AS f, tributo_id, regime, retem_tributo, aliquota_iss, vigencia_inicio, vigencia_fim
         FROM enquadramento_tributario_participante
        WHERE ativo AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
          AND empresa_fornecedora_id IN (${ids.map(() => '?').join(',')})`,
      [est, ...ids],
    );
    for (const x of linhas) {
      const lista = m.get(num(x['f'])) ?? [];
      lista.push({
        tributo: numOuNull(x['tributo_id']),
        regime: String(x['regime']),
        retem: bool(x['retem_tributo']),
        aliquotaIss: x['aliquota_iss'] === null ? null : num(x['aliquota_iss']),
        inicio: dataTexto(x['vigencia_inicio'])!,
        fim: dataTexto(x['vigencia_fim']),
      });
      m.set(num(x['f']), lista);
    }
    return m;
  }

  /** Os alvos que o favorecido pode apontar (empresa, cooperativa ativa ou profissional), pelo nome ou CNPJ. */
  listarAlvos(
    c: ContextoPortaPropria,
    tipo: 'pessoa_juridica' | 'cooperativa' | 'terceiro_profissional' | 'fonte_pagadora',
    busca: string,
  ): Promise<{ id: number; nome: string; documento: string | null }[]> {
    const b = `%${busca.trim()}%`;
    const sql = {
      pessoa_juridica:
        'SELECT id, razao_social AS nome, cnpj AS documento FROM pessoa_juridica WHERE razao_social LIKE ? OR cnpj LIKE ? ORDER BY razao_social LIMIT 30',
      cooperativa: `SELECT cm.id, cm.nome, pj.cnpj AS documento FROM cooperativa_medica cm
          JOIN pessoa_juridica pj ON pj.id = cm.pessoa_juridica_id
         WHERE cm.ativo AND cm.excluido_em IS NULL AND (cm.nome LIKE ? OR pj.cnpj LIKE ?) ORDER BY cm.nome LIMIT 30`,
      terceiro_profissional: `SELECT p.id, pf.nome, NULL AS documento FROM profissional p
          JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
         WHERE p.excluido_em IS NULL AND (pf.nome LIKE ? OR p.id = ?) ORDER BY pf.nome LIMIT 30`,
      fonte_pagadora:
        'SELECT id, nome, NULL AS documento FROM fonte_pagadora WHERE nome LIKE ? OR codigo LIKE ? ORDER BY nome LIMIT 30',
    }[tipo];
    return this.ler(c, 'alvos', async (l) =>
      (await l.consultar<Linha>(sql, [b, tipo === 'terceiro_profissional' ? Number(busca) || 0 : b])).map(
        (x) => ({
          id: num(x['id']),
          nome: String(x['nome']),
          documento: txtOuNull(x['documento']),
        }),
      ),
    );
  }

  /**
   * As contas de crédito ativas do credor do favorecido (donoDaConta): do profissional, do terceiro, do fornecedor da
   * empresa ou da cooperativa, ou do prestador terceiro. O documento do titular só com os 4 últimos dígitos.
   */
  listarContas(c: ContextoPortaPropria, credor: { tipo: TipoFavorecido | 'prestador_terceiro'; id: number }) {
    return this.ler(c, 'contas', async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT cb.id, cb.numero_agencia, cb.numero_conta, cb.tipo_chave_pix, cb.titular_nome, cb.titular_documento,
                  cb.preferencial
             FROM conta_bancaria_credor cb
            WHERE ${CONTA_DO_CREDOR[credor.tipo]} AND cb.ativo AND cb.excluido_em IS NULL
            ORDER BY cb.preferencial DESC, cb.id`,
          [credor.id],
        )
      ).map((x) => ({
        id: num(x['id']),
        rotulo: x['numero_conta']
          ? `Ag. ${txtOuNull(x['numero_agencia']) ?? '-'} / conta ${String(x['numero_conta'])}`
          : `PIX (${String(x['tipo_chave_pix'] ?? '')})`,
        titular: String(x['titular_nome']),
        documentoFinal: String(x['titular_documento']).slice(-4),
        preferencial: bool(x['preferencial']),
      })),
    );
  }

  incluirFavorecido(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; encerrados: number[] }> {
    const e = entradaValida(esquemaFavorecido, entrada);
    return this.gravar(c, 'repasse.favorecido.incluir', ['favorecido_repasse'], async (tx, est) => {
      const prof = await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [
        e.profissional,
      ]);
      if (!prof) throw naoEncontrado('Profissional');
      const alvos: [number | null, string, string][] = [
        [e.fontePagadora, 'SELECT id FROM fonte_pagadora WHERE id = ?', 'Fonte pagadora'],
        [e.pessoaJuridica, 'SELECT id FROM pessoa_juridica WHERE id = ?', 'Empresa'],
        [
          e.cooperativa,
          'SELECT id FROM cooperativa_medica WHERE id = ? AND ativo AND excluido_em IS NULL',
          'Cooperativa',
        ],
        [
          e.terceiroProfissional,
          'SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL',
          'Profissional favorecido',
        ],
      ];
      for (const [v, sql, nome] of alvos)
        if (v !== null && !(await tx.uma(sql, [v]))) throw naoEncontrado(nome);
      if (e.contaBancaria !== null) {
        const conta = await tx.uma<Linha>(
          'SELECT ativo, excluido_em FROM conta_bancaria_credor WHERE id = ?',
          [e.contaBancaria],
        );
        if (!conta) throw naoEncontrado('Conta de crédito');
        if (!bool(conta['ativo']) || conta['excluido_em'] !== null)
          throw recusaRegra('Favorecido recusado', [
            { campo: 'contaBancaria', mensagem: 'A conta de crédito está inativa.' },
          ]);
        const doCredor = await tx.uma(
          `SELECT cb.id FROM conta_bancaria_credor cb WHERE cb.id = ? AND ${CONTA_DO_CREDOR[e.tipo]}`,
          [e.contaBancaria, credorDoFavorecido(e)],
        );
        if (!doCredor)
          throw recusaRegra('Favorecido recusado', [
            { campo: 'contaBancaria', mensagem: 'A conta de crédito não é do favorecido.' },
          ]);
      }
      const existentes: FavorecidoVigente[] = (
        await tx.consultar<Linha>(
          `SELECT id, fonte_pagadora_id, tipo_favorecido, percentual, vigencia_inicio, vigencia_fim, versao
             FROM favorecido_repasse WHERE estabelecimento_id = ? AND profissional_id = ? AND ativo FOR UPDATE`,
          [est.id, e.profissional],
        )
      ).map((x) => ({
        id: num(x['id']),
        fontePagadora: numOuNull(x['fonte_pagadora_id']),
        tipo: String(x['tipo_favorecido']) as TipoFavorecido,
        percentual: num(x['percentual']),
        inicio: dataTexto(x['vigencia_inicio'])!,
        fim: dataTexto(x['vigencia_fim']),
      }));
      const plano = planejarFavorecido(e, existentes);
      if (plano.problemas.length) throw recusaRegra('Favorecido recusado', plano.problemas);
      for (const enc of plano.encerrar) {
        const v = await tx.uma<Linha>('SELECT versao FROM favorecido_repasse WHERE id = ?', [enc.id]);
        await tx.alterar('favorecido_repasse', enc.id, num(v?.['versao']), { vigencia_fim: enc.fim });
      }
      const novo = await tx.incluir('favorecido_repasse', {
        estabelecimento_id: est.id,
        profissional_id: e.profissional,
        fonte_pagadora_id: e.fontePagadora,
        tipo_favorecido: e.tipo,
        favorecido_pessoa_juridica_id: e.pessoaJuridica,
        cooperativa_medica_id: e.cooperativa,
        favorecido_profissional_id: e.terceiroProfissional,
        conta_bancaria_credor_id: e.contaBancaria,
        percentual: e.percentual,
        vigencia_inicio: e.inicio,
        vigencia_fim: e.fim,
        ativo: true,
      });
      return { tabela: 'favorecido_repasse', id: novo, encerrados: plano.encerrar.map((x) => x.id) };
    });
  }

  /** Encerra a vigência (com a versão lida); o registro fica para o histórico e para os lançamentos que o citam. */
  encerrarFavorecido(c: ContextoPortaPropria, favorecido: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(z.object({ versao, fim: data }).strict(), entrada);
    return this.gravar(c, 'repasse.favorecido.encerrar', ['favorecido_repasse'], async (tx, est) => {
      const f = await tx.uma<Linha>(
        'SELECT vigencia_inicio, vigencia_fim FROM favorecido_repasse WHERE id = ? AND estabelecimento_id = ?',
        [favorecido, est.id],
      );
      if (!f) throw naoEncontrado('Favorecido');
      const problemas = validarEncerramento(
        { inicio: dataTexto(f['vigencia_inicio'])!, fim: dataTexto(f['vigencia_fim']) },
        x.fim,
      );
      if (problemas.length) throw recusaRegra('Encerramento recusado', problemas);
      await tx.alterar('favorecido_repasse', favorecido, x.versao, { vigencia_fim: x.fim });
      return { tabela: 'favorecido_repasse', id: favorecido };
    });
  }

  // ── Prestadores terceiros ──────────────────────────────────────────────────────────────────────────────

  listarPrestadores(c: ContextoPortaPropria, busca: string | null): Promise<PrestadorTerceiro[]> {
    const b = busca?.trim() ? `%${busca.trim()}%` : null;
    return this.ler(c, 'prestadores', async (l, est) =>
      (
        await l.consultar<Linha>(
          `SELECT * FROM prestador_terceiro
            WHERE estabelecimento_id = ? AND excluido_em IS NULL
              AND (? IS NULL OR nome LIKE ? OR codigo LIKE ? OR cnpj LIKE ? OR cpf LIKE ?)
            ORDER BY ativo DESC, nome LIMIT 2000`,
          [est.id, b, b, b, b, b],
        )
      ).map(prestadorDe),
    );
  }

  incluirPrestador(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaPrestador, entrada);
    const problemas = validarPrestadorTerceiro(e);
    if (problemas.length) throw recusaRegra('Prestador recusado', problemas);
    return this.gravar(c, 'repasse.prestador.incluir', ['prestador_terceiro'], async (tx, est) => {
      const dup = await tx.uma<Linha>(
        `SELECT codigo FROM prestador_terceiro
          WHERE estabelecimento_id = ? AND (codigo = ? OR cpf <=> ? AND cpf IS NOT NULL OR cnpj <=> ? AND cnpj IS NOT NULL)`,
        [est.id, e.codigo, e.cpf, e.cnpj],
      );
      if (dup)
        throw new ErroOperacao(
          409,
          'prestador-repetido',
          'Prestador repetido',
          String(dup['codigo']) === e.codigo
            ? 'Já existe prestador com este código.'
            : 'Já existe prestador com este documento.',
        );
      if (
        e.profissional !== null &&
        !(await tx.uma('SELECT id FROM profissional WHERE id = ?', [e.profissional]))
      )
        throw naoEncontrado('Profissional');
      if (
        e.cooperativa !== null &&
        !(await tx.uma('SELECT id FROM cooperativa_medica WHERE id = ?', [e.cooperativa]))
      )
        throw naoEncontrado('Cooperativa');
      const novo = await tx.incluir('prestador_terceiro', {
        estabelecimento_id: est.id,
        codigo: e.codigo,
        nome: e.nome,
        nome_curto: e.nomeCurto,
        tipo_pessoa: e.tipoPessoa,
        cpf: e.cpf,
        cnpj: e.cnpj,
        cnes: e.cnes,
        profissional_id: e.profissional,
        cooperativa_medica_id: e.cooperativa,
        percentual_repasse: e.percentualRepasse,
        base_repasse: e.baseRepasse,
        gera_custo: e.geraCusto,
        anestesista: e.anestesista,
        aceita_cessao_credito: e.aceitaCessaoCredito,
        email: e.email,
        telefone: e.telefone,
        observacao: e.observacao,
        ativo: true,
      });
      return { tabela: 'prestador_terceiro', id: novo };
    });
  }

  /** Muda o percentual, a base ou os contatos, ou inativa/reativa (com a versão lida; nada apagado). */
  alterarPrestador(c: ContextoPortaPropria, prestador: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(
      z
        .object({
          versao,
          ativo: z.boolean().optional(),
          percentualRepasse: z.number().nullable().optional(),
          baseRepasse: z.enum(['cobrado', 'recebido', 'misto']).optional(),
          email: z.string().trim().max(254).nullable().optional(),
          telefone: z.string().trim().max(20).nullable().optional(),
        })
        .strict(),
      entrada,
    );
    if (
      x.percentualRepasse !== undefined &&
      x.percentualRepasse !== null &&
      !(x.percentualRepasse >= 0 && x.percentualRepasse <= 100)
    )
      throw recusaRegra('Prestador recusado', [
        { campo: 'percentualRepasse', mensagem: 'O percentual de repasse fica entre 0 e 100.' },
      ]);
    return this.gravar(c, 'repasse.prestador.alterar', ['prestador_terceiro'], async (tx, est) => {
      const p = await tx.uma<Linha>(
        'SELECT id FROM prestador_terceiro WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [prestador, est.id],
      );
      if (!p) throw naoEncontrado('Prestador');
      const mud: Record<string, unknown> = {};
      if (x.ativo !== undefined) {
        mud['ativo'] = x.ativo;
        mud['inativado_em'] = x.ativo ? null : civil(new Date(), est.fuso).data;
      }
      if (x.percentualRepasse !== undefined) mud['percentual_repasse'] = x.percentualRepasse;
      if (x.baseRepasse !== undefined) mud['base_repasse'] = x.baseRepasse;
      if (x.email !== undefined) mud['email'] = x.email;
      if (x.telefone !== undefined) mud['telefone'] = x.telefone;
      await tx.alterar('prestador_terceiro', prestador, x.versao, mud as never);
      return { tabela: 'prestador_terceiro', id: prestador };
    });
  }

  /** Inclui a conta de crédito do prestador terceiro: o titular é o próprio prestador (nome e documento dele). */
  incluirContaPrestador(
    c: ContextoPortaPropria,
    prestador: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const x = entradaValida(
      z
        .object({
          banco: id.nullable().default(null),
          agencia: z.string().trim().max(10).nullable().default(null),
          conta: z.string().trim().max(20).nullable().default(null),
          tipoConta: z.enum(['corrente', 'poupanca', 'pagamento', 'salario']).default('corrente'),
          tipoChavePix: z.enum(['cpf', 'cnpj', 'email', 'telefone', 'aleatoria']).nullable().default(null),
          chavePix: z.string().trim().min(1).max(77).nullable().default(null),
          preferencial: z.boolean().default(false),
        })
        .strict(),
      entrada,
    );
    const problemas = [];
    if (!((x.banco !== null && x.conta) || x.chavePix))
      problemas.push({ campo: 'conta', mensagem: 'Informe o banco e a conta, ou a chave PIX.' });
    if ((x.chavePix === null) !== (x.tipoChavePix === null))
      problemas.push({ campo: 'tipoChavePix', mensagem: 'Informe o tipo e a chave PIX juntos.' });
    if (problemas.length) throw recusaRegra('Conta recusada', problemas);
    return this.gravar(c, 'repasse.prestador.conta', ['conta_bancaria_credor'], async (tx, est) => {
      const p = await tx.uma<Linha>(
        `SELECT nome, cpf, cnpj FROM prestador_terceiro
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND ativo`,
        [prestador, est.id],
      );
      if (!p) throw naoEncontrado('Prestador');
      const novo = await tx.incluir('conta_bancaria_credor', {
        prestador_terceiro_id: prestador,
        banco_id: x.banco,
        tipo_conta: x.tipoConta,
        numero_agencia: x.agencia,
        numero_conta: x.conta,
        tipo_chave_pix: x.tipoChavePix,
        chave_pix: x.chavePix,
        titular_nome: String(p['nome']),
        titular_documento: String(p['cnpj'] ?? p['cpf']),
        preferencial: x.preferencial,
        ativo: true,
      });
      return { tabela: 'conta_bancaria_credor', id: novo };
    });
  }
}
