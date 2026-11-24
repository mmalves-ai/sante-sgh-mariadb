// Família acesso-email, pedido do dono (23/11): "Esqueci a senha" do ADMINISTRADOR DA PLATAFORMA (pelo e-mail de
// administrador_plataforma) e o segundo fator por código no e-mail, escolhível ao lado do aplicativo. As mesmas
// proteções da recuperação do usuário do cliente (recuperacao-senha.ts):
//   - o pedido responde SEMPRE a mesma mensagem, no mesmo tempo (busca, envio e linha do tempo correm depois da
//     resposta): ninguém descobre se a conta existe;
//   - limite por conta (e-mail normalizado) e por origem, contados ANTES de saber se a conta existe;
//   - token de 32 bytes, só no e-mail, guardado só como resumo SHA-256 no armazém, válido 15 min, uso único (consumo
//     atômico); um pedido novo invalida o anterior;
//   - usar o token grava uma senha provisória (argon2id) com troca obrigatória no próximo acesso, zera as tentativas e
//     o bloqueio; a marca de senha_alterada_em muda, e as sessões antigas da plataforma deixam de valer.
// Linha do tempo em credencial_administrador_evento (db/plataforma/0092, só de acréscimo), com o resumo da origem.
// Senha, token, código e resumos nunca vão a log, resposta (salvo a senha provisória ao dono do token) ou trilha.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { cifrarSenha, gerarSenhaProvisoria, type PoliticaSenha } from '@sgh/dominio-acesso';
import type { ArmazemSessao } from './armazem.js';
import {
  contaPlataforma,
  type DesfechoConferenciaCodigo,
  ehMetodoSegundoFator,
  type MetodoSegundoFator,
  type ServicoCodigoEmail,
} from './codigo-email.js';
import { ENDERECO_EMAIL, type PortaEmailAcesso } from './email-acesso.js';
import type { NucleoPlataforma } from './fonte-plataforma.js';

export const RESPOSTA_RECUPERACAO_PLATAFORMA =
  'Se o e-mail for de um administrador ativo da plataforma, as instruções chegam nele em instantes. O link vale por pouco tempo e uma vez só.';
export const VALIDADE_TOKEN_PLATAFORMA_SEG = 15 * 60;
export const PEDIDOS_PLATAFORMA_POR_CONTA_HORA = 3;
export const PEDIDOS_PLATAFORMA_POR_ORIGEM_HORA = 20;
const HORA_SEG = 3600;

/** Política da senha provisória da plataforma (a mais forte: todas as classes, 16 caracteres). */
export const POLITICA_PROVISORIA_PLATAFORMA: PoliticaSenha = {
  minimoCaracteres: 16,
  exigeLetra: true,
  exigeNumero: true,
  exigeEspecial: true,
  exigeMinuscula: true,
  exigeMaiuscula: true,
  periodoTrocaDias: 0,
  periodoReutilizacaoDias: 0,
};

export type TipoEventoCredencialPlataforma =
  | 'recuperacao_pedida'
  | 'senha_recuperada'
  | 'segundo_fator_metodo_alterado'
  | 'codigo_email_enviado'
  | 'codigo_email_conferido'
  | 'codigo_email_recusado';

export class ErroRecuperacaoPlataforma extends Error {
  constructor(
    readonly codigo:
      | 'indisponivel'
      | 'muitos-pedidos'
      | 'entrada-invalida'
      | 'token-invalido'
      | 'conta-impedida'
      | 'metodo-nao-escolhido',
    readonly status: 400 | 409 | 429 | 503,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroRecuperacaoPlataforma';
  }
}

export interface OpcoesRecuperacaoPlataforma {
  /** Endereço da tela que recebe o token (ex.: https://host/plataforma/recuperar-senha). */
  readonly linkTela: string;
  readonly agora?: () => Date;
  readonly cifrar?: (senha: string) => Promise<string>;
  readonly aviso?: (mensagem: string, campos: Record<string, unknown>) => void;
}

const resumo = (s: string) => createHash('sha256').update(s).digest('hex');
const emailNormalizado = (e: string) => e.trim().toLowerCase();
const bool = (v: unknown): boolean => v === true || Number(v) === 1;

