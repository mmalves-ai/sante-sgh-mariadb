// Cadastro da central de material esterilizado (CME; F7, 04-CME linha 115; RDC ANVISA 15/2012). Regras puras do
// cadastro dos produtos para saúde reprocessáveis (instrumental avulso e material), das caixas e kits com a composição
// em ordem de montagem, das fases do reprocessamento que cada produto ou caixa percorre e da foto de conferência.
// A porta reconfere no banco e nunca apaga: a peça tirada da caixa, a fase retirada e o produto descartado ficam no
// histórico com quem e quando.
//
// Base normativa usada como referência de recurso (não de fluxo):
//   - RDC 15/2012, art. 22: o produto para saúde com reprocessamento proibido ou com limite do fabricante não é
//     reprocessado além do limite (o contador nunca passa do limite);
//   - arts. 65 a 69: a limpeza precede o preparo e a esterilização (a fase que exige ciclo não vem sem uma fase de
//     limpeza ou preparo antes);
//   - art. 83: a etiqueta identifica o conteúdo, por isso a caixa tem a composição e a peça que a identifica.
import type { ProblemaCme } from './cme.js';

export const TIPOS_PRODUTO_REPROCESSAVEL = [
  'instrumental',
  'material',
  'equipamento',
  'roupa',
  'outro',
] as const;
export type TipoProdutoReprocessavel = (typeof TIPOS_PRODUTO_REPROCESSAVEL)[number];

export const SITUACOES_PRODUTO_REPROCESSAVEL = ['ativo', 'em_manutencao', 'descartado', 'inativo'] as const;
export type SituacaoProdutoReprocessavel = (typeof SITUACOES_PRODUTO_REPROCESSAVEL)[number];

export const NATUREZAS_CAIXA = ['caixa', 'kit', 'pacote_avulso'] as const;
export type NaturezaCaixa = (typeof NATUREZAS_CAIXA)[number];

/** Peças por caixa (limite do cadastro; a montagem real cabe com folga). */
export const MAXIMO_PECAS_CAIXA = 300;
/** A foto de conferência (caixa ou peça): PNG, JPEG ou WebP até 2 MB. */
export const TAMANHO_MAXIMO_FOTO_CME = 2 * 1024 * 1024;

const CODIGO_BARRAS = /^[0-9A-Za-z.\-/]{4,100}$/;

const faixa = (
  p: ProblemaCme[],
  campo: string,
  v: number | null,
  min: number,
  max: number,
  mensagem: string,
) => {
  if (v !== null && !(Number.isFinite(v) && v >= min && v <= max)) p.push({ campo, mensagem });
};

// ── Produto reprocessável ──────────────────────────────────────────────────────────────────────────────────────

export interface ProdutoReprocessavelEntrada {
  readonly descricao: string;
  readonly tipo: string;
  readonly codigoBarras: string | null;
  readonly limiteReprocessamentos: number | null;
  /** O contador gravado (0 no cadastro novo). */
  readonly contadorReprocessamentos: number;
  readonly validadeDias: number | null;
  readonly tempoMinutos: number | null;
  readonly temperaturaCelsius: number | null;
}

