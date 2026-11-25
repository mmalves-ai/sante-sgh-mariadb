// Integração da porta própria da conta do paciente (M30) contra o MariaDB real (cliente f22_o2, já criado pela obra da
// onda 2). Massa SINTÉTICA com códigos "L0208" (nenhuma pessoa real). Contrato de efeito de cada gravação: linhas,
// versão, trilha e outbox; e as recusas (conflito de versão, entrada inválida, outro estabelecimento, pendência que
// bloqueia, item sem preço, preço manual fora da faixa). Uma bateria comum de recusas roda sobre as duas fábricas
// (memória e banco) num describe.each. No fim, a massa de negócio é apagada; ficam o estabelecimento e o usuário de
// teste, que a trilha (só inclusão) referencia. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { versaoTexto } from './esquemas.js';
import type { ContextoFaturamento, PortaFaturamento } from './porta.js';
import { PortaFaturamentoMemoria } from './porta-memoria.js';
import { PortaFaturamentoPropria, TIPO_MOVIMENTO_RECEBIMENTO } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0208';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

function codigoDe(e: unknown): string | null {
  return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : null;
}
async function erroDe(p: Promise<unknown>): Promise<ErroOperacao> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) return e;
    throw e;
  }
  throw new Error('esperava recusa');
}

