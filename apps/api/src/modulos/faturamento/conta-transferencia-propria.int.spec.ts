// Contrato de efeito da transferência da conta inteira, por lote e do estorno (F3.7, 06-FAT linha 14) contra o MariaDB
// real. Massa SINTÉTICA com códigos "F749" (nenhuma pessoa real):
// - conta inteira para a nova fonte: nasce a conta no mesmo atendimento (atendimento_conta), na fonte e no plano novos;
//   os itens lançados vão (glosado fica), com o preço do destino; item sem preço lá é recusado sem o aceite, e com o
//   aceite vai com a justificativa na observação da transferência;
// - desde um dia: só a parte realizada a partir dele;
// - lote: duas contas do paciente de uma vez; uma recusada desfaz o lote inteiro (nada fica);
// - estorno: item de destino "estornado", origem de volta a "lancado", transferência "estornada" com autor e motivo;
//   estorno repetido recusado; nada é apagado;
// - painel: prévia da cobertura por item no destino e as transferências com a situação.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoTransferenciaConta } from './conta-transferencia.controller.js';
import { painelTransferenciaPropria } from './conta-transferencia-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F749';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
async function recusaDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) return JSON.stringify(e.problema);
    throw e;
  }
  throw new Error('esperava recusa');
}

describe.skipIf(SEM_BANCO)('transferência da conta inteira, por lote e estorno (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoTransferenciaConta;
  const ids: Record<string, number> = {};
  const op = () =>
    ({
      cliente: CLIENTE,
      estabelecimento: ids['est']!,
      usuario: ids['usuario']!,
      correlacao: 'teste-f749',
      chaveIdempotencia: `f749-${randomUUID()}`,
      reautenticadoEm: Date.now(),
    }) as ContextoOperacao & { chaveIdempotencia: string };
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f749' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));
  const situacoes = async (conta: number) =>
    (
      await linhas(
        'SELECT situacao FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? ORDER BY sequencia',
        [conta],
      )
    ).map((r) => String(r['situacao']));
  const gravar = (nome: 'conta' | 'lote' | 'estorno', corpo: unknown) => s.gravar(nome, op() as never, corpo);

  const limpar = async (e: Escritor) => {
    const contas = (
      await e.consultar<{ id: number }>('SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ?', [
        ids['est'],
      ])
    ).map((c) => Number(c.id));
    for (const id of contas) {
      await e.executar(
        'DELETE ti FROM transferencia_conta_item ti JOIN transferencia_conta t ON t.id = ti.transferencia_conta_id WHERE t.conta_origem_id = ? OR t.conta_destino_id = ?',
        [id, id],
      );
      await e.executar(
        'DELETE p FROM conta_hospitalar_item_participante p JOIN conta_hospitalar_item i ON i.id = p.conta_hospitalar_item_id WHERE i.conta_hospitalar_id = ?',
        [id],
      );
    }
    for (const id of contas)
      await e.executar('DELETE FROM transferencia_conta WHERE conta_origem_id = ? OR conta_destino_id = ?', [
        id,
        id,
      ]);
    for (const id of contas) {
      await e.executar(
        'DELETE m FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id WHERE i.conta_hospitalar_id = ?',
        [id],
      );
      await e.executar(
        'DELETE FROM producao_repasse WHERE conta_hospitalar_item_id IN (SELECT id FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?)',
        [id],
      );
      await e.executar('DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM atendimento_conta WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar WHERE id = ?', [id]);
    }
    await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids['est']]);
  };

  const novaConta = async (numero: string, itens: [number, string, string][]) =>
    escrever(async (e) => {
      const agora = new Date();
      const at = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', '2026-01-20 08:00:00', ?)`,
        [
          ids['est'],
          numero,
          ids['paciente'],
          ids['categoria'],
          ids['carater'],
          ids['fonteA'],
          ids['medico'],
          agora,
        ],
      );
      const c = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tabela_preco_id, tipo_conta_id, natureza, competencia, inicio_em, situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 08:00:00', 'aberta', ?)`,
        [ids['est'], `${numero}-1`, at, ids['paciente'], ids['fonteA'], ids['tabA'], ids['tipoConta'], agora],
      );
      await e.inserir(
        'INSERT INTO atendimento_conta (atendimento_id, conta_hospitalar_id, criado_em) VALUES (?, ?, ?)',
        [at, c, agora],
      );
      let sq = 0;
      for (const [item, dia, situacao] of itens)
        await e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, grupo_faturamento_id,
             realizado_em, quantidade, valor_unitario, valor_honorario, valor_custo_operacional, valor_total, situacao,
             motivo_glosa_id, criado_em)
           VALUES (?, ?, ?, ?, ?, 1, 100, 0, 100, 100, ?, ?, ?)`,
          [
            c,
            ++sq,
            item,
            ids['grupo'],
            `${dia} 10:00:00`,
            situacao,
            situacao === 'glosado' ? ids['motivoGlosa'] : null,
            agora,
          ],
        );
      return { conta: c, atendimento: at };
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever(async (e) => {
      const agora = new Date();
      const g = (tabela: string, codigo: string, ins: string, pi: unknown[]) =>
        garantir(e, `SELECT id FROM ${tabela} WHERE codigo = ?`, [codigo], ins, pi);
      ids['est'] = await g(
        'estabelecimento',
        P,
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids['usuario'] = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f749.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f749.teste', `USUARIO SINTETICO ${P}`, agora],
      );
      await limpar(e);
      await garantir(
        e,
        "SELECT id FROM sequencia_negocio WHERE tipo = 'transferencia_conta' AND estabelecimento_id = ?",
        [ids['est']],
        `INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, proximo_valor, incremento, valor_maximo, ativo,
           criado_em, versao) VALUES (?, 'transferencia_conta', NULL, 1, 1, 999999999, TRUE, ?, 1)`,
        [ids['est'], agora],
      );
      const fonte = (c: string) =>
        g(
          'fonte_pagadora',
          c,
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
          [c, `OPERADORA SINTETICA ${c}`, agora],
        );
      ids['fonteA'] = await fonte(`${P}FA`);
      ids['fonteB'] = await fonte(`${P}FB`);
      const pf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      ids['paciente'] = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pf],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pf, 874_901, agora],
      );
      const pfm = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`MEDICO SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`MEDICO SINTETICO ${P}`, agora],
      );
      ids['medico'] = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pfm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pfm, agora],
      );
      ids['categoria'] = await g(
        'categoria_atendimento',
        P,
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `CATEGORIA SINTETICA ${P}`, agora],
      );
      ids['carater'] = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['F7'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('F7', ?, 'teste', ?)",
        [`CARATER SINTETICO ${P}`, agora],
      );
      ids['tipoConta'] = await g(
        'tipo_conta',
        P,
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `TIPO DE CONTA SINTETICO ${P}`, agora],
      );
      ids['grupo'] = await g(
        'grupo_faturamento',
        P,
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
        [P, `GRUPO SINTETICO ${P}`, agora],
      );
      const item = (c: string) =>
        g(
          'item_faturavel',
          c,
          "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
          [c, `PROCEDIMENTO SINTETICO ${c}`, ids['grupo'], agora],
        );
      ids['coberto'] = await item('87490001');
      ids['semCobertura'] = await item('87490002');
      const tabela = async (c: string, fonteId: number, precos: [number, number][]) => {
        const t = await g(
          'tabela_preco',
          c,
          `INSERT INTO tabela_preco (codigo, descricao, tipo_item, referencia, situacao, fonte_pagadora_id, criado_em)
           VALUES (?, ?, 'servico_hospitalar', 'propria', 'ativa', ?, ?)`,
          [c, `TABELA SINTETICA ${c}`, fonteId, agora],
        );
        let sq = 0;
        for (const [it, total] of precos) {
          const pp = await garantir(
            e,
            'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
            [t, it],
            'INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, criado_em) VALUES (?, ?, ?, ?)',
            [t, ++sq, it, agora],
          );
          await garantir(
            e,
            'SELECT id FROM preco_procedimento_valor WHERE preco_procedimento_id = ?',
            [pp],
            `INSERT INTO preco_procedimento_valor (preco_procedimento_id, operacao, ocorrido_em, vigencia_inicio,
               valor_honorario, valor_custo_operacional, valor_filme, valor_total, criado_em)
             VALUES (?, 'inclusao', ?, '2020-01-01', 0, ?, 0, ?, ?)`,
            [pp, agora, total, total, agora],
          );
        }
        return t;
      };
      ids['tabA'] = await tabela(`${P}TA`, ids['fonteA']!, [
        [ids['coberto']!, 100],
        [ids['semCobertura']!, 100],
      ]);
      ids['tabB'] = await tabela(`${P}TB`, ids['fonteB']!, [[ids['coberto']!, 150]]);
      ids['plano'] = await garantir(
        e,
        "SELECT id FROM plano_fonte_pagadora WHERE codigo = 'F749PL'",
        [],
        "INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, codigo, descricao, tabela_preco_id, criado_em) VALUES (?, 'F749PL', ?, ?, ?)",
        [ids['fonteB'], `PLANO SINTETICO ${P}`, ids['tabB'], agora],
      );
      ids['motivoGlosa'] = await garantir(
        e,
        "SELECT id FROM motivo_glosa WHERE codigo_tuss = 'F749'",
        [],
        "INSERT INTO motivo_glosa (codigo_tuss, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES ('F749', ?, '2020-01-01', 'teste', ?)",
        [`MOTIVO SINTETICO ${P}`, agora],
      );
    });
    s = new ServicoTransferenciaConta(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids['est']!] });
    });
    await nucleo.encerrar();
  });

  it('conta inteira para a nova fonte: conta nova no atendimento, cobertura conferida, glosado fica; estorno desfaz', async () => {
    const { conta, atendimento } = await novaConta(`${P}-A`, [
      [ids['coberto']!, '2026-01-21', 'lancado'],
      [ids['semCobertura']!, '2026-01-21', 'lancado'],
      [ids['coberto']!, '2026-01-21', 'glosado'],
    ]);
    const destinoNovo = { fontePagadoraId: ids['fonteB'], planoId: ids['plano'] };

    // Prévia: o item sem preço na fonte B aparece sem cobertura, antes de gravar.
    const painel = await nucleo.lerSomente(
      { cliente: CLIENTE, estabelecimento: ids['est']!, correlacao: 'teste-f749' },
      (l) =>
        painelTransferenciaPropria(
          l,
          ids['est']!,
          conta,
          { usuario: ids['usuario']!, total: false },
          { fontePagadoraId: ids['fonteB']!, planoId: ids['plano']! },
        ),
    );
    expect(painel.transferiveis).toBe(2);
    expect(painel.previa.map((p) => [p.precoNoDestino, p.valorDestino])).toEqual([
      [true, 150],
      [false, null],
    ]);

    // Sem o aceite, recusa e nada fica (nem a conta nova).
    expect(
      await recusaDe(gravar('conta', { contaOrigemId: conta, destinoNovo, motivo: 'Troca de convênio' })),
    ).toContain('cobertura');
    expect(
      await linhas('SELECT COUNT(*) AS n FROM conta_hospitalar WHERE atendimento_id = ?', [atendimento]),
    ).toEqual([{ n: 1 }]);

    // A mesma fonte e o mesmo plano não é destino.
    expect(
      await recusaDe(
        gravar('conta', {
          contaOrigemId: conta,
          destinoNovo: { fontePagadoraId: ids['fonteA'], planoId: null },
          motivo: 'Troca de convênio',
        }),
      ),
    ).toContain('fontePagadoraId');

    const r = await gravar('conta', {
      contaOrigemId: conta,
      destinoNovo,
      motivo: 'Troca de convênio',
      aceitarSemCobertura: true,
      justificativaCobertura: 'Cobrado por pacote do plano',
    });
    expect(r).toMatchObject({
      itens: 2,
      contaAberta: true,
      semCobertura: 1,
      valorOrigem: 200,
      valorDestino: 250,
    });
    const nova = Number(r['contaDestinoId']);
    const [c] = await linhas(
      `SELECT c.atendimento_id, c.fonte_pagadora_id, c.plano_fonte_pagadora_id, c.situacao, c.numero, c.valor_total,
              (SELECT COUNT(*) FROM atendimento_conta ac WHERE ac.conta_hospitalar_id = c.id) AS vinculo
         FROM conta_hospitalar c WHERE c.id = ?`,
      [nova],
    );
    expect(c).toMatchObject({
      atendimento_id: atendimento,
      fonte_pagadora_id: ids['fonteB'],
      plano_fonte_pagadora_id: ids['plano'],
      situacao: 'aberta',
      numero: `${P}-A-2`,
      vinculo: 1,
    });
    expect(Number(c!['valor_total'])).toBe(250);
    expect(await situacoes(conta)).toEqual(['transferido', 'transferido', 'glosado']);
    expect(await situacoes(nova)).toEqual(['lancado', 'lancado']);
    const [t] = await linhas('SELECT id, situacao, tipo, observacao FROM transferencia_conta WHERE id = ?', [
      Number(r['id']),
    ]);
    expect(t).toMatchObject({ situacao: 'efetivada', tipo: 'fonte_pagadora' });
    expect(String(t!['observacao'])).toContain('Cobrado por pacote do plano');

    // Estorno: sem motivo, recusa; com motivo, desfaz sem apagar.
    expect(await recusaDe(gravar('estorno', { transferenciaId: Number(r['id']), motivo: '' }))).toContain(
      'motivo',
    );
    await gravar('estorno', { transferenciaId: Number(r['id']), motivo: 'Convênio informado errado' });
    expect(await situacoes(conta)).toEqual(['lancado', 'lancado', 'glosado']);
    expect(await situacoes(nova)).toEqual(['estornado', 'estornado']);
    const [te] = await linhas(
      'SELECT situacao, estorno_usuario_id, motivo_estorno, estornado_em IS NOT NULL AS em FROM transferencia_conta WHERE id = ?',
      [Number(r['id'])],
    );
    expect(te).toMatchObject({
      situacao: 'estornada',
      estorno_usuario_id: ids['usuario'],
      motivo_estorno: 'Convênio informado errado',
      em: 1,
    });
    const totais = await linhas(
      'SELECT id, valor_total FROM conta_hospitalar WHERE id IN (?, ?) ORDER BY id',
      [conta, nova],
    );
    // O total da conta soma o glosado (a glosa fica em valor_glosado): 2 itens de volta + o glosado; o destino zera.
    expect(totais.map((x) => Number(x['valor_total']))).toEqual([300, 0]);
    expect(
      await linhas(
        "SELECT COUNT(*) AS n FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id WHERE i.conta_hospitalar_id IN (?, ?) AND m.dados LIKE '%estorno_transferencia%'",
        [conta, nova],
      ),
    ).toEqual([{ n: 4 }]);
    // Estornada de novo: recusa.
    expect(
      await recusaDe(
        gravar('estorno', { transferenciaId: Number(r['id']), motivo: 'Convênio informado errado' }),
      ),
    ).toContain('transferencia');
  });

  it('desde o dia da troca: só a parte realizada a partir dele vai para a conta nova', async () => {
    const { conta } = await novaConta(`${P}-D`, [
      [ids['coberto']!, '2026-01-21', 'lancado'],
      [ids['coberto']!, '2026-01-25', 'lancado'],
    ]);
    const r = await gravar('conta', {
      contaOrigemId: conta,
      destinoNovo: { fontePagadoraId: ids['fonteB'], planoId: ids['plano'] },
      desde: '2026-01-24',
      motivo: 'Troca de convênio na internação',
    });
    expect(r).toMatchObject({ itens: 1, semCobertura: 0 });
    expect(await situacoes(conta)).toEqual(['lancado', 'transferido']);
    const [c] = await linhas('SELECT DATE(inicio_em) AS d, competencia FROM conta_hospitalar WHERE id = ?', [
      Number(r['contaDestinoId']),
    ]);
    expect(String(c!['d'] instanceof Date ? (c!['d'] as Date).toISOString() : c!['d'])).toContain(
      '2026-01-2',
    );
  });

  it('lote: duas contas de uma vez; uma recusada desfaz o lote inteiro', async () => {
    const a = await novaConta(`${P}-L1`, [[ids['coberto']!, '2026-01-21', 'lancado']]);
    const b = await novaConta(`${P}-L2`, [[ids['coberto']!, '2026-01-22', 'lancado']]);
    const vazia = await novaConta(`${P}-L3`, [[ids['coberto']!, '2026-01-22', 'glosado']]);
    const destinoNovo = { fontePagadoraId: ids['fonteB'], planoId: ids['plano'] };
    // A terceira não tem item transferível: o lote inteiro volta (a primeira e a segunda ficam como estavam).
    expect(
      await recusaDe(
        gravar('lote', {
          contas: [{ contaOrigemId: a.conta }, { contaOrigemId: b.conta }, { contaOrigemId: vazia.conta }],
          destinoNovo,
          motivo: 'Descredenciamento do plano',
        }),
      ),
    ).toContain('sem-itens');
    expect(await situacoes(a.conta)).toEqual(['lancado']);
    expect(await situacoes(b.conta)).toEqual(['lancado']);
    expect(
      await recusaDe(
        gravar('lote', {
          contas: [{ contaOrigemId: a.conta }, { contaOrigemId: a.conta }],
          destinoNovo,
          motivo: 'Descredenciamento do plano',
        }),
      ),
    ).toContain('contas');

    const r = await gravar('lote', {
      contas: [{ contaOrigemId: a.conta }, { contaOrigemId: b.conta }],
      destinoNovo,
      motivo: 'Descredenciamento do plano',
    });
    expect(r).toMatchObject({ contas: 2, itens: 2, valorOrigem: 200, valorDestino: 300 });
    expect(await situacoes(a.conta)).toEqual(['transferido']);
    expect(await situacoes(b.conta)).toEqual(['transferido']);
    expect(new Set(String(r['contasDestino']).split(',')).size).toBe(2);
  });
});
