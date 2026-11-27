// Central de integrações externas (decisão 53): o serviço sobre a porta em memória e o cofre em memória.
import { CATALOGO_INTEGRACOES_EXTERNAS, referenciaCofreIntegracao } from '@sgh/contratos';
import { respostaSimulada } from '@sgh/dominio-integracao';
import { describe, expect, it } from 'vitest';
import { CofreMemoria } from '../../assinatura/infra/cofre.js';
import { PortaIntegracoesExternasMemoria } from './porta.js';
import { ligarCentralIntegracoes, modoDaIntegracao, ServicoIntegracoesExternas } from './servico.js';

const C = { hospital: 'H1', login: 'ADM', correlacao: 'c', chaveIdempotencia: 'k' };
const PIX = {
  endereco: 'https://pix.exemplo.test',
  'chave-pix': 'chave-sintetica',
  provedor: 'Banco Sintético',
};

function montar(producao: boolean) {
  const cofre = new CofreMemoria();
  const s = new ServicoIntegracoesExternas(new PortaIntegracoesExternasMemoria(), cofre, 'cli1', producao);
  return { s, cofre };
}

async function completarPix(s: ServicoIntegracoesExternas) {
  await s.configurar(C, { integracao: 'pix', parametros: PIX });
  for (const campo of ['client-id', 'client-secret', 'certificado', 'senha-certificado'])
    await s.guardarCredencial(C, { integracao: 'pix', campo, valor: `v-${campo}`, senha: 'x' });
}

describe('central de integrações externas', () => {
  it('o painel traz todo o catálogo no simulador, com o que falta e as credenciais não definidas', async () => {
    const { s } = montar(false);
    const p = await s.painel();
    expect(p.integracoes.map((i) => i.id)).toEqual(CATALOGO_INTEGRACOES_EXTERNAS.map((e) => e.id));
    expect(p.integracoes.every((i) => i.situacao === 'simulador')).toBe(true);
    const pix = p.integracoes.find((i) => i.id === 'pix')!;
    expect(pix.credenciais.every((c) => c.definida === false)).toBe(true);
    expect(pix.faltam).toContain('Chave PIX recebedora');
  });

  it('a credencial vai só ao cofre e nunca volta na resposta', async () => {
    const { s, cofre } = montar(false);
    const r = await s.guardarCredencial(C, {
      integracao: 'pix',
      campo: 'client-secret',
      valor: 'segredo-sintetico',
      senha: 'x',
    });
    expect(JSON.stringify(r)).not.toContain('segredo-sintetico');
    expect(r.integracao.credenciais.find((c) => c.campo === 'client-secret')?.definida).toBe(true);
    expect(await cofre.ler(referenciaCofreIntegracao('cli1', 'pix', 'client-secret'))).toBe(
      'segredo-sintetico',
    );
  });

  it('endereço que não é http(s) é recusado', async () => {
    const { s } = montar(false);
    await expect(
      s.configurar(C, { integracao: 'pix', parametros: { endereco: 'ftp://x' } }),
    ).rejects.toMatchObject({ problema: { codigo: 'endereco-invalido' } });
  });

  it('fora de produção o real completo fica neutralizado e o adaptador segue no simulador', async () => {
    const { s } = montar(false);
    await completarPix(s);
    const r = await s.definirModo(C, {
      integracao: 'pix',
      modo: 'real',
      justificativa: 'credencial do banco',
      senha: 'x',
    });
    expect(r.neutralizado).toBe(true);
    expect(r.integracao.situacao).toBe('real-neutralizado');
    const m = await s.modoDaIntegracao('pix');
    expect(m.modo).toBe('simulador');
    expect(m.neutralizado).toBe(true);
    expect(await m.credencial('client-secret')).toBeNull();
  });

  it('em produção, real ligado e incompleto segue no simulador; completo usa o real e lê a credencial', async () => {
    const { s } = montar(true);
    await s.definirModo(C, {
      integracao: 'pix',
      modo: 'real',
      justificativa: 'credencial do banco',
      senha: 'x',
    });
    expect((await s.painel()).integracoes.find((i) => i.id === 'pix')?.situacao).toBe('real-incompleto');
    expect((await s.modoDaIntegracao('pix')).modo).toBe('simulador');
    await completarPix(s);
    const m = await s.modoDaIntegracao('pix');
    expect(m.modo).toBe('real');
    expect(await m.credencial('client-secret')).toBe('v-client-secret');
    await m.registrarFalha('tempo esgotado');
    expect((await s.painel()).integracoes.find((i) => i.id === 'pix')?.situacao).toBe('real-com-falha');
  });

  it('o helper único responde simulador sem central e pela central quando ligada', async () => {
    ligarCentralIntegracoes(null);
    expect((await modoDaIntegracao('esocial')).modo).toBe('simulador');
    await expect(modoDaIntegracao('inexistente')).rejects.toThrow();
    const { s } = montar(true);
    await completarPix(s);
    await s.definirModo(C, {
      integracao: 'pix',
      modo: 'real',
      justificativa: 'credencial do banco',
      senha: 'x',
    });
    ligarCentralIntegracoes(s);
    expect((await modoDaIntegracao('pix')).modo).toBe('real');
    ligarCentralIntegracoes(null);
  });

  it('o simulador comum é determinístico: aceite com protocolo, recusa e erro de transporte', () => {
    const a = respostaSimulada('pix', 'cobranca-1');
    expect(a).toEqual(respostaSimulada('pix', 'cobranca-1'));
    expect(a.tipo).toBe('aceite');
    expect(respostaSimulada('pix', 'cobranca-1-recusa').tipo).toBe('recusa');
    expect(respostaSimulada('pix', 'cobranca-1-erro').tipo).toBe('erro-transporte');
  });

  it('a referência do cofre só aceita integração e campo do catálogo', () => {
    expect(referenciaCofreIntegracao('cli1', 'esocial', 'certificado')).toBe(
      'cofre:integracao/cli1/esocial/certificado',
    );
    expect(() => referenciaCofreIntegracao('cli1', 'esocial', 'client-secret')).toThrow();
  });
});
