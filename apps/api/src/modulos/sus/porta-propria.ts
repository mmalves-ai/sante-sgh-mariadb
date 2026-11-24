// Porta própria do faturamento SUS (M51) sobre o banco do cliente, pelo @sgh/nucleo: leituras numa transação somente
// leitura e gravações pelo Executor (uma operação `faturamento.sus.gravacao` por pedido, com a trilha, o outbox e a
// idempotência na mesma transação). Tabelas: competencia_sus e critica_sus (contagens), equivalencia_sigtap_item com
// item_faturavel, procedimento_sigtap e os vínculos da tabela unificada (procedimento_sigtap_registro, _cid, _cbo,
// _habilitacao, _leito, _valor, dominio_sigtap), leito_uti_habilitado com dominio_sus e estabelecimento (CNES).
// Toda leitura de tabela com estabelecimento filtra o da sessão; a tabela unificada, o item faturável e a equivalência
// são do cliente inteiro (o mesmo catálogo para a rede), sem estabelecimento.
// Melhoria: a competência segue o ciclo do modelo (aberta, fechada, reaberta, com quem e quando em colunas próprias) e a
// trava otimista pela coluna `versao`; a equivalência SIGTAP é por vigência (fechar não apaga: a história fica), uma só
// vigente por item faturável, e a recusa por versão vista é de negócio, não do banco.
// Melhoria: a trilha da tela (evento, operação, alvo e diferença) vai nos dados da trilha da própria operação, na mesma
// transação (uma linha por gravação, sem tabela de trilha à parte).
// Crítica prévia: critica_sus por conta, item, atendimento ou competência inteira (regra e chave estável, UNIQUE por
// competência), com o detalhe em JSON e a justificativa do aviso; a rodada grava criticada_em, a quantidade de registros
// e o CNES na competência. Faixa de AIH: faixa_numeracao_aih (instrumento `aih`) com o número de 13 dígitos (base e
// dígito), o órgão emissor, a data de liberação e o motivo do cancelamento; o consumo é lido das autorizações.
// O arquivo gerado (número, remessa e registro do núcleo) está em porta-propria-arquivos.ts.
// Ainda por escrever nesta porta (a estrutura existe no banco, ver ddl-aplicado-v3): as linhas do BPA,
// da APAC e da CIHA ligadas ao arquivo, o ciclo da AIH (laudo, autorização e conta) e da APAC pela tela atual e o
// retorno por linha. Até lá,
// essas leituras saem vazias e as gravações recusam com "modelo-pendente". A montagem a partir da conta própria
// (atendimentos, itens, internação e trajetória da competência) é do lote da conta e da internação: hoje sai vazia.
import { randomUUID } from 'node:crypto';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Escritor,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { numeroAih } from '@sgh/dominio-faturamento';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type {
  AtendimentoLido,
  ContextoSus,
  DadosBpaLidos,
  DadosCihaLidos,
  GravacaoSus,
  LeituraSus,
  PortaSus,
} from './porta.js';
import type { DadosAihLidos, SolicitanteAihLido } from './porta-aih.js';
import {
  gravarRemessa,
  lerArquivo,
  lerArquivos,
  linhasPendentes,
  proximoNumeroArquivo,
  TABELAS_ARQUIVO_SUS,
} from './porta-propria-arquivos.js';
import {
  type ArquivoSus,
  type CompatibilidadeSigtap,
  type CompetenciaSusRegistro,
  type LinhaApacParaGravar,
  type LinhaBpaParaGravar,
  type NovoArquivoSus,
  type RegistroCihaParaGravar,
  type CriticaSus,
  type EquivalenciaSus,
  type EquivalenciaSusNomeada,
  ErroAih,
  type FaixaAih,
  type FiltroCriticasPorta,
  type NovaCriticaSus,
  type ResultadoGravacaoCriticas,
  ErroSus,
  type FiltroEquivalenciasPorta,
  type InstrumentoSusPorta,
  type LinhaTrilhaSus,
  type ProcedimentoHospital,
  type ProcedimentoSigtapRegra,
  type RegistroSigtap,
  type ValorSigtap,
} from './tipos.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoSus = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
const numOuNulo = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const txtOuNulo = (v: unknown): string | null => {
  const t = txt(v).trim();
  return t === '' ? null : t;
};

/** As tabelas que a operação de gravação do faturamento SUS declara (a transação recusa as outras). */
export const TABELAS_SUS = [
  'competencia_sus',
  'equivalencia_sigtap_item',
  'critica_sus',
  'faixa_numeracao_aih',
  ...TABELAS_ARQUIVO_SUS,
] as const;

/** Os instrumentos do faturamento SUS que a tela usa (o modelo também tem RAAS, fora desta tela). */
const INSTRUMENTOS: readonly InstrumentoSusPorta[] = ['ciha', 'bpa', 'apac', 'aih'];

/** A recusa da gravação que o modelo ainda não guarda (pedido do lote 03-05). */
export function modeloPendente(oque: string): never {
  throw recusa(
    'modelo-pendente',
    `O banco do cliente ainda não guarda ${oque}: a gravação foi recusada e nada mudou (pedido de modelo registrado).`,
  );
}

/** AAAAMM → primeiro e último dia (texto ISO). */
export function periodoDaCompetencia(competencia: string): { inicio: string; fim: string } {
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(competencia)) throw new Error('competência AAAAMM');
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(4, 6));
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const m = String(mes).padStart(2, '0');
  return { inicio: `${ano}-${m}-01`, fim: `${ano}-${m}-${String(ultimo).padStart(2, '0')}` };
}

/** Data ISO → competência AAAAMM numérica; sem data (vigente), 0, como a montagem lê a vigência aberta. */
export function competenciaDaData(d: unknown): number {
  const t = txt(d);
  return /^\d{4}-\d{2}/.test(t) ? Number(t.slice(0, 4) + t.slice(5, 7)) : 0;
}

/** A situação do modelo na tela: aberta e reaberta aceitam crítica e arquivo; as demais estão fechadas. */
export function situacaoDaTela(situacao: string): 'aberta' | 'fechada' {
  return situacao === 'aberta' || situacao === 'reaberta' ? 'aberta' : 'fechada';
}

const hojeIso = (): string => new Date().toISOString().slice(0, 10);
const instante = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%dT%H:%i:%s.%fZ')`;
const dia = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%d')`;
const login = (col: string) => `(SELECT u.login FROM usuario u WHERE u.id = ${col})`;

const SQL_COMPETENCIA = `
  SELECT c.id, c.instrumento, c.competencia, c.situacao, c.versao, e.codigo_cnes AS cnes,
         ${instante('c.aberta_em')} AS aberta_em, ${login('c.aberta_por_usuario_id')} AS aberta_por,
         ${instante('c.fechada_em')} AS fechada_em, ${login('c.fechada_por_usuario_id')} AS fechada_por,
         ${instante('c.reaberta_em')} AS reaberta_em, ${login('c.reaberta_por_usuario_id')} AS reaberta_por,
         (SELECT COUNT(*) FROM critica_sus k WHERE k.competencia_sus_id = c.id AND k.situacao = 'aberta'
             AND k.gravidade = 'bloqueante') AS bloqueantes,
         (SELECT COUNT(*) FROM critica_sus k WHERE k.competencia_sus_id = c.id AND k.situacao = 'aberta'
             AND k.gravidade = 'aviso') AS avisos,
         ${instante('c.criticada_em')} AS criticada_em, c.quantidade_registros_criticados AS registros
    FROM competencia_sus c JOIN estabelecimento e ON e.id = c.estabelecimento_id
   WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL`;

