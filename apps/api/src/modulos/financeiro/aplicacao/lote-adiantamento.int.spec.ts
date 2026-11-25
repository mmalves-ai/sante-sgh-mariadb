// F3.8, 07-FIN linha 67: contrato de efeito do adiantamento NO LOTE contábil, contra o MariaDB real (massa SINTÉTICA
// "L0207"). O adiantamento é pedido, aprovado, pago (500,00), compensado num título aprovado do mesmo credor (300,00) e
// a sobra devolvida (200,00); o lote do dia sai com as três partidas pelo de-para por evento: a concessão (débito a
// conta do adiantamento, crédito o banco), a compensação (crédito a conta do adiantamento; débito o fornecedor da
// emissão na competência, ou a despesa paga no caixa) e a devolução (débito o banco, crédito a conta do adiantamento).
// O compensado não sai como pagamento ao banco. O arquivo guardado pelo serviço é o mesmo lote, com hash e registro.
// E a leitura do adiantamento: o credor vem com o nome, e a busca acha o fornecedor e o profissional pelo nome.
import { createHash, randomUUID } from 'node:crypto';
import { conferirLote, dePararFatos, montarLoteContabil } from '@sgh/dominio-financeiro';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { ApoiosFinanceiro } from '../apoios.js';
import { OPERACOES_CONTABIL_FISCAL } from '../contabil-fiscal-propria.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import { ServicoFinanceiro } from '../servico.js';
import {
  CLIENTE,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
  tituloDaMassa,
} from './massa-banco.spec-util.js';

