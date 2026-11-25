// Representação do paciente no banco próprio (F3.1, 02-CAD linha 4), além da lista de responsáveis:
//   - condição de incapacidade (`incapacidade_paciente`): data de início e documento que a prova (sentença de curatela,
//     curatela provisória ou laudo médico), uma só vigente por paciente; o levantamento encerra com data e motivo, e
//     nada é apagado;
//   - comprovante (termo de guarda, tutela, curatela, sentença ou laudo) enviado pela tela: o conteúdo vai para a porta
//     de arquivos (disco local, ADR 0004) com o paciente como dono, e o vínculo ou a condição guarda o id;
//   - a situação da representação lida na transação de quem precisa dela: a ficha (pendências), a abertura do
//     atendimento (aviso, nunca bloqueio) e o consentimento (quem assina).
// A regra é do domínio (`@sgh/dominio-cadastro`, ficha-complementar/responsaveis.ts); aqui só leitura e gravação pelo
// executor (trilha e idempotência na transação). Sem gatilho.
import { randomUUID } from 'node:crypto';
import {
  type AlertaRepresentacao,
  alertasRepresentacao,
  DOCUMENTOS_INCAPACIDADE,
  errosIncapacidade,
  PAPEIS_COM_COMPROVANTE,
  PAPEIS_RESPONSAVEL,
  type PapelResponsavel,
  recusaFimIncapacidade,
  type VinculoVigente,
} from '@sgh/dominio-cadastro';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoArmazem,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { type ArquivosDoModulo, arquivosDoAmbiente } from '../arquivos-locais.js';
import type { ContextoPorta } from './porta.js';
import type { NucleoCadastro } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

export const REPRESENTACAO_PACIENTE = Symbol('REPRESENTACAO_PACIENTE');

/** Finalidade do comprovante na porta de arquivos (dono: a tabela paciente, o id dele). */
export const FINALIDADE_COMPROVANTE = 'comprovante_representacao';
/** O corpo da rota é JSON com o conteúdo em base64 (limite de 1 MB do servidor): o arquivo vai até 640 KB. */
export const TAMANHO_MAXIMO_COMPROVANTE = 640 * 1024;

const TETO = 200;
const data = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const recusaCampos = (codigo: string, detalhe: string, campos: readonly string[]): ErroOperacao =>
  recusa(codigo, detalhe, { campos: [...campos] });

/** O tipo pela assinatura do conteúdo (nunca pelo nome nem pelo tipo declarado): PDF, PNG ou JPEG; outro, null. */
export function tipoComprovante(b: Uint8Array): 'application/pdf' | 'image/png' | 'image/jpeg' | null {
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46)
    return 'application/pdf';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

// ── Situação da representação (lida na transação de quem usa) ──

export interface SituacaoRepresentacao {
  readonly nascimento: string | null;
  readonly hoje: string;
  /** A condição de incapacidade vigente (nula: o paciente não está registrado como incapaz). */
  readonly incapacidade: { readonly id: number; readonly versao: number; readonly inicio: string } | null;
  /** Vínculos vigentes hoje, na ordem de preferência (contato principal primeiro). */
  readonly vigentes: readonly VinculoVigente[];
}

const PAPEIS_SQL = PAPEIS_RESPONSAVEL.map(() => '?').join(', ');

