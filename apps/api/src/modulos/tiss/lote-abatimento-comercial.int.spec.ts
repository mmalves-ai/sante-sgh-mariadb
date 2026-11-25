// Contrato de efeito da ligação da regra comercial com a TISS (F8, 06-FAT linha 19, C2-043) contra o MariaDB real
// (cliente f22_o3). Massa SINTÉTICA com códigos "L0343" (nenhuma pessoa real); preparo igual ao da porta própria do
// pós-fechamento. Uma conta com franquia do contrato e desconto por volume aplicados (linhas vivas em
// conta_hospitalar_franquia, valor_total já abatido, como a aplicação grava) vai ao lote pelo caminho real
// (faturamento.gerarLote → contaTiss): sem recusa de guia divergente, com o fator de redução (reducaoAcrescimo) item a
// item e o total da guia igual ao valor_total da conta no centavo, mesmo com divisão não exata. A conta de um item só,
// cujo abatimento o fator de duas casas não representa, é recusada sem gravar nada. No fim, a massa é apagada.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import {
  type ContextoOperacao,
  criarArmazemLocal,
  criarPastaArquivosTeste,
  type Escritor,
  ErroOperacao,
  NucleoProprio,
  type PastaArquivosTeste,
} from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { versaoTexto } from '../faturamento/esquemas.js';
import { armazemXmlLocal, type LocalizadorArquivos } from './armazem-xml.js';
import type { ContextoTiss } from './porta.js';
import { PortaTissPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0343';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
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
const codigo = (e: ErroOperacao) => String(e.problema['codigo'] ?? '');

describe.skipIf(SEM_BANCO)('guia TISS com franquia e desconto por volume (MariaDB, cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaTissPropria;
  // O XML do lote vai ao disco local (ADR 0004), na pasta temporária do cliente de teste: a leitura parte da chave
  // registrada em `arquivo`, como na produção.
  let pasta: PastaArquivosTeste;
  let local: LocalizadorArquivos | null = null;
  const armazem = armazemXmlLocal(() => (local ??= criarArmazemLocal(nucleo, { raiz: pasta.raiz })), CLIENTE);
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
    grupo: 0,
    item: 0,
    versaoTiss: 0,
    conta: 0,
    contaB: 0,
    itemConta: 0,
    motivo: 0,
    lote: 0,
  };
  let c: ContextoTiss;
  const hoje = new Date().toISOString().slice(0, 10);
  const competencia = `${hoje.slice(0, 7)}-01`;
  const op = (): ContextoOperacao => ({
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: c.correlacao,
    chaveIdempotencia: `t0343-${randomUUID()}`,
  });
  const lerUma = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-teste-c2-043' }, (l) =>
      l.uma<Record<string, unknown>>(sql, p),
    );
  const versaoDaConta = async (id: number) =>
    versaoTexto(Number((await lerUma('SELECT versao FROM conta_hospitalar WHERE id = ?', [id]))?.['versao']));

  const limpar = (e: Escritor) =>
    (async () => {
      const est = [ids.est, ids.outroEst];
      await e.executar(
        "DELETE FROM integracao_mensagem WHERE estabelecimento_id IN (?, ?) AND ponto LIKE 'tiss.%'",
        est,
      );
      await e.executar('DELETE FROM endpoint_tiss_fonte_pagadora WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar('DELETE FROM inscricao_conselho WHERE profissional_id = ?', [ids.prof]);
      await e.executar(
        'DELETE FROM glosa_item WHERE glosa_id IN (SELECT id FROM glosa WHERE estabelecimento_id IN (?, ?))',
        est,
      );
      await e.executar('DELETE FROM glosa WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar(
        'UPDATE lote_tiss SET protocolo_recebimento_id = NULL WHERE estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar('DELETE FROM protocolo_recebimento WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar('DELETE FROM calendario_entrega_fatura WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar(
        'DELETE FROM lote_tiss_conta WHERE lote_tiss_id IN (SELECT id FROM lote_tiss WHERE estabelecimento_id IN (?, ?))',
        est,
      );
      // A fatura ao pagador nasce com o lote (06-FAT linha 31): sai antes dele (massa sintética).
      await e.executar(
        'DELETE FROM fatura_fonte_pagadora_conta WHERE fatura_fonte_pagadora_id IN (SELECT id FROM fatura_fonte_pagadora WHERE estabelecimento_id IN (?, ?))',
        est,
      );
      await e.executar('DELETE FROM fatura_fonte_pagadora WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar('DELETE FROM lote_tiss WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar(
        "DELETE FROM arquivo WHERE estabelecimento_id IN (?, ?) AND entidade = 'lote_tiss'",
        est,
      );
      await e.executar(
        'DELETE FROM ciclo_competencia_fonte_pagadora WHERE estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar(
        'DELETE FROM fechamento_competencia_fonte_pagadora WHERE estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar(
        'DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (SELECT id FROM conta_hospitalar WHERE estabelecimento_id IN (?, ?))',
        est,
      );
      await e.executar('DELETE FROM conta_hospitalar WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar(
        'DELETE FROM configuracao_tiss_fonte_pagadora WHERE estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar(
        "DELETE FROM sequencia_negocio WHERE tipo = 'lote_tiss' AND estabelecimento_id IN (?, ?)",
        est,
      );
    })();

  beforeAll(async () => {
    pasta = await criarPastaArquivosTeste(CLIENTE);
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-c2-043' }, async (e) => {
      const agora = new Date();
      const est = (cod: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, `ESTAB ${cod} SINTETICO`, `ESTAB ${cod} SINTETICO`, agora],
        );
      ids.est = await est(`${P}A`);
      ids.outroEst = await est(`${P}B`);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['l0343.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0343.teste', 'USUARIO SINTETICO L0343', agora],
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
      ids.pessoa = await pessoa('PACIENTE SINTETICO L0343');
      ids.pessoaProf = await pessoa('PROFISSIONAL SINTETICO L0343');
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [ids.pessoa],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [ids.pessoa, 843_043, agora],
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
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, registro_ans, criado_em) VALUES (?, ?, 'operadora', '999999', ?)",
        [`${P}FP`, 'OPERADORA SINTETICA L0343', agora],
      );
      ids.categoria = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [P],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, 'CATEGORIA SINTETICA L0343', agora],
      );
      ids.carater = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['L9'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('L9', ?, 'teste', ?)",
        ['CARATER SINTETICO L0343', agora],
      );
      ids.tipoConta = await garantir(
        e,
        'SELECT id FROM tipo_conta WHERE codigo = ?',
        [P],
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, 'TIPO DE CONTA SINTETICO L0343', agora],
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
      // A guia sai do cadastro: caráter, regime, motivo de saída e clínica (tipo de internação) do atendimento, e a
      // inscrição do profissional no conselho (catálogos sintéticos com os códigos oficiais da TISS).
      const carater1 = await garantir(
        e,
        "SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = '1'",
        [],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('1', ?, 'teste', ?)",
        ['ELETIVO SINTETICO L0343', agora],
      );
      const regime = await garantir(
        e,
        "SELECT id FROM regime_atendimento WHERE codigo_tiss = '1'",
        [],
        "INSERT INTO regime_atendimento (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('1', ?, 'teste', ?)",
        ['REGIME SINTETICO L0343', agora],
      );
      const motivoSaida = await garantir(
        e,
        'SELECT id FROM motivo_encerramento_atendimento WHERE codigo = ?',
        [P],
        `INSERT INTO motivo_encerramento_atendimento (codigo, descricao, desfecho, codigo_tiss, criado_em)
         VALUES (?, ?, 'alta', '12', ?)`,
        [P, 'ALTA SINTETICA L0343', agora],
      );
      const clinica = await garantir(
        e,
        'SELECT id FROM clinica_assistencial WHERE codigo = ?',
        [P],
        `INSERT INTO clinica_assistencial (codigo, descricao, natureza, codigo_tiss_tipo_internacao, criado_em)
         VALUES (?, ?, 'medica', '1', ?)`,
        [P, 'CLINICA SINTETICA L0343', agora],
      );
      await e.executar(
        `UPDATE atendimento SET carater_atendimento_tiss_id = ?, regime_atendimento_id = ?,
                motivo_encerramento_atendimento_id = ?, clinica_assistencial_id = ?, recem_nascido = FALSE
          WHERE id IN (?, ?)`,
        [carater1, regime, motivoSaida, clinica, ids.atendimento, ids.atendimentoB],
      );
      const conselho = await garantir(
        e,
        "SELECT id FROM conselho_classe WHERE codigo_tiss = '06'",
        [],
        "INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES ('06', 'CRM', ?, ?)",
        ['CONSELHO SINTETICO L0343', agora],
      );
      const uf = await garantir(
        e,
        "SELECT id FROM unidade_federativa WHERE codigo_ibge = '33'",
        [],
        `INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em)
         VALUES ('33', 'RJ', 'UF SINTETICA L0343', (SELECT MIN(id) FROM pais_referencia), ?)`,
        [agora],
      );
      const cbo = await garantir(
        e,
        "SELECT id FROM ocupacao_cbo WHERE codigo_cbo = '225125'",
        [],
        "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES ('225125', ?, ?)",
        ['OCUPACAO SINTETICA L0343', agora],
      );
      await e.executar('DELETE FROM inscricao_conselho WHERE profissional_id = ?', [ids.prof]);
      await e.inserir(
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, ocupacao_cbo_id, principal, criado_em)
         VALUES (?, 1, ?, ?, '843001', ?, TRUE, ?)`,
        [ids.prof, conselho, uf, cbo, agora],
      );
      await e.executar("UPDATE estabelecimento SET codigo_cnes = '8430016' WHERE id = ?", [ids.est]);
      ids.grupo = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        [P],
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
        [P, 'GRUPO SINTETICO L0343', agora],
      );
      ids.item = await garantir(
        e,
        'SELECT id FROM item_faturavel WHERE codigo = ?',
        ['84300001'],
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
        ['84300001', 'PROCEDIMENTO SINTETICO 84300001', ids.grupo, agora],
      );
      ids.versaoTiss = await garantir(
        e,
        "SELECT id FROM versao_padrao_tiss WHERE codigo_tiss = '04.03.00' AND ativo = TRUE ORDER BY id LIMIT 1",
        [],
        `INSERT INTO versao_padrao_tiss (codigo_tiss, componente, descricao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('04.03.00', 'troca', 'VERSAO SINTETICA L0343', '2020-01-01', 'teste', ?)`,
        [agora],
      );
      ids.motivo = await garantir(
        e,
        "SELECT id FROM motivo_glosa WHERE codigo_tuss = '9316'",
        [],
        `INSERT INTO motivo_glosa (codigo_tuss, descricao, permite_reapresentacao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('9316', 'MOTIVO SINTETICO L0343', TRUE, '2020-01-01', 'teste', ?)`,
        [agora],
      );
      await e.inserir(
        `INSERT INTO configuracao_tiss_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, versao_padrao_tiss_id,
           vigencia_inicio, registro_ans, codigo_prestador_operadora, criado_em)
         VALUES (?, ?, ?, '2020-01-01', '999999', 'PRESTSINT01', ?)`,
        [ids.est, ids.fonte, ids.versaoTiss, agora],
      );
      const conta = (estab: number, atend: number, numero: string) =>
        e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tipo_conta_id, natureza, competencia, inicio_em, fim_em, situacao, valor_itens, valor_total, fechada_em,
             fechada_por_usuario_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 'internacao', ?, ?, ?, 'fechada', 300, 300, ?, ?, ?)`,
          [
            estab,
            numero,
            atend,
            ids.paciente,
            ids.fonte,
            ids.tipoConta,
            competencia,
            agora,
            agora,
            agora,
            ids.usuario,
            agora,
          ],
        );
      ids.conta = await conta(ids.est, ids.atendimento, `${P}-C1`);
      ids.contaB = await conta(ids.outroEst, ids.atendimentoB, `${P}-C2`);
      ids.itemConta = await e.inserir(
        `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
           valor_unitario, valor_total, criado_em)
         VALUES (?, 1, ?, ?, 3, 100, 300, ?)`,
        [ids.conta, ids.item, agora, agora],
      );
    });
    porta = new PortaTissPropria(nucleo, CLIENTE, armazem);
    c = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: ids.usuario,
      correlacao: `t0343-${randomUUID()}`.slice(0, 64),
      rede: 'rede',
      hospital: `${P}A`,
    };
  }, 60_000);

  afterAll(async () => {
    await pasta?.apagar();
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-c2-043' }, (e) => limpar(e));
    await nucleo.encerrar();
  });

  /** Conta fechada com itens e o abatimento comercial gravado (franquia do contrato e desconto por volume). */
  const prepararConta = (numero: string, valores: number[], franquia: number, desconto: number) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-c2-043' }, async (e) => {
      const agora = new Date();
      const bruto = valores.reduce((t, v) => t + v, 0);
      const abat = Math.round((franquia + desconto) * 100) / 100;
      const id = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, fim_em, situacao, valor_itens, valor_desconto,
           valor_paciente, valor_total, fechada_em, fechada_por_usuario_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'internacao', ?, ?, ?, 'fechada', ?, ?, ?, ?, ?, ?, ?)`,
        [
          ids.est,
          numero,
          ids.atendimento,
          ids.paciente,
          ids.fonte,
          ids.tipoConta,
          competencia,
          agora,
          agora,
          bruto,
          abat,
          franquia,
          Math.round((bruto - abat) * 100) / 100,
          agora,
          ids.usuario,
          agora,
        ],
      );
      for (const [k, v] of valores.entries())
        await e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em,
             quantidade, valor_unitario, valor_total, criado_em) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
          [id, k + 1, ids.item, agora, v, v, agora],
        );
      const contrato = await e.inserir(
        `INSERT INTO contrato_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, numero, descricao, vigencia_inicio,
           criado_em) VALUES (?, ?, ?, ?, '2025-01-01', ?)`,
        [ids.est, ids.fonte, `${numero}CT`, `CONTRATO SINTETICO ${P}`, agora],
      );
      const fr = await e.inserir(
        `INSERT INTO franquia_contrato (contrato_fonte_pagadora_id, descricao, tipo_franquia, valor_franquia,
           vigencia_inicio, criado_em) VALUES (?, 'FRANQUIA SINTETICA', 'valor', ?, '2025-01-01', ?)`,
        [contrato, franquia, agora],
      );
      await e.inserir(
        `INSERT INTO conta_hospitalar_franquia (conta_hospitalar_id, sequencia, tipo, franquia_contrato_id, valor,
           criado_em, criado_por) VALUES (?, 1, 'franquia', ?, ?, ?, ?)`,
        [id, fr, franquia, agora, ids.usuario],
      );
      if (desconto > 0)
        await e.inserir(
          `INSERT INTO conta_hospitalar_franquia (conta_hospitalar_id, sequencia, tipo, valor, criado_em, criado_por)
           VALUES (?, 2, 'desconto_volume', ?, ?, ?)`,
          [id, desconto, agora, ids.usuario],
        );
      return id;
    });

  const apagarMassa = (contas: number[], lote: number) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-c2-043' }, async (e) => {
      const a = await e.uma<{ arquivo_id: number }>('SELECT arquivo_id FROM lote_tiss WHERE id = ?', [lote]);
      for (const id of contas) {
        await e.executar('DELETE FROM guia_tiss WHERE conta_hospitalar_id = ?', [id]);
        await e.executar('DELETE FROM conta_hospitalar_franquia WHERE conta_hospitalar_id = ?', [id]);
      }
      await e.executar('DELETE FROM lote_tiss_conta WHERE lote_tiss_id = ?', [lote]);
      await e.executar(
        'DELETE FROM fatura_fonte_pagadora_conta WHERE fatura_fonte_pagadora_id IN (SELECT id FROM fatura_fonte_pagadora WHERE lote_tiss_id = ?)',
        [lote],
      );
      await e.executar('DELETE FROM fatura_fonte_pagadora WHERE lote_tiss_id = ?', [lote]);
      await e.executar('DELETE FROM lote_tiss WHERE id = ?', [lote]);
      await e.executar('DELETE FROM arquivo WHERE id = ?', [a?.arquivo_id ?? 0]);
      for (const id of contas) {
        await e.executar('DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [id]);
        await e.executar('DELETE FROM conta_hospitalar WHERE id = ?', [id]);
      }
      await e.executar(
        'DELETE f FROM franquia_contrato f JOIN contrato_fonte_pagadora c ON c.id = f.contrato_fonte_pagadora_id WHERE c.estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar('DELETE FROM contrato_fonte_pagadora WHERE estabelecimento_id = ?', [ids.est]);
    });

  it('franquia de 200 e desconto de 133 sobre 1000 (divisão não exata): o lote sai sem recusa, com o fator item a item, e a guia fecha em 667,00 como a conta', async () => {
    const conta = await prepararConta(`${P}-CF`, [600, 250, 150], 200, 133);
    let lote = 0;
    try {
      const r = await porta.executar(
        c,
        'faturamento.gerarLote',
        { convenio: ids.fonte, tipoGuia: 3, contas: [{ id: conta, versao: await versaoDaConta(conta) }] },
        op(),
      );
      lote = Number(r.resultado['lote']);
      expect(lote).toBeGreaterThan(0);
      const chave = (await porta.xmlDoLote(c, lote))?.chave ?? '';
      const xml = new TextDecoder().decode((await armazem.ler(chave)) ?? new Uint8Array());
      const fatores = [...xml.matchAll(/<ans:reducaoAcrescimo>([0-9.]+)<\/ans:reducaoAcrescimo>/g)].map((m) =>
        Number(m[1]),
      );
      const totais = [...xml.matchAll(/<ans:valorTotal>([0-9.]+)<\/ans:valorTotal>/g)].map((m) =>
        Number(m[1]),
      );
      // Três itens, cada um com o seu fator de duas casas, todos abaixo de 1 (nenhum sai cheio).
      expect(fatores).toHaveLength(3);
      for (const f of fatores) expect(f).toBeLessThan(1);
      expect(Math.round(totais.reduce((t, v) => t + v, 0) * 100) / 100).toBe(667);
      expect(xml).toContain('<ans:valorTotalGeral>667.00</ans:valorTotalGeral>');
      // O lote e a conta: o valor do lote é o cobrado da fonte (667), a franquia segue com o paciente.
      const l = await lerUma('SELECT valor_total FROM lote_tiss WHERE id = ?', [lote]);
      expect(Number(l?.['valor_total'])).toBe(667);
      const fat = await lerUma('SELECT valor_apresentado FROM fatura_fonte_pagadora WHERE lote_tiss_id = ?', [
        lote,
      ]);
      expect(Number(fat?.['valor_apresentado'])).toBe(667);
      const ct = await lerUma(
        'SELECT valor_total, valor_paciente, situacao FROM conta_hospitalar WHERE id = ?',
        [conta],
      );
      expect([Number(ct?.['valor_total']), Number(ct?.['valor_paciente']), ct?.['situacao']]).toEqual([
        667,
        200,
        'faturada',
      ]);
    } finally {
      await apagarMassa([conta], lote);
    }
  }, 60_000);

  it('conta de um item só com abatimento que o fator de duas casas não representa: recusa com o resíduo, sem gravar lote', async () => {
    const conta = await prepararConta(`${P}-CU`, [1000], 200, 133);
    try {
      const antes = Number(
        (await lerUma('SELECT COUNT(*) AS q FROM lote_tiss WHERE estabelecimento_id = ?', [ids.est]))?.['q'],
      );
      const e = await erroDe(
        porta.executar(
          c,
          'faturamento.gerarLote',
          { convenio: ids.fonte, tipoGuia: 3, contas: [{ id: conta, versao: await versaoDaConta(conta) }] },
          op(),
        ),
      );
      expect(codigo(e)).toBe('guia-abatimento-sem-fator');
      const depois = Number(
        (await lerUma('SELECT COUNT(*) AS q FROM lote_tiss WHERE estabelecimento_id = ?', [ids.est]))?.['q'],
      );
      expect(depois).toBe(antes);
      const ct = await lerUma('SELECT situacao FROM conta_hospitalar WHERE id = ?', [conta]);
      expect(ct?.['situacao']).toBe('fechada');
      const ligadas = await lerUma(
        'SELECT COUNT(*) AS q FROM lote_tiss_conta WHERE conta_hospitalar_id = ?',
        [conta],
      );
      expect(Number(ligadas?.['q'])).toBe(0);
    } finally {
      await apagarMassa([conta], 0);
    }
  }, 60_000);
});
