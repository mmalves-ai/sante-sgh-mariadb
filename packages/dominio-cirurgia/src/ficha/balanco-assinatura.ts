// Ficha anestésica (M46, regra 3): o de-para dos fluidos e das perdas para o balanço hídrico do M45 e o conteúdo
// canônico que a assinatura cobre (o SHA-256 gravado na ficha). Regras puras.
//   - De-para (D-BAL-46): o balanço classifica o ganho pelo grupo (PRAGRUPBALANCO) e a perda pelo tipo de eliminação
//     (PRBHTPELIMINA), domínios do estabelecimento lidos do banco, sem ID fixo no código. O fluido e a perda da ficha
//     acham o seu pelo nome (hemocomponente → grupo de sangue ou hemoderivado; o resto → soro, hidratação ou infusão;
//     sangramento, diurese e aspiração pelo nome); sem correspondência, o primeiro do domínio. Domínio vazio: o item
//     fica fora do balanço (a ficha mostra "fora do balanço").
//   - Conteúdo canônico: os marcos, os lançamentos (parte, momento, fim e campos), as passagens e as justificativas,
//     em ordem estável e JSON com as chaves ordenadas; o que muda depois (adendo) não entra.
import { FLUIDOS_FICHA, sha256Hex } from '@sgh/contratos';

export interface DominioDoBalanco {
  readonly grupos: readonly { readonly codigo: number; readonly nome: string }[];
  readonly tiposEliminacao: readonly {
    readonly codigo: number;
    readonly nome: string;
    readonly ativo: boolean;
  }[];
}

const DIACRITICOS = new RegExp('[\u0300-\u036f]', 'g');
const semAcento = (s: string) => s.normalize('NFD').replace(DIACRITICOS, '').toLowerCase();

const achar = <T extends { nome: string }>(lista: readonly T[], re: RegExp): T | undefined =>
  lista.find((x) => re.test(semAcento(x.nome)));

const HEMO = new Set<string>(FLUIDOS_FICHA.filter((f) => f.hemocomponente).map((f) => f.codigo));

const PERDA_RE: Readonly<Record<string, RegExp>> = {
  sangramento: /sangr|hemorr/,
  diurese: /diur|urin/,
  aspiracao: /aspir/,
  outra: /outr/,
};

/** O grupo do ganho ou o tipo da perda do balanço para o lançamento da ficha; null = não vai ao balanço. */
export function deParaBalanco(
  l: { readonly parte: 'fluido' | 'perda'; readonly tipo: string },
  d: DominioDoBalanco,
): { grupo: number | null; tipoEliminacao: number | null } | null {
  if (l.parte === 'fluido') {
    if (d.grupos.length === 0) return null;
    const g = HEMO.has(l.tipo)
      ? achar(d.grupos, /hemo|sangue/)
      : achar(d.grupos, /soro|hidrat|cristal|infus|parenter|endoven/);
    return { grupo: (g ?? d.grupos[0]!).codigo, tipoEliminacao: null };
  }
  const ativos = d.tiposEliminacao.filter((t) => t.ativo);
  if (ativos.length === 0) return null;
  const t = achar(ativos, PERDA_RE[l.tipo] ?? /outr/);
  return { grupo: null, tipoEliminacao: (t ?? ativos[0]!).codigo };
}

export interface ConteudoFicha {
  readonly agendamento: number;
  readonly marcos: Readonly<Record<string, string>>;
  readonly lancamentos: readonly {
    readonly id: number;
    readonly parte: string;
    readonly momento: string;
    readonly fim: string | null;
    readonly dados: Readonly<Record<string, string | number | null>>;
  }[];
  readonly passagens: readonly {
    readonly momento: string;
    readonly de: number;
    readonly para: number;
    readonly resumo: string;
  }[];
  readonly lacunas: readonly { readonly inicio: string; readonly fim: string; readonly motivo: string }[];
}

function ordenado(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenado);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, ordenado((v as Record<string, unknown>)[k])]),
    );
  return v;
}

/** O texto canônico da ficha (o que a assinatura cobre): ordem estável, chaves ordenadas. */
export function conteudoCanonicoFicha(c: ConteudoFicha): string {
  const lancamentos = [...c.lancamentos].sort((a, b) =>
    a.momento < b.momento ? -1 : a.momento > b.momento ? 1 : a.id - b.id,
  );
  return JSON.stringify(ordenado({ ...c, lancamentos }));
}

export function impressaoFicha(c: ConteudoFicha): Promise<string> {
  return sha256Hex(conteudoCanonicoFicha(c));
}
