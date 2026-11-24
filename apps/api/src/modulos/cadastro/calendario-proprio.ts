// Calendário de feriados e dias não úteis no banco próprio (F3.1, 02-CAD linha 28): cadastro único em `dia_nao_util`
// (a decisão entre as duas tabelas está na migração 05_AGE/90_dia_nao_util_unico). Abrangência nacional, estadual,
// municipal ou do estabelecimento; recorrência anual, data única ou móvel (uma linha por ano, gerada pela Páscoa);
// ponto facultativo; faixa do dia (meio expediente). Inativar não apaga: a linha fica, com a versão e a trilha.
// A regra é a do domínio (@sgh/dominio-agenda); aqui só leitura, conferência no banco e gravação pelo executor (trilha e
// idempotência na mesma transação). A visão do ano é a mesma que a agenda de consultas e a de exames usam para pular
// os dias (`lerDiasSemExpediente`).
import { randomUUID } from 'node:crypto';
import {
  type Abrangencia,
  type BaseMovel,
  datasMoveis,
  type DiaNaoUtilExistente,
  duplicadoDe,
  type EntradaDiaNaoUtil,
  errosDiaNaoUtil,
  NOME_BASE_MOVEL,
  ocorrencias,
} from '@sgh/dominio-agenda';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { lerDiasSemExpediente } from '../agenda/dias-sem-expediente-leitor.js';
import type { ContextoPorta } from './porta.js';
import type { NucleoCadastro } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

export const CALENDARIO_CADASTRO = Symbol('CALENDARIO_CADASTRO');

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const data = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const hora = (v: unknown): string | null => txt(v)?.slice(0, 5) ?? null;

const MENSAGENS: Record<string, [string, string]> = {
  'descricao-curta': ['Escreva a descrição com ao menos 3 letras.', 'descricao'],
  'descricao-longa': ['A descrição tem no máximo 150 letras.', 'descricao'],
  'abrangencia-invalida': [
    'Escolha a abrangência: nacional, estadual, municipal ou do estabelecimento.',
    'abrangencia',
  ],
  'uf-ausente': ['Escolha a UF do feriado estadual.', 'uf'],
  'municipio-ausente': ['Escolha o município do feriado municipal.', 'municipio'],
  'estabelecimento-ausente': ['Escolha o estabelecimento.', 'estabelecimento'],
  'alvo-a-mais': ['Informe só o alvo da abrangência escolhida.', 'abrangencia'],
  'recorrencia-invalida': ['Escolha a recorrência: todo ano, data única ou móvel.', 'recorrencia'],
  'dia-mes-invalido': ['O dia não existe no mês escolhido.', 'dia'],
  'data-invalida': ['Informe uma data válida.', 'data'],
  'data-com-dia-mes': ['Informe o dia e o mês (todo ano) ou a data (data única), não os dois.', 'data'],
  'hora-incompleta': [
    'Informe o início e o fim do período sem expediente, ou deixe os dois vazios.',
    'horaInicio',
  ],
  'hora-invalida': ['A hora vai em HH:MM.', 'horaInicio'],
  'hora-invertida': ['O fim do período é depois do início.', 'horaFim'],
};
function recusarErros(erros: readonly string[]): void {
  if (!erros.length) return;
  throw recusa(erros[0]!, erros.map((e) => MENSAGENS[e]?.[0] ?? e).join(' '), {
    campos: [...new Set(erros.map((e) => MENSAGENS[e]?.[1] ?? e))],
  });
}
const naoAchado = () =>
  new ErroOperacao(404, 'dia-nao-util-inexistente', 'Não encontrado', 'Dia não útil não encontrado.');

const idPos = z.number().int().positive();
const esquemaEntrada = z
  .object({
    descricao: z.string().max(400),
    abrangencia: z.enum(['nacional', 'estadual', 'municipal', 'estabelecimento']),
    ufId: idPos.nullable(),
    municipio: idPos.nullable(),
    estabelecimento: idPos.nullable(),
    recorrencia: z.enum(['anual', 'data_unica', 'movel']),
    dia: z.number().int().nullable(),
    mes: z.number().int().nullable(),
    data: z.string().max(10).nullable(),
    facultativo: z.boolean(),
    horaInicio: z.string().max(5).nullable(),
    horaFim: z.string().max(5).nullable(),
  })
  .strict();
export type EntradaCalendario = z.infer<typeof esquemaEntrada>;

