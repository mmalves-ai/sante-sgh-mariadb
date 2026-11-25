// Profissional provisório no banco próprio (F8, 02-CAD linha 21): quem atende antes de completar o cadastro e
// regulariza depois. Cadastro mínimo em `profissional_provisorio` (conselho, número e UF da inscrição, motivo e prazo
// curto), registros ligados em `profissional_provisorio_uso` (atendimento, paciente, agenda cirúrgica e de internação) e
// a regularização, que liga o provisório ao cadastro definitivo e transfere o profissional dos registros ligados (o
// atendimento passa a ser do definitivo, com a trilha na mesma transação). O prazo vencido é só alerta (ADR 0002): a
// lista mostra os vencidos e os que vencem logo, sem trava. Nada é apagado: regularizado e cancelado ficam.
// A regra é a do domínio (@sgh/dominio-cadastro, profissional/provisorio); aqui só leitura, conferência no banco e
// gravação pelo executor (trilha e idempotência na mesma transação).
import { randomUUID } from 'node:crypto';
import {
  type EntradaProvisorio,
  errosCancelamento,
  errosPrazo,
  errosProvisorio,
  errosRegularizacao,
  errosUso,
  estadoDoPrazo,
  type EstadoPrazo,
  normalizarNumeroConselho,
  prazoSugerido,
  type SituacaoProvisorio,
  somenteDigitos,
  type TipoUsoProvisorio,
} from '@sgh/dominio-cadastro';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from './porta.js';
import type { NucleoCadastro } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

export const PROFISSIONAL_PROVISORIO = Symbol('PROFISSIONAL_PROVISORIO');

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const data = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const hojeLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MENSAGENS: Record<string, [string, string]> = {
  'nome-curto': ['Escreva o nome com ao menos 3 letras.', 'nome'],
  'nome-longo': ['O nome tem no máximo 150 letras.', 'nome'],
  'nome-incompleto': ['Escreva o nome e o sobrenome.', 'nome'],
  'cpf-invalido': ['CPF inválido: confira os dígitos.', 'cpf'],
  'conselho-ausente': ['Escolha o conselho profissional.', 'conselho'],
  'numero-conselho-ausente': ['Informe o número da inscrição no conselho.', 'numeroConselho'],
  'numero-conselho-longo': ['O número da inscrição tem no máximo 20 caracteres.', 'numeroConselho'],
  'uf-conselho-ausente': ['Escolha a UF da inscrição no conselho.', 'ufConselho'],
  'motivo-curto': ['Escreva o motivo com ao menos 10 letras.', 'motivo'],
  'motivo-longo': ['O motivo tem no máximo 500 letras.', 'motivo'],
  'inicio-invalido': ['Informe uma data de início válida.', 'dataInicio'],
  'inicio-futuro': ['O início não pode ser depois de hoje.', 'dataInicio'],
  'inicio-antigo': ['O início vai até 30 dias para trás.', 'dataInicio'],
  'prazo-invalido': ['Informe um prazo válido.', 'prazo'],
  'prazo-antes-do-inicio': ['O prazo vem depois do início.', 'prazo'],
  'prazo-longo': ['O prazo é de no máximo 90 dias a partir do início.', 'prazo'],
  'prazo-nao-prorroga': ['O novo prazo vem depois do prazo atual.', 'prazo'],
  'tipo-uso-invalido': ['Escolha o tipo do registro.', 'tipo'],
  'provisorio-encerrado': ['O provisório já foi regularizado ou cancelado.', 'situacao'],
  'definitivo-inativo': ['O cadastro definitivo não está ativo.', 'profissional'],
  'cpf-diferente': ['O CPF do cadastro definitivo é outro.', 'profissional'],
  'inscricao-diferente': [
    'O cadastro definitivo não tem a mesma inscrição ativa no conselho (conselho, número e UF).',
    'profissional',
  ],
  'usos-pendentes': [
    'Há registros ligados ao provisório: regularize-o para o cadastro definitivo em vez de cancelar.',
    'situacao',
  ],
};
function recusarErros(erros: readonly string[]): void {
  if (!erros.length) return;
  throw recusa(erros[0]!, erros.map((e) => MENSAGENS[e]?.[0] ?? e).join(' '), {
    campos: [...new Set(erros.map((e) => MENSAGENS[e]?.[1] ?? e))],
  });
}
const naoAchado = () =>
  new ErroOperacao(
    404,
    'provisorio-inexistente',
    'Não encontrado',
    'Profissional provisório não encontrado neste estabelecimento.',
  );

