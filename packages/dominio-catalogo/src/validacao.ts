// Validação da carga (ficha do M13, regra 6, segundo passo): leiaute (os erros da leitura), totais e
// duplicados pela chave natural, campos obrigatórios, tamanho em bytes CP1252, tipo, e o charset (regra 7:
// caractere fora do CP1252 vira troca proposta, mostrada no motivo da linha antes de publicar).
import type { CampoCatalogo, DefinicaoCatalogo, EntidadeCatalogo } from '@sgh/contratos';
import { bytesCp1252, converterParaCp1252, descreverTrocas } from './charset.js';
import type { ItemLido } from './leiautes/comum.js';

export type ValorItem = string | number | null;

export interface ItemValidado {
  readonly entidade: string;
  readonly linha: number;
  /** Chave natural como texto (`campo=valor;…`), a mesma da comparação e da área de preparação. */
  readonly chave: string;
  readonly campos: Readonly<Record<string, ValorItem>>;
  readonly resultado: 'valida' | 'erro';
  /** Erros (linha com erro não é publicada) e avisos (trocas de charset propostas). */
  readonly motivos: readonly string[];
}

export interface ResultadoValidacao {
  readonly itens: readonly ItemValidado[];
  readonly totais: { readonly linhas: number; readonly validas: number; readonly erros: number };
}

export function entidadeDe(def: DefinicaoCatalogo, codigo: string): EntidadeCatalogo | null {
  return def.entidades.find((e) => e.codigo === codigo) ?? null;
}

/** Chave natural (campos da chave na ordem da definição). */
export function chaveDoItem(e: EntidadeCatalogo, campos: Readonly<Record<string, ValorItem>>): string {
  return e.campos
    .filter((c) => c.chave)
    .map((c) => `${c.nome}=${campos[c.nome] ?? ''}`)
    .join(';');
}

/** Campos da chave a partir do texto da chave. */
export function camposDaChave(chave: string): Record<string, string> {
  return Object.fromEntries(
    chave
      .split(';')
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i), p.slice(i + 1)];
      }),
  );
}

function validarCampo(c: CampoCatalogo, v: ValorItem, motivos: string[], erros: string[]): ValorItem {
  if (v === null || v === '') {
    if (c.obrigatorio) erros.push(`${c.nome}: obrigatório`);
    return c.tipo === 'texto' ? (v ?? null) : null;
  }
  switch (c.tipo) {
    case 'inteiro': {
      const n = typeof v === 'number' ? v : /^-?\d+$/.test(String(v).trim()) ? Number(v) : NaN;
      if (!Number.isSafeInteger(n)) erros.push(`${c.nome}: inteiro esperado`);
      return Number.isSafeInteger(n) ? n : v;
    }
    case 'decimal': {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) erros.push(`${c.nome}: valor inválido`);
      return Number.isFinite(n) ? n : v;
    }
    case 'data':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) erros.push(`${c.nome}: data inválida`);
      return v;
    default: {
      const conv = converterParaCp1252(String(v));
      if (conv.trocas.length > 0) motivos.push(descreverTrocas(c.nome, conv.trocas));
      if (c.tamanho !== undefined && bytesCp1252(conv.texto) > c.tamanho) {
        if (!c.truncar) erros.push(`${c.nome}: ${bytesCp1252(conv.texto)} caracteres (máximo ${c.tamanho})`);
        else {
          motivos.push(`${c.nome}: cortado em ${c.tamanho} caracteres (o banco guarda esse tamanho)`);
          return [...conv.texto].slice(0, c.tamanho).join('').trimEnd();
        }
      }
      return conv.texto;
    }
  }
}

/** Valida os itens lidos de todos os arquivos (linhas com erro de leitura já chegam com o erro). */
export function validarItens(def: DefinicaoCatalogo, lidos: readonly ItemLido[]): ResultadoValidacao {
  const vistos = new Map<string, number>();
  const itens: ItemValidado[] = [];
  for (const l of lidos) {
    const e = entidadeDe(def, l.entidade);
    if (!e) {
      itens.push({
        entidade: l.entidade,
        linha: l.linha,
        chave: '',
        campos: l.campos,
        resultado: 'erro',
        motivos: ['entidade desconhecida'],
      });
      continue;
    }
    const erros = [...l.erros];
    const motivos: string[] = [];
    const campos: Record<string, ValorItem> = {};
    for (const c of e.campos) campos[c.nome] = validarCampo(c, l.campos[c.nome] ?? null, motivos, erros);
    const chave = chaveDoItem(e, campos);
    const k = `${e.codigo}|${chave}`;
    const antes = vistos.get(k);
    if (antes !== undefined) erros.push(`duplicado: a mesma chave já veio na linha ${antes % 1_000_000}`);
    else vistos.set(k, l.linha);
    itens.push({
      entidade: e.codigo,
      linha: l.linha,
      chave,
      campos,
      resultado: erros.length > 0 ? 'erro' : 'valida',
      motivos: [...erros, ...motivos],
    });
  }
  const erros = itens.filter((i) => i.resultado === 'erro').length;
  return { itens, totais: { linhas: itens.length, validas: itens.length - erros, erros } };
}
