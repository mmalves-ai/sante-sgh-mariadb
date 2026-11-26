// E2E @C2-020 (F3.7, 06-FAT linha 5): o valor do índice de cobrança por vigência na tela do contrato. Quem edita o
// contrato abre a aba das tabelas do convênio sintético, escolhe "Índice de cobrança" e um índice no combo, vê a
// validação na hora (sem data e sem valor nada é gravado), registra uma vigência nova de CH numa data futura e a vê na
// linha do tempo; repetir a mesma data é recusado na hora, no campo, sem pedido ao servidor (a mudança de valor é
// sempre uma vigência nova; nada se apaga). Fonte sintética; axe na seção. Os índices exigem o banco próprio (sem ele a
// API responde 503): aqui a API dos índices é simulada, com estado (a gravação aparece na releitura); o efeito no banco
// é o contrato de efeito da API.
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Uma data futura diferente a cada execução (a mesma data repetida é recusada, de propósito). */
function dataFutura(): string {
  const d = new Date(Date.UTC(2090, 0, 1) + Math.floor(Math.random() * 3_000) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

type Vigencia = {
  tipo: 'indice' | 'porte' | 'porte-anestesico';
  chave: string;
  tabelaId: number | null;
  inicio: string;
  valor: number;
  valorHorarioEspecial: number | null;
};

/** API simulada dos índices do convênio 305: opções e vigências, e a gravação de uma vigência nova. */
async function simularIndices(page: Page): Promise<void> {
  const vigencias: Vigencia[] = [
    {
      tipo: 'indice',
      chave: '1',
      tabelaId: null,
      inicio: '2025-01-01',
      valor: 0.5,
      valorHorarioEspecial: null,
    },
  ];
  const json = (rota: Route, corpo: unknown, status = 200) =>
    rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
  await page.route('**/api/cadastros/convenios/305/indices/**', async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname;
    if (req.method() === 'GET' && caminho.endsWith('/indices/opcoes'))
      return json(rota, {
        indices: [
          { id: 1, codigo: 'CH', descricao: 'CH PADRAO', tipo: 'ch' },
          { id: 2, codigo: 'UCO', descricao: 'UCO', tipo: 'uco' },
        ],
        portes: [{ codigo: '3A', descricao: 'PORTE 3A' }],
        tabelas: [],
        vigencias,
      });
    if (req.method() === 'POST' && caminho.endsWith('/indices/indice')) {
      const c = req.postDataJSON() as {
        indiceId: number;
        tabelaId: number | null;
        vigenciaInicio: string;
        valor: number;
      };
      vigencias.push({
        tipo: 'indice',
        chave: String(c.indiceId),
        tabelaId: c.tabelaId,
        inicio: c.vigenciaInicio,
        valor: c.valor,
        valorHorarioEspecial: null,
      });
      return json(rota, { id: 900 + vigencias.length }, 201);
    }
    return rota.fallback();
  });
}

test.describe('Valor do índice e do porte por vigência @C2-020 @fase3', () => {
  test('vigência nova de CH na linha do tempo; data repetida recusada na hora; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await simularIndices(page);
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/cadastros/convenios');
    await page.getByTestId('convenios-busca').fill('operadora alfa');
    await page.getByTestId('abrir-convenio-305').click();
    await expect(page.getByRole('heading', { level: 1, name: /Contrato do convênio 305/ })).toBeVisible();
    await page.getByTestId('aba-tabelas').click();
    const secao = page.getByTestId('indices-contrato');
    await expect(secao.getByRole('heading', { name: 'Valores dos índices e portes' })).toBeVisible();
    await expect(secao).not.toContainText(/SPDATA|legado|sistema atual/i);

    let gravacoes = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/indices\//.test(new URL(r.url()).pathname)) gravacoes++;
    });

    // Sem índice, data e valor: os erros aparecem e o pedido não sai.
    await page.getByTestId('indices-registrar').click();
    await expect(page.getByTestId('indices-erro-alvo')).toBeVisible();
    await expect(page.getByTestId('indices-erro-vigenciaInicio')).toBeVisible();
    expect(gravacoes).toBe(0);

    // Índice de cobrança do acordo inteiro: o primeiro índice ativo da lista.
    await escolher(page.getByTestId('indices-tipo'), { rotulo: 'Índice de cobrança (CH, UCO, filme)' });
    await escolher(page.getByTestId('indices-alvo'), { indice: 1 });
    await expect(page.getByTestId('indices-erro-alvo')).toHaveCount(0);
    const data = dataFutura();
    await page.getByTestId('indices-campo-vigenciaInicio').fill(data);
    await page.getByTestId('indices-campo-valor').fill('-1');
    await page.getByTestId('indices-campo-valor').blur();
    await expect(page.getByTestId('indices-erro-valor')).toContainText('maior ou igual a zero');
    await page.getByTestId('indices-campo-valor').fill('0.62');
    await expect(page.getByTestId('indices-erro-valor')).toHaveCount(0);
    await semViolacaoAxe(page, 'contrato: valores dos índices e portes');
    await page.getByTestId('indices-registrar').click();
    await expect(page.getByTestId('indices-mensagem')).toContainText('Vigência registrada');
    expect(gravacoes).toBe(1);
    const nova = page.getByTestId(`indices-vigencia-${data}`);
    await expect(nova).toContainText('0,62');
    await expect(nova).toContainText('a partir de');

    // A mesma data de novo: recusada na hora, no campo; nada sai para o servidor.
    await page.getByTestId('indices-campo-vigenciaInicio').fill(data);
    await page.getByTestId('indices-campo-valor').fill('0.7');
    await page.getByTestId('indices-campo-valor').blur();
    await expect(page.getByTestId('indices-erro-vigenciaInicio')).toContainText('vigência nova');
    await page.getByTestId('indices-registrar').click();
    expect(gravacoes).toBe(1);
    await expect(page.getByTestId(`indices-vigencia-${data}`)).toHaveCount(1);
    expect(externas).toEqual([]);
  });
});
