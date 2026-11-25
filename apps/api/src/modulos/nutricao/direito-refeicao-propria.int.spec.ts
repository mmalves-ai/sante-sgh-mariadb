// Contrato de efeito da refeição do acompanhante pelo direito legal e pelas regras do convênio (F7, 04-HOT linha 133)
// contra o MariaDB real (cliente de teste). Massa SINTÉTICA: estabelecimento, fonte pagadora, pacientes (um idoso, um
// adulto), atendimentos, internações, conta, item faturável, tabela de preço e preço da refeição com o prefixo do teste;
// usuário, acomodação e refeições do dia são ids já existentes do cliente de teste (só lidos).
// Prova o que fica no banco: a regra validada no domínio (422 sem linha), a inclusão com as refeições, a alteração com
// a versão +1 (refeição retirada marcada excluída e restaurada ao voltar), tirar de uso sem apagar; o lançamento coberto
// pela lei (idade), à espera da autorização do convênio e cobrável com o item na conta pelo faturamento.lancarItem (valor
// da tabela da conta); a autorização negada vai para a conta; a refeição repetida recusada (409) sem linha nova; o
// cancelamento sem apagar e o da refeição já na conta recusado; a base legal registrada cobre sem regra de idade; a trilha.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaDireitoRefeicaoPropria } from './direito-refeicao-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c1030dr';
const HOJE = new Date().toISOString().slice(0, 10);