/** As recusas do cadastro do produto reprocessável (vazio: pode gravar). */
export function conferirProdutoReprocessavel(e: ProdutoReprocessavelEntrada): ProblemaCme[] {
  const p: ProblemaCme[] = [];
  if (!e.descricao.trim()) p.push({ campo: 'descricao', mensagem: 'Informe a descrição do produto.' });
  else if (e.descricao.trim().length > 150)
    p.push({ campo: 'descricao', mensagem: 'A descrição tem até 150 caracteres.' });
  if (!(TIPOS_PRODUTO_REPROCESSAVEL as readonly string[]).includes(e.tipo))
    p.push({ campo: 'tipo', mensagem: 'Escolha o tipo do produto.' });
  if (e.codigoBarras !== null && !CODIGO_BARRAS.test(e.codigoBarras))
    p.push({
      campo: 'codigoBarras',
      mensagem: 'O código de barras tem de 4 a 100 letras, números, ponto, hífen ou barra.',
    });
  if (e.limiteReprocessamentos !== null) {
    if (!(Number.isInteger(e.limiteReprocessamentos) && e.limiteReprocessamentos > 0))
      p.push({
        campo: 'limiteReprocessamentos',
        mensagem: 'O limite de reprocessamentos do fabricante é um número inteiro maior que zero.',
      });
    else if (e.contadorReprocessamentos > e.limiteReprocessamentos)
      p.push({
        campo: 'limiteReprocessamentos',
        mensagem: `O produto já passou por ${e.contadorReprocessamentos} reprocessamentos: o limite não fica abaixo disso.`,
      });
  }
  faixa(p, 'validadeDias', e.validadeDias, 1, 3650, 'A validade da esterilização vai de 1 a 3650 dias.');
  faixa(p, 'tempoMinutos', e.tempoMinutos, 1, 1440, 'O tempo de esterilização vai de 1 a 1440 minutos.');
  faixa(
    p,
    'temperaturaCelsius',
    e.temperaturaCelsius,
    1,
    300,
    'A temperatura de esterilização vai de 1 a 300 °C.',
  );
  return p;
}

/** A troca de situação do produto: o descartado não volta (cadastra-se outro); a mesma situação é recusada. */
export function conferirSituacaoProduto(atual: string, nova: string): ProblemaCme[] {
  if (!(SITUACOES_PRODUTO_REPROCESSAVEL as readonly string[]).includes(nova))
    return [{ campo: 'situacao', mensagem: 'Escolha a situação do produto.' }];
  if (atual === nova) return [{ campo: 'situacao', mensagem: 'O produto já está nesta situação.' }];
  if (atual === 'descartado')
    return [
      {
        campo: 'situacao',
        mensagem: 'O produto descartado não volta ao uso: cadastre um produto novo.',
      },
    ];
  return [];
}

export type AlertaLimite = 'sem_limite' | 'livre' | 'perto' | 'atingido';

/** Quanto falta para o limite do fabricante e o alerta da tela (perto: 10% finais, ao menos 1). */
export function usoDoLimite(
  contador: number,
  limite: number | null,
): { restante: number | null; alerta: AlertaLimite } {
  if (limite === null) return { restante: null, alerta: 'sem_limite' };
  const restante = Math.max(0, limite - contador);
  if (restante === 0) return { restante, alerta: 'atingido' };
  return { restante, alerta: restante <= Math.max(1, Math.ceil(limite * 0.1)) ? 'perto' : 'livre' };
}

// ── Caixa, kit e composição ───────────────────────────────────────────────────────────────────────────────────

export interface PecaComposicao {
  readonly produto: number | null;
  readonly insumo: number | null;
  readonly bem: number | null;
  readonly quantidade: number;
  readonly pecaMestre: boolean;
  readonly codigoBarras: string | null;
  readonly suspenso: boolean;
}

export interface CaixaCadastroEntrada {
  readonly codigo: string;
  readonly descricao: string;
  readonly natureza: string;
  readonly validadeDias: number | null;
  readonly controlaReprocessamentos: boolean;
  readonly limiteReprocessamentos: number | null;
  /** O contador gravado da caixa (0 na nova). */
  readonly reprocessamentos: number;
  readonly pecas: readonly PecaComposicao[];
}

/** O produto reprocessável que a composição cita (o que a porta leu do banco). */
export interface ProdutoDaComposicao {
  readonly descricao: string;
  readonly situacao: string;
}

const NOME_SITUACAO: Record<string, string> = {
  em_manutencao: 'em manutenção',
  descartado: 'descartado',
  inativo: 'inativo',
};

