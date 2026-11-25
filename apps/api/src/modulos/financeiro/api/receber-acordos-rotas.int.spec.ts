// F3.8, 07-FIN linha 76: as rotas de `financeiro/receber/acordos` e `demonstrativos-importados` contra o MariaDB real
// (massa SINTÉTICA "L0207"), chamadas no próprio controlador com o banco do cliente e a sessão do usuário, como a tela
// chama: escolher o devedor particular, ler os títulos em aberto dele com o saldo real, gravar o acordo (corpo conferido,
// mensagem para a tela), ler a lista e o histórico, desfazer com motivo; o outro estabelecimento não vê o acordo (404).
// Cada rota declara a permissão e a auditoria que a esteira cobra. Só contagens e códigos.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { partesDaPermissao } from '@sgh/dominio-acesso';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_PERMISSAO } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { ErroProblema } from '../../../problema.filter.js';
import { desligarMapaEstabelecimentos, ligarMapaEstabelecimentos } from '../../cadastro/contexto-nucleo.js';
import {
  CLIENTE,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  P,
  SEM_BANCO,
} from '../aplicacao/massa-banco.spec-util.js';
import { ReceberAcordosController } from '../receber-acordos.controller.js';

const HOJE = new Date().toISOString().slice(0, 10);
const EM_30_DIAS = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const LER = 'financeiro.tituloReceber.ler';
const CRIAR = 'financeiro.tituloReceber.criar';
const BAIXAR = 'financeiro.tituloReceber.baixar';

/** O que a rota respondeu: "ok" ou o status e o código do problema (a função cobre a recusa antes da promessa). */
async function resposta(p: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await p();
    return 'ok';
  } catch (e) {
    if (!(e instanceof ErroProblema)) throw e;
    return `${e.getStatus()}:${String(e.extras['codigo'] ?? e.tipo)}`;
  }
}