function competenciaDaLinha(x: Linha): CompetenciaSusRegistro {
  return {
    id: num(x['id']),
    instrumento: txt(x['instrumento']) as InstrumentoSusPorta,
    competencia: txt(x['competencia']),
    situacao: situacaoDaTela(txt(x['situacao'])),
    cnes: txtOuNulo(x['cnes']),
    registros: num(x['registros']),
    bloqueantes: num(x['bloqueantes']),
    avisos: num(x['avisos']),
    criticadaEm: txtOuNulo(x['criticada_em']),
    abertaPor: txt(x['aberta_por']),
    abertaEm: txt(x['aberta_em']),
    fechadaPor: txtOuNulo(x['fechada_por']),
    fechadaEm: txtOuNulo(x['fechada_em']),
    reabertaPor: txtOuNulo(x['reaberta_por']),
    reabertaEm: txtOuNulo(x['reaberta_em']),
    versao: num(x['versao']),
  };
}

const SQL_EQUIVALENCIA = `
  SELECT q.id, q.item_faturavel_id, i.codigo AS codigo_item, i.descricao AS nome_item, i.tipo_item,
         q.procedimento_sigtap_id, p.codigo_sigtap, p.descricao AS nome_sigtap, (q.vigencia_fim IS NULL) AS ativa,
         ${login('q.criado_por')} AS registrada_por, ${instante('q.criado_em')} AS registrada_em, q.versao
    FROM equivalencia_sigtap_item q
    JOIN item_faturavel i ON i.id = q.item_faturavel_id
    JOIN procedimento_sigtap p ON p.id = q.procedimento_sigtap_id
   WHERE q.excluido_em IS NULL AND q.instrumento IN ('ciha', 'bpa', 'todos')`;

/** O código do item faturável na tela (numérico; o código com letra fica no nome do item). */
function codigoDoItem(v: unknown): number {
  const t = txt(v).trim();
  return /^\d{1,15}$/.test(t) ? Number(t) : 0;
}

function equivalenciaDaLinha(x: Linha): EquivalenciaSusNomeada {
  return {
    id: num(x['id']),
    procedimento: num(x['item_faturavel_id']),
    codigoProcedimento: codigoDoItem(x['codigo_item']),
    sigtap: num(x['procedimento_sigtap_id']),
    codigo: txt(x['codigo_sigtap']),
    ativa: num(x['ativa']) === 1,
    registradaPor: txt(x['registrada_por']),
    registradaEm: txt(x['registrada_em']),
    versao: num(x['versao']),
    procedimentoNome: txtOuNulo(x['nome_item']),
    tabela: txtOuNulo(x['tipo_item']),
    sigtapNome: txtOuNulo(x['nome_sigtap']),
  };
}

const semNomes = (x: EquivalenciaSusNomeada): EquivalenciaSus => {
  const { procedimentoNome, tabela, sigtapNome, ...e } = x;
  void procedimentoNome;
  void tabela;
  void sigtapNome;
  return e;
};

const marcadores = (n: number) => Array.from({ length: n }, () => '?').join(', ');

const SQL_CRITICA = `
  SELECT k.id, k.competencia_sus_id, k.codigo_regra, k.gravidade, k.situacao, k.conta_hospitalar_id, k.atendimento_id,
         k.conta_hospitalar_item_id, k.fonte_pagadora_id, k.detalhe, k.justificativa, k.versao
    FROM critica_sus k JOIN competencia_sus c ON c.id = k.competencia_sus_id
   WHERE c.estabelecimento_id = ? AND k.excluido_em IS NULL`;

/** O detalhe guardado em JSON volta como o texto curto que a montagem gerou. */
function detalheDaCritica(v: unknown): string {
  // O driver pode devolver a coluna JSON já interpretada (objeto) ou como texto.
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  const t = txt(v);
  try {
    const x: unknown = JSON.parse(t);
    return typeof x === 'string' ? x : t;
  } catch {
    return t;
  }
}

/** O detalhe da montagem (JSON curto) como JSON válido para a coluna. */
function detalheParaGravar(d: string): string {
  try {
    JSON.parse(d);
    return d;
  } catch {
    return JSON.stringify(d);
  }
}

function criticaDaLinha(x: Linha): CriticaSus & { competencia: number; convenio: number | null } {
  const situacao = txt(x['situacao']);
  return {
    id: num(x['id']),
    regra: txt(x['codigo_regra']),
    gravidade: txt(x['gravidade']) === 'aviso' ? 'aviso' : 'bloqueante',
    // `ignorada` é a situação de carga antiga: na tela, a crítica que não pede mais ação é a corrigida.
    situacao: situacao === 'aberta' || situacao === 'justificada' ? situacao : 'corrigida',
    conta: numOuNulo(x['conta_hospitalar_id']),
    atendimento: numOuNulo(x['atendimento_id']),
    item: numOuNulo(x['conta_hospitalar_item_id']),
    detalhe: detalheDaCritica(x['detalhe']),
    justificativa: txtOuNulo(x['justificativa']),
    versao: num(x['versao']),
    competencia: num(x['competencia_sus_id']),
    convenio: numOuNulo(x['fonte_pagadora_id']),
  };
}

const SQL_FAIXA = `
  SELECT f.id, f.numero_inicial, f.numero_final, f.orgao_emissor, ${dia('f.data_liberacao')} AS data_liberacao,
         f.situacao, f.motivo_situacao, ${login('f.recebida_por_usuario_id')} AS registrada_por,
         ${instante('f.recebida_em')} AS registrada_em, f.versao,
         (SELECT COUNT(a.numero_aih) FROM autorizacao_internacao_sus a
           WHERE a.faixa_numeracao_aih_id = f.id AND a.excluido_em IS NULL) AS usados
    FROM faixa_numeracao_aih f
   WHERE f.estabelecimento_id = ? AND f.instrumento = 'aih'`;

/** A faixa na tela: a base de 12 dígitos (o banco guarda o número de 13, com o dígito). */
function faixaDaLinha(x: Linha): FaixaAih {
  const situacao = txt(x['situacao']);
  return {
    id: num(x['id']),
    inicio: txt(x['numero_inicial']).slice(0, 12),
    fim: txt(x['numero_final']).slice(0, 12),
    orgaoEmissor: txt(x['orgao_emissor']),
    dataLiberacao: txt(x['data_liberacao']),
    situacao: situacao === 'esgotada' || situacao === 'cancelada' ? situacao : 'ativa',
    justificativa: txtOuNulo(x['motivo_situacao']),
    usados: num(x['usados']),
    registradaPor: txt(x['registrada_por']),
    registradaEm: txt(x['registrada_em']),
    versao: num(x['versao']),
  };
}

/** As leituras do faturamento SUS sobre uma conexão (a somente leitura ou a da transação da gravação). */
export class LeituraSusPropria implements LeituraSus {
  constructor(
    protected readonly l: Leitor,
    protected readonly est: number,
    /** Dentro da gravação, as leituras com `travar` travam a linha (SELECT ... FOR UPDATE do núcleo). */
    protected readonly travador: Escritor | null = null,
  ) {}

  // ── Competência ──

  async competencias(instrumento: InstrumentoSusPorta | null): Promise<CompetenciaSusRegistro[]> {
    const filtro = instrumento
      ? ' AND c.instrumento = ?'
      : ` AND c.instrumento IN (${marcadores(INSTRUMENTOS.length)})`;
    const ls = await this.l.consultar(
      `${SQL_COMPETENCIA}${filtro} ORDER BY c.competencia DESC, c.instrumento`,
      [this.est, ...(instrumento ? [instrumento] : INSTRUMENTOS)],
      { teto: 2_000 },
    );
    return ls.map(competenciaDaLinha);
  }

