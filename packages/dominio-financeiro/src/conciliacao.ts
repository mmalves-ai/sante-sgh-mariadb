// Conciliação bancária por extrato (M32; ficha, seções 6 e 10): a SUGESTÃO casa a linha do extrato com o movimento ou
// o título por regra (valor e data exatos; valor numa janela de dias; o número do documento no histórico); a
// confirmação é humana e nunca baixa sem regra. Quem pagou não concilia (regra 4). Crédito sem casamento vai para a fila
// de crédito não identificado (regra 14).
import { centavos, diasEntre } from '@sgh/contratos/regras-financeiro';

export type RegraConciliacao = 'valor-data' | 'valor-janela' | 'documento' | 'manual';

export interface LinhaExtrato {
  readonly id: number;
  readonly data: string;
  /** Positivo: crédito na conta; negativo: débito. */
  readonly valor: number;
  readonly historico: string;
  readonly documento: string;
}

export interface Candidato {
  readonly tipo: 'movimento' | 'titulo-pagar' | 'titulo-receber';
  readonly id: number;
  readonly data: string;
  /** Com o sinal da conta (entrada +, saída −). */
  readonly valor: number;
  readonly documento: string;
}

export interface Sugestao {
  readonly linha: number;
  readonly candidato: Candidato;
  readonly regra: Exclude<RegraConciliacao, 'manual'>;
  /** 3 = valor e data, 2 = documento, 1 = valor na janela. */
  readonly forca: number;
}

const iguais = (a: number, b: number) => Math.abs(centavos(a) - centavos(b)) < 0.005;
const temDocumento = (historico: string, doc: string) =>
  doc.trim().length >= 3 && historico.replace(/\D/g, ' ').split(/\s+/).includes(doc.replace(/\D/g, ''));

/** As sugestões: cada linha recebe no máximo um candidato, e cada candidato serve a uma linha (o mais forte primeiro). */
export function sugerirConciliacao(
  linhas: readonly LinhaExtrato[],
  candidatos: readonly Candidato[],
  janelaDias = 3,
): Sugestao[] {
  const todas: Sugestao[] = [];
  for (const l of linhas)
    for (const c of candidatos) {
      if (!iguais(l.valor, c.valor)) continue;
      const d = Math.abs(diasEntre(l.data, c.data));
      if (d === 0) todas.push({ linha: l.id, candidato: c, regra: 'valor-data', forca: 3 });
      else if (c.documento && (temDocumento(l.historico, c.documento) || l.documento === c.documento))
        todas.push({ linha: l.id, candidato: c, regra: 'documento', forca: 2 });
      else if (d <= janelaDias) todas.push({ linha: l.id, candidato: c, regra: 'valor-janela', forca: 1 });
    }
  todas.sort((a, b) => b.forca - a.forca || a.linha - b.linha || a.candidato.id - b.candidato.id);
  const linhasUsadas = new Set<number>();
  const candUsados = new Set<string>();
  const r: Sugestao[] = [];
  for (const s of todas) {
    const k = `${s.candidato.tipo}:${s.candidato.id}`;
    if (linhasUsadas.has(s.linha) || candUsados.has(k)) continue;
    linhasUsadas.add(s.linha);
    candUsados.add(k);
    r.push(s);
  }
  return r;
}

/** Créditos do extrato sem sugestão: candidatos à fila de crédito não identificado. */
export function creditosSemCasamento(
  linhas: readonly LinhaExtrato[],
  sugestoes: readonly Sugestao[],
): LinhaExtrato[] {
  const casadas = new Set(sugestoes.map((s) => s.linha));
  return linhas.filter((l) => l.valor > 0 && !casadas.has(l.id));
}
