// Prestador de serviço de pagamento do Pix (07-FIN linha 90): a API Pix do Banco Central é a mesma em todos os
// prestadores; o prestador contratado é configuração por cliente e as credenciais ficam no cofre de segredos.
// - Fora de produção: o simulador (nenhuma rede; QR e devolução sintéticos, marcados como simulados).
// - Produção: pela central de integrações (entrada `pix`), o adaptador da API Pix padronizada (PUT /cob/{txid}, PUT /cobv/{txid}, PATCH para remover e
//   PUT /pix/{e2eid}/devolucao/{id}), com token OAuth2 (client credentials). O transporte com o certificado do cliente
//   (TLS mútuo) vem do certificado A1 guardado no cofre. Sem configuração, falha fechada: nada é cobrado.
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { montarBrCodePix } from '@sgh/dominio-financeiro';
import { type ModoDaIntegracao, modoDaIntegracao } from '../integracao/externas/servico.js';

export interface PedidoCobrancaProvedor {
  readonly txid: string;
  readonly modalidade: 'imediata' | 'com_vencimento';
  readonly chave: string;
  readonly valor: number;
  readonly descricao: string | null;
  readonly vencimento: string | null;
  readonly validadeSegundos: number | null;
  readonly pagadorNome: string | null;
  readonly pagadorDocumento: string | null;
  readonly recebedorNome: string;
}
export interface CobrancaNoProvedor {
  readonly localizacao: string | null;
  readonly copiaECola: string;
  readonly revisao: number;
  /** O prestador que atendeu é o simulador (a central decide a cada chamada). */
  readonly simulado?: boolean;
}
export interface DevolucaoNoProvedor {
  readonly fimAFimDevolucao: string | null;
  readonly situacao: 'em_processamento' | 'devolvida' | 'nao_realizada';
  readonly motivo: string | null;
}
export interface ProvedorPix {
  readonly simulado: boolean;
  criarCobranca(p: PedidoCobrancaProvedor): Promise<CobrancaNoProvedor>;
  removerCobranca(txid: string, modalidade: 'imediata' | 'com_vencimento'): Promise<void>;
  devolver(
    fimAFim: string,
    idDevolucao: string,
    valor: number,
    descricao: string,
  ): Promise<DevolucaoNoProvedor>;
}

/** O simulador: QR estático com a chave e o txid (o CRC confere; nenhum banco recebe). */
export class ProvedorPixSimulado implements ProvedorPix {
  readonly simulado = true;
  async criarCobranca(p: PedidoCobrancaProvedor): Promise<CobrancaNoProvedor> {
    return {
      localizacao: `pix.simulado.invalid/qr/v2/${p.txid}`,
      copiaECola: montarBrCodePix({
        chave: p.chave,
        valor: p.valor,
        nomeRecebedor: `SIMULADO ${p.recebedorNome}`,
        cidade: 'SIMULADO',
        txid: p.txid,
      }),
      revisao: 0,
    };
  }
  async removerCobranca(): Promise<void> {}
  async devolver(fimAFim: string, idDevolucao: string): Promise<DevolucaoNoProvedor> {
    const d = `D${fimAFim.slice(1, 21)}${idDevolucao
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(-11)
      .padStart(11, '0')}`;
    return { fimAFimDevolucao: d.slice(0, 32), situacao: 'devolvida', motivo: null };
  }
}

export interface ConfigApiPix {
  readonly urlBase: string;
  readonly urlToken: string;
  readonly clienteId: string;
  readonly clienteSegredo: string;
  /** O transporte com o certificado do cliente (TLS mútuo); padrão: o fetch global. */
  readonly transporte?: TransportePix;
}

