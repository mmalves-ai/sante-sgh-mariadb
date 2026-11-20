// Regras 6 e 7 da ficha do M02 (unitário): pool por estabelecimento, nunca SYSDBA, tetos e nenhuma
// conexão de um banco servindo a outro. ARQ-1: um terceiro código fictício sobe um terceiro pool.
import { describe, expect, it } from 'vitest';
import { CONFIGURACAO_PADRAO, conferirUsuarioFirebird, lerConfiguracaoNucleo } from './configuracao.js';
import { ambienteFicticio, criarDubleDriver } from './duble-driver.spec-util.js';
import { lerEstabelecimentos } from './estabelecimentos.js';
import { ErroPool, marcaDoSistema, PoolsDaRede } from './pool.js';

const cfg = (extra: Partial<typeof CONFIGURACAO_PADRAO> = {}) => ({ ...CONFIGURACAO_PADRAO, ...extra });

function criar(codigos: string[], extra: Record<string, string> = {}, config = cfg()) {
  const env = ambienteFicticio(codigos, extra);
  const driver = criarDubleDriver();
  const pools = new PoolsDaRede('rede-teste', lerEstabelecimentos(env), driver, config, env);
  return { env, driver, pools };
}

describe('pool por estabelecimento', () => {
  it('um terceiro código fictício sobe um terceiro pool sem mudar código (ARQ-1)', () => {
    const { pools } = criar(['pc', 'hs', 'zz']);
    expect(pools.codigos).toEqual(['pc', 'hs', 'zz']);
    expect(pools.estados()).toHaveLength(3);
  });

  it('a conexão sai marcada com o código e conecta no banco daquele estabelecimento', async () => {
    const { pools, driver } = criar(['pc', 'hs']);
    const c = await pools.para('hs').obter();
    expect(c.estabelecimento).toBe('hs');
    expect(driver.conexoes[0]?.destino.banco).toBe('/var/lib/firebird/data/hs.fdb');
    await pools.para('hs').devolver(c);
    expect(pools.para('hs').estado()).toMatchObject({ livres: 1, emUso: 0 });
  });

  it('código fora da configuração é erro: nunca cai em outro banco', () => {
    const { pools } = criar(['pc']);
    expect(() => pools.para('hs')).toThrow(/não está em ESTABELECIMENTOS/);
  });

  it('devolver a conexão ao pool de outro estabelecimento é recusado', async () => {
    const { pools } = criar(['pc', 'hs']);
    const c = await pools.para('pc').obter();
    await expect(pools.para('hs').devolver(c)).rejects.toThrow(ErroPool);
    await pools.para('pc').devolver(c);
  });

  it('reaproveita a conexão livre e descarta a quebrada', async () => {
    const { pools, driver } = criar(['pc']);
    const p = pools.para('pc');
    const a = await p.obter();
    await p.devolver(a);
    const b = await p.obter();
    expect(b.conexao).toBe(a.conexao);
    driver.conexoes[0]?.quebrar();
    await p.devolver(b);
    const c = await p.obter();
    expect(c.conexao).not.toBe(a.conexao);
    await p.devolver(c, true);
    expect(p.estado().abertas).toBe(0);
  });

  it('teto por estabelecimento: a próxima espera e recebe a conexão devolvida', async () => {
    const { pools } = criar(['pc'], {}, cfg({ tetoPorEstabelecimento: 2, esperaConexaoMs: 1000 }));
    const p = pools.para('pc');
    const a = await p.obter();
    await p.obter();
    const esperando = p.obter();
    expect(p.estado().esperando).toBe(1);
    await p.devolver(a);
    expect((await esperando).conexao).toBe(a.conexao);
  });

  it('espera vence com erro claro', async () => {
    const { pools } = criar(['pc'], {}, cfg({ tetoPorEstabelecimento: 1, esperaConexaoMs: 100 }));
    const p = pools.para('pc');
    await p.obter();
    await expect(p.obter()).rejects.toThrow(/Sem conexão livre para "pc"/);
  });

  it('teto por rede: um estabelecimento cede a vaga ociosa ao outro', async () => {
    const { pools } = criar(
      ['pc', 'hs'],
      {},
      cfg({ tetoPorEstabelecimento: 2, tetoPorRede: 2, esperaConexaoMs: 1000 }),
    );
    const a = await pools.para('pc').obter();
    const b = await pools.para('pc').obter();
    const hs = pools.para('hs').obter();
    expect(pools.para('hs').estado().esperando).toBe(1);
    await pools.para('pc').devolver(a); // sem espera no pc: fecha e cede a vaga
    const c = await hs;
    expect(c.estabelecimento).toBe('hs');
    expect(pools.para('pc').estado().abertas).toBe(1);
    await pools.para('pc').devolver(b);
    await pools.para('hs').devolver(c);
  });

  it('falha de conexão libera a vaga e propaga o erro', async () => {
    const { pools, driver } = criar(['pc'], {}, cfg({ tetoPorEstabelecimento: 1 }));
    driver.falharConexao = true;
    await expect(pools.para('pc').obter()).rejects.toThrow(/refused/);
    driver.falharConexao = false;
    const c = await pools.para('pc').obter();
    expect(c.estabelecimento).toBe('pc');
  });

  it('encerrar rejeita quem espera e fecha as livres', async () => {
    const { pools, driver } = criar(['pc'], {}, cfg({ tetoPorEstabelecimento: 1, esperaConexaoMs: 5000 }));
    const p = pools.para('pc');
    const a = await p.obter();
    const esperando = p.obter();
    await pools.encerrar();
    await expect(esperando).rejects.toThrow(/encerrado/);
    await p.devolver(a);
    expect(driver.conexoes[0]?.fechada).toBe(true);
    await expect(p.obter()).rejects.toThrow(/encerrado/);
  });
});

