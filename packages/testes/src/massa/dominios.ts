// Massa sintética do CRUD genérico (M08): valores de campo marcados "SGH M08", códigos livres na faixa alta do
// tipo (procurados de cima para baixo na própria transação desfeita; nunca MAX+1 no adaptador) e opções de
// referência já existentes. Os domínios são dados de referência (descrições), não de pessoa; ainda assim nada
// sai da memória do teste. Tudo roda em transação desfeita.
import type { ColunaDeclarada, DeclaracaoDominio, ValorCampo } from '@sgh/contratos';
import {
  chavesDe,
  codigoDosValores,
  colunaDaChave,
  declaracao,
  descricaoSentinela,
  type Leitor,
  listarDominio,
  opcoesDoCampo,
  usoDoItem,
} from '@sgh/legado';

export const MARCA_DOMINIO = 'SGH M08';

let contador = 0;
/** Texto sintético único (cabe em `maxBytes`, com acento do corpus CP1252 quando cabe). */
export function textoSintetico(maxBytes: number, tipo = 'TESTE'): string {
  const id = `${Date.now().toString(36).slice(-5)}${(contador++).toString(36)}`.toUpperCase();
  const completo = `${MARCA_DOMINIO} ${tipo} ÇÃO ${id}`;
  if (completo.length <= maxBytes) return completo;
  const curto = `M08 ${id}`;
  return curto.length <= maxBytes ? curto : id.slice(-maxBytes);
}

/** Código livre da chave manual, procurado do máximo do tipo para baixo (faixa alta, longe dos reais). */
export async function codigoLivre(
  l: Leitor,
  d: DeclaracaoDominio,
  ocupados: ReadonlySet<string> = new Set(),
): Promise<number | string> {
  const c = colunaDaChave(d);
  const usados = new Set((await listarDominio(l, d)).itens.map((i) => i.codigo));
  // M10: chave de texto digitada (bloco, clínica, unidade de consumo): "Z" + sequência, do fim do alfabeto.
  if (c.tipo === 'texto') {
    const max = c.maxBytes ?? 1;
    const candidatos =
      max === 1
        ? 'ZYXWVUSRKJIHGFEDBA987654321'.split('')
        : Array.from({ length: 2000 }, (_, i) => `Z${(46_655 - i).toString(36).toUpperCase()}`.slice(0, max));
    for (const k of candidatos) if (!usados.has(k) && !ocupados.has(k)) return k;
    throw new Error(`${d.tabela}: nenhum código de texto livre.`);
  }
  // M53 (etapa F1): chave do tipo data (vigência da tabela legal): o dia 1º de um mês livre do ano 9998, longe das reais.
  if (c.tipo === 'data') {
    for (let m = 12; m >= 1; m--) {
      const k = `9998-${String(m).padStart(2, '0')}-01`;
      if (!usados.has(k) && !ocupados.has(k)) return k;
    }
    throw new Error(`${d.tabela}: nenhuma data livre.`);
  }
  for (let n = c.maximo ?? 32767; n >= (c.minimo ?? 1); n--) {
    if (!usados.has(String(n)) && !ocupados.has(String(n))) return n;
  }
  throw new Error(`${d.tabela}: nenhum código livre.`);
}

/** Inteiro livre para um campo de código que não é a chave (ex.: COD do estado civil), entre os do mesmo conjunto único. */
async function inteiroLivre(
  l: Leitor,
  d: DeclaracaoDominio,
  c: ColunaDeclarada,
  atual?: ValorCampo,
): Promise<number> {
  const usados = new Set((await listarDominio(l, d)).itens.map((i) => String(i.valores[c.campo])));
  for (let n = c.maximo ?? 32767; n >= (c.minimo ?? 1); n--) if (!usados.has(String(n))) return n;
  // M23: inteiro de domínio pequeno (ex.: tipo 1 ou 2), todos já usados e fora de conjunto único: um valor da faixa
  // (na alteração, diferente do atual).
  const faixa = [c.maximo ?? 32767, c.minimo ?? 1];
  if (d.unico.some((u) => u.includes(c.campo)) || faixa[0]! - faixa[1]! > 20)
    throw new Error(`${d.tabela}.${c.coluna}: nenhum valor livre.`);
  return faixa.find((n) => String(n) !== String(atual)) ?? faixa[0]!;
}

