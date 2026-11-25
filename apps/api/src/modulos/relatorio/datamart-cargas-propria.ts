// Controle da carga do data mart na administração (01-REL L113; F3), sobre o banco do cliente pelo @sgh/nucleo.
// Leitura: as cargas do estabelecimento da sessão (carga_data_mart), com a situação que a tela mostra (aguardando o
// worker, em execução, interrompida ou fechada), as linhas e a duração, e o detalhe com as etapas por dimensão e fato
// (carga_data_mart_etapa). Gravação: o pedido manual da carga pelo executor (trilha na mesma transação), sob a trava da
// linha do estabelecimento: recusado (409 carga-em-andamento) se outra carga dele está aberta há menos do que o teto;
// aceito, grava a carga manual completa em execução, com o usuário e a marcação `pedido = aguardando` que o worker
// assume. Nada de dado de pessoa no registro: só contagens, tempos e a mensagem limpa.
import {
  ASSUNTO_CARGA_DATAMART,
  decidirPedidoManual,
  duracaoDaCarga,
  PEDIDO_AGUARDANDO,
  situacaoVisivel,
  type SituacaoVisivelCarga,
} from '@sgh/dominio-relatorio';
import { ErroOperacao } from '@sgh/nucleo';
import {
  type ContextoPortaPropria,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const CARGAS_DATAMART = Symbol('CARGAS_DATAMART');

const TABELAS = ['carga_data_mart'] as const;
type Linha = Record<string, unknown>;

export interface CargaDataMartLida {
  readonly id: number;
  readonly disparo: 'agendado' | 'manual';
  readonly tipoCarga: string;
  readonly situacao: SituacaoVisivelCarga;
  readonly ocorridoEm: string;
  readonly concluidoEm: string | null;
  readonly duracaoMs: number | null;
  readonly linhasLidas: number | null;
  readonly linhasGravadas: number | null;
  readonly linhasRejeitadas: number | null;
  readonly mensagemErro: string | null;
  readonly pedidoPor: string | null;
  readonly etapas: number;
}

export interface EtapaCargaLida {
  readonly sequencia: number;
  readonly tipoObjeto: string;
  readonly objeto: string;
  readonly linhas: number | null;
  readonly duracaoMs: number | null;
  readonly situacao: string;
}

const quando = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v).replace(' ', 'T') + 'Z');

const SELECAO = `SELECT c.id, c.disparo, c.tipo_carga, c.situacao, c.ocorrido_em, c.concluido_em, c.linhas_lidas,
       c.linhas_gravadas, c.linhas_rejeitadas, c.mensagem_erro, JSON_UNQUOTE(JSON_EXTRACT(c.dados, '$.pedido')) AS pedido,
       u.nome AS pedido_por,
       (SELECT COUNT(*) FROM carga_data_mart_etapa x WHERE x.carga_data_mart_id = c.id AND x.excluido_em IS NULL) AS etapas
  FROM carga_data_mart c
  LEFT JOIN usuario u ON u.id = c.usuario_id
 WHERE c.estabelecimento_id = ? AND c.assunto = ?`;