describe('nunca SYSDBA (regra 7)', () => {
  it('configuração com SYSDBA não sobe', () => {
    const env = ambienteFicticio(['pc'], { FB_PC_USUARIO: 'sysdba' });
    expect(
      () => new PoolsDaRede('rede-teste', lerEstabelecimentos(env), criarDubleDriver(), cfg(), env),
    ).toThrow(/FB_PC_USUARIO: SYSDBA é recusado/);
  });

  it('a exceção provisória só vale em dev, com host em loopback e a chave explícita', () => {
    const base = ambienteFicticio(['pc'], { FB_PC_USUARIO: 'SYSDBA' });
    const [est] = lerEstabelecimentos(base);
    if (!est) throw new Error('sem estabelecimento');
    expect(conferirUsuarioFirebird(est, { ...base, SGH_DEV_PERMITIR_SYSDBA: 'sim' })).toBe(true);
    expect(() => conferirUsuarioFirebird(est, base)).toThrow(/SYSDBA/);
    expect(() =>
      conferirUsuarioFirebird(est, { ...base, AMBIENTE: 'homolog', SGH_DEV_PERMITIR_SYSDBA: 'sim' }),
    ).toThrow(/SYSDBA/);
    const semAmbiente: Record<string, string> = { ...base, SGH_DEV_PERMITIR_SYSDBA: 'sim' };
    delete semAmbiente['AMBIENTE'];
    expect(() => conferirUsuarioFirebird(est, semAmbiente)).toThrow(/SYSDBA/); // AMBIENTE ausente não é dev
    const remoto = lerEstabelecimentos({ ...base, FB_PC_HOST: '10.0.0.5' })[0];
    if (!remoto) throw new Error('sem estabelecimento');
    expect(() => conferirUsuarioFirebird(remoto, { ...base, SGH_DEV_PERMITIR_SYSDBA: 'sim' })).toThrow(
      /SYSDBA/,
    );
    expect(conferirUsuarioFirebird({ ...est, usuario: 'SGH_DEV' }, base)).toBe(false);
  });
});

