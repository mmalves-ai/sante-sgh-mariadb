// Geradores sintéticos do cadastro de domínios (F2.2, lote 05-06): valores marcados, documentos válidos pelo
// dígito e código livre (puros), mais a massa do CRUD genérico de domínios, lida pela fonte própria do MariaDB
// (FonteDominiosPropria). Nada de dado de pessoa: tudo é gerado pelo algoritmo.
// Melhoria: sem sentinela "não informado" (0, ' '), sem hora em HHMM e sem chave numérica "na faixa alta" — o código
//   livre vem do conjunto de usados que o chamador leu, e a data sintética é uma data ISO válida.
// Melhoria: CPF e CNS conferidos pelo dígito na própria geração (o mesmo algoritmo da validação do cadastro).

import type { CampoDescrito, ItemDominio, ValorCampo } from '@sgh/contratos';

export const MARCA_DOMINIO = 'SGH M08';

let contador = 0;

/** Texto sintético único, marcado, que cabe em `maxCaracteres` (com acento, quando cabe). */
export function textoSintetico(maxCaracteres: number, tipo = 'TESTE'): string {
  const id = `${Date.now().toString(36).slice(-5)}${(contador++).toString(36)}`.toUpperCase();
  const completo = `${MARCA_DOMINIO} ${tipo} ÇÃO ${id}`;
  if (completo.length <= maxCaracteres) return completo;
  const curto = `M08 ${id}`;
  return curto.length <= maxCaracteres ? curto : id.slice(-Math.max(1, maxCaracteres));
}

