// Registro clínico no banco PRÓPRIO do cliente (MariaDB, pelo @sgh/nucleo): os métodos da porta dos registros que a
// PortaRegistroPropria ainda recusa com 501 (profissional da sessão, definição do formulário, rascunhos, último
// registro, histórico, cabeçalhos, respostas, prova, modelos de impressão, liberação e as gravações). O integrador
// troca os pendentes da porta pelas chamadas desta classe (construída com o mesmo núcleo e cliente).
//
// A especificação é a porta de memória (registro-porta-memoria.ts): os mesmos filtros (estabelecimento da sessão,
// paciente, modelo, situação), a mesma ordenação (o mais novo primeiro), a versão do rascunho que recusa a gravação
// sobre o rascunho alterado, os mesmos erros de domínio e a trilha de cada gravação (pelo Executor, na transação).
//
// O formulário de preenchimento sai da versão PUBLICADA do modelo (modelo_campo e modelo_campo_opcao): cada campo vira
// um componente com a ordem hierárquica (dois dígitos por nível, pelo pai e pela sequência), que é a chave da linha da
// resposta. Na gravação a linha volta ao campo pela mesma ordem e vira registro_assistencial_resposta com o valor
// tipado; a leitura faz o caminho inverso. O rascunho guarda as linhas como vieram (JSON do contrato de resposta).
//
// Identidade do profissional: o "cbo" do contrato é o id do profissional (a conta da sessão → usuario_profissional
// vigente ou vínculo do estabelecimento → profissional ativo); gravar exige ainda inscrição em conselho ativa ou
// provisória dentro da validade. Registro clínico nunca é apagado: suspensão com justificativa, correção por novo
// registro que aponta o suspenso, rascunho arquivado ou descartado (situação), nunca DELETE.
import { createHash, randomUUID } from 'node:crypto';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoRegistro, ProvaLida } from './registro-porta.js';
import { dataHora, fusoValido, type NucleoLeituraPep } from './registro-porta-propria.js';
import {
  type CabecalhoDocumentoLido,
  type CabecalhoRegistroLido,
  type DefinicaoFormularioLida,
  type DescarteRascunho,
  type GravacaoEvolucao,
  type GravacaoRascunho,
  type LiberacaoConsultada,
  type LinhaGravacao,
  type LinhaRespostaLida,
  type ProfissionalDoRegistro,
  type RascunhoLido,
  type SuspensaoEvolucao,
  loginDaOperacao,
} from './tipos-pep.js';

/** O que a gravação usa do NucleoProprio (os testes trocam). */
export interface NucleoRegistroGravacao extends NucleoLeituraPep {
  criarExecutor(): Executor;
}

/** Tabelas que as gravações do registro clínico escrevem (a transação recusa as outras). */
export const TABELAS_REGISTRO = [
  'registro_assistencial',
  'registro_assistencial_resposta',
  'registro_assistencial_rascunho',
] as const;

/** Respostas de escolha múltipla: o id da resposta é este deslocamento + o id da opção (nunca colide com campo). */
export const DESLOCAMENTO_OPCAO = 1_000_000_000_000;
/** Registros devolvidos pelo histórico de uma pergunta (como a memória). */
export const TETO_HISTORICO = 20;
/** Rascunhos devolvidos por lista. */
export const TETO_RASCUNHOS = 500;

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const comMs = (v: string | null): string | null => (v === null ? null : `${v}.000`);

const TIPOS_TITULO = new Set(['secao', 'grupo', 'titulo', 'rotulo']);
const TIPOS_NUMERO = new Set(['decimal', 'inteiro', 'calculado']);
const TIPOS_ESCOLHA = new Set(['escolha', 'escolha_com_texto']);

const recusa = (status: number, codigo: string, titulo: string, detalhe: string) =>
  new ErroOperacao(status, codigo, titulo, detalhe);

// ── Campos do modelo e ordem hierárquica ─────────────────────────────────────────────────────────────

export interface OpcaoDoCampo {
  readonly id: number;
  readonly rotulo: string;
}
export interface CampoDoModelo {
  readonly id: number;
  readonly versao: number;
  readonly sequencia: number;
  readonly pai: number | null;
  readonly titulo: string;
  readonly tipo: string;
  readonly obrigatorio: boolean;
  readonly opcoes: readonly OpcaoDoCampo[];
}
export interface CampoOrdenado extends CampoDoModelo {
  /** Dois dígitos por nível (até 6 níveis, até 99 por nível); null: fora do alcance do contrato. */
  readonly ordem: string | null;
}

/** Ordem de cada campo de UMA versão: pelo pai e pela sequência (o pai inexistente na versão conta como raiz). */
export function ordenarCampos(campos: readonly CampoDoModelo[]): CampoOrdenado[] {
  const ids = new Set(campos.map((c) => c.id));
  const filhos = new Map<number | null, CampoDoModelo[]>();
  for (const c of campos) {
    const pai = c.pai !== null && ids.has(c.pai) && c.pai !== c.id ? c.pai : null;
    const l = filhos.get(pai) ?? [];
    l.push(c);
    filhos.set(pai, l);
  }
  const ordem = new Map<number, string | null>();
  const visitar = (pai: number | null, prefixo: string | null, nivel: number) => {
    const l = (filhos.get(pai) ?? []).sort((a, b) => a.sequencia - b.sequencia || a.id - b.id);
    l.forEach((c, i) => {
      if (ordem.has(c.id)) return;
      const o =
        prefixo === null || i + 1 > 99 || nivel > 6 ? null : `${prefixo}${String(i + 1).padStart(2, '0')}`;
      ordem.set(c.id, o);
      visitar(c.id, o, nivel + 1);
    });
  };
  visitar(null, '', 1);
  // Ciclo de pais (defeito do cadastro): o campo não alcançado fica sem ordem.
  return campos
    .map((c) => ({ ...c, ordem: ordem.get(c.id) ?? null }))
    .sort((a, b) => a.sequencia - b.sequencia || a.id - b.id);
}

/**
 * Campos de todas as versões do modelo, já com a ordem dentro de cada versão. Para preencher e gravar (padrão): só os
 * campos não excluídos e as opções ativas. Para LER registros (`leitura`): todos, porque a resposta gravada continua
 * sendo do campo e da opção que existiam na gravação (campo excluído ou opção desativada depois não esconde o registro).
 */
export async function camposDoModelo(
  l: Pick<Leitor, 'consultar'>,
  modelo: number,
  leitura = false,
): Promise<CampoOrdenado[]> {
  const linhas = await l.consultar(
    `SELECT c.id, c.modelo_documento_versao_id AS versao_id, c.sequencia, c.pai_modelo_campo_id, c.titulo,
            c.tipo_campo, c.obrigatorio
       FROM modelo_campo c JOIN modelo_documento_versao v ON v.id = c.modelo_documento_versao_id
      WHERE v.modelo_documento_clinico_id = ?${leitura ? '' : ' AND c.excluido_em IS NULL'}
      ORDER BY c.modelo_documento_versao_id, c.sequencia, c.id`,
    [modelo],
  );
  const opcoes = await l.consultar(
    `SELECT o.id, o.modelo_campo_id, o.rotulo
       FROM modelo_campo_opcao o JOIN modelo_campo c ON c.id = o.modelo_campo_id
       JOIN modelo_documento_versao v ON v.id = c.modelo_documento_versao_id
      WHERE v.modelo_documento_clinico_id = ?${leitura ? '' : ' AND o.ativo = TRUE'}
      ORDER BY o.modelo_campo_id, o.sequencia, o.id`,
    [modelo],
  );
  const porCampo = new Map<number, OpcaoDoCampo[]>();
  for (const o of opcoes) {
    const l2 = porCampo.get(num(o['modelo_campo_id'])) ?? [];
    l2.push({ id: num(o['id']), rotulo: String(o['rotulo']) });
    porCampo.set(num(o['modelo_campo_id']), l2);
  }
  const porVersao = new Map<number, CampoDoModelo[]>();
  for (const x of linhas) {
    const c: CampoDoModelo = {
      id: num(x['id']),
      versao: num(x['versao_id']),
      sequencia: num(x['sequencia']),
      pai: numOuNull(x['pai_modelo_campo_id']),
      titulo: String(x['titulo']),
      tipo: String(x['tipo_campo']),
      obrigatorio: Number(x['obrigatorio']) === 1,
      opcoes: porCampo.get(num(x['id'])) ?? [],
    };
    const l2 = porVersao.get(c.versao) ?? [];
    l2.push(c);
    porVersao.set(c.versao, l2);
  }
  return [...porVersao.values()].flatMap(ordenarCampos);
}

