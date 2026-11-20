// Receita genérica de gravação do CRUD genérico (ficha do M08, seção 5; cap-10 §10.2): cada declaração
// editável gera até três operações do protocolo, registradas no catálogo, cada uma com o seu teste de
// assinatura:
//   <modulo>.incluir<Recurso>  1 SELECT (sem trava) da tabela: duplicidade de código e descrição entre
//                              ativos; 2 INSERT: chave vazia quando o trigger BI gera por GEN_ID (o trigger
//                              gera; nunca MAX+1) ou digitada (código manual); campos da tela = entrada;
//                              situação = a letra de ativo; demais pelo perfil (constante ou vazio).
//   <modulo>.alterar<Recurso>  1 SELECT … WITH LOCK pela chave; 2 UPDATE só das colunas editáveis
//                              (nunca a chave: o *_BU do legado recusa mudar chave, e_geral_valor_chave).
//   <modulo>.inativar<Recurso> 1 SELECT … WITH LOCK; 2 UPDATE da coluna de situação para a letra de inativo
//                              (só onde o legado tem a coluna e a letra tem evidência).
//   <modulo>.reativar<Recurso> W0-02: 1 SELECT … WITH LOCK; 2 UPDATE da coluna de situação para a letra de ativo (como o
//                              cadastro anterior grava), com motivo; motivo e valor anterior na SGH_CRUD_EVENTO.
//   <modulo>.excluir<Recurso>  W0-02: só no domínio que declara `excluir` (nunca em regra de apoio à decisão nem em
//                              formulário): 1 SELECT … WITH LOCK; verificador de dependências (FKs do catálogo + mapa
//                              de referências lógicas; D-CRUD-ORFAOS): havendo dependente, 409 com quantos e quais e a
//                              oferta de inativar; 2 retrato da linha inteira (D-CRUD-SNAP, categoria protegida) e
//                              DELETE pela chave; recontagem das referências lógicas antes do COMMIT; o gatilho do
//                              legado que recusa (exceção) chega com a mensagem do catálogo e tudo é desfeito.
// Revisão do W0-02: a alteração e a inativação também gravam o evento (motivo e valor anterior, com o texto longo
// anterior) na SGH_CRUD_EVENTO; a exclusão recusa item de sistema e a sentinela (como a inativação), retrata as filhas
// próprias em CASCADE e, no domínio que inativa só no novo, apaga a marca da SGH_CFG_DOMINIO_SITUACAO na mesma transação
// (a inclusão de chave digitada também limpa marca que tenha ficado de uma exclusão feita por fora).
// O que o novo NÃO faz: gerar ID por MAX(ID)+1; gravar o que o trigger grava; excluir item com vínculo.
// Condição no estado relido: versão (colunas mostradas) igual à lida, senão 409 conflito-versao; código e
// descrição únicos entre ativos (409 duplicado); referência a outro domínio declarado aponta para item
// existente e ativo, e nunca para o próprio item (409 referencia-invalida; a tela só filtra, o servidor
// confere); para inativar, uso pelas FKs (aviso "em uso") e item de sistema protegido (409).
// Prova pós-escrita: relê a linha; no incluir, confere a chave gerada e as colunas gravadas.
import {
  camposMudados,
  CATEGORIAS_PROTEGIDAS,
  CATEGORIAS_SEM_EXCLUSAO,
  type ColunaDeclarada,
  type DeclaracaoDominio,
  lerVersao,
  mensagemDuplicidade,
  operacaoDoDominio,
  procurarDuplicidade,
  type ValorCampo,
  versaoDoItem,
} from '@sgh/contratos';
import { lerBlobTexto, prepararBlobTexto } from '../codec.js';
import type { Linha } from '../driver.js';
import type { Escritor } from '../transacao.js';
import { GDS_EXCECAO, gdscodeDe } from '../erros.js';
import { erroConflitoVersao, exigirEfeito, recusa, restricaoUnicaViolada } from '../erros-operacao.js';
import { inserirPelaReceita } from '../gravador.js';
import { inativacaoSoNoNovo, lerInativosSoNoNovo } from '../../config/repositorios/dominio-situacao.js';
import {
  type ColunaReceita,
  definirOperacao,
  type Operacao,
  type PassoReceita,
  type Receita,
  type TxOperacao,
} from '../operacao.js';
import {
  chaveComoObjeto,
  chavesDe,
  colunaDaChave,
  colunasLidas,
  codigoDosValores,
  condicaoDaChave,
  esquemaAlteracao,
  esquemaExclusao,
  esquemaInativacao,
  esquemaInclusao,
  esquemaReativacao,
  textosEditaveis,
  itemDaLinha,
  ordemDaChave,
  valoresDaChave,
  valorParaColuna,
} from '../crud/declaracao.js';
import {
  chavePrimaria,
  type DependenteContado,
  fksProprias,
  frasesDosDependentes,
  mapaDoDominio,
  type RotuloDaTabela,
  verificarDependencias,
} from '../crud/dependencias.js';
import {
  gravarEventoCrud,
  gravarRetrato,
  type RetratoLinha,
  retratarFilhas,
  retratarLinha,
} from './retrato.js';

/** Teto da leitura da tabela inteira (os domínios têm de 3 a 18 linhas; ficha, seção 4). */
export const TETO_TABELA_DOMINIO = 501;

/** M14: teto da leitura da tabela do domínio (declaração maior: itens de kit, exames). */
export function tetoDoDominio(d: DeclaracaoDominio): number {
  return Math.max(TETO_TABELA_DOMINIO, d.tetoLeitura ?? 0);
}

/**
 * M14: o código na carga do evento da outbox (só letras, dígitos e `._:-`): a chave composta troca `|` por `:` e
 * o resto que não cabe por `_` (o código exposto continua na trilha e no resultado).
 */
export function codigoDoEvento(codigo: string): string {
  return (
    codigo
      .replace(/\|/g, ':')
      .replace(/[^A-Za-z0-9._:-]/g, '_')
      .slice(0, 64) || '_'
  );
}

/** Descrição "não informado" (regra 10 do M14): sentinela do legado, nunca inativada nem escolhida. */
export function descricaoSentinela(texto: unknown): boolean {
  if (typeof texto !== 'string') return false;
  const t = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  return /^(?:nao informad[oa]|nao se aplica|nenhum|nenhuma|sem informacao|ignorado)$/.test(t);
}

export type EntradaInclusao = Record<string, ValorCampo>;
export interface EntradaAlteracao {
  readonly codigo: string;
  readonly versao: string;
  readonly valores: Record<string, ValorCampo>;
}
export interface EntradaInativacao {
  readonly codigo: string;
  readonly versao: string;
  readonly confirmarEmUso?: boolean;
  /** Revisão do W0-02: o motivo (a API e a tela exigem; vai ao registro do evento). */
  readonly motivo?: string;
}
/** M14: `alvoLegado` (quando há) é o identificador da linha na trilha do legado (SITABPRO.ID, não a chave). */
export interface SaidaDominio {
  readonly codigo: string;
  readonly [k: string]: string;
}

const recursoMaiusculo = (d: DeclaracaoDominio) =>
  `${d.publico.recurso.charAt(0).toUpperCase()}${d.publico.recurso.slice(1)}`;

/** Classe da coluna na inclusão: a declarada (domínio/constante do perfil), generator, constante ou entrada. */
function classeInclusao(d: DeclaracaoDominio, c: ColunaDeclarada): string {
  if (c.coluna === d.chave && c.codigo === 'generator') return 'generator';
  if (c.classe) return c.classe;
  if (c.constanteNaInclusao !== undefined) return `constante:${String(c.constanteNaInclusao)}`;
  return 'entrada';
}

function passoInclusao(d: DeclaracaoDominio): PassoReceita {
  const colunas: Record<string, ColunaReceita> = {};
  for (const c of d.colunas) {
    if (c.coluna === d.chave && c.codigo === 'generator') {
      // M14: o trigger que só gera quando a chave vem 0 (sem tratar NULL) recebe 0, como o Delphi manda.
      colunas[c.coluna] =
        c.constanteNaInclusao !== undefined
          ? {
              classe: 'generator',
              origem: `${String(c.constanteNaInclusao)}; ${d.triggers[0]?.nome ?? 'trigger BI'} gera por GEN_ID quando vem 0`,
              valor: { de: 'constante', valor: c.constanteNaInclusao },
            }
          : { classe: 'generator', origem: `vazio; ${d.triggers[0]?.nome ?? 'trigger BI'} gera por GEN_ID` };
      continue;
    }
    if (c.naInclusao) {
      colunas[c.coluna] = {
        classe: classeInclusao(d, c),
        origem: `entrada: ${c.campo}${c.padraoNaInclusao !== undefined ? ` (vazio: DEFAULT ${String(c.padraoNaInclusao)})` : ''}`,
        valor: { de: 'entrada', campo: c.campo, seAusente: c.padraoNaInclusao ?? null },
      };
    } else if (c.constanteNaInclusao !== undefined) {
      colunas[c.coluna] = {
        classe: classeInclusao(d, c),
        origem: 'constante do perfil',
        valor: { de: 'constante', valor: c.constanteNaInclusao },
      };
    } else {
      colunas[c.coluna] = { classe: 'vazio', origem: 'o legado deixa vazio na inclusão (perfil)' };
    }
  }
  // Revisão do W0-02 (D-CRUD-30): o texto longo editável também na inclusão (BLOB de texto; vazio: NULL).
  for (const t of textosEditaveis(d))
    if (!colunas[t.coluna])
      colunas[t.coluna] = {
        classe: 'entrada',
        origem: `entrada: ${t.campo} (texto longo: BLOB sub_type 1, CP1252/WIN1252, em segmentos; vazio: NULL)`,
        valor: { de: 'entrada', campo: t.campo, seAusente: null },
      };
  // W1-04 (D-W104-8): o leiaute que a inclusão grava (não editável): os bytes do modelo, gerados na transação.
  for (const t of textosComPadrao(d))
    if (!colunas[t.coluna])
      colunas[t.coluna] = {
        classe: 'entrada',
        origem: `leiaute padrão: ${t.padraoNaInclusao.origem} (BLOB sub_type 1, bytes do modelo)`,
        valor: { de: 'entrada', campo: t.campo, seAusente: null },
      };
  if (d.situacao && !colunas[d.situacao.coluna]) {
    colunas[d.situacao.coluna] = {
      classe: `constante:${d.situacao.ativo}`,
      origem: `letra de ativo (${d.situacao.evidencia})`,
      valor: { de: 'constante', valor: d.situacao.ativo },
    };
  }
  const chave = colunaDaChave(d);
  return {
    ordem: 1,
    tabela: d.tabela,
    acao: 'INSERT',
    colunas,
    ...(chave.codigo === 'generator' ? { retorna: [d.chave] } : {}),
  };
}

