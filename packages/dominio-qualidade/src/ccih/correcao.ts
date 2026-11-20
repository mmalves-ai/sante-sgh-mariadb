// W0-04 (programa CRUD completo): as regras puras da correção e do cancelamento da CCIH.
//   - Registro clínico finalizado (dispositivo, bundle, precaução): corrige-se por versão, com justificativa; o
//     cancelado fica visível; nunca exclusão física (matriz, linha "Registro clínico finalizado"; SBIS NGS1.12.01).
//   - Indicador de competência fechada (IRAS, dispositivos-dia): sem norma; padrão adotado: alterar só antes do
//     fechamento; depois, reabrir a competência com motivo e trilha. O registro que toca uma competência fechada é
//     recusado (409) com a oferta "reabrir competência com motivo", e os indicadores dela não mudam.
import type { SitioIras, TipoDispositivoInvasivo } from '@sgh/contratos';
import { msLocal } from '../nsp/prazos.js';
import { dispositivoAssociado } from './iras.js';
import { diferencaDias, somarDias } from './tempo.js';

export type RecusaCorrecaoCcih =
  | 'registro-cancelado'
  | 'competencia-fechada'
  | 'retirada-sem-registro'
  | 'dispositivo-com-iras'
  | 'observacao-estornada'
  | 'sem-mudanca'
  | 'associacao-desfeita'
  | 'nao-e-autor'
  | 'bundle-estornado'
  | 'responsavel-inexistente';

export const MENSAGENS_CORRECAO_CCIH: Readonly<Record<RecusaCorrecaoCcih, string>> = {
  'registro-cancelado': 'Este registro foi cancelado: ele fica visível como inativo e não se corrige mais.',
  'competencia-fechada':
    'A competência deste registro está fechada e os indicadores dela já foram apurados: reabra a competência com motivo para corrigir.',
  'retirada-sem-registro':
    'O dispositivo ainda está em uso: registre a retirada pela ação própria; a correção só ajusta uma retirada já registrada.',
  'dispositivo-com-iras':
    'O dispositivo é critério de ficha de IRAS confirmada: corrija ou descarte a ficha antes de cancelar o dispositivo.',
  'observacao-estornada': 'Esta sessão de observação já foi estornada.',
  'sem-mudanca': 'Nada foi alterado: confira os campos antes de salvar.',
  'associacao-desfeita':
    'A correção desfaz a associação do dispositivo com ficha de IRAS confirmada (o tipo ou as datas deixam de cobrir a data da infecção): corrija ou descarte a ficha antes.',
  'nao-e-autor':
    'Só quem fez o registro o corrige ou cancela. A CCIH corrige o registro de outro profissional com a permissão própria e a senha.',
  'bundle-estornado': 'Este checklist foi estornado: ele fica visível como inativo e não se corrige mais.',
  'responsavel-inexistente': 'O profissional responsável pela inserção não foi encontrado no cadastro.',
};

/**
 * Revisão do W0-04 (regras_governanca do pacote: registro clínico finalizado e checagem de enfermagem, "correção por
 * versão, com justificativa e pelo autor"; SBIS NGS1.12.01): quem corrige ou cancela é o autor do registro. O de outro
 * autor só com a permissão `qualidade.ccih.corrigirDeOutro`, e aí a operação passa a pedir a senha (crítica).
 * Devolve 'autor' (pode, sem senha extra), 'outro' (pode, com a senha) ou a recusa.
 */
export function autoriaDaCorrecao(e: {
  readonly autor: string;
  readonly login: string;
  readonly podeDeOutro: boolean;
}): 'autor' | 'outro' | 'nao-e-autor' {
  if (e.autor.trim().toUpperCase() === e.login.trim().toUpperCase()) return 'autor';
  return e.podeDeOutro ? 'outro' : 'nao-e-autor';
}

/** A ficha de IRAS confirmada associada a um dispositivo (o vínculo por ID_DISPOSITIVO). */
export interface FichaAssociada {
  readonly id: number;
  readonly sitio: string;
  readonly dataInfeccao: string;
  readonly dispositivo: number | null;
}

/**
 * Revisão do W0-04 (D-CRUD-ORFAOS, vínculo por critério): as fichas confirmadas associadas ao dispositivo cuja
 * associação deixaria de valer com o dispositivo corrigido (tipo diferente do exigido pelo sítio, ou inserção e retirada
 * que deixam de cobrir a data da infecção, ou outro dispositivo passaria a ser o associado). A regra é a mesma do
 * registro da ficha (`dispositivoAssociado`), refeita com o dispositivo como ficaria.
 */
