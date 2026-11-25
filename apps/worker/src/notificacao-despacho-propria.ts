// Despachante agendado da notificação por regra (01-ADM L76), porta própria do worker sobre o banco do cliente.
// Regras no domínio (@sgh/dominio-acesso: consolidarAvisos, situacaoInicialEnvio, transicaoEnvio, tentativasApos);
// aqui ficam a leitura e a gravação, pelo Executor (trilha e idempotência na mesma transação).
//
// - notificacao.despacho_consolidar: junta os avisos da central (notificacao_usuario) das regras com consolidação num
//   envio por canal e janela, como a consolidação pedida na tela (a API, administracao/notificacao-regra-propria.ts;
//   o worker não importa a API, então a leitura e a gravação são as mesmas aqui, sobre a mesma regra do domínio). O
//   "não reenviar" é a unicidade de envio_notificacao_aviso por canal e aviso. Canal interno já entrega; canal externo
//   fora de produção fica "capturado" (nada sai); em produção fica pendente para a entrega.
// - notificacao.despacho_entrega: o resultado da entrega do envio pendente de canal externo (enviado ou falhou, com a
//   tentativa contada pela regra do domínio).
import { randomUUID } from 'node:crypto';
import {
  type AvisoPendente,
  camposDaChave,
  consolidarAvisos,
  type SituacaoEnvio,
  situacaoInicialEnvio,
  tentativasApos,
  transicaoEnvio,
} from '@sgh/dominio-acesso';
import { definirOperacao, type Executor, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { type AlvoEstabelecimento, estabelecimentosAtivos, type NucleoWorker } from './servico-worker.js';

const TETO = 5000;
const FLAG_CANAL: Readonly<Record<string, string>> = {
  central: 'notifica_tela',
  painel: 'notifica_tela',
  email: 'notifica_email',
  sms: 'notifica_sms',
  whatsapp: 'notifica_sms',
  push: 'notifica_aplicativo',
};

export interface CanalDespacho {
  readonly codigo: string;
  readonly tipo: string;
  readonly externo: boolean;
}
// Tipo literal (não interface): o resultado da operação precisa caber no registro do Executor.
export type ResultadoConsolidacao = {
  readonly envios: number;
  readonly avisos: number;
  readonly aguardando: number;
  readonly retidos: number;
};
/** Envio pendente de canal externo, com o contato do destinatário (só para a entrega; nunca vai ao log). */
export interface EnvioPendente {
  readonly id: number;
  readonly versao: number;
  readonly tipo: string;
  readonly contato: string | null;
  readonly quantidadeAvisos: number;
}

export interface PortaDespachoNotificacao {
  estabelecimentos(): Promise<AlvoEstabelecimento[]>;
  canais(): Promise<CanalDespacho[]>;
  consolidar(
    est: AlvoEstabelecimento,
    canal: string,
    producao: boolean,
    agora: Date,
  ): Promise<ResultadoConsolidacao>;
  pendentes(est: AlvoEstabelecimento, limite: number): Promise<EnvioPendente[]>;
  registrarEntrega(
    est: AlvoEstabelecimento,
    envio: number,
    versao: number,
    erro: string | null,
  ): Promise<string>;
}

const n = (v: unknown) => Number(v ?? 0);
const nOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const data = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));
const bool = (v: unknown) => v === true || v === 1 || v === '1';

const ENTRADA_CONSOLIDAR = z.object({
  estabelecimento: z.number().int().positive(),
  canal: z.string().min(1).max(30),
  producao: z.boolean(),
  agora: z.string().min(10),
});
const ENTRADA_ENTREGA = z.object({
  estabelecimento: z.number().int().positive(),
  envio: z.number().int().positive(),
  versao: z.number().int().positive(),
  erro: z.string().max(500).nullable(),
});

export class PortaDespachoNotificacaoPropria implements PortaDespachoNotificacao {
  private readonly executor: Executor;

  private readonly opConsolidar = definirOperacao<
    z.infer<typeof ENTRADA_CONSOLIDAR>,
    ResultadoConsolidacao & { canal: number }
  >({
    nome: 'notificacao.despacho_consolidar',
    tabelas: ['envio_notificacao', 'envio_notificacao_aviso'],
    entrada: ENTRADA_CONSOLIDAR,
    gravar: (tx, e) => this.consolidarTx(tx, e),
    alvo: (_e, r) => ({ tabela: 'canal_notificacao', id: r.canal }),
  });