/** Classe do componente, tipo de pergunta e opções mostradas, pelo tipo do campo. */
function componenteDe(c: CampoDoModelo): { classe: string; tipo: string; opcoes: readonly string[] | null } {
  if (TIPOS_TITULO.has(c.tipo)) return { classe: 'TGroupBoxPep', tipo: '1', opcoes: null };
  if (c.tipo === 'booleano') return { classe: 'TfRespComboBox', tipo: '4', opcoes: ['', 'Não', 'Sim'] };
  if (TIPOS_ESCOLHA.has(c.tipo))
    return { classe: 'TfRespComboBox', tipo: '13', opcoes: ['', ...c.opcoes.map((o) => o.rotulo)] };
  if (c.tipo === 'multipla')
    return { classe: 'TfRespCheckListBox', tipo: '12', opcoes: c.opcoes.map((o) => o.rotulo) };
  if (c.tipo === 'data') return { classe: 'TfRespData', tipo: '2', opcoes: null };
  if (c.tipo === 'hora') return { classe: 'TfRespHora', tipo: '3', opcoes: null };
  if (TIPOS_NUMERO.has(c.tipo)) return { classe: 'TfRespEditUnidade', tipo: '7', opcoes: null };
  return { classe: 'TfRespTexto', tipo: '5', opcoes: null };
}

const citar = (t: string) => `'${t.replace(/[\r\n]+/g, ' ').replace(/'/g, "''")}'`;

/** Definição do formulário da versão publicada, no formato que o conversor do domínio lê. */
export function definicaoDosCampos(
  modelo: { id: number; codigo: string | null; titulo: string | null },
  campos: readonly CampoOrdenado[],
  numeroVersao: number,
): DefinicaoFormularioLida {
  const usados = campos.filter((c): c is CampoOrdenado & { ordem: string } => c.ordem !== null);
  const respostas: DefinicaoFormularioLida['respostas'][number][] = [];
  const componentes = usados.map((c, i) => {
    const k = componenteDe(c);
    const porOpcao = c.tipo === 'multipla' || TIPOS_ESCOLHA.has(c.tipo);
    const ids = porOpcao ? c.opcoes.map((o) => DESLOCAMENTO_OPCAO + o.id) : [c.id];
    if (porOpcao)
      c.opcoes.forEach((o, j) =>
        respostas.push({
          id: DESLOCAMENTO_OPCAO + o.id,
          idPergunta: c.id,
          cod: null,
          ordem: j + 1,
          ativo: true,
          descricao: o.rotulo,
        }),
      );
    else respostas.push({ id: c.id, idPergunta: c.id, cod: null, ordem: 0, ativo: true, descricao: null });
    const titulo = k.classe === 'TGroupBoxPep' ? 'Caption' : 'Description';
    const linhas = [
      `inherited cmp${c.id}: ${k.classe}`,
      '  Left = 5',
      `  Top = ${(i + 1) * 60}`,
      `  Width = ${k.classe === 'TfRespTexto' || k.classe === 'TGroupBoxPep' ? 744 : 350}`,
      `  Height = ${k.classe === 'TfRespTexto' ? 110 : 40}`,
      `  ${titulo} = ${citar(c.titulo)}`,
      `  Ordem = '${c.ordem}'`,
      `  Id_resposta = ${ids[0] ?? c.id}`,
      `  CampoObrigatorio = ${c.obrigatorio ? 'True' : 'False'}`,
    ];
    const lista = (xs: readonly string[]) => xs.map((x) => `      ${citar(x)}`).join('\r\n');
    if (k.opcoes && k.classe === 'TfRespComboBox')
      linhas.push(
        '  inherited cbxId_Resposta: TComboBox',
        '    Items.Strings = (',
        `${lista(['0', ...(porOpcao ? ids.map(String) : k.opcoes.slice(1).map(() => String(c.id)))])})`,
        '  end',
        '  inherited cbxResp: TValidadeComboBox',
        '    Items.Strings = (',
        `${lista(k.opcoes)})`,
        '  end',
      );
    if (k.opcoes && k.opcoes.length && k.classe === 'TfRespCheckListBox')
      linhas.push(
        '  inherited clbResp: TCheckListBox',
        '    Items.Strings = (',
        `${lista(k.opcoes)})`,
        '  end',
      );
    linhas.push('end');
    return {
      id: c.id,
      idVinculo: c.id,
      classe: k.classe,
      pai: 'jvsBox',
      ordemCriacao: i,
      dfm: linhas.join('\r\n'),
    };
  });
  return {
    modelo: { id: modelo.id, codigo: modelo.codigo, descricao: modelo.titulo, fase: 2 },
    vinculos: usados.map((c) => ({
      id: c.id,
      idPergunta: c.id,
      ordem: c.ordem,
      obrigatorio: c.obrigatorio ? 'T' : 'F',
      ativo: 'T',
    })),
    perguntas: usados.map((c) => ({
      id: c.id,
      codPergunta: c.sequencia,
      descricao: c.titulo,
      tipo: componenteDe(c).tipo,
      unidade: null,
      ativo: 'T',
      manterHist: 0,
    })),
    respostas,
    componentes,
    versoes: [{ versao: numeroVersao, componentes: componentes.length }],
    colunasGrade: [],
    bytesDfm: componentes.reduce((s, x) => s + x.dfm.length, 0),
  };
}

// ── Linhas do contrato ↔ respostas tipadas ───────────────────────────────────────────────────────────

/** Linha com algum valor (o título de seção não tem; não vira resposta). */
export const temValor = (l: {
  data: unknown;
  hora: unknown;
  indice: unknown;
  valor: unknown;
  alfa: unknown;
  texto: unknown;
  cid: unknown;
}): boolean => [l.data, l.hora, l.indice, l.valor, l.alfa, l.texto, l.cid].some((v) => v !== null);

export interface RespostaTipada {
  readonly modelo_campo_id: number;
  readonly tipo_valor: string;
  readonly valor_texto: string | null;
  readonly valor_numero: number | null;
  readonly valor_data: string | null;
  readonly valor_hora: string | null;
  readonly valor_booleano: boolean | null;
  readonly modelo_campo_opcao_id: number | null;
  readonly codigo_cid10: string | null;
  readonly unidade: string | null;
  readonly autopreenchido: boolean;
}

const respostaInvalida = (detalhe: string) =>
  recusa(422, 'resposta-fora-do-modelo', 'Resposta recusada', detalhe);

/** A linha do contrato no campo da versão publicada (pela ordem), com o valor na coluna do tipo. */
export function respostaDaLinha(
  l: LinhaGravacao,
  campos: ReadonlyMap<string, CampoOrdenado>,
): RespostaTipada {
  const c = campos.get(l.ordem);
  if (!c)
    throw respostaInvalida(`A resposta de ordem ${l.ordem} não é de um campo da versão publicada do modelo.`);
  const base = {
    modelo_campo_id: c.id,
    valor_texto: null,
    valor_numero: null,
    valor_data: null,
    valor_hora: null,
    valor_booleano: null,
    modelo_campo_opcao_id: null,
    codigo_cid10: null,
    unidade: null,
    autopreenchido: (l as { autopreenchido?: boolean }).autopreenchido === true,
  };
  if (l.cid !== null) return { ...base, tipo_valor: 'cid', codigo_cid10: l.cid.replace('.', '') };
  const daLista = c.opcoes.find((x) => DESLOCAMENTO_OPCAO + x.id === l.idResposta);
  if (c.tipo === 'multipla') {
    // A marcada vem pelo id da resposta da opção; sem ele, pela posição na lista (a partir de 0).
    const o =
      daLista ??
      (l.idResposta < DESLOCAMENTO_OPCAO && l.indice !== null ? c.opcoes[Number(l.indice)] : undefined);
    if (!o) throw respostaInvalida(`A opção marcada não é do campo de ordem ${l.ordem}.`);
    return { ...base, tipo_valor: 'opcao', modelo_campo_opcao_id: o.id, valor_texto: l.alfa };
  }
  if (c.tipo === 'booleano' && l.indice !== null && Number(l.indice) > 0) {
    if (Number(l.indice) > 2) throw respostaInvalida(`Valor fora de Sim/Não no campo de ordem ${l.ordem}.`);
    return { ...base, tipo_valor: 'booleano', valor_booleano: Number(l.indice) === 2 };
  }
  if (TIPOS_ESCOLHA.has(c.tipo) && l.indice !== null && Number(l.indice) > 0) {
    // Pelo id da resposta da opção; sem ele, pela posição na lista (a partir de 1: o 0 é o vazio).
    const o = l.idResposta >= DESLOCAMENTO_OPCAO ? daLista : c.opcoes[Number(l.indice) - 1];
    if (!o) throw respostaInvalida(`A opção escolhida não é do campo de ordem ${l.ordem}.`);
    return { ...base, tipo_valor: 'opcao', modelo_campo_opcao_id: o.id, valor_texto: l.alfa };
  }
  if (l.data !== null && l.hora === null) return { ...base, tipo_valor: 'data', valor_data: l.data };
  if (l.hora !== null && l.data === null)
    return { ...base, tipo_valor: 'hora', valor_hora: `${l.hora.slice(0, 2)}:${l.hora.slice(2, 4)}:00` };
  if (l.valor !== null)
    return { ...base, tipo_valor: 'numero', valor_numero: l.valor, unidade: l.unidade || null };
  const texto = l.texto ?? l.alfa ?? (l.data !== null ? `${l.data} ${l.hora ?? ''}`.trim() : null);
  return { ...base, tipo_valor: c.tipo === 'texto_formatado' ? 'formatado' : 'texto', valor_texto: texto };
}

