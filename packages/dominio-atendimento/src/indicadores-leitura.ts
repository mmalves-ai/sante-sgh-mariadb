// Regras da leitura dos indicadores do atendimento externo sobre o banco do cliente (F3.2, 02-REC linha 30): o que
// cada grupo contado no banco vale para o cálculo (`calcularIndicadoresAgregados`), sem banco aqui. O tipo e o caráter
// chegam pelo código de negócio (categoria e caráter TISS, TISS: padrão de troca de informações da saúde suplementar)
// e saem no vocabulário numérico que o cálculo já usa.
// Regras: (1) só os tipos do atendimento externo entram (a internação tem os indicadores dela); (2) a requisição de
// laboratório é a marca da categoria OU o tipo "requisição"; (3) sem especialidade = sem consulta (fica fora do
// denominador); (4) a troca de leito não abre observação nova (a contagem das horas é do paciente); (5) a internação
// originada no PA (PA: pronto atendimento) conta uma vez por ficha, pelo desfecho, pelo encaminhamento ou pelos dois.
import { CARATERES, TIPOS_ATENDIMENTO } from '@sgh/contratos';
import type { InternacoesPa } from './indicadores.js';

/** Os tipos do atendimento externo (os únicos que os indicadores do ambulatório e do PA contam). */
export const TIPOS_DOS_INDICADORES: readonly string[] = TIPOS_ATENDIMENTO.map((t) => t.codigo);

/** O tipo numérico que o cálculo usa para o tipo de negócio (0 = não informado). */
export function tipoAteDoTipo(tipo: string): number {
  return TIPOS_ATENDIMENTO.find((t) => t.codigo === tipo)?.tipoAte ?? 0;
}

/** Um grupo contado no banco: tipo, marca de laboratório da categoria, sem especialidade, caráter TISS e o total. */
export interface GrupoContado {
  readonly tipo: string;
  readonly laboratorio: boolean;
  readonly semEspecialidade: boolean;
  readonly caraterTiss: string | null;
  readonly total: number;
}

/** O grupo no vocabulário do cálculo; os grupos que caem na mesma chave são somados. */
export function gruposDosIndicadores(
  grupos: readonly GrupoContado[],
): { tipoAte: number; laboratorio: boolean; especialidadeZero: boolean; caracters: number; total: number }[] {
  const soma = new Map<
    string,
    { tipoAte: number; laboratorio: boolean; especialidadeZero: boolean; caracters: number; total: number }
  >();
  for (const g of grupos) {
    if (!TIPOS_DOS_INDICADORES.includes(g.tipo) || g.total <= 0) continue;
    const t = TIPOS_ATENDIMENTO.find((x) => x.codigo === g.tipo);
    const x = {
      tipoAte: t?.tipoAte ?? 0,
      laboratorio: g.laboratorio || t?.laboratorio === true,
      especialidadeZero: g.semEspecialidade,
      caracters: CARATERES.find((c) => String(c.tiss) === String(g.caraterTiss ?? ''))?.gravado ?? 0,
    };
    const k = `${x.tipoAte}:${x.laboratorio}:${x.especialidadeZero}:${x.caracters}`;
    soma.set(k, { ...x, total: (soma.get(k)?.total ?? 0) + g.total });
  }
  return [...soma.values()];
}

/** Uma ocupação do leito de observação lida do banco (instantes ISO; saída nula = ainda no leito). */
export interface OcupacaoObservacaoLida {
  readonly cabecalho: string;
  readonly entrada: string;
  readonly saida: string | null;
  /** A saída foi a primeira metade de uma troca de leito (a ocupação seguinte continua a mesma observação). */
  readonly trocaDeLeito: boolean;
}

/** As observações do período com os minutos de permanência: a troca de leito não conta como observação nova. */
export function observacoesDosIndicadores(
  ocupacoes: readonly OcupacaoObservacaoLida[],
  agora: string,
): { cabecalho: string; minutos: number }[] {
  const t = (iso: string) => Date.parse(iso);
  return ocupacoes
    .filter((o) => !o.trocaDeLeito)
    .map((o) => ({
      cabecalho: o.cabecalho,
      minutos: Math.max(0, Math.floor((t(o.saida ?? agora) - t(o.entrada)) / 60_000)),
    }))
    .filter((o) => Number.isFinite(o.minutos));
}

/** As internações originadas no PA: cada grupo de fichas diz por qual caminho; a ficha com os dois conta uma vez. */
export function internacoesDoPa(
  grupos: readonly { peloDesfecho: boolean; peloEncaminhamento: boolean; total: number }[],
): InternacoesPa {
  let viaDesfecho = 0;
  let viaEncaminhamento = 0;
  let total = 0;
  for (const g of grupos) {
    if (g.peloDesfecho) viaDesfecho += g.total;
    if (g.peloEncaminhamento) viaEncaminhamento += g.total;
    if (g.peloDesfecho || g.peloEncaminhamento) total += g.total;
  }
  return { viaDesfecho, viaEncaminhamento, total };
}
