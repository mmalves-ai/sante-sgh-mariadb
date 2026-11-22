// Montagem do processo de enfermagem (SAE) a partir dos itens gravados (diagnóstico, resultado, intervenção, atividade,
// evolução e suspensão), e a dose vigente da vacina depois das correções. Regra pura: nenhuma leitura de banco; a
// porta própria e a memória entregam os itens no formato `ItemSae`.
// Melhoria: a montagem saiu da camada de leitura (repositório) para o domínio, testada, e serve às duas portas.
import type {
  AtividadeSaeLida,
  DiagnosticoSaeLido,
  DoseVacina,
  ProcessoSaeLido,
  SistemaTerminologiaSae,
  SituacaoEvolucaoSae,
  TermoSae,
} from '@sgh/contratos';

/** Tipo do item do processo gravado. */
export type TipoItemSae =
  'diagnostico' | 'resultado' | 'intervencao' | 'atividade' | 'evolucao' | 'suspensao';

/** Item gravado do processo de enfermagem (a árvore pelo `pai`). */
export interface ItemSae {
  readonly id: number;
  readonly tipo: TipoItemSae | string;
  readonly pai: number | null;
  readonly codigo: string | null;
  readonly descricao: string;
  readonly caracteristicas: readonly string[];
  readonly fatores: readonly string[];
  readonly escala: number | null;
  readonly meta: number | null;
  readonly escalaMeta: number | null;
  readonly frequencia: number | null;
  readonly horarios: readonly string[];
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly situacao: string | null;
  readonly nota: string | null;
  readonly chave: string | null;
  readonly usuario: string;
  readonly em: string;
}

/** Cabeçalho da versão do processo. */
export interface CabecalhoProcessoSae {
  readonly id: number;
  readonly versao: number;
  readonly avaliacao: string;
  readonly sistema: SistemaTerminologiaSae;
  readonly versaoTerminologia: string;
  readonly usuario: string;
  readonly em: string;
  readonly registroProntuario: number | null;
}

function atividadeDe(a: ItemSae, suspensoes: readonly ItemSae[]): AtividadeSaeLida {
  const s = suspensoes.find((x) => x.pai === a.id);
  return {
    id: a.id,
    codigo: a.codigo,
    descricao: a.descricao,
    frequenciaDia: a.frequencia ?? 0,
    horarios: a.horarios,
    inicio: a.inicio ?? '',
    fim: a.fim,
    suspensa: s ? { motivo: s.nota ?? '', usuario: s.usuario, em: s.em } : null,
    usuario: a.usuario,
    em: a.em,
  };
}

/** Monta o processo dos itens: diagnósticos, resultados com as evoluções, intervenções com as atividades e as suspensões; as evoluções agrupadas pela chave do pedido. */
export function montarProcessoSae(
  cab: {
    readonly id: number;
    readonly versao: number;
    readonly avaliacao: string;
    readonly sistema: SistemaTerminologiaSae;
    readonly versaoTerminologia: string;
    readonly usuario: string;
    readonly em: string;
    readonly registroProntuario: number | null;
  },
  itens: readonly ItemSae[],
  termos: (tipo: 'caracteristica' | 'fator', diagnostico: string, codigo: string) => TermoSae,
): ProcessoSaeLido {
  const de = (t: string) => itens.filter((x) => x.tipo === t);
  const suspensoes = de('suspensao');
  const evolucoes = de('evolucao');
  const diagnosticos: DiagnosticoSaeLido[] = de('diagnostico').map((d) => ({
    id: d.id,
    codigo: d.codigo ?? '',
    descricao: d.descricao,
    caracteristicas: d.caracteristicas.map((c) => termos('caracteristica', d.codigo ?? '', c)),
    fatores: d.fatores.map((c) => termos('fator', d.codigo ?? '', c)),
    resultados: de('resultado')
      .filter((r) => r.pai === d.id)
      .map((r) => ({
        id: r.id,
        codigo: r.codigo,
        descricao: r.descricao,
        escalaAtual: r.escala ?? 0,
        meta: r.meta ?? 0,
        escalaMeta: r.escalaMeta ?? 0,
        evolucoes: evolucoes
          .filter((v) => v.pai === r.id)
          .map((v) => ({
            id: v.id,
            escala: v.escala ?? 0,
            situacao: (v.situacao ?? 'mantida') as SituacaoEvolucaoSae,
            usuario: v.usuario,
            em: v.em,
          })),
      })),
    intervencoes: de('intervencao')
      .filter((i) => i.pai === d.id)
      .map((i) => ({
        id: i.id,
        codigo: i.codigo,
        descricao: i.descricao,
        atividades: de('atividade')
          .filter((a) => a.pai === i.id)
          .map((a) => atividadeDe(a, suspensoes)),
      })),
  }));
  const grupos = new Map<string, ItemSae>();
  for (const v of evolucoes) {
    const g = (v.chave ?? `${v.usuario}|${v.em}`).replace(/#\d+$/, '');
    if (!grupos.has(g)) grupos.set(g, v);
  }
  return {
    ...cab,
    diagnosticos,
    evolucoes: [...grupos.values()]
      .sort((a, b) => a.em.localeCompare(b.em) || a.id - b.id)
      .map((v) => ({ id: v.id, nota: v.nota ?? '', usuario: v.usuario, em: v.em })),
  };
}

/** A correção da vacina aplicada que a dose vigente considera. */
export interface CorrecaoDaDose {
  readonly tipo: 'estorno' | 'retificacao';
  readonly dados: Readonly<Record<string, string | null>> | null;
}

/** A dose vigente da vacina depois das correções: null se estornada; a última retificação da dose vale. */
export function doseVigenteDaVacina(v: {
  readonly dose: DoseVacina;
  readonly correcoes: readonly CorrecaoDaDose[];
}): DoseVacina | null {
  if (v.correcoes.some((c) => c.tipo === 'estorno')) return null;
  let dose = v.dose;
  for (const c of v.correcoes) {
    const d = c.dados?.['dose'];
    if (c.tipo === 'retificacao' && typeof d === 'string' && d) dose = d as DoseVacina;
  }
  return dose;
}
