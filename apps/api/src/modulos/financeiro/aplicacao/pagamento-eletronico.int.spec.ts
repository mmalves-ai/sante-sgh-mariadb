// F3.8, 07-FIN linha 66: contrato de efeito do pagamento eletrônico contra o MariaDB real (massa SINTÉTICA "L0207").
// Retorno do banco: o pago ganha a baixa na conta da remessa com o movimento bancário (data e valor do banco), o pago a
// menor deixa a parcela parcial, o rejeitado volta à fila sem baixa, o agendado continua aguardando e o título que não é
// da remessa fica registrado como não localizado; o mesmo arquivo não entra duas vezes, o arquivo de outro banco é
// recusado inteiro e o pagamento repetido não gera segunda baixa. Dados bancários do credor: forma canônica gravada,
// chave trocada guardada no histórico, preferencial única, desativar não apaga, lista mascarada. Remessa por Pix:
// gravada com as parcelas aguardando o retorno; credor sem chave, parcela já enviada e arquivo desatualizado recusam.
import { createHash, randomUUID } from 'node:crypto';
import { montarRetornoCnab240 } from '@sgh/dominio-financeiro';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contasDoCredor,
  montarRemessaPix,
  OPERACOES_PAGAMENTO_ELETRONICO,
  remessasComPendencia,
  retornoSimulado,
  retornosDaRemessa,
} from '../pagamento-eletronico-propria.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import {
  CLIENTE,
  codigoDe,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
  tituloDaMassa,
} from './massa-banco.spec-util.js';