/** Respostas gravadas → linhas do contrato (o caminho inverso; campos de versões antigas pela ordem da versão). */
export function linhasDasRespostas(
  linhas: readonly Record<string, unknown>[],
  campos: ReadonlyMap<number, CampoOrdenado>,
): LinhaRespostaLida[] {
  const seqs = new Map<number, number>();
  const saida: LinhaRespostaLida[] = [];
  for (const x of linhas) {
    const c = campos.get(num(x['modelo_campo_id']));
    if (!c || c.ordem === null) continue;
    const seq = seqs.get(c.id) ?? 0;
    seqs.set(c.id, seq + 1);
    const tipo = String(x['tipo_valor']);
    const opcao = numOuNull(x['modelo_campo_opcao_id']);
    const texto = textoOuNull(x['valor_texto']);
    const pos = opcao === null ? -1 : c.opcoes.findIndex((o) => o.id === opcao);
    const hora = textoOuNull(x['valor_hora']);
    const data = x['valor_data'];
    const cid = textoOuNull(x['codigo_cid10']);
    // O complemento da escolha (texto livre) é a linha de sequência 1 do mesmo campo.
    const complemento = TIPOS_ESCOLHA.has(c.tipo) && tipo !== 'opcao';
    saida.push({
      ordem: c.ordem,
      seq: c.tipo === 'multipla' ? seq : complemento ? 1 : 0,
      idResposta:
        (c.tipo === 'multipla' || TIPOS_ESCOLHA.has(c.tipo)) && opcao !== null
          ? DESLOCAMENTO_OPCAO + opcao
          : c.id,
      data:
        tipo === 'data' && data !== null && data !== undefined
          ? data instanceof Date
            ? data.toISOString().slice(0, 10)
            : String(data).slice(0, 10)
          : null,
      hora: tipo === 'hora' && hora ? hora.replace(':', '').slice(0, 4) : null,
      indice:
        tipo === 'booleano'
          ? Number(x['valor_booleano'])
            ? '2'
            : '1'
          : tipo === 'opcao' && pos >= 0
            ? String(c.tipo === 'multipla' ? pos : pos + 1)
            : null,
      valor: tipo === 'numero' ? numOuNull(x['valor_numero']) : null,
      alfa: tipo === 'opcao' || complemento ? texto : null,
      texto: (tipo === 'texto' || tipo === 'formatado') && !complemento ? texto : null,
      unidade: textoOuNull(x['unidade']),
      cid: cid && cid.length > 3 ? `${cid.slice(0, 3)}.${cid.slice(3)}` : cid,
      procedimento: null,
      observacao: textoOuNull(x['observacao']),
      autopreenchido: Number(x['autopreenchido']) === 1,
    });
  }
  return saida;
}

// ── Datas ────────────────────────────────────────────────────────────────────────────────────────────

/** Hora civil local (AAAA-MM-DDTHH:MM[:SS]) no fuso do estabelecimento → instante UTC; independe do TZ da máquina. */
export function localParaUtc(local: string, fuso: string): Date {
  const alvo = Date.parse(`${local.length === 16 ? `${local}:00` : local.slice(0, 19)}Z`);
  if (Number.isNaN(alvo))
    throw recusa(400, 'data-invalida', 'Data inválida', 'A data e hora não são válidas.');
  const local_ = (t: number) => Date.parse(`${dataHora(new Date(t), fuso)}Z`);
  let t = alvo - (local_(alvo) - alvo);
  t += alvo - local_(t);
  return new Date(t);
}

/** Versão do rascunho que a tela leva (muda a cada alteração da linha). */
export const versaoDoRascunho = (id: number, versaoLinha: number): string =>
  createHash('sha256').update(`rascunho:${id}:${versaoLinha}`).digest('hex').slice(0, 32);

/** Linhas do rascunho guardadas em JSON (o contrato de resposta); o que não for lista vira lista vazia. */
export function linhasDoRascunho(v: unknown): LinhaGravacao[] {
  const x = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return Array.isArray(x) ? (x as LinhaGravacao[]) : [];
}

// ── Trilha e selo do conteúdo ─────────────────────────────────────────────────────────────────────────

export const OP_REGISTRAR = 'pep.registro.registrar';
export const OP_SALVAR_RASCUNHO = 'pep.registro.salvar-rascunho';
export const OP_DESCARTAR_RASCUNHO = 'pep.registro.descartar-rascunho';
export const OP_SUSPENDER = 'pep.registro.suspender';

/** Uma linha da trilha (dados_depois) de uma gravação desta família. */
export interface TrilhaLida {
  readonly entidadeId: number;
  readonly operacao: string | null;
  readonly dados: Record<string, unknown> | null;
  /** Origem da sessão "como" (ADR 0021) gravada pelo Executor; null fora dela. */
  readonly origem: unknown;
}

const jsonOuNull = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return null;
  }
};

/** As linhas da trilha das gravações desta família sobre as linhas dadas (na ordem em que ocorreram). */
export async function trilhasDe(
  l: Pick<Leitor, 'consultar'>,
  estabelecimento: number,
  entidade: string,
  ids: readonly number[],
  operacoes: readonly string[],
): Promise<TrilhaLida[]> {
  if (!ids.length) return [];
  const linhas = await l.consultar(
    `SELECT entidade_id, JSON_UNQUOTE(JSON_EXTRACT(dados_depois, '$.operacao')) AS operacao,
            JSON_EXTRACT(dados_depois, '$.dados') AS dados, JSON_EXTRACT(dados_depois, '$.origem') AS origem
       FROM trilha_auditoria
      WHERE entidade = ? AND entidade_id IN (${ids.map(() => '?').join(', ')})
        AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
        AND JSON_UNQUOTE(JSON_EXTRACT(dados_depois, '$.operacao')) IN (${operacoes.map(() => '?').join(', ')})
      ORDER BY id`,
    [entidade, ...ids, estabelecimento, ...operacoes],
  );
  return linhas.map((x) => {
    const dados = jsonOuNull(x['dados']);
    return {
      entidadeId: num(x['entidade_id']),
      operacao: textoOuNull(x['operacao']),
      dados: dados !== null && typeof dados === 'object' ? (dados as Record<string, unknown>) : null,
      origem: jsonOuNull(x['origem']),
    };
  });
}

/** A gravação ou a suspensão veio de uma sessão de suporte (a marca do serviço ou a origem "como" do Executor). */
export const deSuporte = (t: TrilhaLida): boolean => t.dados?.['comoSuporte'] === true || t.origem !== null;

/** As marcas de suporte técnico do registro, como a memória: 'criado' e/ou 'suspenso', na ordem da trilha. */
export function marcasDeSuporte(trilhas: readonly TrilhaLida[]): ('criado' | 'suspenso')[] {
  const marcas: ('criado' | 'suspenso')[] = [];
  for (const t of trilhas) {
    if (!deSuporte(t)) continue;
    const m = t.operacao === OP_REGISTRAR ? 'criado' : t.operacao === OP_SUSPENDER ? 'suspenso' : null;
    if (m && !marcas.includes(m)) marcas.push(m);
  }
  return marcas;
}

/**
 * Selo do conteúdo gravado: SHA-256 das colunas de conteúdo do registro (não as da suspensão) e de TODAS as linhas de
 * resposta (com versão, alteração e exclusão), lidas como texto pelo próprio banco. Calculado na transação da gravação
 * (vai à trilha encadeada) e recalculado na prova: qualquer inclusão, alteração ou exclusão feita fora deste sistema
 * no registro ou nas respostas faz o atual divergir do guardado.
 */
