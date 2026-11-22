// Unidade da massa sintética (sem banco): CPF, paciente, usuário e a forma das consultas (parametrizadas, no
// modelo próprio, sem sintaxe do banco de origem).
import { cpfValido } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { dubleEscritor, SINTAXE_ANTIGA } from './dubles-banco.spec-util.js';
import {
  cepCompleto,
  cepInexistente,
  cpfComDigitos,
  cpfLivre,
  estabelecimentosAtivos,
  loginLivre,
  MARCA_SINTETICA,
  outroCepCompleto,
  pacienteSintetico,
  papelSintetico,
  perfilSintetico,
  usuarioSintetico,
} from './sintetica.js';

describe('massa sintética', () => {
  it('gera CPF válido e recusa base fora do formato', () => {
    expect(cpfValido(cpfComDigitos('900000001'))).toBe(true);
    expect(() => cpfComDigitos('12')).toThrow();
  });

  it('cpfLivre confere pessoa e usuário e pula o CPF ocupado', async () => {
    let n = 0;
    const e = dubleEscritor((c) => (c.tipo === 'consultar' && n++ === 0 ? [{ achou: 1 }] : []));
    const cpf = await cpfLivre(e, 1);
    expect(cpfValido(cpf)).toBe(true);
    expect(e.chamadas).toHaveLength(2);
    expect(e.chamadas[0]?.sql).toMatch(/pessoa_fisica[\s\S]*usuario/);
    expect(e.chamadas[1]?.parametros).toEqual([cpf, cpf]);
  });

  it('paciente e usuário sintéticos levam a marca', () => {
    const p = pacienteSintetico('com-responsavel', cpfComDigitos('900000002'), '20000000');
    expect(p.nome).toContain(MARCA_SINTETICA);
    expect(p.contatoNome).toContain(MARCA_SINTETICA);
    expect(usuarioSintetico('usuario-tecnico', 'x').nomeCompleto).toContain(MARCA_SINTETICA);
  });

  it('CEP: completo, outro e inexistente no catálogo próprio', async () => {
    const e = dubleEscritor((c) =>
      /LIMIT 1$/m.test(c.sql) && /codigo_cep\b/.test(c.sql) && !/= \?\s*LIMIT/.test(c.sql)
        ? [{ codigo_cep: '20000000' }]
        : [],
    );
    expect(await cepCompleto(e)).toBe('20000000');
    expect(await outroCepCompleto(e, '20000000')).toBe('20000000');
    expect(await cepInexistente(e)).toBe('99999999');
    await expect(cepCompleto(dubleEscritor())).rejects.toThrow('Nenhum CEP completo');
  });

  it('login livre, estabelecimentos e concessões com vigência', async () => {
    const e = dubleEscritor((c) =>
      /FROM (usuario|papel_seguranca|perfil_acesso)\s+WHERE (login|codigo)/.test(c.sql) &&
      !/LIMIT 1/.test(c.sql)
        ? [{ id: 7 }]
        : [],
    );
    expect(await loginLivre(e, 10)).toMatch(/^sgh\.m04\./);
    expect(await estabelecimentosAtivos(e, 99)).toEqual([]);
    await papelSintetico(e, 'sgh.m04.a', 'operador');
    await perfilSintetico(e, 'sgh.m04.a', 'perfil', 3);
    const ins = e.chamadas.filter((c) => c.tipo === 'executar');
    expect(ins.map((c) => c.sql)).toEqual([
      expect.stringMatching(/INSERT INTO usuario_papel_seguranca[\s\S]*vigencia_inicio/),
      expect.stringMatching(/INSERT INTO usuario_perfil[\s\S]*vigencia_inicio/),
    ]);
    expect(ins[1]?.parametros).toEqual([7, 7, 3]);
    // O perfil só do estabelecimento pedido ou da rede (nunca de outro estabelecimento).
    const busca = e.chamadas.find((c) => /FROM perfil_acesso/.test(c.sql));
    expect(busca?.sql).toMatch(/estabelecimento_id IS NULL OR estabelecimento_id = \?/);
    expect(busca?.parametros).toEqual(['perfil', 3]);
    expect(e.chamadas.find((c) => /estabelecimento WHERE ativo/.test(c.sql))?.parametros).toEqual([20]);
    for (const c of e.chamadas) expect(c.sql).not.toMatch(SINTAXE_ANTIGA);
  });
});
