// Importação versionada de tabela de preço (ficha do M12, seção 5 "Importação versionada"; cap-06a §6.2,
// carga em três passos): o arquivo entra na área de preparação, é validado (leiaute, totais, códigos
// repetidos, números) e comparado com a vigência que vale hoje (novos, removidos, alterados, iguais). A
// publicação dos itens EXISTENTES é o `preco.reajustar` em modo "por arquivo"; os novos e os removidos
// aparecem na comparação e não são publicados (o novo nunca grava TBTABTHM; operação ainda não disponível).
//
// Leiaute (CSV, separador ";" ou ","; decimal com vírgula quando o separador é ";"):
//   codigo;valor_ch[;valor_co;valor_filme;valor_anes;valor_outros]
// Primeira linha: o cabeçalho com esses nomes (ordem livre; `codigo` e `valor_ch` obrigatórios). Linha de
// total opcional no fim: `#total;<quantidade de itens>;<soma de valor_ch>` (conferida).
import { TETO_LINHAS_IMPORTACAO } from '@sgh/contratos';
import { type Componentes, NOMES_COMPONENTES } from './modelo-valor.js';
import { componenteValido } from './proposta-reajuste.js';

const COLUNAS: Readonly<Record<string, keyof Componentes | 'codigo'>> = {
  codigo: 'codigo',
  valor_ch: 'ch',
  valor_co: 'co',
  valor_filme: 'filme',
  valor_anes: 'anes',
  valor_outros: 'outros',
};

export interface LinhaArquivo {
  readonly linha: number;
  readonly codigo: number;
  readonly valores: Partial<Componentes> & { readonly ch: number };
}

export interface ErroArquivo {
  readonly linha: number;
  readonly motivo: string;
}

export interface ArquivoLido {
  readonly colunas: readonly (keyof Componentes)[];
  readonly linhas: readonly LinhaArquivo[];
  readonly erros: readonly ErroArquivo[];
  /** Linhas de dados lidas (válidas e com erro). */
  readonly total: number;
}

function numero(bruto: string, decimalVirgula: boolean): number | null {
  const s = bruto.trim();
  if (s === '') return null;
  const normal = decimalVirgula ? s.replace(/\./g, '').replace(',', '.') : s;
  if (!/^-?\d+(?:\.\d+)?$/.test(normal)) return null;
  return Number(normal);
}

/** Lê e valida o arquivo (sem consultar o banco). */
export function lerArquivoPreco(texto: string): ArquivoLido {
  const brutas = texto.replace(/^\uFEFF/, '').split(/\r?\n/);
  const erros: ErroArquivo[] = [];
  const cab = brutas[0] ?? '';
  const sep = cab.includes(';') ? ';' : ',';
  const decimalVirgula = sep === ';';
  const nomes = cab.split(sep).map((c) => c.trim().toLowerCase());
  const indice = new Map<string, number>();
  nomes.forEach((n, i) => indice.set(n, i));
  const desconhecidas = nomes.filter((n) => !(n in COLUNAS));
  if (!indice.has('codigo') || !indice.has('valor_ch'))
    return {
      colunas: [],
      linhas: [],
      erros: [{ linha: 1, motivo: 'Cabeçalho sem as colunas obrigatórias "codigo" e "valor_ch".' }],
      total: 0,
    };
  if (desconhecidas.length)
    return {
      colunas: [],
      linhas: [],
      erros: [{ linha: 1, motivo: `Colunas fora do leiaute: ${desconhecidas.join(', ')}.` }],
      total: 0,
    };
  const colunas = NOMES_COMPONENTES.filter((k) => nomes.some((n) => COLUNAS[n] === k));
  const linhas: LinhaArquivo[] = [];
  const vistos = new Map<number, number>();
  let total = 0;
  let totalDeclarado: { itens: number; soma: number; linha: number } | null = null;
  for (let i = 1; i < brutas.length; i++) {
    const bruta = brutas[i] ?? '';
    if (bruta.trim() === '') continue;
    const n = i + 1;
    const partes = bruta.split(sep);
    if ((partes[0] ?? '').trim().toLowerCase() === '#total') {
      const itens = numero(partes[1] ?? '', false);
      const soma = numero(partes[2] ?? '', decimalVirgula);
      if (itens === null || soma === null) erros.push({ linha: n, motivo: 'Linha de total ilegível.' });
      else totalDeclarado = { itens, soma, linha: n };
      continue;
    }
    total++;
    if (total > TETO_LINHAS_IMPORTACAO) {
      erros.push({ linha: n, motivo: `Arquivo acima do teto de ${TETO_LINHAS_IMPORTACAO} linhas.` });
      break;
    }
    if (partes.length !== nomes.length) {
      erros.push({ linha: n, motivo: `Esperadas ${nomes.length} colunas, lidas ${partes.length}.` });
      continue;
    }
    const codigo = numero(partes[indice.get('codigo') ?? 0] ?? '', false);
    if (codigo === null || !Number.isSafeInteger(codigo) || codigo <= 0 || codigo > 2_147_483_647) {
      erros.push({ linha: n, motivo: 'Código do item inválido (inteiro positivo).' });
      continue;
    }
    const valores: Partial<Record<keyof Componentes, number>> = {};
    let ruim: string | null = null;
    for (const [nome, i2] of indice) {
      const k = COLUNAS[nome];
      if (!k || k === 'codigo') continue;
      const v = numero(partes[i2] ?? '', decimalVirgula);
      if (v === null) {
        if (k === 'ch') ruim = 'valor_ch vazio ou ilegível';
        continue;
      }
      if (!componenteValido(k, v)) {
        ruim = `${nome} inválido (não negativo, até 4 casas; 2 em anestesia e filme)`;
        continue;
      }
      valores[k] = v;
    }
    if (ruim || valores.ch === undefined) {
      erros.push({ linha: n, motivo: ruim ?? 'valor_ch ausente' });
      continue;
    }
    const antes = vistos.get(codigo);
    if (antes !== undefined) {
      erros.push({ linha: n, motivo: `Código ${codigo} repetido (primeira vez na linha ${antes}).` });
      continue;
    }
    vistos.set(codigo, n);
    linhas.push({ linha: n, codigo, valores: { ...valores, ch: valores.ch } });
  }
  if (totalDeclarado) {
    const soma = Math.round(linhas.reduce((s, l) => s + l.valores.ch, 0) * 10000) / 10000;
    if (totalDeclarado.itens !== total)
      erros.push({
        linha: totalDeclarado.linha,
        motivo: `Total de itens declarado (${totalDeclarado.itens}) diferente do lido (${total}).`,
      });
    else if (Math.abs(totalDeclarado.soma - soma) > 0.00005)
      erros.push({
        linha: totalDeclarado.linha,
        motivo: `Soma de valor_ch declarada (${totalDeclarado.soma}) diferente da lida (${soma}).`,
      });
  }
  return { colunas, linhas, erros, total };
}