  async competencia(
    instrumento: InstrumentoSusPorta,
    competencia: string,
    travar?: boolean,
  ): Promise<CompetenciaSusRegistro | null> {
    if (travar && this.travador)
      await this.travador.consultarParaAtualizar(
        'SELECT id FROM competencia_sus WHERE estabelecimento_id = ? AND instrumento = ? AND competencia = ?',
        [this.est, instrumento, competencia],
      );
    const x = await this.l.uma(`${SQL_COMPETENCIA} AND c.instrumento = ? AND c.competencia = ?`, [
      this.est,
      instrumento,
      competencia,
    ]);
    return x ? competenciaDaLinha(x) : null;
  }

  // ── Crítica prévia (da competência do estabelecimento) ──

  async criticas(
    competencia: number,
    f: FiltroCriticasPorta,
  ): Promise<{ itens: CriticaSus[]; total: number; porRegra: Record<string, number> }> {
    let escopo = ' AND k.competencia_sus_id = ?';
    const pe: unknown[] = [this.est, competencia];
    if (f.convenios !== null) {
      escopo += f.convenios.length
        ? ` AND (k.fonte_pagadora_id IS NULL OR k.fonte_pagadora_id IN (${marcadores(f.convenios.length)}))`
        : ' AND k.fonte_pagadora_id IS NULL';
      pe.push(...f.convenios);
    }
    let filtro = ' AND k.situacao = ?';
    const pf: unknown[] = [f.situacao ?? 'aberta'];
    if (f.regra) {
      filtro += ' AND k.codigo_regra = ?';
      pf.push(f.regra);
    }
    if (f.gravidade) {
      filtro += ' AND k.gravidade = ?';
      pf.push(f.gravidade);
    }
    const total = num(
      (await this.l.uma(`SELECT COUNT(*) AS n FROM (${SQL_CRITICA}${escopo}${filtro}) t`, [...pe, ...pf]))?.[
        'n'
      ],
    );
    const porPagina = Math.max(1, Math.min(500, f.porPagina));
    const ls = await this.l.consultar(
      `${SQL_CRITICA}${escopo}${filtro} ORDER BY k.gravidade DESC, k.codigo_regra, k.id LIMIT ? OFFSET ?`,
      [...pe, ...pf, porPagina, Math.max(0, f.pagina) * porPagina],
      { teto: 500 },
    );
    const porRegra: Record<string, number> = {};
    for (const x of await this.l.consultar(
      `SELECT t.codigo_regra, COUNT(*) AS n FROM (${SQL_CRITICA}${escopo} AND k.situacao = 'aberta') t GROUP BY t.codigo_regra`,
      pe,
      { teto: 1_000 },
    ))
      porRegra[txt(x['codigo_regra'])] = num(x['n']);
    return {
      itens: ls.map((x) => {
        const { competencia: _c, convenio: _v, ...k } = criticaDaLinha(x);
        void _c;
        void _v;
        return k;
      }),
      total,
      porRegra,
    };
  }

  async critica(id: number): Promise<(CriticaSus & { competencia: number; convenio: number | null }) | null> {
    const x = await this.l.uma(`${SQL_CRITICA} AND k.id = ?`, [this.est, id]);
    return x ? criticaDaLinha(x) : null;
  }

  arquivos(instrumento: InstrumentoSusPorta, competencia: string | null): Promise<ArquivoSus[]> {
    return lerArquivos(this.l, this.est, instrumento, competencia);
  }

  arquivo(id: number): Promise<ArquivoSus | null> {
    return lerArquivo(this.l, this.est, id);
  }

  // ── Equivalência SIGTAP (do cliente inteiro) ──

  async equivalencias(): Promise<EquivalenciaSus[]> {
    const ls = await this.l.consultar(`${SQL_EQUIVALENCIA} AND q.vigencia_fim IS NULL ORDER BY q.id`, [], {
      teto: 50_000,
    });
    return ls.map((x) => semNomes(equivalenciaDaLinha(x)));
  }

