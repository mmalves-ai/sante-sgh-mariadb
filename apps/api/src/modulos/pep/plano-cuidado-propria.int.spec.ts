// Contrato de efeito do plano de cuidado e da estratificação de risco (03-PEP L142), contra o MariaDB real (cliente de
// teste f22_o3 por padrão). Massa SINTÉTICA própria (estabelecimento c3019, logins teste.c3019.*), limpa antes e
// depois (a trilha pelo utilitário comum). Prova o que fica no banco: o plano em rascunho com responsável, risco e
// metas; os itens em ordem com a hierarquia; a reestratificação com aviso quando sobe para alto; a ativação só com
// risco e objetivo; os passos dos itens com a justificativa do desvio; o fechamento só sem item em aberto; o
// cancelamento com motivo; a não criação com justificativa; e as recusas sem gravar nada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PlanoCuidadoPropria } from './plano-cuidado-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'c3019';
const MEDICO = 'teste.c3019.a';
const SEM_PROF = 'teste.c3019.c';
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

describe.skipIf(SEM_BANCO)('plano de cuidado e estratificação de risco (banco próprio, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let planos: PlanoCuidadoPropria;
  const ids = { est: 0, medico: 0, semProf: 0, prof: 0, paciente: 0 };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    if (!ids.paciente) return;
    await e.executar(
      `UPDATE plano_cuidado_acao a JOIN plano_cuidado p ON p.id = a.plano_cuidado_id
          SET a.superior_plano_cuidado_acao_id = NULL WHERE p.paciente_id = ?`,
      [ids.paciente],
    );
    await e.executar(
      'DELETE a FROM plano_cuidado_acao a JOIN plano_cuidado p ON p.id = a.plano_cuidado_id WHERE p.paciente_id = ?',
      [ids.paciente],
    );
    await e.executar('DELETE FROM plano_cuidado WHERE paciente_id = ?', [ids.paciente]);
    await limparTrilhaDaMassa(e, { codigos: [EST] });
  };
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c3019' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const ctx = (login = MEDICO) => ({
    hospital: EST,
    login,
    correlacao: 'teste-c3019',
    chaveIdempotencia: `c3019-${randomUUID()}`,
  });
  const gravar = (e: Record<string, unknown>, login = MEDICO) => planos.gravarPlano(ctx(login), e);
  const plano = async (id: number) =>
    (await ler('SELECT * FROM plano_cuidado WHERE id = ?', [id]))[0] as Record<string, unknown>;
  const item = async (id: number) =>
    (await ler('SELECT * FROM plano_cuidado_acao WHERE id = ?', [id]))[0] as Record<string, unknown>;
  const contar = async () =>
    Number(
      (
        await ler<{ n: number }>(
          `SELECT (SELECT COUNT(*) FROM plano_cuidado WHERE paciente_id = ?) +
                  (SELECT COUNT(*) FROM plano_cuidado_acao a JOIN plano_cuidado p ON p.id = a.plano_cuidado_id
                    WHERE p.paciente_id = ?) AS n`,
          [ids.paciente, ids.paciente],
        )
      )[0]!.n,
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    planos = new PlanoCuidadoPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c3019' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, `Hospital sintético ${EST}`, `Hospital sintético ${EST} (fictício)`, agora],
      );
      const usuario = (login: string, cpf: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)',
          [login, `Conta sintética ${login}`, cpf, agora],
        );
      ids.medico = await usuario(MEDICO, '30190190001');
      ids.semProf = await usuario(SEM_PROF, '30190190003');
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pf = await pessoa('PESSOA SINTETICA C3019 MEDICA');
      ids.prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'assistencial', 'massa c3019', ?)",
        [pf, agora],
      );
      await garantir(
        e,
        'SELECT id FROM usuario_profissional WHERE usuario_id = ? AND profissional_id = ?',
        [ids.medico, ids.prof],
        'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [ids.medico, ids.prof, '2026-01-01', agora],
      );
      const pac = await pessoa('PESSOA SINTETICA C3019 PACIENTE');
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pac],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pac, 301_901_901, agora],
      );
      await limpar(e);
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c3019' }, (e) => limpar(e));
    await nucleo.encerrar?.();
  });

  it('cria o rascunho, inclui os itens em hierarquia, reestratifica com aviso, ativa, anda os itens e fecha', async () => {
    const r = await gravar({
      acao: 'criar',
      paciente: ids.paciente,
      risco: 'moderado',
      inicio: '2026-11-26',
      fimPrevisto: '2027-05-26',
      metas: '  Controle glicêmico e pressórico  ',
    });
    expect(r.resultado).toMatchObject({ situacao: 'rascunho', risco: 'moderado' });
    const id = r.resultado.plano;
    const p0 = await plano(id);
    expect(p0).toMatchObject({
      estabelecimento_id: ids.est,
      paciente_id: ids.paciente,
      responsavel_profissional_id: ids.prof,
      risco: 'moderado',
      situacao: 'rascunho',
      metas: 'Controle glicêmico e pressórico',
      programa_cuidado_paciente_id: null,
      origem: 'sistema',
      versao: 1,
    });
    expect(Number(p0['criado_por'])).toBe(ids.medico);

    // Ativar sem objetivo é recusado, sem escrita.
    const antes = await contar();
    await expect(gravar({ acao: 'ativar', plano: id, versao: 1 })).rejects.toMatchObject(
      recusada('plano-sem-objetivo'),
    );
    expect(await contar()).toBe(antes);

    const prob = (
      await gravar({
        acao: 'incluir_item',
        plano: id,
        tipo: 'problema',
        descricao: 'Diabetes tipo 2 descompensado',
      })
    ).resultado.item!;
    const obj = (
      await gravar({
        acao: 'incluir_item',
        plano: id,
        tipo: 'objetivo',
        descricao: 'HbA1c abaixo de 7%',
        superior: prob,
        prazo: '2027-02-26',
      })
    ).resultado.item!;
    const interv = (
      await gravar({
        acao: 'incluir_item',
        plano: id,
        tipo: 'intervencao',
        descricao: 'Consulta com nutricionista',
        superior: obj,
      })
    ).resultado.item!;
    const educ = (
      await gravar({
        acao: 'incluir_item',
        plano: id,
        tipo: 'educacao',
        descricao: 'Orientar autoaplicação de insulina',
        superior: obj,
      })
    ).resultado.item!;
    expect(await item(obj)).toMatchObject({
      plano_cuidado_id: id,
      sequencia: 2,
      superior_plano_cuidado_acao_id: prob,
      tipo: 'objetivo',
      situacao: 'pendente',
      responsavel_profissional_id: ids.prof,
    });
    expect((await item(educ))['sequencia']).toBe(4);
    const antes2 = await contar();
    await expect(
      gravar({ acao: 'incluir_item', plano: id, tipo: 'problema', descricao: 'Hipertensão', superior: obj }),
    ).rejects.toMatchObject(recusada('hierarquia-invalida'));
    await expect(
      gravar({
        acao: 'incluir_item',
        plano: id,
        tipo: 'objetivo',
        descricao: 'Prazo antigo',
        prazo: '2026-01-01',
      }),
    ).rejects.toMatchObject(recusada('prazo-antes-do-inicio'));
    expect(await contar()).toBe(antes2);

    const e1 = await gravar({ acao: 'estratificar', plano: id, versao: 1, risco: 'alto' });
    expect(e1.resultado).toMatchObject({ risco: 'alto', avisar: true, situacao: 'rascunho' });
    expect(await plano(id)).toMatchObject({ risco: 'alto', versao: 2 });
    await expect(
      gravar({ acao: 'estratificar', plano: id, versao: 1, risco: 'baixo' }),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ codigo: 'conflito-versao' }) });

    // Item não anda com o plano em rascunho.
    await expect(
      gravar({ acao: 'passo_item', item: interv, versao: 1, passo: 'iniciar' }),
    ).rejects.toMatchObject(recusada('plano-nao-ativo'));

    expect((await gravar({ acao: 'ativar', plano: id, versao: 2 })).resultado.situacao).toBe('ativo');
    const p1 = await plano(id);
    expect(p1).toMatchObject({ situacao: 'ativo', versao: 3 });
    expect(p1['ativado_em']).not.toBeNull();

    await gravar({ acao: 'passo_item', item: interv, versao: 1, passo: 'iniciar' });
    await gravar({ acao: 'passo_item', item: interv, versao: 2, passo: 'concluir' });
    const i1 = await item(interv);
    expect(i1).toMatchObject({ situacao: 'concluida', versao: 3 });
    expect(i1['concluida_em']).not.toBeNull();
    await expect(
      gravar({ acao: 'passo_item', item: educ, versao: 1, passo: 'cancelar' }),
    ).rejects.toMatchObject(recusada('justificativa-obrigatoria'));
    expect(await item(educ)).toMatchObject({ situacao: 'pendente', versao: 1 });
    await gravar({
      acao: 'passo_item',
      item: educ,
      versao: 1,
      passo: 'nao_realizar',
      justificativa: 'Paciente recusou a orientação',
    });
    expect(await item(educ)).toMatchObject({
      situacao: 'nao_realizada',
      justificativa_desvio: 'Paciente recusou a orientação',
    });

    await expect(gravar({ acao: 'fechar', plano: id, versao: 3 })).rejects.toMatchObject(
      recusada('itens-em-aberto'),
    );
    expect((await plano(id))['situacao']).toBe('ativo');
    await gravar({ acao: 'passo_item', item: prob, versao: 1, passo: 'concluir' });
    await gravar({ acao: 'passo_item', item: obj, versao: 1, passo: 'concluir' });
    expect((await gravar({ acao: 'fechar', plano: id, versao: 3 })).resultado.situacao).toBe('fechado');
    const p2 = await plano(id);
    expect(p2).toMatchObject({ situacao: 'fechado', fechamento_usuario_id: ids.medico });
    expect(p2['fechado_em']).not.toBeNull();
    await expect(
      gravar({ acao: 'incluir_item', plano: id, tipo: 'problema', descricao: 'Depois do fechamento' }),
    ).rejects.toMatchObject(recusada('plano-encerrado'));

    const tela = await planos.doPaciente(ctx(), ids.paciente);
    const lido = tela.planos.find((x) => x.id === id)!;
    expect(lido).toMatchObject({
      situacao: 'fechado',
      risco: 'alto',
      inicio: '2026-11-26',
      fimPrevisto: '2027-05-26',
    });
    expect(lido.itens.map((x) => x.sequencia)).toEqual([1, 2, 3, 4]);
    expect(lido.itens[1]).toMatchObject({ superior: prob, prazo: '2027-02-26' });
    expect(tela.podeEscrever).toBe(true);
  });

  it('cancela o plano com motivo, registra a não criação com justificativa e recusa sem gravar', async () => {
    const id = (await gravar({ acao: 'criar', paciente: ids.paciente, inicio: '2026-11-26' })).resultado
      .plano;
    await expect(gravar({ acao: 'cancelar', plano: id, versao: 1, motivo: ' ' })).rejects.toMatchObject(
      recusada('motivo-obrigatorio'),
    );
    await gravar({ acao: 'cancelar', plano: id, versao: 1, motivo: 'Transferido para outro serviço' });
    const p = await plano(id);
    expect(p).toMatchObject({ situacao: 'cancelado' });
    expect(String(p['observacao'])).toContain('Transferido para outro serviço');

    const antes = await contar();
    await expect(
      gravar({ acao: 'nao_criar', paciente: ids.paciente, justificativa: 'curta' }),
    ).rejects.toMatchObject(recusada('justificativa-curta'));
    await expect(
      gravar({ acao: 'criar', paciente: ids.paciente, inicio: '2026-11-26' }, SEM_PROF),
    ).rejects.toMatchObject(recusada('sem-profissional'));
    await expect(
      gravar({ acao: 'criar', paciente: ids.paciente, inicio: '2026-11-26', fimPrevisto: '2026-11-01' }),
    ).rejects.toMatchObject(recusada('fim-antes-do-inicio'));
    expect(await contar()).toBe(antes);

    const n = (
      await gravar({
        acao: 'nao_criar',
        paciente: ids.paciente,
        justificativa: 'Paciente em cuidado paliativo exclusivo',
      })
    ).resultado;
    expect(n.situacao).toBe('nao_criado');
    expect(await plano(n.plano)).toMatchObject({
      situacao: 'nao_criado',
      justificativa_nao_criacao: 'Paciente em cuidado paliativo exclusivo',
      responsavel_profissional_id: ids.prof,
    });
    expect((await planos.doPaciente(ctx(SEM_PROF), ids.paciente)).podeEscrever).toBe(false);
  });
});
