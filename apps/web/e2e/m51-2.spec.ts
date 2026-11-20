// E2E @M51.2 (ficha do M51, seção 10, na parte da etapa 2): o BPA nasce DESLIGADO por estabelecimento (DP-35: a tela diz
// o pré-requisito e a API recusa abrir a competência); o administrador registra o pré-requisito e liga a chave só para o
// faturista do BPA (escopo pessoa); o faturista abre a competência BPA, roda a crítica (o validador de compatibilidade e
// a ficha sem equivalente SIGTAP), registra o equivalente, roda de novo (0 bloqueante), gera o BPA (BPA-C e BPA-I), baixa
// o arquivo conferindo o hash e o cabeçalho do BPA-Mag, vê as linhas sem dado pessoal, com o filtro por tipo; o aviso do
// leiaute não conferido aparece. Os médicos solicitantes SUS: o CRUD genérico do FAMEDSOL (o CPF com dígito errado é
// recusado; o válido entra) e a consulta ao cadastro geral. A chave é recolhida no fim. axe sem violação séria em cada
// estado; nenhuma requisição externa. Sessão real sobre a fonte sintética e a porta em MEMÓRIA (massa sintética).
import { createHash } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FATURISTA = 'SINT.FATURISTA.BPA';

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
  'idempotency-key': `e2e-m51-2-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});

async function prerequisito(page: Page, recurso = 'faturamento.susBpa'): Promise<void> {
  const r = await page.request.put('/api/administracao/liberacao/prerequisitos', {
    headers: await cabecalhos(page, 'pre'),
    data: {
      recurso,
      tipo: 'contrato',
      situacao: 'cumprido',
      validade: '2099-12-31',
      evidencia: 'contrato SUS sintético do E2E',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

/** O cabeçalho do BPA-Mag (Parâmetros do estabelecimento): o órgão de origem e o CNPJ do prestador, sintéticos. */
async function parametro(page: Page, chave: string, valor: string): Promise<void> {
  const r = await page.request.put(`/api/administracao/parametros/${chave}`, {
    headers: await cabecalhos(page, `par-${chave}`),
    data: {
      nivel: 'estabelecimento',
      alvo: 'pc',
      valor,
      justificativa: 'Cabeçalho sintético do BPA no E2E da etapa 2',
      senha: SENHA,
    },
  });
  expect([200, 201, 409], await r.text()).toContain(r.status());
}

async function chave(page: Page, ligar: boolean, recurso = 'faturamento.susBpa'): Promise<void> {
  const r = await page.request.post('/api/administracao/liberacao', {
    headers: await cabecalhos(page, `chave-${recurso}-${ligar}`),
    data: {
      chave: recurso,
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: [FATURISTA],
      ligar,
      justificativa: 'BPA sintético do E2E da etapa 2 do faturamento SUS',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

/** CPF sintético válido pelo dígito (base 999 + 6 dígitos da rodada; gerado pelo algoritmo, nunca de pessoa). */
function cpfSintetico(): string {
  const base = `999${String(Date.now() % 1_000_000).padStart(6, '0')}`;
  const dv = (b: string) => {
    let t = 0;
    for (let i = 0; i < b.length; i++) t += Number(b[i]) * (b.length + 1 - i);
    const r = (t * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  return `${base}${d1}${dv(`${base}${d1}`)}`;
}

/** Uma competência passada diferente a cada rodada (a porta em memória guarda as competências do servidor no ar). */
function competenciaDaRodada(): string {
  const n = Math.floor(Date.now() / 1000) % 180;
  const ano = 2011 + Math.floor(n / 12);
  return `${ano}${String((n % 12) + 1).padStart(2, '0')}`;
}

test.describe('@M51.2 Faturamento SUS: BPA, validador de compatibilidade e solicitantes', () => {
  test.describe.configure({ timeout: 300_000 });

  test('desligado → ligado → crítica → equivalente → BPA com hash e linhas; recolher', async ({ page }) => {
    const externas = vigiarExternas(page);
    const competencia = competenciaDaRodada();

    // Desligado (DP-35): a tela diz o pré-requisito e a API recusa abrir a competência.
    await entrar(page, FATURISTA);
    await (await itemDoMenu(page, 'BPA')).click();
    await expect(page).toHaveURL(/\/faturamento\/sus\/bpa$/);
    await expect(page.getByTestId('bpa-desligado')).toContainText('contrato ou habilitação SUS');
    await semViolacaoAxe(page, 'BPA desligado');
    const recusa = await page.request.post('/api/sus/competencias', {
      headers: { ...(await cabecalhos(page, 'abrir')), 'content-type': 'application/json' },
      data: { instrumento: 'bpa', competencia },
    });
    expect(recusa.status()).toBe(403);

    // O administrador registra o pré-requisito (contrato SUS) e liga o BPA só para o faturista.
    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page);
    await parametro(page, 'faturamento.sus.bpa.orgaoOrigem', 'HOSPITAL SINTETICO');
    await parametro(page, 'faturamento.sus.bpa.cnpjPrestador', '11222333000181');
    await chave(page, true);
    // Com a APAC desligada, o procedimento só de APAC da massa (a hemodiálise sintética) fica no BPA como
    // `instrumento-incompativel` (D-BPA-APAC-513); com a APAC ligada para o faturista, sai do BPA (D-E2E-BPA-51.4).
    await prerequisito(page, 'faturamento.susApac');
    await chave(page, true, 'faturamento.susApac');

    try {
      await entrar(page, FATURISTA);
      await page.goto('/faturamento/sus/competencias?instrumento=bpa');
      await expect(page.getByTestId('instrumento-sus-desligado')).toHaveCount(0);
      await page.getByLabel('Nova competência').fill(competencia);
      await page.getByTestId('botao-abrir-competencia-sus').click();
      await expect(page.getByTestId('mensagem-sus')).toContainText(`Competência ${competencia} aberta`);
      const linha = page.getByTestId(`competencia-sus-${competencia}`);
      await linha.getByTestId(`criticar-${competencia}`).click();
      await expect(page.getByTestId('mensagem-sus')).toContainText('críticas bloqueantes');
      const criticas = page.getByTestId('criticas-sus');
      await expect(criticas.locator('[data-testid^="critica-sus-"]').first()).toBeVisible();
      const semSigtap = criticas.getByTestId('critica-sus-sem-sigtap');
      // Primeira rodada no servidor: a ficha do MAPA sem equivalente; nas seguintes, a equivalência já está lá.
      if ((await semSigtap.count()) > 0) {
        await expect(semSigtap).toContainText('MAPA SINTETICO DE 24 HORAS');
        await expect(page.getByTestId('tela-competencias-sus')).not.toContainText('PACIENTE SINTETICO');
        await semViolacaoAxe(page, 'Críticas do BPA');
        await semSigtap.getByRole('button', { name: 'Registrar o equivalente SIGTAP' }).click();
        const form = page.getByTestId('form-equivalencia-sus');
        await form.getByLabel('Buscar na tabela SIGTAP (código ou nome)').fill('exame');
        await form.getByTestId('botao-buscar-sigtap').click();
        await expect(form.getByTestId('equivalencia-sigtap-nome')).toContainText(
          '0202010295 PROCEDIMENTO SINTETICO DE EXAME',
        );
        await form.getByTestId('botao-gravar-equivalencia').click();
        await expect(page.getByTestId('mensagem-sus')).toContainText('Equivalência registrada');
        await linha.getByTestId(`criticar-${competencia}`).click();
      }
      await expect(page.getByTestId('mensagem-sus')).toContainText('0 críticas bloqueantes');

      // A tela do BPA: gerar, o hash, o download conferido e as linhas sem dado pessoal.
      await page.getByRole('link', { name: 'Ir para o BPA' }).click();
      await expect(page).toHaveURL(/\/faturamento\/sus\/bpa$/);
      await expect(page.getByTestId('bpa-desligado')).toHaveCount(0);
      await escolher(page.getByTestId('bpa-competencia'), competencia);
      await expect(page.getByTestId('bpa-resumo')).toContainText('Pronto para gerar');
      await page.getByTestId('botao-gerar-bpa').click();
      await expect(page.getByTestId('mensagem-bpa')).toContainText('BPA gerado');
      const tabela = page.getByTestId('tabela-arquivos-bpa');
      await expect(tabela).toContainText('Leiaute BPA-MAG 04.10');
      await expect(page.getByText('O leiaute do BPA ainda não foi conferido')).toBeVisible();
      const hash = ((await tabela.getByTestId('hash-arquivo-bpa').first().textContent()) ?? '').trim();
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      const href =
        (await tabela
          .getByRole('link', { name: /^PA\d{7}/ })
          .first()
          .getAttribute('href')) ?? '';
      expect(href).toMatch(/^\/api\/sus\/bpa\/arquivos\/\d+\/conteudo$/);
      const arquivo = await page.request.get(href);
      expect(arquivo.status()).toBe(200);
      expect(arquivo.headers()['x-sgh-sha256']).toBe(hash);
      const corpo = await arquivo.body();
      expect(createHash('sha256').update(corpo).digest('hex')).toBe(hash);
      const linhas = corpo.toString('ascii').split('\r\n').filter(Boolean);
      expect(linhas[0]).toMatch(new RegExp(`^01#BPA#${competencia}`));
      expect(linhas[0]).toHaveLength(130);
      expect(linhas.slice(1).every((l) => l.startsWith('02') || l.startsWith('03'))).toBe(true);
      // O arquivo do BPA não sai pela rota da CIHA (cada rota tem a permissão do instrumento).
      const id = /arquivos\/(\d+)\//.exec(href)?.[1];
      expect((await page.request.get(`/api/sus/arquivos/${id}/conteudo`)).status()).not.toBe(200);
      await semViolacaoAxe(page, 'BPA com arquivo');

      await tabela.getByRole('button', { name: 'Ver as linhas' }).first().click();
      const secao = page.getByTestId('bpa-linhas');
      await expect(secao.getByTestId('tabela-linhas-bpa')).toContainText('Consolidado (BPA-C)');
      await expect(secao.getByTestId('tabela-linhas-bpa')).toContainText('Individualizado (BPA-I)');
      await expect(secao.getByTestId('bpa-resumo-tipos')).toContainText('Individualizado: 1 linhas');
      await escolher(secao.getByTestId('bpa-tipo'), 'i');
      await secao.getByTestId('botao-filtrar-bpa').click();
      await expect(secao.getByTestId('tabela-linhas-bpa').locator('tbody tr')).toHaveCount(1);
      await expect(page.getByTestId('tela-bpa')).not.toContainText('PACIENTE SINTETICO');
      await semViolacaoAxe(page, 'Linhas do BPA');
    } finally {
      // Recolher: o BPA volta a desligado para todos.
      await entrar(page, 'SINT.ADMIN');
      await chave(page, false);
      await chave(page, false, 'faturamento.susApac');
    }
    await entrar(page, FATURISTA);
    await page.goto('/faturamento/sus/bpa');
    await expect(page.getByTestId('bpa-desligado')).toBeVisible();
    expect(externas).toEqual([]);
  });

  test('médicos solicitantes SUS: CRUD do cadastro (CPF conferido pelo dígito) e o cadastro geral', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, FATURISTA);
    await (await itemDoMenu(page, 'Médicos solicitantes SUS')).click();
    await expect(page).toHaveURL(/\/faturamento\/sus\/solicitantes$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Médicos solicitantes SUS' })).toBeVisible();
    await semViolacaoAxe(page, 'Médicos solicitantes SUS');

    // O cadastro geral de solicitantes (busca no servidor).
    const geral = page.getByTestId('solicitantes-geral');
    await geral.getByLabel('Número do conselho ou nome').fill('52000');
    await geral.getByTestId('botao-buscar-solicitantes').click();
    await expect(geral.getByTestId('tabela-solicitantes-geral')).toContainText(
      'MEDICO SOLICITANTE SINTETICO A',
    );
    await expect(geral.getByTestId('tabela-solicitantes-geral').locator('tbody tr')).toHaveCount(2);

    // O CRUD genérico do FAMEDSOL: o CPF com dígito errado é recusado; o sintético válido entra.
    await page.getByTestId('dominio-faturamento.susSolicitante').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Médicos solicitantes SUS' })).toBeVisible();
    const cpf = cpfSintetico();
    const errado = `${cpf.slice(0, 10)}${(Number(cpf[10]) + 1) % 10}`;
    const nome = `MEDICO SOLICITANTE SINTETICO E2E ${cpf.slice(3, 9)}`;
    await page.getByTestId('botao-incluir').click();
    const form = page.getByTestId('form-dominio');
    await form.getByLabel('CPF').fill(errado);
    await form.getByLabel('Nome').fill(nome);
    await form.getByTestId('botao-salvar').click();
    await expect(form.getByRole('alert')).toBeVisible();
    await form.getByLabel('CPF').fill(cpf);
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Incluído com o código');
    await expect(page.getByTestId('tabela-dominio')).toContainText(nome);
    await semViolacaoAxe(page, 'Médico solicitante incluído');
    expect(externas).toEqual([]);
  });
});