  async paginaEquivalencias(
    f: FiltroEquivalenciasPorta,
  ): Promise<{ itens: EquivalenciaSusNomeada[]; total: number }> {
    let where = '';
    const p: unknown[] = [];
    if (!f.inativas) where += ' AND q.vigencia_fim IS NULL';
    if (f.procedimento !== undefined) {
      where += ' AND q.item_faturavel_id = ?';
      p.push(f.procedimento);
    }
    const termo = f.termo?.trim();
    if (termo) {
      where += ' AND (i.codigo LIKE ? OR i.descricao LIKE ? OR p.codigo_sigtap LIKE ? OR p.descricao LIKE ?)';
      const like = `%${termo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      p.push(like, like, like, like);
    }
    const total = num(
      (await this.l.uma(`SELECT COUNT(*) AS n FROM (${SQL_EQUIVALENCIA}${where}) t`, p))?.['n'],
    );
    const porPagina = Math.max(1, Math.min(200, f.porPagina));
    const ls = await this.l.consultar(
      `${SQL_EQUIVALENCIA}${where} ORDER BY ativa DESC, i.descricao, q.id LIMIT ? OFFSET ?`,
      [...p, porPagina, (Math.max(1, f.pagina) - 1) * porPagina],
      { teto: 200 },
    );
    return { itens: ls.map(equivalenciaDaLinha), total };
  }

  // ── Tabela unificada (do cliente inteiro) ──

  async sigtapPorCodigo(codigo: string): Promise<{ id: number; codigo: string; nome: string } | null> {
    const x = await this.l.uma(
      'SELECT id, codigo_sigtap, descricao FROM procedimento_sigtap WHERE codigo_sigtap = ?',
      [codigo],
    );
    return x ? { id: num(x['id']), codigo: txt(x['codigo_sigtap']), nome: txt(x['descricao']) } : null;
  }

  async buscarSigtap(
    termo: string,
    competencia: number | null,
  ): Promise<{ id: number; codigo: string; nome: string; vigente: boolean }[]> {
    const t = termo.trim();
    if (t.length < 2) return [];
    const dia = competencia ? periodoDaCompetencia(String(competencia)).inicio : hojeIso();
    const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const ls = await this.l.consultar(
      `SELECT id, codigo_sigtap, descricao,
              (ativo AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)) AS vigente
         FROM procedimento_sigtap
        WHERE codigo_sigtap LIKE ? OR descricao LIKE ?
        ORDER BY vigente DESC, codigo_sigtap LIMIT 30`,
      [dia, dia, `${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, like],
      { teto: 30 },
    );
    return ls.map((x) => ({
      id: num(x['id']),
      codigo: txt(x['codigo_sigtap']),
      nome: txt(x['descricao']),
      vigente: num(x['vigente']) === 1,
    }));
  }

  async nomesSigtap(ids: readonly number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (ids.length === 0) return out;
    const ls = await this.l.consultar(
      `SELECT id, descricao FROM procedimento_sigtap WHERE id IN (${marcadores(ids.length)})`,
      [...ids],
      { teto: ids.length },
    );
    for (const x of ls) out.set(num(x['id']), txt(x['descricao']));
    return out;
  }

  async valoresSigtap(ids: readonly number[]): Promise<ValorSigtap[]> {
    if (ids.length === 0) return [];
    const ls = await this.l.consultar(
      `SELECT procedimento_sigtap_id AS id, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS data,
              valor_servico_hospitalar, valor_servico_profissional, valor_servico_ambulatorial, valor_total_ambulatorial
         FROM procedimento_sigtap_valor
        WHERE procedimento_sigtap_id IN (${marcadores(ids.length)})
        ORDER BY procedimento_sigtap_id, vigencia_inicio`,
      [...ids],
      { teto: 50_000 },
    );
    return ls.map((x) => ({
      id: num(x['id']),
      data: txt(x['data']),
      servicoHospitalar: num(x['valor_servico_hospitalar']),
      servicoProfissional: num(x['valor_servico_profissional']),
      sadt: num(x['valor_servico_ambulatorial']),
      ambulatorial: num(x['valor_total_ambulatorial']),
    }));
  }

  /** Os atributos, os instrumentos de registro e as compatibilidades dos procedimentos pedidos. */
  protected async sigtapDosIds(ids: readonly number[]): Promise<{
    procedimentos: ProcedimentoSigtapRegra[];
    registros: RegistroSigtap[];
    compatibilidades: DadosBpaLidos['compatibilidades'];
  }> {
    const vazio = { cids: [], cbos: [], habilitacoes: [], leitos: [] };
    const unicos = [...new Set(ids.filter((i) => Number.isFinite(i) && i > 0))];
    if (unicos.length === 0) return { procedimentos: [], registros: [], compatibilidades: vazio };
    const em = `IN (${marcadores(unicos.length)})`;
    const procs = await this.l.consultar(
      `SELECT p.id, p.codigo_sigtap, ${dia('p.vigencia_inicio')} AS vigencia_inicio, ${dia('p.vigencia_fim')} AS vigencia_fim, p.idade_minima_meses, p.idade_maxima_meses,
              p.sexo, p.quantidade_maxima, p.permanencia_dias, COALESCE(d.sigla, d.codigo_sigtap) AS complexidade
         FROM procedimento_sigtap p LEFT JOIN dominio_sigtap d ON d.id = p.complexidade_dominio_sigtap_id
        WHERE p.id ${em}`,
      unicos,
      { teto: unicos.length },
    );
    const sexo = (s: string): string | null => (s === 'masculino' ? 'M' : s === 'feminino' ? 'F' : null);
    const procedimentos = procs.map((x) => ({
      id: num(x['id']),
      codigo: txt(x['codigo_sigtap']),
      competenciaInicial: competenciaDaData(x['vigencia_inicio']),
      competenciaFinal: competenciaDaData(x['vigencia_fim']),
      idadeMinima: numOuNulo(x['idade_minima_meses']),
      idadeMaxima: numOuNulo(x['idade_maxima_meses']),
      sexo: sexo(txt(x['sexo'])),
      quantidadeMaxima: numOuNulo(x['quantidade_maxima']),
      permanencia: numOuNulo(x['permanencia_dias']),
      complexidade: txtOuNulo(x['complexidade']),
    }));
    const datas = (x: Linha) => ({
      competenciaInicial: competenciaDaData(x['vigencia_inicio']),
      competenciaFinal: competenciaDaData(x['vigencia_fim']),
    });
    const regs = await this.l.consultar(
      `SELECT r.procedimento_sigtap_id AS id, d.codigo_sigtap AS registro, ${dia('r.vigencia_inicio')} AS vigencia_inicio,
              ${dia('r.vigencia_fim')} AS vigencia_fim
         FROM procedimento_sigtap_registro r JOIN dominio_sigtap d ON d.id = r.instrumento_dominio_sigtap_id
        WHERE r.procedimento_sigtap_id ${em}`,
      unicos,
      { teto: 50_000 },
    );
    const vinculo = async (sql: string): Promise<CompatibilidadeSigtap[]> =>
      (await this.l.consultar(sql, unicos, { teto: 200_000 })).map((x) => ({
        id: num(x['id']),
        codigo: txt(x['codigo']),
        ...datas(x),
      }));
    return {
      procedimentos,
      registros: regs.map((x) => ({ id: num(x['id']), registro: txt(x['registro']), ...datas(x) })),
      compatibilidades: {
        cids: await vinculo(
          `SELECT v.procedimento_sigtap_id AS id, REPLACE(t.codigo_termo, '.', '') AS codigo, DATE_FORMAT(v.vigencia_inicio, '%Y-%m-%d') AS vigencia_inicio,
                  DATE_FORMAT(v.vigencia_fim, '%Y-%m-%d') AS vigencia_fim
             FROM procedimento_sigtap_cid v JOIN termo_terminologia t ON t.id = v.cid_termo_terminologia_id
            WHERE v.procedimento_sigtap_id ${em}`,
        ),
        cbos: await vinculo(
          `SELECT v.procedimento_sigtap_id AS id, o.codigo_cbo AS codigo, DATE_FORMAT(v.vigencia_inicio, '%Y-%m-%d') AS vigencia_inicio,
                  DATE_FORMAT(v.vigencia_fim, '%Y-%m-%d') AS vigencia_fim
             FROM procedimento_sigtap_cbo v JOIN ocupacao_cbo o ON o.id = v.ocupacao_cbo_id
            WHERE v.procedimento_sigtap_id ${em}`,
        ),
        habilitacoes: await vinculo(
          `SELECT v.procedimento_sigtap_id AS id, h.codigo_habilitacao AS codigo, DATE_FORMAT(v.vigencia_inicio, '%Y-%m-%d') AS vigencia_inicio,
                  DATE_FORMAT(v.vigencia_fim, '%Y-%m-%d') AS vigencia_fim
             FROM procedimento_sigtap_habilitacao v JOIN habilitacao_sigtap h ON h.id = v.habilitacao_sigtap_id
            WHERE v.procedimento_sigtap_id ${em}`,
        ),
        leitos: await vinculo(
          `SELECT v.procedimento_sigtap_id AS id, l.codigo_cnes_tipo_leito AS codigo, DATE_FORMAT(v.vigencia_inicio, '%Y-%m-%d') AS vigencia_inicio,
                  DATE_FORMAT(v.vigencia_fim, '%Y-%m-%d') AS vigencia_fim
             FROM procedimento_sigtap_leito v JOIN especialidade_leito l ON l.id = v.especialidade_leito_id
            WHERE v.procedimento_sigtap_id ${em}`,
        ),
      },
    };
  }

  /** O CNES do estabelecimento da sessão (a crítica confere o do cabeçalho contra os cadastrados). */
  protected async cnesCadastrados(): Promise<number[]> {
    const x = await this.l.uma('SELECT codigo_cnes FROM estabelecimento WHERE id = ?', [this.est]);
    const c = txtOuNulo(x?.['codigo_cnes']);
    return c && /^\d{7}$/.test(c) ? [Number(c)] : [];
  }

  // ── Itens faturáveis do hospital (a origem da equivalência) ──

  async buscarProcedimentosHospital(termo: string): Promise<ProcedimentoHospital[]> {
    const t = termo.trim();
    if (t.length < 2) return [];
    const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const ls = await this.l.consultar(
      `SELECT id, codigo, descricao, tipo_item FROM item_faturavel
        WHERE excluido_em IS NULL AND situacao = 'ativo' AND (codigo LIKE ? OR descricao LIKE ?)
        ORDER BY descricao, id LIMIT 30`,
      [like, like],
      { teto: 30 },
    );
    return ls.map((x) => ({
      id: num(x['id']),
      codigo: codigoDoItem(x['codigo']),
      nome: txt(x['descricao']),
      tabela: txt(x['tipo_item']),
    }));
  }

  async procedimentosHospital(ids: readonly number[]): Promise<ProcedimentoHospital[]> {
    if (ids.length === 0) return [];
    const ls = await this.l.consultar(
      `SELECT id, codigo, descricao, tipo_item FROM item_faturavel WHERE id IN (${marcadores(ids.length)})`,
      [...ids],
      { teto: ids.length },
    );
    return ls.map((x) => ({
      id: num(x['id']),
      codigo: codigoDoItem(x['codigo']),
      nome: txt(x['descricao']),
      tabela: txt(x['tipo_item']),
    }));
  }

  // ── Montagem: a produção da competência (a conta própria é do lote da conta; hoje vazia) ──

  async dadosCiha(
    _intervalo: { readonly inicio: string; readonly fim: string },
    _conveniosSus: readonly number[],
    sigtapExtra: readonly number[],
  ): Promise<DadosCihaLidos> {
    const atendimentos: AtendimentoLido[] = [];
    const s = await this.sigtapDosIds(sigtapExtra);
    return {
      atendimentos,
      procedimentos: s.procedimentos,
      historico: [],
      registros: s.registros,
      cids: new Set<string>(),
      cnesCadastrados: await this.cnesCadastrados(),
    };
  }

  async dadosBpa(
    _intervalo: { readonly inicio: string; readonly fim: string },
    _conveniosSus: readonly number[],
    sigtapExtra: readonly number[],
  ): Promise<DadosBpaLidos> {
    const s = await this.sigtapDosIds(sigtapExtra);
    return {
      atendimentos: [],
      procedimentos: s.procedimentos,
      historico: [],
      registros: s.registros,
      compatibilidades: s.compatibilidades,
      cids: new Set<string>(),
      cnesCadastrados: await this.cnesCadastrados(),
    };
  }

  async dadosAih(
    _registros: readonly number[],
    codigos: readonly string[],
    sigtapExtra: readonly number[],
  ): Promise<DadosAihLidos> {
    const porCodigo: { id: number; codigo: string; nome: string }[] = [];
    for (const c of [...new Set(codigos)]) {
      const x = await this.sigtapPorCodigo(c);
      if (x) porCodigo.push(x);
    }
    const s = await this.sigtapDosIds([...sigtapExtra, ...porCodigo.map((p) => p.id)]);
    return {
      internacoes: [],
      itens: [],
      passagens: [],
      procedimentos: s.procedimentos,
      historico: [],
      registros: s.registros,
      compatibilidades: s.compatibilidades,
      porCodigo,
      cids: new Set<string>(),
      leitosUti: await this.leitosUti(),
      cnesCadastrados: await this.cnesCadastrados(),
    };
  }

  async linhasBpa(): Promise<{
    itens: never[];
    total: number;
    porTipo: Record<string, { linhas: number; quantidade: number }>;
  }> {
    return { itens: [], total: 0, porTipo: {} };
  }

  async buscarSolicitantes(): Promise<never[]> {
    return [];
  }

  async parametrosCadastro(): Promise<{ competenciaAmbulatorio: null; versao: null; orgao: null }> {
    return { competenciaAmbulatorio: null, versao: null, orgao: null };
  }

  // ── APAC (pendente de modelo pela tela atual: leituras vazias) ──

  async apac(): Promise<null> {
    return null;
  }

  async paginaApacs(): Promise<{ itens: never[]; total: number; porSituacao: Record<string, number> }> {
    return { itens: [], total: 0, porSituacao: {} };
  }

  async apacsDaCompetencia(): Promise<never[]> {
    return [];
  }

  async atendimentoLaudoApac(): Promise<null> {
    return null;
  }

  async dominiosApac(): Promise<{
    caracteristicaTratamento: never[];
    contraindicacaoTransplante: never[];
    situacaoTransplante: never[];
    acessoVascular: never[];
  }> {
    return {
      caracteristicaTratamento: [],
      contraindicacaoTransplante: [],
      situacaoTransplante: [],
      acessoVascular: [],
    };
  }

  async buscarSolicitantesApac(): Promise<never[]> {
    return [];
  }

  async solicitantesApacPorChave(): Promise<never[]> {
    return [];
  }

  async linhasApac(): Promise<{ itens: never[]; total: number; apacs: number; quantidade: number }> {
    return { itens: [], total: 0, apacs: 0, quantidade: 0 };
  }

  // ── AIH: leitos de UTI habilitados (o restante do ciclo é pendente de modelo) ──

  async leitosUti(): Promise<{ tipo: number; nome: string; leitos: number }[]> {
    const hoje = hojeIso();
    const ls = await this.l.consultar(
      `SELECT d.codigo_oficial, d.codigo, d.descricao, SUM(h.quantidade_leitos) AS leitos
         FROM leito_uti_habilitado h JOIN dominio_sus d ON d.id = h.tipo_uti_dominio_sus_id
        WHERE h.estabelecimento_id = ? AND h.ativo
          AND h.vigencia_inicio <= ? AND (h.vigencia_fim IS NULL OR h.vigencia_fim >= ?)
        GROUP BY d.id, d.codigo_oficial, d.codigo, d.descricao
        ORDER BY d.codigo_oficial, d.codigo`,
      [this.est, hoje, hoje],
      { teto: 500 },
    );
    return ls
      .map((x) => ({
        tipo: Number(txtOuNulo(x['codigo_oficial']) ?? txt(x['codigo'])),
        nome: txt(x['descricao']),
        leitos: num(x['leitos']),
      }))
      .filter((x) => Number.isFinite(x.tipo));
  }

  async internacaoAih(): Promise<null> {
    return null;
  }

  async internacoesSus(): Promise<never[]> {
    return [];
  }

  async lotesSaida(): Promise<never[]> {
    return [];
  }

  async solicitanteAih(): Promise<SolicitanteAihLido | null> {
    return null;
  }

  async faixasAih(): Promise<FaixaAih[]> {
    return (
      await this.l.consultar(`${SQL_FAIXA} ORDER BY f.numero_inicial DESC`, [this.est], { teto: 2_000 })
    ).map(faixaDaLinha);
  }

  async faixaAih(id: number, travar?: boolean): Promise<FaixaAih | null> {
    if (travar && this.travador)
      await this.travador.consultarParaAtualizar(
        "SELECT id FROM faixa_numeracao_aih WHERE id = ? AND estabelecimento_id = ? AND instrumento = 'aih'",
        [id, this.est],
      );
    const x = await this.l.uma(`${SQL_FAIXA} AND f.id = ?`, [this.est, id]);
    return x ? faixaDaLinha(x) : null;
  }

  /** O maior número de AIH já dado pela faixa (nas autorizações do estabelecimento); nulo se nenhum. */
  async maiorNumeroDaFaixa(id: number): Promise<string | null> {
    const x = await this.l.uma(
      `SELECT MAX(a.numero_aih) AS maior FROM autorizacao_internacao_sus a
         JOIN faixa_numeracao_aih f ON f.id = a.faixa_numeracao_aih_id AND f.estabelecimento_id = ?
        WHERE a.faixa_numeracao_aih_id = ? AND a.excluido_em IS NULL`,
      [this.est, id],
    );
    return txtOuNulo(x?.['maior']);
  }

  async numeroAihEmUso(numero: string): Promise<boolean> {
    // O número da AIH é único no estabelecimento: na autorização e na conta.
    const x = await this.l.uma(
      `SELECT (EXISTS (SELECT 1 FROM autorizacao_internacao_sus WHERE estabelecimento_id = ? AND numero_aih = ?
                         AND excluido_em IS NULL)
            OR EXISTS (SELECT 1 FROM conta_aih WHERE estabelecimento_id = ? AND numero_aih = ? AND excluido_em IS NULL))
              AS usado`,
      [this.est, numero, this.est, numero],
    );
    return num(x?.['usado']) === 1;
  }

  async aih(): Promise<null> {
    return null;
  }

  async aihPorNumero(): Promise<null> {
    return null;
  }

  async aihsDasInternacoes(): Promise<never[]> {
    return [];
  }

  async aihsParaApresentar(): Promise<never[]> {
    return [];
  }

  async paginaAihs(): Promise<{ itens: never[]; total: number; porSituacao: Record<string, number> }> {
    return { itens: [], total: 0, porSituacao: {} };
  }

  async itensAih(): Promise<never[]> {
    return [];
  }

  async linhaBpaDaCompetencia(): Promise<null> {
    return null;
  }

  async paginaRetornos(): Promise<{
    itens: never[];
    total: number;
    porSituacao: Record<string, number>;
    valorGlosado: number;
  }> {
    return { itens: [], total: 0, porSituacao: {}, valorGlosado: 0 };
  }

  async retornoSus(): Promise<null> {
    return null;
  }

  async ultimoRetornoDaAih(): Promise<null> {
    return null;
  }
}

