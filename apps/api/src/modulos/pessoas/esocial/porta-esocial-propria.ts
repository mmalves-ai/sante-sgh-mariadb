// Porta PRÓPRIA do eSocial (M53.6; F2.2 lote 03-05) sobre o MariaDB do cliente, pelo @sgh/nucleo: evento_esocial,
// lote_esocial e retorno_esocial (gravados); tipo_evento_esocial, leiaute_esocial, categoria_trabalhador,
// motivo_afastamento, estabelecimento, recibo_autonomo e usuario (lidos). Leituras somente leitura; gravações diretas
// numa operação do Executor (gravacaoDireta: trilha, outbox e idempotência na mesma transação), com os eventos e o lote
// relidos e travados (FOR UPDATE) e a troca de situação conferida pela versão vista (alterar do núcleo).
// Toda leitura de registro filtra o estabelecimento da sessão e `excluido_em IS NULL`. Exceções, com o motivo: os
// catálogos oficiais (tipo de evento, leiaute, categoria) e o cadastro de motivos de afastamento são do cliente inteiro;
// o CNPJ das empresas é lido da rede inteira porque o transmissor é único por raiz de CNPJ (regra 1).
// "Empresa" no contrato da tela é o estabelecimento (o empregador do eSocial é o CNPJ do estabelecimento).
// Melhoria: a situação do banco é a do modelo (pendente, erro_validacao, em_lote, processado, cancelado...), traduzida
// para a da tela aqui; `substituido` não é gravado: é derivado (o evento processado que tem retificação processada).
// Melhoria: a origem do evento é a entidade e o id do registro que o gerou (entidade, entidade_id), sem texto livre.
// Melhoria: os erros do XSD e o motivo do descarte ficam como ocorrências do evento (retorno_esocial, códigos XSD e
// MOTIVO), com sequência e instante, em vez de JSON numa coluna.
// Melhoria: o XML cifrado se reconhece pelo conteúdo (XML claro começa por '<'), sem indicador S/N à parte.
// Melhoria: o leiaute aponta para o catálogo oficial (leiaute_esocial) quando a versão está carregada; o tipo do evento
// é a FK do catálogo (evento fora do catálogo é recusado, nunca gravado pela metade).
// Melhoria: o sequencial do Id do evento é número de negócio do estabelecimento (sequencia_negocio "evento_esocial",
// travado na transação); o id do registro é do banco (AUTO_INCREMENT). Nada de MAX + 1 nem de trava na tabela inteira.
// Melhoria: o autor é o usuário da sessão (criado_por/alterado_por pelo núcleo), mostrado pelo login do cadastro.
// Pendente (pedidos ao orquestrador, DDL em docs/obra/fatias/f22/saida/03-05.json): os parâmetros do eSocial do
// empregador (transmissor, leiaute e parâmetros do S-1000/S-1005), a ficha do eSocial do vínculo, a conferência gravada
// da conciliação, o ambiente `coletor` no evento e no lote, a operação dos eventos de tabela e a data de referência do
// evento não periódico. Até lá, recusa com o código `modelo-pendente` (nunca vazio calado nem gravação pela metade):
// - gravar e ler os parâmetros do empregador; por consequência, gerar eventos (tabela, trabalhador e periódicos) e
//   calcular a conciliação, que dependem da vigência do empregador;
// - gravar e ler a ficha do eSocial do vínculo; gravar e ler a conferência da conciliação;
// - gravar evento de tabela com operação (inclusão, alteração ou exclusão): sem a coluna, a duplicidade do evento de
//   tabela (mesmo registro e operação em andamento) não seria detectada;
// - montar lote no ambiente `coletor`. A data de referência do evento não periódico vai em `competencia`.
import {
  type AmbienteEsocial,
  type GrupoEventoEsocial,
  type SituacaoEventoEsocial,
  type SituacaoLoteEsocial,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  type Executor,
  garantirSequencia,
  type Leitor,
  type NucleoProprio,
  recusa,
  restricaoUnicaViolada,
  type TxOperacao,
} from '@sgh/nucleo';
import { gravacaoDireta } from '../../enfermagem/gravacao-direta.js';
import { type ContextoPortaM18, portaIndisponivel, type TrilhaDaGravacao } from '../../exames/public-api.js';
import { comCacheCurtoDosCatalogos } from './cache-catalogos-esocial.js';
import {
  type ContextoEsocial,
  type EventoDoCatalogoEsocial,
  type FichaEsocialCifrada,
  type FiltroRegistrosEventoEsocial,
  type GravadorEsocial,
  type ItemDoCatalogoEsocial,
  type LeiauteDoCatalogoEsocial,
  METODOS_PORTA_ESOCIAL,
  type MudancaSituacaoEvento,
  type MudancaSituacaoLote,
  type NovoRegistroEvento,
  type NovoRegistroLote,
  type PendenciaMigradaEsocial,
  type PortaEsocial,
  type RegistroConciliacaoEsocial,
  type RegistroEventoEsocial,
  type RegistroLoteEsocial,
  TETO_EVENTOS_ESOCIAL,
  TETO_LOTES_ESOCIAL,
  type VigenciaEmpregadorEsocial,
} from './porta-esocial.js';
import { PortaEsocialMemoria } from './porta-esocial-memoria.js';

