// E2E @C1-085 (F7, 09-AREA linha 68): o envio mensal da notificação de IRAS ao órgão sanitário e o cadastro das condutas
// da análise das culturas, pelo caminho da tela. O controlador de infecção chega à tela pela navegação da CCIH, vê a
// competência fechada com o prazo e o atraso, registra o envio: o que falta aparece na hora e o botão fica travado; o
// formulário que já tem envio vira retificação e pede o motivo. Depois registra o andamento (rejeição com a mensagem do
// órgão). Na tela das culturas, abre o cadastro das condutas e cadastra uma com o efeito. As rotas exigem o banco próprio
// e o E2E roda com a fonte sintética (sem núcleo): as respostas são simuladas pelo Playwright com massa SINTÉTICA. O
// efeito no banco está no contrato apps/api/src/modulos/qualidade/notificacao-iras.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const COMPETENCIA = 501;

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

const envioUti = (situacao: string, versao: number) => ({
  id: 61,
  formulario: 'uti_adulto',
  tipo: 'inicial',
  situacao,
  enviadoEm: '2026-10-10T00:00:00',
  protocolo: 'PROT-SINT-1',
  motivoRetificacao: null,
  mensagemRetorno: situacao === 'rejeitada' ? 'Denominador inconsistente' : null,
  registradoEm: '2026-10-10T09:00:00',
  registradoPor: 'SINT.CCIH',
  versao,
});

function competencia(situacaoUti: string, versao: number) {
  return {
    id: COMPETENCIA,
    competencia: '2026-09',
    situacao: 'enviada',
    prazo: '2026-10-15',
    atrasada: false,
    formularios: [{ formulario: 'uti_adulto', ultima: situacaoUti, atrasado: false }],
    envios: [envioUti(situacaoUti, versao)],
    versao: 2,
  };
}

