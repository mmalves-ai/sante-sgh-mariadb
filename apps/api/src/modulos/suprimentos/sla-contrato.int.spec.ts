// Integração do SLA do contrato com fornecedor (09-AREA linha 88) contra o MariaDB real (cliente f22_o4).
// Contrato de efeito: o SLA gravado (sla_contrato com auditoria e versão 1, uma faixa_sla_contrato por faixa na ordem,
// a trilha e a chave em idempotencia_operacao; o reenvio pela chave sem linha nova), o novo do mesmo modelo fechando o
// anterior na véspera (versão 2, nada apagado), a medição em ocorrencia_contrato com o tempo coberto (fim de semana fora),
// a apuração do período com a faixa, a glosa e a multa gravadas (tipo multa, valor total, parcelas), a recusa do período
// já apurado, do contrato de outro estabelecimento e do encerramento antes da apuração. Massa SINTÉTICA, limpa no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { OPERACOES_SLA_CONTRATO, PortaSlaContratoPropria } from './sla-contrato.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const SEM_DB = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CODIGOS = ['c1053a', 'c1053b'];
const NUMERO = 'C1053-SLA';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

const FAIXAS = [
  {
    codigo: 'C',
    descricao: 'Crítico',
    desempenhoInicio: 0,
    desempenhoFim: 80,
    penalidade: 'glosa_e_multa' as const,
    percentualGlosa: 10,
    valorMulta: 500,
  },
  {
    codigo: 'B',
    descricao: 'Abaixo',
    desempenhoInicio: 80,
    desempenhoFim: 95,
    penalidade: 'glosa' as const,
    percentualGlosa: 5,
    valorMulta: null,
  },
  {
    codigo: 'A',
    descricao: 'Atende',
    desempenhoInicio: 95,
    desempenhoFim: null,
    penalidade: 'nenhuma' as const,
    percentualGlosa: null,
    valorMulta: null,
  },
];

