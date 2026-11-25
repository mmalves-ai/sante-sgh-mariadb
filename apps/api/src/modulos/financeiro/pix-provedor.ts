// Prestador de serviço de pagamento do Pix (07-FIN linha 90): a API Pix do Banco Central é a mesma em todos os
// prestadores; o prestador contratado é configuração por cliente e as credenciais ficam no cofre de segredos.
// - Fora de produção: o simulador (nenhuma rede; QR e devolução sintéticos, marcados como simulados).
// - Produção: o adaptador da API Pix padronizada (PUT /cob/{txid}, PUT /cobv/{txid}, PATCH para remover e
//   PUT /pix/{e2eid}/devolucao/{id}), com token OAuth2 (client credentials). O transporte com o certificado do cliente
//   (TLS mútuo) vem da configuração, como um fetch próprio. Sem configuração, falha fechada: nada é cobrado.
import { montarBrCodePix } from '@sgh/dominio-financeiro';

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
  /** O fetch com o certificado do cliente (TLS mútuo); padrão: o fetch global. */
  readonly transporte?: typeof fetch;
}

/** O adaptador da API Pix padronizada do Banco Central. */
export class ProvedorPixApiBacen implements ProvedorPix {
  readonly simulado = false;
  private token: { valor: string; expira: number } | null = null;
  constructor(private readonly cfg: ConfigApiPix) {}

  private get transporte(): typeof fetch {
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

/** O prestador do ambiente: o simulador fora de produção; em produção, a API Pix pela configuração do cofre. */
export function provedorPixDoAmbiente(
  ambiente: string,
  segredo: (nome: string) => string | undefined = (n) => process.env[n],
): ProvedorPix {
  if (ambiente !== 'producao') return new ProvedorPixSimulado();
  const [urlBase, urlToken, clienteId, clienteSegredo] = [
    'PIX_API_URL',
    'PIX_API_URL_TOKEN',
    'PIX_API_CLIENTE_ID',
    'PIX_API_CLIENTE_SEGREDO',
  ].map((n) => segredo(n)?.trim() ?? '');
  if (!urlBase || !urlToken || !clienteId || !clienteSegredo) return new ProvedorPixAusente();
  return new ProvedorPixApiBacen({
    urlBase: urlBase as string,
    urlToken: urlToken as string,
    clienteId: clienteId as string,
    clienteSegredo: clienteSegredo as string,
  });
}
