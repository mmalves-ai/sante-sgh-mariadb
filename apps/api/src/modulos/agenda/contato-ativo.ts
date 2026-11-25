// Contato ativo com o paciente antes da consulta (02-REC linha 39) sobre contato_ativo e resultado_contato: a fila da
// central (marcações próximas que aguardam confirmação, com a resposta negativa à mensagem em destaque, e os contatos
// programados), o histórico por paciente e as gravações pelo executor (trilha na mesma transação):
//   - registrar a tentativa (ligação, mensagem, e-mail) com o resultado padronizado; o resultado que confirma deixa a
//     marcação confirmada (confirmacao_marcacao), o da desistência cancela com o motivo "desistência do paciente" e
//     libera a vaga (cancelamento_marcacao, horário livre), e o sem sucesso programa a próxima tentativa até o limite;
//   - programar um contato e cancelar um programado (nunca apaga: situação "cancelado");
//   - quando a marcação deixa de aguardar confirmação no registro, os demais pendentes dela são encerrados com o motivo;
//     os pendentes que ficaram órfãos por outro caminho (confirmação pela mensagem, cancelamento ou falta na agenda)
//     aparecem entre os programados, marcados como de consulta encerrada, para a central cancelar;
//   - ao liberar a vaga pela desistência, devolve quantos pedidos da lista de espera servem ao horário (mesma agenda ou
//     especialidade da agenda), para a central ofertar pela lista de espera.
// A resposta "não" à mensagem não cancela sozinha: divergência registrada no domínio (RESPOSTA_NEGATIVA_CANCELA_SOZINHA).
// A regra é do domínio (@sgh/dominio-agenda: decidirContato, ordemFilaContato, validarProgramacaoContato).
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  CANAIS_CONTATO,
  conferirPendenteDoContato,
  decidirContato,
  encerrarPendentesDaMarcacao,
  type EfeitoResultadoContato,
  MOTIVOS_CONTATO,
  ordemFilaContato,
  validarProgramacaoContato,
} from '@sgh/dominio-agenda';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { NucleoAgenda } from './porta-propria.js';

const num = (v: unknown): number => Number(v);
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txtOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown) => Boolean(Number(v));
const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();
const textoOuNulo = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((s) => (s ? s : null));
const instante = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Data e hora inválidas.');

export const esquemaRegistrarContato = z
  .object({
    paciente: z.number().int().positive(),
    marcacao: z.number().int().positive().nullable().default(null),
    pendente: z.number().int().positive().nullable().default(null),
    canal: z.enum(CANAIS_CONTATO),
    motivo: z.enum(MOTIVOS_CONTATO),
    resultado: z.string().trim().min(1).max(30),
    contatoEm: instante,
    informante: textoOuNulo(150),
    descricao: textoOuNulo(2000),
  })
  .strict();
export type EntradaRegistrarContato = z.infer<typeof esquemaRegistrarContato>;

export const esquemaProgramarContato = z
  .object({
    paciente: z.number().int().positive(),
    marcacao: z.number().int().positive().nullable().default(null),
    canal: z.enum(CANAIS_CONTATO),
    motivo: z.enum(MOTIVOS_CONTATO),
    programadoPara: instante,
    assunto: textoOuNulo(500),
  })
  .strict();
export type EntradaProgramarContato = z.infer<typeof esquemaProgramarContato>;

export const esquemaCancelarContato = z
  .object({ id: z.number().int().positive(), motivo: z.string().trim().min(3).max(500) })
  .strict();
export type EntradaCancelarContato = z.infer<typeof esquemaCancelarContato>;

export interface ResultadoContatoLido {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly sucesso: boolean;
  readonly encerraTentativas: boolean;
  readonly efeitoMarcacao: EfeitoResultadoContato | null;
}

export interface ItemFilaLido {
  readonly marcacao: number;
  readonly paciente: number;
  readonly nome: string;
  readonly prontuario: number | null;
  readonly telefone: string | null;
  readonly agenda: string;
  readonly inicioEm: string;
  readonly respostaNegativa: boolean;
  readonly tentativas: number;
  readonly contatoPendente: number | null;
  readonly programadoPara: string | null;
}

