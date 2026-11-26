// Exceções da regra de lançamento automático sobre o banco do cliente (F3.7, 06-FAT linha 16; C1-090). Leitura pelo
// Leitor, gravação pelo Executor (trilha, autoria e idempotência na mesma transação). A regra é do
// @sgh/dominio-faturamento (conta/excecao-regra-lancamento): aqui só se lê, chama o domínio e grava.
// - Listar: as regras ativas que a apuração da conta usa (taxa de abertura e diária) com as exceções de cada uma
//   (as do estabelecimento da sessão e as que valem para todos), com a situação no dia, e as opções dos combos.
// - Incluir: a exceção com o recorte (fonte pagadora, plano, setor, especialidade, item ou grupo; o estabelecimento da
//   sessão ou todos), o efeito, as naturezas, a vigência e o motivo. A apuração seguinte já a respeita.
// - Encerrar: a exceção passa a valer até ontem (vigencia_fim). Nunca se apaga: o histórico continua no banco.
import {
  encerramentoExcecaoRegra,
  situacaoExcecaoRegra,
  validarExcecaoRegraLancamento,
} from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

type Linha = Record<string, unknown>;
type Consulta = Pick<Leitor, 'consultar' | 'uma'>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown) => v === true || v === 1 || v === '1';
const p2 = (x: number) => String(x).padStart(2, '0');
const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};
function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}

/** Gatilhos cuja apuração confere as exceções (conta-entrada.ts). */
const GATILHOS_COM_EXCECAO = ['abertura_atendimento', 'diaria_internacao'] as const;

export async function excecoesRegraLancamentoPropria(l: Consulta, est: number) {
  const dia = hoje();
  const regras = await l.consultar<Linha>(
    `SELECT id, codigo, descricao, gatilho, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS inicio,
            DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim
       FROM regra_lancamento WHERE ativo = TRUE AND gatilho IN ('abertura_atendimento','diaria_internacao')
      ORDER BY codigo`,
    [],
    { teto: 2000 },
  );
  const excecoes = await l.consultar<Linha>(
    `SELECT x.id, x.versao, x.regra_lancamento_id, x.estabelecimento_id, x.fonte_pagadora_id, fp.nome AS fonte,
            x.plano_fonte_pagadora_id, pl.descricao AS plano, x.setor_funcional_id, sf.nome AS setor,
            x.especialidade_medica_id, em.descricao AS especialidade, x.item_faturavel_id,
            CONCAT(it.codigo, ' ', it.descricao) AS item, x.grupo_faturamento_id, gf.descricao AS grupo, x.efeito,
            x.aplica_internacao, x.aplica_ambulatorial, x.aplica_externo, x.aplica_urgencia, x.aplica_domiciliar,
            DATE_FORMAT(x.vigencia_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(x.vigencia_fim, '%Y-%m-%d') AS fim,
            x.motivo, x.criado_em, u.nome AS criado_por
       FROM regra_lancamento_excecao x
       JOIN regra_lancamento rl ON rl.id = x.regra_lancamento_id
       LEFT JOIN fonte_pagadora fp ON fp.id = x.fonte_pagadora_id
       LEFT JOIN plano_fonte_pagadora pl ON pl.id = x.plano_fonte_pagadora_id
       LEFT JOIN setor_funcional sf ON sf.id = x.setor_funcional_id
       LEFT JOIN especialidade_medica em ON em.id = x.especialidade_medica_id
       LEFT JOIN item_faturavel it ON it.id = x.item_faturavel_id
       LEFT JOIN grupo_faturamento gf ON gf.id = x.grupo_faturamento_id
       LEFT JOIN usuario u ON u.id = x.criado_por
      WHERE rl.ativo = TRUE AND (x.estabelecimento_id IS NULL OR x.estabelecimento_id = ?)
      ORDER BY x.vigencia_inicio DESC, x.id DESC`,
    [est],
    { teto: 5000 },
  );
  const [fontes, planos, setores, especialidades, grupos] = await Promise.all([
    l.consultar<Linha>("SELECT id, nome FROM fonte_pagadora WHERE situacao = 'ativa' ORDER BY nome", [], {
      teto: 2000,
    }),
    l.consultar<Linha>(
      "SELECT id, fonte_pagadora_id, descricao FROM plano_fonte_pagadora WHERE situacao = 'ativo' ORDER BY descricao",
      [],
      { teto: 5000 },
    ),
    l.consultar<Linha>(
      'SELECT id, nome FROM setor_funcional WHERE ativo = TRUE AND estabelecimento_id = ? ORDER BY nome',
      [est],
      { teto: 2000 },
    ),
    l.consultar<Linha>(
      'SELECT id, descricao FROM especialidade_medica WHERE ativo = TRUE ORDER BY descricao',
      [],
      {
        teto: 2000,
      },
    ),
    l.consultar<Linha>(
      'SELECT id, descricao FROM grupo_faturamento WHERE ativo = TRUE ORDER BY descricao',
      [],
      {
        teto: 2000,
      },
    ),
  ]);
  const opcao = (x: Linha, rot: string) => ({ id: n(x['id']), rotulo: String(x[rot]) });
  return {
    hoje: dia,
    regras: regras.map((r) => ({
      id: n(r['id']),
      codigo: String(r['codigo']),
      descricao: String(r['descricao']),
      gatilho: String(r['gatilho']),
      vigenciaInicio: txt(r['inicio']),
      vigenciaFim: txt(r['fim']),
      excecoes: excecoes
        .filter((x) => n(x['regra_lancamento_id']) === n(r['id']))
        .map((x) => ({
          id: n(x['id']),
          versao: n(x['versao']),
          todosEstabelecimentos: x['estabelecimento_id'] === null,
          fontePagadoraId: nn(x['fonte_pagadora_id']),
          fonte: txt(x['fonte']),
          planoId: nn(x['plano_fonte_pagadora_id']),
          plano: txt(x['plano']),
          setorId: nn(x['setor_funcional_id']),
          setor: txt(x['setor']),
          especialidadeId: nn(x['especialidade_medica_id']),
          especialidade: txt(x['especialidade']),
          itemId: nn(x['item_faturavel_id']),
          item: txt(x['item']),
          grupoId: nn(x['grupo_faturamento_id']),
          grupo: txt(x['grupo']),
          efeito: String(x['efeito']),
          aplica: {
            internacao: bool(x['aplica_internacao']),
            ambulatorial: bool(x['aplica_ambulatorial']),
            externo: bool(x['aplica_externo']),
            urgencia: bool(x['aplica_urgencia']),
            domiciliar: bool(x['aplica_domiciliar']),
          },
          vigenciaInicio: txt(x['inicio']),
          vigenciaFim: txt(x['fim']),
          situacao: situacaoExcecaoRegra(txt(x['inicio']), txt(x['fim']), dia),
          motivo: txt(x['motivo']),
          criadoPor: txt(x['criado_por']),
        })),
    })),
    opcoes: {
      fontes: fontes.map((x) => opcao(x, 'nome')),
      planos: planos.map((x) => ({ ...opcao(x, 'descricao'), fontePagadoraId: n(x['fonte_pagadora_id']) })),
      setores: setores.map((x) => opcao(x, 'nome')),
      especialidades: especialidades.map((x) => opcao(x, 'descricao')),
      grupos: grupos.map((x) => opcao(x, 'descricao')),
    },
  };
}

