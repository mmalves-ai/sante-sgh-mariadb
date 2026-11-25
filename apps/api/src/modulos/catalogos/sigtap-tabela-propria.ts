// Tabela unificada do SUS por competência no banco próprio (06-SUS L50): as competências carregadas
// (`competencia_sigtap`) e os pares principal × secundário (`compatibilidade_sigtap`) vigentes na competência em uso.
// A vigência e a escolha da competência são regra do domínio (`tabela-competencia.ts`); aqui só se lê.
import {
  type CompetenciaSigtapLida,
  type ParSigtapLido,
  type SituacaoCargaSigtap,
  type TipoCompatibilidadeSigtap,
  competenciaEmUso,
  competenciasOrdenadas,
  paresDaCompetencia,
} from '@sgh/dominio-faturamento';
import type { Leitor } from '@sgh/nucleo';
import type { HistoricoSigtap } from './fonte.js';

type Tabela = Pick<HistoricoSigtap, 'competenciaEmUso' | 'competenciasCarregadas' | 'compatibilidades'>;

const dia = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

export async function competenciasSigtapLidas(l: Leitor): Promise<CompetenciaSigtapLida[]> {
  const linhas = await l.consultar(
    `SELECT codigo_competencia, situacao_carga, vigente, DATE_FORMAT(data_publicacao, '%Y-%m-%d') AS publicacao,
            DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS ini, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim,
            quantidade_procedimentos
       FROM competencia_sigtap ORDER BY codigo_competencia DESC LIMIT 240`,
    [],
    { teto: 240 },
  );
  return linhas.map((r) => ({
    codigo: String(r['codigo_competencia']),
    situacao: String(r['situacao_carga']) as SituacaoCargaSigtap,
    vigente: Boolean(Number(r['vigente'])),
    publicacao: dia(r['publicacao']),
    vigenciaInicio: String(dia(r['ini'])),
    vigenciaFim: dia(r['fim']),
    procedimentos: r['quantidade_procedimentos'] === null ? null : Number(r['quantidade_procedimentos']),
  }));
}

export async function tabelaSigtapDoProcedimento(l: Leitor, procedimentoId: number): Promise<Tabela> {
  const competencias = await competenciasSigtapLidas(l);
  const emUso = competenciaEmUso(competencias);
  const linhas = await l.consultar(
    `SELECT pp.codigo_sigtap AS principal, ps.codigo_sigtap AS secundario, ps.descricao, c.tipo_compatibilidade,
            c.quantidade_maxima, DATE_FORMAT(c.vigencia_inicio, '%Y-%m-%d') AS ini,
            DATE_FORMAT(c.vigencia_fim, '%Y-%m-%d') AS fim
       FROM compatibilidade_sigtap c
       JOIN procedimento_sigtap pp ON pp.id = c.principal_procedimento_sigtap_id
       JOIN procedimento_sigtap ps ON ps.id = c.compativel_procedimento_sigtap_id
      WHERE c.principal_procedimento_sigtap_id = ?
        AND c.tipo_compatibilidade IN ('compativel', 'incompativel', 'concomitante')
      ORDER BY ps.codigo_sigtap, c.vigencia_inicio DESC LIMIT 2000`,
    [procedimentoId],
    { teto: 2000 },
  );
  const descricao = new Map<string, string | null>();
  const pares: ParSigtapLido[] = linhas.map((r) => {
    descricao.set(String(r['secundario']), r['descricao'] === null ? null : String(r['descricao']));
    return {
      principal: String(r['principal']),
      secundario: String(r['secundario']),
      tipo: String(r['tipo_compatibilidade']) as TipoCompatibilidadeSigtap,
      quantidadeMaxima: r['quantidade_maxima'] === null ? null : Number(r['quantidade_maxima']),
      vigenciaInicio: String(dia(r['ini'])),
      vigenciaFim: dia(r['fim']),
    };
  });
  return {
    competenciaEmUso: emUso?.codigo ?? null,
    competenciasCarregadas: competenciasOrdenadas(competencias).map((c) => ({
      codigo: c.codigo,
      situacao: c.situacao,
      vigente: c.vigente,
      publicacao: c.publicacao,
      procedimentos: c.procedimentos,
    })),
    compatibilidades: emUso
      ? paresDaCompetencia(pares, emUso.codigo).map((p) => ({
          secundario: p.secundario,
          descricao: descricao.get(p.secundario) ?? null,
          tipo: p.tipo,
          quantidadeMaxima: p.quantidadeMaxima,
          vigenciaInicio: p.vigenciaInicio,
          vigenciaFim: p.vigenciaFim,
        }))
      : [],
  };
}