describe.skipIf(SEM_BANCO)('acordos a receber e baixa pelo demonstrativo: as rotas (MariaDB)', () => {
  let m: MassaFinanceiro;
  let rotas: ReceberAcordosController;
  let paciente = 0;
  let titulo = 0;
  const codigos = new Map<number, string>();
  const logins = new Map<number, string>();
  const consultar = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'ac-rotas' }, (l) => l.consultar(sql, p));
  /** A requisição já autorizada pelo guarda: a sessão do usuário no estabelecimento, com as permissões dadas. */
  const req = (usuario: number, est = m.est): RequisicaoAutorizada => {
    const partes = [LER, CRIAR, BAIXAR].map(partesDaPermissao);
    return {
      headers: { 'idempotency-key': `t0207-ac-rotas-${randomUUID()}` },
      ip: '127.0.0.1',
      sgh: {
        sessao: {
          estabelecimentoAtivo: codigos.get(est),
          rede: '',
          unidadeAtiva: null,
          usuario: { id: String(usuario), login: logins.get(usuario) },
        },
        ability: {
          can: (acao: string, sujeito: string) =>
            partes.some((x) => x.acao === acao && x.sujeito === sujeito),
        },
      },
    } as unknown as RequisicaoAutorizada;
  };

  beforeAll(async () => {
    m = await montarMassa();
    for (const r of await consultar('SELECT id, codigo FROM estabelecimento WHERE id IN (?, ?)', [
      m.est,
      m.outroEst,
    ]))
      codigos.set(Number(r['id']), String(r['codigo']));
    for (const r of await consultar('SELECT id, login FROM usuario WHERE id = ?', [m.lanca]))
      logins.set(Number(r['id']), String(r['login']));
    paciente = Number(
      (
        await consultar('SELECT paciente_id FROM conta_hospitalar WHERE id = ?', [m.contasHospitalares[0]])
      )[0]?.['paciente_id'],
    );
    // Um título de particular com 450,00, dos quais 150,00 já recebidos: o saldo real é 300,00.
    titulo = await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'ac-rotas' }, async (e) => {
      const agora = new Date();
      const tipoDoc = await e.uma<{ id: number }>(
        "SELECT id FROM tipo_documento_financeiro WHERE ativo = TRUE AND sentido IN ('receber','ambos') ORDER BY id LIMIT 1",
        [],
      );
      const nat = await e.uma<{ id: number }>(
        "SELECT id FROM natureza_financeira WHERE codigo = '9207.2.1'",
        [],
      );
      const t = await e.inserir(
        `INSERT INTO titulo_receber (estabelecimento_id, numero, tipo_devedor, paciente_id, tipo_origem,
           tipo_documento_financeiro_id, numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido,
           valor_recebido, situacao, natureza_financeira_id, criado_em)
         VALUES (?, ?, 'paciente', ?, 'avulso', ?, '938071', ?, ?, 450, 450, 150, 'recebido_parcial', ?, ?)`,
        [m.est, `${P}-N938071`, paciente, Number(tipoDoc?.id), HOJE, HOJE, Number(nat?.id), agora],
      );
      await e.inserir(
        `INSERT INTO parcela_receber (titulo_receber_id, sequencia, vencimento, vencimento_original, valor,
           valor_recebido, saldo, situacao, criado_em) VALUES (?, 1, ?, ?, 450, 150, 300, 'parcial', ?)`,
        [t, HOJE, HOJE, agora],
      );
      return t;
    });
    desligarMapaEstabelecimentos();
    await ligarMapaEstabelecimentos(CLIENTE, m.nucleo);
    rotas = new ReceberAcordosController(m.nucleo);
  }, 180_000);

  afterAll(async () => {
    desligarMapaEstabelecimentos();
    if (m) {
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  it('cada rota declara a permissão; toda gravação declara a auditoria', () => {
    const marcas = (metodo: keyof ReceberAcordosController) => {
      const fn = ReceberAcordosController.prototype[metodo] as object;
      return [
        Reflect.getMetadata(CHAVE_PERMISSAO, fn) as string | undefined,
        typeof Reflect.getMetadata(CHAVE_AUDITADO_NO_HANDLER, fn),
      ];
    };
    expect(marcas('devedores')).toEqual([LER, 'undefined']);
    expect(marcas('titulosAbertos')).toEqual([LER, 'undefined']);
    expect(marcas('acordos')).toEqual([LER, 'undefined']);
    expect(marcas('acordo')).toEqual([LER, 'undefined']);
    expect(marcas('demonstrativos')).toEqual([LER, 'undefined']);
    expect(marcas('previa')).toEqual([LER, 'undefined']);
    expect(marcas('renegociar')).toEqual([CRIAR, 'string']);
    expect(marcas('desfazer')).toEqual([CRIAR, 'string']);
    expect(marcas('baixar')).toEqual([BAIXAR, 'string']);
    expect(marcas('desfazerBaixa')).toEqual([BAIXAR, 'string']);
  });

  it('sem o banco do cliente as rotas respondem 503 (falha fechada)', async () => {
    const semBanco = new ReceberAcordosController(null);
    expect(await resposta(() => semBanco.acordos(req(m.lanca)))).toBe('503:indisponivel');
    expect(await resposta(() => semBanco.renegociar({}, req(m.lanca)))).toMatch(/^(400|422|503):/);
  });

  it('particular: escolher o devedor, ler o saldo real, gravar o acordo, ver o histórico e desfazer', async () => {
    const lanca = () => req(m.lanca);
    // A escolha do devedor: tipo inválido (a letra que a tela antiga mandava) é 400; o particular aparece com o saldo.
    expect(await resposta(() => rotas.devedores('P', '', lanca()))).toBe('400:entrada-invalida');
    expect(await resposta(() => rotas.titulosAbertos('E', 'abc', lanca()))).toBe('400:entrada-invalida');
    const devedores = await rotas.devedores('E', undefined, lanca());
    expect(devedores.map((d) => [d.id, d.titulos, d.saldo])).toEqual([[paciente, 1, 300]]);
    const abertos = await rotas.titulosAbertos('E', String(paciente), lanca());
    expect(abertos.titulos.map((x) => [x.id, x.valor, x.recebido, x.saldo, x.parcelas.length])).toEqual([
      [titulo, 450, 150, 300, 1],
    ]);
    expect(await rotas.devedores('E', '', req(m.lanca, m.outroEst))).toEqual([]);

    // POST /acordos: o corpo é conferido (campo a mais, lista vazia) e a recusa da regra chega com o código.
    const corpo = { titulos: [titulo], juros: 0, multa: 0, desconto: 0, quantidadeParcelas: 3 };
    expect(
      await resposta(() => rotas.renegociar({ ...corpo, primeiroVencimento: EM_30_DIAS, a: 1 }, lanca())),
    ).toMatch(/^4\d\d:/);
    expect(
      await resposta(() =>
        rotas.renegociar({ ...corpo, titulos: [], primeiroVencimento: EM_30_DIAS }, lanca()),
      ),
    ).toMatch(/^4\d\d:/);
    expect(
      await resposta(() => rotas.renegociar({ ...corpo, primeiroVencimento: '2020-01-01' }, lanca())),
    ).toMatch(/:vencimento-passado$/);
    expect(await rotas.acordos(lanca())).toEqual([]);
    const gravado = await rotas.renegociar({ ...corpo, primeiroVencimento: EM_30_DIAS }, lanca());
    expect(gravado.mensagem).toMatch(/^Acordo RN-\S+ gravado: R\$ 300,00 em 3 parcela\(s\)/);

    // GET /acordos e /acordos/:id: o que ficou gravado, com o saldo levado igual ao que a lista mostrou.
    const lista = await rotas.acordos(lanca());
    expect(lista.map((a) => [a.situacao, a.valorOriginal, a.valorRenegociado, a.parcelas])).toEqual([
      ['efetivada', 300, 300, 3],
    ]);
    const id = Number(lista[0]?.id);
    const detalhe = await rotas.acordo(String(id), lanca());
    expect(detalhe.originais.map((o) => [o.titulo, o.saldoLevado, o.situacao])).toEqual([
      [titulo, 300, 'renegociada'],
    ]);
    expect(detalhe.novas.map((x) => [x.sequencia, x.valor, x.situacao])).toEqual([
      [1, 100, 'aberta'],
      [2, 100, 'aberta'],
      [3, 100, 'aberta'],
    ]);
    expect(await rotas.devedores('E', '', lanca())).toEqual([
      expect.objectContaining({ id: paciente, titulos: 1, saldo: 300 }),
    ]);
    expect(await resposta(() => rotas.acordo('abc', lanca()))).toBe('400:entrada-invalida');
    expect(await resposta(() => rotas.acordo(String(id), req(m.lanca, m.outroEst)))).toBe(
      '404:nao-encontrado',
    );
    expect(await rotas.acordos(req(m.lanca, m.outroEst))).toEqual([]);

    // POST /acordos/:id/desfazer: motivo curto é recusado; com motivo, o título original volta com o saldo.
    expect(await resposta(() => rotas.desfazer(String(id), { motivo: 'ok' }, lanca()))).toMatch(
      /:motivo-obrigatorio$/,
    );
    const desfeito = await rotas.desfazer(String(id), { motivo: 'Paciente não assinou o termo' }, lanca());
    expect(desfeito.mensagem).toMatch(/^Acordo RN-\S+ desfeito/);
    expect((await rotas.acordos(lanca())).map((a) => a.situacao)).toEqual(['cancelada']);
    expect(
      (await rotas.titulosAbertos('E', String(paciente), lanca())).titulos.map((x) => [x.id, x.saldo]),
    ).toEqual([[titulo, 300]]);

    // As rotas do demonstrativo: sem demonstrativo importado a lista é vazia; o que não existe é recusado com o código.
    expect(await rotas.demonstrativos(lanca())).toEqual([]);
    expect(await resposta(() => rotas.previa('999999999', lanca()))).toMatch(/:demonstrativo-inexistente$/);
    expect(
      await resposta(() => rotas.baixar('999999999', { conta: m.contaA, dataRecebimento: HOJE }, lanca())),
    ).toMatch(/:demonstrativo-inexistente$/);
    expect(
      await resposta(() => rotas.desfazerBaixa('999999999', { motivo: 'Demonstrativo trocado' }, lanca())),
    ).toMatch(/:demonstrativo-inexistente$/);
    expect(await resposta(() => rotas.desfazerBaixa('1', {}, lanca()))).toMatch(/^4\d\d:/);
    console.info('[f38-05 rotas] 1 acordo de particular gravado e desfeito pelas rotas');
  }, 120_000);
});
