// Simulador do provedor em nuvem (PSC), da ACT e da LCR (M49, etapa 1; ficha, seções 10 e 13: "na cópia, com
// certificados de teste e simulador do PSC"). SÓ dev/ci: a ICP é a sintética de @sgh/dominio-documento (raiz "AC RAIZ
// SINTETICA SANTE", que nenhum validador de produção aceita). Faz o papel do PSC de ponta a ponta, pelo mesmo contrato
// do cliente HTTP: a página de autorização (o titular digita o CPF, como no provedor de verdade), o código de uso único
// amarrado ao `code_challenge` (PKCE S256), o token com o titular autorizado, a descoberta do certificado e a assinatura
// crua de cada hash. A ACT responde ao TimeStampReq com o token assinado; a LCR sai assinada pela raiz. Cada fonte
// pode ser posta "fora do ar" (regra 5, teste do reprocessamento). O segredo esperado é o que o cofre guarda.
import { createHash, randomBytes } from 'node:crypto';
import {
  assinarHashRsa,
  carimbarSintetico,
  type ConfiguracaoPsc,
  cpfValido,
  criarRaizSintetica,
  desafioDe,
  emitirLcrSintetica,
  emitirSintetico,
  type EntidadeSintetica,
  hex,
  lerPedidoCarimbo,
} from '@sgh/dominio-documento';
import { type BuscadorLcr, type ClienteAct, type ClientePsc, ErroIndisponivel } from './clientes.js';

export const CODIGO_PROVEDOR_SIMULADO = 'simulador';
export const URI_SIMULADOR = 'https://simulador-psc.invalid/v0';
export const CLIENT_ID_SIMULADOR = 'sante-simulador';
export const LCR_SIMULADOR = 'https://simulador-icp.invalid/lcr.crl';
/** Onde o navegador abre a página de autorização do simulador (pela própria API, só dev/ci). */
export const ROTA_NAVEGADOR_SIMULADOR = '/api/documento/simulador-psc/v0';

interface CodigoEmitido {
  readonly cpf: string;
  readonly redirect: string;
  readonly desafio: string;
  readonly escopo: string;
  readonly expira: number;
}

export interface ParametrosAutorizacao {
  readonly response_type?: string;
  readonly client_id?: string;
  readonly redirect_uri?: string;
  readonly scope?: string;
  readonly state?: string;
  readonly code_challenge?: string;
  readonly code_challenge_method?: string;
}

export class SimuladorIcp {
  private raizGerada: EntidadeSintetica | null = null;
  private actGerada: EntidadeSintetica | null = null;
  readonly foraDoAr = { psc: false, act: false, lcr: false };
  private readonly titulares = new Map<string, EntidadeSintetica>();
  private readonly codigos = new Map<string, CodigoEmitido>();
  private readonly tokens = new Map<string, { cpf: string; escopo: string; expira: number }>();
  private readonly revogados = new Set<string>();