const efeitosNenhum: Receita['efeitos'] = [];

/** M14: efeitos dos triggers que a ação do verbo dispara (INSERT na inclusão; UPDATE na alteração e inativação). */
function efeitosDoVerbo(d: DeclaracaoDominio, verbo: 'incluir' | 'alterar' | 'inativar'): Receita['efeitos'] {
  const acao = verbo === 'incluir' ? 'INSERT' : 'UPDATE';
  const r = (d.efeitosTrigger ?? [])
    .filter((e) => e.quando.includes(acao))
    .map((e) => ({ trigger: e.trigger, tabela: e.tabela, acao: e.acao, faz: e.faz }));
  return r.length ? r : efeitosNenhum;
}

/** M20: as regras da referência das tabelas dos efeitos que o verbo dispara (classe medida de colunas do efeito). */
function regrasDosEfeitos(
  d: DeclaracaoDominio,
  verbo: 'incluir' | 'alterar' | 'inativar',
): Record<string, Record<string, { classe: string; motivo: string }>> | undefined {
  const acao = verbo === 'incluir' ? 'INSERT' : 'UPDATE';
  const r: Record<string, Record<string, { classe: string; motivo: string }>> = {};
  for (const e of d.efeitosTrigger ?? [])
    if (e.regras && e.quando.includes(acao))
      r[e.tabela] = {
        ...r[e.tabela],
        ...Object.fromEntries(Object.entries(e.regras).map(([k, v]) => [k, { ...v }])),
      };
  return Object.keys(r).length ? r : undefined;
}

/** W1-05: os efeitos DELETE medidos (com `linhas`) que o cenário da exclusão espera. */
function efeitosDaExclusao(d: DeclaracaoDominio): { efeitos?: Readonly<Record<string, number>> } {
  const r = (d.efeitosTrigger ?? []).filter((e) => e.quando.includes('DELETE') && e.linhas !== undefined);
  return r.length
    ? { efeitos: Object.fromEntries(r.map((e) => [`${e.tabela}:${e.acao}`, e.linhas ?? 1])) }
    : {};
}

/** M20: os efeitos medidos (com `linhas`) que o cenário de assinatura do verbo espera. */
function efeitosDoCenarioGenerico(
  d: DeclaracaoDominio,
  verbo: 'incluir' | 'alterar' | 'inativar',
): { efeitos?: Readonly<Record<string, number>> } {
  const acao = verbo === 'incluir' ? 'INSERT' : 'UPDATE';
  const r = (d.efeitosTrigger ?? []).filter((e) => e.quando.includes(acao) && e.linhas !== undefined);
  return r.length
    ? { efeitos: Object.fromEntries(r.map((e) => [`${e.tabela}:${e.acao}`, e.linhas ?? 1])) }
    : {};
}

/**
 * M53.2: o carimbo que o gatilho da própria tabela grava na alteração (`carimbosNaAlteracao`) entra na referência do
 * cenário principal, com a regra da declaração (`referenciaPerfil`; sem ela, `carimbo-banco`).
 */
function carimbosDaAlteracao(d: DeclaracaoDominio): {
  referencia?: { classes: Record<string, Record<string, { classe: string; motivo: string }>> };
} {
  const cols = d.carimbosNaAlteracao ?? [];
  if (cols.length === 0) return {};
  return {
    referencia: {
      classes: {
        [d.tabela]: Object.fromEntries(
          cols.map((c) => [
            c,
            d.referenciaPerfil?.[c]
              ? { ...d.referenciaPerfil[c] }
              : {
                  classe: 'carimbo-banco',
                  motivo: 'o gatilho da própria tabela carimba a coluna na alteração',
                },
          ]),
        ),
      },
    },
  };
}

/** M14 (POL-3): o que falta provar para o verbo (a receita sai completa e desligada). */
function pendenteDe(d: DeclaracaoDominio, verbo: 'incluir' | 'alterar' | 'inativar'): string | undefined {
  const p = d.pendenteDeProva;
  return p && p.verbos.includes(verbo) ? p.motivo : undefined;
}

function receitaBase(
  d: DeclaracaoDominio,
  verbo: 'incluir' | 'alterar' | 'inativar',
): Omit<Receita, 'passos' | 'cenarios' | 'condicao' | 'prova' | 'concorrencia' | 'descricao' | 'evento'> {
  return {
    nome: operacaoDoDominio(d.publico, verbo),
    modulo: d.publico.modulo,
    grupo: d.grupo,
    marco: d.publico.marco,
    origem: 'perfil-passivo',
    arquivoOrigem: null,
    efeitos: efeitosDoVerbo(d, verbo),
    naoFaz: [
      ...(colunaDaChave(d).codigo === 'generator'
        ? [
            `${d.chave} (${d.triggers.find((t) => /GEN_|generator/i.test(t.faz))?.nome ?? 'trigger BI'}, por GEN_ID; nunca MAX+1)`,
          ]
        : []),
      d.publico.acoes.includes('excluir')
        ? 'não exclui fisicamente (a exclusão é a operação própria, só do item sem dependentes)'
        : 'não exclui fisicamente (inativa onde o legado tem a coluna de situação)',
      'não grava o que os triggers gravam',
      ...(pendenteDe(d, verbo) ? [`ainda não grava: ${pendenteDe(d, verbo)}`] : []),
    ],
    ...(pendenteDe(d, verbo) ? { pendente: pendenteDe(d, verbo)! } : {}),
    recurso: `${d.publico.modulo}.${d.publico.recurso}`,
    ...(d.referenciaPerfil || regrasDosEfeitos(d, verbo)
      ? {
          referencia: {
            classes: {
              ...regrasDosEfeitos(d, verbo),
              ...(d.referenciaPerfil
                ? {
                    [d.tabela]: Object.fromEntries(
                      Object.entries(d.referenciaPerfil).map(([k, v]) => [k, { ...v }]),
                    ),
                  }
                : {}),
            },
          },
        }
      : {}),
  };
}

async function lerTabela(tx: TxOperacao, d: DeclaracaoDominio): Promise<Linha[]> {
  const linhas = await tx.consultar(
    `SELECT ${colunasLidas(d).join(', ')} FROM ${d.tabela} ORDER BY ${ordemDaChave(d)}`,
    [],
    { teto: tetoDoDominio(d) },
  );
  return linhas;
}

function rotulos(d: DeclaracaoDominio): Record<string, string> {
  return Object.fromEntries(d.colunas.map((c) => [c.campo, c.rotulo]));
}

async function conferirDuplicidade(
  tx: TxOperacao,
  d: DeclaracaoDominio,
  valores: Readonly<Record<string, ValorCampo>>,
  ignorar: string | null,
): Promise<void> {
  const itens = (await lerTabela(tx, d)).map((l) => itemDaLinha(d, l));
  const dup = procurarDuplicidade(itens, valores, d.unico, ignorar);
  if (dup) throw recusa('duplicado', mensagemDuplicidade(dup, rotulos(d)), { campos: dup.campos });
}

/** Declaração pelo recurso (`<modulo>.<recurso>`): o registro passa o resolvedor (sem import circular). */
export type ResolverDominio = (id: string) => DeclaracaoDominio | undefined;

/**
 * Referências a domínio declarado: item existente e ativo, diferente do próprio item. Referência a tabela
 * de opções que não é domínio declarado fica com a FK do legado.
 */
async function conferirReferencias(
  tx: TxOperacao,
  d: DeclaracaoDominio,
  valores: Readonly<Record<string, ValorCampo>>,
  proprio: string | null,
  resolver: ResolverDominio,
): Promise<void> {
  for (const c of d.colunas) {
    const ref = c.referencia;
    if (!ref || !('dominio' in ref) || !(c.campo in valores)) continue;
    const v = valores[c.campo];
    if (v === null || v === undefined || v === '') continue;
    const alvo = resolver(ref.dominio);
    if (!alvo) continue;
    if (alvo.tabela === d.tabela && proprio !== null && String(v) === proprio)
      throw recusa('referencia-invalida', `${c.rotulo}: não pode apontar para o próprio item.`, {
        campos: [c.campo],
      });
    const l = await relerPelaChave(tx, alvo, String(v));
    if (!l || !itemDaLinha(alvo, l).ativo)
      throw recusa('referencia-invalida', `${c.rotulo}: escolha um item existente e ativo.`, {
        campos: [c.campo],
      });
  }
}

