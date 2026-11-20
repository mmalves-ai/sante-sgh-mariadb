// E2E @M44.3 (ficha do M44, seção 10, etapa 3): a diretoria clínica publica a definição de dor torácica pela tela de
// protocolos; o paciente que chegou é classificado laranja pela dor precordial típica e o relógio de protocolos sugere a
// dor torácica; a enfermeira inclui com o critério conferido; o ECG feito no prazo fica cumprido; a troponina não feita
// pede o motivo (texto em CP1252) e fica perdida; o cartão do quadro do PA mostra o relógio; o encerramento leva o
// protocolo aos encerrados do dia e a adesão mostra o numerador e o denominador; o cartão do PA na página inicial. A
// regulação estadual: o NIR registra o número à mão, atualiza a situação, vê o histórico e a configuração recebida; o
// cartão do NIR na página inicial. axe sem violação séria em cada tela. Sessão real sobre a fonte sintética e as portas
// em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { PROTOCOLO_SINTETICO } from '@sgh/dominio-recepcao';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const CP1252 = 'Laboratório sem reagente — coleta às 11h (ação nº 2, atenção)';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function novaAba(browser: Browser, login: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: ORIGEM, timezoneId: 'America/Sao_Paulo' });
  const p = await ctx.newPage();
  await entrar(p, login);
  return p;
}

let sequencia = 0;
async function postar(page: Page, url: string, data: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  return (page.request as APIRequestContext).post(url, {
    headers: { 'x-csrf': csrf, 'idempotency-key': `e2e-m44e3-${Date.now()}-${++sequencia}` },
    data: data as object,
  });
}

async function abrirPa(page: Page, paciente: number): Promise<number> {
  const r = await postar(page, '/api/atendimento', {
    tipo: 'pa',
    paciente,
    convenio: 306,
    profissional: 7101,
    especialidade: 15,
    unidade: 3,
    centroCusto: 300400,
    procedimento: 10101039,
    carater: 'urgencia',
    cidPrincipal: 1,
    matricula: '900000000779',
  });
  expect(r.status(), await r.text()).toBe(201);
  return Number((await r.json()).resultado.reg);
}