const COLUNAS = `id, descricao, abrangencia, unidade_federativa_id, municipio_ibge_id, estabelecimento_id, recorrencia,
  dia, mes, data, facultativo, hora_inicio, hora_fim, ativo, versao`;

function daLinha(x: Record<string, unknown>): DiaNaoUtilExistente {
  return {
    id: Number(x['id']),
    descricao: String(x['descricao']),
    abrangencia: String(x['abrangencia']) as Abrangencia,
    ufId: num(x['unidade_federativa_id']),
    municipio: num(x['municipio_ibge_id']),
    estabelecimento: num(x['estabelecimento_id']),
    recorrencia: String(x['recorrencia']) as EntradaDiaNaoUtil['recorrencia'],
    dia: num(x['dia']),
    mes: num(x['mes']),
    data: data(x['data']),
    facultativo: bool(x['facultativo']),
    horaInicio: hora(x['hora_inicio']),
    horaFim: hora(x['hora_fim']),
  };
}

/**
 * O dia de um estabelecimento só se mantém na sessão dele: a sessão é o alcance do cargo (quem troca de estabelecimento
 * entra na sessão do outro). Sem isto, quem edita o calendário num estabelecimento fecharia a agenda de outro.
 */
function conferirAlcance(alvo: number | null, sessao: number): void {
  if (alvo != null && alvo !== sessao)
    throw recusa(
      'estabelecimento-fora-da-sessao',
      'O dia de outro estabelecimento só se mantém na sessão dele: entre no estabelecimento para alterá-lo.',
      { campos: ['estabelecimento'] },
    );
}

/** Confere no banco os alvos e a duplicidade no mesmo alvo (todos os ativos do alvo, travados). */
async function conferir(
  tx: TxOperacao,
  e: EntradaDiaNaoUtil,
  proprio: number | null,
  sessao: number,
): Promise<void> {
  recusarErros(errosDiaNaoUtil({ ...e, descricao: e.descricao }));
  if (e.abrangencia === 'estabelecimento') conferirAlcance(e.estabelecimento, sessao);
  if (e.ufId != null && !(await tx.uma('SELECT id FROM unidade_federativa WHERE id = ?', [e.ufId])))
    throw recusa('uf-inexistente', 'UF não encontrada.', { campos: ['uf'] });
  if (e.municipio != null && !(await tx.uma('SELECT id FROM municipio_ibge WHERE id = ?', [e.municipio])))
    throw recusa('municipio-inexistente', 'Município não encontrado.', { campos: ['municipio'] });
  if (
    e.estabelecimento != null &&
    !(await tx.uma('SELECT id FROM estabelecimento WHERE id = ? AND excluido_em IS NULL', [
      e.estabelecimento,
    ]))
  )
    throw recusa('estabelecimento-inexistente', 'Estabelecimento não encontrado.', {
      campos: ['estabelecimento'],
    });
  const atuais = await tx.consultar(
    `SELECT ${COLUNAS} FROM dia_nao_util
      WHERE ativo AND excluido_em IS NULL AND abrangencia = ? AND unidade_federativa_id <=> ?
        AND municipio_ibge_id <=> ? AND estabelecimento_id <=> ? FOR UPDATE`,
    [e.abrangencia, e.ufId, e.municipio, e.estabelecimento],
  );
  const dup = duplicadoDe(atuais.map(daLinha), e, proprio);
  if (dup)
    throw recusa(
      'dia-ja-cadastrado',
      `Este dia já está no calendário para o mesmo alvo ("${dup.descricao}"): altere o que existe.`,
      { campos: ['data'] },
    );
}

const colunasDe = (e: EntradaDiaNaoUtil) => ({
  descricao: e.descricao.trim(),
  abrangencia: e.abrangencia,
  unidade_federativa_id: e.ufId,
  municipio_ibge_id: e.municipio,
  estabelecimento_id: e.estabelecimento,
  recorrencia: e.recorrencia,
  dia: e.recorrencia === 'anual' ? e.dia : null,
  mes: e.recorrencia === 'anual' ? e.mes : null,
  data: e.recorrencia === 'anual' ? null : e.data,
  facultativo: e.facultativo,
  hora_inicio: e.horaInicio,
  hora_fim: e.horaFim,
});

