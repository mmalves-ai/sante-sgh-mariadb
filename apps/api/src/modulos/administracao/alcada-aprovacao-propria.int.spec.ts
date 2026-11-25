// Contrato de efeito das alçadas de aprovação (01-ADM L59, escopo do usuário) no MariaDB:
// - a regra gravada deixa alcada_aprovacao (número de níveis tirado das linhas) e uma linha por aprovador em
//   alcada_aprovacao_nivel, com trilha na mesma transação; recusas do domínio e do banco não gravam nada;
// - a vigência nova do mesmo documento encerra a anterior na véspera, na mesma gravação;
// - a troca de níveis deixa as linhas antigas com exclusão lógica (nunca apagadas) e as novas com sequência nova;
//   com pedido de aprovação na regra, a troca é recusada;
// - encerrar fecha a vigência; a regra que ainda não começou é desativada;
// - a visão da conta mostra em quais níveis ela aprova, direto ou pelo perfil vigente. Massa sintética (prefixo L59A).
import { randomUUID } from 'node:crypto';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { AlcadaAprovacaoPropria } from './alcada-aprovacao-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L59A';

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema.codigo ?? '');
    return `outro: ${(e as Error)?.message ?? ''}`;
  }
}

describe.skipIf(SEM_BANCO)('alçadas de aprovação no banco próprio', () => {
  const nucleo = new NucleoProprio();
  let porta: AlcadaAprovacaoPropria;
  const ids = { est: 0, a: 0, b: 0, tipo: 0, perfil: 0 };
  const ctx = () => ({
    hospital: P,
    login: `${P}.A`,
    correlacao: 'teste-l59a',
    chaveIdempotencia: `tl59a-${randomUUID()}`,
  });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l59a' }, (l) => l.uma(sql, p));
  const todos = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l59a' }, (l) => l.consultar(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['q'] ?? -1);

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l59a' }, async (e) => {
      if (ids.est) {
        await e.executar('DELETE FROM pedido_aprovacao WHERE estabelecimento_id = ?', [ids.est]);
        await e.executar(
          'DELETE n FROM alcada_aprovacao_nivel n JOIN alcada_aprovacao a ON a.id = n.alcada_aprovacao_id WHERE a.estabelecimento_id = ?',
          [ids.est],
        );
        await e.executar('DELETE FROM alcada_aprovacao WHERE estabelecimento_id = ?', [ids.est]);
        await e.executar('DELETE FROM usuario_perfil WHERE estabelecimento_id = ?', [ids.est]);
        await e.executar('DELETE FROM usuario_estabelecimento WHERE estabelecimento_id = ?', [ids.est]);
      }
      await limparTrilhaDaMassa(e, { codigos: [P] });
    });
  }

  beforeAll(async () => {
    if ((await nucleo.cliente(CLIENTE)).banco !== `cliente_${CLIENTE}`)
      throw new Error('Cliente de teste inesperado.');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l59a' }, async (e) => {
      const hoje = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      ids.est = await g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, hoje],
      );
      for (const k of ['a', 'b'] as const) {
        ids[k] = await g(
          'SELECT id FROM usuario WHERE login = ?',
          [`${P}.${k.toUpperCase()}`],
          "INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, criado_em) VALUES (?, 'PESSOA SINTETICA', TRUE, 'pessoa', ?)",
          [`${P}.${k.toUpperCase()}`, hoje],
        );
      }
      ids.tipo = await g(
        'SELECT id FROM tipo_documento_aprovacao WHERE codigo = ?',
        [`${P}D`],
        "INSERT INTO tipo_documento_aprovacao (codigo, descricao, criado_em) VALUES (?, 'DOCUMENTO SINTETICO', ?)",
        [`${P}D`, hoje],
      );
      ids.perfil = await g(
        'SELECT id FROM perfil_acesso WHERE codigo = ? AND estabelecimento_id = ?',
        [`${P}P`, ids.est],
        "INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, 'PERFIL SINTETICO', ?)",
        [ids.est, `${P}P`, hoje],
      );
    });
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l59a' }, async (e) => {
      // A conta A tem acesso ao estabelecimento e o perfil sintético; a B não tem acesso.
      await e.inserir(
        "INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, padrao, vigencia_inicio, criado_em) VALUES (?, ?, TRUE, '2026-01-01', NOW(3))",
        [ids.a, ids.est],
      );
      await e.inserir(
        "INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, '2026-01-01', NOW(3))",
        [ids.a, ids.perfil, ids.est],
      );
    });
    porta = new AlcadaAprovacaoPropria(nucleo, CLIENTE, () => '2026-11-25');
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  const base = {
    documento: `${P}D`,
    descricao: 'REGRA SINTETICA',
    modo: 'serie' as const,
    prazoHoras: 48,
    vigenciaInicio: '2026-01-01',
    niveis: [
      { nivel: 1, perfil: `${P}P`, valorMinimo: 0, valorMaximo: 1000 },
      { nivel: 2, usuario: `${P}.A`, valorMinimo: 0, valorMaximo: null },
    ],
  };
  let primeira = 0;

  it('grava a regra com os níveis e a trilha; recusas não gravam', async () => {
    const r = await porta.gravarAlcada(ctx(), base);
    primeira = r.resultado.alcada;
    const a = await um(
      'SELECT quantidade_niveis, modo_aprovacao, prazo_horas, ativo FROM alcada_aprovacao WHERE id = ?',
      [primeira],
    );
    expect(Number(a?.['quantidade_niveis'])).toBe(2);
    expect(a?.['modo_aprovacao']).toBe('serie');
    const ns = await todos(
      'SELECT nivel, sequencia, perfil_acesso_id, aprovador_usuario_id, valor_unitario_maximo FROM alcada_aprovacao_nivel WHERE alcada_aprovacao_id = ? ORDER BY sequencia',
      [primeira],
    );
    expect(ns.map((n) => [Number(n['nivel']), Number(n['sequencia'])])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(Number(ns[0]?.['perfil_acesso_id'])).toBe(ids.perfil);
    expect(Number(ns[1]?.['aprovador_usuario_id'])).toBe(ids.a);
    expect(ns[1]?.['valor_unitario_maximo']).toBeNull();
    expect(
      await contar(
        "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'alcada_aprovacao'",
        [ids.est],
      ),
    ).toBeGreaterThan(0);

    const antes = await contar('SELECT COUNT(*) AS q FROM alcada_aprovacao WHERE estabelecimento_id = ?', [
      ids.est,
    ]);
    expect(
      await codigo(
        porta.gravarAlcada(ctx(), {
          ...base,
          vigenciaInicio: '2028-01-01',
          niveis: [
            { nivel: 1, perfil: `${P}P`, valorMaximo: 5000 },
            { nivel: 2, perfil: `${P}P`, valorMaximo: 1000 },
          ],
        }),
      ),
    ).toBe('teto-decrescente');
    expect(
      await codigo(
        porta.gravarAlcada(ctx(), {
          ...base,
          vigenciaInicio: '2028-01-01',
          niveis: [{ nivel: 1, usuario: `${P}.B` }],
        }),
      ),
    ).toBe('aprovador-sem-acesso');
    expect(
      await codigo(
        porta.gravarAlcada(ctx(), { ...base, vigenciaInicio: '2026-06-01', vigenciaFim: '2026-07-01' }),
      ),
    ).toBe('vigencia-sobreposta');
    expect(
      await contar('SELECT COUNT(*) AS q FROM alcada_aprovacao WHERE estabelecimento_id = ?', [ids.est]),
    ).toBe(antes);
  });

  let segunda = 0;
  it('vigência nova encerra a anterior na véspera, na mesma gravação', async () => {
    const r = await porta.gravarAlcada(ctx(), {
      ...base,
      descricao: 'REGRA SINTETICA 2027',
      vigenciaInicio: '2027-01-01',
    });
    segunda = r.resultado.alcada;
    expect(r.resultado.encerrada).toBe(primeira);
    const a = await um('SELECT vigencia_fim FROM alcada_aprovacao WHERE id = ?', [primeira]);
    expect(
      String(
        a?.['vigencia_fim'] instanceof Date ? (a['vigencia_fim'] as Date).toISOString() : a?.['vigencia_fim'],
      ),
    ).toContain('2026-12-3');
  });

  it('troca de níveis: antigos com exclusão lógica e sequência nova; com pedido, recusada', async () => {
    const v = await um('SELECT versao FROM alcada_aprovacao WHERE id = ?', [segunda]);
    await porta.gravarAlcada(ctx(), {
      ...base,
      id: segunda,
      versao: Number(v?.['versao']),
      descricao: 'REGRA SINTETICA 2027',
      vigenciaInicio: '2027-01-01',
      niveis: [{ nivel: 1, perfil: `${P}P`, valorMaximo: null }],
    });
    const ns = await todos(
      'SELECT sequencia, excluido_em FROM alcada_aprovacao_nivel WHERE alcada_aprovacao_id = ? ORDER BY sequencia',
      [segunda],
    );
    expect(ns.length).toBe(3);
    expect(ns.filter((n) => n['excluido_em'] !== null).map((n) => Number(n['sequencia']))).toEqual([1, 2]);
    expect(ns.filter((n) => n['excluido_em'] === null).map((n) => Number(n['sequencia']))).toEqual([3]);
    expect(
      Number(
        (await um('SELECT quantidade_niveis FROM alcada_aprovacao WHERE id = ?', [segunda]))?.[
          'quantidade_niveis'
        ],
      ),
    ).toBe(1);

    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l59a' }, (e) =>
      e.inserir(
        `INSERT INTO pedido_aprovacao (estabelecimento_id, tipo_documento_aprovacao_id, alcada_aprovacao_id, nivel_atual, entidade,
            entidade_id, descricao, valor, solicitante_usuario_id, solicitado_em, situacao, criado_em)
         VALUES (?, ?, ?, 1, 'sintetico', 1, 'PEDIDO SINTETICO', 10, ?, NOW(3), 'pendente', NOW(3))`,
        [ids.est, ids.tipo, primeira, ids.b],
      ),
    );
    const v1 = await um('SELECT versao FROM alcada_aprovacao WHERE id = ?', [primeira]);
    expect(
      await codigo(
        porta.gravarAlcada(ctx(), {
          ...base,
          id: primeira,
          versao: Number(v1?.['versao']),
          vigenciaFim: '2026-12-31',
          niveis: [{ nivel: 1, perfil: `${P}P` }],
        }),
      ),
    ).toBe('regra-em-uso');
    // Sem troca de níveis, a regra usada aceita mudar o prazo.
    const ok = await porta.gravarAlcada(ctx(), {
      ...base,
      id: primeira,
      versao: Number(v1?.['versao']),
      vigenciaFim: '2026-12-31',
      prazoHoras: 24,
    });
    expect(ok.resultado.alcada).toBe(primeira);
    expect(
      Number(
        (await um('SELECT prazo_horas FROM alcada_aprovacao WHERE id = ?', [primeira]))?.['prazo_horas'],
      ),
    ).toBe(24);
  });

  it('visão da conta: aprova pelo perfil e direto', async () => {
    const p = await porta.painel({ hospital: P, login: `${P}.A` }, `${P}.A`);
    expect(p.documentos.some((d) => d.codigo === `${P}D`)).toBe(true);
    expect(p.alcadas.length).toBe(2);
    const minha = (p.doUsuario ?? []).filter((x) => x.alcada === primeira);
    expect(minha.map((x) => `${x.nivel}:${x.via}`).sort()).toEqual(['1:perfil', '2:conta']);
  });

  it('encerrar: a regra futura é desativada e a vigente fecha hoje', async () => {
    const v2 = await um('SELECT versao FROM alcada_aprovacao WHERE id = ?', [segunda]);
    const r2 = await porta.encerrarAlcada(ctx(), { id: segunda, versao: Number(v2?.['versao']) });
    expect(r2.resultado.acao).toBe('desativar');
    expect(Number((await um('SELECT ativo FROM alcada_aprovacao WHERE id = ?', [segunda]))?.['ativo'])).toBe(
      0,
    );
    const v1 = await um('SELECT versao FROM alcada_aprovacao WHERE id = ?', [primeira]);
    expect(
      await codigo(
        porta.encerrarAlcada(ctx(), { id: primeira, versao: Number(v1?.['versao']), fim: '2027-02-01' }),
      ),
    ).toBe('encerramento-invalido');
    const r1 = await porta.encerrarAlcada(ctx(), { id: primeira, versao: Number(v1?.['versao']) });
    expect(r1.resultado.acao).toBe('fechar');
    // As duas regras e todas as linhas de nível continuam no banco.
    expect(
      await contar('SELECT COUNT(*) AS q FROM alcada_aprovacao WHERE estabelecimento_id = ?', [ids.est]),
    ).toBe(2);
  });
});
