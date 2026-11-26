// Foto do paciente para a identificação positiva no banco próprio (F3.1, 02-CAD linha 5; fase 1 da decisão de 26/11):
//   - a foto captada na ficha vai para a porta de arquivos (disco local, ADR 0004) com o paciente como dono e a guarda
//     do prontuário (20 anos); `identificacao_biometrica` guarda a ligação (modalidade foto, situação ativa, quem
//     captou, onde e quando). Uma só ativa por pessoa: a nova substitui a anterior, que fica no histórico;
//   - a revogação (foto de outra pessoa, imprópria) tira a foto da conferência, com o motivo na trilha; nada é apagado;
//   - cada conferência da identidade (recepção, guia, leito...) fica em `verificacao_biometrica`, ligada à foto ativa,
//     ou dispensada com motivo (conferida pelo documento).
// A regra é do domínio (`@sgh/dominio-cadastro`, identificacao/foto-identificacao.ts); aqui só leitura e gravação
// pelo executor (trilha e idempotência na transação). Sem gatilho.
import { randomUUID } from 'node:crypto';
import {
  BASE_LEGAL_FOTO_IDENTIFICACAO,
  type ContextoConferencia,
  errosConferenciaIdentidade,
  errosFotoIdentificacao,
  guardaFotoIdentificacaoAte,
  motivoDaConferencia,
  motivoRevogacaoValido,
  type ResultadoConferencia,
  TIPO_CONFERENCIA_DOCUMENTO,
  TIPO_CONFERENCIA_FOTO,
  tipoDaConferencia,
  tipoDaFotoIdentificacao,
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

export const FOTO_IDENTIFICACAO = Symbol('FOTO_IDENTIFICACAO');
/** Finalidade da foto na porta de arquivos (dono: a tabela paciente, o id dele). */
export const FINALIDADE_FOTO_IDENTIFICACAO = 'foto_identificacao';

const TIPOS_AUTENTICACAO: Readonly<Record<string, { descricao: string; modalidade: string }>> = {
  [TIPO_CONFERENCIA_FOTO]: { descricao: 'FOTO CONFERIDA PELO ATENDENTE', modalidade: 'foto_conferida' },
  [TIPO_CONFERENCIA_DOCUMENTO]: {
    descricao: 'DOCUMENTO CONFERIDO PELO ATENDENTE',
    modalidade: 'documento_conferido',
  },
};

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);
const recusaCampos = (codigo: string, detalhe: string, campos: readonly string[]): ErroOperacao =>
  recusa(codigo, detalhe, { campos: [...campos] });

/** A pessoa do paciente, com a linha travada (duas capturas ao mesmo tempo não deixam duas fotos ativas). */
async function pessoaDoPaciente(tx: TxOperacao, paciente: number): Promise<number> {
  const [p] = await tx.consultarParaAtualizar(
    'SELECT pessoa_fisica_id FROM paciente WHERE id = ? AND excluido_em IS NULL',
    [paciente],
  );
  if (!p) throw recusaCampos('paciente-inexistente', 'Paciente não encontrado.', ['paciente']);
  return Number(p['pessoa_fisica_id']);
}

/** A foto ativa da pessoa (nula: sem foto). */
async function fotoAtiva(
  l: Leitor | TxOperacao,
  pessoa: number,
): Promise<{ id: number; versao: number; arquivo: number } | null> {
  const r = await l.uma(
    `SELECT id, versao, arquivo_id FROM identificacao_biometrica
      WHERE pessoa_fisica_id = ? AND modalidade = 'foto' AND situacao = 'ativa' AND excluido_em IS NULL
      ORDER BY capturado_em DESC, id DESC LIMIT 1`,
    [pessoa],
  );
  return r ? { id: Number(r['id']), versao: Number(r['versao']), arquivo: Number(r['arquivo_id']) } : null;
}

/** O id do tipo de autenticação (o cadastro padrão é criado na primeira vez: catálogo da plataforma, idempotente). */
async function tipoAutenticacao(tx: TxOperacao, codigo: string): Promise<number> {
  const r = await tx.uma('SELECT id FROM tipo_autenticacao_biometrica WHERE codigo = ?', [codigo]);
  if (r) return Number(r['id']);
  const t = TIPOS_AUTENTICACAO[codigo]!;
  return tx.incluir('tipo_autenticacao_biometrica', {
    codigo,
    descricao: t.descricao,
    ativo: true,
    modalidade: t.modalidade,
    exige_dispositivo: false,
  });
}

