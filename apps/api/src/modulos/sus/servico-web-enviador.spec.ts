// Transporte da troca por serviço web com o SUS (08-INTG linha 131): fora de produção, sempre o simulador (regra 6);
// em produção, sem endereço configurado, falha de transporte sem chamar nada; a resposta do serviço vira críticas.
import { describe, expect, it, vi } from 'vitest';
import {
  enviadorServicoWebSusDoAmbiente,
  enviadorServicoWebSusProducao,
  enviadorServicoWebSusSimulado,
  lerRespostaServicoWebSus,
} from './servico-web-enviador.js';

describe('enviador do serviço web do SUS', () => {
  it('fora de produção é o simulador, mesmo com endereço configurado', () => {
    const env = {
      AMBIENTE: 'dev',
      SUS_SERVICO_WEB_URL_RASTREAMENTO_CANCER: 'https://exemplo.invalid',
    };
    expect(enviadorServicoWebSusDoAmbiente(env).modo).toBe('simulador');
    expect(enviadorServicoWebSusDoAmbiente({}).modo).toBe('simulador');
    expect(enviadorServicoWebSusDoAmbiente({ AMBIENTE: 'producao' }).modo).toBe('producao');
  });

  it('simulador: protocolo local estável, aviso do cartão provisório e erro do prestador sem ocupação', async () => {
    const s = enviadorServicoWebSusSimulado();
    const c = { servico: 'rastreamento_cancer', cnsPaciente: '700000000000013' };
    const a = await s.enviar('rastreamento_cancer', c);
    expect(a).toMatchObject({ chegou: true, cnsConfirmado: '700000000000013' });
    const b = await s.enviar('rastreamento_cancer', c);
    expect(a.chegou && b.chegou && a.protocolo === b.protocolo).toBe(true);
    expect(a.chegou && a.criticas.map((x) => [x.tipo, x.codigo])).toEqual([['aviso', 'cns-provisorio']]);
    const p = await s.enviar('cadastro_prestador', { cnsProfissional: '299000177220009', cbo: null });
    expect(p.chegou && p.criticas.map((x) => [x.tipo, x.codigo, x.campo])).toEqual([
      ['erro', 'cbo-ausente', 'cbo'],
    ]);
  });

  it('produção sem endereço: falha de transporte, sem chamada', async () => {
    const t = vi.fn();
    const e = enviadorServicoWebSusProducao({ AMBIENTE: 'producao' }, t);
    expect(await e.enviar('cadastro_prestador', {})).toEqual({
      chegou: false,
      mensagem: 'Endereço do serviço do SUS não configurado neste servidor.',
    });
    expect(t).not.toHaveBeenCalled();
  });

  it('produção com endereço: chama o serviço e lê protocolo e críticas; a queda de rede vira falha', async () => {
    const env = {
      AMBIENTE: 'producao',
      SUS_SERVICO_WEB_URL_CADASTRO_PRESTADOR: 'https://servico.invalid/cnes',
    };
    const t = vi.fn().mockResolvedValue({
      status: 200,
      texto: JSON.stringify({ protocolo: 'P9', criticas: [{ tipo: 'aviso', campo: 'cbo', mensagem: 'm' }] }),
    });
    const r = await enviadorServicoWebSusProducao(env, t).enviar('cadastro_prestador', { cnes: '1' });
    expect(t).toHaveBeenCalledWith('https://servico.invalid/cnes', '{"cnes":"1"}');
    expect(r).toMatchObject({ chegou: true, protocolo: 'P9', criticas: [{ tipo: 'aviso', campo: 'cbo' }] });
    const caiu = vi.fn().mockRejectedValue(new TypeError('rede'));
    expect(await enviadorServicoWebSusProducao(env, caiu).enviar('cadastro_prestador', {})).toMatchObject({
      chegou: false,
    });
  });

  it('não produção nunca chama o enviador real', async () => {
    const t = vi.fn();
    await expect(
      enviadorServicoWebSusProducao({ AMBIENTE: 'dev' }, t).enviar('cadastro_prestador', {}),
    ).rejects.toThrow(/neutralizado/);
    expect(t).not.toHaveBeenCalled();
  });

  it('resposta 5xx, 401 e ilegível são falha de transporte', () => {
    expect(lerRespostaServicoWebSus(503, '')).toMatchObject({ chegou: false });
    expect(lerRespostaServicoWebSus(401, '{}')).toMatchObject({ chegou: false });
    expect(lerRespostaServicoWebSus(200, '<html>')).toMatchObject({ chegou: false });
  });
});
