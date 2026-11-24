// Porta PRÓPRIA da gestão da qualidade, completa (modulos-proprios-1, família qualidade-b): estende a porta própria
// da gestão (risco, não conformidade, ouvidoria) com o que o modelo próprio passou a cobrir, sem tocar no que ela já
// faz. Cada assunto entra aqui com a leitura e a gravação do mesmo contrato da porta de memória (filtros, ordenação,
// versão e erros de domínio); o que continua sem modelo segue falhando fechado na porta de base (503 na leitura, 409
// `modelo-pendente` na gravação).
// - Envios regulatórios (envio_regulatorio_qualidade): a lista desde a competência, o envio, a geração com a revisão
//   por competência (a geração anterior fica substituída; a competência transmitida recusa `ja-transmitido`) e a
//   transmissão conferida pela versão e pelo resumo SHA-256. O arquivo é gerado na tela e não é guardado: a chave do
//   objeto fica nula (migração 18_QUA/94_gestao).
import { type Executor, recusa, type TxOperacao } from '@sgh/nucleo';
import { gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import {
  camelo,
  cobra,
  exigirUsuario,
  instante,
  instanteN,
  type Linha,
  lerNoEstabelecimento,
  n,
  type NucleoQualidade,
  paraBanco,
  texto,
  textoN,
} from './apoio-propria.js';
import type { ContextoGestao, GravadorGestao } from './porta-gestao.js';
import { PortaGestaoPropria, TABELAS_GESTAO } from './porta-gestao-propria.js';
import { type EnvioRegulatorioRegistrado, recusaVersaoGestao } from './tipos.js';

/** As tabelas que a gestão completa grava (as da base e as dos assuntos novos). */
export const TABELAS_GESTAO_COMPLETA = [...TABELAS_GESTAO, 'envio_regulatorio_qualidade'] as const;

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

  constructor(nucleo: NucleoQualidade, executorPronto?: Executor) {
    super(nucleo, executorPronto);
    this.nucleoCompleta = nucleo;
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
      gravador: (tx, est) => this.gravador(tx, est),
      fn,
    });
  }

  protected override gravador(tx: TxOperacao, est: number): GravadorGestao {
    return {
      ...super.gravador(tx, est),
      gerarEnvioRegulatorio: (g) => this.gerarEnvio(tx, est, g),
      registrarTransmissaoEnvio: (t) => this.transmitirEnvio(tx, est, t),
    };
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

  private async gerarEnvio(
    tx: TxOperacao,
    est: number,
    g: Parameters<GravadorGestao['gerarEnvioRegulatorio']>[0],
  ): Promise<{ id: number; revisao: number; arquivo: string }> {
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
      chave_objeto: null,
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