async function opcao(
  l: Leitor,
  d: DeclaracaoDominio,
  c: ColunaDeclarada,
  diferenteDe?: ValorCampo,
  proprio?: string,
): Promise<number> {
  // Opção 0 é a sentinela "não informado" do legado (TBTPDIETA, TBTIPOACOMOD): a massa usa uma opção real.
  // M14: quando a tabela de opções só tem a sentinela (RETPAGEN), a massa usa a sentinela, como o legado.
  const todas = await opcoesDoCampo(l, d, c.campo, declaracao);
  const reais = todas.filter((o) => o.ativo && String(o.valor) !== '0');
  const ops = reais.length > 0 ? reais : todas.filter((o) => String(o.valor) === '0');
  // Nunca o próprio item (autorreferência: o servidor recusa, 409 referencia-invalida).
  const x = ops.find(
    (o) =>
      (diferenteDe === undefined || String(o.valor) !== String(diferenteDe)) &&
      (proprio === undefined || String(o.valor) !== proprio),
  );
  if (!x) throw new Error(`${d.tabela}.${c.coluna}: sem opção de referência.`);
  return Number(x.valor);
}

/** M24: a chave simples que é referência: a primeira opção ativa que ainda não tem linha na tabela. */
async function referenciaLivre(
  l: Leitor,
  d: DeclaracaoDominio,
  c: ColunaDeclarada,
): Promise<number | string> {
  const usados = new Set((await listarDominio(l, d)).itens.map((i) => i.codigo));
  const ops = (await opcoesDoCampo(l, d, c.campo, declaracao)).filter(
    (o) =>
      o.ativo && String(o.valor).trim() !== '' && String(o.valor) !== '0' && !usados.has(String(o.valor)),
  );
  const x = ops[0];
  if (!x) throw new SemOpcaoLivre(d.tabela, ...origemDasOpcoes(c));
  return c.tipo === 'texto' ? String(x.valor) : Number(x.valor);
}

/** M24: todas as opções da chave já têm linha (ex.: todo bloco já tem regra de vigência). */
export class SemOpcaoLivre extends Error {
  override readonly name = 'SemOpcaoLivre';
  readonly tabela: string;
  /** Tabela das opções (quando é um domínio declarado, a reprodução inclui um item nela pelo executor). */
  readonly tabelaOpcoes: string | null;
  /** M26: o domínio declarado das opções (`modulo.recurso`), quando a referência é por domínio. */
  readonly dominioOpcoes: string | null;
  constructor(
    tabela: string,
    tabelaOpcoes: string | null,
    dominioOpcoes: string | null = null,
    mensagem?: string,
  ) {
    super(mensagem ?? `${tabela}: nenhuma opção livre para a chave.`);
    this.tabela = tabela;
    this.tabelaOpcoes = tabelaOpcoes;
    this.dominioOpcoes = dominioOpcoes;
  }
}

/** A tabela ou o domínio declarado de onde vêm as opções da referência. */
function origemDasOpcoes(c: ColunaDeclarada): [string | null, string | null] {
  const r = c.referencia;
  if (!r) return [null, null];
  return ['tabela' in r ? r.tabela : null, 'dominio' in r ? r.dominio : null];
}

/** M24: opção de uma referência de código em texto (unidade, via), diferente da atual na alteração. */
async function opcaoTexto(
  l: Leitor,
  d: DeclaracaoDominio,
  c: ColunaDeclarada,
  diferenteDe?: ValorCampo,
): Promise<string> {
  const ops = (await opcoesDoCampo(l, d, c.campo, declaracao)).filter(
    (o) => o.ativo && String(o.valor).trim() !== '' && String(o.valor).length <= (c.maxBytes ?? 1),
  );
  const x = ops.find((o) => diferenteDe === undefined || String(o.valor) !== String(diferenteDe));
  if (!x) throw new Error(`${d.tabela}.${c.coluna}: sem opção de referência.`);
  return String(x.valor);
}

/**
 * M14: chave composta livre. As partes que são referência usam itens existentes (a FK do legado recusa o
 * resto); as digitadas, valores altos do tipo (texto "Z…"); a combinação é conferida na lista lida.
 */
