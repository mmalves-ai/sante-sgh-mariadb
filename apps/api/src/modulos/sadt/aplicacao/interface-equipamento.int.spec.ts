// Contrato de efeito da interface com os equipamentos do laboratório (F3.5, 05-SADT linha 13) no MariaDB real (cliente
// f22_o2; massa SINTÉTICA). Prova o que fica no banco: a interface e o equipamento gravados juntos, com a trilha; o
// cadastro incoerente recusado com todos os campos, sem gravar; o de-para de exame e de analito (código repetido
// recusado); o pedido na fila de saída só com a amostra e os códigos (nenhum dado da pessoa); o resultado ASTM gravado no
// exame pedido pela regra da digitação, convertido pelo fator e pelas casas, marcado como vindo da interface e do
// equipamento; a mesma mensagem duas vezes não duplica; o código sem de-para deixa a mensagem em erro (sem valor no
// motivo) e o reprocessamento depois do de-para a conclui; outro estabelecimento não vê nem usa a interface. Saída só
// com contagens.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';
import {
  PONTO_PEDIDO_EQUIPAMENTO,
  PONTO_RESULTADO_EQUIPAMENTO,
  ServicoInterfaceEquipamento,
} from './interface-equipamento-propria.js';

const problemaDe = (e: unknown) =>
  e instanceof ErroOperacao
    ? { codigo: String(e.problema['codigo'] ?? ''), campos: (e.problema['campos'] as string[]) ?? [] }
    : { codigo: String(e), campos: [] };
const COR = { cliente: CLIENTE, correlacao: 't-l13eq' };

