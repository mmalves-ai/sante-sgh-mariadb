// O prestador Pix pela central de integrações externas (decisão 53, 07-FIN linha 90): o modo vem da central, as
// credenciais do cofre (nunca do ambiente do processo) e o transporte leva o certificado do cliente (TLS mútuo).
import { describe, expect, it } from 'vitest';
import type { ModoDaIntegracao } from '../integracao/externas/servico.js';
import { INTEGRACAO_PIX, ProvedorPixDaCentral, type TransportePix } from './pix-provedor.js';

const PEDIDO = {
  txid: 'TX0000000000000000000000001',
  modalidade: 'imediata' as const,
  chave: 'financeiro@exemplo.invalid',
  valor: 10,
  descricao: null,
  vencimento: null,
  validadeSegundos: null,
  pagadorNome: null,
  pagadorDocumento: null,
  recebedorNome: 'HOSPITAL TESTE',
};

const CREDENCIAIS: Record<string, string> = {
  'client-id': 'id-teste',
  'client-secret': 'segredo-teste',
  certificado: Buffer.from('pfx-teste').toString('base64'),
  'senha-certificado': 'senha-teste',
};

function central(modo: 'real' | 'simulador', faltando: string[] = []) {
  const falhas: string[] = [];
  const consultas: string[] = [];
  const consultar = async (id: string): Promise<ModoDaIntegracao> => {
    consultas.push(id);
    return {
      integracao: id,
      modo,
      neutralizado: false,
      parametros: {
        endereco: 'https://pix.exemplo.invalid/v2',
        'endereco-token': 'https://pix.exemplo.invalid/oauth',
      },
      credencial: async (c) => (modo === 'real' && !faltando.includes(c) ? (CREDENCIAIS[c] ?? null) : null),
      registrarFalha: async (m) => {
        falhas.push(m);
      },
    };
  };
  return { consultar, falhas, consultas };
}

function transporte(statusCob = 200) {
  const chamadas: { url: string; metodo: string }[] = [];
  const certificados: { pfx: string; senha: string }[] = [];
  const t: TransportePix = async (url, init) => {
    chamadas.push({ url, metodo: init.method });
    if (url.endsWith('/oauth')) return { ok: true, status: 200, json: async () => ({ access_token: 'tk' }) };
    return {
      ok: statusCob < 300,
      status: statusCob,
      json: async () => ({
        pixCopiaECola: '000201...',
        revisao: 0,
        loc: { location: 'pix.exemplo.invalid/qr' },
      }),
    };
  };
  const criar = (pfx: Buffer, senha: string) => {
    certificados.push({ pfx: pfx.toString(), senha });
    return t;
  };
  return { criar, chamadas, certificados };
}

describe('ProvedorPixDaCentral', () => {
  it('fora de produção usa o simulador sem perguntar credencial', async () => {
    const c = central('real');
    const p = new ProvedorPixDaCentral('dev', c.consultar);
    const r = await p.criarCobranca(PEDIDO);
    expect(r.simulado).toBe(true);
    expect(r.localizacao).toContain('pix.simulado.invalid');
    expect(c.consultas).toEqual([]);
  });

  it('em produção com o Real usa a API Pix com o certificado do cofre (TLS mútuo)', async () => {
    const c = central('real');
    const t = transporte();
    const p = new ProvedorPixDaCentral('producao', c.consultar, t.criar);
    const r = await p.criarCobranca(PEDIDO);
    expect(c.consultas).toEqual([INTEGRACAO_PIX]);
    expect(r.simulado).toBe(false);
    expect(r.copiaECola).toBe('000201...');
    expect(t.certificados).toEqual([{ pfx: 'pfx-teste', senha: 'senha-teste' }]);
    expect(t.chamadas.map((x) => `${x.metodo} ${x.url}`)).toEqual([
      'POST https://pix.exemplo.invalid/oauth',
      `PUT https://pix.exemplo.invalid/v2/cob/${PEDIDO.txid}`,
    ]);
    // O mesmo prestador (e o token) na chamada seguinte.
    await p.removerCobranca(PEDIDO.txid, 'imediata');
    expect(t.certificados).toHaveLength(1);
    expect(t.chamadas.filter((x) => x.url.endsWith('/oauth'))).toHaveLength(1);
  });

  it('em produção sem o Real, ou sem o certificado, falha fechada: nada é cobrado', async () => {
    const t = transporte();
    for (const c of [central('simulador'), central('real', ['certificado'])]) {
      const p = new ProvedorPixDaCentral('producao', c.consultar, t.criar);
      await expect(p.criarCobranca(PEDIDO)).rejects.toThrow('não está configurado');
    }
    expect(t.chamadas).toEqual([]);
  });

  it('a recusa do prestador fica registrada na central', async () => {
    const c = central('real');
    const t = transporte(500);
    const p = new ProvedorPixDaCentral('producao', c.consultar, t.criar);
    await expect(p.criarCobranca(PEDIDO)).rejects.toThrow('HTTP 500');
    expect(c.falhas).toEqual(['O prestador Pix recusou PUT cob (HTTP 500).']);
  });
});