const id = z.number().int().positive();
const idN = id.nullable().default(null);
const dataZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const aplicaZ = z.object({
  internacao: z.boolean(),
  ambulatorial: z.boolean(),
  externo: z.boolean(),
  urgencia: z.boolean(),
  domiciliar: z.boolean(),
});
export const esquemaIncluirExcecao = z.object({
  regraLancamentoId: id,
  todosEstabelecimentos: z.boolean().default(false),
  fontePagadoraId: idN,
  planoId: idN,
  setorId: idN,
  especialidadeId: idN,
  itemId: idN,
  grupoId: idN,
  efeito: z.enum(['nao_aplicar', 'aplicar_somente']),
  aplica: aplicaZ,
  vigenciaInicio: dataZ,
  vigenciaFim: dataZ.nullable().default(null),
  motivo: z.string().max(600),
});
export const esquemaEncerrarExcecao = z.object({ id, versao: z.number().int().positive() });

async function exigirExiste(tx: TxOperacao, sql: string, p: unknown[], campo: string, msg: string) {
  if (!(await tx.uma<Linha>(sql, p))) throw recusa('entrada-invalida', msg, { campos: [campo] });
}

export const opIncluirExcecaoRegra = definirOperacao({
  nome: 'faturamento.incluir-excecao-regra-lancamento',
  tabelas: ['regra_lancamento_excecao'],
  entrada: esquemaIncluirExcecao,
  async gravar(tx, e) {
    const est = estDe(tx.contexto);
    const estab = e.todosEstabelecimentos ? null : est;
    const erros = validarExcecaoRegraLancamento({
      regraLancamento: e.regraLancamentoId,
      estabelecimento: estab,
      fontePagadora: e.fontePagadoraId,
      plano: e.planoId,
      setor: e.setorId,
      especialidade: e.especialidadeId,
      item: e.itemId,
      grupo: e.grupoId,
      efeito: e.efeito,
      aplica: e.aplica,
      vigenciaInicio: e.vigenciaInicio,
      vigenciaFim: e.vigenciaFim,
      motivo: e.motivo,
    });
    if (Object.keys(erros).length)
      throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos: Object.keys(erros) });
    await exigirExiste(
      tx,
      `SELECT id FROM regra_lancamento WHERE id = ? AND ativo = TRUE AND gatilho IN (?, ?)`,
      [e.regraLancamentoId, ...GATILHOS_COM_EXCECAO],
      'regraLancamentoId',
      'Regra de lançamento não encontrada ou inativa.',
    );
    if (e.planoId !== null)
      await exigirExiste(
        tx,
        'SELECT id FROM plano_fonte_pagadora WHERE id = ? AND fonte_pagadora_id = ?',
        [e.planoId, e.fontePagadoraId],
        'planoId',
        'O plano não é da fonte pagadora escolhida.',
      );
    else if (e.fontePagadoraId !== null)
      await exigirExiste(
        tx,
        'SELECT id FROM fonte_pagadora WHERE id = ?',
        [e.fontePagadoraId],
        'fontePagadoraId',
        'Fonte pagadora não encontrada.',
      );
    if (e.setorId !== null)
      await exigirExiste(
        tx,
        'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?',
        [e.setorId, est],
        'setorId',
        'O setor não é deste estabelecimento.',
      );
    if (e.especialidadeId !== null)
      await exigirExiste(
        tx,
        'SELECT id FROM especialidade_medica WHERE id = ?',
        [e.especialidadeId],
        'especialidadeId',
        'Especialidade não encontrada.',
      );
    if (e.itemId !== null)
      await exigirExiste(
        tx,
        'SELECT id FROM item_faturavel WHERE id = ?',
        [e.itemId],
        'itemId',
        'Item não encontrado.',
      );
    if (e.grupoId !== null)
      await exigirExiste(
        tx,
        'SELECT id FROM grupo_faturamento WHERE id = ?',
        [e.grupoId],
        'grupoId',
        'Grupo de faturamento não encontrado.',
      );
    const novo = await tx.incluir('regra_lancamento_excecao', {
      estabelecimento_id: estab,
      regra_lancamento_id: e.regraLancamentoId,
      fonte_pagadora_id: e.fontePagadoraId,
      plano_fonte_pagadora_id: e.planoId,
      setor_funcional_id: e.setorId,
      especialidade_medica_id: e.especialidadeId,
      item_faturavel_id: e.itemId,
      grupo_faturamento_id: e.grupoId,
      efeito: e.efeito,
      aplica_internacao: e.aplica.internacao,
      aplica_ambulatorial: e.aplica.ambulatorial,
      aplica_externo: e.aplica.externo,
      aplica_urgencia: e.aplica.urgencia,
      aplica_domiciliar: e.aplica.domiciliar,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
      motivo: e.motivo.trim(),
    });
    return { id: novo };
  },
  alvo: (_e, s) => ({ tabela: 'regra_lancamento_excecao', id: s.id }),
});