const opIncluir = (t: RegistroTrilhaTela, sessao: number) =>
  definirOperacao({
    nome: 'cadastro.calendario.incluir',
    tabelas: ['dia_nao_util'],
    entrada: esquemaEntrada,
    acao: 'inclusao',
    async gravar(tx, e) {
      await conferir(tx, e, null, sessao);
      const id = await tx.incluir('dia_nao_util', { ...colunasDe(e), ativo: true, origem: 'sistema' });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'dia_nao_util', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaAlterar = z.object({ id: idPos, versao: idPos, entrada: esquemaEntrada }).strict();
const opAlterar = (t: RegistroTrilhaTela, sessao: number) =>
  definirOperacao({
    nome: 'cadastro.calendario.alterar',
    tabelas: ['dia_nao_util'],
    entrada: esquemaAlterar,
    acao: 'alteracao',
    async gravar(tx, e) {
      const atual = await tx.uma(
        'SELECT estabelecimento_id FROM dia_nao_util WHERE id = ? AND excluido_em IS NULL',
        [e.id],
      );
      if (!atual) throw naoAchado();
      conferirAlcance(num(atual['estabelecimento_id']), sessao);
      await conferir(tx, e.entrada, e.id, sessao);
      await tx.alterar('dia_nao_util', e.id, e.versao, colunasDe(e.entrada));
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'dia_nao_util', id: e.id }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaSituacao = z
  .object({ id: idPos, versao: idPos, ativo: z.boolean(), motivo: z.string().max(500) })
  .strict();
const opSituacao = (t: RegistroTrilhaTela, sessao: number) =>
  definirOperacao({
    nome: 'cadastro.calendario.situacao',
    tabelas: ['dia_nao_util'],
    entrada: esquemaSituacao,
    acao: 'alteracao',
    async gravar(tx, e) {
      const x = await tx.uma(`SELECT ${COLUNAS} FROM dia_nao_util WHERE id = ? AND excluido_em IS NULL`, [
        e.id,
      ]);
      if (!x) throw naoAchado();
      conferirAlcance(num(x['estabelecimento_id']), sessao);
      if (bool(x['ativo']) === e.ativo)
        throw recusa('situacao-igual', e.ativo ? 'O dia já está ativo.' : 'O dia já está inativo.');
      if (!e.ativo && e.motivo.trim().length < 5)
        throw recusa('motivo-curto', 'Escreva o motivo com ao menos 5 letras.', { campos: ['motivo'] });
      // Reativar confere a duplicidade de novo (outro pode ter sido cadastrado no mesmo dia nesse meio tempo).
      if (e.ativo) await conferir(tx, daLinha(x), e.id, sessao);
      await tx.alterar('dia_nao_util', e.id, e.versao, { ativo: e.ativo });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'dia_nao_util', id: e.id }),
    trilha: (e) => ({
      dados: { ...(t.dadosDepois ?? {}), ativo: e.ativo },
      motivo: e.motivo.trim() || null,
    }),
  });

const esquemaMoveis = z
  .object({
    base: z.enum(['carnaval', 'sexta_santa', 'pascoa', 'corpus_christi']),
    anoInicio: z.number().int().min(1900).max(2200),
    anoFim: z.number().int().min(1900).max(2200),
    descricao: z.string().max(400).nullable(),
    abrangencia: z.enum(['nacional', 'estadual', 'municipal', 'estabelecimento']),
    ufId: idPos.nullable(),
    municipio: idPos.nullable(),
    estabelecimento: idPos.nullable(),
    facultativo: z.boolean(),
  })
  .strict();
export type EntradaMoveis = z.infer<typeof esquemaMoveis>;

/** Gera a data móvel de cada ano (uma linha por ano); o ano que já tem o dia no mesmo alvo é pulado, não duplica. */
const opMoveis = (t: RegistroTrilhaTela, sessao: number) =>
  definirOperacao({
    nome: 'cadastro.calendario.gerar-moveis',
    tabelas: ['dia_nao_util'],
    entrada: esquemaMoveis,
    acao: 'inclusao',
    async gravar(tx, e) {
      const datas = datasMoveis(e.base as BaseMovel, e.anoInicio, e.anoFim);
      if (!datas.length)
        throw recusa('anos-invalidos', 'Escolha de 1 a 20 anos, do primeiro ao último.', {
          campos: ['anoFim'],
        });
      const incluidos: number[] = [];
      let pulados = 0;
      for (const d of datas) {
        const entrada: EntradaDiaNaoUtil = {
          descricao: e.descricao?.trim() || NOME_BASE_MOVEL[e.base as BaseMovel],
          abrangencia: e.abrangencia,
          ufId: e.ufId,
          municipio: e.municipio,
          estabelecimento: e.estabelecimento,
          recorrencia: 'movel',
          dia: null,
          mes: null,
          data: d,
          facultativo: e.facultativo,
          horaInicio: null,
          horaFim: null,
        };
        try {
          await conferir(tx, entrada, null, sessao);
        } catch (x) {
          if (x instanceof ErroOperacao && x.problema.codigo === 'dia-ja-cadastrado') {
            pulados++;
            continue;
          }
          throw x;
        }
        incluidos.push(
          await tx.incluir('dia_nao_util', { ...colunasDe(entrada), ativo: true, origem: 'sistema' }),
        );
      }
      // O resultado da operação guarda só escalares: os ids incluídos vão em texto, separados por vírgula.
      return { id: incluidos[0] ?? 0, incluidos: incluidos.join(','), quantidade: incluidos.length, pulados };
    },
    alvo: (_e, r) => ({ tabela: 'dia_nao_util', id: Number(r.id) || null }),
    trilha: (_e, r) => ({
      dados: { ...(t.dadosDepois ?? {}), incluidos: r.quantidade, pulados: r.pulados },
      motivo: null,
    }),
  });

export interface ItemCalendario extends DiaNaoUtilExistente {
  readonly versao: number;
  readonly ativo: boolean;
  readonly ufSigla: string | null;
  readonly municipioNome: string | null;
  readonly estabelecimentoNome: string | null;
  /** Vale para o estabelecimento da sessão. */
  readonly valeAqui: boolean;
  /** Datas no ano consultado. */
  readonly datasNoAno: readonly string[];
}

export interface VisaoCalendario {
  readonly ano: number;
  readonly local: {
    estabelecimento: number;
    estabelecimentoNome: string;
    ufId: number | null;
    ufSigla: string | null;
    municipio: number | null;
    municipioNome: string | null;
  };
  readonly itens: readonly ItemCalendario[];
  /** O que a agenda de consultas e a de exames pulam no ano, neste estabelecimento (com os nacionais calculados). */
  readonly semExpediente: readonly {
    data: string;
    nome: string;
    horaInicio?: string | null;
    horaFim?: string | null;
  }[];
  readonly ufs: readonly { id: number; sigla: string }[];
}

export class CalendarioProprio {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCadastro,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'calendario' }, fn);
  }

  private async estabelecimento(c: ContextoPorta): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const r = c.hospital
      ? await this.ler(c, (l) =>
          l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
            c.hospital,
          ]),
        )
      : null;
    if (!r)
      throw new ErroOperacao(
        403,
        'sem-estabelecimento',
        'Sem estabelecimento',
        'A sessão não tem estabelecimento.',
      );
    return Number(r.id);
  }

  private async executar<E>(
    c: ContextoPorta,
    op: Parameters<Executor['executar']>[0],
    entrada: E,
    t: RegistroTrilhaTela,
  ): Promise<Record<string, unknown>> {
    const est = await this.estabelecimento(c);
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: t.estabelecimento ?? est,
      usuario: t.usuario ?? c.usuario,
      correlacao: (t.correlacao ?? c.correlacao).slice(0, 64) || 'calendario',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
    const x = await this.executor.executar(op, this.cliente, entrada, ctx);
    return x.resultado as Record<string, unknown>;
  }

  /**
   * O calendário do ano: o cadastro (ativos e inativos) sem os dias de outros estabelecimentos, o que vale aqui e o que
   * a agenda pula.
   */
  async visao(c: ContextoPorta, ano: number): Promise<VisaoCalendario> {
    const est = await this.estabelecimento(c);
    const de = `${ano}-01-01`;
    const ate = `${ano}-12-31`;
    return this.ler(c, async (l) => {
      const loc = await l.uma(
        `SELECT s.nome_fantasia, s.municipio_ibge_id, m.nome AS municipio_nome, m.unidade_federativa_id, u.sigla
           FROM estabelecimento s
           LEFT JOIN municipio_ibge m ON m.id = s.municipio_ibge_id
           LEFT JOIN unidade_federativa u ON u.id = m.unidade_federativa_id
          WHERE s.id = ?`,
        [est],
      );
      const local = {
        estabelecimento: est,
        estabelecimentoNome: txt(loc?.['nome_fantasia']) ?? '',
        ufId: num(loc?.['unidade_federativa_id']),
        ufSigla: txt(loc?.['sigla']),
        municipio: num(loc?.['municipio_ibge_id']),
        municipioNome: txt(loc?.['municipio_nome']),
      };
      const linhas = await l.consultar(
        `SELECT d.id, d.descricao, d.abrangencia, d.unidade_federativa_id, d.municipio_ibge_id, d.estabelecimento_id,
                d.recorrencia, d.dia, d.mes, d.data, d.facultativo, d.hora_inicio, d.hora_fim, d.ativo, d.versao,
                u.sigla, m.nome AS municipio_nome, s.nome_fantasia
           FROM dia_nao_util d
           LEFT JOIN unidade_federativa u ON u.id = d.unidade_federativa_id
           LEFT JOIN municipio_ibge m ON m.id = d.municipio_ibge_id
           LEFT JOIN estabelecimento s ON s.id = d.estabelecimento_id
          WHERE d.excluido_em IS NULL AND (d.estabelecimento_id IS NULL OR d.estabelecimento_id = ?)
            AND (d.recorrencia = 'anual' OR d.data BETWEEN ? AND ?)
          ORDER BY COALESCE(d.mes, MONTH(d.data)), COALESCE(d.dia, DAY(d.data)), d.id`,
        [est, de, ate],
        { teto: 5000 },
      );
      const itens: ItemCalendario[] = linhas.map((x) => {
        const b = daLinha(x);
        const vale =
          b.abrangencia === 'nacional' ||
          (b.abrangencia === 'estadual' && b.ufId != null && b.ufId === local.ufId) ||
          (b.abrangencia === 'municipal' && b.municipio != null && b.municipio === local.municipio) ||
          (b.abrangencia === 'estabelecimento' && b.estabelecimento === est);
        return {
          ...b,
          versao: Number(x['versao']),
          ativo: bool(x['ativo']),
          ufSigla: txt(x['sigla']),
          municipioNome: txt(x['municipio_nome']),
          estabelecimentoNome: txt(x['nome_fantasia']),
          valeAqui: vale,
          datasNoAno: ocorrencias(b, de, ate),
        };
      });
      const semExpediente = await lerDiasSemExpediente(l, est, de, ate);
      const ufs = (
        await l.consultar('SELECT id, sigla FROM unidade_federativa ORDER BY sigla', [], { teto: 100 })
      ).map((x) => ({ id: Number(x['id']), sigla: String(x['sigla']) }));
      return { ano, local, itens, semExpediente, ufs };
    });
  }

  /** Municípios pelo nome (para o feriado municipal de outro município). */
  municipios(c: ContextoPorta, termo: string): Promise<{ id: number; nome: string; uf: string }[]> {
    const t = termo.trim();
    if (t.length < 2) return Promise.resolve([]);
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT m.id, m.nome, u.sigla FROM municipio_ibge m JOIN unidade_federativa u ON u.id = m.unidade_federativa_id
            WHERE m.nome LIKE ? ORDER BY m.nome LIMIT 20`,
          [`${t.replace(/[%_]/g, '')}%`],
          { teto: 20 },
        )
      ).map((x) => ({ id: Number(x['id']), nome: String(x['nome']), uf: String(x['sigla']) })),
    );
  }

  async incluir(c: ContextoPorta, e: EntradaCalendario, t: RegistroTrilhaTela): Promise<number> {
    return Number((await this.executar(c, opIncluir(t, await this.estabelecimento(c)), e, t))['id']);
  }
  async alterar(c: ContextoPorta, id: number, versao: number, e: EntradaCalendario, t: RegistroTrilhaTela) {
    return Number(
      (await this.executar(c, opAlterar(t, await this.estabelecimento(c)), { id, versao, entrada: e }, t))[
        'id'
      ],
    );
  }
  async situacao(
    c: ContextoPorta,
    e: { id: number; versao: number; ativo: boolean; motivo: string },
    t: RegistroTrilhaTela,
  ) {
    return Number((await this.executar(c, opSituacao(t, await this.estabelecimento(c)), e, t))['id']);
  }
  async gerarMoveis(
    c: ContextoPorta,
    e: EntradaMoveis,
    t: RegistroTrilhaTela,
  ): Promise<{ incluidos: number[]; pulados: number }> {
    const r = await this.executar(c, opMoveis(t, await this.estabelecimento(c)), e, t);
    const ids = String(r['incluidos'] ?? '');
    return { incluidos: ids ? ids.split(',').map(Number) : [], pulados: Number(r['pulados'] ?? 0) };
  }
}
