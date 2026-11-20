// E2E @W0-07 (programa CRUD completo): as telas do NIR, do mapa de leitos e da observação do PA com o motivo
// obrigatório em cada diálogo — corrigir a solicitação, excluí-la com a senha (e a recusa com a contagem quando há
// reserva), alterar e excluir a reserva, retirar a alta prevista, alterar e encerrar a barreira, remover o limite,
// alterar o estado do leito sem encerrar, limpar os atributos e transferir o paciente de leito na observação do PA.
// axe sem violação séria nos diálogos. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS;
// nada vai à cópia; nenhuma mensagem a paciente).
import {
  type APIRequestContext,
  type Browser,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

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
    headers: { 'x-csrf': csrf, 'idempotency-key': `e2e-w007-${Date.now()}-${++sequencia}` },
    data: data as object,
  });
}
const pedido = (paciente: number) => ({
  origem: 'eletiva',
  paciente,
  prioridade: 'urgente',
  perfil: { intensiva: false, precaucao: null, tiposAcomodacao: [] },
  clinica: 'M',
  justificativa: 'Indicação sintética de internação para o teste do W0-07',
});
/** O campo de texto do componente (input ou textarea) pelo data-testid do invólucro. */
const campo = (l: Locator) => l.locator('input, textarea').first();
/** Escreve o motivo e confirma o diálogo. */
async function confirmar(p: Page, testid: string, motivo: string, senha?: string): Promise<void> {
  const d = p.getByTestId(testid);
  await expect(d).toBeVisible();
  await expect(d.getByTestId(`${testid}-confirmar`)).toBeDisabled();
  await campo(d.getByTestId(`${testid}-motivo`)).fill(motivo);
  if (senha !== undefined) await d.getByTestId(`${testid}-senha`).fill(senha);
  await d.getByTestId(`${testid}-confirmar`).click();
}

