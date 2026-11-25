// Contrato de efeito do chamado de ambulância com cobrança e do maqueiro (C2-068, 04-INT linha 83) contra o MariaDB
// real (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, categorias de ambulância (tipo B e
// tipo A), ambulância com hodômetro, trajeto, destino externo, motivo, item faturável com preço por quilômetro, regra de
// cobrança, atendimento com a conta aberta, habilitações de transporte e um pedido de transporte interno; usuário,
// paciente, fonte pagadora, grupo de faturamento e profissionais são ids já existentes do cliente (só lidos).
// Prova o que fica em `chamado_ambulancia`, `chamado_ambulancia_equipe`, `ambulancia`, `conta_hospitalar_item` e
// `solicitacao_transporte_paciente`: o pedido numerado ligado ao pedido de transporte, a equipe mínima da categoria, o
// hodômetro, a remoção lançada na conta pelos quilômetros rodados na mesma transação (uma vez só), a cobrança pendente
// sem regra e lançada depois, a reprovação com motivo, o maqueiro habilitado, e as recusas sem gravar nada.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaChamadoAmbulanciaPropria } from './chamado-ambulancia-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2068amb';

type Massa = Record<string, number>;

async function limpar(e: Escritor): Promise<void> {
  // O estabelecimento do teste e o segundo (código com o sufixo X), da habilitação de outra unidade.
  const est = "(SELECT id FROM estabelecimento WHERE codigo LIKE CONCAT(?, '%'))";
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(
      `DELETE q FROM chamado_ambulancia_equipe q JOIN chamado_ambulancia c ON c.id = q.chamado_ambulancia_id
        WHERE c.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM chamado_ambulancia WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM solicitacao_transporte_paciente WHERE estabelecimento_id IN ${est}`, [P]);
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
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM regra_cobranca_ambulancia WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM profissional_transporte WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM ambulancia WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM rota_ambulancia WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM sequencia_negocio WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE v FROM preco_procedimento_valor v JOIN preco_procedimento p ON p.id = v.preco_procedimento_id
         JOIN tabela_preco t ON t.id = p.tabela_preco_id WHERE t.codigo = ?`,
      [`${P}TP`],
    );
    await e.executar(
      'DELETE p FROM preco_procedimento p JOIN tabela_preco t ON t.id = p.tabela_preco_id WHERE t.codigo = ?',
      [`${P}TP`],
    );
    await e.executar('DELETE FROM tabela_preco WHERE codigo = ?', [`${P}TP`]);
    await e.executar('DELETE FROM item_faturavel WHERE codigo LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM categoria_ambulancia WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM motivo_cancelamento_transporte WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM estabelecimento_externo WHERE nome LIKE ?', [`${P} %`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P, `${P}X`] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, `${P}X`]);
}

const recusa = { problema: { codigo: 'regra-violada' } };

describe.skipIf(SEM_BANCO)('PortaChamadoAmbulanciaPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaChamadoAmbulanciaPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m['usuario']!, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const chamado = async (id: number) =>
    (await ler('SELECT * FROM chamado_ambulancia WHERE id = ?', [id]))[0]!;
  const contar = async (tabela: 'chamado_ambulancia' | 'conta_hospitalar_item') =>
    Number(
      (
        await ler(
          tabela === 'chamado_ambulancia'
            ? 'SELECT COUNT(*) AS n FROM chamado_ambulancia WHERE estabelecimento_id = ?'
            : `SELECT COUNT(*) AS n FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id
                WHERE c.estabelecimento_id = ?`,
          [m['est']],
        )
      )[0]!['n'],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const um = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const paciente = await um('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      const fonte = await um('SELECT MIN(id) AS id FROM fonte_pagadora');
      const grupo = await um('SELECT MIN(id) AS id FROM grupo_faturamento');
      const profs = (
        await e.consultar('SELECT id FROM profissional WHERE excluido_em IS NULL ORDER BY id LIMIT 3')
      ).map((x) => Number(x['id']));
      if (!usuario || !paciente || !fonte || !grupo || profs.length < 3)
        throw new Error(
          'O cliente de teste precisa de usuário, paciente, fonte, grupo de faturamento e 3 profissionais.',
        );
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const categoria = (cod: string, cls: string) =>
        e.inserir(
          'INSERT INTO categoria_ambulancia (codigo, descricao, classificacao_nacional, criado_em) VALUES (?, ?, ?, ?)',
          [`${P}-${cod}`, `Categoria sintética ${cod}`, cls, agora],
        );
      const catB = await categoria('B', 'B');
      const catA = await categoria('A', 'A');
      const motivo = await e.inserir(
        'INSERT INTO motivo_cancelamento_transporte (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-DES`, 'Motivo sintético', agora],
      );
      const externo = await e.inserir('INSERT INTO estabelecimento_externo (nome, criado_em) VALUES (?, ?)', [
        `${P} Hospital de destino fictício`,
        agora,
      ]);
      const itemKm = await e.inserir(
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'servico', ?, ?)",
        [`${P}KM`, 'ITEM SINTETICO KM', grupo, agora],
      );
      const tabela = await e.inserir(
        `INSERT INTO tabela_preco (codigo, descricao, tipo_item, referencia, situacao, fonte_pagadora_id, criado_em)
         VALUES (?, ?, 'servico_hospitalar', 'propria', 'ativa', ?, ?)`,
        [`${P}TP`, `TABELA SINTETICA ${P}`, fonte, agora],
      );
      const pp = await e.inserir(
        'INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, criado_em) VALUES (?, 1, ?, ?)',
        [tabela, itemKm, agora],
      );
      await e.inserir(
        `INSERT INTO preco_procedimento_valor (preco_procedimento_id, operacao, ocorrido_em, vigencia_inicio,
           valor_honorario, valor_custo_operacional, valor_filme, valor_total, criado_em)
         VALUES (?, 'inclusao', ?, '2020-01-01', 0, 5, 0, 5, ?)`,
        [pp, agora, agora],
      );
      await e.inserir(
        `INSERT INTO regra_cobranca_ambulancia (estabelecimento_id, fonte_pagadora_id, categoria_ambulancia_id,
           forma_cobranca, item_faturavel_id, criado_em) VALUES (?, NULL, ?, 'quilometro', ?, ?)`,
        [est, catB, itemKm, agora],
      );
      const rota = await e.inserir(
        `INSERT INTO rota_ambulancia (estabelecimento_id, codigo, descricao, local_partida, local_destino, distancia_km,
           criado_em) VALUES (?, ?, 'TRAJETO SINTETICO', 'PARTIDA SINTETICA', 'DESTINO SINTETICO', 20, ?)`,
        [est, `${P}R`, agora],
      );
      const hab = (prof: number, funcao: string, tipo: string) =>
        e.inserir(
          `INSERT INTO profissional_transporte (estabelecimento_id, profissional_id, funcao_transporte, tipo_transporte,
             criado_em) VALUES (?, ?, ?, ?, ?)`,
          [est, prof, funcao, tipo, agora],
        );
      await hab(profs[0]!, 'motorista', 'ambulancia');
      await hab(profs[1]!, 'maqueiro', 'interno');
      await hab(profs[2]!, 'tecnico_enfermagem', 'ambos');
      // Outra unidade: o maqueiro daqui é médico habilitado lá (não vale neste estabelecimento).
      const outra = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [`${P}X`, `Hospital sintético ${P}X`, `Hospital sintético ${P}X (fictício)`, agora],
      );
      await e.inserir(
        `INSERT INTO profissional_transporte (estabelecimento_id, profissional_id, funcao_transporte, tipo_transporte,
           criado_em) VALUES (?, ?, 'medico', 'ambos', ?)`,
        [outra, profs[1]!, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const ambB = await e.inserir(
          `INSERT INTO ambulancia (estabelecimento_id, categoria_ambulancia_id, placa, quilometragem_atual, criado_em)
           VALUES (?, ?, 'SNT0B00', 1000, ?)`,
          [est, catB, agora],
        );
        const ambA = await e.inserir(
          `INSERT INTO ambulancia (estabelecimento_id, categoria_ambulancia_id, placa, quilometragem_atual, criado_em)
           VALUES (?, ?, 'SNT0A00', 500, ?)`,
          [est, catA, agora],
        );
        const atd = await e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
           VALUES (?, ?, ?, 1, 1, ?, 1, NOW(3) - INTERVAL 2 DAY, ?)`,
          [est, `${P}-1`, paciente, fonte, agora],
        );
        const conta = await e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             contrato_fonte_pagadora_id, tipo_conta_id, tabela_preco_id, natureza, competencia, inicio_em, valor_itens,
             valor_total, criado_em)
           VALUES (?, ?, ?, ?, ?, 1, 1, ?, 'internacao', '2026-11-01', NOW(3) - INTERVAL 2 DAY, 0, 0, ?)`,
          [est, `${P}-C1`, atd, paciente, fonte, tabela, agora],
        );
        const transporte = await e.inserir(
          `INSERT INTO solicitacao_transporte_paciente (estabelecimento_id, paciente_id, atendimento_id, tipo,
             destino_descricao, solicitante_usuario_id, solicitado_em, situacao, criado_em)
           VALUES (?, ?, ?, 'interno', 'Setor sintético', ?, ?, 'solicitado', ?)`,
          [est, paciente, atd, usuario, agora, agora],
        );
        const externoT = await e.inserir(
          `INSERT INTO solicitacao_transporte_paciente (estabelecimento_id, paciente_id, atendimento_id, tipo,
             destino_estabelecimento_externo_id, solicitante_usuario_id, solicitado_em, situacao, criado_em)
           VALUES (?, ?, ?, 'transferencia_externa', ?, ?, ?, 'solicitado', ?)`,
          [est, paciente, atd, externo, usuario, agora, agora],
        );
        return {
          est,
          usuario,
          paciente,
          catB,
          catA,
          motivo,
          externo,
          rota,
          itemKm,
          ambB,
          ambA,
          atd,
          conta,
          transporte,
          externoT,
          prof0: profs[0]!,
          prof1: profs[1]!,
          prof2: profs[2]!,
        };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    porta = new PortaChamadoAmbulanciaPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('pede, aprova com a equipe, sai, conclui e lança a remoção na conta pelos quilômetros rodados', async () => {
    const op = await porta.opcoes(ctx());
    expect(op.ambulancias.map((a) => a.id).sort()).toEqual([m['ambB'], m['ambA']].sort());
    expect(op.profissionais.find((p) => p.id === m['prof1'])).toMatchObject({ funcao: 'maqueiro' });

    const s = await porta.solicitar(ctx(), {
      atendimento: m['atd'],
      transporte: m['externoT'],
      tipo: 'remocao_inter_hospitalar',
      categoria: m['catB'],
      destinoExterno: m['externo'],
      posicao: 'maca',
    });
    expect(s.numero).toBe('AMB-1');
    let c = await chamado(s.id);
    expect(c).toMatchObject({
      paciente_id: m['paciente'],
      atendimento_id: m['atd'],
      categoria_ambulancia_id: m['catB'],
      destino_estabelecimento_externo_id: m['externo'],
      situacao: 'solicitado',
    });
    const [ped] = await ler(
      'SELECT chamado_ambulancia_id FROM solicitacao_transporte_paciente WHERE id = ?',
      [m['externoT']],
    );
    expect(Number(ped!['chamado_ambulancia_id'])).toBe(s.id);

    // Recusas sem gravar: outro chamado aberto no atendimento; equipe sem o técnico (tipo B); veículo de outra categoria.
    const antes = await contar('chamado_ambulancia');
    await expect(
      porta.solicitar(ctx(), {
        atendimento: m['atd'],
        tipo: 'alta_domicilio',
        categoria: m['catB'],
        destinoLogradouro: 'Rua sintética',
      }),
    ).rejects.toMatchObject(recusa);
    expect(await contar('chamado_ambulancia')).toBe(antes);
    const condutor = { profissional: m['prof0'], funcao: 'condutor' };
    await expect(
      porta.aprovar(ctx(), s.id, { ambulancia: m['ambB'], equipe: [condutor], versao: Number(c['versao']) }),
    ).rejects.toMatchObject(recusa);
    await expect(
      porta.aprovar(ctx(), s.id, {
        ambulancia: m['ambA'],
        equipe: [condutor, { profissional: m['prof2'], funcao: 'tecnico_enfermagem' }],
        versao: Number(c['versao']),
      }),
    ).rejects.toMatchObject(recusa);
    expect((await chamado(s.id))['situacao']).toBe('solicitado');
    // Habilitação: o maqueiro daqui (médico só na outra unidade) declarado como médico, ou como enfermeiro sem
    // habilitação nenhuma, não completa a equipe; nada é gravado.
    const equipeAntes = Number(
      (
        await ler('SELECT COUNT(*) AS n FROM chamado_ambulancia_equipe WHERE chamado_ambulancia_id = ?', [
          s.id,
        ])
      )[0]!['n'],
    );
    for (const funcao of ['medico', 'enfermeiro'])
      await expect(
        porta.aprovar(ctx(), s.id, {
          ambulancia: m['ambB'],
          equipe: [
            condutor,
            { profissional: m['prof2'], funcao: 'tecnico_enfermagem' },
            { profissional: m['prof1'], funcao },
          ],
          versao: Number(c['versao']),
        }),
      ).rejects.toMatchObject({
        problema: {
          codigo: 'regra-violada',
          detail: expect.stringMatching(/^Um profissional da equipe não está habilitado/),
        },
      });
    expect((await chamado(s.id))['situacao']).toBe('solicitado');
    expect(
      Number(
        (
          await ler('SELECT COUNT(*) AS n FROM chamado_ambulancia_equipe WHERE chamado_ambulancia_id = ?', [
            s.id,
          ])
        )[0]!['n'],
      ),
    ).toBe(equipeAntes);

    await porta.aprovar(ctx(), s.id, {
      ambulancia: m['ambB'],
      equipe: [condutor, { profissional: m['prof2'], funcao: 'tecnico_enfermagem' }],
      versao: Number(c['versao']),
    });
    c = await chamado(s.id);
    expect(c).toMatchObject({
      situacao: 'aprovado',
      ambulancia_id: m['ambB'],
      aprovado_por_usuario_id: m['usuario'],
    });
    const eq = await ler(
      'SELECT funcao FROM chamado_ambulancia_equipe WHERE chamado_ambulancia_id = ? ORDER BY sequencia',
      [s.id],
    );
    expect(eq.map((x) => x['funcao'])).toEqual(['condutor', 'tecnico_enfermagem']);

    // Hodômetro menor que o do veículo: recusa.
    await expect(
      porta.sair(ctx(), s.id, { kmInicial: 900, versao: Number(c['versao']) }),
    ).rejects.toMatchObject(recusa);
    await porta.sair(ctx(), s.id, { kmInicial: 1000, versao: Number(c['versao']) });
    c = await chamado(s.id);
    expect(c).toMatchObject({ situacao: 'em_transito', quilometragem_inicial: 1000 });
    expect(c['saida_em']).not.toBeNull();
    await expect(
      porta.cancelar(ctx(), s.id, { motivo: m['motivo'], versao: Number(c['versao']) }),
    ).rejects.toMatchObject(recusa);

    const itensAntes = await contar('conta_hospitalar_item');
    const fim = await porta.concluir(ctx(), s.id, { kmFinal: 1042, versao: Number(c['versao']) });
    expect(fim).toMatchObject({ situacao: 'concluido', cobranca: { situacao: 'lancada', quantidade: 42 } });
    c = await chamado(s.id);
    expect(c).toMatchObject({ situacao: 'concluido', quilometragem_final: 1042 });
    expect(Number(c['conta_hospitalar_item_id'])).toBeGreaterThan(0);
    const [item] = await ler(
      'SELECT conta_hospitalar_id, item_faturavel_id, quantidade, valor_unitario, valor_total FROM conta_hospitalar_item WHERE id = ?',
      [c['conta_hospitalar_item_id']],
    );
    expect(item).toMatchObject({ conta_hospitalar_id: m['conta'], item_faturavel_id: m['itemKm'] });
    expect([
      Number(item!['quantidade']),
      Number(item!['valor_unitario']),
      Number(item!['valor_total']),
    ]).toEqual([42, 5, 210]);
    expect(await contar('conta_hospitalar_item')).toBe(itensAntes + 1);
    const [amb] = await ler('SELECT quilometragem_atual FROM ambulancia WHERE id = ?', [m['ambB']]);
    expect(Number(amb!['quilometragem_atual'])).toBe(1042);
    const [conta] = await ler('SELECT valor_itens FROM conta_hospitalar WHERE id = ?', [m['conta']]);
    expect(Number(conta!['valor_itens'])).toBe(210);

    // Nunca duas vezes.
    await expect(porta.cobrar(ctx(), s.id, { versao: Number(c['versao']) })).rejects.toMatchObject(recusa);
    expect(await contar('conta_hospitalar_item')).toBe(itensAntes + 1);
    const lista = await porta.listar(ctx(), { paciente: m['paciente'] });
    expect(lista.find((x) => x.id === s.id)).toMatchObject({ kmRodados: 42, situacao: 'concluido' });
    expect(lista.find((x) => x.id === s.id)?.equipe).toHaveLength(2);
  });

  it('conclui sem regra com a cobrança pendente, lança depois; reprova só com motivo', async () => {
    const s = await porta.solicitar(ctx(), {
      atendimento: m['atd'],
      tipo: 'exame_externo',
      categoria: m['catA'],
      rota: m['rota'],
    });
    let c = await chamado(s.id);
    await porta.aprovar(ctx(), s.id, {
      ambulancia: m['ambA'],
      equipe: [{ profissional: m['prof0'], funcao: 'condutor' }],
      versao: Number(c['versao']),
    });
    c = await chamado(s.id);
    await porta.sair(ctx(), s.id, { kmInicial: 500, versao: Number(c['versao']) });
    c = await chamado(s.id);
    const itensAntes = await contar('conta_hospitalar_item');
    const fim = await porta.concluir(ctx(), s.id, { kmFinal: 530, versao: Number(c['versao']) });
    expect(fim).toMatchObject({ situacao: 'concluido', cobranca: { situacao: 'pendente' } });
    c = await chamado(s.id);
    expect(c['conta_hospitalar_item_id']).toBeNull();
    expect(await contar('conta_hospitalar_item')).toBe(itensAntes);
    // Cobrar sem a regra: a recusa do faturamento chega como está, e nada entra na conta.
    await expect(porta.cobrar(ctx(), s.id, { versao: Number(c['versao']) })).rejects.toThrow(
      /Não há regra de cobrança/,
    );
    expect(await contar('conta_hospitalar_item')).toBe(itensAntes);

    await nucleo.escrever({ cliente: CLIENTE, correlacao: `regra-${P}` }, (e) =>
      e.inserir(
        `INSERT INTO regra_cobranca_ambulancia (estabelecimento_id, fonte_pagadora_id, categoria_ambulancia_id,
           forma_cobranca, item_faturavel_id, criado_em) VALUES (?, NULL, ?, 'quilometro', ?, NOW(3))`,
        [m['est'], m['catA'], m['itemKm']],
      ),
    );
    // Remoção concluída às 23h30 de Brasília (02h30 do dia seguinte em UTC): a conta recebe o dia local.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `fim-${P}` }, (e) =>
      e.executar('UPDATE chamado_ambulancia SET fim_trajeto_em = ? WHERE id = ?', [
        new Date('2026-11-20T23:30:00-03:00'),
        s.id,
      ]),
    );
    c = await chamado(s.id);
    const r = await porta.cobrar(ctx(), s.id, { versao: Number(c['versao']) });
    expect(r).toMatchObject({ cobranca: { situacao: 'lancada', quantidade: 30 } });
    const [lancado] = await ler('SELECT realizado_em FROM conta_hospitalar_item WHERE id = ?', [
      (r.cobranca as { itemId: number }).itemId,
    ]);
    const realizado = lancado!['realizado_em'];
    expect(
      realizado instanceof Date ? realizado.toISOString().slice(0, 10) : String(realizado).slice(0, 10),
    ).toBe('2026-11-20');
    expect(Number((await chamado(s.id))['conta_hospitalar_item_id'])).toBe(
      (r.cobranca as { itemId: number }).itemId,
    );

    const t = await porta.solicitar(ctx(), {
      atendimento: m['atd'],
      tipo: 'alta_domicilio',
      categoria: m['catA'],
      destinoLogradouro: 'Rua sintética',
      destinoCep: '01001000',
    });
    c = await chamado(t.id);
    await expect(porta.reprovar(ctx(), t.id, { versao: Number(c['versao']) })).rejects.toMatchObject(recusa);
    await porta.reprovar(ctx(), t.id, { motivo: 'Sem vaga no destino', versao: Number(c['versao']) });
    expect(await chamado(t.id)).toMatchObject({
      situacao: 'reprovado',
      motivo_reprovacao: 'Sem vaga no destino',
      reprovado_por_usuario_id: m['usuario'],
    });
  });

  it('designa o maqueiro habilitado no transporte interno e recusa quem não é maqueiro ou o pedido externo', async () => {
    const v = async (id: number) =>
      Number(
        (await ler('SELECT versao FROM solicitacao_transporte_paciente WHERE id = ?', [id]))[0]!['versao'],
      );
    await expect(
      porta.designarMaqueiro(ctx(), m['transporte']!, {
        maqueiro: m['prof0'],
        versao: await v(m['transporte']!),
      }),
    ).rejects.toMatchObject(recusa);
    await expect(
      porta.designarMaqueiro(ctx(), m['externoT']!, {
        maqueiro: m['prof1'],
        versao: await v(m['externoT']!),
      }),
    ).rejects.toMatchObject(recusa);
    await porta.designarMaqueiro(ctx(), m['transporte']!, {
      maqueiro: m['prof1'],
      versao: await v(m['transporte']!),
    });
    const [t] = await ler(
      'SELECT maqueiro_profissional_id FROM solicitacao_transporte_paciente WHERE id = ?',
      [m['transporte']],
    );
    expect(Number(t!['maqueiro_profissional_id'])).toBe(m['prof1']);
    const internos = await porta.internos(ctx());
    expect(internos.map((x) => x.id)).toEqual([m['transporte']]);
    expect(internos[0]).toMatchObject({ maqueiro: m['prof1'] });
  });
});