/** Relê a linha pela chave (na transação da operação). */
async function relerPelaChave(tx: TxOperacao, d: DeclaracaoDominio, codigo: string): Promise<Linha | null> {
  return tx.uma(
    `SELECT ${colunasLidas(d).join(', ')} FROM ${d.tabela} WHERE ${condicaoDaChave(d)}`,
    valoresDaChave(d, codigo),
  );
}

function conferirVersao(
  d: DeclaracaoDominio,
  relido: Linha | null,
  versao: string,
  /** Revisão do W0-02: o item está inativo só no novo (a tela calcula a versão com a situação do novo). */
  inativoNoNovo = false,
): void {
  if (!relido) return;
  const lida = lerVersao(versao);
  if (!lida)
    throw recusa('versao-invalida', 'A versão lida pela tela é inválida. Releia o item.', {
      campos: ['versao'],
    });
  const atual = itemDaLinha(d, relido);
  const mudou = camposMudados(lida.valores, atual.valores);
  if (lida.ativo !== (atual.ativo && !inativoNoNovo)) mudou.push('situacao');
  if (mudou.length > 0) throw erroConflitoVersao(mudou);
}

function montarAtualizacao(
  d: DeclaracaoDominio,
  colunas: readonly ColunaDeclarada[],
  valores: Readonly<Record<string, ValorCampo>>,
  codigo: string,
  /** W0-02: há texto longo na mesma alteração (sem coluna comum, o UPDATE é só do texto). */
  temTexto = false,
): { sql: string; parametros: unknown[] } | null {
  const usadas = colunas.filter((c) => c.campo in valores);
  if (usadas.length === 0 && temTexto) return null;
  if (usadas.length === 0) throw recusa('sem-alteracao', 'Nenhum campo alterado.');
  return {
    sql: `UPDATE ${d.tabela} SET ${usadas.map((c) => `${c.coluna} = ?`).join(', ')} WHERE ${condicaoDaChave(d)}`,
    parametros: [...usadas.map((c) => valorParaColuna(c, valores[c.campo])), ...valoresDaChave(d, codigo)],
  };
}

const igual = (a: unknown, b: unknown) =>
  (a === null || a === undefined ? null : String(a).replace(/ +$/, '')) ===
  (b === null || b === undefined ? null : String(b).replace(/ +$/, ''));

/**
 * W0-02 (D-CRUD-30): colunas de BLOB de texto em UTF-8 no catálogo (as demais, NONE ou WIN1252, gravam CP1252 como o
 * cadastro anterior). Leitura do catálogo na transação da operação.
 */
async function colunasUtf8(tx: TxOperacao, tabela: string, colunas: readonly string[]): Promise<Set<string>> {
  const linhas = await tx.consultar(
    `SELECT TRIM(rf.RDB$FIELD_NAME) C, f.RDB$CHARACTER_SET_ID CS FROM RDB$RELATION_FIELDS rf
       JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
      WHERE rf.RDB$RELATION_NAME = ? AND f.RDB$FIELD_TYPE = 261`,
    [tabela],
    { teto: 200 },
  );
  const r = new Set<string>();
  for (const x of linhas) {
    const c = String(x['C'] ?? '').trim();
    if (colunas.includes(c) && Number(x['CS']) === 4) r.add(c);
  }
  return r;
}

/** W1-04 (D-W104-8): os textos longos não editáveis com leiaute padrão na inclusão. */
function textosComPadrao(d: DeclaracaoDominio) {
  return (d.textosLongos ?? []).flatMap((t) =>
    !t.editavel && t.padraoNaInclusao ? [{ ...t, padraoNaInclusao: t.padraoNaInclusao }] : [],
  );
}

/** W1-04 (D-W104-8): gera, na transação da inclusão, os bytes do leiaute padrão de cada coluna. */
async function gerarPadroes(
  tx: TxOperacao,
  d: DeclaracaoDominio,
  e: EntradaInclusao,
  usuario: string,
): Promise<Record<string, Buffer>> {
  const r: Record<string, Buffer> = {};
  for (const t of textosComPadrao(d)) {
    const bytes = await t.padraoNaInclusao.gerar({
      consultar: (sql, p) => tx.consultar(sql, p ?? [], { teto: 50 }),
      lerBlob: (b) => tx.lerBlob(b),
      entrada: e,
      usuario,
    });
    if (bytes.length === 0) throw recusa('sem-modelo', `${t.rotulo}: não há leiaute padrão para gravar.`);
    r[t.campo] = Buffer.from(bytes);
  }
  return r;
}

/** W0-02: o texto da tela → bytes do BLOB (vazio → NULL, como o cadastro anterior deixa). */
function bytesDoTexto(v: ValorCampo | undefined, utf8: boolean): Buffer | null {
  if (v === null || v === undefined || v === '') return null;
  return prepararBlobTexto(String(v), { utf8 });
}

function operacaoIncluir(
  d: DeclaracaoDominio,
  resolver: ResolverDominio,
): Operacao<EntradaInclusao, SaidaDominio> {
  const passo = passoInclusao(d);
  const chave = colunaDaChave(d);
  const campos = d.colunas.filter((c) => c.naInclusao).map((c) => c.campo);
  const textos = textosEditaveis(d);
  // Revisão do W0-02: a marca de inativação só no novo que tenha ficado de uma exclusão feita por fora não pode fazer o
  // item novo de mesma chave (digitada) nascer inativo: a inclusão a apaga na mesma transação.
  const limpaMarca = d.situacaoSoNoNovo !== undefined && !d.situacao && chave.codigo === 'manual';
  const receita: Receita = {
    ...receitaBase(d, 'incluir'),
    ...(limpaMarca ? { registrosSgh: ['SGH_CFG_DOMINIO_SITUACAO'] } : {}),
    ...eventoLegadoDe(d, 'incluir'),
    descricao: `Inclui ${d.publico.rotulo.singular.toLowerCase()} (CRUD genérico, receita genérica).`,
    evento: `${d.publico.modulo}.${d.publico.recurso}.incluido`,
    passos: [passo],
    condicao:
      'código e descrição únicos entre ativos, depois de normalizar (409 duplicado); código manual livre na chave.',
    concorrencia: 'a chave primária do legado recusa a segunda inclusão do mesmo código (409 em português).',
    prova: `relê pela chave: ${chave.codigo === 'generator' ? 'chave gerada pelo trigger (> 0) e ' : ''}colunas gravadas iguais.`,
    cenarios: [
      {
        nome: 'novo',
        descricao: 'Item novo com todos os campos da declaração.',
        campos,
        ...efeitosDoCenarioGenerico(d, 'incluir'),
      },
      {
        nome: 'recusa-duplicado',
        descricao: 'Descrição (ou código) já usada por item ativo: nada gravado.',
        recusa: true,
      },
    ],
  };
  const esquema = esquemaInclusao(d);
  const composta = d.chaveComposta !== undefined;
  /** W1-04: os bytes do leiaute padrão gerados no gravar, para a prova reler (por entrada da execução). */
  const gerados = new WeakMap<object, Record<string, Buffer>>();
  /** Valor que a inclusão grava na coluna: o digitado ou, vazio, o DEFAULT do catálogo. */
  const gravado = (c: ColunaDeclarada, e: EntradaInclusao) =>
    valorParaColuna(c, e[c.campo] ?? (c.padraoNaInclusao as ValorCampo | undefined));
  return definirOperacao<EntradaInclusao, SaidaDominio>({
    receita,
    entrada: esquema as unknown as Operacao<EntradaInclusao, SaidaDominio>['entrada'],
    async conferir(tx, e) {
      if (chave.codigo === 'manual') {
        const codigo = codigoDosValores(d, e);
        if (await relerPelaChave(tx, d, codigo))
          throw recusa(
            'duplicado',
            `Já existe item com o código ${composta ? codigo.replace(/\|/g, ' / ') : codigo}.`,
            {
              campos: composta
                ? (d.chaveComposta ?? []).map((k) => d.colunas.find((c) => c.coluna === k)?.campo ?? k)
                : [chave.campo],
            },
          );
      }
      await conferirDuplicidade(tx, d, e, null);
      await conferirReferencias(tx, d, e, null, resolver);
    },
    async gravar(tx, e, ctx) {
      const entrada: Record<string, unknown> = Object.fromEntries(
        d.colunas.filter((c) => c.naInclusao).map((c) => [c.campo, gravado(c, e)]),
      );
      const comTexto = textos.filter(
        (t) => e[t.campo] !== undefined && e[t.campo] !== null && e[t.campo] !== '',
      );
      if (comTexto.length > 0) {
        const utf8 = await colunasUtf8(
          tx,
          d.tabela,
          comTexto.map((t) => t.coluna),
        );
        for (const t of comTexto) entrada[t.campo] = bytesDoTexto(e[t.campo], utf8.has(t.coluna));
      }
      const padroes = await gerarPadroes(tx, d, e, ctx.usuarioLegado);
      Object.assign(entrada, padroes);
      gerados.set(e, padroes);
      let linha: Linha;
      try {
        linha = await inserirPelaReceita(tx, passo, { entrada: entrada as Record<string, ValorCampo> }, ctx);
      } catch (erro) {
        if (restricaoUnicaViolada(erro))
          throw recusa('duplicado', 'Já existe item com este código.', { campos: [chave.campo] });
        throw erro;
      }
      const codigo = chave.codigo === 'generator' ? String(linha[d.chave] ?? '') : codigoDosValores(d, e);
      return { codigo, ...(await alvoDaTrilha(tx, d, codigo)) };
    },
    async provar(tx, e, r) {
      exigirEfeito(r.codigo !== '' && r.codigo !== 'undefined', `${d.tabela}: chave da inclusão`);
      const l = await relerPelaChave(tx, d, r.codigo);
      exigirEfeito(l, `${d.tabela}: item incluído não relido pela chave`);
      if (chave.codigo === 'generator')
        exigirEfeito(Number(l[d.chave]) > 0, `${d.triggers[0]?.nome ?? 'trigger'}: chave gerada`);
      for (const c of d.colunas.filter((x) => x.naInclusao))
        exigirEfeito(
          c.tipo === 'hora'
            ? itemDaLinha(d, l).valores[c.campo] === (e[c.campo] ?? null)
            : c.tipo === 'decimal'
              ? Number(l[c.coluna] ?? NaN) === Number(gravado(c, e) ?? NaN) ||
                (l[c.coluna] === null && gravado(c, e) === null)
              : igual(l[c.coluna], gravado(c, e)),
          `${d.tabela}.${c.coluna} gravada`,
        );
      if (d.situacao)
        exigirEfeito(
          String(l[d.situacao.coluna] ?? '').trim() === d.situacao.ativo,
          `${d.tabela}.${d.situacao.coluna} ativo`,
        );
      await provarTextos(tx, d, textos, e, r.codigo);
      await provarPadroes(tx, d, gerados.get(e) ?? {}, r.codigo);
    },
    ...(limpaMarca
      ? {
          async registrarSgh(es: Escritor, _e: EntradaInclusao, r: SaidaDominio) {
            await es.executar('DELETE FROM SGH_CFG_DOMINIO_SITUACAO WHERE TABELA = ? AND CHAVE = ?', [
              d.tabela,
              r.codigo,
            ]);
          },
        }
      : {}),
    eventos: (_e, r) => [{ tipo: receita.evento, carga: { codigo: codigoDoEvento(r.codigo) } }],
    alvo: (_e, r) => alvoDaOperacao(d, r),
  });
}