const comChave = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-la-${randomUUID()}` });
const trilhaDo = (id: number) => ({
  estabelecimento: null,
  usuario: null,
  acao: 'operacao' as const,
  entidade: 'adiantamento',
  entidadeId: id,
  correlacao: null,
});
const hoje = () => new Date().toISOString().slice(0, 10);
const DOCUMENTO = 672_067;
const REFERENTE = 'SINTETICO L0207 LOTE';

describe.skipIf(SEM_BANCO)('adiantamento no lote contábil e credor pelo nome (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  let numero = '';
  let adiantamento = 0;
  const consultar = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'la-67' }, (l) => l.consultar(sql, p));
  const limparDePara = () =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-la-67' }, async (e) => {
      for (const t of ['depara_conta_externa', 'depara_centro_custo_externo', 'depara_participante_externo'])
        await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN (?, ?)`, [m.est, m.outroEst]);
    });
  const dePara = (entrada: object) =>
    m.nucleo
      .criarExecutor()
      .executar(
        OPERACOES_CONTABIL_FISCAL['financeiro.manterDeParaContabil'] as never,
        CLIENTE,
        entrada,
        comChave(m.ctx(m.lanca)),
      );
  const conta = (evento: string, lado: string, codigo: string) =>
    dePara({ tipo: 'conta', id: null, natureza: null, ativo: true, evento, lado, conta: codigo });
  /** As linhas do lote deste teste (o adiantamento e o título dele), sem o histórico: data;débito;crédito;valor;doc;centro;credor. */
  const linhasDoLote = async (regua: 'competencia' | 'caixa') => {
    const dp = await porta.deParaContabil(m.ctx(m.lanca) as never, { de: hoje(), ate: hoje(), regua });
    const { eventos, depara } = dePararFatos(dp.fatos, dp.regras, dp.centros, dp.credores);
    const lote = montarLoteContabil(eventos, depara);
    return {
      lote,
      linhas: lote.linhas.map((l) => l.split(';')).map((c) => [...c.slice(0, 4), c[5], c[7]].join(';')),
      historicos: lote.linhas.map((l) => String(l.split(';')[4])),
    };
  };

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
    await limparDePara();
    const g = <T>(u: number, id: number, f: Parameters<typeof porta.gravarSgh<T>>[2]) =>
      porta.gravarSgh<T>(comChave(m.ctx(u)), trilhaDo(id), f);
    const escopo = { usuario: 'x', contasEscopo: [m.contaA, m.contaB] };
    await g(m.lanca, 0, (x) =>
      x.salvarFaixa({
        id: null,
        centroCusto: null,
        tipoCredor: null,
        valorDe: 0,
        valorAte: null,
        aprovacoes: 1,
        permissao: 'financeiro.tituloPagar.aprovar',
        vigenciaInicio: '2000-01-01',
        vigenciaFim: null,
        ativa: true,
        usuario: 'x',
      }),
    );
    // O título de 300,00 do mesmo fornecedor, aprovado por outra pessoa.
    const c = m.ctx(m.lanca);
    const t = await porta.executar(c, 'financeiro.criarTituloPagar', tituloDaMassa(m, DOCUMENTO, 300), {
      ...c,
      chaveIdempotencia: `t0207-la-${randomUUID()}`,
    });
    const parcela = Number(t.resultado['titulo']);
    await g(m.aprova, 0, (x) =>
      x.aprovarTitulo({ titulo: parcela, observacao: '', usuario: 'x', temPermissao: () => true }),
    );
    // O adiantamento de 500,00: pedido, aprovado, pago, 300,00 compensados no título e 200,00 devolvidos.
    const ad = await g<{ id: number; numero: string }>(m.lanca, 0, (x) =>
      x.concederAdiantamento({
        tipoCredor: 'fornecedor',
        credor: m.fornecedor,
        conta: m.contaA,
        valor: 500,
        data: hoje(),
        prazo: null,
        referente: REFERENTE,
        ...escopo,
      }),
    );
    adiantamento = ad.id;
    numero = ad.numero;
    await g(m.aprova, ad.id, (x) =>
      x.aprovarAdiantamento({ adiantamento: ad.id, observacao: '', usuario: 'x', temPermissao: () => true }),
    );
    await g(m.paga, ad.id, (x) => x.pagarAdiantamento({ adiantamento: ad.id, data: hoje(), ...escopo }));
    await g(m.paga, ad.id, (x) =>
      x.compensarAdiantamento({ adiantamento: ad.id, parcela, valor: 300, data: hoje(), usuario: 'x' }),
    );
    await g(m.paga, ad.id, (x) =>
      x.devolverAdiantamento({
        adiantamento: ad.id,
        conta: m.contaA,
        valor: 200,
        data: hoje(),
        motivo: 'SINTETICO sobra devolvida',
        ...escopo,
      }),
    );
    // O de-para por evento: nenhuma conta fixa no código.
    await conta('fin_despesa_reconhecida', 'debito', '4.1.1');
    await conta('fin_despesa_reconhecida', 'credito', '2.1.1');
    await conta('fin_despesa_paga', 'debito', '4.1.1');
    await conta('fin_despesa_paga', 'credito', '1.1.1');
    await conta('fin_pagamento_titulo', 'credito', '1.1.1');
    await conta('fin_adiantamento_concedido', 'debito', '1.1.5');
    await conta('fin_adiantamento_concedido', 'credito', '1.1.1');
    await conta('fin_adiantamento_devolvido', 'debito', '1.1.1');
    await dePara({ tipo: 'credor', fornecedor: m.fornecedor, codigo: 'F-EXT-67', ativo: true });
  }, 240_000);
  afterAll(async () => {
    if (m) {
      await limparDePara();
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  it('competência: concessão, compensação (baixa o fornecedor da emissão) e devolução saem no arquivo guardado', async () => {
    const d = hoje();
    const { lote, linhas, historicos } = await linhasDoLote('competencia');
    // A emissão do título (despesa contra fornecedor), a concessão, a compensação e a devolução. O compensado não vira
    // pagamento ao banco: não há partida de pagamento do título.
    expect(linhas).toEqual([
      `${d};4.1.1;2.1.1;300.00;${DOCUMENTO};F-EXT-67`,
      `${d};1.1.5;1.1.1;500.00;${numero};F-EXT-67`,
      `${d};2.1.1;1.1.5;300.00;${DOCUMENTO};F-EXT-67`,
      `${d};1.1.1;1.1.5;200.00;${numero};F-EXT-67`,
    ]);
    expect(historicos.slice(1).every((h) => h.startsWith(`ADIANTAMENTO ${numero} ${REFERENTE}`))).toBe(true);
    expect([lote.somaDebitos, lote.somaCreditos, lote.semDePara.length]).toEqual([1300, 1300, 0]);
    expect(conferirLote(lote.conteudo)).toEqual({ ok: true, lancamentos: 4, soma: 1300 });
    // A conta do adiantamento fecha: 500,00 a débito na concessão; 300,00 + 200,00 a crédito (compensado e devolvido).
    const saldo = lote.linhas
      .map((l) => l.split(';'))
      .reduce((s, c) => s + (c[1] === '1.1.5' ? Number(c[3]) : 0) - (c[2] === '1.1.5' ? Number(c[3]) : 0), 0);
    expect(saldo).toBe(0);

    // Pelo serviço: o arquivo guardado é esse lote, o hash confere e o registro do lote leva a contagem e a soma.
    const guardados = new Map<string, Uint8Array>();
    const armazem = {
      guardar: async (chave: string, b: Uint8Array) => {
        guardados.set(chave, b);
        return { versao: null };
      },
      ler: async (chave: string) => guardados.get(chave) ?? null,
    };
    const apoios = new ApoiosFinanceiro(porta, new RegistradorTrilhaMemoria(), null, null, 'desenvolvimento');
    // A liberação da funcionalidade é da configuração do estabelecimento (fora deste contrato).
    (apoios.apoios.fiscal as unknown as { exigirLiberacao: () => Promise<void> }).exigirLiberacao =
      async () => undefined;
    const servico = new ServicoFinanceiro(porta, apoios, 'desenvolvimento', armazem);
    const sessao = {
      req: { headers: { 'idempotency-key': `t0207-la-lote-${randomUUID()}` } },
      hospital: 'l0207',
      rede: '',
      login: `l0207.${m.lanca}`,
      porta: m.ctx(m.lanca),
      pode: () => true,
    } as unknown as SessaoCadastro;
    const exportado = await servico.exportarLoteContabil(sessao, {
      periodo: d.slice(0, 7),
      regua: 'competencia',
    } as never);
    const [chave, bytes] = [...guardados.entries()][0] ?? ['', new Uint8Array()];
    const arquivo = Buffer.from(bytes).toString('utf8');
    // O arquivo do mês traz as quatro partidas do dia, inteiras (com o histórico), na mesma ordem.
    for (const l of lote.linhas) expect(arquivo).toContain(`${l}\r\n`);
    expect(conferirLote(arquivo).ok).toBe(true);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const [reg] = await consultar(
      `SELECT x.quantidade_lancamentos, x.valor_total, x.hash_conferencia, a.chave_armazenamento
         FROM lote_exportacao_contabil x LEFT JOIN arquivo a ON a.id = x.arquivo_id
        WHERE x.id = ? AND x.estabelecimento_id = ?`,
      [Number(exportado.ids['lote']), m.est],
    );
    const conferido = conferirLote(arquivo);
    expect([
      Number(reg?.['quantidade_lancamentos']),
      Number(reg?.['valor_total']),
      reg?.['hash_conferencia'],
      reg?.['chave_armazenamento'],
    ]).toEqual([conferido.lancamentos, conferido.soma, hash, chave]);
  });

  it('caixa: a compensação debita a despesa paga; o compensado não aparece como saída do banco', async () => {
    const d = hoje();
    const { lote, linhas } = await linhasDoLote('caixa');
    expect(linhas).toEqual([
      `${d};1.1.5;1.1.1;500.00;${numero};F-EXT-67`,
      `${d};4.1.1;1.1.5;300.00;${DOCUMENTO};F-EXT-67`,
      `${d};1.1.1;1.1.5;200.00;${numero};F-EXT-67`,
    ]);
    expect([lote.somaDebitos, lote.semDePara.length]).toEqual([1000, 0]);
    // O banco só perde o que saiu de fato: 500,00 da concessão menos 200,00 devolvidos.
    const banco = lote.linhas
      .map((l) => l.split(';'))
      .reduce((s, c) => s + (c[2] === '1.1.1' ? Number(c[3]) : 0) - (c[1] === '1.1.1' ? Number(c[3]) : 0), 0);
    expect(banco).toBe(300);
  });

  it('leitura: o adiantamento vem com o nome do credor; a busca acha o fornecedor e o profissional pelo nome', async () => {
    const lista = await porta.adiantamentos(m.ctx(m.paga));
    expect(lista.find((x) => x.id === adiantamento)).toMatchObject({
      credor: m.fornecedor,
      credorNome: 'FORNECEDOR SINTETICO L0207',
      situacao: 'compensado',
      compensado: 500,
      saldo: 0,
    });
    const c = m.ctx(m.lanca) as never;
    const achados = await porta.credores(c, 'fornecedor', 'SINTETICO L0207');
    expect(achados.some((f) => f.id === m.fornecedor && f.nome === 'FORNECEDOR SINTETICO L0207')).toBe(true);
    expect(
      (await porta.credores(c, 'fornecedor', String(m.fornecedor))).some((f) => f.id === m.fornecedor),
    ).toBe(true);
    // O profissional é achado pelo nome da pessoa, sem documento pessoal na resposta; o fornecedor não entra nesse tipo.
    const [prof] = await consultar(
      `SELECT pr.id, pf.nome FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
        WHERE pf.nome LIKE 'SINTETICO%' OR pf.nome LIKE '%L0207%' ORDER BY pr.id DESC LIMIT 1`,
      [],
    );
    expect(prof).toBeTruthy();
    const medicos = await porta.credores(c, 'profissional', String(prof?.['nome']));
    expect(medicos.find((x) => x.id === Number(prof?.['id']))).toMatchObject({ documento: null });
    expect(await porta.credores(c, 'profissional', 'FORNECEDOR SINTETICO L0207')).toEqual([]);
    expect(await porta.credores(c, 'fornecedor', 'S')).toEqual([]);
  });
});