/** O que a porta usa do núcleo (o NucleoProprio serve; os testes passam um dublê). */
export type NucleoEsocial = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** Tabelas que as gravações do eSocial escrevem (a transação recusa as outras). */
export const TABELAS_ESOCIAL = [
  'evento_esocial',
  'lote_esocial',
  'retorno_esocial',
  'sequencia_negocio',
] as const;

/** Tipo da sequência do sequencial do Id do evento (por estabelecimento). */
export const SEQUENCIA_EVENTO_ESOCIAL = 'evento_esocial';

type AmbienteBanco = 'producao' | 'producao_restrita';
type Linha = Record<string, unknown>;

const MODELO_PENDENTE = (o: string) =>
  recusa(
    'modelo-pendente',
    `${o} ainda não tem lugar no modelo do banco (pedido de DDL registrado na obra). Nada foi gravado.`,
  );
/** Leitura que alimenta decisão e ainda não tem lugar no modelo: recusa dizendo o que fica indisponível. */
const LEITURA_PENDENTE = (o: string, indisponivel: string) =>
  recusa(
    'modelo-pendente',
    `${o} ainda não tem lugar no modelo do banco (pedido de DDL registrado na obra). Indisponível até lá: ${indisponivel}.`,
  );
const PARAMETROS_PENDENTES = () =>
  LEITURA_PENDENTE(
    'Os parâmetros do eSocial do empregador',
    'registrar e consultar os parâmetros, gerar eventos de tabela, do trabalhador e periódicos e calcular a conciliação',
  );
const FICHA_PENDENTE = () =>
  LEITURA_PENDENTE(
    'A ficha do eSocial do vínculo',
    'registrar e consultar a ficha e gerar os eventos do trabalhador',
  );
const CONFERENCIA_PENDENTE = () =>
  LEITURA_PENDENTE(
    'A conferência gravada da conciliação',
    'conferir a conciliação e consultar a última conferência',
  );

// ── Traduções entre a tela e o banco ─────────────────────────────────────────────────────────────────────────

const SITUACAO_EVENTO_BANCO: Readonly<Record<Exclude<SituacaoEventoEsocial, 'substituido'>, string>> = {
  gerado: 'pendente',
  invalido: 'erro_validacao',
  validado: 'validado',
  'em-lote': 'em_lote',
  enviado: 'enviado',
  aceito: 'processado',
  rejeitado: 'rejeitado',
  excluido: 'excluido',
  descartado: 'cancelado',
};
const SITUACAO_EVENTO_TELA: Readonly<Record<string, SituacaoEventoEsocial>> = Object.fromEntries(
  Object.entries(SITUACAO_EVENTO_BANCO).map(([t, b]) => [b, t as SituacaoEventoEsocial]),
);
/** As situações do banco que podem corresponder à da tela (substituído é um processado com retificação aceita). */
const bancoDaSituacao = (s: string): string | null =>
  s === 'substituido' ? 'processado' : ((SITUACAO_EVENTO_BANCO as Record<string, string>)[s] ?? null);

const SITUACAO_LOTE_BANCO: Readonly<Record<SituacaoLoteEsocial, string>> = {
  montado: 'montando',
  enviado: 'enviado',
  processado: 'processado',
  cancelado: 'cancelado',
};
const SITUACAO_LOTE_TELA: Readonly<Record<string, SituacaoLoteEsocial>> = {
  montando: 'montado',
  enviado: 'enviado',
  processando: 'enviado',
  processado: 'processado',
  erro: 'processado',
  cancelado: 'cancelado',
};

const GRUPO_LOTE_BANCO: Readonly<Record<GrupoEventoEsocial, string>> = {
  tabela: 'tabelas',
  'nao-periodico': 'nao_periodicos',
  periodico: 'periodicos',
};
const GRUPO_LOTE_TELA: Readonly<Record<string, GrupoEventoEsocial>> = {
  tabelas: 'tabela',
  nao_periodicos: 'nao-periodico',
  periodicos: 'periodico',
};
const grupoDaClasse = (classe: unknown): GrupoEventoEsocial =>
  classe === 'tabela'
    ? 'tabela'
    : classe === 'periodico' || classe === 'totalizador'
      ? 'periodico'
      : 'nao-periodico';
const numeroDoGrupo = (g: GrupoEventoEsocial): 1 | 2 | 3 => (g === 'tabela' ? 1 : g === 'periodico' ? 3 : 2);

function ambienteDoBanco(a: AmbienteEsocial): AmbienteBanco {
  if (a === 'producao') return 'producao';
  if (a === 'producao-restrita') return 'producao_restrita';
  throw MODELO_PENDENTE('O lote ao coletor local (ambiente de teste fora do eSocial)');
}
const ambienteDaTela = (a: unknown): AmbienteEsocial => (a === 'producao' ? 'producao' : 'producao-restrita');

