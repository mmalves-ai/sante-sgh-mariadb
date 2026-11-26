// Cotação por portal externo (05-SUP linha 19, C3-008): a porta é genérica (`AdaptadorPortalCotacao`: montar o envio do
// mapa e ler as respostas dos fornecedores). O primeiro adaptador é a troca por arquivo: o comprador baixa o mapa em
// planilha (CSV com ponto e vírgula, vírgula decimal, como a planilha brasileira abre), o portal ou o fornecedor
// preenche o preço e a marca, e o arquivo volta para o mapa. O adaptador de um portal com API (o primeiro previsto é o
// mais usado no país) entra pelo motor de integração com a mesma porta, quando o hospital tiver o contrato com ele.
// Regras puras: nada de banco nem de arquivo em disco; a leitura recusa a linha com o número dela e nunca valores de
// outra cotação.
import { recusa, reais, type RecusaSuprimentos } from './recusa.js';

/** A proposta do mapa que vai no arquivo (uma linha por fornecedor convidado em cada item). */
export interface PropostaDoMapa {
  readonly id: number;
  readonly item: number;
  readonly seq: number;
  readonly fornecedor: number;
  readonly fornecedorNome: string;
  readonly quantidade: number;
  readonly valorUnitario: number;
  readonly marca: string;
}

/** O item do pedido, para o nome do produto no arquivo. */
export interface ItemDoMapa {
  readonly item: number;
  readonly seq: number;
  readonly nome: string;
}

/** A resposta lida para uma proposta: o preço e a marca que o fornecedor informou. */
export interface RespostaDaCotacao {
  readonly proposta: number;
  readonly valorUnitario: number;
  readonly marca?: string;
}

export interface RecusaDeLinha {
  /** A linha do arquivo (1 é o cabeçalho). */
  readonly linha: number;
  readonly codigo: string;
  readonly mensagem: string;
}

export interface LeituraRespostas {
  readonly respostas: RespostaDaCotacao[];
  readonly recusas: RecusaDeLinha[];
  /** Linhas sem preço: o fornecedor não cotou o item (não é erro). */
  readonly semPreco: number;
}

/** A porta genérica do portal de cotação: cada portal (arquivo, API) é um adaptador dela. */
export interface AdaptadorPortalCotacao {
  /** O código do portal no cadastro (`portal_cotacao.codigo`). */
  readonly codigo: string;
  readonly tipoIntegracao: 'api' | 'webservice' | 'arquivo' | 'manual';
  montarEnvio(
    pedido: { ano: number; doc: number },
    itens: readonly ItemDoMapa[],
    propostas: readonly PropostaDoMapa[],
  ): string;
  lerRespostas(conteudo: string, propostas: readonly PropostaDoMapa[]): LeituraRespostas;
}

export const COLUNAS_MAPA_COTACAO = [
  'codigo_proposta',
  'item',
  'sequencia',
  'produto',
  'quantidade',
  'fornecedor_codigo',
  'fornecedor',
  'valor_unitario',
  'marca',
] as const;

const SEP = ';';
const MAX_MARCA = 25;

/** Início de texto que a planilha executaria como fórmula (injeção de fórmula em CSV, OWASP). */
const INICIO_FORMULA = /^[=+\-@\t\r]/;

/** A célula no CSV: aspas quando tem separador, aspas ou quebra de linha; texto com início de fórmula ganha o apóstrofo. */
function celula(v: string | number): string {
  const t = typeof v === 'string' && INICIO_FORMULA.test(v) ? `'${v}` : String(v);
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Número com vírgula decimal (a planilha brasileira); zero sai vazio (sem preço ainda). */
function decimalBr(v: number, casas: number): string {
  return v ? v.toFixed(casas).replace('.', ',') : '';
}

/** O mapa de cotação em CSV: cabeçalho fixo e uma linha por proposta, na ordem do item e do fornecedor. */
export function montarArquivoCotacao(
  itens: readonly ItemDoMapa[],
  propostas: readonly PropostaDoMapa[],
): string {
  const nome = new Map(itens.map((i) => [`${i.item}-${i.seq}`, i.nome]));
  const linhas = [...propostas]
    .filter((p) => p.fornecedor !== 0)
    .sort((a, b) => a.seq - b.seq || a.item - b.item || a.fornecedor - b.fornecedor || a.id - b.id)
    .map((p) =>
      [
        p.id,
        p.item,
        p.seq,
        nome.get(`${p.item}-${p.seq}`) ?? '',
        String(p.quantidade).replace('.', ','),
        p.fornecedor,
        p.fornecedorNome,
        decimalBr(p.valorUnitario, 4),
        p.marca,
      ]
        .map(celula)
        .join(SEP),
    );
  return [COLUNAS_MAPA_COTACAO.join(SEP), ...linhas].join('\r\n') + '\r\n';
}

/** Separa as linhas e as células do CSV (aspas com aspas dobradas e quebra de linha dentro delas). */
export function lerCsv(conteudo: string, sep = SEP): string[][] {
  const t = conteudo.replace(/^\uFEFF/, '');
  const linhas: string[][] = [];
  let linha: string[] = [];
  let cel = '';
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') {
        cel += '"';
        i++;
      } else if (c === '"') aspas = false;
      else cel += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(cel);
      cel = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(cel);
      linhas.push(linha);
      linha = [];
      cel = '';
    } else cel += c;
  }
  if (cel !== '' || linha.length) {
    linha.push(cel);
    linhas.push(linha);
  }
  return linhas;
}

/**
 * O valor da planilha: aceita "1.234,56", "1234,56" e "1234.56" (o ponto sozinho com até 4 casas é decimal). Vazio é
 * `null` (sem preço); texto que não é número é `NaN`.
 */