test.describe('Protocolos gerenciados, regulação estadual e cartões da fila @M44 @M44.3 @fase5', () => {
  test.setTimeout(300_000);

  test('chegada → classificação laranja → relógio de dor torácica → metas → encerramento; quadro e cartão do PA; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    // A diretoria clínica: o protocolo de classificação (pré-condição, etapa 1) e a definição de dor torácica pela tela.
    const dir = await novaAba(browser, 'SINT.DIRETOR.CLINICO');
    const pc = await postar(dir, '/api/pa/protocolos', {
      autor: 'SINT.ENFERMEIRO.PA',
      conteudo: PROTOCOLO_SINTETICO,
      notas: 'Classificação sintética do E2E',
      senha: SENHA,
    });
    expect(pc.status(), await pc.text()).toBe(201);
    await dir.goto('/administracao/pa/protocolos#gerenciados');
    await expect(dir.getByTestId('definicoes-gerenciadas')).toBeVisible();
    // O atalho cai na seção das definições, não no topo da tela de protocolos.
    await expect(dir.locator('#gerenciados-titulo')).toBeInViewport();
    await escolher(dir.getByTestId('gerenciado-tipo'), 'dor-toracica');
    await dir.getByTestId('gerenciado-partir-vigente').click();
    await expect(dir.getByTestId('form-gerenciado')).toBeVisible();
    await dir
      .getByTestId('form-gerenciado')
      .getByLabel('Autor da versão (login de quem redigiu)')
      .fill('SINT.ENFERMEIRO.PA');
    await dir
      .getByTestId('form-gerenciado')
      .getByLabel('O que mudou nesta versão')
      .fill('Primeira versão sintética do E2E');
    await dir.getByTestId('gerenciado-senha').fill(SENHA);
    await semViolacaoAxe(dir, '/administracao/pa/protocolos (gerenciados)');
    await dir.getByTestId('gerenciado-publicar').click();
    await expect(dir.getByTestId('gerenciado-mensagem')).toContainText('publicada');
    await expect(dir.getByTestId('definicao-dor-toracica-1')).toContainText('vigente');
    await expect(dir.getByTestId('definicao-dor-toracica-1')).toContainText('ECG de 12 derivações');
    await dir.context().close();

    // A chegada e a classificação laranja pela dor precordial típica (discriminador marcado à mão).
    await entrar(page, 'SINT.ENFERMEIRO.PA');
    const recepcao = await novaAba(browser, 'SINT.ATENDIMENTO');
    const reg = await abrirPa(recepcao, 1004);
    await recepcao.context().close();
    await page.goto(`/pa/classificacao/${reg}`);
    await expect(page.getByTestId('tela-classificar')).toBeVisible();
    await escolher(page.getByTestId('classificar-fluxograma'), 'dor-toracica');
    await page.getByTestId('disc-dor-precordial').check();
    await expect(page.getByTestId('classificar-proposta')).toContainText('Laranja');
    await page.getByTestId('cl-queixa').fill('Dor no peito em aperto há uma hora');
    await page.getByTestId('classificar-concluir').click();
    await expect(page.getByTestId('classificar-mensagem')).toContainText('Classificado: Laranja');

    // O relógio sugere a dor torácica; a enfermeira inclui com o critério conferido.
    await page.goto('/pa/protocolos');
    await expect(page.getByTestId('tela-relogio-protocolos')).toBeVisible();
    const sugestao = page.getByTestId(`sugestao-${reg}-dor-toracica`);
    await expect(sugestao).toContainText('Dor precordial típica');
    await semViolacaoAxe(page, '/pa/protocolos');
    await sugestao.getByRole('button').click();
    await page.getByTestId('protocolos-criterios').getByText('Dor ou desconforto torácico').click();
    await page.getByTestId('protocolos-confirmar-inclusao').click();
    await expect(page.getByTestId('protocolos-mensagem')).toContainText('relógio começou');
    await expect(page.getByTestId(`sugestao-${reg}-dor-toracica`)).toHaveCount(0);
    const cartao = page.locator('[data-testid^="protocolo-"]').filter({ hasText: 'Dor torácica' }).first();
    await expect(cartao).toBeVisible();
    const id = Number((await cartao.getAttribute('data-testid'))!.replace('protocolo-', ''));

    // O ECG feito agora: cumprida. A troponina não feita: pede o motivo e fica perdida.
    await page.getByTestId(`registrar-${id}-ecg`).click();
    await expect(page.getByTestId(`form-meta-${id}`)).toBeVisible();
    await semViolacaoAxe(page, '/pa/protocolos (meta)');
    await page.getByTestId('salvar-meta').click();
    await expect(page.getByTestId(`meta-${id}-ecg`)).toContainText('Cumprida');
    await page.getByTestId(`registrar-${id}-troponina`).click();
    await page.getByTestId(`form-meta-${id}`).getByText('Não feita').click();
    await page.getByTestId('salvar-meta').click();
    await expect(page.getByTestId('recusa-classificacao')).toContainText('motivo');
    await page.getByTestId(`form-meta-${id}`).getByLabel('Motivo (obrigatório na meta perdida)').fill(CP1252);
    await page.getByTestId('salvar-meta').click();
    await expect(page.getByTestId(`meta-${id}-troponina`)).toContainText('Perdida');
    await expect(page.getByTestId(`meta-${id}-troponina`)).toContainText('Laboratório sem reagente');

    // O quadro do PA mostra o relógio do protocolo no cartão.
    const med = await novaAba(browser, 'SINT.MEDICO.PA');
    await med.goto('/pa/quadro');
    await expect(med.getByTestId(`protocolo-quadro-${reg}-dor-toracica`)).toContainText('Dor torácica');
    // O cartão do PA na página inicial (a fila de trabalho do perfil).
    await med.goto('/inicio');
    await expect(med.getByTestId('cartao-pa')).toBeVisible();
    await expect(med.getByTestId('topo-pa')).toContainText('Laranja');
    await expect(med.getByTestId('topo-pa')).toContainText('Dor torácica');
    await semViolacaoAxe(med, '/inicio (cartão do PA)');
    await med.context().close();

    // O encerramento: o desfecho com o motivo (há meta sem registro); vai aos encerrados; a adesão 1 de 1 no ECG.
    await page.getByTestId(`encerrar-${id}`).click();
    await escolher(page.getByTestId('encerrar-desfecho'), 'transferido');
    await page
      .getByLabel('Motivo (obrigatório no descarte e com meta sem registro)')
      .fill('Encaminhado à hemodinâmica');
    await page.getByTestId('confirmar-encerrar').click();
    await expect(page.getByTestId('protocolos-mensagem')).toContainText('relógio parou');
    await expect(page.getByTestId(`protocolo-${id}`)).toHaveCount(0);
    await expect(page.getByTestId('protocolos-encerrados')).toContainText(
      'Paciente transferido ou internado',
    );
    const adesao = page.getByTestId('adesao-dor-toracica-ecg');
    await expect(adesao).toContainText('ECG de 12 derivações');
    await expect(adesao.locator('td').nth(1)).toHaveText('1');
    await expect(adesao.locator('td').nth(2)).toHaveText('1');
    await expect(page.getByTestId('adesao-dor-toracica-troponina').locator('td').nth(1)).toHaveText('0');
    await semViolacaoAxe(page, '/pa/protocolos (encerrado)');
    expect(externas).toEqual([]);
  });

  test('regulação estadual: número à mão, situação, histórico, configuração; cartão do NIR; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    const med = await novaAba(browser, 'SINT.MEDICO.NIR');
    const s = await postar(med, '/api/nir/solicitacoes', {
      origem: 'eletiva',
      paciente: 1003,
      prioridade: 'urgente',
      perfil: { intensiva: false, precaucao: null, tiposAcomodacao: [] },
      clinica: 'M',
      justificativa: 'Indicação sintética: vaga regulada para o hospital de referência',
    });
    expect(s.status(), await s.text()).toBe(201);
    const sol = Number((await s.json()).id);
    await med.context().close();

    await entrar(page, 'SINT.INTERNACAO');
    // O cartão do NIR na página inicial.
    await expect(page.getByTestId('cartao-nir')).toBeVisible();
    await expect(page.getByTestId('resumo-nir')).toContainText('aberta');
    await expect(page.getByTestId('topo-nir')).toBeVisible();
    // As barreiras de alta abertas entram no cartão (o selo, a contagem e os primeiros itens).
    const altas = await (await page.request.get('/api/nir/altas-previstas')).json();
    const internado = altas.itens[0] as { internacao: number };
    const emTresDias = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const b = await postar(page, '/api/nir/barreiras', {
      internacao: internado.internacao,
      tipo: 'exame',
      descricao: 'Ecocardiograma sintético do cartão',
      responsavel: 'Imagem',
      prazo: emTresDias,
    });
    expect(b.status(), await b.text()).toBe(201);
    await page.reload();
    await expect(page.getByTestId('resumo-nir')).toContainText('barreira(s) de alta aberta(s)');
    await expect(page.getByTestId('topo-nir-barreiras')).toContainText('Aguardando exame');
    await semViolacaoAxe(page, '/inicio (cartão do NIR)');

    await page.goto('/internacao/nir/regulacao');
    await expect(page.getByTestId('tela-regulacao')).toBeVisible();
    await expect(page.getByTestId('regulacao-conector')).toContainText('à mão');
    const card = page.getByTestId(`regulacao-${sol}`);
    await expect(card).toContainText('Sem número de regulação');
    await semViolacaoAxe(page, '/internacao/nir/regulacao');
    await page.getByTestId(`abrir-regulacao-${sol}`).click();
    await expect(page.getByTestId(`form-regulacao-${sol}`)).toBeVisible();
    await page.getByLabel('Número da regulação').fill('rj-2026-004433');
    await semViolacaoAxe(page, '/internacao/nir/regulacao (registro)');
    await page.getByTestId('salvar-regulacao').click();
    await expect(page.getByTestId('regulacao-mensagem')).toContainText('registrada');
    await expect(card.getByTestId('regulacao-vigente')).toContainText('nº RJ-2026-004433');
    await expect(card.getByTestId('regulacao-vigente')).toContainText('Solicitada à central');
    // A central autoriza: a situação nova sobre a vigente; o histórico guarda as duas.
    await page.getByTestId(`abrir-regulacao-${sol}`).click();
    await escolher(page.getByTestId('reg-situacao'), 'autorizada');
    await page.getByTestId('salvar-regulacao').click();
    await expect(card.getByTestId('regulacao-vigente')).toContainText('Autorizada');
    await card.getByText('Histórico da regulação').click();
    await expect(card).toContainText('registrado à mão');
    await expect(page.getByTestId('contagem-autorizada')).toContainText('1');
    // A configuração recebida, só consulta.
    await page.getByTestId('ver-configuracao').click();
    await expect(page.getByTestId('regulacao-configuracao')).toContainText('Pontos de integração');
    await semViolacaoAxe(page, '/internacao/nir/regulacao (configuração)');
    expect(externas).toEqual([]);
  });
});