/** As gravações na transação da operação (o Escritor restrito às tabelas declaradas). */
export class GravacaoSusPropria extends LeituraSusPropria implements GravacaoSus {
  readonly linhas: LinhaTrilhaSus[] = [];

  constructor(
    private readonly tx: TxOperacao,
    est: number,
  ) {
    super(tx, est, tx);
  }

  private async competenciaPorId(id: number): Promise<CompetenciaSusRegistro> {
    await this.tx.consultarParaAtualizar(
      'SELECT id FROM competencia_sus WHERE id = ? AND estabelecimento_id = ?',
      [id, this.est],
    );
    const x = await this.tx.uma(`${SQL_COMPETENCIA} AND c.id = ?`, [this.est, id]);
    if (!x) throw new ErroSus('nao-encontrado', 'Competência não encontrada.');
    return competenciaDaLinha(x);
  }

  async abrir(p: {
    instrumento: InstrumentoSusPorta;
    competencia: string;
    por: string;
  }): Promise<CompetenciaSusRegistro> {
    if (await this.competencia(p.instrumento, p.competencia, true))
      throw new ErroSus('competencia-ja-aberta', 'A competência já foi aberta para o instrumento.');
    const { inicio, fim } = periodoDaCompetencia(p.competencia);
    const id = await this.tx.incluir('competencia_sus', {
      estabelecimento_id: this.est,
      instrumento: p.instrumento,
      competencia: p.competencia,
      periodo_inicio: inicio,
      periodo_fim: fim,
      situacao: 'aberta',
      aberta_em: new Date(),
      aberta_por_usuario_id: this.tx.contexto.usuario,
    });
    return this.competenciaPorId(id);
  }