export async function seloDoConteudo(
  l: Pick<Leitor, 'uma' | 'consultar'>,
  registro: number,
): Promise<string | null> {
  const r = await l.uma(
    `SELECT CAST(id AS CHAR) AS id, CAST(estabelecimento_id AS CHAR) AS est, CAST(paciente_id AS CHAR) AS pac,
            CAST(atendimento_id AS CHAR) AS atd, CAST(modelo_documento_clinico_id AS CHAR) AS modelo,
            CAST(autor_profissional_id AS CHAR) AS autor, CAST(autor_usuario_id AS CHAR) AS usuario,
            CAST(data_hora_clinica AS CHAR) AS clinica, CAST(data_hora_lancamento AS CHAR) AS lancamento,
            justificativa_retroativo AS retro, impressao_digital AS impressao, texto_consolidado AS texto,
            CAST(corrige_registro_assistencial_id AS CHAR) AS corrige, CAST(excluido_em AS CHAR) AS excluido
       FROM registro_assistencial WHERE id = ?`,
    [registro],
  );
  if (!r) return null;
  const s = await l.consultar(
    `SELECT CAST(id AS CHAR) AS id, CAST(sequencia AS CHAR) AS seq, CAST(modelo_campo_id AS CHAR) AS campo, tipo_valor,
            valor_texto, CAST(valor_numero AS CHAR) AS numero, CAST(valor_data AS CHAR) AS data,
            CAST(valor_data_hora AS CHAR) AS data_hora, CAST(valor_hora AS CHAR) AS hora,
            CAST(valor_booleano AS CHAR) AS booleano, CAST(modelo_campo_opcao_id AS CHAR) AS opcao,
            CAST(valor_estruturado AS CHAR) AS estruturado, codigo_cid10, justificativa_diagnostico, unidade,
            CAST(arquivo_id AS CHAR) AS arquivo, observacao, CAST(autopreenchido AS CHAR) AS auto,
            CAST(confirmado AS CHAR) AS confirmado, CAST(versao AS CHAR) AS versao,
            CAST(alterado_em AS CHAR) AS alterado, CAST(excluido_em AS CHAR) AS excluido
       FROM registro_assistencial_resposta WHERE registro_assistencial_id = ? ORDER BY id`,
    [registro],
  );
  const valores = (x: Record<string, unknown>) =>
    Object.keys(x)
      .sort()
      .map((k) => [k, x[k] ?? null]);
  return createHash('sha256')
    .update(JSON.stringify([valores(r), s.map(valores)]), 'utf8')
    .digest('hex');
}

/** Lançamento de cada rascunho: o do primeiro da cadeia (gravado na trilha de cada salvamento), como a memória. */
export async function lancamentosDosRascunhos(
  l: Pick<Leitor, 'consultar'>,
  estabelecimento: number,
  ids: readonly number[],
): Promise<Map<number, string>> {
  const m = new Map<number, string>();
  for (const t of await trilhasDe(l, estabelecimento, 'registro_assistencial_rascunho', ids, [
    OP_SALVAR_RASCUNHO,
  ])) {
    const v = t.dados?.['lancadoEm'];
    if (typeof v === 'string' && !m.has(t.entidadeId)) m.set(t.entidadeId, v);
  }
  return m;
}

// ── Classe ───────────────────────────────────────────────────────────────────────────────────────────

interface Estabelecimento {
  readonly id: number;
  readonly fuso: string;
  readonly nome: string | null;
}
interface ProfissionalDaSessao {
  readonly usuario: number;
  readonly profissional: number;
  readonly nome: string | null;
  readonly ativo: boolean;
  readonly inscricaoAtiva: boolean;
  readonly ocupacao: number | null;
}
type Consultor = Pick<Leitor, 'uma' | 'consultar'>;

const SQL_RASCUNHO = `SELECT r.id, r.paciente_id, r.modelo_documento_clinico_id, r.atendimento_id, r.autor_profissional_id,
       r.data_hora_clinica, r.criado_em, r.justificativa_retroativo, r.respostas, r.situacao, r.origem, r.versao,
       r.corrige_registro_assistencial_id, m.codigo AS modelo_codigo, m.titulo AS modelo_titulo,
       CASE WHEN COALESCE(p.usa_nome_social, pf.usa_nome_social) THEN COALESCE(p.nome_social, pf.nome_social, pf.nome)
            ELSE pf.nome END AS paciente_nome
  FROM registro_assistencial_rascunho r
  JOIN modelo_documento_clinico m ON m.id = r.modelo_documento_clinico_id
  LEFT JOIN paciente p ON p.id = r.paciente_id
  LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id`;

export class RegistroPropriaGravacao {
  private executorPronto: Executor | null;

  constructor(
    private readonly nucleo: NucleoRegistroGravacao,
    /** Cliente desta API (configuração; um banco por cliente), quando o contexto da sessão não o traz. */
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executorPronto = executor ?? null;
  }

  private get executor(): Executor {
    this.executorPronto ??= this.nucleo.criarExecutor();
    return this.executorPronto;
  }

