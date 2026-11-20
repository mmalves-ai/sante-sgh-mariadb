// E2E @M51.4 (ficha do M51, seção 10, na parte da etapa 4): a AIH nasce DESLIGADA por estabelecimento (DP-35: a tela diz
// o pré-requisito e a API recusa a faixa); o administrador registra o pré-requisito, os parâmetros do SISAIH01 (CNES,
// diretor clínico, tipo de UTI do SIH por acomodação) e liga a chave só para o faturista da AIH (escopo pessoa). O
// faturista vê os leitos de UTI habilitados e os domínios do SIH; registra a faixa liberada pelo gestor; registra o laudo
// pela internação SUS sintética; autoriza com o próximo número da faixa; abre a competência AIH e roda a crítica (0
// bloqueante); fecha a AIH com o OPM conferido (nota e lote sugerido pela saída de estoque) e vê o espelho com as diárias
// de UTI pela trajetória; gera o SISAIH01 conferindo o hash e o cabeçalho; importa o retorno do gestor (AIH rejeitada:
// glosa) e decide reapresentar. A chave é recolhida no fim. axe sem violação séria em cada estado; nenhuma requisição
// externa; nenhum nome de paciente na tela. Sessão real sobre a fonte sintética e a porta em MEMÓRIA (massa sintética).
import { createHash } from 'node:crypto';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FATURISTA = 'SINT.FATURISTA.AIH';
const CNES = '9999991';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const cabecalhos = async (page: Page, k: string) => ({
  'x-csrf': (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '',
  'idempotency-key': `e2e-m51-4-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});

async function prerequisito(page: Page): Promise<void> {
  const r = await page.request.put('/api/administracao/liberacao/prerequisitos', {
    headers: await cabecalhos(page, 'pre'),
    data: {
      recurso: 'faturamento.susAih',
      tipo: 'contrato',
      situacao: 'cumprido',
      validade: '2099-12-31',
      evidencia: 'contrato SUS sintético do E2E da AIH',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

async function parametro(page: Page, chave: string, valor: string): Promise<void> {
  const r = await page.request.put(`/api/administracao/parametros/${chave}`, {
    headers: await cabecalhos(page, `par-${chave}`),
    data: {
      nivel: 'estabelecimento',
      alvo: 'pc',
      valor,
      justificativa: 'Parâmetro sintético do SISAIH01 no E2E da etapa 4',
      senha: SENHA,
    },
  });
  expect([200, 201, 409], await r.text()).toContain(r.status());
}

async function chave(page: Page, ligar: boolean): Promise<void> {
  const r = await page.request.post('/api/administracao/liberacao', {
    headers: await cabecalhos(page, `chave-${ligar}`),
    data: {
      chave: 'faturamento.susAih',
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: [FATURISTA],
      ligar,
      justificativa: 'AIH sintética do E2E da etapa 4 do faturamento SUS',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

/** CNS sintético definitivo (começa por 7; soma ponderada múltipla de 11), gerado pelo algoritmo, nunca de pessoa. */
function cnsSintetico(semente: number): string {
  for (let k = 0; k < 1000; k++) {
    const corpo = `7${String(semente * 1000 + k).padStart(14, '0')}`;
    let t = 0;
    for (let i = 0; i < 15; i++) t += Number(corpo[i]) * (15 - i);
    if (t % 11 === 0) return corpo;
  }
  throw new Error('sem CNS sintético');
}

/** Número da AIH (13 dígitos): a base de 12 e o dígito pelo módulo 11. */
function numeroAih(base12: string): string {
  const r = Number(BigInt(base12) % 11n);
  return `${base12}${r === 10 ? '0' : String(r)}`;
}

const hoje = new Date();
const COMPETENCIA = `${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, '0')}`;
const dia = (d: number) => `${String(d).padStart(2, '0')}/${COMPETENCIA.slice(4)}/${COMPETENCIA.slice(0, 4)}`;

const entradaDe = (l: Locator) => l.locator('input, textarea').first();
async function digitar(l: Locator, valor: string): Promise<void> {
  await entradaDe(l).fill(valor);
}
async function digitarData(l: Locator, valor: string): Promise<void> {
  const e = l.locator('input');
  await e.fill(valor);
  await e.blur(); // confirma a data sem enviar o formulário (o Enter enviaria)
}

test.describe('@M51.4 Faturamento SUS: AIH, leitos de UTI, espelho, retorno e glosa', () => {
  test.describe.configure({ timeout: 300_000 });

  test('desligada → ligada → faixa → laudo → autorização → crítica → fechamento → SISAIH01 → retorno; recolher', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // Faixa diferente a cada rodada (a porta em memória guarda as faixas do servidor no ar).
    const base = `3326${String(Date.now() % 100_000_000).padStart(8, '0')}`;
    const inicial = numeroAih(base);
    const final = numeroAih((BigInt(base) + 4n).toString().padStart(12, '0'));

    // Desligada (DP-35): a tela diz o pré-requisito e a API recusa registrar a faixa.
    await entrar(page, FATURISTA);
    await (await itemDoMenu(page, 'AIH')).click();
    await expect(page).toHaveURL(/\/faturamento\/sus\/aih$/);
    await expect(page.getByTestId('aih-desligado')).toContainText('contrato com o gestor e habilitação SUS');
    await semViolacaoAxe(page, 'AIH desligada');
    const recusa = await page.request.post('/api/sus/aih/faixas', {
      headers: { ...(await cabecalhos(page, 'faixa-desligada')), 'content-type': 'application/json' },
      data: { acao: 'registrar', inicial, final, orgaoEmissor: 'SMS SINT', dataLiberacao: '2026-01-01' },
    });
    expect(recusa.status()).toBe(403);

    // O administrador: pré-requisito, parâmetros do SISAIH01 e a chave só para o faturista.
    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page);
    await parametro(page, 'faturamento.sus.cnes', CNES);
    await parametro(page, 'faturamento.sus.aih.diretorClinicoCns', cnsSintetico(881));
    await parametro(page, 'faturamento.sus.aih.utiPorAcomodacao', '3:2:0802010083');
    await chave(page, true);

    try {
      await entrar(page, FATURISTA);
      // Os leitos de UTI habilitados e os domínios do SIH (tipos de UTI).
      await page.goto('/faturamento/sus/aih');
      await expect(page.getByTestId('aih-desligado')).toHaveCount(0);
      await expect(page.getByTestId('aih-leitos-resumo')).toContainText('10');
      await page.getByTestId('link-leitos-uti').click();
      await expect(page).toHaveURL(/\/faturamento\/sus\/cadastros\/leitos-uti$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Leitos de UTI habilitados' })).toBeVisible();
      await semViolacaoAxe(page, 'Leitos de UTI habilitados');
      await page.getByRole('link', { name: 'Tipos de UTI e domínios do SIH e do SIA' }).click();
      await expect(page).toHaveURL(/\/faturamento\/sus\/cadastros\/dominios$/);
      await semViolacaoAxe(page, 'Domínios do SIH e do SIA');

      // A faixa liberada pelo gestor.
      await page.goto('/faturamento/sus/aih');
      await digitar(page.getByTestId('faixa-inicial'), inicial);
      await digitar(page.getByTestId('faixa-final'), final);
      await digitar(page.getByTestId('faixa-orgao'), 'SMS SINTETICA');
      await digitarData(page.getByTestId('faixa-data'), dia(1));
      await page.getByTestId('botao-registrar-faixa').click();
      await expect(page.getByTestId('mensagem-aih')).toContainText(
        `Faixa de ${inicial} a ${final} registrada`,
      );
      await expect(page.getByTestId('tabela-faixas')).toContainText(inicial);

      // O laudo pela internação SUS sintética (7401: trajetória com acomodação de UTI e OPM na conta).
      await digitar(page.getByTestId('laudo-registro'), '7401');
      await page.getByTestId('botao-buscar-internacao').click();
      await expect(page.getByTestId('laudo-internacao')).toBeVisible();
      await expect(page.getByTestId('tela-aih')).not.toContainText('PACIENTE SINTETICO');
      await digitar(page.getByTestId('laudo-procedimento'), '0406010811');
      await digitar(page.getByTestId('laudo-solicitante'), '00000000191');
      await digitar(
        page.getByTestId('laudo-justificativa'),
        'DOR TORACICA SINTETICA COM SUPRA DE ST (MASSA DE TESTE)',
      );
      await semViolacaoAxe(page, 'Laudo da AIH');
      await page.getByTestId('botao-registrar-laudo').click();
      await expect(page.getByTestId('mensagem-aih')).toContainText('Laudo da internação 7401 registrado');

      // A autorização com o próximo número da faixa.
      const detalhe = page.getByTestId('aih-detalhe');
      await expect(detalhe.getByTestId('aih-situacao')).toContainText('Solicitada');
      await digitar(detalhe.getByTestId('autorizar-autorizador'), cnsSintetico(771));
      await digitarData(detalhe.getByTestId('autorizar-data'), dia(3));
      await detalhe.getByTestId('botao-autorizar').click();
      await expect(page.getByTestId('mensagem-aih')).toContainText(`AIH autorizada com o número ${inicial}`);
      await expect(detalhe.getByTestId('aih-numero')).toHaveText(inicial);

      // A competência AIH e a crítica (avisos: a outra internação sem AIH; a AIH ainda não fechada).
      await page.getByRole('link', { name: 'Competência e críticas da AIH' }).first().click();
      await expect(page).toHaveURL(/\/faturamento\/sus\/competencias/);
      const linha = page.getByTestId(`competencia-sus-${COMPETENCIA}`);
      if ((await linha.count()) === 0) {
        await page.getByLabel('Nova competência').fill(COMPETENCIA);
        await page.getByTestId('botao-abrir-competencia-sus').click();
        await expect(page.getByTestId('mensagem-sus')).toContainText(`Competência ${COMPETENCIA} aberta`);
      }
      await linha.getByTestId(`criticar-${COMPETENCIA}`).click();
      await expect(page.getByTestId('mensagem-sus')).toContainText('0 críticas bloqueantes');
      await semViolacaoAxe(page, 'Críticas da AIH');

      // O fechamento: o OPM pede a nota (o lote sugerido pela saída de estoque) e o espelho com as diárias de UTI.
      await page.getByRole('link', { name: 'Ir para a AIH' }).click();
      await expect(page).toHaveURL(/\/faturamento\/sus\/aih$/);
      const lista = page.getByTestId('tabela-aih');
      await lista.locator('tr', { hasText: inicial }).getByRole('button', { name: 'Abrir' }).click();
      await expect(detalhe.getByTestId('aih-situacao')).toContainText('Autorizada');
      await expect(detalhe.getByTestId('tabela-espelho')).toContainText('0802010083');
      await expect(detalhe.getByTestId('aih-diarias-uti')).toHaveText('3');
      await expect(detalhe.getByTestId('lotes-saida')).toContainText('LOTE-SINT-1');
      const opm = detalhe.locator('[data-testid^="fechar-opm-"]').first();
      await digitar(opm.locator('[data-testid^="opm-cnpj-"]'), '00000000000191');
      await digitar(opm.locator('[data-testid^="opm-nota-"]'), 'NF-SINT-1');
      await entradaDe(opm.locator('.sgh-campo', { hasText: 'Registro Anvisa' })).fill('10000000001');
      await digitar(opm.locator('[data-testid^="opm-lote-"]'), 'LOTE-SINT-1');
      await semViolacaoAxe(page, 'Fechamento da AIH');
      await detalhe.getByTestId('botao-fechar-aih').click();
      await expect(page.getByTestId('mensagem-aih')).toContainText('AIH fechada');
      await expect(detalhe.getByTestId('aih-situacao')).toContainText('Fechada');
      await expect(detalhe.getByTestId('espelho-total')).toBeVisible();

      // A crítica de novo (a AIH fechada entra) e o SISAIH01 com o hash e o cabeçalho.
      await page.goto(`/faturamento/sus/competencias?instrumento=aih&competencia=${COMPETENCIA}`);
      await page.getByTestId(`competencia-sus-${COMPETENCIA}`).getByTestId(`criticar-${COMPETENCIA}`).click();
      await expect(page.getByTestId('mensagem-sus')).toContainText('0 críticas bloqueantes');
      await page.getByRole('link', { name: 'Ir para a AIH' }).click();
      await escolher(page.getByTestId('aih-competencia'), COMPETENCIA);
      await expect(page.getByText('O leiaute do SISAIH01 ainda não foi conferido')).toBeVisible();
      await page.getByTestId('botao-gerar-sisaih').click();
      await expect(page.getByTestId('mensagem-aih')).toContainText('SISAIH01 gerado');
      const tabela = page.getByTestId('tabela-arquivos-aih');
      const hash = ((await tabela.getByTestId('hash-arquivo-aih').first().textContent()) ?? '').trim();
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      const href =
        (await tabela
          .getByRole('link', { name: /^AIH\d+/ })
          .first()
          .getAttribute('href')) ?? '';
      expect(href).toMatch(/^\/api\/sus\/aih\/arquivos\/\d+\/conteudo$/);
      const arquivo = await page.request.get(href);
      expect(arquivo.status()).toBe(200);
      const corpo = await arquivo.body();
      expect(createHash('sha256').update(corpo).digest('hex')).toBe(hash);
      const texto = corpo.toString('latin1');
      expect(texto.startsWith(`01#SIH#${COMPETENCIA}${CNES}`)).toBe(true);
      expect(texto).toContain(inicial);
      // O arquivo da AIH não sai pela rota da CIHA.
      const id = /arquivos\/(\d+)\//.exec(href)?.[1];
      expect((await page.request.get(`/api/sus/arquivos/${id}/conteudo`)).status()).not.toBe(200);
      await semViolacaoAxe(page, 'SISAIH01 gerado');

      // O retorno do gestor: a AIH rejeitada (glosa do apresentado); a decisão de reapresentar.
      await page.getByTestId('link-retorno').click();
      await expect(page).toHaveURL(/\/faturamento\/sus\/retorno$/);
      await expect(page.getByTestId('retorno-desligado')).toHaveCount(0);
      await digitar(page.getByTestId('retorno-competencia'), COMPETENCIA);
      await digitar(page.getByTestId('retorno-nome'), 'ESPELHO-SINTETICO.CSV');
      await digitar(
        page.getByTestId('retorno-conteudo'),
        [
          'instrumento;competencia;identificacao;procedimento;situacao;motivo;valor_apresentado;valor_aprovado',
          `aih;${COMPETENCIA};${inicial};0406010811;R;CNS do paciente;2500,00;`,
        ].join('\n'),
      );
      await page.getByTestId('botao-importar-retorno').click();
      await expect(page.getByTestId('retorno-resultado')).toContainText('1 casadas');
      const ret = page.getByTestId('tabela-retorno').locator('tr', { hasText: inicial });
      await expect(ret).toContainText('Rejeitada');
      await semViolacaoAxe(page, 'Retorno do gestor');
      await ret.locator('[data-testid^="botao-decidir-"]').click();
      await digitar(
        page.locator('[data-testid^="retorno-justificativa-"]').first(),
        'CNS corrigido no cadastro sintético; reapresentar',
      );
      await page.locator('[data-testid^="botao-reapresentar-"]').first().click();
      await expect(page.getByTestId('mensagem-retorno')).toContainText(
        `${inicial} vai ser reapresentada na competência seguinte`,
      );
      await expect(page.getByTestId('tela-retorno-sus')).not.toContainText('PACIENTE SINTETICO');
      // O retorno também pela tela do BPA (a ficha o põe sob a AIH e o BPA): o atalho abre o retorno no BPA.
      await page.goto('/faturamento/sus/bpa');
      await page.getByTestId('bpa-link-retorno').click();
      await expect(page).toHaveURL(/\/faturamento\/sus\/retorno\?instrumento=bpa$/);
      await expect(page.getByTestId('tela-retorno-sus')).toBeVisible();
    } finally {
      // Recolher: a AIH volta a desligada para todos.
      await entrar(page, 'SINT.ADMIN');
      await chave(page, false);
    }
    await entrar(page, FATURISTA);
    await page.goto('/faturamento/sus/aih');
    await expect(page.getByTestId('aih-desligado')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