describe('configuração do núcleo', () => {
  it('padrões pequenos e chaves configuráveis', () => {
    expect(lerConfiguracaoNucleo({})).toEqual(CONFIGURACAO_PADRAO);
    const c = lerConfiguracaoNucleo({
      FB_POOL_TETO: '2',
      FB_REDE_TETO: '6',
      FB_LOCK_TIMEOUT_S: '3',
      FB_CLIENTE_BIBLIOTECA: '/opt/fb/lib.so',
    });
    expect(c).toMatchObject({
      tetoPorEstabelecimento: 2,
      tetoPorRede: 6,
      lockTimeoutSegundos: 3,
      bibliotecaCliente: '/opt/fb/lib.so',
    });
  });

  it.each([
    [{ FB_POOL_TETO: '0' }, /FB_POOL_TETO/],
    [{ FB_POOL_TETO: 'x' }, /FB_POOL_TETO/],
    [{ FB_LOCK_TIMEOUT_S: '600' }, /FB_LOCK_TIMEOUT_S/],
    [{ FB_POOL_TETO: '8', FB_REDE_TETO: '4' }, /FB_REDE_TETO menor/],
    [{ FB_CLIENTE_BIBLIOTECA: 'relativo.so' }, /caminho absoluto/],
  ])('recusa %o', (env, erro) => {
    expect(() => lerConfiguracaoNucleo(env)).toThrow(erro);
  });
});

describe('marca das conexões (M09)', () => {
  it('padrão sgh:<rede>:<estabelecimento>:<processo>', () => {
    expect(marcaDoSistema('r', 'pc', { SGH_PROCESSO: 'api' })).toBe('sgh:r:pc:api');
    expect(marcaDoSistema('r', 'pc', {})).toBe('sgh:r:pc:sgh');
  });

  it('SGH_MARCA_CONEXAO só com AMBIENTE=dev explícito e só "legado-simulado…"', () => {
    expect(marcaDoSistema('r', 'pc', { AMBIENTE: 'dev', SGH_MARCA_CONEXAO: 'legado-simulado:k6' })).toBe(
      'legado-simulado:k6',
    );
    expect(() =>
      marcaDoSistema('r', 'pc', { AMBIENTE: 'producao', SGH_MARCA_CONEXAO: 'legado-simulado' }),
    ).toThrow(ErroPool);
    expect(() => marcaDoSistema('r', 'pc', { SGH_MARCA_CONEXAO: 'legado-simulado' })).toThrow(ErroPool);
    expect(() => marcaDoSistema('r', 'pc', { AMBIENTE: 'dev', SGH_MARCA_CONEXAO: 'spdata' })).toThrow(
      ErroPool,
    );
  });
});

describe('conta por módulo (M59-F1, regra 4)', () => {
  it('módulo com conta no ambiente usa a conta e o papel do módulo; sem conta, a conta única', async () => {
    const { pools, driver } = criar(['pc'], {
      FB_PC_MOD_ACESSO_USUARIO: 'SGH_APP_ACESSO',
      FB_PC_MOD_ACESSO_SENHA: '<senha-ficticia>',
    });
    expect(pools.modulosComConta('pc')).toEqual(['ACESSO']);
    const p = pools.para('pc', 'ACESSO');
    expect(p).not.toBe(pools.para('pc'));
    expect(p.papel).toBe('SGH_MOD_ACESSO');
    expect(JSON.stringify(p.estabelecimento)).not.toContain('<senha-ficticia>');
    const c = await p.obter();
    expect(driver.conexoes[0]?.destino).toMatchObject({ usuario: 'SGH_APP_ACESSO', papel: 'SGH_MOD_ACESSO' });
    expect(c.estabelecimento).toBe('pc');
    await p.devolver(c);
    expect(pools.para('pc', 'CADASTRO')).toBe(pools.para('pc'));
    expect(pools.para('pc', null)).toBe(pools.para('pc'));
    expect(pools.para('pc').papel).toBe('SGH_APLICACAO');
    expect(pools.estados().map((e) => e.modulo ?? null)).toEqual([null, 'ACESSO']);
  });

  it('conta de módulo SYSDBA ou com sufixo inválido não sobe', () => {
    expect(() => criar(['pc'], { FB_PC_MOD_ACESSO_USUARIO: 'sysdba' })).toThrow(/administrador do servidor/);
    expect(() => criar(['pc'], { FB_PC_MOD_acesso_USUARIO: 'X' })).toThrow(/sufixo de módulo inválido/);
  });

  it('chave vazia é ignorada (o módulo segue na conta única)', () => {
    const { pools } = criar(['pc'], { FB_PC_MOD_ACESSO_USUARIO: ' ' });
    expect(pools.modulosComConta('pc')).toEqual([]);
  });
});