interface Massa {
  est: number;
  usuario: number;
  fonte: number;
  acomodacao: number;
  r1: number;
  r2: number;
  idoso: number;
  adulto: number;
  atdIdoso: number;
  atdAdulto: number;
  conta: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM refeicao_acompanhante WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE r FROM direito_refeicao_acompanhante_refeicao r
         JOIN direito_refeicao_acompanhante d ON d.id = r.direito_refeicao_acompanhante_id
        WHERE d.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM direito_refeicao_acompanhante WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM preco_refeicao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE m FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id
         JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(
      `DELETE i FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id
        WHERE c.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM conta_hospitalar WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM plano_refeicao_acompanhante WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM internacao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE v FROM preco_procedimento_valor v JOIN preco_procedimento pp ON pp.id = v.preco_procedimento_id
         JOIN tabela_preco t ON t.id = pp.tabela_preco_id WHERE t.codigo = ?`,
      [`${P}-TP`],
    );
    await e.executar(
      'DELETE pp FROM preco_procedimento pp JOIN tabela_preco t ON t.id = pp.tabela_preco_id WHERE t.codigo = ?',
      [`${P}-TP`],
    );
    await e.executar('DELETE FROM tabela_preco WHERE codigo = ?', [`${P}-TP`]);
    await e.executar('DELETE FROM item_faturavel WHERE codigo = ?', [`${P}-REF`]);
    await e.executar('DELETE FROM grupo_faturamento WHERE codigo = ?', [`${P}-GF`]);
    await e.executar(
      `DELETE p FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE pf.nome LIKE ?`,
      [`SINTETICO ${P}%`],
    );
    await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`SINTETICO ${P}%`]);
    await e.executar('DELETE FROM fonte_pagadora WHERE codigo = ?', [`${P}-FP`]);
    await e.executar(`DELETE FROM acomodacao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM refeicao_do_dia WHERE codigo LIKE ?', [`${P}-R%`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaDireitoRefeicaoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaDireitoRefeicaoPropria;
  let m: Massa;
  let internIdoso = 0;
  let internAdulto = 0;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const contar = async (sql: string, p: unknown[]) => Number((await ler(sql, p))[0]?.['n'] ?? 0);
  const regraBase = () => ({
    descricao: 'Convênio sintético autoriza o almoço',
    fundamento: 'convenio' as const,
    fontePagadora: m.fonte,
    acomodacao: null,
    idadeMinima: null,
    idadeMaxima: null,
    cobertoPelaFonte: false,
    exigeAutorizacao: true,
    incluidoNaDiaria: false,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    refeicoes: [m.r1],
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const tipoConta = await e.uma('SELECT MIN(id) AS id FROM tipo_conta');
      if (!usuario?.['id'] || !tipoConta?.['id'])
        throw new Error('O cliente de teste precisa de usuário e tipo de conta.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const fonte = await e.inserir(
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, ?, 'operadora', 'ativa', ?)",
        [`${P}-FP`, `OPERADORA SINTETICA ${P}`, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const paciente = async (sufixo: string, nasc: string, prontuario: number) => {
          const pf = await e.inserir(
            'INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, ?, ?)',
            [`SINTETICO ${P} ${sufixo}`, nasc, agora],
          );
          return e.inserir(
            "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
            [pf, prontuario, agora],
          );
        };
        const acomodacao = {
          id: await e.inserir(
            `INSERT INTO acomodacao (estabelecimento_id, unidade_internacao_id, categoria_acomodacao_id, codigo, nome, criado_em)
             VALUES (?, 1, 1, ?, 'QUARTO SINTETICO', ?)`,
            [est, `${P}-Q1`, agora],
          ),
        };
        const refs: Record<string, unknown>[] = [];
        for (const [k, nome] of ['ALMOCO', 'JANTAR'].entries())
          refs.push({
            id: await e.inserir(
              `INSERT INTO refeicao_do_dia (codigo, descricao, ordem, servida_acompanhante, ativo, criado_em)
               VALUES (?, ?, ?, TRUE, TRUE, ?)`,
              [`${P}-R${k + 1}`, `${nome} SINTETICO ${P}`, 9301 + k, agora],
            ),
          });
        const idoso = await paciente('IDOSO', '1950-03-10', 930_030_001);
        const adulto = await paciente('ADULTO', '1990-05-20', 930_030_002);
        const atendimento = (pac: number, n: string) =>
          e.inserir(
            `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
               carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
             VALUES (?, ?, ?, 1, 1, ?, 1, NOW(3) - INTERVAL 2 DAY, ?)`,
            [est, `${P}-${n}`, pac, fonte, agora],
          );
        const atdIdoso = await atendimento(idoso, 'A1');
        const atdAdulto = await atendimento(adulto, 'A2');
        const internacao = (atd: number, pac: number, n: string) =>
          e.inserir(
            `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
               carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, leito_hospitalar_id, acomodacao_id,
               especialidade_medica_id, medico_assistente_profissional_id, fonte_pagadora_id, situacao, criado_em)
             VALUES (?, ?, ?, ?, NOW(3) - INTERVAL 2 DAY, 1, 1, 1, 1, ?, 1, 1, ?, 'ativa', ?)`,
            [est, `${P}-${n}`, atd, pac, acomodacao['id'], fonte, agora],
          );
        internIdoso = await internacao(atdIdoso, idoso, 'I1');
        internAdulto = await internacao(atdAdulto, adulto, 'I2');
        const gf = await e.inserir(
          "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, 'TAXAS C1030', 'taxa', ?)",
          [`${P}-GF`, agora],
        );
        const item = await e.inserir(
          `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em)
           VALUES (?, 'REFEICAO DE ACOMPANHANTE SINTETICA', 'taxa', ?, ?)`,
          [`${P}-REF`, gf, agora],
        );
        const tabela = await e.inserir(
          `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, fonte_pagadora_id,
             situacao, criado_em) VALUES (?, ?, 'TABELA SINTETICA TAXAS', 'diaria_taxa', 'propria', ?, 'ativa', ?)`,
          [est, `${P}-TP`, fonte, agora],
        );
        const pp = await e.inserir(
          `INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, modelo_valor, criado_em)
           VALUES (?, 1, ?, 'valor', ?)`,
          [tabela, item, agora],
        );
        await e.inserir(
          `INSERT INTO preco_procedimento_valor (preco_procedimento_id, vigencia_inicio, valor_total, ocorrido_em, criado_em)
           VALUES (?, '2020-01-01', 27.5, ?, ?)`,
          [pp, agora, agora],
        );
        for (const r of refs)
          await e.inserir(
            `INSERT INTO preco_refeicao (estabelecimento_id, refeicao_do_dia_id, item_faturavel_id, valor, vigencia_inicio,
               criado_em) VALUES (?, ?, ?, 25, '2020-01-01', ?)`,
            [est, r['id'], item, agora],
          );
        const conta = await e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tipo_conta_id, natureza, competencia, inicio_em, calculada, tabela_preco_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 'internacao', ?, NOW(3) - INTERVAL 2 DAY, TRUE, ?, ?)`,
          [
            est,
            `${P}-C1`,
            atdAdulto,
            adulto,
            fonte,
            tipoConta['id'],
            `${HOJE.slice(0, 7)}-01`,
            tabela,
            agora,
          ],
        );
        return {
          est,
          usuario: Number(usuario['id']),
          fonte,
          acomodacao: Number(acomodacao['id']),
          r1: Number(refs[0]!['id']),
          r2: Number(refs[1]!['id']),
          idoso,
          adulto,
          atdIdoso,
          atdAdulto,
          conta,
        };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    porta = new PortaDireitoRefeicaoPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('regra: validada no domínio, incluída com as refeições, alterada pela versão e tirada de uso sem apagar', async () => {
    await expect(porta.incluir(ctx(), { ...regraBase(), fontePagadora: null })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    const sql = 'SELECT COUNT(*) AS n FROM direito_refeicao_acompanhante WHERE estabelecimento_id = ?';
    expect(await contar(sql, [m.est])).toBe(0);
    const { id } = await porta.incluir(ctx(), regraBase());
    const [r] = await ler(
      'SELECT fundamento, fonte_pagadora_id, exige_autorizacao, ativo, versao FROM direito_refeicao_acompanhante WHERE id = ?',
      [id],
    );
    expect(r).toMatchObject({ fundamento: 'convenio', fonte_pagadora_id: m.fonte, versao: 1 });
    expect(Boolean(r!['exige_autorizacao'])).toBe(true);
    const refs = (excl: boolean) =>
      contar(
        `SELECT COUNT(*) AS n FROM direito_refeicao_acompanhante_refeicao WHERE direito_refeicao_acompanhante_id = ?
            AND excluido_em IS ${excl ? 'NOT ' : ''}NULL`,
        [id],
      );
    expect(await refs(false)).toBe(1);
    await porta.alterar(ctx(), id, { ...regraBase(), refeicoes: [m.r2], versao: 1 });
    expect(await refs(false)).toBe(1);
    expect(await refs(true)).toBe(1);
    // A versão velha é recusada (409) e nada muda.
    await expect(porta.alterar(ctx(), id, { ...regraBase(), versao: 1 })).rejects.toMatchObject({
      problema: { status: 409 },
    });
    await porta.alterar(ctx(), id, { ...regraBase(), refeicoes: [m.r1, m.r2], versao: 2 });
    expect(await refs(false)).toBe(2);
    expect(await refs(true)).toBe(0);
    await porta.definirUso(ctx(), id, { ativo: false, versao: 3 });
    const [fora] = await ler('SELECT ativo, versao FROM direito_refeicao_acompanhante WHERE id = ?', [id]);
    expect(Boolean(fora!['ativo'])).toBe(false);
    expect(Number(fora!['versao'])).toBe(4);
    expect(await contar(sql, [m.est])).toBe(1);
    const lista = await porta.listar(ctx());
    expect(lista.map((x) => x.id)).toEqual([id]);
  });

  it('lançamento: coberta pela lei, a autorizar pelo convênio e cobrável na conta pelo faturamento', async () => {
    await porta.incluir(ctx(), {
      ...regraBase(),
      descricao: 'Pessoa idosa (Lei 10.741)',
      fundamento: 'lei',
      fontePagadora: null,
      idadeMinima: 60,
      exigeAutorizacao: false,
      cobertoPelaFonte: true,
      refeicoes: [],
    });
    const { id: regraConv } = await porta.incluir(ctx(), regraBase());
    // Idoso: a lei cobre (a regra de lei ganha da do convênio).
    const dIdoso = await porta.decidir(ctx(), internIdoso, HOJE, m.r1);
    expect(dIdoso).toMatchObject({ cobertura: 'coberta', fundamento: 'lei' });
    expect(dIdoso.idadePaciente).toBeGreaterThanOrEqual(60);
    const coberta = await porta.lancar(ctx(), {
      internacao: internIdoso,
      data: HOJE,
      refeicao: m.r1,
      quantidade: 1,
    });
    expect(coberta.cobertura).toBe('coberta');
    const [rc] = await ler(
      'SELECT situacao, cobravel, valor, conta_hospitalar_id, direito_refeicao_acompanhante_id FROM refeicao_acompanhante WHERE id = ?',
      [coberta.id],
    );
    expect(rc).toMatchObject({ situacao: 'autorizada', valor: null, conta_hospitalar_id: null });
    expect(Boolean(rc!['cobravel'])).toBe(false);
    expect(rc!['direito_refeicao_acompanhante_id']).not.toBe(regraConv);
    // Adulto, almoço: o convênio pede autorização (solicitada); negada, vai para a conta pelo preço da tabela.
    const espera = await porta.lancar(ctx(), {
      internacao: internAdulto,
      data: HOJE,
      refeicao: m.r1,
      quantidade: 1,
    });
    expect(espera.cobertura).toBe('a_autorizar');
    const [re] = await ler(
      'SELECT situacao, versao, direito_refeicao_acompanhante_id FROM refeicao_acompanhante WHERE id = ?',
      [espera.id],
    );
    expect(re).toMatchObject({ situacao: 'solicitada', direito_refeicao_acompanhante_id: regraConv });
    const itensConta = () =>
      contar(
        'SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? AND excluido_em IS NULL',
        [m.conta],
      );
    expect(await itensConta()).toBe(0);
    const negada = await porta.autorizar(ctx(), espera.id, {
      autorizada: false,
      versao: Number(re!['versao']),
    });
    expect(negada).toMatchObject({ cobertura: 'cobravel', valor: 27.5 });
    const [rn] = await ler(
      'SELECT situacao, cobravel, valor, conta_hospitalar_id, autorizada_pela_fonte_pagadora FROM refeicao_acompanhante WHERE id = ?',
      [espera.id],
    );
    expect(rn).toMatchObject({ situacao: 'autorizada', conta_hospitalar_id: m.conta });
    expect(Number(rn!['valor'])).toBe(27.5);
    expect(Boolean(rn!['cobravel'])).toBe(true);
    expect(Boolean(rn!['autorizada_pela_fonte_pagadora'])).toBe(false);
    expect(await itensConta()).toBe(1);
    // Adulto, segunda refeição: nenhuma regra e sem direito legal → cobrável já no lançamento (2 unidades).
    const cobravel = await porta.lancar(ctx(), {
      internacao: internAdulto,
      data: HOJE,
      refeicao: m.r2,
      quantidade: 2,
    });
    expect(cobravel).toMatchObject({ cobertura: 'cobravel', valor: 55 });
    expect(await itensConta()).toBe(2);
    const [item] = await ler(
      `SELECT i.valor_total, i.quantidade FROM conta_hospitalar_item i JOIN refeicao_acompanhante r
          ON r.conta_hospitalar_id = i.conta_hospitalar_id WHERE r.id = ? ORDER BY i.id DESC LIMIT 1`,
      [cobravel.id],
    );
    expect(Number(item!['valor_total'])).toBe(55);
    expect(Number(item!['quantidade'])).toBe(2);
    // A mesma refeição do dia é recusada (409) sem linha nova nem item novo.
    const total = () =>
      contar('SELECT COUNT(*) AS n FROM refeicao_acompanhante WHERE estabelecimento_id = ?', [m.est]);
    expect(await total()).toBe(3);
    await expect(
      porta.lancar(ctx(), { internacao: internAdulto, data: HOJE, refeicao: m.r2, quantidade: 1 }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    expect(await total()).toBe(3);
    expect(await itensConta()).toBe(2);
    // O idoso não tem conta: cobrável seria recusado; a refeição coberta não precisa de conta (já provado acima).
    // Cancelar: a já lançada na conta é recusada; a coberta vira cancelada e continua no banco.
    const [vc] = await ler('SELECT versao FROM refeicao_acompanhante WHERE id = ?', [cobravel.id]);
    await expect(
      porta.cancelar(ctx(), cobravel.id, { motivo: 'Lançada por engano', versao: Number(vc!['versao']) }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await porta.cancelar(ctx(), coberta.id, { motivo: 'Acompanhante saiu', versao: 1 });
    const [rcan] = await ler('SELECT situacao, observacao FROM refeicao_acompanhante WHERE id = ?', [
      coberta.id,
    ]);
    expect(rcan).toMatchObject({ situacao: 'cancelada' });
    expect(String(rcan!['observacao'])).toContain('Acompanhante saiu');
    expect(await total()).toBe(3);
    const lidas = await porta.refeicoesDaInternacao(ctx(), internAdulto);
    expect(lidas.map((x) => x.cobravel)).toEqual([true, true]);
    // A trilha da operação ficou na mesma transação.
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?',
        [m.est, m.usuario],
      ),
    ).toBeGreaterThan(0);
  });

  it('a base legal registrada na nutrição cobre o adulto sem faixa de idade (parturiente)', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `legal-${P}` }, (e) =>
      e.inserir(
        `INSERT INTO plano_refeicao_acompanhante (estabelecimento_id, internacao_id, direito_legal, inicio_em, situacao,
           criado_em) VALUES (?, ?, 'parturiente', NOW(3) - INTERVAL 1 DAY, 'ativa', NOW(3))`,
        [m.est, internAdulto],
      ),
    );
    const d = await porta.decidir(ctx(), internAdulto, HOJE, m.r2);
    expect(d).toMatchObject({ cobertura: 'coberta', fundamento: 'lei', baseLegal: 'parturiente' });
  });
});
