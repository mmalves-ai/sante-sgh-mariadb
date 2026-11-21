// Porta do portal do médico externo sobre o banco do cliente (M50, etapa 3), pelo @sgh/nucleo: a conta do portal
// (conta_portal_profissional_externo, da rede inteira: o médico externo entra em qualquer estabelecimento do cliente,
// por isso a conta não tem estabelecimento), o profissional do corpo clínico (profissional, pessoa_fisica) e as
// inscrições no conselho (inscricao_conselho, unidade_federativa), o login do profissional (usuario_profissional,
// usuario). Leituras somente leitura; gravações pelo Executor, com a trilha, o outbox e a idempotência na mesma
// transação, a conta relida sob trava (FOR UPDATE) e a versão conferida.
// Melhoria: o vínculo da conta com o profissional é a autorização do hospital (autorizada_por_usuario_id e
// autorizada_em): desligar tira a autorização e mantém o profissional da conta; só a conta vigente (autorizada, não
// encerrada) prende o profissional, e o desligado ou o da conta encerrada pode ser ligado a outra conta; ligar exige
// inscrição ativa ou provisória no conselho e a conta ativa, e a pessoa da conta acompanha a do profissional.
// Melhoria: uma operação do Executor por gravação, com o esquema da entrada de negócio e a Idempotency-Key da
// requisição: o clique duplo devolve o mesmo resultado e a mesma chave com outro corpo é recusada.
// Melhoria: o código de prestador do repasse e o cirurgião da agenda são o próprio profissional (id): nenhum código é
// compartilhado entre cadastros, e o "código repetido" do sistema de origem deixa de existir.
// Melhoria: o ato do hospital sobre a conta (bloqueio, desbloqueio, encerramento) passa pela regra do domínio do módulo
// (regras-conta.ts) e vai à trilha com o motivo e a decisão sobre os pedidos pendentes.
// Melhoria: a troca do e-mail da conta grava o pedido em troca_email_conta_portal (o código nunca é guardado, só o
// resumo; um pedido pendente por conta, CHECK e UNIQUE do banco) e a confirmação passa a conta ao e-mail novo.
// Melhoria: a notificação do aviso de crítico ao médico externo é uma tentativa de contato do aviso
// (aviso_valor_critico_tentativa, uma por aviso e conta do portal, UNIQUE do banco), com o envio e o motivo.
// Pendências (nada em silêncio; a tela recebe 409 com o motivo; pedidos em
// docs/obra/fatias/f24/saida/21-misto-farmacia.json): OPERACOES_PENDENTES abaixo.
import {
  type ContextoNucleo,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  restricaoUnicaViolada,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type AtoContaMedicoRegistrado,
  type ContextoPortalMedico,
  type DecisaoPedidosConta,
  type EnvioCriticoMedico,
  type EnvioTrocaEmailMedico,
  type GravadorPortalMedico,
  type NotificacaoCriticoMedico,
  type TrocaEmailMedico,
  METODOS_PORTA_PORTAL_MEDICO,
  type PortaPortalMedico,
  type ProfissionalCorpoClinico,
  type TrilhaPortalMedico,
  trilhaDoNucleo,
  type VinculoMedicoExterno,
} from './porta.js';
import { conferirAtoContaMedico, SITUACAO_DO_MODELO, situacaoDaTela } from './regras-conta.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoPortalMedico = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

export const TABELA_CONTA = 'conta_portal_profissional_externo';
const TABELAS_GRAVACAO = [
  TABELA_CONTA,
  'ato_conta_portal_profissional_externo',
  'troca_email_conta_portal',
  'aviso_valor_critico_tentativa',
] as const;
/** O canal da notificação do crítico pelo portal do médico externo (cadastro canal_notificacao do cliente). */
export const CANAL_CRITICO_PORTAL_MEDICO = 'portal_medico_externo';
const TETO_BUSCA = 20;

/** Operações que o banco próprio ainda não atende, com o que falta (pedidos do lote 21-misto-farmacia da F2.4). */
export const OPERACOES_PENDENTES: Readonly<Record<string, string>> = {
  trocarSenha:
    'a troca de senha da conta do médico externo (a senha fica no provedor de identidade, ainda não ligado)',
};

