// E2E @M51.3 (ficha do M51, seção 10, na parte da etapa 3): a APAC nasce DESLIGADA por estabelecimento (DP-35: a tela diz
// o pré-requisito e a API recusa o registro); o administrador registra o pré-requisito, a UF do gestor e o cabeçalho e
// liga a chave só para o faturista da APAC (escopo pessoa); o faturista abre a competência APAC e roda a crítica (a
// hemodiálise sem autorização é aviso), registra o laudo (atendimento SUS conferido, procedimento, CID, solicitante e o
// laudo de nefrologia) e a autorização (APAC única com o número e o verificador), roda a crítica de novo (0 bloqueante,
// 0 aviso), gera o APAC-Mag, baixa o arquivo conferindo o hash e o cabeçalho, vê os procedimentos sem dado pessoal e
// encerra a APAC; o aviso do leiaute não conferido aparece. A chave é recolhida no fim. axe sem violação séria em cada
// estado; nenhuma requisição externa. Sessão real sobre a fonte sintética e a porta em MEMÓRIA (massa sintética).
import { createHash } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FATURISTA = 'SINT.FATURISTA.APAC';
const REGISTRO = '710025';

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
  'idempotency-key': `e2e-m51-3-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});

async function prerequisito(page: Page): Promise<void> {
  const r = await page.request.put('/api/administracao/liberacao/prerequisitos', {
    headers: await cabecalhos(page, 'pre'),
    data: {
      recurso: 'faturamento.susApac',
      tipo: 'contrato',
      situacao: 'cumprido',
      validade: '2099-12-31',
      evidencia: 'contrato SUS sintético do E2E',
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
      justificativa: 'Cabeçalho sintético da APAC no E2E da etapa 3',
      senha: SENHA,
    },
  });
  expect([200, 201, 409], await r.text()).toContain(r.status());
}

async function chave(page: Page, ligar: boolean): Promise<void> {
  const r = await page.request.post('/api/administracao/liberacao', {
    headers: await cabecalhos(page, `chave-${ligar}`),
    data: {
      chave: 'faturamento.susApac',
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: [FATURISTA],
      ligar,
      justificativa: 'APAC sintética do E2E da etapa 3 do faturamento SUS',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

/** Uma competência passada diferente a cada rodada (a porta em memória guarda as competências do servidor no ar). */
function competenciaDaRodada(): string {
  const n = (Math.floor(Date.now() / 1000) + 97) % 120;
  const ano = 2014 + Math.floor(n / 12);
  return `${ano}${String((n % 12) + 1).padStart(2, '0')}`;
}

/** Número de APAC sintético da rodada (12 dígitos + o verificador: o resto por 11; 10 vira 0). */
function numeroApac(): string {
  const base = `33${String(Date.now() % 10_000_000_000).padStart(10, '0')}`;
  const r = Number(BigInt(base) % 11n);
  return `${base}${r === 10 ? 0 : r}`;
}

/** CNS provisório sintético (começa em 7; soma ponderada múltipla de 11): gerado, nunca de pessoa. */
function cnsSintetico(semente: number): string {
  for (let k = 0; k < 1000; k++) {
    const corpo = `7${String(semente * 1000 + k).padStart(14, '0')}`;
    let t = 0;
    for (let i = 0; i < 15; i++) t += Number(corpo[i]) * (15 - i);
    if (t % 11 === 0) return corpo;
  }
  throw new Error('sem CNS sintético');
}

test.describe('@M51.3 Faturamento SUS: APAC', () => {
  test.describe.configure({ timeout: 300_000 });

  test('desligada → ligada → crítica → laudo e autorização → APAC-Mag com hash → encerramento; recolher', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const competencia = competenciaDaRodada();
    const [ano, mes] = [competencia.slice(0, 4), competencia.slice(4, 6)];
    const numero = numeroApac();

    // Desligada (DP-35): a tela diz o pré-requisito e a API recusa o laudo.
    await entrar(page, FATURISTA);
    await (await itemDoMenu(page, 'APAC')).click();
    await expect(page).toHaveURL(/\/faturamento\/sus\/apac$/);
    await expect(page.getByTestId('apac-desligada')).toContainText('contrato ou habilitação SUS');
    await semViolacaoAxe(page, 'APAC desligada');
    const recusa = await page.request.post('/api/sus/apac', {
      headers: { ...(await cabecalhos(page, 'laudo')), 'content-type': 'application/json' },
      data: { acao: 'continuar', apac: 1, versao: '0000000001' },
    });
    expect(recusa.status()).toBe(403);

    // O administrador registra o pré-requisito (contrato SUS), a UF e o cabeçalho e liga a APAC só para o faturista.
    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page);
    await parametro(page, 'faturamento.sus.apac.uf', '33');
    await parametro(page, 'faturamento.sus.bpa.orgaoOrigem', 'HOSPITAL SINTETICO');
    await parametro(page, 'faturamento.sus.bpa.cnpjPrestador', '11222333000181');
    await chave(page, true);

    try {
      // A competência APAC e a crítica: a hemodiálise sintética sem autorização é aviso.
      await entrar(page, FATURISTA);
      await page.goto('/faturamento/sus/competencias?instrumento=apac');
      await page.getByLabel('Nova competência').fill(competencia);
      await page.getByTestId('botao-abrir-competencia-sus').click();
      await expect(page.getByTestId('mensagem-sus')).toContainText(`Competência ${competencia} aberta`);
      const linha = page.getByTestId(`competencia-sus-${competencia}`);
      await linha.getByTestId(`criticar-${competencia}`).click();
      await expect(page.getByTestId('mensagem-sus')).toContainText('0 críticas bloqueantes');
      const criticas = page.getByTestId('criticas-sus');
      await expect(criticas.getByTestId('critica-sus-apac-sem-autorizacao').first()).toContainText(
        'sem autorização vigente',
      );
      await expect(page.getByTestId('tela-competencias-sus')).not.toContainText('PACIENTE SINTETICO');
      await semViolacaoAxe(page, 'Críticas da APAC');

      // O laudo pela tela da APAC.
      await page.getByRole('link', { name: 'Ir para a APAC' }).click();
      await expect(page).toHaveURL(/\/faturamento\/sus\/apac$/);
      await expect(page.getByTestId('apac-desligada')).toHaveCount(0);
      await page.getByTestId('botao-novo-laudo').click();
      const laudo = page.getByTestId('form-laudo-apac');
      await laudo.getByLabel('Número do atendimento ambulatorial').fill(REGISTRO);
      await laudo.getByTestId('botao-conferir-atendimento').click();
      await expect(laudo.getByTestId('apac-atendimento')).toContainText(`Atendimento ${REGISTRO}`);
      await laudo.getByLabel('Procedimento principal (código SIGTAP de 10 dígitos)').fill('0305010107');
      await laudo.getByLabel('CID principal').fill('N18.0');
      await laudo.getByLabel('Buscar o médico solicitante (CRM ou nome)').fill('APAC');
      await laudo.getByTestId('botao-buscar-solicitante').click();
      await escolher(laudo.getByTestId('apac-solicitante'), {
        rotulo: /MEDICO SOLICITANTE SINTETICO DA APAC/,
      });
      const dataLaudo = laudo.getByLabel('Data do laudo');
      await dataLaudo.fill(`01/${mes}/${ano}`);
      await dataLaudo.press('Tab');
      await laudo
        .getByLabel('Justificativa clínica do laudo')
        .fill('Doença renal crônica sintética em hemodiálise.');
      await escolher(laudo.getByTestId('apac-laudo-especifico'), 'nefrologia');
      await escolher(laudo.getByLabel('Característica do tratamento'), { indice: 1 });
      await escolher(laudo.getByLabel('Contraindicação para transplante'), { indice: 1 });
      await escolher(laudo.getByLabel('Situação na lista de transplante'), { indice: 1 });
      await escolher(laudo.getByLabel('Acesso vascular'), { indice: 1 });
      const inicio = laudo.getByLabel('Início do tratamento');
      await inicio.fill('10/01/2014');
      await inicio.press('Tab');
      await semViolacaoAxe(page, 'Laudo da APAC');
      await laudo.getByTestId('botao-registrar-laudo').click();
      await expect(page.getByTestId('mensagem-apac')).toContainText('Laudo registrado');

      // O detalhe do laudo registrado e a correção do transcrito (D-CORRIGIR-513).
      const detalhe = page.getByTestId('apac-detalhe');
      await expect(detalhe.getByTestId('apac-detalhe-justificativa')).toContainText(
        'Doença renal crônica sintética em hemodiálise.',
      );
      await expect(detalhe.getByTestId('apac-detalhe-cids')).toContainText('N180');
      await expect(detalhe.getByTestId('apac-detalhe-nefrologia')).toContainText(' — ');
      await expect(detalhe).toContainText('MEDICO SOLICITANTE SINTETICO DA APAC');
      await semViolacaoAxe(page, 'Detalhe da APAC');
      await detalhe.getByTestId('botao-corrigir-detalhe').click();
      const correcao = page.getByTestId('form-laudo-apac');
      await expect(correcao.getByTestId('apac-correcao-fixos')).toContainText('0305010107');
      await correcao.getByLabel('CID secundário (opcional)').fill('I10');
      await correcao
        .getByLabel('Justificativa clínica do laudo')
        .fill('Doença renal crônica sintética em hemodiálise (laudo corrigido).');
      await correcao.getByTestId('botao-registrar-laudo').click();
      await expect(page.getByTestId('mensagem-apac')).toContainText('Laudo corrigido');
      await expect(detalhe.getByTestId('apac-detalhe-justificativa')).toContainText('(laudo corrigido)');
      await expect(detalhe.getByTestId('apac-detalhe-cids')).toContainText('I10');
      await expect(detalhe.getByTestId('apac-detalhe-alterada')).toContainText(FATURISTA);
      await page.getByTestId('botao-fechar-detalhe').click();

      // A autorização (APAC única na competência).
      await escolher(page.getByTestId('apac-situacao'), 'solicitada');
      await page.getByTestId('botao-filtrar-apac').click();
      const tabela = page.getByTestId('tabela-apac');
      await expect(tabela).toContainText('0305010107');
      await tabela.locator('[data-testid^="botao-autorizar-"]').first().click();
      const acao = page.getByTestId('form-acao-apac');
      await acao.getByLabel('Número da APAC (13 dígitos, com o verificador)').fill(numero);
      await escolher(acao.getByLabel('Tipo da APAC'), 'unica');
      await acao.getByLabel('CNS do autorizador do gestor').fill(cnsSintetico(981));
      const dataAut = acao.getByLabel('Data da autorização');
      await dataAut.fill(`02/${mes}/${ano}`);
      await dataAut.press('Tab');
      await acao.getByLabel('Competência inicial da validade (AAAAMM)').fill(competencia);
      await acao.getByLabel('Competência final da validade (AAAAMM)').fill(competencia);
      await acao.getByTestId('botao-confirmar-acao-apac').click();
      await expect(page.getByTestId('mensagem-apac')).toContainText('APAC atualizada');
      await escolher(page.getByTestId('apac-situacao'), 'autorizada');
      await page.getByLabel('Número da APAC (começo)').fill(numero);
      await page.getByTestId('botao-filtrar-apac').click();
      await expect(page.getByTestId('tabela-apac')).toContainText(numero);
      await expect(page.getByTestId('tabela-apac')).toContainText('Única');

      // A crítica de novo: 0 bloqueante e 0 aviso.
      await page.goto(`/faturamento/sus/competencias?instrumento=apac&competencia=${competencia}`);
      await page.getByTestId(`competencia-sus-${competencia}`).getByTestId(`criticar-${competencia}`).click();
      await expect(page.getByTestId('mensagem-sus')).toContainText('0 críticas bloqueantes, 0 avisos');

      // O APAC-Mag: gerar, o hash, o download conferido e os procedimentos sem dado pessoal.
      await page.goto('/faturamento/sus/apac');
      await escolher(page.getByTestId('apac-competencia-escolha'), competencia);
      await expect(page.getByTestId('apac-resumo')).toContainText('Pronta para gerar');
      await page.getByTestId('botao-gerar-apac').click();
      await expect(page.getByTestId('mensagem-apac')).toContainText('Arquivo APAC gerado');
      const arquivos = page.getByTestId('tabela-arquivos-apac');
      await expect(arquivos).toContainText('Leiaute APAC-MAG 03.20');
      await expect(page.getByText('O leiaute da APAC ainda não foi conferido')).toBeVisible();
      const hash = ((await arquivos.getByTestId('hash-arquivo-apac').first().textContent()) ?? '').trim();
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      const href =
        (await arquivos
          .getByRole('link', { name: /^AP\d{7}/ })
          .first()
          .getAttribute('href')) ?? '';
      expect(href).toMatch(/^\/api\/sus\/apac\/arquivos\/\d+\/conteudo$/);
      const arquivo = await page.request.get(href);
      expect(arquivo.status()).toBe(200);
      expect(arquivo.headers()['x-sgh-sha256']).toBe(hash);
      const corpo = await arquivo.body();
      expect(createHash('sha256').update(corpo).digest('hex')).toBe(hash);
      const linhas = corpo.toString('ascii').split('\r\n').filter(Boolean);
      expect(linhas[0]).toMatch(new RegExp(`^01#APAC${competencia}`));
      expect(linhas[0]).toHaveLength(124);
      expect(linhas.map((l) => l.slice(0, 2))).toEqual(['01', '14', '06', '13', '13']);
      expect(linhas[1]).toContain(numero);
      // O arquivo da APAC não sai pela rota da CIHA (cada rota tem a permissão do instrumento).
      const id = /arquivos\/(\d+)\//.exec(href)?.[1];
      expect((await page.request.get(`/api/sus/arquivos/${id}/conteudo`)).status()).not.toBe(200);
      await semViolacaoAxe(page, 'APAC com arquivo');
      await arquivos.getByRole('button', { name: 'Ver os procedimentos' }).first().click();
      const secao = page.getByTestId('apac-linhas');
      await expect(secao.getByTestId('apac-resumo-linhas')).toContainText('1 APAC(s), 2 linha(s)');
      await expect(secao.getByTestId('tabela-linhas-apac')).toContainText('0305010107');
      await expect(secao.getByTestId('tabela-linhas-apac')).toContainText('Única');
      await expect(page.getByTestId('tela-apac')).not.toContainText('PACIENTE SINTETICO');
      await semViolacaoAxe(page, 'Procedimentos da APAC');

      // O encerramento (motivo de saída do SIA).
      await page.getByLabel('Número da APAC (começo)').fill(numero);
      await page.getByTestId('botao-filtrar-apac').click();
      await page.getByTestId('tabela-apac').locator('[data-testid^="botao-encerrar-"]').first().click();
      const enc = page.getByTestId('form-acao-apac');
      await escolher(enc.getByLabel('Motivo de saída'), '12');
      const dataEnc = enc.getByLabel('Data do encerramento');
      await dataEnc.fill(`20/${mes}/${ano}`);
      await dataEnc.press('Tab');
      await enc.getByTestId('botao-confirmar-acao-apac').click();
      await expect(page.getByTestId('mensagem-apac')).toContainText('APAC atualizada');
      await escolher(page.getByTestId('apac-situacao'), 'encerrada');
      await page.getByTestId('botao-filtrar-apac').click();
      await expect(page.getByTestId('tabela-apac')).toContainText(numero);
      await semViolacaoAxe(page, 'APAC encerrada');
    } finally {
      // Recolher: a APAC volta a desligada para todos.
      await entrar(page, 'SINT.ADMIN');
      await chave(page, false);
    }
    await entrar(page, FATURISTA);
    await page.goto('/faturamento/sus/apac');
    await expect(page.getByTestId('apac-desligada')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
