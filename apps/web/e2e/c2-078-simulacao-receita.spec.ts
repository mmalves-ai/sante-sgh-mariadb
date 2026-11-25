// F8 (01-ADM L120) @C2-078: simulação de cenários de receita sobre a produção real pelo caminho da tela. As rotas
// exigem o banco próprio e o E2E roda com a fonte sintética, então as respostas da API são simuladas pelo Playwright
// com massa SINTÉTICA. O que se prova é a tela: o cenário sem mudança e a troca de procedimento sem código de destino
// travam o salvar na hora; "Salvar e simular" envia o cenário (convênio, tabela nova, reajuste, conversão com fator) e
// a execução num clique; o resultado mostra os totais com as parcelas, por convênio, por grupo e os itens sem preço;
// "Simular de novo" pede outra execução do cenário. O efeito no banco está no contrato de efeito
// apps/api/src/modulos/faturamento/simulacao-receita-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const OPCOES = {
  fontes: [
    { id: 3, descricao: 'CONVENIO SINTETICO A' },
    { id: 4, descricao: 'CONVENIO SINTETICO B' },
  ],
  planos: [{ id: 5, descricao: 'P1 PLANO SINTETICO', fonteId: 3 }],
  tabelas: [
    { id: 7, descricao: 'TN TABELA SINTETICA NOVA', fonteId: 3 },
    { id: 8, descricao: 'TB TABELA SINTETICA B', fonteId: 4 },
  ],
};

function painel(executado: boolean) {
  return {
    cenarios: executado
      ? [
          {
            id: 21,
            nome: 'CENARIO SINTETICO',
            objetivo: 'troca_tabela_preco',
            descricao: null,
            producaoInicio: '2026-01-01',
            producaoFim: '2026-01-01',
            dataReferencia: 'competencia',
            situacao: 'concluido',
            receitaBase: 390,
            receitaSimulada: 601,
            quantidadeAtendimentos: 2,
            processadoEm: '2026-11-25T10:00:00',
          },
        ]
      : [],
    execucoes: executado
      ? [
          {
            id: 31,
            cenarioId: 21,
            solicitadoEm: '2026-11-25T10:00:00',
            situacao: 'concluida_com_inconsistencia',
            dataReferencia: 'competencia',
            tipo: 'cenario_completo',
            quantidadeItens: 4,
            quantidadeInconsistencias: 1,
            valorAtual: 390,
            valorSimulado: 601,
            diferenca: 211,
          },
        ]
      : [],
    opcoes: OPCOES,
  };
}

const somas = (q: number, a: number, s: number) => ({
  quantidade: q,
  valorAtual: a,
  valorSimulado: s,
  diferenca: Math.round((s - a) * 100) / 100,
});
const DETALHE = {
  simulacao: {
    id: 31,
    cenarioId: 21,
    cenario: 'CENARIO SINTETICO',
    objetivo: 'troca_tabela_preco',
    tipo: 'cenario_completo',
    periodoInicio: '2026-01-01',
    periodoFim: '2026-01-31',
    dataReferencia: 'competencia',
    situacao: 'concluida_com_inconsistencia',
    solicitadoEm: '2026-11-25T10:00:00',
    quantidadeItens: 4,
    quantidadeInconsistencias: 1,
    valorAtual: 390,
    valorSimulado: 601,
    diferenca: 211,
    percentual: 54.1,
  },
  regras: [
    {
      id: 1,
      fonte: 'CONVENIO SINTETICO A',
      plano: null,
      fonteDestino: null,
      tabelaDestino: 'TABELA SINTETICA NOVA',
      percentualAjuste: 10,
      conversoes: 1,
    },
  ],
  porConvenio: [{ fonteId: 3, fonte: 'CONVENIO SINTETICO A', fonteDestino: null, ...somas(5, 390, 601) }],
  porGrupo: [{ grupoId: 6, grupo: 'GRUPO SINTETICO', ...somas(5, 390, 601) }],
  porTipoAtendimento: [
    { tipo: 'ambulatorial', ...somas(1, 100, 165) },
    { tipo: 'internacao', ...somas(4, 290, 436) },
  ],
  itens: [
    {
      sequencia: 2,
      fonte: 'CONVENIO SINTETICO A',
      codigo: '90000001',
      descricao: 'PROCEDIMENTO SINTETICO X',
      tipo: 'internacao',
      atendimentos: 1,
      ...somas(2, 200, 330),
    },
  ],
  inconsistencias: [
    {
      sequencia: 1,
      motivo: 'sem_preco_destino',
      detalhe: 'Procedimento sem preço vigente na tabela de destino (1 item).',
      data: '2026-01-12',
      codigoAtual: '90000004',
      descricaoAtual: 'PROCEDIMENTO SINTETICO W',
      codigoDestino: null,
      resolvida: false,
    },
  ],
};

async function simular(page: Page, enviados: Record<string, unknown>[]): Promise<void> {
  let executado = false;
  await page.route('**/api/faturamento/simulacao-receita', (r) => json(r, painel(executado)));
  await page.route('**/api/faturamento/simulacao-receita/cenarios', (r) => {
    enviados.push({ rota: 'cenario', ...(r.request().postDataJSON() as Record<string, unknown>) });
    return json(r, { id: 21, regras: 1, conversoes: 1, parametros: 1 }, 201);
  });
  await page.route('**/api/faturamento/simulacao-receita/cenarios/21/execucoes', (r) => {
    enviados.push({ rota: 'execucao', ...(r.request().postDataJSON() as Record<string, unknown>) });
    executado = true;
    return json(
      r,
      {
        id: 31,
        valorAtual: 390,
        valorSimulado: 601,
        diferenca: 211,
        situacao: 'concluida_com_inconsistencia',
      },
      201,
    );
  });
  await page.route('**/api/faturamento/simulacao-receita/execucoes/31', (r) => json(r, DETALHE));
}

