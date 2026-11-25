// Contrato de efeito da RECERTIFICAÇÃO DE ACESSOS no banco próprio (01-ADM L57), no MariaDB real (cliente f22_o2,
// massa sintética "l57r"): abrir grava a campanha e uma linha por conta do retrato; a leitura devolve os perfis
// vigentes no dia da abertura; decidir grava a decisão na linha do item (manter, reduzir com o perfil, revogar com o
// bloqueio), uma vez só; fechar grava quem fechou, o motivo e conta as pendentes; e as recusas (prazo vencido, motivo
// curto, escopo vazio, conta sem vínculo, alvo inexistente, decidir de novo, decidir ou fechar campanha fechada,
// validador do domínio) não deixam linha. Nada se apaga. Só ids e códigos sintéticos; nenhum dado real.
import { randomUUID } from 'node:crypto';
import { alvosDaRecert, itensDaCampanhaRecert } from '@sgh/dominio-acesso';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { fonteGestaoPropria } from './gestao-fonte-propria.js';
import type { FonteGestao } from './gestao-fonte.js';
import type { TrilhaGestao } from './gestao-tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'l57re';
const GESTOR = 'teste.l57r.gestor';
const CONTAS = ['teste.l57r.a', 'teste.l57r.b', 'teste.l57r.c'];
const FORA = 'teste.l57r.fora';
const PERFIL = 'l57r-perfil';
const PERFIL2 = 'l57r-perfil2';
const hoje = (): string => new Date().toISOString().slice(0, 10);
const daqui = (dias: number): string => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

const codigo = (p: Promise<unknown>) =>
  p.then(
    () => 'gravou',
    (e: unknown) => (e instanceof ErroOperacao ? String(e.problema.codigo ?? '') : `outro: ${String(e)}`),
  );

