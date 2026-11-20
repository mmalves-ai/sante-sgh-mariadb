// Comuns das telas dos lançamentos (M54.2): o valor digitado em reais para centavos, os totais do rascunho do lançamento
// manual com a conferência antes de ir ao servidor (débitos = créditos, regra 5; conta com centro de custo exigido),
// a soma das partidas marcadas na conciliação e o intervalo de datas da competência. O servidor confere tudo de novo.
import { MAX_PARTIDAS_MANUAL, type PartidaParaConciliar } from '@sgh/contratos';
import { reais } from './comum-contabil.js';

export interface PartidaRascunhoManual {
  lado: 'D' | 'C';
  conta: string | null;
  /** O valor como digitado (ex.: "1.234,56"). */
  valor: string;
  centroCusto: string;
  historico: string;
}

export interface ContaDoApoio {
  readonly codigo: string;
  readonly nome: string;
  readonly natureza: 'devedora' | 'credora';
  readonly exigeCentroCusto: boolean;
}

/** "1.234,56", "1234,5", "1234.56" ou "10" em centavos; nulo se não for um valor positivo com até 2 decimais. */
export function centavosDoTexto(texto: string): number | null {
  const t = texto.trim().replace(/\s|R\$/g, '');
  if (!t) return null;
  let normal: string;
  if (t.includes(',')) normal = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, '');
  else normal = t;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  const [inteiro, dec = ''] = normal.split('.') as [string, string?];
  const c = Number(inteiro) * 100 + Number((dec + '00').slice(0, 2));
  return Number.isSafeInteger(c) && c > 0 ? c : null;
}

export const partidaVaziaManual = (lado: 'D' | 'C'): PartidaRascunhoManual => ({
  lado,
  conta: null,
  valor: '',
  centroCusto: '',
  historico: '',
});

export function totaisDoManual(partidas: readonly PartidaRascunhoManual[]): {
  debitos: number;
  creditos: number;
  diferenca: number;
  equilibrado: boolean;
} {
  let debitos = 0;
  let creditos = 0;
  for (const p of partidas) {
    const v = centavosDoTexto(p.valor) ?? 0;
    if (p.lado === 'D') debitos += v;
    else creditos += v;
  }
  return {
    debitos,
    creditos,
    diferenca: debitos - creditos,
    equilibrado: debitos === creditos && debitos > 0,
  };
}

/** A conferência do rascunho do lançamento manual (as mensagens que a tela mostra antes de enviar). */
export function problemasDoManual(
  r: { data: string; historico: string; partidas: readonly PartidaRascunhoManual[] },
  contas: readonly ContaDoApoio[],
): string[] {
  const p: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.data)) p.push('Informe a data do lançamento.');
  if (r.historico.trim().length < 3) p.push('O histórico precisa de ao menos 3 caracteres.');
  if (r.partidas.length < 2) p.push('O lançamento precisa de ao menos duas partidas.');
  if (r.partidas.length > MAX_PARTIDAS_MANUAL) p.push(`No máximo ${MAX_PARTIDAS_MANUAL} partidas.`);
  if (!r.partidas.some((x) => x.lado === 'D') || !r.partidas.some((x) => x.lado === 'C'))
    p.push('O lançamento precisa de ao menos um débito e um crédito.');
  const porCodigo = new Map(contas.map((c) => [c.codigo, c]));
  r.partidas.forEach((x, i) => {
    const n = i + 1;
    if (!x.conta) p.push(`Partida ${n}: escolha a conta.`);
    else if (!porCodigo.has(x.conta)) p.push(`Partida ${n}: a conta não recebe lançamento.`);
    else if (porCodigo.get(x.conta)?.exigeCentroCusto && !/^\d+$/.test(x.centroCusto.trim()))
      p.push(`Partida ${n}: a conta exige o centro de custo.`);
    if (centavosDoTexto(x.valor) === null) p.push(`Partida ${n}: valor inválido.`);
    if (x.centroCusto.trim() && !/^\d+$/.test(x.centroCusto.trim()))
      p.push(`Partida ${n}: o centro de custo é um número.`);
  });
  const t = totaisDoManual(r.partidas);
  if (t.debitos !== t.creditos)
    p.push(
      `Débitos (${reais(t.debitos)}) diferentes dos créditos (${reais(t.creditos)}): diferença de ${reais(Math.abs(t.diferenca))}.`,
    );
  return p;
}

/** As partidas do corpo enviado (só depois de `problemasDoManual` vazio). */
export function partidasDoCorpo(partidas: readonly PartidaRascunhoManual[]) {
  return partidas.map((x) => ({
    lado: x.lado,
    conta: x.conta ?? '',
    valorCentavos: centavosDoTexto(x.valor) ?? 0,
    centroCusto: x.centroCusto.trim() ? Number(x.centroCusto.trim()) : null,
    historico: x.historico.trim() ? x.historico.trim() : null,
  }));
}

/** A soma das partidas marcadas na conciliação (débitos, créditos e se fecham). */
export function somaDaSelecao(
  itens: readonly PartidaParaConciliar[],
  marcadas: ReadonlySet<number>,
): { partidas: number; debitos: number; creditos: number; fecha: boolean } {
  let debitos = 0;
  let creditos = 0;
  let partidas = 0;
  for (const x of itens) {
    if (!marcadas.has(x.id)) continue;
    partidas++;
    if (x.lado === 'D') debitos += x.valorCentavos;
    else creditos += x.valorCentavos;
  }
  return { partidas, debitos, creditos, fecha: partidas >= 2 && debitos === creditos && debitos > 0 };
}

/** O primeiro e o último dia da competência "AAAA-MM". */
export function diasDaCompetencia(competencia: string): { de: string; ate: string } {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: `${competencia}-01`, ate: `${competencia}-${String(ultimo).padStart(2, '0')}` };
}

/** Chave da intenção do lançamento manual (UUID: o envio repetido não duplica). */
export function novaIdempotencia(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
