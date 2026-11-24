// F3.7 (06-FAT linhas 10 e 12): complementos da conta e campo adicional da operadora na guia, pelo caminho da tela.
// Os complementos exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo). Por isso as respostas da API
// destas rotas são simuladas pelo Playwright com massa SINTÉTICA; o que se prova é a tela: a sugestão do período vai
// para fevereiro depois de janeiro fechado (e é o que se envia num clique), a troca da carteira, a guia com o
// obrigatório que falta vista na conta, o caminho conta → guia → campos da operadora e o preenchimento do obrigatório,
// que tira a pendência antes de gravar. O efeito no banco está no contrato de efeito
// (apps/api/src/modulos/faturamento/conta-complementos-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const CONTA = 7301;
const GUIA = 9301;
const FONTE = 5301;

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

const trat = {
  id: 1,
  codigo: 'TRAT',
  rotulo: 'Tratamento oncológico',
  tipoDado: 'opcao',
  tipoGuia: null,
  obrigatorio: true,
  tamanhoMaximo: null,
  dependeDeId: null,
  ativo: true,
  ordem: 0,
  versao: 1,
  opcoes: [
    { id: 10, codigo: 'QT', descricao: 'Quimioterapia', ativo: true, opcaoPaiId: null, versao: 1 },
    { id: 11, codigo: 'RT', descricao: 'Radioterapia', ativo: true, opcaoPaiId: null, versao: 1 },
  ],
};

async function simular(page: Page, enviados: Record<string, unknown>[]): Promise<void> {
  await page.route(`**/api/faturamento/contas/${CONTA}/periodos`, (rota) => {
    if (rota.request().method() === 'POST') {
      enviados.push({ periodo: rota.request().postDataJSON() });
      return json(rota, { id: 2, sequencia: 2, competencia: '2026-02-01' }, 201);
    }
    return json(rota, {
      contaId: CONTA,
      situacao: 'aberta',
      editavel: true,
      inicioConta: '2026-01-20T08:00:00.000',
      fimConta: null,
      periodos: [
        {
          id: 1,
          sequencia: 1,
          inicio: '2026-01-20T08:00:00.000',
          fim: '2026-01-31T23:59:59.999',
          competencia: '2026-01-01',
          tipoLancamentoId: null,
          tipoLancamento: null,
          versao: 1,
        },
      ],
      sugestao: null,
    });
  });
  await page.route(`**/api/faturamento/contas/${CONTA}/segurado`, (rota) => {
    if (rota.request().method() === 'POST') {
      enviados.push({ segurado: rota.request().postDataJSON() });
      return json(rota, { id: 2, versao: 1, substituido: 1, alertas: [] });
    }
    return json(rota, {
      contaId: CONTA,
      editavel: true,
      gravado: false,
      substituidos: 0,
      segurado: {
        id: null,
        sequencia: null,
        coberturaPacienteId: 41,
        titularCoberturaId: null,
        numeroCarteira: 'F373SINT0001',
        validadeCarteira: '2026-12-31',
        matriculaFuncional: null,
        cargo: null,
        padraoFuncional: null,
        classeFuncional: null,
        unidadeAdministrativa: null,
        parentescoTitular: 'titular',
        numeroOrdem: null,
        versao: null,
      },
    });
  });
  await page.route(`**/api/faturamento/contas/${CONTA}/guias-atributos`, (rota) =>
    json(rota, {
      contaId: CONTA,
      fontePagadoraId: FONTE,
      guias: [
        {
          id: GUIA,
          numero: 'F373G1',
          tipoGuia: 'sp_sadt',
          situacao: 'montada',
          fontePagadoraId: FONTE,
          campos: 1,
          faltam: ['Tratamento oncológico'],
        },
      ],
    }),
  );
  await page.route(`**/api/faturamento/guias/${GUIA}/atributos`, (rota) => {
    if (rota.request().method() === 'POST') {
      enviados.push({ guia: rota.request().postDataJSON() });
      return json(rota, { id: GUIA, gravados: 1, retirados: 0, faltam: [] });
    }
    return json(rota, {
      guia: {
        id: GUIA,
        tipoGuia: 'sp_sadt',
        situacao: 'montada',
        fontePagadoraId: FONTE,
        contaId: CONTA,
        numero: 'F373G1',
      },
      editavel: true,
      campos: [trat],
      valores: [],
      faltam: ['Tratamento oncológico'],
    });
  });
  await page.route(`**/api/faturamento/fontes/${FONTE}/atributos-guia`, (rota) => json(rota, [trat]));
}

