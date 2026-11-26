// E2E @C1-124 (05-SUP linha 12): produção interna da farmácia e da central pelas rotas reais do módulo (o
// ProducaoInternaController registrado no modulo.ts, sem depender do módulo de cirurgia). O farmacêutico da manipulação
// (SINT.MANIPULACAO, o do E2E M46) abre a tela pela manipulação (link "Produção interna: lotes e kits"). A porta grava
// só no banco próprio: na sessão sintética de dev/ci (logins SINT.*, sem o núcleo), GET /api/farmacia/producao-interna
// responde 503 e a tela mostra o erro sem inventar ordem nem kit (primeiro teste). O segundo teste simula as rotas
// (page.route com respostas sintéticas) e percorre a tela: fechamento da ordem baixada (rendimento acima recusado na
// hora, prévia do custo do lote com as parcelas, POST com a Idempotency-Key) e montagem do kit (produto igual a um
// componente recusado na hora, consumo da composição impresso, POST). O efeito no MariaDB (lote_produzido,
// lote_produzido_custo, entrada no estoque e o kit montado) está em
// apps/api/src/modulos/suprimentos/producao-interna.int.spec.ts. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const B = '/api/farmacia/producao-interna';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Abre a tela pelo link da manipulação e devolve o status da leitura do painel. */
async function abrirPelaManipulacao(page: Page): Promise<number> {
  await page.goto('/farmacia/manipulacao');
  await expect(page.getByTestId('tela-manipulacao')).toBeVisible();
  const leitura = page.waitForResponse(
    (r) => new URL(r.url()).pathname === B && r.request().method() === 'GET',
  );
  await page.getByTestId('manip-producao-interna').click();
  await expect(page).toHaveURL(/\/farmacia\/producao-interna$/);
  await expect(page.getByTestId('tela-farmacia-producao-interna')).toBeVisible();
  return (await leitura).status();
}