export function lerValorPlanilha(texto: string): number | null {
  const t = texto
    .trim()
    .replace(/^R\$\s*/i, '')
    .replace(/\s/g, '');
  if (t === '') return null;
  let normal: string;
  if (t.includes(',')) normal = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, '');
  else normal = t;
  return /^-?\d+(\.\d+)?$/.test(normal) ? Number(normal) : Number.NaN;
}

/**
 * As respostas do arquivo devolvido, conferidas contra as propostas do pedido: o código tem de ser de uma proposta
 * deste pedido, o fornecedor da linha (quando vem) tem de ser o da proposta, o valor tem de ser número de 0 a
 * 999.999.999 com até 4 casas e a marca cabe em 25 caracteres. A mesma proposta duas vezes é recusada. Sem preço é
 * pulada (o fornecedor não cotou o item). Qualquer recusa barra a importação inteira (quem importa corrige o arquivo).
 */
export function lerArquivoRespostas(
  conteudo: string,
  propostas: readonly Pick<PropostaDoMapa, 'id' | 'fornecedor'>[],
): LeituraRespostas {
  const linhas = lerCsv(conteudo).filter((l) => l.some((c) => c.trim() !== ''));
  const recusas: RecusaDeLinha[] = [];
  const respostas: RespostaDaCotacao[] = [];
  let semPreco = 0;
  const cab = (linhas[0] ?? []).map((c) => c.trim().toLowerCase());
  const col = (nome: string) => cab.indexOf(nome);
  const cCodigo = col('codigo_proposta');
  const cValor = col('valor_unitario');
  const cMarca = col('marca');
  const cForn = col('fornecedor_codigo');
  if (cCodigo < 0 || cValor < 0) {
    recusas.push({
      linha: 1,
      codigo: 'cabecalho',
      mensagem: 'O arquivo não tem as colunas codigo_proposta e valor_unitario do mapa de cotação.',
    });
    return { respostas, recusas, semPreco };
  }
  const porId = new Map(propostas.filter((p) => p.fornecedor !== 0).map((p) => [p.id, p]));
  const vistas = new Set<number>();
  linhas.slice(1).forEach((l, k) => {
    const linha = k + 2;
    const cod = (l[cCodigo] ?? '').trim();
    const id = /^\d+$/.test(cod) ? Number(cod) : Number.NaN;
    const p = porId.get(id);
    if (!p) {
      recusas.push({ linha, codigo: 'proposta-inexistente', mensagem: 'A proposta não é deste pedido.' });
      return;
    }
    if (vistas.has(id)) {
      recusas.push({ linha, codigo: 'proposta-repetida', mensagem: 'A proposta aparece mais de uma vez.' });
      return;
    }
    vistas.add(id);
    if (cForn >= 0) {
      const f = (l[cForn] ?? '').trim();
      if (f !== '' && f !== String(p.fornecedor)) {
        recusas.push({
          linha,
          codigo: 'fornecedor-diferente',
          mensagem: 'O fornecedor da linha não é o da proposta.',
        });
        return;
      }
    }
    const v = lerValorPlanilha(l[cValor] ?? '');
    if (v === null) {
      semPreco++;
      return;
    }
    if (!Number.isFinite(v) || v < 0 || v > 999_999_999 || Math.round(v * 10_000) / 10_000 !== v) {
      recusas.push({
        linha,
        codigo: 'valor-invalido',
        mensagem: 'O valor unitário tem de ser um número de 0 a 999.999.999 com até 4 casas.',
      });
      return;
    }
    const marca =
      cMarca >= 0
        ? (l[cMarca] ?? '')
            .replace(/^'(?=[=+\-@])/, '')
            .replace(/\s+/g, ' ')
            .trim()
        : undefined;
    if (marca !== undefined && marca.length > MAX_MARCA) {
      recusas.push({ linha, codigo: 'marca-longa', mensagem: 'A marca tem no máximo 25 caracteres.' });
      return;
    }
    respostas.push({ proposta: id, valorUnitario: v, ...(marca ? { marca } : {}) });
  });
  if (!recusas.length && !respostas.length)
    recusas.push({ linha: 1, codigo: 'sem-resposta', mensagem: 'O arquivo não traz nenhum preço.' });
  return { respostas, recusas, semPreco };
}

/** A recusa da importação (a primeira linha recusada, com o número dela) no vocabulário de recusas do estoque. */
export function recusaDaLeitura(l: LeituraRespostas): RecusaSuprimentos | null {
  const r = l.recusas[0];
  return r ? recusa(r.codigo, `Linha ${r.linha}: ${r.mensagem}`, ['arquivo']) : null;
}

/** O valor total das respostas lidas (parcelas: quantidade × unitário de cada uma), para conferir antes de gravar. */
export function totalDasRespostas(
  respostas: readonly RespostaDaCotacao[],
  propostas: readonly Pick<PropostaDoMapa, 'id' | 'quantidade'>[],
): { total: number; parcelas: number[] } {
  const q = new Map(propostas.map((p) => [p.id, p.quantidade]));
  const parcelas = respostas.map((r) => reais((q.get(r.proposta) ?? 0) * r.valorUnitario));
  return { total: reais(parcelas.reduce((s, v) => s + v, 0)), parcelas };
}

/** O primeiro adaptador da porta: a troca do mapa por arquivo. */
export const ADAPTADOR_ARQUIVO_COTACAO: AdaptadorPortalCotacao = {
  codigo: 'arquivo',
  tipoIntegracao: 'arquivo',
  montarEnvio: (_pedido, itens, propostas) => montarArquivoCotacao(itens, propostas),
  lerRespostas: (conteudo, propostas) => lerArquivoRespostas(conteudo, propostas),
};
