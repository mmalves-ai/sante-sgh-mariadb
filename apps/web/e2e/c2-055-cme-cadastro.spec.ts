// F7 (04-CME linha 115) @C2-055: cadastro da CME pelo caminho da tela. As rotas exigem o banco próprio e o E2E roda
// com a fonte sintética, então as respostas da API são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a
// tela: o produto reprocessável com a esterilização sem limpeza antes trava o salvar na hora e, com a limpeza marcada,
// grava as fases na ordem do fluxo; a caixa sem peça trava o salvar, a composição em ordem (produto e item do estoque,
// subir e descer) vai inteira com as fases; a caixa gravada abre com as peças e a foto de conferência que não é imagem
// é recusada na hora, sem envio. O efeito no banco está no contrato de efeito
// apps/api/src/modulos/cirurgia/cme-cadastro-propria.int.spec.ts.
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

const FASES = [
  {
    id: 1,
    codigo: 'REC',
    descricao: 'Recepção',
    ordem: 1,
    ativo: true,
    exigeCiclo: false,
    exigeOperador: true,
  },
  {
    id: 2,
    codigo: 'LIM',
    descricao: 'Limpeza',
    ordem: 2,
    ativo: true,
    exigeCiclo: false,
    exigeOperador: true,
  },
  {
    id: 5,
    codigo: 'EST',
    descricao: 'Esterilização',
    ordem: 5,
    ativo: true,
    exigeCiclo: true,
    exigeOperador: true,
  },
];

const PRODUTO = {
  id: 31,
  descricao: 'PINCA SINTETICA',
  tipo: 'instrumental',
  codigoBarras: 'SINT-0001',
  insumo: null,
  bem: null,
  metodo: null,
  embalagem: null,
  guarda: null,
  limiteReprocessamentos: 10,
  contadorReprocessamentos: 9,
  restante: 1,
  alertaLimite: 'perto',
  validadeDias: 30,
  tempoMinutos: null,
  temperaturaCelsius: null,
  tecnicaExpurgo: null,
  tecnicaDesinfeccao: null,
  tecnicaPreparo: null,
  tecnicaEsterilizacao: null,
  conservacao: null,
  situacao: 'ativo',
  versao: 1,
  fases: [
    { fase: 2, descricao: 'Limpeza', ordem: 1, obrigatoria: true },
    { fase: 5, descricao: 'Esterilização', ordem: 2, obrigatoria: true },
  ],
};

function painel(comCaixa: boolean) {
  return {
    produtos: [PRODUTO],
    caixas: comCaixa
      ? [
          {
            id: 41,
            codigo: 'CX-SINT',
            descricao: 'CAIXA SINTETICA',
            natureza: 'caixa',
            ativo: true,
            pecas: 2,
            fases: 2,
            temFoto: false,
            alertaLimite: 'sem_limite',
            versao: 1,
          },
        ]
      : [],
    fases: FASES,
    metodos: [{ id: 3, descricao: 'VAPOR SINTETICO' }],
    embalagens: [{ id: 4, descricao: 'EMBALAGEM SINTETICA', validadeDias: 30 }],
    setores: [{ id: 6, nome: 'ARSENAL SINTETICO' }],
    especialidades: [],
    insumos: [{ id: 7, descricao: 'COMPRESSA SINTETICA' }],
  };
}

const CAIXA = {
  id: 41,
  codigo: 'CX-SINT',
  descricao: 'CAIXA SINTETICA',
  descricaoResumida: null,
  natureza: 'caixa',
  especialidade: null,
  metodo: 3,
  embalagem: null,
  setor: null,
  validadeDias: 30,
  controlaReprocessamentos: false,
  limiteReprocessamentos: null,
  reprocessamentos: 0,
  alertaLimite: 'sem_limite',
  etiquetasPreparo: 1,
  etiquetasEsterilizacao: 1,
  ativo: true,
  temFoto: false,
  versao: 1,
  pecas: [
    {
      id: 51,
      sequencia: 1,
      produto: null,
      insumo: 7,
      bem: null,
      descricao: 'COMPRESSA SINTETICA',
      quantidade: 2,
      pecaMestre: false,
      codigoBarras: null,
      suspenso: false,
      temFoto: false,
      versao: 1,
    },
    {
      id: 52,
      sequencia: 2,
      produto: 31,
      insumo: null,
      bem: null,
      descricao: 'PINCA SINTETICA',
      quantidade: 1,
      pecaMestre: true,
      codigoBarras: null,
      suspenso: false,
      temFoto: false,
      versao: 1,
    },
  ],
  fases: PRODUTO.fases,
};