const pad2 = (s: string) => s.padStart(2, '0');
/** Versão do catálogo (S-1.3) no formato do XSD (v_S_01_03_00); outro formato volta como está. */
export function leiauteDaVersao(v: string): string {
  const m = /^S-(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?$/.exec(v.trim());
  return m ? `v_S_${pad2(m[1]!)}_${pad2(m[2]!)}_${pad2(m[3] ?? '0')}` : v;
}
/** Formato do XSD (v_S_01_03_00) na versão do catálogo (S-1.3). */
export function versaoDoLeiaute(v: string): string {
  const m = /^v_S_(\d{2})_(\d{2})_(\d{2})$/.exec(v.trim());
  if (!m) return v;
  const terceiro = Number(m[3]);
  return `S-${Number(m[1])}.${Number(m[2])}${terceiro ? `.${terceiro}` : ''}`;
}

/** A data de referência (AAAA-MM-DD; a competência AAAA-MM vira o primeiro dia do mês). */
const dataDoBanco = (d: string) => (/^\d{4}-\d{2}$/.test(d) ? `${d}-01` : d.slice(0, 10));

const num = (v: unknown) => Number(v ?? 0);
const numOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txtOuNulo = (v: unknown) => (v === null || v === undefined ? null : String(v));

// ── Leituras (as mesmas no Leitor e dentro da transação da gravação) ─────────────────────────────────────────

const CAMPOS_EVENTO = `e.id, e.estabelecimento_id, t.codigo_esocial AS evento, t.classe, e.identificador_evento,
  e.vinculo_trabalho_id, e.entidade, e.entidade_id, DATE_FORMAT(e.competencia, '%Y-%m-%d') AS data_referencia,
  lv.codigo_versao AS leiaute, (e.xml IS NOT NULL AND LEFT(e.xml, 1) <> '<') AS xml_cifrado, e.hash_xml, e.situacao,
  e.evento_retificado_id, e.lote_esocial_id, e.numero_recibo, e.codigo_resposta, e.descricao_resposta,
  uc.login AS criado_por_login, DATE_FORMAT(e.criado_em, '%Y-%m-%dT%H:%i:%s') AS criado_em_txt,
  ua.login AS alterado_por_login, DATE_FORMAT(e.alterado_em, '%Y-%m-%dT%H:%i:%s') AS alterado_em_txt, e.versao,
  EXISTS (SELECT 1 FROM evento_esocial r WHERE r.evento_retificado_id = e.id AND r.tipo_operacao = 'retificacao'
           AND r.situacao = 'processado' AND r.excluido_em IS NULL) AS substituido`;
const DE_EVENTO = `FROM evento_esocial e
  JOIN tipo_evento_esocial t ON t.id = e.tipo_evento_esocial_id
  LEFT JOIN leiaute_esocial lv ON lv.id = e.leiaute_esocial_id
  LEFT JOIN usuario uc ON uc.id = e.criado_por
  LEFT JOIN usuario ua ON ua.id = e.alterado_por`;

function situacaoDaTela(situacao: unknown, substituido: unknown): SituacaoEventoEsocial {
  const s = SITUACAO_EVENTO_TELA[String(situacao)] ?? 'gerado';
  return s === 'aceito' && num(substituido) > 0 ? 'substituido' : s;
}

function eventoDaLinha(
  x: Linha,
  ocorrencias: Map<number, { erros: string[]; motivo: string | null }>,
): RegistroEventoEsocial {
  const id = num(x['id']);
  const o = ocorrencias.get(id);
  return {
    id,
    empresa: num(x['estabelecimento_id']),
    evento: String(x['evento']) as RegistroEventoEsocial['evento'],
    grupo: grupoDaClasse(x['classe']),
    operacao: null,
    idEsocial: String(x['identificador_evento']),
    vinculo: numOuNulo(x['vinculo_trabalho_id']),
    origem: txtOuNulo(x['entidade']),
    referencia: numOuNulo(x['entidade_id']),
    dataReferencia: String(x['data_referencia'] ?? ''),
    leiaute: x['leiaute'] ? leiauteDaVersao(String(x['leiaute'])) : '',
    xmlCifrado: num(x['xml_cifrado']) > 0,
    hashXml: String(x['hash_xml'] ?? ''),
    errosXsd: o?.erros ?? [],
    situacao: situacaoDaTela(x['situacao'], x['substituido']),
    eventoAnterior: numOuNulo(x['evento_retificado_id']),
    lote: numOuNulo(x['lote_esocial_id']),
    recibo: txtOuNulo(x['numero_recibo']),
    retornoCodigo: txtOuNulo(x['codigo_resposta']),
    retornoDescricao: txtOuNulo(x['descricao_resposta']),
    motivo: o?.motivo ?? null,
    criadoPor: String(x['criado_por_login'] ?? ''),
    criadoEm: String(x['criado_em_txt'] ?? ''),
    situacaoPor: txtOuNulo(x['alterado_por_login']),
    situacaoEm: txtOuNulo(x['alterado_em_txt']),
    versao: num(x['versao']),
  };
}

/** Os erros do XSD e o último motivo de cada evento (ocorrências gravadas em retorno_esocial). */
async function ocorrenciasDe(l: Leitor, ids: readonly number[]) {
  const r = new Map<number, { erros: string[]; motivo: string | null }>();
  if (ids.length === 0) return r;
  const linhas = await l.consultar(
    `SELECT evento_esocial_id, codigo_resposta, mensagem FROM retorno_esocial
      WHERE evento_esocial_id IN (${ids.map(() => '?').join(',')}) AND codigo_resposta IN ('XSD', 'MOTIVO')
        AND excluido_em IS NULL ORDER BY evento_esocial_id, sequencia`,
    ids,
  );
  for (const x of linhas) {
    const id = num(x['evento_esocial_id']);
    const o = r.get(id) ?? { erros: [], motivo: null };
    if (x['codigo_resposta'] === 'XSD') o.erros.push(String(x['mensagem']));
    else o.motivo = String(x['mensagem']);
    r.set(id, o);
  }
  return r;
}

async function eventosDe(
  l: Leitor,
  est: number,
  f: FiltroRegistrosEventoEsocial,
): Promise<RegistroEventoEsocial[]> {
  if (f.empresa !== undefined && f.empresa !== est) return [];
  const onde: string[] = ['e.estabelecimento_id = ?', 'e.excluido_em IS NULL'];
  const p: unknown[] = [est];
  if (f.evento !== undefined) {
    onde.push('t.codigo_esocial = ?');
    p.push(f.evento);
  }
  if (f.eventos?.length) {
    onde.push(`t.codigo_esocial IN (${f.eventos.map(() => '?').join(',')})`);
    p.push(...f.eventos);
  }
  const situacoes = [...(f.situacao !== undefined ? [f.situacao] : []), ...(f.situacoes ?? [])];
  if (situacoes.length) {
    const banco = [...new Set(situacoes.map(bancoDaSituacao).filter((x): x is string => x !== null))];
    if (banco.length === 0) return [];
    onde.push(`e.situacao IN (${banco.map(() => '?').join(',')})`);
    p.push(...banco);
  }
  if (f.vinculo !== undefined) {
    onde.push('e.vinculo_trabalho_id = ?');
    p.push(f.vinculo);
  }
  if (f.lote !== undefined) {
    onde.push('e.lote_esocial_id = ?');
    p.push(f.lote);
  }
  if (f.origem !== undefined) {
    onde.push('e.entidade = ?');
    p.push(f.origem);
  }
  if (f.referencia !== undefined) {
    onde.push('e.entidade_id = ?');
    p.push(f.referencia);
  }
  if (f.de !== undefined) {
    onde.push('e.competencia >= ?');
    p.push(dataDoBanco(f.de));
  }
  if (f.ate !== undefined) {
    onde.push('e.competencia <= ?');
    p.push(dataDoBanco(f.ate));
  }
  const linhas = await l.consultar(
    `SELECT ${CAMPOS_EVENTO} ${DE_EVENTO} WHERE ${onde.join(' AND ')} ORDER BY e.id DESC LIMIT ${TETO_EVENTOS_ESOCIAL + 1}`,
    p,
  );
  const oc = await ocorrenciasDe(
    l,
    linhas.map((x) => num(x['id'])),
  );
  const xs = linhas.map((x) => eventoDaLinha(x, oc));
  // A situação da tela é exata (o banco junta aceito e substituído em `processado`).
  return situacoes.length ? xs.filter((x) => situacoes.includes(x.situacao)) : xs;
}

async function eventosPorId(
  l: Leitor,
  est: number,
  ids: readonly number[],
): Promise<RegistroEventoEsocial[]> {
  if (ids.length === 0) return [];
  const linhas = await l.consultar(
    `SELECT ${CAMPOS_EVENTO} ${DE_EVENTO}
      WHERE e.id IN (${ids.map(() => '?').join(',')}) AND e.estabelecimento_id = ? AND e.excluido_em IS NULL
      ORDER BY e.id`,
    [...ids, est],
  );
  const oc = await ocorrenciasDe(
    l,
    linhas.map((x) => num(x['id'])),
  );
  return linhas.map((x) => eventoDaLinha(x, oc));
}

const CAMPOS_LOTE = `o.id, o.estabelecimento_id, o.grupo, o.ambiente, o.situacao, o.quantidade_eventos, o.protocolo,
  o.descricao_resposta, DATE_FORMAT(o.enviado_em, '%Y-%m-%dT%H:%i:%s') AS enviado_em_txt, ua.login AS alterado_por_login,
  uc.login AS criado_por_login, DATE_FORMAT(o.criado_em, '%Y-%m-%dT%H:%i:%s') AS criado_em_txt, o.versao`;
const DE_LOTE = `FROM lote_esocial o LEFT JOIN usuario uc ON uc.id = o.criado_por LEFT JOIN usuario ua ON ua.id = o.alterado_por`;

const loteDaLinha = (x: Linha): RegistroLoteEsocial => ({
  id: num(x['id']),
  empresa: num(x['estabelecimento_id']),
  grupo: GRUPO_LOTE_TELA[String(x['grupo'])] ?? 'nao-periodico',
  ambiente: ambienteDaTela(x['ambiente']),
  situacao: SITUACAO_LOTE_TELA[String(x['situacao'])] ?? 'montado',
  quantidade: num(x['quantidade_eventos']),
  protocolo: txtOuNulo(x['protocolo']),
  motivo: txtOuNulo(x['descricao_resposta']),
  enviadoPor: x['enviado_em_txt'] ? txtOuNulo(x['alterado_por_login']) : null,
  enviadoEm: txtOuNulo(x['enviado_em_txt']),
  criadoPor: String(x['criado_por_login'] ?? ''),
  criadoEm: String(x['criado_em_txt'] ?? ''),
  versao: num(x['versao']),
});

async function loteDe(l: Leitor, est: number, id: number): Promise<RegistroLoteEsocial | null> {
  const x = await l.uma(
    `SELECT ${CAMPOS_LOTE} ${DE_LOTE} WHERE o.id = ? AND o.estabelecimento_id = ? AND o.excluido_em IS NULL`,
    [id, est],
  );
  return x ? loteDaLinha(x) : null;
}

// ── Gravações ───────────────────────────────────────────────────────────────────────────────────────────────

async function proximaSequenciaRetorno(tx: TxOperacao, evento: number): Promise<number> {
  const x = await tx.uma(
    'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM retorno_esocial WHERE evento_esocial_id = ?',
    [evento],
  );
  return num(x?.['s'] ?? 1);
}

async function registrarOcorrencia(
  tx: TxOperacao,
  evento: number,
  codigo: 'XSD' | 'MOTIVO',
  mensagem: string,
): Promise<void> {
  await tx.incluir('retorno_esocial', {
    evento_esocial_id: evento,
    sequencia: await proximaSequenciaRetorno(tx, evento),
    codigo_resposta: codigo,
    tipo_resposta: codigo === 'XSD' ? 'erro' : 'informacao',
    mensagem: mensagem.slice(0, 60_000),
    recebido_em: new Date(),
    origem: 'sistema',
  });
}

async function tipoDoEvento(tx: Leitor, codigo: string): Promise<number> {
  const t = await tx.uma('SELECT id FROM tipo_evento_esocial WHERE codigo_esocial = ?', [codigo]);
  if (!t)
    throw recusa(
      'evento-fora-do-catalogo',
      `O evento ${codigo} não está no catálogo oficial do eSocial carregado neste cliente.`,
    );
  return num(t['id']);
}

async function leiauteDoEvento(tx: Leitor, tipo: number, leiaute: string): Promise<number | null> {
  if (!leiaute) return null;
  const x = await tx.uma(
    `SELECT id FROM leiaute_esocial WHERE tipo_evento_esocial_id = ? AND codigo_versao IN (?, ?)
      ORDER BY vigencia_inicio DESC LIMIT 1`,
    [tipo, leiaute, versaoDoLeiaute(leiaute)],
  );
  return x ? num(x['id']) : null;
}

const tipoOperacao = (x: NovoRegistroEvento): 'original' | 'retificacao' | 'exclusao' => {
  if (x.evento === 'S-3000') {
    if (x.eventoAnterior === null)
      throw recusa('exclusao-sem-evento', 'O S-3000 precisa do evento que ele exclui.');
    return 'exclusao';
  }
  return x.eventoAnterior === null ? 'original' : 'retificacao';
};

function semRepeticao<T>(p: Promise<T>, codigo: string, mensagem: string): Promise<T> {
  return p.catch((e: unknown) => {
    if (restricaoUnicaViolada(e) !== null) throw recusa(codigo, mensagem);
    throw e;
  });
}

function gravador(tx: TxOperacao, est: number, ambienteEventos: AmbienteBanco): GravadorEsocial {
  const daEmpresa = (empresa: number) => {
    if (empresa !== est)
      throw recusa('outro-estabelecimento', 'A empresa informada não é o estabelecimento da sessão.');
  };
  return {
    empregadores: () => Promise.reject(PARAMETROS_PENDENTES()),
    incluirEmpregador: () => Promise.reject(MODELO_PENDENTE('Os parâmetros do eSocial do empregador')),
    gravarFicha: () => Promise.reject(MODELO_PENDENTE('A ficha do eSocial do vínculo')),
    eventos: (f) => eventosDe(tx, est, f),
    async eventosComTrava(ids) {
      if (ids.length === 0) return [];
      await tx.consultarParaAtualizar(
        `SELECT id FROM evento_esocial WHERE id IN (${ids.map(() => '?').join(',')}) AND estabelecimento_id = ?`,
        [...ids, est],
      );
      return eventosPorId(tx, est, ids);
    },
    async proximoSequencialEvento() {
      await garantirSequencia(
        tx,
        { tipo: SEQUENCIA_EVENTO_ESOCIAL, estabelecimento: est },
        { usuario: tx.contexto.usuario, agora: new Date() },
      );
      return (await tx.proximoNumero(SEQUENCIA_EVENTO_ESOCIAL)).valor;
    },
    async incluirEvento(x) {
      daEmpresa(x.empresa);
      if (x.situacao === 'substituido')
        throw recusa('situacao-invalida', 'O evento novo não nasce substituído.');
      // Sem a coluna da operação (pedido de DDL operacao_tabela), o evento de tabela perderia a operação e, com ela, o
      // bloqueio de duplicidade (mesmo registro e operação em andamento): recusa em vez de gravar sem ela.
      if (x.operacao !== null)
        throw MODELO_PENDENTE('A operação do evento de tabela (inclusão, alteração ou exclusão)');
      const tipo = await tipoDoEvento(tx, x.evento);
      const leiaute = await leiauteDoEvento(tx, tipo, x.leiaute);
      // A auditoria (criado_em, criado_por, versao 1) é do núcleo; o id é do banco.
      const id = await semRepeticao(
        tx.incluir('evento_esocial', {
          estabelecimento_id: est,
          tipo_evento_esocial_id: tipo,
          leiaute_esocial_id: leiaute,
          vinculo_trabalho_id: x.vinculo,
          entidade: x.origem,
          entidade_id: x.referencia,
          competencia: dataDoBanco(x.dataReferencia),
          identificador_evento: x.idEsocial,
          ambiente: ambienteEventos,
          tipo_operacao: tipoOperacao(x),
          evento_retificado_id: x.eventoAnterior,
          xml: x.xml,
          hash_xml: x.hashXml,
          situacao: SITUACAO_EVENTO_BANCO[x.situacao],
          origem: 'sistema',
        }),
        'evento-repetido',
        'O identificador do evento já existe.',
      );
      for (const erro of x.errosXsd) await registrarOcorrencia(tx, id, 'XSD', erro);
      return id;
    },
    async mudarSituacaoEvento(x: MudancaSituacaoEvento) {
      const [atual] = await tx.consultarParaAtualizar(
        `SELECT id, situacao, tentativas_envio FROM evento_esocial
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [x.id, est],
      );
      if (!atual) throw recusa('nao-encontrado', 'O evento não existe neste estabelecimento.');
      const v: Record<string, unknown> = {};
      // Substituído não é gravado: é o processado com retificação processada (derivado na leitura).
      if (x.situacao !== 'substituido') v['situacao'] = SITUACAO_EVENTO_BANCO[x.situacao];
      if (x.situacao === 'enviado') v['tentativas_envio'] = num(atual['tentativas_envio']) + 1;
      if (x.situacao === 'aceito' || x.situacao === 'rejeitado') v['processado_em'] = new Date();
      if (x.lote !== undefined) {
        v['lote_esocial_id'] = x.lote;
        if (x.lote !== null) {
          const lote = await tx.uma(
            'SELECT ambiente FROM lote_esocial WHERE id = ? AND estabelecimento_id = ?',
            [x.lote, est],
          );
          if (!lote) throw recusa('nao-encontrado', 'O lote não existe neste estabelecimento.');
          v['ambiente'] = lote['ambiente'];
        }
      }
      if (x.recibo !== undefined) v['numero_recibo'] = x.recibo;
      if (x.retorno !== undefined) {
        v['codigo_resposta'] = x.retorno?.codigo.slice(0, 10) ?? null;
        v['descricao_resposta'] = x.retorno?.descricao.slice(0, 1000) ?? null;
      }
      await tx.alterar('evento_esocial', x.id, x.versao, v);
      if (x.motivo) await registrarOcorrencia(tx, x.id, 'MOTIVO', x.motivo);
    },
    async loteComTrava(id) {
      await tx.consultarParaAtualizar('SELECT id FROM lote_esocial WHERE id = ? AND estabelecimento_id = ?', [
        id,
        est,
      ]);
      return loteDe(tx, est, id);
    },
    async incluirLote(x: NovoRegistroLote) {
      daEmpresa(x.empresa);
      return tx.incluir('lote_esocial', {
        estabelecimento_id: est,
        grupo: GRUPO_LOTE_BANCO[x.grupo],
        ambiente: ambienteDoBanco(x.ambiente),
        quantidade_eventos: x.quantidade,
        situacao: 'montando',
        origem: 'sistema',
      });
    },
    async mudarSituacaoLote(x: MudancaSituacaoLote) {
      const atual = await loteDe(tx, est, x.id);
      if (!atual) throw recusa('nao-encontrado', 'O lote não existe neste estabelecimento.');
      const v: Record<string, unknown> = { situacao: SITUACAO_LOTE_BANCO[x.situacao] };
      if (x.protocolo !== undefined) v['protocolo'] = x.protocolo;
      if (x.motivo !== undefined) v['descricao_resposta'] = x.motivo?.slice(0, 1000) ?? null;
      if (x.enviado) v['enviado_em'] = new Date();
      if (x.situacao === 'processado') v['processado_em'] = new Date();
      await semRepeticao(
        tx.alterar('lote_esocial', x.id, x.versao, v),
        'protocolo-repetido',
        'O protocolo do lote já existe.',
      );
    },
    incluirConciliacao: () =>
      Promise.reject(MODELO_PENDENTE('A conferência gravada da conciliação do eSocial')),
  };
}

export interface OpcoesPortaEsocialPropria {
  /** Ambiente dos eventos gravados (o do servidor; o lote leva o seu ao evento). Padrão: produção restrita. */
  readonly ambienteEventos?: AmbienteBanco;
}

export class PortaEsocialPropria implements PortaEsocial {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;
  private readonly ambienteEventos: AmbienteBanco;

  constructor(
    private readonly nucleo: NucleoEsocial,
    opcoes: OpcoesPortaEsocialPropria = {},
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
    this.ambienteEventos = opcoes.ambienteEventos ?? 'producao_restrita';
  }

  private ler<T>(c: ContextoNucleo, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(
      {
        cliente: c.cliente,
        estabelecimento: est,
        usuario: c.usuario,
        correlacao: c.correlacao || 'pessoas-esocial',
      },
      (l) => fn(l, est),
    );
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw recusa('operacao-desconhecida', 'O eSocial não usa o executor por operação de tela.');
  }

  gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorEsocial) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'pessoas.esocial.gravacao-direta',
      tabelas: TABELAS_ESOCIAL,
      trilha,
      gravador: (tx, est) => gravador(tx, est, this.ambienteEventos),
      fn,
    });
  }

  // ── Catálogos oficiais (cliente inteiro) ─────────────────────────────────────────────────────────────────

  eventosCatalogo(c: ContextoEsocial): Promise<EventoDoCatalogoEsocial[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT id, codigo_esocial, descricao, classe FROM tipo_evento_esocial
            WHERE obrigacao = 'esocial' AND (vigencia_fim IS NULL OR vigencia_fim >= CURDATE())
            ORDER BY codigo_esocial`,
        )
      ).map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo_esocial']),
        nome: String(x['descricao']),
        grupo: numeroDoGrupo(grupoDaClasse(x['classe'])),
      })),
    );
  }

  leiauteCatalogo(c: ContextoEsocial, data: string): Promise<LeiauteDoCatalogoEsocial[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT t.codigo_esocial AS evento, v.codigo_versao, DATE_FORMAT(v.vigencia_inicio, '%Y-%m-%d') AS inicio
           FROM leiaute_esocial v JOIN tipo_evento_esocial t ON t.id = v.tipo_evento_esocial_id
          WHERE (v.vigencia_inicio IS NULL OR v.vigencia_inicio <= ?) AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ?)
          ORDER BY t.codigo_esocial, v.vigencia_inicio DESC`,
        [data, data],
      );
      const vistos = new Set<string>();
      const r: LeiauteDoCatalogoEsocial[] = [];
      for (const x of linhas) {
        const evento = String(x['evento']);
        if (vistos.has(evento)) continue;
        vistos.add(evento);
        r.push({
          evento,
          versao: leiauteDaVersao(String(x['codigo_versao'])),
          inicio: String(x['inicio'] ?? ''),
        });
      }
      return r;
    });
  }

  motivosAfastamento(c: ContextoEsocial): Promise<ItemDoCatalogoEsocial[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT codigo_esocial, descricao FROM motivo_afastamento
          WHERE ativo AND codigo_esocial IS NOT NULL AND (vigencia_fim IS NULL OR vigencia_fim >= CURDATE())
          ORDER BY codigo_esocial, id`,
      );
      const vistos = new Set<string>();
      return linhas
        .filter((x) => !vistos.has(String(x['codigo_esocial'])) && vistos.add(String(x['codigo_esocial'])))
        .map((x) => ({ codigo: String(x['codigo_esocial']), rotulo: String(x['descricao']) }));
    });
  }

  categorias(c: ContextoEsocial): Promise<ItemDoCatalogoEsocial[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT codigo_esocial, descricao FROM categoria_trabalhador
            WHERE vigencia_fim IS NULL OR vigencia_fim >= CURDATE() ORDER BY codigo_esocial`,
        )
      ).map((x) => ({ codigo: String(x['codigo_esocial']), rotulo: String(x['descricao']) })),
    );
  }

  /** Rede inteira (motivo no cabeçalho): o transmissor é único por raiz de CNPJ. */
  cnpjs(c: ContextoEsocial): Promise<Map<number, string | null>> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        'SELECT id, cnpj FROM estabelecimento WHERE excluido_em IS NULL ORDER BY id',
      );
      return new Map(linhas.map((x) => [num(x['id']), txtOuNulo(x['cnpj'])]));
    });
  }

  pendenciasMigradas(c: ContextoEsocial, empresa: number | null): Promise<PendenciaMigradaEsocial[]> {
    return this.ler(c, async (l, est) => {
      if (empresa !== null && empresa !== est) return [];
      const linhas = await l.consultar(
        `SELECT t.codigo_esocial AS evento, YEAR(COALESCE(e.competencia, e.criado_em)) AS ano, COUNT(*) AS n
           FROM evento_esocial e JOIN tipo_evento_esocial t ON t.id = e.tipo_evento_esocial_id
          WHERE e.estabelecimento_id = ? AND e.origem = 'migracao' AND e.excluido_em IS NULL
            AND e.situacao IN ('pendente', 'validado', 'erro_validacao', 'em_lote', 'rejeitado')
          GROUP BY t.codigo_esocial, YEAR(COALESCE(e.competencia, e.criado_em))
          ORDER BY t.codigo_esocial, ano`,
        [est],
      );
      return linhas.map((x) => ({
        evento: String(x['evento']),
        ano: num(x['ano']),
        quantidade: num(x['n']),
      }));
    });
  }

  recibosAutonomo(c: ContextoEsocial, empresa: number, competencia: string): Promise<number> {
    return this.ler(c, async (l, est) => {
      if (empresa !== est) return 0;
      const x = await l.uma(
        `SELECT COUNT(*) AS n FROM recibo_autonomo
          WHERE estabelecimento_id = ? AND competencia = ? AND situacao IN ('emitido', 'pago') AND excluido_em IS NULL`,
        [est, dataDoBanco(competencia)],
      );
      return num(x?.['n']);
    });
  }

  // ── Registros do eSocial (estabelecimento da sessão) ─────────────────────────────────────────────────────

  /** Pendente de DDL (parâmetros do empregador): recusa dizendo o que fica indisponível (nunca lista vazia calada). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta; a operação aguarda o modelo
  async empregadores(_c: ContextoEsocial, _empresa: number | null): Promise<VigenciaEmpregadorEsocial[]> {
    throw PARAMETROS_PENDENTES();
  }

  /** Pendente de DDL (ficha do eSocial do vínculo): recusa (nunca "não preenchida" calado). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta; a operação aguarda o modelo
  async ficha(_c: ContextoEsocial, _vinculo: number): Promise<FichaEsocialCifrada | null> {
    throw FICHA_PENDENTE();
  }

  eventos(c: ContextoEsocial, f: FiltroRegistrosEventoEsocial): Promise<RegistroEventoEsocial[]> {
    return this.ler(c, (l, est) => eventosDe(l, est, f));
  }

  evento(c: ContextoEsocial, id: number): Promise<{ evento: RegistroEventoEsocial; xml: string } | null> {
    return this.ler(c, async (l, est) => {
      const [evento] = await eventosPorId(l, est, [id]);
      if (!evento) return null;
      const x = await l.uma('SELECT xml FROM evento_esocial WHERE id = ? AND estabelecimento_id = ?', [
        id,
        est,
      ]);
      return { evento, xml: String(x?.['xml'] ?? '') };
    });
  }

  contagemEventos(
    c: ContextoEsocial,
    empresas: readonly number[],
    de: string,
    ate: string,
    situacoes: readonly string[],
  ): Promise<Record<string, number>> {
    return this.ler(c, async (l, est) => {
      const r: Record<string, number> = {};
      const banco = [...new Set(situacoes.map(bancoDaSituacao).filter((x): x is string => x !== null))];
      if (!empresas.includes(est) || banco.length === 0) return r;
      const linhas = await l.consultar(
        `SELECT t.codigo_esocial AS evento, e.situacao,
                EXISTS (SELECT 1 FROM evento_esocial x WHERE x.evento_retificado_id = e.id AND x.tipo_operacao = 'retificacao'
                         AND x.situacao = 'processado' AND x.excluido_em IS NULL) AS substituido, COUNT(*) AS n
           FROM evento_esocial e JOIN tipo_evento_esocial t ON t.id = e.tipo_evento_esocial_id
          WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL AND e.competencia BETWEEN ? AND ?
            AND e.situacao IN (${banco.map(() => '?').join(',')})
          GROUP BY t.codigo_esocial, e.situacao, substituido`,
        [est, dataDoBanco(de), dataDoBanco(ate), ...banco],
      );
      for (const x of linhas)
        if (situacoes.includes(situacaoDaTela(x['situacao'], x['substituido']))) {
          const ev = String(x['evento']);
          r[ev] = (r[ev] ?? 0) + num(x['n']);
        }
      return r;
    });
  }

  lotes(
    c: ContextoEsocial,
    f: { readonly empresa?: number; readonly situacao?: string },
  ): Promise<RegistroLoteEsocial[]> {
    return this.ler(c, async (l, est) => {
      if (f.empresa !== undefined && f.empresa !== est) return [];
      const onde = ['o.estabelecimento_id = ?', 'o.excluido_em IS NULL'];
      const p: unknown[] = [est];
      if (f.situacao !== undefined) {
        const s = (SITUACAO_LOTE_BANCO as Record<string, string>)[f.situacao];
        if (!s) return [];
        const banco =
          s === 'enviado' ? ['enviado', 'processando'] : s === 'processado' ? ['processado', 'erro'] : [s];
        onde.push(`o.situacao IN (${banco.map(() => '?').join(',')})`);
        p.push(...banco);
      }
      const linhas = await l.consultar(
        `SELECT ${CAMPOS_LOTE} ${DE_LOTE} WHERE ${onde.join(' AND ')} ORDER BY o.id DESC LIMIT ${TETO_LOTES_ESOCIAL + 1}`,
        p,
      );
      return linhas.map(loteDaLinha);
    });
  }

  lote(c: ContextoEsocial, id: number): Promise<RegistroLoteEsocial | null> {
    return this.ler(c, (l, est) => loteDe(l, est, id));
  }

  /** Pendente de DDL (conferência gravada da conciliação): recusa (nunca "sem conferência" calado). */
  /* eslint-disable @typescript-eslint/no-unused-vars -- assinatura da porta; a operação aguarda o modelo */
  async ultimaConciliacao(
    _c: ContextoEsocial,
    _empresa: number,
    _competencia: string,
  ): Promise<RegistroConciliacaoEsocial | null> {
  /* eslint-enable @typescript-eslint/no-unused-vars */
    throw CONFERENCIA_PENDENTE();
  }
}

export function portaEsocialIndisponivel(): PortaEsocial {
  return portaIndisponivel<PortaEsocial>(METODOS_PORTA_ESOCIAL);
}

/**
 * A porta do eSocial do ambiente: a própria (com o cache curto dos catálogos) quando há núcleo; a memória só em dev/ci
 * sem núcleo; fora disso, indisponível (falha fechada).
 */
export function portaEsocialDoAmbiente(
  nucleo: NucleoEsocial | null | undefined,
  ambiente: string,
): PortaEsocial {
  if (nucleo)
    return comCacheCurtoDosCatalogos(
      new PortaEsocialPropria(nucleo, {
        ambienteEventos: ambiente === 'producao' ? 'producao' : 'producao_restrita',
      }),
    );
  if (ambiente === 'dev' || ambiente === 'ci') return new PortaEsocialMemoria();
  return portaEsocialIndisponivel();
}
