// F3.8, 07-FIN linha 63: contrato de efeito da prorrogação do vencimento da parcela a pagar contra o MariaDB real
// (massa SINTÉTICA "L0207"). Prorrogar: a parcela passa a vencer na data nova, o vencimento original não muda, e o passo
// fica no histórico (prorrogacao_parcela: anterior, novo, motivo da lista, justificativa, quem e quando). Uma segunda
// prorrogação acrescenta outro passo e o original continua o mesmo. Cada recusa (para trás, longa demais, sem justificativa
// quando o motivo exige, motivo fora da lista, versão desatualizada, parcela numa remessa ainda sem retorno, título já
// aprovado pedido por quem lançou ou por quem não pode aprovar) deixa a parcela e o histórico como estavam. Pelo serviço,
// a prorrogação grava a linha da trilha com o evento na mesma transação.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { ApoiosFinanceiro } from '../apoios.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import { ServicoFinanceiro } from '../servico.js';
import {
  CLIENTE,
  codigoDaGravacao,
  codigoDe,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
  tituloDaMassa,
} from './massa-banco.spec-util.js';

const comChave = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-pr-${randomUUID()}` });
const trilha = (id: number) => ({
  estabelecimento: null,
  usuario: null,
  acao: 'operacao' as const,
  entidade: 'parcela_pagar',
  entidadeId: id,
  correlacao: null,
});
const somaDias = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

describe.skipIf(SEM_BANCO)('prorrogação do vencimento da parcela a pagar (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  let motivoLivre = 0;
  let motivoJustificado = 0;
  const uma = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'pr-02-07' }, (l) => l.uma(sql, p));
  const parcelaLida = async (id: number) => {
    const r = await uma('SELECT vencimento, vencimento_original, versao FROM parcela_pagar WHERE id = ?', [
      id,
    ]);
    return {
      vencimento: iso(r?.['vencimento']),
      original: iso(r?.['vencimento_original']),
      versao: Number(r?.['versao']),
    };
  };
  const passos = async (id: number) =>
    Number(
      (await uma('SELECT COUNT(*) AS n FROM prorrogacao_parcela WHERE parcela_pagar_id = ?', [id]))?.['n'] ??
        0,
    );
  const titulo = async (documento: number, valor: number) => {
    const c = m.ctx(m.lanca);
    const t = await porta.executar(c, 'financeiro.criarTituloPagar', tituloDaMassa(m, documento, valor), {
      ...c,
      chaveIdempotencia: `t0207-pr-${randomUUID()}`,
    });
    return Number(t.resultado['titulo']);
  };
  const prorrogar = (
    parcela: number,
    vencimento: string,
    motivo: number,
    justificativa = '',
    versao: string | null = null,
  ) =>
    porta.gravarSgh(comChave(m.ctx(m.lanca)), trilha(parcela), (g) =>
      g.prorrogarVencimento({
        parcela,
        versao,
        vencimento,
        motivo,
        justificativa,
        usuario: 'x',
        podeAprovar: false,
      }),
    );
  const remessa = (parcela: number, vencimento: string, situacao: 'gerada' | 'retornada') =>
    porta.gravarSgh(comChave(m.ctx(m.paga)), { ...trilha(0), entidade: 'remessa_bancaria' }, (g) =>
      g.registrarRemessa({
        usuario: 'x',
        conta: m.contaA,
        leiaute: 'cnab240',
        titulos: 1,
        valorTotal: 400,
        hashArquivo: randomUUID().replaceAll('-', '').padEnd(64, '0'),
        parcelas: [{ parcela, valor: 400, vencimento }],
        arquivo: null,
        destino: situacao === 'gerada' ? 'banco' : 'simulador',
        situacao,
        hashRetorno: null,
        ocorrencias: null,
      }),
    );
  const codigoServico = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'gravou';
    } catch (e) {
      return e instanceof ErroProblema ? String(e.extras['codigo'] ?? e.tipo) : codigoDe(e);
    }
  };

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
    // Os motivos da semente padrão (db/sementes/14_financeiro.json), garantidos no cliente de teste.
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'pr-02-07-motivos' }, async (e) => {
      for (const [codigo, descricao, exige] of [
        ['acordo_credor', 'Acordo com o credor', false],
        ['outro', 'Outro motivo', true],
      ] as const) {
        const r = await e.uma<{ id: number }>('SELECT id FROM motivo_prorrogacao WHERE codigo = ?', [codigo]);
        const id = r
          ? Number(r.id)
          : await e.inserir(
              `INSERT INTO motivo_prorrogacao (codigo, descricao, aplica_pagar, aplica_receber, exige_justificativa, criado_em)
               VALUES (?, ?, TRUE, TRUE, ?, NOW(3))`,
              [codigo, descricao, exige],
            );
        if (exige) motivoJustificado = id;
        else motivoLivre = id;
      }
    });
  });

  afterAll(async () => {
    if (m) {
      await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-pr-02-07' }, (e) =>
        e.executar(
          `DELETE pp FROM prorrogacao_parcela pp JOIN parcela_pagar p ON p.id = pp.parcela_pagar_id
             JOIN titulo_pagar t ON t.id = p.titulo_pagar_id WHERE t.estabelecimento_id IN (?, ?)`,
          [m.est, m.outroEst],
        ),
      );
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  it('prorroga: a parcela vence na data nova, o original fica e o passo vai ao histórico', async () => {
    const p = await titulo(963001, 500);
    const antes = await parcelaLida(p);
    const novo = somaDias(antes.vencimento, 15);
    const r = await prorrogar(p, novo, motivoLivre);
    expect(r).toMatchObject({
      vencimentoAnterior: antes.vencimento,
      vencimento: novo,
      vencimentoOriginal: antes.original,
    });
    const depois = await parcelaLida(p);
    expect(depois).toEqual({ vencimento: novo, original: antes.original, versao: antes.versao + 1 });
    const h = await uma(
      `SELECT vencimento_anterior, vencimento_novo, motivo_prorrogacao_id, operacao, usuario_id, observacao
         FROM prorrogacao_parcela WHERE id = ?`,
      [r.id],
    );
    expect({
      anterior: iso(h?.['vencimento_anterior']),
      novo: iso(h?.['vencimento_novo']),
      motivo: Number(h?.['motivo_prorrogacao_id']),
      operacao: h?.['operacao'],
      usuario: Number(h?.['usuario_id']),
      observacao: h?.['observacao'],
    }).toEqual({
      anterior: antes.vencimento,
      novo,
      motivo: motivoLivre,
      operacao: 'alteracao',
      usuario: m.lanca,
      observacao: null,
    });

    // Segunda prorrogação: outro passo, o original continua o mesmo; a leitura do histórico vem do mais recente.
    const novo2 = somaDias(novo, 10);
    await prorrogar(p, novo2, motivoJustificado, 'Nota com CNPJ divergente');
    expect(await parcelaLida(p)).toMatchObject({ vencimento: novo2, original: antes.original });
    expect(await passos(p)).toBe(2);
    const lidos = await porta.prorrogacoes(m.ctx(m.lanca), p);
    expect(lidos.map((x) => [x.vencimentoAnterior, x.vencimentoNovo, x.justificativa])).toEqual([
      [novo, novo2, 'Nota com CNPJ divergente'],
      [antes.vencimento, novo, ''],
    ]);
  });

  it('recusas não mudam a parcela nem o histórico', async () => {
    const p = await titulo(963002, 300);
    const antes = await parcelaLida(p);
    const recusada = async (g: Promise<unknown>) => {
      const codigo = await codigoDaGravacao(g);
      expect(await parcelaLida(p)).toEqual(antes);
      expect(await passos(p)).toBe(0);
      return codigo;
    };
    expect(await recusada(prorrogar(p, antes.vencimento, motivoLivre))).toBe('prorrogacao-para-tras');
    expect(await recusada(prorrogar(p, somaDias(antes.vencimento, -1), motivoLivre))).toBe(
      'prorrogacao-para-tras',
    );
    expect(await recusada(prorrogar(p, somaDias(antes.vencimento, 400), motivoLivre))).toBe(
      'prorrogacao-longa',
    );
    expect(await recusada(prorrogar(p, somaDias(antes.vencimento, 5), motivoJustificado, 'ok'))).toBe(
      'justificativa-obrigatoria',
    );
    expect(await recusada(prorrogar(p, somaDias(antes.vencimento, 5), 999_999_999))).toBe(
      'motivo-obrigatorio',
    );
  });

  it('a parcela de outro estabelecimento não é encontrada', async () => {
    const p = await titulo(963003, 200);
    const outra = porta.gravarSgh(comChave(m.ctx(m.lanca, m.outroEst)), trilha(p), (g) =>
      g.prorrogarVencimento({
        parcela: p,
        versao: null,
        vencimento: '2099-01-01',
        motivo: motivoLivre,
        justificativa: '',
        usuario: 'x',
        podeAprovar: false,
      }),
    );
    expect(await codigoDaGravacao(outra)).toBe('titulo-inexistente');
    expect(await passos(p)).toBe(0);
  });

  it('versão desatualizada é recusada sem mudar a parcela nem o histórico; a versão vigente passa', async () => {
    const p = await titulo(963004, 250);
    const antes = await parcelaLida(p);
    expect(
      await codigoDaGravacao(
        prorrogar(p, somaDias(antes.vencimento, 5), motivoLivre, '', `v${antes.versao + 7}`),
      ),
    ).toBe('conflito-versao');
    expect(await parcelaLida(p)).toEqual(antes);
    expect(await passos(p)).toBe(0);
    await prorrogar(p, somaDias(antes.vencimento, 5), motivoLivre, '', `v${antes.versao}`);
    expect(await passos(p)).toBe(1);
  });

  it('parcela numa remessa ainda sem retorno não é prorrogada; depois do retorno, é', async () => {
    const p = await titulo(963005, 400);
    const antes = await parcelaLida(p);
    const r = await remessa(p, antes.vencimento, 'gerada');
    expect(
      await uma(
        'SELECT situacao, vencimento, valor FROM parcela_remessa_bancaria WHERE remessa_bancaria_id = ? AND parcela_pagar_id = ?',
        [r.id, p],
      ),
    ).toMatchObject({ situacao: 'pendente' });
    expect(await codigoDaGravacao(prorrogar(p, somaDias(antes.vencimento, 5), motivoLivre))).toBe(
      'parcela-em-lote',
    );
    expect(await parcelaLida(p)).toEqual(antes);
    expect(await passos(p)).toBe(0);

    // A remessa respondida pelo banco (simulador) não prende a parcela.
    const q = await titulo(963006, 400);
    const antesQ = await parcelaLida(q);
    await remessa(q, antesQ.vencimento, 'retornada');
    await prorrogar(q, somaDias(antesQ.vencimento, 5), motivoLivre);
    expect(await passos(q)).toBe(1);
  });

  it('pelo serviço: título aprovado pede outro aprovador; a prorrogação grava a trilha com o evento', async () => {
    const apoios = new ApoiosFinanceiro(porta, new RegistradorTrilhaMemoria(), null, null, 'desenvolvimento');
    // A liberação da funcionalidade é da configuração do estabelecimento (fora deste contrato).
    (apoios.apoios.contasPagar as unknown as { exigirLiberacao: () => Promise<void> }).exigirLiberacao =
      async () => undefined;
    const servico = new ServicoFinanceiro(porta, apoios, 'desenvolvimento', {} as never);
    const sessao = (usuario: number, pode: (c: string) => boolean) =>
      ({
        req: { headers: { 'idempotency-key': `t0207-pr-${randomUUID()}` } },
        hospital: 'l0207',
        rede: '',
        login: `l0207.${usuario}`,
        porta: m.ctx(usuario),
        pode,
      }) as unknown as SessaoCadastro;
    const todas = () => true;
    const semAprovar = (c: string) => c !== 'financeiro.tituloPagar.aprovar';
    const p = await titulo(963007, 600);
    const antes = await parcelaLida(p);
    const novo = somaDias(antes.vencimento, 7);
    const pedido = (usuario: number, pode: (c: string) => boolean) =>
      servico.prorrogarVencimento(sessao(usuario, pode), {
        parcela: p,
        versao: null,
        vencimento: novo,
        motivo: motivoLivre,
        justificativa: '',
      });
    // Título aprovado na alçada (marca do aprovador, como a aprovação deixa).
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'pr-02-07-aprovado' }, (e) =>
      e.executar(
        `UPDATE titulo_pagar t JOIN parcela_pagar p ON p.titulo_pagar_id = t.id
            SET t.autorizado = TRUE, t.autorizado_em = NOW(3), t.autorizador_usuario_id = ? WHERE p.id = ?`,
        [m.aprova, p],
      ),
    );
    expect(await codigoServico(pedido(m.lanca, todas))).toBe('prorrogacao-pelo-lancador');
    expect(await codigoServico(pedido(m.aprova, semAprovar))).toBe('prorrogacao-exige-aprovador');
    expect(await parcelaLida(p)).toEqual(antes);
    expect(await passos(p)).toBe(0);

    await pedido(m.aprova, todas);
    expect(await parcelaLida(p)).toMatchObject({ vencimento: novo, original: antes.original });
    const t = await uma(
      `SELECT COUNT(*) AS n FROM trilha_auditoria
        WHERE entidade = 'parcela_pagar' AND entidade_id = ? AND estabelecimento_id = ? AND usuario_id = ?
          AND JSON_UNQUOTE(JSON_EXTRACT(dados_depois, '$.dados.evento')) = 'financeiro.titulo_pagar.vencimento_prorrogado'`,
      [p, m.est, m.aprova],
    );
    expect(Number(t?.['n'])).toBe(1);
  });
});
