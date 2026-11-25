// Contrato de efeito do C2-048 (04-INT linha 70) contra o MariaDB real (cliente de teste), num estabelecimento
// SINTÉTICO. Paciente, usuário, profissionais, itens faturáveis, insumos, funções da equipe, convênio e caráter de
// admissão são ids já existentes do cliente (só lidos); as pré-internações são massa sintética apagada no fim. Prova o
// que fica no banco:
//   - o plano: procedimentos (o primeiro vira o principal e entra na guia), material com a unidade de estoque do insumo e
//     equipe por função, com a pré-internação em versão nova; versão velha recusada (409) sem gravar;
//   - regravar: o que sai do plano fica marcado como excluído (com quem e quando), nunca apagado; o que volta reaproveita
//     a mesma linha (sem duplicar); o novo entra no fim da sequência;
//   - item inexistente e dois principais recusados (422) sem gravar; pré-internação com falta (histórico) recusada;
//   - a fila de espera: só as sem data, ordenadas pela prioridade e pela data do pedido, com a contagem do plano; a
//     mudança de prioridade sem justificativa e fora da fila é recusada, e com justificativa grava a prioridade e
//     acrescenta a linha datada à observação, reordenando a fila;
//   - o principal é um só com a pré-internação: o plano lido parte do procedimento previsto, e o principal gravado passa
//     a ser o previsto (a fila mostra o mesmo); pelo SUS, marcar um item do plano como principal é recusado e o
//     procedimento da tabela do SUS fica; o fornecedor previsto do material é gravado (e o inativo recusado), achado
//     pela busca de fornecedores. Fornecedores sintéticos (CNPJ fictício) apagados no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaPreInternacaoPlanoPropria } from './pre-internacao-plano-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c2048pi';

interface Massa {
  est: number;
  usuario: number;
  paciente: number;
  profs: number[];
  itens: number[];
  insumos: number[];
  funcoes: number[];
  /** Pré-internação com data (solicitada), duas na fila (normal antiga, normal recente) e uma com falta. */
  agendada: number;
  filaAntiga: number;
  filaRecente: number;
  faltou: number;
}

async function limpar(e: Escritor): Promise<void> {
  const pre =
    'SELECT id FROM agendamento_internacao WHERE estabelecimento_id IN (SELECT id FROM estabelecimento WHERE codigo = ?)';
  for (const t of [
    'agendamento_internacao_procedimento',
    'agendamento_internacao_material',
    'agendamento_internacao_profissional',
  ])
    await e.executar(`DELETE FROM ${t} WHERE agendamento_internacao_id IN (${pre})`, [P]);
  await e.executar(
    'DELETE FROM agendamento_internacao WHERE estabelecimento_id IN (SELECT id FROM estabelecimento WHERE codigo = ?)',
    [P],
  );
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
  await e.executar("DELETE FROM empresa_fornecedora WHERE cnpj IN ('00002048000101','00002048000102')");
}