async function chaveCompostaLivre(l: Leitor, d: DeclaracaoDominio): Promise<Record<string, ValorCampo>> {
  const cols = chavesDe(d).map((k) => d.colunas.find((c) => c.coluna === k)!);
  const usados = new Set((await listarDominio(l, d)).itens.map((i) => i.codigo));
  const candidatos: ValorCampo[][] = [];
  for (const c of cols) {
    if (c.tipo === 'referencia') {
      const ops = (await opcoesDoCampo(l, d, c.campo, declaracao)).filter(
        (o) => o.ativo && String(o.valor) !== '0',
      );
      candidatos.push(ops.slice(0, 40).map((o) => Number(o.valor)));
    } else if (c.tipo === 'letra' && c.valores?.length) {
      // M18: letra na chave composta (dia da semana, tipo de exame): só os valores vistos.
      candidatos.push(c.valores.map((x) => x.valor));
    } else if (c.tipo === 'texto' && c.referencia) {
      // M24: código em texto de outro cadastro na chave (via do item não padronizado): opções reais.
      const ops = (await opcoesDoCampo(l, d, c.campo, declaracao)).filter(
        (o) => o.ativo && String(o.valor).trim() !== '',
      );
      candidatos.push(ops.slice(0, 40).map((o) => String(o.valor)));
    } else if (c.tipo === 'texto') {
      const max = c.maxBytes ?? 1;
      candidatos.push(
        Array.from({ length: 20 }, (_, i) => `Z${(1295 - i).toString(36).toUpperCase()}`.slice(0, max)),
      );
    } else {
      const max = c.maximo ?? 32767;
      candidatos.push(Array.from({ length: 20 }, (_, i) => max - i));
    }
  }
  // Busca a primeira combinação livre (produto cartesiano, poucas dezenas).
  const atual: ValorCampo[] = [];
  const buscar = (i: number): ValorCampo[] | null => {
    if (i === cols.length) {
      const v = Object.fromEntries(cols.map((c, k) => [c.campo, atual[k] ?? null]));
      return usados.has(codigoDosValores(d, v)) ? null : [...atual];
    }
    for (const x of candidatos[i] ?? []) {
      atual[i] = x;
      const r = buscar(i + 1);
      if (r) return r;
    }
    return null;
  };
  const achado = buscar(0);
  if (!achado) {
    // M26: toda combinação já existe (um perfil só, com todas as modalidades): a reprodução inclui um item no cadastro
    // da primeira referência da chave pelo executor e busca de novo.
    const ref = cols.find((c) => c.tipo === 'referencia');
    const [tabelaOpcoes, dominioOpcoes] = ref ? origemDasOpcoes(ref) : [null, null];
    throw new SemOpcaoLivre(
      d.tabela,
      tabelaOpcoes,
      dominioOpcoes,
      `${d.tabela}: nenhuma combinação de chave livre.`,
    );
  }
  return Object.fromEntries(cols.map((c, k) => [c.campo, achado[k] ?? null]));
}

