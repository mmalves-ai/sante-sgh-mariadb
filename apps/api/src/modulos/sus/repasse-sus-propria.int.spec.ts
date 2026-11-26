// Contrato de efeito do repasse da produção SUS (F7, 06-SUS linha 62) contra o MariaDB real (cliente de teste).
// Massa SINTÉTICA (estabelecimento com o código do teste, profissionais, procedimentos, competência, AIH, folha do BPA
// e apuração fictícios; removidos na limpeza). Prova o que fica no banco: as regras do repasse e do rateio do SADT
// gravadas (código repetido e regra inválida recusados sem linha nova); a apuração lendo só a produção APROVADA (a AIH
// apresentada e a folha aberta ficam de fora), a equipe da AIH por atividade (anestesista com a regra própria), a glosa
// proporcional ao não aprovado, o SADT rateado ao executante por pontos, a pendência sem executante; o reprocessamento
// que exclui as linhas anteriores (nunca apaga) e segue a sequência; a versão da apuração; as recusas (versão vista,
// apuração aprovada, fim antes do início) sem gravar; o encerramento da regra que tira a produção do BPA.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaRepasseSusPropria } from './repasse-sus-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c3022rep';
const SIG = ['0415302201', '0205302202', '0205302203', '0301302204'] as const;
const CBO = '225125';

