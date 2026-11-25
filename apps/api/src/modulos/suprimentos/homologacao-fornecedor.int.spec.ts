// Integração da homologação do fornecedor por questionário (09-AREA linha 66) contra o MariaDB real (cliente f22_o4).
// Contrato de efeito: o questionário gravado (questionario_homologacao com auditoria e versão 1, uma
// questionario_homologacao_pergunta por pergunta com as opções em JSON, a trilha e a chave em idempotencia_operacao; o
// reenvio pela chave sem linha nova); a avaliação (homologacao_fornecedor com a nota, a faixa, a situação e a validade,
// uma homologacao_fornecedor_resposta por resposta com os pontos e o peso); a eliminatória que reprova; a exceção recusada
// a quem avaliou e aprovada por outra pessoa (versão 2, justificativa, validade); o cancelamento que fica no histórico; o
// ranking do painel; o outro estabelecimento sem acesso; o questionário encerrado que não avalia mais. Massa SINTÉTICA,
// limpa no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import {
  classificarHomologacao,
  type FaixaHomologacao,
  validadeHomologacao,
} from '@sgh/contratos/regras-suprimentos';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import {
  OPERACOES_HOMOLOGACAO_FORNECEDOR,
  PortaHomologacaoFornecedorPropria,
} from './homologacao-fornecedor.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const SEM_DB = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CODIGOS = ['c1070a', 'c1070b'];
const PREFIXO = 'C1070-';
const CNPJS = ['00107001000110', '00107002000120'];

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

const ESCALA = [
  { ordem: 1, texto: 'Não atende', pontos: 0 },
  { ordem: 2, texto: 'Atende parcialmente', pontos: 5 },
  { ordem: 3, texto: 'Atende plenamente', pontos: 10 },
];

