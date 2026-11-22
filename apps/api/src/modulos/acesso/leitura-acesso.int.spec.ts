// Integração da leitura das telas de consulta do acesso (perfis e mapa módulo → ação) contra o MariaDB real, no
// cliente de teste da onda 2 (f22_o2). Massa SINTÉTICA do lote 02-03 (estabelecimento l0203g, conta teste.l0203g,
// perfil L0203-CONSULTA com uma ação permitida e uma negada do catálogo carregado pelo "criar cliente"), idempotente no
// beforeAll e limpa no afterAll. Confere: o perfil do estabelecimento com usuários em faixa e as ações contadas, o
// perfil de outro estabelecimento fora, e o mapa do módulo com o código da ação. SGH_NUCLEO_SEM_BANCO=1 pula o arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LeituraAcesso } from './legado-acesso.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'l0203g';
const LOGIN = 'teste.l0203g';
const PERFIL = 'L0203-CONSULTA';

describe.skipIf(SEM_BANCO)('leitura própria das telas de consulta do acesso (cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  const ids = { est: 0, usuario: 0, perfil: 0, modulo: 0, acoes: [] as number[], codigo: '' };

  async function garantir(
    e: Escritor,
    sel: string,
    p: unknown[],
    ins: string,
    pi: unknown[],
  ): Promise<number> {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-l0203g' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, `Hospital sintético ${EST}`, `Hospital sintético ${EST} (fictício)`, agora],
      );
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        "INSERT INTO usuario (login, nome, dispensa_cpf, situacao, criado_em) VALUES (?, ?, TRUE, 'ativo', ?)",
        [LOGIN, 'USUARIO SINTETICO L0203G', agora],
      );
      ids.perfil = await garantir(
        e,
        'SELECT id FROM perfil_acesso WHERE codigo = ? AND estabelecimento_id = ?',
        [PERFIL, ids.est],
        `INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, privilegiado, criado_em)
         VALUES (?, ?, 'Perfil sintético de consulta', TRUE, ?)`,
        [ids.est, PERFIL, agora],
      );
      await garantir(
        e,
        'SELECT id FROM usuario_perfil WHERE usuario_id = ? AND perfil_acesso_id = ?',
        [ids.usuario, ids.perfil],
        `INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2020-01-01', ?)`,
        [ids.usuario, ids.perfil, ids.est, agora],
      );
      // Módulo e ações sintéticos do lote no catálogo do cliente (o catálogo de teste pode vir vazio).
      ids.modulo = await garantir(
        e,
        'SELECT id FROM modulo_sistema WHERE codigo = ?',
        ['l0203'],
        "INSERT INTO modulo_sistema (codigo, descricao, area, criado_em) VALUES ('l0203', 'Módulo sintético 02-03', 'teste', ?)",
        [agora],
      );
      ids.codigo = 'l0203.teste.ver';
      ids.acoes = [];
      for (const [codigo, tipo] of [
        ['l0203.teste.ver', 'ver'],
        ['l0203.teste.incluir', 'incluir'],
      ] as const)
        ids.acoes.push(
          await garantir(
            e,
            'SELECT id FROM acao_sistema WHERE codigo = ?',
            [codigo],
            'INSERT INTO acao_sistema (codigo, descricao, modulo_sistema_id, tipo_acao, criado_em) VALUES (?, ?, ?, ?, ?)',
            [codigo, `Ação sintética ${codigo}`, ids.modulo, tipo, agora],
          ),
        );
      await e.executar('DELETE FROM perfil_acao WHERE perfil_acesso_id = ?', [ids.perfil]);
      await e.inserir(
        'INSERT INTO perfil_acao (perfil_acesso_id, acao_sistema_id, permitido, criado_em) VALUES (?, ?, TRUE, ?), (?, ?, FALSE, ?)',
        [ids.perfil, ids.acoes[0], agora, ids.perfil, ids.acoes[1], agora],
      );
    });
  });

  afterAll(async () => {
    await nucleo?.escrever({ cliente: CLIENTE, correlacao: 'limpeza-l0203g' }, (e) =>
      e.executar('DELETE FROM perfil_acao WHERE perfil_acesso_id = ?', [ids.perfil]),
    );
    await nucleo?.encerrar();
  });

  it('perfis do estabelecimento com usuários em faixa e ações; o estabelecimento inexistente não tem perfil', async () => {
    const leitura = new LeituraAcesso({ cliente: CLIENTE, lerSomente: (c, fn) => nucleo.lerSomente(c, fn) });
    const grupos = await leitura.grupos(EST);
    expect(grupos.find((g) => g.grupo === PERFIL)).toMatchObject({
      ativo: true,
      usuariosAtivos: '<5',
      opcoesLegado: 2,
      permissoesNovo: 1,
      destino: 'perfil',
      perfil: PERFIL,
      nivel: 'privilegiado',
    });
    expect(await leitura.grupos('l0203x')).toEqual([]);
    expect((await leitura.grupos('l0203e')).some((g) => g.grupo === PERFIL)).toBe(false);
  });

  it('módulos do catálogo com as ações, e o mapa do módulo com o código da ação', async () => {
    const leitura = new LeituraAcesso({ cliente: CLIENTE, lerSomente: (c, fn) => nucleo.lerSomente(c, fn) });
    const modulo = (await leitura.modulos(EST)).find((m) => m.id === ids.modulo);
    expect(modulo?.opcoes).toBeGreaterThanOrEqual(1);
    const mapa = await leitura.mapa(EST, ids.modulo);
    expect(mapa).toContainEqual(
      expect.objectContaining({ opcao: ids.acoes[0], permissao: ids.codigo, exclusao: null }),
    );
  });
});