  private readonly opEntrega = definirOperacao<z.infer<typeof ENTRADA_ENTREGA>, { situacao: string }>({
    nome: 'notificacao.despacho_entrega',
    tabelas: ['envio_notificacao'],
    entrada: ENTRADA_ENTREGA,
    gravar: async (tx, e) => {
      const [x] = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao, tentativas FROM envio_notificacao WHERE id = ? AND estabelecimento_id = ?',
        [e.envio, e.estabelecimento],
        { teto: 1 },
      );
      if (!x) return { situacao: 'inexistente' };
      const atual = String(x['situacao']) as SituacaoEnvio;
      const evento = e.erro === null ? 'enviar' : 'falhar';
      const t = transicaoEnvio(atual, evento, n(x['tentativas']));
      if ('recusa' in t) return { situacao: atual };
      const valores: Record<string, unknown> = {
        situacao: t.nova,
        tentativas: tentativasApos(atual, evento, n(x['tentativas'])),
      };
      if (e.erro === null) valores['enviado_em'] = new Date();
      else valores['erro'] = e.erro;
      await tx.alterar('envio_notificacao', e.envio, e.versao, valores);
      return { situacao: t.nova };
    },
    alvo: (e) => ({ tabela: 'envio_notificacao', id: e.envio }),
  });

  constructor(
    private readonly nucleo: NucleoWorker,
    readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(est: number | null, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, estabelecimento: est, correlacao: 'notificacao-despacho' },
      fn,
    );
  }

  private ctx(est: number, chave: string) {
    return {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: null,
      correlacao: 'notificacao-despacho',
      chaveIdempotencia: `worker.notificacao.${chave}.${randomUUID()}`.slice(0, 80),
    };
  }

  estabelecimentos(): Promise<AlvoEstabelecimento[]> {
    return this.ler(null, (l) => estabelecimentosAtivos(l, this.cliente));
  }

  canais(): Promise<CanalDespacho[]> {
    return this.ler(null, async (l) =>
      (
        await l.consultar(
          'SELECT codigo, tipo_canal, externo FROM canal_notificacao WHERE ativo ORDER BY ordem, codigo',
          [],
          {
            teto: 100,
          },
        )
      ).map((x) => ({ codigo: txt(x['codigo']), tipo: txt(x['tipo_canal']), externo: bool(x['externo']) })),
    );
  }

  async consolidar(est: AlvoEstabelecimento, canal: string, producao: boolean, agora: Date) {
    const r = await this.executor.executar(
      this.opConsolidar,
      this.cliente,
      { estabelecimento: est.id, canal, producao, agora: agora.toISOString() },
      this.ctx(est.id, `consolidar.${canal}`),
    );
    const { envios, avisos, aguardando, retidos } = r.resultado;
    return { envios, avisos, aguardando, retidos };
  }

  pendentes(est: AlvoEstabelecimento, limite: number): Promise<EnvioPendente[]> {
    return this.ler(est.id, async (l) =>
      (
        await l.consultar(
          `SELECT en.id, en.versao, c.tipo_canal, u.email, u.telefone_celular, en.quantidade_avisos
             FROM envio_notificacao en
             JOIN canal_notificacao c ON c.id = en.canal_notificacao_id
             JOIN usuario u ON u.id = en.usuario_id
            WHERE en.estabelecimento_id = ? AND en.situacao = 'pendente' AND c.externo
            ORDER BY en.ocorrido_em, en.id
            LIMIT ${Math.max(1, Math.min(limite, 500))}`,
          [est.id],
          { teto: 500 },
        )
      ).map((x) => {
        const tipo = txt(x['tipo_canal']);
        const contato = tipo === 'email' ? x['email'] : x['telefone_celular'];
        return {
          id: n(x['id']),
          versao: n(x['versao']),
          tipo,
          contato:
            contato === null || contato === undefined || String(contato).trim() === ''
              ? null
              : String(contato).trim(),
          quantidadeAvisos: n(x['quantidade_avisos']),
        };
      }),
    );
  }

  async registrarEntrega(est: AlvoEstabelecimento, envio: number, versao: number, erro: string | null) {
    const r = await this.executor.executar(
      this.opEntrega,
      this.cliente,
      { estabelecimento: est.id, envio, versao, erro: erro === null ? null : erro.slice(0, 500) },
      this.ctx(est.id, `entrega.${envio}`),
    );
    return r.resultado.situacao;
  }

  private async consolidarTx(tx: TxOperacao, e: z.infer<typeof ENTRADA_CONSOLIDAR>) {
    const est = e.estabelecimento;
    const agora = new Date(e.agora);
    const canal = await tx.uma(
      'SELECT id, tipo_canal, externo, ativo FROM canal_notificacao WHERE codigo = ?',
      [e.canal],
    );
    if (!canal || !bool(canal['ativo'])) return { canal: 0, envios: 0, avisos: 0, aguardando: 0, retidos: 0 };
    const canalId = n(canal['id']);
    const flag = FLAG_CANAL[txt(canal['tipo_canal'])] ?? 'notifica_tela';
    const coluna =
      flag === 'notifica_email'
        ? 'r.notifica_email'
        : flag === 'notifica_sms'
          ? 'r.notifica_sms'
          : flag === 'notifica_aplicativo'
            ? 'r.notifica_aplicativo'
            : 'r.notifica_tela';
    const regras = await tx.consultar(
      `SELECT r.id AS regra, rc.id AS rc, rc.janela_minutos, rc.chave_agrupamento, rc.limite_por_usuario,
              rc.periodo_limite_minutos, TIME_FORMAT(rc.horario_resumo, '%H:%i') AS horario
         FROM regra_alerta r JOIN regra_consolidacao_notificacao rc ON rc.id = r.regra_consolidacao_notificacao_id
         LEFT JOIN regra_alerta_estabelecimento rae ON rae.regra_alerta_id = r.id AND rae.estabelecimento_id = ?
        WHERE r.ativo AND COALESCE(rae.ativo, TRUE) AND rc.ativo AND ${coluna}
          AND (r.estabelecimento_id IS NULL OR r.estabelecimento_id = ?)
          AND (rc.estabelecimento_id IS NULL OR rc.estabelecimento_id = ?)
        ORDER BY rc.id, r.id`,
      [est, est, est],
      { teto: TETO },
    );
    const grupos = new Map<number, { linha: Record<string, unknown>; regras: number[] }>();
    for (const x of regras) {
      const g = grupos.get(n(x['rc']));
      if (g) g.regras.push(n(x['regra']));
      else grupos.set(n(x['rc']), { linha: x, regras: [n(x['regra'])] });
    }
    const situacao = situacaoInicialEnvio(bool(canal['externo']), e.producao);
    let envios = 0;
    let avisosEnviados = 0;
    let aguardando = 0;
    let retidos = 0;
    for (const [rcId, { linha, regras: rs }] of grupos) {
      const avisos = await tx.consultar(
        `SELECT n.id, n.usuario_id, n.regra_alerta_id, n.paciente_id, n.atendimento_id, n.entidade, n.entidade_id,
                n.chave_agrupamento, n.gerada_em
           FROM notificacao_usuario n
          WHERE n.estabelecimento_id = ? AND n.regra_alerta_id IN (${rs.map(() => '?').join(', ')})
            AND n.excluido_em IS NULL AND n.resolvida = FALSE
            AND NOT EXISTS (SELECT 1 FROM envio_notificacao_aviso ea
                  WHERE ea.canal_notificacao_id = ? AND ea.notificacao_usuario_id = n.id)
          ORDER BY n.gerada_em, n.id`,
        [est, ...rs, canalId],
        { teto: TETO },
      );
      const limite = nOuNulo(linha['limite_por_usuario']);
      const recentes = new Map<number, number>();
      if (limite !== null) {
        const desde = new Date(agora.getTime() - n(linha['periodo_limite_minutos']) * 60_000);
        for (const x of await tx.consultar(
          `SELECT usuario_id, COUNT(*) AS q FROM envio_notificacao
            WHERE estabelecimento_id = ? AND canal_notificacao_id = ? AND regra_consolidacao_notificacao_id = ?
              AND ocorrido_em >= ?
            GROUP BY usuario_id`,
          [est, canalId, rcId, desde],
          { teto: TETO },
        ))
          recentes.set(n(x['usuario_id']), n(x['q']));
      }
      const r = consolidarAvisos(
        avisos.map((x): AvisoPendente => ({
          id: n(x['id']),
          usuario: n(x['usuario_id']),
          regra: nOuNulo(x['regra_alerta_id']),
          paciente: nOuNulo(x['paciente_id']),
          atendimento: nOuNulo(x['atendimento_id']),
          entidade: txt(x['entidade']),
          entidadeId: nOuNulo(x['entidade_id']),
          assunto: txt(x['chave_agrupamento']),
          geradoEm: data(x['gerada_em']),
        })),
        {
          janelaMinutos: n(linha['janela_minutos']),
          campos: camposDaChave(txt(linha['chave_agrupamento'])),
          limitePorUsuario: limite,
          horarioResumo: txt(linha['horario']),
        },
        agora,
        recentes,
      );
      aguardando += r.aguardando.length;
      retidos += r.retidos.length;
      for (const en of r.envios) {
        avisosEnviados += en.avisos.length;
        const envio = await tx.incluir('envio_notificacao', {
          estabelecimento_id: est,
          usuario_id: en.usuario,
          canal_notificacao_id: canalId,
          notificacao_usuario_id: en.avisos.length === 1 ? en.avisos[0] : null,
          regra_consolidacao_notificacao_id: rcId,
          quantidade_avisos: en.avisos.length,
          avisos_consolidados: JSON.stringify(en.avisos),
          situacao,
          tentativas: situacao === 'pendente' ? 0 : 1,
          enviado_em: situacao === 'pendente' ? null : agora,
          entregue_em: situacao === 'entregue' ? agora : null,
          ocorrido_em: agora,
        });
        for (const aviso of en.avisos)
          await tx.incluir('envio_notificacao_aviso', {
            envio_notificacao_id: envio,
            notificacao_usuario_id: aviso,
            canal_notificacao_id: canalId,
          });
        envios++;
      }
    }
    return { canal: canalId, envios, avisos: avisosEnviados, aguardando, retidos };
  }
}