describe.skipIf(SEM_DB)('Homologação do fornecedor contra o MariaDB (cliente f22_o4)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaHomologacaoFornecedorPropria;
  let estA = 0;
  let estB = 0;
  let avaliador = 0;
  let gestor = 0;
  let fornA = 0;
  let fornB = 0;
  let ctxA: ContextoPortaM18;
  let ctxGestor: ContextoPortaM18;
  let ctxB: ContextoPortaM18;
  let questionario = 0;
  let perguntas: number[] = [];
  let homA = 0;
  let homB = 0;
  const sufixo = String(Date.now()).slice(-8);
  const ler = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c1070-conta' }, (l) => l.consultar<T>(sql, p));

  async function limpar(e: Escritor): Promise<void> {
    const ests = `SELECT id FROM estabelecimento WHERE codigo IN ('${CODIGOS.join("','")}')`;
    await e.executar(
      `DELETE FROM homologacao_fornecedor_resposta WHERE homologacao_fornecedor_id IN (SELECT id FROM homologacao_fornecedor WHERE estabelecimento_id IN (${ests}))`,
      [],
    );
    await e.executar(`DELETE FROM homologacao_fornecedor WHERE estabelecimento_id IN (${ests})`, []);
    await e.executar(
      `DELETE FROM questionario_homologacao_pergunta WHERE questionario_homologacao_id IN (SELECT id FROM questionario_homologacao WHERE codigo LIKE '${PREFIXO}%')`,
      [],
    );
    await e.executar(`DELETE FROM questionario_homologacao WHERE codigo LIKE '${PREFIXO}%'`, []);
    await e.executar(`DELETE FROM faixa_avaliacao_fornecedor WHERE codigo LIKE '${PREFIXO}%'`, []);
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    porta = new PortaHomologacaoFornecedorPropria(nucleo);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1070-massa' }, async (e) => {
      const agora = new Date();
      await limpar(e);
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
      const usuario = (login: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
          [login, `Usuário fictício ${login}`, agora],
        );
      avaliador = await usuario('c1070.avaliador');
      gestor = await usuario('c1070.gestor');
      const forn = (cnpj: string, nome: string) =>
        garantir(
          e,
          'SELECT id FROM empresa_fornecedora WHERE cnpj = ?',
          [cnpj],
          "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, criado_em) VALUES ('juridica', ?, ?, ?)",
          [cnpj, nome, agora],
        );
      fornA = await forn(CNPJS[0]!, 'DISTRIBUIDORA FICTÍCIA C1070 A LTDA');
      fornB = await forn(CNPJS[1]!, 'DISTRIBUIDORA FICTÍCIA C1070 B LTDA');
      await e.executar(
        `INSERT INTO faixa_avaliacao_fornecedor (codigo, descricao, nota_inicial, nota_final, resultado, ordem, criado_em)
         VALUES (?, 'Ótimo (teste)', 90, 100, 'aprovado', 1, ?), (?, 'Reprovado (teste)', 0, 49.9999, 'reprovado', 3, ?)`,
        [`${PREFIXO}OT`, agora, `${PREFIXO}RE`, agora],
      );
    });
    const correlacao = `c1070-${sufixo}`;
    ctxA = { cliente: CLIENTE, estabelecimento: estA, usuario: avaliador, correlacao };
    ctxGestor = { cliente: CLIENTE, estabelecimento: estA, usuario: gestor, correlacao };
    ctxB = { cliente: CLIENTE, estabelecimento: estB, usuario: avaliador, correlacao };
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1070-limpa' }, async (e) => {
        await limpar(e);
        await limparTrilhaDaMassa(e, { codigos: CODIGOS });
      });
      await nucleo.encerrar();
    }
  });

  const QUESTIONARIO = {
    descricao: 'Fornecedores de medicamentos (teste)',
    categoria: null,
    notaMinima: 70,
    validadeMeses: 12,
    instrucoes: null,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    perguntas: [
      {
        identificador: 'afe',
        texto: 'Autorização de funcionamento vigente?',
        peso: 3,
        tipoResposta: 'sim_nao' as const,
        opcoes: [],
        obrigatoria: true,
        eliminatoria: true,
      },
      {
        identificador: 'prazo',
        texto: 'Cumprimento de prazo de entrega',
        peso: 2,
        tipoResposta: 'escala' as const,
        opcoes: ESCALA,
        obrigatoria: true,
        eliminatoria: false,
      },
      {
        identificador: null,
        texto: 'Observações da visita técnica',
        peso: 1,
        tipoResposta: 'texto' as const,
        opcoes: [],
        obrigatoria: false,
        eliminatoria: false,
      },
    ],
  };

  it('grava o questionário com as perguntas (auditoria, trilha, chave) e o reenvio não duplica', async () => {
    const chave = `c1070-q-${sufixo}`;
    const e = { ...QUESTIONARIO, codigo: `${PREFIXO}${sufixo}` };
    const r = await porta.gravarQuestionario(ctxA, e, chave);
    questionario = r.id;
    expect(await porta.gravarQuestionario(ctxA, e, chave)).toEqual(r);
    const [q] = await ler(
      'SELECT codigo, nota_minima, validade_meses, versao, criado_por, ativo FROM questionario_homologacao WHERE codigo LIKE ?',
      [`${PREFIXO}%`],
    );
    expect(q!['codigo']).toBe(`${PREFIXO}${sufixo}`);
    expect([Number(q!['nota_minima']), Number(q!['validade_meses']), Number(q!['versao'])]).toEqual([
      70, 12, 1,
    ]);
    expect(Number(q!['criado_por'])).toBe(avaliador);
    const ps = await ler(
      'SELECT id, sequencia, identificador, tipo_resposta, peso, respostas, eliminatoria FROM questionario_homologacao_pergunta WHERE questionario_homologacao_id = ? ORDER BY sequencia',
      [questionario],
    );
    perguntas = ps.map((p) => Number(p['id']));
    expect(
      ps.map((p) => [Number(p['sequencia']), p['identificador'], p['tipo_resposta'], Number(p['peso'])]),
    ).toEqual([
      [1, 'AFE', 'sim_nao', 3],
      [2, 'PRAZO', 'escala', 2],
      [3, null, 'texto', 1],
    ]);
    const bruto = ps[1]!['respostas'];
    const opcoes = (typeof bruto === 'string' ? JSON.parse(bruto) : bruto) as { pontos: number }[];
    expect(opcoes.map((o) => o.pontos)).toEqual([0, 5, 10]);
    expect(ps[0]!['respostas']).toBeNull();
    const [t] = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'questionario_homologacao' AND entidade_id = ?",
      [questionario],
    );
    expect(Number(t?.['n'])).toBeGreaterThanOrEqual(1);
    const [i] = await ler(
      'SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = ? AND estabelecimento_id = ?',
      [OPERACOES_HOMOLOGACAO_FORNECEDOR.questionario, estA],
    );
    expect(Number(i?.['n'])).toBe(1);
  });

  it('avalia: nota ponderada, faixa, homologado com validade; uma resposta por pergunta respondida', async () => {
    const r = await porta.avaliar(
      ctxA,
      {
        fornecedor: fornA,
        questionario,
        insumo: null,
        respostas: [
          { pergunta: perguntas[0]!, opcao: 1, texto: null },
          { pergunta: perguntas[1]!, opcao: 3, texto: null },
          { pergunta: perguntas[2]!, opcao: null, texto: 'Visita sem pendências' },
        ],
      },
      `c1070-a-${sufixo}`,
    );
    homA = r.id;
    const faixas = (
      await ler(
        'SELECT id, codigo, descricao, nota_inicial, nota_final, resultado FROM faixa_avaliacao_fornecedor WHERE ativo',
        [],
      )
    ).map((f): FaixaHomologacao => ({
      id: Number(f['id']),
      codigo: String(f['codigo']),
      descricao: String(f['descricao']),
      notaInicial: Number(f['nota_inicial']),
      notaFinal: Number(f['nota_final']),
      resultado: f['resultado'] as FaixaHomologacao['resultado'],
    }));
    const esperado = classificarHomologacao({ nota: 100, eliminatorias: [] }, 70, faixas);
    expect(r.nota).toBe(100);
    expect(r.situacao).toBe(esperado.situacao);
    expect(r.parcelas.at(-1)).toBe('Nota = 100 × 5 ÷ 5 = 100');
    const [hoje] = await ler("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS d", []);
    const [h] = await ler(
      "SELECT situacao, nota, faixa_avaliacao_fornecedor_id, DATE_FORMAT(valido_ate, '%Y-%m-%d') AS ate, avaliador_usuario_id, excecao_aprovada, versao, criado_por FROM homologacao_fornecedor WHERE id = ?",
      [homA],
    );
    expect(h!['situacao']).toBe('homologado');
    expect(Number(h!['nota'])).toBe(100);
    expect(Number(h!['faixa_avaliacao_fornecedor_id'])).toBe(esperado.faixa!.id);
    expect(h!['ate']).toBe(validadeHomologacao(String(hoje!['d']), 12));
    expect([
      Number(h!['avaliador_usuario_id']),
      Number(h!['excecao_aprovada']),
      Number(h!['versao']),
    ]).toEqual([avaliador, 0, 1]);
    const rs = await ler(
      'SELECT sequencia, questionario_homologacao_pergunta_id AS p, resposta, atende, pontuacao, peso FROM homologacao_fornecedor_resposta WHERE homologacao_fornecedor_id = ? ORDER BY sequencia',
      [homA],
    );
    expect(
      rs.map((x) => [
        Number(x['p']),
        x['resposta'],
        x['atende'] === null ? null : Number(x['atende']),
        Number(x['pontuacao']),
        Number(x['peso']),
      ]),
    ).toEqual([
      [perguntas[0], 'Sim', 1, 10, 3],
      [perguntas[1], 'Atende plenamente', null, 10, 2],
      [perguntas[2], 'Visita sem pendências', null, 0, 1],
    ]);
  });

  it('a eliminatória reprova sem validade; a obrigatória sem resposta é recusada e nada grava', async () => {
    await expect(
      porta.avaliar(
        ctxA,
        {
          fornecedor: fornB,
          questionario,
          insumo: null,
          respostas: [{ pergunta: perguntas[0]!, opcao: 1, texto: null }],
        },
        `c1070-x-${sufixo}`,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'resposta-obrigatoria' } });
    const r = await porta.avaliar(
      ctxA,
      {
        fornecedor: fornB,
        questionario,
        insumo: null,
        respostas: [
          { pergunta: perguntas[0]!, opcao: 2, texto: null },
          { pergunta: perguntas[1]!, opcao: 3, texto: null },
        ],
      },
      `c1070-b-${sufixo}`,
    );
    homB = r.id;
    expect(r.situacao).toBe('reprovado');
    expect(r.nota).toBe(40);
    expect(r.motivos.join(' ')).toContain('Eliminatória');
    const [h] = await ler('SELECT situacao, valido_ate FROM homologacao_fornecedor WHERE id = ?', [homB]);
    expect(h).toMatchObject({ situacao: 'reprovado', valido_ate: null });
    const [n] = await ler(
      'SELECT COUNT(*) AS n FROM homologacao_fornecedor WHERE estabelecimento_id = ? AND empresa_fornecedora_id = ?',
      [estA, fornB],
    );
    expect(Number(n?.['n'])).toBe(1);
  });

  it('a exceção: recusada a quem avaliou; aprovada por outra pessoa com justificativa (versão 2, validade)', async () => {
    const just = 'Único distribuidor do item na região; plano de ação de 90 dias.';
    await expect(porta.aprovarExcecao(ctxA, homB, just, 1, `c1070-e1-${sufixo}`)).rejects.toMatchObject({
      problema: { codigo: 'excecao-segregacao' },
    });
    const r = await porta.aprovarExcecao(ctxGestor, homB, just, 1, `c1070-e2-${sufixo}`);
    expect(r.validoAte).not.toBeNull();
    const [h] = await ler(
      "SELECT situacao, excecao_aprovada, justificativa, versao, alterado_por, DATE_FORMAT(valido_ate, '%Y-%m-%d') AS ate FROM homologacao_fornecedor WHERE id = ?",
      [homB],
    );
    expect(h!['situacao']).toBe('homologado');
    expect([Number(h!['excecao_aprovada']), Number(h!['versao']), Number(h!['alterado_por'])]).toEqual([
      1,
      2,
      gestor,
    ]);
    expect(h!['justificativa']).toBe(just);
    expect(h!['ate']).toBe(r.validoAte);
  });

  it('cancela com motivo (fica no histórico); o ranking traz só a vigente; o outro estabelecimento não vê', async () => {
    await porta.cancelar(ctxA, homA, 'Avaliação lançada no questionário errado', 1, `c1070-c-${sufixo}`);
    const [h] = await ler('SELECT situacao, versao FROM homologacao_fornecedor WHERE id = ?', [homA]);
    expect([h!['situacao'], Number(h!['versao'])]).toEqual(['cancelado', 2]);
    await expect(
      porta.cancelar(ctxA, homA, 'Avaliação lançada no questionário errado', 2, `c1070-c2-${sufixo}`),
    ).rejects.toMatchObject({ problema: { codigo: 'homologacao-cancelada' } });
    const p = await porta.painel(ctxA);
    const ranking = p.ranking.filter((x) => x.questionario === questionario);
    expect(ranking.map((x) => [x.posicao, x.id, x.situacaoNaData, x.excecao])).toEqual([
      [1, homB, 'homologado', true],
    ]);
    expect(p.homologacoes.filter((x) => x.questionario === questionario).map((x) => x.id)).toEqual(
      expect.arrayContaining([homA, homB]),
    );
    const d = await porta.detalhe(ctxA, homB);
    expect(d.respostas.map((x) => x.pontuacao)).toEqual([0, 10]);
    await expect(porta.detalhe(ctxB, homB)).rejects.toMatchObject({ problema: { codigo: 'nao-encontrado' } });
    expect((await porta.painel(ctxB)).homologacoes.filter((x) => x.questionario === questionario)).toEqual(
      [],
    );
  });

  it('o questionário encerrado deixa de avaliar; as avaliações continuam', async () => {
    await porta.encerrarQuestionario(ctxA, questionario, '2026-01-02', 1, `c1070-f-${sufixo}`);
    const [q] = await ler(
      "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, versao FROM questionario_homologacao WHERE id = ?",
      [questionario],
    );
    expect([q!['fim'], Number(q!['versao'])]).toEqual(['2026-01-02', 2]);
    await expect(
      porta.avaliar(
        ctxA,
        {
          fornecedor: fornA,
          questionario,
          insumo: null,
          respostas: [
            { pergunta: perguntas[0]!, opcao: 1, texto: null },
            { pergunta: perguntas[1]!, opcao: 3, texto: null },
          ],
        },
        `c1070-g-${sufixo}`,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'questionario-fora-vigencia' } });
    const [n] = await ler(
      'SELECT COUNT(*) AS n FROM homologacao_fornecedor WHERE questionario_homologacao_id = ?',
      [questionario],
    );
    expect(Number(n?.['n'])).toBe(2);
  });
});