export class PortaCargasDataMartPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'relatorio.datamart');
  }

  private linha(x: Linha, agora: Date): CargaDataMartLida {
    const ocorrido = quando(x['ocorrido_em']) ?? agora;
    const concluido = quando(x['concluido_em']);
    return {
      id: num(x['id']),
      disparo: String(x['disparo']) === 'manual' ? 'manual' : 'agendado',
      tipoCarga: String(x['tipo_carga']),
      situacao: situacaoVisivel(
        { situacao: String(x['situacao']), pedido: txtOuNull(x['pedido']), ocorridoEm: ocorrido },
        agora,
      ),
      ocorridoEm: ocorrido.toISOString(),
      concluidoEm: concluido ? concluido.toISOString() : null,
      duracaoMs: duracaoDaCarga(ocorrido, concluido),
      linhasLidas: numOuNull(x['linhas_lidas']),
      linhasGravadas: numOuNull(x['linhas_gravadas']),
      linhasRejeitadas: numOuNull(x['linhas_rejeitadas']),
      mensagemErro: txtOuNull(x['mensagem_erro']),
      pedidoPor: txtOuNull(x['pedido_por']),
      etapas: num(x['etapas']),
    };
  }

  /** As cargas do estabelecimento da sessão, da mais recente (no máximo `limite`, até 200). */
  listar(c: ContextoPortaPropria, limite = 50, agora = new Date()): Promise<CargaDataMartLida[]> {
    const n = Math.min(Math.max(Math.trunc(limite) || 50, 1), 200);
    return this.ler(c, 'listar', async (l, est) =>
      (
        await l.consultar<Linha>(`${SELECAO} ORDER BY c.ocorrido_em DESC, c.id DESC LIMIT ${n}`, [
          est.id,
          ASSUNTO_CARGA_DATAMART,
        ])
      ).map((x) => this.linha(x, agora)),
    );
  }

  /** A carga com as etapas por dimensão e fato. */
  detalhe(
    c: ContextoPortaPropria,
    id: number,
    agora = new Date(),
  ): Promise<CargaDataMartLida & { itens: EtapaCargaLida[] }> {
    return this.ler(c, 'detalhe', async (l, est) => {
      const x = await l.uma<Linha>(`${SELECAO} AND c.id = ?`, [est.id, ASSUNTO_CARGA_DATAMART, id]);
      if (!x) throw naoEncontrado('Carga do data mart');
      const etapas = await l.consultar<Linha>(
        `SELECT sequencia, tipo_objeto, objeto_carga, linhas_gravadas, duracao_ms, situacao
           FROM carga_data_mart_etapa WHERE carga_data_mart_id = ? AND excluido_em IS NULL ORDER BY sequencia LIMIT 500`,
        [id],
      );
      return {
        ...this.linha(x, agora),
        itens: etapas.map((e) => ({
          sequencia: num(e['sequencia']),
          tipoObjeto: String(e['tipo_objeto']),
          objeto: String(e['objeto_carga']),
          linhas: numOuNull(e['linhas_gravadas']),
          duracaoMs: numOuNull(e['duracao_ms']),
          situacao: String(e['situacao']),
        })),
      };
    });
  }

  /** Pede a carga manual do estabelecimento da sessão; o worker a assume na volta seguinte. */
  pedir(c: ContextoPortaPropria, agora = new Date()): Promise<{ id: number; situacao: 'aguardando' }> {
    return this.gravar(c, 'relatorio.datamart.carga_pedir', TABELAS, async (tx, est, usuario) => {
      // A trava do estabelecimento serializa dois pedidos e o worker: o segundo vê a carga aberta.
      await tx.consultarParaAtualizar('SELECT id FROM estabelecimento WHERE id = ?', [est.id], { teto: 1 });
      const abertas = await tx.consultar<Linha>(
        `SELECT id, ocorrido_em FROM carga_data_mart
          WHERE estabelecimento_id = ? AND assunto = ? AND situacao = 'em_execucao'`,
        [est.id, ASSUNTO_CARGA_DATAMART],
        { teto: 50 },
      );
      const d = decidirPedidoManual(
        abertas.map((a) => ({ id: num(a['id']), ocorridoEm: quando(a['ocorrido_em']) ?? agora })),
        agora,
      );
      if (!d.aceito)
        throw new ErroOperacao(
          409,
          'carga-em-andamento',
          'Carga do data mart em andamento',
          `Já há uma carga do data mart aberta neste estabelecimento (carga ${d.carga}): aguarde o fim dela.`,
        );
      const id = await tx.incluir('carga_data_mart', {
        estabelecimento_id: est.id,
        assunto: ASSUNTO_CARGA_DATAMART,
        tipo_carga: 'completa',
        disparo: 'manual',
        ocorrido_em: agora,
        situacao: 'em_execucao',
        usuario_id: usuario,
        dados: JSON.stringify({ pedido: PEDIDO_AGUARDANDO }),
      });
      return { tabela: 'carga_data_mart', id, situacao: 'aguardando' as const };
    }).then((r) => ({ id: Number(r.id), situacao: r.situacao }));
  }
}
