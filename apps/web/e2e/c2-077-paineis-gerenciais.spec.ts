// E2E @C2-077 (F3, 01-REL L112): painéis gerenciais montados pelo hospital, pela tela /relatorios/paineis-gerenciais
// aberta pelo menu Relatórios e BI > Painéis montados. O administrador abre o painel em uso e lê o indicador apurado
// (valor, numerador e denominador, meta, situação, variação e a série); monta o painel (quadro de indicador e de
// texto, perfil liberado), vê a conferência na hora (indicador repetido na mesma forma) e salva; um painel em montagem
// vazio não deixa pôr em uso. As rotas /api/relatorios/paineis-gerenciais exigem o banco próprio e o E2E roda com a
// fonte sintética: as respostas são simuladas pelo Playwright com massa SINTÉTICA (só agregados). O efeito no banco
// está em apps/api/src/modulos/relatorio/painel-gerencial-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

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
  id: 7,
  codigo: 'DIR-ASSIST',
  nome: 'Diretoria assistencial',
  descricao: null,
  publico: 'diretoria',
  periodoPadrao: 'ultimos_3_meses',
  ativo: true,
  rede: false,
  donoId: 1,
  versao: 3,
  itens: 1,
  permissoes: 1,
};
const ponto = (competencia: string, numerador: number, denominador: number, situacaoMeta: string) => ({
  competencia,
  valor: (numerador / denominador) * 100,
  numerador,
  denominador,
  meta: 80,
  situacaoMeta,
});
const aberto = {
  painel: {
    id: 7,
    nome: 'Diretoria assistencial',
    descricao: null,
    periodoPadrao: 'ultimos_3_meses',
    ativo: true,
  },
  periodo: { de: '2026-08-01', ate: '2026-10-01' },
  exportar: true,
  quadros: [
    {
      tipo: 'indicador',
      indicadorId: 31,
      indicadorNome: 'Taxa de ocupação',
      titulo: null,
      texto: null,
      forma: 'barra',
      largura: 2,
      casasDecimais: 1,
      exibirMeta: true,
      indicador: {
        id: 31,
        codigo: 'OCUP',
        nome: 'Taxa de ocupação',
        unidade: 'percentual',
        simbolo: '%',
        casasDecimais: 1,
        polaridade: 'maior_melhor',
        ultima: ponto('2026-10-01', 171, 200, 'na_meta'),
        variacao: 22.1,
        serie: [ponto('2026-09-01', 70, 100, 'fora_da_meta'), ponto('2026-10-01', 171, 200, 'na_meta')],
      },
    },
  ],
};
const detalhe = {
  ...resumo,
  itens: [
    {
      tipo: 'indicador',
      indicadorId: 31,
      indicadorNome: 'Taxa de ocupação',
      titulo: null,
      texto: null,
      forma: 'barra',
      largura: 2,
      casasDecimais: 1,
      exibirMeta: true,
    },
  ],
  permissoes: [
    {
      perfilId: 5,
      usuarioId: null,
      perfilNome: 'Diretoria clínica',
      podeExportar: true,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    },
  ],
};
const catalogo = {
  indicadores: [
    { id: 31, codigo: 'OCUP', nome: 'Taxa de ocupação', unidade: 'percentual', casasDecimais: 1 },
    { id: 32, codigo: 'PERM', nome: 'Média de permanência', unidade: 'dias', casasDecimais: 1 },
  ],
  perfis: [
    { id: 5, codigo: 'diretoria-clinica', nome: 'Diretoria clínica' },
    { id: 6, codigo: 'gestao-qualidade', nome: 'Gestão da qualidade' },
  ],
};

test.describe('Painéis gerenciais montados @C2-077 @fase3', () => {
  test.setTimeout(120_000);
  test('abrir o painel em uso, montar com conferência na hora e salvar; axe', async ({ page }) => {
    let salvo: Record<string, unknown> | null = null;
    await page.route('**/api/relatorios/paineis-gerenciais**', async (r) => {
      const u = new URL(r.request().url());
      const metodo = r.request().method();
      if (metodo === 'PUT') {
        salvo = r.request().postDataJSON() as Record<string, unknown>;
        return json(r, { id: 7, versao: 4 });
      }
      if (u.pathname.endsWith('/catalogo')) return json(r, catalogo);
      if (u.pathname.endsWith('/7/abrir')) return json(r, aberto);
      if (u.pathname.endsWith('/7')) return json(r, detalhe);
      return json(r, { itens: [resumo] });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/relatorios/paineis-gerenciais');
    await expect(page.getByTestId('tela-paineis-gerenciais')).toBeVisible();
    await page.getByTestId('pg-painel-7').click();
    await expect(page.getByTestId('pg-visao')).toContainText('Taxa de ocupação');
    await expect(page.getByTestId('pg-quadro-0-valor')).toContainText('85,5');
    await expect(page.getByTestId('pg-quadro-0-fracao')).toContainText('171 de 200');
    await expect(page.getByTestId('pg-quadro-0-meta')).toContainText('Na meta');
    await expect(page.getByTestId('pg-quadro-0-variacao')).toContainText('22,1%');
    await semViolacaoAxe(page, 'painel gerencial aberto');

    await page.getByTestId('pg-montar').click();
    const editor = page.getByTestId('pg-editor');
    await expect(editor).toBeVisible();
    await esperarSemSelectNativo(editor);
    // Um segundo quadro do mesmo indicador na mesma forma: a conferência acusa na hora e o salvar fica desligado.
    await escolher(page.getByTestId('pg-novo-tipo'), { rotulo: 'Indicador' });
    await page.getByTestId('pg-incluir').click();
    await escolher(page.getByTestId('pg-item-1-indicador'), { rotulo: 'Taxa de ocupação' });
    await escolher(page.getByTestId('pg-item-1-forma'), { rotulo: 'Barras' });
    await expect(page.getByTestId('pg-item-1-erro')).toContainText('mesmo indicador');
    await expect(page.getByTestId('pg-salvar')).toBeDisabled();
    await escolher(page.getByTestId('pg-item-1-indicador'), { rotulo: 'Média de permanência' });
    await expect(page.getByTestId('pg-item-1-erro')).toHaveCount(0);

    await escolher(page.getByTestId('pg-novo-tipo'), { rotulo: 'Texto' });
    await page.getByTestId('pg-incluir').click();
    await page.getByTestId('pg-item-2-texto').fill('Ocupação acima da meta no trimestre.');
    await escolher(page.getByTestId('pg-perfil'), { rotulo: 'Gestão da qualidade' });
    await page.getByTestId('pg-liberar').click();
    await semViolacaoAxe(page, 'montagem do painel gerencial');

    await page.getByTestId('pg-salvar').click();
    await expect(page.getByTestId('pg-aviso')).toContainText('Painel salvo');
    expect(salvo).not.toBeNull();
    const corpo = salvo as unknown as {
      itens: { indicadorId: number | null; forma: string }[];
      permissoes: unknown[];
    };
    expect(corpo.itens.map((i) => [i.indicadorId, i.forma])).toEqual([
      [31, 'barra'],
      [32, 'barra'],
      [null, 'texto'],
    ]);
    expect(corpo.permissoes).toHaveLength(2);
  });
});