const BANCO = 987;
const HOJE = new Date().toISOString().slice(0, 10);
const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-pe-${randomUUID()}` });
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const TITULAR = { titularNome: 'Fornecedor Sintético L0207', titularDocumento: '11.222.333/0001-81' };
const CONTA_BASE = {
  ...TITULAR,
  tipoConta: 'corrente' as const,
  banco: null as number | null,
  agencia: '',
  digitoAgencia: '',
  conta: '',
  digitoConta: '',
  tipoChavePix: null as string | null,
  chavePix: '',
  preferencial: false,
};

describe.skipIf(SEM_BANCO)('pagamento eletrônico a credores (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  let banco = 0;
  let documento = 660_000;
  const ler = <T>(fn: Parameters<MassaFinanceiro['nucleo']['lerSomente']>[1]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'pe-02-07' }, fn) as Promise<T>;
  const uma = (sql: string, p: unknown[]) => ler<Record<string, unknown> | null>((l) => l.uma(sql, p));
  const varias = (sql: string, p: unknown[]) =>
    ler<Record<string, unknown>[]>((l) => l.consultar(sql, p, { teto: 500 }));
  const contar = async (sql: string, p: unknown[]) => Number((await uma(sql, p))?.['n'] ?? 0);
  const executar = (nome: keyof typeof OPERACOES_PAGAMENTO_ELETRONICO, entrada: unknown, est?: number) =>
    m.nucleo
      .criarExecutor()
      .executar(OPERACOES_PAGAMENTO_ELETRONICO[nome] as never, CLIENTE, entrada, op(m.ctx(m.paga, est)))
      .then((r) => r.resultado as Record<string, unknown>);
  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'gravou';
    } catch (e) {
      return codigoDe(e);
    }
  };
  /** Lança um título de uma parcela e devolve o id da parcela (o número que vai ao banco). */
  const parcela = async (valor: number) => {
    documento += 1;
    const c = m.ctx(m.lanca);
    const t = await porta.executar(
      c,
      'financeiro.criarTituloPagar',
      tituloDaMassa(m, documento, valor),
      op(c),
    );
    const tituloPagar = Number(t.resultado['tituloPagar'] ?? 0);
    const p = tituloPagar
      ? await uma('SELECT id FROM parcela_pagar WHERE titulo_pagar_id = ? ORDER BY id LIMIT 1', [tituloPagar])
      : await uma('SELECT id FROM parcela_pagar WHERE id = ?', [Number(t.resultado['titulo'])]);
    return Number(p?.['id']);
  };
  /** A remessa por arquivo já gerada (as parcelas aguardam o retorno). */
  const remessa = async (parcelas: readonly { id: number; valor: number }[]) => {
    await porta.gravarSgh(
      op(m.ctx(m.paga)),
      {
        estabelecimento: null,
        usuario: null,
        acao: 'operacao' as const,
        entidade: 'remessa_bancaria',
        entidadeId: 0,
        correlacao: null,
      },
      (g) =>
        g.registrarRemessa({
          usuario: 'x',
          conta: m.contaA,
          leiaute: 'cnab240',
          titulos: parcelas.length,
          valorTotal: parcelas.reduce((s, p) => s + p.valor, 0),
          hashArquivo: randomUUID().replaceAll('-', '').padEnd(64, '0'),
          parcelas: parcelas.map((p) => ({ parcela: p.id, valor: p.valor, vencimento: HOJE })),
          arquivo: null,
          destino: 'banco',
          situacao: 'gerada',
          hashRetorno: null,
          ocorrencias: null,
        }),
    );
    const r = await uma('SELECT MAX(id) AS id FROM remessa_bancaria WHERE estabelecimento_id = ?', [m.est]);
    return Number(r?.['id']);
  };
  const parcelaLida = async (id: number) => {
    const r = await uma(
      `SELECT p.situacao, p.saldo, p.valor_pago, p.quitada_em, t.situacao AS titulo
         FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id WHERE p.id = ?`,
      [id],
    );
    return {
      situacao: String(r?.['situacao']),
      saldo: Number(r?.['saldo']),
      pago: Number(r?.['valor_pago']),
      titulo: String(r?.['titulo']),
    };
  };
  const baixas = (id: number) =>
    varias(
      `SELECT b.forma_pagamento, b.valor_principal, b.valor_acrescimo, b.valor_pago, b.data_pagamento,
              b.conta_bancaria_id, mv.valor AS movimento, mv.natureza, mv.conta_bancaria_id AS conta_movimento
         FROM baixa_titulo b LEFT JOIN movimento_bancario mv ON mv.id = b.movimento_bancario_id
        WHERE b.parcela_pagar_id = ? ORDER BY b.id`,
      [id],
    );
  const vinculo = async (rem: number, id: number) =>
    String(
      (
        await uma(
          'SELECT situacao FROM parcela_remessa_bancaria WHERE remessa_bancaria_id = ? AND parcela_pagar_id = ?',
          [rem, id],
        )
      )?.['situacao'],
    );
  const limparProprio = () =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-pe-02-07' }, async (e) => {
      const ests = [m.est, m.outroEst];
      await e.executar(
        `DELETE i FROM retorno_bancario_item i JOIN retorno_bancario r ON r.id = i.retorno_bancario_id
          WHERE r.estabelecimento_id IN (?, ?)`,
        ests,
      );
      await e.executar('DELETE FROM retorno_bancario WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar(
        `DELETE k FROM chave_pix_credor k JOIN conta_bancaria_credor c ON c.id = k.conta_bancaria_credor_id
          WHERE c.empresa_fornecedora_id = ?`,
        [m.fornecedor],
      );
      await e.executar('DELETE FROM conta_bancaria_credor WHERE empresa_fornecedora_id = ?', [m.fornecedor]);
    });
  const codigoDoBanco = (valor: string | null) =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-pe-02-07' }, (e) =>
      e.executar('UPDATE banco SET codigo_compensacao = ? WHERE id = ?', [valor, banco]),
    );

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
    await limparProprio();
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
    m = await montarMassa();
    banco = Number((await uma('SELECT banco_id FROM conta_bancaria WHERE id = ?', [m.contaA]))?.['banco_id']);
    // O banco sintético da massa não tem código de compensação; o retorno confere o banco pelo código.
    await codigoDoBanco(String(BANCO));
  }, 120_000);

  afterAll(async () => {
    if (!m) return;
    await limparProprio();
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
    await codigoDoBanco(null);
    await m.nucleo.encerrar?.();
  }, 120_000);

  describe('retorno do banco', () => {
    let rem = 0;
    let paga = 0;
    let rejeitada = 0;
    let agendada = 0;
    let parcial = 0;
    const retornos = () =>
      contar('SELECT COUNT(*) AS n FROM retorno_bancario WHERE remessa_bancaria_id = ?', [rem]);

    it('baixa o pago, devolve o rejeitado, mantém o agendado e registra cada ocorrência', async () => {
      paga = await parcela(100);
      rejeitada = await parcela(50);
      agendada = await parcela(70);
      parcial = await parcela(80);
      rem = await remessa([
        { id: paga, valor: 100 },
        { id: rejeitada, valor: 50 },
        { id: agendada, valor: 70 },
        { id: parcial, valor: 80 },
      ]);
      const conteudo = montarRetornoCnab240(BANCO, 1, [
        { titulo: paga, valor: 100, ocorrencias: ['00'], dataPagamento: HOJE, valorPago: 100 },
        { titulo: rejeitada, valor: 50, ocorrencias: ['AG', 'AE'] },
        { titulo: agendada, valor: 70, ocorrencias: ['BD'], dataPagamento: HOJE },
        { titulo: parcial, valor: 80, ocorrencias: ['00'], dataPagamento: HOJE, valorPago: 60 },
        { titulo: 999_999_991, valor: 30, ocorrencias: ['00'], dataPagamento: HOJE, valorPago: 30 },
      ]);
      const r = await executar('financeiro.processarRetornoPagamento', {
        remessa: rem,
        nomeArquivo: 'retorno-sintetico-1.ret',
        conteudo,
      });
      expect(r).toMatchObject({
        baixados: 2,
        rejeitados: 1,
        agendados: 1,
        naoLocalizados: 1,
        totalBaixado: 160,
        pendentes: 1,
        situacaoRemessa: 'aceita',
      });
      // O pago: parcela quitada, título pago, uma baixa por transferência na conta da remessa com o movimento a débito.
      expect(await parcelaLida(paga)).toEqual({ situacao: 'paga', saldo: 0, pago: 100, titulo: 'pago' });
      const b = await baixas(paga);
      expect(b).toHaveLength(1);
      expect(b[0]).toMatchObject({ forma_pagamento: 'transferencia', natureza: 'debito' });
      expect(Number(b[0]?.['valor_pago'])).toBe(100);
      expect(Number(b[0]?.['movimento'])).toBe(100);
      expect(Number(b[0]?.['conta_bancaria_id'])).toBe(m.contaA);
      expect(Number(b[0]?.['conta_movimento'])).toBe(m.contaA);
      expect(iso(b[0]?.['data_pagamento'])).toBe(HOJE);
      // O pago a menor: baixa só do que o banco pagou; a parcela continua com saldo e o título, pago em parte.
      expect(await parcelaLida(parcial)).toEqual({
        situacao: 'parcial',
        saldo: 20,
        pago: 60,
        titulo: 'pago_parcial',
      });
      expect(Number((await baixas(parcial))[0]?.['valor_principal'])).toBe(60);
      // O rejeitado e o agendado: sem baixa, parcela em aberto.
      expect(await parcelaLida(rejeitada)).toMatchObject({ situacao: 'aberta', saldo: 50, pago: 0 });
      expect(await baixas(rejeitada)).toHaveLength(0);
      expect(await parcelaLida(agendada)).toMatchObject({ situacao: 'aberta', saldo: 70 });
      expect(await baixas(agendada)).toHaveLength(0);
      // O vínculo com a remessa: respondido no pago e no rejeitado; o agendado continua aguardando.
      expect(await vinculo(rem, paga)).toBe('retornada');
      expect(await vinculo(rem, parcial)).toBe('retornada');
      expect(await vinculo(rem, rejeitada)).toBe('rejeitada');
      expect(await vinculo(rem, agendada)).toBe('pendente');
      // O retorno e as linhas com a ocorrência como veio do banco.
      const cab = await uma(
        `SELECT id, hash_arquivo, quantidade_registros, quantidade_baixados, quantidade_rejeitados, valor_total,
                situacao, importado_usuario_id FROM retorno_bancario WHERE id = ?`,
        [Number(r['retorno'])],
      );
      expect(cab).toMatchObject({ hash_arquivo: sha256(conteudo), situacao: 'processado_com_erros' });
      expect([
        Number(cab?.['quantidade_registros']),
        Number(cab?.['quantidade_baixados']),
        Number(cab?.['quantidade_rejeitados']),
        Number(cab?.['valor_total']),
        Number(cab?.['importado_usuario_id']),
      ]).toEqual([5, 2, 1, 160, m.paga]);
      const itens = await varias(
        `SELECT parcela_pagar_id, codigo_ocorrencia, codigos_complementares, situacao, valor_efetivado,
                movimento_bancario_id FROM retorno_bancario_item WHERE retorno_bancario_id = ? ORDER BY sequencia`,
        [Number(r['retorno'])],
      );
      expect(itens.map((i) => [i['situacao'], i['codigo_ocorrencia']])).toEqual([
        ['liquidado', '00'],
        ['rejeitado', 'AG'],
        ['agendado', 'BD'],
        ['liquidado', '00'],
        ['nao_localizado', '00'],
      ]);
      expect(itens[1]?.['codigos_complementares']).toBe('AE');
      expect(itens[4]?.['parcela_pagar_id']).toBeNull();
      expect(itens[0]?.['movimento_bancario_id']).not.toBeNull();
      expect(itens[1]?.['movimento_bancario_id']).toBeNull();
      expect(
        String((await uma('SELECT situacao FROM remessa_bancaria WHERE id = ?', [rem]))?.['situacao']),
      ).toBe('aceita');
      // A leitura da tela: a remessa com o que aguarda e o retorno linha a linha.
      const lista = await ler<Awaited<ReturnType<typeof remessasComPendencia>>>((l) =>
        remessasComPendencia(l, m.est, [m.contaA]),
      );
      expect(lista.find((x) => x.id === rem)).toMatchObject({ parcelas: 4, pendentes: 1, retornos: 1 });
      const lidos = await ler<Awaited<ReturnType<typeof retornosDaRemessa>>>((l) =>
        retornosDaRemessa(l, m.est, rem),
      );
      expect(lidos[0]?.itens.map((i) => i.descricao)[1]).toBe('Agência ou conta do favorecido inválidas');
    }, 120_000);

    it('o mesmo arquivo não entra duas vezes e o arquivo que não fecha é recusado inteiro', async () => {
      const antes = await retornos();
      const repetido = montarRetornoCnab240(BANCO, 1, [
        { titulo: paga, valor: 100, ocorrencias: ['00'], dataPagamento: HOJE, valorPago: 100 },
        { titulo: rejeitada, valor: 50, ocorrencias: ['AG', 'AE'] },
        { titulo: agendada, valor: 70, ocorrencias: ['BD'], dataPagamento: HOJE },
        { titulo: parcial, valor: 80, ocorrencias: ['00'], dataPagamento: HOJE, valorPago: 60 },
        { titulo: 999_999_991, valor: 30, ocorrencias: ['00'], dataPagamento: HOJE, valorPago: 30 },
      ]);
      const mandar = (conteudo: string, remessaId = rem, est?: number) =>
        codigo(
          executar(
            'financeiro.processarRetornoPagamento',
            { remessa: remessaId, nomeArquivo: 'x.ret', conteudo },
            est,
          ),
        );
      expect(await mandar(repetido)).toBe('retorno-ja-importado');
      const outroBanco = montarRetornoCnab240(BANCO + 1, 2, [
        { titulo: agendada, valor: 70, ocorrencias: ['00'], dataPagamento: HOJE, valorPago: 70 },
      ]);
      expect(await mandar(outroBanco)).toBe('banco-diferente');
      expect(await mandar(outroBanco.slice(0, 300))).toBe('linha-tamanho');
      expect(await mandar(repetido.replace(/\r\n$/, '').split('\r\n').slice(0, -1).join('\r\n'))).toBe(
        'rodape-divergente',
      );
      expect(await mandar(repetido, 999_999_991)).toBe('remessa-inexistente');
      // A remessa de um estabelecimento não é respondida pela sessão de outro.
      const valido = montarRetornoCnab240(BANCO, 3, [
        { titulo: agendada, valor: 70, ocorrencias: ['00'], dataPagamento: HOJE, valorPago: 70 },
      ]);
      expect(await mandar(valido, rem, m.outroEst)).toBe('remessa-inexistente');
      expect(await retornos()).toBe(antes);
      expect(await baixas(agendada)).toHaveLength(0);
      expect(await baixas(paga)).toHaveLength(1);
    }, 120_000);

    it('o retorno seguinte paga o agendado, fecha a remessa e não baixa de novo o que já foi pago', async () => {
      const r = await executar('financeiro.processarRetornoPagamento', {
        remessa: rem,
        nomeArquivo: 'retorno-sintetico-2.ret',
        conteudo: montarRetornoCnab240(BANCO, 2, [
          { titulo: agendada, valor: 70, ocorrencias: ['00'], dataPagamento: HOJE, valorPago: 71.5 },
          { titulo: paga, valor: 100, ocorrencias: ['00'], dataPagamento: HOJE, valorPago: 100 },
        ]),
      });
      expect(r).toMatchObject({
        baixados: 1,
        informativos: 1,
        totalBaixado: 71.5,
        pendentes: 0,
        situacaoRemessa: 'processada',
      });
      // Pago a maior: a parcela quita e a diferença vai como acréscimo da baixa e do movimento.
      expect(await parcelaLida(agendada)).toEqual({ situacao: 'paga', saldo: 0, pago: 70, titulo: 'pago' });
      const b = await baixas(agendada);
      expect(b).toHaveLength(1);
      expect([
        Number(b[0]?.['valor_principal']),
        Number(b[0]?.['valor_acrescimo']),
        Number(b[0]?.['valor_pago']),
        Number(b[0]?.['movimento']),
      ]).toEqual([70, 1.5, 71.5, 71.5]);
      expect(await baixas(paga)).toHaveLength(1);
      expect(await parcelaLida(paga)).toMatchObject({ saldo: 0, pago: 100 });
      expect(await vinculo(rem, agendada)).toBe('retornada');
      expect(
        String((await uma('SELECT situacao FROM remessa_bancaria WHERE id = ?', [rem]))?.['situacao']),
      ).toBe('processada');
      expect(await retornos()).toBe(2);
    }, 120_000);
  });

  describe('dados bancários e chave Pix do credor', () => {
    let conta = 0;
    const linha = (id: number) =>
      uma(
        `SELECT versao, banco_id, numero_agencia, digito_agencia, numero_conta, digito_conta, tipo_chave_pix, chave_pix,
                titular_documento, preferencial, ativo FROM conta_bancaria_credor WHERE id = ?`,
        [id],
      );
    const chaves = (id: number) =>
      varias(
        'SELECT tipo_chave, chave, padrao, ativa FROM chave_pix_credor WHERE conta_bancaria_credor_id = ? ORDER BY sequencia',
        [id],
      );
    const manter = (entrada: Record<string, unknown>) => executar('financeiro.manterContaCredor', entrada);

    it('grava a forma canônica, guarda a chave trocada e mantém uma só preferencial', async () => {
      const r = await manter({
        ...CONTA_BASE,
        acao: 'incluir',
        fornecedor: m.fornecedor,
        banco,
        agencia: '12-34',
        digitoAgencia: 'x',
        conta: '56.789',
        digitoConta: '0',
        tipoChavePix: 'email',
        chavePix: ' Financeiro@Exemplo.COM ',
      });
      conta = Number(r['contaCredor']);
      const l = await linha(conta);
      expect(l).toMatchObject({
        numero_agencia: '1234',
        digito_agencia: 'X',
        numero_conta: '56789',
        digito_conta: '0',
        tipo_chave_pix: 'email',
        chave_pix: 'financeiro@exemplo.com',
        titular_documento: '11222333000181',
      });
      // A primeira conta do credor é a preferencial, mesmo sem pedir.
      expect([Number(l?.['banco_id']), Boolean(l?.['preferencial']), Boolean(l?.['ativo'])]).toEqual([
        banco,
        true,
        true,
      ]);
      expect(
        (await chaves(conta)).map((k) => [k['chave'], Boolean(k['padrao']), Boolean(k['ativa'])]),
      ).toEqual([['financeiro@exemplo.com', true, true]]);
      // A lista da tela nunca traz o dado inteiro.
      const lista = await ler<Awaited<ReturnType<typeof contasDoCredor>>>((x) =>
        contasDoCredor(x, { tipo: 'fornecedor', id: m.fornecedor }),
      );
      expect(lista[0]).toMatchObject({ conta: '••••6789', chavePix: '••••.com', preferencial: true });
      expect(JSON.stringify(lista)).not.toContain('financeiro@exemplo.com');
      // Trocar a chave: a antiga fica desativada no histórico e a nova vira a padrão.
      await manter({
        ...CONTA_BASE,
        acao: 'alterar',
        contaCredor: conta,
        versao: Number(l?.['versao']),
        banco,
        agencia: '1234',
        digitoAgencia: 'X',
        conta: '56789',
        digitoConta: '0',
        tipoChavePix: 'telefone',
        chavePix: '(11) 98765-4321',
      });
      expect((await linha(conta))?.['chave_pix']).toBe('+5511987654321');
      expect(
        (await chaves(conta)).map((k) => [k['chave'], Boolean(k['padrao']), Boolean(k['ativa'])]),
      ).toEqual([
        ['financeiro@exemplo.com', false, false],
        ['+5511987654321', true, true],
      ]);
      // A segunda conta marcada como preferencial desmarca a primeira.
      const s = await manter({
        ...CONTA_BASE,
        acao: 'incluir',
        fornecedor: m.fornecedor,
        tipoChavePix: 'cnpj',
        chavePix: '11.222.333/0001-81',
        preferencial: true,
      });
      expect(Boolean((await linha(Number(s['contaCredor'])))?.['preferencial'])).toBe(true);
      expect(Boolean((await linha(conta))?.['preferencial'])).toBe(false);
    }, 120_000);

    it('recusa o que não fecha sem gravar e desativa sem apagar', async () => {
      const antes = await contar(
        'SELECT COUNT(*) AS n FROM conta_bancaria_credor WHERE empresa_fornecedora_id = ?',
        [m.fornecedor],
      );
      const incluir = (e: Record<string, unknown>) =>
        codigo(manter({ ...CONTA_BASE, acao: 'incluir', fornecedor: m.fornecedor, ...e }));
      expect(await incluir({ tipoChavePix: 'email', chavePix: 'sem-arroba' })).toBe('chave-pix-invalida');
      expect(await incluir({})).toBe('sem-destino');
      expect(await incluir({ banco, agencia: '1' })).toBe('conta-incompleta');
      expect(await incluir({ tipoChavePix: 'cpf', chavePix: '529.982.247-25' })).toBe(
        'chave-pix-de-outro-titular',
      );
      expect(await incluir({ tipoChavePix: 'telefone', chavePix: '11987654321' })).toBe('conta-repetida');
      expect(
        await incluir({ titularDocumento: '11222333000100', tipoChavePix: 'email', chavePix: 'a@b.com' }),
      ).toBe('documento-invalido');
      expect(
        await codigo(
          manter({
            ...CONTA_BASE,
            acao: 'incluir',
            fornecedor: 999_999_991,
            tipoChavePix: 'email',
            chavePix: 'a@b.com',
          }),
        ),
      ).toBe('credor-inexistente');
      const l = await linha(conta);
      expect(
        await codigo(manter({ acao: 'desativar', contaCredor: conta, versao: Number(l?.['versao']) + 5 })),
      ).toBe('versao-desatualizada');
      expect(
        await contar('SELECT COUNT(*) AS n FROM conta_bancaria_credor WHERE empresa_fornecedora_id = ?', [
          m.fornecedor,
        ]),
      ).toBe(antes);
      await manter({ acao: 'desativar', contaCredor: conta, versao: Number(l?.['versao']) });
      const depois = await linha(conta);
      expect([Boolean(depois?.['ativo']), depois?.['chave_pix']]).toEqual([false, '+5511987654321']);
      expect((await chaves(conta)).map((k) => Boolean(k['ativa']))).toEqual([false, false]);
      expect(
        await contar('SELECT COUNT(*) AS n FROM conta_bancaria_credor WHERE empresa_fornecedora_id = ?', [
          m.fornecedor,
        ]),
      ).toBe(antes);
    }, 120_000);
  });

  describe('remessa por Pix', () => {
    const montar = (parcelas: number[]) =>
      ler<Awaited<ReturnType<typeof montarRemessaPix>>>((l) =>
        montarRemessaPix(l, m.est, m.contaA, parcelas, HOJE),
      );
    const registrar = (parcelas: number[], hashArquivo: string) =>
      executar('financeiro.registrarRemessaPix', {
        conta: m.contaA,
        parcelas,
        dataPagamento: HOJE,
        hashArquivo,
        arquivo: null,
        destino: 'simulador',
      });

    it('grava a remessa com as parcelas aguardando e o retorno baixa por Pix', async () => {
      const p = await parcela(300);
      const sequenciaAntes = Number(
        (await uma('SELECT sequencia_remessa FROM conta_bancaria WHERE id = ?', [m.contaA]))?.[
          'sequencia_remessa'
        ],
      );
      // O credor tem a chave do CNPJ ativa (incluída no bloco anterior).
      const montada = await montar([p]);
      const linhas = montada.conteudo.split('\r\n').filter((x) => x.length > 0);
      expect(linhas).toHaveLength(6);
      expect(linhas.every((x) => x.length === 240)).toBe(true);
      expect(linhas[1]?.slice(11, 13)).toBe('45');
      expect(linhas[3]?.slice(18, 32)).toBe('11222333000181');
      expect(montada.total).toBe(300);
      // O arquivo que mudou depois de montado não é registrado.
      expect(await codigo(registrar([p], 'a'.repeat(64)))).toBe('remessa-desatualizada');
      const r = await registrar([p], sha256(montada.conteudo));
      const rem = Number(r['remessa']);
      const gravada = await uma(
        `SELECT formato, situacao, valor_total, quantidade_registros, sequencia_arquivo, hash_arquivo, observacao,
                gerado_usuario_id, data_pagamento FROM remessa_bancaria WHERE id = ?`,
        [rem],
      );
      expect(gravada).toMatchObject({
        formato: 'cnab240',
        situacao: 'gerada',
        hash_arquivo: sha256(montada.conteudo),
      });
      expect([
        Number(gravada?.['valor_total']),
        Number(gravada?.['quantidade_registros']),
        Number(gravada?.['sequencia_arquivo']),
        Number(gravada?.['gerado_usuario_id']),
        iso(gravada?.['data_pagamento']),
      ]).toEqual([300, 1, sequenciaAntes + 1, m.paga, HOJE]);
      expect(JSON.parse(String(gravada?.['observacao']))).toMatchObject({
        meio: 'pix',
        destino: 'simulador',
      });
      expect(await vinculo(rem, p)).toBe('pendente');
      expect(await parcelaLida(p)).toMatchObject({ situacao: 'aberta', saldo: 300 });
      // A parcela que aguarda o retorno não entra em outra remessa.
      expect(await codigo(montar([p]))).toBe('titulo-em-remessa');
      // O retorno do simulador (fora de produção) fecha o ciclo: baixa na forma Pix.
      const conteudo = await ler<string | null>((l) => retornoSimulado(l, m.est, rem));
      const fim = await executar('financeiro.processarRetornoPagamento', {
        remessa: rem,
        nomeArquivo: 'retorno-simulado.ret',
        conteudo,
      });
      expect(fim).toMatchObject({ baixados: 1, pendentes: 0, situacaoRemessa: 'processada' });
      const b = await baixas(p);
      expect(b).toHaveLength(1);
      expect(b[0]).toMatchObject({ forma_pagamento: 'pix' });
      expect(await parcelaLida(p)).toEqual({ situacao: 'paga', saldo: 0, pago: 300, titulo: 'pago' });
      expect(await codigo(montar([p]))).toBe('titulo-ja-baixado');
    }, 120_000);

    it('credor sem chave Pix ativa recusa a remessa inteira e nada é gravado', async () => {
      const p = await parcela(40);
      const ativas = await varias(
        'SELECT id, versao FROM conta_bancaria_credor WHERE empresa_fornecedora_id = ? AND ativo = TRUE',
        [m.fornecedor],
      );
      for (const a of ativas)
        await executar('financeiro.manterContaCredor', {
          acao: 'desativar',
          contaCredor: Number(a['id']),
          versao: Number(a['versao']),
        });
      const antes = await contar('SELECT COUNT(*) AS n FROM remessa_bancaria WHERE estabelecimento_id = ?', [
        m.est,
      ]);
      expect(await codigo(montar([p]))).toBe('credor-sem-chave-pix');
      expect(await codigo(registrar([p], 'b'.repeat(64)))).toBe('credor-sem-chave-pix');
      expect(await codigo(montar([p, 999_999_991]))).toBe('parcela-inexistente');
      expect(
        await contar('SELECT COUNT(*) AS n FROM remessa_bancaria WHERE estabelecimento_id = ?', [m.est]),
      ).toBe(antes);
      expect(await vinculo(0, p)).toBe('undefined');
    }, 120_000);
  });
});