  private ler<T>(c: ContextoRegistro, rotulo: string, fn: (l: Leitor, est: Estabelecimento) => Promise<T>) {
    return this.nucleo.lerSomente(
      { cliente: c.cliente || this.cliente, correlacao: `pep.registro.${rotulo}` },
      async (l) => fn(l, await estabelecimentoDe(l, c.hospital)),
    );
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────

  profissional(c: ContextoRegistro, login: string): Promise<ProfissionalDoRegistro | null> {
    return this.ler(c, 'profissional', async (l, est) => {
      const p = await profissionalDaSessao(l, est.id, { login });
      if (!p || !p.ativo) return null;
      const esp = await l.consultar(
        `SELECT especialidade_medica_id FROM profissional_especialidade
          WHERE profissional_id = ? AND ativo = TRUE AND excluido_em IS NULL
          ORDER BY principal DESC, especialidade_medica_id`,
        [p.profissional],
      );
      return {
        idUsuario: p.usuario,
        idProfissional: p.profissional,
        nome: p.nome,
        cbo: p.profissional,
        cbos: [p.profissional],
        especialidades: esp.map((x) => num(x['especialidade_medica_id'])),
        // A tolerância de lançamento retroativo é regra do serviço (com justificativa), como na memória.
        permiteRetroativo: true,
      };
    });
  }

  podeGravar(c: ContextoRegistro, _operacao: string, login: string): Promise<LiberacaoConsultada> {
    return this.ler(c, 'podeGravar', async (l, est) => {
      const p = await profissionalDaSessao(l, est.id, { login });
      if (!p)
        return {
          pode: false,
          codigo: 'sem-profissional',
          motivo: 'A conta da sessão não está ligada a um profissional.',
        };
      if (!p.ativo)
        return {
          pode: false,
          codigo: 'profissional-inativo',
          motivo: 'O profissional da sessão não está ativo.',
        };
      if (!p.inscricaoAtiva)
        return {
          pode: false,
          codigo: 'sem-inscricao-ativa',
          motivo: 'O profissional da sessão não tem inscrição em conselho ativa e dentro da validade.',
        };
      return { pode: true, codigo: null, motivo: null };
    });
  }

  definicao(c: ContextoRegistro, modelo: number): Promise<DefinicaoFormularioLida | null> {
    return this.ler(c, 'definicao', async (l) => {
      const m = await l.uma(
        `SELECT m.id, m.codigo, m.titulo, m.publicada_modelo_documento_versao_id AS publicada, v.numero_versao
           FROM modelo_documento_clinico m
           JOIN modelo_documento_versao v ON v.id = m.publicada_modelo_documento_versao_id
          WHERE m.id = ? AND m.situacao IN ('publicado', 'aposentado') AND m.excluido_em IS NULL`,
        [modelo],
      );
      if (!m) return null;
      const campos = (await camposDoModelo(l, modelo)).filter((x) => x.versao === num(m['publicada']));
      return definicaoDosCampos(
        { id: num(m['id']), codigo: textoOuNull(m['codigo']), titulo: textoOuNull(m['titulo']) },
        campos,
        num(m['numero_versao']),
      );
    });
  }

  private rascunhoLido(
    x: Record<string, unknown>,
    fuso: string,
    lancados: ReadonlyMap<number, string>,
  ): RascunhoLido {
    const linhas = linhasDoRascunho(x['respostas']);
    return {
      id: num(x['id']),
      paciente: num(x['paciente_id']),
      pacienteNome: textoOuNull(x['paciente_nome']),
      modelo: num(x['modelo_documento_clinico_id']),
      modeloCodigo: textoOuNull(x['modelo_codigo']),
      modeloNome: textoOuNull(x['modelo_titulo']),
      idHtAtendimento: num(x['atendimento_id']),
      atendimento: num(x['atendimento_id']),
      cbo: num(x['autor_profissional_id']),
      dataHoraClinica: comMs(dataHora(x['data_hora_clinica'], fuso)),
      // O lançamento é o do primeiro rascunho da cadeia (a versão encadeada é o mesmo lançamento).
      lancadoEm: comMs(dataHora(lancados.get(num(x['id'])) ?? x['criado_em'], fuso)),
      justificativa: textoOuNull(x['justificativa_retroativo']),
      respostas: new Set(linhas.filter(temValor).map((y) => y.ordem)).size,
      versao: versaoDoRascunho(num(x['id']), num(x['versao'])),
      doNovo: x['origem'] === 'sistema',
      corrige: numOuNull(x['corrige_registro_assistencial_id']),
    };
  }

  rascunhosDoProfissional(c: ContextoRegistro, cbos: readonly number[]): Promise<RascunhoLido[]> {
    if (!cbos.length) return Promise.resolve([]);
    return this.ler(c, 'rascunhosDoProfissional', async (l, est) => {
      const linhas = await l.consultar(
        `${SQL_RASCUNHO}
          WHERE r.estabelecimento_id = ? AND r.situacao = 'aberto' AND r.excluido_em IS NULL
            AND r.autor_profissional_id IN (${cbos.map(() => '?').join(', ')})
          ORDER BY r.id DESC LIMIT ${TETO_RASCUNHOS}`,
        [est.id, ...cbos],
      );
      const lancados = await lancamentosDosRascunhos(
        l,
        est.id,
        linhas.map((x) => num(x['id'])),
      );
      return linhas.map((x) => this.rascunhoLido(x, est.fuso, lancados));
    });
  }

  rascunhosDoPaciente(c: ContextoRegistro, paciente: number, modelo: number): Promise<RascunhoLido[]> {
    return this.ler(c, 'rascunhosDoPaciente', async (l, est) => {
      const linhas = await l.consultar(
        `${SQL_RASCUNHO}
          WHERE r.estabelecimento_id = ? AND r.situacao = 'aberto' AND r.excluido_em IS NULL
            AND r.paciente_id = ? AND r.modelo_documento_clinico_id = ?
          ORDER BY r.id DESC LIMIT ${TETO_RASCUNHOS}`,
        [est.id, paciente, modelo],
      );
      const lancados = await lancamentosDosRascunhos(
        l,
        est.id,
        linhas.map((x) => num(x['id'])),
      );
      return linhas.map((x) => this.rascunhoLido(x, est.fuso, lancados));
    });
  }

  lerRascunho(
    c: ContextoRegistro,
    id: number,
  ): Promise<{
    rascunho: RascunhoLido;
    linhas: LinhaRespostaLida[];
    aberto: boolean;
    substituido: boolean;
  } | null> {
    return this.ler(c, 'lerRascunho', async (l, est) => {
      const x = await l.uma(
        `${SQL_RASCUNHO} WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL`,
        [id, est.id],
      );
      if (!x) return null;
      return {
        rascunho: this.rascunhoLido(x, est.fuso, await lancamentosDosRascunhos(l, est.id, [id])),
        linhas: linhasDoRascunho(x['respostas']).map((y) => ({
          ...y,
          procedimento: null,
          observacao: null,
          autopreenchido: (y as { autopreenchido?: boolean }).autopreenchido === true,
        })),
        aberto: x['situacao'] === 'aberto',
        substituido: x['situacao'] === 'arquivado',
      };
    });
  }

  private async respostas(l: Leitor, modelo: number, registros: readonly number[]) {
    const porRegistro = new Map<number, LinhaRespostaLida[]>();
    if (!registros.length) return porRegistro;
    const campos = new Map((await camposDoModelo(l, modelo, true)).map((x) => [x.id, x] as const));
    const linhas = await l.consultar(
      `SELECT registro_assistencial_id, modelo_campo_id, tipo_valor, valor_texto, valor_numero, valor_data, valor_hora,
              valor_booleano, modelo_campo_opcao_id, codigo_cid10, unidade, observacao, autopreenchido
         FROM registro_assistencial_resposta
        WHERE registro_assistencial_id IN (${registros.map(() => '?').join(', ')}) AND excluido_em IS NULL
        ORDER BY registro_assistencial_id, sequencia`,
      [...registros],
    );
    for (const id of registros)
      porRegistro.set(
        id,
        linhasDasRespostas(
          linhas.filter((x) => num(x['registro_assistencial_id']) === id),
          campos,
        ),
      );
    return porRegistro;
  }

  ultimoRegistro(
    c: ContextoRegistro,
    paciente: number,
    modelo: number,
  ): Promise<{ registro: number; linhas: LinhaRespostaLida[] } | null> {
    return this.ler(c, 'ultimoRegistro', async (l, est) => {
      const x = await l.uma(
        `SELECT id FROM registro_assistencial
          WHERE estabelecimento_id = ? AND paciente_id = ? AND modelo_documento_clinico_id = ?
            AND suspenso_em IS NULL AND excluido_em IS NULL
          ORDER BY id DESC LIMIT 1`,
        [est.id, paciente, modelo],
      );
      if (!x) return null;
      const id = num(x['id']);
      return { registro: id, linhas: (await this.respostas(l, modelo, [id])).get(id) ?? [] };
    });
  }

  historico(
    c: ContextoRegistro,
    paciente: number,
    modelo: number,
    ordem: string,
  ): Promise<{ registro: number; dataHora: string | null; linhas: LinhaRespostaLida[] }[]> {
    return this.ler(c, 'historico', async (l, est) => {
      const campos = (await camposDoModelo(l, modelo, true))
        .filter((x) => x.ordem === ordem)
        .map((x) => x.id);
      if (!campos.length) return [];
      const regs = await l.consultar(
        `SELECT r.id, r.data_hora_clinica FROM registro_assistencial r
          WHERE r.estabelecimento_id = ? AND r.paciente_id = ? AND r.modelo_documento_clinico_id = ?
            AND r.suspenso_em IS NULL AND r.excluido_em IS NULL
            AND EXISTS (SELECT 1 FROM registro_assistencial_resposta s
                         WHERE s.registro_assistencial_id = r.id AND s.excluido_em IS NULL
                           AND s.modelo_campo_id IN (${campos.map(() => '?').join(', ')}))
          ORDER BY r.id DESC LIMIT ${TETO_HISTORICO}`,
        [est.id, paciente, modelo, ...campos],
      );
      const ids = regs.map((x) => num(x['id']));
      const resp = await this.respostas(l, modelo, ids);
      return regs.map((x) => ({
        registro: num(x['id']),
        dataHora: comMs(dataHora(x['data_hora_clinica'], est.fuso)),
        linhas: (resp.get(num(x['id'])) ?? []).filter((y) => y.ordem === ordem),
      }));
    });
  }

  cabecalhoRegistro(c: ContextoRegistro, registro: number): Promise<CabecalhoRegistroLido | null> {
    return this.ler(c, 'cabecalhoRegistro', async (l, est) => {
      const x = await l.uma(
        `SELECT r.id, r.paciente_id, r.modelo_documento_clinico_id, r.atendimento_id, r.autor_profissional_id,
                r.data_hora_clinica, r.data_hora_lancamento, r.suspenso_em, r.justificativa_suspensao,
                r.corrige_registro_assistencial_id, COALESCE(p.nome_exibicao, pf.nome) AS profissional_nome
           FROM registro_assistencial r
           LEFT JOIN profissional p ON p.id = r.autor_profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL`,
        [registro, est.id],
      );
      if (!x) return null;
      return {
        id: num(x['id']),
        paciente: num(x['paciente_id']),
        modelo: num(x['modelo_documento_clinico_id']),
        idHtPaciente: num(x['paciente_id']),
        idHtAtendimento: num(x['atendimento_id']),
        atendimento: num(x['atendimento_id']),
        cbo: num(x['autor_profissional_id']),
        dataHoraClinica: comMs(dataHora(x['data_hora_clinica'], est.fuso)),
        lancadoEm: comMs(dataHora(x['data_hora_lancamento'], est.fuso)),
        suspensoEm: comMs(dataHora(x['suspenso_em'], est.fuso)),
        justificativaSuspensao: textoOuNull(x['justificativa_suspensao']),
        profissionalNome: textoOuNull(x['profissional_nome']),
        corrige: numOuNull(x['corrige_registro_assistencial_id']),
      };
    });
  }

  respostasRegistro(c: ContextoRegistro, registro: number): Promise<LinhaRespostaLida[]> {
    return this.ler(c, 'respostasRegistro', async (l, est) => {
      const x = await l.uma(
        'SELECT modelo_documento_clinico_id FROM registro_assistencial WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [registro, est.id],
      );
      if (!x) return [];
      return (await this.respostas(l, num(x['modelo_documento_clinico_id']), [registro])).get(registro) ?? [];
    });
  }

  /**
   * Prova de integridade: a impressão digital guardada na finalização. O "atual" diverge do guardado quando o selo do
   * conteúdo (seloDoConteudo, guardado na trilha da gravação) não confere com o recalculado agora, ou quando alguma
   * resposta foi alterada ou excluída depois da gravação. As marcas de suporte técnico saem da trilha da gravação e da
   * suspensão. Registro sem prova (de migração): nulos.
   */
  prova(c: ContextoRegistro, registro: number): Promise<ProvaLida> {
    return this.ler(c, 'prova', async (l, est) => {
      const x = await l.uma(
        `SELECT r.impressao_digital,
                (SELECT COUNT(*) FROM registro_assistencial_resposta s
                  WHERE s.registro_assistencial_id = r.id
                    AND (s.alterado_em IS NOT NULL OR s.excluido_em IS NOT NULL OR s.versao > 1)) AS alteradas
           FROM registro_assistencial r
          WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.origem = 'sistema'`,
        [registro, est.id],
      );
      const hash = textoOuNull(x?.['impressao_digital']);
      if (!x || !hash) return { guardado: null, hashConteudo: null, atual: null, comoSuporte: [] };
      const trilhas = await trilhasDe(
        l,
        est.id,
        'registro_assistencial',
        [registro],
        [OP_REGISTRAR, OP_SUSPENDER],
      );
      // O selo guardado na trilha (encadeada) da gravação, recalculado sobre o que está gravado agora.
      const selo = trilhas.find((t) => t.operacao === OP_REGISTRAR)?.dados?.['selo'];
      const alteradoFora =
        num(x['alteradas']) > 0 || (typeof selo === 'string' && selo !== (await seloDoConteudo(l, registro)));
      return {
        guardado: hash,
        hashConteudo: hash,
        atual: alteradoFora ? `${hash.slice(0, 63)}x` : hash,
        comoSuporte: marcasDeSuporte(trilhas),
      };
    });
  }

  cabecalhoDocumento(
    c: ContextoRegistro,
    retratos: { readonly htPaciente: number; readonly htAtendimento: number },
    cbo: number,
    situacao: number,
  ): Promise<CabecalhoDocumentoLido> {
    return this.ler(c, 'cabecalhoDocumento', async (l, est) => {
      const pac = await l.uma(
        `SELECT p.id, p.numero_prontuario,
                CASE WHEN p.usa_nome_social THEN COALESCE(p.nome_social, pf.nome) ELSE pf.nome END AS nome
           FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = ?`,
        [retratos.htPaciente],
      );
      const at = await l.uma(
        `SELECT a.id, a.numero, k.tipo_base FROM atendimento a
           JOIN categoria_atendimento k ON k.id = a.categoria_atendimento_id
          WHERE a.id = ? AND a.estabelecimento_id = ?`,
        [retratos.htAtendimento, est.id],
      );
      const prof = await l.uma(
        `SELECT p.id, COALESCE(p.nome_exibicao, pf.nome) AS nome,
                (SELECT CONCAT(cc.sigla, ' ', ic.numero_inscricao) FROM inscricao_conselho ic
                   JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
                  WHERE ic.profissional_id = p.id AND ic.excluido_em IS NULL AND ic.situacao IN ('ativa', 'provisoria')
                  ORDER BY ic.principal DESC, ic.sequencia LIMIT 1) AS conselho
           FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = ?`,
        [cbo],
      );
      return {
        hospital: [
          ['id', est.id],
          ['nome', est.nome],
        ],
        paciente: [
          ['id', retratos.htPaciente],
          ['nome', textoOuNull(pac?.['nome'])],
          ['prontuario', numOuNull(pac?.['numero_prontuario'])],
        ],
        atendimento: [
          ['id', retratos.htAtendimento],
          ['numero', textoOuNull(at?.['numero'])],
          ['tipo_atendimento', textoOuNull(at?.['tipo_base'])],
        ],
        profissional: [
          ['id', cbo],
          ['nome', textoOuNull(prof?.['nome'])],
          ['conselho', textoOuNull(prof?.['conselho'])],
        ],
        tipoAssinatura: 'Anamnese/Evolução',
        situacao: situacao === 2 ? 'Suspenso' : 'Lançado',
      } as CabecalhoDocumentoLido;
    });
  }

  modelosImpressao(c: ContextoRegistro): Promise<{
    fichas: { id: number; nome: string | null; tipo: number | null; componente: string | null }[];
    relatorios: { id: number; nome: string | null }[];
  }> {
    return this.ler(c, 'modelosImpressao', async (l) => {
      const linhas = await l.consultar(
        `SELECT m.id, m.codigo, m.nome, t.id AS tipo_id, t.codigo AS tipo_codigo
           FROM modelo_impressao_clinica m JOIN tipo_modelo_impressao t ON t.id = m.tipo_modelo_impressao_id
          WHERE m.ativo = TRUE AND t.ativo = TRUE AND t.codigo IN ('ficha', 'relatorio')
          ORDER BY m.nome, m.id`,
      );
      return {
        fichas: linhas
          .filter((x) => x['tipo_codigo'] === 'ficha')
          .map((x) => ({
            id: num(x['id']),
            nome: textoOuNull(x['nome']),
            tipo: numOuNull(x['tipo_id']),
            componente: textoOuNull(x['codigo']),
          })),
        relatorios: linhas
          .filter((x) => x['tipo_codigo'] === 'relatorio')
          .map((x) => ({ id: num(x['id']), nome: textoOuNull(x['nome']) })),
      };
    });
  }

  // ── Gravações (pelo Executor: trilha, idempotência e escritas auditadas na mesma transação) ─────────

  private async gravar<T>(
    c: ContextoRegistro,
    ctx: ContextoOperacao,
    nome: string,
    critica: boolean,
    conteudo: unknown,
    fn: (
      tx: TxOperacao,
      est: Estabelecimento,
      prof: ProfissionalDaSessao,
    ) => Promise<{ valor: T; alvo: AlvoGravado }>,
  ): Promise<T> {
    const cliente = ctx.cliente || c.cliente || this.cliente;
    const est = await this.ler(c, 'estabelecimento', async (_l, e) => e);
    let alvo: AlvoGravado | null = null;
    const op = definirOperacao({
      nome,
      tabelas: [...TABELAS_REGISTRO],
      // O conteúdo entra no hash da idempotência: a mesma chave com outro conteúdo é 409 (idempotencia-divergente).
      entrada: z.object({ chave: z.string(), conteudo: z.unknown() }),
      critica,
      gravar: async (tx) => {
        const prof = await profissionalDaSessao(tx, est.id, {
          usuario: ctx.usuario ?? c.usuario ?? null,
          login: loginDaOperacao(ctx),
        });
        if (!prof || !prof.ativo)
          throw recusa(
            409,
            'profissional-sem-cbo',
            'Operação recusada',
            'Só o profissional da sessão registra.',
          );
        const r = await fn(tx, est, prof);
        alvo = r.alvo;
        return { valor: r.valor } as unknown as ResultadoOperacao;
      },
      alvo: () => ({ tabela: alvo?.tabela ?? 'registro_assistencial', id: alvo?.id ?? null }),
      trilha: () => ({ dados: alvo?.dados ?? null, motivo: alvo?.motivo ?? null }),
    });
    const chave = ctx.chaveIdempotencia || `pep.registro:${randomUUID()}`;
    const r = await this.executor.executar(
      op,
      cliente,
      { chave, conteudo: JSON.parse(JSON.stringify(conteudo ?? null)) as unknown },
      { ...ctx, cliente, estabelecimento: est.id, chaveIdempotencia: chave },
    );
    return (r.resultado as unknown as { valor: T }).valor;
  }

  registrar(
    c: ContextoRegistro,
    e: GravacaoEvolucao,
    ctx: ContextoOperacao,
  ): Promise<{ registro: number; trilha: string | null }> {
    // O pedido e a resposta de parecer, a classificação de risco e a coassinatura gravam em tabelas de outras famílias:
    // até a ligação delas, recusa fechada (nada gravado pela metade).
    if (e.fluxo || e.classificacao || e.supervisao)
      return Promise.reject(
        recusa(
          501,
          'pendente-modelo-proprio',
          'Ainda não disponível no banco próprio',
          'O registro com parecer, classificação de risco ou coassinatura ainda não grava no banco próprio.',
        ),
      );
    return this.gravar(c, ctx, OP_REGISTRAR, false, conteudoDoRegistro(e), async (tx, est, prof) => {
      if (prof.profissional !== e.cbo)
        throw recusa(
          409,
          'profissional-sem-cbo',
          'Operação recusada',
          'Só o profissional da sessão registra.',
        );
      exigirInscricao(prof);
      await conferirAtendimento(tx, est.id, e.atendimento, e.paciente);
      const modelo = await modeloPublicado(tx, e.modelo);
      if (e.corrige !== undefined) {
        const o = await tx.uma(
          `SELECT paciente_id, modelo_documento_clinico_id, autor_profissional_id, suspenso_em FROM registro_assistencial
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [e.corrige, est.id],
        );
        if (!o || num(o['paciente_id']) !== e.paciente)
          throw recusa(422, 'correcao-de-outro-paciente', 'Operação recusada', 'Outro paciente.');
        if (num(o['modelo_documento_clinico_id']) !== e.modelo)
          throw recusa(422, 'correcao-de-outro-modelo', 'Operação recusada', 'Outro modelo.');
        if (o['suspenso_em'] === null || o['suspenso_em'] === undefined)
          throw recusa(422, 'correcao-sem-suspensao', 'Operação recusada', 'Suspenda antes.');
        if (num(o['autor_profissional_id']) !== e.cbo)
          throw recusa(422, 'correcao-por-outro', 'Operação recusada', 'Só o autor corrige.');
      }
      const rascunho = e.rascunho
        ? await rascunhoAberto(tx, est.id, e.rascunho, e.cbo, {
            paciente: e.paciente,
            modelo: e.modelo,
            atendimento: e.atendimento,
          })
        : null;
      const campos = new Map(
        (await camposDoModelo(tx, e.modelo))
          .filter((x) => x.versao === modelo.versao && x.ordem !== null)
          .map((x) => [x.ordem as string, x] as const),
      );
      const respostas = e.linhas.filter(temValor).map((l) => respostaDaLinha(l, campos));
      const agora = new Date();
      const id = await tx.incluir('registro_assistencial', {
        estabelecimento_id: est.id,
        paciente_id: e.paciente,
        atendimento_id: e.atendimento,
        modelo_documento_clinico_id: e.modelo,
        tipo_documento_clinico_id: modelo.tipo,
        autor_profissional_id: prof.profissional,
        autor_usuario_id: prof.usuario,
        ocupacao_cbo_id: prof.ocupacao,
        data_hora_clinica: localParaUtc(e.dataHoraClinica, est.fuso),
        data_hora_lancamento: agora,
        justificativa_retroativo: e.justificativaRetroativo ?? null,
        situacao: 'finalizado',
        impressao_digital: e.hashConteudo,
        texto_consolidado: textoConsolidado(respostas, campos),
        corrige_registro_assistencial_id: e.corrige ?? null,
        origem: 'sistema',
      });
      for (const [i, r] of respostas.entries())
        await tx.incluir('registro_assistencial_resposta', {
          registro_assistencial_id: id,
          sequencia: i + 1,
          ...r,
        });
      const selo = await seloDoConteudo(tx, id);
      if (rascunho)
        await tx.alterar('registro_assistencial_rascunho', rascunho.id, rascunho.versao, {
          situacao: 'finalizado',
          registro_assistencial_id: id,
          encerrado_em: agora,
        });
      return {
        valor: { registro: id, trilha: null },
        alvo: {
          tabela: 'registro_assistencial',
          id,
          dados: {
            paciente: e.paciente,
            modelo: e.modelo,
            respostas: respostas.length,
            comoSuporte: !!e.comoSuporte,
            selo,
          },
          motivo: e.justificativaRetroativo ?? null,
        },
      };
    });
  }

  salvarRascunho(
    c: ContextoRegistro,
    e: GravacaoRascunho,
    ctx: ContextoOperacao,
  ): Promise<{ rascunho: number; versao: string; trilha: string | null }> {
    return this.gravar(c, ctx, OP_SALVAR_RASCUNHO, false, conteudoDoRascunho(e), async (tx, est, prof) => {
      if (prof.profissional !== e.cbo)
        throw recusa(
          409,
          'profissional-sem-cbo',
          'Operação recusada',
          'Só o profissional da sessão registra.',
        );
      exigirInscricao(prof);
      await conferirAtendimento(tx, est.id, e.atendimento, e.paciente);
      await modeloPublicado(tx, e.modelo);
      // Como a memória: salvar de novo cria a versão seguinte e arquiva a anterior (nada é sobrescrito).
      const anterior = e.rascunho
        ? await rascunhoAberto(tx, est.id, e.rascunho, e.cbo, {
            paciente: e.paciente,
            modelo: e.modelo,
            atendimento: e.atendimento,
          })
        : null;
      const agora = new Date();
      // A versão encadeada é o mesmo lançamento: herda o do primeiro rascunho da cadeia (como a memória).
      const lancadoEm = anterior
        ? ((await lancamentosDosRascunhos(tx, est.id, [anterior.id])).get(anterior.id) ?? anterior.criadoEm)
        : agora.toISOString();
      if (anterior)
        await tx.alterar('registro_assistencial_rascunho', anterior.id, anterior.versao, {
          situacao: 'arquivado',
          encerrado_em: agora,
        });
      const id = await tx.incluir('registro_assistencial_rascunho', {
        estabelecimento_id: est.id,
        paciente_id: e.paciente,
        atendimento_id: e.atendimento,
        modelo_documento_clinico_id: e.modelo,
        autor_profissional_id: prof.profissional,
        autor_usuario_id: prof.usuario,
        data_hora_clinica: localParaUtc(e.dataHoraClinica, est.fuso),
        justificativa_retroativo: e.justificativaRetroativo ?? null,
        corrige_registro_assistencial_id: e.corrige ?? anterior?.corrige ?? null,
        respostas: JSON.stringify(e.linhas),
        situacao: 'aberto',
        origem: 'sistema',
      });
      return {
        valor: { rascunho: id, versao: versaoDoRascunho(id, 1), trilha: null },
        alvo: {
          tabela: 'registro_assistencial_rascunho',
          id,
          dados: { paciente: e.paciente, modelo: e.modelo, anterior: anterior?.id ?? null, lancadoEm },
          motivo: null,
        },
      };
    });
  }

  async descartarRascunho(c: ContextoRegistro, e: DescarteRascunho, ctx: ContextoOperacao): Promise<void> {
    await this.gravar(
      c,
      ctx,
      OP_DESCARTAR_RASCUNHO,
      false,
      { rascunho: e.rascunho, versao: e.versao, cbo: e.cbo },
      async (tx, est, prof) => {
        if (prof.profissional !== e.cbo)
          throw recusa(
            409,
            'profissional-sem-cbo',
            'Operação recusada',
            'Só o profissional da sessão registra.',
          );
        const x = await tx.uma(
          'SELECT paciente_id, modelo_documento_clinico_id FROM registro_assistencial_rascunho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.rascunho, est.id],
        );
        if (!x)
          throw recusa(404, 'registro-inexistente', 'Rascunho não encontrado', 'O rascunho não existe mais.');
        const r = await rascunhoAberto(tx, est.id, { id: e.rascunho, versao: e.versao }, e.cbo, {
          paciente: num(x['paciente_id']),
          modelo: num(x['modelo_documento_clinico_id']),
        });
        await tx.alterar('registro_assistencial_rascunho', r.id, r.versao, {
          situacao: 'descartado',
          encerrado_em: new Date(),
        });
        return {
          valor: undefined,
          alvo: {
            tabela: 'registro_assistencial_rascunho',
            id: r.id,
            dados: { paciente: r.paciente },
            motivo: null,
          },
        };
      },
    );
  }

  async suspender(c: ContextoRegistro, e: SuspensaoEvolucao, ctx: ContextoOperacao): Promise<void> {
    if (ctx.reautenticadoEm === undefined)
      throw recusa(401, 'reautenticacao-necessaria', 'Confirme a senha', 'Confirme a senha para suspender.');
    const conteudo = {
      registro: e.registro,
      cbo: e.cbo,
      justificativa: e.justificativa,
      comoSuporte: !!e.comoSuporte,
    };
    await this.gravar(c, ctx, OP_SUSPENDER, true, conteudo, async (tx, est, prof) => {
      if (prof.profissional !== e.cbo)
        throw recusa(
          409,
          'profissional-sem-cbo',
          'Operação recusada',
          'Só o profissional da sessão registra.',
        );
      const [r] = await tx.consultarParaAtualizar(
        `SELECT id, paciente_id, autor_profissional_id, suspenso_em, versao FROM registro_assistencial
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [e.registro, est.id],
      );
      if (!r) throw recusa(404, 'registro-inexistente', 'Registro não encontrado', 'O registro não existe.');
      if (r['suspenso_em'] !== null && r['suspenso_em'] !== undefined)
        throw recusa(409, 'ja-suspenso', 'Operação recusada', 'O registro já está suspenso.');
      if (num(r['autor_profissional_id']) !== e.cbo)
        throw recusa(409, 'suspensao-por-outro', 'Operação recusada', 'Só o autor suspende.');
      await tx.alterar('registro_assistencial', e.registro, num(r['versao']), {
        situacao: 'suspenso',
        suspenso_em: new Date(),
        suspenso_por_usuario_id: prof.usuario,
        justificativa_suspensao: e.justificativa,
      });
      return {
        valor: undefined,
        alvo: {
          tabela: 'registro_assistencial',
          id: e.registro,
          dados: { paciente: num(r['paciente_id']), comoSuporte: !!e.comoSuporte },
          motivo: e.justificativa,
        },
      };
    });
  }
}

interface AlvoGravado {
  readonly tabela: string;
  readonly id: number;
  readonly dados: Record<string, unknown> | null;
  readonly motivo: string | null;
}

// ── Apoio (leitura dentro da leitura ou da transação) ─────────────────────────────────────────────────

async function estabelecimentoDe(l: Consultor, codigo: string): Promise<Estabelecimento> {
  const e = await l.uma<{ id: unknown; fuso_horario: unknown; nome_fantasia: unknown }>(
    'SELECT id, fuso_horario, nome_fantasia FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
    [codigo],
  );
  if (!e)
    throw recusa(
      404,
      'estabelecimento-inexistente',
      'Estabelecimento não encontrado',
      'O estabelecimento da sessão não existe neste cliente.',
    );
  return { id: num(e.id), fuso: fusoValido(e.fuso_horario), nome: textoOuNull(e.nome_fantasia) };
}

/**
 * Profissional da conta da sessão: o vínculo do estabelecimento vigente (se houver) ou o profissional vigente da
 * conta; a inscrição em conselho ativa (ou provisória) dentro da validade e a ocupação com que registra.
 */
export async function profissionalDaSessao(
  l: Consultor,
  estabelecimento: number,
  quem: { usuario?: number | null; login?: string | null },
): Promise<ProfissionalDaSessao | null> {
  const porId = quem.usuario !== null && quem.usuario !== undefined;
  const u = await l.uma(
    `SELECT id FROM usuario WHERE ${porId ? 'id = ?' : 'login = ?'} AND situacao = 'ativo' AND excluido_em IS NULL`,
    [porId ? quem.usuario : (quem.login ?? '')],
  );
  if (!u) return null;
  const usuario = num(u['id']);
  const p = await l.uma(
    `SELECT p.id, p.situacao, COALESCE(p.nome_exibicao, pf.nome) AS nome,
            (SELECT COUNT(*) FROM inscricao_conselho ic
              WHERE ic.profissional_id = p.id AND ic.excluido_em IS NULL AND ic.situacao IN ('ativa', 'provisoria')
                AND (ic.validade IS NULL OR ic.validade >= UTC_DATE())) AS inscricoes,
            COALESCE(
              (SELECT po.ocupacao_cbo_id FROM profissional_ocupacao po
                WHERE po.profissional_id = p.id AND po.ativo = TRUE AND po.excluido_em IS NULL
                ORDER BY po.principal DESC, po.id LIMIT 1),
              (SELECT ic.ocupacao_cbo_id FROM inscricao_conselho ic
                WHERE ic.profissional_id = p.id AND ic.excluido_em IS NULL AND ic.situacao IN ('ativa', 'provisoria')
                ORDER BY ic.principal DESC, ic.sequencia LIMIT 1)) AS ocupacao
       FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
      WHERE p.excluido_em IS NULL AND p.id = COALESCE(
              (SELECT v.profissional_id FROM usuario_vinculo_profissional v
                WHERE v.usuario_id = ? AND v.estabelecimento_id = ? AND v.profissional_id IS NOT NULL
                  AND v.excluido_em IS NULL AND v.vigencia_inicio <= UTC_DATE()
                  AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= UTC_DATE())
                ORDER BY v.vigencia_inicio DESC LIMIT 1),
              (SELECT up.profissional_id FROM usuario_profissional up
                WHERE up.usuario_id = ? AND up.excluido_em IS NULL AND up.vigencia_inicio <= UTC_DATE()
                  AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= UTC_DATE())
                ORDER BY up.vigencia_inicio DESC LIMIT 1))`,
    [usuario, estabelecimento, usuario],
  );
  if (!p) return null;
  return {
    usuario,
    profissional: num(p['id']),
    nome: textoOuNull(p['nome']),
    ativo: p['situacao'] === 'ativo',
    inscricaoAtiva: num(p['inscricoes']) > 0,
    ocupacao: numOuNull(p['ocupacao']),
  };
}

function exigirInscricao(p: ProfissionalDaSessao): void {
  if (!p.inscricaoAtiva)
    throw recusa(
      409,
      'sem-inscricao-ativa',
      'Operação recusada',
      'O profissional da sessão não tem inscrição em conselho ativa e dentro da validade.',
    );
}

async function conferirAtendimento(
  l: Consultor,
  est: number,
  atendimento: number,
  paciente: number,
): Promise<void> {
  const a = await l.uma(
    'SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [atendimento, est],
  );
  if (!a)
    throw recusa(404, 'atendimento-inexistente', 'Atendimento não encontrado', 'O atendimento não existe.');
  if (num(a['paciente_id']) !== paciente)
    throw recusa(
      409,
      'atendimento-de-outro-paciente',
      'Operação recusada',
      'O atendimento é de outro paciente.',
    );
}

async function modeloPublicado(
  l: Consultor,
  modelo: number,
): Promise<{ versao: number; tipo: number | null }> {
  const m = await l.uma(
    `SELECT publicada_modelo_documento_versao_id AS versao, tipo_documento_clinico_id AS tipo
       FROM modelo_documento_clinico
      WHERE id = ? AND situacao = 'publicado' AND publicada_modelo_documento_versao_id IS NOT NULL AND excluido_em IS NULL`,
    [modelo],
  );
  if (!m)
    throw recusa(
      409,
      'modelo-indisponivel',
      'Operação recusada',
      'O modelo não está publicado para registro.',
    );
  return { versao: num(m['versao']), tipo: numOuNull(m['tipo']) };
}

/** As conferências da memória sobre o rascunho de origem, com a linha travada para a transação. */
async function rascunhoAberto(
  tx: TxOperacao,
  est: number,
  ref: { id: number; versao: string },
  cbo: number,
  de: { paciente: number; modelo: number; atendimento?: number },
): Promise<{ id: number; versao: number; paciente: number; corrige: number | null; criadoEm: string }> {
  const [r] = await tx.consultarParaAtualizar(
    `SELECT id, paciente_id, modelo_documento_clinico_id, atendimento_id, autor_profissional_id, situacao, origem,
            versao, corrige_registro_assistencial_id, criado_em
       FROM registro_assistencial_rascunho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [ref.id, est],
  );
  if (!r) throw recusa(404, 'registro-inexistente', 'Rascunho não encontrado', 'O rascunho não existe mais.');
  const situacao = String(r['situacao']);
  if (situacao === 'finalizado' || situacao === 'descartado')
    throw recusa(409, 'rascunho-fechado', 'Operação recusada', 'O rascunho já foi finalizado ou descartado.');
  if (situacao === 'arquivado' || versaoDoRascunho(num(r['id']), num(r['versao'])) !== ref.versao)
    throw new ErroOperacao(
      409,
      'conflito-versao',
      'Rascunho alterado',
      'O rascunho foi alterado depois que você o abriu.',
      { colunas: ['rascunho'] },
    );
  if (r['origem'] !== 'sistema')
    throw recusa(
      409,
      'rascunho-de-outro-sistema',
      'Operação recusada',
      'Rascunho começado no outro sistema.',
    );
  if (num(r['autor_profissional_id']) !== cbo)
    throw recusa(409, 'rascunho-de-outro', 'Operação recusada', 'Rascunho de outro profissional.');
  if (num(r['paciente_id']) !== de.paciente || num(r['modelo_documento_clinico_id']) !== de.modelo)
    throw recusa(409, 'rascunho-de-outro-formulario', 'Operação recusada', 'Outro paciente ou formulário.');
  if (de.atendimento !== undefined && num(r['atendimento_id']) !== de.atendimento)
    throw recusa(409, 'rascunho-de-outro-atendimento', 'Operação recusada', 'Outro atendimento.');
  return {
    id: num(r['id']),
    versao: num(r['versao']),
    paciente: num(r['paciente_id']),
    corrige: numOuNull(r['corrige_registro_assistencial_id']),
    criadoEm: instanteIso(r['criado_em']),
  };
}

/** Instante do banco (Date ou texto UTC) em ISO. */
function instanteIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(`${String(v).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** O conteúdo da gravação do registro que entra no hash da idempotência (a representação deriva dele). */
export function conteudoDoRegistro(e: GravacaoEvolucao): unknown {
  return {
    paciente: e.paciente,
    atendimento: e.atendimento,
    modelo: e.modelo,
    cbo: e.cbo,
    dataHoraClinica: e.dataHoraClinica,
    justificativaRetroativo: e.justificativaRetroativo ?? null,
    linhas: e.linhas,
    corrige: e.corrige ?? null,
    rascunho: e.rascunho ?? null,
    comoSuporte: !!e.comoSuporte,
  };
}

/** O conteúdo do salvamento do rascunho que entra no hash da idempotência. */
export function conteudoDoRascunho(e: GravacaoRascunho): unknown {
  return {
    paciente: e.paciente,
    atendimento: e.atendimento,
    modelo: e.modelo,
    cbo: e.cbo,
    dataHoraClinica: e.dataHoraClinica,
    justificativaRetroativo: e.justificativaRetroativo ?? null,
    linhas: e.linhas,
    corrige: e.corrige ?? null,
    rascunho: e.rascunho ?? null,
  };
}

/** Texto do registro para busca e leitura: título do campo e valor, uma linha por resposta. */
function textoConsolidado(
  respostas: readonly RespostaTipada[],
  campos: ReadonlyMap<string, CampoOrdenado>,
): string {
  const porId = new Map([...campos.values()].map((c) => [c.id, c] as const));
  return respostas
    .map((r) => {
      const c = porId.get(r.modelo_campo_id);
      const opcao =
        r.modelo_campo_opcao_id === null ? null : c?.opcoes.find((o) => o.id === r.modelo_campo_opcao_id);
      const v =
        opcao?.rotulo ??
        (r.valor_booleano === null ? null : r.valor_booleano ? 'Sim' : 'Não') ??
        r.valor_texto ??
        (r.valor_numero === null ? null : `${r.valor_numero}${r.unidade ? ` ${r.unidade}` : ''}`) ??
        r.valor_data ??
        r.valor_hora ??
        r.codigo_cid10;
      return `${c?.titulo ?? ''}: ${v ?? ''}`;
    })
    .join('\n');
}
