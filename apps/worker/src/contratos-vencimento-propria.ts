// Porta própria do alerta diário de vencimento dos contratos com fornecedores (M55, etapa 3; regra 5; lote F2.2 05-15)
// sobre o banco do cliente, pelo @sgh/nucleo. Leitura (somente leitura, filtrada pelo estabelecimento e pelos
// excluídos): a chave `contratos` (liberacao_chave, recurso_prerequisito), os contratos vigentes com o fim da vigência
// (contrato_fornecedor; o aditivo de prazo e a renovação mudam o fim) e o gestor e o fiscal vigentes (gestor_contrato).
// Gravação: os avisos na central de avisos (notificacao_usuario) numa operação do Executor por contrato (trilha na
// mesma transação), uma vez por destinatário, faixa e fim (chave de agrupamento), sob a trava da linha do contrato.
// Melhoria: o destinatário é o usuário (chave estrangeira) do gestor principal do contrato (contrato_fornecedor.
// gestor_usuario_id) e do gestor e do fiscal vigentes no vínculo (gestor_contrato), sem repetir, não um login digitado;
// o aviso já gravado não abre operação (nem trilha) de novo; o contrato em alerta sem nenhum deles é contado.
// Melhoria: a antecedência própria do contrato (dias_alerta_vencimento) e o assunto e a mensagem dele (assunto_alerta,
// mensagem_alerta) vão ao serviço, que os aplica no aviso (título e texto da central).
import { randomUUID } from 'node:crypto';
import { CHAVE_LIBERACAO_CONTRATOS, EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { definirOperacao, type Executor, type Leitor } from '@sgh/nucleo';
import { z } from 'zod';
import { type AlvoEstabelecimento, estabelecimentosAtivos, type NucleoWorker, recursoLigadoAqui } from './servico-worker.js';

export const TIPO_AVISO_CONTRATO = 'contrato-vencimento';

export interface ContratoParaAlerta {
  readonly id: number;
  readonly numero: string;
  /** Situação do cadastro (vigente, suspenso...). */
  readonly situacao: string;
  readonly inicio: string;
  readonly fim: string;
  /** Usuários do gestor principal e do gestor e do fiscal vigentes no vínculo, sem repetir. */
  readonly destinatarios: readonly number[];
  /** Antecedência própria do alerta, em dias (null: só as faixas padrão). */
  readonly diasAlerta: number | null;
  /** Assunto e mensagem próprios do alerta do contrato (null: os textos padrão). */
  readonly assunto: string | null;
  readonly mensagem: string | null;
}

export interface AvisoContrato {
  readonly contrato: number;
  readonly chave: string;
  readonly titulo: string;
  /** O texto do aviso (a mensagem própria do contrato, ou o título). */
  readonly texto: string;
  readonly destinatarios: readonly number[];
}

export interface PortaContratos {
  estabelecimentos(): Promise<AlvoEstabelecimento[]>;
  ligada(est: AlvoEstabelecimento, agora: Date): Promise<boolean>;
  contratos(est: AlvoEstabelecimento, hoje: string): Promise<ContratoParaAlerta[]>;
  /** Os avisos novos gravados (0: todos os destinatários já avisados nesta faixa e fim). */
  avisar(est: AlvoEstabelecimento, aviso: AvisoContrato): Promise<number>;
}

const n = (v: unknown) => Number(v ?? 0);
const dia = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const textoOuNulo = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
const em = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const agrupamento = (chave: string) => `${TIPO_AVISO_CONTRATO}:${chave}`.slice(0, 100);

const ENTRADA = z.object({
  estabelecimento: z.number().int().positive(),
  contrato: z.number().int().positive(),
  chave: z.string().min(1).max(80),
  titulo: z.string().min(1).max(200),
  texto: z.string().min(1).max(20_000),
  destinatarios: z.array(z.number().int().positive()).min(1),
});

export class PortaContratosPropria implements PortaContratos {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoWorker,
    readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(est: number | null, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, estabelecimento: est, correlacao: 'contratos-vencimento' }, fn);
  }

  estabelecimentos(): Promise<AlvoEstabelecimento[]> {
    return this.ler(null, (l) => estabelecimentosAtivos(l, this.cliente));
  }

  ligada(est: AlvoEstabelecimento, agora: Date): Promise<boolean> {
    return this.ler(est.id, (l) => recursoLigadoAqui(l, CHAVE_LIBERACAO_CONTRATOS, est.id, agora));
  }

  contratos(est: AlvoEstabelecimento, hoje: string): Promise<ContratoParaAlerta[]> {
    return this.ler(est.id, async (l) => {
      const cs = await l.consultar(
        `SELECT id, numero, situacao, vigencia_inicio, vigencia_fim, gestor_usuario_id, dias_alerta_vencimento,
                assunto_alerta, mensagem_alerta
           FROM contrato_fornecedor
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'vigente' AND vigencia_fim IS NOT NULL
          ORDER BY vigencia_fim, id`,
        [est.id],
        { teto: 50_000 },
      );
      const ids = cs.map((c) => n(c['id']));
      const dest = new Map<number, Set<number>>();
      for (const c of cs)
        if (c['gestor_usuario_id'] !== null && c['gestor_usuario_id'] !== undefined)
          dest.set(n(c['id']), new Set([n(c['gestor_usuario_id'])]));
      for (let i = 0; i < ids.length; i += 500) {
        const parte = ids.slice(i, i + 500);
        for (const g of await l.consultar(
          `SELECT contrato_fornecedor_id, usuario_id FROM gestor_contrato
            WHERE contrato_fornecedor_id IN (${em(parte.length)}) AND papel IN ('gestor', 'fiscal') AND excluido_em IS NULL
              AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
            ORDER BY papel, id`,
          [...parte, hoje, hoje],
          { teto: 50_000 },
        )) {
          const k = n(g['contrato_fornecedor_id']);
          dest.set(k, (dest.get(k) ?? new Set()).add(n(g['usuario_id'])));
        }
      }
      return cs.map((c) => ({
        id: n(c['id']),
        numero: String(c['numero']),
        situacao: String(c['situacao']),
        inicio: dia(c['vigencia_inicio']),
        fim: dia(c['vigencia_fim']),
        destinatarios: [...(dest.get(n(c['id'])) ?? [])],
        diasAlerta: c['dias_alerta_vencimento'] === null || c['dias_alerta_vencimento'] === undefined ? null : n(c['dias_alerta_vencimento']),
        assunto: textoOuNulo(c['assunto_alerta']),
        mensagem: textoOuNulo(c['mensagem_alerta']),
      }));
    });
  }

  async avisar(est: AlvoEstabelecimento, aviso: AvisoContrato): Promise<number> {
    if (aviso.destinatarios.length === 0) return 0;
    const grupo = agrupamento(aviso.chave);
    const avisados = await this.ler(est.id, async (l) =>
      (
        await l.consultar(
          `SELECT usuario_id FROM notificacao_usuario
            WHERE estabelecimento_id = ? AND chave_agrupamento = ? AND excluido_em IS NULL AND usuario_id IN (${em(aviso.destinatarios.length)})`,
          [est.id, grupo, ...aviso.destinatarios],
          { teto: 1000 },
        )
      ).map((r) => n(r['usuario_id'])),
    );
    const faltam = aviso.destinatarios.filter((d) => !avisados.includes(d));
    if (faltam.length === 0) return 0;
    const op = definirOperacao<z.infer<typeof ENTRADA>, { novos: number }>({
      nome: 'suprimentos.contrato.alerta_vencimento',
      tabelas: ['notificacao_usuario'],
      entrada: ENTRADA,
      gravar: async (tx, e) => {
        // A trava do contrato serializa dois consumidores: o segundo relê os avisos já gravados.
        const c = await tx.consultarParaAtualizar(
          'SELECT id FROM contrato_fornecedor WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.contrato, e.estabelecimento],
          { teto: 1 },
        );
        if (c.length === 0) return { novos: 0 };
        const g = agrupamento(e.chave);
        const ja = new Set(
          (
            await tx.consultar(
              `SELECT usuario_id FROM notificacao_usuario
                WHERE estabelecimento_id = ? AND chave_agrupamento = ? AND excluido_em IS NULL AND usuario_id IN (${em(e.destinatarios.length)})`,
              [e.estabelecimento, g, ...e.destinatarios],
              { teto: 1000 },
            )
          ).map((r) => n(r['usuario_id'])),
        );
        let novos = 0;
        const agora = new Date();
        for (const usuario of e.destinatarios) {
          if (ja.has(usuario)) continue;
          await tx.incluir('notificacao_usuario', {
            estabelecimento_id: e.estabelecimento,
            usuario_id: usuario,
            titulo: e.titulo,
            texto: e.texto,
            detalhes: JSON.stringify({
              tipo: TIPO_AVISO_CONTRATO,
              modulo: 'suprimentos',
              evento: EVENTOS_AUDITAVEIS.contratoAlertaVencimento.codigo,
            }),
            link: '/suprimentos/contratos',
            gravidade: 'atencao',
            entidade: 'contrato_fornecedor',
            entidade_id: e.contrato,
            chave_agrupamento: g,
            gerada_em: agora,
          });
          novos++;
        }
        return { novos };
      },
      alvo: (e) => ({ tabela: 'contrato_fornecedor', id: e.contrato }),
    });
    const r = await this.executor.executar(
      op,
      this.cliente,
      {
        estabelecimento: est.id,
        contrato: aviso.contrato,
        chave: aviso.chave,
        titulo: aviso.titulo,
        texto: aviso.texto,
        destinatarios: faltam,
      },
      {
        cliente: this.cliente,
        estabelecimento: est.id,
        usuario: null,
        correlacao: aviso.chave.slice(0, 64),
        chaveIdempotencia: `worker.contrato.${aviso.contrato}.${randomUUID()}`,
      },
    );
    return r.resultado.novos;
  }
}