/** As recusas do cadastro da caixa ou do kit com a composição (vazio: pode gravar). */
export function conferirCadastroCaixa(
  c: CaixaCadastroEntrada,
  produtos: ReadonlyMap<number, ProdutoDaComposicao>,
): ProblemaCme[] {
  const p: ProblemaCme[] = [];
  if (!c.codigo.trim()) p.push({ campo: 'codigo', mensagem: 'Informe o código da caixa.' });
  else if (c.codigo.trim().length > 30)
    p.push({ campo: 'codigo', mensagem: 'O código tem até 30 caracteres.' });
  if (!c.descricao.trim()) p.push({ campo: 'descricao', mensagem: 'Informe a descrição da caixa.' });
  const natureza = c.natureza as NaturezaCaixa;
  if (!NATUREZAS_CAIXA.includes(natureza))
    p.push({ campo: 'natureza', mensagem: 'Escolha se é caixa, kit ou pacote avulso.' });
  faixa(p, 'validadeDias', c.validadeDias, 1, 3650, 'A validade da esterilização vai de 1 a 3650 dias.');
  if (c.controlaReprocessamentos) {
    if (!(c.limiteReprocessamentos !== null && c.limiteReprocessamentos > 0))
      p.push({
        campo: 'limiteReprocessamentos',
        mensagem: 'Quem controla os reprocessamentos informa o limite.',
      });
    else if (c.reprocessamentos > c.limiteReprocessamentos)
      p.push({
        campo: 'limiteReprocessamentos',
        mensagem: `A caixa já passou por ${c.reprocessamentos} reprocessamentos: o limite não fica abaixo disso.`,
      });
  }

  if (c.pecas.length > MAXIMO_PECAS_CAIXA)
    p.push({ campo: 'pecas', mensagem: `A caixa tem até ${MAXIMO_PECAS_CAIXA} peças.` });
  const emUso = c.pecas.filter((x) => !x.suspenso);
  if (emUso.length === 0)
    p.push({ campo: 'pecas', mensagem: 'A caixa precisa de ao menos uma peça em uso.' });
  if (natureza === 'pacote_avulso' && c.pecas.length > 1)
    p.push({ campo: 'pecas', mensagem: 'O pacote avulso leva uma peça só (para mais, use caixa ou kit).' });
  if (c.pecas.filter((x) => x.pecaMestre).length > 1)
    p.push({ campo: 'pecas', mensagem: 'Só uma peça identifica a caixa (peça mestre).' });

  const vistosProduto = new Set<number>();
  const vistosInsumo = new Set<number>();
  const vistosCodigo = new Set<string>();
  c.pecas.forEach((x, n) => {
    const rot = `Peça ${n + 1}`;
    const origens = [x.produto, x.insumo, x.bem].filter((v) => v !== null).length;
    if (origens !== 1)
      p.push({
        campo: `pecas.${n}`,
        mensagem: `${rot}: escolha uma origem só (produto reprocessável, item do estoque ou bem patrimonial).`,
      });
    if (!(x.quantidade > 0))
      p.push({ campo: `pecas.${n}.quantidade`, mensagem: `${rot}: a quantidade tem de ser maior que zero.` });
    if (x.produto !== null) {
      if (!Number.isInteger(x.quantidade))
        p.push({
          campo: `pecas.${n}.quantidade`,
          mensagem: `${rot}: o produto reprocessável conta em unidades inteiras.`,
        });
      const prod = produtos.get(x.produto);
      if (!prod)
        p.push({ campo: `pecas.${n}.produto`, mensagem: `${rot}: o produto reprocessável não existe aqui.` });
      else if (prod.situacao !== 'ativo' && !x.suspenso)
        p.push({
          campo: `pecas.${n}.produto`,
          mensagem: `${rot}: "${prod.descricao}" está ${NOME_SITUACAO[prod.situacao] ?? prod.situacao}; troque a peça ou marque-a como suspensa.`,
        });
      if (vistosProduto.has(x.produto))
        p.push({
          campo: `pecas.${n}.produto`,
          mensagem: `${rot}: o produto já está na caixa; some a quantidade na mesma linha.`,
        });
      vistosProduto.add(x.produto);
    }
    if (x.insumo !== null) {
      if (vistosInsumo.has(x.insumo))
        p.push({
          campo: `pecas.${n}.insumo`,
          mensagem: `${rot}: o item do estoque já está na caixa; some a quantidade na mesma linha.`,
        });
      vistosInsumo.add(x.insumo);
    }
    if (x.codigoBarras !== null) {
      if (!CODIGO_BARRAS.test(x.codigoBarras))
        p.push({
          campo: `pecas.${n}.codigoBarras`,
          mensagem: `${rot}: o código de barras tem de 4 a 100 letras, números, ponto, hífen ou barra.`,
        });
      if (vistosCodigo.has(x.codigoBarras))
        p.push({ campo: `pecas.${n}.codigoBarras`, mensagem: `${rot}: código de barras repetido na caixa.` });
      vistosCodigo.add(x.codigoBarras);
    }
  });
  return p;
}

