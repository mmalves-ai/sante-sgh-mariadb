// Competência de trabalho do faturista (F3.7, 06-FAT linha 32) no banco próprio: uma linha por usuário, estabelecimento
// e módulo em competencia_trabalho_usuario (12_FAT/01). A leitura devolve a escolhida e o padrão dos filtros (sem
// escolha, o mês corrente); a gravação passa pelo executor (trilha, autoria e idempotência na mesma transação), com a
// regra do domínio (@sgh/dominio-faturamento, competencia/trabalho.ts). Cada usuário só grava a própria.
import {
  competenciaPadrao,
  conferirCompetenciaTrabalho,
  MODULOS_COMPETENCIA_TRABALHO,
} from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  erroConflitoVersao,
  type Executor,
  type Leitor,
  recusa,
} from '@sgh/nucleo';
import { z } from 'zod';

type Linha = Record<string, unknown>;
const TABELA = 'competencia_trabalho_usuario';

const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;

/** Hoje (AAAA-MM-DD) no fuso dos estabelecimentos. */
export const hojeLocal = (agora = new Date()): string =>
  agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

export interface CompetenciaTrabalhoLida {
  readonly modulo: string;
  /** AAAA-MM escolhida pelo usuário, ou null sem escolha. */
  readonly competencia: string | null;
  readonly periodoInicio: string | null;
  readonly periodoFim: string | null;
  readonly versao: number | null;
  readonly alteradaEm: string | null;
  /** A competência que os filtros usam: a escolhida ou o mês corrente. */
  readonly padrao: string;
}

export async function lerCompetenciaTrabalho(
  l: Leitor,
  est: number,
  usuario: number | null,
  modulo: string,
  hoje = hojeLocal(),
): Promise<CompetenciaTrabalhoLida> {
  const linhas =
    usuario === null
      ? []
      : await l.consultar<Linha>(
          `SELECT competencia, periodo_inicio, periodo_fim, versao, criado_em, alterado_em FROM ${TABELA}
            WHERE estabelecimento_id = ? AND usuario_id = ? AND modulo = ?`,
          [est, usuario, modulo],
        );
  const r = linhas[0];
  const competencia = r ? (dataIso(r['competencia'])?.slice(0, 7) ?? null) : null;
  return {
    modulo,
    competencia,
    periodoInicio: r ? dataIso(r['periodo_inicio']) : null,
    periodoFim: r ? dataIso(r['periodo_fim']) : null,
    versao: r ? Number(r['versao']) : null,
    alteradaEm: r ? ((r['alterado_em'] ?? r['criado_em']) as Date).toISOString() : null,
    padrao: competenciaPadrao(competencia, hoje),
  };
}

export const esquemaCompetenciaTrabalho = z.object({
  modulo: z.enum(MODULOS_COMPETENCIA_TRABALHO).default('fonte_pagadora'),
  competencia: z.string().max(7),
  periodoInicio: z.string().max(10).nullish(),
  periodoFim: z.string().max(10).nullish(),
  /** A versão lida; sem ela, só a primeira escolha (inclusão). Sobre a linha que já existe, a versão é exigida. */
  versao: z.number().int().positive().nullish(),
});

export const opDefinirCompetenciaTrabalho = definirOperacao({
  nome: 'faturamento.definir-competencia-trabalho',
  tabelas: [TABELA],
  entrada: esquemaCompetenciaTrabalho,
  async gravar(tx, e, ctx: ContextoOperacao) {
    if (ctx.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    if (ctx.usuario === null)
      throw recusa('sem-usuario', 'A competência de trabalho é de um usuário identificado.');
    const negado = conferirCompetenciaTrabalho({
      modulo: e.modulo,
      competencia: e.competencia,
      periodoInicio: e.periodoInicio ?? null,
      periodoFim: e.periodoFim ?? null,
      hoje: hojeLocal(),
    });
    if (negado) throw recusa(negado.codigo, negado.mensagem, { campos: [...negado.campos] });
    const campos = {
      competencia: `${e.competencia}-01`,
      periodo_inicio: e.periodoInicio || null,
      periodo_fim: e.periodoFim || null,
    };
    const atual = await tx.uma<Linha>(
      `SELECT id, versao FROM ${TABELA} WHERE estabelecimento_id = ? AND usuario_id = ? AND modulo = ?`,
      [ctx.estabelecimento, ctx.usuario, e.modulo],
    );
    if (!atual) {
      const id = await tx.incluir(TABELA, {
        estabelecimento_id: ctx.estabelecimento,
        usuario_id: ctx.usuario,
        modulo: e.modulo,
        ...campos,
      });
      return { id, versao: 1, competencia: e.competencia };
    }
    // A linha já existe: a versão lida é obrigatória. Sem ela (a tela leu antes de outra aba gravar, ou o pedido veio
    // sem versão), é conflito: nunca se usa a versão do banco no lugar da que o usuário viu.
    if (e.versao === null || e.versao === undefined) throw erroConflitoVersao(['versao']);
    const id = Number(atual['id']);
    const versao = await tx.alterar(TABELA, id, e.versao, campos);
    return { id, versao, competencia: e.competencia };
  },
  alvo: (_e, r) => ({ tabela: TABELA, id: Number(r['id']) }),
});

/** Grava pelo executor; devolve id, versão e a competência gravada. */
export async function definirCompetenciaTrabalho(
  executor: Executor,
  ctx: ContextoOperacao,
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const r = await executor.executar(
    opDefinirCompetenciaTrabalho as Parameters<Executor['executar']>[0],
    ctx.cliente,
    entrada,
    ctx,
  );
  return r.resultado as Record<string, unknown>;
}