export interface ItemVigente {
  readonly codigo: number;
  readonly nome: string;
  readonly situacao: string | null;
  /** Componentes da vigência que vale hoje (null: item sem preço). */
  readonly valores: Componentes | null;
}

export type ResultadoComparacao = 'novo' | 'removido' | 'alterado' | 'igual';

export interface ItemComparado {
  readonly codigo: number;
  readonly nome: string | null;
  readonly resultado: ResultadoComparacao;
  readonly antes: Componentes | null;
  readonly depois: (Partial<Componentes> & { readonly ch: number }) | null;
  readonly linha: number | null;
}

export interface Comparacao {
  readonly itens: readonly ItemComparado[];
  readonly novos: number;
  readonly removidos: number;
  readonly alterados: number;
  readonly iguais: number;
}

/**
 * Compara o arquivo com a vigência atual da tabela: código fora de TBTABTHM é `novo` (não publicado: o novo nunca grava TBTABTHM);
 * item ativo com preço que não está no arquivo é `removido` (nada muda no novo); os demais `alterado` ou
 * `igual` (só os componentes do arquivo contam; os ausentes ficam como estão).
 */
export function compararComVigente(
  arquivo: readonly LinhaArquivo[],
  vigentes: readonly ItemVigente[],
): Comparacao {
  const porCodigo = new Map(vigentes.map((v) => [v.codigo, v]));
  const noArquivo = new Set(arquivo.map((l) => l.codigo));
  const itens: ItemComparado[] = [];
  for (const l of arquivo) {
    const v = porCodigo.get(l.codigo);
    if (!v) {
      itens.push({
        codigo: l.codigo,
        nome: null,
        resultado: 'novo',
        antes: null,
        depois: l.valores,
        linha: l.linha,
      });
      continue;
    }
    const mudou =
      !v.valores ||
      NOMES_COMPONENTES.some((k) => l.valores[k] !== undefined && l.valores[k] !== v.valores?.[k]);
    itens.push({
      codigo: l.codigo,
      nome: v.nome,
      resultado: mudou ? 'alterado' : 'igual',
      antes: v.valores,
      depois: l.valores,
      linha: l.linha,
    });
  }
  for (const v of vigentes) {
    if (noArquivo.has(v.codigo) || (v.situacao ?? '').trim() !== 'A' || !v.valores) continue;
    itens.push({
      codigo: v.codigo,
      nome: v.nome,
      resultado: 'removido',
      antes: v.valores,
      depois: null,
      linha: null,
    });
  }
  itens.sort((a, b) => a.codigo - b.codigo);
  const conta = (r: ResultadoComparacao) => itens.filter((i) => i.resultado === r).length;
  return {
    itens,
    novos: conta('novo'),
    removidos: conta('removido'),
    alterados: conta('alterado'),
    iguais: conta('igual'),
  };
}