describe.skipIf(SEM_BANCO)('PortaPreInternacaoPlanoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaPreInternacaoPlanoPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const uma = async (sql: string, p: unknown[] = []) => (await ler(sql, p))[0]!;
  const falha = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return `${String(e)} ${JSON.stringify(e)}`;
    }
    throw new Error('era para recusar');
  };
  const ids = (rs: Record<string, unknown>[]) => rs.map((r) => Number(r['id']));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const pac = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      const profs = ids(
        await e.consultar(
          "SELECT id FROM profissional WHERE situacao = 'ativo' AND excluido_em IS NULL ORDER BY id LIMIT 2",
        ),
      );
      const itens = ids(
        await e.consultar(
          "SELECT id FROM item_faturavel WHERE situacao = 'ativo' AND excluido_em IS NULL ORDER BY id LIMIT 3",
        ),
      );
      const insumos = ids(
        await e.consultar(
          "SELECT id FROM insumo WHERE situacao = 'ativo' AND excluido_em IS NULL ORDER BY id LIMIT 2",
        ),
      );
      const funcoes = ids(
        await e.consultar('SELECT id FROM funcao_equipe_cirurgica WHERE ativo ORDER BY ordem, id LIMIT 2'),
      );
      const fonte = await e.uma('SELECT MIN(id) AS id FROM fonte_pagadora');
      const carater = await e.uma('SELECT MIN(id) AS id FROM carater_admissao');
      if (
        !usuario?.['id'] ||
        !pac?.['id'] ||
        profs.length < 2 ||
        itens.length < 3 ||
        insumos.length < 2 ||
        funcoes.length < 2 ||
        !fonte?.['id'] ||
        !carater?.['id']
      )
        throw new Error(
          'O cliente de teste precisa de usuário, paciente, 2 profissionais, 3 itens, 2 insumos, 2 funções, convênio e caráter.',
        );
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const agendar = (numero: string, situacao: string, diasAtras: number, prevista: Date | null) =>
        e.inserir(
          `INSERT INTO agendamento_internacao (estabelecimento_id, numero, paciente_id, solicitado_em, previsto_para,
             carater_admissao_id, medico_profissional_id, fonte_pagadora_id, situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            est,
            numero,
            Number(pac['id']),
            new Date(agora.getTime() - diasAtras * 86_400_000),
            prevista,
            Number(carater['id']),
            profs[0],
            Number(fonte['id']),
            situacao,
            agora,
          ],
        );
      const amanha = new Date(agora.getTime() + 86_400_000);
      return {
        est,
        usuario: Number(usuario['id']),
        paciente: Number(pac['id']),
        profs,
        itens,
        insumos,
        funcoes,
        agendada: await agendar(`${P}-1`, 'solicitado', 1, amanha),
        filaAntiga: await agendar(`${P}-2`, 'em_espera', 30, null),
        filaRecente: await agendar(`${P}-3`, 'em_espera', 2, null),
        faltou: await agendar(`${P}-4`, 'nao_compareceu', 40, amanha),
      };
    });
    porta = new PortaPreInternacaoPlanoPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  const linhas = (tabela: string, pre: number) =>
    ler(`SELECT * FROM ${tabela} WHERE agendamento_internacao_id = ? ORDER BY sequencia`, [pre]);

  it('grava o plano: principal definido, unidade do insumo, equipe por função, versão nova; versão velha 409', async () => {
    const r = await porta.gravarPlano(ctx(), m.agendada, {
      versao: 1,
      procedimentos: [
        { item: m.itens[0], quantidade: 1, incluirNaGuia: false },
        { item: m.itens[1], quantidade: 2, viaAcesso: 'mesma_via' },
      ],
      materiais: [{ insumo: m.insumos[0], quantidade: 3, observacao: '  consignado  ' }],
      equipe: [
        { profissional: m.profs[0], funcao: m.funcoes[0] },
        { profissional: m.profs[1], funcao: m.funcoes[1] },
      ],
    });
    expect(r.versao).toBe(2);
    const procs = await linhas('agendamento_internacao_procedimento', m.agendada);
    expect(procs.map((x) => [x['item_faturavel_id'], x['sequencia'], Boolean(x['principal'])])).toEqual([
      [m.itens[0], 1, true],
      [m.itens[1], 2, false],
    ]);
    expect(Boolean(procs[0]!['incluir_na_guia'])).toBe(true);
    expect(procs[1]).toMatchObject({ via_acesso: 'mesma_via', origem: 'sistema', criado_por: m.usuario });
    expect(Number(procs[1]!['quantidade'])).toBe(2);
    const mat = await linhas('agendamento_internacao_material', m.agendada);
    const unidade = await uma('SELECT estoque_unidade_medida_id AS u FROM insumo WHERE id = ?', [
      m.insumos[0],
    ]);
    expect(mat).toHaveLength(1);
    expect(mat[0]).toMatchObject({
      insumo_id: m.insumos[0],
      observacao: 'consignado',
      unidade_medida_id: unidade['u'],
    });
    const eqp = await linhas('agendamento_internacao_profissional', m.agendada);
    expect(eqp.map((x) => [x['profissional_id'], x['funcao_equipe_cirurgica_id']])).toEqual([
      [m.profs[0], m.funcoes[0]],
      [m.profs[1], m.funcoes[1]],
    ]);
    const pre = await uma('SELECT versao, alterado_por FROM agendamento_internacao WHERE id = ?', [
      m.agendada,
    ]);
    expect(pre).toMatchObject({ versao: 2, alterado_por: m.usuario });
    expect(
      await falha(
        porta.gravarPlano(ctx(), m.agendada, { versao: 1, procedimentos: [], materiais: [], equipe: [] }),
      ),
    ).toMatch(/conflito-versao/);
    expect(await linhas('agendamento_internacao_procedimento', m.agendada)).toHaveLength(2);
    const lido = await porta.plano(ctx(), m.agendada);
    expect(lido).toMatchObject({ editavel: true, versao: 2, situacao: 'solicitado' });
    expect(lido.procedimentos[0]!.principal).toBe(true);
    expect((await porta.planoDoPaciente(ctx(), m.paciente))?.preInternacao).toBeGreaterThan(0);
  });

  it('regravar: o que sai fica excluído (nunca apagado), o que volta reaproveita a linha, o novo vai ao fim', async () => {
    await porta.gravarPlano(ctx(), m.agendada, {
      versao: 2,
      procedimentos: [{ item: m.itens[1], principal: true }, { item: m.itens[2] }],
      materiais: [],
      equipe: [{ profissional: m.profs[1], funcao: m.funcoes[1] }],
    });
    const procs = await linhas('agendamento_internacao_procedimento', m.agendada);
    expect(procs).toHaveLength(3);
    expect(procs.map((x) => [x['item_faturavel_id'], x['sequencia'], x['excluido_em'] === null])).toEqual([
      [m.itens[0], 1, false],
      [m.itens[1], 2, true],
      [m.itens[2], 3, true],
    ]);
    expect(procs[0]!['excluido_por']).toBe(m.usuario);
    expect(Boolean(procs[1]!['principal'])).toBe(true);
    const mat = await linhas('agendamento_internacao_material', m.agendada);
    expect(mat).toHaveLength(1);
    expect(mat[0]!['excluido_em']).not.toBeNull();
    // Volta o profissional e o material que saíram: as mesmas linhas, sem duplicar (chave única da equipe).
    await porta.gravarPlano(ctx(), m.agendada, {
      versao: 3,
      procedimentos: [{ item: m.itens[1], principal: true }],
      materiais: [{ insumo: m.insumos[0], quantidade: 1 }],
      equipe: [
        { profissional: m.profs[1], funcao: m.funcoes[1] },
        { profissional: m.profs[0], funcao: m.funcoes[0] },
      ],
    });
    const eqp = await linhas('agendamento_internacao_profissional', m.agendada);
    expect(eqp).toHaveLength(2);
    expect(eqp.every((x) => x['excluido_em'] === null)).toBe(true);
    const mat2 = await linhas('agendamento_internacao_material', m.agendada);
    expect(mat2.map((x) => [x['id'], x['excluido_em']])).toEqual([[mat[0]!['id'], null]]);
    const lido = await porta.plano(ctx(), m.agendada);
    expect(lido.procedimentos.map((x) => x.item)).toEqual([m.itens[1]]);
    expect(lido.equipe).toHaveLength(2);
    expect(lido.versao).toBe(4);
  });

  it('recusa item inexistente, dois principais e plano de pré-internação com falta, sem gravar', async () => {
    const vazio = { materiais: [], equipe: [] };
    expect(
      await falha(
        porta.gravarPlano(ctx(), m.agendada, { versao: 4, procedimentos: [{ item: 999_999_999 }], ...vazio }),
      ),
    ).toMatch(/procedimentos\.0\.item/);
    expect(
      await falha(
        porta.gravarPlano(ctx(), m.agendada, {
          versao: 4,
          procedimentos: [
            { item: m.itens[0], principal: true },
            { item: m.itens[1], principal: true },
          ],
          ...vazio,
        }),
      ),
    ).toMatch(/regra-violada/);
    expect(
      await falha(
        porta.gravarPlano(ctx(), m.faltou, { versao: 1, procedimentos: [{ item: m.itens[0] }], ...vazio }),
      ),
    ).toMatch(/situacao/);
    expect(await linhas('agendamento_internacao_procedimento', m.faltou)).toHaveLength(0);
    expect(
      (await uma('SELECT versao FROM agendamento_internacao WHERE id = ?', [m.agendada]))['versao'],
    ).toBe(4);
    expect((await porta.plano(ctx(), m.faltou)).editavel).toBe(false);
  });

  it('fila de espera: prioridade e data do pedido; a mudança de prioridade exige justificativa e reordena', async () => {
    await porta.gravarPlano(ctx(), m.filaRecente, {
      versao: 1,
      procedimentos: [{ item: m.itens[2] }],
      materiais: [],
      equipe: [],
    });
    const antes = await porta.fila(ctx());
    expect(antes.itens.map((x) => [x.preInternacao, x.posicao])).toEqual([
      [m.filaAntiga, 1],
      [m.filaRecente, 2],
    ]);
    expect(antes.contagens).toMatchObject({ total: 2, normal: 2, urgente: 0 });
    expect(antes.itens[0]!.diasEspera).toBe(30);
    expect(antes.itens[1]).toMatchObject({ procedimentos: 1, materiais: 0, equipe: 0 });
    expect(antes.itens[1]!.procedimentoPrincipal).not.toBeNull();

    expect(
      await falha(
        porta.priorizar(ctx(), m.filaRecente, { versao: 2, prioridade: 'urgente', justificativa: 'x' }),
      ),
    ).toMatch(/justificativa/);
    expect(
      await falha(
        porta.priorizar(ctx(), m.agendada, {
          versao: 4,
          prioridade: 'urgente',
          justificativa: 'piora clínica relatada pelo médico',
        }),
      ),
    ).toMatch(/situacao/);
    const r = await porta.priorizar(ctx(), m.filaRecente, {
      versao: 2,
      prioridade: 'urgente',
      justificativa: 'piora clínica relatada pelo médico',
    });
    expect(r.versao).toBe(3);
    const a = await uma('SELECT prioridade, observacao, versao FROM agendamento_internacao WHERE id = ?', [
      m.filaRecente,
    ]);
    expect(a['prioridade']).toBe('urgente');
    expect(String(a['observacao'])).toMatch(
      /Prioridade normal → urgente: piora clínica relatada pelo médico$/,
    );
    const depois = await porta.fila(ctx());
    expect(depois.itens.map((x) => [x.preInternacao, x.posicao, x.prioridade])).toEqual([
      [m.filaRecente, 1, 'urgente'],
      [m.filaAntiga, 2, 'normal'],
    ]);
    const trilha = await uma(
      'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = ? AND entidade_id = ?',
      [m.est, 'agendamento_internacao', m.filaRecente],
    );
    expect(Number(trilha['n'])).toBeGreaterThanOrEqual(2);
  });

  it('principal único com a pré-internação (previsto e SUS) e fornecedor previsto do material', async () => {
    const extra = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo2-${P}` }, async (e) => {
      const agora = new Date();
      const base = await e.uma(
        'SELECT paciente_id, carater_admissao_id, medico_profissional_id, fonte_pagadora_id FROM agendamento_internacao WHERE id = ?',
        [m.agendada],
      );
      const sigtap = await e.uma('SELECT MIN(id) AS id FROM procedimento_sigtap');
      if (!sigtap?.['id']) throw new Error('O cliente de teste precisa de um procedimento da tabela do SUS.');
      const inserir = (numero: string, item: number | null, sus: number | null) =>
        e.inserir(
          `INSERT INTO agendamento_internacao (estabelecimento_id, numero, paciente_id, solicitado_em, previsto_para,
             carater_admissao_id, medico_profissional_id, fonte_pagadora_id, item_faturavel_id, procedimento_sigtap_id,
             situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmado', ?)`,
          [
            m.est,
            numero,
            base!['paciente_id'],
            agora,
            new Date(agora.getTime() + 2 * 86_400_000),
            base!['carater_admissao_id'],
            base!['medico_profissional_id'],
            base!['fonte_pagadora_id'],
            item,
            sus,
            agora,
          ],
        );
      const fornecedor = (cnpj: string, situacao: string) =>
        e.inserir(
          `INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, nome_fantasia, fornece_opme, situacao, criado_em)
           VALUES ('juridica', ?, ?, ?, TRUE, ?, ?)`,
          [cnpj, `Fornecedora sintética ${P} ${situacao}`, `OPME ${P}`, situacao, agora],
        );
      return {
        previsto: await inserir(`${P}-5`, m.itens[2]!, null),
        sus: await inserir(`${P}-6`, null, Number(sigtap['id'])),
        sigtap: Number(sigtap['id']),
        ativo: await fornecedor('00002048000101', 'ativo'),
        inativo: await fornecedor('00002048000102', 'inativo'),
      };
    });

    // O plano lido parte do procedimento previsto da pré-internação, como principal.
    const lido = await porta.plano(ctx(), extra.previsto);
    expect(lido.procedimentos.map((p) => [p.item, p.principal])).toEqual([[m.itens[2], true]]);
    expect(lido.procedimentoSus).toBeNull();
    // Sem marcação, o previsto continua principal; marcado outro, ele passa a ser o previsto (uma fonte só).
    await porta.gravarPlano(ctx(), extra.previsto, {
      versao: 1,
      procedimentos: [{ item: m.itens[0] }, { item: m.itens[2] }],
      materiais: [],
      equipe: [],
    });
    let procs = await linhas('agendamento_internacao_procedimento', extra.previsto);
    expect(procs.map((x) => [x['item_faturavel_id'], Boolean(x['principal'])])).toEqual([
      [m.itens[0], false],
      [m.itens[2], true],
    ]);
    expect(
      (await uma('SELECT item_faturavel_id FROM agendamento_internacao WHERE id = ?', [extra.previsto]))[
        'item_faturavel_id'
      ],
    ).toBe(m.itens[2]);

    // O fornecedor: a busca acha o ativo (não o inativo); o ativo é gravado, o inativo recusado.
    const achados = await porta.buscarFornecedores(ctx(), `OPME ${P}`);
    expect(achados.map((f) => f.id)).toEqual([extra.ativo]);
    expect(achados[0]).toMatchObject({ opme: true, fantasia: `OPME ${P}` });
    expect(
      await falha(
        porta.gravarPlano(ctx(), extra.previsto, {
          versao: 2,
          procedimentos: [{ item: m.itens[2] }],
          materiais: [{ insumo: m.insumos[1], quantidade: 2, fornecedor: extra.inativo }],
          equipe: [],
        }),
      ),
    ).toMatch(/materiais\.0\.fornecedor/);
    await porta.gravarPlano(ctx(), extra.previsto, {
      versao: 2,
      procedimentos: [{ item: m.itens[0], principal: true }, { item: m.itens[2] }],
      materiais: [{ insumo: m.insumos[1], quantidade: 2, fornecedor: extra.ativo }],
      equipe: [],
    });
    const a = await uma(
      'SELECT item_faturavel_id, procedimento_sigtap_id, versao FROM agendamento_internacao WHERE id = ?',
      [extra.previsto],
    );
    expect(a).toMatchObject({ item_faturavel_id: m.itens[0], procedimento_sigtap_id: null, versao: 3 });
    const mat = await linhas('agendamento_internacao_material', extra.previsto);
    expect(mat.map((x) => [x['insumo_id'], x['empresa_fornecedora_id']])).toEqual([
      [m.insumos[1], extra.ativo],
    ]);
    const relido = await porta.plano(ctx(), extra.previsto);
    expect(relido.procedimentos.filter((p) => p.principal).map((p) => p.item)).toEqual([m.itens[0]]);
    expect(relido.materiais[0]).toMatchObject({
      fornecedor: extra.ativo,
      fornecedorNome: `Fornecedora sintética ${P} ativo`,
    });
    procs = await linhas('agendamento_internacao_procedimento', extra.previsto);
    expect(procs.filter((x) => Boolean(x['principal'])).map((x) => x['item_faturavel_id'])).toEqual([
      m.itens[0],
    ]);

    // Pelo SUS: o principal é o da tabela do SUS; marcar um item do plano como principal é recusado.
    const lidoSus = await porta.plano(ctx(), extra.sus);
    expect(lidoSus.procedimentoSus).not.toBeNull();
    expect(
      await falha(
        porta.gravarPlano(ctx(), extra.sus, {
          versao: 1,
          procedimentos: [{ item: m.itens[0], principal: true }],
          materiais: [],
          equipe: [],
        }),
      ),
    ).toMatch(/SUS/);
    expect(await linhas('agendamento_internacao_procedimento', extra.sus)).toHaveLength(0);
    await porta.gravarPlano(ctx(), extra.sus, {
      versao: 1,
      procedimentos: [{ item: m.itens[0] }],
      materiais: [],
      equipe: [],
    });
    const s = await uma(
      'SELECT item_faturavel_id, procedimento_sigtap_id FROM agendamento_internacao WHERE id = ?',
      [extra.sus],
    );
    expect(s).toMatchObject({ item_faturavel_id: null, procedimento_sigtap_id: extra.sigtap });
    const procSus = await linhas('agendamento_internacao_procedimento', extra.sus);
    expect(procSus.map((x) => Boolean(x['principal']))).toEqual([false]);
    expect((await porta.plano(ctx(), extra.sus)).procedimentos.every((p) => !p.principal)).toBe(true);
  });
});