async function simular(page: Page, enviados: Record<string, unknown>[]): Promise<void> {
  let comCaixa = false;
  await page.route('**/api/cirurgia/cme/cadastro', (r) => json(r, painel(comCaixa)));
  await page.route('**/api/cirurgia/cme/cadastro/produtos', (r) => {
    enviados.push({ rota: 'produto', ...(r.request().postDataJSON() as Record<string, unknown>) });
    return json(r, { produto: 31, versao: 1 }, 201);
  });
  await page.route('**/api/cirurgia/cme/cadastro/caixas', (r) => {
    enviados.push({ rota: 'caixa', ...(r.request().postDataJSON() as Record<string, unknown>) });
    comCaixa = true;
    return json(r, { caixa: 41, versao: 1, pecas: 2 }, 201);
  });
  await page.route('**/api/cirurgia/cme/cadastro/caixas/41', (r) => json(r, CAIXA));
  await page.route('**/api/cirurgia/cme/cadastro/caixas/41/foto', (r) => {
    enviados.push({ rota: 'foto' });
    return json(r, { arquivo: 1, versao: 2 });
  });
}

test.describe('@C2-055 cadastro da CME (04-CME linha 115)', () => {
  test('produto com fases conferidas na hora e caixa com composição em ordem', async ({ page }) => {
    const enviados: Record<string, unknown>[] = [];
    await simular(page, enviados);
    await entrar(page, 'SINT.ADMIN');

    await page.goto('/cirurgia/cme/cadastro');
    await expect(page.getByTestId('tela-cme-cadastro')).toBeVisible();
    // O produto perto do limite do fabricante aparece com o alerta.
    await expect(page.getByTestId('cme-produto-alerta-31')).toContainText('9 / 10');

    // Produto: a esterilização sem limpeza antes trava o salvar.
    await page.getByTestId('cme-produto-descricao').fill('TESOURA SINTETICA');
    await page.getByTestId('cme-produto-fase-5').check();
    await expect(page.getByTestId('cme-produto-problemas')).toContainText('exige ciclo');
    await expect(page.getByTestId('cme-produto-salvar')).toBeDisabled();
    await page.getByTestId('cme-produto-fase-2').check();
    await expect(page.getByTestId('cme-produto-problemas')).toBeHidden();
    await escolher(page.getByTestId('cme-produto-metodo'), { rotulo: 'VAPOR SINTETICO' });
    await page.getByTestId('cme-produto-limite').fill('200');
    await page.getByTestId('cme-produto-salvar').click();
    await expect(page.getByTestId('cme-cad-aviso')).toBeVisible();
    const prod = enviados.find((e) => e['rota'] === 'produto')!;
    expect(prod).toMatchObject({ descricao: 'TESOURA SINTETICA', metodo: 3, limiteReprocessamentos: 200 });
    expect((prod['fases'] as { fase: number }[]).map((f) => f.fase)).toEqual([2, 5]);

    // Caixa: sem peça escolhida, o salvar fica travado; a composição vai em ordem com as fases.
    await page.getByTestId('cme-aba-caixas').click();
    await page.getByTestId('cme-caixa-codigo').fill('CX-SINT');
    await page.getByTestId('cme-caixa-descricao').fill('CAIXA SINTETICA');
    await expect(page.getByTestId('cme-caixa-problemas')).toBeVisible();
    await expect(page.getByTestId('cme-caixa-salvar')).toBeDisabled();
    await escolher(page.getByTestId('cme-peca-0-produto'), { rotulo: /PINCA SINTETICA/ });
    await page.getByTestId('cme-peca-0-mestre').check();
    await page.getByTestId('cme-nova-peca').click();
    await escolher(page.getByTestId('cme-peca-1-origem'), { rotulo: 'Item do estoque' });
    await escolher(page.getByTestId('cme-peca-1-insumo'), { rotulo: 'COMPRESSA SINTETICA' });
    await page.getByTestId('cme-peca-1-quantidade').fill('2');
    await page.getByTestId('cme-peca-1-subir').click();
    await page.getByTestId('cme-caixa-fase-2').check();
    await page.getByTestId('cme-caixa-fase-5').check();
    await expect(page.getByTestId('cme-caixa-problemas')).toBeHidden();
    await page.getByTestId('cme-caixa-salvar').click();
    const cx = enviados.find((e) => e['rota'] === 'caixa')!;
    expect(cx).toMatchObject({ codigo: 'CX-SINT', natureza: 'caixa' });
    expect(cx['pecas']).toEqual([
      expect.objectContaining({ insumo: 7, produto: null, quantidade: 2 }),
      expect.objectContaining({ produto: 31, insumo: null, quantidade: 1, pecaMestre: true }),
    ]);
    expect((cx['fases'] as { fase: number }[]).map((f) => f.fase)).toEqual([2, 5]);

    // A caixa gravada abre com as peças; a foto que não é imagem é recusada na hora, sem envio.
    await page.getByTestId('cme-caixa-editar-41').click();
    await expect(page.getByTestId('cme-peca-1')).toContainText('Peça 2');
    await page.getByTestId('cme-caixa-foto').setInputFiles({
      name: 'nota.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('texto sintetico'),
    });
    await expect(page.getByTestId('cme-foto-erro')).toContainText('PNG, JPEG ou WebP');
    expect(enviados.some((e) => e['rota'] === 'foto')).toBe(false);

    await semViolacaoAxe(page);
  });
});
