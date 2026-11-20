// Fachada do núcleo (ARQ-1): estabelecimento que não conecta, não passa no schema-check ou tem a conta
// recusada fica "indisponível", sem derrubar os demais; nome configurado conferido com o banco.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ambienteFicticio, criarDubleDriver, type Responder } from './duble-driver.spec-util.js';
import { LIMITE_UNIDADES, lerIdentificacao, nomeConfere, normalizarNome } from './identificacao.js';
import { NucleoLegado } from './legado.js';
import { gravarHomologada } from './schema/verificacao.js';

const pasta = mkdtempSync(join(tmpdir(), 'sgh-nucleo-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

// Banco sintético: identificação e um catálogo mínimo.
const responder: Responder = (sql, _p, { destino }) => {
  if (destino.porta === 3353) throw new Error('connection refused');
  if (sql.includes('FROM TBHOSPIT')) return [{ NOME: 'ESTABELECIMENTO PC (EXEMPLO)', CNES: 1234567 }];
  if (sql.includes('FROM TBEMPHOS')) return [{ NOME: 'EMPRESA EXEMPLO LTDA', CNES: 0 }];
  if (sql.includes('FROM TBUNIDAD'))
    return [
      { COD: 1, NOME: 'UNIDADE A   ', CNES: null },
      { COD: 2, NOME: 'UNIDADE B', CNES: 7654321 },
    ];
  if (sql.includes('FROM RDB$DATABASE')) return [{ CS: 'NONE', V: '3.0.14' }];
  if (sql.includes('FROM RDB$RELATIONS r'))
    return [{ NOME: destino.porta === 3352 ? 'TB_HS' : 'TB_PC', FONTE: null, VISAO: 0 }];
  return [];
};

function nucleo(extra: Record<string, string> = {}) {
  const env = ambienteFicticio(['pc', 'hs', 'zz'], extra);
  const avisos: string[] = [];
  const n = new NucleoLegado({
    env,
    driver: criarDubleDriver(responder),
    pastaHomologada: pasta,
    aviso: (m) => avisos.push(m),
  });
  return { n, avisos };
}

describe('NucleoLegado', () => {
  it('partida: pc homologado, hs divergente, zz sem conexão; nenhum derruba os outros', async () => {
    const { n: preparo } = nucleo();
    await preparo.verificarSchema('pc');
    const impressaoPc = preparo.ultimaImpressao('pc');
    if (!impressaoPc) throw new Error('sem impressão');
    gravarHomologada(pasta, impressaoPc);
    gravarHomologada(pasta, { ...impressaoPc, estabelecimento: 'hs' });
    await preparo.encerrar();

    const { n, avisos } = nucleo();
    const saude = await n.partida();
    const por = Object.fromEntries(saude.map((s) => [s.codigo, s]));
    expect(por['pc']).toMatchObject({ disponivel: true, conectado: true, nomeConfere: true, motivo: null });
    expect(por['pc']?.identificacao?.unidades).toHaveLength(2);
    expect(por['pc']?.identificacao?.unidades[0]?.nome).toBe('UNIDADE A');
    expect(por['hs']).toMatchObject({ disponivel: false, conectado: true, nomeConfere: false });
    expect(por['hs']?.schema?.estado).toBe('divergente');
    expect(por['hs']?.motivo).toMatch(/Schema diferente/);
    expect(por['zz']).toMatchObject({
      disponivel: false,
      conectado: false,
      motivo: 'Não conectou ao banco do estabelecimento.',
    });
    expect(n.schema.bloqueada('pc', ['TB_PC'])).toBe(false);
    expect(n.schema.bloqueada('hs', ['TB_HS'])).toBe(true);
    expect(n.schema.bloqueada('zz', [])).toBe(true);
    expect(avisos).toContain('nome configurado diverge do banco');
    expect(avisos).toContain('estabelecimento indisponível');
    expect(n.estadosDosPools().map((p) => p.estabelecimento)).toEqual(['pc', 'hs', 'zz']);
    expect(
      await n.consultar({ rede: 'rede-teste', hospital: 'pc', traceId: 't' }, 'SELECT 1 FROM TBHOSPIT'),
    ).toHaveLength(1);
    await n.encerrar();
  });

  it('conta SYSDBA recusada deixa só aquele estabelecimento indisponível', async () => {
    const { n } = nucleo({ FB_HS_USUARIO: 'SYSDBA' });
    const saude = await n.partida();
    const hs = saude.find((s) => s.codigo === 'hs');
    expect(hs).toMatchObject({ disponivel: false, conectado: false });
    expect(hs?.motivo).toMatch(/FB_HS_USUARIO: SYSDBA é recusado/);
    expect((await n.verificarSchema('hs')).estado).toBe('indisponivel');
    expect(saude.find((s) => s.codigo === 'pc')?.disponivel).toBe(true);
    await n.encerrar();
  });

  it('exceção de dev da conta SYSDBA é avisada e aparece na saúde', async () => {
    const { n, avisos } = nucleo({ FB_PC_USUARIO: 'SYSDBA', SGH_DEV_PERMITIR_SYSDBA: 'sim' });
    expect(avisos[0]).toMatch(/SYSDBA aceita só em dev/);
    expect(n.saude().find((s) => s.codigo === 'pc')).toMatchObject({
      sysdbaDev: true,
      motivo: 'Ainda não verificado.',
    });
    await expect(n.conferirEstabelecimento('xx')).rejects.toThrow(/não configurado/);
    await n.encerrar();
  });

  it('sem REDE_PADRAO o núcleo não sobe (ARQ-2)', () => {
    const env = { ...ambienteFicticio(['pc']), REDE_PADRAO: '' };
    expect(() => new NucleoLegado({ env, driver: criarDubleDriver(), pastaHomologada: pasta })).toThrow(
      /REDE_PADRAO/,
    );
  });
});

describe('identificação', () => {
  it('normaliza nome sem caixa, acento e pontuação', () => {
    expect(normalizarNome('  Hospital  São-José, Ltda. ')).toBe('HOSPITAL SAO JOSE LTDA');
  });
  it('confere com o nome do hospital ou com a razão social', async () => {
    const id = await lerIdentificacao({
      hospital: 'pc',
      consultar: async (sql: string) =>
        (await responder(sql, [], {
          destino: { host: '', porta: 1, banco: '', usuario: '', senha: '' },
          cancelado: () => false,
        })) as never,
      lerBlob: async () => Buffer.alloc(0),
    });
    expect(id).toMatchObject({
      cnesHospital: 1234567,
      cnesEmpresa: null,
      razaoSocial: 'EMPRESA EXEMPLO LTDA',
    });
    expect(nomeConfere('Empresa Exemplo Ltda', id)).toBe(true);
    expect(nomeConfere('Outro', id)).toBe(false);
    // Sufixo societário ignorado: a tela mostra o nome, o banco guarda a razão social.
    expect(nomeConfere('Empresa Exemplo', id)).toBe(true);
    expect(nomeConfere('Empresa Exemplo S/A', id)).toBe(true);
    expect(nomeConfere('Empresa', id)).toBe(false);
  });

  it('mais unidades que o limite: lista cortada e sinalizada, sem virar falha de conexão', async () => {
    const id = await lerIdentificacao({
      hospital: 'pc',
      consultar: async (sql: string) =>
        (sql.includes('FROM TBUNIDAD')
          ? Array.from({ length: LIMITE_UNIDADES + 1 }, (_, i) => ({ COD: i + 1, NOME: `U${i}`, CNES: null }))
          : []) as never,
      lerBlob: async () => Buffer.alloc(0),
    });
    expect(id.unidades).toHaveLength(LIMITE_UNIDADES);
    expect(id.unidadesCortadas).toBe(true);
  });
});

describe('NucleoLegado: estado depois da partida', () => {
  const pastaZ = mkdtempSync(join(tmpdir(), 'sgh-nucleo-z-'));
  afterAll(() => rmSync(pastaZ, { recursive: true, force: true }));
  let fora = false;
  const r: Responder = (sql, p, c) => {
    if (fora) throw new Error('connection refused');
    return responder(sql, p, c);
  };
  const criar = (codigos: string[], pastaH: string) =>
    new NucleoLegado({
      env: ambienteFicticio(codigos),
      driver: criarDubleDriver(r),
      pastaHomologada: pastaH,
    });

  it('banco fora na partida: a verificação seguinte reconecta e libera; falha depois apaga a impressão', async () => {
    fora = false;
    const preparo = criar(['pc'], pastaZ);
    await preparo.verificarSchema('pc');
    gravarHomologada(pastaZ, preparo.ultimaImpressao('pc') as never);
    await preparo.encerrar();

    fora = true;
    const n = criar(['pc'], pastaZ);
    const [antes] = await n.partida();
    expect(antes).toMatchObject({ disponivel: false, conectado: false });
    fora = false;
    await n.verificarSchema('pc'); // o POST de config/schema/verificar
    const [depois] = n.saude();
    expect(depois).toMatchObject({ disponivel: true, conectado: true, motivo: null });
    expect(n.ultimaImpressao('pc')).toBeDefined();

    fora = true;
    const m = await n.verificarSchema('pc');
    expect(m.estado).toBe('indisponivel');
    expect(n.ultimaImpressao('pc')).toBeUndefined(); // nunca compara com impressão velha
    expect(n.saude()[0]).toMatchObject({ disponivel: false, conectado: false });
    await n.encerrar();
  });

  it('nova tentativa periódica devolve o estabelecimento ao seletor quando o banco volta', async () => {
    fora = true;
    const n = criar(['pc'], pastaZ);
    await n.partida();
    expect(n.saude()[0]?.disponivel).toBe(false);
    fora = false;
    n.reverificarPeriodicamente(10);
    await new Promise((ok) => setTimeout(ok, 150));
    expect(n.saude()[0]?.disponivel).toBe(true);
    await n.encerrar();
  });

  it('homologadas diferentes entre os bancos bloqueiam as escritas dos dois (mesmo modelo)', async () => {
    fora = false;
    const pastaD = mkdtempSync(join(tmpdir(), 'sgh-nucleo-d-'));
    try {
      const preparo = criar(['pc', 'hs'], pastaD);
      for (const c of ['pc', 'hs']) {
        await preparo.verificarSchema(c);
        gravarHomologada(pastaD, preparo.ultimaImpressao(c) as never);
      }
      await preparo.encerrar();
      const n = criar(['pc', 'hs'], pastaD);
      const saude = await n.partida();
      for (const s of saude) {
        expect(s.schema?.estado).toBe('divergente');
        expect(s.schema?.bloqueiaTudo).toBe(true);
        expect(s.motivo).toMatch(/mesmo modelo/);
      }
      expect(n.schema.bloqueada('pc', ['TB_PC'])).toBe(true);
      await n.encerrar();
    } finally {
      rmSync(pastaD, { recursive: true, force: true });
    }
  });
});