describe.skipIf(SEM_BANCO)('recertificação de acessos no banco próprio (MariaDB, cliente f22_o2)', () => {
  const nucleo = new NucleoProprio();
  let fonte: FonteGestao;
  const ids = { est: 0, gestor: 0 };
  const trilha = (): TrilhaGestao => ({
    evento: 'acesso.recertificacao',
    rede: 'teste',
    hospital: EST,
    usuario: GESTOR,
    estacao: 'teste:l57r',
    correlacao: `teste-l57r-${randomUUID()}`.slice(0, 64),
    recurso: 'acesso.recertificacao',
    resultado: 'sucesso',
  });
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l57r-conferir' }, (l) => l.consultar(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await ler(sql, p))[0]?.['n'] ?? -1);
  const campanhas = () =>
    contar('SELECT COUNT(*) AS n FROM recertificacao_acesso WHERE estabelecimento_id = ?', [ids.est]);
  const itensDoEst = () =>
    contar(
      `SELECT COUNT(*) AS n FROM recertificacao_acesso_item i JOIN recertificacao_acesso c ON c.id = i.recertificacao_acesso_id
        WHERE c.estabelecimento_id = ?`,
      [ids.est],
    );
  const abrir = (
    logins: readonly string[],
    extra: Partial<{
      prazo: string;
      motivo: string;
      escopo: 'grupo' | 'setor' | 'todos';
      alvo: string | null;
    }> = {},
  ) =>
    fonte.abrirCampanhaRecert(
      'teste',
      EST,
      {
        hospital: EST,
        escopo: extra.escopo ?? 'todos',
        alvo: extra.alvo ?? null,
        prazo: extra.prazo ?? daqui(15),
        motivo: extra.motivo ?? 'Revisão semestral dos acessos do hospital',
        por: GESTOR,
        hoje: hoje(),
        itens: logins.map((login) => ({ login, grupo: null, perfis: [] })),
      },
      trilha(),
    );
  const decidir = (
    campanha: string,
    login: string,
    decisao: 'manter' | 'retirar',
    acao: 'bloqueio' | 'revogacao' | null,
    perfil: string | null = null,
    validar: Parameters<FonteGestao['decidirRecert']>[4] = () => null,
  ) =>
    fonte.decidirRecert(
      'teste',
      EST,
      { hospital: EST, campanha, login, decisao, acao, perfil, motivo: 'Decisão da revisão', por: GESTOR },
      trilha(),
      validar,
    );

  async function limpar() {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l57r' }, async (e) => {
      const est = await e.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', [EST]);
      if (!est) return;
      await e.executar(
        `DELETE i FROM recertificacao_acesso_item i JOIN recertificacao_acesso c ON c.id = i.recertificacao_acesso_id
          WHERE c.estabelecimento_id = ?`,
        [est.id],
      );
      await e.executar('DELETE FROM recertificacao_acesso WHERE estabelecimento_id = ?', [est.id]);
      await limparTrilhaDaMassa(e, { codigos: [EST] });
    });
  }

  beforeAll(async () => {
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l57r' }, async (e) => {
      const agora = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      ids.est = await g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, 'Hospital sintético l57r', 'Hospital sintético l57r (fictício)', agora],
      );
      const perfis: number[] = [];
      for (const p of [PERFIL, PERFIL2])
        perfis.push(
          await g(
            'SELECT id FROM perfil_acesso WHERE codigo = ? AND estabelecimento_id = ?',
            [p, ids.est],
            'INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
            [ids.est, p, `Perfil sintético ${p}`, agora],
          ),
        );
      for (const login of [GESTOR, ...CONTAS, FORA]) {
        const u = await g(
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
          [login, `USUARIO SINTETICO ${login.toUpperCase()}`, agora],
        );
        if (login === GESTOR) ids.gestor = u;
        if (login === FORA) continue;
        await g(
          'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?',
          [u, ids.est],
          'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
          [u, ids.est, '2026-01-01', agora],
        );
        if (login === CONTAS[0])
          for (const pid of perfis)
            await g(
              'SELECT id FROM usuario_perfil WHERE usuario_id = ? AND perfil_acesso_id = ? AND estabelecimento_id = ?',
              [u, pid, ids.est],
              'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
              [u, pid, ids.est, '2026-01-01', agora],
            );
      }
    });
    fonte = fonteGestaoPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('abrir grava a campanha e uma linha por conta; a leitura traz os perfis do dia da abertura', async () => {
    const r = await abrir(CONTAS);
    expect(r.itens).toBe(3);
    const [c] = await ler(
      'SELECT escopo, situacao, prazo, criado_por, perfil_acesso_id FROM recertificacao_acesso WHERE id = ?',
      [r.id],
    );
    expect(c).toMatchObject({ escopo: 'todos', situacao: 'aberta' });
    expect(Number(c?.['criado_por'])).toBe(ids.gestor);
    const itens = await ler(
      `SELECT i.sequencia, u.login, i.decisao FROM recertificacao_acesso_item i JOIN usuario u ON u.id = i.usuario_id
        WHERE i.recertificacao_acesso_id = ? ORDER BY i.sequencia`,
      [r.id],
    );
    expect(itens.map((x) => [Number(x['sequencia']), x['login'], x['decisao']])).toEqual(
      CONTAS.map((l, k) => [k + 1, l, null]),
    );
    const lida = await fonte.campanhaRecert('teste', EST, r.id);
    expect(lida?.campanha).toMatchObject({
      escopo: 'todos',
      alvo: null,
      situacao: 'aberta',
      criadoPor: GESTOR,
    });
    expect(lida?.itens.find((i) => i.login === CONTAS[0])?.perfis).toEqual([PERFIL, PERFIL2]);
    expect((await fonte.campanhasRecert('teste', EST)).map((x) => x.id)).toContain(r.id);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'recertificacao_acesso' AND entidade_id = ?",
        [r.id],
      ),
    ).toBeGreaterThanOrEqual(1);
    // Fechar para as próximas campanhas do mesmo escopo.
    await fonte.fecharCampanhaRecert(
      'teste',
      EST,
      {
        hospital: EST,
        campanha: r.id,
        situacao: 'cancelada',
        motivo: 'Campanha de conferência do teste',
        por: GESTOR,
      },
      trilha(),
    );
  });

  it('as recusas da abertura não deixam linha', async () => {
    const [c0, i0] = [await campanhas(), await itensDoEst()];
    expect(await codigo(abrir(CONTAS, { prazo: hoje() }))).toBe('prazo-invalido');
    expect(await codigo(abrir(CONTAS, { motivo: 'curto' }))).toBe('motivo-curto');
    expect(await codigo(abrir([]))).toBe('escopo-vazio');
    expect(await codigo(abrir([...CONTAS, FORA]))).toBe('conta-fora');
    expect(await codigo(abrir(CONTAS, { escopo: 'grupo', alvo: 'l57r-nada' }))).toBe('alvo-inexistente');
    expect(await codigo(abrir(CONTAS, { escopo: 'setor', alvo: 'l57r-nada' }))).toBe('alvo-inexistente');
    expect([await campanhas(), await itensDoEst()]).toEqual([c0, i0]);
  });

  it('decidir grava manter, reduzir e revogar na linha do item, uma vez só; fechar conta as pendentes', async () => {
    const { id } = await abrir(CONTAS, { escopo: 'grupo', alvo: PERFIL });
    const [c] = await ler(
      'SELECT c.escopo, p.codigo FROM recertificacao_acesso c JOIN perfil_acesso p ON p.id = c.perfil_acesso_id WHERE c.id = ?',
      [id],
    );
    expect(c).toMatchObject({ escopo: 'perfil', codigo: PERFIL });
    expect(await decidir(id, CONTAS[0]!, 'retirar', 'revogacao', PERFIL2)).toHaveProperty('item');
    await decidir(id, CONTAS[1]!, 'retirar', 'bloqueio');
    const linhas = await ler(
      `SELECT u.login, i.decisao, i.acao, p.codigo AS perfil, i.decidido_por_usuario_id AS por, i.decidido_em
         FROM recertificacao_acesso_item i JOIN usuario u ON u.id = i.usuario_id
         LEFT JOIN perfil_acesso p ON p.id = i.perfil_acesso_id
        WHERE i.recertificacao_acesso_id = ? ORDER BY i.sequencia`,
      [id],
    );
    expect(linhas.map((x) => [x['login'], x['decisao'], x['acao'], x['perfil']])).toEqual([
      [CONTAS[0], 'reduzir', 'revogacao', PERFIL2],
      [CONTAS[1], 'revogar', 'bloqueio', null],
      [CONTAS[2], null, null, null],
    ]);
    expect(Number(linhas[0]?.['por'])).toBe(ids.gestor);
    expect(linhas[0]?.['decidido_em']).not.toBeNull();
    const lida = await fonte.campanhaRecert('teste', EST, id);
    expect(lida?.itens.find((i) => i.login === CONTAS[0])).toMatchObject({
      decisao: 'retirar',
      acao: 'revogacao',
      perfil: PERFIL2,
      decididoPor: GESTOR,
    });
    // Recusas: de novo, conta fora da campanha, validador do domínio.
    expect(await codigo(decidir(id, CONTAS[0]!, 'manter', null))).toBe('ja-decidido');
    expect(await codigo(decidir(id, FORA, 'manter', null))).toBe('item-inexistente');
    expect(
      await codigo(
        decidir(id, CONTAS[2]!, 'manter', null, null, () => ({
          codigo: 'regra-dominio',
          mensagem: 'recusada',
        })),
      ),
    ).toBe('regra-dominio');
    // Fechar: grava quem, quando, o motivo e conta a pendente; depois nada mais se decide nem se fecha.
    expect(
      await codigo(
        fonte.fecharCampanhaRecert(
          'teste',
          EST,
          { hospital: EST, campanha: id, situacao: 'encerrada', motivo: 'curto', por: GESTOR },
          trilha(),
        ),
      ),
    ).toBe('motivo-curto');
    const f = await fonte.fecharCampanhaRecert(
      'teste',
      EST,
      {
        hospital: EST,
        campanha: id,
        situacao: 'encerrada',
        motivo: 'Revisão concluída pelo gestor',
        por: GESTOR,
      },
      trilha(),
    );
    expect(f).toEqual({ id, situacao: 'encerrada', pendentes: 1 });
    const [fc] = await ler(
      'SELECT situacao, fechada_por_usuario_id AS por, fechada_em, motivo_fechamento FROM recertificacao_acesso WHERE id = ?',
      [id],
    );
    expect(fc).toMatchObject({ situacao: 'encerrada', motivo_fechamento: 'Revisão concluída pelo gestor' });
    expect(Number(fc?.['por'])).toBe(ids.gestor);
    expect(await codigo(decidir(id, CONTAS[2]!, 'manter', null))).toBe('campanha-fechada');
    expect(
      await codigo(
        fonte.fecharCampanhaRecert(
          'teste',
          EST,
          {
            hospital: EST,
            campanha: id,
            situacao: 'cancelada',
            motivo: 'Tentativa de fechar de novo',
            por: GESTOR,
          },
          trilha(),
        ),
      ),
    ).toBe('campanha-fechada');
    // Nada se apagou: as três linhas continuam.
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM recertificacao_acesso_item WHERE recertificacao_acesso_id = ?',
        [id],
      ),
    ).toBe(3);
  });

  it('o retrato traz o grupo, os perfis e os setores de cada conta; campanha por grupo e por setor grava o alvo e só as contas dele', async () => {
    const ontem = daqui(-1);
    // Massa: a conta B tem vínculo de trabalho no setor UTI; a conta C tem lotação vigente no CME, uma lotação
    // encerrada ontem (FIM) e uma lotação cuja última versão é a exclusão (EXC).
    const setor: Record<string, number> = {};
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l57r-setor' }, async (e) => {
      const agora = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      const primeiro = async (tabela: string, ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(`SELECT id FROM ${tabela} ORDER BY id LIMIT 1`, []);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      for (const c of ['UTI', 'CME', 'FIM', 'EXC'])
        setor[c] = await g(
          'SELECT id FROM setor_funcional WHERE codigo = ? AND estabelecimento_id = ?',
          [`L57R-${c}`, ids.est],
          "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'assistencial', ?)",
          [ids.est, `L57R-${c}`, `Setor sintético ${c}`, agora],
        );
      const centro = await g(
        'SELECT id FROM centro_custo WHERE codigo = ? AND estabelecimento_id = ?',
        ['L57R-CC', ids.est],
        "INSERT INTO centro_custo (estabelecimento_id, codigo, nome, vigencia_inicio, criado_em) VALUES (?, ?, 'Centro sintético l57r', '2026-01-01', ?)",
        [ids.est, 'L57R-CC', agora],
      );
      const cbo = await g(
        'SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ?',
        ['990571'],
        "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, area_saude, criado_em) VALUES ('990571', 'OCUPACAO SINTETICA L57R', FALSE, ?)",
        [agora],
      );
      const cargo = await g(
        'SELECT id FROM cargo WHERE codigo = ?',
        ['L57RC'],
        "INSERT INTO cargo (codigo, nome, ocupacao_cbo_id, data_inicio, criado_em) VALUES (?, 'CARGO SINTETICO L57R', ?, '2020-01-01', ?)",
        ['L57RC', cbo, agora],
      );
      const sexo = await e.uma<{ id: number }>('SELECT id FROM sexo ORDER BY id LIMIT 1', []);
      if (!sexo) throw new Error('O catálogo de sexo está vazio no cliente de teste.');
      const tipo = await primeiro(
        'tipo_vinculo_trabalho',
        "INSERT INTO tipo_vinculo_trabalho (codigo_cnes, nivel, codigo_vinculo, descricao, criado_em) VALUES ('L57R', 'vinculo', '97', 'Vínculo sintético', ?)",
        [agora],
      );
      const categoria = await primeiro(
        'categoria_trabalhador',
        "INSERT INTO categoria_trabalhador (codigo_esocial, descricao, grupo, criado_em) VALUES ('Z57', 'Categoria sintética', 'empregado', ?)",
        [agora],
      );
      const vinculoDe = async (login: string, cpf: string, setorDoVinculo: number | null) => {
        const u = await e.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [login]);
        const col = await g(
          'SELECT id FROM colaborador WHERE cpf = ?',
          [cpf],
          "INSERT INTO colaborador (usuario_id, nome, cpf, data_nascimento, sexo_id, grau_instrucao, criado_em) VALUES (?, 'COLABORADOR SINTETICO L57R', ?, '1990-01-01', ?, '07', ?)",
          [Number(u?.id), cpf, Number(sexo.id), agora],
        );
        return g(
          'SELECT id FROM vinculo_trabalho WHERE estabelecimento_id = ? AND matricula = ?',
          [ids.est, `L57R${cpf.slice(-2)}`],
          'INSERT INTO vinculo_trabalho (estabelecimento_id, colaborador_id, matricula, tipo_vinculo_trabalho_id, categoria_trabalhador_id, cargo_id, setor_funcional_id, data_admissao, salario_base, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1000, ?)',
          [ids.est, col, `L57R${cpf.slice(-2)}`, tipo, categoria, cargo, setorDoVinculo, '2026-01-01', agora],
        );
      };
      await vinculoDe(CONTAS[1]!, '00057100001', setor['UTI']!);
      const vc = await vinculoDe(CONTAS[2]!, '00057100002', null);
      const lotar = (s: number, fim: string | null, operacao: string, ocorrido: string) =>
        g(
          'SELECT id FROM lotacao WHERE vinculo_trabalho_id = ? AND setor_funcional_id = ? AND operacao = ?',
          [vc, s, operacao],
          "INSERT INTO lotacao (vinculo_trabalho_id, setor_funcional_id, centro_custo_id, data_inicio, data_fim, operacao, ocorrido_em, criado_em) VALUES (?, ?, ?, '2026-01-01', ?, ?, ?, ?)",
          [vc, s, centro, fim, operacao, ocorrido, agora],
        );
      await lotar(setor['CME']!, null, 'inclusao', '2026-01-01 08:00:00');
      await lotar(setor['FIM']!, null, 'inclusao', '2026-01-01 08:00:00');
      await e.executar(
        "UPDATE lotacao SET data_fim = ? WHERE vinculo_trabalho_id = ? AND setor_funcional_id = ? AND operacao = 'inclusao'",
        [ontem, vc, setor['FIM']],
      );
      await lotar(setor['EXC']!, null, 'inclusao', '2026-01-01 08:00:00');
      await lotar(setor['EXC']!, null, 'exclusao', '2026-02-01 08:00:00');
    });

    const todas = await fonte.contasRecert('teste', EST);
    const minhas = todas.filter((c) => [GESTOR, ...CONTAS, FORA].includes(c.login));
    expect(minhas.map((c) => c.login).sort()).toEqual([GESTOR, ...CONTAS].sort());
    const de = (login: string) => minhas.find((c) => c.login === login);
    expect(de(CONTAS[0]!)).toMatchObject({ grupo: PERFIL, perfis: [PERFIL, PERFIL2], setores: [] });
    expect(de(CONTAS[1]!)).toMatchObject({ grupo: null, perfis: [], setores: ['L57R-UTI'] });
    expect(de(CONTAS[2]!)?.setores).toEqual(['L57R-CME']);
    const alvos = alvosDaRecert(minhas);
    expect(alvos.grupos).toEqual([
      { valor: PERFIL, contas: 1 },
      { valor: PERFIL2, contas: 1 },
    ]);
    expect(alvos.setores).toEqual([
      { valor: 'L57R-CME', contas: 1 },
      { valor: 'L57R-UTI', contas: 1 },
    ]);

    const fechar = (campanha: string) =>
      fonte.fecharCampanhaRecert(
        'teste',
        EST,
        {
          hospital: EST,
          campanha,
          situacao: 'cancelada',
          motivo: 'Campanha de conferência do teste',
          por: GESTOR,
        },
        trilha(),
      );
    // Por grupo: quem tem o perfil, mesmo sem ser o principal.
    const doGrupo = itensDaCampanhaRecert(minhas, 'grupo', PERFIL2);
    expect(doGrupo.map((i) => i.login)).toEqual([CONTAS[0]]);
    const cg = await abrir(
      doGrupo.map((i) => i.login),
      { escopo: 'grupo', alvo: PERFIL2 },
    );
    expect(cg.itens).toBe(1);
    const [lg] = await ler(
      `SELECT c.escopo, p.codigo AS perfil, c.setor_funcional_id FROM recertificacao_acesso c
         LEFT JOIN perfil_acesso p ON p.id = c.perfil_acesso_id WHERE c.id = ?`,
      [cg.id],
    );
    expect(lg).toMatchObject({ escopo: 'perfil', perfil: PERFIL2, setor_funcional_id: null });
    const lidaG = await fonte.campanhaRecert('teste', EST, cg.id);
    expect(lidaG?.campanha).toMatchObject({ escopo: 'grupo', alvo: PERFIL2 });
    expect(lidaG?.itens.map((i) => [i.login, i.grupo, i.perfis])).toEqual([
      [CONTAS[0], PERFIL, [PERFIL, PERFIL2]],
    ]);
    await fechar(cg.id);

    // Por setor: quem está no setor (vínculo ou lotação vigente).
    const doSetor = itensDaCampanhaRecert(minhas, 'setor', 'L57R-UTI');
    expect(doSetor.map((i) => i.login)).toEqual([CONTAS[1]]);
    const cs = await abrir(
      doSetor.map((i) => i.login),
      { escopo: 'setor', alvo: 'L57R-UTI' },
    );
    const [ls] = await ler(
      'SELECT escopo, setor_funcional_id, perfil_acesso_id FROM recertificacao_acesso WHERE id = ?',
      [cs.id],
    );
    expect(ls).toMatchObject({ escopo: 'setor', perfil_acesso_id: null });
    expect(Number(ls?.['setor_funcional_id'])).toBe(setor['UTI']);
    const lidaS = await fonte.campanhaRecert('teste', EST, cs.id);
    expect(lidaS?.campanha).toMatchObject({ escopo: 'setor', alvo: 'L57R-UTI' });
    expect(lidaS?.itens.map((i) => i.login)).toEqual([CONTAS[1]]);
    await fechar(cs.id);
  });
});
