// Interface com a folha e cálculo da folha (M53.1 e M53.3) sobre o MariaDB real, cliente de teste da onda (f22_o3):
// as portas próprias leem os catálogos, as competências, os vínculos e os afastamentos do estabelecimento da sessão e
// gravam o afastamento pelo Executor (linha, versão e trilha na mesma transação). Recusas: conflito de versão, vínculo de
// outro estabelecimento, período invertido, sobreposição (na inclusão e na prorrogação), encerrar e cancelar de outro
// estabelecimento e as operações que aguardam o modelo (`modelo-pendente`). O cálculo lê com dados: tipo do vínculo pela
// categoria (estagiário 901), desligados com rescisão, FGTS das folhas fechadas (e a recusa com mês sem folha),
// dependentes com vigência, vigências do salário e adiantamentos do 13º.
// Massa sintética (CPF fictício com dígitos válidos, códigos com o prefixo f2206); nenhuma pessoa real.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18 } from '../../exames/public-api.js';
import { PortaCalculoFolhaPropria } from '../folha/porta-calculo-propria.js';
import { PortaFolhaPropria } from '../folha/porta-folha-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
/** CPF sintético com dígitos válidos (não é de pessoa real). */
const CPF = '52998224725';
const CPF2 = '11144477735';
const CPF3 = '39053344705';
const CPF_DEP = '86288366757';
const P = 'f2206';
const cifra = { cifrar: (cpf: string) => `cifrado:${cpf.length}` };
const n = (v: unknown) => Number(v ?? 0);