export interface ContatoLido {
  readonly id: number;
  readonly paciente: number;
  readonly nome: string;
  readonly marcacao: number | null;
  readonly canal: string;
  readonly motivo: string;
  readonly situacao: string;
  readonly resultado: string | null;
  readonly programadoPara: string | null;
  readonly contatoEm: string | null;
  readonly informante: string | null;
  readonly descricao: string | null;
  readonly anterior: number | null;
  /** Pendente de uma consulta que já não aguarda confirmação ou já passou (órfão: a central cancela). */
  readonly marcacaoEncerrada: boolean;
}

export interface ContextoContato {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoContato = ContextoContato & {
  correlacao: string;
  chaveIdempotencia: string;
  enderecoIp?: string;
  /** A sessão tem a permissão de cancelar consulta (o resultado de desistência cancela). */
  podeCancelar: boolean;
};

const COLUNAS_CONTATO = `c.id, c.paciente_id, pf.nome, c.marcacao_horario_id, c.canal, c.motivo, c.situacao,
  r.descricao AS resultado, c.programado_para, c.contato_em, c.informante, c.descricao, c.anterior_contato_ativo_id,
  (c.marcacao_horario_id IS NOT NULL AND (sm.significado <> 'aguardando' OR hm.inicio_em <= ?)) AS marcacao_encerrada`;
/** Junções da marcação do contato (para saber se o pendente ficou órfão). */
const JUNCAO_MARCACAO = `LEFT JOIN marcacao_horario mm ON mm.id = c.marcacao_horario_id
             LEFT JOIN situacao_marcacao sm ON sm.id = mm.situacao_marcacao_id
             LEFT JOIN horario_agenda hm ON hm.id = mm.horario_agenda_id`;
const contatoDe = (x: Linha): ContatoLido => ({
  id: num(x['id']),
  paciente: num(x['paciente_id']),
  nome: String(x['nome'] ?? ''),
  marcacao: numOuNulo(x['marcacao_horario_id']),
  canal: String(x['canal']),
  motivo: String(x['motivo']),
  situacao: String(x['situacao']),
  resultado: txtOuNulo(x['resultado']),
  programadoPara: iso(x['programado_para']),
  contatoEm: iso(x['contato_em']),
  informante: txtOuNulo(x['informante']),
  descricao: txtOuNulo(x['descricao']),
  anterior: numOuNulo(x['anterior_contato_ativo_id']),
  marcacaoEncerrada: bool(x['marcacao_encerrada']),
});

/** O estabelecimento da sessão que grava (o executor já recusa a escrita sem ele; aqui o tipo fica explícito). */
function estabelecimentoDaGravacao(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}

export class ContatoAtivoPropria {
  private readonly executor: Executor;
  private readonly sessao = new AsyncLocalStorage<{ podeCancelar: boolean }>();
  private readonly registrarOp = definirOperacao<
    EntradaRegistrarContato,
    // Os alertas vão numa linha cada (o resultado guardado pela idempotência só tem valores simples).
    {
      contato: number;
      efeito: string | null;
      novaTentativa: number | null;
      alertas: string;
      /** Pendentes da mesma marcação encerrados no registro. */
      pendentesEncerrados: number;
      /** Vaga liberada pela desistência: pedidos da lista de espera que servem ao horário; nulo sem vaga liberada. */
      esperaCompativel: number | null;
    }
  >({
    nome: 'agenda.contato_ativo_registrar',
    tabelas: [
      'contato_ativo',
      'marcacao_horario',
      'confirmacao_marcacao',
      'cancelamento_marcacao',
      'horario_agenda',
      'lista_espera',
      'agenda_especialidade',
    ],
    entrada: esquemaRegistrarContato as unknown as z.ZodType<EntradaRegistrarContato>,
    gravar: (tx, e, ctx) => this.gravarRegistro(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'contato_ativo', id: r.contato }),
  });
  private readonly programarOp = definirOperacao<EntradaProgramarContato, { contato: number }>({
    nome: 'agenda.contato_ativo_programar',
    tabelas: ['contato_ativo', 'marcacao_horario'],
    entrada: esquemaProgramarContato as unknown as z.ZodType<EntradaProgramarContato>,
    gravar: (tx, e, ctx) => this.gravarProgramacao(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'contato_ativo', id: r.contato }),
  });
  private readonly cancelarOp = definirOperacao<EntradaCancelarContato, { contato: number }>({
    nome: 'agenda.contato_ativo_cancelar',
    tabelas: ['contato_ativo'],
    entrada: esquemaCancelarContato as unknown as z.ZodType<EntradaCancelarContato>,
    gravar: (tx, e, ctx) => this.gravarCancelamento(tx, e, ctx),
    alvo: (e) => ({ tabela: 'contato_ativo', id: e.id }),
  });

  constructor(
    private readonly nucleo: NucleoAgenda,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private async quem(c: ContextoContato): Promise<{ estabelecimento: number; usuario: number | null }> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'contato-ativo' }, async (l) => {
      const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        c.hospital,
      ]);
      if (!e)
        throw new ErroOperacao(
          403,
          'estabelecimento-desconhecido',
          'Estabelecimento',
          'O estabelecimento da sessão não existe no cliente.',
        );
      const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
      return { estabelecimento: num(e['id']), usuario: u ? num(u['id']) : null };
    });
  }

  private ler<T>(c: ContextoContato, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.quem(c).then((q) =>
      this.nucleo.lerSomente(
        { cliente: this.cliente, correlacao: 'contato-ativo', estabelecimento: q.estabelecimento },
        (l) => fn(l, q.estabelecimento),
      ),
    );
  }

  private async contexto(c: ContextoGravacaoContato): Promise<ContextoOperacao> {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa('usuario-sem-conta', 'Registrar o contato exige uma conta de usuário do cliente.');
    return {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
  }

  /** Resultados padronizados ativos (os combos da tela). */
  resultados(c: ContextoContato): Promise<ResultadoContatoLido[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT id, codigo, descricao, sucesso, encerra_tentativas, efeito_marcacao
             FROM resultado_contato WHERE ativo ORDER BY sucesso DESC, descricao`,
        )
      ).map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo']),
        descricao: String(x['descricao']),
        sucesso: bool(x['sucesso']),
        encerraTentativas: bool(x['encerra_tentativas']),
        efeitoMarcacao: (txtOuNulo(x['efeito_marcacao']) as EfeitoResultadoContato | null) ?? null,
      })),
    );
  }

  /**
   * A fila da central: as marcações da unidade nos próximos `dias` que aguardam confirmação, com o telefone principal,
   * as tentativas já feitas, o contato programado e a resposta negativa à confirmação (mensagem ou contato) em
   * destaque; e os contatos programados fora de marcação. Na ordem do domínio.
   */
  fila(c: ContextoContato, dias = 3): Promise<{ itens: ItemFilaLido[]; programados: ContatoLido[] }> {
    const agora = this.agora();
    const ate = new Date(agora.getTime() + Math.min(Math.max(dias, 1), 15) * 86_400_000);
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT m.id, m.paciente_id, pf.nome, p.numero_prontuario, a.nome AS agenda, h.inicio_em,
                (SELECT CONCAT(t.ddd, t.numero) FROM telefone_pessoa t
                  WHERE t.pessoa_fisica_id = pf.id AND t.excluido_em IS NULL
                  ORDER BY t.principal DESC, t.sequencia LIMIT 1) AS telefone,
                (SELECT sc.significado FROM confirmacao_marcacao cm
                   JOIN situacao_confirmacao sc ON sc.id = cm.situacao_confirmacao_id
                  WHERE cm.marcacao_horario_id = m.id ORDER BY cm.tentativa DESC, cm.id DESC LIMIT 1) AS ultima_resposta,
                (SELECT COUNT(*) FROM contato_ativo ca
                  WHERE ca.marcacao_horario_id = m.id AND ca.situacao IN ('realizado','sem_sucesso')
                    AND ca.excluido_em IS NULL) AS tentativas,
                (SELECT ca.id FROM contato_ativo ca
                  WHERE ca.marcacao_horario_id = m.id AND ca.situacao = 'pendente' AND ca.excluido_em IS NULL
                  ORDER BY ca.programado_para LIMIT 1) AS pendente,
                (SELECT MIN(ca.programado_para) FROM contato_ativo ca
                  WHERE ca.marcacao_horario_id = m.id AND ca.situacao = 'pendente' AND ca.excluido_em IS NULL)
                  AS programado_para
           FROM marcacao_horario m
           JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
           JOIN horario_agenda h ON h.id = m.horario_agenda_id
           JOIN agenda_servico a ON a.id = h.agenda_servico_id
           JOIN paciente p ON p.id = m.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND s.significado = 'aguardando'
            AND h.inicio_em > ? AND h.inicio_em <= ?
          ORDER BY h.inicio_em LIMIT 500`,
        [est, agora, ate],
      );
      const itens: ItemFilaLido[] = linhas.map((x) => ({
        marcacao: num(x['id']),
        paciente: num(x['paciente_id']),
        nome: String(x['nome'] ?? ''),
        prontuario: numOuNulo(x['numero_prontuario']),
        telefone: txtOuNulo(x['telefone']),
        agenda: String(x['agenda'] ?? ''),
        inicioEm: iso(x['inicio_em'])!,
        respostaNegativa: x['ultima_resposta'] === 'recusada',
        tentativas: num(x['tentativas']),
        contatoPendente: numOuNulo(x['pendente']),
        programadoPara: iso(x['programado_para']),
      }));
      itens.sort((a, b) =>
        ordemFilaContato(
          {
            inicioEm: new Date(a.inicioEm),
            respostaNegativa: a.respostaNegativa,
            contatoDevido: a.programadoPara !== null && Date.parse(a.programadoPara) <= agora.getTime(),
            tentativas: a.tentativas,
          },
          {
            inicioEm: new Date(b.inicioEm),
            respostaNegativa: b.respostaNegativa,
            contatoDevido: b.programadoPara !== null && Date.parse(b.programadoPara) <= agora.getTime(),
            tentativas: b.tentativas,
          },
        ),
      );
      const programados = (
        await l.consultar(
          `SELECT ${COLUNAS_CONTATO}
             FROM contato_ativo c
             JOIN paciente p ON p.id = c.paciente_id
             JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
             LEFT JOIN resultado_contato r ON r.id = c.resultado_contato_id
             ${JUNCAO_MARCACAO}
            WHERE c.estabelecimento_id = ? AND c.situacao = 'pendente' AND c.excluido_em IS NULL
              AND (c.programado_para IS NULL OR c.programado_para <= ?)
              AND (c.marcacao_horario_id IS NULL OR sm.significado <> 'aguardando' OR hm.inicio_em <= ?)
            ORDER BY c.programado_para LIMIT 200`,
          [agora, est, ate, agora],
        )
      ).map(contatoDe);
      return { itens, programados };
    });
  }

  /** Visão por paciente: todos os contatos (feitos, sem sucesso, programados e cancelados), do mais recente. */
  historico(c: ContextoContato, paciente: number): Promise<ContatoLido[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT ${COLUNAS_CONTATO}
             FROM contato_ativo c
             JOIN paciente p ON p.id = c.paciente_id
             JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
             LEFT JOIN resultado_contato r ON r.id = c.resultado_contato_id
             ${JUNCAO_MARCACAO}
            WHERE c.estabelecimento_id = ? AND c.paciente_id = ? AND c.excluido_em IS NULL
            ORDER BY COALESCE(c.contato_em, c.programado_para, c.criado_em) DESC, c.id DESC LIMIT 300`,
          [this.agora(), est, paciente],
        )
      ).map(contatoDe),
    );
  }

  async registrar(c: ContextoGravacaoContato, entrada: unknown) {
    const ctx = await this.contexto(c);
    const r = await this.sessao.run({ podeCancelar: c.podeCancelar }, () =>
      this.executor.executar(this.registrarOp, this.cliente, entrada, ctx),
    );
    const alertas = r.resultado.alertas.split('\n').filter((a) => a !== '');
    return { resultado: { ...r.resultado, alertas }, repetida: r.repetida };
  }

  async programar(c: ContextoGravacaoContato, entrada: unknown) {
    const r = await this.executor.executar(this.programarOp, this.cliente, entrada, await this.contexto(c));
    return { resultado: r.resultado, repetida: r.repetida };
  }

  async cancelar(c: ContextoGravacaoContato, entrada: unknown) {
    const r = await this.executor.executar(this.cancelarOp, this.cliente, entrada, await this.contexto(c));
    return { resultado: r.resultado, repetida: r.repetida };
  }

  // ── Gravações ─────────────────────────────────────────────────────────────────────────────────────

  private async exigirPaciente(tx: TxOperacao, paciente: number): Promise<void> {
    const p = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [paciente]);
    if (!p) throw new ErroOperacao(404, 'registro-inexistente', 'Paciente', 'Paciente não encontrado.');
  }

  private async travarMarcacao(tx: TxOperacao, est: number, id: number, paciente: number): Promise<Linha> {
    const [m] = await tx.consultarParaAtualizar(
      `SELECT m.id, m.versao, m.paciente_id, m.horario_agenda_id, m.canal_marcacao_id, s.significado, h.inicio_em
         FROM marcacao_horario m
         JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
         JOIN horario_agenda h ON h.id = m.horario_agenda_id
        WHERE m.id = ? AND m.estabelecimento_id = ? AND m.excluido_em IS NULL`,
      [id, est],
      { teto: 1 },
    );
    if (!m) throw new ErroOperacao(404, 'registro-inexistente', 'Marcação', 'Marcação não encontrada.');
    if (num(m['paciente_id']) !== paciente)
      throw recusa('paciente-diferente', 'A marcação escolhida é de outro paciente.');
    return m;
  }

  private async idPor(tx: TxOperacao, sql: string, p: unknown[], falta: string): Promise<number> {
    const x = await tx.uma(sql, p);
    if (!x)
      throw new ErroOperacao(
        422,
        'configuracao-incompleta',
        'Cadastro incompleto',
        `Falta no cadastro do cliente: ${falta}. Peça ao administrador para completar os domínios da agenda.`,
      );
    return num(x['id']);
  }

  private async gravarRegistro(tx: TxOperacao, e: EntradaRegistrarContato, ctx: ContextoOperacao) {
    const est = estabelecimentoDaGravacao(ctx);
    const agora = this.agora();
    await this.exigirPaciente(tx, e.paciente);
    const r = await tx.uma(
      `SELECT id, codigo, sucesso, encerra_tentativas, efeito_marcacao FROM resultado_contato
        WHERE codigo = ? AND ativo`,
      [e.resultado],
    );
    if (!r) throw recusa('resultado-invalido', 'Escolha o resultado do contato.');
    const m = e.marcacao !== null ? await this.travarMarcacao(tx, est, e.marcacao, e.paciente) : null;
    let pendente: Linha | null = null;
    if (e.pendente !== null) {
      const [p] = await tx.consultarParaAtualizar(
        `SELECT id, versao, paciente_id, marcacao_horario_id, situacao FROM contato_ativo
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [e.pendente, est],
        { teto: 1 },
      );
      if (!p)
        throw new ErroOperacao(404, 'registro-inexistente', 'Contato', 'Contato programado não encontrado.');
      if (p['situacao'] !== 'pendente')
        throw recusa('contato-ja-feito', 'Este contato programado já foi feito ou cancelado.');
      if (num(p['paciente_id']) !== e.paciente)
        throw recusa('paciente-diferente', 'O contato programado é de outro paciente.');
      const outra = conferirPendenteDoContato({
        marcacaoDoPendente: numOuNulo(p['marcacao_horario_id']),
        marcacaoInformada: e.marcacao,
      });
      if (outra) throw recusa('pendente-de-outra-marcacao', outra);
      pendente = p;
    }
    const tentativas = await tx.uma(
      e.marcacao !== null
        ? `SELECT COUNT(*) AS n FROM contato_ativo WHERE marcacao_horario_id = ? AND estabelecimento_id = ?
             AND situacao IN ('realizado','sem_sucesso') AND excluido_em IS NULL`
        : `SELECT COUNT(*) AS n FROM contato_ativo WHERE paciente_id = ? AND estabelecimento_id = ? AND motivo = ?
             AND marcacao_horario_id IS NULL AND situacao IN ('realizado','sem_sucesso') AND excluido_em IS NULL
             AND contato_em >= ?`,
      e.marcacao !== null
        ? [e.marcacao, est]
        : [e.paciente, est, e.motivo, new Date(agora.getTime() - 7 * 86_400_000)],
    );
    const d = decidirContato({
      canal: e.canal,
      motivo: e.motivo,
      contatoEm: new Date(e.contatoEm),
      agora,
      resultado: {
        codigo: String(r['codigo']),
        sucesso: bool(r['sucesso']),
        encerraTentativas: bool(r['encerra_tentativas']),
        efeitoMarcacao: (txtOuNulo(r['efeito_marcacao']) as EfeitoResultadoContato | null) ?? null,
      },
      marcacao: m
        ? { significado: String(m['significado']), inicioEm: new Date(m['inicio_em'] as string) }
        : null,
      tentativasAnteriores: num(tentativas?.['n'] ?? 0),
      podeCancelar: this.sessao.getStore()?.podeCancelar === true,
    });
    if (!d.ok) throw recusa(d.codigo, d.mensagem);
    const dados = {
      situacao: d.situacao,
      canal: e.canal,
      motivo: e.motivo,
      resultado_contato_id: num(r['id']),
      contato_em: new Date(e.contatoEm),
      usuario_id: ctx.usuario,
      informante: e.informante,
      descricao: e.descricao,
      marcacao_horario_id: e.marcacao,
    };
    let contato: number;
    if (pendente) {
      contato = num(pendente['id']);
      await tx.alterar('contato_ativo', contato, num(pendente['versao']), dados);
    } else {
      contato = await tx.incluir('contato_ativo', {
        estabelecimento_id: est,
        paciente_id: e.paciente,
        ...dados,
      });
    }
    if (m && d.efeito === 'confirmar') await this.confirmar(tx, ctx, m, e.canal, agora);
    let esperaCompativel: number | null = null;
    if (m && d.efeito === 'cancelar')
      esperaCompativel = await this.cancelarPorDesistencia(tx, ctx, m, e.descricao, agora);
    let pendentesEncerrados = 0;
    const motivoEncerrar = m
      ? encerrarPendentesDaMarcacao({ efeito: d.efeito, significadoAntes: String(m['significado']) })
      : null;
    if (m && motivoEncerrar) {
      const outros = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM contato_ativo
          WHERE marcacao_horario_id = ? AND estabelecimento_id = ? AND situacao = 'pendente' AND excluido_em IS NULL
            AND id <> ?`,
        [m['id'], est, contato],
        { teto: 100 },
      );
      for (const o of outros)
        await tx.alterar('contato_ativo', num(o['id']), num(o['versao']), {
          situacao: 'cancelado',
          descricao: motivoEncerrar,
          usuario_id: ctx.usuario,
        });
      pendentesEncerrados = outros.length;
    }
    let novaTentativa: number | null = null;
    if (d.novaTentativaEm)
      novaTentativa = await tx.incluir('contato_ativo', {
        estabelecimento_id: est,
        paciente_id: e.paciente,
        marcacao_horario_id: e.marcacao,
        anterior_contato_ativo_id: contato,
        canal: e.canal,
        motivo: e.motivo,
        situacao: 'pendente',
        assunto: 'Nova tentativa programada pela central',
        programado_para: d.novaTentativaEm,
      });
    return {
      contato,
      efeito: d.efeito,
      novaTentativa,
      alertas: d.alertas.join('\n'),
      pendentesEncerrados,
      esperaCompativel,
    };
  }

  private async confirmar(tx: TxOperacao, ctx: ContextoOperacao, m: Linha, canal: string, agora: Date) {
    await tx.alterar('marcacao_horario', num(m['id']), num(m['versao']), {
      situacao_marcacao_id: await this.idPor(
        tx,
        "SELECT id FROM situacao_marcacao WHERE significado = 'confirmada' AND ativo ORDER BY ordem, id LIMIT 1",
        [],
        'situação de marcação "confirmada"',
      ),
    });
    const t = await tx.uma(
      'SELECT COALESCE(MAX(tentativa), 0) + 1 AS n FROM confirmacao_marcacao WHERE marcacao_horario_id = ?',
      [m['id']],
    );
    const c = await tx.uma('SELECT id FROM canal_marcacao WHERE codigo = ? AND ativo', [canal]);
    await tx.incluir('confirmacao_marcacao', {
      estabelecimento_id: ctx.estabelecimento,
      marcacao_horario_id: m['id'],
      tentativa: num(t?.['n'] ?? 1),
      canal_marcacao_id: c ? c['id'] : m['canal_marcacao_id'],
      situacao_confirmacao_id: await this.idPor(
        tx,
        "SELECT id FROM situacao_confirmacao WHERE significado = 'confirmada' AND ativo ORDER BY ordem, id LIMIT 1",
        [],
        'situação de confirmação "confirmada"',
      ),
      automatica: false,
      solicitada_em: agora,
      respondida_em: agora,
      responsavel_usuario_id: ctx.usuario,
      observacao: 'Confirmada no contato ativo da central.',
    });
  }

  private async cancelarPorDesistencia(
    tx: TxOperacao,
    ctx: ContextoOperacao,
    m: Linha,
    complemento: string | null,
    agora: Date,
  ): Promise<number> {
    const motivo = await this.idPor(
      tx,
      "SELECT id FROM motivo_cancelamento_operacao WHERE codigo = 'desistencia_paciente' AND ativo",
      [],
      'motivo de cancelamento "desistência do paciente"',
    );
    await tx.incluir('cancelamento_marcacao', {
      estabelecimento_id: ctx.estabelecimento,
      marcacao_horario_id: m['id'],
      motivo_cancelamento_operacao_id: motivo,
      complemento: complemento ? complemento.slice(0, 300) : 'Desistência informada no contato ativo.',
      solicitante: 'paciente',
      cancelado_em: agora,
      responsavel_usuario_id: ctx.usuario,
      horario_liberado: true,
      nova_marcacao_horario_id: null,
    });
    await tx.alterar('marcacao_horario', num(m['id']), num(m['versao']), {
      situacao_marcacao_id: await this.idPor(
        tx,
        "SELECT id FROM situacao_marcacao WHERE significado = 'cancelada' AND ativo ORDER BY ordem, id LIMIT 1",
        [],
        'situação de marcação "cancelada"',
      ),
    });
    const [h] = await tx.consultarParaAtualizar(
      'SELECT id, versao, tipo_horario, vagas_ocupadas, agenda_servico_id FROM horario_agenda WHERE id = ?',
      [m['horario_agenda_id']],
      { teto: 1 },
    );
    if (!h) return 0;
    await tx.alterar('horario_agenda', num(h['id']), num(h['versao']), {
      vagas_ocupadas: Math.max(0, num(h['vagas_ocupadas']) - 1),
      situacao: h['tipo_horario'] === 'encaixe' ? 'cancelado' : 'livre',
    });
    if (h['tipo_horario'] === 'encaixe') return 0;
    // A vaga voltou à grade: os pedidos aguardando da lista de espera que servem a ela (a mesma agenda ou uma
    // especialidade da agenda), para a central ofertar pela lista de espera (a oferta confere a ordem e a prioridade).
    const n = await tx.uma(
      `SELECT COUNT(*) AS n FROM lista_espera le
        WHERE le.estabelecimento_id = ? AND le.situacao = 'aguardando' AND le.excluido_em IS NULL
          AND (le.agenda_servico_id = ? OR le.especialidade_medica_id IN (
                SELECT ae.especialidade_medica_id FROM agenda_especialidade ae
                 WHERE ae.agenda_servico_id = ? AND ae.excluido_em IS NULL))`,
      [ctx.estabelecimento, h['agenda_servico_id'], h['agenda_servico_id']],
    );
    return num(n?.['n'] ?? 0);
  }

  private async gravarProgramacao(tx: TxOperacao, e: EntradaProgramarContato, ctx: ContextoOperacao) {
    await this.exigirPaciente(tx, e.paciente);
    const m =
      e.marcacao !== null
        ? await this.travarMarcacao(tx, estabelecimentoDaGravacao(ctx), e.marcacao, e.paciente)
        : null;
    const motivo = validarProgramacaoContato({
      canal: e.canal,
      motivo: e.motivo,
      programadoPara: new Date(e.programadoPara),
      agora: this.agora(),
      marcacao: m
        ? { significado: String(m['significado']), inicioEm: new Date(m['inicio_em'] as string) }
        : null,
    });
    if (motivo) throw recusa('programacao-invalida', motivo);
    const contato = await tx.incluir('contato_ativo', {
      estabelecimento_id: ctx.estabelecimento,
      paciente_id: e.paciente,
      marcacao_horario_id: e.marcacao,
      canal: e.canal,
      motivo: e.motivo,
      situacao: 'pendente',
      assunto: e.assunto,
      programado_para: new Date(e.programadoPara),
    });
    return { contato };
  }

  private async gravarCancelamento(tx: TxOperacao, e: EntradaCancelarContato, ctx: ContextoOperacao) {
    const [p] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao FROM contato_ativo
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.id, ctx.estabelecimento],
      { teto: 1 },
    );
    if (!p)
      throw new ErroOperacao(404, 'registro-inexistente', 'Contato', 'Contato programado não encontrado.');
    if (p['situacao'] !== 'pendente')
      throw recusa('contato-ja-feito', 'Só o contato programado (pendente) pode ser cancelado.');
    await tx.alterar('contato_ativo', e.id, num(p['versao']), {
      situacao: 'cancelado',
      descricao: e.motivo,
      usuario_id: ctx.usuario,
    });
    return { contato: e.id };
  }
}
