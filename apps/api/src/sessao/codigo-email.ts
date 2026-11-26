// Família acesso-email, pedido do dono (23/11): SEGUNDO FATOR POR CÓDIGO NO E-MAIL, escolhível ao lado do aplicativo
// autenticador (TOTP), para usuários do cliente e para o administrador da plataforma.
//   - código de 6 dígitos (crypto.randomInt), validade curta (`VALIDADE_CODIGO_EMAIL_SEG`), uso único;
//   - guardado só como resumo SHA-256 (a chave do armazém é o resumo da conta + código: conferir = consumir a chave,
//     atômico, então um código certo vale uma vez só, mesmo com dois pedidos ao mesmo tempo);
//   - tentativas erradas limitadas por código (`TENTATIVAS_CODIGO_EMAIL`): no teto o código é descartado;
//   - envios limitados por conta e hora (`ENVIOS_CODIGO_EMAIL_HORA`); um código novo invalida o anterior e zera as
//     tentativas.
// O código nunca vai a log, trilha ou resposta; só ao e-mail da conta (captura local fora de produção, regra 6).
import { createHash, randomInt } from 'node:crypto';
import type { ArmazemSessao } from './armazem.js';
import { ENDERECO_EMAIL, type PortaEmailAcesso } from './email-acesso.js';

export const DIGITOS_CODIGO_EMAIL = 6;
export const VALIDADE_CODIGO_EMAIL_SEG = 5 * 60;
export const TENTATIVAS_CODIGO_EMAIL = 5;
export const ENVIOS_CODIGO_EMAIL_HORA = 5;
const HORA_SEG = 3600;

/** Os dois segundos fatores escolhíveis. */
export const METODOS_SEGUNDO_FATOR = ['aplicativo', 'email', 'dispositivo'] as const;
export type MetodoSegundoFator = (typeof METODOS_SEGUNDO_FATOR)[number];
export const ehMetodoSegundoFator = (v: unknown): v is MetodoSegundoFator =>
  typeof v === 'string' && (METODOS_SEGUNDO_FATOR as readonly string[]).includes(v);

export type RecusaCodigoEmail = 'muitos-envios' | 'sem-email' | 'metodo-nao-escolhido';

const MENSAGEM_RECUSA: Record<RecusaCodigoEmail, string> = {
  'muitos-envios': 'Muitos códigos pedidos; aguarde.',
  'sem-email': 'Conta sem e-mail cadastrado.',
  'metodo-nao-escolhido': 'O código por e-mail não é o segundo fator escolhido nesta conta.',
};

export class ErroCodigoEmail extends Error {
  constructor(readonly codigo: RecusaCodigoEmail) {
    super(MENSAGEM_RECUSA[codigo]);
    this.name = 'ErroCodigoEmail';
  }
}

export type DesfechoConferenciaCodigo = 'ok' | 'invalido' | 'esgotado';

const resumo = (s: string) => createHash('sha256').update(s).digest('hex');

/** Conta opaca do código: `usuario:<rede>:<estabelecimento>:<login>` ou `plataforma:<id>` (o chamador decide). */
export function contaUsuario(rede: string, estabelecimento: string, login: string): string {
  return `usuario:${rede}:${estabelecimento}:${login.trim().toUpperCase()}`;
}
export function contaPlataforma(idAdministrador: number): string {
  return `plataforma:${idAdministrador}`;
}

export class ServicoCodigoEmail {
  constructor(
    private readonly armazem: ArmazemSessao,
    private readonly email: PortaEmailAcesso,
    private readonly sortear: () => number = () => randomInt(0, 10 ** DIGITOS_CODIGO_EMAIL),
  ) {}

  private base(conta: string): string {
    return `segundo-fator-email:${resumo(conta)}`;
  }

  private chaveCodigo(conta: string, codigo: string): string {
    return `${this.base(conta)}:codigo:${resumo(`${conta}\u0000${codigo}`)}`;
  }

  /**
   * Gera e envia o código ao e-mail da conta. Lança ErroCodigoEmail ('sem-email' sem endereço válido; 'muitos-envios'
   * acima do limite por hora). A falha do servidor de e-mail propaga e o código é descartado.
   */
  async emitir(
    conta: string,
    para: string | null,
    assunto = 'Código de acesso',
  ): Promise<{ validadeMinutos: number }> {
    if (!para || !ENDERECO_EMAIL.test(para)) throw new ErroCodigoEmail('sem-email');
    const n = await this.armazem.incrementar(`${this.base(conta)}:envios`, HORA_SEG);
    if (n > ENVIOS_CODIGO_EMAIL_HORA) throw new ErroCodigoEmail('muitos-envios');
    const codigo = String(this.sortear()).padStart(DIGITOS_CODIGO_EMAIL, '0').slice(-DIGITOS_CODIGO_EMAIL);
    const chave = this.chaveCodigo(conta, codigo);
    const ultimo = `${this.base(conta)}:ultimo`;
    const anterior = await this.armazem.consumir(ultimo);
    if (anterior) await this.armazem.apagar(anterior);
    await this.armazem.apagar(`${this.base(conta)}:tentativas`);
    await this.armazem.gravar(chave, '1', VALIDADE_CODIGO_EMAIL_SEG);
    await this.armazem.gravar(ultimo, chave, VALIDADE_CODIGO_EMAIL_SEG);
    const minutos = VALIDADE_CODIGO_EMAIL_SEG / 60;
    try {
      await this.email.enviar({
        para,
        assunto,
        texto:
          `Seu código de acesso é ${codigo}.\n\nEle vale por ${minutos} minutos e uma vez só. ` +
          'Se não foi você quem tentou entrar, troque a senha e avise o gestor de acessos.\n',
      });
    } catch (e) {
      await this.armazem.apagar(chave).catch(() => undefined);
      await this.armazem.apagar(ultimo).catch(() => undefined);
      throw e;
    }
    return { validadeMinutos: minutos };
  }

  /** Confere (e consome) o código. No teto de tentativas, o código vivo é descartado ('esgotado'). */
  async conferir(conta: string, codigo: string): Promise<DesfechoConferenciaCodigo> {
    const tentativas = `${this.base(conta)}:tentativas`;
    const n = await this.armazem.incrementar(tentativas, VALIDADE_CODIGO_EMAIL_SEG);
    if (n > TENTATIVAS_CODIGO_EMAIL) {
      await this.descartar(conta);
      return 'esgotado';
    }
    if (!/^\d{6}$/.test(codigo)) return 'invalido';
    const usado = await this.armazem.consumir(this.chaveCodigo(conta, codigo));
    if (!usado) return 'invalido';
    await this.armazem.apagar(`${this.base(conta)}:ultimo`).catch(() => undefined);
    await this.armazem.apagar(tentativas).catch(() => undefined);
    return 'ok';
  }

  /** Descarta o código vivo da conta (ex.: a sessão desistiu do login). */
  async descartar(conta: string): Promise<void> {
    const anterior = await this.armazem.consumir(`${this.base(conta)}:ultimo`);
    if (anterior) await this.armazem.apagar(anterior);
  }
}
