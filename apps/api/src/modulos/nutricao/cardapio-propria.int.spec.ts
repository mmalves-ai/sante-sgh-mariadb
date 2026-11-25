// Contrato de efeito do cardápio do serviço de nutrição e dietética (F8, 04-HOT linha 141) contra o MariaDB real
// (cliente de teste). Massa SINTÉTICA com o prefixo do teste: estabelecimento, refeição do dia, opções do cardápio,
// modalidade de dieta, unidade de medida, grupo e gêneros, uma nutricionista (usuário, pessoa, profissional e ocupação
// CBO 223710) e um usuário sem vínculo, paciente, atendimento, internação e o mapa de dietas fechado do dia; ids de
// cadastro básico (unidade assistencial, setor, categoria) são os do cliente de teste (só lidos).
// Prova o que fica no banco: a preparação com a ficha técnica calculada (líquido e custo), a linha que sai marcada
// excluída e reativada quando volta, o código repetido recusado; o planejamento em rascunho com as preparações, o envio,
// a aprovação recusada a quem não é nutricionista e gravada com o profissional e o instante, a edição recusada fora do
// rascunho, a publicação; a previsão da produção (mapa com margem, escolha e planejado; gêneros e custo); a escolha do
// paciente (substitui a anterior, recusa opção fora do dia, cancela); o cancelamento do planejamento com o motivo; a trilha.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaCardapioPropria } from './cardapio-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c2098cd';
const diaLocal = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const HOJE = diaLocal(new Date());
const AMANHA = diaLocal(new Date(Date.now() + 86_400_000));