export function associacoesDesfeitas(e: {
  readonly dispositivo: {
    readonly id: number;
    readonly tipo: string;
    readonly inseridoEm: string;
    readonly retiradoEm: string | null;
  };
  /** Os outros dispositivos ativos (não cancelados) da internação. */
  readonly outros: readonly {
    readonly id: number;
    readonly tipo: string;
    readonly inseridoEm: string;
    readonly retiradoEm: string | null;
  }[];
  readonly fichas: readonly FichaAssociada[];
}): number[] {
  const todos = [e.dispositivo, ...e.outros.filter((o) => o.id !== e.dispositivo.id)].map((d) => ({
    ...d,
    tipo: d.tipo as TipoDispositivoInvasivo,
  }));
  return e.fichas
    .filter((f) => f.dispositivo === e.dispositivo.id)
    .filter((f) => dispositivoAssociado(f.sitio as SitioIras, todos, f.dataInfeccao) !== e.dispositivo.id)
    .map((f) => f.id);
}

/** A competência `AAAA-MM` de uma data ou instante local (a mesma de gestao/comum.ts). */
const competenciaDe = (t: string): string => t.slice(0, 7);

/**
 * As competências em que o dispositivo conta dispositivos-dia: da inserção até a retirada (ou até `agora`). Um
 * dispositivo inserido em março e retirado em maio toca março, abril e maio.
 */
export function competenciasDoIntervalo(inicio: string, fim: string | null, agora: string): string[] {
  const ate = competenciaDe(fim ?? agora);
  const r: string[] = [];
  let c = competenciaDe(inicio);
  for (let i = 0; c <= ate && i < 600; i++) {
    r.push(c);
    const [a, m] = c.split('-').map(Number) as [number, number];
    c = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  }
  return r;
}

/** As competências fechadas que a mudança toca (o antes e o depois do registro). */
export function competenciasFechadasTocadas(
  tocadas: readonly string[],
  fechadas: ReadonlySet<string>,
): string[] {
  return [...new Set(tocadas)].filter((c) => fechadas.has(c)).sort();
}

export interface DispositivoParaCorrigir {
  readonly tipo: string;
  readonly sitio: string | null;
  readonly inseridoEm: string;
  readonly retiradoEm: string | null;
  readonly canceladoEm?: string | null;
}

/** A correção de data, sítio e tipo do dispositivo (as travas de data são as da inserção e da retirada). */
export function conferirCorrecaoDispositivo(e: {
  readonly atual: DispositivoParaCorrigir;
  readonly novo: {
    readonly tipo: TipoDispositivoInvasivo;
    readonly sitio: string | null;
    readonly inseridoEm: string;
    readonly retiradoEm: string | null;
  };
  readonly agora: string;
  readonly entrada: string;
  /** Os outros dispositivos ativos da internação (sem este e sem os cancelados). */
  readonly outrosAtivos: readonly { readonly tipo: string }[];
}):
  | RecusaCorrecaoCcih
  | 'instante-futuro'
  | 'antes-da-internacao'
  | 'antes-da-insercao'
  | 'dispositivo-ja-ativo'
  | null {
  if (e.atual.canceladoEm) return 'registro-cancelado';
  if (e.atual.retiradoEm === null && e.novo.retiradoEm !== null) return 'retirada-sem-registro';
  const retirado = e.atual.retiradoEm === null ? null : (e.novo.retiradoEm ?? e.atual.retiradoEm);
  const igual =
    e.atual.tipo === e.novo.tipo &&
    (e.atual.sitio ?? '') === (e.novo.sitio ?? '') &&
    msLocal(e.atual.inseridoEm) === msLocal(e.novo.inseridoEm) &&
    (retirado === null
      ? e.atual.retiradoEm === null
      : msLocal(retirado) === msLocal(e.atual.retiradoEm ?? retirado));
  if (igual) return 'sem-mudanca';
  if (msLocal(e.novo.inseridoEm) > msLocal(e.agora)) return 'instante-futuro';
  if (retirado !== null && msLocal(retirado) > msLocal(e.agora)) return 'instante-futuro';
  if (diferencaDias(e.entrada, e.novo.inseridoEm) < 0) return 'antes-da-internacao';
  if (retirado !== null && msLocal(retirado) < msLocal(e.novo.inseridoEm)) return 'antes-da-insercao';
  // Trocar o tipo de um dispositivo em uso não pode deixar dois do mesmo tipo ativos.
  if (e.atual.retiradoEm === null && e.outrosAtivos.some((o) => o.tipo === e.novo.tipo))
    return 'dispositivo-ja-ativo';
  return null;
}

/** A correção da sessão de higiene das mãos: a estornada não se corrige; a data segue as travas do registro. */
export function conferirCorrecaoObservacao(e: {
  readonly estornadoEm?: string | null | undefined;
}): RecusaCorrecaoCcih | null {
  return e.estornadoEm ? 'observacao-estornada' : null;
}

/** A primeira competência ainda aberta à edição livre: as anteriores à data de hoje podem ser fechadas. */
export function podeFecharCompetencia(competencia: string, agora: string): boolean {
  return (
    competencia < competenciaDe(agora) ||
    somarDias(agora.slice(0, 10), 1).slice(0, 7) !== competenciaDe(agora)
  );
}
