// Entrada com certificado ICP-Brasil (M49, etapa 3; "login por certificado", opcional na ficha; DOC-ICP-15; SBIS-31).
// O certificado A1/A3 do usuário assina, no agente local da estação, o hash de um DESAFIO de uso único (a chave nunca
// sai do computador); o servidor confere: o desafio (o mesmo, no prazo, uma vez só), a assinatura do hash, a cadeia até
// a raiz ICP-Brasil, a vigência, a revogação (LCR), o KeyUsage, o CPF do certificado igual ao do usuário (regra 2) e que
// o certificado é um dos VINCULADOS ativos da conta (tela "Meu certificado"). Só então a porta de entrada abre a sessão,
// a mesma de sempre (sem a senha). Desligada pela chave `acesso.loginCertificado` até o teste de invasão e o agente local
// escolhido (POL-3). Toda recusa vai à trilha (`sessao.login.certificado-falho`) sem CPF nem certificado; as recusas
// da conferência são limitadas por conta (normalizada) e a emissão de desafios por origem: pedir desafios sem
// responder não bloqueia a conta de ninguém. O desafio é consumido de forma atômica (GETDEL). O certificado em nuvem continua entrando pela senha e pelo segundo fator (D-LOGIN-CERT-49).
import { createHash, randomBytes } from 'node:crypto';
import {
  type DesafioLoginCertificado,
  type DisponibilidadeLoginCertificado,
  EVENTOS_AUDITAVEIS,
  type RespostaAgenteLocal,
} from '@sgh/contratos';
import { conferirRespostaAgente, criarDesafio, origemDaTaxa } from '@sgh/dominio-documento';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { ArmazemSessao } from '../../../sessao/armazem.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import { ligadaNoEstabelecimento } from '../../sadt/aplicacao/liberacao.js';
import type { PortaAssinaturaIcp } from '../porta.js';
import { cpfCruzadoDiverge, type ServicoAssinaturaIcp } from './servico.js';

export const CHAVE_LOGIN_CERTIFICADO = 'acesso.loginCertificado';
/** Validade do desafio da entrada (segundos): o tempo de o agente pedir o PIN do A3. */
export const VALIDADE_DESAFIO_LOGIN_SEG = 120;
/**
 * Recusas da conferência por conta em 10 minutos (o desafio vencido ou inexistente não conta): passou disso, a conta
 * fica sem entrada com certificado até o prazo. Pedir desafio NÃO conta (senão qualquer um bloquearia a conta alheia).
 */
export const TENTATIVAS_LOGIN_CERTIFICADO = 10;
/** Desafios emitidos por origem (IPv4 inteiro, IPv6 /64) em 10 minutos. */
export const DESAFIOS_POR_ORIGEM_LOGIN_CERTIFICADO = 30;
const JANELA_TENTATIVAS_SEG = 600;

/** A conta como a entrada com senha compara (sem espaços nas pontas, em maiúsculas): um contador só por usuário. */
const contaNormalizada = (login: string) => login.trim().toUpperCase();
const resumoOrigem = (ip: string | null | undefined) =>
  createHash('sha256')
    .update(`login-certificado:${origemDaTaxa(ip)}`)
    .digest('hex')
    .slice(0, 32);

export type MotivoLoginCertificado =
  | 'desafio-expirado'
  | 'resposta-invalida'
  | 'certificado-nao-vinculado'
  | 'cpf-divergente'
  | 'validacao-invalida'
  | 'validacao-indeterminada';

interface DesafioGuardado {
  readonly estabelecimento: string;
  readonly login: string;
  readonly hash: string;
  readonly expiraEm: string;
}

const resumo = (s: string) => createHash('sha256').update(s).digest('hex');
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));

export interface OrigemLogin {
  readonly estacao: string;
  readonly correlacao: string;
}

export class ServicoLoginCertificado {
  private readonly agora: () => Date;

  constructor(
    private readonly icp: ServicoAssinaturaIcp,
    private readonly porta: PortaAssinaturaIcp,
    private readonly armazem: ArmazemSessao,
    private readonly configuracao: FonteConfiguracao | null,
    private readonly trilha: RegistradorTrilha | null,
    agora?: () => Date,
  ) {
    this.agora = agora ?? (() => new Date());
  }

