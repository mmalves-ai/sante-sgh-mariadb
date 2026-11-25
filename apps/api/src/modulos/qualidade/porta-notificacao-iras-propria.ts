// Porta PRÓPRIA do envio mensal dos indicadores de infecção e de resistência ao órgão sanitário (F7, 09-AREA linha 68)
// sobre o MariaDB do cliente, pelo @sgh/nucleo. Lê as competências fechadas da vigilância (fechamento_vigilancia_iras)
// com os envios de cada formulário (notificacao_iras_envio) e grava, numa operação do Executor (gravacaoDireta: trilha,
// outbox e idempotência na mesma transação), o registro do envio e o andamento dele.
// Melhoria: a regra (avaliarEnvioIras, avaliarAndamentoIras) decide o tipo (inicial ou retificação), confere a data e o
// caminho das situações; o prazo e o atraso de cada formulário vêm calculados na leitura. A competência passa a
// "enviada" no primeiro formulário transmitido. Nada é apagado: a retificação é um registro novo; o andamento trava a
// linha, confere a versão vista, guarda o retrato no próprio registro (operação e dados) e a versão anterior na trilha.
// Este registro não transmite nada para fora: a pessoa da comissão envia pelo formulário do órgão e registra aqui a data
// e o protocolo (situação "transcrita"); a transmissão automática ("enviada") fica para a mensagem de integração.
import {
  avaliarAndamentoIras,
  avaliarEnvioIras,
  type EntradaEnvioIras,
  envioAtrasado,
  type FormularioIras,
  MENSAGENS_NOTIFICACAO_IRAS,
  prazoDoEnvio,
  type RecusaNotificacaoIras,
  type SituacaoEnvioIras,
  type TipoEnvioIras,
  transmitido,
} from '@sgh/dominio-qualidade';
import { type Executor, recusa, type TxOperacao } from '@sgh/nucleo';
import { gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import {
  exigirUsuario,
  instanteN,
  type L,
  lerNoEstabelecimento,
  type Linha,
  n,
  type NucleoQualidade,
  paraBanco,
  relogioDoEstabelecimento,
  texto,
  textoN,
} from './apoio-propria.js';

export const TABELAS_NOTIFICACAO_IRAS = ['notificacao_iras_envio', 'fechamento_vigilancia_iras'] as const;
const TETO = 120;

export interface EnvioIras {
  readonly id: number;
  readonly formulario: FormularioIras;
  readonly tipo: TipoEnvioIras;
  readonly situacao: SituacaoEnvioIras;
  readonly enviadoEm: string | null;
  readonly protocolo: string | null;
  readonly motivoRetificacao: string | null;
  readonly mensagemRetorno: string | null;
  readonly registradoEm: string | null;
  readonly registradoPor: string | null;
  readonly versao: number;
}

export interface FormularioDaCompetencia {
  readonly formulario: FormularioIras;
  /** A situação do envio mais recente do formulário. */
  readonly ultima: SituacaoEnvioIras;
  readonly atrasado: boolean;
}

export interface CompetenciaNotificacao {
  readonly id: number;
  readonly competencia: string;
  readonly situacao: string;
  readonly prazo: string;
  /** Passou o prazo sem nenhum formulário transmitido. */
  readonly atrasada: boolean;
  readonly formularios: readonly FormularioDaCompetencia[];
  readonly envios: readonly EnvioIras[];
  readonly versao: number;
}

export interface AndamentoEnvio {
  readonly situacao: SituacaoEnvioIras;
  readonly enviadoEm: string | null;
  readonly protocolo: string | null;
  readonly mensagemRetorno: string | null;
}

const recusaIras = (r: RecusaNotificacaoIras) => recusa(r, MENSAGENS_NOTIFICACAO_IRAS[r]);

const SQL_COMPETENCIAS = `
  SELECT f.id, f.ano, f.mes, f.situacao, f.versao
    FROM fechamento_vigilancia_iras f
   WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL AND f.situacao IN ('fechada', 'enviada', 'reaberta')
   ORDER BY f.ano DESC, f.mes DESC
   LIMIT 24`;

const SQL_ENVIOS = `
  SELECT ne.*, u.login AS registrado_por
    FROM notificacao_iras_envio ne
    LEFT JOIN usuario u ON u.id = ne.criado_por`;

const competenciaDe = (r: Linha) => `${texto(r['ano'])}-${String(n(r['mes'])).padStart(2, '0')}`;

const envioDe = (r: Linha): EnvioIras => ({
  id: n(r['id']),
  formulario: texto(r['formulario']) as FormularioIras,
  tipo: texto(r['tipo_envio']) as TipoEnvioIras,
  situacao: texto(r['situacao']) as SituacaoEnvioIras,
  enviadoEm: instanteN(r['enviado_em']),
  protocolo: textoN(r['protocolo']),
  motivoRetificacao: textoN(r['motivo_retificacao']),
  mensagemRetorno: textoN(r['mensagem_retorno']),
  registradoEm: instanteN(r['criado_em']),
  registradoPor: textoN(r['registrado_por']),
  versao: n(r['versao']),
});

/** O retrato do envio guardado no próprio registro (operação e dados). */
const retrato = (e: Record<string, unknown>) => JSON.stringify(e);

export class PortaNotificacaoIrasPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoQualidade,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private gravar<T>(
    c: ContextoPortaM18,
    trilha: (r: T) => TrilhaDaGravacao,
    fn: (
      tx: TxOperacao,
      est: number,
      anotacao: { motivo: string | null; dados: Record<string, unknown> | null },
    ) => Promise<T>,
  ) {
    return gravacaoDireta(this.executor, c, {
      nome: 'qualidade.ccih.notificacao-iras',
      tabelas: TABELAS_NOTIFICACAO_IRAS,
      trilha,
      gravador: (tx, est, anotacao) => ({ tx, est, anotacao }),
      fn: ({ tx, est, anotacao }) => fn(tx, est, anotacao),
    });
  }

  /** As competências fechadas do estabelecimento (as mais recentes primeiro) com os envios e o prazo de cada uma. */
  competencias(c: ContextoPortaM18): Promise<CompetenciaNotificacao[]> {
    return lerNoEstabelecimento(this.nucleo, c, async (l, est) => {
      const hoje = (await relogioDoEstabelecimento(l, est)).slice(0, 10);
      const fs = await l.consultar<Linha>(SQL_COMPETENCIAS, [est], { teto: 24 });
      const envios = await this.enviosDe(
        l,
        fs.map((f) => n(f['id'])),
      );
      return fs.map((f) => {
        const competencia = competenciaDe(f);
        const lista = envios.get(n(f['id'])) ?? [];
        const ultimas = new Map<FormularioIras, SituacaoEnvioIras>();
        for (const e of lista) if (!ultimas.has(e.formulario)) ultimas.set(e.formulario, e.situacao);
        return {
          id: n(f['id']),
          competencia,
          situacao: texto(f['situacao']),
          prazo: prazoDoEnvio(competencia),
          atrasada: envioAtrasado(
            competencia,
            hoje,
            lista.some((e) => transmitido(e.situacao)) ? 'transcrita' : null,
          ),
          formularios: [...ultimas].map(([formulario, ultima]) => ({
            formulario,
            ultima,
            atrasado: envioAtrasado(competencia, hoje, ultima),
          })),
          envios: lista,
          versao: n(f['versao']),
        };
      });
    });
  }

  /** Os envios das competências (o mais recente primeiro). */
  private async enviosDe(l: L, ids: readonly number[]): Promise<Map<number, EnvioIras[]>> {
    const m = new Map<number, EnvioIras[]>();
    if (!ids.length) return m;
    const r = await l.consultar<Linha>(
      `${SQL_ENVIOS} WHERE ne.fechamento_vigilancia_iras_id IN (${ids.map(() => '?').join(', ')})
        ORDER BY ne.criado_em DESC, ne.id DESC`,
      [...ids],
      { teto: TETO * 4 },
    );
    for (const x of r) {
      const k = n(x['fechamento_vigilancia_iras_id']);
      m.set(k, [...(m.get(k) ?? []), envioDe(x)]);
    }
    return m;
  }

  /** A competência travada (do estabelecimento). */
  private async competenciaTravada(tx: TxOperacao, est: number, id: number) {
    const [f] = await tx.consultarParaAtualizar<Linha>(
      'SELECT * FROM fechamento_vigilancia_iras WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
      { teto: 1 },
    );
    if (!f) throw recusa('competencia-inexistente', 'Competência não encontrada neste estabelecimento.');
    return f;
  }

  /** A competência passa a "enviada" no primeiro formulário transmitido (versão anterior na trilha). */
  private async marcarEnviada(
    tx: TxOperacao,
    f: Linha,
    usuario: number,
    anotacao: { dados: Record<string, unknown> | null },
  ) {
    if (texto(f['situacao']) !== 'fechada') return;
    anotacao.dados = {
      ...(anotacao.dados ?? {}),
      competenciaAnterior: {
        tabela: 'fechamento_vigilancia_iras',
        id: n(f['id']),
        versao: n(f['versao']),
        situacao: 'fechada',
      },
    };
    await tx.executar(
      `UPDATE fechamento_vigilancia_iras SET situacao = 'enviada', alterado_em = NOW(3), alterado_por = ?, versao = versao + 1
        WHERE id = ? AND versao = ?`,
      [usuario, n(f['id']), n(f['versao'])],
    );
  }

  /** Registra o envio do formulário da competência (inicial ou retificação, pela regra). */
  registrar(
    c: ContextoPortaM18,
    login: string,
    competencia: number,
    e: EntradaEnvioIras,
    trilha: (r: { id: number }) => TrilhaDaGravacao,
  ): Promise<{ id: number; tipo: TipoEnvioIras; situacao: SituacaoEnvioIras }> {
    return this.gravar(c, trilha, async (tx, est, anotacao) => {
      const usuario = await exigirUsuario(tx, login);
      const f = await this.competenciaTravada(tx, est, competencia);
      const anteriores = await tx.consultar<Linha>(
        'SELECT formulario, situacao FROM notificacao_iras_envio WHERE fechamento_vigilancia_iras_id = ?',
        [competencia],
        { teto: TETO },
      );
      const hoje = (await relogioDoEstabelecimento(tx, est)).slice(0, 10);
      const comp = competenciaDe(f);
      const a = avaliarEnvioIras(e, {
        competencia: comp,
        situacaoCompetencia: texto(f['situacao']),
        anteriores: anteriores.map((x) => ({
          formulario: texto(x['formulario']),
          situacao: texto(x['situacao']) as SituacaoEnvioIras,
        })),
        hoje,
      });
      if (a.recusa) throw recusaIras(a.recusa);
      const enviadoEm = e.situacao === 'transcrita' && e.enviadoEm ? paraBanco(e.enviadoEm) : null;
      const motivo = a.tipo === 'retificacao' ? (e.motivoRetificacao ?? '').trim() : null;
      const protocolo = e.protocolo?.trim() || null;
      const id = await tx.inserir(
        `INSERT INTO notificacao_iras_envio (fechamento_vigilancia_iras_id, operacao, dados, ocorrido_em, usuario_id,
           formulario, tipo_envio, situacao, enviado_em, protocolo, motivo_retificacao, criado_em, criado_por, versao)
         VALUES (?, 'inclusao', ?, NOW(3), ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, 1)`,
        [
          competencia,
          retrato({
            competencia: comp,
            formulario: e.formulario,
            tipo: a.tipo,
            situacao: e.situacao,
            enviadoEm,
            protocolo,
            motivo,
          }),
          usuario,
          e.formulario,
          a.tipo,
          e.situacao,
          enviadoEm,
          protocolo,
          motivo,
          usuario,
        ],
      );
      if (e.situacao === 'transcrita') await this.marcarEnviada(tx, f, usuario, anotacao);
      anotacao.motivo = motivo;
      return { id, tipo: a.tipo, situacao: e.situacao };
    });
  }

  /** Registra o andamento do envio (transmitido, aceito ou rejeitado), com a versão conferida. */
  andamento(
    c: ContextoPortaM18,
    login: string,
    id: number,
    versao: number,
    a: AndamentoEnvio,
    trilha: (r: { id: number }) => TrilhaDaGravacao,
  ): Promise<{ id: number; situacao: SituacaoEnvioIras; versao: number }> {
    return this.gravar(c, trilha, async (tx, est, anotacao) => {
      const usuario = await exigirUsuario(tx, login);
      const [r] = await tx.consultarParaAtualizar<Linha>(
        `SELECT ne.* FROM notificacao_iras_envio ne
           JOIN fechamento_vigilancia_iras f ON f.id = ne.fechamento_vigilancia_iras_id
          WHERE ne.id = ? AND f.estabelecimento_id = ?`,
        [id, est],
        { teto: 1 },
      );
      if (!r || n(r['versao']) !== versao)
        throw recusa('versao-desatualizada', 'O envio mudou desde que foi aberto: recarregue e confira.');
      const f = await this.competenciaTravada(tx, est, n(r['fechamento_vigilancia_iras_id']));
      const hoje = (await relogioDoEstabelecimento(tx, est)).slice(0, 10);
      const enviadoAntes = instanteN(r['enviado_em']);
      const recusaA = avaliarAndamentoIras(texto(r['situacao']) as SituacaoEnvioIras, a, {
        competencia: competenciaDe(f),
        hoje,
        enviadoAntes,
      });
      if (recusaA) throw recusaIras(recusaA);
      const novaData = transmitido(a.situacao) && !enviadoAntes ? a.enviadoEm : enviadoAntes;
      const enviadoEm = novaData ? paraBanco(novaData) : null;
      const protocolo = a.protocolo?.trim() || textoN(r['protocolo']);
      const mensagem = a.mensagemRetorno?.trim() || textoN(r['mensagem_retorno']);
      anotacao.dados = {
        versaoAnterior: {
          tabela: 'notificacao_iras_envio',
          id,
          versao,
          dados: envioDe({ ...r, registrado_por: null }),
        },
      };
      await tx.executar(
        `UPDATE notificacao_iras_envio SET operacao = 'alteracao', dados = ?, ocorrido_em = NOW(3), usuario_id = ?,
            situacao = ?, enviado_em = ?, protocolo = ?, mensagem_retorno = ?, alterado_em = NOW(3), alterado_por = ?,
            versao = versao + 1
          WHERE id = ? AND versao = ?`,
        [
          retrato({
            situacao: a.situacao,
            enviadoEm,
            protocolo,
            mensagemRetorno: mensagem,
            anterior: texto(r['situacao']),
          }),
          usuario,
          a.situacao,
          enviadoEm,
          protocolo,
          mensagem,
          usuario,
          id,
          versao,
        ],
      );
      if (transmitido(a.situacao)) await this.marcarEnviada(tx, f, usuario, anotacao);
      return { id, situacao: a.situacao, versao: versao + 1 };
    });
  }

  /** Os envios de uma competência (para a tela abrir o histórico). */
  envios(c: ContextoPortaM18, competencia: number): Promise<EnvioIras[]> {
    return lerNoEstabelecimento(this.nucleo, c, async (l, est) => {
      const f = await l.uma<Linha>(
        'SELECT id FROM fechamento_vigilancia_iras WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [competencia, est],
      );
      if (!f) return [];
      return (await this.enviosDe(l, [competencia])).get(competencia) ?? [];
    });
  }
}

export type { EntradaEnvioIras, FormularioIras, SituacaoEnvioIras };
