// Porta PRÓPRIA da gestão da qualidade, completa (modulos-proprios-1, família qualidade-b): estende a porta própria
// da gestão (risco, não conformidade, ouvidoria) com o que o modelo próprio passou a cobrir, sem tocar no que ela já
// faz. Cada assunto entra aqui com a leitura e a gravação do mesmo contrato da porta de memória (filtros, ordenação,
// versão e erros de domínio); o que continua sem modelo segue falhando fechado na porta de base (503 na leitura, 409
// `modelo-pendente` na gravação).
// - Envios regulatórios (envio_regulatorio_qualidade): a lista desde a competência, o envio, a geração com a revisão
//   por competência (a geração anterior fica substituída; a competência transmitida recusa `ja-transmitido`) e a
//   transmissão conferida pela versão e pelo resumo SHA-256. O arquivo gerado é guardado pela porta de armazenamento
//   de arquivos (ADR 0004: imutável, conferido pelo resumo antes de chegar ao disco) e a chave fica no envio
//   (`chave_objeto`, NOT NULL): o arquivo transmitido se lê depois pelos bytes guardados, nunca gerado de novo. Sem o
//   armazenamento (instalação sem ARQUIVOS_RAIZ) ou sem o conteúdo, a geração recusa sem gravar nada.
import { createHash, randomUUID } from 'node:crypto';
import { type ArmazemArquivos, type Executor, recusa, type TxOperacao } from '@sgh/nucleo';
import { type AnotacaoGravacao, gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import {
  camelo,
  cobra,
  exigirUsuario,
  instante,
  instanteN,
  type Linha,
  lerNoEstabelecimento,
  modeloPendente,
  n,
  type NucleoQualidade,
  paraBanco,
  texto,
  textoN,
} from './apoio-propria.js';
import type { ContextoGestao, GravadorGestao } from './porta-gestao.js';
import { PortaGestaoPropria, TABELAS_GESTAO } from './porta-gestao-propria.js';
import { comVersoesAnteriores, LeiturasGestaoComplementoD } from './porta-propria-complemento-d.js';
import { gravacoesDocumentos, TABELAS_DOCUMENTOS } from './porta-propria-documentos.js';
import {
  gravacoesComplementoQ1,
  LeiturasGestaoComplementoQ1,
  TABELAS_COMPLEMENTO_Q1,
} from './porta-propria-complemento-q1.js';
import { LeiturasGestaoComplementoQ2 } from './porta-propria-complemento-q2.js';
import {
  gravacoesComplementoQ3,
  LeiturasRevisaoComplementoQ3,
  TABELAS_COMPLEMENTO_Q3,
} from './porta-propria-complemento-q3.js';
import {
  gravadorComplementoQ4,
  LeiturasGestaoComplementoQ4,
  TABELAS_COMPLEMENTO_Q4,
} from './porta-propria-complemento-q4.js';
import {
  gravacoesComplementoQ5,
  LeiturasGestaoComplementoQ5,
  TABELAS_COMPLEMENTO_Q5,
} from './porta-propria-complemento-q5.js';
import {
  dependentesDaComissao,
  gravacoesComissaoSorteio,
  TABELAS_COMISSAO_SORTEIO,
} from './porta-propria-comissao-sorteio.js';
import { gravacaoRevisarProntuario, TABELAS_REVISAR_PRONTUARIO } from './porta-propria-revisar-prontuario.js';
import { gravacoesComplementoQ6, TABELAS_COMPLEMENTO_Q6 } from './porta-propria-complemento-q6.js';
import {
  type EnvioRegulatorioRegistrado,
  type FiltroDocumentos,
  recusaVersaoGestao,
  type TabelaCorrigivel,
} from './tipos.js';

/** As tabelas que a gestão completa grava (as da base e as dos assuntos novos). */
export const TABELAS_GESTAO_COMPLETA = [
  ...new Set([
    ...TABELAS_GESTAO,
    'envio_regulatorio_qualidade',
    ...TABELAS_COMPLEMENTO_Q1,
    ...TABELAS_COMPLEMENTO_Q3,
    ...TABELAS_COMPLEMENTO_Q4,
    ...TABELAS_COMPLEMENTO_Q5,
    ...TABELAS_REVISAR_PRONTUARIO,
    ...TABELAS_COMPLEMENTO_Q6,
    ...TABELAS_DOCUMENTOS,
    ...TABELAS_COMISSAO_SORTEIO,
  ]),
] as const;

// ── Envios regulatórios ─────────────────────────────────────────────────────────────────────────────────────────

const SQL_ENVIO = `
  SELECT e.id, e.versao, e.tipo, DATE_FORMAT(e.competencia, '%Y-%m') AS competencia, e.revisao, e.arquivo_nome,
         e.resumo_sha256, e.linhas, e.resumo, e.situacao, ug.login AS gerado_por, e.gerado_em, e.transmitido_em,
         ut.login AS transmitido_por, e.protocolo
    FROM envio_regulatorio_qualidade e
    JOIN usuario ug ON ug.id = e.gerado_por_usuario_id
    LEFT JOIN usuario ut ON ut.id = e.transmitido_por_usuario_id
   WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL`;

/** A competência do contrato (AAAA-MM) como o banco guarda (o primeiro dia do mês). */
const competenciaBanco = (c: string): string => `${c.slice(0, 7)}-01`;

/**
 * A geração do contrato com o conteúdo do arquivo. O conteúdo é opcional no tipo só porque a interface do gravador
 * (porta-gestao.ts) ainda não o declara; aqui ele é exigido: sem ele, a geração recusa sem gravar.
 */
export type GeracaoEnvioComArquivo = Parameters<GravadorGestao['gerarEnvioRegulatorio']>[0] & {
  readonly conteudo?: string;
};

/** O arquivo do envio como foi guardado na geração (os bytes transmitidos, nunca gerados de novo). */
export interface ArquivoEnvioGuardado {
  readonly arquivo: string;
  readonly conteudo: string;
  readonly hash: string;
}

const extensao = (nome: string): string => /\.[A-Za-z0-9]{1,8}$/.exec(nome)?.[0] ?? '';

const tipoMime = (nome: string): string =>
  nome.toLowerCase().endsWith('.xml')
    ? 'application/xml'
    : nome.toLowerCase().endsWith('.csv')
      ? 'text/csv'
      : 'text/plain';

function envio(r: Linha): EnvioRegulatorioRegistrado {
  return {
    id: n(r['id']),
    versao: n(r['versao']),
    tipo: camelo(r['tipo']),
    competencia: texto(r['competencia']),
    revisao: n(r['revisao']),
    arquivo: texto(r['arquivo_nome']),
    hash: texto(r['resumo_sha256']),
    linhas: n(r['linhas']),
    resumo: texto(r['resumo']),
    situacao: texto(r['situacao']),
    geradoPor: texto(r['gerado_por']),
    geradoEm: instante(r['gerado_em']),
    transmitidoEm: instanteN(r['transmitido_em']),
    transmitidoPor: textoN(r['transmitido_por']),
    protocolo: textoN(r['protocolo']),
  };
}

export class PortaGestaoPropriaCompleta extends PortaGestaoPropria {
  private readonly nucleoCompleta: NucleoQualidade;
  /** Pesquisas da agenda, versões anteriores e protocolos gerenciados (porta-propria-complemento-d.ts). */
  private readonly complementoD: LeiturasGestaoComplementoD;
  /** Altas para a revisão de prontuários (porta-propria-complemento-q1.ts). */
  private readonly complementoQ1: LeiturasGestaoComplementoQ1;
  /** Documentos, ciências, histórico de análises, comissões e contagens (porta-propria-complemento-q2.ts). */
  private readonly complementoQ2: LeiturasGestaoComplementoQ2;
  /** Checklists, prontuários e pendências da revisão (porta-propria-complemento-q3.ts). */
  private readonly complementoQ3: LeiturasRevisaoComplementoQ3;
  /** Reuniões de comissão (porta-propria-complemento-q4.ts). */
  private readonly complementoQ4: LeiturasGestaoComplementoQ4;
  /** Análises da competência, auditorias, sorteios e revisões da amostra (porta-propria-complemento-q5.ts). */
  private readonly complementoQ5: LeiturasGestaoComplementoQ5;

  /**
   * @param armazem O armazenamento de arquivos da instalação (ADR 0004: disco local, metadado na tabela `arquivo`).
   * Sem ele (sem ARQUIVOS_RAIZ), gerar o envio recusa 409 `modelo-pendente` e o arquivo guardado não se lê.
   */
  constructor(
    nucleo: NucleoQualidade,
    private readonly armazem: ArmazemArquivos | null = null,
    executorPronto?: Executor,
  ) {
    super(nucleo, executorPronto);
    this.nucleoCompleta = nucleo;
    this.complementoD = new LeiturasGestaoComplementoD(nucleo);
    this.complementoQ1 = new LeiturasGestaoComplementoQ1(nucleo);
    this.complementoQ2 = new LeiturasGestaoComplementoQ2(nucleo);
    this.complementoQ3 = new LeiturasRevisaoComplementoQ3(nucleo);
    this.complementoQ4 = new LeiturasGestaoComplementoQ4(nucleo);
    this.complementoQ5 = new LeiturasGestaoComplementoQ5(nucleo);
  }

  override gravarSgh<T>(
    c: ContextoGestao,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorGestao) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'qualidade.gestao',
      tabelas: TABELAS_GESTAO_COMPLETA,
      trilha,
      gravador: (tx, est, anotacao) => this.gravador(tx, est, anotacao),
      fn,
    });
  }

  /** As correções da gestão gravam a versão anterior na trilha (dados.versaoAnterior), como a memória versiona. */
  protected override gravador(
    tx: TxOperacao,
    est: number,
    anotacao: AnotacaoGravacao = { motivo: null, dados: null },
  ): GravadorGestao {
    return comVersoesAnteriores(
      {
        ...super.gravador(tx, est, anotacao),
        ...gravacoesComplementoQ1(tx, est, anotacao),
        ...gravacoesComplementoQ3(tx, est),
        ...gravadorComplementoQ4(tx, est, anotacao),
        ...gravacoesComplementoQ5(tx, est, anotacao),
        ...gravacoesComissaoSorteio(tx, est, anotacao),
        ...gravacaoRevisarProntuario(tx, est, anotacao),
        ...gravacoesComplementoQ6(tx, est, anotacao),
        ...gravacoesDocumentos(tx, est),
        gerarEnvioRegulatorio: (g: GeracaoEnvioComArquivo) => this.gerarEnvio(tx, est, g),
        registrarTransmissaoEnvio: (t) => this.transmitirEnvio(tx, est, t),
      },
      tx,
      est,
      anotacao,
    );
  }

  /** As dependências da comissão (checklist vigente e sorteios sem aval) pela mesma consulta da gravação. */
  override dependentes(c: ContextoGestao, tabela: string, id: number) {
    if (tabela === 'comissao_hospitalar')
      return lerNoEstabelecimento(this.nucleoCompleta, c, (l, est) => dependentesDaComissao(l, est, id));
    return super.dependentes(c, tabela, id);
  }

  // ── Complementos Q1 a Q4 (modulos-proprios-3): leituras delegadas ──

  override altasParaRevisao(c: ContextoGestao, de: string, ate: string) {
    return this.complementoQ1.altasParaRevisao(c, de, ate);
  }

  override documentos(c: ContextoGestao, f: FiltroDocumentos) {
    return this.complementoQ2.documentos(c, f);
  }

  override documento(c: ContextoGestao, id: number) {
    return this.complementoQ2.documento(c, id);
  }

  override documentosDoCodigo(c: ContextoGestao, codigo: string) {
    return this.complementoQ2.documentosDoCodigo(c, codigo);
  }

  override ciencias(c: ContextoGestao, documentos: readonly number[], usuario: string) {
    return this.complementoQ2.ciencias(c, documentos, usuario);
  }

  override cientes(c: ContextoGestao, documento: number) {
    return this.complementoQ2.cientes(c, documento);
  }

  override pendentesCiencia(c: ContextoGestao, documento: number) {
    return this.complementoQ2.pendentesCiencia(c, documento);
  }

  override historicoAnalises(c: ContextoGestao, indicador: string) {
    return this.complementoQ2.historicoAnalises(c, indicador);
  }

  override comissoes(c: ContextoGestao) {
    return this.complementoQ2.comissoes(c);
  }

  override comissao(c: ContextoGestao, id: number, dia?: string) {
    return this.complementoQ2.comissao(c, id, dia);
  }

  override contagem(c: ContextoGestao, agora: string, usuario: string) {
    return this.complementoQ2.contagem(c, agora, usuario);
  }

  override checklistsRevisao(c: ContextoGestao, comissao: number) {
    return this.complementoQ3.checklistsRevisao(c, comissao);
  }

  override checklistRevisao(c: ContextoGestao, id: number) {
    return this.complementoQ3.checklistRevisao(c, id);
  }

  override prontuariosDoSorteio(c: ContextoGestao, sorteio: number) {
    return this.complementoQ3.prontuariosDoSorteio(c, sorteio);
  }

  override prontuarioRevisao(c: ContextoGestao, id: number) {
    return this.complementoQ3.prontuarioRevisao(c, id);
  }

  override pendenciasDosProntuarios(c: ContextoGestao, ids: readonly number[]) {
    return this.complementoQ3.pendenciasDosProntuarios(c, ids);
  }

  override pendenciaRevisao(c: ContextoGestao, id: number) {
    return this.complementoQ3.pendenciaRevisao(c, id);
  }

  override pendenciasDoLogin(c: ContextoGestao, login: string) {
    return this.complementoQ3.pendenciasDoLogin(c, login);
  }

  override reunioes(c: ContextoGestao, comissao: number) {
    return this.complementoQ4.reunioes(c, comissao);
  }

  override reuniao(c: ContextoGestao, id: number) {
    return this.complementoQ4.reuniao(c, id);
  }

  // ── Complemento Q5 (fecho-1): leituras delegadas ──

  override analises(c: ContextoGestao, competencia: string) {
    return this.complementoQ5.analises(c, competencia);
  }

  override auditorias(c: ContextoGestao, f: { pagina: number; porPagina: number }) {
    return this.complementoQ5.auditorias(c, f);
  }

  override auditoria(c: ContextoGestao, id: number) {
    return this.complementoQ5.auditoria(c, id);
  }

  override loginsDosMedicos(c: ContextoGestao, registros: readonly number[]) {
    return this.complementoQ5.loginsDosMedicos(c, registros);
  }

  override sorteiosRevisao(c: ContextoGestao, comissao: number) {
    return this.complementoQ5.sorteiosRevisao(c, comissao);
  }

  override sorteioRevisao(c: ContextoGestao, id: number) {
    return this.complementoQ5.sorteioRevisao(c, id);
  }

  override revisoesDaCompetencia(c: ContextoGestao, comissao: number, competencia: string) {
    return this.complementoQ5.revisoesDaCompetencia(c, comissao, competencia);
  }

  override revisoesDaInternacao(c: ContextoGestao, reg: number) {
    return this.complementoQ5.revisoesDaInternacao(c, reg);
  }

  override pesquisas(c: ContextoGestao, de: string, ate: string) {
    return this.complementoD.pesquisas(c, de, ate);
  }

  override pesquisa(c: ContextoGestao, id: number) {
    return this.complementoD.pesquisa(c, id);
  }

  override versoes(c: ContextoGestao, tabela: TabelaCorrigivel, id: number) {
    return this.complementoD.versoes(c, tabela, id);
  }

  override protocolosGerenciados(c: ContextoGestao, inicio: string, fim: string) {
    return this.complementoD.protocolosGerenciados(c, inicio, fim);
  }

  // ── Envios regulatórios ───────────────────────────────────────────────────────────────────────────────────

  override envios(c: ContextoGestao, desdeCompetencia: string): Promise<EnvioRegulatorioRegistrado[]> {
    return lerNoEstabelecimento(this.nucleoCompleta, c, async (l, est) => {
      const linhas = await l.consultar(
        `${SQL_ENVIO} AND e.competencia >= ? ORDER BY e.competencia DESC, e.tipo, e.revisao DESC, e.id DESC`,
        [est, competenciaBanco(desdeCompetencia)],
        { teto: 5000 },
      );
      return linhas.map(envio);
    });
  }

  override envio(c: ContextoGestao, id: number): Promise<EnvioRegulatorioRegistrado | null> {
    return lerNoEstabelecimento(this.nucleoCompleta, c, async (l, est) => {
      const r = await l.uma(`${SQL_ENVIO} AND e.id = ?`, [est, id]);
      return r ? envio(r) : null;
    });
  }

  /**
   * O arquivo do envio pelos bytes guardados na geração (a rota `/arquivo`): null quando o envio não existe no
   * estabelecimento da sessão; sem o armazenamento, 409 `modelo-pendente`.
   */
  async arquivoEnvio(c: ContextoGestao, id: number): Promise<ArquivoEnvioGuardado | null> {
    const r = await lerNoEstabelecimento(this.nucleoCompleta, c, async (l, est) => {
      const e = await l.uma(
        `SELECT e.arquivo_nome, e.resumo_sha256, a.id AS arquivo_id
           FROM envio_regulatorio_qualidade e
           JOIN arquivo a ON a.chave_armazenamento = e.chave_objeto AND a.excluido_em IS NULL
          WHERE e.id = ? AND e.estabelecimento_id = ? AND e.excluido_em IS NULL`,
        [id, est],
      );
      return e ? { est, e } : null;
    });
    if (!r) return null;
    if (!this.armazem)
      throw modeloPendente('A gestão da qualidade: arquivo do envio (armazenamento de arquivos sem raiz)');
    const a = await this.armazem.ler(
      {
        cliente: c.cliente,
        estabelecimento: r.est,
        usuario: null,
        correlacao: c.correlacao || 'qualidade.gestao',
      },
      n(r.e['arquivo_id']),
    );
    const conteudo = a.conteudo.toString('utf8');
    const hash = createHash('sha256').update(a.conteudo).digest('hex');
    // O arquivo guardado diverge do resumo do envio só por corrupção no disco: recusa, nunca devolve bytes errados.
    if (hash !== texto(r.e['resumo_sha256']))
      throw recusa(
        'arquivo-divergente',
        'O arquivo guardado do envio não confere com o resumo gravado na geração.',
      );
    return { arquivo: texto(r.e['arquivo_nome']), conteudo, hash };
  }

  private async gerarEnvio(
    tx: TxOperacao,
    est: number,
    g: GeracaoEnvioComArquivo,
  ): Promise<{ id: number; revisao: number; arquivo: string }> {
    // O arquivo transmitido ao órgão tem de ser guardado (ADR 0004): sem armazenamento ou sem conteúdo, nada é gravado.
    if (!this.armazem)
      throw modeloPendente('A gestão da qualidade: arquivo do envio (armazenamento de arquivos sem raiz)');
    if (g.conteudo === undefined)
      throw recusa(
        'arquivo-ausente',
        'O conteúdo do arquivo do envio não veio na geração: nada foi gravado.',
      );
    const bytes = Buffer.from(g.conteudo, 'utf8');
    // Confere antes de guardar: o arquivo divergente do resumo nunca chega ao disco.
    if (createHash('sha256').update(bytes).digest('hex') !== g.hash.toLowerCase())
      throw recusa(
        'arquivo-divergente',
        'O conteúdo do arquivo não confere com o resumo calculado na geração.',
      );
    // O arquivo é guardado ANTES de qualquer leitura desta transação: o armazenamento grava a sua própria operação
    // (metadado e trilha) e a leitura anterior fixaria o retrato da transação, recusando depois a trilha do envio
    // (registro alterado desde a leitura). O nome guardado não leva a revisão (ela só se sabe sob a trava); o nome do
    // envio fica em arquivo_nome. Recusa posterior (corrida com outra geração) deixa o arquivo guardado sem envio,
    // imutável e reaproveitado pela chave do conteúdo, nunca um envio sem arquivo.
    const tipoArq = cobra(g.tipo);
    const guardado = await this.armazem.guardar(
      {
        conteudo: bytes,
        nomeOriginal: `envio-${tipoArq}-${g.competencia.slice(0, 7)}${extensao(g.arquivoDe(1))}`,
        tipoMime: tipoMime(g.arquivoDe(1)),
        finalidade: 'envio_regulatorio',
        entidade: 'envio_regulatorio_qualidade',
        imutavel: true,
      },
      {
        ...tx.contexto,
        // A chave da operação do armazenamento (até 80 caracteres): única por geração.
        chaveIdempotencia: `qualidade-envio:${randomUUID()}`,
      },
    );
    const usuario = await exigirUsuario(tx, g.usuario);
    const tipo = cobra(g.tipo);
    const competencia = competenciaBanco(g.competencia);
    // As gerações da competência travadas (inclusive as excluídas: a revisão nunca se repete).
    const ant = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, revisao, excluido_em FROM envio_regulatorio_qualidade
        WHERE estabelecimento_id = ? AND tipo = ? AND competencia = ?`,
      [est, tipo, competencia],
      { teto: 1000 },
    );
    const vivas = ant.filter((x) => x['excluido_em'] === null || x['excluido_em'] === undefined);
    if (vivas.some((x) => texto(x['situacao']) === 'transmitido'))
      throw recusa(
        'ja-transmitido',
        'O envio desta competência já foi transmitido: a retificação se faz no portal do programa.',
      );
    const revisao = Math.max(0, ...ant.map((x) => n(x['revisao']))) + 1;
    for (const x of vivas)
      if (texto(x['situacao']) === 'gerado')
        await tx.alterar('envio_regulatorio_qualidade', n(x['id']), n(x['versao']), {
          situacao: 'substituido',
        });
    const arquivo = g.arquivoDe(revisao);
    const id = await tx.incluir('envio_regulatorio_qualidade', {
      estabelecimento_id: est,
      tipo,
      competencia,
      revisao,
      arquivo_nome: arquivo,
      chave_objeto: guardado.chave,
      resumo_sha256: g.hash,
      linhas: g.linhas,
      resumo: g.resumo,
      situacao: 'gerado',
      gerado_em: paraBanco(g.agora),
      gerado_por_usuario_id: usuario,
    });
    return { id, revisao, arquivo };
  }

  private async transmitirEnvio(
    tx: TxOperacao,
    est: number,
    t: Parameters<GravadorGestao['registrarTransmissaoEnvio']>[0],
  ): Promise<{ versao: number }> {
    const usuario = await exigirUsuario(tx, t.usuario);
    const [r] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, resumo_sha256 FROM envio_regulatorio_qualidade
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [t.id, est],
      { teto: 1 },
    );
    if (
      !r ||
      n(r['versao']) !== t.versao ||
      texto(r['situacao']) !== 'gerado' ||
      texto(r['resumo_sha256']) !== t.hash
    )
      throw recusaVersaoGestao('O envio');
    const versao = await tx.alterar('envio_regulatorio_qualidade', t.id, t.versao, {
      situacao: 'transmitido',
      transmitido_em: paraBanco(t.transmitidoEm),
      transmitido_por_usuario_id: usuario,
      protocolo: t.protocolo,
    });
    return { versao };
  }
}