  async fechar(c: { id: number; versao: number }): Promise<void> {
    const atual = await this.competenciaPorId(c.id);
    if (atual.versao !== c.versao)
      throw new ErroSus('versao-alterada', 'A competência mudou desde a leitura.');
    if (atual.situacao !== 'aberta')
      throw new ErroSus('competencia-ja-fechada', 'A competência já está fechada.');
    await this.tx.alterar('competencia_sus', c.id, c.versao, {
      situacao: 'fechada',
      fechada_em: new Date(),
      fechada_por_usuario_id: this.tx.contexto.usuario,
    });
  }

  async reabrir(c: { id: number; versao: number }, _por: string, justificativa: string): Promise<void> {
    const atual = await this.competenciaPorId(c.id);
    if (atual.versao !== c.versao)
      throw new ErroSus('versao-alterada', 'A competência mudou desde a leitura.');
    if (atual.situacao !== 'fechada')
      throw new ErroSus('competencia-nao-fechada', 'A competência não está fechada.');
    const x = await this.tx.uma('SELECT situacao FROM competencia_sus WHERE id = ?', [c.id]);
    if (txt(x?.['situacao']) !== 'fechada')
      throw new ErroSus(
        'competencia-nao-fechada',
        'A competência enviada ou encerrada não reabre pela tela.',
      );
    await this.tx.alterar('competencia_sus', c.id, c.versao, {
      situacao: 'reaberta',
      reaberta_em: new Date(),
      reaberta_por_usuario_id: this.tx.contexto.usuario,
      motivo_reabertura: justificativa.slice(0, 500),
    });
  }

