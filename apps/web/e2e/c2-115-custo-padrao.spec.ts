// C2-115 (07-FIN linha 140, F8): custo-padrão por procedimento. Abre a tela pelo menu, cria a ficha do procedimento
// buscado, inclui um insumo com o custo de referência já preenchido (prévia do custo do item na hora), confere a recusa
// na hora da mão de obra sem descrição, ativa a ficha e vê o padrão contra o apurado da competência. Fonte sintética: as
// rotas da API do custo-padrão são simuladas com page.route (sem o banco do cliente a porta própria responde 503); o
// efeito no banco é provado no contrato ficha-custo-padrao-propria.int.spec.ts.
import { expect, type Locator, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe } from './ajuda.js';
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

const campo = (l: Locator) =>
  l.locator('xpath=self::input | self::textarea | .//input | .//textarea').first();
const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const PROC = { id: 9101, codigo: 'E2E-PROC', descricao: 'Procedimento sintético E2E', tempoMinutos: 60 };
const INSUMO = {
  id: 9201,
  codigo: 'E2E-INS',
  descricao: 'Insumo sintético',
  custoUnitario: 5.5,
  unidade: 'unidade de estoque',
};

function simular(page: Page) {
  const estado = {
    situacao: 'rascunho' as 'rascunho' | 'ativa',
    versao: 1,
    itens: [] as Record<string, unknown>[],
  };
  const total = () => estado.itens.reduce((a, i) => a + Number(i['custoTotal']), 0);
  const resumo = () => ({
    id: 77,
    versao: estado.versao,
    procedimento: { id: PROC.id, codigo: PROC.codigo, descricao: PROC.descricao },
    descricao: 'Ficha sintética',
    versaoFicha: '1',
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    situacao: estado.situacao,
    padrao: estado.situacao === 'ativa',
    custoHonorario: 0,
    custoOperacional: total(),
    custoTotal: total(),
    vigenteHoje: estado.situacao === 'ativa',
  });
  let criada = false;
  return page.route('**/api/custos/fichas-padrao**', async (rota) => {
    const req = rota.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (req.method() === 'GET' && p.endsWith('/procedimentos')) return json(rota, [PROC]);
    if (req.method() === 'GET' && p.endsWith('/referencias')) return json(rota, [INSUMO]);
    if (req.method() === 'GET' && p.endsWith('/comparacao'))
      return json(rota, {
        ficha: 77,
        competencia: url.searchParams.get('competencia'),
        apuracao: { id: 1, numeroVersao: 1, situacao: 'apurada' },
        custoPadrao: total(),
        linhas: [
          {
            conta: 1,
            numero: 'E2E-CH1',
            quantidade: 1,
            custoApurado: 1300,
            outrosItens: 0,
            participacaoCent: 10000,
            custoPadrao: total(),
            variacao: 1300 - total(),
            variacaoPercentualCent: 1818,
            classe: 'acima',
          },
        ],
        naoComparaveis: [
          {
            conta: 2,
            numero: 'E2E-CH2',
            quantidade: 1,
            custoApurado: 300000,
            outrosItens: 3,
            participacaoCent: 2500,
          },
        ],
        totalPadrao: total(),
        totalApurado: 1300,
        variacao: 1300 - total(),
        variacaoPercentualCent: 1818,
        classe: 'acima',
        contagem: { dentro: 0, acima: 1, abaixo: 0 },
      });
    if (req.method() === 'GET' && /\/fichas-padrao\/77$/.test(p))
      return json(rota, { ...resumo(), itens: estado.itens, porTipo: { insumo: total() }, versoes: [] });
    if (req.method() === 'GET') return json(rota, criada ? [resumo()] : []);
    if (req.method() === 'POST' && /\/fichas-padrao$/.test(p)) {
      criada = true;
      return json(rota, { id: 77, versao: 1 }, 201);
    }
    if (req.method() === 'POST' && p.endsWith('/itens')) {
      const b = req.postDataJSON() as { quantidade: number; custoUnitario: number | null };
      const unit = b.custoUnitario ?? INSUMO.custoUnitario;
      estado.itens.push({
        id: estado.itens.length + 1,
        sequencia: estado.itens.length + 1,
        tipo: 'insumo',
        referencia: INSUMO.id,
        codigo: INSUMO.codigo,
        descricao: INSUMO.descricao,
        unidade: INSUMO.unidade,
        quantidade: b.quantidade,
        custoUnitario: unit,
        custoTotal: Math.round(b.quantidade * unit * 100),
      });
      estado.versao += 1;
      return json(rota, { id: 77, versao: estado.versao }, 201);
    }
    if (req.method() === 'POST' && p.endsWith('/ativacao')) {
      estado.situacao = 'ativa';
      estado.versao += 1;
      return json(rota, { id: 77, versao: estado.versao });
    }
    return json(rota, { status: 404 }, 404);
  });
}

