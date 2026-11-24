// Contrato de efeito da manutenção dos locais de atendimento (02-REC linha 34) contra o MariaDB real, no cliente de
// teste (f22_o1 por padrão). Massa SINTÉTICA própria (estabelecimento f322l, logins teste.f322l.*), idempotente; os
// registros do lote são limpos antes e depois. Prova o que fica no banco: o local incluído, a semana de funcionamento
// trocada inteira, o encaminhamento e a visibilidade entre locais com exclusão lógica (quem e quando) e reativação da
// mesma linha, os usuários do local com o papel, a trilha na mesma transação e as recusas do domínio (faixa
// sobreposta, origem que não encaminha, local ligado a si, usuário sem papel), sem gravar nada na recusa.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { LocaisAtendimentoPropria } from './locais-atendimento.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'f322l';
const LOGINS = ['teste.f322l.a', 'teste.f322l.b'] as const;
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

describe.skipIf(SEM_BANCO)('manutenção dos locais de atendimento (banco próprio, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let locais: LocaisAtendimentoPropria;
  const ids = { est: 0, recepcao: 0, a: 0, b: 0, l1: 0, l2: 0, l3: 0 };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    const est = [ids.est];
    for (const [t, c] of [
      ['local_atendimento_horario', 'local_atendimento_id'],
      ['local_atendimento_encaminhamento', 'local_atendimento_id'],
      ['local_atendimento_visibilidade', 'local_atendimento_id'],
      ['usuario_local_atendimento', 'local_atendimento_id'],
    ] as const)
      await e.executar(
        `DELETE x FROM ${t} x JOIN local_atendimento la ON la.id = x.${c} WHERE la.estabelecimento_id = ?`,
        est,
      );
    await e.executar('DELETE FROM local_atendimento WHERE estabelecimento_id = ?', est);
  };
  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-f322l' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const ctx = (login: string = LOGINS[0]) => ({
    hospital: EST,
    login,
    correlacao: 'teste-f322l',
    chaveIdempotencia: `f322l-${randomUUID()}`,
  });
  const manter = (entrada: Record<string, unknown>) => locais.manter(ctx(), entrada);
  const contar = async (sql: string, p: unknown[]) => Number((await ler<{ n: number }>(sql, p))[0]?.n ?? 0);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    locais = new LocaisAtendimentoPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f322l' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, `Hospital sintético ${EST}`, `Hospital sintético ${EST} (fictício)`, agora],
      );
      await limpar(e);
      const [a, b] = LOGINS;
      ids.a = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [a],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [a, 'USUARIO SINTETICO F322L A', agora],
      );
      ids.b = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [b],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [b, 'USUARIO SINTETICO F322L B', agora],
      );
      ids.recepcao = await garantir(
        e,
        'SELECT id FROM ponto_recepcao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'F322L'],
        'INSERT INTO ponto_recepcao (estabelecimento_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?)',
        [ids.est, 'F322L', 'RECEPCAO SINTETICA F322L', agora],
      );
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f322l' }, async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
    });
  });

  it('inclui os locais da unidade e recusa código repetido e recepção de fora', async () => {
    const incluir = async (codigo: string, permiteEncaminhamento: boolean) =>
      (
        await manter({
          acao: 'incluir',
          codigo,
          descricao: `CONSULTORIO SINTETICO ${codigo}`,
          recepcao: ids.recepcao,
          permiteEncaminhamento,
        })
      ).resultado.local;
    ids.l1 = await incluir('C1', true);
    ids.l2 = await incluir('C2', false);
    ids.l3 = await incluir('C3', false);
    await expect(
      manter({
        acao: 'incluir',
        codigo: 'C1',
        descricao: 'X',
        recepcao: ids.recepcao,
        permiteEncaminhamento: false,
      }),
    ).rejects.toMatchObject(recusada('local-codigo-repetido'));
    await expect(
      manter({
        acao: 'incluir',
        codigo: 'C9',
        descricao: 'X',
        recepcao: 999999999,
        permiteEncaminhamento: false,
      }),
    ).rejects.toMatchObject(recusada('recepcao-invalida'));
    const l = await ler<{ criado_por: number; ponto_recepcao_id: number }>(
      'SELECT criado_por, ponto_recepcao_id FROM local_atendimento WHERE id = ?',
      [ids.l1],
    );
    expect(Number(l[0]!.criado_por)).toBe(ids.a);
    expect(Number(l[0]!.ponto_recepcao_id)).toBe(ids.recepcao);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'local_atendimento' AND entidade_id = ?",
        [ids.l1],
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it('grava a semana de funcionamento inteira e recusa faixa sobreposta sem tocar na gravada', async () => {
    const semana = [
      { diaSemana: 2, diaNaoUtil: false, inicio: '08:00', fim: '12:00' },
      { diaSemana: 2, diaNaoUtil: false, inicio: '13:00', fim: '17:00' },
      { diaSemana: null, diaNaoUtil: true, inicio: '08:00', fim: '12:00' },
    ];
    expect((await manter({ acao: 'horario', local: ids.l1, faixas: semana })).resultado.itens).toBe(3);
    await manter({ acao: 'horario', local: ids.l1, faixas: semana.slice(0, 2) });
    const sql =
      "SELECT COUNT(*) AS n FROM local_atendimento_horario WHERE local_atendimento_id = ? AND hora_inicio IN ('08:00:00','13:00:00')";
    expect(await contar(sql, [ids.l1])).toBe(2);
    await expect(
      manter({
        acao: 'horario',
        local: ids.l1,
        faixas: [semana[0], { diaSemana: 2, diaNaoUtil: false, inicio: '11:00', fim: '14:00' }],
      }),
    ).rejects.toMatchObject(recusada('horario-sobreposto'));
    expect(
      await contar('SELECT COUNT(*) AS n FROM local_atendimento_horario WHERE local_atendimento_id = ?', [
        ids.l1,
      ]),
    ).toBe(2);
    const lista = await locais.lista({ hospital: EST, login: LOGINS[0] });
    expect(
      lista.locais.find((x) => x.id === ids.l1)!.horario.map((f) => `${f.diaSemana}-${f.inicio}-${f.fim}`),
    ).toEqual(['2-08:00-12:00', '2-13:00-17:00']);
  });

  it('encaminha só de quem encaminha; retirar é exclusão lógica e voltar reativa a mesma linha', async () => {
    await expect(
      manter({ acao: 'encaminhamentos', local: ids.l2, destinos: [ids.l1] }),
    ).rejects.toMatchObject(recusada('local-nao-encaminha'));
    await expect(
      manter({ acao: 'encaminhamentos', local: ids.l1, destinos: [ids.l1] }),
    ).rejects.toMatchObject(recusada('local-ligado-a-si'));
    await manter({ acao: 'encaminhamentos', local: ids.l1, destinos: [ids.l2, ids.l3] });
    await manter({ acao: 'encaminhamentos', local: ids.l1, destinos: [ids.l3] });
    const linhas = () =>
      ler<{ id: number; d: number; excluido_em: Date | null; excluido_por: number | null }>(
        `SELECT id, destino_local_atendimento_id AS d, excluido_em, excluido_por FROM local_atendimento_encaminhamento
          WHERE local_atendimento_id = ? ORDER BY d`,
        [ids.l1],
      );
    const r1 = await linhas();
    expect(r1).toHaveLength(2);
    const doL2 = r1.find((x) => Number(x.d) === ids.l2)!;
    expect(doL2.excluido_em).not.toBeNull();
    expect(Number(doL2.excluido_por)).toBe(ids.a);
    await manter({ acao: 'encaminhamentos', local: ids.l1, destinos: [ids.l2, ids.l3] });
    const r2 = await linhas();
    expect(r2).toHaveLength(2);
    expect(r2.every((x) => x.excluido_em === null)).toBe(true);
    expect(Number(r2.find((x) => Number(x.d) === ids.l2)!.id)).toBe(Number(doL2.id));
    // Desmarcar "encaminha" com encaminhamentos ativos é recusado.
    await expect(
      manter({
        acao: 'dados',
        local: ids.l1,
        descricao: 'CONSULTORIO SINTETICO C1',
        permiteEncaminhamento: false,
        ativo: true,
      }),
    ).rejects.toMatchObject(recusada('local-com-encaminhamentos'));
  });

  it('grava os locais que o local consulta e quem o opera ou atende nele', async () => {
    await manter({ acao: 'visibilidade', local: ids.l2, consultados: [ids.l1] });
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM local_atendimento_visibilidade WHERE local_atendimento_id = ? AND consultado_local_atendimento_id = ? AND excluido_em IS NULL',
        [ids.l2, ids.l1],
      ),
    ).toBe(1);
    await expect(
      manter({
        acao: 'usuarios',
        local: ids.l1,
        usuarios: [{ usuario: ids.a, atuaNoLocal: false, podeOperar: false }],
      }),
    ).rejects.toMatchObject(recusada('usuario-sem-papel'));
    await manter({
      acao: 'usuarios',
      local: ids.l1,
      usuarios: [
        { usuario: ids.a, atuaNoLocal: true, podeOperar: true },
        { usuario: ids.b, atuaNoLocal: false, podeOperar: true },
      ],
    });
    await manter({
      acao: 'usuarios',
      local: ids.l1,
      usuarios: [{ usuario: ids.a, atuaNoLocal: true, podeOperar: false }],
    });
    const u = await ler<{
      usuario_id: number;
      atua_no_local: number;
      pode_operar: number;
      excluido_em: Date | null;
    }>(
      'SELECT usuario_id, atua_no_local, pode_operar, excluido_em FROM usuario_local_atendimento WHERE local_atendimento_id = ? ORDER BY usuario_id',
      [ids.l1],
    );
    expect(
      u.map((x) => [
        Number(x.usuario_id),
        Number(x.atua_no_local),
        Number(x.pode_operar),
        x.excluido_em === null,
      ]),
    ).toEqual(
      [
        [ids.a, 1, 0, true],
        [ids.b, 0, 1, false],
      ].sort((p, q) => Number(p[0]) - Number(q[0])),
    );
    const lista = await locais.lista({ hospital: EST, login: LOGINS[0] });
    const l1 = lista.locais.find((x) => x.id === ids.l1)!;
    expect(l1.usuarios.map((x) => x.usuario)).toEqual([ids.a]);
    expect(lista.locais.find((x) => x.id === ids.l2)!.consulta).toEqual([ids.l1]);
    expect(l1.encaminhaPara).toEqual([ids.l2, ids.l3].sort((p, q) => p - q));
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'local_atendimento' AND entidade_id = ?",
        [ids.l1],
      ),
    ).toBeGreaterThanOrEqual(7);
  });
});