/** O mínimo de HTTP que o adaptador usa (o fetch global atende; o TLS mútuo vem de transporteTlsMutuo). */
export type TransportePix = (
  url: string,
  init: { readonly method: string; readonly headers: Record<string, string>; readonly body: string },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

/** O adaptador da API Pix padronizada do Banco Central. */
export class ProvedorPixApiBacen implements ProvedorPix {
  readonly simulado = false;
  private token: { valor: string; expira: number } | null = null;
  constructor(private readonly cfg: ConfigApiPix) {}

  private get transporte(): TransportePix {
    return this.cfg.transporte ?? fetch;
  }

  private async acesso(): Promise<string> {
    if (this.token && this.token.expira > Date.now() + 30_000) return this.token.valor;
    const r = await this.transporte(this.cfg.urlToken, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${this.cfg.clienteId}:${this.cfg.clienteSegredo}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });
    if (!r.ok) throw new Error(`O prestador Pix recusou o acesso (HTTP ${r.status}).`);
    const j = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error('O prestador Pix não devolveu o token de acesso.');
    this.token = { valor: j.access_token, expira: Date.now() + (j.expires_in ?? 300) * 1000 };
    return j.access_token;
  }

  private async chamar(metodo: string, caminho: string, corpo: unknown): Promise<Record<string, unknown>> {
    const r = await this.transporte(`${this.cfg.urlBase.replace(/\/$/, '')}${caminho}`, {
      method: metodo,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.acesso()}` },
      body: JSON.stringify(corpo),
    });
    if (!r.ok)
      throw new Error(`O prestador Pix recusou ${metodo} ${caminho.split('/')[1]} (HTTP ${r.status}).`);
    return (await r.json()) as Record<string, unknown>;
  }

  async criarCobranca(p: PedidoCobrancaProvedor): Promise<CobrancaNoProvedor> {
    const doc = (p.pagadorDocumento ?? '').replace(/\D/g, '');
    const devedor =
      doc && p.pagadorNome ? { nome: p.pagadorNome, [doc.length === 14 ? 'cnpj' : 'cpf']: doc } : undefined;
    const corpo =
      p.modalidade === 'imediata'
        ? {
            calendario: { expiracao: p.validadeSegundos ?? 86_400 },
            ...(devedor ? { devedor } : {}),
            valor: { original: p.valor.toFixed(2) },
            chave: p.chave,
            ...(p.descricao ? { solicitacaoPagador: p.descricao.slice(0, 140) } : {}),
          }
        : {
            calendario: { dataDeVencimento: p.vencimento, validadeAposVencimento: 30 },
            devedor,
            valor: { original: p.valor.toFixed(2) },
            chave: p.chave,
            ...(p.descricao ? { solicitacaoPagador: p.descricao.slice(0, 140) } : {}),
          };
    const j = await this.chamar('PUT', `/${p.modalidade === 'imediata' ? 'cob' : 'cobv'}/${p.txid}`, corpo);
    const loc = j['loc'] as Record<string, unknown> | undefined;
    return {
      localizacao: loc?.['location'] ? String(loc['location']) : null,
      copiaECola: String(j['pixCopiaECola'] ?? ''),
      revisao: Number(j['revisao'] ?? 0),
    };
  }

  async removerCobranca(txid: string, modalidade: 'imediata' | 'com_vencimento'): Promise<void> {
    await this.chamar('PATCH', `/${modalidade === 'imediata' ? 'cob' : 'cobv'}/${txid}`, {
      status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR',
    });
  }

  async devolver(fimAFim: string, idDevolucao: string, valor: number, descricao: string) {
    const j = await this.chamar('PUT', `/pix/${fimAFim}/devolucao/${idDevolucao}`, {
      valor: valor.toFixed(2),
      natureza: 'ORIGINAL',
      descricao: descricao.slice(0, 140),
    });
    const st = String(j['status'] ?? 'EM_PROCESSAMENTO');
    return {
      fimAFimDevolucao: j['rtrId'] ? String(j['rtrId']) : null,
      situacao:
        st === 'DEVOLVIDO'
          ? ('devolvida' as const)
          : st === 'NAO_REALIZADO'
            ? ('nao_realizada' as const)
            : ('em_processamento' as const),
      motivo: j['motivo'] ? String(j['motivo']).slice(0, 140) : null,
    };
  }
}

/** Falha fechada: em produção sem o prestador configurado, nada é cobrado nem devolvido. */
class ProvedorPixAusente implements ProvedorPix {
  readonly simulado = false;
  private falhar(): never {
    throw new Error('O prestador Pix do cliente não está configurado.');
  }
  async criarCobranca(): Promise<CobrancaNoProvedor> {
    return this.falhar();
  }
  async removerCobranca(): Promise<void> {
    return this.falhar();
  }
  async devolver(): Promise<DevolucaoNoProvedor> {
    return this.falhar();
  }
}

/** O transporte com o certificado do cliente (TLS mútuo): o PKCS#12 (A1) e a senha, só em memória. */
export function transporteTlsMutuo(pfx: Buffer, senha: string): TransportePix {
  const agente = new HttpsAgent({ pfx, passphrase: senha, keepAlive: true });
  return (url, init) =>
    new Promise((resolver, rejeitar) => {
      const req = httpsRequest(
        url,
        { method: init.method, headers: { ...init.headers }, agent: agente, timeout: 30_000 },
        (res) => {
          const partes: Buffer[] = [];
          res.on('data', (c: Buffer) => partes.push(c));
          res.on('end', () => {
            const texto = Buffer.concat(partes).toString('utf8');
            const status = res.statusCode ?? 0;
            resolver({
              ok: status >= 200 && status < 300,
              status,
              json: async () => (texto ? (JSON.parse(texto) as unknown) : {}),
            });
          });
          res.on('error', rejeitar);
        },
      );
      req.on('timeout', () => req.destroy(new Error('O prestador Pix não respondeu a tempo.')));
      req.on('error', rejeitar);
      req.end(init.body);
    });
}

/** A integração do catálogo da central (decisão 53) que o Pix usa. */
export const INTEGRACAO_PIX = 'pix';

/**
 * O prestador pela central de integrações externas (decisão 53, entrada `pix`): a cada chamada pergunta o modo pelo
 * helper único modoDaIntegracao, nunca o ambiente do processo.
 * - Fora de produção: o simulador (o real ligado na tela fica neutralizado).
 * - Produção com o modo Real: a API Pix padronizada com o endereço e o endereço do token dos parâmetros, o client id e
 *   o client secret do cofre, e o transporte com o certificado A1 do cliente (TLS mútuo, exigido pelo Banco Central).
 *   A falha do prestador fica registrada na central (a tela mostra "real com falha"), sem segredo nem dado de pessoa.
 * - Produção sem o Real completo: falha fechada (nada é cobrado nem devolvido; o QR simulado nunca chega ao pagador).
 */
export class ProvedorPixDaCentral implements ProvedorPix {
  private ultimo: { chave: string; provedor: ProvedorPix } | null = null;
  constructor(
    private readonly ambiente: string,
    private readonly consultar: (id: string) => Promise<ModoDaIntegracao> = modoDaIntegracao,
    private readonly criarTransporte: (pfx: Buffer, senha: string) => TransportePix = transporteTlsMutuo,
  ) {}

  /** O último prestador resolvido (o resultado da cobrança diz se foi simulado). */
  get simulado(): boolean {
    return this.ultimo?.provedor.simulado ?? this.ambiente !== 'producao';
  }

  private async resolver(): Promise<{ provedor: ProvedorPix; central: ModoDaIntegracao | null }> {
    if (this.ambiente !== 'producao') return { provedor: new ProvedorPixSimulado(), central: null };
    const m = await this.consultar(INTEGRACAO_PIX);
    if (m.modo !== 'real') return { provedor: new ProvedorPixAusente(), central: null };
    const [clienteId, clienteSegredo, certificado, senhaCertificado] = await Promise.all(
      ['client-id', 'client-secret', 'certificado', 'senha-certificado'].map((c) => m.credencial(c)),
    );
    const urlBase = (m.parametros['endereco'] ?? '').trim();
    const urlToken = (m.parametros['endereco-token'] ?? '').trim();
    if (!urlBase || !urlToken || !clienteId || !clienteSegredo || !certificado)
      return { provedor: new ProvedorPixAusente(), central: m };
    // O mesmo prestador (e o token OAuth2 dele) enquanto a configuração não muda.
    const chave = [urlBase, urlToken, clienteId, clienteSegredo.length, certificado.length].join('|');
    if (this.ultimo?.chave !== chave)
      this.ultimo = {
        chave,
        provedor: new ProvedorPixApiBacen({
          urlBase,
          urlToken,
          clienteId,
          clienteSegredo,
          transporte: this.criarTransporte(Buffer.from(certificado, 'base64'), senhaCertificado ?? ''),
        }),
      };
    return { provedor: this.ultimo.provedor, central: m };
  }

  private async usar<T>(fn: (p: ProvedorPix) => Promise<T>): Promise<T> {
    const { provedor, central } = await this.resolver();
    try {
      return await fn(provedor);
    } catch (e) {
      if (central)
        await central.registrarFalha(e instanceof Error ? e.message.slice(0, 200) : 'falha do prestador');
      throw e;
    }
  }

  async criarCobranca(p: PedidoCobrancaProvedor): Promise<CobrancaNoProvedor> {
    return this.usar(async (pv) => ({ ...(await pv.criarCobranca(p)), simulado: pv.simulado }));
  }
  async removerCobranca(txid: string, modalidade: 'imediata' | 'com_vencimento'): Promise<void> {
    return this.usar((pv) => pv.removerCobranca(txid, modalidade));
  }
  async devolver(fimAFim: string, idDevolucao: string, valor: number, descricao: string) {
    return this.usar((pv) => pv.devolver(fimAFim, idDevolucao, valor, descricao));
  }
}