interface Massa {
  est: number;
  nutri: number;
  outro: number;
  profissional: number;
  refeicao: number;
  altA: number;
  altB: number;
  altC: number;
  unidade: number;
  arroz: number;
  frango: number;
  oleo: number;
  internacao: number;
  atendimento: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM escolha_cardapio_paciente WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE i FROM planejamento_cardapio_preparacao i JOIN planejamento_cardapio p ON p.id = i.planejamento_cardapio_id
        WHERE p.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM planejamento_cardapio WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE f FROM ficha_tecnica_preparacao f JOIN preparacao_culinaria p ON p.id = f.preparacao_culinaria_id
        WHERE p.codigo LIKE ?`,
      [`${P}-%`],
    );
    await e.executar('DELETE FROM preparacao_culinaria WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar(
      `DELETE it FROM mapa_dieta_item it JOIN mapa_dieta m ON m.id = it.mapa_dieta_id WHERE m.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM mapa_dieta WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM internacao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM unidade_internacao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      'DELETE p FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE pf.nome LIKE ?',
      [`SINTETICO ${P}%`],
    );
    await e.executar(
      `DELETE up FROM usuario_profissional up JOIN usuario u ON u.id = up.usuario_id WHERE u.login LIKE ?`,
      [`${P}.%`],
    );
    await e.executar(
      `DELETE po FROM profissional_ocupacao po JOIN profissional pr ON pr.id = po.profissional_id
         JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id WHERE pf.nome LIKE ?`,
      [`SINTETICO ${P}%`],
    );
    await e.executar(
      'DELETE pr FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id WHERE pf.nome LIKE ?',
      [`SINTETICO ${P}%`],
    );
    await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`SINTETICO ${P}%`]);
    await e.executar('DELETE FROM insumo WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM grupo_insumo WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM unidade_medida WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM alternativa_cardapio WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM modalidade_dieta WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM refeicao_do_dia WHERE codigo LIKE ?', [`${P}-%`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  const usuarios = (await e.consultar('SELECT id FROM usuario WHERE login LIKE ?', [`${P}.%`])).map((x) =>
    Number(x['id']),
  );
  await limparTrilhaDaMassa(e, { codigos: [P] });
  if (usuarios.length) {
    await e.executar('SET FOREIGN_KEY_CHECKS = 0');
    try {
      await e.executar(`DELETE FROM usuario WHERE id IN (${usuarios.map(() => '?').join(',')})`, usuarios);
    } finally {
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    }
  }
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaCardapioPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaCardapioPropria;
  let m: Massa;
  const ctx = (usuario = m.nutri) => ({ cliente: CLIENTE, hospital: P, usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const usuario = (login: string) =>
          e.inserir('INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)', [
            `${P}.${login}`,
            `USUARIO SINTETICO ${login}`,
            agora,
          ]);
        const nutri = await usuario('nutri');
        const outro = await usuario('copa');
        const pfNutri = await e.inserir(
          "INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, '1985-01-01', ?)",
          [`SINTETICO ${P} NUTRICIONISTA`, agora],
        );
        const profissional = await e.inserir(
          "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'assistencial', ?)",
          [pfNutri, agora],
        );
        const cbo =
          Number((await e.uma("SELECT id FROM ocupacao_cbo WHERE codigo_cbo = '223710'"))?.['id'] ?? 0) ||
          (await e.inserir(
            "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES ('223710', 'Nutricionista', ?)",
            [agora],
          ));
        await e.inserir(
          'INSERT INTO profissional_ocupacao (profissional_id, ocupacao_cbo_id, criado_em) VALUES (?, ?, ?)',
          [profissional, cbo, agora],
        );
        await e.inserir(
          'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
          [nutri, profissional, '2026-01-01', agora],
        );
        const refeicao = await e.inserir(
          `INSERT INTO refeicao_do_dia (codigo, descricao, ordem, servida_acompanhante, ativo, criado_em)
           VALUES (?, ?, 9298, TRUE, TRUE, ?)`,
          [`${P}-R1`, `ALMOCO SINTETICO ${P}`, agora],
        );
        const alternativa = (cod: string, ordem: number) =>
          e.inserir(
            `INSERT INTO alternativa_cardapio (codigo, descricao, ativo, classificacao, ordem_exibicao, criado_em)
             VALUES (?, ?, TRUE, 'opcao', ?, ?)`,
            [`${P}-${cod}`, `OPCAO ${cod} SINTETICA`, ordem, agora],
          );
        const altA = await alternativa('A', 1);
        const altB = await alternativa('B', 2);
        const altC = await alternativa('C', 3);
        const modalidade = await e.inserir(
          "INSERT INTO modalidade_dieta (codigo, descricao, ativo, classe, criado_em) VALUES (?, ?, TRUE, 'oral', ?)",
          [`${P}-MD`, `DIETA LIVRE SINTETICA ${P}`, agora],
        );
        const unidade = await e.inserir(
          'INSERT INTO unidade_medida (codigo, descricao, sigla, criado_em) VALUES (?, ?, ?, ?)',
          [`${P}-KG`, 'QUILOGRAMA SINTETICO', 'KGS', agora],
        );
        const grupo = await e.inserir(
          "INSERT INTO grupo_insumo (codigo, descricao, natureza, criado_em) VALUES (?, 'GENEROS SINTETICOS', 'material', ?)",
          [`${P}-G`, agora],
        );
        const insumo = (cod: string) =>
          e.inserir(
            `INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, criado_em)
             VALUES (?, ?, 'outro', ?, ?, ?)`,
            [`${P}-${cod}`, `GENERO SINTETICO ${cod}`, grupo, unidade, agora],
          );
        const arroz = await insumo('ARROZ');
        const frango = await insumo('FRANGO');
        const oleo = await insumo('OLEO');
        const ui = await e.inserir(
          `INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, setor_funcional_id, codigo,
             descricao, tipo, criado_em) VALUES (?, 1, 1, ?, 'ENFERMARIA SINTETICA', 'enfermaria', ?)`,
          [est, `${P}-UI`, agora],
        );
        const pacientes: number[] = [];
        const atendimentos: number[] = [];
        for (let k = 1; k <= 12; k++) {
          const pf = await e.inserir(
            "INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, '1970-01-01', ?)",
            [`SINTETICO ${P} PACIENTE ${k}`, agora],
          );
          const pac = await e.inserir(
            "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
            [pf, 920_980_000 + k, agora],
          );
          pacientes.push(pac);
          atendimentos.push(
            await e.inserir(
              `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
                 carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
               VALUES (?, ?, ?, 1, 1, 1, 1, NOW(3) - INTERVAL 2 DAY, ?)`,
              [est, `${P}-A${k}`, pac, agora],
            ),
          );
        }
        const pac = pacientes[0]!;
        const atendimento = atendimentos[0]!;
        const internacao = await e.inserir(
          `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
             carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, leito_hospitalar_id, acomodacao_id,
             especialidade_medica_id, medico_assistente_profissional_id, fonte_pagadora_id, situacao, criado_em)
           VALUES (?, ?, ?, ?, NOW(3) - INTERVAL 2 DAY, 1, 1, ?, 1, 1, 1, 1, 1, 'ativa', ?)`,
          [est, `${P}-I1`, atendimento, pac, ui, agora],
        );
        const mapa = await e.inserir(
          `INSERT INTO mapa_dieta (estabelecimento_id, data_referencia, refeicao_do_dia_id, setor_funcional_id,
             unidade_internacao_id, horario_corte, situacao, fechado_em, fechado_por_usuario_id, criado_em)
           VALUES (?, ?, ?, 1, ?, ?, 'fechado', ?, ?, ?)`,
          [est, HOJE, refeicao, ui, agora, agora, nutri, agora],
        );
        // 10 bandejas sem jejum (uma com 2 acompanhantes), 1 em jejum e 1 cancelada: 10 pacientes no mapa.
        for (let k = 1; k <= 12; k++)
          await e.inserir(
            `INSERT INTO mapa_dieta_item (mapa_dieta_id, sequencia, atendimento_id, paciente_id, modalidade_dieta_id,
               jejum, quantidade_acompanhantes, situacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              mapa,
              k,
              atendimentos[k - 1],
              pacientes[k - 1],
              modalidade,
              k === 11,
              k === 1 ? 2 : 0,
              k === 12 ? 'cancelado' : 'previsto',
              agora,
            ],
          );
        return {
          est,
          nutri,
          outro,
          profissional,
          refeicao,
          altA,
          altB,
          altC,
          unidade,
          arroz,
          frango,
          oleo,
          internacao,
          atendimento,
        };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    porta = new PortaCardapioPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  let prato = 0;
  let guarnicao = 0;
  let plano = 0;

  it('grava a preparação com a ficha calculada e sincroniza sem apagar', async () => {
    const r = await porta.salvarPreparacao(ctx(), {
      codigo: `${P}-FRANGO`,
      nome: 'Frango grelhado sintético',
      tipo: 'prato_principal',
      rendimentoPorcoes: 1,
      ficha: [
        { insumo: m.frango, unidade: m.unidade, perCapitaBruto: 0.15, fatorCorrecao: 1.5, custoUnidade: 30 },
        { insumo: m.oleo, unidade: m.unidade, perCapitaBruto: 0.01 },
      ],
    });
    prato = r.id;
    expect(r.custoPorcao).toBe(4.5);
    expect(r.mensagem).toMatch(/1 gênero/);
    const linhas = await ler(
      `SELECT insumo_id, sequencia, per_capita_bruto, fator_correcao, per_capita_liquido, custo_per_capita, excluido_em
         FROM ficha_tecnica_preparacao WHERE preparacao_culinaria_id = ? ORDER BY sequencia`,
      [prato],
    );
    expect(linhas.map((x) => [x['insumo_id'], x['sequencia'], Number(x['per_capita_liquido'])])).toEqual([
      [m.frango, 1, 0.1],
      [m.oleo, 2, 0.01],
    ]);
    expect(Number(linhas[0]!['custo_per_capita'])).toBe(4.5);

    // Tira o óleo: a linha fica, marcada excluída.
    const lida = await porta.preparacao(ctx(), prato);
    await porta.salvarPreparacao(ctx(), {
      id: prato,
      versao: lida.versao,
      codigo: `${P}-FRANGO`,
      nome: 'Frango grelhado sintético',
      tipo: 'prato_principal',
      ficha: [
        { insumo: m.frango, unidade: m.unidade, perCapitaBruto: 0.15, fatorCorrecao: 1.5, custoUnidade: 30 },
      ],
    });
    const depois = await ler(
      'SELECT insumo_id, excluido_em, excluido_por FROM ficha_tecnica_preparacao WHERE preparacao_culinaria_id = ?',
      [prato],
    );
    expect(depois).toHaveLength(2);
    expect(depois.find((x) => x['insumo_id'] === m.oleo)).toMatchObject({ excluido_por: m.nutri });
    expect((await porta.preparacao(ctx(), prato)).ficha).toHaveLength(1);

    // O óleo volta: reativado, sem linha nova.
    const v2 = (await porta.preparacao(ctx(), prato)).versao;
    await porta.salvarPreparacao(ctx(), {
      id: prato,
      versao: v2,
      codigo: `${P}-FRANGO`,
      nome: 'Frango grelhado sintético',
      tipo: 'prato_principal',
      ficha: [
        { insumo: m.frango, unidade: m.unidade, perCapitaBruto: 0.15, fatorCorrecao: 1.5, custoUnidade: 30 },
        { insumo: m.oleo, unidade: m.unidade, perCapitaBruto: 0.01, custoUnidade: 10 },
      ],
    });
    const volta = await ler(
      'SELECT COUNT(*) AS n, SUM(excluido_em IS NULL) AS ativas FROM ficha_tecnica_preparacao WHERE preparacao_culinaria_id = ?',
      [prato],
    );
    expect(volta[0]).toMatchObject({ n: 2 });
    expect(Number(volta[0]!['ativas'])).toBe(2);

    const g = await porta.salvarPreparacao(ctx(), {
      codigo: `${P}-ARROZ`,
      nome: 'Arroz branco sintético',
      tipo: 'guarnicao',
      ficha: [{ insumo: m.arroz, unidade: m.unidade, perCapitaBruto: 0.08, custoUnidade: 6.5 }],
    });
    guarnicao = g.id;

    await expect(
      porta.salvarPreparacao(ctx(), {
        codigo: `${P}-ARROZ`,
        nome: 'Outro arroz',
        tipo: 'guarnicao',
        ficha: [{ insumo: m.arroz, unidade: m.unidade, perCapitaBruto: 0.08 }],
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.salvarPreparacao(ctx(), {
        codigo: `${P}-RUIM`,
        nome: 'Ficha inválida',
        tipo: 'outro',
        ficha: [{ insumo: m.arroz, unidade: m.unidade, perCapitaBruto: 0.08, fatorCorrecao: 0.5 }],
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await ler('SELECT id FROM preparacao_culinaria WHERE codigo = ?', [`${P}-RUIM`])).toHaveLength(0);
  });

  it('planeja em rascunho, envia, recusa aprovação de quem não é nutricionista, aprova e publica', async () => {
    const r = await porta.salvarPlanejamento(ctx(m.outro), {
      descricao: 'Almoço da semana sintética',
      periodoInicio: HOJE,
      periodoFim: AMANHA,
      refeicao: m.refeicao,
      itens: [
        { data: HOJE, alternativa: null, preparacao: guarnicao, porcoes: 40 },
        { data: HOJE, alternativa: m.altA, preparacao: prato, porcoes: 20 },
        { data: HOJE, alternativa: m.altB, preparacao: prato, porcoes: 8 },
        { data: AMANHA, alternativa: m.altA, preparacao: prato, porcoes: 20 },
      ],
    });
    plano = r.id;
    const [cab] = await ler(
      'SELECT situacao, elaborado_por_usuario_id, aprovado_por_profissional_id, versao FROM planejamento_cardapio WHERE id = ?',
      [plano],
    );
    expect(cab).toMatchObject({
      situacao: 'rascunho',
      elaborado_por_usuario_id: m.outro,
      aprovado_por_profissional_id: null,
    });
    expect(
      await ler(
        'SELECT sequencia FROM planejamento_cardapio_preparacao WHERE planejamento_cardapio_id = ? AND excluido_em IS NULL',
        [plano],
      ),
    ).toHaveLength(4);

    // Edita o rascunho: tira o dia de amanhã (fica excluído, não apagado).
    const lido = await porta.planejamento(ctx(), plano);
    await porta.salvarPlanejamento(ctx(m.outro), {
      id: plano,
      versao: lido.versao,
      descricao: 'Almoço da semana sintética',
      periodoInicio: HOJE,
      periodoFim: AMANHA,
      refeicao: m.refeicao,
      itens: lido.itens
        .filter((i) => i.data === HOJE)
        .map((i) => ({
          data: i.data,
          alternativa: i.alternativa,
          preparacao: i.preparacao,
          porcoes: i.porcoes,
        })),
    });
    const itens = await ler(
      'SELECT data_cardapio, excluido_em FROM planejamento_cardapio_preparacao WHERE planejamento_cardapio_id = ?',
      [plano],
    );
    expect(itens).toHaveLength(4);
    expect(itens.filter((x) => x['excluido_em'] !== null)).toHaveLength(1);

    let v = (await porta.planejamento(ctx(), plano)).versao;
    expect((await porta.agir(ctx(m.outro), plano, { acao: 'enviar', versao: v })).situacao).toBe(
      'em_aprovacao',
    );
    v += 1;
    await expect(porta.agir(ctx(m.outro), plano, { acao: 'aprovar', versao: v })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    expect((await porta.agir(ctx(), plano, { acao: 'aprovar', versao: v })).situacao).toBe('aprovado');
    const [ap] = await ler(
      'SELECT situacao, aprovado_por_profissional_id, aprovado_em FROM planejamento_cardapio WHERE id = ?',
      [plano],
    );
    expect(ap).toMatchObject({ situacao: 'aprovado', aprovado_por_profissional_id: m.profissional });
    expect(ap!['aprovado_em']).not.toBeNull();
    v += 1;
    await expect(
      porta.salvarPlanejamento(ctx(), {
        id: plano,
        versao: v,
        descricao: 'Mudança depois da aprovação',
        periodoInicio: HOJE,
        periodoFim: AMANHA,
        refeicao: m.refeicao,
        itens: [],
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect((await porta.agir(ctx(m.outro), plano, { acao: 'publicar', versao: v })).situacao).toBe(
      'publicado',
    );
    expect((await porta.planejamento(ctx(), plano)).aprovador).toBe(`SINTETICO ${P} NUTRICIONISTA`);
  });

  it('registra a escolha do paciente, substitui a anterior, recusa opção fora do dia e cancela', async () => {
    const dia = await porta.cardapioDoDia(ctx(), {
      data: HOJE,
      refeicao: m.refeicao,
      internacao: m.internacao,
    });
    expect(dia.opcoes.map((o) => o.alternativa)).toEqual([m.altA, m.altB]);

    const e1 = await porta.registrarEscolha(ctx(m.outro), {
      internacao: m.internacao,
      data: HOJE,
      refeicao: m.refeicao,
      alternativa: m.altA,
    });
    expect(e1.substituida).toBeNull();
    const e2 = await porta.registrarEscolha(ctx(m.outro), {
      internacao: m.internacao,
      data: HOJE,
      refeicao: m.refeicao,
      alternativa: m.altB,
      quantidade: 2,
    });
    expect(e2.substituida).toBe(e1.id);
    const linhas = await ler(
      `SELECT id, situacao, atendimento_id, comensal, planejamento_cardapio_id, registrador_usuario_id, quantidade
         FROM escolha_cardapio_paciente WHERE estabelecimento_id = ? ORDER BY id`,
      [m.est],
    );
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ situacao: 'cancelada' });
    expect(linhas[1]).toMatchObject({
      situacao: 'escolhida',
      atendimento_id: m.atendimento,
      comensal: 'paciente',
      planejamento_cardapio_id: plano,
      registrador_usuario_id: m.outro,
      quantidade: 2,
    });
    await expect(
      porta.registrarEscolha(ctx(m.outro), {
        internacao: m.internacao,
        data: HOJE,
        refeicao: m.refeicao,
        alternativa: m.altC,
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(
      await ler('SELECT id FROM escolha_cardapio_paciente WHERE estabelecimento_id = ?', [m.est]),
    ).toHaveLength(2);
  });

  it('prevê a produção do dia pela escolha, pelo mapa com margem e pelo planejado, com os gêneros e o custo', async () => {
    const p = await porta.producao(ctx(), plano, HOJE, 10);
    expect(p.comensaisMapa).toBe(10);
    const por = new Map(p.preparacoes.map((x) => [`${x.preparacao}|${x.alternativa}`, x]));
    // Guarnição sem opção: 10 do mapa + 10% = 11. Opção B: 2 escolhidas. Opção A: sem escolha ativa, 20 planejadas.
    expect(por.get(`${guarnicao}|null`)).toMatchObject({ porcoes: 11, base: 'mapa' });
    expect(por.get(`${prato}|${m.altB}`)).toMatchObject({ porcoes: 2, base: 'escolha' });
    expect(por.get(`${prato}|${m.altA}`)).toMatchObject({ porcoes: 20, base: 'planejado' });
    const gen = new Map(p.generos.map((g) => [g.insumo, g]));
    expect(gen.get(m.arroz)).toMatchObject({ quantidade: 0.88, custo: 5.72 });
    expect(gen.get(m.frango)).toMatchObject({ quantidade: 3.3, custo: 99 });
    expect(gen.get(m.oleo)).toMatchObject({ quantidade: 0.22, custo: 2.2 });
    expect(p.custoTotal).toBe(106.92);
  });

  it('cancela a escolha e o planejamento com o motivo, sem apagar, e deixa a trilha', async () => {
    const dia = await porta.cardapioDoDia(ctx(), {
      data: HOJE,
      refeicao: m.refeicao,
      internacao: m.internacao,
    });
    const ativa = (dia.escolhas as { id: number; situacao: string; versao: number }[]).find(
      (x) => x.situacao === 'escolhida',
    )!;
    await porta.cancelarEscolha(ctx(m.outro), ativa.id, ativa.versao);
    expect(
      await ler(
        "SELECT id FROM escolha_cardapio_paciente WHERE estabelecimento_id = ? AND situacao = 'cancelada'",
        [m.est],
      ),
    ).toHaveLength(2);

    const v = (await porta.planejamento(ctx(), plano)).versao;
    await expect(porta.agir(ctx(), plano, { acao: 'cancelar', versao: v, motivo: '' })).rejects.toMatchObject(
      {
        problema: { status: 422 },
      },
    );
    await porta.agir(ctx(), plano, { acao: 'cancelar', versao: v, motivo: 'Troca de fornecedor' });
    const [cab] = await ler(
      'SELECT situacao, observacao, excluido_em FROM planejamento_cardapio WHERE id = ?',
      [plano],
    );
    expect(cab).toMatchObject({ situacao: 'cancelado', excluido_em: null });
    expect(String(cab!['observacao'])).toContain('Troca de fornecedor');

    const [t] = await ler(
      'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id IN (?, ?)',
      [m.est, m.nutri, m.outro],
    );
    expect(Number(t!['n'])).toBeGreaterThanOrEqual(10);
  });
});
