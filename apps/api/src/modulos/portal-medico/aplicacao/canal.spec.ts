// W0-10: a trava de saídas do canal ao médico externo: dev e ci só no simulador (nada sai do processo); fora deles, a
// Hal-AI para o médico fica desligada até o dono ligar, e nada é enviado.
import { describe, expect, it } from 'vitest';
import { CanalMedicoDesligado, CanalMedicoSimulador, canalMedicoDoAmbiente } from './canal.js';

const M = {
  hospital: 'aa',
  acesso: 7,
  tipo: 'confirmacao-email',
  destino: 'novo@exemplo.invalid',
  link: '/medico-externo/email/confirmar?h=aa&t=x',
  validoAte: '2026-11-19T00:00:00.000Z',
} as const;

describe('canal do médico externo (trava de saídas)', () => {
  it('dev e ci: o simulador guarda a mensagem em memória, por estabelecimento e conta', async () => {
    for (const amb of ['dev', 'ci']) {
      const c = canalMedicoDoAmbiente(amb);
      expect(c).toBeInstanceOf(CanalMedicoSimulador);
      expect(await c.disponivel('aa')).toEqual({ envio: 'simulador', motivo: null });
      expect(await c.enviar(M)).toBe('simulador');
      const s = c as CanalMedicoSimulador;
      expect(s.mensagens('aa', 7)).toHaveLength(1);
      expect(s.mensagens('bb')).toEqual([]);
    }
  });

  it('homologação e produção: desligado, com o motivo, e o envio é recusado', async () => {
    for (const amb of ['homologacao', 'producao']) {
      const c = canalMedicoDoAmbiente(amb);
      expect(c).toBeInstanceOf(CanalMedicoDesligado);
      const d = await c.disponivel('aa');
      expect(d.envio).toBeNull();
      expect(d.motivo).toMatch(/Hal-AI/);
      await expect(c.enviar(M)).rejects.toThrow(/desligado/);
    }
  });
});