test.describe('@C1-124 Produção interna: lote produzido e kit montado', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('pela manipulação; sem o banco do cliente, a tela mostra o erro e não oferece gravação; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    await entrar(page, 'SINT.MANIPULACAO');
    const status = await abrirPelaManipulacao(page);
    const tela = page.getByTestId('tela-farmacia-producao-interna');
    if (status === 503) {
      await expect(tela.getByTestId('mensagem-erro').first()).toBeVisible();
      await expect(tela.getByTestId('prod-fechar')).toHaveCount(0);
      await expect(tela.getByTestId('prod-kit')).toHaveCount(0);
    } else {
      expect(status).toBe(200);
    }
    await semViolacaoAxe(page, '/farmacia/producao-interna');
  });

  test('fechamento da ordem e montagem do kit com a API simulada, validação na hora; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    const json = (rota: Route, corpo: unknown, status = 200) =>
      rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
    const posts: { caminho: string; corpo: Record<string, unknown>; chave: string | null }[] = [];
    const lote = (id: number, tipo: 'manipulacao' | 'kit_montado', numeroLote: string) => ({
      id,
      tipo,
      numeroLote,
      produto: tipo === 'manipulacao' ? 51 : 61,
      produtoNome: tipo === 'manipulacao' ? 'Bolsa sintética de nutrição' : 'Kit sintético de curativo',
      local: 1,
      ordem: tipo === 'manipulacao' ? 31 : null,
      ordemNumero: tipo === 'manipulacao' ? 8 : null,
      kit: tipo === 'kit_montado' ? 4 : null,
      kitNome: tipo === 'kit_montado' ? 'Curativo sintético' : null,
      quantidadeProduzida: tipo === 'manipulacao' ? 10 : 2,
      perda: 0,
      produzidoEm: '2026-11-25T10:00',
      validadeEm: '2026-11-27T10:00',
      valorTotal: 125,
      custoUnitario: 12.5,
      situacao: 'disponivel',
      custos: [],
    });
    const painel = {
      hoje: '2026-11-25',
      agora: '2026-11-25T10:00',
      aFechar: [
        {
          id: 31,
          numero: 8,
          versao: 3,
          finalidade: 'prescricao',
          produto: 51,
          produtoNome: 'Bolsa sintética de nutrição',
          quantidadePrevista: 10,
          valorInsumos: 100,
          validadeSugerida: '2026-11-27T10:00',
        },
      ],
      custos: [
        { id: 2, descricao: 'Hora da capela sintética', valor: 12.5 },
        { id: 3, descricao: 'Custo sem valor sintético', valor: null },
      ],
      kits: [
        {
          id: 4,
          codigo: 'KS-1',
          nome: 'Curativo sintético',
          componentes: [
            { insumo: 71, nome: 'Gaze sintética', quantidade: 2 },
            { insumo: 72, nome: 'Luva sintética', quantidade: 1 },
          ],
        },
      ],
      locais: [{ id: 1, nome: 'Farmácia central sintética' }],
      lotes: [] as ReturnType<typeof lote>[],
    };
    const item = (codigo: number, nome: string) => ({
      codigo,
      nome,
      unidade: 'UN',
      rastreavel: true,
      controlado: false,
      antimicrobiano: false,
      consignado: false,
      ativo: true,
    });
    await page.route('**/api/suprimentos/itens**', (rota) =>
      json(rota, [item(71, 'Gaze sintética'), item(61, 'Kit sintético de curativo')]),
    );
    await page.route(`**${B}**`, async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      if (req.method() === 'POST') {
        const corpo = req.postDataJSON() as Record<string, unknown>;
        posts.push({ caminho: url.pathname, corpo, chave: req.headers()['idempotency-key'] ?? null });
        const gravado = (numeroLote: string, saidaPaciente: number | null = null) => ({
          id: 90 + posts.length,
          numeroLote,
          loteEstoque: 500 + posts.length,
          movimento: 700 + posts.length,
          valorInsumos: 100,
          valorIndireto: 25,
          valorAdicional: 0,
          valorTotal: 125,
          custoUnitario: 12.5,
          saidaPaciente,
        });
        if (url.pathname === `${B}/ordens/31/fechamento`) {
          painel.aFechar = [];
          painel.lotes.unshift(lote(91, 'manipulacao', 'MP-20261125-0001'));
          // A ordem é a dose do paciente: o lote sai direto a ele (saída devolvida pela API).
          return json(rota, gravado('MP-20261125-0001', 801), 201);
        }
        if (url.pathname === `${B}/kits`) {
          painel.lotes.unshift(lote(92, 'kit_montado', 'KT-20261125-0001'));
          return json(rota, gravado('KT-20261125-0001'), 201);
        }
      }
      if (url.pathname === B) {
        expect(url.searchParams.get('de')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(url.searchParams.get('ate')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        return json(rota, painel);
      }
      return rota.fallback();
    });

    await entrar(page, 'SINT.MANIPULACAO');
    await abrirPelaManipulacao(page);
    const tela = page.getByTestId('tela-farmacia-producao-interna');
    await expect(tela.getByTestId('prod-ordem-31')).toContainText('Bolsa sintética de nutrição');
    await expect(tela.getByTestId('prod-ordem-31')).toContainText('Dose do paciente');

    // ---------------- fechamento da ordem baixada
    await tela.getByTestId('prod-escolher-31').click();
    const fechamento = tela.getByTestId('prod-fechamento');
    // A dose individual avisa que o lote vai ao paciente e não ao saldo livre do local.
    await expect(fechamento.getByTestId('prod-dose')).toContainText('não entra no saldo livre');
    // A validade vem sugerida pela ordem; a quantidade produzida, pela prevista.
    await expect(fechamento.getByTestId('prod-validade')).toHaveValue('2026-11-27T10:00');
    await expect(fechamento.getByTestId('prod-produzida')).toHaveValue('10');
    // Validação na hora: produzido mais perda passa da prevista mais a tolerância.
    await fechamento.getByTestId('prod-perda').fill('2');
    await expect(fechamento.getByTestId('prod-fechamento-recusas')).toBeVisible();
    await expect(fechamento.getByTestId('prod-fechar-gravar')).toBeDisabled();
    await fechamento.getByTestId('prod-perda').fill('0');
    await expect(fechamento.getByTestId('prod-fechamento-recusas')).toHaveCount(0);
    // O custo sem valor vigente não é oferecido; o com valor entra com as parcelas impressas.
    await expect(fechamento.getByTestId('prod-custo-3')).toHaveCount(0);
    await fechamento.getByTestId('prod-custo-2').fill('2');
    await expect(fechamento.getByTestId('prod-previa')).toContainText(
      'Hora da capela sintética: 2 × R$ 12,50 = R$ 25,00',
    );
    await expect(fechamento.getByTestId('prod-previa-total')).toContainText('R$ 125,00');
    await expect(fechamento.getByTestId('prod-previa-unidade')).toContainText('R$ 12,50');
    await semViolacaoAxe(page, '/farmacia/producao-interna');
    await fechamento.getByTestId('prod-fechar-gravar').click();
    await expect(tela.getByTestId('prod-aviso')).toContainText('MP-20261125-0001');
    await expect(tela.getByTestId('prod-aviso')).toContainText('entregue ao paciente');
    await expect(tela.getByTestId('prod-lotes')).toContainText('MP-20261125-0001');
    await expect(tela.getByTestId('prod-ordens')).toHaveCount(0);

    // ---------------- montagem do kit
    const montagem = tela.getByTestId('prod-montagem');
    await escolher(montagem.getByTestId('prod-kit-kit'), { rotulo: /Curativo sintético/ });
    await escolher(montagem.getByTestId('prod-kit-local'), { rotulo: /Farmácia central sintética/ });
    await montagem.getByTestId('prod-kit-quantidade').fill('3');
    await montagem.getByTestId('prod-kit-validade').fill('2026-12-20T18:00');
    await expect(montagem.getByTestId('prod-kit-consumo')).toContainText('Gaze sintética: 2 por kit × 3 = 6');
    await expect(montagem.getByTestId('prod-kit-consumo')).toContainText('Luva sintética: 1 por kit × 3 = 3');
    // Validação na hora: o produto do kit não pode ser um dos componentes.
    await montagem.getByTestId('prod-kit-busca-termo').fill('sintét');
    await montagem.getByTestId('prod-kit-busca-buscar').click();
    await montagem.getByTestId('prod-kit-busca-opcao-71').click();
    await expect(montagem.getByTestId('prod-kit-recusas')).toContainText('não pode ser um dos componentes');
    await expect(montagem.getByTestId('prod-kit-gravar')).toBeDisabled();
    await montagem.getByRole('button', { name: 'Trocar' }).click();
    await montagem.getByTestId('prod-kit-busca-termo').fill('kit');
    await montagem.getByTestId('prod-kit-busca-buscar').click();
    await montagem.getByTestId('prod-kit-busca-opcao-61').click();
    await expect(montagem.getByTestId('prod-kit-recusas')).toHaveCount(0);
    // Kits inteiros: 1,5 kit é recusado na hora.
    await montagem.getByTestId('prod-kit-quantidade').fill('1,5');
    await expect(montagem.getByTestId('prod-kit-recusas')).toBeVisible();
    await montagem.getByTestId('prod-kit-quantidade').fill('3');
    await expect(montagem.getByTestId('prod-kit-gravar')).toBeEnabled();
    await montagem.getByTestId('prod-kit-gravar').click();
    await expect(tela.getByTestId('prod-aviso')).toContainText('KT-20261125-0001');
    await expect(tela.getByTestId('prod-lotes')).toContainText('Kit montado');

    expect(posts).toHaveLength(2);
    for (const p of posts) expect(p.chave).toMatch(/^[A-Za-z0-9._:-]{8,80}$/);
    expect(posts[0]!.caminho).toBe(`${B}/ordens/31/fechamento`);
    expect(posts[0]!.corpo).toMatchObject({
      versaoVista: 3,
      quantidadeProduzida: 10,
      perda: 0,
      validadeEm: '2026-11-27T10:00',
      numeroLote: null,
      custos: [{ custo: 2, quantidade: 2 }],
      valorAdicional: 0,
    });
    expect(posts[1]!.caminho).toBe(`${B}/kits`);
    expect(posts[1]!.corpo).toMatchObject({
      kit: 4,
      produto: 61,
      local: 1,
      quantidadeKits: 3,
      validadeEm: '2026-12-20T18:00',
      numeroLote: null,
      custos: [],
      valorAdicional: 0,
    });
  });
});