interface LinhaAdm {
  readonly id: unknown;
  readonly email: unknown;
  readonly ativo: unknown;
  readonly login: unknown;
  readonly metodo_segundo_fator: unknown;
  [k: string]: unknown;
}

const SQL_ADM = `SELECT a.id, a.email, a.ativo, c.login, c.metodo_segundo_fator
  FROM administrador_plataforma a JOIN credencial_administrador_plataforma c ON c.administrador_plataforma_id = a.id`;

export class ServicoRecuperacaoPlataforma {
  private readonly emCurso = new Set<Promise<void>>();
  private readonly agora: () => Date;
  private readonly cifrar: (senha: string) => Promise<string>;
  private readonly aviso: (mensagem: string, campos: Record<string, unknown>) => void;

  constructor(
    private readonly nucleo: NucleoPlataforma,
    private readonly armazem: ArmazemSessao,
    private readonly email: PortaEmailAcesso | null,
    private readonly codigos: ServicoCodigoEmail | null,
    private readonly opcoes: OpcoesRecuperacaoPlataforma,
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.cifrar = opcoes.cifrar ?? ((s) => cifrarSenha(s));
    this.aviso = opcoes.aviso ?? (() => undefined);
  }

  /** O "Esqueci a senha" da plataforma aparece? (só com o envio de e-mail montado) */
  get disponivel(): boolean {
    return this.email !== null;
  }

  /** Testes: espera o que corre depois da resposta. */
  async aguardarEnvios(): Promise<void> {
    await Promise.all([...this.emCurso]);
  }

  private async contar(chave: string, limite: number): Promise<void> {
    if ((await this.armazem.incrementar(chave, HORA_SEG)) > limite)
      throw new ErroRecuperacaoPlataforma('muitos-pedidos', 429, 'Muitos pedidos; aguarde e tente de novo.');
  }

  private chaveToken(token: string): string {
    return `plataforma:recuperacao-senha:token:${resumo(token)}`;
  }

  private chaveUltimo(id: number): string {
    return `plataforma:recuperacao-senha:ultimo:${id}`;
  }

