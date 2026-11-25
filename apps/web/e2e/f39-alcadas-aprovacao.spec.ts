// E2E @C2-051 (01-ADM linha 59): alçadas de aprovação pelo caminho da tela. As rotas exigem o banco próprio e o E2E
// roda com a fonte sintética, então as respostas de /api/administracao/alcadas são simuladas pelo Playwright com
// massa SINTÉTICA e um estado que avança a cada gravação. O que se prova é a tela: abre da lista de usuários; a regra
// nova trava sem documento e sem aprovador e mostra na hora a recusa do domínio (nível sem teto no meio, acumulado sem
// período); grava com dois níveis (perfil e conta); a regra usada em pedidos avisa que mudar os níveis pede vigência
// nova; encerrar fecha a vigência; a ficha da conta mostra em que nível ela aprova. O efeito no banco está no contrato
// apps/api/src/modulos/administracao/alcada-aprovacao-propria.int.spec.ts. Nenhum dado real.
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

interface Estado {
  gravada: Record<string, unknown> | null;
  encerrada: boolean;
}

function painel(e: Estado, comUsuario: boolean) {
  const alcadas = e.gravada
    ? [
        {
          id: 31,
          versao: 1,
          documento: 'SC',
          documentoDescricao: 'Solicitação de compra',
          descricao: String(e.gravada['descricao']),
          modo: 'serie',
          quantidadeNiveis: 2,
          prazoHoras: null,
          acaoPrazoVencido: 'alertar',
          permiteAutoaprovacao: false,
          exigeJustificativaRecusa: true,
          vigenciaInicio: String(e.gravada['vigenciaInicio']),
          vigenciaFim: e.encerrada ? String(e.gravada['vigenciaInicio']) : null,
          ativo: true,
          vigente: !e.encerrada,
          pedidos: 3,
          niveis: e.gravada['niveis'],
        },
      ]
    : [];
  return {
    documentos: [
      { codigo: 'SC', descricao: 'Solicitação de compra' },
      { codigo: 'OC', descricao: 'Ordem de compra' },
    ],
    perfis: [
      { codigo: 'COMPRAS', nome: 'Compras sintético' },
      { codigo: 'DIRETORIA', nome: 'Diretoria sintética' },
    ],
    alcadas,
    ...(comUsuario
      ? {
          doUsuario: e.gravada
            ? [
                {
                  alcada: 31,
                  documento: 'SC',
                  descricao: String(e.gravada['descricao']),
                  nivel: 2,
                  via: 'conta',
                  perfil: null,
                  valorMinimo: 1000.01,
                  valorMaximo: null,
                },
              ]
            : [],
        }
      : {}),
  };
}

async function simular(page: Page, e: Estado): Promise<void> {
  await page.route('**/api/administracao/alcadas**', async (rota) => {
    const req = rota.request();
    const url = new URL(req.url());
    if (req.method() === 'GET') return json(rota, painel(e, url.searchParams.has('usuario')));
    if (url.pathname.endsWith('/encerrar')) {
      e.encerrada = true;
      return json(rota, { alcada: 31, acao: 'fechar' });
    }
    e.gravada = req.postDataJSON() as Record<string, unknown>;
    return json(rota, { alcada: 31, encerrada: null });
  });
}

test.describe('Alçadas de aprovação @C2-051', () => {
  test('cadastro com validação na hora, gravação, aviso de regra em uso e encerramento @C2-051', async ({
    page,
  }) => {
    const e: Estado = { gravada: null, encerrada: false };
    await simular(page, e);
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios');
    await page.getByTestId('atalho-alcadas').click();
    await expect(page).toHaveURL(/\/administracao\/acesso\/alcadas$/);
    await expect(page.getByTestId('alcadas-vazio')).toBeVisible();
    await semViolacaoAxe(page, 'alçadas de aprovação');

    await page.getByTestId('alcada-nova').click();
    const form = page.getByTestId('form-alcada');
    await expect(page.getByTestId('alcada-gravar')).toBeDisabled();
    await expect(page.getByTestId('alcada-problema')).toContainText('tipo de documento');
    await escolher(page.getByTestId('alcada-documento'), 'SC');
    await form.getByLabel('Nome da regra').fill('Compras sintéticas');
    await expect(page.getByTestId('alcada-problema')).toContainText('perfil ou a conta');
    await escolher(page.getByTestId('alcada-perfil-0'), 'COMPRAS');
    await page.getByTestId('alcada-mais-nivel').click();
    await escolher(page.getByTestId('alcada-tipo-1'), 'conta');
    await page.getByTestId('alcada-conta-1').getByRole('textbox').fill('SINT.GESTOR');
    // Primeiro nível sem teto e o segundo depois dele: a regra do domínio recusa na hora.
    await expect(page.getByTestId('alcada-problema')).toContainText('Só o último nível pode ficar sem teto');
    await page.getByTestId('alcada-maximo-0').getByRole('textbox').fill('1.000,00');
    await page.getByTestId('alcada-minimo-1').getByRole('textbox').fill('1000,01');
    // Teto acumulado sem período: recusa; com o período, libera.
    await page.getByTestId('alcada-acumulado-1').getByRole('textbox').fill('50000');
    await expect(page.getByTestId('alcada-problema')).toContainText('teto acumulado exige o período');
    await escolher(page.getByTestId('alcada-periodo-1'), 'mes');
    await expect(page.getByTestId('alcada-problema')).toHaveCount(0);
    await page.getByTestId('alcada-gravar').click();
    await expect(page.getByTestId('alcadas-feito')).toContainText('Regra gravada');
    expect(e.gravada).toMatchObject({
      documento: 'SC',
      niveis: [
        { nivel: 1, perfil: 'COMPRAS', usuario: null, valorMaximo: 1000 },
        { nivel: 2, perfil: null, usuario: 'SINT.GESTOR', valorMaximo: null, periodoAcumulado: 'mes' },
      ],
    });

    // A regra já decidiu pedidos: alterar avisa que mudar os níveis pede vigência nova.
    await page.getByTestId('alcada-editar-31').click();
    await expect(page.getByTestId('form-alcada')).toContainText('vigência nova');
    await page.getByTestId('alcada-cancelar').click();

    await page.getByTestId('alcada-encerrar-31').click();
    await page.getByTestId('alcada-confirmar-encerrar').click();
    await expect(page.getByTestId('alcadas-feito')).toContainText('Regra encerrada');
    await expect(page.getByTestId('alcada-31')).toContainText('encerrada');
  });

  test('a ficha da conta mostra em que nível ela aprova @C2-051', async ({ page }) => {
    const e: Estado = {
      gravada: {
        descricao: 'Compras sintéticas',
        vigenciaInicio: '2026-01-01',
        niveis: [],
      },
      encerrada: false,
    };
    await simular(page, e);
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios/SINT.GESTOR');
    await page.getByTestId('ficha-aba-papeis').click();
    const cartao = page.getByTestId('ficha-alcadas');
    await expect(cartao).toContainText('Compras sintéticas');
    await expect(cartao).toContainText('nível 2');
    await expect(cartao).toContainText('pela conta');
    await cartao.getByTestId('ficha-abrir-alcadas').click();
    await expect(page).toHaveURL(/\/administracao\/acesso\/alcadas$/);
  });
});