// ── Fases do reprocessamento ──────────────────────────────────────────────────────────────────────────────────

export interface FaseDoCatalogo {
  readonly id: number;
  readonly descricao: string;
  readonly ordem: number;
  readonly ativo: boolean;
  readonly exigeCiclo: boolean;
}

export interface FaseEscolhida {
  readonly fase: number;
  readonly obrigatoria: boolean;
}

/** As fases escolhidas na ordem do fluxo da CME (a ordem do catálogo); a desconhecida vai ao fim. */
export function ordenarFases<T extends FaseEscolhida>(
  escolhidas: readonly T[],
  catalogo: readonly FaseDoCatalogo[],
): T[] {
  const ordem = new Map(catalogo.map((f) => [f.id, f.ordem]));
  return [...escolhidas].sort(
    (a, b) => (ordem.get(a.fase) ?? Number.MAX_SAFE_INTEGER) - (ordem.get(b.fase) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** As recusas das fases do produto ou da caixa (vazio: pode gravar). */
export function conferirFases(
  escolhidas: readonly FaseEscolhida[],
  catalogo: readonly FaseDoCatalogo[],
): ProblemaCme[] {
  const p: ProblemaCme[] = [];
  if (escolhidas.length === 0) {
    p.push({ campo: 'fases', mensagem: 'Escolha ao menos uma fase do reprocessamento.' });
    return p;
  }
  const porId = new Map(catalogo.map((f) => [f.id, f]));
  const vistas = new Set<number>();
  for (const e of escolhidas) {
    const f = porId.get(e.fase);
    if (!f) p.push({ campo: 'fases', mensagem: 'Uma das fases escolhidas não existe no catálogo.' });
    else if (!f.ativo) p.push({ campo: 'fases', mensagem: `A fase "${f.descricao}" está fora de uso.` });
    if (vistas.has(e.fase)) p.push({ campo: 'fases', mensagem: 'A mesma fase foi escolhida duas vezes.' });
    vistas.add(e.fase);
  }
  if (!escolhidas.some((e) => e.obrigatoria))
    p.push({ campo: 'fases', mensagem: 'Ao menos uma fase tem de ser obrigatória.' });
  const ordenadas = ordenarFases(escolhidas, catalogo)
    .map((e) => porId.get(e.fase))
    .filter((f): f is FaseDoCatalogo => !!f);
  const primeiraCiclo = ordenadas.findIndex((f) => f.exigeCiclo);
  if (primeiraCiclo === 0)
    p.push({
      campo: 'fases',
      mensagem: `A fase "${ordenadas[0]!.descricao}" exige ciclo e não vem sem a limpeza ou o preparo antes.`,
    });
  return p;
}

// ── Foto de conferência ───────────────────────────────────────────────────────────────────────────────────────

/** O tipo da imagem pela assinatura do conteúdo (nunca pela extensão do nome). */
export function tipoDaFotoCme(b: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === 'RIFF' &&
    String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** As recusas da foto (vazio: pode guardar). */
export function conferirFotoCme(b: Uint8Array): ProblemaCme[] {
  if (b.length === 0) return [{ campo: 'conteudo', mensagem: 'Escolha a imagem.' }];
  const p: ProblemaCme[] = [];
  if (b.length > TAMANHO_MAXIMO_FOTO_CME) p.push({ campo: 'conteudo', mensagem: 'A foto tem até 2 MB.' });
  if (!tipoDaFotoCme(b)) p.push({ campo: 'conteudo', mensagem: 'A foto tem de ser PNG, JPEG ou WebP.' });
  return p;
}
