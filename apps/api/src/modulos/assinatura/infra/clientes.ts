// Clientes externos do serviço de assinatura (M49, etapa 1): o provedor em nuvem (PSC, DOC-ICP-17.01 v3.0, item 6.4:
// OAuth 2.0 com PKCE sobre TLS, API v0), a autoridade de carimbo do tempo (ACT, RFC 3161 por HTTP) e a lista de
// revogação (LCR por HTTP). Só HASHES saem do servidor; o segredo do provedor vem do cofre e só passa no corpo da
// troca do código. Falha de rede, tempo esgotado ou 5xx é INDISPONÍVEL (a assinatura fica pendente e é reprocessada,
// regra 5); a resposta 4xx volta como veio, para a conferência recusar. Nada daqui vai a log com o corpo.
import { corpoAssinatura, corpoTroca, type ConfiguracaoPsc, type ItemHash } from '@sgh/dominio-documento';

export class ErroIndisponivel extends Error {
  override readonly name = 'ErroIndisponivel';
  readonly fonte: 'psc' | 'act' | 'lcr';
  constructor(fonte: 'psc' | 'act' | 'lcr', mensagem: string) {
    super(mensagem);
    this.fonte = fonte;
  }
}

export interface ClientePsc {
  /** Troca o código da volta do OAuth pelo token (o segredo do cofre vai só aqui). */
  trocarCodigo(
    cfg: ConfiguracaoPsc,
    p: { codigo: string; verificador: string; segredo: string },
  ): Promise<unknown>;
  /** Os certificados do titular autorizado (para vincular o certificado em nuvem). */
  descobrirCertificados(cfg: ConfiguracaoPsc, token: string): Promise<unknown>;
  /** A assinatura de cada HASH (formato cru: a assinatura PKCS#1 do hash; o envelope é do serviço). */
  assinar(cfg: ConfiguracaoPsc, token: string, itens: readonly ItemHash[], alias: string): Promise<unknown>;
  /** O provedor responde (teste de conexão da tela de provedores). */
  testar(cfg: ConfiguracaoPsc): Promise<boolean>;
}

export interface ClienteAct {
  /** TimeStampReq (DER) → TimeStampResp (DER). */
  carimbar(pedido: Uint8Array): Promise<Uint8Array>;
}

export interface BuscadorLcr {
  buscar(endereco: string): Promise<Uint8Array>;
}

const TEMPO_MS = 10_000;

async function chamar(fonte: 'psc' | 'act' | 'lcr', url: string, init: RequestInit): Promise<Response> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TEMPO_MS) });
  } catch {
    throw new ErroIndisponivel(fonte, `${fonte} sem resposta`);
  }
  if (r.status >= 500) throw new ErroIndisponivel(fonte, `${fonte} respondeu ${r.status}`);
  return r;
}

const json = async (r: Response): Promise<unknown> => {
  try {
    return await r.json();
  } catch {
    return {};
  }
};

const base = (u: string) => u.replace(/\/+$/, '');

/** Cliente HTTP do PSC (produção): só https (a configuração do provedor já exige https terminado em /v0). */
export const clientePscHttp: ClientePsc = {
  async trocarCodigo(cfg, p) {
    const t = corpoTroca(cfg, p);
    return json(
      await chamar('psc', t.endereco, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: t.corpo,
      }),
    );
  },
  async descobrirCertificados(cfg, token) {
    return json(
      await chamar('psc', `${base(cfg.uriBase)}/oauth/certificate-discovery`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      }),
    );
  },
  async assinar(cfg, token, itens, alias) {
    const a = corpoAssinatura(cfg, itens);
    return json(
      await chamar('psc', a.endereco, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ certificate_alias: alias, ...a.corpo }),
      }),
    );
  },
  async testar(cfg) {
    try {
      const r = await chamar('psc', `${base(cfg.uriBase)}/oauth/authorize`, { method: 'HEAD' });
      return r.status < 500;
    } catch {
      return false;
    }
  },
};

export function clienteActHttp(endereco: string): ClienteAct {
  return {
    async carimbar(pedido) {
      const r = await chamar('act', endereco, {
        method: 'POST',
        headers: { 'content-type': 'application/timestamp-query', accept: 'application/timestamp-reply' },
        body: Buffer.from(pedido),
      });
      if (r.status !== 200) throw new ErroIndisponivel('act', `act respondeu ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}

/** LCR por HTTP com cache em memória até a próxima atualização (o chamador decide a validade pela própria LCR). */
export function buscadorLcrHttp(validadeCacheMs = 30 * 60_000): BuscadorLcr {
  const cache = new Map<string, { der: Uint8Array; ate: number }>();
  return {
    async buscar(endereco) {
      if (!/^https?:\/\//.test(endereco)) throw new ErroIndisponivel('lcr', 'endereço da LCR inválido');
      const c = cache.get(endereco);
      if (c && c.ate > Date.now()) return c.der;
      const r = await chamar('lcr', endereco, { method: 'GET' });
      if (r.status !== 200) throw new ErroIndisponivel('lcr', `lcr respondeu ${r.status}`);
      const der = new Uint8Array(await r.arrayBuffer());
      cache.set(endereco, { der, ate: Date.now() + validadeCacheMs });
      return der;
    },
  };
}