export const opEncerrarExcecaoRegra = definirOperacao({
  nome: 'faturamento.encerrar-excecao-regra-lancamento',
  tabelas: ['regra_lancamento_excecao'],
  entrada: esquemaEncerrarExcecao,
  async gravar(tx, e) {
    const est = estDe(tx.contexto);
    const x = await tx.uma<Linha>(
      `SELECT id, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim
         FROM regra_lancamento_excecao WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
      [e.id, est],
    );
    if (!x) throw recusa('nao-encontrado', 'Exceção não encontrada.', { campos: ['id'] });
    const r = encerramentoExcecaoRegra(txt(x['inicio']), txt(x['fim']), hoje());
    if (!r.ok) throw recusa(r.codigo, r.mensagem, { campos: ['id'] });
    await tx.alterar('regra_lancamento_excecao', e.id, e.versao, { vigencia_fim: r.vigenciaFim });
    return { id: e.id, vigenciaFim: r.vigenciaFim };
  },
  alvo: (e) => ({ tabela: 'regra_lancamento_excecao', id: e.id }),
});

export const OPERACOES_EXCECAO_REGRA = {
  'incluir-excecao': opIncluirExcecaoRegra,
  'encerrar-excecao': opEncerrarExcecaoRegra,
} as const;
export type NomeOperacaoExcecaoRegra = keyof typeof OPERACOES_EXCECAO_REGRA;

export async function gravarExcecaoRegra(
  executor: Executor,
  nome: NomeOperacaoExcecaoRegra,
  ctx: ContextoOperacao,
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const op = OPERACOES_EXCECAO_REGRA[nome] as Parameters<Executor['executar']>[0];
  const r = await executor.executar(op, ctx.cliente, entrada, ctx);
  return r.resultado as Record<string, unknown>;
}
