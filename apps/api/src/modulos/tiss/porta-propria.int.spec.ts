// Integração da porta própria do pós-fechamento (M31/M42) contra o MariaDB real (cliente f22_o3, já criado pela obra
// da onda 3). Massa SINTÉTICA com códigos "L0316" (nenhuma pessoa real). Contrato de efeito de cada gravação: linhas,
// versão, trilha (com a operação) e as recusas (conta em lote, outro estabelecimento, entrada inválida, protocolo já
// registrado, glosa já decidida, operação pendente). Uma bateria comum roda sobre as duas fábricas (memória e banco)
// num describe.each. No fim, a massa de negócio é apagada; ficam o estabelecimento e o usuário de teste, que a trilha
// (só inclusão) referencia. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
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
import { ServicoApresentacaoTiss } from './apresentacao.controller.js';
import { armazemXmlLocal, armazemXmlMemoria, type LocalizadorArquivos } from './armazem-xml.js';
import type { ContextoTiss, PortaTiss } from './porta.js';
import { PortaTissMemoria } from './porta-memoria.js';
import { PortaTissPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0316';

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
/** Campos comuns da linha da trilha das gravações diretas (o estabelecimento e o usuário vêm do contexto). */
const base = { estabelecimento: null, usuario: null, correlacao: null } as const;

describe.skipIf(SEM_BANCO)('porta própria do pós-fechamento (MariaDB, cliente f22_o3)', () => {
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
  const [anoAnt, mesAnt] = (() => {
    const d = new Date(`${competencia}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return [d.getUTCFullYear(), d.getUTCMonth() + 1];
  })();
  const op = (): ContextoOperacao => ({
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: c.correlacao,
    chaveIdempotencia: `t0316-${randomUUID()}`,
  });
  const lerUma = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-teste-03-16' }, (l) =>
      l.uma<Record<string, unknown>>(sql, p),
    );
  const lerTodas = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-teste-03-16' }, (l) =>
      l.consultar<Record<string, unknown>>(sql, p),
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
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-03-16' }, async (e) => {
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
        ['l0316.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0316.teste', 'USUARIO SINTETICO L0316', agora],
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
      ids.pessoa = await pessoa('PACIENTE SINTETICO L0316');
      ids.pessoaProf = await pessoa('PROFISSIONAL SINTETICO L0316');
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [ids.pessoa],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [ids.pessoa, 831_601, agora],
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
        [`${P}FP`, 'OPERADORA SINTETICA L0316', agora],
      );
      ids.categoria = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [P],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, 'CATEGORIA SINTETICA L0316', agora],
      );
      ids.carater = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['L9'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('L9', ?, 'teste', ?)",
        ['CARATER SINTETICO L0316', agora],
      );
      ids.tipoConta = await garantir(
        e,
        'SELECT id FROM tipo_conta WHERE codigo = ?',
        [P],
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, 'TIPO DE CONTA SINTETICO L0316', agora],
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
        ['ELETIVO SINTETICO L0316', agora],
      );
      const regime = await garantir(
        e,
        "SELECT id FROM regime_atendimento WHERE codigo_tiss = '1'",
        [],
        "INSERT INTO regime_atendimento (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('1', ?, 'teste', ?)",
        ['REGIME SINTETICO L0316', agora],
      );
      const motivoSaida = await garantir(
        e,
        'SELECT id FROM motivo_encerramento_atendimento WHERE codigo = ?',
        [P],
        `INSERT INTO motivo_encerramento_atendimento (codigo, descricao, desfecho, codigo_tiss, criado_em)
         VALUES (?, ?, 'alta', '12', ?)`,
        [P, 'ALTA SINTETICA L0316', agora],
      );
      const clinica = await garantir(
        e,
        'SELECT id FROM clinica_assistencial WHERE codigo = ?',
        [P],
        `INSERT INTO clinica_assistencial (codigo, descricao, natureza, codigo_tiss_tipo_internacao, criado_em)
         VALUES (?, ?, 'medica', '1', ?)`,
        [P, 'CLINICA SINTETICA L0316', agora],
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
        ['CONSELHO SINTETICO L0316', agora],
      );
      const uf = await garantir(
        e,
        "SELECT id FROM unidade_federativa WHERE codigo_ibge = '33'",
        [],
        `INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em)
         VALUES ('33', 'RJ', 'UF SINTETICA L0316', (SELECT MIN(id) FROM pais_referencia), ?)`,
        [agora],
      );
      const cbo = await garantir(
        e,
        "SELECT id FROM ocupacao_cbo WHERE codigo_cbo = '225125'",
        [],
        "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES ('225125', ?, ?)",
        ['OCUPACAO SINTETICA L0316', agora],
      );
      await e.executar('DELETE FROM inscricao_conselho WHERE profissional_id = ?', [ids.prof]);
      await e.inserir(
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, ocupacao_cbo_id, principal, criado_em)
         VALUES (?, 1, ?, ?, '831601', ?, TRUE, ?)`,
        [ids.prof, conselho, uf, cbo, agora],
      );
      await e.executar("UPDATE estabelecimento SET codigo_cnes = '8316016' WHERE id = ?", [ids.est]);
      ids.grupo = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        [P],
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
        [P, 'GRUPO SINTETICO L0316', agora],
      );
      ids.item = await garantir(
        e,
        'SELECT id FROM item_faturavel WHERE codigo = ?',
        ['83160001'],
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
        ['83160001', 'PROCEDIMENTO SINTETICO 83160001', ids.grupo, agora],
      );
      ids.versaoTiss = await garantir(
        e,
        "SELECT id FROM versao_padrao_tiss WHERE codigo_tiss = '04.03.00' AND ativo = TRUE ORDER BY id LIMIT 1",
        [],
        `INSERT INTO versao_padrao_tiss (codigo_tiss, componente, descricao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('04.03.00', 'troca', 'VERSAO SINTETICA L0316', '2020-01-01', 'teste', ?)`,
        [agora],
      );
      ids.motivo = await garantir(
        e,
        "SELECT id FROM motivo_glosa WHERE codigo_tuss = '9316'",
        [],
        `INSERT INTO motivo_glosa (codigo_tuss, descricao, permite_reapresentacao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('9316', 'MOTIVO SINTETICO L0316', TRUE, '2020-01-01', 'teste', ?)`,
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
      correlacao: `t0316-${randomUUID()}`.slice(0, 64),
      rede: 'rede',
      hospital: `${P}A`,
    };
  }, 60_000);

  afterAll(async () => {
    await pasta?.apagar();
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-03-16' }, (e) => limpar(e));
    await nucleo.encerrar();
  });

  it('leituras de apoio: convênio, situações do protocolo e contas prontas pelo tipo de guia', async () => {
    expect((await porta.convenios(c)).some((x) => x.codigo === ids.fonte)).toBe(true);
    expect((await porta.situacoesProtocolo(c)).length).toBeGreaterThan(0);
    const prontas = await porta.contasProntas(c, {
      convenio: ids.fonte,
      tipoGuia: 3,
      ano: null,
      mes: null,
      convenios: null,
    });
    expect(prontas.map((x) => x.conta)).toEqual([ids.conta]);
    expect(prontas[0]).toMatchObject({ itens: 1, total: 300, tiposGuia: [3, 4] });
    expect(
      await porta.contasProntas(c, {
        convenio: ids.fonte,
        tipoGuia: 2,
        ano: null,
        mes: null,
        convenios: null,
      }),
    ).toEqual([]);
    expect(
      await porta.contasProntas(c, { convenio: ids.fonte, tipoGuia: 3, ano: null, mes: null, convenios: [] }),
    ).toEqual([]);
  });

  it('gerar o lote: cadastro incompleto (CNES, executante, saída) e guia divergente recusam sem gravar nada', async () => {
    const versao = await versaoDaConta(ids.conta);
    const entrada = { convenio: ids.fonte, tipoGuia: 3, contas: [{ id: ids.conta, versao }] };
    const mexer = (sql: string, p: unknown[]) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-03-16' }, (e) => e.executar(sql, p));
    const recusaDe = async () => erroDe(porta.executar(c, 'faturamento.gerarLote', entrada, op()));
    await mexer('UPDATE estabelecimento SET codigo_cnes = NULL WHERE id = ?', [ids.est]);
    const semCnes = await recusaDe();
    expect([codigo(semCnes), String(semCnes.problema['detail'] ?? semCnes.message)]).toEqual([
      'cadastro-tiss-incompleto',
      expect.stringContaining('CNES'),
    ]);
    await mexer("UPDATE estabelecimento SET codigo_cnes = '8316016' WHERE id = ?", [ids.est]);
    // Honorário sem executante no cadastro (inscrição cancelada): recusa, nunca um profissional padrão.
    await mexer("UPDATE inscricao_conselho SET situacao = 'cancelada' WHERE profissional_id = ?", [ids.prof]);
    expect(
      codigo(await erroDe(porta.executar(c, 'faturamento.gerarLote', { ...entrada, tipoGuia: 4 }, op()))),
    ).toBe('cadastro-tiss-incompleto');
    await mexer("UPDATE inscricao_conselho SET situacao = 'ativa' WHERE profissional_id = ?", [ids.prof]);
    await mexer('UPDATE atendimento SET motivo_encerramento_atendimento_id = NULL WHERE id = ?', [
      ids.atendimento,
    ]);
    expect(codigo(await recusaDe())).toBe('cadastro-tiss-incompleto');
    await mexer(
      'UPDATE atendimento SET motivo_encerramento_atendimento_id = (SELECT id FROM motivo_encerramento_atendimento WHERE codigo = ?) WHERE id = ?',
      [P, ids.atendimento],
    );
    await mexer('UPDATE conta_hospitalar SET valor_total = 310 WHERE id = ?', [ids.conta]);
    expect(codigo(await recusaDe())).toBe('guia-divergente');
    await mexer('UPDATE conta_hospitalar SET valor_total = 300 WHERE id = ?', [ids.conta]);
    expect(
      await lerUma('SELECT COUNT(*) AS q FROM lote_tiss WHERE estabelecimento_id = ?', [ids.est]),
    ).toMatchObject({
      q: 0,
    });
  }, 60_000);

  it('gerar o lote de honorário: o XML leva o executante do cadastro (conselho, número, UF, CBO e nome)', async () => {
    const contaH = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-teste-03-16' },
      async (e) => {
        const agora = new Date();
        const honorario = await garantir(
          e,
          'SELECT id FROM item_faturavel WHERE codigo = ?',
          ['83160002'],
          "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'honorario', ?, ?)",
          ['83160002', 'HONORARIO SINTETICO 83160002', ids.grupo, agora],
        );
        const id = await e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, fim_em, situacao, valor_itens, valor_total, fechada_em,
           fechada_por_usuario_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'internacao', ?, ?, ?, 'fechada', 150, 150, ?, ?, ?)`,
          [
            ids.est,
            `${P}-CH`,
            ids.atendimento,
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
        await e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
           valor_unitario, valor_total, executante_profissional_id, criado_em)
         VALUES (?, 1, ?, ?, 1, 150, 150, ?, ?)`,
          [id, honorario, agora, ids.prof, agora],
        );
        return id;
      },
    );
    let lote = 0;
    try {
      const r = await porta.executar(
        c,
        'faturamento.gerarLote',
        { convenio: ids.fonte, tipoGuia: 4, contas: [{ id: contaH, versao: await versaoDaConta(contaH) }] },
        op(),
      );
      lote = Number(r.resultado['lote']);
      const chave = (await porta.xmlDoLote(c, lote))?.chave ?? '';
      const xml = new TextDecoder().decode((await armazem.ler(chave)) ?? new Uint8Array());
      expect(xml).toMatch(/numeroConselhoProfissional>831601</);
      expect(xml).toContain('225125');
      expect(xml).toContain('PROFISSIONAL SINTETICO L0316');
      expect(xml).toContain('8316016');
      expect(xml).toMatch(/valorTotalHonorarios>150\.00</);
      // Sem a guia de autorização da operadora, o aviso explícito (vai o número da guia do prestador).
      expect(String(r.resultado['alertas'])).toContain('guia de autorização');
    } finally {
      // Desfaz este lote (os testes seguintes contam um lote só no estabelecimento).
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-03-16' }, async (e) => {
        const a = await e.uma<{ arquivo_id: number }>('SELECT arquivo_id FROM lote_tiss WHERE id = ?', [
          lote,
        ]);
        await e.executar('DELETE FROM lote_tiss_conta WHERE lote_tiss_id = ?', [lote]);
        await e.executar(
          'DELETE FROM fatura_fonte_pagadora_conta WHERE fatura_fonte_pagadora_id IN (SELECT id FROM fatura_fonte_pagadora WHERE lote_tiss_id = ?)',
          [lote],
        );
        await e.executar('DELETE FROM fatura_fonte_pagadora WHERE lote_tiss_id = ?', [lote]);
        await e.executar('DELETE FROM lote_tiss WHERE id = ?', [lote]);
        await e.executar('DELETE FROM arquivo WHERE id = ?', [a?.arquivo_id ?? 0]);
        await e.executar('DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [contaH]);
        await e.executar('DELETE FROM conta_hospitalar WHERE id = ?', [contaH]);
      });
    }
  }, 60_000);

  it('gerar o lote com a regra de apresentação (06-FAT linhas 29 e 30): código trocado, item fora do arquivo, guia zerada omitida fora do lote e da fatura; credenciamento que barra recusa sem gravar', async () => {
    const apresentacao = new ServicoApresentacaoTiss(nucleo);
    const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-f377' }, fn);
    const m = await escrever(async (e) => {
      const agora = new Date();
      const item = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM item_faturavel WHERE codigo = ?',
          [codigo],
          "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'honorario', ?, ?)",
          [codigo, `HONORARIO SINTETICO ${codigo}`, ids.grupo, agora],
        );
      const trocado = await item('83160002');
      const fora = await item('83160003');
      const conta = async (sufixo: string, itens: [number, number][]) => {
        const total = itens.reduce((t, [, v]) => t + v, 0);
        const id = await e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, fim_em, situacao, valor_itens, valor_total, fechada_em,
           fechada_por_usuario_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'internacao', ?, ?, ?, 'fechada', ?, ?, ?, ?, ?)`,
          [
            ids.est,
            `${P}-${sufixo}`,
            ids.atendimento,
            ids.paciente,
            ids.fonte,
            ids.tipoConta,
            competencia,
            agora,
            agora,
            total,
            total,
            agora,
            ids.usuario,
            agora,
          ],
        );
        let seq = 0;
        for (const [it, v] of itens)
          await e.inserir(
            `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em,
             quantidade, valor_unitario, valor_total, executante_profissional_id, criado_em)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
            [id, ++seq, it, agora, v, v, ids.prof, agora],
          );
        return id;
      };
      return {
        trocado,
        fora,
        a: await conta('RA', [
          [trocado, 150],
          [fora, 50],
        ]),
        b: await conta('RB', [[fora, 30]]),
      };
    });
    const regra = Number(
      (
        await apresentacao.gravar('regra', op(), {
          fontePagadoraId: ids.fonte,
          tipoContaId: null,
          versaoPadraoTissId: ids.versaoTiss,
          omiteGuiaSemValor: true,
        })
      )['id'],
    );
    await apresentacao.gravar('regra-item', op(), {
      regraId: regra,
      itemFaturavelId: m.trocado,
      codigoApresentacao: '99990001',
    });
    await apresentacao.gravar('regra-item', op(), {
      regraId: regra,
      itemFaturavelId: m.fora,
      naoExporta: true,
    });
    const entrada = async () => ({
      convenio: ids.fonte,
      tipoGuia: 4,
      contas: [
        { id: m.a, versao: await versaoDaConta(m.a) },
        { id: m.b, versao: await versaoDaConta(m.b) },
      ],
    });
    const lotes = async () =>
      Number(
        (await lerUma('SELECT COUNT(*) AS q FROM lote_tiss WHERE estabelecimento_id = ?', [ids.est]))?.['q'],
      );
    let lote = 0;
    try {
      // A fonte pagadora barra a cobrança sem credenciamento (cadastro do convênio): o executante não tem
      // credenciamento nela, o lote é recusado e nada é gravado.
      const antes = await lotes();
      await escrever((e) =>
        e.executar('UPDATE fonte_pagadora SET bloqueia_sem_credenciamento = TRUE WHERE id = ?', [ids.fonte]),
      );
      expect(codigo(await erroDe(porta.executar(c, 'faturamento.gerarLote', await entrada(), op())))).toBe(
        'credenciamento-barra-cobranca',
      );
      expect(await lotes()).toBe(antes);
      await escrever((e) =>
        e.executar('UPDATE fonte_pagadora SET bloqueia_sem_credenciamento = FALSE WHERE id = ?', [ids.fonte]),
      );
      const r = await porta.executar(c, 'faturamento.gerarLote', await entrada(), op());
      lote = Number(r.resultado['lote']);
      expect(r.resultado).toMatchObject({ contas: 1, contasForaDoArquivo: 1 });
      expect(Number(r.resultado['valor'])).toBe(150);
      const chave = (await porta.xmlDoLote(c, lote))?.chave ?? '';
      const xml = new TextDecoder().decode((await armazem.ler(chave)) ?? new Uint8Array());
      expect(xml).toContain('99990001');
      expect(xml).not.toContain('83160003');
      expect(xml).toMatch(/valorTotalHonorarios>150\.00</);
      // Só a conta que foi ao arquivo entra no lote e na fatura, com o valor apresentado (sem o item retirado).
      const noLote = await escrever((e) =>
        e.consultar<{ conta_hospitalar_id: number; valor: string }>(
          'SELECT conta_hospitalar_id, valor FROM lote_tiss_conta WHERE lote_tiss_id = ?',
          [lote],
        ),
      );
      expect(noLote.map((x) => [Number(x.conta_hospitalar_id), Number(x.valor)])).toEqual([[m.a, 150]]);
      const fatura = await lerUma(
        `SELECT f.quantidade_contas, f.valor_apresentado,
                (SELECT SUM(fc.valor_apresentado) FROM fatura_fonte_pagadora_conta fc
                  WHERE fc.fatura_fonte_pagadora_id = f.id) AS soma,
                (SELECT COUNT(*) FROM fatura_fonte_pagadora_conta fc
                  WHERE fc.fatura_fonte_pagadora_id = f.id AND fc.conta_hospitalar_id = ?) AS omitida
           FROM fatura_fonte_pagadora f WHERE f.lote_tiss_id = ?`,
        [m.b, lote],
      );
      expect(Number(fatura?.['quantidade_contas'])).toBe(1);
      expect(Number(fatura?.['valor_apresentado'])).toBe(150);
      expect(Number(fatura?.['soma'])).toBe(150);
      expect(Number(fatura?.['omitida'])).toBe(0);
      // A conta omitida não é faturada: segue na fila; a enviada é faturada.
      expect(await lerUma('SELECT situacao FROM conta_hospitalar WHERE id = ?', [m.b])).toMatchObject({
        situacao: 'fechada',
      });
      expect(await lerUma('SELECT situacao FROM conta_hospitalar WHERE id = ?', [m.a])).toMatchObject({
        situacao: 'faturada',
      });
    } finally {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-f377' }, async (e) => {
        await e.executar('UPDATE fonte_pagadora SET bloqueia_sem_credenciamento = FALSE WHERE id = ?', [
          ids.fonte,
        ]);
        const a = await e.uma<{ arquivo_id: number }>('SELECT arquivo_id FROM lote_tiss WHERE id = ?', [
          lote,
        ]);
        await e.executar('DELETE FROM lote_tiss_conta WHERE lote_tiss_id = ?', [lote]);
        await e.executar(
          'DELETE FROM fatura_fonte_pagadora_conta WHERE fatura_fonte_pagadora_id IN (SELECT id FROM fatura_fonte_pagadora WHERE lote_tiss_id = ?)',
          [lote],
        );
        await e.executar('DELETE FROM fatura_fonte_pagadora WHERE lote_tiss_id = ?', [lote]);
        await e.executar('DELETE FROM lote_tiss WHERE id = ?', [lote]);
        await e.executar('DELETE FROM arquivo WHERE id = ?', [a?.arquivo_id ?? 0]);
        await e.executar('DELETE FROM regra_apresentacao_tiss_item WHERE regra_apresentacao_tiss_id = ?', [
          regra,
        ]);
        await e.executar('DELETE FROM regra_apresentacao_tiss WHERE id = ?', [regra]);
        await e.executar('DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (?, ?)', [m.a, m.b]);
        await e.executar('DELETE FROM conta_hospitalar WHERE id IN (?, ?)', [m.a, m.b]);
      });
    }
  }, 90_000);

  it('gerar o lote com faixa de números da operadora (02-CAD linha 25): a guia nasce com o número da faixa, o uso fica gravado, a faixa esgota e avisa; sem número o lote recusa sem gravar; o lote refeito reusa o número e regrava o valor; a guia importada vai ao lote com o número dela; número já usado na fonte pagadora recusa; a guia de outra fonte pagadora não é reusada', async () => {
    const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-f3111' }, fn);
    const novaConta = (sufixo: string) =>
      escrever(async (e) => {
        const agora = new Date();
        const id = await e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, fim_em, situacao, valor_itens, valor_total, fechada_em,
           fechada_por_usuario_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'internacao', ?, ?, ?, 'fechada', 100, 100, ?, ?, ?)`,
          [
            ids.est,
            `${P}-${sufixo}`,
            ids.atendimento,
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
        await e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
           valor_unitario, valor_total, criado_em)
         VALUES (?, 1, ?, ?, 1, 100, 100, ?)`,
          [id, ids.item, agora, agora],
        );
        return id;
      });
    const k = {
      a: await novaConta('N1'),
      b: await novaConta('N2'),
      c: await novaConta('N3'),
      d: await novaConta('N4'),
    };
    const todas = Object.values(k);
    const marcas = todas.map(() => '?').join(', ');
    const faixas: number[] = [];
    let outraFonte = 0;
    // Guia que já existia antes da emissão (como a que vem da importação): montada, sem lote.
    const guiaImportada = (conta: number, numero: string, tipo: string, fonte: number) =>
      escrever((e) =>
        e.inserir(
          `INSERT INTO guia_tiss (estabelecimento_id, conta_hospitalar_id, tipo_guia, fonte_pagadora_id, paciente_id,
             numero_guia_prestador, data_emissao, valor_total, situacao, origem, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, '2026-01-10', 40, 'montada', 'migracao', ?)`,
          [ids.est, conta, tipo, fonte, ids.paciente, numero, new Date()],
        ),
      );
    const faixa = await escrever((e) =>
      e.inserir(
        `INSERT INTO faixa_numeracao_guia (estabelecimento_id, fonte_pagadora_id, tipo_guia, prefixo, tamanho_fixo,
           numero_inicial, numero_final, proximo_numero, vigencia_inicio, criado_em)
         VALUES (?, ?, 'internacao', 'F', 4, 5, 6, 5, '2026-01-01', ?)`,
        [ids.est, ids.fonte, new Date()],
      ),
    );
    faixas.push(faixa);
    const contar = async (sql: string, p: unknown[]) => Number((await lerUma(sql, p))?.['q']);
    const entrada = async (contas: number[]) => ({
      convenio: ids.fonte,
      tipoGuia: 3,
      contas: await Promise.all(contas.map(async (id) => ({ id, versao: await versaoDaConta(id) }))),
    });
    const xmlDe = async (lote: number) =>
      new TextDecoder().decode(
        (await armazem.ler((await porta.xmlDoLote(c, lote))?.chave ?? '')) ?? new Uint8Array(),
      );
    const lotes: number[] = [];
    try {
      const r = await porta.executar(c, 'faturamento.gerarLote', await entrada([k.a, k.b]), op());
      lotes.push(Number(r.resultado['lote']));
      // O que fica no banco: uma guia por conta, com o número da faixa, no lote; o uso de cada número; a faixa esgotada.
      const guias = await lerTodas(
        `SELECT conta_hospitalar_id, numero_guia_prestador, tipo_guia, situacao, lote_tiss_id, fonte_pagadora_id,
                paciente_id, valor_total, criado_por
           FROM guia_tiss WHERE conta_hospitalar_id IN (?, ?) ORDER BY numero_guia_prestador`,
        [k.a, k.b],
      );
      expect(guias.map((g) => String(g['numero_guia_prestador']))).toEqual(['F0005', 'F0006']);
      expect(guias.map((g) => Number(g['conta_hospitalar_id'])).sort()).toEqual([k.a, k.b].sort());
      for (const g of guias) {
        expect(g).toMatchObject({ tipo_guia: 'resumo_internacao', situacao: 'em_lote' });
        expect(Number(g['lote_tiss_id'])).toBe(lotes[0]);
        expect(Number(g['fonte_pagadora_id'])).toBe(ids.fonte);
        expect(Number(g['paciente_id'])).toBe(ids.paciente);
        expect(Number(g['valor_total'])).toBe(100);
        expect(Number(g['criado_por'])).toBe(ids.usuario);
      }
      const usos = await lerTodas(
        `SELECT u.numero, u.numero_guia, u.usuario_id, g.numero_guia_prestador
           FROM faixa_numeracao_guia_uso u JOIN guia_tiss g ON g.id = u.guia_tiss_id
          WHERE u.faixa_numeracao_guia_id = ? ORDER BY u.numero`,
        [faixa],
      );
      expect(
        usos.map((u) => [Number(u['numero']), String(u['numero_guia']), Number(u['usuario_id'])]),
      ).toEqual([
        [5, 'F0005', ids.usuario],
        [6, 'F0006', ids.usuario],
      ]);
      expect(usos.every((u) => u['numero_guia'] === u['numero_guia_prestador'])).toBe(true);
      expect(
        await lerUma('SELECT situacao, proximo_numero FROM faixa_numeracao_guia WHERE id = ?', [faixa]),
      ).toMatchObject({ situacao: 'esgotada' });
      expect(await contar('SELECT proximo_numero AS q FROM faixa_numeracao_guia WHERE id = ?', [faixa])).toBe(
        7,
      );
      // O XML leva o número da faixa (não o da conta) e o faturista é avisado de que a faixa esgotou.
      const xml = await xmlDe(lotes[0]!);
      expect(xml).toMatch(/numeroGuiaPrestador>F0005</);
      expect(xml).toMatch(/numeroGuiaPrestador>F0006</);
      expect(xml).not.toContain(`${P}-N1`);
      expect(String(r.resultado['alertas'])).toContain('esgotou');

      // Faixa esgotada: a conta seguinte recusa e nada é gravado (nem lote, nem guia; a conta segue fechada).
      const antes = await contar('SELECT COUNT(*) AS q FROM lote_tiss WHERE estabelecimento_id = ?', [
        ids.est,
      ]);
      expect(
        codigo(await erroDe(porta.executar(c, 'faturamento.gerarLote', await entrada([k.c]), op()))),
      ).toBe('sem-faixa-de-guia');
      expect(
        await contar('SELECT COUNT(*) AS q FROM lote_tiss WHERE estabelecimento_id = ?', [ids.est]),
      ).toBe(antes);
      expect(await contar('SELECT COUNT(*) AS q FROM guia_tiss WHERE conta_hospitalar_id = ?', [k.c])).toBe(
        0,
      );
      expect(await lerUma('SELECT situacao FROM conta_hospitalar WHERE id = ?', [k.c])).toMatchObject({
        situacao: 'fechada',
      });

      // Lote cancelado e refeito: a guia já emitida fica com o número dela (a faixa esgotada não impede) e passa
      // a apontar para o lote novo; nenhum número é reemitido.
      await escrever(async (e) => {
        await e.executar("UPDATE lote_tiss SET situacao = 'cancelado' WHERE id = ?", [lotes[0]]);
        await e.executar("UPDATE conta_hospitalar SET situacao = 'fechada' WHERE id IN (?, ?)", [k.a, k.b]);
      });
      const r2 = await porta.executar(c, 'faturamento.gerarLote', await entrada([k.a]), op());
      lotes.push(Number(r2.resultado['lote']));
      const numeroA = String(
        (await lerUma('SELECT numero_guia_prestador FROM guia_tiss WHERE conta_hospitalar_id = ?', [k.a]))?.[
          'numero_guia_prestador'
        ],
      );
      expect(await xmlDe(lotes[1]!)).toContain(`numeroGuiaPrestador>${numeroA}<`);
      expect(
        await contar('SELECT COUNT(*) AS q FROM guia_tiss WHERE conta_hospitalar_id IN (?, ?)', [k.a, k.b]),
      ).toBe(2);
      expect(
        await contar('SELECT lote_tiss_id AS q FROM guia_tiss WHERE conta_hospitalar_id = ?', [k.a]),
      ).toBe(lotes[1]);
      expect(
        await contar('SELECT COUNT(*) AS q FROM faixa_numeracao_guia_uso WHERE faixa_numeracao_guia_id = ?', [
          faixa,
        ]),
      ).toBe(2);
      // Lote refeito depois de corrigir a conta (o motivo usual de refazer): a guia reusada é regravada com o valor
      // que o lote novo apresenta, o mesmo do arquivo e da fatura; o número segue o dela.
      await escrever(async (e) => {
        await e.executar("UPDATE lote_tiss SET situacao = 'cancelado' WHERE id = ?", [lotes[1]]);
        await e.executar(
          "UPDATE conta_hospitalar SET situacao = 'fechada', valor_itens = 150, valor_total = 150 WHERE id = ?",
          [k.a],
        );
        await e.executar(
          'UPDATE conta_hospitalar_item SET valor_unitario = 150, valor_total = 150 WHERE conta_hospitalar_id = ?',
          [k.a],
        );
      });
      const r3 = await porta.executar(c, 'faturamento.gerarLote', await entrada([k.a]), op());
      lotes.push(Number(r3.resultado['lote']));
      const guiaA = await lerUma(
        'SELECT numero_guia_prestador, valor_total, lote_tiss_id, situacao FROM guia_tiss WHERE conta_hospitalar_id = ?',
        [k.a],
      );
      expect(guiaA).toMatchObject({ numero_guia_prestador: numeroA, situacao: 'em_lote' });
      expect(Number(guiaA?.['valor_total'])).toBe(150);
      expect(Number(guiaA?.['lote_tiss_id'])).toBe(lotes[2]);
      expect(await contar('SELECT valor AS q FROM lote_tiss_conta WHERE lote_tiss_id = ?', [lotes[2]])).toBe(
        150,
      );

      // Guia que já existia com número e fora de lote (a que veio da importação, montada): vai ao arquivo com o
      // número dela mesmo com a faixa esgotada, e fica ligada ao lote, em lote, com o valor apresentado.
      const importada = await guiaImportada(k.c, `${P}IMP1`, 'resumo_internacao', ids.fonte);
      const r4 = await porta.executar(c, 'faturamento.gerarLote', await entrada([k.c]), op());
      lotes.push(Number(r4.resultado['lote']));
      const guiaC = await lerTodas(
        'SELECT id, numero_guia_prestador, valor_total, lote_tiss_id, situacao, origem FROM guia_tiss WHERE conta_hospitalar_id = ?',
        [k.c],
      );
      expect(guiaC).toHaveLength(1);
      expect(guiaC[0]).toMatchObject({
        numero_guia_prestador: `${P}IMP1`,
        situacao: 'em_lote',
        origem: 'migracao',
      });
      expect(Number(guiaC[0]?.['id'])).toBe(importada);
      expect(Number(guiaC[0]?.['valor_total'])).toBe(100);
      expect(Number(guiaC[0]?.['lote_tiss_id'])).toBe(lotes[3]);
      expect(await xmlDe(lotes[3]!)).toContain(`numeroGuiaPrestador>${P}IMP1<`);
      expect(
        await contar('SELECT COUNT(*) AS q FROM faixa_numeracao_guia_uso WHERE faixa_numeracao_guia_id = ?', [
          faixa,
        ]),
      ).toBe(2);

      // O número da guia é único por fonte pagadora, qualquer que seja o tipo de guia: a faixa nova cujo próximo
      // número já está em outra guia (aqui, uma guia de outro tipo com o mesmo número, como a que sairia de uma
      // faixa de outro tipo com os mesmos números, ou a que veio da importação) recusa o lote como regra de negócio,
      // sem gravar nada e sem gastar o número.
      const faixa2 = await escrever((e) =>
        e.inserir(
          `INSERT INTO faixa_numeracao_guia (estabelecimento_id, fonte_pagadora_id, tipo_guia, prefixo, tamanho_fixo,
             numero_inicial, numero_final, proximo_numero, vigencia_inicio, criado_em)
           VALUES (?, ?, 'internacao', 'F', 4, 7, 8, 7, '2026-01-01', ?)`,
          [ids.est, ids.fonte, new Date()],
        ),
      );
      faixas.push(faixa2);
      const colide = await guiaImportada(k.b, 'F0007', 'sp_sadt', ids.fonte);
      const antes2 = await contar('SELECT COUNT(*) AS q FROM lote_tiss WHERE estabelecimento_id = ?', [
        ids.est,
      ]);
      expect(
        codigo(await erroDe(porta.executar(c, 'faturamento.gerarLote', await entrada([k.d]), op()))),
      ).toBe('numero-de-guia-ja-usado');
      expect(
        await contar('SELECT COUNT(*) AS q FROM lote_tiss WHERE estabelecimento_id = ?', [ids.est]),
      ).toBe(antes2);
      expect(await contar('SELECT COUNT(*) AS q FROM guia_tiss WHERE conta_hospitalar_id = ?', [k.d])).toBe(
        0,
      );
      expect(
        await lerUma('SELECT situacao, proximo_numero FROM faixa_numeracao_guia WHERE id = ?', [faixa2]),
      ).toMatchObject({ situacao: 'ativa' });
      expect(
        await contar('SELECT proximo_numero AS q FROM faixa_numeracao_guia WHERE id = ?', [faixa2]),
      ).toBe(7);
      expect(await lerUma('SELECT situacao FROM conta_hospitalar WHERE id = ?', [k.d])).toMatchObject({
        situacao: 'fechada',
      });
      await escrever((e) => e.executar('DELETE FROM guia_tiss WHERE id = ?', [colide]));

      // A conta que trocou de convênio: a guia da fonte pagadora anterior não é reusada. A guia nasce de novo com o
      // número da faixa da operadora atual, e a antiga fica como estava.
      outraFonte = await escrever((e) =>
        garantir(
          e,
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          [`${P}FP2`],
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, registro_ans, criado_em) VALUES (?, ?, 'operadora', '999998', ?)",
          [`${P}FP2`, 'OPERADORA SINTETICA L0316 B', new Date()],
        ),
      );
      const antiga = await guiaImportada(k.d, `${P}OUT1`, 'resumo_internacao', outraFonte);
      const r5 = await porta.executar(c, 'faturamento.gerarLote', await entrada([k.d]), op());
      lotes.push(Number(r5.resultado['lote']));
      const guiasD = await lerTodas(
        'SELECT id, numero_guia_prestador, fonte_pagadora_id, lote_tiss_id, situacao FROM guia_tiss WHERE conta_hospitalar_id = ? ORDER BY id',
        [k.d],
      );
      expect(guiasD).toHaveLength(2);
      expect(guiasD[0]).toMatchObject({
        numero_guia_prestador: `${P}OUT1`,
        situacao: 'montada',
        lote_tiss_id: null,
      });
      expect(Number(guiasD[0]?.['id'])).toBe(antiga);
      expect(Number(guiasD[0]?.['fonte_pagadora_id'])).toBe(outraFonte);
      expect(guiasD[1]).toMatchObject({ numero_guia_prestador: 'F0007', situacao: 'em_lote' });
      expect(Number(guiasD[1]?.['fonte_pagadora_id'])).toBe(ids.fonte);
      expect(Number(guiasD[1]?.['lote_tiss_id'])).toBe(lotes[4]);
      const xmlD = await xmlDe(lotes[4]!);
      expect(xmlD).toContain('numeroGuiaPrestador>F0007<');
      expect(xmlD).not.toContain(`${P}OUT1`);
      expect(
        await contar('SELECT COUNT(*) AS q FROM faixa_numeracao_guia_uso WHERE faixa_numeracao_guia_id = ?', [
          faixa2,
        ]),
      ).toBe(1);
    } finally {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-f3111' }, async (e) => {
        for (const f of faixas)
          await e.executar('DELETE FROM faixa_numeracao_guia_uso WHERE faixa_numeracao_guia_id = ?', [f]);
        await e.executar(`DELETE FROM guia_tiss WHERE conta_hospitalar_id IN (${marcas})`, todas);
        for (const f of faixas) await e.executar('DELETE FROM faixa_numeracao_guia WHERE id = ?', [f]);
        if (outraFonte) await e.executar('DELETE FROM fonte_pagadora WHERE id = ?', [outraFonte]);
        for (const lote of lotes) {
          const a = await e.uma<{ arquivo_id: number }>('SELECT arquivo_id FROM lote_tiss WHERE id = ?', [
            lote,
          ]);
          await e.executar('DELETE FROM lote_tiss_conta WHERE lote_tiss_id = ?', [lote]);
          await e.executar(
            'DELETE FROM fatura_fonte_pagadora_conta WHERE fatura_fonte_pagadora_id IN (SELECT id FROM fatura_fonte_pagadora WHERE lote_tiss_id = ?)',
            [lote],
          );
          await e.executar('DELETE FROM fatura_fonte_pagadora WHERE lote_tiss_id = ?', [lote]);
          await e.executar('DELETE FROM lote_tiss WHERE id = ?', [lote]);
          await e.executar('DELETE FROM arquivo WHERE id = ?', [a?.arquivo_id ?? 0]);
        }
        await e.executar(`DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (${marcas})`, todas);
        await e.executar(`DELETE FROM conta_hospitalar WHERE id IN (${marcas})`, todas);
      });
    }
  }, 180_000);

  it('gerar o lote: lote, contas do lote, arquivo, conta faturada (versão +1) e trilha com a operação', async () => {
    const versao = await versaoDaConta(ids.conta);
    const ctx = op();
    const entrada = { convenio: ids.fonte, tipoGuia: 3, contas: [{ id: ids.conta, versao }] };
    const r = await porta.executar(c, 'faturamento.gerarLote', entrada, ctx);
    expect(r.repetida).toBe(false);
    ids.lote = Number(r.resultado['lote']);
    const lote = await lerUma(
      'SELECT situacao, numero_lote, tipo_guia, arquivo_id, hash_arquivo, fonte_pagadora_id FROM lote_tiss WHERE id = ?',
      [ids.lote],
    );
    expect(lote).toMatchObject({ situacao: 'gerado', tipo_guia: 'resumo_internacao' });
    expect(String(lote?.['numero_lote'])).toMatch(/^\d{12}$/);
    expect(
      await lerUma('SELECT COUNT(*) AS q FROM lote_tiss_conta WHERE lote_tiss_id = ?', [ids.lote]),
    ).toMatchObject({
      q: 1,
    });
    const arq = await lerUma('SELECT entidade_id, imutavel, hash_sha256 FROM arquivo WHERE id = ?', [
      lote?.['arquivo_id'],
    ]);
    expect(Number(arq?.['entidade_id'])).toBe(ids.lote);
    expect(arq?.['hash_sha256']).toBe(lote?.['hash_arquivo']);
    const conta = await lerUma('SELECT situacao, versao FROM conta_hospitalar WHERE id = ?', [ids.conta]);
    expect(versaoTexto(Number(conta?.['versao']))).toBe(versaoTexto(Number(versao.slice(1)) + 1));
    expect(conta?.['situacao']).toBe('faturada');
    // 06-FAT linha 31: a fatura ao pagador nasce fechada com o lote, a conta e o valor apresentado.
    const fatura = await lerUma(
      `SELECT f.situacao, f.quantidade_contas, f.valor_apresentado, f.fechado_em IS NOT NULL AS fechada,
              (SELECT COUNT(*) FROM fatura_fonte_pagadora_conta fc WHERE fc.fatura_fonte_pagadora_id = f.id
                  AND fc.conta_hospitalar_id = ?) AS contas
         FROM fatura_fonte_pagadora f WHERE f.lote_tiss_id = ?`,
      [ids.conta, ids.lote],
    );
    expect(fatura).toMatchObject({ situacao: 'fechada', quantidade_contas: 1, fechada: 1, contas: 1 });
    expect(Number(fatura?.['valor_apresentado'])).toBe(Number(r.resultado['valor']));
    expect(Number(r.resultado['fatura'])).toBeGreaterThan(0);
    const trilha = await lerUma(
      "SELECT entidade, entidade_id, JSON_VALUE(dados_depois, '$.operacao') AS operacao FROM trilha_auditoria WHERE id = ?",
      [r.trilha],
    );
    expect(trilha).toMatchObject({ entidade: 'lote_tiss', operacao: 'faturamento.gerar-lote' });
    // O XML leva o executante do cadastro, o CNES e o código do prestador reais e o total da conta.
    const chave = (await porta.xmlDoLote(c, ids.lote))?.chave ?? '';
    const xml = new TextDecoder().decode((await armazem.ler(chave)) ?? new Uint8Array());
    expect(xml).toContain('8316016');
    expect(xml).toContain('PRESTSINT01');
    expect(xml).toMatch(/valorTotalGeral>300\.00</);
    expect(xml).not.toContain('9999999');
    expect(Number(r.resultado['valor'])).toBe(300);
    // Repetida pela mesma chave: nada novo.
    const rep = await porta.executar(c, 'faturamento.gerarLote', entrada, ctx);
    expect(rep.repetida).toBe(true);
    // Recusas: a conta já em lote; a conta de outro estabelecimento; a entrada inválida.
    const v2 = await versaoDaConta(ids.conta);
    expect(
      codigo(
        await erroDe(
          porta.executar(
            c,
            'faturamento.gerarLote',
            { ...entrada, contas: [{ id: ids.conta, versao: v2 }] },
            op(),
          ),
        ),
      ),
    ).toBe('conta-em-lote');
    expect(
      codigo(
        await erroDe(
          porta.executar(
            c,
            'faturamento.gerarLote',
            { ...entrada, contas: [{ id: ids.contaB, versao: await versaoDaConta(ids.contaB) }] },
            op(),
          ),
        ),
      ),
    ).toBe('conta-inexistente');
    expect(
      (await erroDe(porta.executar(c, 'faturamento.gerarLote', { convenio: ids.fonte }, op()))).problema
        .status,
    ).toBe(400);
  }, 60_000);

  it('lotes, detalhe e XML do lote', async () => {
    const lista = await porta.lotes(c, {
      convenio: ids.fonte,
      de: hoje,
      ate: hoje,
      semProtocolo: true,
      convenios: null,
      pagina: 0,
      porPagina: 20,
      hoje,
    });
    expect(lista.total).toBe(1);
    expect(lista.itens[0]).toMatchObject({
      id: ids.lote,
      contas: 1,
      protocolo: '',
      congelado: false,
      situacao: 'gerado',
    });
    expect(lista.itens[0]?.xml?.hashArquivo).toMatch(/^[0-9a-f]{64}$/);
    const d = await porta.lote(c, ids.lote, hoje);
    expect(d?.contasDoLote.map((x) => x.conta)).toEqual([ids.conta]);
    expect(await porta.convenioDoLote(c, ids.lote)).toBe(ids.fonte);
    expect((await porta.xmlDoLote(c, ids.lote))?.convenio).toBe(ids.fonte);
    // Outro estabelecimento não vê o lote.
    expect(
      await porta.lote({ ...c, estabelecimento: ids.outroEst, hospital: `${P}B` }, ids.lote, hoje),
    ).toBeNull();
  });

  it('protocolo: registrar congela o lote; repetir recusa; limpar cancela o registro e o histórico guarda os dois', async () => {
    await porta.executar(
      c,
      'faturamento.registrarProtocolo',
      { lote: ids.lote, acao: 'registrar', protocolo: 'PRT0316', data: hoje, recibo: 'R1', situacao: 1 },
      op(),
    );
    expect(
      await lerUma('SELECT situacao, numero_protocolo FROM lote_tiss WHERE id = ?', [ids.lote]),
    ).toMatchObject({
      situacao: 'protocolado',
      numero_protocolo: 'PRT0316',
    });
    // 06-FAT linha 31: o protocolo chega à fatura do lote (número, entrega e situação).
    expect(
      await lerUma(
        'SELECT situacao, protocolo_recebimento, data_entrega IS NOT NULL AS entregue FROM fatura_fonte_pagadora WHERE lote_tiss_id = ?',
        [ids.lote],
      ),
    ).toMatchObject({ situacao: 'protocolada', protocolo_recebimento: 'PRT0316', entregue: 1 });
    // O recibo do comprovante fica no registro do protocolo e volta no histórico; a fatura aparece no detalhe do lote.
    expect(
      await lerUma(
        'SELECT recibo FROM protocolo_recebimento WHERE lote_tiss_id = ? AND numero_protocolo = ?',
        [ids.lote, 'PRT0316'],
      ),
    ).toMatchObject({ recibo: 'R1' });
    const detalhe = await porta.lote(c, ids.lote, hoje);
    expect(detalhe?.historico[0]).toMatchObject({ acao: 'registrado', protocolo: 'PRT0316', recibo: 'R1' });
    expect(detalhe?.fatura).toMatchObject({ situacao: 'protocolada', protocolo: 'PRT0316', entrega: hoje });
    expect(
      codigo(
        await erroDe(
          porta.executar(
            c,
            'faturamento.registrarProtocolo',
            { lote: ids.lote, acao: 'registrar', protocolo: 'OUTRO', situacao: null },
            op(),
          ),
        ),
      ),
    ).toBe('protocolo-ja-registrado');
    expect((await porta.lote(c, ids.lote, hoje))?.congelado).toBe(true);
    await porta.executar(
      c,
      'faturamento.registrarProtocolo',
      { lote: ids.lote, acao: 'limpar', protocolo: 'PRT0316', situacao: null },
      op(),
    );
    const d = await porta.lote(c, ids.lote, hoje);
    expect(d?.protocolo).toBe('');
    expect(
      await lerUma(
        'SELECT situacao, protocolo_recebimento FROM fatura_fonte_pagadora WHERE lote_tiss_id = ?',
        [ids.lote],
      ),
    ).toMatchObject({ situacao: 'fechada', protocolo_recebimento: null });
    expect(d?.historico.map((h) => h.acao)).toEqual(['limpo']);
    expect(
      await lerUma(
        "SELECT COUNT(*) AS q FROM protocolo_recebimento WHERE lote_tiss_id = ? AND situacao = 'cancelado'",
        [ids.lote],
      ),
    ).toMatchObject({ q: 1 });
    // Registrar de novo o mesmo número (a limpeza foi por engano) reativa o registro cancelado, sem duplicar.
    await porta.executar(
      c,
      'faturamento.registrarProtocolo',
      { lote: ids.lote, acao: 'registrar', protocolo: 'PRT0316', data: hoje, situacao: 1 },
      op(),
    );
    expect(
      await lerUma(
        "SELECT COUNT(*) AS q, SUM(situacao = 'recebido') AS vivos FROM protocolo_recebimento WHERE lote_tiss_id = ?",
        [ids.lote],
      ),
    ).toMatchObject({ q: 1, vivos: expect.anything() });
    expect(
      Number(
        (
          await lerUma(
            "SELECT COUNT(*) AS q FROM protocolo_recebimento WHERE lote_tiss_id = ? AND situacao = 'recebido'",
            [ids.lote],
          )
        )?.['q'],
      ),
    ).toBe(1);
    expect((await porta.lote(c, ids.lote, hoje))?.protocolo).toBe('PRT0316');
    // E volta a limpar, para os testes seguintes partirem do lote sem protocolo.
    await porta.executar(
      c,
      'faturamento.registrarProtocolo',
      { lote: ids.lote, acao: 'limpar', protocolo: 'PRT0316', situacao: null },
      op(),
    );
  });

  it('competência: fechar grava o retrato; fechar de novo recusa; a leitura diz fechada', async () => {
    const r = await porta.executar(
      c,
      'faturamento.fecharCompetencia',
      { convenio: ids.fonte, ano: anoAnt, mes: mesAnt },
      op(),
    );
    const f = await lerUma(
      'SELECT situacao, fechado_por_usuario_id FROM fechamento_competencia_fonte_pagadora WHERE id = ?',
      [r.resultado['fechamento']],
    );
    expect(f).toMatchObject({ situacao: 'fechada', fechado_por_usuario_id: ids.usuario });
    await erroDe(
      porta.executar(
        c,
        'faturamento.fecharCompetencia',
        { convenio: ids.fonte, ano: anoAnt, mes: mesAnt },
        op(),
      ),
    );
    expect(await porta.resumoCompetencia(c, { convenio: ids.fonte, ano: anoAnt, mes: mesAnt })).toMatchObject(
      {
        fechada: true,
        fechadaPor: 'l0316.teste',
      },
    );
    const atual = await porta.competencias(c, { convenio: ids.fonte, ano: null, convenios: null });
    expect(atual.find((x) => x.fechada === false)).toMatchObject({ contas: 1, emLote: 1, valor: 300 });
  });

  it('competência: reabrir grava quem, quando e o motivo, guarda o retrato; conta em lote exige confirmar o impacto; fecha de novo sem sobrescrever o ciclo', async () => {
    const comp = { convenio: ids.fonte, ano: anoAnt, mes: mesAnt };
    const dia = `${anoAnt}-${String(mesAnt).padStart(2, '0')}-01`;
    const antes = await lerUma(
      'SELECT id, quantidade_contas, valor_apresentado, fechado_em FROM fechamento_competencia_fonte_pagadora WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND competencia = ?',
      [ids.est, ids.fonte, dia],
    );
    const lote = await lerUma(
      `SELECT COUNT(*) AS q FROM conta_hospitalar ch
        WHERE ch.estabelecimento_id = ? AND ch.fonte_pagadora_id = ? AND ch.competencia = ? AND ch.excluido_em IS NULL
          AND ch.situacao <> 'cancelada'
          AND EXISTS (SELECT 1 FROM lote_tiss_conta ltc JOIN lote_tiss lt ON lt.id = ltc.lote_tiss_id
                       WHERE ltc.conta_hospitalar_id = ch.id AND ltc.excluido_em IS NULL AND lt.excluido_em IS NULL
                         AND lt.situacao <> 'cancelado')`,
      [ids.est, ids.fonte, dia],
    );
    const emLote = Number(lote!['q']);
    // Conta já apresentada à operadora: sem a confirmação, recusa mostrando o impacto, sem gravar nada.
    if (emLote > 0) {
      const e0 = await erroDe(
        porta.executar(c, 'faturamento.reabrirCompetencia', { ...comp, motivo: 'conta esquecida' }, op()),
      );
      expect(codigo(e0)).toBe('competencia-apresentada');
      expect((await porta.resumoCompetencia(c, comp)).fechada).toBe(true);
    }
    const r = await porta.executar(
      c,
      'faturamento.reabrirCompetencia',
      { ...comp, motivo: 'conta esquecida', confirmarImpacto: emLote > 0 },
      op(),
    );
    expect(r.resultado['fechamento']).toBe(antes!['id']);
    const f = await lerUma(
      `SELECT situacao, reaberto_por_usuario_id, motivo_reabertura, reaberto_em IS NOT NULL AS quando,
              quantidade_contas, valor_apresentado, fechado_em FROM fechamento_competencia_fonte_pagadora WHERE id = ?`,
      [antes!['id']],
    );
    expect(f).toMatchObject({
      situacao: 'reaberta',
      reaberto_por_usuario_id: ids.usuario,
      motivo_reabertura: 'conta esquecida',
      quantidade_contas: antes!['quantidade_contas'],
      valor_apresentado: antes!['valor_apresentado'],
    });
    expect(Number(f!['quando'])).toBe(1);
    expect(f!['fechado_em']).toEqual(antes!['fechado_em']);
    expect(await porta.resumoCompetencia(c, comp)).toMatchObject({
      fechada: false,
      reaberta: true,
      reabertaPor: 'l0316.teste',
      motivoReabertura: 'conta esquecida',
      ciclos: 2,
    });
    const e = await erroDe(
      porta.executar(c, 'faturamento.reabrirCompetencia', { ...comp, motivo: 'segunda vez' }, op()),
    );
    expect(codigo(e)).toBe('competencia-aberta');
    await porta.executar(c, 'faturamento.fecharCompetencia', comp, op());
    expect(await porta.resumoCompetencia(c, comp)).toMatchObject({
      fechada: true,
      reaberta: false,
      ciclos: 3,
    });
    // A linha guarda só o estado atual (sem a reabertura antiga); os dois retratos e a reabertura ficam nos ciclos.
    expect(
      await lerUma(
        'SELECT reaberto_em, reaberto_por_usuario_id, motivo_reabertura FROM fechamento_competencia_fonte_pagadora WHERE id = ?',
        [antes!['id']],
      ),
    ).toMatchObject({ reaberto_em: null, reaberto_por_usuario_id: null, motivo_reabertura: null });
    const ciclos = await lerTodas(
      `SELECT tipo, usuario_id, quantidade_contas, valor_apresentado, contas_em_lote, impacto_confirmado, motivo
         FROM ciclo_competencia_fonte_pagadora WHERE fechamento_competencia_fonte_pagadora_id = ? ORDER BY id`,
      [antes!['id']],
    );
    expect(ciclos.map((x) => x['tipo'])).toEqual(['fechamento', 'reabertura', 'fechamento']);
    expect(ciclos[0]).toMatchObject({
      usuario_id: ids.usuario,
      quantidade_contas: antes!['quantidade_contas'],
      valor_apresentado: antes!['valor_apresentado'],
      motivo: null,
    });
    expect(ciclos[1]).toMatchObject({ motivo: 'conta esquecida', contas_em_lote: emLote });
    expect(Number(ciclos[1]!['impacto_confirmado'])).toBe(emLote > 0 ? 1 : 0);
  });

  it('glosa: a decisão de aceitar grava no item, a grade e o painel somam; decidir de novo recusa', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-03-16' }, async (e) => {
      const agora = new Date();
      const glosa = await e.inserir(
        `INSERT INTO glosa (estabelecimento_id, numero, fonte_pagadora_id, procedencia, conta_hospitalar_id, data_glosa,
           competencia, valor_apresentado, valor_glosado, data_limite_recurso, criado_em)
         VALUES (?, ?, ?, 'digitacao', ?, ?, ?, 300, 100, ?, ?)`,
        [ids.est, `${P}-G1`, ids.fonte, ids.conta, hoje, competencia, hoje, agora],
      );
      await e.inserir(
        `INSERT INTO glosa_item (glosa_id, sequencia, conta_hospitalar_item_id, motivo_glosa_id, quantidade_apresentada,
           quantidade_glosada, valor_apresentado, valor_glosado, criado_em)
         VALUES (?, 1, ?, ?, 3, 1, 300, 100, ?)`,
        [glosa, ids.itemConta, ids.motivo, agora],
      );
      // Uma segunda glosa do mesmo item, mais recente porém cancelada: não conta nem é decidida.
      const cancelada = await e.inserir(
        `INSERT INTO glosa (estabelecimento_id, numero, fonte_pagadora_id, procedencia, conta_hospitalar_id, data_glosa,
           competencia, valor_apresentado, valor_glosado, situacao, cancelado_em, motivo_cancelamento, criado_em)
         VALUES (?, ?, ?, 'auditoria_interna', ?, ?, ?, 300, 250, 'cancelada', ?, 'lancada em duplicidade', ?)`,
        [ids.est, `${P}-G0`, ids.fonte, ids.conta, hoje, competencia, agora, agora],
      );
      await e.inserir(
        `INSERT INTO glosa_item (glosa_id, sequencia, conta_hospitalar_item_id, motivo_glosa_id, quantidade_apresentada,
           quantidade_glosada, valor_apresentado, valor_glosado, criado_em)
         VALUES (?, 1, ?, ?, 3, 3, 300, 250, ?)`,
        [cancelada, ids.itemConta, ids.motivo, agora],
      );
    });
    expect(await porta.itensDaConta(c, ids.conta, '')).toHaveLength(1);
    const antes = await porta.itensDaConta(c, ids.conta, '');
    expect(antes[0]).toMatchObject({
      conciliado: true,
      glosa: 100,
      valorPago: 200,
      estado: 'pendente',
      motivo: 9316,
    });
    const trilhaDe = (x: { id: number }) => ({
      ...base,
      acao: 'alteracao' as const,
      entidade: 'glosa_item',
      entidadeId: x.id,
      motivo: 'decisão da glosa (teste)',
    });
    const r = await porta.gravarSgh(c, trilhaDe, (g) =>
      g.decidirGlosa({
        item: ids.itemConta,
        decisao: 'aceitar',
        texto: 'glosa procedente',
        evidencia: '',
        usuario: 'x',
        prazo: null,
      }),
    );
    expect(r).toMatchObject({ estado: 'aceita', conta: ids.conta, glosa: 100 });
    expect(
      await lerUma('SELECT decisao, valor_aceito, decidido_por_usuario_id FROM glosa_item WHERE id = ?', [
        r.id,
      ]),
    ).toMatchObject({ decisao: 'aceitar', decidido_por_usuario_id: ids.usuario });
    // O cabeçalho acompanha a decisão (valor aceito e situação); a cancelada fica como estava.
    expect(
      await lerUma('SELECT situacao, valor_aceito FROM glosa WHERE estabelecimento_id = ? AND numero = ?', [
        ids.est,
        `${P}-G1`,
      ]),
    ).toMatchObject({ situacao: 'aceita_total' });
    expect(
      Number(
        (await lerUma('SELECT valor_aceito FROM glosa WHERE numero = ?', [`${P}-G1`]))?.['valor_aceito'],
      ),
    ).toBe(100);
    expect(
      await lerUma('SELECT situacao FROM glosa WHERE estabelecimento_id = ? AND numero = ?', [
        ids.est,
        `${P}-G0`,
      ]),
    ).toMatchObject({ situacao: 'cancelada' });
    expect(
      await lerUma(
        "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'glosa_item' AND entidade_id = ?",
        [r.id],
      ),
    ).toMatchObject({ q: 1 });
    expect((await porta.itensDaConta(c, ids.conta, ''))[0]?.estado).toBe('aceita');
    const e = await erroDe(
      porta.gravarSgh(c, trilhaDe, (g) =>
        g.decidirGlosa({
          item: ids.itemConta,
          decisao: 'recorrer',
          texto: 'nova tentativa',
          evidencia: '',
          usuario: 'x',
          prazo: null,
        }),
      ),
    );
    expect(codigo(e)).toBe('glosa-decidida');
    const [ano, mes] = [Number(competencia.slice(0, 4)), Number(competencia.slice(5, 7))];
    const grade = await porta.grade(c, {
      convenios: null,
      convenio: ids.fonte,
      ano,
      mes,
      estado: 'com-glosa',
      pagina: 0,
      porPagina: 20,
    });
    expect(grade.contas[0]).toMatchObject({
      conta: ids.conta,
      cobrado: 300,
      pago: 200,
      glosa: 100,
      itensGlosados: 1,
    });
    const painel = await porta.painel(c, { de: competencia, ate: hoje, convenios: null });
    expect(painel.somas).toMatchObject({ emitido: 300, conciliado: 300, pago: 200, glosaLiquida: 100 });
    expect(painel.porMotivo[0]).toMatchObject({ codigo: 9316, glosa: 100, itens: 1 });
  });

  it('canal de envio e mensagem TISS: gravam e aparecem na configuração e no lote', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-03-16' }, (e) =>
      garantir(
        e,
        "SELECT id FROM transacao_tiss_webservice WHERE codigo_transacao = 'L0316ENV'",
        [],
        `INSERT INTO transacao_tiss_webservice (versao_tiss, codigo_transacao, nome, tipo_transacao, criado_em)
         VALUES ('04.03.00', 'L0316ENV', 'TRANSACAO SINTETICA L0316', 'envio_lote', ?)`,
        [new Date()],
      ),
    );
    const t = await lerUma(
      "SELECT codigo_transacao FROM transacao_tiss_webservice WHERE codigo_transacao = 'L0316ENV'",
      [],
    );
    if (t) {
      const x = await porta.gravarSgh(
        c,
        (r: { id: number }) => ({
          ...base,
          acao: 'inclusao' as const,
          entidade: 'endpoint_tiss_fonte_pagadora',
          entidadeId: r.id,
        }),
        (g) =>
          g.editarEndpoint({
            convenio: ids.fonte,
            transacao: String(t['codigo_transacao']),
            url: 'https://operadora.invalid/tiss',
            referenciaCofre: 'cofre:tiss/l0316',
            ativo: true,
            usuario: 'x',
          }),
      );
      expect(x.id).toBeGreaterThan(0);
      expect(
        await lerUma('SELECT tipo_autenticacao FROM endpoint_tiss_fonte_pagadora WHERE id = ?', [x.id]),
      ).toMatchObject({ tipo_autenticacao: 'basica' });
      // Canal com certificado: editar a URL ou o ativo não troca o tipo de autenticação.
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-03-16' }, (e) =>
        e.executar("UPDATE endpoint_tiss_fonte_pagadora SET tipo_autenticacao = 'certificado' WHERE id = ?", [
          x.id,
        ]),
      );
      await porta.gravarSgh(
        c,
        { ...base, acao: 'alteracao' as const, entidade: 'endpoint_tiss_fonte_pagadora', entidadeId: x.id },
        (g) =>
          g.editarEndpoint({
            convenio: ids.fonte,
            transacao: 'L0316ENV',
            url: 'https://operadora.invalid/tiss/v2',
            referenciaCofre: 'cofre:tiss/l0316',
            ativo: false,
            usuario: 'x',
          }),
      );
      expect(
        await lerUma('SELECT tipo_autenticacao, url, ativo FROM endpoint_tiss_fonte_pagadora WHERE id = ?', [
          x.id,
        ]),
      ).toMatchObject({
        tipo_autenticacao: 'certificado',
        url: 'https://operadora.invalid/tiss/v2',
        ativo: 0,
      });
      expect(
        (await porta.configuracao(c)).endpoints.some((e) => e.referenciaCofre === 'cofre:tiss/l0316'),
      ).toBe(true);
    }
    const m = await porta.gravarSgh(
      c,
      (r: { id: number }) => ({
        ...base,
        acao: 'inclusao' as const,
        entidade: 'integracao_mensagem',
        entidadeId: r.id,
      }),
      (g) =>
        g.registrarMensagem({
          usuario: 'l0316.teste',
          lote: ids.lote,
          conta: null,
          convenio: ids.fonte,
          transacao: 'ENVIO_LOTE_GUIAS',
          direcao: 'envio',
          destino: 'simulador',
          hashRequisicao: 'a'.repeat(64),
          hashResposta: null,
          tentativa: 1,
          situacao: 'aceita',
          protocolo: 'SIM0316',
        }),
    );
    expect(
      await lerUma('SELECT situacao, direcao FROM integracao_mensagem WHERE id = ?', [m.id]),
    ).toMatchObject({
      situacao: 'processada',
      direcao: 'saida',
    });
    expect((await porta.lote(c, ids.lote, hoje))?.mensagens[0]).toMatchObject({
      direcao: 'envio',
      destino: 'simulador',
      situacao: 'aceita',
      transacao: 'ENVIO_LOTE_GUIAS',
    });
    expect((await porta.configuracao(c)).versaoGerada).toBe('04.03.00');
  });

  it('acompanhamento: contas, lotes e gravações da competência pela trilha', async () => {
    const [ano, mes] = [Number(competencia.slice(0, 4)), Number(competencia.slice(5, 7))];
    const a = await porta.acompanhamento(c, {
      ano,
      mes,
      convenio: null,
      convenios: null,
      operacoes: ['faturamento.gerarLote', 'faturamento.fecharConta'],
      titulos: false,
      contasBancarias: null,
      repasse: false,
      uso: null,
    });
    expect(a.contas).toEqual([
      { convenio: ids.fonte, situacao: 'A', contas: 1, fechadasPeloNovo: 1, valor: 300 },
    ]);
    expect(a.lotes).toMatchObject({ lotes: 1, contasEmLote: 1, conveniosComConta: 1 });
    expect(a.gravacoes.find((g) => g.operacao === 'faturamento.gerarLote')?.peloNovo).toBeGreaterThanOrEqual(
      1,
    );
    expect(a.uso).toBeNull();
  });

  it('baixa, recurso e retorno saíram das pendentes (contrato em glosa-recurso.int.spec.ts); a importação do demonstrativo ainda recusa sem gravar', async () => {
    for (const o of [
      'faturamento.registrarGlosa',
      'faturamento.registrarRecurso',
      'faturamento.registrarRetornoRecurso',
    ])
      expect(await porta.podeGravar(c, o)).toMatchObject({ pode: true });
    expect(
      codigo(
        await erroDe(
          porta.gravarSgh(
            c,
            { ...base, acao: 'inclusao', entidade: 'lote_tiss', entidadeId: ids.lote },
            (g) =>
              g.importarDemonstrativo({
                usuario: 'x',
                lote: ids.lote,
                tipo: 'analise',
                origem: 'digitacao',
                numero: 'D1',
                dataEmissao: hoje,
                itens: [],
                hashArquivo: null,
                chaveObjeto: null,
              }),
          ),
        ),
      ),
    ).toBe('operacao-pendente');
    expect(await porta.contasBancariasDoEscopo(c, 'l0316.teste')).toEqual([]);
  });

  it('glosa: recorrer grava a evidência do prontuário, a leitura auditada a devolve e a lista só diz que existe; aceitar grava sem evidência', async () => {
    const [recorrido, aceito] = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-teste-evidencia' },
      async (e) => {
        const agora = new Date();
        const item = (seq: number) =>
          e.inserir(
            `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
             valor_unitario, valor_total, criado_em)
           VALUES (?, ?, ?, ?, 1, 100, 100, ?)`,
            [ids.conta, seq, ids.item, agora, agora],
          );
        const i8 = await item(8);
        const i9 = await item(9);
        const glosa = await e.inserir(
          `INSERT INTO glosa (estabelecimento_id, numero, fonte_pagadora_id, procedencia, conta_hospitalar_id, data_glosa,
           competencia, valor_apresentado, valor_glosado, data_limite_recurso, criado_em)
         VALUES (?, ?, ?, 'digitacao', ?, ?, ?, 200, 80, ?, ?)`,
          [ids.est, `${P}-G9`, ids.fonte, ids.conta, hoje, competencia, hoje, agora],
        );
        for (const [seq, it] of [
          [1, i8],
          [2, i9],
        ] as const)
          await e.inserir(
            `INSERT INTO glosa_item (glosa_id, sequencia, conta_hospitalar_item_id, motivo_glosa_id, quantidade_apresentada,
             quantidade_glosada, valor_apresentado, valor_glosado, criado_em)
           VALUES (?, ?, ?, ?, 1, 1, 100, 40, ?)`,
            [glosa, seq, it, ids.motivo, agora],
          );
        return [i8, i9];
      },
    );
    const trilhaDe = (x: { id: number }) => ({
      ...base,
      acao: 'alteracao' as const,
      entidade: 'glosa_item',
      entidadeId: x.id,
      motivo: 'decisão da glosa com evidência (teste)',
    });
    const decidir = (item: number, decisao: 'recorrer' | 'aceitar') =>
      porta.gravarSgh(c, trilhaDe, (g) =>
        g.decidirGlosa({
          item,
          decisao,
          texto: decisao === 'recorrer' ? 'procedimento registrado em evolução' : 'glosa procedente',
          evidencia: '  Evolução sintética do dia 2 registra o procedimento  ',
          usuario: 'x',
          prazo: null,
        }),
      );
    const r1 = await decidir(recorrido, 'recorrer');
    const r2 = await decidir(aceito, 'aceitar');
    const coluna = async (id: number) =>
      (await lerUma('SELECT evidencia_prontuario AS e FROM glosa_item WHERE id = ?', [id]))?.['e'] ?? null;
    expect(await coluna(r1.id)).toBe('Evolução sintética do dia 2 registra o procedimento');
    expect(await coluna(r2.id)).toBeNull();
    expect(await porta.evidenciaDoItem(c, recorrido)).toMatchObject({
      item: recorrido,
      evidencia: 'Evolução sintética do dia 2 registra o procedimento',
    });
    expect(await porta.evidenciaDoItem(c, aceito)).toBeNull();
    const itens = await porta.itensDaConta(c, ids.conta, '');
    expect(itens.find((x) => x.item === recorrido)?.decisao).toMatchObject({ temEvidencia: true });
    expect(itens.find((x) => x.item === aceito)?.decisao).toMatchObject({ temEvidencia: false });
    // A evidência é dado clínico: a lista não a carrega.
    expect(JSON.stringify(itens)).not.toContain('Evolução sintética');
  });
});

