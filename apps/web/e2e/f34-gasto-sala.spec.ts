// F3.4-5 (04-CC linha 100): a tela do gasto de sala do ato. A sugestão da lista padrão entra num clique, a validação
// roda na hora (o lote do produto com rastreio e o motivo do obrigatório não usado: o salvar só libera quando tudo
// está certo), e conferir e debitar aparecem pela situação e pelo nível de acesso. Axe em cada passo.
// API simulada com massa SINTÉTICA (nenhuma pessoa real): o que fica no banco é provado pelo contrato de efeito
// (apps/api/src/modulos/cirurgia/gasto-sala-propria.int.spec.ts, inclusive o débito com conta aberta).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const ATO = 77;

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

const sugestao = [
  { insumo: 11, insumoNome: 'FIO SINTETICO', quantidade: 2, obrigatorio: false, linhas: [1] },
  { insumo: 12, insumoNome: 'COMPRESSA SINTETICA', quantidade: 1, obrigatorio: true, linhas: [2] },
];
const base = {
  ato: {
    id: ATO,
    numero: 'SINT-77',
    atendimento: 5,
    situacao: 'realizado',
    tipoAnestesia: null,
    procedimentos: [{ id: 3, descricao: 'PROCEDIMENTO SINTETICO' }],
  },
  motivos: [],
  cirurgiaoLista: 9,
  sugestao,
};
const gasto = (situacao: string, versao: number) => ({
  id: 40,
  situacao,
  local: 21,
  conta: null,
  cirurgiao: 9,
  conferidoEm: null,
  conferidoPor: null,
  debitadoEm: null,
  observacao: null,
  versao,
});
const itemGravado = {
  id: 1,
  sequencia: 1,
  insumo: 11,
  insumoNome: 'FIO SINTETICO',
  quantidade: 2,
  lote: 31,
  implantePermanente: false,
  faturar: true,
  movimento: null,
  itemConta: null,
};

test.describe('centro cirúrgico: gasto de sala do ato @F34-5', () => {
  test.setTimeout(180_000);

  test('sugestão num clique, lote e motivo na hora, salvar, conferir e debitar; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let estado: Record<string, unknown> = { ...base, gasto: null, itens: [], diferencas: [], pendencias: [] };
    await page.route('**/api/cirurgia/gasto-sala/**', async (r) => {
      const u = new URL(r.request().url());
      const caminho = u.pathname.replace('/api/cirurgia/gasto-sala', '');
      if (r.request().method() === 'GET') {
        if (caminho === '/apoio')
          return json(r, {
            locais: [{ id: 21, nome: 'ARSENAL SINTETICO', comCentro: true }],
            produtos: [],
          });
        if (caminho === '/lotes')
          return json(r, {
            itens:
              u.searchParams.get('insumo') === '11'
                ? [{ id: 31, numero: 'LSINT1', validade: '2027-03-31', saldo: 10 }]
                : [],
          });
        if (caminho === '/lista') return json(r, { itens: [] });
        return json(r, estado);
      }
      const corpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, corpo });
      if (caminho === `/atos/${ATO}`)
        estado = {
          ...estado,
          gasto: gasto('aberta', 1),
          itens: [itemGravado],
          motivos: [
            { tipo: 'item_nao_usado', insumo: 12, motivo: 'paciente alergico', registradoEm: '', usuario: 1 },
          ],
          diferencas: [{ insumo: 12, sugerido: 1, lancado: 0, tipo: 'nao_usado' }],
        };
      else if (caminho.endsWith('/conferir')) estado = { ...estado, gasto: gasto('conferida', 2) };
      else if (caminho.endsWith('/debitar'))
        estado = { ...estado, gasto: { ...gasto('debitada', 3), conta: 8 } };
      return json(r, { id: 40 });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto(`/cirurgia/gasto-sala/${ATO}`);
    await expect(page.getByTestId('tela-gasto-sala')).toBeVisible();
    await expect(page.getByTestId('gasto-situacao')).toContainText('ainda não lançado');

    // A sugestão entra num clique; o salvar fica preso até o local, o lote e o motivo.
    await page.getByTestId('gasto-usar-sugestao').click();
    await expect(page.getByTestId('gasto-tabela').locator('tbody tr')).toHaveCount(2);
    const salvar = page.getByTestId('gasto-salvar');
    await expect(salvar).toBeDisabled();
    await expect(page.getByTestId('gasto-problemas')).toContainText('Escolha o local de estoque');
    await escolher(page.getByTestId('gasto-local'), '21');
    await expect(page.getByTestId('gasto-problemas')).toContainText('Item 1: informe o lote');
    await escolher(page.getByTestId('gasto-lote-0'), '31');
    // A compressa (obrigatória) não foi usada: tira e o motivo é pedido na hora.
    await page.getByTestId('gasto-item-1').getByRole('button', { name: 'Tirar' }).click();
    await expect(page.getByTestId('gasto-problemas')).toContainText('Justifique o obrigatório não usado');
    await page.getByTestId('gasto-just-12').fill('paciente alergico');
    await expect(page.getByTestId('gasto-problemas')).toHaveCount(0);
    await semViolacaoAxe(page, 'gasto de sala: lançamento');
    await salvar.click();
    await expect(page.getByTestId('gasto-aviso')).toContainText('Gasto salvo');
    expect(pedidos[0]).toEqual({
      caminho: `/atos/${ATO}`,
      corpo: {
        local: 21,
        cirurgiao: 9,
        itens: [{ insumo: 11, quantidade: 2, lote: 31, implantePermanente: false, faturar: true }],
        justificativas: [{ insumo: 12, motivo: 'paciente alergico' }],
      },
    });

    // Aberto: conferir (pelo nível de quem confere), depois debitar na conta.
    await expect(page.getByTestId('gasto-situacao')).toContainText('aberto');
    await expect(page.getByTestId('gasto-diferencas')).toContainText('não usado');
    await page.getByTestId('gasto-conferir').click();
    await expect(page.getByTestId('gasto-situacao')).toContainText('conferido');
    expect(pedidos[1]).toEqual({ caminho: `/atos/${ATO}/conferir`, corpo: { versao: 1 } });
    // Reabrir pede motivo de 5 letras ou mais.
    await expect(page.getByTestId('gasto-reabrir')).toBeDisabled();
    await semViolacaoAxe(page, 'gasto de sala: conferido');
    await page.getByTestId('gasto-debitar').click();
    await expect(page.getByTestId('gasto-situacao')).toContainText('debitado na conta');
    expect(pedidos[2]).toEqual({ caminho: `/atos/${ATO}/debitar`, corpo: { versao: 2 } });
    await expect(page.getByTestId('gasto-salvar')).toHaveCount(0);
    await expect(page.getByTestId('gasto-debitar')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