test.describe('complementos da conta e campo adicional da operadora @F3.7', () => {
  test.setTimeout(180_000);

  test('período sugerido em fevereiro num clique, troca da carteira, guia pendente vista na conta e obrigatório preenchido na guia; axe', async ({
    page,
  }) => {
    const enviados: Record<string, unknown>[] = [];
    await entrar(page, 'SINT.TISS');
    await simular(page, enviados);

    // Conta: janeiro fechado até o último instante; a sugestão começa em 1º de fevereiro e vai num clique.
    await page.goto(`/faturamento/contas/${CONTA}/complementos`);
    await expect(page.getByTestId('tela-complementos-conta')).toBeVisible();
    await expect(page.getByTestId('cc-sugestao')).toBeVisible();
    await semViolacaoAxe(page, '/faturamento/contas/:id/complementos');
    await page.getByTestId('cc-aceitar').click();
    await expect.poll(() => enviados.find((e) => 'periodo' in e)).toBeTruthy();
    expect(enviados.find((e) => 'periodo' in e)?.['periodo']).toEqual({
      inicio: '2026-02-01T00:00:00.000',
      fim: '2026-02-28T23:59:59.999',
    });

    // Segurado: troca a carteira sugerida da cobertura e grava.
    await page.getByTestId('cc-carteira').fill('F373SINT0002');
    await page.getByTestId('cc-gravar-segurado').click();
    await expect.poll(() => enviados.find((e) => 'segurado' in e)).toBeTruthy();
    expect(enviados.find((e) => 'segurado' in e)?.['segurado']).toMatchObject({
      numeroCarteira: 'F373SINT0002',
      coberturaPacienteId: 41,
    });

    // Guias da conta: a pendência do obrigatório aparece na conta, e a guia abre num clique.
    const linha = page.getByTestId(`cc-guia-${GUIA}`);
    await expect(linha.getByTestId('cc-guia-faltam')).toContainText('Tratamento oncológico');
    await linha.getByTestId('cc-guia-preencher').click();
    await expect(page).toHaveURL(new RegExp(`/faturamento/guias/${GUIA}/atributos`));
    await expect(page.getByTestId('ag-faltam')).toContainText('Tratamento oncológico');
    await semViolacaoAxe(page, '/faturamento/guias/:guia/atributos');

    // Preenche o obrigatório: a pendência some antes de gravar, e o valor vai no pedido.
    await page.getByTestId('ag-campo-TRAT').selectOption({ label: 'Radioterapia' });
    await expect(page.getByTestId('ag-faltam')).not.toContainText('Tratamento oncológico');
    await page.getByTestId('ag-gravar').click();
    await expect.poll(() => enviados.find((e) => 'guia' in e)).toBeTruthy();
    expect(JSON.stringify(enviados.find((e) => 'guia' in e)?.['guia'])).toContain('"opcaoId":11');

    // Da guia para o cadastro dos campos da operadora.
    await page.getByTestId('ag-campos-operadora').click();
    await expect(page).toHaveURL(new RegExp(`/faturamento/fontes/${FONTE}/atributos-guia`));
    await expect(page.getByTestId('ag-lista')).toContainText('TRAT');
    await semViolacaoAxe(page, '/faturamento/fontes/:fonte/atributos-guia');
  });
});