/** Dígitos do CPF pela base de 9 dígitos. */
function cpfDaBase(base9: string): string {
  const dv = (b: string) => {
    let t = 0;
    for (let i = 0; i < b.length; i++) t += Number(b[i]) * (b.length + 1 - i);
    const r = (t * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base9);
  return `${base9}${d1}${dv(`${base9}${d1}`)}`;
}

/** CNS provisório sintético (começa em 7; soma ponderada de 15 a 1 múltipla de 11). */
function cnsDaSemente(semente: number): string {
  for (let k = 0; k < 1000; k++) {
    const corpo = `7${String(semente * 1000 + k).padStart(14, '0')}`;
    let t = 0;
    for (let i = 0; i < 15; i++) t += Number(corpo[i]) * (15 - i);
    if (t % 11 === 0) return corpo;
  }
  throw new Error('sem CNS sintético');
}

/**
 * M51: documento sintético válido pelo dígito (CPF de base 99988877x, CNS provisório 7…), diferente do atual; o CPF que é
 * a chave sai livre entre os itens da tabela. Nada disso é de pessoa: é gerado pelo algoritmo, na transação desfeita.
 */
async function documentoSintetico(
  l: Leitor,
  d: DeclaracaoDominio,
  c: ColunaDeclarada,
  atual?: ValorCampo,
): Promise<number> {
  const usados = new Set(
    c.coluna === d.chave ? (await listarDominio(l, d)).itens.map((i) => String(i.codigo)) : [],
  );
  for (let k = 0; k < 500; k++) {
    const n = contador++ % 1000;
    const doc =
      c.documento === 'cpf' ? cpfDaBase(`999888${String(n).padStart(3, '0')}`) : cnsDaSemente(900_000 + n);
    const valor = Number(doc);
    if (String(valor) !== String(atual ?? '') && !usados.has(String(valor))) return valor;
  }
  throw new Error(`${d.tabela}.${c.coluna}: sem documento sintético livre.`);
}

/** Valores sintéticos de todos os campos da inclusão. */
export async function valoresDeInclusao(
  l: Leitor,
  d: DeclaracaoDominio,
): Promise<Record<string, ValorCampo>> {
  const v: Record<string, ValorCampo> = d.chaveComposta ? await chaveCompostaLivre(l, d) : {};
  for (const c of d.colunas.filter((x) => x.naInclusao)) {
    if (d.chaveComposta && d.chaveComposta.includes(c.coluna)) continue;
    // M24: chave que aponta para outro cadastro (bloco, unidade da regra de vigência): uma opção real ainda sem linha.
    if (c.coluna === d.chave && c.referencia) v[c.campo] = await referenciaLivre(l, d, c);
    // M51: documento (CPF, CNS) conferido pelo dígito: um sintético válido (CPF livre na tabela, quando é a chave).
    else if (c.documento) v[c.campo] = await documentoSintetico(l, d, c);
    else if (c.coluna === d.chave) v[c.campo] = await codigoLivre(l, d);
    // M25: decimal sem casas (DOUBLE inteiro, a idade dos procedimentos de enfermagem): um inteiro.
    else if (c.tipo === 'decimal') v[c.campo] = c.casas === 0 ? 1 : 1.25;
    else if (c.tipo === 'texto' && (c.formatoTexto === 'HHMM' || c.formatoTexto === 'digitos'))
      v[c.campo] = '0915';
    // M24: código em texto de outro cadastro (unidade, via): uma opção real (a FK do legado confere).
    else if (c.tipo === 'texto' && c.referencia) v[c.campo] = await opcaoTexto(l, d, c);
    else if (c.tipo === 'texto') v[c.campo] = textoSintetico(c.maxBytes ?? 10);
    else if (c.tipo === 'letra') v[c.campo] = c.valores?.[0]?.valor ?? null;
    else if (c.tipo === 'hora') v[c.campo] = '01:30';
    // M10: data civil sintética (ano 9999: o feriado recorrente, como o legado grava).
    else if (c.tipo === 'data') v[c.campo] = `9999-12-${String(1 + (contador++ % 28)).padStart(2, '0')}`;
    else if (c.tipo === 'referencia') v[c.campo] = await opcao(l, d, c);
    else v[c.campo] = await inteiroLivre(l, d, c);
  }
  // W1-04: o texto longo obrigatório na inclusão (TBRECEPCAO.TEXTOIMP) leva um texto sintético curto, com acento CP1252.
  for (const t of (d.textosLongos ?? []).filter((x) => x.editavel && x.obrigatorio))
    v[t.campo] = `Texto sintético de ${t.rotulo.toLowerCase()}: ação\r\nsegunda linha`;
  await conjuntoUnicoLivre(l, d, v);
  return v;
}

/**
 * M14: conjunto único sem texto (índice único do catálogo sobre referências, ex.: princípio × unidade): a massa
 * troca a última referência do conjunto até a combinação ficar livre entre os itens existentes.
 */
async function conjuntoUnicoLivre(
  l: Leitor,
  d: DeclaracaoDominio,
  v: Record<string, ValorCampo>,
): Promise<void> {
  for (const conjunto of d.unico) {
    const cols = conjunto.map((campo) => d.colunas.find((c) => c.campo === campo));
    if (cols.some((c) => !c || c.tipo === 'texto') || conjunto.length === 0) continue;
    const itens = (await listarDominio(l, d)).itens;
    const chave = (x: Readonly<Record<string, ValorCampo>>) =>
      conjunto.map((c) => String(x[c] ?? '')).join('\u0001');
    const usados = new Set(itens.map((i) => chave(i.valores)));
    if (!usados.has(chave(v))) continue;
    const ultima = [...cols].reverse().find((c) => c?.tipo === 'referencia');
    if (!ultima) continue;
    const ops = (await opcoesDoCampo(l, d, ultima.campo, declaracao)).filter((o) => o.ativo);
    const livre = ops.find((o) => !usados.has(chave({ ...v, [ultima.campo]: Number(o.valor) })));
    if (!livre) throw new Error(`${d.tabela}: nenhuma combinação livre no conjunto único.`);
    v[ultima.campo] = Number(livre.valor);
  }
}

/** Valores novos (diferentes dos atuais) para todos os campos editáveis. */
export async function valoresDeAlteracao(
  l: Leitor,
  d: DeclaracaoDominio,
  atuais: Readonly<Record<string, ValorCampo>>,
  proprio?: string,
): Promise<Record<string, ValorCampo>> {
  const v: Record<string, ValorCampo> = {};
  for (const c of d.colunas.filter((x) => x.editavel)) {
    // M54.1: os algarismos da ordem usam os mesmos 4 dígitos da hora (o perfil do pc os vê como HHMM).
    if (c.tipo === 'texto' && (c.formatoTexto === 'HHMM' || c.formatoTexto === 'digitos'))
      v[c.campo] = atuais[c.campo] === '1035' ? '1040' : '1035';
    else if (c.tipo === 'texto' && c.referencia) v[c.campo] = await opcaoTexto(l, d, c, atuais[c.campo]);
    else if (c.tipo === 'texto') v[c.campo] = textoSintetico(c.maxBytes ?? 10, 'ALTERADO');
    else if (c.documento) v[c.campo] = await documentoSintetico(l, d, c, atuais[c.campo]);
    else if (c.tipo === 'decimal' && c.casas === 0) v[c.campo] = Number(atuais[c.campo] ?? 0) === 2 ? 3 : 2;
    else if (c.tipo === 'decimal') v[c.campo] = Number(atuais[c.campo] ?? 0) === 2.5 ? 3.75 : 2.5;
    else if (c.tipo === 'hora') v[c.campo] = atuais[c.campo] === '02:45' ? '03:15' : '02:45';
    // M24: data civil editável (vigência do protocolo): outro dia sintético do ano 9999.
    else if (c.tipo === 'data') v[c.campo] = atuais[c.campo] === '9999-12-20' ? '9999-12-21' : '9999-12-20';
    else if (c.tipo === 'referencia') v[c.campo] = await opcao(l, d, c, atuais[c.campo], proprio);
    else if (c.tipo === 'letra') {
      const outro = c.valores?.find((x) => x.valor !== atuais[c.campo]);
      // M14: letra com um só valor visto (regra 3) e já com ele: o campo fica como está.
      if (!outro) {
        if (d.colunas.filter((x) => x.editavel).length === 1)
          throw new Error(`${d.tabela}.${c.coluna}: sem outro valor visto.`);
        continue;
      }
      v[c.campo] = outro.valor;
    } else v[c.campo] = await inteiroLivre(l, d, c, atuais[c.campo]);
  }
  // W1-04: o conjunto único só de referências todas editáveis (um painel de chamada por local) vai a uma combinação livre.
  if (d.unico.some((u) => u.length > 0 && u.every((campo) => campo in v))) await conjuntoUnicoLivre(l, d, v);
  return v;
}

/** Primeiro item ativo da tabela (referência real, só em memória, na transação desfeita). */
export async function itemAtivo(l: Leitor, d: DeclaracaoDominio) {
  const item = await itemAtivoOuNulo(l, d);
  if (!item) throw new Error(`${d.tabela}: nenhum item ativo.`);
  return item;
}

/**
 * M14: o item ativo de verdade (fora da faixa da chave e da sentinela "não informado" — regra 10: a linha 0 do
 * legado nunca é alterada), ou null quando a tabela só tem a sentinela.
 */
export async function itemAtivoOuNulo(l: Leitor, d: DeclaracaoDominio) {
  // Código dentro da faixa da declaração (o legado tem itens antigos fora do CHECK atual, ex.: escolaridade
  // 0, e o próprio legado recusa alterá-los: o CHECK vale de novo no UPDATE).
  const c = colunaDaChave(d);
  const naFaixa = (codigo: string) =>
    d.chaveComposta !== undefined ||
    c.tipo !== 'inteiro' ||
    (Number(codigo) >= (c.minimo ?? 1) && Number(codigo) <= (c.maximo ?? 32767));
  // M11: nunca um item de sistema que o legado protege na alteração (ex.: TBCONSPROF 1 a 12).
  const protegido = (codigo: string) => d.protegidasNaAlteracao?.codigos.includes(Number(codigo)) ?? false;
  return (
    (await listarDominio(l, d)).itens.find(
      (i) =>
        i.ativo && naFaixa(i.codigo) && !protegido(i.codigo) && !descricaoSentinela(i.valores[d.descricao]),
    ) ?? null
  );
}

/** M11: item ativo existente que nenhuma FK usa (domínio sem inclusão: a inativação reproduz sobre ele). */
export async function itemAtivoSemUso(l: Leitor, d: DeclaracaoDominio): Promise<string> {
  for (const i of (await listarDominio(l, d)).itens.filter((x) => x.ativo)) {
    const usos = await usoDoItem(l, d, i.codigo);
    if (!usos.some((u) => u.usos)) return i.codigo;
  }
  throw new Error(`${d.tabela}: nenhum item ativo sem uso.`);
}