test.describe('@C2-078 simulação de cenários de receita (01-ADM L120)', () => {
  test('cenário conferido na hora, salvar e simular num clique e resultado com as parcelas', async ({
    page,
  }) => {
    const enviados: Record<string, unknown>[] = [];
    await simular(page, enviados);
    await entrar(page, 'SINT.CONTAS');

    await page.goto('/faturamento/simulacao-receita');
    await expect(page.getByTestId('tela-simulacao-receita')).toBeVisible();
    await expect(page.getByTestId('sr-sem-cenarios')).toBeVisible();

    // Sem o que muda: o salvar mostra o erro na hora e não envia nada.
    await page.getByTestId('sr-nome').fill('CENARIO SINTETICO');
    // Pela competência, o dia no meio do mês vale pelo mês inteiro: a tela mostra as competências enquanto se digita.
    await page.getByTestId('sr-inicio').fill('2026-01-15');
    await page.getByTestId('sr-fim').fill('2026-01-31');
    await expect(page.getByTestId('sr-competencias')).toContainText('01/2026 a 01/2026');
    await escolher(page.getByTestId('sr-regra-0-convenio'), { rotulo: 'CONVENIO SINTETICO A' });
    await page.getByTestId('sr-salvar').click();
    await expect(page.getByTestId('sr-regra-0-erro-destino')).toBeVisible();
    await expect(page.getByTestId('sr-salvar')).toBeDisabled();
    expect(enviados).toHaveLength(0);

    // Tabela nova, reajuste e troca de procedimento: sem o código de destino, o erro aparece enquanto se digita.
    await escolher(page.getByTestId('sr-regra-0-tabela'), { rotulo: 'TN TABELA SINTETICA NOVA' });
    await page.getByTestId('sr-regra-0-reajuste').fill('10');
    await expect(page.getByTestId('sr-regra-0-erro-destino')).toBeHidden();
    await page.getByTestId('sr-regra-0-nova-conversao').click();
    await page.getByTestId('sr-conv-0-0-atual').fill('90000002');
    await expect(page.getByTestId('sr-conv-0-0-erro-destino')).toBeVisible();
    await expect(page.getByTestId('sr-salvar')).toBeDisabled();
    await page.getByTestId('sr-conv-0-0-destino').fill('90000003');
    await page.getByTestId('sr-conv-0-0-fator-destino').fill('2');
    await expect(page.getByTestId('sr-conv-0-0-erro-destino')).toBeHidden();
    await expect(page.getByTestId('sr-salvar')).toBeEnabled();
    await semViolacaoAxe(page, 'simulação de receita');

    await page.getByTestId('sr-salvar').click();
    await expect(page.getByTestId('sr-resultado')).toBeVisible();
    expect(enviados[0]).toMatchObject({
      rota: 'cenario',
      nome: 'CENARIO SINTETICO',
      producaoInicio: '2026-01-01',
      producaoFim: '2026-01-01',
      dataReferencia: 'competencia',
      regras: [
        {
          fontePagadoraId: 3,
          tabelaDestinoId: 7,
          percentualAjuste: 10,
          conversoes: [
            { itemAtualCodigo: '90000002', itemDestinoCodigo: '90000003', fatorAtual: 1, fatorDestino: 2 },
          ],
        },
      ],
    });
    expect(enviados[1]).toMatchObject({ rota: 'execucao', dataReferencia: 'competencia' });

    // O resultado com as parcelas: atual, simulado, diferença e variação; por convênio, por grupo e sem preço.
    await expect(page.getByTestId('sr-total-atual')).toContainText('390,00');
    await expect(page.getByTestId('sr-total-simulado')).toContainText('601,00');
    await expect(page.getByTestId('sr-total-diferenca')).toContainText('211,00');
    await expect(page.getByTestId('sr-total-percentual')).toContainText('54,1%');
    await expect(page.getByTestId('sr-por-convenio')).toContainText('CONVENIO SINTETICO A');
    await expect(page.getByTestId('sr-por-grupo')).toContainText('GRUPO SINTETICO');
    await expect(page.getByTestId('sr-por-tipo')).toContainText('Internação');
    await expect(page.getByTestId('sr-procedimentos')).toContainText('90000001');
    await expect(page.getByTestId('sr-inconsistencias')).toContainText('90000004');
    await expect(page.getByTestId('sr-inconsistencias')).toContainText('Sem preço na tabela simulada');
    await semViolacaoAxe(page, 'simulação de receita');

    // O cenário fica na lista; simular de novo pede outra execução (a anterior fica no histórico).
    // Simular de novo usa o recorte salvo no cenário, mesmo com o formulário de cenário novo em outro recorte.
    await expect(page.getByTestId('sr-cenario-21')).toContainText('CENARIO SINTETICO');
    await expect(page.getByTestId('sr-cenario-21')).toContainText('01/2026 — 01/2026');
    await escolher(page.getByTestId('sr-recorte'), { rotulo: 'data do atendimento' });
    await expect(page.getByTestId('sr-competencias')).toBeHidden();
    await page.getByTestId('sr-refazer-21').click();
    await expect.poll(() => enviados.filter((x) => x['rota'] === 'execucao').length).toBe(2);
    expect(enviados.filter((x) => x['rota'] === 'execucao')[1]).toMatchObject({
      dataReferencia: 'competencia',
    });
  });
});