const esquemaFoto = z
  .object({ paciente: z.number().int().positive(), arquivo: z.number().int().positive() })
  .strict();

const operacaoCadastrarFoto = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.cadastrar-foto-identificacao',
    tabelas: ['identificacao_biometrica', 'tipo_autenticacao_biometrica'],
    entrada: esquemaFoto,
    acao: 'inclusao',
    async gravar(tx, e, ctx) {
      const pessoa = await pessoaDoPaciente(tx, e.paciente);
      const a = await tx.uma(
        'SELECT finalidade, entidade, entidade_id FROM arquivo WHERE id = ? AND excluido_em IS NULL',
        [e.arquivo],
      );
      if (
        !a ||
        a['finalidade'] !== FINALIDADE_FOTO_IDENTIFICACAO ||
        a['entidade'] !== 'paciente' ||
        Number(a['entidade_id']) !== e.paciente
      )
        throw recusaCampos(
          'arquivo-nao-e-foto',
          'A foto não foi enviada para este paciente: capte pela tela.',
          ['foto'],
        );
      const anterior = await fotoAtiva(tx, pessoa);
      if (anterior && anterior.arquivo === e.arquivo) return { id: anterior.id };
      if (anterior)
        await tx.alterar('identificacao_biometrica', anterior.id, anterior.versao, {
          situacao: 'substituida',
        });
      const id = await tx.incluir('identificacao_biometrica', {
        pessoa_fisica_id: pessoa,
        modalidade: 'foto',
        tipo_autenticacao_biometrica_id: await tipoAutenticacao(tx, TIPO_CONFERENCIA_FOTO),
        arquivo_id: e.arquivo,
        captura_estabelecimento_id: ctx.estabelecimento,
        capturado_em: new Date(),
        capturado_por_usuario_id: ctx.usuario,
        situacao: 'ativa',
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'identificacao_biometrica', id: r.id }),
    trilha: () => ({
      dados: { ...(trilha.dadosDepois ?? {}), baseLegal: BASE_LEGAL_FOTO_IDENTIFICACAO },
      motivo: null,
    }),
  });

const esquemaRevogar = z
  .object({ paciente: z.number().int().positive(), motivo: z.string().trim().max(200) })
  .strict();

const operacaoRevogarFoto = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.revogar-foto-identificacao',
    tabelas: ['identificacao_biometrica'],
    entrada: esquemaRevogar,
    acao: 'alteracao',
    async gravar(tx, e) {
      if (!motivoRevogacaoValido(e.motivo))
        throw recusaCampos('motivo-obrigatorio', 'Informe o motivo da revogação (ao menos 5 letras).', [
          'motivo',
        ]);
      const f = await fotoAtiva(tx, await pessoaDoPaciente(tx, e.paciente));
      if (!f) throw recusaCampos('sem-foto', 'O paciente não tem foto ativa.', ['foto']);
      await tx.alterar('identificacao_biometrica', f.id, f.versao, {
        situacao: 'revogada',
        revogada_em: new Date(),
      });
      return { id: f.id };
    },
    alvo: (_e, r) => ({ tabela: 'identificacao_biometrica', id: r.id }),
    trilha: (e) => ({ dados: trilha.dadosDepois ?? null, motivo: e.motivo }),
  });

const esquemaConferencia = z
  .object({
    paciente: z.number().int().positive(),
    resultado: z.string().max(30),
    contexto: z.string().max(30),
    motivoDispensa: z.string().max(200).nullable(),
    atendimento: z.number().int().positive().nullable(),
  })
  .strict();
export type EntradaConferencia = z.infer<typeof esquemaConferencia>;

const MENSAGEM_CONFERENCIA: Record<string, string> = {
  resultado: 'Escolha o resultado: confirmada, não confirmada ou dispensada.',
  contexto: 'Escolha onde a identidade foi conferida.',
  motivoDispensa:
    'Informe o motivo da dispensa (ao menos 5 letras): a identidade é conferida pelo documento.',
  'sem-foto': 'O paciente não tem foto ativa: capte a foto ou registre a dispensa com o motivo.',
};