describe.skipIf(SEM_BANCO)('folha sobre o MariaDB (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let folha: PortaFolhaPropria;
  let calculo: PortaCalculoFolhaPropria;
  let c: ContextoPortaM18;
  let cOutro: ContextoPortaM18;
  const ids = {
    estA: 0,
    estB: 0,
    vinculoA: 0,
    vinculoB: 0,
    vinculoC: 0,
    vinculoE: 0,
    motivo: 0,
    tipoFolha: 0,
    tipoRescisao: 0,
    competencia: 0,
    competenciaAgo: 0,
    rescisao: 0,
    colab2: 0,
  };

  async function limparMassa(e: Escritor): Promise<void> {
    const v = [ids.vinculoA, ids.vinculoB, ids.vinculoC, ids.vinculoE];
    await e.executar('DELETE FROM parcela_decimo_terceiro WHERE colaborador_id = ?', [ids.colab2]);
    await e.executar(
      'DELETE r FROM rescisao r JOIN desligamento d ON d.id = r.desligamento_id WHERE d.vinculo_trabalho_id IN (?, ?, ?, ?)',
      v,
    );
    await e.executar('DELETE FROM desligamento WHERE vinculo_trabalho_id IN (?, ?, ?, ?)', v);
    await e.executar('DELETE FROM calculo_folha WHERE vinculo_trabalho_id IN (?, ?, ?, ?)', v);
    await e.executar('DELETE FROM historico_salarial WHERE vinculo_trabalho_id IN (?, ?, ?, ?)', v);
    await e.executar('DELETE FROM dependente WHERE colaborador_id = ?', [ids.colab2]);
    await e.executar('DELETE FROM afastamento WHERE vinculo_trabalho_id IN (?, ?, ?, ?)', v);
  }

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
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    let usuario: number | null = null;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f2206' }, async (e) => {
      const agora = new Date();
      const u = await e.uma<{ id: number }>('SELECT id FROM usuario ORDER BY id LIMIT 1');
      usuario = u ? Number(u.id) : null;
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital de teste ${codigo}`, `Hospital de teste ${codigo} (fictício)`, agora],
        );
      ids.estA = await est(`${P}a`);
      ids.estB = await est(`${P}b`);
      const sexo = await garantir(
        e,
        // A sigla é única: reaproveita o sexo de sigla I do catálogo do cliente quando já existir.
        'SELECT id FROM sexo WHERE codigo = ? OR sigla = ? ORDER BY id LIMIT 1',
        [`${P}_s`, 'I'],
        'INSERT INTO sexo (codigo, descricao, sigla, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}_s`, 'Sexo sintético', 'I', agora],
      );
      const tipoVinculo = await garantir(
        e,
        'SELECT id FROM tipo_vinculo_trabalho WHERE codigo_cnes = ?',
        ['F2206'],
        'INSERT INTO tipo_vinculo_trabalho (codigo_cnes, nivel, codigo_vinculo, descricao, criado_em) VALUES (?, ?, ?, ?, ?)',
        ['F2206', 'vinculo', '99', 'Vínculo sintético', agora],
      );
      const categoria = await garantir(
        e,
        'SELECT id FROM categoria_trabalhador WHERE codigo_esocial = ?',
        ['Z06'],
        'INSERT INTO categoria_trabalhador (codigo_esocial, descricao, grupo, criado_em) VALUES (?, ?, ?, ?)',
        ['Z06', 'Categoria sintética', 'empregado', agora],
      );
      // Estagiário: o código oficial 901 (carregado aqui só se o cliente de teste não tiver o catálogo).
      const estagio = await garantir(
        e,
        'SELECT id FROM categoria_trabalhador WHERE codigo_esocial = ? ORDER BY id LIMIT 1',
        ['901'],
        'INSERT INTO categoria_trabalhador (codigo_esocial, descricao, grupo, criado_em) VALUES (?, ?, ?, ?)',
        ['901', 'Estagiário (sintético)', 'bolsista', agora],
      );
      const tabelaEsocial = await garantir(
        e,
        'SELECT id FROM tabela_esocial WHERE fonte = ? AND codigo_oficial = ? AND versao_fonte = ?',
        ['esocial', 'Z06', P],
        'INSERT INTO tabela_esocial (fonte, codigo_oficial, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?, ?)',
        ['esocial', 'Z06', 'Tabela sintética', P, agora],
      );
      const codigoEsocial = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM codigo_esocial WHERE tabela_esocial_id = ? AND codigo_esocial = ?',
          [tabelaEsocial, codigo],
          'INSERT INTO codigo_esocial (tabela_esocial_id, codigo_esocial, descricao, criado_em) VALUES (?, ?, ?, ?)',
          [tabelaEsocial, codigo, `Código sintético ${codigo}`, agora],
        );
      const motivoDeslig = await codigoEsocial(`${P}m`);
      const tipoDependente = await codigoEsocial(`${P}d`);
      // CBO sintético da massa: o catálogo do cliente de teste pode estar vazio (ou sendo carregado por outro spec).
      const cbo = {
        id: await garantir(
          e,
          'SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ?',
          ['999206'],
          'INSERT INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES (?, ?, ?)',
          ['999206', 'Ocupação sintética', agora],
        ),
      };
      const cargo = await garantir(
        e,
        'SELECT id FROM cargo WHERE codigo = ?',
        [`${P}_cargo`],
        'INSERT INTO cargo (codigo, nome, ocupacao_cbo_id, data_inicio, carga_semanal_horas_padrao, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        [`${P}_cargo`, 'Cargo sintético', n(cbo?.id), '2020-01-01', 40, agora],
      );
      const colab = await garantir(
        e,
        'SELECT id FROM colaborador WHERE cpf = ?',
        [CPF],
        'INSERT INTO colaborador (nome, cpf, data_nascimento, sexo_id, grau_instrucao, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        ['Colaborador sintético', CPF, '1990-01-01', sexo, '07', agora],
      );
      const colabDe = (cpf: string) =>
        garantir(
          e,
          'SELECT id FROM colaborador WHERE cpf = ?',
          [cpf],
          'INSERT INTO colaborador (nome, cpf, data_nascimento, sexo_id, grau_instrucao, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
          ['Colaborador sintético', cpf, '1995-01-01', sexo, '07', agora],
        );
      ids.colab2 = await colabDe(CPF2);
      const colab3 = await colabDe(CPF3);
      ids.tipoRescisao = await garantir(
        e,
        'SELECT id FROM tipo_rescisao WHERE codigo = ?',
        [`${P}_sjc`],
        `INSERT INTO tipo_rescisao (codigo, descricao, iniciativa, codigo_saque_fgts, codigo_causa_afastamento, criado_em)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [`${P}_sjc`, 'Sem justa causa (sintético)', 'empregador', '01', '11', agora],
      );
      const vinculo = (
        estab: number,
        matricula: string,
        pessoa = colab,
        cat = categoria,
        admissao = '2025-01-02',
        deslig: string | null = null,
      ) =>
        garantir(
          e,
          'SELECT id FROM vinculo_trabalho WHERE estabelecimento_id = ? AND matricula = ?',
          [estab, matricula],
          `INSERT INTO vinculo_trabalho (estabelecimento_id, colaborador_id, matricula, tipo_vinculo_trabalho_id,
             categoria_trabalhador_id, cargo_id, data_admissao, salario_base, data_desligamento, tipo_rescisao_id, situacao,
             criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            estab,
            pessoa,
            matricula,
            tipoVinculo,
            cat,
            cargo,
            admissao,
            3000,
            deslig,
            deslig ? ids.tipoRescisao : null,
            deslig ? 'desligado' : 'ativo',
            agora,
          ],
        );
      ids.vinculoA = await vinculo(ids.estA, `${P}-1`);
      ids.vinculoB = await vinculo(ids.estB, `${P}-2`);
      ids.vinculoC = await vinculo(ids.estA, `${P}-3`, ids.colab2, categoria, '2026-08-03', '2026-09-25');
      ids.vinculoE = await vinculo(ids.estA, `${P}-4`, colab3, estagio, '2026-08-10');
      await limparMassa(e);
      ids.motivo = await garantir(
        e,
        'SELECT id FROM motivo_afastamento WHERE codigo = ?',
        [`${P}_doenca`],
        'INSERT INTO motivo_afastamento (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}_doenca`, 'Doença (sintético)', agora],
      );
      ids.tipoFolha = await garantir(
        e,
        'SELECT id FROM tipo_folha WHERE codigo = ?',
        [`${P}_mensal`],
        'INSERT INTO tipo_folha (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}_mensal`, 'Mensal (sintético)', 'mensal', agora],
      );
      await garantir(
        e,
        'SELECT id FROM tipo_hora WHERE codigo = ?',
        [`${P}_he50`],
        'INSERT INTO tipo_hora (codigo, descricao, natureza, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}_he50`, 'Hora extra 50% (sintético)', 'extra', agora],
      );
      ids.competencia = await garantir(
        e,
        'SELECT id FROM competencia_folha WHERE estabelecimento_id = ? AND ano = 2026 AND mes = 9 AND tipo_folha_id = ?',
        [ids.estA, ids.tipoFolha],
        `INSERT INTO competencia_folha (estabelecimento_id, ano, mes, tipo_folha_id, apuracao_inicio, apuracao_fim, aberta_em, criado_em)
         VALUES (?, 2026, 9, ?, ?, ?, ?, ?)`,
        [ids.estA, ids.tipoFolha, '2026-09-01', '2026-09-30', agora, agora],
      );
      ids.competenciaAgo = await garantir(
        e,
        'SELECT id FROM competencia_folha WHERE estabelecimento_id = ? AND ano = 2026 AND mes = 8 AND tipo_folha_id = ?',
        [ids.estA, ids.tipoFolha],
        `INSERT INTO competencia_folha (estabelecimento_id, ano, mes, tipo_folha_id, apuracao_inicio, apuracao_fim, aberta_em,
           situacao, fechada_em, criado_em) VALUES (?, 2026, 8, ?, ?, ?, ?, 'fechada', ?, ?)`,
        [ids.estA, ids.tipoFolha, '2026-08-01', '2026-08-31', agora, agora, agora],
      );
      // Folha de agosto fechada (FGTS 100,00) e a de setembro só calculada (competência aberta: não conta).
      const calc = (comp: number, situacao: string, fgts: number) =>
        e.inserir(
          `INSERT INTO calculo_folha (estabelecimento_id, competencia_folha_id, colaborador_id, vinculo_trabalho_id,
             total_proventos, total_descontos, valor_liquido, valor_fgts, situacao, calculado_em, criado_em)
           VALUES (?, ?, ?, ?, 1250, 0, 1250, ?, ?, ?, ?)`,
          [ids.estA, comp, ids.colab2, ids.vinculoC, fgts, situacao, agora, agora],
        );
      const calcAgo = await calc(ids.competenciaAgo, 'fechado', 100);
      await calc(ids.competencia, 'calculado', 50);
      const deslig = await e.inserir(
        `INSERT INTO desligamento (estabelecimento_id, vinculo_trabalho_id, motivo_codigo_esocial_id, tipo_rescisao_id,
           iniciativa, data_comunicacao, data_desligamento, aviso_previo, situacao, criado_em)
         VALUES (?, ?, ?, ?, 'empregador', ?, ?, 'indenizado', 'confirmado', ?)`,
        [ids.estA, ids.vinculoC, motivoDeslig, ids.tipoRescisao, '2026-09-25', '2026-09-25', agora],
      );
      ids.rescisao = await e.inserir(
        `INSERT INTO rescisao (estabelecimento_id, colaborador_id, desligamento_id, tipo_rescisao_id, data_desligamento,
           pagamento_limite_em, situacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, 'calculada', ?)`,
        [ids.estA, ids.colab2, deslig, ids.tipoRescisao, '2026-09-25', '2026-10-05', agora],
      );
      // Dependentes: um em vigor (IRRF e salário-família) e um encerrado antes da data consultada.
      const dep = (seq: number, cpf: string | null, irrf: boolean, sf: boolean, fim: string | null) =>
        e.inserir(
          `INSERT INTO dependente (colaborador_id, sequencia, nome, cpf, data_nascimento, tipo_dependente_codigo_esocial_id,
             dependente_irrf, dependente_salario_familia, data_inicio_dependencia, data_fim_dependencia, criado_em)
           VALUES (?, ?, 'Dependente sintético', ?, '2020-05-05', ?, ?, ?, '2020-05-05', ?, ?)`,
          [ids.colab2, seq, cpf, tipoDependente, irrf, sf, fim, agora],
        );
      await dep(1, CPF_DEP, true, true, null);
      await dep(2, null, false, false, '2026-06-30');
      // Vigências do salário: admissão, mérito e uma terceira incluída e depois excluída (não vale).
      const sal = (data: string, valor: number, motivo: string, operacao: string, quando: string) =>
        e.inserir(
          `INSERT INTO historico_salarial (vinculo_trabalho_id, data_vigencia, valor_salario, unidade_pagamento, motivo,
             operacao, ocorrido_em, usuario_id, criado_em) VALUES (?, ?, ?, 'mes', ?, ?, ?, ?, ?)`,
          [ids.vinculoC, data, valor, motivo, operacao, quando, usuario, agora],
        );
      await sal('2026-08-03', 3000, 'admissao', 'inclusao', '2026-08-03 10:00:00');
      await sal('2026-09-01', 3500, 'merito', 'inclusao', '2026-08-28 10:00:00');
      await sal('2026-09-15', 3600, 'correcao', 'inclusao', '2026-09-10 10:00:00');
      await sal('2026-09-15', 3600, 'correcao', 'exclusao', '2026-09-11 10:00:00');
      await e.inserir(
        `INSERT INTO parcela_decimo_terceiro (colaborador_id, ano_referencia, parcela, competencia_folha_id, calculo_folha_id,
           avos, base_calculo, valor_bruto, valor_liquido, situacao, criado_em)
         VALUES (?, 2026, 'primeira', ?, ?, 2, 3000, 150, 150, 'calculada', ?)`,
        [ids.colab2, ids.competenciaAgo, calcAgo, agora],
      );
    });
    c = { cliente: CLIENTE, estabelecimento: ids.estA, usuario, correlacao: 'int-f2206' };
    cOutro = { ...c, estabelecimento: ids.estB };
    folha = new PortaFolhaPropria(nucleo, cifra);
    calculo = new PortaCalculoFolhaPropria(nucleo);
  }, 120_000);

  afterAll(async () => {
    // A massa (afastamentos, folhas, rescisão, dependentes, salários, 13º) e as competências saem; os cadastros sintéticos (prefixo f2206) ficam para a próxima rodada.
    await nucleo?.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f2206' }, async (e) => {
      await limparMassa(e);
      await e.executar('DELETE FROM competencia_folha WHERE id IN (?, ?)', [
        ids.competencia,
        ids.competenciaAgo,
      ]);
    });
    await nucleo?.encerrar();
  });

  it('domínios, competências e vínculos do estabelecimento da sessão', async () => {
    expect(await folha.empresas(c)).toEqual([{ codigo: ids.estA, rotulo: `Hospital de teste ${P}a` }]);
    expect((await folha.motivosAfastamento(c)).map((m) => m.codigo)).toContain(ids.motivo);
    expect((await folha.tiposFolha(c)).map((m) => m.codigo)).toContain(ids.tipoFolha);
    expect((await folha.eventosPonto(c)).length).toBeGreaterThan(0);
    const r = await folha.relogio(c);
    expect(r.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.agora).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    const rem = await folha.remessas(c, ids.estA);
    expect(rem.find((x) => x.id === ids.competencia)).toMatchObject({
      competencia: '2026-09',
      tipoFolha: ids.tipoFolha,
      inicioApuracao: '2026-09-01',
      fimApuracao: '2026-09-30',
      fechada: false,
    });
    expect(await folha.remessas(c, ids.estB)).toEqual([]);
    const vs = await folha.vinculosDaFolha(c, '2026-09-01', '2026-09-30');
    expect(vs.map((v) => v.id)).toEqual([ids.vinculoA, ids.vinculoC, ids.vinculoE]);
    expect(vs[0]?.cpfCifrado).toBe('cifrado:11');
    expect(vs[0]).toMatchObject({
      matricula: `${P}-1`,
      tipo: 'clt',
      admissao: '2025-01-02',
      desligamento: null,
    });
    // O tipo vem da categoria do trabalhador: 901 é estagiário (sem FGTS, 13º nem férias CLT), não CLT.
    expect(vs[2]).toMatchObject({ matricula: `${P}-4`, tipo: 'estagiario' });
    expect(await folha.conselhos(c, [])).toEqual(new Map());
  });

  it('afastamento: inclusão, encerramento e cancelamento com versão e trilha', async () => {
    const { hoje } = await folha.relogio(c);
    const id = await folha.gravarSgh(
      c,
      (r: number) => ({
        estabelecimento: ids.estA,
        usuario: c.usuario,
        acao: 'inclusao' as const,
        entidade: 'afastamento',
        entidadeId: r,
        correlacao: 'int-f2206',
      }),
      (g) =>
        g.incluirAfastamento({
          vinculo: ids.vinculoA,
          motivo: ids.motivo,
          inicio: '2026-09-10',
          fim: null,
          observacao: 'sintético',
          por: 'teste',
        }),
    );
    const lido = await folha.afastamento(c, id);
    expect(lido).toMatchObject({
      vinculo: ids.vinculoA,
      motivo: ids.motivo,
      inicio: '2026-09-10',
      fim: null,
      situacao: 'ativo',
      versao: 1,
    });
    const linha = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conf-f2206' }, async (l) => ({
      a: await l.uma('SELECT situacao, estabelecimento_id, criado_por FROM afastamento WHERE id = ?', [id]),
      t: await l.uma(
        "SELECT COUNT(*) q FROM trilha_auditoria WHERE entidade = 'afastamento' AND entidade_id = ?",
        [id],
      ),
    }));
    // Grava só o fato (ativo); o andamento pelo relógio não é gravado.
    expect(hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(linha.a?.['situacao']).toBe('em_andamento');
    expect(n(linha.a?.['estabelecimento_id'])).toBe(ids.estA);
    expect(n(linha.t?.['q'])).toBeGreaterThanOrEqual(1);

    const trilha = {
      estabelecimento: ids.estA,
      usuario: c.usuario,
      acao: 'alteracao' as const,
      entidade: 'afastamento',
      entidadeId: id,
      correlacao: 'int-f2206',
    };
    await expect(
      folha.gravarSgh(c, trilha, (g) =>
        g.encerrarAfastamento({ id, versao: 9, fim: '2026-09-20', por: 'teste' }),
      ),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await expect(
      folha.gravarSgh(c, trilha, (g) =>
        g.encerrarAfastamento({ id, versao: 1, fim: '2026-09-01', por: 'teste' }),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'periodo-invertido' } });
    await folha.gravarSgh(c, trilha, (g) =>
      g.encerrarAfastamento({ id, versao: 1, fim: '2026-09-20', por: 'teste' }),
    );
    expect(await folha.afastamento(c, id)).toMatchObject({ fim: '2026-09-20', versao: 2 });
    await expect(
      folha.gravarSgh(c, trilha, (g) =>
        g.incluirAfastamento({
          vinculo: ids.vinculoA,
          motivo: ids.motivo,
          inicio: '2026-09-15',
          fim: '2026-09-25',
          observacao: null,
          por: 'teste',
        }),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'afastamento-sobreposto' } });
    const posterior = await folha.gravarSgh(
      c,
      (r: number) => ({ ...trilha, acao: 'inclusao' as const, entidadeId: r }),
      (g) =>
        g.incluirAfastamento({
          vinculo: ids.vinculoA,
          motivo: ids.motivo,
          inicio: '2026-09-22',
          fim: '2026-09-25',
          observacao: null,
          por: 'teste',
        }),
    );
    // Prorrogar o fim sobre o afastamento posterior é recusado, e nada muda.
    await expect(
      folha.gravarSgh(c, trilha, (g) =>
        g.encerrarAfastamento({ id, versao: 2, fim: '2026-09-23', por: 'teste' }),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'afastamento-sobreposto' } });
    expect(await folha.afastamento(c, id)).toMatchObject({ fim: '2026-09-20', versao: 2 });
    // Outro estabelecimento não encerra nem cancela.
    await expect(
      folha.gravarSgh(cOutro, trilha, (g) =>
        g.encerrarAfastamento({ id, versao: 2, fim: '2026-09-21', por: 'teste' }),
      ),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    await expect(
      folha.gravarSgh(cOutro, trilha, (g) =>
        g.cancelarAfastamento({ id, versao: 2, motivo: 'x', por: 'teste' }),
      ),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    await folha.gravarSgh(c, { ...trilha, motivo: 'lançado por engano' }, (g) =>
      g.cancelarAfastamento({ id, versao: 2, motivo: 'lançado por engano', por: 'teste' }),
    );
    expect(await folha.afastamento(c, id)).toMatchObject({ situacao: 'cancelado', versao: 3 });
    expect(
      (await folha.afastamentos(c, { vinculo: ids.vinculoA, de: '2026-09-01', ate: '2026-09-30' })).map(
        (a) => a.id,
      ),
    ).toEqual([id, posterior]);
    // Outro estabelecimento não vê nem grava o afastamento deste.
    expect(await folha.afastamento(cOutro, id)).toBeNull();
    await expect(
      folha.gravarSgh(c, trilha, (g) =>
        g.incluirAfastamento({
          vinculo: ids.vinculoB,
          motivo: ids.motivo,
          inicio: '2026-09-10',
          fim: null,
          observacao: null,
          por: 'teste',
        }),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'vinculo-inexistente' } });
  });

  it('lotes da folha externa: outro estabelecimento não é visto e o número inexistente lê nulo', async () => {
    expect(await folha.lotes(c, { empresa: ids.estB })).toEqual([]);
    expect(await folha.lote(c, 999_999_999)).toBeNull();
  });

  it('cálculo: vínculos, dependentes, tipos de rescisão, desligados, FGTS, salários e 13º; o resto recusa com modelo-pendente', async () => {
    const vs = await calculo.vinculos(c, '2026-09-01', '2026-09-30');
    expect(vs).toEqual([
      {
        id: ids.vinculoA,
        matricula: `${P}-1`,
        tipo: 'clt',
        admissao: '2025-01-02',
        desligamento: null,
        centroCusto: null,
        cargaSemanal: 40,
      },
      {
        id: ids.vinculoC,
        matricula: `${P}-3`,
        tipo: 'clt',
        admissao: '2026-08-03',
        desligamento: '2026-09-25',
        centroCusto: null,
        cargaSemanal: 40,
      },
      {
        id: ids.vinculoE,
        matricula: `${P}-4`,
        tipo: 'estagiario',
        admissao: '2026-08-10',
        desligamento: null,
        centroCusto: null,
        cargaSemanal: 40,
      },
    ]);
    const deps = await calculo.dependentes(c, [ids.vinculoA, ids.vinculoC, ids.vinculoB], '2026-09-30');
    expect([...deps.entries()]).toEqual([
      [ids.vinculoA, { irrf: 0, salarioFamilia: 0 }],
      [ids.vinculoC, { irrf: 1, salarioFamilia: 1 }],
    ]);
    // Em 2026-06-01 o segundo dependente ainda vale, mas não tem marca de IRRF nem de salário-família.
    expect((await calculo.dependentes(c, [ids.vinculoC], '2026-06-01')).get(ids.vinculoC)).toEqual({
      irrf: 1,
      salarioFamilia: 1,
    });
    expect((await calculo.dependentes(cOutro, [ids.vinculoC], '2026-09-30')).size).toBe(0);
    expect((await calculo.tiposRescisao(c)).find((t) => t.id === ids.tipoRescisao)).toEqual({
      id: ids.tipoRescisao,
      nome: 'Sem justa causa (sintético)',
      saque: '01',
      causa: 11,
    });
    expect(await calculo.desligados(c, '2026-09-01', '2026-09-30')).toEqual([
      {
        vinculo: ids.vinculoC,
        matricula: `${P}-3`,
        tipo: 'clt',
        admissao: '2026-08-03',
        desligamento: '2026-09-25',
        tipoRescisao: ids.tipoRescisao,
        rescisao: ids.rescisao,
      },
    ]);
    expect(await calculo.desligados(cOutro, '2026-09-01', '2026-09-30')).toEqual([]);
    // FGTS: só a folha de competência fechada (agosto), não a de setembro (competência aberta).
    expect(await calculo.fgtsDepositado(c, ids.vinculoC)).toBe(100);
    // Vínculo de 2025 sem folhas fechadas desde a admissão: recusa e pede o saldo do extrato.
    await expect(calculo.fgtsDepositado(c, ids.vinculoA)).rejects.toMatchObject({
      problema: { codigo: 'saldo-fgts-incompleto' },
    });
    await expect(calculo.fgtsDepositado(cOutro, ids.vinculoC)).rejects.toMatchObject({
      problema: { codigo: 'vinculo-inexistente' },
    });
    const sal = await calculo.salarios(c, [ids.vinculoC, ids.vinculoB]);
    expect(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- o campo é descartado de propósito
      sal.map(({ id: _id, registradoEm, ...x }) => ({ ...x, registradoEm: registradoEm.slice(0, 4) })),
    ).toEqual([
      {
        vinculo: ids.vinculoC,
        inicio: '2026-08-03',
        salario: 3000,
        insalubridade: 0,
        periculosidade: false,
        motivo: 'admissao',
        registradoPor: expect.any(String),
        registradoEm: '2026',
      },
      {
        vinculo: ids.vinculoC,
        inicio: '2026-09-01',
        salario: 3500,
        insalubridade: 0,
        periculosidade: false,
        motivo: 'merito',
        registradoPor: expect.any(String),
        registradoEm: '2026',
      },
    ]);
    expect(await calculo.salarios(cOutro, [ids.vinculoC])).toEqual([]);
    expect([...(await calculo.adiantamentosDecimo(c, ids.estA, 2026)).entries()]).toEqual([
      [ids.vinculoC, 150],
    ]);
    expect((await calculo.adiantamentosDecimo(c, ids.estA, 2026, ['ferias'])).size).toBe(0);
    expect((await calculo.adiantamentosDecimo(cOutro, ids.estB, 2026)).size).toBe(0);
    // A gravação direta está ligada (salário, parâmetros e fechamento); o processamento segue recusando.
    expect(await calculo.podeGravar()).toMatchObject({ pode: true });
    await expect(calculo.processos()).rejects.toMatchObject({ problema: { codigo: 'modelo-pendente' } });
    await expect(calculo.rescisoes()).rejects.toMatchObject({ problema: { codigo: 'modelo-pendente' } });
  });
});