/** W0-02 (D-CRUD-30): os bytes relidos do BLOB são os gravados (texto idêntico, em todos os segmentos). */
async function provarTextos(
  tx: TxOperacao,
  d: DeclaracaoDominio,
  textos: ReturnType<typeof textosEditaveis>,
  valores: Readonly<Record<string, ValorCampo>>,
  codigo: string,
): Promise<void> {
  const blobs = textos.filter((t) => t.campo in valores);
  if (blobs.length === 0) return;
  const utf8 = await colunasUtf8(
    tx,
    d.tabela,
    blobs.map((t) => t.coluna),
  );
  const [x] = await tx.consultar(
    `SELECT ${blobs.map((t) => t.coluna).join(', ')} FROM ${d.tabela} WHERE ${condicaoDaChave(d)}`,
    valoresDaChave(d, codigo),
    { teto: 1 },
  );
  for (const t of blobs) {
    const esperado = bytesDoTexto(valores[t.campo], utf8.has(t.coluna));
    const lido = x?.[t.coluna];
    if (esperado === null) exigirEfeito(lido === null || lido === undefined, `${d.tabela}.${t.coluna} vazio`);
    else {
      const bytes = Buffer.isBuffer(lido)
        ? lido
        : typeof lido === 'string'
          ? prepararBlobTexto(lido, { utf8: utf8.has(t.coluna) })
          : lido
            ? await tx.lerBlob(lido)
            : Buffer.alloc(0);
      exigirEfeito(Buffer.from(bytes).equals(esperado), `${d.tabela}.${t.coluna}: texto relido idêntico`);
    }
  }
}

/** W1-04 (D-W104-8): o leiaute relido é, byte a byte, o gerado (o que o executável do painel vai ler). */
async function provarPadroes(
  tx: TxOperacao,
  d: DeclaracaoDominio,
  gerados: Readonly<Record<string, Buffer>>,
  codigo: string,
): Promise<void> {
  const textos = textosComPadrao(d).filter((t) => gerados[t.campo]);
  if (textos.length === 0) return;
  const [x] = await tx.consultar(
    `SELECT ${textos.map((t) => t.coluna).join(', ')} FROM ${d.tabela} WHERE ${condicaoDaChave(d)}`,
    valoresDaChave(d, codigo),
    { teto: 1 },
  );
  for (const t of textos) {
    const lido = x?.[t.coluna];
    const bytes = Buffer.isBuffer(lido)
      ? lido
      : typeof lido === 'string'
        ? prepararBlobTexto(lido, { utf8: false })
        : lido
          ? await tx.lerBlob(lido)
          : Buffer.alloc(0);
    exigirEfeito(
      Buffer.from(bytes).equals(gerados[t.campo]!),
      `${d.tabela}.${t.coluna}: leiaute padrão relido idêntico`,
    );
  }
}

/**
 * Revisão do W0-02: os textos longos atuais do item (para o valor anterior do evento da alteração), lidos na transação
 * da operação antes do UPDATE; só os pedidos.
 */
async function textosAtuais(
  tx: TxOperacao,
  d: DeclaracaoDominio,
  textos: ReturnType<typeof textosEditaveis>,
  codigo: string,
): Promise<Record<string, string | null>> {
  if (textos.length === 0) return {};
  const [x] = await tx.consultar(
    `SELECT ${textos.map((t) => t.coluna).join(', ')} FROM ${d.tabela} WHERE ${condicaoDaChave(d)}`,
    valoresDaChave(d, codigo),
    { teto: 1 },
  );
  const r: Record<string, string | null> = {};
  for (const t of textos) {
    const v = x?.[t.coluna];
    if (v === null || v === undefined) r[t.campo] = null;
    else if (typeof v === 'string') r[t.campo] = v;
    else {
      const bytes = Buffer.isBuffer(v) ? v : await tx.lerBlob(v);
      const texto = lerBlobTexto(bytes).texto;
      r[t.campo] = texto === '' ? null : texto;
    }
  }
  return r;
}

/**
 * M14: alvo da trilha. A trilha do legado (onde o Delphi a grava: TBALERGIA, TBPRINC, SITABPRO) leva o
 * identificador da coluna medida (`trilhaLegado.alvo`, ex.: SITABPRO.ID, que não é a chave); a SGH_TRILHA leva
 * o mesmo identificador e o código exposto como chave natural.
 */
function alvoDaOperacao(
  d: DeclaracaoDominio,
  r: SaidaDominio,
): { tabela: string; id: string; chaveNatural?: string } {
  const legado = (r as Readonly<Record<string, string | undefined>>)['alvoLegado'];
  if (legado) return { tabela: d.tabela, id: legado, chaveNatural: r.codigo };
  // M18: chave composta longa (o nome da agenda na escala de exames): SGH_TRILHA.ID_ALVO tem 40 posições; o
  // código inteiro vai à chave natural (120).
  return r.codigo.length > 40
    ? { tabela: d.tabela, id: r.codigo.slice(0, 40), chaveNatural: r.codigo }
    : { tabela: d.tabela, id: r.codigo };
}

async function alvoDaTrilha(
  tx: TxOperacao,
  d: DeclaracaoDominio,
  codigo: string,
): Promise<Record<string, string>> {
  const col = d.trilhaLegado?.alvo.split('.')[1];
  if (!col || (col === d.chave && !d.chaveComposta)) return {};
  const l = await tx.uma(
    `SELECT ${col} V FROM ${d.tabela} WHERE ${condicaoDaChave(d)}`,
    valoresDaChave(d, codigo),
  );
  return l?.['V'] === null || l?.['V'] === undefined ? {} : { alvoLegado: String(l['V']) };
}

/** M14: evento da trilha do legado do verbo (o Delphi grava; medido no perfil da trilha). */
function eventoLegadoDe(d: DeclaracaoDominio, verbo: 'incluir' | 'alterar'): Pick<Receita, 'eventoLegado'> {
  const ev = d.trilhaLegado?.[verbo];
  if (!ev || !d.trilhaLegado) return {};
  return {
    eventoLegado: {
      tipo: ev.tipo as NonNullable<Receita['eventoLegado']>['tipo'],
      criticidade: ev.criticidade as NonNullable<Receita['eventoLegado']>['criticidade'],
      opcao: ev.opcao,
      alvo: d.trilhaLegado.alvo as NonNullable<Receita['eventoLegado']>['alvo'],
    },
  };
}