test.describe('W0-07: correção, alteração e exclusão no NIR, no mapa e no PA @W0-07', () => {
  test.setTimeout(300_000);

  test('fila e reservas: corrigir, excluir (senha; recusa com a contagem), alterar e excluir a reserva; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    const med = await novaAba(browser, 'SINT.MEDICO.NIR');
    const r1 = await postar(med, '/api/nir/solicitacoes', pedido(1001));
    expect(r1.status(), await r1.text()).toBe(201);
    const s1 = Number((await r1.json()).id);
    const r2 = await postar(med, '/api/nir/solicitacoes', pedido(1002));
    const s2 = Number((await r2.json()).id);
    await med.context().close();

    await entrar(page, 'SINT.INTERNACAO');
    await page.goto('/internacao/nir/fila');
    const c1 = page.getByTestId(`solicitacao-${s1}`);
    await expect(c1).toBeVisible({ timeout: 30_000 });

    // Corrigir: o motivo é obrigatório (o botão fica desligado sem ele); a observação aparece no cartão.
    await c1.getByTestId(`corrigir-${s1}`).click();
    const dc = page.getByTestId(`dialogo-corrigir-${s1}`);
    await expect(dc).toBeVisible();
    await escolher(dc.getByTestId(`corrigir-precaucao-${s1}`), 'contato');
    await campo(dc.getByTestId(`corrigir-observacao-${s1}`)).fill('Precisa de monitor contínuo');
    await semViolacaoAxe(page, 'diálogo corrigir solicitação');
    await confirmar(page, `dialogo-corrigir-${s1}`, 'Perfil revisto pelo plantonista');
    await expect(dc).toBeHidden();
    await expect(c1.getByTestId('recursos')).toContainText('Precisa de monitor contínuo');

    // Excluir a criada por engano: pede a senha (reautenticação no diálogo); sai da fila.
    await c1.getByTestId(`excluir-${s1}`).click();
    await semViolacaoAxe(page, 'diálogo excluir solicitação');
    await confirmar(page, `dialogo-excluir-${s1}`, 'Paciente errado na tela', SENHA);
    await expect(page.getByTestId(`solicitacao-${s1}`)).toHaveCount(0);

    // A segunda: reserva pela API do NIR; excluir a solicitação recusa com a contagem (aviso único no diálogo).
    const leitos = await (await page.request.get(`/api/nir/solicitacoes/${s2}/leitos`)).json();
    const compat = (leitos.leitos as { compativel: boolean; leito: unknown; chave: string }[]).filter(
      (l) => l.compativel,
    );
    const rr = await postar(page, '/api/nir/reservas', { solicitacao: s2, leito: compat[0]!.leito });
    expect(rr.status(), await rr.text()).toBe(201);
    const reserva = Number((await rr.json()).id);
    await page.reload();
    const c2 = page.getByTestId(`solicitacao-${s2}`);
    await expect(c2).toHaveAttribute('data-estado', 'reservado');
    await c2.getByTestId(`excluir-${s2}`).click();
    await confirmar(page, `dialogo-excluir-${s2}`, 'Paciente errado na tela', SENHA);
    await expect(page.getByTestId(`dialogo-excluir-${s2}-recusa`)).toContainText(
      '1 reserva de leito vinculada',
    );
    await page.keyboard.press('Escape');

    // Reservas: alterar a validade (motivo) e excluir a reserva feita por engano (a solicitação volta à análise).
    await page.goto('/internacao/nir/reservas');
    await page.getByTestId(`reserva-alterar-${reserva}`).click();
    const da = page.getByTestId('dialogo-alterar-reserva');
    await campo(da.getByTestId('alterar-reserva-validade')).fill('300');
    await semViolacaoAxe(page, 'diálogo alterar reserva');
    await confirmar(page, 'dialogo-alterar-reserva', 'Transporte atrasado');
    await expect(da).toBeHidden();
    await page.getByTestId(`reserva-excluir-${reserva}`).click();
    await confirmar(page, 'dialogo-excluir-reserva', 'Reservado no paciente errado');
    await expect(page.getByTestId(`reserva-${reserva}`)).toHaveCount(0);
    await page.goto('/internacao/nir/fila');
    await expect(page.getByTestId(`solicitacao-${s2}`)).toHaveAttribute('data-estado', 'em_analise');
    expect(externas).toEqual([]);
  });

  test('altas previstas, barreira e limite: retirar a DPA, alterar e encerrar a barreira, remover o limite; axe', async ({
    page,
    browser,
  }) => {
    const med = await novaAba(browser, 'SINT.MEDICO.NIR');
    const a = await (await med.request.get('/api/nir/altas-previstas')).json();
    const internacao = Number(a.itens[0].internacao);
    const amanha = new Date(Date.parse(`${a.hoje}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect((await postar(med, '/api/nir/dpa', { internacao, data: amanha, anterior: null })).status()).toBe(
      201,
    );
    await med.goto('/internacao/nir/altas-previstas');
    const card = med.getByTestId(`internado-${internacao}`);
    await card.getByTestId(`retirar-dpa-${internacao}`).click();
    await semViolacaoAxe(med, 'diálogo retirar DPA');
    await confirmar(med, `dialogo-retirar-dpa-${internacao}`, 'Exame pendente');
    await expect(card.getByTestId('dpa')).toContainText(/sem alta prevista/i);
    await med.context().close();

    await entrar(page, 'SINT.INTERNACAO');
    const b = await postar(page, '/api/nir/barreiras', {
      internacao,
      tipo: 'social',
      descricao: 'Aguardando vaga em ILPI',
      responsavel: 'Serviço social',
      prazo: amanha,
    });
    const barreira = Number((await b.json()).id);
    await page.goto('/internacao/nir/altas-previstas');
    await page.getByTestId(`alterar-barreira-${barreira}`).click();
    await campo(page.getByTestId(`alterar-barreira-responsavel-${internacao}`)).fill(
      'Assistente social do andar',
    );
    await confirmar(page, `dialogo-alterar-barreira-${internacao}`, 'Troca de responsável');
    await expect(page.getByTestId(`barreira-${barreira}`)).toContainText('Assistente social do andar');
    await page.getByTestId(`encerrar-barreira-${barreira}`).click();
    await semViolacaoAxe(page, 'diálogo encerrar barreira');
    await confirmar(page, `dialogo-encerrar-barreira-${internacao}`, 'Vaga conseguida');
    await expect(page.getByTestId(`barreira-${barreira}`)).toContainText(/resolvida/i);

    expect(
      (
        await postar(page, '/api/nir/limites', {
          escopo: 'clinica',
          chave: 'M',
          amareloDias: 4,
          vermelhoDias: 8,
          origem: 'manual',
        })
      ).status(),
    ).toBe(200);
    await page.goto('/internacao/nir/permanencia');
    await page.getByTestId('remover-limite-M').click();
    await semViolacaoAxe(page, 'diálogo remover limite');
    await confirmar(page, 'dialogo-remover-limite', 'Volta ao padrão');
    await expect(page.getByTestId('remover-limite-M')).toHaveCount(0);
  });

  test('mapa e PA: alterar o estado sem encerrar, limpar os atributos, transferir de leito na observação; axe', async ({
    page,
    browser,
  }) => {
    await entrar(page, 'SINT.INTERNACAO');
    const mapa = await (await page.request.get('/api/leitos/mapa')).json();
    const livre = (mapa.leitos as { situacao: string; chave: string; leito: unknown }[]).find(
      (l) => l.situacao === 'livre',
    )!;
    expect(
      (
        await postar(page, '/api/leitos/estados', {
          leito: livre.leito,
          estado: 'bloqueio',
          motivo: 'manutencao',
        })
      ).status(),
    ).toBe(201);
    // O motivo vale quando o leito já tem atributos próprios (outro teste do mesmo servidor pode tê-los gravado).
    expect(
      (
        await postar(page, '/api/leitos/atributos', {
          leito: livre.leito,
          sexo: 'F',
          motivo: 'Leito feminino',
        })
      ).status(),
    ).toBe(200);
    await page.goto('/leitos/mapa');
    await page.getByTestId(`alterar-estado-bloqueio-${livre.chave}`).click();
    await campo(page.getByTestId('alterar-estado-observacao')).fill('Troca do painel de gases');
    await semViolacaoAxe(page, 'diálogo alterar estado');
    await confirmar(page, 'dialogo-alterar-estado', 'Previsão informada pela manutenção');
    await expect(page.getByTestId('dialogo-alterar-estado')).toBeHidden();
    await expect(page.getByTestId(`leito-${livre.chave}`)).toHaveAttribute('data-situacao', 'bloqueado');
    await page.getByTestId(`limpar-atributos-${livre.chave}`).click();
    await confirmar(page, 'dialogo-limpar-atributos', 'Leito voltou a ser misto');
    await expect(page.getByTestId(`limpar-atributos-${livre.chave}`)).toHaveCount(0);

    // PA: aloca e transfere de leito numa operação só (motivo obrigatório).
    const recepcao = await novaAba(browser, 'SINT.ATENDIMENTO');
    const ab = await postar(recepcao, '/api/atendimento', {
      tipo: 'pa',
      paciente: 1005,
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
    expect(ab.status(), await ab.text()).toBe(201);
    const reg = Number((await ab.json()).resultado.reg);
    await recepcao.context().close();
    const pa = await novaAba(browser, 'SINT.MEDICO.PA');
    const o = await (await pa.request.get('/api/pa/observacao')).json();
    const livres = (o.leitos as { id: number; ativo: boolean; ocupacao: unknown }[]).filter(
      (l) => l.ativo && l.ocupacao === null,
    );
    expect((await postar(pa, `/api/pa/${reg}/observacao`, { leito: livres[0]!.id })).status()).toBe(201);
    await pa.goto('/pa/observacao');
    await pa.getByTestId(`obs-transferir-${livres[0]!.id}`).click();
    await escolher(pa.getByTestId('transferir-destino'), String(livres[1]!.id));
    await semViolacaoAxe(pa, 'diálogo transferir observação');
    await confirmar(pa, 'dialogo-transferir-observacao', 'Necessidade de monitor');
    await expect(pa.getByTestId('obs-mensagem')).toContainText(/transferido/i);
    await expect(pa.getByTestId(`obs-liberar-${livres[1]!.id}`)).toBeVisible();
    await expect(pa.getByTestId(`obs-liberar-${livres[0]!.id}`)).toHaveCount(0);
  });
});
