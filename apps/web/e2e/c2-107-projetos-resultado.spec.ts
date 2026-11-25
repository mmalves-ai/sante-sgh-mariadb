// E2E @C2-107 (F8, 07-FIN L128): projeto como centro de resultado pela tela /financeiro/orcamento/projetos, aberta pelo
// orçamento empresarial. Quem edita o orçamento cadastra o projeto (as etapas acima da verba aparecem na hora e travam o
// botão), abre o projeto com o resultado (orçado × realizado, receita − despesa), busca o título a pagar pelo número,
// vê o valor livre e a prévia do rateio pelo percentual, apropria e estorna com o motivo. As rotas /api/financeiro/
// projetos exigem o banco próprio e o E2E roda com a fonte sintética: as respostas são simuladas pelo Playwright com
// massa SINTÉTICA. O efeito no banco está em apps/api/src/modulos/orcamento/projeto-resultado-propria.int.spec.ts.
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

const resumo = {
  id: 1,
  versao: 1,
  codigo: 'OBRA-1',
  descricao: 'Reforma sintética',
  tipo: 'obra',
  situacao: 'em_andamento',
  verba: 1000,
  inicioPrevisto: '2027-01-01',
  fimPrevisto: '2027-12-31',
  despesa: 0,
  receita: 0,
  estourado: false,
};
const lista = {
  projetos: [] as unknown[],
  centros: [{ id: 7, nome: 'CC-A · Centro sintético A' }],
  insumos: [],
};
const detalhe = (despesa: number, apropriacoes: unknown[]) => ({
  ...resumo,
  despesa: undefined,
  receita: undefined,
  estourado: undefined,
  inicioEfetivo: '2027-01-02',
  fimEfetivo: null,
  centroResultado: 7,
  convenio: null,
  etapas: [
    {
      id: 11,
      sequencia: 1,
      descricao: 'Execução',
      centroCusto: null,
      centroNome: null,
      inicioPrevisto: null,
      fimPrevisto: null,
      valorPrevisto: 800,
      valorRealizado: despesa,
      percentualConcluido: 0,
      situacao: 'em_andamento',
    },
  ],
  centros: [{ centroCusto: 7, nome: 'Centro sintético A', percentual: 100 }],
  produtos: [],
  apropriacoes,
  resultado: {
    orcado: 1000,
    despesa,
    receita: 0,
    resultado: -despesa,
    saldoVerba: 1000 - despesa,
    percentualConsumido: despesa / 10,
    estourado: false,
    etapas: [
      {
        sequencia: 1,
        descricao: 'Execução',
        previsto: 800,
        realizado: despesa,
        diferenca: 800 - despesa,
        estourada: false,
      },
    ],
    semEtapa: 0,
    centros: [{ centroCusto: 7, percentual: 100, despesa }],
  },
});
const apropriacao = {
  id: 21,
  versao: 1,
  origem: 'titulo',
  documento: 31,
  natureza: 'despesa',
  etapa: 1,
  percentual: 40,
  valor: 200,
  data: '2027-03-10',
  observacao: null,
  estornada: false,
};

