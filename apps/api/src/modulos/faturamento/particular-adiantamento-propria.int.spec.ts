// Contrato de efeito do adiantamento, caução e conta corrente do paciente (06-FAT linha 39) e do modelo de orçamento
// padrão (06-FAT linha 40) contra o MariaDB real. Massa SINTÉTICA com códigos "F3710" (nenhuma pessoa real):
// - recebimento no caixa aberto do operador (adiantamento_paciente + movimento_caixa ligado + total da sessão);
// - caução na urgência recusada sem a declaração voluntária e aceita com ela;
// - atendimento de outro paciente recusado; a urgência sai do caráter do atendimento (o operador não a desmarca);
// - Pix sem comprovante recusado sem o conector; o simulado devolve identificador único (nunca texto fixo);
// - aplicação do saldo na conta do mais antigo para o mais novo (aplicacao_adiantamento_paciente, saldo e situação);
// - estorno da aplicação marcado com o motivo (nada apagado) e o valor de volta ao saldo; aplicar de novo cria outra
//   linha (sequência) e o estorno continua no extrato; estorno com a conta faturada recusado;
// - devolução com conta aberta devendo só com a confirmação;
// - devolução em duas pessoas (F7, 07-FIN linha 92): o pedido fica "solicitada" e reserva o saldo (outro pedido acima do
//   disponível é recusado; nada de caixa nem de saldo ainda); quem pediu não aprova; outra pessoa aprova e a linha vira
//   "devolvida" com o aprovador (em dinheiro, movimento_caixa de saída na sessão de quem pediu e o total abatido); o
//   pedido cancelado fica com o motivo (nunca apagado) e não é mais aprovado;
// - o caixa (receberParticular) cobra da conta só o que resta depois do adiantamento aplicado (troco pelo saldo real);
// - extrato da conta corrente com saldo corrido;
// - modelo cadastrado com itens, prévia, orçamento gerado do modelo (preço da tabela particular, honorário pela
//   função, linha sem preço recusada até o valor ser digitado, preço de linha com preço recusado) e modelo inativado
//   sem afetar o orçamento; modelo exclusivo de outro estabelecimento não é inativado daqui.
// No fim, a massa é apagada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoParticularAdiantamento } from './particular-adiantamento.controller.js';
import { PortaFaturamentoPropria, TIPO_MOVIMENTO_RECEBIMENTO } from './porta-propria.js';
import {
  contaCorrentePaciente,
  listarModelos,
  previaComPrecos,
  previaDoModelo,
  TIPO_MOVIMENTO_ADIANTAMENTO,
  TIPO_MOVIMENTO_DEVOLUCAO,
} from './particular-adiantamento-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F3710';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
async function codigoDo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) {
      const pr = e.problema as unknown as Record<string, unknown>;
      return String(pr['codigo'] ?? pr['tipo'] ?? '');
    }
    throw e;
  }
  throw new Error('esperava recusa');
}