/** O CPF completo (11 dígitos) pela base de 9 dígitos. */
export function cpfDaBase(base9: string): string {
  if (!/^\d{9}$/.test(base9)) throw new Error('A base do CPF tem 9 dígitos.');
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
export function cnsDaSemente(semente: number): string {
  for (let k = 0; k < 1000; k++) {
    const corpo = `7${String(semente * 1000 + k).padStart(14, '0')}`.slice(0, 15);
    let t = 0;
    for (let i = 0; i < 15; i++) t += Number(corpo[i]) * (15 - i);
    if (t % 11 === 0) return corpo;
  }
  throw new Error('Sem CNS sintético para a semente.');
}

/** O CNS é válido pela soma ponderada? (provisório 7, 8 ou 9; definitivo 1 ou 2 pela mesma soma). */
export function cnsValido(cns: string): boolean {
  if (!/^[12789]\d{14}$/.test(cns)) return false;
  let t = 0;
  for (let i = 0; i < 15; i++) t += Number(cns[i]) * (15 - i);
  return t % 11 === 0;
}

/**
 * Documento sintético válido pelo dígito (CPF de base 999888xxx, CNS provisório 7…), diferente do `atual` e fora dos
 * `usados` (os documentos já gravados que o chamador leu no banco do cliente de teste).
 */
export function documentoSintetico(
  tipo: 'cpf' | 'cns',
  usados: ReadonlySet<string> = new Set(),
  atual?: string | null,
): string {
  for (let k = 0; k < 1000; k++) {
    const n = contador++ % 1000;
    const doc = tipo === 'cpf' ? cpfDaBase(`999888${String(n).padStart(3, '0')}`) : cnsDaSemente(900_000 + n);
    if (doc !== (atual ?? '') && !usados.has(doc)) return doc;
  }
  throw new Error(`Sem ${tipo} sintético livre.`);
}

/**
 * Código livre de texto (maiúsculas e dígitos, como o CHECK `^[A-Z0-9_]+$` dos códigos do modelo), do fim do
 * alfabeto para o começo, fora dos `usados`.
 */
export function codigoTextoLivre(maxCaracteres: number, usados: ReadonlySet<string>, prefixo = 'Z'): string {
  if (maxCaracteres < 1) throw new Error('O código precisa de ao menos 1 caractere.');
  for (let i = 0; i < 46_656; i++) {
    const k = `${prefixo}${(46_655 - i).toString(36).toUpperCase()}`.slice(0, maxCaracteres);
    if (!usados.has(k)) return k;
  }
  throw new Error('Nenhum código de texto livre.');
}

/** Data sintética ISO (um dia de 2099), diferente da `atual`: longe de qualquer data real de operação. */
export function dataSintetica(atual?: string | null): string {
  for (let k = 0; k < 28; k++) {
    const d = `2099-12-${String(1 + (contador++ % 28)).padStart(2, '0')}`;
    if (d !== atual) return d;
  }
  return '2099-11-30';
}

// ── Massa do CRUD genérico de domínios sobre o modelo próprio (M08) ─────────────────────────────────────────────
// A declaração é a `DominioDeclarado` de apps/api/src/modulos/config/dominios-catalogo.ts (derivada dos metadados do
// MariaDB); a leitura é a `FonteDominiosPropria` (dominios-fonte.ts) com o estabelecimento da sessão. Os tipos abaixo
// são o recorte estrutural dos dois (o pacote de testes não importa a aplicação): a declaração real e a fonte real
// encaixam sem adaptação. Quem chama liga a fonte ao hospital do cliente de teste com `leitorDaFonte`.
// Melhoria: a chave é sempre o `codigo` texto (VARCHAR(30)) do modelo, livre pelo conjunto lido; a referência é o id
//   de uma opção ativa da FK (nunca uma sentinela 0); o booleano é 'sim'/'nao'; a data é ISO de 2099; sem HHMM.

/** Campo do domínio como a declaração do modelo próprio o descreve (recorte de `CampoDominio`). */
export interface CampoDaMassa extends CampoDescrito {
  readonly coluna: string;
  readonly booleano?: boolean;
  readonly tabelaReferencia?: string;
}

/** Domínio declarado (recorte de `DominioDeclarado`). */
export interface DominioDaMassa {
  readonly tabela: string;
  readonly campos: readonly CampoDaMassa[];
}

/** O que a massa lê do banco do cliente de teste (a `FonteDominios` já ligada ao hospital). */
export interface LeitorDaMassa {
  listar(d: DominioDaMassa): Promise<{ readonly itens: readonly ItemDominio[] }>;
  uso(d: DominioDaMassa, codigo: string): Promise<readonly { readonly usos: boolean }[]>;
  opcoes(d: DominioDaMassa, campo: CampoDaMassa): Promise<readonly { readonly valor: string }[]>;
}

/** Recorte da `FonteDominios` (dominios-fonte.ts) que a massa usa. */
export interface FonteDaMassa<D extends DominioDaMassa, C extends CampoDaMassa> {
  listar(hospital: string, d: D, inativos: boolean): Promise<{ readonly itens: readonly ItemDominio[] }>;
  uso(hospital: string, d: D, codigo: string): Promise<readonly { readonly usos: boolean }[]>;
  opcoes(hospital: string, d: D, campo: C): Promise<readonly { readonly valor: string }[]>;
}

/** Liga a fonte própria (ou a de memória) ao hospital do cliente de teste. Lista ativos e inativos. */
export function leitorDaFonte<D extends DominioDaMassa, C extends CampoDaMassa>(
  fonte: FonteDaMassa<D, C>,
  hospital: string,
): LeitorDaMassa {
  return {
    listar: (d) => fonte.listar(hospital, d as D, true),
    uso: (d, codigo) => fonte.uso(hospital, d as D, codigo),
    opcoes: (d, campo) => fonte.opcoes(hospital, d as D, campo as C),
  };
}

/** Todas as opções da referência já têm linha (a chave é a própria referência): o chamador inclui uma opção antes. */
export class SemOpcaoLivre extends Error {
  override readonly name = 'SemOpcaoLivre';
  constructor(
    readonly tabela: string,
    /** Tabela das opções (a FK), onde o chamador inclui um item sintético para tentar de novo. */
    readonly tabelaOpcoes: string | null,
    mensagem?: string,
  ) {
    super(mensagem ?? `${tabela}: nenhuma opção livre para a referência.`);
  }
}

const campoCodigo = (d: DominioDaMassa) => d.campos.find((c) => c.coluna === 'codigo');

/** Código livre do domínio (texto `^[A-Z0-9_]+$`, do fim do alfabeto), fora dos lidos e dos `ocupados`. */
export async function codigoLivre(
  l: LeitorDaMassa,
  d: DominioDaMassa,
  ocupados: ReadonlySet<string> = new Set(),
): Promise<string> {
  const usados = new Set([...(await l.listar(d)).itens.map((i) => i.codigo), ...ocupados]);
  return codigoTextoLivre(campoCodigo(d)?.maxBytes ?? 30, usados);
}

/** Inteiro sintético dentro da faixa do campo, diferente do atual. */
function inteiroSintetico(c: CampoDaMassa, atual?: ValorCampo): number {
  const min = Math.max(c.minimo ?? 0, 0);
  const max = Math.min(c.maximo ?? 127, min + 100);
  const alvo = Math.min(max, min + 7);
  return String(alvo) === String(atual) ? (alvo > min ? alvo - 1 : alvo + 1) : alvo;
}

/** Id de uma opção ativa da referência, diferente do atual e do próprio item. */
async function opcaoDaReferencia(
  l: LeitorDaMassa,
  d: DominioDaMassa,
  c: CampoDaMassa,
  diferenteDe?: ValorCampo,
  proprioId?: string,
): Promise<number> {
  const ops = await l.opcoes(d, c);
  const x = ops.find(
    (o) => (diferenteDe === undefined || o.valor !== String(diferenteDe)) && o.valor !== proprioId,
  );
  if (!x)
    throw new SemOpcaoLivre(
      d.tabela,
      c.tabelaReferencia ?? null,
      `${d.tabela}.${c.coluna}: sem opção ativa.`,
    );
  return Number(x.valor);
}

/** Valores de inclusão sintéticos para todos os campos pedidos na inclusão (obrigatórios e opcionais). */
export async function valoresDeInclusao(
  l: LeitorDaMassa,
  d: DominioDaMassa,
  ocupados: ReadonlySet<string> = new Set(),
): Promise<Record<string, ValorCampo>> {
  const v: Record<string, ValorCampo> = {};
  for (const c of d.campos.filter((x) => x.naInclusao)) {
    if (c.coluna === 'codigo') v[c.campo] = await codigoLivre(l, d, ocupados);
    else if (c.booleano) v[c.campo] = c.coluna === 'ativo' ? 'sim' : 'nao';
    else if (c.tipo === 'referencia') v[c.campo] = await opcaoDaReferencia(l, d, c);
    else if (c.tipo === 'texto') v[c.campo] = textoSintetico(c.maxBytes ?? 30);
    else if (c.tipo === 'letra') v[c.campo] = c.valores?.[0]?.valor ?? null;
    else if (c.tipo === 'decimal') v[c.campo] = (c.casas ?? 0) === 0 ? 1 : 1.25;
    else if (c.tipo === 'hora') v[c.campo] = '01:30';
    else if (c.tipo === 'data') v[c.campo] = dataSintetica();
    else v[c.campo] = inteiroSintetico(c);
  }
  return v;
}

/** Valores novos (diferentes dos atuais) para todos os campos editáveis. `proprioId`: o id do item (autorreferência). */
export async function valoresDeAlteracao(
  l: LeitorDaMassa,
  d: DominioDaMassa,
  atuais: Readonly<Record<string, ValorCampo>>,
  proprioId?: string,
): Promise<Record<string, ValorCampo>> {
  const v: Record<string, ValorCampo> = {};
  for (const c of d.campos.filter((x) => x.editavel && x.coluna !== 'ativo')) {
    const atual = atuais[c.campo];
    if (c.booleano) v[c.campo] = atual === 'sim' ? 'nao' : 'sim';
    else if (c.tipo === 'referencia') {
      try {
        v[c.campo] = await opcaoDaReferencia(l, d, c, atual ?? undefined, proprioId);
      } catch (e) {
        // Uma opção só, e já é a atual: o campo fica como está (a recusa só vale para a referência obrigatória vazia).
        if (!(e instanceof SemOpcaoLivre) || atual === null || atual === undefined) throw e;
      }
    } else if (c.tipo === 'texto') v[c.campo] = textoSintetico(c.maxBytes ?? 30, 'ALTERADO');
    else if (c.tipo === 'letra') {
      const outro = c.valores?.find((x) => x.valor !== atual);
      if (outro) v[c.campo] = outro.valor;
    } else if (c.tipo === 'decimal')
      v[c.campo] = (c.casas ?? 0) === 0 ? (Number(atual) === 2 ? 3 : 2) : Number(atual) === 2.5 ? 3.75 : 2.5;
    else if (c.tipo === 'hora') v[c.campo] = atual === '02:45' ? '03:15' : '02:45';
    else if (c.tipo === 'data') v[c.campo] = dataSintetica(typeof atual === 'string' ? atual : null);
    else v[c.campo] = inteiroSintetico(c, atual);
  }
  return v;
}

/** Primeiro item ativo do domínio no estabelecimento do cliente de teste, ou null. */
export async function itemAtivoOuNulo(l: LeitorDaMassa, d: DominioDaMassa): Promise<ItemDominio | null> {
  return (await l.listar(d)).itens.find((i) => i.ativo) ?? null;
}

/** Primeiro item ativo do domínio (recusa quando não há). */
export async function itemAtivo(l: LeitorDaMassa, d: DominioDaMassa): Promise<ItemDominio> {
  const item = await itemAtivoOuNulo(l, d);
  if (!item) throw new Error(`${d.tabela}: nenhum item ativo.`);
  return item;
}

/** Código do primeiro item ativo que nenhuma FK do modelo referencia (pode ser inativado sem recusa). */
export async function itemAtivoSemUso(l: LeitorDaMassa, d: DominioDaMassa): Promise<string> {
  for (const i of (await l.listar(d)).itens.filter((x) => x.ativo)) {
    if (!(await l.uso(d, i.codigo)).some((u) => u.usos)) return i.codigo;
  }
  throw new Error(`${d.tabela}: nenhum item ativo sem uso.`);
}