const id = z.number().int().positive();
const ENTRADA_VINCULAR = z.object({ acesso: id, profissional: id }).strict();
const ENTRADA_DESVINCULAR = z.object({ acesso: id }).strict();
const ENTRADA_ATO = z
  .object({
    acesso: id,
    ato: z.enum(['bloqueio', 'desbloqueio', 'encerramento']),
    motivo: z.string().trim().min(1).max(250),
    pedidosPendentes: z.number().int().min(0),
    decisaoPedidos: z.enum(['retirar', 'manter']).nullable(),
  })
  .strict()
  .refine((e) => e.pedidosPendentes === 0 || e.decisaoPedidos !== null, { path: ['decisaoPedidos'] });
const ENTRADA_LEITURA = z
  .object({ evento: z.string().min(1).max(120), operacao: z.string().max(200), alvo: z.string().nullable() })
  .strict();

const emOutraConta = () =>
  recusa('profissional-em-outra-conta', 'O profissional já está ligado a outra conta do portal.', {
    campos: ['profissional'],
  });

const pendente = (o: string): ErroOperacao =>
  new ErroOperacao(
    409,
    'modelo-pendente',
    'Recurso ainda não disponível no banco',
    `${o.slice(0, 1).toUpperCase()}${o.slice(1)} ainda não está disponível neste banco.`,
  );

/** O ato gravado (snake_case) → o da tela (as trocas usam hífen). */
const ATO_DO_BANCO: Readonly<Record<string, AtoContaMedicoRegistrado['ato']>> = {
  troca_senha: 'troca-senha',
  troca_email: 'troca-email',
};

const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');
const comoData = (v: unknown): Date | null =>
  v instanceof Date ? v : v === null || v === undefined ? null : new Date(String(v).replace(' ', 'T') + 'Z');

/** O envio da tela → o do banco (sem nome de fornecedor no modelo: a plataforma de mensagens é `plataforma`). */
const ENVIO_TROCA_PARA_BANCO: Readonly<Record<EnvioTrocaEmailMedico, string>> = {
  simulador: 'simulador',
  halai: 'plataforma',
};
const ENVIO_CRITICO_PARA_BANCO: Readonly<Record<EnvioCriticoMedico, string>> = {
  simulador: 'simulador',
  halai: 'plataforma',
  desligado: 'desligado',
};
const ENVIO_TROCA_DO_BANCO: Readonly<Record<string, EnvioTrocaEmailMedico>> = {
  simulador: 'simulador',
  plataforma: 'halai',
};
const ENVIO_CRITICO_DO_BANCO: Readonly<Record<string, EnvioCriticoMedico>> = {
  simulador: 'simulador',
  plataforma: 'halai',
  desligado: 'desligado',
};
const resumo64 = z.string().regex(/^[0-9a-f]{64}$/);
const ENTRADA_PEDIR_TROCA = z
  .object({
    acesso: z.number().int().positive(),
    emailNovo: z.string().email().max(254),
    tokenResumo: resumo64,
    validoAte: z.string().datetime(),
    envio: z.enum(['simulador', 'halai']),
  })
  .strict();
const ENTRADA_CANCELAR_TROCA = z.object({ troca: z.number().int().positive() }).strict();
const ENTRADA_CONFIRMAR_TROCA = z.object({ tokenResumo: resumo64, agora: z.string().datetime() }).strict();
const ENTRADA_NOTIFICAR = z
  .object({
    aviso: z.number().int().positive(),
    acesso: z.number().int().positive(),
    envio: z.enum(['simulador', 'halai', 'desligado']),
    motivo: z.string().max(500).nullable(),
  })
  .strict();

const n = (v: unknown) => Number(v ?? 0);
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const instante = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 19) : v ? String(v).replace(' ', 'T').slice(0, 19) : null;
const semPorcento = (t: string) => t.replace(/[\\%_]/g, (x) => `\\${x}`);

const SQL_NOME = `COALESCE(NULLIF(p.nome_exibicao, ''), pf.nome)`;