describe.skipIf(SEM_BANCO)('interface com o equipamento do laboratório (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoInterfaceEquipamento;
  let m: MassaSadt | null = null;
  let modelo = 0;
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente(COR, (l) => l.uma(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n'] ?? 0);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'E13');
    servico = new ServicoInterfaceEquipamento(nucleo);
    const mm = m;
    await nucleo.escrever(COR, async (e) => {
      await e.executar("DELETE FROM modelo_comunicacao WHERE codigo = 'ASTM-E13'");
      modelo = await e.inserir(
        `INSERT INTO modelo_comunicacao (codigo, descricao, ativo, meio, padrao_mensagem, sentido, modo, criado_em, versao)
         VALUES ('ASTM-E13', 'ASTM por rede (teste)', TRUE, 'rede', 'astm', 'bidirecional', 'online', ?, 1)`,
        [new Date()],
      );
      await e.executar("UPDATE exame_item SET situacao = 'em_analise' WHERE id = ?", [mm.itemLab]);
    });
  }, 60_000);

  afterAll(async () => {
    if (m) {
      const ests = [m.base.est, m.base.outroEst];
      await nucleo.escrever(COR, async (e) => {
        const x = (sql: string, p: unknown[]) => e.executar(sql, p);
        const eq = '(SELECT id FROM equipamento_analitico WHERE estabelecimento_id IN (?, ?))';
        await x(
          `UPDATE resultado_analito SET equipamento_analitico_id = NULL WHERE equipamento_analitico_id IN ${eq}`,
          ests,
        );
        await x(
          `UPDATE resultado_exame SET equipamento_analitico_id = NULL WHERE equipamento_analitico_id IN ${eq}`,
          ests,
        );
        await x(
          `DELETE FROM integracao_mensagem WHERE entidade = 'interface_equipamento'
             AND entidade_id IN (SELECT id FROM interface_equipamento WHERE estabelecimento_id IN (?, ?))`,
          ests,
        );
        await x(`DELETE FROM de_para_exame_equipamento WHERE equipamento_analitico_id IN ${eq}`, ests);
        await x(`DELETE FROM de_para_analito_equipamento WHERE equipamento_analitico_id IN ${eq}`, ests);
        await x('DELETE FROM interface_equipamento WHERE estabelecimento_id IN (?, ?)', ests);
        await x('DELETE FROM equipamento_analitico WHERE estabelecimento_id IN (?, ?)', ests);
      });
    }
    await limparMassaSadt(nucleo, m);
    await nucleo.escrever(COR, (e) => e.executar("DELETE FROM modelo_comunicacao WHERE codigo = 'ASTM-E13'"));
    await nucleo.encerrar();
  }, 60_000);

  it('cadastra, liga o de-para, envia o pedido e recebe o resultado pela fila, sem duplicar nem perder', async () => {
    const c = contexto(m!);
    const est = m!.base.est;
    const entrada = {
      codigo: 'BIOQ-E13',
      descricao: 'Bioquímica E13',
      modelo,
      protocolo: 'astm',
      sentido: 'bidirecional',
      host: '10.0.0.9',
      porta: 5000,
      equipamento: { codigo: 'EQ-E13', descricao: 'Analisador E13', setor: m!.setorLab },
    };

    // Cadastro incoerente: todos os campos de uma vez, nada gravado.
    const invalida = await servico
      .salvar(c, {
        ...entrada,
        sentido: 'unidirecional',
        host: null,
        porta: null,
        equipamento: { codigo: 'EQ-E13', descricao: 'Analisador E13', setor: null },
      })
      .catch(problemaDe);
    expect(invalida).toMatchObject({ codigo: 'interface-invalida' });
    expect((invalida as { campos: string[] }).campos).toEqual(
      expect.arrayContaining(['enviaListaTrabalho', 'host', 'porta', 'equipamento.setor']),
    );
    expect(
      await contar('SELECT COUNT(*) n FROM interface_equipamento WHERE estabelecimento_id = ?', [est]),
    ).toBe(0);
    expect(
      await contar('SELECT COUNT(*) n FROM equipamento_analitico WHERE estabelecimento_id = ?', [est]),
    ).toBe(0);

    // Cadastro certo: a interface e o equipamento novo na mesma gravação, com a trilha.
    const { id } = await servico.salvar(c, entrada);
    const linha = await um(
      `SELECT i.protocolo, i.sentido, i.porta, i.ativo, i.envia_lista_trabalho, i.equipamento_analitico_id AS eq,
              e.setor_diagnostico_id AS setor, e.situacao
         FROM interface_equipamento i JOIN equipamento_analitico e ON e.id = i.equipamento_analitico_id WHERE i.id = ?`,
      [id],
    );
    expect(linha).toMatchObject({ protocolo: 'astm', sentido: 'bidirecional', situacao: 'ativo' });
    expect(Number(linha?.['porta'])).toBe(5000);
    expect(Number(linha?.['setor'])).toBe(m!.setorLab);
    const equipamento = Number(linha?.['eq']);
    expect(
      await contar(
        "SELECT COUNT(*) n FROM trilha_auditoria WHERE entidade = 'interface_equipamento' AND entidade_id = ?",
        [id],
      ),
    ).toBe(1);
    // O mesmo código outra vez é recusado; outro estabelecimento não vê a interface nem a usa.
    expect(await servico.salvar(c, entrada).catch(problemaDe)).toMatchObject({ codigo: 'codigo-repetido' });
    const outro = contexto(m!, m!.base.outroEst);
    expect((await servico.listar(outro)).map((i) => i.id)).not.toContain(id);
    expect(await servico.dePara(outro, id).catch(problemaDe)).toMatchObject({
      codigo: 'interface-inexistente',
    });

    // Sem de-para, o pedido não sai (nada na fila).
    expect(await servico.enviarPedido(c, id, { itens: [m!.itemLab] }).catch(problemaDe)).toMatchObject({
      codigo: 'sem-de-para',
    });
    expect(
      await contar(
        "SELECT COUNT(*) n FROM integracao_mensagem WHERE entidade = 'interface_equipamento' AND entidade_id = ?",
        [id],
      ),
    ).toBe(0);

    // De-para: o exame e o analito (fator 10, uma casa); o código de analito repetido é recusado.
    await servico.salvarDeParaExame(c, id, { exame: m!.exameLab, codigo: 'GLI' });
    expect(
      await servico.salvarDeParaExame(c, id, { exame: m!.exameLab, codigo: 'GLI2' }).catch(problemaDe),
    ).toMatchObject({ codigo: 'de-para-invalido', campos: ['exame'] });
    const dpa = await servico.salvarDeParaAnalito(c, id, {
      analito: m!.analito,
      codigo: 'GLU',
      fator: 10,
      casas: 1,
    });
    expect(
      await servico
        .salvarDeParaAnalito(c, id, { analito: m!.analito, codigo: 'GLU', fator: 0, casas: 9 })
        .catch(problemaDe),
    ).toEqual({ codigo: 'de-para-invalido', campos: ['codigo', 'fator', 'casas'] });
    expect(
      await contar(
        'SELECT COUNT(*) n FROM de_para_exame_equipamento WHERE equipamento_analitico_id = ? AND ativo = TRUE',
        [equipamento],
      ),
    ).toBe(1);
    expect(
      await contar(
        'SELECT COUNT(*) n FROM de_para_analito_equipamento WHERE equipamento_analitico_id = ? AND fator_conversao = 10 AND casas_decimais = 1',
        [equipamento],
      ),
    ).toBe(1);

    // Pedido: uma mensagem pendente na fila de saída, com a amostra e o código; nenhum dado da pessoa.
    const pedido = await servico.enviarPedido(c, id, { itens: [m!.itemLab] });
    expect(pedido).toMatchObject({ enviados: 1, semDePara: [] });
    const saida = await um(
      'SELECT ponto, direcao, situacao, referencia_externa, conteudo FROM integracao_mensagem WHERE id = ?',
      [pedido.mensagens[0]],
    );
    expect(saida).toMatchObject({ ponto: PONTO_PEDIDO_EQUIPAMENTO, direcao: 'saida', situacao: 'pendente' });
    const amostra = String(saida?.['referencia_externa']);
    const conteudo = JSON.parse(String(saida?.['conteudo'])) as Record<string, unknown>;
    expect(Object.keys(conteudo).sort()).toEqual([
      'amostra',
      'astm',
      'interface',
      'itens',
      'protocolo',
      'testes',
      'urgente',
    ]);
    expect(conteudo['testes']).toEqual([{ item: m!.itemLab, codigo: 'GLI' }]);
    expect(String(conteudo['astm'])).toContain(`O|1|${amostra}||^^^GLI|`);
    expect(String(conteudo['astm'])).toContain('\rP|1\r');

    // Resultado ASTM: 1,23 no equipamento vira 12,3 na unidade local, no exame pedido, vindo da interface.
    const astm = (codigos: string) => `H|\\^&\rP|1\rO|1|${amostra}\r${codigos}L|1|N\r`;
    const r1 = await servico.receberResultado(c, id, {
      chaveMensagem: 'MSG-1',
      astm: astm('R|1|^^^GLU|1,23\r'),
    });
    expect(r1).toMatchObject({
      situacao: 'processada',
      duplicada: false,
      gravados: [m!.itemLab],
      pendencias: [],
    });
    const res = await um(
      `SELECT r.id, r.forma_entrada, r.situacao, r.equipamento_analitico_id AS eq, a.valor_numerico AS v,
              a.equipamento_analitico_id AS eqa
         FROM resultado_exame r JOIN resultado_analito a ON a.resultado_exame_id = r.id AND a.analito_id = ?
        WHERE r.exame_item_id = ?`,
      [m!.analito, m!.itemLab],
    );
    expect(res).toMatchObject({ forma_entrada: 'interface', situacao: 'digitado' });
    expect(Number(res?.['v'])).toBe(12.3);
    expect(Number(res?.['eq'])).toBe(equipamento);
    expect(Number(res?.['eqa'])).toBe(equipamento);
    expect(
      await um(
        'SELECT situacao, tentativas, erro, processada_em IS NOT NULL AS p FROM integracao_mensagem WHERE id = ?',
        [r1.mensagem],
      ),
    ).toMatchObject({ situacao: 'processada', erro: null });

    // A mesma mensagem outra vez: não duplica (uma mensagem de entrada, um resultado, o mesmo valor).
    const r2 = await servico.receberResultado(c, id, {
      chaveMensagem: 'MSG-1',
      astm: astm('R|1|^^^GLU|9,99\r'),
    });
    expect(r2).toMatchObject({ mensagem: r1.mensagem, duplicada: true });
    const entradas = () =>
      contar(
        "SELECT COUNT(*) n FROM integracao_mensagem WHERE entidade = 'interface_equipamento' AND entidade_id = ? AND direcao = 'entrada' AND ponto = ?",
        [id, PONTO_RESULTADO_EQUIPAMENTO],
      );
    expect(await entradas()).toBe(1);
    expect(
      await contar(
        'SELECT COUNT(*) n FROM resultado_analito WHERE resultado_exame_id = ? AND valor_numerico = 12.3',
        [res?.['id']],
      ),
    ).toBe(1);

    // Código sem de-para: a mensagem fica em erro com o código (nunca o valor) e nada se perde.
    await servico.salvarDeParaAnalito(c, id, {
      id: dpa.id,
      versao: 1,
      analito: m!.analito,
      codigo: 'GLU',
      fator: 10,
      casas: 1,
      ativo: false,
    });
    const r3 = await servico.receberResultado(c, id, {
      chaveMensagem: 'MSG-2',
      astm: astm('R|1|^^^GLU|2,00\r'),
    });
    expect(r3).toMatchObject({ situacao: 'erro', gravados: [], pendencias: ['codigo-sem-de-para:GLU'] });
    const emErro = await um('SELECT situacao, erro FROM integracao_mensagem WHERE id = ?', [r3.mensagem]);
    expect(emErro).toMatchObject({ situacao: 'erro', erro: 'codigo-sem-de-para:GLU' });
    expect((await servico.listar(c)).find((i) => i.id === id)).toMatchObject({
      resultadosComErro: 1,
      pedidosNaFila: 1,
      examesComCodigo: 1,
      analitosComCodigo: 0,
    });

    // Corrigido o de-para, o reprocessamento conclui a mensagem e grava o valor novo no mesmo resultado.
    await servico.salvarDeParaAnalito(c, id, {
      id: dpa.id,
      versao: 2,
      analito: m!.analito,
      codigo: 'GLU',
      fator: 10,
      casas: 1,
    });
    const r4 = await servico.reprocessar(c, id, r3.mensagem);
    expect(r4).toMatchObject({ situacao: 'processada', gravados: [m!.itemLab] });
    expect(
      await um('SELECT situacao, tentativas, erro FROM integracao_mensagem WHERE id = ?', [r3.mensagem]),
    ).toMatchObject({ situacao: 'processada', tentativas: 2, erro: null });
    expect(
      await contar(
        'SELECT COUNT(*) n FROM resultado_analito WHERE resultado_exame_id = ? AND valor_numerico = 20',
        [res?.['id']],
      ),
    ).toBe(1);
    expect(await contar('SELECT COUNT(*) n FROM resultado_exame WHERE exame_item_id = ?', [m!.itemLab])).toBe(
      1,
    );
    expect(await servico.reprocessar(c, id, r3.mensagem).catch(problemaDe)).toMatchObject({
      codigo: 'mensagem-fechada',
    });

    // Amostra que ninguém pediu: fica em erro como amostra desconhecida. Interface inativa não trafega.
    const r5 = await servico.receberResultado(c, id, {
      chaveMensagem: 'MSG-3',
      amostra: 'NAO-EXISTE',
      leituras: [{ codigo: 'GLU', valor: '1' }],
    });
    expect(r5).toMatchObject({ situacao: 'erro', pendencias: ['amostra-desconhecida'] });
    const atual = (await servico.listar(c)).find((i) => i.id === id)!;
    await servico.salvar(c, {
      ...entrada,
      id,
      versao: atual.versao,
      ativo: false,
      equipamento: { id: equipamento },
    });
    expect(
      await servico
        .receberResultado(c, id, { chaveMensagem: 'MSG-4', astm: astm('R|1|^^^GLU|1\r') })
        .catch(problemaDe),
    ).toMatchObject({ codigo: 'interface-inativa' });
    expect(await servico.enviarPedido(c, id, { itens: [m!.itemLab] }).catch(problemaDe)).toMatchObject({
      codigo: 'interface-inativa',
    });
    expect(await entradas()).toBe(3);
    expect((await servico.mensagens(c, id)).length).toBe(4);
  }, 180_000);
});
