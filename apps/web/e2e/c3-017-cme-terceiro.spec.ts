// F7 (04-CME linha 119) @C3-017: material de terceiro e consignado processado pela CME, pelo caminho da tela. As rotas
// exigem o banco próprio e o E2E roda com a fonte sintética, então as respostas da API são simuladas pelo Playwright
// com massa SINTÉTICA. O que se prova é a tela: o cadastro do material vai com o dono buscado e o roteiro; o
// recebimento vai com a CME, o fornecedor, a cirurgia, o entregador e os itens; a conferência peça a peça leva a
// versão lida; o envio ao reprocessamento e a devolução conferida vão com utilizado, devolvido e quem retirou. O efeito
// no banco está no contrato de efeito apps/api/src/modulos/cirurgia/cme-terceiro-propria.int.spec.ts.
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

const material = {
  id: 4,
  descricao: 'CAIXA DE COLUNA SINTETICA',
  tipoProprietario: 'fornecedor',
  dono: 'FORNECEDOR SINTETICO',
  fornecedor: 7,
  codigoBarras: null,
  quantidadePecas: 40,
  validadeDias: 30,
  esterilizacao: true,
  ativo: true,
};
const recebimento = (situacao: string, versao: number) => ({
  id: 21,
  numero: 1,
  situacao,
  versao,
  fornecedor: 'FORNECEDOR SINTETICO',
  agendamento: 'AG-SINT-1',
  temPaciente: true,
  cme: 'CME SINTETICA',
  entregador: 'REPRESENTANTE SINTETICO',
  recebidoEm: '2026-11-26T08:00',
  conferidoEm: null,
  devolvidoEm: null,
  recebedorDevolucao: null,
  itens: [
    {
      sequencia: 1,
      material: 4,
      descricao: 'CAIXA DE COLUNA SINTETICA',
      recebida: 3,
      utilizada: 0,
      devolvida: 0,
      conferidoRecebimento: situacao !== 'recebido',
      conferidoDevolucao: false,
      divergencia: null,
    },
  ],
  pacotes: [],
});

