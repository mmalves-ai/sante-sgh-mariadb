// Regra 6 da ficha do M02 sobre a cópia: uma operação pertence a um estabelecimento; a sessão de outro
// estabelecimento nunca recebe conexão do pc. Sem a cópia do Serrano (HS-1), o segundo estabelecimento é
// um código fictício apontando para uma porta sem banco: ele falha e não cai no pc.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codigos, contexto, criarNucleoIntegracao, env } from './integracao.spec-util.js';
import type { NucleoLegado } from './legado.js';

const [principal] = codigos;

describe.skipIf(!principal)('pool por estabelecimento sobre a cópia', () => {
  let nucleo: NucleoLegado;
  const cod = principal as string;
  const C = cod.toUpperCase();
  beforeAll(() => {
    nucleo = criarNucleoIntegracao({
      ESTABELECIMENTOS: `${cod},zz`,
      FB_ZZ_HOST: '127.0.0.1',
      FB_ZZ_PORTA: '3359',
      FB_ZZ_BANCO: env[`FB_${C}_BANCO`] ?? '/var/lib/firebird/data/zz.fdb',
      FB_ZZ_USUARIO: 'SGH_DEV',
      FB_ZZ_SENHA: '',
      FB_ZZ_NOME: 'Estabelecimento fictício',
      FB_POOL_ESPERA_MS: '500',
    });
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it(`a sessão de outro estabelecimento nunca recebe conexão do ${principal}`, async () => {
    await nucleo.consultar(contexto(cod, nucleo.rede), 'SELECT 1 X FROM RDB$DATABASE');
    await expect(
      nucleo.consultar(contexto('zz', nucleo.rede), 'SELECT 1 X FROM RDB$DATABASE'),
    ).rejects.toThrow();
    const estados = Object.fromEntries(nucleo.estadosDosPools().map((p) => [p.estabelecimento, p]));
    expect(estados[cod]).toMatchObject({ abertas: 1, livres: 1 });
    expect(estados['zz']).toMatchObject({ abertas: 0, livres: 0 });
  });

  it('código fora da configuração é recusado', async () => {
    await expect(
      nucleo.consultar(contexto('xx', nucleo.rede), 'SELECT 1 X FROM RDB$DATABASE'),
    ).rejects.toThrow(/não está em ESTABELECIMENTOS/);
  });

  it('partida: o estabelecimento que não conecta fica indisponível sem derrubar o principal', async () => {
    const saude = await nucleo.partida();
    const por = Object.fromEntries(saude.map((s) => [s.codigo, s]));
    expect(por['zz']).toMatchObject({ disponivel: false, conectado: false });
    expect(por[cod]?.conectado).toBe(true);
    expect(por[cod]?.schema?.estado).toBe('homologado');
    expect(por[cod]?.disponivel).toBe(true);
    expect(por[cod]?.identificacao?.unidades.length).toBeGreaterThan(0);
    console.log(
      `[${cod}] partida: disponível; nome configurado confere com o banco: ${por[cod]?.nomeConfere}; ` +
        `unidades: ${por[cod]?.identificacao?.unidades.length}; schema-check em ${por[cod]?.schema?.duracaoMs} ms`,
    );
  });
});
