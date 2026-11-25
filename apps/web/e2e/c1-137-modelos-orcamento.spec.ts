// E2E @C1-137 (F3.7, 06-FAT linha 40): o orçamento de particular gerado de um modelo padrão por procedimento e
// acomodação, pelo caminho da tela /faturamento/modelos-orcamento. Escolhido o modelo, a prévia aparece montada; a linha
// sem preço na tabela particular pede o valor ali mesmo, a prévia é refeita no servidor com o valor digitado (o total
// muda enquanto se digita) e o botão de emitir só libera com o valor informado e o destino (paciente achado pela busca,
// nunca id digitado). O orçamento sai num clique, com o valor da linha sem preço no corpo. As rotas do modelo exigem o
// banco próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas são simuladas pelo Playwright com massa
// SINTÉTICA, no contrato do servidor (ServicoModeloOrcamento: lerModelos, previa, gerarOrcamento). O efeito no banco
// (modelo, prévia, orçamento gerado com a linha sem preço e os itens, inativação) está em
// apps/api/src/modulos/faturamento/particular-adiantamento-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { esperarValor } from './combos.js';

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

const MODELO = 71;
const PACIENTE = 800;
const DIARIA = 300;

/** A prévia do servidor: a diária tem preço na tabela; o honorário (linha 2) não tem até o valor ser informado. */
function previa(precos: Record<string, number>) {
  const honorario = precos['2'];
  const linhas = [
    {
      sequencia: 1,
      tipo: 'diaria',
      itemId: 501,
      funcaoId: null,
      quantidade: 2,
      unitario: DIARIA,
      total: 2 * DIARIA,
      valorPacote: null,
    },
    {
      sequencia: 2,
      tipo: 'honorario',
      itemId: 502,
      funcaoId: 9,
      quantidade: 1,
      unitario: honorario ?? 0,
      total: honorario ?? 0,
      valorPacote: null,
    },
  ];
  const bruto = linhas.reduce((a, l) => a + l.total, 0);
  return {
    fonte: 10,
    linhas,
    bruto,
    administracao: 0,
    acrescimo: 0,
    total: bruto,
    semPreco: honorario === undefined ? [2] : [],
    validadeDias: 30,
  };
}

async function simular(page: Page) {
  const previas: string[] = [];
  const gerados: Record<string, unknown>[] = [];
  await page.route('**/api/faturamento/modelos-orcamento**', (rota) => {
    const req = rota.request();
    const url = new URL(req.url());
    const caminho = url.pathname.replace(/^\/api\/faturamento\/modelos-orcamento\/?/, '');
    const post = req.method() === 'POST';
    if (caminho === '' && !post)
      return json(rota, [
        {
          id: MODELO,
          codigo: 'MOD-SINT',
          descricao: 'PARTO SINTETICO APARTAMENTO',
          procedimentoId: 401,
          procedimento: 'PROCEDIMENTO SINTETICO',
          acomodacaoId: 3,
          acomodacao: 'APARTAMENTO SINTETICO',
          valorFechado: null,
          validadeDias: 30,
          itens: 2,
        },
      ]);
    if (caminho === 'opcoes') return json(rota, { acomodacoes: [], funcoes: [], itens: [] });
    if (caminho === `${MODELO}/previa`) {
      const p = url.searchParams.get('precos') ?? '';
      previas.push(p);
      const precos = Object.fromEntries(
        p
          .split(',')
          .filter(Boolean)
          .map((par) => {
            const [k, v] = par.split(':');
            return [k!, Number(v)];
          }),
      );
      return json(rota, previa(precos));
    }
    if (caminho === `${MODELO}/orcamentos` && post) {
      const corpo = req.postDataJSON() as { precos: Record<string, number> };
      gerados.push(corpo as Record<string, unknown>);
      return json(rota, { id: 9100, numero: 'ORC-000001', total: previa(corpo.precos).total }, 201);
    }
    return json(rota, { title: 'Não encontrado', status: 404 }, 404);
  });
  // A busca do cadastro de pacientes: um paciente sintético para o termo pedido.
  await page.route('**/api/cadastros/pacientes?**', (rota) =>
    json(rota, {
      tipo: 'auto',
      itens: [
        {
          id: PACIENTE,
          prontuario: 800,
          nome: 'PACIENTE SINTETICO',
          nomeSocial: null,
          nascimento: '1980-01-01',
          sexo: 'F',
          maeMascarada: null,
          cpfMascarado: null,
          telefoneMascarado: null,
          situacao: 'ativo',
          obito: false,
          homonimo: false,
        },
      ],
      sugestoes: [],
      truncado: false,
      duracaoMs: 1,
    }),
  );
  return { previas, gerados };
}

test.describe('Modelos de orçamento de particular @C1-137', () => {
  test.setTimeout(180_000);
  test('gera o orçamento do modelo com a linha sem preço informada na hora; axe', async ({ page }) => {
    const { previas, gerados } = await simular(page);

    await entrar(page, 'SINT.CAIXA');
    await page.goto('/faturamento/modelos-orcamento');
    await expect(page.getByTestId('tela-modelos-orcamento')).toBeVisible();
    await expect(page.getByTestId('mo-lista')).toContainText('PARTO SINTETICO APARTAMENTO');

    // Escolher o modelo monta a prévia: a diária com o preço da tabela, o honorário pedindo o valor.
    await page.getByTestId('mo-orcar-MOD-SINT').click();
    const tabela = page.getByTestId('mo-previa');
    await expect(tabela).toBeVisible();
    await expect(tabela).toContainText('300,00');
    await expect(page.getByTestId('mo-preco-2')).toBeVisible();
    await expect(page.getByTestId('mo-preco-1')).toHaveCount(0);
    await expect(page.getByTestId('mo-resumo')).toContainText('600,00');
    await expect(page.getByTestId('mo-form-gerar')).toContainText('Informe o valor das linhas 2.');
    await expect(page.getByTestId('mo-emitir')).toBeDisabled();

    // O destino: o paciente vem da busca (o primeiro achado fica escolhido); ainda falta o valor da linha 2.
    await page.getByTestId('mo-termo-paciente').fill('PACIENTE SINT');
    await page.getByTestId('mo-termo-paciente').press('Enter');
    await esperarValor(page.getByTestId('mo-paciente'), String(PACIENTE));
    await expect(page.getByTestId('mo-emitir')).toBeDisabled();

    // O valor digitado refaz a prévia no servidor e o total muda na hora; o aviso de falta some e o botão libera.
    await page.getByTestId('mo-preco-2').fill('150');
    await expect(page.getByTestId('mo-resumo')).toContainText('750,00');
    expect(previas).toContain('2:150');
    await expect(page.getByTestId('mo-form-gerar')).not.toContainText('Informe o valor das linhas');
    await expect(page.getByTestId('mo-emitir')).toBeEnabled();

    await page.getByTestId('mo-emitir').click();
    await expect(page.getByTestId('mo-aviso')).toContainText('Orçamento ORC-000001 emitido');
    await expect(page.getByTestId('mo-aviso')).toContainText('750,00');
    expect(gerados).toHaveLength(1);
    expect(gerados[0]).toMatchObject({ pacienteId: PACIENTE, nomeInteressado: null, precos: { '2': 150 } });

    await semViolacaoAxe(page, '/faturamento/modelos-orcamento');
  });
});