  async gravarCriticas(
    c: { id: number; versao: number },
    criticas: readonly NovaCriticaSus[],
    contagens: { registros: number; cnes: string | null },
  ): Promise<ResultadoGravacaoCriticas> {
    const atual = await this.competenciaPorId(c.id);
    if (atual.versao !== c.versao)
      throw new ErroSus('versao-alterada', 'A competência mudou desde a leitura.');
    if (atual.situacao !== 'aberta')
      throw new ErroSus('competencia-ja-fechada', 'A competência já está fechada.');
    const agora = new Date();
    const existentes = new Map<string, Linha>();
    for (const x of await this.tx.consultarParaAtualizar(
      'SELECT id, versao, chave_critica, situacao FROM critica_sus WHERE competencia_sus_id = ? AND excluido_em IS NULL',
      [c.id],
    ))
      existentes.set(txt(x['chave_critica']), x);
    let sequencia = num(
      (
        await this.tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) AS s FROM critica_sus WHERE competencia_sus_id = ?',
          [c.id],
        )
      )?.['s'],
    );
    const vistas = new Set<string>();
    let novas = 0;
    let mantidas = 0;
    let reabertas = 0;
    let bloqueantes = 0;
    let avisos = 0;
    for (const x of criticas) {
      const chave = x.chave.slice(0, 120);
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      const ex = existentes.get(chave);
      if (x.gravidade === 'bloqueante') bloqueantes += 1;
      else if (txt(ex?.['situacao']) !== 'justificada') avisos += 1;
      if (ex) {
        if (txt(ex['situacao']) === 'corrigida') {
          await this.tx.alterar('critica_sus', num(ex['id']), num(ex['versao']), {
            situacao: 'aberta',
            criticada_em: agora,
            tratada_em: null,
            tratada_por_usuario_id: null,
          });
          reabertas += 1;
        } else mantidas += 1;
        continue;
      }
      await this.tx.incluir('critica_sus', {
        competencia_sus_id: c.id,
        sequencia: ++sequencia,
        conta_hospitalar_id: x.conta,
        conta_hospitalar_item_id: x.item,
        atendimento_id: x.atendimento,
        fonte_pagadora_id: x.convenio,
        codigo_regra: x.regra.slice(0, 60),
        chave_critica: chave,
        descricao: x.regra.slice(0, 1000),
        detalhe: detalheParaGravar(x.detalhe),
        gravidade: x.gravidade,
        situacao: 'aberta',
        criticada_em: agora,
      });
      novas += 1;
    }
    let corrigidas = 0;
    for (const [chave, ex] of existentes) {
      if (vistas.has(chave) || txt(ex['situacao']) === 'corrigida') continue;
      await this.tx.alterar('critica_sus', num(ex['id']), num(ex['versao']), {
        situacao: 'corrigida',
        tratada_em: agora,
        tratada_por_usuario_id: this.tx.contexto.usuario,
      });
      corrigidas += 1;
    }
    const cnes = contagens.cnes && /^\d{7}$/.test(contagens.cnes) ? contagens.cnes : null;
    await this.tx.alterar('competencia_sus', c.id, c.versao, {
      criticada_em: agora,
      quantidade_registros_criticados: Math.max(0, Math.trunc(contagens.registros)),
      codigo_cnes_critica: cnes,
    });
    return { novas, mantidas, reabertas, corrigidas, bloqueantes, avisos };
  }

  async justificar(c: { id: number; versao: number }, justificativa: string): Promise<void> {
    const [x] = await this.tx.consultarParaAtualizar(
      `SELECT k.id, k.versao, k.situacao, k.gravidade FROM critica_sus k
         JOIN competencia_sus p ON p.id = k.competencia_sus_id AND p.estabelecimento_id = ?
        WHERE k.id = ? AND k.excluido_em IS NULL`,
      [this.est, c.id],
    );
    if (
      !x ||
      num(x['versao']) !== c.versao ||
      txt(x['situacao']) !== 'aberta' ||
      txt(x['gravidade']) !== 'aviso'
    )
      throw new ErroSus(
        'critica-nao-justificavel',
        'Só o aviso aberto, na versão que a tela leu, pode ser justificado.',
      );
    await this.tx.alterar('critica_sus', c.id, c.versao, {
      situacao: 'justificada',
      justificativa: justificativa.slice(0, 1000),
      tratada_em: new Date(),
      tratada_por_usuario_id: this.tx.contexto.usuario,
    });
  }

  proximoArquivo(): Promise<number> {
    return proximoNumeroArquivo(this.tx);
  }

  async gravarArquivo(
    a: NovoArquivoSus,
    registros: readonly RegistroCihaParaGravar[],
  ): Promise<{ substituidos: number }> {
    if (registros.length > 0)
      linhasPendentes('os registros da CIHA (registro_ciha com paciente e fonte de remuneração)');
    const { substituidos } = await gravarRemessa(this.tx, this.est, a, 'ciha', {
      quantidade_registro_internacao: 0,
      quantidade_registro_ambulatorial: 0,
    });
    return { substituidos };
  }

  async gravarArquivoBpa(
    a: NovoArquivoSus,
    linhas: readonly LinhaBpaParaGravar[],
  ): Promise<{ substituidos: number }> {
    if (linhas.length > 0) linhasPendentes('as folhas do BPA (producao_ambulatorial_sus com os itens)');
    const { substituidos } = await gravarRemessa(this.tx, this.est, a, 'bpa', {
      tipo_bpa: 'misto',
      quantidade_registros: a.registros,
    });
    return { substituidos };
  }

  incluirApac(): Promise<never> {
    return Promise.reject(modeloPendente('a APAC pela tela atual (laudo, solicitante e autorização)'));
  }

  mudarApac(): Promise<never> {
    return Promise.reject(modeloPendente('a APAC pela tela atual (laudo, solicitante e autorização)'));
  }

  async gravarArquivoApac(
    a: NovoArquivoSus,
    linhas: readonly LinhaApacParaGravar[],
  ): Promise<{ substituidos: number }> {
    if (linhas.length > 0) linhasPendentes('a produção da APAC na competência (apac com apac_procedimento)');
    const { inicio } = periodoDaCompetencia(a.competencia.competencia);
    const { substituidos } = await gravarRemessa(this.tx, this.est, a, 'apac', {
      competencia_apresentacao: inicio,
      quantidade_apac: a.registros,
    });
    return { substituidos };
  }

  private async vigentesDoItem(item: number): Promise<EquivalenciaSusNomeada[]> {
    await this.tx.consultarParaAtualizar('SELECT id FROM item_faturavel WHERE id = ?', [item]);
    const ls = await this.tx.consultarParaAtualizar(
      `${SQL_EQUIVALENCIA} AND q.item_faturavel_id = ? AND q.vigencia_fim IS NULL ORDER BY q.id`,
      [item],
      { teto: 50 },
    );
    return ls.map(equivalenciaDaLinha);
  }

  async registrarEquivalencia(p: {
    procedimento: number;
    codigoProcedimento: number;
    sigtap: number;
    codigo: string;
    por: string;
    versao?: number | undefined;
  }): Promise<{ antes: EquivalenciaSus | null; depois: EquivalenciaSus; mudou: boolean }> {
    const item = await this.tx.uma('SELECT id FROM item_faturavel WHERE id = ? AND excluido_em IS NULL', [
      p.procedimento,
    ]);
    const proc = await this.tx.uma('SELECT id FROM procedimento_sigtap WHERE id = ? AND codigo_sigtap = ?', [
      p.sigtap,
      p.codigo,
    ]);
    if (!item || !proc)
      throw new ErroSus('nao-encontrado', 'Item do hospital ou procedimento SIGTAP não encontrado.');
    const vigentes = await this.vigentesDoItem(p.procedimento);
    const antes = vigentes[0] ?? null;
    // Trava otimista: havendo equivalência vigente, o pedido tem de trazer a versão lida (ausente ou diferente é
    // recusa, como na memória); sem isso, um formulário aberto antes da primeira equivalência a substituiria em silêncio.
    if (antes && antes.versao !== p.versao)
      throw new ErroSus('equivalencia-alterada', 'A equivalência mudou desde a leitura.');
    if (antes && antes.sigtap === p.sigtap && vigentes.length === 1)
      return { antes: semNomes(antes), depois: semNomes(antes), mudou: false };
    const hoje = hojeIso();
    for (const v of vigentes) {
      if (v.sigtap === p.sigtap) continue;
      await this.tx.alterar('equivalencia_sigtap_item', v.id, v.versao, { vigencia_fim: hoje });
    }
    let id: number;
    const atual = vigentes.find((v) => v.sigtap === p.sigtap);
    if (atual) id = atual.id;
    else {
      // A mesma ligação fechada hoje volta a valer (a chave única é item, procedimento, instrumento e início).
      const mesmoDia = await this.tx.uma(
        `SELECT id, versao FROM equivalencia_sigtap_item
          WHERE item_faturavel_id = ? AND procedimento_sigtap_id = ? AND instrumento = 'todos' AND vigencia_inicio = ?`,
        [p.procedimento, p.sigtap, hoje],
      );
      if (mesmoDia) {
        id = num(mesmoDia['id']);
        await this.tx.alterar('equivalencia_sigtap_item', id, num(mesmoDia['versao']), {
          vigencia_fim: null,
        });
      } else
        id = await this.tx.incluir('equivalencia_sigtap_item', {
          item_faturavel_id: p.procedimento,
          procedimento_sigtap_id: p.sigtap,
          instrumento: 'todos',
          vigencia_inicio: hoje,
        });
    }
    const depois = await this.tx.uma(`${SQL_EQUIVALENCIA} AND q.id = ?`, [id]);
    if (!depois) throw new ErroSus('nao-encontrado', 'Equivalência não encontrada.');
    return {
      antes: antes ? semNomes(antes) : null,
      depois: semNomes(equivalenciaDaLinha(depois)),
      mudou: true,
    };
  }

  async desativarEquivalencia(p: {
    procedimento: number;
    versao: number;
    por: string;
  }): Promise<{ antes: EquivalenciaSus; depois: EquivalenciaSus }> {
    const vigentes = await this.vigentesDoItem(p.procedimento);
    const antes = vigentes[0];
    if (!antes) throw new ErroSus('nao-encontrado', 'O item não tem equivalência vigente.');
    if (antes.versao !== p.versao)
      throw new ErroSus('equivalencia-alterada', 'A equivalência mudou desde a leitura.');
    for (const v of vigentes)
      await this.tx.alterar('equivalencia_sigtap_item', v.id, v.versao, { vigencia_fim: hojeIso() });
    const depois = await this.tx.uma(`${SQL_EQUIVALENCIA} AND q.id = ?`, [antes.id]);
    if (!depois) throw new ErroSus('nao-encontrado', 'Equivalência não encontrada.');
    return { antes: semNomes(antes), depois: semNomes(equivalenciaDaLinha(depois)) };
  }

  async trilha(linha: LinhaTrilhaSus): Promise<void> {
    this.linhas.push(linha);
  }

  // ── AIH, faixa e retorno (pendentes de modelo) ──

  async inserirFaixaAih(p: {
    inicio: bigint;
    fim: bigint;
    orgaoEmissor: string;
    dataLiberacao: string;
    por: string;
  }): Promise<number> {
    const inicio = numeroAih(p.inicio);
    const fim = numeroAih(p.fim);
    // Melhoria: a faixa nova não pode cruzar nenhuma faixa do estabelecimento (não só a que começa no mesmo número).
    const cruza = await this.tx.consultarParaAtualizar(
      `SELECT id FROM faixa_numeracao_aih
        WHERE estabelecimento_id = ? AND instrumento = 'aih' AND numero_inicial <= ? AND numero_final >= ? LIMIT 1`,
      [this.est, fim, inicio],
    );
    if (cruza.length)
      throw new ErroAih('faixa-sobreposta', 'Já existe uma faixa que cobre parte destes números.');
    return this.tx.incluir('faixa_numeracao_aih', {
      estabelecimento_id: this.est,
      instrumento: 'aih',
      numero_inicial: inicio,
      numero_final: fim,
      orgao_emissor: p.orgaoEmissor.trim().slice(0, 10),
      data_liberacao: p.dataLiberacao,
      situacao: 'ativa',
      recebida_em: new Date(),
      recebida_por_usuario_id: this.tx.contexto.usuario,
    });
  }

  async mudarFaixaAih(p: {
    id: number;
    versao: number;
    situacao: 'esgotada' | 'cancelada';
    justificativa: string | null;
    por: string;
  }): Promise<void> {
    const f = await this.faixaAih(p.id, true);
    if (!f || f.versao !== p.versao || f.situacao !== 'ativa')
      throw new ErroAih('versao-alterada', 'O registro mudou desde que a tela foi aberta.');
    await this.tx.alterar('faixa_numeracao_aih', p.id, p.versao, {
      situacao: p.situacao,
      ...(p.justificativa ? { motivo_situacao: p.justificativa.slice(0, 500) } : {}),
    });
  }

  inserirAih(): Promise<never> {
    return Promise.reject(modeloPendente('a AIH pela tela atual (laudo, autorização e conta)'));
  }

  autorizarAih(): Promise<never> {
    return Promise.reject(modeloPendente('a AIH pela tela atual (laudo, autorização e conta)'));
  }

  negarAih(): Promise<never> {
    return Promise.reject(modeloPendente('a AIH pela tela atual (laudo, autorização e conta)'));
  }

  reabrirAih(): Promise<never> {
    return Promise.reject(modeloPendente('a AIH pela tela atual (laudo, autorização e conta)'));
  }

  cancelarAih(): Promise<never> {
    return Promise.reject(modeloPendente('a AIH pela tela atual (laudo, autorização e conta)'));
  }

  fecharAih(): Promise<never> {
    return Promise.reject(modeloPendente('o fechamento da AIH com os itens'));
  }

  async gravarArquivoSisaih(
    a: NovoArquivoSus,
    aihs: readonly { id: number; versao: number }[],
  ): Promise<{ substituidos: number }> {
    if (aihs.length > 0) linhasPendentes('as contas da AIH apresentadas (conta_aih na remessa)');
    const { substituidos } = await gravarRemessa(this.tx, this.est, a, 'aih', { quantidade_aih: 0 });
    return { substituidos };
  }

  inserirRetornoSus(): Promise<never> {
    return Promise.reject(modeloPendente('o retorno do gestor por linha'));
  }

  aplicarRetornoNaAih(): Promise<never> {
    return Promise.reject(modeloPendente('o retorno do gestor por linha'));
  }

  tratarRetornoSus(): Promise<never> {
    return Promise.reject(modeloPendente('o tratamento do retorno do gestor'));
  }
}