const idPos = z.number().int().positive();
const esquemaEntrada = z
  .object({
    nome: z.string().max(400),
    cpf: z.string().max(20).nullable(),
    conselhoId: idPos.nullable(),
    numeroConselho: z.string().max(40).nullable(),
    ufConselhoId: idPos.nullable(),
    ocupacaoId: idPos.nullable(),
    especialidadeId: idPos.nullable(),
    telefone: z.string().max(20).nullable(),
    motivo: z.string().max(1000),
    dataInicio: z.string().max(10),
    prazo: z.string().max(10).nullable(),
    observacao: z.string().max(1000).nullable(),
  })
  .strict();
export type EntradaProvisorioTela = z.infer<typeof esquemaEntrada>;

/** Lê e trava o provisório do estabelecimento. */
async function lerProvisorio(tx: TxOperacao, id: number, est: number): Promise<Record<string, unknown>> {
  const [x] = await tx.consultarParaAtualizar(
    `SELECT id, situacao, cpf, conselho_classe_id, numero_conselho, conselho_unidade_federativa_id, data_inicio,
            prazo_regularizacao, versao
       FROM profissional_provisorio WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!x) throw naoAchado();
  return x;
}

const opCriar = (t: RegistroTrilhaTela, est: number, hoje: string) =>
  definirOperacao({
    nome: 'cadastro.profissional-provisorio.criar',
    tabelas: ['profissional_provisorio'],
    entrada: esquemaEntrada,
    acao: 'inclusao',
    async gravar(tx, e) {
      const prazo = e.prazo ?? (e.dataInicio ? prazoSugerido(e.dataInicio) : '');
      let porUf = true;
      if (e.conselhoId !== null) {
        const c = await tx.uma('SELECT inscricao_por_uf FROM conselho_classe WHERE id = ? AND ativo', [
          e.conselhoId,
        ]);
        if (!c) throw recusa('conselho-inexistente', 'Conselho não encontrado.', { campos: ['conselho'] });
        porUf = bool(c['inscricao_por_uf']);
      }
      const dom: EntradaProvisorio = {
        nome: e.nome,
        cpf: e.cpf,
        conselhoId: e.conselhoId,
        numeroConselho: e.numeroConselho,
        ufConselhoId: e.ufConselhoId,
        motivo: e.motivo,
        dataInicio: e.dataInicio,
        prazo,
      };
      recusarErros(errosProvisorio(dom, hoje, porUf));
      if (
        e.ufConselhoId !== null &&
        !(await tx.uma('SELECT id FROM unidade_federativa WHERE id = ?', [e.ufConselhoId]))
      )
        throw recusa('uf-inexistente', 'UF não encontrada.', { campos: ['ufConselho'] });
      const numero = normalizarNumeroConselho(e.numeroConselho);
      // Um provisório aberto por inscrição no estabelecimento: o segundo atendimento usa o mesmo.
      const abertos = await tx.consultarParaAtualizar(
        `SELECT id, numero_conselho, conselho_unidade_federativa_id FROM profissional_provisorio
          WHERE estabelecimento_id = ? AND conselho_classe_id = ? AND situacao IN ('provisorio','expirado')
            AND excluido_em IS NULL`,
        [est, e.conselhoId],
      );
      const dup = abertos.find(
        (a) =>
          normalizarNumeroConselho(txt(a['numero_conselho'])) === numero &&
          num(a['conselho_unidade_federativa_id']) === e.ufConselhoId,
      );
      if (dup)
        throw recusa(
          'provisorio-ja-aberto',
          'Já há um provisório aberto com esta inscrição neste estabelecimento: ligue o registro a ele.',
          { campos: ['numeroConselho'] },
        );
      const id = await tx.incluir('profissional_provisorio', {
        estabelecimento_id: est,
        nome: e.nome.trim().replace(/\s+/g, ' '),
        cpf: e.cpf && e.cpf.trim() ? somenteDigitos(e.cpf) : null,
        conselho_classe_id: e.conselhoId,
        numero_conselho: numero,
        conselho_unidade_federativa_id: e.ufConselhoId,
        ocupacao_cbo_id: e.ocupacaoId,
        especialidade_medica_id: e.especialidadeId,
        telefone: e.telefone?.trim() || null,
        motivo: e.motivo.trim(),
        data_inicio: e.dataInicio,
        prazo_regularizacao: prazo,
        situacao: 'provisorio',
        observacao: e.observacao?.trim() || null,
        origem: 'sistema',
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'profissional_provisorio', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaUso = z
  .object({
    id: idPos,
    tipo: z.enum(['atendimento', 'paciente', 'agendamento_cirurgico', 'agendamento_internacao']),
    registroId: idPos,
  })
  .strict();
export type EntradaUso = z.infer<typeof esquemaUso>;

/** Confere que o registro existe e é do estabelecimento (o paciente é da rede: só existir). */
async function conferirRegistro(tx: TxOperacao, tipo: TipoUsoProvisorio, id: number, est: number) {
  let achou: Record<string, unknown> | null;
  if (tipo === 'atendimento')
    achou = await tx.uma('SELECT id FROM atendimento WHERE id = ? AND estabelecimento_id = ?', [id, est]);
  else if (tipo === 'paciente') achou = await tx.uma('SELECT id FROM paciente WHERE id = ?', [id]);
  else if (tipo === 'agendamento_cirurgico')
    achou = await tx.uma('SELECT id FROM agendamento_cirurgico WHERE id = ? AND estabelecimento_id = ?', [
      id,
      est,
    ]);
  else
    achou = await tx.uma('SELECT id FROM agendamento_internacao WHERE id = ? AND estabelecimento_id = ?', [
      id,
      est,
    ]);
  if (!achou)
    throw recusa('registro-inexistente', 'Registro não encontrado neste estabelecimento.', {
      campos: ['registroId'],
    });
}

const COLUNA_USO: Record<TipoUsoProvisorio, string> = {
  atendimento: 'atendimento_id',
  paciente: 'paciente_id',
  agendamento_cirurgico: 'agendamento_cirurgico_id',
  agendamento_internacao: 'agendamento_internacao_id',
};

const opUso = (t: RegistroTrilhaTela, est: number) =>
  definirOperacao({
    nome: 'cadastro.profissional-provisorio.ligar',
    tabelas: ['profissional_provisorio_uso'],
    entrada: esquemaUso,
    acao: 'inclusao',
    async gravar(tx, e) {
      const p = await lerProvisorio(tx, e.id, est);
      recusarErros(errosUso(String(p['situacao']) as SituacaoProvisorio, e.tipo));
      await conferirRegistro(tx, e.tipo, e.registroId, est);
      const usos = await tx.consultar(
        `SELECT sequencia, tipo, atendimento_id, paciente_id, agendamento_cirurgico_id, agendamento_internacao_id
           FROM profissional_provisorio_uso WHERE profissional_provisorio_id = ? AND excluido_em IS NULL`,
        [e.id],
      );
      const coluna = COLUNA_USO[e.tipo];
      if (usos.some((u) => u['tipo'] === e.tipo && num(u[coluna]) === e.registroId))
        throw recusa('uso-ja-ligado', 'Este registro já está ligado ao provisório.', {
          campos: ['registroId'],
        });
      const sequencia = usos.reduce((m, u) => Math.max(m, Number(u['sequencia'])), 0) + 1;
      const id = await tx.incluir('profissional_provisorio_uso', {
        profissional_provisorio_id: e.id,
        sequencia,
        tipo: e.tipo,
        atendimento_id: e.tipo === 'atendimento' ? e.registroId : null,
        paciente_id: e.tipo === 'paciente' ? e.registroId : null,
        agendamento_cirurgico_id: e.tipo === 'agendamento_cirurgico' ? e.registroId : null,
        agendamento_internacao_id: e.tipo === 'agendamento_internacao' ? e.registroId : null,
        vigencia_inicio: e.tipo === 'paciente' ? new Date() : null,
        regularizado: false,
        origem: 'sistema',
      });
      return { id, sequencia };
    },
    alvo: (_e, r) => ({ tabela: 'profissional_provisorio_uso', id: Number(r.id) }),
    trilha: (e) => ({ dados: { ...(t.dadosDepois ?? {}), provisorio: e.id, tipo: e.tipo }, motivo: null }),
  });

const esquemaPrazo = z
  .object({ id: idPos, versao: idPos, prazo: z.string().max(10), motivo: z.string().max(500) })
  .strict();
const opProrrogar = (t: RegistroTrilhaTela, est: number) =>
  definirOperacao({
    nome: 'cadastro.profissional-provisorio.prorrogar',
    tabelas: ['profissional_provisorio'],
    entrada: esquemaPrazo,
    acao: 'alteracao',
    async gravar(tx, e) {
      const p = await lerProvisorio(tx, e.id, est);
      const erros = errosUso(String(p['situacao']) as SituacaoProvisorio, 'atendimento');
      erros.push(...errosPrazo(data(p['data_inicio']), e.prazo, data(p['prazo_regularizacao'])));
      if (e.motivo.trim().length < 10) erros.push('motivo-curto');
      recusarErros(erros);
      await tx.alterar('profissional_provisorio', e.id, e.versao, {
        prazo_regularizacao: e.prazo,
        situacao: 'provisorio',
      });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'profissional_provisorio', id: e.id }),
    trilha: (e) => ({ dados: { ...(t.dadosDepois ?? {}), prazo: e.prazo }, motivo: e.motivo.trim() }),
  });

const esquemaRegularizar = z.object({ id: idPos, versao: idPos, profissional: idPos }).strict();

/** Lê o definitivo para a regra: situação, CPF e inscrições no conselho. */
async function lerDefinitivo(l: Pick<Leitor, 'uma' | 'consultar'>, id: number) {
  const pr = await l.uma(
    `SELECT pr.situacao, pf.cpf FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
      WHERE pr.id = ? AND pr.excluido_em IS NULL`,
    [id],
  );
  if (!pr) return null;
  const ins = await l.consultar(
    `SELECT conselho_classe_id, unidade_federativa_id, numero_inscricao, situacao FROM inscricao_conselho
      WHERE profissional_id = ? AND excluido_em IS NULL`,
    [id],
  );
  return {
    situacao: String(pr['situacao']),
    cpf: txt(pr['cpf']),
    inscricoes: ins.map((i) => ({
      conselhoId: Number(i['conselho_classe_id']),
      ufId: Number(i['unidade_federativa_id']),
      numero: String(i['numero_inscricao']),
      ativa: ['ativa', 'provisoria'].includes(String(i['situacao'])),
    })),
  };
}

const opRegularizar = (t: RegistroTrilhaTela, est: number) =>
  definirOperacao({
    nome: 'cadastro.profissional-provisorio.regularizar',
    tabelas: [
      'profissional_provisorio',
      'profissional_provisorio_uso',
      'atendimento',
      'agendamento_cirurgico',
      'agendamento_internacao',
    ],
    entrada: esquemaRegularizar,
    acao: 'alteracao',
    async gravar(tx, e) {
      const p = await lerProvisorio(tx, e.id, est);
      const d = await lerDefinitivo(tx, e.profissional);
      if (!d)
        throw recusa('definitivo-inexistente', 'Cadastro definitivo não encontrado.', {
          campos: ['profissional'],
        });
      recusarErros(
        errosRegularizacao(
          {
            situacao: String(p['situacao']) as SituacaoProvisorio,
            cpf: txt(p['cpf']),
            conselhoId: num(p['conselho_classe_id']),
            numeroConselho: txt(p['numero_conselho']),
            ufConselhoId: num(p['conselho_unidade_federativa_id']),
          },
          d,
        ),
      );
      // Transfere o profissional de cada registro ligado pendente (com versão: a alteração vai à trilha do registro).
      const usos = await tx.consultarParaAtualizar(
        `SELECT id, tipo, atendimento_id, agendamento_cirurgico_id, agendamento_internacao_id, versao
           FROM profissional_provisorio_uso
          WHERE profissional_provisorio_id = ? AND NOT regularizado AND excluido_em IS NULL ORDER BY sequencia`,
        [e.id],
      );
      let transferidos = 0;
      for (const u of usos) {
        const tipo = String(u['tipo']) as TipoUsoProvisorio;
        if (tipo === 'atendimento') {
          const a = await tx.uma('SELECT versao FROM atendimento WHERE id = ?', [num(u['atendimento_id'])]);
          if (a) {
            await tx.alterar('atendimento', Number(u['atendimento_id']), Number(a['versao']), {
              profissional_id: e.profissional,
            });
            transferidos++;
          }
        } else if (tipo === 'agendamento_cirurgico') {
          const a = await tx.uma('SELECT versao FROM agendamento_cirurgico WHERE id = ?', [
            num(u['agendamento_cirurgico_id']),
          ]);
          if (a) {
            await tx.alterar(
              'agendamento_cirurgico',
              Number(u['agendamento_cirurgico_id']),
              Number(a['versao']),
              {
                cirurgiao_profissional_id: e.profissional,
              },
            );
            transferidos++;
          }
        } else if (tipo === 'agendamento_internacao') {
          const a = await tx.uma('SELECT versao FROM agendamento_internacao WHERE id = ?', [
            num(u['agendamento_internacao_id']),
          ]);
          if (a) {
            await tx.alterar(
              'agendamento_internacao',
              Number(u['agendamento_internacao_id']),
              Number(a['versao']),
              {
                medico_profissional_id: e.profissional,
              },
            );
            transferidos++;
          }
        }
        await tx.alterar('profissional_provisorio_uso', Number(u['id']), Number(u['versao']), {
          regularizado: true,
          ...(tipo === 'paciente' ? { vigencia_fim: new Date() } : {}),
        });
      }
      await tx.alterar('profissional_provisorio', e.id, e.versao, {
        situacao: 'regularizado',
        profissional_id: e.profissional,
        regularizado_em: new Date(),
      });
      return { id: e.id, usos: usos.length, transferidos };
    },
    alvo: (e) => ({ tabela: 'profissional_provisorio', id: e.id }),
    trilha: (e, r) => ({
      dados: {
        ...(t.dadosDepois ?? {}),
        profissional: e.profissional,
        usos: r.usos,
        transferidos: r.transferidos,
      },
      motivo: null,
    }),
  });

const esquemaCancelar = z.object({ id: idPos, versao: idPos, motivo: z.string().max(500) }).strict();
const opCancelar = (t: RegistroTrilhaTela, est: number) =>
  definirOperacao({
    nome: 'cadastro.profissional-provisorio.cancelar',
    tabelas: ['profissional_provisorio'],
    entrada: esquemaCancelar,
    acao: 'alteracao',
    async gravar(tx, e) {
      const p = await lerProvisorio(tx, e.id, est);
      const pend = await tx.uma(
        `SELECT COUNT(*) AS n FROM profissional_provisorio_uso
          WHERE profissional_provisorio_id = ? AND NOT regularizado AND excluido_em IS NULL`,
        [e.id],
      );
      recusarErros(
        errosCancelamento(String(p['situacao']) as SituacaoProvisorio, Number(pend?.['n'] ?? 0), e.motivo),
      );
      const obs = `Cancelado: ${e.motivo.trim()}`.slice(0, 1000);
      await tx.alterar('profissional_provisorio', e.id, e.versao, { situacao: 'cancelado', observacao: obs });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'profissional_provisorio', id: e.id }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

export interface UsoProvisorio {
  readonly id: number;
  readonly sequencia: number;
  readonly tipo: TipoUsoProvisorio;
  readonly registroId: number;
  readonly regularizado: boolean;
}

export interface CandidatoDefinitivo {
  readonly id: number;
  readonly nome: string;
  /** Por que é candidato: a mesma inscrição no conselho ou o mesmo CPF. */
  readonly por: 'inscricao' | 'cpf';
}

export interface ItemProvisorio {
  readonly id: number;
  readonly versao: number;
  readonly nome: string;
  readonly cpfInformado: boolean;
  readonly conselhoId: number | null;
  readonly conselhoSigla: string | null;
  readonly numeroConselho: string | null;
  readonly ufConselhoId: number | null;
  readonly ufSigla: string | null;
  readonly motivo: string;
  readonly dataInicio: string;
  readonly prazo: string;
  readonly situacao: SituacaoProvisorio;
  readonly estadoPrazo: EstadoPrazo;
  readonly diasParaPrazo: number;
  readonly profissionalId: number | null;
  readonly usos: number;
  readonly usosPendentes: number;
}

export interface VisaoProvisorios {
  readonly hoje: string;
  readonly prazoSugerido: string;
  readonly itens: readonly ItemProvisorio[];
  readonly resumo: { abertos: number; vencidos: number; venceLogo: number };
  readonly conselhos: readonly { id: number; sigla: string; porUf: boolean }[];
  readonly ufs: readonly { id: number; sigla: string }[];
}

export class ProfissionalProvisorioProprio {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCadastro,
    private readonly cliente: string,
    executor?: Executor,
    private readonly hoje: () => string = hojeLocal,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'provisorio' }, fn);
  }

  private async estabelecimento(c: ContextoPorta): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const r = c.hospital
      ? await this.ler(c, (l) =>
          l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
            c.hospital,
          ]),
        )
      : null;
    if (!r)
      throw new ErroOperacao(
        403,
        'sem-estabelecimento',
        'Sem estabelecimento',
        'A sessão não tem estabelecimento.',
      );
    return Number(r.id);
  }

  private async executar<E>(
    c: ContextoPorta,
    op: Parameters<Executor['executar']>[0],
    entrada: E,
    t: RegistroTrilhaTela,
    est: number,
  ): Promise<Record<string, unknown>> {
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: t.estabelecimento ?? est,
      usuario: t.usuario ?? c.usuario,
      correlacao: (t.correlacao ?? c.correlacao).slice(0, 64) || 'provisorio',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
    const x = await this.executor.executar(op, this.cliente, entrada, ctx);
    return x.resultado as Record<string, unknown>;
  }

  /** Os provisórios do estabelecimento: abertos primeiro (vencidos no topo), com o alerta do prazo. */
  async visao(c: ContextoPorta, filtro: 'abertos' | 'vencidos' | 'todos'): Promise<VisaoProvisorios> {
    const est = await this.estabelecimento(c);
    const hoje = this.hoje();
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT p.id, p.versao, p.nome, p.cpf, p.conselho_classe_id, cc.sigla AS conselho_sigla, p.numero_conselho,
                p.conselho_unidade_federativa_id, u.sigla AS uf_sigla, p.motivo, p.data_inicio, p.prazo_regularizacao,
                p.situacao, p.profissional_id,
                (SELECT COUNT(*) FROM profissional_provisorio_uso x
                  WHERE x.profissional_provisorio_id = p.id AND x.excluido_em IS NULL) AS usos,
                (SELECT COUNT(*) FROM profissional_provisorio_uso x
                  WHERE x.profissional_provisorio_id = p.id AND x.excluido_em IS NULL AND NOT x.regularizado) AS pendentes
           FROM profissional_provisorio p
           LEFT JOIN conselho_classe cc ON cc.id = p.conselho_classe_id
           LEFT JOIN unidade_federativa u ON u.id = p.conselho_unidade_federativa_id
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL
            AND (? = 'todos' OR p.situacao IN ('provisorio','expirado'))
          ORDER BY p.situacao IN ('provisorio','expirado') DESC, p.prazo_regularizacao, p.id`,
        [est, filtro],
        { teto: 1000 },
      );
      const todos: ItemProvisorio[] = linhas.map((x) => {
        const situacao = String(x['situacao']) as SituacaoProvisorio;
        const prazo = data(x['prazo_regularizacao']);
        const ep = estadoDoPrazo(situacao, prazo, hoje);
        return {
          id: Number(x['id']),
          versao: Number(x['versao']),
          nome: String(x['nome']),
          cpfInformado: txt(x['cpf']) !== null,
          conselhoId: num(x['conselho_classe_id']),
          conselhoSigla: txt(x['conselho_sigla']),
          numeroConselho: txt(x['numero_conselho']),
          ufConselhoId: num(x['conselho_unidade_federativa_id']),
          ufSigla: txt(x['uf_sigla']),
          motivo: String(x['motivo']),
          dataInicio: data(x['data_inicio']),
          prazo,
          situacao,
          estadoPrazo: ep.estado,
          diasParaPrazo: ep.dias,
          profissionalId: num(x['profissional_id']),
          usos: Number(x['usos']),
          usosPendentes: Number(x['pendentes']),
        };
      });
      const itens = filtro === 'vencidos' ? todos.filter((i) => i.estadoPrazo === 'vencido') : todos;
      const abertos = todos.filter((i) => i.estadoPrazo !== 'encerrado');
      const conselhos = (
        await l.consultar(
          'SELECT id, sigla, inscricao_por_uf FROM conselho_classe WHERE ativo ORDER BY sigla',
          [],
          {
            teto: 200,
          },
        )
      ).map((x) => ({ id: Number(x['id']), sigla: String(x['sigla']), porUf: bool(x['inscricao_por_uf']) }));
      const ufs = (
        await l.consultar('SELECT id, sigla FROM unidade_federativa ORDER BY sigla', [], { teto: 100 })
      ).map((x) => ({ id: Number(x['id']), sigla: String(x['sigla']) }));
      return {
        hoje,
        prazoSugerido: prazoSugerido(hoje),
        itens,
        resumo: {
          abertos: abertos.length,
          vencidos: abertos.filter((i) => i.estadoPrazo === 'vencido').length,
          venceLogo: abertos.filter((i) => i.estadoPrazo === 'vence_logo').length,
        },
        conselhos,
        ufs,
      };
    });
  }

  /** Os registros ligados e os candidatos a cadastro definitivo (mesma inscrição ou mesmo CPF), para regularizar. */
  async detalhe(
    c: ContextoPorta,
    id: number,
  ): Promise<{ usos: UsoProvisorio[]; candidatos: CandidatoDefinitivo[] }> {
    const est = await this.estabelecimento(c);
    return this.ler(c, async (l) => {
      const p = await l.uma(
        `SELECT cpf, conselho_classe_id, numero_conselho, conselho_unidade_federativa_id FROM profissional_provisorio
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [id, est],
      );
      if (!p) throw naoAchado();
      const usos = (
        await l.consultar(
          `SELECT id, sequencia, tipo, atendimento_id, paciente_id, agendamento_cirurgico_id, agendamento_internacao_id,
                  regularizado
             FROM profissional_provisorio_uso WHERE profissional_provisorio_id = ? AND excluido_em IS NULL
            ORDER BY sequencia`,
          [id],
          { teto: 2000 },
        )
      ).map((u) => {
        const tipo = String(u['tipo']) as TipoUsoProvisorio;
        return {
          id: Number(u['id']),
          sequencia: Number(u['sequencia']),
          tipo,
          registroId: Number(u[COLUNA_USO[tipo]]),
          regularizado: bool(u['regularizado']),
        };
      });
      const numero = normalizarNumeroConselho(txt(p['numero_conselho']));
      const porInscricao = await l.consultar(
        `SELECT DISTINCT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome, i.numero_inscricao
           FROM inscricao_conselho i
           JOIN profissional pr ON pr.id = i.profissional_id AND pr.excluido_em IS NULL AND pr.situacao = 'ativo'
           JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE i.conselho_classe_id = ? AND i.unidade_federativa_id <=> COALESCE(?, i.unidade_federativa_id)
            AND i.excluido_em IS NULL AND i.situacao IN ('ativa','provisoria')
            AND TRIM(LEADING '0' FROM i.numero_inscricao) LIKE ?`,
        [num(p['conselho_classe_id']), num(p['conselho_unidade_federativa_id']), `%${numero}%`],
        { teto: 20 },
      );
      const candidatos: CandidatoDefinitivo[] = porInscricao
        .filter((x) => normalizarNumeroConselho(String(x['numero_inscricao'])) === numero)
        .map((x) => ({ id: Number(x['id']), nome: String(x['nome']), por: 'inscricao' as const }));
      const cpf = txt(p['cpf']);
      if (cpf) {
        const porCpf = await l.consultar(
          `SELECT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome FROM profissional pr
             JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE pf.cpf = ? AND pr.excluido_em IS NULL AND pr.situacao = 'ativo'`,
          [cpf],
          { teto: 5 },
        );
        for (const x of porCpf)
          if (!candidatos.some((k) => k.id === Number(x['id'])))
            candidatos.push({ id: Number(x['id']), nome: String(x['nome']), por: 'cpf' });
      }
      return { usos, candidatos };
    });
  }

  async criar(c: ContextoPorta, e: EntradaProvisorioTela, t: RegistroTrilhaTela): Promise<number> {
    const est = await this.estabelecimento(c);
    return Number((await this.executar(c, opCriar(t, est, this.hoje()), e, t, est))['id']);
  }
  async ligar(c: ContextoPorta, e: EntradaUso, t: RegistroTrilhaTela): Promise<number> {
    const est = await this.estabelecimento(c);
    return Number((await this.executar(c, opUso(t, est), e, t, est))['id']);
  }
  async prorrogar(
    c: ContextoPorta,
    e: { id: number; versao: number; prazo: string; motivo: string },
    t: RegistroTrilhaTela,
  ): Promise<number> {
    const est = await this.estabelecimento(c);
    return Number((await this.executar(c, opProrrogar(t, est), e, t, est))['id']);
  }
  async regularizar(
    c: ContextoPorta,
    e: { id: number; versao: number; profissional: number },
    t: RegistroTrilhaTela,
  ): Promise<{ id: number; usos: number; transferidos: number }> {
    const est = await this.estabelecimento(c);
    const r = await this.executar(c, opRegularizar(t, est), e, t, est);
    return { id: Number(r['id']), usos: Number(r['usos']), transferidos: Number(r['transferidos']) };
  }
  async cancelar(
    c: ContextoPorta,
    e: { id: number; versao: number; motivo: string },
    t: RegistroTrilhaTela,
  ): Promise<number> {
    const est = await this.estabelecimento(c);
    return Number((await this.executar(c, opCancelar(t, est), e, t, est))['id']);
  }
}
