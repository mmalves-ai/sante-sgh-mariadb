// A porta sintética do saneamento (M59-F4) lê os grupos e os usuários ao vivo do estado sintético do acesso: o que a
// gestão em memória grava (troca de grupo, bloqueio, retirada das opções) aparece nas leituras seguintes.
import { beforeEach, describe, expect, it } from 'vitest';
import { estadoAcessoSintetico, reiniciarEstadoAcessoSintetico } from '../fonte-sintetica.js';
import { ALVOS_SANEAMENTO_SINTETICOS as ALVOS, PortaSaneamentoSintetica } from './porta-sintetica.js';

const AGORA = Date.parse('2026-10-29T12:00:00Z');

describe('PortaSaneamentoSintetica', () => {
  beforeEach(() => reiniciarEstadoAcessoSintetico());

  it('semeia os dois grupos de acesso amplo, os alvos e o uso', async () => {
    const p = new PortaSaneamentoSintetica(estadoAcessoSintetico, () => AGORA);
    const [msf, mcf] = await p.grupos('pc', ['MASTER_SEM_FINANCEIRO', 'MASTER_CONSULTA_FINANCEIRO']);
    expect(msf).toMatchObject({ existe: true, ativos: 2, opcoes: 9 });
    expect(mcf).toMatchObject({ existe: true, ativos: 0, opcoes: 2 });
    const us = await p.usuarios('pc', 'MASTER_SEM_FINANCEIRO');
    expect(us.map((u) => u.login)).toEqual([ALVOS.emUso, ALVOS.semUso]);
    expect(us[1]?.ultimoAcesso).toBe('2026-03-03');
    const uso = await p.uso('pc', 'MASTER_SEM_FINANCEIRO');
    expect([...(uso.get(ALVOS.emUso) ?? new Map()).keys()].sort()).toEqual([5056, 6813, 6814]);
    expect(uso.has(ALVOS.semUso)).toBe(false);
    const destinos = await p.gruposComOpcoes();
    expect(destinos.find((g) => g.grupo === 'ANESTESIA')?.opcoes).toEqual(
      expect.arrayContaining([6813, 6814]),
    );
  });

  it('vê o que a gestão em memória grava no estado', async () => {
    const p = new PortaSaneamentoSintetica(estadoAcessoSintetico, () => AGORA);
    await p.grupos('pc', ['MASTER_SEM_FINANCEIRO']);
    const e = estadoAcessoSintetico();
    e.aplicar('acesso.trocarGrupoUsuario', { login: ALVOS.emUso, grupo: 'ANESTESIA' }, 'SINT.SANEAR.GESTOR');
    e.aplicar('acesso.bloquearUsuario', { login: ALVOS.semUso }, 'SINT.SANEAR.GESTOR');
    expect(() => e.aplicar('acesso.bloquearUsuario', { login: ALVOS.semUso }, 'SINT.SANEAR.GESTOR')).toThrow(
      /bloqueado/,
    );
    expect(() =>
      e.aplicar('acesso.bloquearUsuario', { login: 'SINT.SANEAR.GESTOR' }, 'SINT.SANEAR.GESTOR'),
    ).toThrow(/próprio/);
    e.aplicar(
      'acesso.revogarOpcoesGrupo',
      { grupo: 'MASTER_CONSULTA_FINANCEIRO', opcoes: [1169, 2324] },
      'SINT.SANEAR.GESTOR',
    );
    const [msf, mcf] = await p.grupos('pc', ['MASTER_SEM_FINANCEIRO', 'MASTER_CONSULTA_FINANCEIRO']);
    expect(msf).toMatchObject({ usuarios: 1, ativos: 0 });
    expect(mcf).toMatchObject({ opcoes: 0 });
    expect((await p.usuario('pc', ALVOS.emUso))?.grupo).toBe('ANESTESIA');
    expect((await p.usuario('pc', ALVOS.semUso))?.bloqueado).toBe(true);
  });
});