/** A representação do paciente hoje. Paciente inexistente: recusa. */
export async function situacaoRepresentacao(
  tx: Leitor | TxOperacao,
  paciente: number,
): Promise<SituacaoRepresentacao> {
  const p = await tx.uma(
    `SELECT pf.data_nascimento, CURRENT_DATE AS hoje FROM paciente p
       JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = ? AND p.excluido_em IS NULL`,
    [paciente],
  );
  if (!p) throw recusa('paciente-inexistente', 'O paciente não existe.', { campos: ['idPaciente'] });
  const i = await tx.uma(
    `SELECT id, versao, vigencia_inicio FROM incapacidade_paciente
      WHERE paciente_id = ? AND vigencia_fim IS NULL AND excluido_em IS NULL`,
    [paciente],
  );
  const v = await tx.consultar(
    `SELECT id, papel, comprovante_arquivo_id FROM responsavel_paciente
      WHERE paciente_id = ? AND excluido_em IS NULL AND papel IN (${PAPEIS_SQL})
        AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
      ORDER BY contato_principal DESC, id`,
    [paciente, ...PAPEIS_RESPONSAVEL],
    { teto: TETO },
  );
  return {
    nascimento: data(p['data_nascimento']),
    hoje: data(p['hoje']) ?? new Date().toISOString().slice(0, 10),
    incapacidade: i
      ? { id: Number(i['id']), versao: Number(i['versao']), inicio: data(i['vigencia_inicio']) ?? '' }
      : null,
    vigentes: v.map((x) => ({
      id: Number(x['id']),
      papel: String(x['papel']),
      temComprovante: x['comprovante_arquivo_id'] !== null && x['comprovante_arquivo_id'] !== undefined,
    })),
  };
}

/** Só a existência da condição vigente (para quem já leu o resto). */
export async function incapacidadeVigente(tx: Leitor | TxOperacao, paciente: number): Promise<boolean> {
  const i = await tx.uma(
    'SELECT id FROM incapacidade_paciente WHERE paciente_id = ? AND vigencia_fim IS NULL AND excluido_em IS NULL',
    [paciente],
  );
  return i !== null && i !== undefined;
}

export const MENSAGEM_ALERTA_REPRESENTACAO: Record<AlertaRepresentacao, string> = {
  'menor-sem-representante':
    'Paciente menor de idade sem representante vigente no cadastro: inclua o responsável legal na ficha.',
  'incapaz-sem-curador':
    'Paciente com incapacidade registrada e sem curador vigente no cadastro: inclua o curador na ficha.',
};

/** O que a abertura do atendimento avisa sobre a representação do paciente (vazio: nada a avisar). */
export async function alertasRepresentacaoDoPaciente(
  tx: Leitor | TxOperacao,
  paciente: number,
): Promise<AlertaRepresentacao[]> {
  const s = await situacaoRepresentacao(tx, paciente);
  return alertasRepresentacao(s.nascimento, s.vigentes, s.hoje, s.incapacidade !== null);
}

// ── Operações ──

/** O arquivo é um comprovante enviado para este paciente (nunca um arquivo de outro dono). */
async function conferirComprovante(tx: TxOperacao, arquivo: number, paciente: number): Promise<void> {
  const a = await tx.uma(
    'SELECT finalidade, entidade, entidade_id FROM arquivo WHERE id = ? AND excluido_em IS NULL',
    [arquivo],
  );
  if (
    !a ||
    a['finalidade'] !== FINALIDADE_COMPROVANTE ||
    a['entidade'] !== 'paciente' ||
    Number(a['entidade_id']) !== paciente
  )
    throw recusaCampos(
      'arquivo-nao-e-comprovante',
      'O arquivo não foi enviado como comprovante deste paciente: envie o documento pela tela.',
      ['comprovante'],
    );
}

const esquemaIncapacidade = z
  .object({
    paciente: z.number().int().positive(),
    inicio: z.string().trim().max(10),
    documentoTipo: z.string().trim().max(30),
    documentoNumero: z.string().trim().max(60).nullable(),
    documentoData: z.string().trim().max(10).nullable(),
    comprovante: z.number().int().positive().nullable(),
    observacao: z.string().trim().max(500).nullable(),
  })
  .strict();
export type EntradaIncapacidade = z.infer<typeof esquemaIncapacidade>;

const MENSAGEM_INCAPACIDADE: Record<string, string> = {
  'incapacidade-ja-vigente':
    'O paciente já tem a incapacidade registrada e vigente: registre o levantamento antes de incluir outra.',
  inicio: 'A data de início da incapacidade não pode ser futura nem anterior ao nascimento do paciente.',
  documentoTipo: 'Escolha o documento: sentença de curatela, curatela provisória ou laudo médico.',
  documentoData: 'Informe a data do documento (não pode ser futura).',
  documentoNumero: 'Informe o número do processo da curatela.',
};