export class PortaPortalMedicoPropria implements PortaPortalMedico {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(private readonly nucleo: NucleoPortalMedico) {
    this.executor = nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoNucleo, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: c.cliente, correlacao: c.correlacao || 'portal-medico' }, fn);
  }

  // ── Gravações ─────────────────────────────────────────────────────────────────────────────────────────────────
  // Uma operação do Executor por gravação (portal-medico.vincular, .desvincular, .ato-conta), com o esquema Zod da
  // entrada de negócio: o hash da idempotência cobre os dados (a mesma chave com outro corpo é 'idempotencia-divergente')
  // e a chave é a Idempotency-Key da requisição, quando veio (ContextoPortalMedico.chaveIdempotencia).

  private async operar<E extends object, S extends ResultadoOperacao>(
    c: ContextoPortalMedico,
    nome: string,
    esquema: z.ZodType<E>,
    entrada: E,
    trilha: TrilhaPortalMedico | null,
    fn: (tx: TxOperacao, e: E, extras: { motivo: string | null }) => Promise<S>,
  ): Promise<S> {
    const extras: { motivo: string | null } = { motivo: null };
    const linha = trilha ? trilhaDoNucleo(c, trilha) : null;
    const idDaEntrada = (e: E): number | null => {
      const v = (e as Record<string, unknown>)['acesso'];
      return typeof v === 'number' ? v : null;
    };
    const op = definirOperacao<E, S>({
      nome,
      tabelas: TABELAS_GRAVACAO,
      entrada: esquema,
      acao: linha?.acao === 'consulta' ? 'consulta' : 'alteracao',
      gravar: (tx, e) => fn(tx, e, extras),
      alvo: (e) => ({ tabela: linha?.entidade ?? TABELA_CONTA, id: linha?.entidadeId ?? idDaEntrada(e) }),
      trilha: () => ({ dados: linha?.dadosDepois ?? null, motivo: extras.motivo }),
    });
    const r = await this.executor.executar(op, c.cliente, entrada, {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao || 'portal-medico',
      chaveIdempotencia: c.chaveIdempotencia || randomUUID(),
    });
    return r.resultado;
  }

  /** A conta relida sob trava (a recusa sem a conta). */
  private async contaTravada(tx: TxOperacao, acesso: number): Promise<Linha> {
    const [l] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, profissional_id, pessoa_fisica_id, autorizada_em
         FROM conta_portal_profissional_externo WHERE id = ? AND excluido_em IS NULL`,
      [acesso],
    );
    if (!l) throw recusa('conta-inexistente', 'A conta do portal não existe.');
    return l;
  }

  private gravador(c: ContextoPortalMedico, trilha: () => TrilhaPortalMedico | null): GravadorPortalMedico {
    return {
      vincular: async (x) => {
        await this.operar(
          c,
          'portal-medico.vincular',
          ENTRADA_VINCULAR,
          { acesso: x.acesso, profissional: x.profissional },
          trilha(),
          async (tx, e) => {
            const conta = await this.contaTravada(tx, e.acesso);
            if (String(conta['situacao']) !== 'ativa')
              throw recusa('conta-inativa', 'A conta do portal não está ativa.');
            const prof = await tx.uma(
              `SELECT p.pessoa_fisica_id FROM profissional p
                WHERE p.id = ? AND p.excluido_em IS NULL
                  AND EXISTS (SELECT 1 FROM inscricao_conselho ic WHERE ic.profissional_id = p.id
                              AND ic.excluido_em IS NULL AND ic.situacao IN ('ativa', 'provisoria'))`,
              [e.profissional],
            );
            if (!prof)
              throw recusa('profissional-sem-registro', 'O profissional não tem registro no corpo clínico.', {
                campos: ['profissional'],
              });
            // Só a conta vigente prende o profissional: autorizada, não encerrada e não excluída. A conta desligada ou
            // encerrada (fato histórico, não se exclui) guarda o profissional, mas não impede ligá-lo a outra conta.
            const outra = await tx.uma(
              `SELECT id FROM conta_portal_profissional_externo
                WHERE profissional_id = ? AND id <> ? AND excluido_em IS NULL
                  AND situacao IN ('ativa', 'bloqueada', 'suspensa') AND autorizada_em IS NOT NULL`,
              [e.profissional, e.acesso],
            );
            if (outra) throw emOutraConta();
            try {
              // A pessoa da conta é a do médico dono dela: acompanha o profissional confirmado pelo hospital (quem
              // autorizou fica em autorizada_por_usuario_id).
              await tx.alterar(TABELA_CONTA, e.acesso, n(conta['versao']), {
                profissional_id: e.profissional,
                pessoa_fisica_id: n(prof['pessoa_fisica_id']),
                autorizada_por_usuario_id: c.usuario,
                autorizada_em: new Date(),
              });
            } catch (erro) {
              const unica = restricaoUnicaViolada(erro);
              // A chave única cobre só a conta vigente: a desligada ou a encerrada não impede religar.
              if (unica && /vigente/i.test(unica)) throw emOutraConta();
              throw erro;
            }
            return {};
          },
        );
      },
      desvincular: async (x) => {
        await this.operar(
          c,
          'portal-medico.desvincular',
          ENTRADA_DESVINCULAR,
          { acesso: x.acesso },
          trilha(),
          async (tx, e) => {
            const conta = await this.contaTravada(tx, e.acesso);
            if (conta['autorizada_em'] === null || conta['autorizada_em'] === undefined)
              throw recusa('sem-vinculo', 'A conta do portal não está ligada a um profissional.');
            // O profissional fica na linha (de quem a conta era); a autorização sai e a conta deixa de ser vigente.
            await tx.alterar(TABELA_CONTA, e.acesso, n(conta['versao']), {
              autorizada_por_usuario_id: null,
              autorizada_em: null,
            });
            return {};
          },
        );
      },
      atoConta: (x) =>
        this.operar(
          c,
          'portal-medico.ato-conta',
          ENTRADA_ATO,
          {
            acesso: x.acesso,
            ato: x.ato,
            motivo: x.motivo,
            pedidosPendentes: x.pedidosPendentes,
            decisaoPedidos: x.pedidosPendentes > 0 ? x.decisaoPedidos : null,
          },
          trilha(),
          async (tx, e, extras) => {
            const conta = await this.contaTravada(tx, e.acesso);
            const anterior = situacaoDaTela(String(conta['situacao']));
            if (anterior === null)
              throw recusa(
                'conta-pendente',
                'A conta ainda aguarda a conferência do hospital: confira o pedido antes.',
              );
            const situacao = conferirAtoContaMedico(anterior, { ...x, ...e });
            const agora = new Date();
            await tx.incluir('ato_conta_portal_profissional_externo', {
              conta_portal_profissional_externo_id: e.acesso,
              ato: e.ato,
              situacao_anterior: String(conta['situacao']),
              motivo: e.motivo.trim().slice(0, 250),
              pedidos_pendentes: e.pedidosPendentes,
              decisao_pedidos: e.pedidosPendentes > 0 ? e.decisaoPedidos : null,
              realizado_por_usuario_id: c.usuario,
              realizado_em: agora,
            });
            await tx.alterar(TABELA_CONTA, e.acesso, n(conta['versao']), {
              situacao: SITUACAO_DO_MODELO[situacao],
              bloqueada_ate: null,
              ...(situacao === 'encerrado' ? { encerrada_em: agora } : {}),
              ...(e.ato === 'desbloqueio' ? { tentativas_falhas: 0 } : {}),
            });
            extras.motivo = `${e.ato}: ${e.motivo.trim()}${
              e.pedidosPendentes > 0
                ? ` (pedidos pendentes: ${e.pedidosPendentes}; decisão: ${e.decisaoPedidos})`
                : ''
            }`.slice(0, 500);
            return { situacao, anterior, id: e.acesso };
          },
        ),
      trocarSenha: () => Promise.reject(pendente(OPERACOES_PENDENTES['trocarSenha']!)),
      pedirTrocaEmail: (x) =>
        this.operar(
          c,
          'portal-medico.troca-email.pedir',
          ENTRADA_PEDIR_TROCA,
          {
            acesso: x.acesso,
            emailNovo: x.emailNovo.trim(),
            tokenResumo: x.tokenResumo,
            validoAte: x.validoAte.toISOString(),
            envio: x.envio,
          },
          trilha(),
          async (tx, e) => {
            const conta = await this.contaTravada(tx, e.acesso);
            if (String(conta['situacao']) !== SITUACAO_DO_MODELO.ativo)
              throw recusa('conta-nao-ativa', 'Só a conta ativa troca o e-mail.');
            // O pedido novo cancela o pendente anterior (um pendente por conta, UNIQUE do banco).
            const agora = new Date();
            const antigos = await tx.consultarParaAtualizar(
              `SELECT id, versao FROM troca_email_conta_portal
                WHERE conta_portal_profissional_externo_id = ? AND situacao = 'pendente' AND excluido_em IS NULL`,
              [e.acesso],
            );
            for (const a of antigos)
              await tx.alterar('troca_email_conta_portal', n(a['id']), n(a['versao']), {
                situacao: 'cancelada',
                decidido_em: agora,
              });
            const id = await tx.incluir('troca_email_conta_portal', {
              conta_portal_profissional_externo_id: e.acesso,
              email_novo: e.emailNovo,
              email_novo_resumo: sha256(e.emailNovo.toLowerCase()),
              codigo_resumo: e.tokenResumo,
              valido_ate: new Date(e.validoAte),
              canal_pedido: 'portal',
              motivo: 'Troca pedida pelo médico no portal',
              envio: ENVIO_TROCA_PARA_BANCO[e.envio],
              situacao: 'pendente',
            });
            return { id };
          },
        ),
      cancelarTrocaEmail: async (troca) => {
        await this.operar(
          c,
          'portal-medico.troca-email.cancelar',
          ENTRADA_CANCELAR_TROCA,
          { troca },
          trilha(),
          async (tx, e) => {
            const [t] = await tx.consultarParaAtualizar(
              `SELECT id, versao, situacao FROM troca_email_conta_portal
                WHERE id = ? AND conta_portal_profissional_externo_id IS NOT NULL AND excluido_em IS NULL`,
              [e.troca],
            );
            if (!t || String(t['situacao']) !== 'pendente')
              throw recusa('troca-nao-pendente', 'O pedido de troca do e-mail não está mais pendente.');
            await tx.alterar('troca_email_conta_portal', e.troca, n(t['versao']), {
              situacao: 'cancelada',
              decidido_em: new Date(),
            });
            return {};
          },
        );
      },
      confirmarTrocaEmail: (x) =>
        this.operar(
          c,
          'portal-medico.troca-email.confirmar',
          ENTRADA_CONFIRMAR_TROCA,
          { tokenResumo: x.tokenResumo, agora: x.agora.toISOString() },
          trilha(),
          async (tx, e) => {
            const [t] = await tx.consultarParaAtualizar(
              `SELECT id, versao, situacao, valido_ate, email_novo, conta_portal_profissional_externo_id
                 FROM troca_email_conta_portal
                WHERE codigo_resumo = ? AND conta_portal_profissional_externo_id IS NOT NULL AND excluido_em IS NULL`,
              [e.tokenResumo],
            );
            const validoAte = t ? comoData(t['valido_ate']) : null;
            if (!t || String(t['situacao']) !== 'pendente' || !validoAte || validoAte <= new Date(e.agora))
              throw recusa('link-invalido', 'Este link de confirmação não vale mais. Peça a troca do e-mail de novo.');
            const acesso = n(t['conta_portal_profissional_externo_id']);
            const conta = await this.contaTravada(tx, acesso);
            if (String(conta['situacao']) !== SITUACAO_DO_MODELO.ativo)
              throw recusa('conta-nao-ativa', 'Só a conta ativa troca o e-mail.');
            const emailNovo = String(t['email_novo']);
            await tx.alterar(TABELA_CONTA, acesso, n(conta['versao']), { email: emailNovo });
            const id = n(t['id']);
            await tx.alterar('troca_email_conta_portal', id, n(t['versao']), {
              situacao: 'confirmada',
              decidido_em: new Date(),
            });
            return { acesso, emailNovo, id };
          },
        ),
      notificarCritico: (x) =>
        this.operar(
          c,
          'portal-medico.critico.notificar',
          ENTRADA_NOTIFICAR,
          { aviso: x.aviso, acesso: x.acesso, envio: x.envio, motivo: x.motivo?.trim() || null },
          trilha(),
          async (tx, e) => {
            if (e.envio === 'desligado' && !e.motivo)
              throw recusa('motivo-obrigatorio', 'A notificação desligada guarda o motivo.', { campos: ['motivo'] });
            const conta = await this.contaTravada(tx, e.acesso);
            const [a] = await tx.consultarParaAtualizar(
              `SELECT id, nivel_escalonamento FROM aviso_valor_critico WHERE id = ? AND excluido_em IS NULL`,
              [e.aviso],
            );
            if (!a) throw recusa('aviso-inexistente', 'O aviso de crítico não existe.');
            const ja = await tx.uma(
              `SELECT id FROM aviso_valor_critico_tentativa
                WHERE aviso_valor_critico_id = ? AND conta_portal_profissional_externo_id = ?`,
              [e.aviso, e.acesso],
            );
            if (ja) return { nova: false };
            const canal = await tx.uma('SELECT id FROM canal_notificacao WHERE codigo = ? AND ativo = TRUE', [
              CANAL_CRITICO_PORTAL_MEDICO,
            ]);
            if (!canal)
              throw recusa(
                'canal-inexistente',
                'O canal da notificação do portal do médico externo não está cadastrado neste cliente.',
              );
            const [seq] = await tx.consultar(
              'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM aviso_valor_critico_tentativa WHERE aviso_valor_critico_id = ?',
              [e.aviso],
            );
            try {
              await tx.incluir('aviso_valor_critico_tentativa', {
                aviso_valor_critico_id: e.aviso,
                operacao: 'inclusao',
                ocorrido_em: new Date(),
                usuario_id: c.usuario,
                sequencia: n(seq?.['s']),
                canal_notificacao_id: n(canal['id']),
                destinatario_profissional_id: conta['profissional_id'] ?? null,
                destinatario_descricao: `conta ${e.acesso} do portal do médico externo`,
                nivel_escalonamento: n(a['nivel_escalonamento']),
                // A mensagem deixada no portal não confirma a leitura (a ciência é registrada à parte); a desligada não
                // saiu, e o motivo fica na observação.
                resultado: e.envio === 'desligado' ? 'sem_resposta' : 'recado',
                observacao: e.motivo,
                conta_portal_profissional_externo_id: e.acesso,
                envio: ENVIO_CRITICO_PARA_BANCO[e.envio],
              });
            } catch (erro) {
              if (restricaoUnicaViolada(erro)) return { nova: false };
              throw erro;
            }
            return { nova: true };
          },
        ).then((r) => r.nova),
    };
  }

  /** Cada chamada faz uma gravação (uma operação do Executor), com a linha da trilha do serviço. */
  gravar<T>(
    c: ContextoPortalMedico,
    fn: (g: GravadorPortalMedico) => Promise<T>,
    trilha: TrilhaPortalMedico | null,
  ): Promise<T> {
    let usada = false;
    return fn(
      this.gravador(c, () => {
        if (usada) throw new Error('Uma gravação do portal do médico por chamada de gravar.');
        usada = true;
        return trilha;
      }),
    );
  }

  async registrarLeitura(c: ContextoPortalMedico, trilha: TrilhaPortalMedico): Promise<void> {
    // A leitura auditada não tem idempotência: cada leitura é uma linha nova da trilha.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- a chave sai do contexto de propósito
    const { chaveIdempotencia: _chave, ...semChave } = c;
    await this.operar(
      semChave,
      'portal-medico.leitura',
      ENTRADA_LEITURA,
      { evento: trilha.evento, operacao: trilha.operacao.slice(0, 200), alvo: trilha.idAlvo },
      trilha,
      async () => ({}),
    );
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────────

  vinculos(c: ContextoPortalMedico, acessos: readonly number[]): Promise<Map<number, VinculoMedicoExterno>> {
    if (acessos.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l) => {
      const rs = await l.consultar(
        `SELECT cp.id, cp.profissional_id, cp.autorizada_em, u.login
           FROM conta_portal_profissional_externo cp
           LEFT JOIN usuario u ON u.id = cp.autorizada_por_usuario_id
          WHERE cp.id IN (${lista(acessos.length)}) AND cp.excluido_em IS NULL`,
        [...acessos],
        { teto: acessos.length },
      );
      return new Map(
        rs.map((r) => {
          const ligada = r['autorizada_em'] !== null && r['autorizada_em'] !== undefined;
          return [
            n(r['id']),
            {
              acesso: n(r['id']),
              profissional: ligada ? n(r['profissional_id']) : null,
              vinculadoPor: r['login'] ? String(r['login']) : null,
              vinculadoEm: instante(r['autorizada_em']),
            },
          ];
        }),
      );
    });
  }

  async profissional(c: ContextoPortalMedico, id: number): Promise<ProfissionalCorpoClinico | null> {
    return (await this.profissionais(c, [id])).get(id) ?? null;
  }

  profissionais(
    c: ContextoPortalMedico,
    ids: readonly number[],
  ): Promise<Map<number, ProfissionalCorpoClinico>> {
    const unicos = [...new Set(ids)].filter((x) => Number.isInteger(x) && x > 0);
    if (unicos.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l) => {
      const ps = await l.consultar(
        `SELECT p.id, ${SQL_NOME} AS nome FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.id IN (${lista(unicos.length)}) AND p.excluido_em IS NULL`,
        unicos,
        { teto: unicos.length },
      );
      const ins = await l.consultar(
        `SELECT ic.profissional_id, ic.numero_inscricao, uf.sigla
           FROM inscricao_conselho ic JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
          WHERE ic.profissional_id IN (${lista(unicos.length)}) AND ic.excluido_em IS NULL
            AND ic.situacao IN ('ativa', 'provisoria')
          ORDER BY ic.profissional_id, ic.principal DESC, ic.sequencia`,
        unicos,
        { teto: unicos.length * 20 },
      );
      return new Map(
        ps.map((p) => {
          const id = n(p['id']);
          return [
            id,
            {
              id,
              nome: String(p['nome'] ?? ''),
              registros: ins
                .filter((r) => n(r['profissional_id']) === id)
                .map((r) => ({
                  id,
                  codigo: id,
                  uf: String(r['sigla']),
                  numero: String(r['numero_inscricao']),
                })),
              vinculoAssistencial: [id],
            },
          ];
        }),
      );
    });
  }

  donosDosCodigos(c: ContextoPortalMedico, codigos: readonly number[]): Promise<Map<number, Set<number>>> {
    const unicos = [...new Set(codigos)].filter((x) => Number.isInteger(x) && x > 0);
    if (unicos.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l) => {
      const rs = await l.consultar(
        `SELECT id FROM profissional WHERE id IN (${lista(unicos.length)}) AND excluido_em IS NULL`,
        unicos,
        { teto: unicos.length },
      );
      return new Map(rs.map((r) => [n(r['id']), new Set([n(r['id'])])]));
    });
  }

  async sugestoes(c: ContextoPortalMedico, uf: string, numero: number) {
    return (await this.sugestoesEmLote(c, [{ uf, numero }])).get(`${uf}:${numero}`) ?? [];
  }

  sugestoesEmLote(
    c: ContextoPortalMedico,
    pares: readonly { uf: string; numero: number }[],
  ): Promise<Map<string, { id: number; nome: string }[]>> {
    const validos = pares.filter(
      (x) => /^[A-Z]{2}$/.test(x.uf) && Number.isInteger(x.numero) && x.numero > 0,
    );
    const m = new Map<string, { id: number; nome: string }[]>(pares.map((x) => [`${x.uf}:${x.numero}`, []]));
    if (validos.length === 0) return Promise.resolve(m);
    return this.ler(c, async (l) => {
      const rs = await l.consultar(
        `SELECT DISTINCT uf.sigla, TRIM(LEADING '0' FROM ic.numero_inscricao) AS numero, p.id, ${SQL_NOME} AS nome
           FROM inscricao_conselho ic
           JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
           JOIN profissional p ON p.id = ic.profissional_id AND p.excluido_em IS NULL
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE ic.excluido_em IS NULL AND ic.situacao IN ('ativa', 'provisoria')
            AND (${validos.map(() => "(uf.sigla = ? AND TRIM(LEADING '0' FROM ic.numero_inscricao) = ?)").join(' OR ')})
          ORDER BY nome`,
        validos.flatMap((x) => [x.uf, String(x.numero)]),
        { teto: validos.length * 10 },
      );
      for (const r of rs) {
        const k = `${String(r['sigla'])}:${String(r['numero'])}`;
        const atual = m.get(k);
        if (atual && !atual.some((y) => y.id === n(r['id'])))
          atual.push({ id: n(r['id']), nome: String(r['nome']) });
      }
      return m;
    });
  }

  buscarProfissionais(c: ContextoPortalMedico, texto: string): Promise<{ id: number; nome: string }[]> {
    const t = texto.trim();
    if (t.length < 3) return Promise.resolve([]);
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT p.id, ${SQL_NOME} AS nome FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE p.excluido_em IS NULL AND p.situacao = 'ativo'
              AND (pf.nome LIKE ? OR p.nome_exibicao LIKE ?)
              AND EXISTS (SELECT 1 FROM inscricao_conselho ic WHERE ic.profissional_id = p.id AND ic.excluido_em IS NULL
                          AND ic.situacao IN ('ativa', 'provisoria'))
            ORDER BY nome LIMIT ${TETO_BUSCA}`,
          [`${semPorcento(t)}%`, `${semPorcento(t)}%`],
          { teto: TETO_BUSCA },
        )
      ).map((r) => ({ id: n(r['id']), nome: String(r['nome']) })),
    );
  }

  loginDoProfissional(c: ContextoPortalMedico, profissional: number): Promise<string | null> {
    return this.ler(c, async (l) => {
      const r = await l.uma(
        `SELECT u.login FROM usuario_profissional up
           JOIN usuario u ON u.id = up.usuario_id AND u.excluido_em IS NULL
          WHERE up.profissional_id = ? AND up.excluido_em IS NULL
            AND up.vigencia_inicio <= CURRENT_DATE AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURRENT_DATE)
          ORDER BY up.vigencia_inicio DESC, up.id DESC LIMIT 1`,
        [profissional],
      );
      return r ? String(r['login']) : null;
    });
  }

  atosConta(c: ContextoPortalMedico, acesso: number): Promise<AtoContaMedicoRegistrado[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT a.id, a.ato, a.situacao_anterior, a.motivo, a.pedidos_pendentes, a.decisao_pedidos, a.realizado_em,
                  u.login
             FROM ato_conta_portal_profissional_externo a
             LEFT JOIN usuario u ON u.id = a.realizado_por_usuario_id
            WHERE a.conta_portal_profissional_externo_id = ?
            ORDER BY a.realizado_em DESC, a.id DESC`,
          [acesso],
          { teto: 500 },
        )
      ).map((x) => ({
        id: n(x['id']),
        ato: ATO_DO_BANCO[String(x['ato'])] ?? (String(x['ato']) as AtoContaMedicoRegistrado['ato']),
        situacaoAnterior: situacaoDaTela(String(x['situacao_anterior'])) ?? String(x['situacao_anterior']),
        motivo: x['motivo'] === null || x['motivo'] === undefined ? null : String(x['motivo']),
        pedidosPendentes: n(x['pedidos_pendentes']),
        decisaoPedidos:
          x['decisao_pedidos'] === null || x['decisao_pedidos'] === undefined
            ? null
            : (String(x['decisao_pedidos']) as DecisaoPedidosConta),
        usuario: x['login'] === null || x['login'] === undefined ? '' : String(x['login']),
        em: instante(x['realizado_em']) ?? '',
      })),
    );
  }

  private trocaEmail(c: ContextoPortalMedico, filtro: string, p: unknown[]): Promise<TrocaEmailMedico | null> {
    return this.ler(c, async (l) => {
      const t = await l.uma<Linha>(
        `SELECT id, conta_portal_profissional_externo_id, email_novo, valido_ate, envio, situacao
           FROM troca_email_conta_portal
          WHERE ${filtro} AND conta_portal_profissional_externo_id IS NOT NULL AND excluido_em IS NULL
          ORDER BY id DESC LIMIT 1`,
        p,
      );
      if (!t) return null;
      const situacao = String(t['situacao']);
      return {
        id: n(t['id']),
        acesso: n(t['conta_portal_profissional_externo_id']),
        emailNovo: String(t['email_novo']),
        validoAte: comoData(t['valido_ate']) ?? new Date(0),
        envio: ENVIO_TROCA_DO_BANCO[String(t['envio'])] ?? 'simulador',
        // A expirada no banco é, para a tela, um pedido que não vale mais (como o cancelado).
        situacao: situacao === 'pendente' || situacao === 'confirmada' ? situacao : 'cancelada',
      };
    });
  }

  trocaEmailPendente(c: ContextoPortalMedico, acesso: number): Promise<TrocaEmailMedico | null> {
    return this.trocaEmail(c, "conta_portal_profissional_externo_id = ? AND situacao = 'pendente'", [acesso]);
  }

  trocaEmailPorToken(c: ContextoPortalMedico, tokenResumo: string): Promise<TrocaEmailMedico | null> {
    return this.trocaEmail(c, 'codigo_resumo = ?', [tokenResumo]);
  }

  notificacoesCritico(c: ContextoPortalMedico, acesso: number): Promise<NotificacaoCriticoMedico[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT aviso_valor_critico_id, envio, observacao, ocorrido_em FROM aviso_valor_critico_tentativa
            WHERE conta_portal_profissional_externo_id = ? ORDER BY ocorrido_em DESC, id DESC`,
          [acesso],
          { teto: 500 },
        )
      ).map((x) => ({
        aviso: n(x['aviso_valor_critico_id']),
        envio: ENVIO_CRITICO_DO_BANCO[String(x['envio'])] ?? 'simulador',
        motivo: x['observacao'] === null || x['observacao'] === undefined ? null : String(x['observacao']),
        em: instante(x['ocorrido_em']) ?? '',
      })),
    );
  }
}

export function portaPortalMedicoPropria(nucleo: NucleoPortalMedico): PortaPortalMedico {
  return new PortaPortalMedicoPropria(nucleo);
}

export function portaPortalMedicoIndisponivel(): PortaPortalMedico {
  return portaIndisponivel<PortaPortalMedico>(METODOS_PORTA_PORTAL_MEDICO);
}
