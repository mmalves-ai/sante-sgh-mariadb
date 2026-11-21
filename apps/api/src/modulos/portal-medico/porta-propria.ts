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
// Pendências (nada em silêncio; a tela recebe 409 modelo-pendente com o motivo; pedido de DDL na saída do lote 04-02):
// OPERACOES_PENDENTES abaixo.
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
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoPortalMedico,
  type GravadorPortalMedico,
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
const TABELAS_GRAVACAO = [TABELA_CONTA] as const;
const TETO_BUSCA = 20;

/** Operações que o modelo ainda não atende, com o que falta (pedido de DDL do lote 04-02). */
export const OPERACOES_PENDENTES: Readonly<Record<string, string>> = {
  atosConta:
    'o histórico dos atos da conta do médico externo (a tabela do histórico ainda não existe no modelo)',
  trocarSenha:
    'a troca de senha da conta do médico externo (a senha fica no provedor de identidade, ainda não ligado)',
  trocaEmail:
    'a troca do e-mail da conta do médico externo (a tabela do pedido de troca ainda não existe no modelo)',
  religar:
    'religar o profissional a outra conta depois de desligar ou encerrar a antiga (a chave única do profissional ainda cobre a conta não vigente)',
  notificacoesCritico:
    'a notificação do resultado crítico ao médico externo (a notificação por conta do portal ainda não existe no modelo)',
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
              if (unica && /vigente/i.test(unica)) throw emOutraConta();
              // A chave única do modelo atual cobre o profissional de qualquer conta (também a desligada ou a
              // encerrada): religar fica indisponível até o DDL da chave do profissional vigente (pedido do 04-02).
              if (unica && /profissional/i.test(unica)) throw pendente(OPERACOES_PENDENTES['religar']!);
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
      pedirTrocaEmail: () => Promise.reject(pendente(OPERACOES_PENDENTES['trocaEmail']!)),
      cancelarTrocaEmail: () => Promise.reject(pendente(OPERACOES_PENDENTES['trocaEmail']!)),
      confirmarTrocaEmail: () => Promise.reject(pendente(OPERACOES_PENDENTES['trocaEmail']!)),
      notificarCritico: () => Promise.reject(pendente(OPERACOES_PENDENTES['notificacoesCritico']!)),
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

  atosConta(): Promise<never> {
    return Promise.reject(pendente(OPERACOES_PENDENTES['atosConta']!));
  }

  trocaEmailPendente(): Promise<never> {
    return Promise.reject(pendente(OPERACOES_PENDENTES['trocaEmail']!));
  }

  trocaEmailPorToken(): Promise<never> {
    return Promise.reject(pendente(OPERACOES_PENDENTES['trocaEmail']!));
  }

  notificacoesCritico(): Promise<never> {
    return Promise.reject(pendente(OPERACOES_PENDENTES['notificacoesCritico']!));
  }
}

export function portaPortalMedicoPropria(nucleo: NucleoPortalMedico): PortaPortalMedico {
  return new PortaPortalMedicoPropria(nucleo);
}

export function portaPortalMedicoIndisponivel(): PortaPortalMedico {
  return portaIndisponivel<PortaPortalMedico>(METODOS_PORTA_PORTAL_MEDICO);
}