describe.skipIf(SEM_BANCO)('adiantamento do paciente e modelo de orçamento (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoParticularAdiantamento;
  const ids: Record<string, number> = {};
  const criados: string[] = [];
  const op = (est?: number, usuario?: number): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: est ?? ids['est']!,
    usuario: usuario ?? ids['usuario']!,
    correlacao: 'teste-f3710',
    chaveIdempotencia: `f3710-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const ctxL = () => ({
    cliente: CLIENTE,
    estabelecimento: ids['est']!,
    usuario: null,
    correlacao: 'teste-f3710',
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f3710' }, fn);
  const uma = (sql: string, p: unknown[]) => escrever((e) => e.uma<Record<string, unknown>>(sql, p));

  const limpar = async (e: Escritor) => {
    const est = ids['est'];
    if (!est) return;
    await e.executar(
      'DELETE x FROM aplicacao_adiantamento_paciente x JOIN adiantamento_paciente a ON a.id = x.adiantamento_paciente_id WHERE a.estabelecimento_id = ?',
      [est],
    );
    await e.executar(
      'DELETE d FROM devolucao_adiantamento_paciente d JOIN adiantamento_paciente a ON a.id = d.adiantamento_paciente_id WHERE a.estabelecimento_id = ?',
      [est],
    );
    await e.executar('DELETE FROM recebimento_particular WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM movimento_caixa WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM adiantamento_paciente WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM sessao_caixa WHERE estabelecimento_id = ?', [est]);
    await e.executar(
      'DELETE i FROM orcamento_particular_item i JOIN orcamento_particular o ON o.id = i.orcamento_particular_id WHERE o.estabelecimento_id = ?',
      [est],
    );
    await e.executar('DELETE FROM orcamento_particular WHERE estabelecimento_id = ?', [est]);
    await e.executar(
      "DELETE i FROM modelo_orcamento_item i JOIN modelo_orcamento m ON m.id = i.modelo_orcamento_id WHERE m.codigo LIKE 'F3710%'",
      [],
    );
    await e.executar("DELETE FROM modelo_orcamento WHERE codigo LIKE 'F3710%'", []);
    await e.executar('DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM sequencia_negocio WHERE estabelecimento_id = ?', [est]);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    s = new ServicoParticularAdiantamento(nucleo, 'dev');
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever(async (e) => {
      const agora = new Date();
      const g = (tabela: string, codigo: string, ins: string, pi: unknown[]) =>
        garantir(e, `SELECT id FROM ${tabela} WHERE codigo = ?`, [codigo], ins, pi);
      ids['est'] = await g(
        'estabelecimento',
        `${P}A`,
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids['estB'] = await g(
        'estabelecimento',
        `${P}B`,
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}B`, `ESTAB ${P} SINTETICO B`, `ESTAB ${P} SINTETICO B`, agora],
      );
      await limpar(e);
      ids['usuario'] = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f3710.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f3710.teste', `USUARIO SINTETICO ${P}`, agora],
      );
      // Quem aprova a devolução (outra pessoa).
      ids['aprovador'] = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f3710.aprovador'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f3710.aprovador', `APROVADOR SINTETICO ${P}`, agora],
      );
      ids['fonte'] = await g(
        'fonte_pagadora',
        `${P}FP`,
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
        [`${P}FP`, `PARTICULAR SINTETICO ${P}`, agora],
      );
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
        [pf, 837_710, agora],
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
        ['F5'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('F5', ?, 'teste', ?)",
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
      ids['proc'] = await item('83771001');
      ids['diaria'] = await item('83771002');
      ids['semPreco'] = await item('83771003');
      ids['acomodacao'] = await g(
        'categoria_acomodacao',
        P,
        "INSERT INTO categoria_acomodacao (codigo, descricao, tipo, criado_em) VALUES (?, ?, 'apartamento', ?)",
        [P, `ACOMODACAO SINTETICA ${P}`, agora],
      );
      ids['funcao'] = await g(
        'funcao_equipe_cobranca',
        `${P}AUX`,
        "INSERT INTO funcao_equipe_cobranca (codigo, descricao, tipo_funcao, percentual_cobranca, ordem_auxiliar, ordem_apresentacao, criado_em) VALUES (?, ?, 'auxiliar', 30, 1, 1, ?)",
        [`${P}AUX`, `FUNCAO SINTETICA ${P}`, agora],
      );
      const tab = await g(
        'tabela_preco',
        `${P}TP`,
        `INSERT INTO tabela_preco (codigo, descricao, tipo_item, referencia, situacao, fonte_pagadora_id, criado_em)
         VALUES (?, ?, 'servico_hospitalar', 'propria', 'ativa', ?, ?)`,
        [`${P}TP`, `TABELA SINTETICA ${P}`, ids['fonte'], agora],
      );
      let sq = 0;
      for (const [it, total] of [
        [ids['proc']!, 1000],
        [ids['diaria']!, 300],
      ] as const) {
        const pp = await garantir(
          e,
          'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
          [tab, it],
          'INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, criado_em) VALUES (?, ?, ?, ?)',
          [tab, ++sq, it, agora],
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
      const pfProf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PROFISSIONAL SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PROFISSIONAL SINTETICO ${P}`, agora],
      );
      ids['prof'] = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pfProf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pfProf, agora],
      );
      ids['caraterUrg'] = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['F5U'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, urgencia, criado_em) VALUES ('F5U', ?, 'teste', TRUE, ?)",
        [`CARATER URGENCIA SINTETICO ${P}`, agora],
      );
      ids['atendUrg'] = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', '2026-01-21 08:00:00', ?)`,
        [
          ids['est'],
          `${P}-AU`,
          ids['paciente'],
          ids['categoria'],
          ids['caraterUrg'],
          ids['fonte'],
          ids['prof'],
          agora,
        ],
      );
      const atend = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', '2026-01-20 08:00:00', ?)`,
        [
          ids['est'],
          `${P}-AT`,
          ids['paciente'],
          ids['categoria'],
          ids['carater'],
          ids['fonte'],
          ids['prof'],
          agora,
        ],
      );
      ids['conta'] = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tabela_preco_id, tipo_conta_id, natureza, competencia, inicio_em, valor_total, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 08:00:00', 700, ?)`,
        [ids['est'], `${P}-C1`, atend, ids['paciente'], ids['fonte'], tab, ids['tipoConta'], agora],
      );
      for (const [codigo, sentido] of [
        [TIPO_MOVIMENTO_ADIANTAMENTO, 'entrada'],
        [TIPO_MOVIMENTO_DEVOLUCAO, 'saida'],
        [TIPO_MOVIMENTO_RECEBIMENTO, 'entrada'],
      ] as const) {
        const ja = await e.uma('SELECT id FROM tipo_movimento_caixa WHERE codigo = ?', [codigo]);
        if (!ja) {
          await e.inserir(
            'INSERT INTO tipo_movimento_caixa (codigo, descricao, sentido, criado_em) VALUES (?, ?, ?, ?)',
            [codigo, `MOVIMENTO SINTETICO ${codigo}`, sentido, agora],
          );
          criados.push(codigo);
        }
      }
      for (const meio of ['dinheiro', 'pix'])
        await garantir(
          e,
          'SELECT id FROM forma_recebimento WHERE codigo = ?',
          [`${P}-${meio}`],
          "INSERT INTO forma_recebimento (codigo, descricao, meio, uso, padrao, criado_em) VALUES (?, ?, ?, 'ambos', 1, ?)",
          [`${P}-${meio}`, `FORMA SINTETICA ${meio}`, meio, agora],
        );
      ids['caixa'] = await garantir(
        e,
        'SELECT id FROM caixa WHERE estabelecimento_id = ? AND codigo = ?',
        [ids['est'], P],
        'INSERT INTO caixa (estabelecimento_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?)',
        [ids['est'], P, `CAIXA SINTETICO ${P}`, agora],
      );
      ids['sessao'] = await e.inserir(
        `INSERT INTO sessao_caixa (estabelecimento_id, caixa_id, numero, operador_usuario_id, situacao, aberta_em,
           fundo_troco, criado_em) VALUES (?, ?, 1, ?, 'aberta', ?, 50, ?)`,
        [ids['est'], ids['caixa'], ids['usuario'], agora, agora],
      );
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      for (const c of criados) await e.executar('DELETE FROM tipo_movimento_caixa WHERE codigo = ?', [c]);
      await limparTrilhaDaMassa(e, { ids: [ids['est']!, ids['estB']!] });
    });
    await nucleo.encerrar?.();
  });

  it('recebe adiantamento e caução no caixa aberto; veda a caução exigida na urgência', async () => {
    const a1 = await s.gravar('adiantamento.receber', op(), {
      pacienteId: ids['paciente'],
      tipo: 'adiantamento',
      valor: 400,
      forma: 'dinheiro',
    });
    ids['a1'] = Number(a1['id']);
    expect(String(a1['numero'])).toMatch(/^AD-/);
    const a = await uma(
      'SELECT valor, saldo, situacao, sessao_caixa_id FROM adiantamento_paciente WHERE id = ?',
      [ids['a1']],
    );
    expect([Number(a!['valor']), Number(a!['saldo']), a!['situacao'], Number(a!['sessao_caixa_id'])]).toEqual(
      [400, 400, 'ativo', ids['sessao']],
    );
    const m = await uma(
      'SELECT natureza, especie, valor FROM movimento_caixa WHERE adiantamento_paciente_id = ? AND situacao = ?',
      [ids['a1'], 'ativo'],
    );
    expect([m!['natureza'], m!['especie'], Number(m!['valor'])]).toEqual(['entrada', 'dinheiro', 400]);
    const urg = {
      pacienteId: ids['paciente'],
      tipo: 'caucao',
      valor: 500,
      forma: 'pix',
      atendimentoUrgencia: true,
    };
    expect(await codigoDo(s.gravar('adiantamento.receber', op(), urg))).toBe('entrada-invalida');
    // A urgência vem do caráter do atendimento: desmarcar no corpo não libera a caução exigida.
    expect(
      await codigoDo(
        s.gravar('adiantamento.receber', op(), {
          ...urg,
          atendimentoUrgencia: false,
          atendimentoId: ids['atendUrg'],
        }),
      ),
    ).toBe('entrada-invalida');
    // Atendimento que não é do paciente neste estabelecimento.
    expect(
      await codigoDo(
        s.gravar('adiantamento.receber', op(ids['estB']), { ...urg, atendimentoId: ids['atendUrg'] }),
      ),
    ).toBe('atendimento-inexistente');
    // Sem o conector (produção ou ambiente desconhecido), Pix sem comprovante é recusado.
    const semConector = new ServicoParticularAdiantamento(nucleo, undefined);
    expect(semConector.simulado).toBe(false);
    // (a regra do domínio pede o comprovante no campo; a operação ainda confere 'sem-conector' por defesa)
    expect(
      await codigoDo(
        semConector.gravar('adiantamento.receber', op(), { ...urg, declaracaoVoluntaria: true }),
      ),
    ).toBe('entrada-invalida');
    const a2 = await s.gravar('adiantamento.receber', op(), {
      ...urg,
      atendimentoId: ids['atendUrg'],
      declaracaoVoluntaria: true,
    });
    ids['a2'] = Number(a2['id']);
    const t = await uma(
      'SELECT identificador_transacao, atendimento_urgencia, atendimento_id FROM adiantamento_paciente WHERE id = ?',
      [ids['a2']],
    );
    expect(String(t!['identificador_transacao'])).toMatch(/^SIM-[0-9A-F]{16}$/);
    expect([Number(t!['atendimento_urgencia']), Number(t!['atendimento_id'])]).toEqual([1, ids['atendUrg']]);
    const sessao = await uma('SELECT total_dinheiro, total_pix FROM sessao_caixa WHERE id = ?', [
      ids['sessao'],
    ]);
    expect([Number(sessao!['total_dinheiro']), Number(sessao!['total_pix'])]).toEqual([400, 500]);
  });

  it('aplica o saldo na conta do mais antigo para o mais novo, até o que a conta deve', async () => {
    expect(
      await codigoDo(s.gravar('adiantamento.aplicar', op(), { contaId: ids['conta'], valor: 1000 })),
    ).toBe('entrada-invalida');
    const r = await s.gravar('adiantamento.aplicar', op(), { contaId: ids['conta'] });
    expect(r['total']).toBe(700);
    expect(JSON.parse(String(r['parcelas']))).toEqual([
      { adiantamento: ids['a1'], valor: 400 },
      { adiantamento: ids['a2'], valor: 300 },
    ]);
    const a1 = await uma('SELECT saldo, situacao FROM adiantamento_paciente WHERE id = ?', [ids['a1']]);
    const a2 = await uma('SELECT saldo, situacao FROM adiantamento_paciente WHERE id = ?', [ids['a2']]);
    expect([Number(a1!['saldo']), a1!['situacao'], Number(a2!['saldo']), a2!['situacao']]).toEqual([
      0,
      'aplicado',
      200,
      'aplicado_parcial',
    ]);
    // A conta está quitada: nova aplicação é recusada.
    expect(await codigoDo(s.gravar('adiantamento.aplicar', op(), { contaId: ids['conta'] }))).toBe(
      'entrada-invalida',
    );
  });

  it('estorna a aplicação sem apagar, aplica de novo em outra linha e devolve só com a confirmação', async () => {
    const ap = await uma(
      'SELECT id, sequencia FROM aplicacao_adiantamento_paciente WHERE adiantamento_paciente_id = ? AND conta_hospitalar_id = ?',
      [ids['a2'], ids['conta']],
    );
    expect(Number(ap!['sequencia'])).toBe(1);
    const est = await s.gravar('adiantamento.estornar', op(), {
      aplicacaoId: ap!['id'],
      motivo: 'item retirado',
    });
    expect(est['saldo']).toBe(500);
    const marcado = await uma(
      'SELECT estornado, estornado_em, excluido_em, motivo_estorno, estornador_usuario_id FROM aplicacao_adiantamento_paciente WHERE id = ?',
      [ap!['id']],
    );
    expect([
      Number(marcado!['estornado']),
      marcado!['estornado_em'] !== null,
      marcado!['excluido_em'],
      marcado!['motivo_estorno'],
      Number(marcado!['estornador_usuario_id']),
    ]).toEqual([1, true, null, 'item retirado', ids['usuario']]);
    expect(
      await codigoDo(
        s.gravar('adiantamento.devolver', op(), {
          adiantamentoId: ids['a2'],
          valor: 600,
          forma: 'dinheiro',
          favorecidoNome: 'FAVORECIDO SINTETICO',
          motivo: 'alta',
          confirmarContaAberta: true,
        }),
      ),
    ).toBe('entrada-invalida');
    const devolver = (valor: number, forma: string, chavePix: string | null = null, confirmar = true) =>
      s.gravar('adiantamento.devolver', op(), {
        adiantamentoId: ids['a2'],
        valor,
        forma,
        chavePix,
        favorecidoNome: 'FAVORECIDO SINTETICO',
        motivo: 'alta',
        confirmarContaAberta: confirmar,
      });
    const aprovar = (devolucaoId: unknown, usuario = ids['aprovador'], comprovante: string | null = null) =>
      s.gravar('adiantamento.aprovarDevolucao', op(undefined, usuario), { devolucaoId, comprovante });
    // A conta ainda deve 300: devolver sem a confirmação é recusado.
    expect(await codigoDo(devolver(300, 'dinheiro', null, false))).toBe('conta-em-aberto');
    // Na gaveta: fundo 50 + dinheiro 400 = 450; 500 em dinheiro não sai.
    expect(await codigoDo(devolver(500, 'dinheiro'))).toBe('caixa-sem-dinheiro');
    // O pedido: "solicitada", reserva 300 dos 500; nada de caixa nem de saldo ainda.
    const d = await devolver(300, 'dinheiro');
    expect([d['situacao'], d['disponivel']]).toEqual(['solicitada', 200]);
    const pedido = await uma(
      `SELECT situacao, criado_por, aprovado_por_usuario_id, devolvido_em, movimento_caixa_id, sessao_caixa_id
         FROM devolucao_adiantamento_paciente WHERE id = ?`,
      [d['id']],
    );
    expect([
      pedido!['situacao'],
      Number(pedido!['criado_por']),
      pedido!['aprovado_por_usuario_id'],
      pedido!['devolvido_em'],
      pedido!['movimento_caixa_id'],
      Number(pedido!['sessao_caixa_id']),
    ]).toEqual(['solicitada', ids['usuario'], null, null, null, ids['sessao']]);
    const intacto = await uma('SELECT saldo FROM adiantamento_paciente WHERE id = ?', [ids['a2']]);
    expect(Number(intacto!['saldo'])).toBe(500);
    // O pedido em aberto reserva o saldo também contra o uso na conta: aplicar além dos 200 livres é recusado.
    expect(
      await codigoDo(
        s.gravar('adiantamento.aplicar', op(), {
          contaId: ids['conta'],
          valor: 250,
          adiantamentos: [ids['a2']],
        }),
      ),
    ).toBe('entrada-invalida');
    const semAplicar = await uma('SELECT saldo FROM adiantamento_paciente WHERE id = ?', [ids['a2']]);
    expect(Number(semAplicar!['saldo'])).toBe(500);
    // Outro pedido acima do disponível (500 − 300 reservados) é recusado.
    expect(await codigoDo(devolver(250, 'pix', 'chave-sintetica'))).toBe('entrada-invalida');
    // Quem pediu não aprova.
    expect(await codigoDo(aprovar(d['id'], ids['usuario']))).toBe('aprovacao-pelo-solicitante');
    // O pedido cancelado fica com o motivo e não é mais aprovado.
    const c = await devolver(50, 'pix', 'chave-sintetica');
    await s.gravar('adiantamento.cancelarDevolucao', op(), { devolucaoId: c['id'], motivo: 'desistiu' });
    const cancelado = await uma(
      'SELECT situacao, observacao, excluido_em FROM devolucao_adiantamento_paciente WHERE id = ?',
      [c['id']],
    );
    expect([cancelado!['situacao'], cancelado!['observacao'], cancelado!['excluido_em']]).toEqual([
      'cancelada',
      'Cancelada: desistiu',
      null,
    ]);
    expect(await codigoDo(aprovar(c['id']))).toBe('devolucao-decidida');
    // Outra pessoa aprova: a devolução sai da gaveta de quem pediu e o saldo cai.
    const ok = await aprovar(d['id']);
    expect(ok['saldo']).toBe(200);
    expect(await codigoDo(aprovar(d['id']))).toBe('devolucao-decidida');
    // Aplicar de novo o mesmo adiantamento na mesma conta: linha nova (sequência 2); a estornada fica como está.
    const r = await s.gravar('adiantamento.aplicar', op(), {
      contaId: ids['conta'],
      valor: 100,
      adiantamentos: [ids['a2']],
    });
    expect(JSON.parse(String(r['parcelas']))).toEqual([{ adiantamento: ids['a2'], valor: 100 }]);
    const linhas = await escrever((e) =>
      e.consultar<Record<string, unknown>>(
        'SELECT sequencia, valor, estornado FROM aplicacao_adiantamento_paciente WHERE adiantamento_paciente_id = ? ORDER BY sequencia',
        [ids['a2']],
      ),
    );
    expect(linhas.map((x) => [Number(x['sequencia']), Number(x['valor']), Number(x['estornado'])])).toEqual([
      [1, 300, 1],
      [2, 100, 0],
    ]);
    const pix = await devolver(100, 'pix', 'chave-sintetica');
    // Fora do dinheiro, sem o identificador da transação a devolução não é efetivada: o pedido segue em aberto.
    expect(await codigoDo(aprovar(pix['id']))).toBe('comprovante-obrigatorio');
    const semProva = await uma(
      'SELECT situacao, aprovado_por_usuario_id, devolvido_em, identificador_transacao FROM devolucao_adiantamento_paciente WHERE id = ?',
      [pix['id']],
    );
    expect([
      semProva!['situacao'],
      semProva!['aprovado_por_usuario_id'],
      semProva!['devolvido_em'],
      semProva!['identificador_transacao'],
    ]).toEqual(['solicitada', null, null, null]);
    const pixOk = await aprovar(pix['id'], ids['aprovador'], 'PIX-SINT-F3710-0001');
    expect([pixOk['saldo'], pixOk['movimento']]).toEqual([0, null]);
    const pixDev = await uma(
      'SELECT situacao, identificador_transacao, devolvido_em FROM devolucao_adiantamento_paciente WHERE id = ?',
      [pix['id']],
    );
    expect([
      pixDev!['situacao'],
      pixDev!['identificador_transacao'],
      pixDev!['devolvido_em'] !== null,
    ]).toEqual(['devolvida', 'PIX-SINT-F3710-0001', true]);
    const dev = await uma(
      `SELECT situacao, sequencia, movimento_caixa_id, devolvido_em, aprovado_por_usuario_id, aprovado_em
         FROM devolucao_adiantamento_paciente WHERE id = ?`,
      [d['id']],
    );
    expect([
      dev!['situacao'],
      Number(dev!['sequencia']),
      dev!['devolvido_em'] !== null,
      Number(dev!['aprovado_por_usuario_id']),
      dev!['aprovado_em'] !== null,
    ]).toEqual(['devolvida', 1, true, ids['aprovador'], true]);
    const mov = await uma('SELECT natureza, valor, sessao_caixa_id FROM movimento_caixa WHERE id = ?', [
      dev!['movimento_caixa_id'],
    ]);
    expect([mov!['natureza'], Number(mov!['valor']), Number(mov!['sessao_caixa_id'])]).toEqual([
      'saida',
      300,
      ids['sessao'],
    ]);
    const a2 = await uma('SELECT situacao FROM adiantamento_paciente WHERE id = ?', [ids['a2']]);
    expect(a2!['situacao']).toBe('devolvido');
    const sessao = await uma('SELECT total_dinheiro FROM sessao_caixa WHERE id = ?', [ids['sessao']]);
    expect(Number(sessao!['total_dinheiro'])).toBe(100);
  });

  it('a conta corrente do paciente mostra o extrato corrido e o devido da conta', async () => {
    const cc = await nucleo.lerSomente(ctxL(), (l) =>
      contaCorrentePaciente(l, ids['est']!, ids['paciente']!),
    );
    expect(cc.saldo).toBe(0);
    expect(cc.adiantamentos).toHaveLength(2);
    expect(cc.extrato.linhas.map((x) => x.tipo)).toEqual([
      'adiantamento',
      'caucao',
      'aplicacao',
      'aplicacao',
      'estorno_aplicacao',
      'devolucao',
      'aplicacao',
      'devolucao',
    ]);
    expect([cc.extrato.creditos, cc.extrato.debitos, cc.extrato.saldo]).toEqual([1200, 1200, 0]);
    expect(cc.contasAbertas.find((c) => c.id === ids['conta'])?.devido).toBe(200);
    expect(cc.aplicacoes.filter((x) => x.estornado).map((x) => x.motivoEstorno)).toEqual(['item retirado']);
    // Conta faturada: o uso do saldo nela não é mais estornado.
    const viva = cc.aplicacoes.find((x) => !x.estornado && x.adiantamento === ids['a2'])!;
    await escrever((e) =>
      e.executar(
        "UPDATE conta_hospitalar SET situacao = 'faturada', fechada_em = CURRENT_TIMESTAMP(3), fechada_por_usuario_id = ? WHERE id = ?",
        [ids['usuario'], ids['conta']],
      ),
    );
    try {
      expect(
        await codigoDo(
          s.gravar('adiantamento.estornar', op(), { aplicacaoId: viva.id, motivo: 'tarde demais' }),
        ),
      ).toBe('conta-fechada');
    } finally {
      await escrever((e) =>
        e.executar(
          "UPDATE conta_hospitalar SET situacao = 'aberta', fechada_em = NULL, fechada_por_usuario_id = NULL WHERE id = ?",
          [ids['conta']],
        ),
      );
    }
  });

  it('o caixa cobra da conta só o que resta depois do adiantamento aplicado', async () => {
    // A conta de 700 tem 500 de adiantamento aplicado (400 + 100; o uso estornado não conta): restam 200.
    const porta = new PortaFaturamentoPropria(nucleo, CLIENTE);
    const c = {
      cliente: CLIENTE,
      estabelecimento: ids['est']!,
      usuario: ids['usuario']!,
      correlacao: 'teste-f3710',
      rede: 'rede-teste',
      hospital: `${P}A`,
    };
    const trilha = {
      estabelecimento: ids['est']!,
      usuario: ids['usuario']!,
      acao: 'inclusao' as const,
      entidade: 'movimento_caixa',
      entidadeId: null,
      correlacao: 'teste-f3710',
    };
    const r = await porta.gravarSgh(c, trilha, (g) =>
      g.receberParticular({
        caixa: ids['sessao']!,
        orcamento: null,
        conta: ids['conta']!,
        pagamentos: [{ forma: 'dinheiro', valor: 250, comprovante: null, parcelas: 1 }],
        usuario: 'x',
        simulado: true,
      }),
    );
    expect(r.troco).toBe(50);
    const m = await uma('SELECT natureza, valor FROM movimento_caixa WHERE id = ?', [r.pagamentos[0]]);
    expect([m!['natureza'], Number(m!['valor'])]).toEqual(['entrada', 200]);
    // Quitada pelo caixa e pelo adiantamento: nada mais a receber.
    expect(
      await codigoDo(
        porta.gravarSgh(c, trilha, (g) =>
          g.receberParticular({
            caixa: ids['sessao']!,
            orcamento: null,
            conta: ids['conta']!,
            pagamentos: [{ forma: 'dinheiro', valor: 10, comprovante: null, parcelas: 1 }],
            usuario: 'x',
            simulado: true,
          }),
        ),
      ),
    ).toBe('conta-quitada');
  });

  it('cadastra o modelo, gera o orçamento pela tabela particular e inativa o modelo', async () => {
    const base = {
      descricao: 'MODELO SINTETICO',
      procedimentoId: ids['proc'],
      acomodacaoId: ids['acomodacao'],
      fontePagadoraId: ids['fonte'],
      administracao: 10,
      validadeDias: 15,
      itens: [
        { tipo: 'diaria', itemId: ids['diaria'], quantidade: 2 },
        { tipo: 'honorario', funcaoId: ids['funcao'] },
        { tipo: 'taxa', itemId: ids['semPreco'] },
      ],
    };
    expect(
      await codigoDo(
        s.gravar('modelo.cadastrar', op(), { ...base, codigo: `${P}M1`, itens: [{ tipo: 'honorario' }] }),
      ),
    ).toBe('entrada-invalida');
    const m = await s.gravar('modelo.cadastrar', op(), { ...base, codigo: `${P}M1` });
    ids['modelo'] = Number(m['id']);
    expect(m['itens']).toBe(3);
    expect(await codigoDo(s.gravar('modelo.cadastrar', op(), { ...base, codigo: `${P}M1` }))).toBe(
      'codigo-repetido',
    );
    const lista = await nucleo.lerSomente(ctxL(), (l) => listarModelos(l, ids['est']!));
    expect(lista.find((x) => x.id === ids['modelo'])?.itens).toBe(3);
    const pre = await nucleo.lerSomente(ctxL(), (l) => previaDoModelo(l, ids['est']!, ids['modelo']!));
    expect(pre.montado.linhas.map((x) => x.total)).toEqual([1000, 600, 300, 0]);
    expect(pre.montado.semPreco).toEqual([4]);
    const gerar = { pacienteId: ids['paciente'] };
    expect(
      await codigoDo(s.gravar('modelo.gerarOrcamento', op(), { ...gerar, modeloId: ids['modelo'] })),
    ).toBe('sem-preco');
    // O valor na hora vale só para a linha sem preço: trocar o preço do procedimento (linha 1) é recusado.
    expect(
      await codigoDo(
        s.gravar('modelo.gerarOrcamento', op(), {
          ...gerar,
          modeloId: ids['modelo'],
          precos: { '1': 1, '4': 40 },
        }),
      ),
    ).toBe('preco-fora-da-linha');
    const pre2 = await nucleo.lerSomente(ctxL(), (l) =>
      previaComPrecos(l, ids['est']!, ids['modelo']!, { '4': 40 }),
    );
    expect([pre2.montado.total, pre2.montado.semPreco]).toEqual([2104, []]);
    const o = await s.gravar('modelo.gerarOrcamento', op(), {
      ...gerar,
      modeloId: ids['modelo'],
      precos: { '4': 40 },
    });
    // (1000 + 600 + 300 + 40) + administração 10% sobre os não honorários (1640) = 2104
    expect(o['total']).toBe(2104);
    const orc = await uma(
      'SELECT modelo_orcamento_id, categoria_acomodacao_id, valor_total, DATEDIFF(validade_ate, data_orcamento) AS dias FROM orcamento_particular WHERE id = ?',
      [o['id']],
    );
    expect([
      Number(orc!['modelo_orcamento_id']),
      Number(orc!['categoria_acomodacao_id']),
      Number(orc!['valor_total']),
      Number(orc!['dias']),
    ]).toEqual([ids['modelo'], ids['acomodacao'], 2104, 15]);
    const itens = await uma(
      'SELECT COUNT(*) AS n, SUM(valor_total) AS t FROM orcamento_particular_item WHERE orcamento_particular_id = ?',
      [o['id']],
    );
    expect([Number(itens!['n']), Number(itens!['t'])]).toEqual([5, 2104]);
    // O modelo exclusivo de outro estabelecimento não é inativado daqui.
    const mb = await s.gravar('modelo.cadastrar', op(ids['estB']), { ...base, codigo: `${P}MB` });
    expect(
      await codigoDo(
        s.gravar('modelo.inativar', op(), { modeloId: mb['id'], motivo: 'outro estabelecimento' }),
      ),
    ).toBe('modelo-inexistente');
    await s.gravar('modelo.inativar', op(), { modeloId: ids['modelo'], motivo: 'revisão de preços' });
    const ina = await uma('SELECT ativo FROM modelo_orcamento WHERE id = ?', [ids['modelo']]);
    expect(Number(ina!['ativo'])).toBe(0);
    expect(
      await codigoDo(s.gravar('modelo.gerarOrcamento', op(), { ...gerar, modeloId: ids['modelo'] })),
    ).toBe('modelo-inexistente');
  });
});