test.describe('C3-017 material de terceiro na CME', () => {
  test('cadastra, recebe, confere, reprocessa e devolve pela tela', async ({ page }) => {
    const corpos: Record<string, unknown[]> = {
      material: [],
      receber: [],
      conferir: [],
      reprocessar: [],
      devolver: [],
    };
    let estado = { situacao: 'recebido', versao: 1 };
    const painel = () => ({
      materiais: [material],
      recebimentos: [recebimento(estado.situacao, estado.versao)],
      setores: [{ id: 3, nome: 'CME SINTETICA' }],
      agendamentos: [{ id: 9, numero: 'AG-SINT-1', paciente: 5 }],
    });
    await page.route('**/api/cirurgia/cme/terceiros', (r) => json(r, painel()));
    await page.route('**/api/cirurgia/cme/terceiros/donos**', (r) =>
      json(r, [{ id: 7, nome: 'FORNECEDOR SINTETICO' }]),
    );
    await page.route('**/api/cirurgia/cme/terceiros/materiais', (r) => {
      corpos['material']!.push(r.request().postDataJSON());
      return json(r, { material: 4 }, 201);
    });
    await page.route('**/api/cirurgia/cme/terceiros/recebimentos', (r) => {
      corpos['receber']!.push(r.request().postDataJSON());
      return json(r, { recebimento: 21, numero: 1 }, 201);
    });
    await page.route('**/api/cirurgia/cme/terceiros/recebimentos/21/conferir', (r) => {
      corpos['conferir']!.push(r.request().postDataJSON());
      estado = { situacao: 'conferido', versao: 2 };
      return json(r, { situacao: 'conferido' });
    });
    await page.route('**/api/cirurgia/cme/terceiros/recebimentos/21/reprocessar', (r) => {
      corpos['reprocessar']!.push(r.request().postDataJSON());
      return json(r, { situacao: 'em_reprocessamento', etiquetas: ['P-SINT-1'] });
    });
    await page.route('**/api/cirurgia/cme/terceiros/recebimentos/21/devolver', (r) => {
      corpos['devolver']!.push(r.request().postDataJSON());
      return json(r, { situacao: 'devolvido' });
    });

    // A CME é permissão clínica por perfil (cirurgia.cme.ler e .operar, perfil central-material-esteril): a segregação de
    // funções a tira do administrador sem perfil assistencial. Quem recebe, confere e devolve o material de terceiro é a
    // equipe da CME.
    await entrar(page, 'SINT.CME');
    await page.goto('/cirurgia/cme/terceiros');
    await expect(page.getByTestId('tela-cme-terceiros')).toBeVisible();

    await page.getByTestId('cme-terceiro-descricao').fill('CAIXA DE COLUNA SINTETICA');
    await escolher(page.getByTestId('cme-terceiro-dono'), { rotulo: 'FORNECEDOR SINTETICO' });
    await page.getByTestId('cme-terceiro-validade').fill('30');
    await page.getByTestId('cme-terceiro-cadastrar').click();
    await expect.poll(() => corpos['material']!.length).toBe(1);
    expect(corpos['material']![0]).toMatchObject({
      descricao: 'CAIXA DE COLUNA SINTETICA',
      tipoProprietario: 'fornecedor',
      fornecedor: 7,
      profissional: null,
      validadeDias: 30,
      lavagem: true,
      esterilizacao: true,
    });

    await escolher(page.getByTestId('cme-terceiro-cme'), { rotulo: 'CME SINTETICA' });
    await escolher(page.getByTestId('cme-terceiro-rec-fornecedor'), { rotulo: 'FORNECEDOR SINTETICO' });
    await escolher(page.getByTestId('cme-terceiro-rec-cirurgia'), { rotulo: 'AG-SINT-1' });
    await page.getByTestId('cme-terceiro-entregador').fill('REPRESENTANTE SINTETICO');
    await escolher(page.getByTestId('cme-terceiro-rec-material'), { rotulo: /CAIXA DE COLUNA SINTETICA/ });
    await page.getByTestId('cme-terceiro-rec-quantidade').fill('3');
    await page.getByTestId('cme-terceiro-incluir').click();
    await page.getByTestId('cme-terceiro-receber').click();
    await expect.poll(() => corpos['receber']!.length).toBe(1);
    expect(corpos['receber']![0]).toEqual({
      cme: 3,
      fornecedor: 7,
      agendamento: 9,
      entregador: 'REPRESENTANTE SINTETICO',
      observacao: null,
      itens: [{ material: 4, quantidade: 3 }],
    });

    await escolher(page.getByTestId('cme-terceiro-escolha'), { rotulo: /^1 ·/ });
    await expect(page.getByTestId('cme-terceiro-situacao')).toContainText('Recebido');
    await page.getByTestId('cme-terceiro-conf-1').check();
    await page.getByTestId('cme-terceiro-conferir').click();
    await expect.poll(() => corpos['conferir']!.length).toBe(1);
    expect(corpos['conferir']![0]).toEqual({
      versao: 1,
      itens: [{ sequencia: 1, conferido: true, divergencia: null }],
    });

    await expect(page.getByTestId('cme-terceiro-situacao')).toContainText('Conferido');
    await page.getByTestId('cme-terceiro-reprocessar').click();
    await expect.poll(() => corpos['reprocessar']!.length).toBe(1);
    expect(corpos['reprocessar']![0]).toEqual({ versao: 2 });

    await page.getByTestId('cme-terceiro-usada-1').fill('1');
    await page.getByTestId('cme-terceiro-devolvida-1').fill('2');
    await page.getByTestId('cme-terceiro-dev-conf-1').check();
    await page.getByTestId('cme-terceiro-recebedor').fill('REPRESENTANTE SINTETICO');
    await page.getByTestId('cme-terceiro-devolver').click();
    await expect.poll(() => corpos['devolver']!.length).toBe(1);
    expect(corpos['devolver']![0]).toEqual({
      versao: 2,
      recebedor: 'REPRESENTANTE SINTETICO',
      observacao: null,
      itens: [{ sequencia: 1, utilizada: 1, devolvida: 2, conferido: true }],
    });
    await semViolacaoAxe(page, 'C3-017 material de terceiro na CME');
  });
});