test.describe('@C2-115 custo-padrão por procedimento', () => {
  test('cria a ficha, inclui o insumo com o custo de referência, ativa e compara com o apurado', async ({
    page,
  }) => {
    await entrar(page, 'SINT.CUSTOS');
    await simular(page);
    await (await itemDoMenu(page, 'Custo-padrão por procedimento')).click();
    await expect(page).toHaveURL(/\/custos\/custo-padrao/);
    await expect(page.getByTestId('cp-vazia')).toBeVisible();
    await semViolacaoAxe(page, '/custos/custo-padrao');

    await page.getByTestId('cp-nova').click();
    await campo(page.getByTestId('cp-nova-busca')).fill('E2E');
    await escolher(page.getByTestId('cp-nova-procedimento'), { rotulo: /E2E-PROC/ });
    await expect(campo(page.getByTestId('cp-nova-descricao'))).toHaveValue(PROC.descricao);
    await page.getByTestId('cp-nova-criar').click();
    await expect(page.getByTestId('cp-detalhe')).toBeVisible();
    await expect(page.getByTestId('cp-situacao')).toHaveText('Rascunho');

    // Mão de obra sem descrição: recusa na hora, botão desligado.
    await escolher(page.getByTestId('cp-item-tipo'), 'mao_de_obra');
    await expect(page.getByTestId('cp-item-problemas')).toContainText('Descreva a mão de obra');
    await expect(page.getByTestId('cp-item-incluir')).toBeDisabled();

    // Insumo: o custo de referência vem preenchido e a prévia aparece.
    await escolher(page.getByTestId('cp-item-tipo'), 'insumo');
    await campo(page.getByTestId('cp-item-busca')).fill('E2E');
    await escolher(page.getByTestId('cp-item-referencia'), { rotulo: /E2E-INS/ });
    await expect(page.getByTestId('cp-item-unitario')).toHaveValue('5,5');
    await page.getByTestId('cp-item-quantidade').fill('2');
    await expect(page.getByTestId('cp-item-previa')).toContainText('R$ 11,00');
    await page.getByTestId('cp-item-incluir').click();
    await expect(page.getByTestId('cp-item-1')).toContainText('E2E-INS');
    await expect(page.getByTestId('cp-total')).toContainText('R$ 11,00');

    await page.getByTestId('cp-ativar').click();
    await page.getByRole('button', { name: /confirmar/i }).click();
    await expect(page.getByTestId('cp-situacao')).toHaveText('Ativa');
    await expect(page.getByTestId('cp-painel-item')).toHaveCount(0);

    await expect(page.getByTestId('cp-comparacao-resumo')).toContainText('apurado R$ 13,00');
    await expect(page.getByTestId('cp-comparacao-tabela')).toContainText('Acima do padrão');
    // A conta com outros itens fica fora da comparação, com o apurado inteiro e a parte do procedimento.
    await expect(page.getByTestId('cp-comparacao-tabela')).not.toContainText('E2E-CH2');
    await expect(page.getByTestId('cp-nao-comparaveis')).toContainText('E2E-CH2');
    await expect(page.getByTestId('cp-nao-comparaveis')).toContainText('25,00%');
    await semViolacaoAxe(page, '/custos/custo-padrao (ativa)');
  });
});