  private get agenteLocal(): string | null {
    return this.icp.modo === 'desligado' ? null : this.icp.cfg.agenteLocal;
  }

  private async ligada(rede: string, estabelecimento: string, login: string): Promise<boolean> {
    return ligadaNoEstabelecimento(this.configuracao, rede, estabelecimento, CHAVE_LOGIN_CERTIFICADO, login);
  }

  /** O botão "Entrar com certificado" aparece? (a chave no estabelecimento e o agente local configurado) */
  async disponivel(rede: string, estabelecimento: string): Promise<DisponibilidadeLoginCertificado> {
    const agente = this.agenteLocal;
    if (!agente || !/^[a-z0-9]{1,10}$/.test(estabelecimento)) return { disponivel: false, agenteLocal: null };
    const ok = await this.ligada(rede, estabelecimento, '');
    return { disponivel: ok, agenteLocal: ok ? agente : null };
  }

  private chaveTentativas(rede: string, estabelecimento: string, login: string): string {
    return `${rede}:login-certificado:tentativas:${estabelecimento}:${contaNormalizada(login)}`;
  }

  private muitasTentativas(): ErroProblema {
    return new ErroProblema(
      'muitas-tentativas',
      429,
      'Muitas tentativas',
      'Aguarde alguns minutos e tente de novo.',
    );
  }

  private async bloqueada(rede: string, estabelecimento: string, login: string): Promise<boolean> {
    const n = Number((await this.armazem.obter(this.chaveTentativas(rede, estabelecimento, login))) ?? 0);
    return Number.isFinite(n) && n >= TENTATIVAS_LOGIN_CERTIFICADO;
  }

  private async falha(
    rede: string,
    estabelecimento: string,
    login: string,
    origem: OrigemLogin,
    motivo: MotivoLoginCertificado,
  ): Promise<never> {
    // Só a recusa de uma resposta a um desafio válido da conta conta para o limite (o vencido não).
    if (motivo !== 'desafio-expirado')
      await this.armazem
        .incrementar(this.chaveTentativas(rede, estabelecimento, login), JANELA_TENTATIVAS_SEG)
        .catch(() => undefined);
    await this.trilha
      ?.registrar({
        evento: EVENTOS_AUDITAVEIS.loginCertificadoFalho.codigo,
        rede,
        hospital: estabelecimento,
        usuario: login.slice(0, 31),
        estacao: origem.estacao,
        correlacao: origem.correlacao,
        recurso: 'acesso.sessao',
        resultado: 'falha',
        chaveNaturalAlvo: `certificado:${motivo}`,
      })
      .catch(() => undefined);
    throw new ErroProblema(
      'nao-autenticado',
      401,
      'Entrada com certificado recusada',
      motivo === 'desafio-expirado'
        ? 'O pedido expirou. Tente de novo.'
        : 'Não foi possível entrar com este certificado. Confira se ele está vinculado à sua conta e válido.',
      { motivo } as never,
    );
  }