test.describe('projeto como centro de resultado @C2-107', () => {
  test.setTimeout(240_000);
  test.use({ actionTimeout: 30_000 });

  test('cadastro validado na hora → resultado → apropriação com prévia → estorno; axe', async ({ page }) => {
    let estado: 'vazio' | 'criado' | 'apropriado' | 'estornado' = 'vazio';
    const corpos: Record<string, unknown> = {};
    await page.route('**/api/financeiro/projetos**', async (rota) => {
      const url = new URL(rota.request().url());
      const metodo = rota.request().method();
      if (metodo === 'GET' && url.pathname.endsWith('/documentos'))
        return json(rota, [
          {
            id: 31,
            numero: '902107',
            data: '2027-02-01',
            valor: 500,
            livre: 500,
            cancelado: false,
            descricao: 'NF sintética',
          },
        ]);
      if (metodo === 'GET' && /\/projetos\/1$/.test(url.pathname))
        return json(
          rota,
          estado === 'apropriado'
            ? detalhe(200, [apropriacao])
            : estado === 'estornado'
              ? detalhe(0, [{ ...apropriacao, estornada: true }])
              : detalhe(0, []),
        );
      if (metodo === 'GET')
        return json(rota, { ...lista, projetos: estado === 'vazio' ? [] : [{ ...resumo }] });
      if (url.pathname.endsWith('/estornar')) {
        corpos['estorno'] = rota.request().postDataJSON();
        estado = 'estornado';
        return json(rota, { id: 21 });
      }
      if (url.pathname.endsWith('/apropriacoes')) {
        corpos['apropriacao'] = rota.request().postDataJSON();
        estado = 'apropriado';
        return json(rota, { id: 21, valor: 200, natureza: 'despesa' }, 201);
      }
      corpos['projeto'] = rota.request().postDataJSON();
      estado = 'criado';
      return json(rota, { id: 1 }, 201);
    });

    await entrar(page, 'SINT.ORCAMENTO');
    await page.goto('/financeiro/orcamento');
    await page.getByTestId('orc-ir-projetos').click();
    await expect(page).toHaveURL(/\/financeiro\/orcamento\/projetos/);
    await expect(page.getByTestId('tela-projetos-resultado')).toBeVisible();
    await semViolacaoAxe(page);

    // Cadastro: etapa acima da verba aparece na hora e trava o botão.
    await page.getByTestId('prj-novo').click();
    await page.getByTestId('prj-codigo').fill('obra-1');
    await page.getByTestId('prj-descricao').fill('Reforma sintética');
    await escolher(page.getByTestId('prj-situacao'), 'em_andamento');
    await page.getByTestId('prj-verba').fill('1000');
    await page.getByTestId('prj-incluir-etapa').click();
    await page.getByTestId('prj-etapa-0-descricao').fill('Execução');
    await page.getByTestId('prj-etapa-0-valor').fill('1200');
    await expect(page.getByTestId('prj-problemas')).toContainText('passa da verba');
    await expect(page.getByTestId('prj-gravar')).toBeDisabled();
    await page.getByTestId('prj-etapa-0-valor').fill('800');
    await page.getByTestId('prj-incluir-centro').click();
    await escolher(page.getByTestId('prj-centro-0'), '7');
    await page.getByTestId('prj-centro-0-percentual').fill('100');
    await expect(page.getByTestId('prj-problemas')).toHaveCount(0);
    await semViolacaoAxe(page);
    await page.getByTestId('prj-gravar').click();
    await expect(page.getByTestId('prj-aviso')).toBeVisible();
    expect(corpos['projeto']).toMatchObject({
      codigo: 'obra-1',
      verba: 1000,
      situacao: 'em_andamento',
      etapas: [{ sequencia: 1, valorPrevisto: 800 }],
      centros: [{ centroCusto: 7, percentual: 100 }],
    });

    // Projeto aberto com o resultado; apropriação do título pelo percentual com a prévia.
    await expect(page.getByTestId('prj-detalhe')).toBeVisible();
    await expect(page.getByTestId('prj-res-saldo')).toContainText('1.000,00');
    await page.getByTestId('prj-apr-busca').fill('902107');
    await page.getByTestId('prj-apr-buscar').click();
    await escolher(page.getByTestId('prj-apr-etapa'), '11');
    await page.getByTestId('prj-apr-percentual').fill('140');
    await expect(page.getByTestId('prj-apr-problemas')).toBeVisible();
    await expect(page.getByTestId('prj-apr-gravar')).toBeDisabled();
    await page.getByTestId('prj-apr-percentual').fill('40');
    await expect(page.getByTestId('prj-apr-previa')).toContainText('200,00');
    await semViolacaoAxe(page);
    await page.getByTestId('prj-apr-gravar').click();
    expect(corpos['apropriacao']).toMatchObject({
      origem: 'titulo',
      documento: 31,
      etapa: 11,
      percentual: 40,
    });
    await expect(page.getByTestId('prj-res-despesa')).toContainText('200,00');

    // Estorno com o motivo: a linha fica como estornada, nada some.
    await page.getByTestId('prj-estornar-21').click();
    await page.getByTestId('prj-estorno-motivo').fill('Lançado no projeto errado');
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('prj-estorno-confirmar').click();
    const dialogo = page.getByRole('alertdialog');
    if (await dialogo.isVisible().catch(() => false))
      await dialogo
        .getByRole('button', { name: /confirmar/i })
        .last()
        .click();
    await expect(page.getByTestId('prj-apr-linha-21')).toContainText('Estornada');
    expect(corpos['estorno']).toMatchObject({ versao: 1, motivo: 'Lançado no projeto errado' });
    await semViolacaoAxe(page);
  });
});