const operacaoRegistrarIncapacidade = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.registrar-incapacidade-paciente',
    tabelas: ['incapacidade_paciente'],
    entrada: esquemaIncapacidade,
    acao: 'inclusao',
    async gravar(tx, e) {
      const s = await situacaoRepresentacao(tx, e.paciente);
      const erros = errosIncapacidade(
        {
          inicio: e.inicio,
          documentoTipo: e.documentoTipo,
          documentoNumero: e.documentoNumero,
          documentoData: e.documentoData,
        },
        s.nascimento,
        s.hoje,
        s.incapacidade !== null,
      );
      if (erros.length > 0)
        throw recusaCampos(
          erros[0] === 'incapacidade-ja-vigente' ? erros[0] : 'incapacidade-invalida',
          MENSAGEM_INCAPACIDADE[erros[0]!] ?? 'Confira os dados da incapacidade.',
          erros.filter((x) => x !== 'incapacidade-ja-vigente'),
        );
      if (e.comprovante !== null) await conferirComprovante(tx, e.comprovante, e.paciente);
      const id = await tx.incluir('incapacidade_paciente', {
        paciente_id: e.paciente,
        vigencia_inicio: e.inicio,
        documento_tipo: e.documentoTipo,
        documento_numero: e.documentoNumero || null,
        documento_data: e.documentoData,
        comprovante_arquivo_id: e.comprovante,
        observacao: e.observacao || null,
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'incapacidade_paciente', id: Number(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

const esquemaLevantamento = z
  .object({
    paciente: z.number().int().positive(),
    id: z.number().int().positive(),
    fim: z.string().trim().max(10),
    motivo: z.string().trim().min(3).max(300),
  })
  .strict();
export type EntradaLevantamento = z.infer<typeof esquemaLevantamento>;

const operacaoEncerrarIncapacidade = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.encerrar-incapacidade-paciente',
    tabelas: ['incapacidade_paciente'],
    entrada: esquemaLevantamento,
    acao: 'alteracao',
    async gravar(tx, e) {
      const s = await situacaoRepresentacao(tx, e.paciente);
      if (!s.incapacidade || s.incapacidade.id !== e.id)
        throw recusaCampos('incapacidade-inexistente', 'A incapacidade não existe ou já foi levantada.', [
          'id',
        ]);
      if (recusaFimIncapacidade(s.incapacidade.inicio, e.fim, s.hoje))
        throw recusaCampos(
          'levantamento-invalido',
          'A data do levantamento não pode ser futura nem anterior ao início da incapacidade.',
          ['fim'],
        );
      await tx.alterar('incapacidade_paciente', e.id, s.incapacidade.versao, {
        vigencia_fim: e.fim,
        motivo_encerramento: e.motivo,
      });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'incapacidade_paciente', id: e.id }),
    trilha: (e) => ({ dados: trilha.dadosDepois ?? null, motivo: e.motivo }),
  });

export const ALVOS_COMPROVANTE = ['responsavel', 'incapacidade'] as const;
export type AlvoComprovante = (typeof ALVOS_COMPROVANTE)[number];

const esquemaAnexo = z
  .object({
    paciente: z.number().int().positive(),
    alvo: z.enum(ALVOS_COMPROVANTE),
    id: z.number().int().positive(),
    arquivo: z.number().int().positive(),
  })
  .strict();

const operacaoAnexarComprovante = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.anexar-comprovante-representacao',
    tabelas: ['responsavel_paciente', 'incapacidade_paciente'],
    entrada: esquemaAnexo,
    acao: 'alteracao',
    async gravar(tx, e) {
      await conferirComprovante(tx, e.arquivo, e.paciente);
      const tabela = e.alvo === 'responsavel' ? 'responsavel_paciente' : 'incapacidade_paciente';
      // Só o registro ainda em vigor recebe o comprovante (o encerrado fica como estava: é histórico).
      const linha = await tx.uma(
        `SELECT id, versao${e.alvo === 'responsavel' ? ', papel' : ''} FROM ${tabela}
          WHERE id = ? AND paciente_id = ? AND excluido_em IS NULL AND ${
            e.alvo === 'responsavel'
              ? '(vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE) AND (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)'
              : 'vigencia_fim IS NULL'
          }`,
        [e.id, e.paciente],
      );
      if (!linha)
        throw recusaCampos(
          'registro-inexistente',
          e.alvo === 'responsavel'
            ? 'O vínculo não existe ou já foi encerrado.'
            : 'A incapacidade não existe ou já foi levantada.',
          ['id'],
        );
      if (
        e.alvo === 'responsavel' &&
        !PAPEIS_COM_COMPROVANTE.includes(String(linha['papel']) as PapelResponsavel)
      )
        throw recusaCampos(
          'papel-sem-comprovante',
          'Só a guarda, a tutela e a curatela levam o comprovante.',
          ['id'],
        );
      await tx.alterar(tabela, e.id, Number(linha['versao']), { comprovante_arquivo_id: e.arquivo });
      return { id: e.id };
    },
    alvo: (e) => ({
      tabela: e.alvo === 'responsavel' ? 'responsavel_paciente' : 'incapacidade_paciente',
      id: e.id,
    }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

// ── Leitura ──

export interface IncapacidadesPaciente {
  /** O paciente está com a incapacidade vigente. */
  incapaz: boolean;
  itens: {
    id: number;
    inicio: string | null;
    fim: string | null;
    vigente: boolean;
    documentoTipo: string;
    documentoNumero: string | null;
    documentoData: string | null;
    temComprovante: boolean;
    motivoEncerramento: string | null;
    observacao: string | null;
  }[];
  /** O que a abertura do atendimento vai avisar hoje. */
  alertas: { alerta: AlertaRepresentacao; mensagem: string }[];
  documentos: readonly string[];
}

export class RepresentacaoPacientePropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCadastro,
    private readonly cliente: string,
    executor?: Executor,
    /** Porta de arquivos (disco local, ADR 0004) para o comprovante; sem ela, o envio dá 503. */
    private arquivos?: ArquivosDoModulo | null,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private arquivosDe(): ArquivosDoModulo | null {
    if (this.arquivos === undefined)
      this.arquivos =
        'cliente' in this.nucleo && 'criarExecutor' in this.nucleo
          ? arquivosDoAmbiente(this.nucleo as unknown as NucleoArmazem, this.cliente)
          : null;
    return this.arquivos;
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'cadastro' }, fn);
  }

  private async executar<E>(
    c: ContextoPorta,
    op: Parameters<Executor['executar']>[0],
    entrada: E,
    trilha: RegistroTrilhaTela,
  ): Promise<number> {
    let est = trilha.estabelecimento ?? c.estabelecimento;
    if (est === null && c.hospital) {
      const r = await this.ler(c, (l) =>
        l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
          c.hospital,
        ]),
      );
      est = r ? Number(r.id) : null;
    }
    if (est === null)
      throw new ErroOperacao(
        403,
        'sem-estabelecimento',
        'Sem estabelecimento',
        'A sessão não tem estabelecimento.',
      );
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: trilha.usuario ?? c.usuario,
      correlacao: (trilha.correlacao ?? c.correlacao).slice(0, 64) || 'cadastro',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
    const x = await this.executor.executar(op, this.cliente, entrada, ctx);
    return Number((x.resultado as { id: unknown }).id);
  }

  async incapacidades(c: ContextoPorta, paciente: number): Promise<IncapacidadesPaciente> {
    return this.ler(c, async (l) => {
      const s = await situacaoRepresentacao(l, paciente);
      const linhas = await l.consultar(
        `SELECT id, vigencia_inicio, vigencia_fim, documento_tipo, documento_numero, documento_data,
                comprovante_arquivo_id, motivo_encerramento, observacao
           FROM incapacidade_paciente WHERE paciente_id = ? AND excluido_em IS NULL
          ORDER BY vigencia_fim IS NULL DESC, vigencia_inicio DESC, id DESC`,
        [paciente],
        { teto: TETO },
      );
      return {
        incapaz: s.incapacidade !== null,
        itens: linhas.map((x) => ({
          id: Number(x['id']),
          inicio: data(x['vigencia_inicio']),
          fim: data(x['vigencia_fim']),
          vigente: x['vigencia_fim'] === null || x['vigencia_fim'] === undefined,
          documentoTipo: String(x['documento_tipo']),
          documentoNumero: texto(x['documento_numero']),
          documentoData: data(x['documento_data']),
          temComprovante: x['comprovante_arquivo_id'] !== null && x['comprovante_arquivo_id'] !== undefined,
          motivoEncerramento: texto(x['motivo_encerramento']),
          observacao: texto(x['observacao']),
        })),
        alertas: alertasRepresentacao(s.nascimento, s.vigentes, s.hoje, s.incapacidade !== null).map((a) => ({
          alerta: a,
          mensagem: MENSAGEM_ALERTA_REPRESENTACAO[a],
        })),
        documentos: DOCUMENTOS_INCAPACIDADE,
      };
    });
  }

  /** O que a abertura do atendimento avisa hoje (a mesma leitura que a operação de abertura faz na transação). */
  alertasDaAbertura(c: ContextoPorta, paciente: number): Promise<AlertaRepresentacao[]> {
    return this.ler(c, (l) => alertasRepresentacaoDoPaciente(l, paciente));
  }

  registrarIncapacidade(c: ContextoPorta, e: EntradaIncapacidade, t: RegistroTrilhaTela): Promise<number> {
    return this.executar(c, operacaoRegistrarIncapacidade(t) as never, e, t);
  }

  encerrarIncapacidade(c: ContextoPorta, e: EntradaLevantamento, t: RegistroTrilhaTela): Promise<number> {
    return this.executar(c, operacaoEncerrarIncapacidade(t) as never, e, t);
  }

  /**
   * Comprovante enviado pela tela: confere o conteúdo (PDF, PNG ou JPEG pela assinatura do arquivo, até 640 KB),
   * guarda pela porta de arquivos com o paciente como dono e liga ao vínculo do responsável ou à incapacidade.
   * Devolve o id do arquivo.
   */
  async enviarComprovante(
    c: ContextoPorta,
    e: { paciente: number; alvo: AlvoComprovante; id: number; conteudo: Uint8Array; nomeOriginal: string },
    t: RegistroTrilhaTela,
  ): Promise<number> {
    const tipoMime = tipoComprovante(e.conteudo);
    if (!tipoMime || e.conteudo.length > TAMANHO_MAXIMO_COMPROVANTE)
      throw recusaCampos('arquivo-invalido', 'O comprovante tem de ser PDF, PNG ou JPEG, com até 640 KB.', [
        'arquivo',
      ]);
    const arquivos = this.arquivosDe();
    if (!arquivos || !c.hospital)
      throw new ErroOperacao(
        503,
        'indisponivel',
        'Indisponível',
        'O armazenamento de arquivos não está configurado.',
      );
    // O alvo é conferido antes de gravar o arquivo (nada fica no disco para um vínculo que não existe).
    await this.ler(c, async (l) => {
      const tabela = e.alvo === 'responsavel' ? 'responsavel_paciente' : 'incapacidade_paciente';
      if (
        !(await l.uma(`SELECT id FROM ${tabela} WHERE id = ? AND paciente_id = ? AND excluido_em IS NULL`, [
          e.id,
          e.paciente,
        ]))
      )
        throw recusaCampos('registro-inexistente', 'O registro não existe para este paciente.', ['id']);
    });
    const a = await arquivos.guardar(c.hospital, {
      conteudo: e.conteudo,
      nomeOriginal: e.nomeOriginal.slice(0, 255) || 'comprovante',
      tipoMime,
      finalidade: FINALIDADE_COMPROVANTE,
      entidade: 'paciente',
      entidadeId: e.paciente,
    });
    await this.executar(
      c,
      operacaoAnexarComprovante(t) as never,
      { paciente: e.paciente, alvo: e.alvo, id: e.id, arquivo: a.id },
      t,
    );
    return a.id;
  }
}
