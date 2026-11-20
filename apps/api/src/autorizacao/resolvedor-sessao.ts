// Sessão da requisição (M05 + M06): a real, pelo cookie (com o bloqueio por inatividade aplicado), ou, só
// em dev/ci e sem cookie, a sintética dos testes. Cookie de sessão que não vale nunca cai na sintética.
import type { Sessao } from '@sgh/contratos';
import { CABECALHO_CSRF, COOKIE_CSRF, lerCookie, lerCookieSessao } from '../sessao/cookies.js';
import type { ResolvedorRede } from '../sessao/rede.js';
import type { RegistroComo, ServicoSessao } from '../sessao/servico-sessao.js';
import type { SessaoSintetica } from '../modulos/acesso/sessao-sintetica.js';

export interface RequisicaoComCabecalhos {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly ip?: string;
  readonly method?: string;
  readonly url?: string;
  /** ADR 0021: marca da sessão "como" (posta pela guarda); a estação da trilha nunca leva o IP do ator. */
  sghComo?: ComoResolvido;
}

/** A sessão "como" da requisição: só identificadores. */
export interface ComoResolvido extends RegistroComo {
  readonly rede: string;
  readonly hospital: string;
  readonly alvoLogin: string;
}

export const RESOLVEDOR_SESSAO = Symbol('RESOLVEDOR_SESSAO');

export class ResolvedorSessao {
  constructor(
    private readonly servico: ServicoSessao | null,
    private readonly sintetica: SessaoSintetica,
    private readonly resolvedorRede: ResolvedorRede,
    private readonly prefixoHost: boolean,
  ) {}

  rede(req: RequisicaoComCabecalhos): string | null {
    const host = req.headers['host'];
    return this.resolvedorRede.resolver(Array.isArray(host) ? host[0] : host);
  }

  idSessao(req: RequisicaoComCabecalhos): string | null {
    return lerCookieSessao(req.headers['cookie'] as string | undefined, this.prefixoHost);
  }

  /**
   * CSRF por token duplo da sessão real (M05): o cabeçalho X-CSRF igual ao cookie CSRF e ao token guardado
   * na sessão. A guarda exige em todo método que muda estado.
   */
  async csrfConfere(req: RequisicaoComCabecalhos): Promise<boolean> {
    const id = this.servico ? this.idSessao(req) : null;
    if (!this.servico || !id) return false;
    const doCookie = lerCookie(req.headers['cookie'] as string | undefined, COOKIE_CSRF);
    const bruto = req.headers[CABECALHO_CSRF];
    const doCabecalho = Array.isArray(bruto) ? bruto[0] : bruto;
    if (!doCookie || doCookie !== doCabecalho) return false;
    return this.servico.csrfConfere(id, this.rede(req), doCabecalho).catch(() => false);
  }

  /** null: sem sessão válida (a guarda responde 401). Erro do serviço sobe (503 pelo filtro). */
  async resolver(
    req: RequisicaoComCabecalhos,
  ): Promise<{ sessao: Sessao; real: boolean; como?: ComoResolvido } | null> {
    const rede = this.rede(req);
    const id = this.servico ? this.idSessao(req) : null;
    if (this.servico && id) {
      const lido = await this.servico.ler(id, rede);
      if (!lido) return null;
      const c = lido.registro.como;
      return {
        sessao: lido.sessao,
        real: true,
        ...(c
          ? {
              como: {
                ...c,
                rede: lido.registro.rede,
                hospital: lido.registro.estabelecimento,
                alvoLogin: lido.registro.login,
              },
            }
          : {}),
      };
    }
    if (rede && this.sintetica.disponivel()) return { sessao: await this.sintetica.atual(), real: false };
    return null;
  }
}