  constructor(
    /** O segredo que o simulador aceita (o que foi gravado no cofre na partida). */
    private readonly segredoEsperado: () => Promise<string | null>,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /** O segredo da partida, para o serviço gravá-lo na referência do cofre de cada estabelecimento (só dev/ci). */
  segredoDaPartida(): Promise<string | null> {
    return this.segredoEsperado();
  }

  /** A raiz e a ACT sintéticas nascem no primeiro uso (a partida da API não gera chave RSA à toa). */
  get raiz(): EntidadeSintetica {
    this.raizGerada ??= criarRaizSintetica(this.agora());
    return this.raizGerada;
  }

  get act(): EntidadeSintetica {
    this.actGerada ??= emitirSintetico(this.raiz, { cpf: null, carimbo: true }, this.agora());
    return this.actGerada;
  }

  /** O certificado sintético do titular do CPF (o mesmo em todas as chamadas da partida). */
  titular(cpf: string): EntidadeSintetica {
    let t = this.titulares.get(cpf);
    if (!t) {
      t = emitirSintetico(this.raiz, { cpf, lcr: LCR_SIMULADOR, nome: 'TITULAR SINTETICO' }, this.agora());
      this.titulares.set(cpf, t);
    }
    return t;
  }

  private readonly agentes = new Map<string, EntidadeSintetica>();

  /**
   * M49, etapa 3: o certificado "A3" sintético do titular no agente local SIMULADO (outro par de chaves que o da nuvem,
   * o mesmo em toda a partida). Só dev/ci: o E2E faz o papel do agente das estações por ele.
   */
  agente(cpf: string): EntidadeSintetica {
    let t = this.agentes.get(cpf);
    if (!t) {
      t = emitirSintetico(this.raiz, { cpf, lcr: LCR_SIMULADOR, nome: 'TITULAR SINTETICO A3' }, this.agora());
      this.agentes.set(cpf, t);
    }
    return t;
  }

  /** O agente local simulado assina cada hash do desafio com a chave do titular (a chave nunca sai do simulador). */
  assinarNoAgente(
    cpf: string,
    hashes: readonly string[],
  ): { assinaturas: { hash: string; assinatura: string }[]; certificado: string } {
    const t = this.agente(cpf);
    return {
      assinaturas: hashes.map((h) => ({
        hash: h,
        assinatura: Buffer.from(assinarHashRsa(t.chave, Buffer.from(h, 'hex'))).toString('base64'),
      })),
      certificado: Buffer.from(t.certificado).toString('base64'),
    };
  }

  revogar(cpf: string): void {
    this.revogados.add(hex(this.titular(cpf).serie));
  }

  /** A página do simulador confirmou: devolve o endereço de volta com o código (ou o erro do OAuth). */
  autorizar(p: ParametrosAutorizacao, cpf: string): string {
    const volta = p.redirect_uri ?? '';
    if (!volta.startsWith('/') && !/^https:\/\//.test(volta)) throw new Error('redirect_uri inválido.');
    const q = new URLSearchParams({ state: p.state ?? '' });
    if (
      p.response_type !== 'code' ||
      p.client_id !== CLIENT_ID_SIMULADOR ||
      p.code_challenge_method !== 'S256' ||
      !p.code_challenge ||
      !cpfValido(cpf.replace(/\D/g, ''))
    ) {
      q.set('error', 'access_denied');
      return `${volta}?${q.toString()}`;
    }
    const codigo = randomBytes(24).toString('base64url');
    this.codigos.set(codigo, {
      cpf: cpf.replace(/\D/g, ''),
      redirect: volta,
      desafio: p.code_challenge,
      escopo: p.scope ?? 'single_signature',
      expira: this.agora().getTime() + 5 * 60_000,
    });
    q.set('code', codigo);
    return `${volta}?${q.toString()}`;
  }

  private exigirNoAr(): void {
    if (this.foraDoAr.psc) throw new ErroIndisponivel('psc', 'simulador do provedor fora do ar');
  }

  readonly psc: ClientePsc = {
    trocarCodigo: async (cfg: ConfiguracaoPsc, p) => {
      this.exigirNoAr();
      const c = this.codigos.get(p.codigo);
      this.codigos.delete(p.codigo);
      const esperado = await this.segredoEsperado();
      if (
        !c ||
        c.expira < this.agora().getTime() ||
        cfg.clientId !== CLIENT_ID_SIMULADOR ||
        c.redirect !== cfg.retorno ||
        desafioDe(p.verificador) !== c.desafio ||
        !esperado ||
        p.segredo !== esperado
      )
        return { error: 'invalid_grant' };
      const token = randomBytes(24).toString('base64url');
      this.tokens.set(token, { cpf: c.cpf, escopo: c.escopo, expira: this.agora().getTime() + 10 * 60_000 });
      return {
        access_token: token,
        token_type: 'Bearer',
        expires_in: 600,
        scope: c.escopo,
        authorized_identification_type: 'CPF',
        authorized_identification: c.cpf,
      };
    },
    descobrirCertificados: async (_cfg, token) => {
      this.exigirNoAr();
      const t = this.tokens.get(token);
      if (!t) return { error: 'invalid_token' };
      return {
        status: 'S',
        certificates: [
          {
            alias: 'principal',
            certificate: Buffer.from(this.titular(t.cpf).certificado).toString('base64'),
          },
        ],
      };
    },
    assinar: async (_cfg, token, itens, alias) => {
      this.exigirNoAr();
      const t = this.tokens.get(token);
      if (!t || t.expira < this.agora().getTime()) return { error: 'invalid_token' };
      // O token de uma assinatura só serve uma vez (single_signature).
      if (t.escopo === 'single_signature') this.tokens.delete(token);
      const titular = this.titular(t.cpf);
      return {
        certificate_alias: alias,
        signatures: itens.map((i) => ({
          id: i.id,
          raw_signature: Buffer.from(assinarHashRsa(titular.chave, Buffer.from(i.hashHex, 'hex'))).toString(
            'base64',
          ),
        })),
      };
    },
    testar: async (cfg) => !this.foraDoAr.psc && cfg.clientId === CLIENT_ID_SIMULADOR,
  };

  readonly carimbo: ClienteAct = {
    carimbar: async (pedido) => {
      if (this.foraDoAr.act) throw new ErroIndisponivel('act', 'simulador da ACT fora do ar');
      return carimbarSintetico(this.act, this.raiz.nome, lerPedidoCarimbo(pedido), this.agora());
    },
  };

  readonly lcr: BuscadorLcr = {
    buscar: async (endereco) => {
      if (this.foraDoAr.lcr || endereco !== LCR_SIMULADOR)
        throw new ErroIndisponivel('lcr', 'simulador da LCR fora do ar');
      return emitirLcrSintetica(this.raiz, [...this.revogados], this.agora());
    },
  };

  /** Raízes que o validador aceita no modo simulador (só a sintética). */
  raizes(): Uint8Array[] {
    return [this.raiz.certificado];
  }
}

/** Resumo SHA-256 em hex (state, desafio): o valor em claro nunca é guardado. */
export const resumo = (s: string) => createHash('sha256').update(s).digest('hex');