describe.skipIf(SEM_DB)('SLA do contrato com fornecedor contra o MariaDB (cliente f22_o4)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSlaContratoPropria;
  let estA = 0;
  let estB = 0;
  let usuario = 0;
  let contrato = 0;
  let ctxA: ContextoPortaM18;
  let ctxB: ContextoPortaM18;
  let slaAntigo = 0;
  let slaNovo = 0;
  const sufixo = String(Date.now()).slice(-8);
  const ler = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c1053-conta' }, (l) => l.consultar<T>(sql, p));

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1053-limpa' }, async (e) => {
      const sub = `SELECT id FROM contrato_fornecedor WHERE numero LIKE '${NUMERO}%'`;
      await e.executar(`DELETE FROM ocorrencia_contrato WHERE contrato_fornecedor_id IN (${sub})`, []);
      await e.executar(
        `DELETE FROM faixa_sla_contrato WHERE sla_contrato_id IN (SELECT id FROM sla_contrato WHERE contrato_fornecedor_id IN (${sub}))`,
        [],
      );
      await e.executar(`DELETE FROM sla_contrato WHERE contrato_fornecedor_id IN (${sub})`, []);
      await e.executar(`DELETE FROM contrato_fornecedor WHERE numero LIKE '${NUMERO}%'`, []);
      await limparTrilhaDaMassa(e, { codigos: CODIGOS });
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    porta = new PortaSlaContratoPropria(nucleo);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1053-massa' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital fictício ${codigo}`, `Hospital fictício ${codigo} (teste)`, agora],
        );
      estA = await est(CODIGOS[0]!);
      estB = await est(CODIGOS[1]!);
      usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['c1053.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['c1053.teste', 'Usuário fictício do SLA', agora],
      );
      const fornecedor = await garantir(
        e,
        'SELECT id FROM empresa_fornecedora WHERE cnpj = ?',
        ['00105301000110'],
        "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, criado_em) VALUES ('juridica', ?, ?, ?)",
        ['00105301000110', 'MANUTENÇÃO FICTÍCIA C1053 LTDA', agora],
      );
      await e.executar(
        `DELETE FROM ocorrencia_contrato WHERE contrato_fornecedor_id IN (SELECT id FROM contrato_fornecedor WHERE numero LIKE '${NUMERO}%')`,
        [],
      );
      await e.executar(
        `DELETE FROM faixa_sla_contrato WHERE sla_contrato_id IN (SELECT id FROM sla_contrato WHERE contrato_fornecedor_id IN (SELECT id FROM contrato_fornecedor WHERE numero LIKE '${NUMERO}%'))`,
        [],
      );
      await e.executar(
        `DELETE FROM sla_contrato WHERE contrato_fornecedor_id IN (SELECT id FROM contrato_fornecedor WHERE numero LIKE '${NUMERO}%')`,
        [],
      );
      await e.executar(`DELETE FROM contrato_fornecedor WHERE numero LIKE '${NUMERO}%'`, []);
      contrato = await e.inserir(
        `INSERT INTO contrato_fornecedor (estabelecimento_id, numero, objeto, empresa_fornecedora_id, tipo, data_emissao,
            vigencia_inicio, vigencia_fim, situacao, criado_em)
         VALUES (?, ?, 'Manutenção corretiva fictícia', ?, 'manutencao', '2026-01-01', '2026-01-01', '2027-12-31', 'vigente', ?)`,
        [estA, `${NUMERO}-${sufixo}`, fornecedor, agora],
      );
    });
    const correlacao = `c1053-${sufixo}`;
    ctxA = { cliente: CLIENTE, estabelecimento: estA, usuario, correlacao };
    ctxB = { cliente: CLIENTE, estabelecimento: estB, usuario, correlacao };
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  const SLA = {
    servico: null,
    descricao: 'Atendimento da manutenção corretiva',
    tipoRegra: 'tempo_atendimento' as const,
    unidade: 'hora' as const,
    meta: 4,
    horarioInicio: '08:00',
    horarioFim: '18:00',
    somenteDiasUteis: true,
    vigenciaFim: null,
    faixas: FAIXAS,
  };

  it('grava o SLA com as faixas (auditoria, trilha, chave) e o reenvio não duplica; o novo fecha o anterior na véspera', async () => {
    const chave = `c1053-sla1-${sufixo}`;
    const r = await porta.gravar(ctxA, contrato, { ...SLA, meta: 6, vigenciaInicio: '2026-01-01' }, chave);
    slaAntigo = r.id;
    expect(r.fechados).toEqual([]);
    expect(
      await porta.gravar(ctxA, contrato, { ...SLA, meta: 6, vigenciaInicio: '2026-01-01' }, chave),
    ).toEqual(r);
    const [s] = await ler(
      "SELECT tipo_regra, unidade_medida, meta, TIME_FORMAT(horario_inicio, '%H:%i') AS hi, somente_dias_uteis, versao, criado_por, criado_em FROM sla_contrato WHERE contrato_fornecedor_id = ?",
      [contrato],
    );
    expect(s).toMatchObject({ tipo_regra: 'tempo_atendimento', unidade_medida: 'hora', hi: '08:00' });
    expect(Number(s!['meta'])).toBe(6);
    expect(Number(s!['versao'])).toBe(1);
    expect(Number(s!['criado_por'])).toBe(usuario);
    const faixas = await ler(
      'SELECT sequencia, codigo_faixa, tipo_penalidade, percentual_glosa, valor_multa FROM faixa_sla_contrato WHERE sla_contrato_id = ? ORDER BY sequencia',
      [slaAntigo],
    );
    expect(faixas.map((f) => [Number(f['sequencia']), f['codigo_faixa'], f['tipo_penalidade']])).toEqual([
      [1, 'C', 'glosa_e_multa'],
      [2, 'B', 'glosa'],
      [3, 'A', 'nenhuma'],
    ]);
    const [t] = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'sla_contrato' AND entidade_id = ?",
      [slaAntigo],
    );
    expect(Number(t?.['n'])).toBeGreaterThanOrEqual(1);
    const [i] = await ler(
      'SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = ? AND estabelecimento_id = ?',
      [OPERACOES_SLA_CONTRATO.gravar, estA],
    );
    expect(Number(i?.['n'])).toBe(1);

    const novo = await porta.gravar(
      ctxA,
      contrato,
      { ...SLA, vigenciaInicio: '2026-11-01' },
      `c1053-sla2-${sufixo}`,
    );
    slaNovo = novo.id;
    expect(novo.fechados).toEqual([slaAntigo]);
    const todos = await ler(
      "SELECT id, versao, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, alterado_por FROM sla_contrato WHERE contrato_fornecedor_id = ? ORDER BY id",
      [contrato],
    );
    expect(todos).toHaveLength(2);
    expect(todos[0]).toMatchObject({ fim: '2026-10-31' });
    expect(Number(todos[0]!['versao'])).toBe(2);
    expect(Number(todos[0]!['alterado_por'])).toBe(usuario);
    expect(todos[1]!['fim']).toBeNull();
    // O de mesmo modelo começando no mesmo dia do novo é recusado; o de outro estabelecimento não acha o contrato.
    await expect(
      porta.gravar(ctxA, contrato, { ...SLA, vigenciaInicio: '2026-11-01' }, `c1053-sla3-${sufixo}`),
    ).rejects.toMatchObject({ problema: { codigo: 'sla-sobreposto' } });
    await expect(porta.painel(ctxB, contrato)).rejects.toMatchObject({
      problema: { codigo: 'nao-encontrado' },
    });
  });

  it('mede os chamados pelo tempo coberto e apura o período com faixa, glosa e multa gravadas', async () => {
    // Sexta 17h a segunda 9h30: 2,5 h cobertas (no prazo). Terça 8h às 14h: 6 h (fora do prazo de 4 h).
    const m1 = await porta.medir(
      ctxA,
      contrato,
      slaNovo,
      {
        inicio: '2026-11-20T17:00',
        fim: '2026-11-23T09:30',
        quantidade: null,
        descricao: 'Bomba de infusão parada',
      },
      `c1053-m1-${sufixo}`,
    );
    expect(m1.medido).toBe(2.5);
    await porta.medir(
      ctxA,
      contrato,
      slaNovo,
      {
        inicio: '2026-11-24T08:00',
        fim: '2026-11-24T14:00',
        quantidade: null,
        descricao: 'Monitor sem imagem',
      },
      `c1053-m2-${sufixo}`,
    );
    const [o] = await ler(
      "SELECT tipo_ocorrencia, duracao_horas, usuario_id, DATE_FORMAT(ocorrido_em, '%Y-%m-%dT%H:%i') AS em FROM ocorrencia_contrato WHERE id = ?",
      [m1.id],
    );
    expect(o).toMatchObject({ tipo_ocorrencia: 'atraso', em: '2026-11-20T17:00' });
    expect(Number(o!['duracao_horas'])).toBe(2.5);
    expect(Number(o!['usuario_id'])).toBe(usuario);
    // Medição no futuro: recusada.
    await expect(
      porta.medir(
        ctxA,
        contrato,
        slaNovo,
        { inicio: '2099-01-01T08:00', fim: '2099-01-01T09:00', quantidade: null, descricao: 'x' },
        `c1053-m3-${sufixo}`,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'medicao-futura' } });

    const periodo = { inicio: '2026-11-01', fim: '2026-11-24', valorFatura: 10000 };
    const previa = await porta.previa(ctxA, contrato, slaNovo, periodo);
    expect(previa).toMatchObject({
      considerados: 2,
      noPrazo: 1,
      desempenho: 50,
      glosa: 1000,
      multa: 500,
      total: 1500,
    });
    const [antes] = await ler(
      "SELECT COUNT(*) AS n FROM ocorrencia_contrato WHERE sla_contrato_id = ? AND tipo_ocorrencia = 'multa'",
      [slaNovo],
    );
    expect(Number(antes?.['n'])).toBe(0);
    // A glosa sem o valor da fatura é recusada.
    await expect(
      porta.apurar(ctxA, contrato, slaNovo, { ...periodo, valorFatura: null }, `c1053-a0-${sufixo}`),
    ).rejects.toMatchObject({ problema: { codigo: 'fatura-obrigatoria' } });
    const a = await porta.apurar(ctxA, contrato, slaNovo, periodo, `c1053-a1-${sufixo}`);
    expect(a).toMatchObject({ desempenho: 50, faixa: 'C', glosa: 1000, multa: 500, total: 1500 });
    expect(a.parcelas.length).toBeGreaterThanOrEqual(4);
    const [g] = await ler(
      "SELECT tipo_ocorrencia, valor, gerada_automaticamente, JSON_UNQUOTE(JSON_EXTRACT(dados, '$.faixa')) AS faixa FROM ocorrencia_contrato WHERE id = ?",
      [a.id],
    );
    expect(g).toMatchObject({ tipo_ocorrencia: 'multa', faixa: 'C' });
    expect(Number(g!['valor'])).toBe(1500);
    expect(Number(g!['gerada_automaticamente'])).toBe(1);
    // Reenvio pela chave: a mesma apuração, nenhuma linha nova; o mesmo período com outra chave: recusado.
    expect((await porta.apurar(ctxA, contrato, slaNovo, periodo, `c1053-a1-${sufixo}`)).id).toBe(a.id);
    await expect(
      porta.apurar(ctxA, contrato, slaNovo, { ...periodo, inicio: '2026-11-10' }, `c1053-a2-${sufixo}`),
    ).rejects.toMatchObject({ problema: { codigo: 'periodo-ja-apurado' } });
    const [n] = await ler(
      "SELECT COUNT(*) AS n FROM ocorrencia_contrato WHERE sla_contrato_id = ? AND JSON_UNQUOTE(JSON_EXTRACT(dados, '$.evento')) = 'sla-apuracao'",
      [slaNovo],
    );
    expect(Number(n?.['n'])).toBe(1);
    // O encerramento antes do fim da apuração é recusado; depois dela, fecha a vigência (versão sobe, nada apagado).
    const painel = await porta.painel(ctxA, contrato);
    const s = painel.slas.find((x) => x.id === slaNovo)!;
    expect(s.medicoes).toHaveLength(2);
    expect(s.apuracoes).toHaveLength(1);
    await expect(
      porta.encerrar(ctxA, contrato, slaNovo, '2026-11-20', s.versao, `c1053-e1-${sufixo}`),
    ).rejects.toMatchObject({ problema: { codigo: 'sla-apurado' } });
    await porta.encerrar(ctxA, contrato, slaNovo, '2026-11-24', s.versao, `c1053-e2-${sufixo}`);
    const [f] = await ler(
      "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, versao FROM sla_contrato WHERE id = ?",
      [slaNovo],
    );
    expect(f).toMatchObject({ fim: '2026-11-24' });
    expect(Number(f!['versao'])).toBe(2);
  });
});
