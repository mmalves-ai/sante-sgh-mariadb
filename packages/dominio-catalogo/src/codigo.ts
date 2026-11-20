// Códigos dos catálogos oficiais (ficha do M13, regra 8): sempre TEXTO, com os zeros à esquerda preservados
// (CID, CBO, CEP, SIGTAP de 10 dígitos, TUSS, IBGE); competência no formato AAAAMM. A conversão para o tipo
// da coluna do banco (CEP e SIGTAP são INTEGER e NUMERIC lá) é da camada física (@sgh/legado), nunca daqui.

export type TipoCodigo =
  'cid' | 'morfologia' | 'ciap' | 'cbo' | 'cep' | 'sigtap' | 'tuss' | 'ibge' | 'banco' | 'numerico';

export type ResultadoCodigo =
  { readonly ok: true; readonly codigo: string } | { readonly ok: false; readonly erro: string };

const so = (texto: string) => texto.normalize('NFC').trim();

const DIGITOS: Partial<Record<TipoCodigo, number>> = {
  cbo: 6,
  cep: 8,
  sigtap: 10,
  ibge: 7,
  banco: 3,
};

/** Normaliza e confere o código do tipo (texto; nunca número). */
export function normalizarCodigo(
  tipo: TipoCodigo,
  bruto: string | number | null | undefined,
): ResultadoCodigo {
  if (bruto === null || bruto === undefined) return { ok: false, erro: 'código vazio' };
  const t = so(String(bruto));
  if (t === '') return { ok: false, erro: 'código vazio' };
  switch (tipo) {
    case 'cid': {
      // A00, A00.0, A000, U07.1 (DATASUS escreve com e sem ponto; o banco guarda sem ponto).
      const c = t.toUpperCase().replace(/\./g, '');
      return /^[A-Z]\d{2}[0-9A-Z]?$/.test(c)
        ? { ok: true, codigo: c }
        : { ok: false, erro: `CID inválido: ${t}` };
    }
    case 'morfologia': {
      // CID-O: 8000/3 ou M80003 → M80003 (letra M, quatro dígitos e o comportamento).
      const c = t.toUpperCase().replace(/[/.\s]/g, '');
      const m = /^M?(\d{5})$/.exec(c);
      return m ? { ok: true, codigo: `M${m[1]}` } : { ok: false, erro: `morfologia inválida: ${t}` };
    }
    case 'ciap': {
      const c = t.toUpperCase();
      return /^[A-Z]\d{2}$/.test(c) || /^-\d{2}$/.test(c)
        ? { ok: true, codigo: c }
        : { ok: false, erro: `CIAP inválido: ${t}` };
    }
    case 'tuss':
    case 'numerico': {
      // Zeros à esquerda preservados como vieram (o arquivo oficial é a régua).
      return /^\d{1,10}$/.test(t)
        ? { ok: true, codigo: t }
        : { ok: false, erro: `código não numérico: ${t}` };
    }
    default: {
      const n = DIGITOS[tipo] as number;
      const c = t.replace(/[.\-\s]/g, '');
      if (!/^\d+$/.test(c) || c.length > n)
        return { ok: false, erro: `código com ${n} dígitos esperado: ${t}` };
      return { ok: true, codigo: c.padStart(n, '0') };
    }
  }
}

/** Competência AAAAMM válida (mês 01 a 12; desde 2000). */
export function competenciaValida(c: string): boolean {
  const m = /^(\d{4})(\d{2})$/.exec(c);
  if (!m) return false;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  return ano >= 2000 && ano <= 2099 && mes >= 1 && mes <= 12;
}

/** Primeiro dia da competência (AAAA-MM-01), a data com que o banco guarda os valores da SIGTAP. */
export function inicioDaCompetencia(c: string): string {
  if (!competenciaValida(c)) throw new Error(`Competência inválida: ${c}`);
  return `${c.slice(0, 4)}-${c.slice(4, 6)}-01`;
}

/** Competência seguinte (AAAAMM). */
export function competenciaSeguinte(c: string): string {
  if (!competenciaValida(c)) throw new Error(`Competência inválida: ${c}`);
  const ano = Number(c.slice(0, 4));
  const mes = Number(c.slice(4, 6));
  return mes === 12 ? `${ano + 1}01` : `${ano}${String(mes + 1).padStart(2, '0')}`;
}

/** Data DDMMAAAA (SPED, DATASUS) ou AAAA-MM-DD ou DD/MM/AAAA → AAAA-MM-DD; null se vazia ou inválida. */
export function dataDoArquivo(bruto: string | null | undefined): string | null {
  const t = (bruto ?? '').trim();
  if (t === '') return null;
  let a: string;
  let m: string;
  let d: string;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  const compacta = /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (iso) [, a, m, d] = iso as unknown as [string, string, string, string];
  else if (br) [, d, m, a] = br as unknown as [string, string, string, string];
  else if (compacta) [, d, m, a] = compacta as unknown as [string, string, string, string];
  else return null;
  const x = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d)));
  if (x.getUTCFullYear() !== Number(a) || x.getUTCMonth() !== Number(m) - 1 || x.getUTCDate() !== Number(d))
    return null;
  return `${a}-${m}-${d}`;
}

/** Valor em centavos sem separador (DATASUS: "000000001234" = 12,34) → número com 2 casas. */
export function valorEmCentavos(bruto: string): number | null {
  const t = bruto.trim();
  if (t === '') return 0;
  if (!/^-?\d+$/.test(t)) return null;
  return Number(t) / 100;
}

/** Número decimal do arquivo ("1.234,56", "1234.56", "1234,56") → número; null se inválido. */
export function decimalDoArquivo(bruto: string | null | undefined): number | null {
  const t = (bruto ?? '').trim();
  if (t === '') return null;
  const s = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  return Number(s);
}