// A mesma bateria nas duas fábricas: entrada inválida recusa (400) e a lista de situações do protocolo existe.
const fabricas: [string, () => Promise<{ porta: PortaTiss; c: ContextoTiss; fim: () => Promise<void> }>][] = [
  [
    'memória',
    async () => ({
      porta: new PortaTissMemoria({ estado: () => 'verde' }),
      c: { cliente: 'x', estabelecimento: 1, usuario: 1, correlacao: 'mem', rede: 'r', hospital: 'aa' },
      fim: async () => {},
    }),
  ],
  ...(SEM_BANCO
    ? []
    : ([
        [
          'banco',
          async () => {
            const nucleo = new NucleoProprio();
            return {
              porta: new PortaTissPropria(nucleo, CLIENTE, armazemXmlMemoria()),
              c: {
                cliente: CLIENTE,
                estabelecimento: null,
                usuario: null,
                correlacao: 'bat',
                rede: 'r',
                hospital: `${P}A`,
              },
              fim: () => nucleo.encerrar(),
            };
          },
        ],
      ] as [string, () => Promise<{ porta: PortaTiss; c: ContextoTiss; fim: () => Promise<void> }>][])),
];

describe.each(fabricas)('bateria comum do pós-fechamento (%s)', (_nome, fabrica) => {
  it('entrada inválida recusa com 400; situações do protocolo listadas', async () => {
    const { porta, c, fim } = await fabrica();
    try {
      const ctx: ContextoOperacao = {
        cliente: c.cliente,
        estabelecimento: c.estabelecimento ?? 1,
        usuario: c.usuario,
        correlacao: c.correlacao,
        chaveIdempotencia: `bat-${randomUUID()}`,
      };
      const e = await erroDe(porta.executar(c, 'faturamento.gerarLote', { convenio: 1 }, ctx));
      expect(e.problema.status).toBe(400);
      expect((await porta.situacoesProtocolo(c)).length).toBeGreaterThan(0);
    } finally {
      await fim();
    }
  });
});