const operacaoConferir = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.conferir-identidade-paciente',
    tabelas: ['verificacao_biometrica', 'tipo_autenticacao_biometrica'],
    entrada: esquemaConferencia,
    acao: 'inclusao',
    async gravar(tx, e, ctx) {
      const pessoa = await pessoaDoPaciente(tx, e.paciente);
      const f = await fotoAtiva(tx, pessoa);
      const erros = errosConferenciaIdentidade({
        resultado: e.resultado,
        contexto: e.contexto,
        motivoDispensa: e.motivoDispensa,
        temFotoAtiva: f !== null,
      });
      if (erros.length > 0)
        throw recusaCampos(
          erros.includes('sem-foto') ? 'sem-foto' : 'conferencia-invalida',
          MENSAGEM_CONFERENCIA[erros[0]!] ?? 'Confira a conferência da identidade.',
          erros,
        );
      if (
        e.atendimento !== null &&
        !(await tx.uma('SELECT id FROM atendimento WHERE id = ? AND paciente_id = ?', [
          e.atendimento,
          e.paciente,
        ]))
      )
        throw recusaCampos('atendimento-de-outro-paciente', 'O atendimento não é deste paciente.', [
          'atendimento',
        ]);
      const resultado = e.resultado as ResultadoConferencia;
      const id = await tx.incluir('verificacao_biometrica', {
        identificacao_biometrica_id: resultado === 'dispensada' ? null : f!.id,
        operacao: 'inclusao',
        ocorrido_em: new Date(),
        usuario_id: ctx.usuario,
        estabelecimento_id: ctx.estabelecimento,
        paciente_id: e.paciente,
        tipo_autenticacao_biometrica_id: await tipoAutenticacao(tx, tipoDaConferencia(resultado)),
        contexto: e.contexto as ContextoConferencia,
        resultado,
        atendimento_id: e.atendimento,
        motivo_dispensa: motivoDaConferencia(resultado, e.motivoDispensa),
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'verificacao_biometrica', id: r.id }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

// ── Leitura ──

export interface FotoIdentificacaoResumo {
  readonly id: number;
  readonly situacao: 'ativa' | 'substituida' | 'revogada';
  readonly capturadaEm: string;
  readonly guardaAte: string;
  readonly revogadaEm: string | null;
}

export interface ConferenciaIdentidade {
  readonly id: number;
  readonly ocorridaEm: string;
  readonly contexto: string;
  readonly resultado: string;
  readonly motivoDispensa: string | null;
  readonly atendimento: number | null;
  readonly usuario: string | null;
}

export interface IdentificacaoPaciente {
  readonly baseLegal: typeof BASE_LEGAL_FOTO_IDENTIFICACAO;
  /** A foto que vale para a conferência (nula: o paciente não tem foto ativa). */
  readonly ativa: FotoIdentificacaoResumo | null;
  readonly historico: readonly FotoIdentificacaoResumo[];
  /** As 20 últimas conferências, da mais recente para a mais antiga. */
  readonly conferencias: readonly ConferenciaIdentidade[];
}

export class FotoIdentificacaoPropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCadastro,
    private readonly cliente: string,
    executor?: Executor,
    /** Porta de arquivos (disco local, ADR 0004); sem ela, a captura e a leitura da foto dão 503. */
    private arquivos?: ArquivosDoModulo | null,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private arquivosDe(c: ContextoPorta): ArquivosDoModulo {
    if (this.arquivos === undefined)
      this.arquivos =
        'cliente' in this.nucleo && 'criarExecutor' in this.nucleo
          ? arquivosDoAmbiente(this.nucleo as unknown as NucleoArmazem, this.cliente)
          : null;
    if (!this.arquivos || !c.hospital)
      throw new ErroOperacao(
        503,
        'indisponivel',
        'Indisponível',
        'O armazenamento de arquivos não está configurado.',
      );
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

  private async pessoa(l: Leitor, paciente: number): Promise<number> {
    const p = await l.uma('SELECT pessoa_fisica_id FROM paciente WHERE id = ? AND excluido_em IS NULL', [
      paciente,
    ]);
    if (!p) throw recusaCampos('paciente-inexistente', 'Paciente não encontrado.', ['paciente']);
    return Number(p['pessoa_fisica_id']);
  }

  async identificacao(c: ContextoPorta, paciente: number): Promise<IdentificacaoPaciente> {
    return this.ler(c, async (l) => {
      const pessoa = await this.pessoa(l, paciente);
      const fotos = (
        await l.consultar(
          `SELECT id, situacao, capturado_em, revogada_em FROM identificacao_biometrica
            WHERE pessoa_fisica_id = ? AND modalidade = 'foto' AND excluido_em IS NULL
            ORDER BY capturado_em DESC, id DESC LIMIT 50`,
          [pessoa],
        )
      ).map((r): FotoIdentificacaoResumo => ({
        id: Number(r['id']),
        situacao: String(r['situacao']) as FotoIdentificacaoResumo['situacao'],
        capturadaEm: iso(r['capturado_em'])!,
        guardaAte: guardaFotoIdentificacaoAte(iso(r['capturado_em'])!),
        revogadaEm: iso(r['revogada_em']),
      }));
      const conferencias = (
        await l.consultar(
          `SELECT v.id, v.ocorrido_em, v.contexto, v.resultado, v.motivo_dispensa, v.atendimento_id, u.login
             FROM verificacao_biometrica v LEFT JOIN usuario u ON u.id = v.usuario_id
            WHERE v.paciente_id = ? ORDER BY v.ocorrido_em DESC, v.id DESC LIMIT 20`,
          [paciente],
        )
      ).map((r): ConferenciaIdentidade => ({
        id: Number(r['id']),
        ocorridaEm: iso(r['ocorrido_em'])!,
        contexto: String(r['contexto']),
        resultado: String(r['resultado']),
        motivoDispensa: r['motivo_dispensa'] === null ? null : String(r['motivo_dispensa']),
        atendimento: r['atendimento_id'] === null ? null : Number(r['atendimento_id']),
        usuario: r['login'] === null || r['login'] === undefined ? null : String(r['login']),
      }));
      return {
        baseLegal: BASE_LEGAL_FOTO_IDENTIFICACAO,
        ativa: fotos.find((f) => f.situacao === 'ativa') ?? null,
        historico: fotos.filter((f) => f.situacao !== 'ativa'),
        conferencias,
      };
    });
  }

  /** A foto ativa (sem foto, ou arquivo que não é foto deste paciente: nulo, e a rota responde 404). */
  async lerFoto(c: ContextoPorta, paciente: number): Promise<{ tipoMime: string; conteudo: Buffer } | null> {
    const arquivos = this.arquivosDe(c);
    const f = await this.ler(c, async (l) => fotoAtiva(l, await this.pessoa(l, paciente)));
    if (!f) return null;
    const a = await arquivos.ler(c.hospital, f.arquivo);
    if (
      !a ||
      a.metadado.finalidade !== FINALIDADE_FOTO_IDENTIFICACAO ||
      a.metadado.entidade !== 'paciente' ||
      a.metadado.entidadeId !== paciente
    )
      return null;
    return {
      tipoMime: tipoDaFotoIdentificacao(a.conteudo) ?? 'application/octet-stream',
      conteudo: a.conteudo,
    };
  }

  /**
   * Foto captada na ficha: confere o conteúdo pelo domínio (JPEG ou PNG, até 300 KB), guarda pela porta de arquivos
   * com o paciente como dono e a guarda do prontuário, e liga à pessoa como a foto ativa. Devolve o id da ligação.
   */
  async cadastrarFoto(
    c: ContextoPorta,
    e: { paciente: number; conteudo: Uint8Array },
    t: RegistroTrilhaTela,
  ): Promise<number> {
    const erros = errosFotoIdentificacao(e.conteudo);
    const tipoMime = tipoDaFotoIdentificacao(e.conteudo);
    if (erros.length > 0 || !tipoMime)
      throw recusaCampos('foto-invalida', 'A foto tem de ser JPEG ou PNG, com até 300 KB.', ['foto']);
    const arquivos = this.arquivosDe(c);
    // O paciente é conferido antes de gravar o arquivo (nada fica no disco para um paciente que não existe).
    await this.ler(c, (l) => this.pessoa(l, e.paciente));
    const hoje = new Date().toISOString().slice(0, 10);
    const a = await arquivos.guardar(c.hospital, {
      conteudo: e.conteudo,
      nomeOriginal: `foto-identificacao.${tipoMime === 'image/png' ? 'png' : 'jpg'}`,
      tipoMime,
      finalidade: FINALIDADE_FOTO_IDENTIFICACAO,
      entidade: 'paciente',
      entidadeId: e.paciente,
      retencaoAte: guardaFotoIdentificacaoAte(hoje),
    });
    return this.executar(c, operacaoCadastrarFoto(t) as never, { paciente: e.paciente, arquivo: a.id }, t);
  }

  revogarFoto(
    c: ContextoPorta,
    e: { paciente: number; motivo: string },
    t: RegistroTrilhaTela,
  ): Promise<number> {
    return this.executar(c, operacaoRevogarFoto(t) as never, e, t);
  }

  conferir(c: ContextoPorta, e: EntradaConferencia, t: RegistroTrilhaTela): Promise<number> {
    return this.executar(c, operacaoConferir(t) as never, e, t);
  }
}
