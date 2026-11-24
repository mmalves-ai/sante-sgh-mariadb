// Dias sem expediente na geração da grade (02-AGE linha 41): os feriados nacionais fixos e a Sexta-feira Santa, mais os
// cadastrados no cliente (feriado nacional, estadual, municipal ou do estabelecimento) e os dias não úteis do
// cadastro (recorrência anual, data única ou móvel gravada por ano).
//
// Regras:
//   - vale o que tem abrangência nacional, o estadual da UF do estabelecimento, o municipal do município do
//     estabelecimento e o do próprio estabelecimento; o de outra UF, outro município ou outro estabelecimento não;
//   - ponto facultativo NÃO pula o dia (o hospital decide abrir); fica fora da lista. Carnaval e Corpus Christi são
//     ponto facultativo federal: só entram se o cliente os cadastrar como feriado (municipal, estadual ou do
//     estabelecimento, sem a marca de ponto facultativo);
//   - dia não útil com faixa de horas (meio expediente) não pula o dia inteiro: sai na lista com a faixa, e a geração
//     da grade pula só os horários dentro dela; se o dia inteiro já está sem expediente, a faixa não aparece;
//   - a mesma data aparece uma vez só, com o primeiro nome pela ordem: cadastro do estabelecimento, municipal,
//     estadual, nacional (o nome mais local é o que a recepção reconhece).
import { type Feriado, feriadosMoveis } from './grade.js';

export type Abrangencia = 'nacional' | 'estadual' | 'municipal' | 'estabelecimento';

/** Onde fica o estabelecimento da sessão. */
export interface LocalExpediente {
  readonly estabelecimento: number;
  readonly municipio: number | null;
  /** Sigla da UF (o cadastro de feriado guarda a sigla). */
  readonly uf: string | null;
  /** Id da UF (o cadastro de dia não útil guarda o id). */
  readonly ufId: number | null;
}

export interface FeriadoCadastrado {
  readonly data: string;
  readonly nome: string;
  readonly abrangencia: Abrangencia;
  readonly uf: string | null;
  readonly municipio: number | null;
  readonly estabelecimento: number | null;
  readonly pontoFacultativo: boolean;
}

export interface DiaNaoUtilCadastrado {
  readonly descricao: string;
  readonly abrangencia: Abrangencia;
  readonly ufId: number | null;
  readonly municipio: number | null;
  readonly estabelecimento: number | null;
  readonly recorrencia: 'anual' | 'data_unica' | 'movel';
  readonly dia: number | null;
  readonly mes: number | null;
  readonly data: string | null;
  readonly facultativo: boolean;
  /** Preenchida quando o dia não útil é só uma faixa de horas. */
  readonly horaInicio: string | null;
  /** Fim exclusivo da faixa; vazio com início preenchido = até o fim do dia. */
  readonly horaFim?: string | null;
}

/** Feriados nacionais de data fixa (lei federal); os móveis saem de `feriadosMoveis`. */
export const FERIADOS_NACIONAIS_FIXOS: readonly (readonly [string, string])[] = [
  ['01-01', 'Confraternização Universal'],
  ['04-21', 'Tiradentes'],
  ['05-01', 'Dia do Trabalho'],
  ['09-07', 'Independência do Brasil'],
  ['10-12', 'Nossa Senhora Aparecida'],
  ['11-02', 'Finados'],
  ['11-15', 'Proclamação da República'],
  ['11-20', 'Dia Nacional de Zumbi e da Consciência Negra'],
  ['12-25', 'Natal'],
];

const PESO: Record<Abrangencia, number> = { estabelecimento: 0, municipal: 1, estadual: 2, nacional: 3 };

/** O cadastro vale para o estabelecimento? */
export function valeNoLocal(
  local: LocalExpediente,
  a: Abrangencia,
  alvo: {
    uf?: string | null;
    ufId?: number | null;
    municipio: number | null;
    estabelecimento: number | null;
  },
): boolean {
  switch (a) {
    case 'nacional':
      return true;
    case 'estadual':
      return (
        (alvo.uf != null && local.uf != null && alvo.uf.toUpperCase() === local.uf.toUpperCase()) ||
        (alvo.ufId != null && local.ufId != null && alvo.ufId === local.ufId)
      );
    case 'municipal':
      return alvo.municipio != null && alvo.municipio === local.municipio;
    case 'estabelecimento':
      return alvo.estabelecimento === local.estabelecimento;
  }
}

const dois = (n: number) => String(n).padStart(2, '0');

/**
 * Dias que a geração da grade pula, no período [de, ate], em ordem de data e sem repetição; o dia com faixa de horas
 * sem expediente sai com `horaInicio`/`horaFim`.
 */
export function diasSemExpediente(
  local: LocalExpediente,
  de: string,
  ate: string,
  cadastro: {
    readonly feriados: readonly FeriadoCadastrado[];
    readonly diasNaoUteis: readonly DiaNaoUtilCadastrado[];
  },
): Feriado[] {
  const cand: { data: string; nome: string; peso: number }[] = [];
  const faixas: Feriado[] = [];
  const anoDe = Number(de.slice(0, 4));
  const anoAte = Number(ate.slice(0, 4));
  for (let a = anoDe; a <= anoAte; a++) {
    for (const [md, nome] of FERIADOS_NACIONAIS_FIXOS) cand.push({ data: `${a}-${md}`, nome, peso: 4 });
    for (const m of feriadosMoveis(a)) cand.push({ data: m.data, nome: m.nome, peso: 4 });
  }
  for (const f of cadastro.feriados) {
    if (f.pontoFacultativo || !valeNoLocal(local, f.abrangencia, f)) continue;
    cand.push({ data: f.data, nome: f.nome, peso: PESO[f.abrangencia] });
  }
  for (const d of cadastro.diasNaoUteis) {
    if (d.facultativo || !valeNoLocal(local, d.abrangencia, d)) continue;
    const datas: string[] = [];
    if (d.recorrencia === 'anual') {
      if (d.dia == null || d.mes == null) continue;
      for (let a = anoDe; a <= anoAte; a++) datas.push(`${a}-${dois(d.mes)}-${dois(d.dia)}`);
    } else if (d.data) datas.push(d.data);
    for (const data of datas)
      if (d.horaInicio)
        faixas.push({ data, nome: d.descricao, horaInicio: d.horaInicio, horaFim: d.horaFim ?? null });
      else cand.push({ data, nome: d.descricao, peso: PESO[d.abrangencia] });
  }
  const porData = new Map<string, { nome: string; peso: number }>();
  for (const x of cand) {
    if (x.data < de || x.data > ate) continue;
    const atual = porData.get(x.data);
    if (!atual || x.peso < atual.peso) porData.set(x.data, { nome: x.nome, peso: x.peso });
  }
  const inteiros: Feriado[] = [...porData.entries()].map(([data, v]) => ({ data, nome: v.nome }));
  const parciais = faixas.filter((f) => f.data >= de && f.data <= ate && !porData.has(f.data));
  return [...inteiros, ...parciais].sort(
    (x, y) => x.data.localeCompare(y.data) || (x.horaInicio ?? '').localeCompare(y.horaInicio ?? ''),
  );
}