function operacaoAlterar(
  d: DeclaracaoDominio,
  resolver: ResolverDominio,
): Operacao<EntradaAlteracao, SaidaDominio> {
  const editaveis = d.colunas.filter((c) => c.editavel);
  const textos = textosEditaveis(d);
  const descricaoEditavel = editaveis.some((c) => c.campo === d.descricao);
  const receita: Receita = {
    ...receitaBase(d, 'alterar'),
    ...eventoLegadoDe(d, 'alterar'),
    // Revisão do W0-02: a descrição do catálogo não muda (o valor anterior vai à SGH_CRUD_EVENTO pelo registro próprio).
    descricao: `Altera ${d.publico.rotulo.singular.toLowerCase()}: só as colunas editáveis, nunca a chave.`,
    evento: `${d.publico.modulo}.${d.publico.recurso}.alterado`,
    // Revisão do W0-02 (linha "Trilha" da matriz): o valor anterior da alteração na SGH_CRUD_EVENTO.
    registrosSgh: ['SGH_CRUD_EVENTO'],
    passos: [
      {
        ordem: 1,
        tabela: d.tabela,
        acao: 'UPDATE',
        colunas: Object.fromEntries([
          ...editaveis.map((c) => [
            c.coluna,
            {
              classe: c.classe ?? 'entrada',
              origem: `entrada: ${c.campo}${c.sentinelaVazio !== undefined ? ` (vazio: ${c.sentinelaVazio})` : ''}`,
              valor: { de: 'entrada', campo: c.campo, seAusente: c.sentinelaVazio ?? null },
            },
          ]),
          // W0-02 (D-CRUD-30): o texto longo editável (BLOB de texto em CP1252, em segmentos).
          ...textos.map((t) => [
            t.coluna,
            {
              classe: 'entrada',
              origem: `entrada: ${t.campo} (texto longo: BLOB sub_type 1, CP1252/WIN1252, em segmentos)`,
              valor: { de: 'entrada', campo: t.campo, seAusente: null },
            },
          ]),
        ]),
      },
    ],
    condicao:
      'versão (colunas mostradas) igual à lida (409 conflito-versao); descrição única entre ativos (409 duplicado).',
    concorrencia:
      'SELECT … WITH LOCK pela chave; outra conexão com a linha travada: 409 registro em edição depois do LOCK TIMEOUT.',
    prova: 'relê pela chave: as colunas editadas com os valores novos.',
    cenarios: [
      {
        nome: descricaoEditavel ? 'descricao' : 'campos-editaveis',
        descricao: descricaoEditavel
          ? 'Descrição alterada.'
          : 'Campos editáveis alterados (a descrição é chave no legado).',
        campos: editaveis.map((c) => c.campo),
        ...efeitosDoCenarioGenerico(d, 'alterar'),
        ...carimbosDaAlteracao(d),
      },
      // M24: a coluna cujo vazio é uma sentinela do legado ganha o cenário de limpar (grava a sentinela, nunca NULL).
      ...editaveis
        .filter((c) => c.sentinelaVazio !== undefined)
        .map((c) => ({
          nome: `limpa-${c.campo.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
          descricao: `${c.rotulo} deixado vazio: grava a sentinela ${String(c.sentinelaVazio)} do legado, nunca NULL.`,
          campos: [c.campo],
          referencia: {
            classes: {
              [d.tabela]: {
                [c.coluna]: {
                  classe: `sentinela:${String(c.sentinelaVazio)}`,
                  motivo: 'o vazio da tela grava a sentinela que o perfil mede na coluna (nunca NULL)',
                },
              },
            },
          },
        })),
      // W0-02 (D-CRUD-30): o texto longo com acentuação e mais de um segmento, relido idêntico.
      ...(textos.length > 0
        ? [
            {
              nome: 'texto-longo',
              descricao:
                'Texto longo com acentuação CP1252 e mais de um segmento (acima de 64 KiB): gravado e relido idêntico.',
              campos: textos.map((t) => t.campo),
            },
          ]
        : []),
      {
        nome: 'recusa-colisao',
        descricao: 'Linha alterada por fora desde a leitura: 409, nada gravado.',
        recusa: true,
      },
    ],
  };
  return definirOperacao<EntradaAlteracao, SaidaDominio>({
    receita,
    entrada: esquemaAlteracao(d) as unknown as Operacao<EntradaAlteracao, SaidaDominio>['entrada'],
    travar: (e) => ({
      tabela: d.tabela,
      chave: chaveComoObjeto(d, e.codigo),
      colunas: colunasLidas(d),
    }),
    async conferir(tx, e, _ctx, relido) {
      // M11: item de sistema que o trigger *_BU do legado protege (ex.: TBCONSPROF 1 a 12): não altera.
      if (d.protegidasNaAlteracao?.codigos.includes(Number(e.codigo)))
        throw recusa(
          'item-de-sistema',
          `Item de sistema do legado: não é alterado (${d.protegidasNaAlteracao.evidencia}).`,
        );
      // Correção do M14: o item inativado só no novo (SGH_CFG_DOMINIO_SITUACAO) também é inativo aqui — a recusa é
      // "item inativo", não um falso conflito de versão (a tela calcula a versão com a situação do novo).
      if (relido && d.situacaoSoNoNovo && (await lerInativosSoNoNovo(tx, d.tabela)).has(e.codigo))
        throw recusa('inativo', 'Item inativo não é alterado.');
      conferirVersao(d, relido, e.versao);
      const atual = relido ? itemDaLinha(d, relido) : null;
      if (atual && !atual.ativo) throw recusa('inativo', 'Item inativo não é alterado.');
      if (atual) await conferirDuplicidade(tx, d, { ...atual.valores, ...e.valores }, e.codigo);
      await conferirReferencias(tx, d, e.valores, e.codigo, resolver);
      // Revisão do W0-02: o valor anterior (colunas declaradas e os textos longos pedidos), lido antes do UPDATE.
      if (relido)
        lidasNaAlteracao.set(e, {
          ...valorAnterior(d, relido),
          ...(await textosAtuais(
            tx,
            d,
            textos.filter((t) => t.campo in e.valores),
            e.codigo,
          )),
        });
    },
    async gravar(tx, e) {
      const blobs = textos.filter((t) => t.campo in e.valores);
      const u = montarAtualizacao(d, editaveis, e.valores, e.codigo, blobs.length > 0);
      if (blobs.length > 0) {
        const utf8 = await colunasUtf8(
          tx,
          d.tabela,
          blobs.map((t) => t.coluna),
        );
        const sets = blobs.map((t) => `${t.coluna} = ?`);
        const vals = blobs.map((t) => bytesDoTexto(e.valores[t.campo], utf8.has(t.coluna)));
        const sql = u
          ? u.sql.replace(' WHERE ', `, ${sets.join(', ')} WHERE `)
          : `UPDATE ${d.tabela} SET ${sets.join(', ')} WHERE ${condicaoDaChave(d)}`;
        const parametros = u
          ? [
              ...u.parametros.slice(0, u.parametros.length - chavesDe(d).length),
              ...vals,
              ...valoresDaChave(d, e.codigo),
            ]
          : [...vals, ...valoresDaChave(d, e.codigo)];
        const n = await atualizarComGatilho(tx, sql, parametros);
        exigirEfeito(n === 1, `${d.tabela}: alteração de 1 linha`);
      } else {
        exigirEfeito(u, `${d.tabela}: alteração sem campo`);
        const n = await atualizarComGatilho(tx, u.sql, u.parametros);
        exigirEfeito(n === 1, `${d.tabela}: alteração de 1 linha`);
      }
      return { codigo: e.codigo, ...(await alvoDaTrilha(tx, d, e.codigo)) };
    },
    async provar(tx, e) {
      const l = await relerPelaChave(tx, d, e.codigo);
      exigirEfeito(l, `${d.tabela}: item alterado não relido`);
      const v = itemDaLinha(d, l).valores;
      for (const c of editaveis.filter((x) => x.campo in e.valores))
        exigirEfeito(
          String(v[c.campo] ?? '') === String(e.valores[c.campo] ?? ''),
          `${d.tabela}.${c.coluna} alterada`,
        );
      await provarTextos(tx, d, textos, e.valores, e.codigo);
    },
    async registrarSgh(es, e, _r, ctx) {
      await gravarEventoCrud(es, {
        hospital: ctx.hospital,
        operacao: receita.nome,
        recurso: `${d.publico.modulo}.${d.publico.recurso}`,
        evento: 'alterado',
        tabela: d.tabela,
        chave: e.codigo,
        motivo: '',
        valorAnterior: lidasNaAlteracao.get(e) ?? null,
        idempotencia: ctx.idempotencyKey,
        estacao: ctx.estacao ?? null,
        usuario: ctx.usuarioLegado,
      });
    },
    eventos: (_e, r) => [{ tipo: receita.evento, carga: { codigo: codigoDoEvento(r.codigo) } }],
    alvo: (_e, r) => alvoDaOperacao(d, r),
  });
}

/** Leitura do uso do item pelas FKs (porta: o repositório implementa com o catálogo RDB$). */
export type LerUso = (
  tx: TxOperacao,
  d: DeclaracaoDominio,
  codigo: string,
) => Promise<readonly { regra: string; usos: boolean }[]>;

function operacaoInativar(d: DeclaracaoDominio, lerUso: LerUso): Operacao<EntradaInativacao, SaidaDominio> {
  const s = d.situacao;
  if (!s) throw new Error('Inativar exige a coluna de situação.');
  const receita: Receita = {
    ...receitaBase(d, 'inativar'),
    descricao: `Inativa ${d.publico.rotulo.singular.toLowerCase()} (letra de inativo ${s.inativo}; ${s.evidencia}); sem exclusão física.`,
    evento: `${d.publico.modulo}.${d.publico.recurso}.inativado`,
    // Revisão do W0-02: o motivo e o valor anterior da inativação na SGH_CRUD_EVENTO (como na reativação irmã).
    registrosSgh: ['SGH_CRUD_EVENTO'],
    passos: [
      {
        ordem: 1,
        tabela: d.tabela,
        acao: 'UPDATE',
        colunas: {
          [s.coluna]: {
            classe: `constante:${s.inativo}`,
            origem: s.evidencia,
            valor: { de: 'constante', valor: s.inativo },
          },
        },
      },
    ],
    condicao:
      'versão igual à lida (409); item ativo; item de sistema protegido recusado (409); em uso pelas FKs do catálogo: aviso e confirmação (409 em-uso sem confirmar).',
    concorrencia: 'SELECT … WITH LOCK pela chave.',
    prova: `relê pela chave: ${s.coluna} = ${s.inativo}.`,
    cenarios: [
      {
        nome: 'sem-uso',
        descricao: 'Item sem uso inativado.',
        campos: [],
        ...efeitosDoCenarioGenerico(d, 'inativar'),
      },
      {
        nome: 'recusa-colisao',
        descricao: 'Linha alterada por fora desde a leitura: 409, nada gravado.',
        recusa: true,
      },
    ],
  };
  return definirOperacao<EntradaInativacao, SaidaDominio>({
    receita,
    entrada: esquemaInativacao() as unknown as Operacao<EntradaInativacao, SaidaDominio>['entrada'],
    travar: (e) => ({
      tabela: d.tabela,
      chave: chaveComoObjeto(d, e.codigo),
      colunas: colunasLidas(d),
    }),
    async conferir(tx, e, _ctx, relido) {
      if (s.protegidas?.codigos.includes(Number(e.codigo)))
        throw recusa(
          'item-de-sistema',
          'Item de sistema (o fluxo do sistema depende dele): não é inativado.',
        );
      // M14 (regra 10): a linha "não informado" é a sentinela do legado; nunca é inativada.
      if (relido && descricaoSentinela(itemDaLinha(d, relido).valores[d.descricao]))
        throw recusa('item-de-sistema', 'O item "não informado" é usado pelo sistema: não é inativado.');
      conferirVersao(d, relido, e.versao);
      if (relido && !itemDaLinha(d, relido).ativo) throw recusa('ja-inativo', 'O item já está inativo.');
      const usos = (await lerUso(tx, d, e.codigo)).filter((u) => u.usos);
      if (usos.length > 0 && !e.confirmarEmUso)
        throw recusa(
          'em-uso',
          `Item em uso em ${usos.length} cadastro(s). Confirme para inativar: os registros antigos continuam legíveis.`,
        );
      if (relido) lidasNaInativacao.set(e, relido);
    },
    async gravar(tx, e) {
      const n = await tx.executar(`UPDATE ${d.tabela} SET ${s.coluna} = ? WHERE ${condicaoDaChave(d)}`, [
        s.inativo,
        ...valoresDaChave(d, e.codigo),
      ]);
      exigirEfeito(n === 1, `${d.tabela}: inativação de 1 linha`);
      return { codigo: e.codigo };
    },
    async provar(tx, e) {
      const l = await relerPelaChave(tx, d, e.codigo);
      exigirEfeito(
        l && String(l[s.coluna] ?? '').trim() === s.inativo,
        `${d.tabela}.${s.coluna} = ${s.inativo}`,
      );
    },
    async registrarSgh(es, e, _r, ctx) {
      await gravarEventoCrud(es, {
        hospital: ctx.hospital,
        operacao: receita.nome,
        recurso: `${d.publico.modulo}.${d.publico.recurso}`,
        evento: 'inativado',
        tabela: d.tabela,
        chave: e.codigo,
        motivo: e.motivo ?? '',
        valorAnterior: valorAnterior(d, lidasNaInativacao.get(e) ?? null),
        idempotencia: ctx.idempotencyKey,
        estacao: ctx.estacao ?? null,
        usuario: ctx.usuarioLegado,
      });
    },
    eventos: (_e, r) => [{ tipo: receita.evento, carga: { codigo: codigoDoEvento(r.codigo) } }],
    alvo: (_e, r) => ({ tabela: d.tabela, id: r.codigo }),
  });
}

// ── W0-02: reativar e excluir ─────────────────────────────────────────────────────────────────────────

export interface EntradaReativacao {
  readonly codigo: string;
  readonly versao: string;
  readonly motivo: string;
}
export interface EntradaExclusao {
  readonly codigo: string;
  readonly versao: string;
  readonly motivo: string;
}

/** O valor anterior do item (as colunas declaradas, como a tela as vê), para o registro do evento. */
function valorAnterior(d: DeclaracaoDominio, l: Linha | null): Record<string, unknown> | null {
  if (!l) return null;
  const i = itemDaLinha(d, l);
  return { codigo: codigoDaLinhaOuVazio(d, l), ativo: i.ativo, ...i.valores };
}
function codigoDaLinhaOuVazio(d: DeclaracaoDominio, l: Linha): string {
  try {
    return chavesDe(d)
      .map((k) => String(l[k] ?? '').trim())
      .join('|');
  } catch {
    return '';
  }
}

/** A categoria proíbe a exclusão física (regra de apoio à decisão, formulário): motivo, ou null. */
export function exclusaoProibida(d: DeclaracaoDominio): string | null {
  const c = d.publico.categoria;
  if (c && CATEGORIAS_SEM_EXCLUSAO.includes(c))
    return c === 'formulario'
      ? 'Formulário finalizado não se exclui: inative e crie nova versão (ECF.07.35 c).'
      : 'Regra de apoio à decisão não se exclui: inative e crie nova versão (ECF.14.07 d).';
  return null;
}

/** D-CRUD-SNAP: a exclusão do domínio retrata a linha inteira antes (categoria protegida ou marca da declaração). */
export function exclusaoProtegida(d: DeclaracaoDominio): boolean {
  if (d.exclusao?.protegida !== undefined) return d.exclusao.protegida;
  const c = d.publico.categoria;
  return c !== undefined && CATEGORIAS_PROTEGIDAS.includes(c);
}

/** Estado da operação guardado entre os passos (a linha lida e o retrato), pela entrada. */
interface LidaNaExclusao {
  readonly linha: Linha;
  readonly retrato: RetratoLinha | null;
  /** As filhas próprias (FK em CASCADE) que o DELETE leva junto, retratadas antes. */
  readonly filhas: readonly RetratoLinha[];
  /** A marca de inativação só no novo (SGH_CFG_DOMINIO_SITUACAO) do item, quando há. */
  readonly marcaNoNovo: { readonly desde: string; readonly autor: string } | null;
}
const lidasNaExclusao = new WeakMap<object, LidaNaExclusao>();
const lidasNaReativacao = new WeakMap<object, Linha>();
const lidasNaInativacao = new WeakMap<object, Linha>();
const lidasNaAlteracao = new WeakMap<object, Record<string, unknown>>();

/** Teto das filhas próprias retratadas numa exclusão (acima dele, a exclusão é recusada: nada apagado). */
export const TETO_FILHAS_PROPRIAS = 1_000;

/**
 * Revisão do W0-02: item de sistema que a exclusão recusa como a inativação recusa — o código protegido (da situação do
 * legado, da situação só no novo ou da alteração) e a sentinela "não informado". Motivo, ou null.
 */
export function itemDeSistemaNaExclusao(
  d: DeclaracaoDominio,
  codigo: string,
  relido: Linha | null,
): string | null {
  const n = Number(codigo);
  if (
    d.situacao?.protegidas?.codigos.includes(n) ||
    (d.situacaoSoNoNovo?.protegidas ?? []).includes(n) ||
    d.protegidasNaAlteracao?.codigos.includes(n)
  )
    return 'Item de sistema (o fluxo do sistema depende dele): não é excluído.';
  if (relido && descricaoSentinela(itemDaLinha(d, relido).valores[d.descricao]))
    return 'O item "não informado" é usado pelo sistema: não é excluído.';
  return null;
}

/** A mensagem do catálogo (RDB$EXCEPTIONS) da exceção que o gatilho do legado lançou; null se não for exceção. */
async function mensagemDoGatilho(tx: TxOperacao, erro: unknown): Promise<string | null> {
  if (gdscodeDe(erro) !== GDS_EXCECAO) return null;
  const bruta = erro instanceof Error ? erro.message : String(erro);
  const nome = /-([A-Z][A-Z0-9_$]{0,62})\b/.exec(bruta.toUpperCase())?.[1];
  if (!nome) return null;
  try {
    const x = await tx.uma('SELECT RDB$MESSAGE M FROM RDB$EXCEPTIONS WHERE RDB$EXCEPTION_NAME = ?', [nome]);
    const m = String(x?.['M'] ?? '').trim();
    return m === '' ? null : m;
  } catch {
    return null;
  }
}

/**
 * W1-04: o UPDATE da alteração com a recusa do gatilho do legado legível (exceção _BU/_BIU, ex.: TRG_TBPROCED_BU
 * recusa trocar o nome da procedência já usada no atendimento): a mensagem do catálogo, nada gravado.
 */
async function atualizarComGatilho(
  tx: TxOperacao,
  sql: string,
  parametros: readonly unknown[],
): Promise<number> {
  try {
    return await tx.executar(sql, parametros);
  } catch (erro) {
    const m = await mensagemDoGatilho(tx, erro);
    if (m) throw recusa('recusa-do-gatilho', m);
    throw erro;
  }
}

function operacaoReativar(d: DeclaracaoDominio): Operacao<EntradaReativacao, SaidaDominio> {
  const s = d.situacao;
  if (!s) throw new Error('Reativar exige a coluna de situação.');
  const receita: Receita = {
    ...receitaBase(d, 'inativar'),
    // W0-02: o verbo novo é do pacote do motor (as contagens dos marcos que declararam o domínio não mudam).
    marco: 'W0-02',
    nome: operacaoDoDominio(d.publico, 'reativar'),
    // W0-02: os cenários de assinatura (reativa, recusa-ja-ativo) foram capturados na cópia e promovidos a verde.
    // A exclusão nasce especificada no catálogo e vira verde pela captura dos cenários dela (os pilotos do W0-02:
    // pep.caracteristicaDieta e a ligação pep.caracteristicaDaDieta).
    naoFaz: [
      'não reativa item de sistema que o fluxo não usa (só o que foi inativado)',
      'não grava o que os triggers gravam',
    ],
    descricao: `Reativa ${d.publico.rotulo.singular.toLowerCase()}: grava a letra de ativo ${s.ativo} na coluna de situação, como o cadastro anterior grava (${s.evidencia}); motivo e valor anterior no registro do evento.`,
    evento: `${d.publico.modulo}.${d.publico.recurso}.reativado`,
    registrosSgh: ['SGH_CRUD_EVENTO'],
    passos: [
      {
        ordem: 1,
        tabela: d.tabela,
        acao: 'UPDATE',
        colunas: {
          [s.coluna]: {
            classe: `constante:${s.ativo}`,
            origem: `letra de ativo (${s.evidencia})`,
            valor: { de: 'constante', valor: s.ativo },
          },
        },
      },
    ],
    condicao: 'versão igual à lida (409); item inativo (409 ja-ativo); motivo obrigatório.',
    concorrencia: 'SELECT … WITH LOCK pela chave.',
    prova: `relê pela chave: ${s.coluna} = ${s.ativo}; o evento com motivo e valor anterior na SGH_CRUD_EVENTO.`,
    cenarios: [
      {
        nome: 'reativa',
        descricao: 'Item sintético inativado na preparação volta a ativo, com o motivo.',
        campos: [],
        ...efeitosDoCenarioGenerico(d, 'inativar'),
      },
      { nome: 'recusa-ja-ativo', descricao: 'Item ativo: 409, nada gravado.', recusa: true },
    ],
  };
  return definirOperacao<EntradaReativacao, SaidaDominio>({
    receita,
    entrada: esquemaReativacao() as unknown as Operacao<EntradaReativacao, SaidaDominio>['entrada'],
    travar: (e) => ({ tabela: d.tabela, chave: chaveComoObjeto(d, e.codigo), colunas: colunasLidas(d) }),
    async conferir(_tx, e, _ctx, relido) {
      conferirVersao(d, relido, e.versao);
      if (relido && itemDaLinha(d, relido).ativo) throw recusa('ja-ativo', 'O item já está ativo.');
      if (relido) lidasNaReativacao.set(e, relido);
    },
    async gravar(tx, e) {
      const n = await tx.executar(`UPDATE ${d.tabela} SET ${s.coluna} = ? WHERE ${condicaoDaChave(d)}`, [
        s.ativo,
        ...valoresDaChave(d, e.codigo),
      ]);
      exigirEfeito(n === 1, `${d.tabela}: reativação de 1 linha`);
      return { codigo: e.codigo };
    },
    async provar(tx, e) {
      const l = await relerPelaChave(tx, d, e.codigo);
      exigirEfeito(l && String(l[s.coluna] ?? '').trim() === s.ativo, `${d.tabela}.${s.coluna} = ${s.ativo}`);
    },
    async registrarSgh(es, e, _r, ctx) {
      await gravarEventoCrud(es, {
        hospital: ctx.hospital,
        operacao: receita.nome,
        recurso: `${d.publico.modulo}.${d.publico.recurso}`,
        evento: 'reativado',
        tabela: d.tabela,
        chave: e.codigo,
        motivo: e.motivo,
        valorAnterior: valorAnterior(d, lidasNaReativacao.get(e) ?? null),
        idempotencia: ctx.idempotencyKey,
        estacao: ctx.estacao ?? null,
        usuario: ctx.usuarioLegado,
      });
    },
    eventos: (_e, r) => [{ tipo: receita.evento, carga: { codigo: codigoDoEvento(r.codigo) } }],
    alvo: (_e, r) => alvoDaOperacao(d, r),
  });
}

/** Os dependentes no formato do problema (sem nome de tabela). */
function dependentesDoProblema(v: readonly DependenteContado[]) {
  return v.map((x) => ({
    rotulo: x.rotulo,
    quantidade: x.quantidade,
    amostra: [...x.amostra],
    origem: x.origem,
  }));
}

function operacaoExcluir(
  d: DeclaracaoDominio,
  rotuloDaTabela: RotuloDaTabela,
): Operacao<EntradaExclusao, SaidaDominio> {
  const proibida = exclusaoProibida(d);
  if (proibida) throw new Error(`${d.publico.modulo}.${d.publico.recurso}: ${proibida}`);
  const mapa = mapaDoDominio(d);
  const protegida = exclusaoProtegida(d);
  const comFilhas = (d.exclusao?.proprias ?? []).length > 0;
  const soNoNovo = d.situacaoSoNoNovo !== undefined && !d.situacao;
  const singular = d.publico.rotulo.singular;
  const saida =
    d.situacao || d.situacaoSoNoNovo
      ? 'Não pode ser excluído: inative em vez disso (os registros antigos continuam legíveis).'
      : 'Não pode ser excluído enquanto houver registros que dependem dele.';
  // A exclusão não herda o "pendente" da alteração (a prova dela é a do próprio verbo).
  const base = Object.fromEntries(
    Object.entries(receitaBase(d, 'alterar')).filter(([k]) => k !== 'pendente' && k !== 'referencia'),
  ) as ReturnType<typeof receitaBase>;
  const receita: Receita = {
    ...base,
    // W0-02: o verbo novo é do pacote do motor (as contagens dos marcos que declararam o domínio não mudam).
    marco: 'W0-02',
    nome: operacaoDoDominio(d.publico, 'excluir'),
    efeitos: (d.efeitosTrigger ?? [])
      .filter((x) => x.quando.includes('DELETE'))
      .map((x) => ({ trigger: x.trigger, tabela: x.tabela, acao: x.acao, faz: x.faz })),
    naoFaz: [
      'excluir item com qualquer registro dependente (FK declarada ou referência só por código): recusa com quantos e quais e oferece inativar',
      ...(protegida
        ? ['apagar sem retrato: a linha inteira vai antes à SGH_HIST_EXCLUSAO, na mesma transação']
        : []),
      'criar gatilho ou qualquer objeto no banco do cadastro anterior (D-CRUD-SEM-GATILHO)',
    ],
    descricao: `Exclui ${singular.toLowerCase()} sem uso (D-CRUD-ORFAOS: só sem dependentes)${protegida ? ', com o retrato da linha inteira (D-CRUD-SNAP)' : ''}; motivo e valor anterior no registro do evento.`,
    evento: `${d.publico.modulo}.${d.publico.recurso}.excluido`,
    critica: true,
    registrosSgh: [
      ...(protegida || comFilhas ? ['SGH_HIST_EXCLUSAO'] : []),
      'SGH_CRUD_EVENTO',
      // Revisão do W0-02: a marca de inativação só no novo sai junto (nenhuma linha SGH_ órfã).
      ...(soNoNovo ? ['SGH_CFG_DOMINIO_SITUACAO'] : []),
    ],
    passos: [
      {
        ordem: 1,
        tabela: d.tabela,
        acao: 'DELETE',
        colunas: Object.fromEntries(
          chavesDe(d).map((k) => [k, { classe: 'entrada', origem: 'a chave do item nunca usado' }]),
        ),
      },
    ],
    condicao:
      'versão igual à lida (409); categoria da matriz que admite exclusão; NENHUM dependente pelas FKs do catálogo nem pelas referências lógicas do mapa (409 com-dependentes: quantos, quais e a oferta de inativar); motivo obrigatório.',
    concorrencia:
      'SELECT … WITH LOCK pela chave; um dependente por FK criado em paralelo faz o banco recusar o DELETE (tudo desfeito); as referências lógicas são recontadas depois do DELETE e antes do COMMIT (409 vinculo-concorrente). Risco residual aceito: inclusão sem FK ainda não confirmada na recontagem.',
    prova: `relê pela chave: a linha não existe mais${protegida ? '; o retrato está na SGH_HIST_EXCLUSAO' : ''}; nenhuma referência lógica apareceu (recontagem).`,
    cenarios: [
      {
        nome: 'nunca-usado',
        descricao: 'Item sintético incluído na preparação, sem uso, excluído com o motivo.',
        campos: [],
        // W1-05: o efeito DELETE de gatilho medido (TRG_RELOCLEITO_AD apaga a acomodação espelho do local).
        ...efeitosDaExclusao(d),
      },
      // A tabela sem dependente possível (d.exclusao.semDependentes) não tem a recusa por dependentes a reproduzir: a
      // recusa dela é a da versão (a linha mudou por fora depois da leitura).
      ...(d.exclusao?.semDependentes
        ? [
            {
              nome: 'recusa-colisao',
              descricao: 'Linha alterada por fora desde a leitura: 409, nada apagado.',
              recusa: true,
            },
          ]
        : [
            {
              nome: 'recusa-com-dependentes',
              descricao: 'Item com registro dependente: 409 com a contagem e a amostra, nada apagado.',
              recusa: true,
            },
          ]),
    ],
  };
  return definirOperacao<EntradaExclusao, SaidaDominio>({
    receita,
    entrada: esquemaExclusao() as unknown as Operacao<EntradaExclusao, SaidaDominio>['entrada'],
    travar: (e) => ({ tabela: d.tabela, chave: chaveComoObjeto(d, e.codigo), colunas: colunasLidas(d) }),
    async conferir(tx, e, _ctx, relido) {
      const sistema = itemDeSistemaNaExclusao(d, e.codigo, relido);
      if (sistema) throw recusa('item-de-sistema', sistema);
      // Revisão do W0-02: no domínio que inativa só no novo, a situação do item é a do novo (a tela calcula a versão
      // com ela): a versão confere com a marca, e a marca vai ao valor anterior e sai junto com o item.
      const marcaNoNovo = soNoNovo && relido ? await inativacaoSoNoNovo(tx, d.tabela, e.codigo) : null;
      conferirVersao(d, relido, e.versao, marcaNoNovo !== null);
      const ativo = relido ? itemDaLinha(d, relido).ativo && marcaNoNovo === null : false;
      const [linha] = await tx.consultar(
        `SELECT * FROM ${d.tabela} WHERE ${condicaoDaChave(d)}`,
        valoresDaChave(d, e.codigo),
        { teto: 1 },
      );
      if (!linha) throw recusa('registro-inexistente', 'O item não existe mais.');
      const v = await verificarDependencias(tx, {
        mapa,
        linha,
        chave: valoresDaChave(d, e.codigo),
        rotulo: rotuloDaTabela,
      });
      if (v.length > 0)
        throw recusa(
          'com-dependentes',
          frasesDosDependentes(v, `Este item (${singular.toLowerCase()})`, saida),
          {
            dependentes: dependentesDoProblema(v),
            // Revisão do W0-02: só oferece inativar o item que ainda está ativo.
            podeInativar:
              ativo && Boolean(d.situacao || d.situacaoSoNoNovo) && d.publico.acoes.includes('inativar'),
          },
        );
      lidasNaExclusao.set(e, { linha, retrato: null, filhas: [], marcaNoNovo });
    },
    async gravar(tx, e) {
      const lida = lidasNaExclusao.get(e);
      exigirEfeito(lida, `${d.tabela}: a linha lida antes da exclusão`);
      // D-CRUD-SNAP: o retrato é lido ANTES do DELETE (a linha inteira, com BLOB) e gravado na mesma transação.
      const retrato = protegida
        ? await retratarLinha(tx, d.tabela, condicaoDaChave(d), valoresDaChave(d, e.codigo), e.codigo)
        : null;
      if (protegida) exigirEfeito(retrato, `${d.tabela}: retrato antes da exclusão`);
      // Revisão do W0-02 (D-CRUD-SNAP com `proprias`): as filhas em CASCADE, retratadas inteiras antes do DELETE.
      const filhas: RetratoLinha[] = [];
      for (const p of await fksProprias(tx, mapa, lida.linha)) {
        const r = await retratarFilhas(
          tx,
          p.fk.tabela,
          p.fk.colunas,
          p.valores,
          await chavePrimaria(tx, p.fk.tabela),
          TETO_FILHAS_PROPRIAS,
        );
        if (r === null)
          throw recusa(
            'com-dependentes',
            `Este item tem mais de ${TETO_FILHAS_PROPRIAS} registros próprios: a exclusão não é feita pelo cadastro. ${saida}`,
          );
        filhas.push(...r);
      }
      lidasNaExclusao.set(e, { ...lida, retrato, filhas });
      let n: number;
      try {
        n = await tx.executar(
          `DELETE FROM ${d.tabela} WHERE ${condicaoDaChave(d)}`,
          valoresDaChave(d, e.codigo),
        );
      } catch (erro) {
        // O gatilho do legado que recusa a exclusão (exceção _BD/_BIUD): a mensagem do catálogo, legível; a operação
        // inteira é desfeita (o retrato ainda nem foi gravado: nenhum retrato órfão).
        const m = await mensagemDoGatilho(tx, erro);
        if (m) throw recusa('recusa-do-gatilho', m);
        throw erro;
      }
      exigirEfeito(n === 1, `${d.tabela}: exclusão de 1 linha`);
      return { codigo: e.codigo };
    },
    async provar(tx, e) {
      const l = await relerPelaChave(tx, d, e.codigo);
      exigirEfeito(!l, `${d.tabela}: o item não existe mais`);
      // Recontagem das referências sem FK antes do COMMIT (as FKs o banco recusa sozinho).
      const lida = lidasNaExclusao.get(e);
      exigirEfeito(lida, `${d.tabela}: a linha lida antes da exclusão`);
      if (mapa.referenciasLogicas.length > 0 || (mapa.derivadas?.length ?? 0) > 0) {
        const v = await verificarDependencias(tx, {
          mapa,
          linha: lida.linha,
          chave: valoresDaChave(d, e.codigo),
          rotulo: rotuloDaTabela,
          soLogicas: true,
        });
        if (v.length > 0)
          throw recusa(
            'vinculo-concorrente',
            frasesDosDependentes(
              v,
              'Este item',
              'O vínculo foi criado enquanto a exclusão era gravada: nada foi apagado.',
            ),
            { dependentes: dependentesDoProblema(v) },
          );
      }
    },
    async registrarSgh(es, e, _r, ctx) {
      const lida = lidasNaExclusao.get(e);
      exigirEfeito(lida, `${d.tabela}: a linha lida antes da exclusão`);
      if (protegida) {
        exigirEfeito(lida.retrato, 'SGH_HIST_EXCLUSAO: retrato antes da exclusão');
        await gravarRetrato(es, lida.retrato, {
          hospital: ctx.hospital,
          operacao: receita.nome,
          motivo: e.motivo,
          usuario: ctx.usuarioLegado,
        });
      }
      for (const f of lida.filhas)
        await gravarRetrato(es, f, {
          hospital: ctx.hospital,
          operacao: receita.nome,
          motivo: e.motivo,
          usuario: ctx.usuarioLegado,
        });
      // Revisão do W0-02: a marca de inativação só no novo sai junto com o item (sempre: também a que outra pessoa
      // tenha gravado depois da leitura).
      if (soNoNovo)
        await es.executar('DELETE FROM SGH_CFG_DOMINIO_SITUACAO WHERE TABELA = ? AND CHAVE = ?', [
          d.tabela,
          e.codigo,
        ]);
      const anterior = valorAnterior(d, lida.linha);
      await gravarEventoCrud(es, {
        hospital: ctx.hospital,
        operacao: receita.nome,
        recurso: `${d.publico.modulo}.${d.publico.recurso}`,
        evento: 'excluido',
        tabela: d.tabela,
        chave: e.codigo,
        motivo: e.motivo,
        valorAnterior:
          anterior && lida.marcaNoNovo
            ? {
                ...anterior,
                ativo: false,
                inativoSoNoNovo: { desde: lida.marcaNoNovo.desde, autor: lida.marcaNoNovo.autor },
              }
            : anterior,
        idempotencia: ctx.idempotencyKey,
        estacao: ctx.estacao ?? null,
        usuario: ctx.usuarioLegado,
      });
    },
    eventos: (_e, r) => [{ tipo: receita.evento, carga: { codigo: codigoDoEvento(r.codigo) } }],
    alvo: (_e, r) => alvoDaOperacao(d, r),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OperacaoDominio = Operacao<any, SaidaDominio>;

/**
 * As operações de gravação do domínio editável (incluir sempre; alterar e inativar quando a declaração tem). W0-02:
 * reativar onde há coluna de situação do legado (junto da inativação) e excluir só no domínio que declara `excluir`.
 */
export function operacoesDoDominio(
  d: DeclaracaoDominio,
  lerUso: LerUso,
  resolver: ResolverDominio = () => undefined,
  rotuloDaTabela: RotuloDaTabela = () => undefined,
): OperacaoDominio[] {
  if (d.publico.natureza !== 'editavel') return [];
  const r: OperacaoDominio[] = [];
  if (d.publico.acoes.includes('criar')) r.push(operacaoIncluir(d, resolver) as OperacaoDominio);
  if (d.publico.acoes.includes('editar')) r.push(operacaoAlterar(d, resolver) as OperacaoDominio);
  // M14: sem coluna de situação provada, a inativação vale só no novo (SGH_CFG_DOMINIO_SITUACAO): não é
  // operação do legado (config/gravacao/dominio-situacao.ts, sem receita nem passo em tabela do legado).
  if (d.publico.acoes.includes('inativar') && d.situacao) {
    r.push(operacaoInativar(d, lerUso) as OperacaoDominio);
    r.push(operacaoReativar(d) as OperacaoDominio);
  }
  if (d.publico.acoes.includes('excluir')) r.push(operacaoExcluir(d, rotuloDaTabela) as OperacaoDominio);
  return r;
}

/** Versão do item como a tela a recebe (colunas mostradas). */
export function versaoDaLinha(d: DeclaracaoDominio, l: Linha): string {
  const i = itemDaLinha(d, l);
  return versaoDoItem(i.valores, i.ativo);
}

export { recursoMaiusculo };
