// E-mail do sistema no banco próprio (01-ADM L77), pelo Executor (trilha e idempotência na mesma transação).
// Regras no domínio (@sgh/dominio-acesso, notificacao/email-configuracao.ts); aqui ficam a leitura e a gravação.
//
// - email.modelo_gravar: cria ou altera o modelo de mensagem (modelo_email: finalidade, assunto, corpo, vigência) e
//   mantém os campos substituíveis (modelo_email_campo) iguais aos marcadores do texto: o marcador novo entra, o que
//   saiu do texto é marcado como excluído (nunca apagado) e volta se o marcador voltar.
// - email.servidor_gravar: cria ou altera o servidor de saída (servidor_email). A senha nunca é gravada: só a
//   referência dela no cofre de segredos. Um servidor padrão por alcance (o estabelecimento ou todos): marcar outro
//   desmarca o anterior na mesma transação.
// - email.servidor_teste: grava o resultado do teste de conexão (ultimo_teste_em, ultimo_teste_sucesso). A conversa
//   com o servidor acontece antes, fora da transação; fora de produção, servidor que não é local não é contatado e
//   nada é gravado (recusa teste-neutralizado).
// - painel: servidores, modelos (com os campos), finalidades e o registro dos últimos envios (envio_email com os
//   destinatários), só do estabelecimento da sessão e do que vale para todos.
import {
  marcadoresDoModelo,
  MENSAGEM_EMAIL,
  type RecusaEmail,
  SEGURANCAS_EMAIL,
  validarModeloEmail,
  validarServidorEmail,
} from '@sgh/dominio-acesso';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { TestadorConexao } from './email-teste-conexao.js';

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const boolOuNull = (v: unknown): boolean | null => (v === null || v === undefined ? null : bool(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const dia = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const vazioNulo = (v: string | null | undefined): string | null => (v && v.trim() !== '' ? v.trim() : null);
const recusar = (r: RecusaEmail) => recusa(r, MENSAGEM_EMAIL[r]);

const id = z.number().int().positive();
const versao = z.number().int().positive();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const textoOpcional = (max: number) => z.string().trim().max(max).nullable().optional();

export const esquemaModeloEmail = z
  .object({
    id: id.optional(),
    versao: versao.optional(),
    /** Verdadeiro: modelo padrão do cliente (todos os estabelecimentos); falso: só o estabelecimento da sessão. */
    todosEstabelecimentos: z.boolean().default(false),
    finalidade: z.string().trim().min(1).max(30),
    codigo: z.string().trim().max(30),
    nome: z.string().trim().max(100),
    assunto: z.string().max(250),
    corpoHtml: z.string().max(200_000),
    corpoTexto: z.string().max(60_000).nullable().optional(),
    remetenteNome: textoOpcional(150),
    remetenteEmail: textoOpcional(254),
    responderPara: textoOpcional(254),
    enviaSms: z.boolean().default(false),
    textoSms: textoOpcional(300),
    vigenciaInicio: dataIso.nullable().optional(),
    vigenciaFim: dataIso.nullable().optional(),
    ativo: z.boolean().default(true),
    /** Descrição e exemplo dos marcadores (o que não vier usa o próprio marcador como descrição). */
    campos: z
      .array(
        z
          .object({
            marcador: z.string().trim().min(1).max(100),
            descricao: z.string().trim().min(1).max(200),
            exemplo: textoOpcional(200),
          })
          .strict(),
      )
      .max(200)
      .default([]),
  })
  .strict();
export type EntradaModeloEmail = z.infer<typeof esquemaModeloEmail>;

export const esquemaServidorEmail = z
  .object({
    id: id.optional(),
    versao: versao.optional(),
    todosEstabelecimentos: z.boolean().default(false),
    /** Código da finalidade atendida; nulo: todas. */
    finalidade: z.string().trim().max(30).nullable().optional(),
    codigo: z.string().trim().max(30),
    nome: z.string().trim().max(150),
    host: z.string().trim().max(255),
    porta: z.number().int(),
    seguranca: z.enum(SEGURANCAS_EMAIL).default('starttls'),
    exigeAutenticacao: z.boolean().default(true),
    usuarioAutenticacao: textoOpcional(254),
    referenciaCofre: textoOpcional(200),
    remetenteEmail: z.string().trim().max(254),
    remetenteNome: textoOpcional(150),
    responderPara: textoOpcional(254),
    copiaRemetente: z.boolean().default(false),
    tempoLimiteSegundos: z.number().int().default(30),
    limiteEnvioHora: z.number().int().nullable().optional(),
    padrao: z.boolean().default(false),
    ativo: z.boolean().default(true),
  })
  .strict();
export type EntradaServidorEmail = z.infer<typeof esquemaServidorEmail>;

const esquemaTeste = z.object({ servidor: id }).strict();
const esquemaResultadoTeste = z.object({ servidor: id, sucesso: z.boolean() }).strict();

export interface ContextoEmail {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoEmail = ContextoEmail & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

export interface ServidorEmailLido {
  readonly id: number;
  readonly versao: number;
  readonly todosEstabelecimentos: boolean;
  readonly finalidade: string | null;
  readonly codigo: string;
  readonly nome: string;
  readonly host: string;
  readonly porta: number;
  readonly seguranca: string;
  readonly exigeAutenticacao: boolean;
  readonly usuarioAutenticacao: string | null;
  /** A chave da senha no cofre (nunca a senha). */
  readonly referenciaCofre: string | null;
  readonly remetenteEmail: string;
  readonly remetenteNome: string | null;
  readonly responderPara: string | null;
  readonly copiaRemetente: boolean;
  readonly tempoLimiteSegundos: number;
  readonly limiteEnvioHora: number | null;
  readonly padrao: boolean;
  readonly ativo: boolean;
  readonly ultimoTesteEm: string | null;
  /** Nulo: nunca testado. */
  readonly ultimoTesteSucesso: boolean | null;
}
export interface ModeloEmailLido {
  readonly id: number;
  readonly versao: number;
  readonly todosEstabelecimentos: boolean;
  readonly finalidade: string;
  readonly codigo: string;
  readonly nome: string;
  readonly assunto: string;
  readonly corpoHtml: string;
  readonly corpoTexto: string | null;
  readonly remetenteNome: string | null;
  readonly remetenteEmail: string | null;
  readonly responderPara: string | null;
  readonly enviaSms: boolean;
  readonly textoSms: string | null;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
  readonly campos: { marcador: string; descricao: string; exemplo: string | null }[];
}
export interface EnvioEmailLido {
  readonly id: number;
  readonly ocorridoEm: string | null;
  readonly finalidade: string | null;
  readonly modelo: string | null;
  readonly assunto: string;
  readonly situacao: string;
  readonly tentativas: number;
  readonly enviadoEm: string | null;
  readonly identificadorMensagem: string | null;
  readonly erro: string | null;
  readonly destinatarios: { tipo: string; email: string; situacao: string }[];
}
export interface PainelEmail {
  /** Fora de produção, nada sai: a mensagem só chega à caixa de captura. */
  readonly saidaDeTeste: boolean;
  readonly finalidades: { codigo: string; descricao: string }[];
  readonly servidores: ServidorEmailLido[];
  readonly modelos: ModeloEmailLido[];
  readonly envios: EnvioEmailLido[];
}

type NucleoEmail = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;
const TETO = 2000;
const ENVIOS_NO_PAINEL = 100;

export class EmailConfiguracaoPropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  private readonly opModelo = definirOperacao<EntradaModeloEmail, { modelo: number; campos: number }>({
    nome: 'email.modelo_gravar',
    tabelas: ['modelo_email', 'modelo_email_campo'],
    entrada: esquemaModeloEmail as unknown as z.ZodType<EntradaModeloEmail>,
    gravar: (tx, e, ctx) => this.gravarModeloTx(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'modelo_email', id: r.modelo }),
  });

  private readonly opServidor = definirOperacao<EntradaServidorEmail, { servidor: number }>({
    nome: 'email.servidor_gravar',
    tabelas: ['servidor_email'],
    entrada: esquemaServidorEmail as unknown as z.ZodType<EntradaServidorEmail>,
    gravar: (tx, e, ctx) => this.gravarServidorTx(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'servidor_email', id: r.servidor }),
  });

  private readonly opTeste = definirOperacao<
    z.infer<typeof esquemaResultadoTeste>,
    { servidor: number; sucesso: boolean }
  >({
    nome: 'email.servidor_teste',
    tabelas: ['servidor_email'],
    entrada: esquemaResultadoTeste,
    gravar: async (tx, e, ctx) => {
      const s = await this.servidorDoAlcance(tx, e.servidor, ctx.estabelecimento ?? null);
      await tx.alterar('servidor_email', e.servidor, num(s['versao']), {
        ultimo_teste_em: this.agora(),
        ultimo_teste_sucesso: e.sucesso,
      });
      return { servidor: e.servidor, sucesso: e.sucesso };
    },
    alvo: (e) => ({ tabela: 'servidor_email', id: e.servidor }),
  });

  constructor(
    private readonly nucleo: NucleoEmail,
    private readonly cliente: string,
    private readonly producao: boolean,
    private readonly testador: TestadorConexao,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private async quem(l: Leitor, c: ContextoEmail) {
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
  }

  private ler<T>(c: ContextoEmail, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'administracao.email' }, async (l) =>
      fn(l, (await this.quem(l, c)).estabelecimento),
    );
  }

  private async contexto(c: ContextoGravacaoEmail): Promise<ContextoOperacao> {
    const q = await this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'administracao.email' },
      (l) => this.quem(l, c),
    );
    return {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
  }

  private async exec<S extends Record<string, unknown>>(
    op: Parameters<Executor['executar']>[0],
    c: ContextoGravacaoEmail,
    entrada: unknown,
  ): Promise<{ resultado: S; repetida: boolean }> {
    const ctx = await this.contexto(c);
    const r = await this.executor.executar(op, this.cliente, entrada, ctx);
    return { resultado: r.resultado as unknown as S, repetida: r.repetida };
  }

  // ── Leitura ─────────────────────────────────────────────────────────────────────────────────────

  painel(c: ContextoEmail): Promise<PainelEmail> {
    return this.ler(c, async (l, est) => {
      const finalidades = (
        await l.consultar(
          'SELECT codigo, descricao FROM finalidade_email WHERE ativo ORDER BY descricao',
          [],
          {
            teto: TETO,
          },
        )
      ).map((x) => ({ codigo: String(x['codigo']), descricao: String(x['descricao']) }));
      const servidores = (
        await l.consultar(
          `SELECT s.*, f.codigo AS finalidade FROM servidor_email s
             LEFT JOIN finalidade_email f ON f.id = s.finalidade_email_id
            WHERE s.estabelecimento_id IS NULL OR s.estabelecimento_id = ?
            ORDER BY s.ativo DESC, s.padrao DESC, s.nome, s.id`,
          [est],
          { teto: TETO },
        )
      ).map((x): ServidorEmailLido => ({
        id: num(x['id']),
        versao: num(x['versao']),
        todosEstabelecimentos: x['estabelecimento_id'] === null,
        finalidade: txt(x['finalidade']),
        codigo: String(x['codigo']),
        nome: String(x['nome']),
        host: String(x['host']),
        porta: num(x['porta']),
        seguranca: String(x['seguranca']),
        exigeAutenticacao: bool(x['exige_autenticacao']),
        usuarioAutenticacao: txt(x['usuario_autenticacao']),
        referenciaCofre: txt(x['referencia_cofre']),
        remetenteEmail: String(x['remetente_email']),
        remetenteNome: txt(x['remetente_nome']),
        responderPara: txt(x['responder_para']),
        copiaRemetente: bool(x['copia_remetente']),
        tempoLimiteSegundos: num(x['tempo_limite_segundos']),
        limiteEnvioHora: numOuNull(x['limite_envio_hora']),
        padrao: bool(x['padrao']),
        ativo: bool(x['ativo']),
        ultimoTesteEm: iso(x['ultimo_teste_em']),
        ultimoTesteSucesso: boolOuNull(x['ultimo_teste_sucesso']),
      }));
      const linhasModelo = await l.consultar(
        `SELECT m.id, m.versao, m.estabelecimento_id, f.codigo AS finalidade, m.codigo, m.nome, m.assunto, m.corpo_html,
                m.corpo_texto, m.remetente_nome, m.remetente_email, m.responder_para, m.envia_sms, m.texto_sms,
                m.vigencia_inicio, m.vigencia_fim, m.ativo
           FROM modelo_email m JOIN finalidade_email f ON f.id = m.finalidade_email_id
          WHERE m.estabelecimento_id IS NULL OR m.estabelecimento_id = ?
          ORDER BY m.ativo DESC, f.descricao, m.nome, m.id`,
        [est],
        { teto: TETO },
      );
      const campos = await l.consultar(
        `SELECT c.modelo_email_id, c.marcador, c.descricao, c.exemplo FROM modelo_email_campo c
           JOIN modelo_email m ON m.id = c.modelo_email_id
          WHERE c.excluido_em IS NULL AND (m.estabelecimento_id IS NULL OR m.estabelecimento_id = ?)
          ORDER BY c.modelo_email_id, c.sequencia`,
        [est],
        { teto: 20_000 },
      );
      const modelos = linhasModelo.map((x): ModeloEmailLido => ({
        id: num(x['id']),
        versao: num(x['versao']),
        todosEstabelecimentos: x['estabelecimento_id'] === null,
        finalidade: String(x['finalidade']),
        codigo: String(x['codigo']),
        nome: String(x['nome']),
        assunto: String(x['assunto']),
        corpoHtml: String(x['corpo_html']),
        corpoTexto: txt(x['corpo_texto']),
        remetenteNome: txt(x['remetente_nome']),
        remetenteEmail: txt(x['remetente_email']),
        responderPara: txt(x['responder_para']),
        enviaSms: bool(x['envia_sms']),
        textoSms: txt(x['texto_sms']),
        vigenciaInicio: dia(x['vigencia_inicio']),
        vigenciaFim: dia(x['vigencia_fim']),
        ativo: bool(x['ativo']),
        campos: campos
          .filter((c2) => num(c2['modelo_email_id']) === num(x['id']))
          .map((c2) => ({
            marcador: String(c2['marcador']),
            descricao: String(c2['descricao']),
            exemplo: txt(c2['exemplo']),
          })),
      }));
      const linhasEnvio = await l.consultar(
        `SELECT e.id, e.ocorrido_em, f.codigo AS finalidade, m.codigo AS modelo, e.assunto, e.situacao, e.tentativas,
                e.enviado_em, e.identificador_mensagem, e.erro
           FROM envio_email e
           LEFT JOIN finalidade_email f ON f.id = e.finalidade_email_id
           LEFT JOIN modelo_email m ON m.id = e.modelo_email_id
          WHERE e.estabelecimento_id IS NULL OR e.estabelecimento_id = ?
          ORDER BY e.ocorrido_em DESC, e.id DESC LIMIT ${ENVIOS_NO_PAINEL}`,
        [est],
        { teto: ENVIOS_NO_PAINEL },
      );
      const idsEnvio = linhasEnvio.map((x) => num(x['id']));
      const dest = idsEnvio.length
        ? await l.consultar(
            `SELECT envio_email_id, tipo_destinatario, email, situacao FROM envio_email_destinatario
              WHERE excluido_em IS NULL AND envio_email_id IN (${idsEnvio.map(() => '?').join(', ')})
              ORDER BY envio_email_id, sequencia`,
            idsEnvio,
            { teto: 20_000 },
          )
        : [];
      const envios = linhasEnvio.map((x): EnvioEmailLido => ({
        id: num(x['id']),
        ocorridoEm: iso(x['ocorrido_em']),
        finalidade: txt(x['finalidade']),
        modelo: txt(x['modelo']),
        assunto: String(x['assunto']),
        situacao: String(x['situacao']),
        tentativas: num(x['tentativas']),
        enviadoEm: iso(x['enviado_em']),
        identificadorMensagem: txt(x['identificador_mensagem']),
        erro: txt(x['erro']),
        destinatarios: dest
          .filter((d) => num(d['envio_email_id']) === num(x['id']))
          .map((d) => ({
            tipo: String(d['tipo_destinatario']),
            email: String(d['email']),
            situacao: String(d['situacao']),
          })),
      }));
      return { saidaDeTeste: !this.producao, finalidades, servidores, modelos, envios };
    });
  }

  // ── Gravações ───────────────────────────────────────────────────────────────────────────────────

  gravarModelo(c: ContextoGravacaoEmail, entrada: unknown) {
    return this.exec<{ modelo: number; campos: number }>(this.opModelo as never, c, entrada);
  }

  gravarServidor(c: ContextoGravacaoEmail, entrada: unknown) {
    return this.exec<{ servidor: number }>(this.opServidor as never, c, entrada);
  }

  /** Testa a conexão (fora da transação) e grava quando foi e se deu certo. */
  async testarServidor(c: ContextoGravacaoEmail, entrada: unknown) {
    const e = esquemaTeste.safeParse(entrada);
    if (!e.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Informe o servidor a testar.');
    const s = await this.ler(c, (l, est) => this.servidorDoAlcance(l, e.data.servidor, est));
    const r = await this.testador({
      host: String(s['host']),
      porta: num(s['porta']),
      seguranca: String(s['seguranca']),
      tempoLimiteSegundos: num(s['tempo_limite_segundos']),
      // Servidor que exige autenticação: o teste autentica com o usuário e a senha lida do cofre pela referência.
      ...(bool(s['exige_autenticacao'])
        ? {
            usuario: s['usuario_autenticacao'] == null ? null : String(s['usuario_autenticacao']),
            referenciaCofre: s['referencia_cofre'] == null ? null : String(s['referencia_cofre']),
          }
        : {}),
    });
    if (r.neutralizado)
      throw recusa(
        'teste-neutralizado',
        'Fora de produção só o servidor local é testado: nenhuma conexão sai deste ambiente.',
      );
    const g = await this.exec<{ servidor: number; sucesso: boolean }>(this.opTeste as never, c, {
      servidor: e.data.servidor,
      sucesso: r.sucesso,
    });
    return { resultado: { ...g.resultado, detalhe: r.detalhe }, repetida: g.repetida };
  }

  private async servidorDoAlcance(l: Leitor, servidor: number, est: number | null) {
    const s = await l.uma(
      `SELECT id, versao, host, porta, seguranca, tempo_limite_segundos, exige_autenticacao, usuario_autenticacao,
              referencia_cofre FROM servidor_email
        WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
      [servidor, est],
    );
    if (!s) throw recusa('servidor-inexistente', 'Servidor de e-mail não encontrado.');
    return s;
  }

  private async finalidade(tx: TxOperacao, codigo: string): Promise<number> {
    const f = await tx.uma('SELECT id FROM finalidade_email WHERE codigo = ? AND ativo', [codigo]);
    if (!f) throw recusa('finalidade-inexistente', 'Finalidade de e-mail inexistente ou inativa.');
    return num(f['id']);
  }

  private async gravarModeloTx(tx: TxOperacao, e: EntradaModeloEmail, ctx: ContextoOperacao) {
    const entrada = {
      codigo: e.codigo,
      nome: e.nome,
      assunto: e.assunto,
      corpoHtml: e.corpoHtml,
      corpoTexto: e.corpoTexto ?? null,
      remetenteEmail: vazioNulo(e.remetenteEmail),
      responderPara: vazioNulo(e.responderPara),
      enviaSms: e.enviaSms,
      textoSms: vazioNulo(e.textoSms),
      vigenciaInicio: e.vigenciaInicio ?? null,
      vigenciaFim: e.vigenciaFim ?? null,
    };
    const v = validarModeloEmail(entrada);
    if (v) throw recusar(v);
    const est = ctx.estabelecimento ?? null;
    const valores = {
      finalidade_email_id: await this.finalidade(tx, e.finalidade),
      codigo: e.codigo,
      nome: e.nome.trim(),
      assunto: e.assunto.trim(),
      corpo_html: e.corpoHtml,
      corpo_texto: vazioNulo(e.corpoTexto),
      remetente_nome: vazioNulo(e.remetenteNome),
      remetente_email: entrada.remetenteEmail,
      responder_para: entrada.responderPara,
      envia_sms: e.enviaSms,
      texto_sms: e.enviaSms ? entrada.textoSms : null,
      vigencia_inicio: entrada.vigenciaInicio,
      vigencia_fim: entrada.vigenciaFim,
      ativo: e.ativo,
    };
    let modelo: number;
    if (e.id) {
      if (!e.versao) throw recusa('versao-obrigatoria', 'Informe a versão lida do modelo.');
      const x = await tx.uma(
        'SELECT id, estabelecimento_id FROM modelo_email WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)',
        [e.id, est],
      );
      if (!x) throw recusa('modelo-inexistente', 'Modelo de mensagem não encontrado.');
      const dup = await tx.uma(
        'SELECT id FROM modelo_email WHERE codigo = ? AND estabelecimento_chave = ? AND id <> ?',
        [e.codigo, numOuNull(x['estabelecimento_id']) ?? 0, e.id],
      );
      if (dup) throw recusa('codigo-duplicado', 'Já existe modelo com este código neste alcance.');
      // O alcance (estabelecimento ou todos) não muda na alteração: quem precisa de outro alcance cria outro modelo.
      await tx.alterar('modelo_email', e.id, e.versao, valores);
      modelo = e.id;
    } else {
      const alcance = e.todosEstabelecimentos ? null : est;
      const dup = await tx.uma('SELECT id FROM modelo_email WHERE codigo = ? AND estabelecimento_chave = ?', [
        e.codigo,
        alcance ?? 0,
      ]);
      if (dup) throw recusa('codigo-duplicado', 'Já existe modelo com este código neste alcance.');
      modelo = await tx.incluir('modelo_email', { ...valores, estabelecimento_id: alcance });
    }
    return { modelo, campos: await this.reconciliarCampos(tx, modelo, e, entrada, ctx) };
  }

  /** Os campos do modelo ficam iguais aos marcadores do texto; o que sai é marcado como excluído, nunca apagado. */
  private async reconciliarCampos(
    tx: TxOperacao,
    modelo: number,
    e: EntradaModeloEmail,
    texto: Parameters<typeof marcadoresDoModelo>[0],
    ctx: ContextoOperacao,
  ): Promise<number> {
    const marcadores = marcadoresDoModelo(texto);
    const atuais = await tx.consultarParaAtualizar(
      'SELECT id, versao, sequencia, marcador, descricao, exemplo, excluido_em FROM modelo_email_campo WHERE modelo_email_id = ?',
      [modelo],
      { teto: 5000 },
    );
    let sequencia = atuais.reduce((m, x) => Math.max(m, num(x['sequencia'])), 0);
    const agora = this.agora();
    for (const marcador of marcadores) {
      const dado = e.campos.find((c) => c.marcador === marcador);
      const atual = atuais.find((x) => String(x['marcador']) === marcador);
      if (!atual) {
        await tx.incluir('modelo_email_campo', {
          modelo_email_id: modelo,
          sequencia: ++sequencia,
          marcador,
          descricao: dado?.descricao ?? marcador,
          exemplo: vazioNulo(dado?.exemplo),
        });
        continue;
      }
      const descricao = dado?.descricao ?? String(atual['descricao']);
      const exemplo = dado ? vazioNulo(dado.exemplo) : txt(atual['exemplo']);
      if (
        atual['excluido_em'] !== null ||
        descricao !== String(atual['descricao']) ||
        exemplo !== txt(atual['exemplo'])
      )
        await tx.alterar('modelo_email_campo', num(atual['id']), num(atual['versao']), {
          descricao,
          exemplo,
          excluido_em: null,
          excluido_por: null,
        });
    }
    for (const x of atuais)
      if (x['excluido_em'] === null && !marcadores.includes(String(x['marcador'])))
        await tx.alterar('modelo_email_campo', num(x['id']), num(x['versao']), {
          excluido_em: agora,
          excluido_por: ctx.usuario ?? null,
        });
    return marcadores.length;
  }

  private async gravarServidorTx(tx: TxOperacao, e: EntradaServidorEmail, ctx: ContextoOperacao) {
    const usuario = vazioNulo(e.usuarioAutenticacao);
    const referencia = vazioNulo(e.referenciaCofre);
    const v = validarServidorEmail({
      codigo: e.codigo,
      nome: e.nome,
      host: e.host,
      porta: e.porta,
      seguranca: e.seguranca,
      exigeAutenticacao: e.exigeAutenticacao,
      usuarioAutenticacao: usuario,
      referenciaCofre: referencia,
      remetenteEmail: e.remetenteEmail,
      responderPara: vazioNulo(e.responderPara),
      tempoLimiteSegundos: e.tempoLimiteSegundos,
      limiteEnvioHora: e.limiteEnvioHora ?? null,
      padrao: e.padrao,
      ativo: e.ativo,
    });
    if (v) throw recusar(v);
    const est = ctx.estabelecimento ?? null;
    const valores = {
      finalidade_email_id: e.finalidade ? await this.finalidade(tx, e.finalidade) : null,
      codigo: e.codigo,
      nome: e.nome.trim(),
      host: e.host.toLowerCase(),
      porta: e.porta,
      seguranca: e.seguranca,
      exige_autenticacao: e.exigeAutenticacao,
      usuario_autenticacao: usuario,
      referencia_cofre: referencia,
      remetente_email: e.remetenteEmail,
      remetente_nome: vazioNulo(e.remetenteNome),
      responder_para: vazioNulo(e.responderPara),
      copia_remetente: e.copiaRemetente,
      tempo_limite_segundos: e.tempoLimiteSegundos,
      limite_envio_hora: e.limiteEnvioHora ?? null,
      padrao: e.padrao,
      ativo: e.ativo,
    };
    let servidor: number;
    let alcance: number | null;
    if (e.id) {
      if (!e.versao) throw recusa('versao-obrigatoria', 'Informe a versão lida do servidor.');
      const x = await tx.uma(
        'SELECT id, estabelecimento_id, host, porta, seguranca FROM servidor_email WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)',
        [e.id, est],
      );
      if (!x) throw recusa('servidor-inexistente', 'Servidor de e-mail não encontrado.');
      const dup = await tx.uma('SELECT id FROM servidor_email WHERE codigo = ? AND id <> ?', [
        e.codigo,
        e.id,
      ]);
      if (dup) throw recusa('codigo-duplicado', 'Já existe servidor de e-mail com este código.');
      alcance = numOuNull(x['estabelecimento_id']);
      // Mudou o endereço, a porta ou a segurança: o teste anterior não vale mais.
      const mudouConexao =
        String(x['host']) !== valores.host ||
        num(x['porta']) !== valores.porta ||
        String(x['seguranca']) !== valores.seguranca;
      await tx.alterar('servidor_email', e.id, e.versao, {
        ...valores,
        ...(mudouConexao ? { ultimo_teste_em: null, ultimo_teste_sucesso: null } : {}),
      });
      servidor = e.id;
    } else {
      const dup = await tx.uma('SELECT id FROM servidor_email WHERE codigo = ?', [e.codigo]);
      if (dup) throw recusa('codigo-duplicado', 'Já existe servidor de e-mail com este código.');
      alcance = e.todosEstabelecimentos ? null : est;
      servidor = await tx.incluir('servidor_email', { ...valores, estabelecimento_id: alcance });
    }
    if (e.padrao) {
      // Um padrão por alcance: os outros padrões do mesmo alcance deixam de ser.
      const outros = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM servidor_email WHERE padrao AND id <> ? AND estabelecimento_id <=> ?',
        [servidor, alcance],
        { teto: 1000 },
      );
      for (const o of outros)
        await tx.alterar('servidor_email', num(o['id']), num(o['versao']), { padrao: false });
    }
    return { servidor };
  }
}