test.describe('Notificação mensal de IRAS e condutas da cultura @C1-085 @fase7', () => {
  test.setTimeout(180_000);

  test('competência com prazo, envio com falta na hora, retificação com motivo, andamento rejeitado; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let situacaoUti = 'transcrita';
    let versaoUti = 2;
    await page.route('**/api/qualidade/ccih/notificacao**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/qualidade\/ccih\/notificacao\/?/, '');
      if (req.method() === 'GET') {
        if (caminho === '') return json(rota, [competencia(situacaoUti, versaoUti)]);
        return rota.fallback();
      }
      pedidos.push({ caminho, corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
      if (caminho === `${COMPETENCIA}/envios`)
        return json(rota, { id: 62, tipo: 'retificacao', situacao: 'transcrita' }, 201);
      if (caminho === 'envios/61/andamento') {
        situacaoUti = 'rejeitada';
        versaoUti = 3;
        return json(rota, { id: 61, situacao: 'rejeitada', versao: 3 });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.CCIH');
    await page.goto('/qualidade/ccih/iras');
    await page.getByTestId('nav-ccih-notificacao').click();
    await expect(page).toHaveURL(/\/qualidade\/ccih\/notificacao$/);
    const comp = page.getByTestId('notificacao-competencia-2026-09');
    await expect(comp).toBeVisible();
    await expect(comp).toContainText('15/10/2026');
    await expect(comp.getByTestId('notificacao-enviada')).toBeVisible();
    await expect(comp.getByTestId('notificacao-formulario-2026-09-uti_adulto')).toContainText('UTI adulto');
    await semViolacaoAxe(page, '/qualidade/ccih/notificacao (competências)');

    // Novo envio: o que falta aparece na hora; o formulário com envio vira retificação e pede o motivo.
    await comp.getByTestId('notificacao-novo-2026-09').click();
    const form = page.getByTestId('form-notificacao');
    await expect(page.getByTestId('notificacao-falta')).toBeVisible();
    await expect(form.getByTestId('notificacao-gravar')).toBeDisabled();
    await escolher(form.getByTestId('notificacao-formulario'), { rotulo: 'UTI adulto' });
    await expect(form.getByTestId('notificacao-tipo')).toContainText('Retificação');
    await expect(page.getByTestId('notificacao-falta')).toContainText('motivo');
    await form.getByTestId('notificacao-data').fill('2026-10-20');
    await form.getByTestId('notificacao-protocolo').locator('input').fill('PROT-SINT-2');
    await form
      .getByTestId('notificacao-motivo')
      .locator('input, textarea')
      .first()
      .fill('Denominador corrigido');
    await expect(page.getByTestId('notificacao-falta')).toHaveCount(0);
    expect(pedidos).toHaveLength(0);
    await form.getByTestId('notificacao-gravar').click();
    await expect(page.getByTestId('notificacao-aviso')).toContainText('Envio registrado');
    expect(pedidos[0]).toMatchObject({
      caminho: `${COMPETENCIA}/envios`,
      corpo: {
        formulario: 'uti_adulto',
        situacao: 'transcrita',
        enviadoEm: '2026-10-20',
        protocolo: 'PROT-SINT-2',
        motivoRetificacao: 'Denominador corrigido',
      },
    });

    // Andamento: a rejeição exige a mensagem de retorno do órgão.
    await comp.getByTestId('notificacao-historico-2026-09').locator('summary').click();
    await comp.getByTestId('notificacao-andamento-61').click();
    const andamento = page.getByTestId('form-andamento');
    await escolher(andamento.getByTestId('andamento-situacao'), { rotulo: 'Rejeitada' });
    await expect(page.getByTestId('andamento-falta')).toContainText('mensagem');
    await expect(andamento.getByTestId('andamento-gravar')).toBeDisabled();
    await andamento
      .getByTestId('andamento-mensagem')
      .locator('input, textarea')
      .first()
      .fill('Denominador inconsistente');
    await andamento.getByTestId('andamento-gravar').click();
    await expect(page.getByTestId('notificacao-aviso')).toContainText('Andamento registrado');
    expect(pedidos[1]).toMatchObject({
      caminho: 'envios/61/andamento',
      corpo: { versao: 2, situacao: 'rejeitada', mensagemRetorno: 'Denominador inconsistente' },
    });
    await expect(page.getByTestId('notificacao-envio-situacao-61')).toContainText('Rejeitada');
    await semViolacaoAxe(page, '/qualidade/ccih/notificacao (histórico)');
  });

  test('cadastro das condutas na tela das culturas: falta na hora e corpo certo', async ({ page }) => {
    const pedidos: Record<string, unknown>[] = [];
    const condutas: Record<string, unknown>[] = [];
    await page.route('**/api/qualidade/ccih/culturas**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/qualidade\/ccih\/culturas\/?/, '');
      if (req.method() === 'GET') {
        if (caminho === '') return json(rota, []);
        if (caminho === 'condutas') return json(rota, condutas);
        return rota.fallback();
      }
      if (caminho === 'condutas') {
        const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
        pedidos.push(corpo);
        condutas.push({ id: 9, ativo: true, ...corpo });
        return json(rota, { id: 9 }, 201);
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.CCIH');
    await page.goto('/qualidade/ccih/culturas');
    await page.getByTestId('culturas-condutas').click();
    const painel = page.getByTestId('condutas-cultura');
    await expect(painel.getByTestId('condutas-nenhuma')).toBeVisible();
    await expect(painel.getByTestId('conduta-falta')).toBeVisible();
    await expect(painel.getByTestId('conduta-gravar')).toBeDisabled();
    await painel.getByTestId('conduta-codigo').locator('input').fill('Contato MR');
    await painel.getByTestId('conduta-descricao').locator('input').fill('Precaução de contato');
    await expect(painel.getByTestId('conduta-falta')).toContainText('código');
    await painel.getByTestId('conduta-codigo').locator('input').fill('contato-mr');
    await escolher(painel.getByTestId('conduta-classificacao'), { rotulo: 'Colonização' });
    await painel.getByTestId('conduta-precaucao').check();
    await expect(painel.getByTestId('conduta-falta')).toHaveCount(0);
    await painel.getByTestId('conduta-gravar').click();
    await expect(painel.getByTestId('conduta-aviso')).toContainText('Conduta cadastrada');
    expect(pedidos[0]).toEqual({
      codigo: 'contato-mr',
      descricao: 'Precaução de contato',
      classificacaoAplicavel: 'colonizacao',
      abreCaso: false,
      indicaPrecaucao: true,
      exigeResposta: false,
    });
    await expect(painel.getByTestId('conduta-contato-mr')).toContainText('Indica precaução');
    await semViolacaoAxe(page, '/qualidade/ccih/culturas (condutas)');
  });
});