describe.skipIf(SEM_BANCO)('PortaRepasseSusPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRepasseSusPropria;
  let usuario = 0;
  let est = 0;
  let apuracao = 0;
  const prof: number[] = [];
  const criados: { tabela: string; id: number }[] = [];
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const contar = async (sql: string, p: unknown[] = []) => Number((await ler<{ n: number }>(sql, p))[0]?.n);
  const versaoApuracao = async () =>
    Number(
      (await ler<{ versao: number }>('SELECT versao FROM apuracao_repasse WHERE id = ?', [apuracao]))[0]
        ?.versao,
    );
  const vivas = () =>
    ler<{
      sequencia: number;
      instrumento: string;
      executante_profissional_id: number;
      papel: string;
      valor_repasse: string;
      valor_glosa: string;
    }>(
      `SELECT sequencia, instrumento, executante_profissional_id, papel, valor_repasse, valor_glosa
         FROM producao_repasse_sus WHERE apuracao_repasse_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
      [apuracao],
    );
  const regrasDoEst = () =>
    contar('SELECT COUNT(*) AS n FROM regra_repasse_sus WHERE estabelecimento_id = ?', [est]);

  async function limpar(e: Escritor): Promise<void> {
    const ests = 'SELECT id FROM estabelecimento WHERE codigo = ?';
    await e.executar('SET FOREIGN_KEY_CHECKS = 0');
    await e.executar(
      `DELETE x FROM producao_repasse_sus x JOIN apuracao_repasse a ON a.id = x.apuracao_repasse_id
        WHERE a.estabelecimento_id IN (${ests})`,
      [P],
    );
    for (const t of ['conta_aih_profissional', 'conta_aih_procedimento'])
      await e.executar(
        `DELETE x FROM ${t} x JOIN conta_aih c ON c.id = x.conta_aih_id WHERE c.estabelecimento_id IN (${ests})`,
        [P],
      );
    await e.executar(
      `DELETE x FROM producao_ambulatorial_sus_item x JOIN producao_ambulatorial_sus f ON f.id = x.producao_ambulatorial_sus_id
        WHERE f.estabelecimento_id IN (${ests})`,
      [P],
    );
    for (const t of [
      'producao_ambulatorial_sus',
      'conta_aih',
      'competencia_sus',
      'apuracao_repasse',
      'regra_repasse_sus',
      'regra_rateio_sadt_aih',
    ])
      await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN (${ests})`, [P]);
    await limparTrilhaDaMassa(e, { codigos: [P] });
    await e.executar(`DELETE FROM idempotencia_operacao WHERE estabelecimento_id IN (${ests})`, [P]);
    await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaRepasseSusPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const agora = new Date();
      const garantir = async (tabela: string, sel: string, sp: unknown[], ins: string, ip: unknown[]) => {
        const x = await e.uma<{ id: number }>(sel, sp);
        if (x) return Number(x.id);
        const id = await e.inserir(ins, ip);
        criados.push({ tabela, id });
        return id;
      };
      const novo = async (tabela: string, ins: string, ip: unknown[]) => {
        const id = await e.inserir(ins, ip);
        criados.push({ tabela, id });
        return id;
      };
      const u = await e.uma('SELECT id FROM usuario WHERE excluido_em IS NULL ORDER BY id LIMIT 1');
      usuario = Number(u?.['id']);
      est = await e.inserir(
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, criado_em) VALUES (?, ?, ?, ?, ?)',
        [P, 'Hospital fictício C3022', 'Hospital fictício C3022 (teste)', '9030220', agora],
      );
      for (const nome of [
        'Cirurgiã fictícia C3022',
        'Anestesista fictício C3022',
        'Radiologista fictícia C3022',
      ]) {
        const pf = await novo('pessoa_fisica', 'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
          nome,
          agora,
        ]);
        prof.push(
          await novo(
            'profissional',
            "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'corpo_clinico', 'teste', ?)",
            [pf, agora],
          ),
        );
      }
      const cbo = await garantir(
        'ocupacao_cbo',
        'SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ?',
        [CBO],
        "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES (?, 'Médico clínico (teste)', ?)",
        [CBO, agora],
      );
      const atividade: Record<string, number> = {};
      for (const codigo of ['1', '6'])
        atividade[codigo] = await garantir(
          'dominio_sus',
          "SELECT id FROM dominio_sus WHERE lista = 'atividade_profissional' AND codigo = ?",
          [codigo],
          "INSERT INTO dominio_sus (lista, codigo, descricao, criado_em) VALUES ('atividade_profissional', ?, ?, ?)",
          [codigo, `Atividade fictícia ${codigo}`, agora],
        );
      const g = await e.uma<{ id: number }>('SELECT id FROM grupo_sigtap ORDER BY id LIMIT 1');
      const grupo = g
        ? Number(g.id)
        : await novo(
            'grupo_sigtap',
            `INSERT INTO grupo_sigtap (nivel, codigo_sigtap, descricao, vigencia_inicio, versao_fonte, criado_em)
             VALUES ('grupo', '99', 'Grupo fictício C3022', '2008-01-01', 'teste', ?)`,
            [agora],
          );
      const sig: number[] = [];
      for (const codigo of SIG)
        sig.push(
          await garantir(
            'procedimento_sigtap',
            'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ?',
            [codigo],
            `INSERT INTO procedimento_sigtap (codigo_sigtap, descricao, grupo_sigtap_id, sexo, vigencia_inicio, versao_fonte, criado_em)
             VALUES (?, 'Procedimento fictício C3022 (teste)', ?, 'ambos', '2008-01-01', 'teste', ?)`,
            [codigo, grupo, agora],
          ),
        );
      await e.executar('UPDATE procedimento_sigtap SET grupo_sigtap_id = ? WHERE id IN (?, ?, ?, ?)', [
        grupo,
        ...sig,
      ]);
      const competencia = async (instrumento: string) =>
        e.inserir(
          `INSERT INTO competencia_sus (estabelecimento_id, instrumento, competencia, periodo_inicio, periodo_fim, situacao, aberta_em, criado_em)
           VALUES (?, ?, '202510', '2025-10-01', '2025-10-31', 'aberta', ?, ?)`,
          [est, instrumento, agora, agora],
        );
      const compAih = await competencia('aih');
      const compBpa = await competencia('bpa');
      const conta = (numero: string, situacao: string) =>
        e.inserir(
          `INSERT INTO conta_aih (estabelecimento_id, internacao_id, paciente_id, competencia_sus_id, numero_aih, data_internacao,
             carater_dominio_sus_id, solicitado_procedimento_sigtap_id, codigo_cid10_principal, valor_servico_hospitalar,
             valor_servico_profissional, valor_total, valor_aprovado, remessa_sisaih_id, situacao, criado_em)
           VALUES (?, 1, 1, ?, ?, '2025-10-02', 1, ?, 'K358', 500, 500, 1000, 800, 1, ?, ?)`,
          [est, compAih, numero, sig[0], situacao, agora],
        );
      const procAih = (
        c: number,
        seq: number,
        s: number,
        exec: number | null,
        pontos: number | null,
        sh: number,
        sp: number,
      ) =>
        e.inserir(
          `INSERT INTO conta_aih_procedimento (conta_aih_id, sequencia, procedimento_sigtap_id, tipo, quantidade,
             executante_profissional_id, pontos, valor_servico_hospitalar, valor_servico_profissional, valor_total, criado_em)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
          [c, seq, s, seq === 1 ? 'principal' : 'secundario', exec, pontos, sh, sp, sh + sp, agora],
        );
      const equipe = (c: number, seq: number, proc: number, p: number, ativ: number, sp: number) =>
        e.inserir(
          `INSERT INTO conta_aih_profissional (conta_aih_id, sequencia, conta_aih_procedimento_id, profissional_id,
             ocupacao_cbo_id, atividade_dominio_sus_id, valor_servico_profissional, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [c, seq, proc, p, cbo, ativ, sp, agora],
        );
      const aprovada = await conta('9302201000011', 'aprovada');
      const p1 = await procAih(aprovada, 1, sig[0]!, null, null, 500, 400);
      await equipe(aprovada, 1, p1, prof[0]!, atividade['1']!, 300);
      await equipe(aprovada, 2, p1, prof[1]!, atividade['6']!, 100);
      await procAih(aprovada, 2, sig[1]!, null, null, 0, 40); // SADT sem equipe nem executante
      await procAih(aprovada, 3, sig[2]!, prof[2]!, 10, 0, 60);
      const apresentada = await conta('9302201000022', 'apresentada');
      const pa = await procAih(apresentada, 1, sig[0]!, null, null, 500, 999);
      await equipe(apresentada, 1, pa, prof[0]!, atividade['1']!, 999);
      const folha = (numero: number, situacao: string) =>
        e.inserir(
          `INSERT INTO producao_ambulatorial_sus (estabelecimento_id, competencia_sus_id, tipo_folha, numero_folha, situacao, criado_em)
           VALUES (?, ?, 'consolidado', ?, ?, ?)`,
          [est, compBpa, numero, situacao, agora],
        );
      const item = (f: number, seq: number, p: number | null, qtd: number) =>
        e.inserir(
          `INSERT INTO producao_ambulatorial_sus_item (producao_ambulatorial_sus_id, sequencia, procedimento_sigtap_id,
             ocupacao_cbo_id, profissional_id, idade_anos, quantidade, valor_servico_ambulatorial, valor_servico_profissional, valor_total, criado_em)
           VALUES (?, ?, ?, ?, ?, 40, ?, 10, 20, 30, ?)`,
          [f, seq, sig[3], cbo, p, qtd, agora],
        );
      const processada = await folha(1, 'processada');
      await item(processada, 1, prof[0]!, 2);
      await item(processada, 2, null, 1);
      await item(await folha(2, 'aberta'), 1, prof[0]!, 5);
      apuracao = await e.inserir(
        `INSERT INTO apuracao_repasse (estabelecimento_id, numero, competencia, tipo_apuracao, situacao, iniciada_em,
           iniciada_por_usuario_id, criado_em) VALUES (?, 'C3022-1', '2025-10-01', 'producao', 'em_apuracao', ?, ?, ?)`,
        [est, agora, usuario, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  }, 60_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, async (e) => {
      await limpar(e);
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      for (const c of [...criados].reverse())
        await e.executar(`DELETE FROM ${c.tabela} WHERE id = ?`, [c.id]);
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
    await nucleo.encerrar();
  }, 60_000);

  const regraBase = { modalidade: 'internacao', base: 'servico_profissional', inicio: '2025-01-01' };

  it('grava as regras e o rateio; recusa a repetida e a inválida sem linha nova', async () => {
    const r1 = await porta.incluirRegra(ctx(), {
      ...regraBase,
      codigo: 'INT-70',
      descricao: 'Internação 70%',
      percentualPago: 70,
    });
    expect(r1).toMatchObject({ codigo: 'INT-70', papel: 'todos', percentualPago: 70, versao: 1 });
    const r2 = await porta.incluirRegra(ctx(), {
      ...regraBase,
      codigo: 'ANEST-80',
      descricao: 'Anestesia 80%',
      papel: 'anestesista',
      procedimento: SIG[0],
      ocupacao: CBO,
      percentualPago: 80,
    });
    expect(r2).toMatchObject({ procedimentoCodigo: SIG[0], ocupacaoCodigo: CBO, papel: 'anestesista' });
    await porta.incluirRegra(ctx(), {
      modalidade: 'ambulatorial',
      base: 'valor_fixo',
      inicio: '2025-01-01',
      codigo: 'AMB-FIXO',
      descricao: 'Consulta valor fixo',
      valorFixo: 5,
    });
    expect(await regrasDoEst()).toBe(3);
    await expect(
      porta.incluirRegra(ctx(), {
        ...regraBase,
        codigo: 'INT-70',
        descricao: 'Repetida',
        percentualPago: 50,
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.incluirRegra(ctx(), {
        ...regraBase,
        codigo: 'PTS',
        descricao: 'Pontos sem valor',
        base: 'pontos',
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.incluirRegra(ctx(), {
        ...regraBase,
        codigo: 'X',
        descricao: 'Código inexistente',
        procedimento: '0000000000',
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await regrasDoEst()).toBe(3);
    const rt = await porta.incluirRateio(ctx(), { procedimento: SIG[2], inicio: '2025-01-01' });
    expect(rt).toMatchObject({
      procedimentoCodigo: SIG[2],
      consideraSadt: true,
      usaPeso: false,
      profissionalNome: null,
    });
    await expect(porta.incluirRateio(ctx(), { inicio: '2025-01-01' })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    expect(
      await contar('SELECT COUNT(*) AS n FROM regra_rateio_sadt_aih WHERE estabelecimento_id = ?', [est]),
    ).toBe(1);
    const lido = await porta.consultar(ctx());
    expect([lido.regras.length, lido.rateios.length, lido.apuracoes.map((a) => a.competencia)]).toEqual([
      3,
      1,
      ['202510'],
    ]);
  });

  it('apura só a produção aprovada: equipe por atividade, glosa proporcional, SADT rateado, pendência', async () => {
    const v0 = await versaoApuracao();
    const r = await porta.apurar(ctx(), apuracao, { versao: v0 });
    expect(r).toMatchObject({
      competencia: '202510',
      linhas: 5,
      excluidas: 0,
      totalRepasse: 307.6,
      totalGlosa: 74.4,
    });
    expect(r.pendencias).toEqual([expect.objectContaining({ instrumento: 'bpa', motivo: 'sem-executante' })]);
    expect(
      (await vivas()).map((l) => [
        l.sequencia,
        l.instrumento,
        l.executante_profissional_id,
        l.papel,
        Number(l.valor_repasse),
        Number(l.valor_glosa),
      ]),
    ).toEqual([
      [1, 'bpa', prof[0], 'executante', 10, 0],
      [2, 'aih', prof[0], 'executante', 168, 42],
      [3, 'aih', prof[1], 'anestesista', 64, 16],
      [4, 'aih', prof[2], 'executante', 33.6, 8.4],
      [5, 'aih', prof[2], 'executante', 32, 8],
    ]);
    expect(await versaoApuracao()).toBe(v0 + 1);
    const linhas = await porta.linhas(ctx(), apuracao);
    expect(linhas.map((l) => l.regraCodigo)).toEqual(['AMB-FIXO', 'INT-70', 'ANEST-80', 'INT-70', null]);
  });

  it('reprocessa excluindo as linhas anteriores; recusa versão antiga, fim antes do início e apuração aprovada', async () => {
    await expect(porta.apurar(ctx(), apuracao, { versao: 1 })).rejects.toMatchObject({
      problema: { status: 409 },
    });
    const fixa = (await porta.consultar(ctx())).regras.find((x) => x.codigo === 'AMB-FIXO')!;
    await expect(
      porta.encerrar(ctx(), 'regra', fixa.id, { versao: fixa.versao, fim: '2024-12-31' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const enc = await porta.encerrar(ctx(), 'regra', fixa.id, { versao: fixa.versao, fim: '2025-09-30' });
    expect(enc.versao).toBe(fixa.versao + 1);
    const r = await porta.apurar(ctx(), apuracao, { versao: await versaoApuracao() });
    expect(r).toMatchObject({ linhas: 4, excluidas: 5, totalRepasse: 297.6 });
    expect(r.pendencias.map((p) => p.motivo).sort()).toEqual(['sem-executante', 'sem-regra']);
    expect((await vivas()).map((l) => l.sequencia)).toEqual([6, 7, 8, 9]);
    expect(
      await contar('SELECT COUNT(*) AS n FROM producao_repasse_sus WHERE apuracao_repasse_id = ?', [
        apuracao,
      ]),
    ).toBe(9);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: P }, (e) =>
      e.executar("UPDATE apuracao_repasse SET situacao = 'aprovada' WHERE id = ?", [apuracao]),
    );
    await expect(porta.apurar(ctx(), apuracao, { versao: await versaoApuracao() })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    expect(
      await contar('SELECT COUNT(*) AS n FROM producao_repasse_sus WHERE apuracao_repasse_id = ?', [
        apuracao,
      ]),
    ).toBe(9);
  });
});