/** A diferença da tela na trilha da operação: só ids, códigos, contagens e hash (o serviço já filtra). */
function dadosDaTrilha(linhas: readonly LinhaTrilhaSus[]): unknown {
  return {
    eventos: linhas.map((l) => ({
      evento: l.evento,
      recurso: l.recurso,
      operacao: l.operacao,
      tabela: l.tabelaAlvo,
      id: l.idAlvo,
      ...(l.diferenca ? { diferenca: l.diferenca } : {}),
      ...(l.estacao ? { estacao: l.estacao } : {}),
    })),
  };
}

export class PortaSusPropria implements PortaSus {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSus,
    private readonly cliente: string,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoSus, est: number | null): ContextoNucleo {
    return {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: c.usuario ?? null,
      correlacao: (c.correlacao || `sus-${c.hospital}`).slice(0, 64),
    };
  }

  /** O estabelecimento da sessão (pelo id; sem ele, pelo código do hospital). Sem estabelecimento, nada é lido. */
  private async estabelecimento(c: ContextoSus): Promise<number> {
    if (c.estabelecimento) return c.estabelecimento;
    const r = await this.nucleo.lerSomente(this.contexto(c, null), (l) =>
      l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [c.hospital]),
    );
    if (r) return num(r['id']);
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  }

  async ler<T>(c: ContextoSus, fn: (l: LeituraSus) => Promise<T>): Promise<T> {
    const est = await this.estabelecimento(c);
    return this.nucleo.lerSomente(this.contexto(c, est), (l) => fn(new LeituraSusPropria(l, est)));
  }

  async gravar<T>(c: ContextoSus, fn: (g: GravacaoSus) => Promise<T>): Promise<T> {
    const est = await this.estabelecimento(c);
    let saida: { valor: T } | null = null;
    let linhas: readonly LinhaTrilhaSus[] = [];
    let recusada: Error | null = null;
    const op = definirOperacao({
      nome: 'faturamento.sus.gravacao',
      tabelas: [...TABELAS_SUS],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        const g = new GravacaoSusPropria(tx, est);
        try {
          saida = { valor: await fn(g) };
        } catch (erro) {
          // A recusa de negócio (da porta ou do serviço) volta como é; o resto o núcleo traduz.
          if (erro instanceof ErroSus || erro instanceof ErroAih || erro instanceof ErroProblema)
            recusada = erro;
          throw erro;
        }
        linhas = g.linhas;
        return {} as ResultadoOperacao;
      },
      alvo: () => {
        const l = linhas[linhas.length - 1];
        const id = l?.idAlvo && /^\d{1,15}$/.test(l.idAlvo) ? Number(l.idAlvo) : null;
        return { tabela: l?.tabelaAlvo ?? 'competencia_sus', id };
      },
      trilha: () => ({ dados: dadosDaTrilha(linhas) }),
    });
    // Cada pedido é uma execução nova (a trilha e o outbox são desta execução); a tela confere a versão vista.
    const chave = `sus:${randomUUID()}`;
    const ctx: ContextoOperacao = { ...this.contexto(c, est), chaveIdempotencia: chave };
    try {
      await this.executor.executar(op, this.cliente, { chave }, ctx);
    } catch (erro) {
      if (recusada) throw recusada;
      throw erro;
    }
    if (!saida) throw new Error('Gravação do faturamento SUS sem resultado.');
    return (saida as { valor: T }).valor;
  }
}