describe.skipIf(SEM_BANCO)('porta própria da conta do paciente (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFaturamentoPropria;
  const ids = {
    est: 0,
    outroEst: 0,
    usuario: 0,
    pessoa: 0,
    pessoaProf: 0,
    paciente: 0,
    prof: 0,
    fonte: 0,
    categoria: 0,
    carater: 0,
    tipoConta: 0,
    atendimento: 0,
    atendimentoB: 0,
    conta: 0,
    contaB: 0,
    grupo: 0,
    item: 0,
    itemSemPreco: 0,
    tabela: 0,
    preco: 0,
    tipoPend: 0,
    tipoAud: 0,
    caixa: 0,
    contaC: 0,
    setor: 0,
    tipoPendAlerta: 0,
    tipoMov: 0,
    tipoMovParticular: 0,
    formas: [] as number[],
  };
  const criados = { tipoMovParticular: false };
  let c: ContextoFaturamento;
  const hoje = new Date().toISOString().slice(0, 10);
  const competencia = `${hoje.slice(0, 7)}-01`;
  const op = (x: ContextoFaturamento = c): ContextoOperacao => ({
    cliente: x.cliente,
    estabelecimento: x.estabelecimento,
    usuario: x.usuario,
    correlacao: x.correlacao,
    chaveIdempotencia: `t0208-${randomUUID()}`,
  });
  const contaLida = () =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-teste-02-08' }, (l) =>
      l.uma<Record<string, unknown>>(
        'SELECT situacao, versao, valor_total FROM conta_hospitalar WHERE id = ?',
        [ids.conta],
      ),
    );
  const lerUma = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-teste-02-08' }, (l) =>
      l.uma<Record<string, unknown>>(sql, p),
    );
  const lerVarias = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-teste-02-08' }, (l) =>
      l.consultar<Record<string, unknown>>(sql, p),
    );
  const escrever = (sql: string, p: unknown[]) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-08' }, (e) => e.executar(sql, p));
  const versaoDaConta = async () => versaoTexto(Number((await contaLida())?.['versao']));
  const trilhaDe = (correlacao: string) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-teste-02-08' }, (l) =>
      l.consultar<Record<string, unknown>>(
        'SELECT entidade, entidade_id FROM trilha_auditoria WHERE correlacao = ?',
        [correlacao],
      ),
    );

  const limpar = (e: Escritor) =>
    (async () => {
      await e.executar('DELETE FROM decisao_lancamento_tardio WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM regra_faturabilidade WHERE estabelecimento_id = ?', [ids.est]);
      // O pacote sintético da rede (sem estabelecimento) do teste de pacote também sai, se ficou de uma falha.
      const pacotes =
        "SELECT id FROM pacote WHERE estabelecimento_id = ? OR (estabelecimento_id IS NULL AND codigo = '82080001')";
      await e.executar(`DELETE FROM pacote_item_incluso WHERE pacote_id IN (${pacotes})`, [ids.est]);
      await e.executar(`DELETE FROM pacote_contrato WHERE pacote_id IN (${pacotes})`, [ids.est]);
      await e.executar(
        "DELETE FROM pacote WHERE estabelecimento_id = ? OR (estabelecimento_id IS NULL AND codigo = '82080001')",
        [ids.est],
      );
      await e.executar('DELETE FROM recibo WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM recebimento_particular WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM movimento_caixa WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar(
        'DELETE FROM orcamento_particular_item WHERE orcamento_particular_id IN (SELECT id FROM orcamento_particular WHERE estabelecimento_id = ?)',
        [ids.est],
      );
      await e.executar('DELETE FROM orcamento_particular WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar(
        "DELETE FROM sequencia_negocio WHERE estabelecimento_id = ? AND tipo IN ('orcamento_particular','recebimento_particular','recibo')",
        [ids.est],
      );
      const contas = [ids.conta, ids.contaB, ids.contaC].filter(Boolean);
      if (contas.length) {
        const q = contas.map(() => '?').join(',');
        await e.executar(
          `DELETE FROM integracao_mensagem WHERE entidade IN ('conta_hospitalar','conta_hospitalar_item') AND entidade_id IN (SELECT id FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (${q}) UNION SELECT id FROM conta_hospitalar WHERE id IN (${q}))`,
          [...contas, ...contas],
        );
        await e.executar(
          `DELETE FROM conta_hospitalar_item_memoria WHERE conta_hospitalar_item_id IN (SELECT id FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (${q}))`,
          contas,
        );
        await e.executar(`DELETE FROM auditoria_conta_versao WHERE conta_hospitalar_id IN (${q})`, contas);
        await e.executar(`DELETE FROM auditoria_conta WHERE conta_hospitalar_id IN (${q})`, contas);
        await e.executar(`DELETE FROM conta_hospitalar_etapa WHERE conta_hospitalar_id IN (${q})`, contas);
        await e.executar(
          `DELETE FROM fato_contabil WHERE entidade_origem = 'conta_hospitalar' AND entidade_origem_id IN (${q})
              AND estornado_fato_contabil_id IS NOT NULL`,
          contas,
        );
        await e.executar(
          `DELETE FROM fato_contabil WHERE entidade_origem = 'conta_hospitalar' AND entidade_origem_id IN (${q})`,
          contas,
        );
        await e.executar(`DELETE FROM pendencia_conta WHERE conta_hospitalar_id IN (${q})`, contas);
        await e.executar(`DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (${q})`, contas);
        await e.executar(`DELETE FROM conta_hospitalar WHERE id IN (${q})`, contas);
      }
      await e.executar('DELETE FROM movimento_caixa WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM sessao_caixa WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM ciclo_competencia_fonte_pagadora WHERE estabelecimento_id = ?', [
        ids.est,
      ]);
      await e.executar('DELETE FROM fechamento_competencia_fonte_pagadora WHERE estabelecimento_id = ?', [
        ids.est,
      ]);
      await e.executar('DELETE FROM competencia_faturamento WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?', [
        'sessao_caixa',
        ids.est,
      ]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-08' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      ids.est = await est(`${P}A`);
      ids.outroEst = await est(`${P}B`);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['l0208.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0208.teste', 'USUARIO SINTETICO L0208', agora],
      );
      await limpar(e);
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      ids.pessoa = await pessoa('PACIENTE SINTETICO L0208');
      ids.pessoaProf = await pessoa('PROFISSIONAL SINTETICO L0208');
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [ids.pessoa],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [ids.pessoa, 820_801, agora],
      );
      ids.prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [ids.pessoaProf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [ids.pessoaProf, agora],
      );
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
        [`${P}FP`, 'OPERADORA SINTETICA L0208', agora],
      );
      ids.categoria = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [P],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, 'CATEGORIA SINTETICA L0208', agora],
      );
      ids.carater = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['L8'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('L8', ?, 'teste', ?)",
        ['CARATER SINTETICO L0208', agora],
      );
      ids.tipoConta = await garantir(
        e,
        'SELECT id FROM tipo_conta WHERE codigo = ?',
        [P],
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, 'TIPO DE CONTA SINTETICO L0208', agora],
      );
      const atendimento = (estab: number, numero: string) =>
        garantir(
          e,
          'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
          [estab, numero],
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', ?, ?)`,
          [estab, numero, ids.paciente, ids.categoria, ids.carater, ids.fonte, ids.prof, agora, agora],
        );
      ids.atendimento = await atendimento(ids.est, `${P}-1`);
      ids.atendimentoB = await atendimento(ids.outroEst, `${P}-2`);
      ids.grupo = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        [P],
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
        [P, 'GRUPO SINTETICO L0208', agora],
      );
      const item = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM item_faturavel WHERE codigo = ?',
          [codigo],
          "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
          [codigo, `PROCEDIMENTO SINTETICO ${codigo}`, ids.grupo, agora],
        );
      ids.item = await item('82080001');
      ids.itemSemPreco = await item('82080002');
      ids.tabela = await garantir(
        e,
        'SELECT id FROM tabela_preco WHERE codigo = ?',
        [P],
        `INSERT INTO tabela_preco (codigo, descricao, tipo_item, referencia, situacao, fonte_pagadora_id, criado_em)
         VALUES (?, ?, 'servico_hospitalar', 'propria', 'ativa', ?, ?)`,
        [P, 'TABELA SINTETICA L0208', ids.fonte, agora],
      );
      ids.preco = await garantir(
        e,
        'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
        [ids.tabela, ids.item],
        'INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, criado_em) VALUES (?, 1, ?, ?)',
        [ids.tabela, ids.item, agora],
      );
      await garantir(
        e,
        'SELECT id FROM preco_procedimento_valor WHERE preco_procedimento_id = ?',
        [ids.preco],
        `INSERT INTO preco_procedimento_valor (preco_procedimento_id, operacao, ocorrido_em, vigencia_inicio,
           valor_honorario, valor_custo_operacional, valor_filme, valor_total, criado_em)
         VALUES (?, 'inclusao', ?, '2020-01-01', 80, 20, 0, 100, ?)`,
        [ids.preco, agora, agora],
      );
      ids.tipoPend = await garantir(
        e,
        'SELECT id FROM tipo_pendencia_conta WHERE codigo = ?',
        [P],
        "INSERT INTO tipo_pendencia_conta (codigo, descricao, categoria, controle, criado_em) VALUES (?, ?, 'documento', 'impede_fechamento', ?)",
        [P, 'PENDENCIA SINTETICA L0208', agora],
      );
      ids.tipoPendAlerta = await garantir(
        e,
        'SELECT id FROM tipo_pendencia_conta WHERE codigo = ?',
        [`${P}AL`],
        "INSERT INTO tipo_pendencia_conta (codigo, descricao, categoria, controle, criado_em) VALUES (?, ?, 'documento', 'alerta', ?)",
        [`${P}AL`, 'ALERTA SINTETICO L0208', agora],
      );
      ids.setor = await garantir(
        e,
        'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, P],
        "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'assistencial', ?)",
        [ids.est, P, 'SETOR SINTETICO L0208', agora],
      );
      ids.tipoMov = await garantir(
        e,
        'SELECT id FROM tipo_movimento_caixa WHERE codigo = ?',
        [P],
        "INSERT INTO tipo_movimento_caixa (codigo, descricao, sentido, criado_em) VALUES (?, ?, 'entrada', ?)",
        [P, 'RECEBIMENTO SINTETICO L0208', agora],
      );
      const tipoParticular = await e.uma<{ id: number }>(
        'SELECT id FROM tipo_movimento_caixa WHERE codigo = ?',
        [TIPO_MOVIMENTO_RECEBIMENTO],
      );
      criados.tipoMovParticular = !tipoParticular;
      ids.tipoMovParticular = tipoParticular
        ? Number(tipoParticular.id)
        : await e.inserir(
            "INSERT INTO tipo_movimento_caixa (codigo, descricao, sentido, criado_em) VALUES (?, ?, 'entrada', ?)",
            [TIPO_MOVIMENTO_RECEBIMENTO, 'RECEBIMENTO PARTICULAR', agora],
          );
      for (const meio of ['dinheiro', 'pix', 'cartao_credito'])
        ids.formas.push(
          await garantir(
            e,
            'SELECT id FROM forma_recebimento WHERE codigo = ?',
            [`${P}-${meio}`],
            "INSERT INTO forma_recebimento (codigo, descricao, meio, uso, criado_em) VALUES (?, ?, ?, 'recebimento', ?)",
            [`${P}-${meio}`, `FORMA SINTETICA ${meio.toUpperCase()}`, meio, agora],
          ),
        );
      ids.tipoAud = await garantir(
        e,
        'SELECT id FROM tipo_auditoria WHERE codigo = ?',
        [P],
        "INSERT INTO tipo_auditoria (codigo, descricao, categoria, criado_em) VALUES (?, ?, 'administrativa', ?)",
        [P, 'AUDITORIA SINTETICA L0208', agora],
      );
      ids.caixa = await garantir(
        e,
        'SELECT id FROM caixa WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, P],
        'INSERT INTO caixa (estabelecimento_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?)',
        [ids.est, P, 'CAIXA SINTETICO L0208', agora],
      );
      await garantir(
        e,
        'SELECT id FROM operador_caixa WHERE caixa_id = ? AND usuario_id = ?',
        [ids.caixa, ids.usuario],
        'INSERT INTO operador_caixa (caixa_id, usuario_id, data_ativacao, criado_em) VALUES (?, ?, ?, ?)',
        [ids.caixa, ids.usuario, '2020-01-01', agora],
      );
      await e.executar(
        "INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, incremento, ativo, criado_em) VALUES (?, 'sessao_caixa', 1, 1, 1, ?)",
        [ids.est, agora],
      );
      const conta = (estab: number, atend: number, numero: string) =>
        e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tipo_conta_id, tabela_preco_id, natureza, competencia, inicio_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'internacao', ?, ?, ?)`,
          [
            estab,
            numero,
            atend,
            ids.paciente,
            ids.fonte,
            ids.tipoConta,
            ids.tabela,
            competencia,
            agora,
            agora,
          ],
        );
      ids.conta = await conta(ids.est, ids.atendimento, `${P}-C1`);
      ids.contaB = await conta(ids.outroEst, ids.atendimentoB, `${P}-C2`);
      ids.contaC = await conta(ids.est, ids.atendimento, `${P}-C3`);
    });
    porta = new PortaFaturamentoPropria(nucleo, CLIENTE);
    c = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: ids.usuario,
      correlacao: 'teste-02-08',
      rede: 'rede-teste',
      hospital: `${P}A`,
    };
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-08' }, async (e) => {
      await limpar(e);
      await e.executar('DELETE FROM operador_caixa WHERE caixa_id = ?', [ids.caixa]);
      await e.executar('DELETE FROM caixa WHERE id = ?', [ids.caixa]);
      await e.executar('DELETE FROM tipo_auditoria WHERE id = ?', [ids.tipoAud]);
      await e.executar('DELETE FROM tipo_pendencia_conta WHERE id IN (?, ?)', [
        ids.tipoPend,
        ids.tipoPendAlerta,
      ]);
      await e.executar('DELETE FROM tipo_movimento_caixa WHERE id = ?', [ids.tipoMov]);
      if (criados.tipoMovParticular)
        await e.executar('DELETE FROM tipo_movimento_caixa WHERE id = ?', [ids.tipoMovParticular]);
      if (ids.formas.length)
        await e.executar(
          `DELETE FROM forma_recebimento WHERE id IN (${ids.formas.map(() => '?').join(',')})`,
          ids.formas,
        );
      await e.executar('DELETE FROM setor_funcional WHERE id = ?', [ids.setor]);
      await e.executar('DELETE FROM preco_procedimento_valor WHERE preco_procedimento_id = ?', [ids.preco]);
      await e.executar('DELETE FROM preco_procedimento WHERE id = ?', [ids.preco]);
      await e.executar('DELETE FROM tabela_preco WHERE id = ?', [ids.tabela]);
      await e.executar('DELETE FROM item_faturavel WHERE id IN (?, ?)', [ids.item, ids.itemSemPreco]);
      await e.executar('DELETE FROM grupo_faturamento WHERE id = ?', [ids.grupo]);
      await e.executar('DELETE FROM atendimento WHERE id IN (?, ?)', [ids.atendimento, ids.atendimentoB]);
      await e.executar('DELETE FROM tipo_conta WHERE id = ?', [ids.tipoConta]);
      await e.executar('DELETE FROM carater_atendimento_tiss WHERE id = ?', [ids.carater]);
      await e.executar('DELETE FROM categoria_atendimento WHERE id = ?', [ids.categoria]);
      await e.executar('DELETE FROM fonte_pagadora WHERE id = ?', [ids.fonte]);
      await e.executar('DELETE FROM profissional WHERE id = ?', [ids.prof]);
      await e.executar('DELETE FROM paciente WHERE id = ?', [ids.paciente]);
      await e.executar('DELETE FROM pessoa_fisica WHERE id IN (?, ?)', [ids.pessoa, ids.pessoaProf]);
    });
    await nucleo.encerrar();
  });

  it('leituras: a conta na lista e no detalhe, os convênios, os tipos de pendência; outro estabelecimento não aparece', async () => {
    const l = await porta.contas(
      c,
      {
        situacao: null,
        convenios: null,
        ano: null,
        mes: null,
        tipoConta: 'I',
        termo: '',
        sus: false,
        altaAte: null,
        pagina: 0,
        porPagina: 50,
      },
      hoje,
    );
    expect(l.contas.map((x) => x.id)).toContain(ids.conta);
    expect(l.contas.map((x) => x.id)).not.toContain(ids.contaB);
    const d = await porta.conta(c, ids.conta, hoje);
    expect(d).toMatchObject({ id: ids.conta, situacao: 'aberta', fechada: 'N', tipoConta: 'I', itens: 0 });
    expect(d?.preVooFechamento?.codigo).toBe('conta-sem-itens');
    expect(await porta.conta(c, ids.contaB, hoje)).toBeNull();
    expect((await porta.convenios(c)).map((x) => x.codigo)).toContain(ids.fonte);
    expect((await porta.tiposPendencia(c)).map((x) => x.id)).toContain(ids.tipoPend);
    expect(await porta.convenioDaConta(c, ids.conta)).toBe(ids.fonte);
    expect(await porta.convenioDaConta(c, ids.contaB)).toBeNull();
    expect(await porta.hoje(c)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lançar item: preço da tabela, total da conta recalculado, versão, trilha e outbox; sem preço e manual fora da faixa recusados', async () => {
    const antes = Number((await contaLida())?.['versao']);
    const base = {
      conta: ids.conta,
      tipo: 3,
      codigo: 82_080_001,
      quantidade: 2,
      data: hoje,
      hora: '10:30',
      local: 0,
      ato: 0,
    };
    const ctx = op();
    const r = await porta.executar(c, 'faturamento.lancarItem', base, ctx);
    expect(r.repetida).toBe(false);
    expect(r.resultado).toMatchObject({ conta: ids.conta, valor: 200 });
    const lida = await contaLida();
    expect(Number(lida?.['valor_total'])).toBe(200);
    expect(Number(lida?.['versao'])).toBe(antes + 1);
    expect(r.trilha).toBeGreaterThan(0);
    const mensagens = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-teste-02-08' }, (l) =>
      l.uma<{ n: number }>(
        "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'faturamento.item.lancado' AND entidade = 'conta_hospitalar_item' AND entidade_id = ?",
        [Number(r.resultado['id'])],
      ),
    );
    expect(Number(mensagens?.n)).toBe(1);
    // A mesma chave repete sem gravar de novo.
    const rep = await porta.executar(c, 'faturamento.lancarItem', base, ctx);
    expect(rep.repetida).toBe(true);
    expect(Number((await contaLida())?.['valor_total'])).toBe(200);
    expect(
      codigoDe(
        await erroDe(porta.executar(c, 'faturamento.lancarItem', { ...base, codigo: 82_080_002 }, op())),
      ),
    ).toBe('item-fora-da-tabela');
    const memoria = await lerUma(
      'SELECT tabela_preco_id, valor_unitario_calculado, preco_manual, operacao FROM conta_hospitalar_item_memoria WHERE conta_hospitalar_item_id = ?',
      [Number(r.resultado['id'])],
    );
    expect(memoria).toMatchObject({ tabela_preco_id: ids.tabela, operacao: 'inclusao' });
    expect(Number(memoria?.['valor_unitario_calculado'])).toBe(100);
    expect(Number(memoria?.['preco_manual'])).toBe(0);
    const fora = await erroDe(
      porta.executar(
        c,
        'faturamento.lancarItem',
        { ...base, precoManual: { unitario: 500, justificativa: 'teste sintético', aprovador: null } },
        op(),
      ),
    );
    expect(codigoDe(fora)).toBe('preco-fora-da-faixa');
    const itens = await porta.itens(c, ids.conta, { pagina: 0, porPagina: 50 });
    expect(itens.itens).toHaveLength(1);
    expect(itens.itens[0]).toMatchObject({
      codigo: 82_080_001,
      quantidade: 2,
      unitario: 100,
      valor: 200,
      tipo: 3,
      hora: '10:30',
    });
    const exp = await porta.explicar(c, itens.itens[0]!.id);
    expect(exp).toMatchObject({ calculado: 200, gravado: 200, confere: true });
  });

  it('conferir itens: versão velha é conflito; a certa marca conferido e registra a etapa', async () => {
    const [item] = (await porta.itens(c, ids.conta, { pagina: 0, porPagina: 50 })).itens;
    const velho = await erroDe(
      porta.executar(
        c,
        'faturamento.conferirItem',
        { conta: ids.conta, itens: [{ id: item!.id, versao: versaoTexto(99) }] },
        op(),
      ),
    );
    expect(codigoDe(velho)).toBe('conflito-versao');
    await porta.executar(
      c,
      'faturamento.conferirItem',
      { conta: ids.conta, itens: [{ id: item!.id, versao: item!.versao }] },
      op(),
    );
    const depois = await porta.itens(c, ids.conta, { pagina: 0, porPagina: 50, naoConferidos: true });
    expect(depois.total).toBe(0);
    const d = await porta.conta(c, ids.conta, hoje);
    expect(d?.etapas.map((e) => e.etapa)).toContain('conferencia-item');
  });

  it('pendência que bloqueia impede o fechamento; resolvida, a conta fecha (etapa, trilha e outbox) e reabre com motivo', async () => {
    const corr = `t0208-pend-${randomUUID().slice(0, 8)}`;
    const cc = { ...c, correlacao: corr };
    const pend = await porta.gravarSgh(
      cc,
      (id: number) => ({
        estabelecimento: ids.est,
        usuario: ids.usuario,
        acao: 'inclusao',
        entidade: 'pendencia_conta',
        entidadeId: id,
        correlacao: corr,
      }),
      (g) =>
        g.registrarPendencia({
          conta: ids.conta,
          tipo: ids.tipoPend,
          descricao: 'Falta laudo sintético',
          bloqueante: true,
          usuario: 'x',
        }),
    );
    expect(pend).toBeGreaterThan(0);
    expect((await trilhaDe(corr)).map((t) => t['entidade'])).toContain('pendencia_conta');
    expect(await porta.contaDaPendencia(c, pend)).toBe(ids.conta);
    const bloqueada = await erroDe(
      porta.executar(c, 'faturamento.fecharConta', { conta: ids.conta, versao: await versaoDaConta() }, op()),
    );
    expect(codigoDe(bloqueada)).toBe('pendencia-bloqueante');
    const r = await porta.gravarSgh(
      c,
      {
        estabelecimento: ids.est,
        usuario: ids.usuario,
        acao: 'alteracao',
        entidade: 'pendencia_conta',
        entidadeId: pend,
        correlacao: c.correlacao,
      },
      (g) => g.resolverPendencia({ id: pend, resolucao: 'Laudo anexado', usuario: 'x' }),
    );
    expect(r.conta).toBe(ids.conta);
    // Versão velha: conflito.
    const velha = await erroDe(
      porta.executar(c, 'faturamento.fecharConta', { conta: ids.conta, versao: versaoTexto(1) }, op()),
    );
    expect(codigoDe(velha)).toBe('conflito-versao');
    const f = await porta.executar(
      c,
      'faturamento.fecharConta',
      { conta: ids.conta, versao: await versaoDaConta() },
      op(),
    );
    expect(f.resultado).toEqual({ conta: ids.conta });
    expect((await contaLida())?.['situacao']).toBe('fechada');
    const fora = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-teste-02-08' }, (l) =>
      l.uma<{ n: number }>(
        "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'faturamento.conta.fechada' AND estabelecimento_id = ?",
        [ids.est],
      ),
    );
    expect(Number(fora?.n)).toBeGreaterThan(0);
    // C2-093 (ADR 0003): o fechamento publica o fato da receita da conta, pendente para a regra, pelo total fechado.
    const fatosDaConta = () =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-teste-c2-093' }, (l) =>
        l.consultar<Record<string, unknown>>(
          `SELECT f.id, ev.codigo, f.valor, f.estorno, f.estornado_fato_contabil_id AS estornado, f.situacao,
                  c.valor_total
             FROM fato_contabil f JOIN evento_contabil ev ON ev.id = f.evento_contabil_id
             JOIN conta_hospitalar c ON c.id = f.entidade_origem_id
            WHERE f.entidade_origem = 'conta_hospitalar' AND f.entidade_origem_id = ? AND f.estabelecimento_id = ?
            ORDER BY f.id`,
          [ids.conta, ids.est],
        ),
      );
    const receita = await fatosDaConta();
    expect(receita).toHaveLength(1);
    expect(receita[0]).toMatchObject({ codigo: 'receitaConta', situacao: 'pendente' });
    expect(Number(receita[0]!['estorno'])).toBe(0);
    expect(Number(receita[0]!['valor'])).toBe(Number(receita[0]!['valor_total']));
    const d = await porta.conta(c, ids.conta, hoje);
    expect(d).toMatchObject({ situacao: 'fechada', fechada: 'S', usuarioFechamento: 'l0208.teste' });
    expect(d?.etapas.map((e) => e.etapa)).toContain('fechamento');
    // Lançar na conta fechada é recusado.
    const lancar = await erroDe(
      porta.executar(
        c,
        'faturamento.lancarItem',
        {
          conta: ids.conta,
          tipo: 3,
          codigo: 82_080_001,
          quantidade: 1,
          data: hoje,
          hora: '10:00',
          local: 0,
          ato: 0,
        },
        op(),
      ),
    );
    expect(codigoDe(lancar)).toBe('conta-fechada');
    await porta.executar(
      c,
      'faturamento.reabrirConta',
      { conta: ids.conta, versao: await versaoDaConta(), motivo: 'Correção sintética' },
      op(),
    );
    expect((await contaLida())?.['situacao']).toBe('aberta');
    // A reabertura estorna a receita: o fato original fica e o estorno aponta para ele.
    const depois = await fatosDaConta();
    expect(depois).toHaveLength(2);
    expect(Number(depois[1]!['estorno'])).toBe(1);
    expect(Number(depois[1]!['estornado'])).toBe(Number(receita[0]!['id']));
    expect(Number(depois[1]!['valor'])).toBe(Number(receita[0]!['valor']));
  });

  it('etapas: iniciar e concluir a conferência; iniciar duas vezes é recusado', async () => {
    const t = {
      estabelecimento: ids.est,
      usuario: ids.usuario,
      acao: 'alteracao' as const,
      entidade: 'conta_hospitalar',
      entidadeId: ids.conta,
      correlacao: c.correlacao,
    };
    await porta.gravarSgh(c, t, (g) =>
      g.registrarEtapa({
        conta: ids.conta,
        etapa: 'conferencia',
        acao: 'iniciar',
        observacao: '',
        usuario: 'x',
      }),
    );
    expect((await contaLida())?.['situacao']).toBe('em_conferencia');
    const dup = await erroDe(
      porta.gravarSgh(c, t, (g) =>
        g.registrarEtapa({
          conta: ids.conta,
          etapa: 'conferencia',
          acao: 'iniciar',
          observacao: '',
          usuario: 'x',
        }),
      ),
    );
    expect(codigoDe(dup)).toBe('etapa-em-andamento');
    await porta.gravarSgh(c, t, (g) =>
      g.registrarEtapa({
        conta: ids.conta,
        etapa: 'conferencia',
        acao: 'concluir',
        observacao: 'ok',
        usuario: 'x',
      }),
    );
    expect((await contaLida())?.['situacao']).toBe('aberta');
  });

  it('auditoria: o parecer abre a auditoria da conta e grava a versão; a leitura traz versões e irregularidades', async () => {
    const t = (id: number) => ({
      estabelecimento: ids.est,
      usuario: ids.usuario,
      acao: 'inclusao' as const,
      entidade: 'auditoria_conta_versao',
      entidadeId: id,
      correlacao: c.correlacao,
    });
    const v = await porta.gravarSgh(c, t, (g) =>
      g.registrarVersaoAuditoria({
        conta: ids.conta,
        parecer: 'Parecer sintético',
        papel: 'medico',
        usuario: 'x',
      }),
    );
    expect(v).toBeGreaterThan(0);
    // O segundo parecer na mesma auditoria (enfermeiro depois do médico) não fere a unicidade (auditoria, momento).
    const v2 = await porta.gravarSgh(c, t, (g) =>
      g.registrarVersaoAuditoria({
        conta: ids.conta,
        parecer: 'Parecer sintético 2',
        papel: 'enfermeiro',
        usuario: 'x',
      }),
    );
    expect(v2).toBe(v);
    const a = await porta.auditoria(c, ids.conta);
    expect(a.versoes).toHaveLength(2);
    expect(a.versoes[0]).toMatchObject({
      papel: 'medico',
      parecer: 'Parecer sintético',
      itens: 1,
      usuario: 'l0208.teste',
    });
    expect(a.versoes[1]).toMatchObject({ papel: 'enfermeiro', parecer: 'Parecer sintético 2' });
    const momentos = await lerVarias(
      'SELECT momento, versao FROM auditoria_conta_versao WHERE conta_hospitalar_id = ? ORDER BY momento',
      [ids.conta],
    );
    expect(momentos.map((m) => [m['momento'], Number(m['versao'])])).toEqual([
      ['antes', 1],
      ['depois', 2],
    ]);
    expect(a.irregularidades.map((i) => i.tipo)).toContain(ids.tipoPend);
  });

  it('caixa: abre com o número da sequência, recusa o segundo aberto e fecha com a diferença', async () => {
    const t = (id: number) => ({
      estabelecimento: ids.est,
      usuario: ids.usuario,
      acao: 'inclusao' as const,
      entidade: 'sessao_caixa',
      entidadeId: id,
      correlacao: c.correlacao,
    });
    const id = await porta.gravarSgh(c, t, (g) => g.abrirCaixa({ usuario: 'x', saldoInicial: 50 }));
    expect(
      codigoDe(await erroDe(porta.gravarSgh(c, t, (g) => g.abrirCaixa({ usuario: 'x', saldoInicial: 0 })))),
    ).toBe('caixa-ja-aberto');
    const f = await porta.gravarSgh(c, { ...t(id), acao: 'alteracao' }, (g) =>
      g.fecharCaixa({ usuario: 'x', id, contado: 45 }),
    );
    expect(f.esperado).toBe(50);
    const [cx] = await porta.caixas(c, 'l0208.teste');
    expect(cx).toMatchObject({ id, saldoInicial: 50, contado: 45, diferenca: -5 });
  });

  it('conta C: preço manual com aprovador e setor na memória do cálculo; competência fechada barra lançar e fechar', async () => {
    const cc = { ...c, correlacao: 'teste-02-08-c' };
    const base = {
      conta: ids.contaC,
      tipo: 3,
      codigo: 82_080_001,
      quantidade: 1,
      data: hoje,
      hora: '09:00',
      local: 0,
      ato: 0,
    };
    const manual = {
      unitario: 500,
      justificativa: 'Material especial sintético',
      aprovador: 'l0208.supervisor',
    };
    const r = await porta.executar(
      cc,
      'faturamento.lancarItem',
      { ...base, local: ids.setor, ato: 2, precoManual: manual },
      op(cc),
    );
    const item = Number(r.resultado['id']);
    expect(
      await lerUma('SELECT setor_funcional_id, tipo_valorizacao FROM conta_hospitalar_item WHERE id = ?', [
        item,
      ]),
    ).toMatchObject({
      setor_funcional_id: ids.setor,
      tipo_valorizacao: 'manual',
    });
    const m = await lerUma(
      'SELECT tabela_preco_id, preco_manual, valor_unitario_calculado, dados FROM conta_hospitalar_item_memoria WHERE conta_hospitalar_item_id = ?',
      [item],
    );
    expect(Number(m?.['preco_manual'])).toBe(1);
    expect(Number(m?.['valor_unitario_calculado'])).toBe(100);
    const dados = typeof m?.['dados'] === 'string' ? JSON.parse(m['dados']) : m?.['dados'];
    expect(dados).toMatchObject({ manual: manual, ato: 2, vigencia: '2020-01-01' });
    // Setor de fora do estabelecimento: recusado.
    expect(
      codigoDe(await erroDe(porta.executar(cc, 'faturamento.lancarItem', { ...base, local: 9999 }, op(cc)))),
    ).toBe('setor-inexistente');
    // Competência do faturamento de convênios fechada: lançar e fechar recusam.
    await escrever(
      "INSERT INTO competencia_faturamento (estabelecimento_id, modulo, competencia, situacao, aberta_em, fechada_em, criado_em) VALUES (?, 'fonte_pagadora', ?, 'fechada', NOW(3), NOW(3), NOW(3))",
      [ids.est, competencia],
    );
    expect(codigoDe(await erroDe(porta.executar(cc, 'faturamento.lancarItem', base, op(cc))))).toBe(
      'competencia-fechada',
    );
    const versaoC = async () =>
      versaoTexto(
        Number((await lerUma('SELECT versao FROM conta_hospitalar WHERE id = ?', [ids.contaC]))?.['versao']),
      );
    expect(
      codigoDe(
        await erroDe(
          porta.executar(
            cc,
            'faturamento.fecharConta',
            { conta: ids.contaC, versao: await versaoC() },
            op(cc),
          ),
        ),
      ),
    ).toBe('competencia-fechada');
    // O fechamento da própria fonte decide quando existe: reaberto para a fonte, a conta fecha.
    await escrever(
      `INSERT INTO fechamento_competencia_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, competencia, data_abertura,
         situacao, fechado_em, reaberto_em, motivo_reabertura, criado_em)
       VALUES (?, ?, ?, ?, 'reaberta', NOW(3), NOW(3), 'Reabertura sintética', NOW(3))`,
      [ids.est, ids.fonte, competencia, competencia],
    );
    await porta.executar(
      cc,
      'faturamento.fecharConta',
      { conta: ids.contaC, versao: await versaoC() },
      op(cc),
    );
    expect(
      (await lerUma('SELECT situacao FROM conta_hospitalar WHERE id = ?', [ids.contaC]))?.['situacao'],
    ).toBe('fechada');
    await escrever('DELETE FROM competencia_faturamento WHERE estabelecimento_id = ?', [ids.est]);
    await escrever('DELETE FROM fechamento_competencia_fonte_pagadora WHERE estabelecimento_id = ?', [
      ids.est,
    ]);
  });

  it('pendência: o tipo define o bloqueio (a tela só endurece), sem responsável fixado; conta enviada recusa', async () => {
    const t = (id: number) => ({
      estabelecimento: ids.est,
      usuario: ids.usuario,
      acao: 'inclusao' as const,
      entidade: 'pendencia_conta',
      entidadeId: id,
      correlacao: c.correlacao,
    });
    const impede = await porta.gravarSgh(c, t, (g) =>
      g.registrarPendencia({
        conta: ids.contaC,
        tipo: ids.tipoPend,
        descricao: 'Tipo que impede',
        bloqueante: false,
        usuario: 'x',
      }),
    );
    const alerta = await porta.gravarSgh(c, t, (g) =>
      g.registrarPendencia({
        conta: ids.contaC,
        tipo: ids.tipoPendAlerta,
        descricao: 'Só alerta',
        bloqueante: false,
        usuario: 'x',
      }),
    );
    const endurecida = await porta.gravarSgh(c, t, (g) =>
      g.registrarPendencia({
        conta: ids.contaC,
        tipo: ids.tipoPendAlerta,
        descricao: 'Alerta endurecido',
        bloqueante: true,
        usuario: 'x',
      }),
    );
    const linhas = await lerVarias(
      `SELECT id, bloqueia_fechamento, responsavel_usuario_id FROM pendencia_conta WHERE id IN (?, ?, ?) ORDER BY id`,
      [impede, alerta, endurecida],
    );
    expect(linhas.map((x) => Number(x['bloqueia_fechamento']))).toEqual([1, 0, 1]);
    expect(linhas.every((x) => x['responsavel_usuario_id'] === null)).toBe(true);
    await escrever("UPDATE conta_hospitalar SET situacao = 'enviada' WHERE id = ?", [ids.contaC]);
    const recusada = await erroDe(
      porta.gravarSgh(c, t, (g) =>
        g.registrarPendencia({
          conta: ids.contaC,
          tipo: ids.tipoPend,
          descricao: 'Depois do envio',
          bloqueante: true,
          usuario: 'x',
        }),
      ),
    );
    expect(codigoDe(recusada)).toBe('conta-encerrada');
  });

  it('pagamentos e caixa: a forma da tela vira a espécie do banco e volta (filtro, lista e totais por forma)', async () => {
    await escrever(
      'INSERT INTO sessao_caixa (estabelecimento_id, caixa_id, numero, operador_usuario_id, aberta_em, total_cartao_credito, total_cheque, criado_em) VALUES (?, ?, 9020801, ?, NOW(3), 30, 5, NOW(3))',
      [ids.est, ids.caixa, ids.usuario],
    );
    const sessao = Number(
      (
        await lerUma('SELECT id FROM sessao_caixa WHERE estabelecimento_id = ? AND numero = 9020801', [
          ids.est,
        ])
      )?.['id'],
    );
    await escrever(
      "INSERT INTO movimento_caixa (estabelecimento_id, sessao_caixa_id, tipo_movimento_caixa_id, natureza, ocorrido_em, especie, valor, descricao, criado_em) VALUES (?, ?, ?, 'entrada', NOW(3), 'cartao_credito', 30, 'Recebimento sintético', NOW(3))",
      [ids.est, sessao, ids.tipoMov],
    );
    const cartao = await porta.pagamentos(c, {
      caixa: sessao,
      forma: 'cartao-credito',
      situacao: null,
      desde: null,
      ate: null,
    });
    expect(cartao.map((x) => x.forma)).toEqual(['cartao-credito']);
    expect(
      await porta.pagamentos(c, { caixa: sessao, forma: 'pix', situacao: null, desde: null, ate: null }),
    ).toEqual([]);
    const cx = (await porta.caixas(c, null)).find((x) => x.id === sessao);
    expect(cx?.porForma).toEqual({ 'cartao-credito': 30, outras: 5 });
    expect(await porta.contaParticular(c, ids.conta)).toBe(false);
  });

  it('outro estabelecimento: a conta de lá não fecha daqui (404); entrada inválida é 400', async () => {
    const outra = await erroDe(
      porta.executar(c, 'faturamento.fecharConta', { conta: ids.contaB, versao: versaoTexto(1) }, op()),
    );
    expect(outra.problema.status).toBe(404);
    const invalida = await erroDe(
      porta.executar(c, 'faturamento.fecharConta', { conta: ids.conta, versao: 'x' }, op()),
    );
    expect(invalida.problema.status).toBe(400);
  });

  const trilha = (entidade: string, acao: 'inclusao' | 'alteracao' = 'inclusao') => ({
    estabelecimento: ids.est,
    usuario: ids.usuario,
    acao,
    entidade,
    entidadeId: null,
    correlacao: c.correlacao,
  });
  const fila = (convenios: readonly number[] | null = null) =>
    porta.tardios(c, { desde: '1900-01-01', convenios, pagina: 0, porPagina: 50 });

  it('fila do lançamento após o fechamento: lê a fila do estabelecimento e grava a decisão uma vez só', async () => {
    await escrever(
      'INSERT INTO decisao_lancamento_tardio (estabelecimento_id, conta_hospitalar_id, atendimento_id, chegou_em, criado_em) VALUES (?, ?, ?, NOW(3), NOW(3))',
      [ids.est, ids.conta, ids.atendimento],
    );
    const antes = await fila();
    expect(antes.total).toBe(1);
    const reg = antes.itens[0]!;
    expect(reg).toMatchObject({ conta: ids.conta, convenio: ids.fonte, decisao: null, decididoPor: null });
    expect((await fila([])).total).toBe(0);
    const painel = await porta.painelLancamentos(c, {
      ano: Number(hoje.slice(0, 4)),
      mes: Number(hoje.slice(5, 7)),
      desde: '1900-01-01',
      convenios: null,
    });
    expect(painel).toMatchObject({ totalTardios: 1, pendentesDecisao: 1 });
    const t = trilha('decisao_lancamento_tardio', 'alteracao');
    const decidir = () =>
      porta.gravarSgh(c, t, (g) =>
        g.decidirLancamentoTardio({
          registro: reg.registro,
          decisao: 'descartar',
          motivo: 'Lançamento sintético repetido',
          usuario: 'x',
          conta: ids.conta,
        }),
      );
    expect(await decidir()).toBe(reg.registro);
    const depois = (await fila()).itens[0];
    expect(depois).toMatchObject({ decisao: 'descartar', motivo: 'Lançamento sintético repetido' });
    expect(depois?.decididoPor).toBeTruthy();
    expect(codigoDe(await erroDe(decidir()))).toBe('ja-decidido');
  });

  it('regras de faturabilidade: grava, lê de volta com o seletor, edita e recusa o nome repetido', async () => {
    const t = trilha('regra_faturabilidade');
    const regra = {
      convenio: ids.fonte,
      nome: `${P} carteira válida`,
      exige: 'carteira-valida' as const,
      seletor: { tipoConta: 'I' as const, grupos: ['sadt' as const], codigos: [82_080_001] },
      acao: 'avisar' as const,
      bloqueiaFechamento: true,
      inicio: '2026-01-01',
      fim: null,
    };
    const id = await porta.gravarSgh(c, t, (g) =>
      g.editarRegra({ id: null, regra, ativa: true, usuario: 'x' }),
    );
    expect((await porta.regras(c)).find((r) => r.id === id)).toMatchObject({
      convenio: ids.fonte,
      exige: 'carteira-valida',
      seletor: { tipoConta: 'I', grupos: ['sadt'], codigos: [82_080_001] },
      bloqueiaFechamento: true,
      ativa: true,
      fim: null,
    });
    expect(
      await lerUma('SELECT exige, natureza_conta FROM regra_faturabilidade WHERE id = ?', [id]),
    ).toMatchObject({
      exige: 'carteira_valida',
      natureza_conta: 'internacao',
    });
    await porta.gravarSgh(c, t, (g) =>
      g.editarRegra({ id, regra: { ...regra, fim: '2026-12-31' }, ativa: false, usuario: 'x' }),
    );
    expect((await porta.regras(c)).find((r) => r.id === id)).toMatchObject({
      fim: '2026-12-31',
      ativa: false,
    });
    const dup = await erroDe(
      porta.gravarSgh(c, t, (g) => g.editarRegra({ id: null, regra, ativa: true, usuario: 'x' })),
    );
    expect(codigoDe(dup)).toBe('regra-duplicada');
  });

  it('pacote pela tela: cria para a fonte pagadora, edita valor e itens, e recusa item inexistente', async () => {
    const t = trilha('pacote_contrato');
    const semPreco = Number(
      (await lerUma('SELECT codigo FROM item_faturavel WHERE id = ?', [ids.itemSemPreco]))?.['codigo'],
    );
    const base = {
      convenio: ids.fonte,
      codigo: 82_080_001,
      nome: 'PACOTE SINTETICO L0208',
      valor: 500,
      inicio: '2026-01-01',
      fim: null,
      itens: [{ codigo: semPreco, quantidade: 2 }],
      ativo: true,
    };
    const id = await porta.gravarSgh(c, t, (g) => g.editarPacote({ ...base, id: null, usuario: 'x' }));
    expect((await porta.pacotes(c)).find((x) => x.id === id)).toMatchObject({
      convenio: ids.fonte,
      codigo: 82_080_001,
      valor: 500,
      ativo: true,
      itens: [{ codigo: semPreco, quantidade: 2 }],
    });
    await porta.gravarSgh(c, t, (g) =>
      g.editarPacote({ ...base, id, valor: 650, itens: [], ativo: false, usuario: 'x' }),
    );
    expect((await porta.pacotes(c)).find((x) => x.id === id)).toMatchObject({
      valor: 650,
      ativo: false,
      itens: [],
    });
    const sem = await erroDe(
      porta.gravarSgh(c, t, (g) =>
        g.editarPacote({ ...base, id: null, itens: [{ codigo: 99_999_998, quantidade: 1 }], usuario: 'x' }),
      ),
    );
    expect(codigoDe(sem)).toBe('item-inexistente');
  });

  it('pacote da rede: o estabelecimento grava só o valor da fonte pagadora; nome, situação e itens são recusados', async () => {
    const t = trilha('pacote_contrato');
    const semPreco = Number(
      (await lerUma('SELECT codigo FROM item_faturavel WHERE id = ?', [ids.itemSemPreco]))?.['codigo'],
    );
    const pacotes = "SELECT id FROM pacote WHERE codigo = '82080001'";
    await escrever(`DELETE FROM pacote_item_incluso WHERE pacote_id IN (${pacotes})`, []);
    await escrever(`DELETE FROM pacote_contrato WHERE pacote_id IN (${pacotes})`, []);
    await escrever("DELETE FROM pacote WHERE codigo = '82080001'", []);
    const base = {
      convenio: ids.fonte,
      codigo: 82_080_001,
      nome: 'PACOTE SINTETICO DA REDE',
      valor: 500,
      inicio: '2026-01-01',
      fim: null,
      itens: [{ codigo: semPreco, quantidade: 2 }],
      ativo: true,
    };
    const id = await porta.gravarSgh(c, t, (g) => g.editarPacote({ ...base, id: null, usuario: 'x' }));
    await escrever("UPDATE pacote SET estabelecimento_id = NULL WHERE codigo = '82080001'", []);
    const pacoteDaRede = async () =>
      lerUma(
        `SELECT pa.descricao, pa.situacao, COUNT(pi.id) AS itens FROM pacote pa
           LEFT JOIN pacote_item_incluso pi ON pi.pacote_id = pa.id AND pi.excluido_em IS NULL
          WHERE pa.codigo = '82080001' GROUP BY pa.id, pa.descricao, pa.situacao`,
        [],
      );
    try {
      // Valor de outra fonte pagadora? Aqui, a mesma fonte com outro início, e o pacote da rede é reaproveitado.
      const novo = await porta.gravarSgh(c, t, (g) =>
        g.editarPacote({ ...base, id: null, inicio: '2026-06-01', valor: 700, usuario: 'x' }),
      );
      expect(novo).not.toBe(id);
      // Editar o valor de um contrato do pacote da rede passa.
      await porta.gravarSgh(c, t, (g) => g.editarPacote({ ...base, id, valor: 650, usuario: 'x' }));
      const mudancas = [
        { nome: 'PACOTE RENOMEADO' },
        { ativo: false },
        { itens: [] },
        { itens: [{ codigo: semPreco, quantidade: 3 }] },
      ];
      for (const m of mudancas) {
        for (const alvo of [null, id]) {
          const e = await erroDe(
            porta.gravarSgh(c, t, (g) =>
              g.editarPacote({ ...base, inicio: '2026-09-01', ...m, id: alvo, usuario: 'x' }),
            ),
          );
          expect(codigoDe(e)).toBe('pacote-da-rede');
        }
      }
      expect(await pacoteDaRede()).toMatchObject({ descricao: base.nome, situacao: 'ativo' });
      expect(Number((await pacoteDaRede())?.['itens'])).toBe(1);
      const valores = await lerVarias(
        `SELECT pc.valor FROM pacote_contrato pc JOIN pacote pa ON pa.id = pc.pacote_id
          WHERE pa.codigo = '82080001' AND pc.excluido_em IS NULL ORDER BY pc.vigencia_inicio`,
        [],
      );
      expect(valores.map((v) => Number(v['valor']))).toEqual([650, 700]);
    } finally {
      await escrever(
        'UPDATE pacote SET estabelecimento_id = ? WHERE codigo = ? AND estabelecimento_id IS NULL',
        [ids.est, '82080001'],
      );
    }
  });

  it('orçamento particular → recebimento no caixa com troco → recibo por extenso, uma vez só', async () => {
    const t = trilha('orcamento_particular');
    const item = { descricao: 'Consulta sintética', quantidade: 2, unitario: 60 };
    const orcar = (urgencia: boolean, exigeGarantiaAntes: boolean) =>
      porta.gravarSgh(c, t, (g) =>
        g.registrarOrcamento({
          prontuario: 0,
          nome: 'Interessado Sintetico',
          itens: [item],
          desconto: 20,
          validadeDias: 30,
          urgencia,
          exigeGarantiaAntes,
          usuario: 'x',
        }),
      );
    expect(codigoDe(await erroDe(orcar(true, true)))).toBe('caucao-proibida');
    const orc = await orcar(true, false);
    expect(orc.total).toBe(100);
    expect((await porta.orcamentos(c, hoje)).find((o) => o.id === orc.id)).toMatchObject({
      total: 100,
      desconto: 20,
      urgencia: true,
      situacao: 'aberto',
      pago: 0,
      itens: [item],
    });
    await escrever(
      "UPDATE sessao_caixa SET situacao = 'fechada', fechada_em = NOW(3) WHERE estabelecimento_id = ? AND situacao = 'aberta'",
      [ids.est],
    );
    const sessao = await porta.gravarSgh(c, t, (g) => g.abrirCaixa({ usuario: 'x', saldoInicial: 50 }));
    const r = await porta.gravarSgh(c, t, (g) =>
      g.receberParticular({
        caixa: sessao,
        orcamento: orc.id,
        conta: null,
        pagamentos: [
          { forma: 'pix', valor: 40, comprovante: 'PIX-SINT-1', parcelas: 1 },
          { forma: 'dinheiro', valor: 70, comprovante: null, parcelas: 1 },
        ],
        usuario: 'x',
        simulado: true,
      }),
    );
    expect(r.troco).toBe(10);
    expect(r.pagamentos).toHaveLength(2);
    expect((await porta.orcamentos(c, hoje)).find((o) => o.id === orc.id)).toMatchObject({
      situacao: 'pago',
      pago: 100,
    });
    expect((await porta.caixas(c, null)).find((x) => x.id === sessao)?.porForma).toEqual({
      dinheiro: 60,
      pix: 40,
    });
    const pags = await porta.pagamentos(c, {
      caixa: sessao,
      forma: null,
      situacao: null,
      desde: null,
      ate: null,
    });
    expect(pags.map((p) => [p.orcamento, p.recibo])).toEqual([
      [orc.id, null],
      [orc.id, null],
    ]);
    const emitir = () =>
      porta.gravarSgh(c, t, (g) =>
        g.emitirRecibo({
          usuario: 'x',
          pagamento: r.pagamentos[1]!,
          pagador: 'Pagador Sintetico',
          referente: 'Consulta sintética',
        }),
      );
    const rec = await emitir();
    expect(await lerUma('SELECT valor_extenso FROM recibo WHERE id = ?', [rec.id])).toMatchObject({
      valor_extenso: 'sessenta reais',
    });
    expect((await porta.recibos(c, false)).find((x) => x.id === rec.id)).toMatchObject({
      pagamento: r.pagamentos[1],
      valor: 60,
    });
    expect(codigoDe(await erroDe(emitir()))).toBe('recibo-emitido');
    const fechado = await porta.gravarSgh(c, t, (g) =>
      g.fecharCaixa({ usuario: 'x', id: sessao, contado: 110 }),
    );
    expect(fechado.esperado).toBe(110);
  });

  // F3.8 (07-FIN linha 89): o recebimento em cartão com a administradora e a bandeira grava a transação e as parcelas a
  // receber da administradora, na mesma transação do recebimento.
  it('recebimento em cartão de crédito parcelado: transação e parcelas a receber, líquidas da taxa vigente', async () => {
    const t = trilha('orcamento_particular');
    const BANDEIRA = `${P}-BAND-FAT`;
    const limparCartao = (e: Escritor) =>
      (async () => {
        await e.executar(
          'DELETE p FROM parcela_recebivel_cartao p JOIN transacao_cartao x ON x.id = p.transacao_cartao_id WHERE x.estabelecimento_id = ?',
          [ids.est],
        );
        await e.executar(
          'DELETE m FROM meio_recebimento_particular m JOIN transacao_cartao x ON x.id = m.transacao_cartao_id WHERE x.estabelecimento_id = ?',
          [ids.est],
        );
        await e.executar('DELETE FROM transacao_cartao WHERE estabelecimento_id = ?', [ids.est]);
        await e.executar('DELETE FROM taxa_administradora WHERE estabelecimento_id = ?', [ids.est]);
        await e.executar('DELETE FROM administradora_cartao WHERE estabelecimento_id = ?', [ids.est]);
        await e.executar('DELETE FROM bandeira_cartao WHERE codigo = ?', [BANDEIRA]);
      })();
    const cad = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f38-07' }, async (e) => {
      await limparCartao(e);
      const bandeira = await e.inserir(
        "INSERT INTO bandeira_cartao (codigo, descricao, modalidade, criado_em) VALUES (?, 'BANDEIRA SINTETICA', 'credito_debito', NOW(3))",
        [BANDEIRA],
      );
      const administradora = await e.inserir(
        "INSERT INTO administradora_cartao (estabelecimento_id, nome, permite_parcelamento, criado_em) VALUES (?, 'ADMINISTRADORA SINTETICA', TRUE, NOW(3))",
        [ids.est],
      );
      await e.inserir(
        `INSERT INTO taxa_administradora (estabelecimento_id, administradora_cartao_id, modalidade, parcela_inicial,
           parcela_final, tipo_taxa, percentual_taxa, dias_repasse, vigencia_inicio, criado_em)
         VALUES (?, ?, 'credito', 1, 12, 'percentual', 2, 30, '2026-01-01', NOW(3))`,
        [ids.est, administradora],
      );
      return { bandeira, administradora };
    });
    try {
      const orc = await porta.gravarSgh(c, t, (g) =>
        g.registrarOrcamento({
          prontuario: 0,
          nome: 'Interessado Sintetico',
          itens: [{ descricao: 'Consulta sintética', quantidade: 2, unitario: 50 }],
          desconto: 0,
          validadeDias: 30,
          urgencia: false,
          exigeGarantiaAntes: false,
          usuario: 'x',
        }),
      );
      await escrever(
        "UPDATE sessao_caixa SET situacao = 'fechada', fechada_em = NOW(3) WHERE estabelecimento_id = ? AND situacao = 'aberta'",
        [ids.est],
      );
      const sessao = await porta.gravarSgh(c, t, (g) => g.abrirCaixa({ usuario: 'x', saldoInicial: 0 }));
      const receber = (
        comprovante: string,
        cartao: { administradora: number; bandeira: number } | null,
        forma: 'cartao-credito' | 'cartao-debito' = 'cartao-credito',
      ) =>
        porta.gravarSgh(c, t, (g) =>
          g.receberParticular({
            caixa: sessao,
            orcamento: orc.id,
            conta: null,
            pagamentos: [
              {
                forma,
                valor: 100,
                comprovante,
                parcelas: forma === 'cartao-credito' ? 2 : 1,
                ...(cartao ? { cartao: { ...cartao, finalCartao: '4321' } } : {}),
              },
            ],
            usuario: 'x',
            simulado: true,
          }),
        );
      // Bandeira que não existe: nada do recebimento fica gravado (a mesma transação).
      expect(codigoDe(await erroDe(receber('CARTAO-SINT-0', { ...cad, bandeira: 999_999_999 })))).toBe(
        'bandeira-cartao-inexistente',
      );
      // Com administradora ativa no estabelecimento, o cartão sem administradora e bandeira é recusado (crédito e
      // débito): a venda não entra no caixa sem o que a administradora tem a creditar.
      expect(codigoDe(await erroDe(receber('CARTAO-SINT-0', null)))).toBe('cartao-sem-administradora');
      expect(codigoDe(await erroDe(receber('CARTAO-SINT-0', null, 'cartao-debito')))).toBe(
        'cartao-sem-administradora',
      );
      // O comprovante que não cabe inteiro é recusado, nunca cortado.
      expect(codigoDe(await erroDe(receber('C'.repeat(21), cad)))).toBe('comprovante-cartao-longo');
      const ler = (sql: string, p: unknown[]) =>
        nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f38-07' }, (l) => l.consultar(sql, p));
      expect(
        Number(
          (
            await ler(
              'SELECT COUNT(*) AS q FROM movimento_caixa WHERE sessao_caixa_id = ? AND natureza = ?',
              [sessao, 'entrada'],
            )
          )[0]?.['q'],
        ),
      ).toBe(0);
      const r = await receber('CARTAO-SINT-1', cad);
      expect(r.pagamentos).toHaveLength(1);
      const [tr] = await ler(
        `SELECT id, tipo_cartao, modalidade, quantidade_parcelas, nsu, final_cartao, valor_bruto, valor_taxa,
                valor_liquido, modulo_origem, sessao_caixa_id, situacao
           FROM transacao_cartao WHERE estabelecimento_id = ?`,
        [ids.est],
      );
      expect(tr).toMatchObject({
        tipo_cartao: 'credito',
        modalidade: 'parcelado_estabelecimento',
        quantidade_parcelas: 2,
        nsu: 'CARTAO-SINT-1',
        final_cartao: '4321',
        modulo_origem: 'caixa',
        sessao_caixa_id: sessao,
        situacao: 'autorizada',
      });
      expect([
        Number(tr?.['valor_bruto']),
        Number(tr?.['valor_taxa']),
        Number(tr?.['valor_liquido']),
      ]).toEqual([100, 2, 98]);
      // A ligação: o meio do recebimento do particular guarda a transação, a administradora e as parcelas; do
      // movimento do caixa chega-se à venda em cartão (e de volta) sem depender do texto do comprovante.
      const elo = await ler(
        `SELECT m.transacao_cartao_id, m.administradora_cartao_id, m.quantidade_parcelas, m.valor, m.nsu, m.sequencia,
                rp.movimento_caixa_id, rp.cartao_nsu, rp.cartao_parcelas
           FROM meio_recebimento_particular m JOIN recebimento_particular rp ON rp.id = m.recebimento_particular_id
          WHERE rp.movimento_caixa_id = ?`,
        [r.pagamentos[0]],
      );
      expect(elo).toHaveLength(1);
      expect(elo[0]).toMatchObject({
        transacao_cartao_id: tr?.['id'],
        administradora_cartao_id: cad.administradora,
        quantidade_parcelas: 2,
        nsu: 'CARTAO-SINT-1',
        sequencia: 1,
        cartao_nsu: 'CARTAO-SINT-1',
        cartao_parcelas: 2,
      });
      expect(Number(elo[0]?.['valor'])).toBe(100);
      expect(
        Number(
          (
            await ler('SELECT COUNT(*) AS q FROM transacao_cartao WHERE estabelecimento_id = ?', [ids.est])
          )[0]?.['q'],
        ),
      ).toBe(1);
      const ps = await ler(
        `SELECT sequencia, valor_bruto, valor_taxa, valor_liquido, situacao, DATEDIFF(data_prevista, CURDATE()) AS dias
           FROM parcela_recebivel_cartao WHERE transacao_cartao_id = ? ORDER BY sequencia`,
        [tr?.['id']],
      );
      expect(
        ps.map((x) => [
          Number(x['sequencia']),
          Number(x['valor_bruto']),
          Number(x['valor_taxa']),
          Number(x['valor_liquido']),
          x['situacao'],
        ]),
      ).toEqual([
        [1, 50, 1, 49, 'prevista'],
        [2, 50, 1, 49, 'prevista'],
      ]);
      expect(Number(ps[1]?.['dias']) - Number(ps[0]?.['dias'])).toBe(30);
      expect(Math.abs(Number(ps[0]?.['dias']) - 30)).toBeLessThanOrEqual(1);
      expect((await porta.caixas(c, null)).find((x) => x.id === sessao)?.porForma).toEqual({
        'cartao-credito': 100,
      });
      await porta.gravarSgh(c, t, (g) => g.fecharCaixa({ usuario: 'x', id: sessao, contado: 0 }));
    } finally {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f38-07' }, (e) => limparCartao(e));
    }
  });
});

// A mesma bateria de recusas na memória e no banco.
type Fabrica = () => Promise<{ porta: PortaFaturamento; c: ContextoFaturamento; fim: () => Promise<void> }>;
const fabricas: [string, Fabrica][] = [
  [
    'memória',
    async () => ({
      porta: new PortaFaturamentoMemoria(null),
      c: {
        cliente: 'teste',
        estabelecimento: null,
        usuario: null,
        correlacao: 'teste',
        rede: 'r',
        hospital: 'aa',
      },
      fim: async () => undefined,
    }),
  ],
  ...(SEM_BANCO
    ? []
    : ([
        [
          'banco',
          async () => {
            const nucleo = new NucleoProprio();
            const est = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-08' }, (l) =>
              l.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', [`${P}A`]),
            );
            return {
              porta: new PortaFaturamentoPropria(nucleo, CLIENTE),
              c: {
                cliente: CLIENTE,
                estabelecimento: est ? Number(est.id) : null,
                usuario: null,
                correlacao: 'teste',
                rede: 'r',
                hospital: `${P}A`,
              },
              fim: () => nucleo.encerrar(),
            };
          },
        ],
      ] as [string, Fabrica][])),
];

describe.each(fabricas)('recusas comuns da conta (%s)', (_nome, fabrica) => {
  let f: Awaited<ReturnType<Fabrica>>;
  beforeAll(async () => {
    f = await fabrica();
  });
  afterAll(async () => {
    await f.fim();
  });

  it('entrada inválida do fechamento é 400 com os campos', async () => {
    const e = await erroDe(
      f.porta.executar(
        f.c,
        'faturamento.fecharConta',
        { conta: 0, versao: 'curta' },
        {
          cliente: f.c.cliente,
          estabelecimento: f.c.estabelecimento,
          usuario: f.c.usuario,
          correlacao: 'teste',
          chaveIdempotencia: `t0208-${randomUUID()}`,
        },
      ),
    );
    expect(e.problema.status).toBe(400);
  });

  it('conta particular: conta inexistente é nula; a forma da tela volta como forma da tela', async () => {
    expect(await f.porta.contaParticular(f.c, 987_654_321)).toBeNull();
    const formas = await f.porta.pagamentos(f.c, {
      caixa: null,
      forma: 'cartao-credito',
      situacao: null,
      desde: null,
      ate: null,
    });
    expect(formas.every((x) => x.forma === 'cartao-credito')).toBe(true);
  });

  it('a liberação de uma operação conhecida responde; a desconhecida não grava', async () => {
    const p = await f.porta.podeGravar(f.c, 'faturamento.fecharConta');
    expect(typeof p.pode).toBe('boolean');
    await expect(
      f.porta.executar(
        f.c,
        'faturamento.inexistente',
        {},
        {
          cliente: f.c.cliente,
          estabelecimento: f.c.estabelecimento,
          usuario: f.c.usuario,
          correlacao: 'teste',
          chaveIdempotencia: `t0208-${randomUUID()}`,
        },
      ),
    ).rejects.toThrow();
  });
});