  /** O desafio de uso único (o hash que o agente local assina), guardado no armazém das sessões até o prazo. */
  async desafio(
    rede: string,
    e: { estabelecimento: string; login: string },
    ip: string | null = null,
  ): Promise<DesafioLoginCertificado> {
    const agente = this.agenteLocal;
    if (!agente || !(await this.ligada(rede, e.estabelecimento, e.login)))
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Entrada com certificado indisponível',
        'A entrada com certificado ainda não foi liberada neste estabelecimento. Entre com a senha.',
        { codigo: 'recurso-desligado' } as never,
      );
    // Emissão limitada por origem (não por conta): quem pede desafios em série só esgota a própria cota.
    const porOrigem = await this.armazem.incrementar(
      `${rede}:login-certificado:desafios:${resumoOrigem(ip)}`,
      JANELA_TENTATIVAS_SEG,
    );
    if (porOrigem > DESAFIOS_POR_ORIGEM_LOGIN_CERTIFICADO) throw this.muitasTentativas();
    if (await this.bloqueada(rede, e.estabelecimento, e.login)) throw this.muitasTentativas();
    const agora = this.agora();
    // O hash é de um texto que diz o que se autoriza (entrada, estabelecimento, conta e instante) e de um nonce.
    const hash = resumo(
      `Sante SGH: entrada com certificado no estabelecimento ${e.estabelecimento} pela conta ${e.login} em ${agora.toISOString()} (${randomBytes(16).toString('hex')})`,
    );
    const d = criarDesafio([hash], agora, VALIDADE_DESAFIO_LOGIN_SEG);
    const guardado: DesafioGuardado = {
      estabelecimento: e.estabelecimento,
      login: e.login,
      hash,
      expiraEm: d.expiraEm.toISOString(),
    };
    await this.armazem.gravar(
      `${rede}:login-certificado:desafio:${resumo(d.desafio)}`,
      JSON.stringify(guardado),
      VALIDADE_DESAFIO_LOGIN_SEG + 10,
    );
    return {
      tipo: 'agente-local',
      desafio: d.desafio,
      hashes: d.hashes,
      algoritmo: 'sha256',
      expiraEm: d.expiraEm.toISOString(),
      agenteLocal: agente,
    };
  }

  /**
   * A resposta do agente: consome o desafio (uma vez só) e confere tudo no servidor. Devolve a conta para a porta de
   * entrada abrir a sessão; qualquer recusa vai à trilha e responde 401 sem dizer qual conferência falhou ao navegador
   * além de "expirou".
   */
  async conferir(
    rede: string,
    r: RespostaAgenteLocal,
    origem: OrigemLogin,
  ): Promise<{ estabelecimento: string; login: string }> {
    const chave = `${rede}:login-certificado:desafio:${resumo(r.desafio)}`;
    // Uso único atômico: de dois pedidos simultâneos com a mesma resposta, só um recebe o desafio.
    const bruto = await this.armazem.consumir(chave);
    if (!bruto) return this.falha(rede, '-', '(desconhecido)', origem, 'desafio-expirado');
    const g = JSON.parse(bruto) as DesafioGuardado;
    // A conta que passou do limite de recusas fica de fora até o prazo, mesmo com um desafio emitido antes.
    if (await this.bloqueada(rede, g.estabelecimento, g.login)) throw this.muitasTentativas();
    const f = (m: MotivoLoginCertificado) => this.falha(rede, g.estabelecimento, g.login, origem, m);
    const conf = conferirRespostaAgente(
      { desafio: r.desafio, hashes: [g.hash], criadoEm: this.agora(), expiraEm: new Date(g.expiraEm) },
      r,
      this.agora(),
    );
    if (!conf.ok) return f(conf.motivo === 'desafio-expirado' ? 'desafio-expirado' : 'resposta-invalida');
    const ctx = { rede, hospital: g.estabelecimento };
    const indisponivel = () => {
      throw new ErroProblema('indisponivel', 503, 'Serviço indisponível', 'Tente de novo em instantes.');
    };
    const [lista, ident] = await Promise.all([
      this.porta.certificados(ctx, g.login),
      this.porta.identidade(ctx, g.login),
    ]).catch(indisponivel);
    // Só o A1/A3 vinculado e ativo da conta (o certificado em nuvem entra pela senha e pelo segundo fator); a lista
    // não traz a parte pública: cada candidato é relido inteiro (até 10).
    let cert = null;
    for (const c of lista.filter((x) => x.ativo && x.midia !== 'nuvem').slice(0, 10)) {
      const inteiro = await this.porta.certificado(ctx, c.id).catch(indisponivel);
      if (inteiro?.ativo && inteiro.usuario === g.login && inteiro.certificadoDer === r.certificado) {
        cert = inteiro;
        break;
      }
    }
    if (!cert) return f('certificado-nao-vinculado');
    if (!ident?.cpf || cpfCruzadoDiverge(ident)) return f('cpf-divergente');
    let v: Awaited<ReturnType<ServicoAssinaturaIcp['validar']>>;
    try {
      v = await this.icp.validar({
        certificadoDer: b64(r.certificado),
        hash: g.hash,
        assinatura: b64(conf.porHash.get(g.hash) ?? ''),
        politica: 'AD-RB',
        cpfDoUsuario: ident.cpf,
      });
    } catch {
      return f('resposta-invalida');
    }
    if (v.cpf === false) return f('cpf-divergente');
    if (v.resultado !== 'valida')
      return f(v.resultado === 'indeterminada' ? 'validacao-indeterminada' : 'validacao-invalida');
    return { estabelecimento: g.estabelecimento, login: g.login };
  }
}