  private async evento(
    id: number,
    tipo: TipoEventoCredencialPlataforma,
    ip: string | null,
    correlacao: string,
  ): Promise<void> {
    const agora = this.agora();
    await this.nucleo.escreverPlataforma(correlacao.slice(0, 64) || 'plataforma-credencial', (e) =>
      e.executar(
        `INSERT INTO credencial_administrador_evento
           (administrador_plataforma_id, tipo, origem_resumo, correlacao, ocorrido_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, tipo, ip === null ? null : resumo(`origem\u0000${ip}`), correlacao.slice(0, 64) || null, agora, agora],
      ),
    );
  }

  private async lerPorEmail(email: string): Promise<LinhaAdm | null> {
    return this.nucleo.lerPlataforma('plataforma-recuperacao', (l) =>
      l.uma<LinhaAdm>(`${SQL_ADM} WHERE a.email = ?`, [email]),
    );
  }

  private async lerPorId(id: number): Promise<LinhaAdm | null> {
    return this.nucleo.lerPlataforma('plataforma-credencial', (l) =>
      l.uma<LinhaAdm>(`${SQL_ADM} WHERE a.id = ?`, [id]),
    );
  }

  /** Pedido do "Esqueci a senha": a mesma resposta para qualquer e-mail (exista ou não a conta). */
  async pedir(emailInformado: string, ip: string | null, correlacao: string): Promise<{ mensagem: string }> {
    const email = this.email;
    if (!email) throw new ErroRecuperacaoPlataforma('indisponivel', 503, 'Recuperação indisponível.');
    const alvo = emailNormalizado(String(emailInformado ?? ''));
    if (!ENDERECO_EMAIL.test(alvo))
      throw new ErroRecuperacaoPlataforma('entrada-invalida', 400, 'Informe um e-mail válido.');
    await this.contar(
      `plataforma:recuperacao-senha:origem:${resumo(String(ip ?? 'sem-ip')).slice(0, 32)}`,
      PEDIDOS_PLATAFORMA_POR_ORIGEM_HORA,
    );
    await this.contar(
      `plataforma:recuperacao-senha:conta:${resumo(alvo).slice(0, 32)}`,
      PEDIDOS_PLATAFORMA_POR_CONTA_HORA,
    );
    const token = randomBytes(32).toString('base64url');
    const chave = this.chaveToken(token);
    const tarefa = new Promise<void>((pronto) => setImmediate(pronto)).then(async () => {
      try {
        const adm = await this.lerPorEmail(alvo);
        if (!adm || !bool(adm.ativo)) return;
        const id = Number(adm.id);
        const ultimo = this.chaveUltimo(id);
        const anterior = await this.armazem.consumir(ultimo);
        if (anterior) await this.armazem.apagar(anterior);
        await this.armazem.gravar(chave, String(id), VALIDADE_TOKEN_PLATAFORMA_SEG);
        await this.armazem.gravar(ultimo, chave, VALIDADE_TOKEN_PLATAFORMA_SEG);
        await email.enviar({
          para: String(adm.email),
          assunto: 'Recuperação de senha da plataforma',
          texto:
            `Recebemos um pedido para redefinir a senha de administrador da plataforma (login ${String(adm.login)}).\n\n` +
            `Para continuar, abra: ${this.opcoes.linkTela}?token=${token}\n\n` +
            `O link vale por ${VALIDADE_TOKEN_PLATAFORMA_SEG / 60} minutos e uma vez só. ` +
            'Se não foi você, ignore este e-mail: a senha atual continua valendo.\n',
        });
        await this.evento(id, 'recuperacao_pedida', ip, correlacao);
      } catch (e) {
        await this.armazem.apagar(chave).catch(() => undefined);
        this.aviso('plataforma: recuperação de senha falhou', { erro: e instanceof Error ? e.name : 'erro' });
      }
    });
    this.emCurso.add(tarefa);
    void tarefa.finally(() => this.emCurso.delete(tarefa));
    return { mensagem: RESPOSTA_RECUPERACAO_PLATAFORMA };
  }

  /** O token do e-mail (uso único) vira a senha provisória; a troca fica obrigatória no próximo acesso. */
  async usar(
    token: string,
    ip: string | null,
    correlacao: string,
  ): Promise<{ senhaProvisoria: string; trocaObrigatoria: true; login: string }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(token ?? '')))
      throw new ErroRecuperacaoPlataforma('token-invalido', 400, 'Link inválido ou vencido.');
    const bruto = await this.armazem.consumir(this.chaveToken(token));
    if (!bruto) throw new ErroRecuperacaoPlataforma('token-invalido', 400, 'Link inválido ou vencido.');
    const id = Number(bruto);
    await this.armazem.apagar(this.chaveUltimo(id)).catch(() => undefined);
    const adm = await this.lerPorId(id);
    if (!adm || !bool(adm.ativo))
      throw new ErroRecuperacaoPlataforma('conta-impedida', 409, 'A conta não está ativa.');
    const login = String(adm.login);
    const senha = gerarSenhaProvisoria(POLITICA_PROVISORIA_PLATAFORMA, login, (n) => randomInt(n));
    const cifra = await this.cifrar(senha);
    if (!cifra.startsWith('$argon2id$')) throw new Error('Resumo de senha fora do formato argon2id.');
    const agora = this.agora();
    await this.nucleo.escreverPlataforma(correlacao.slice(0, 64) || 'plataforma-recuperacao', async (e) => {
      const n = await e.executar(
        `UPDATE credencial_administrador_plataforma
            SET resumo_senha = ?, senha_alterada_em = ?, troca_obrigatoria = TRUE, tentativas_falhas = 0,
                bloqueado_ate = NULL, alterado_em = ?, alterado_por = ?, versao = versao + 1
          WHERE administrador_plataforma_id = ?`,
        [cifra, agora, agora, id, id],
      );
      if (n !== 1) throw new Error('Credencial do administrador da plataforma não encontrada.');
      await e.executar(
        `INSERT INTO credencial_administrador_evento
           (administrador_plataforma_id, tipo, origem_resumo, correlacao, ocorrido_em, criado_em)
         VALUES (?, 'senha_recuperada', ?, ?, ?, ?)`,
        [id, ip === null ? null : resumo(`origem\u0000${ip}`), correlacao.slice(0, 64) || null, agora, agora],
      );
    });
    return { senhaProvisoria: senha, trocaObrigatoria: true, login };
  }

  // ── Segundo fator por código no e-mail (escolhível ao lado do aplicativo) ──

  /** O método escolhido pelo administrador (sem credencial: null). */
  async metodoSegundoFator(id: number): Promise<MetodoSegundoFator | null> {
    const adm = await this.lerPorId(id);
    if (!adm) return null;
    return ehMetodoSegundoFator(adm.metodo_segundo_fator) ? adm.metodo_segundo_fator : 'aplicativo';
  }

  /** Troca o método (a sessão já reautenticada pelo chamador). O e-mail só vale com o envio montado. */
  async escolherMetodoSegundoFator(
    id: number,
    metodo: MetodoSegundoFator,
    ip: string | null,
    correlacao: string,
  ): Promise<void> {
    if (!ehMetodoSegundoFator(metodo))
      throw new ErroRecuperacaoPlataforma('entrada-invalida', 400, 'Método de segundo fator inválido.');
    if (metodo === 'email' && !this.codigos)
      throw new ErroRecuperacaoPlataforma('indisponivel', 503, 'Envio de e-mail indisponível.');
    const agora = this.agora();
    await this.nucleo.escreverPlataforma(correlacao.slice(0, 64) || 'plataforma-segundo-fator', async (e) => {
      const n = await e.executar(
        `UPDATE credencial_administrador_plataforma
            SET metodo_segundo_fator = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1
          WHERE administrador_plataforma_id = ?`,
        [metodo, agora, id, id],
      );
      if (n !== 1) throw new Error('Credencial do administrador da plataforma não encontrada.');
      await e.executar(
        `INSERT INTO credencial_administrador_evento
           (administrador_plataforma_id, tipo, origem_resumo, correlacao, ocorrido_em, criado_em)
         VALUES (?, 'segundo_fator_metodo_alterado', ?, ?, ?, ?)`,
        [id, ip === null ? null : resumo(`origem\u0000${ip}`), correlacao.slice(0, 64) || null, agora, agora],
      );
    });
  }

  /** O código por e-mail só vale para quem o escolheu: quem usa o aplicativo não troca por um fator mais fraco. */
  private exigirEmailEscolhido(adm: LinhaAdm): void {
    if (adm.metodo_segundo_fator !== 'email')
      throw new ErroRecuperacaoPlataforma(
        'metodo-nao-escolhido',
        409,
        'O código por e-mail não é o segundo fator escolhido nesta conta.',
      );
  }

  /** Envia o código ao e-mail do administrador (depois da senha conferida no login). */
  async emitirCodigo(id: number, ip: string | null, correlacao: string): Promise<{ validadeMinutos: number }> {
    if (!this.codigos) throw new ErroRecuperacaoPlataforma('indisponivel', 503, 'Envio de e-mail indisponível.');
    const adm = await this.lerPorId(id);
    if (!adm || !bool(adm.ativo))
      throw new ErroRecuperacaoPlataforma('conta-impedida', 409, 'A conta não está ativa.');
    this.exigirEmailEscolhido(adm);
    const r = await this.codigos.emitir(contaPlataforma(id), String(adm.email), 'Código de acesso da plataforma');
    await this.evento(id, 'codigo_email_enviado', ip, correlacao).catch(() => undefined);
    return r;
  }

  /** Confere o código (uso único; tentativas limitadas) e registra o desfecho na linha do tempo. */
  async conferirCodigo(
    id: number,
    codigo: string,
    ip: string | null,
    correlacao: string,
  ): Promise<DesfechoConferenciaCodigo> {
    if (!this.codigos) throw new ErroRecuperacaoPlataforma('indisponivel', 503, 'Envio de e-mail indisponível.');
    const adm = await this.lerPorId(id);
    if (!adm || !bool(adm.ativo))
      throw new ErroRecuperacaoPlataforma('conta-impedida', 409, 'A conta não está ativa.');
    this.exigirEmailEscolhido(adm);
    const r = await this.codigos.conferir(contaPlataforma(id), String(codigo ?? ''));
    await this.evento(id, r === 'ok' ? 'codigo_email_conferido' : 'codigo_email_recusado', ip, correlacao).catch(
      (e: unknown) =>
        this.aviso('plataforma: evento do código não gravado', { erro: e instanceof Error ? e.name : 'erro' }),
    );
    return r;
  }
}
