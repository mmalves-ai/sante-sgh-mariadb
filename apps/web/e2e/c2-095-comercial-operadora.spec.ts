// E2E @C2-095 (F8, 08-SGO L100): comercial da operadora pela tela /operadora/comercial, aberta pelo link da cobrança.
// A equipe comercial cadastra a corretora (falta mostrada na hora), monta a proposta de adesão com titular e dependente
// (a ficha é conferida pela regra do domínio enquanto se digita: dependente sem parentesco aparece como pendência de
// envio e CPF inválido impede até o rascunho), grava o rascunho e envia à análise pelos botões das situações
// permitidas; depois apura o lote de comissão sobre as parcelas pagas (com o estorno) e o fecha. As rotas
// /api/operadora/comercial exigem o banco próprio e o E2E roda com a fonte sintética: as respostas são simuladas pelo
// Playwright com massa SINTÉTICA. O efeito no banco está em apps/api/src/modulos/operadora/comercial-propria.int.spec.ts.
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

test.describe('Comercial da operadora @C2-095 @fase8', () => {
  test.setTimeout(180_000);
  test('corretora, proposta com titular e dependente enviada à análise e lote de comissão fechado; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let situacaoProposta = 'rascunho';
    let versaoProposta = 1;
    let situacaoLote = 'calculada';
    const painel = () => ({
      corretoras: pedidos.some((p) => p.caminho.endsWith('/corretoras'))
        ? [
            {
              id: 4,
              versao: 1,
              codigo: 'COR-SINT',
              nome: 'CORRETORA SINTETICA',
              tipo: 'corretora',
              registroSusep: null,
              situacao: 'ativa',
              corretoraPai: null,
              cnpj: null,
            },
          ]
        : [],
      vendedores: [
        { id: 6, versao: 1, codigo: 'V1', nome: 'VENDEDOR SINTETICO', corretora: null, ativo: true },
      ],
      equipes: [],
      regras: [
        {
          id: 3,
          versao: 1,
          codigo: 'COM-1',
          descricao: 'REGRA SINTETICA',
          vigenciaInicio: '2026-01-01',
          vigenciaFim: null,
          ativo: true,
          incidencia: 'Mensalidade',
          parcelas: [
            {
              parcelaInicial: 1,
              parcelaFinal: 3,
              tipo: 'percentual',
              percentual: 100,
              valor: null,
              desconto: null,
              vigenciaInicio: '2026-01-01',
            },
          ],
        },
      ],
      incidencias: [{ id: 1, codigo: 'MENS', descricao: 'Mensalidade', base: 'mensalidade' }],
      planos: [{ id: 2, codigo: 'PL-SINT', nome: 'PLANO SINTETICO' }],
      contratos: [],
      parentescos: [{ id: 8, descricao: 'Filho(a)' }],
      propostas: pedidos.some((p) => p.caminho.endsWith('/propostas'))
        ? [
            {
              id: 21,
              versao: versaoProposta,
              numero: 'PA-1',
              propostaEm: '2026-11-20',
              situacao: situacaoProposta,
              plano: 'PLANO SINTETICO',
              vendedor: 'VENDEDOR SINTETICO',
              corretora: null,
              vidas: 2,
            },
          ]
        : [],
      metas: [],
      campanhas: [],
      lotes: pedidos.some((p) => p.caminho.endsWith('/comissoes'))
        ? [
            {
              id: 31,
              versao: situacaoLote === 'calculada' ? 1 : 2,
              numero: 'CV-1',
              descricao: null,
              situacao: situacaoLote,
              bruto: 300,
              estorno: 100,
              irrf: 3,
              iss: 0,
              liquido: 197,
              inicio: '2026-10-01',
              fim: '2026-10-31',
              corretora: null,
              vendedor: 'VENDEDOR SINTETICO',
            },
          ]
        : [],
    });
    const proposta = () => ({
      id: 21,
      versao: versaoProposta,
      numero: 'PA-1',
      situacao: situacaoProposta,
      propostaEm: '2026-11-20',
      plano: 2,
      contrato: null,
      contratoGerado: null,
      vendedor: 6,
      corretora: null,
      equipe: null,
      diaVencimento: 10,
      observacao: null,
      observacaoOperadora: null,
      proponentes: [
        {
          sequencia: 1,
          tipo: 'titular',
          titularSequencia: null,
          parentesco: null,
          nome: 'TITULAR SINTETICO',
          nascimento: '1980-01-01',
          sexo: 'F',
          cpf: null,
          cns: null,
          nomeMae: 'MAE SINTETICA',
        },
        {
          sequencia: 2,
          tipo: 'dependente',
          titularSequencia: 1,
          parentesco: 8,
          nome: 'DEPENDENTE SINTETICO',
          nascimento: '2015-01-01',
          sexo: 'M',
          cpf: null,
          cns: null,
          nomeMae: 'MAE SINTETICA',
        },
      ],
    });
    await page.route('**/api/operadora/comercial/**', async (r) => {
      const caminho = new URL(r.request().url()).pathname.replace('/api/operadora/comercial', '');
      if (r.request().method() === 'POST') {
        const corpo = r.request().postDataJSON() as Record<string, unknown>;
        pedidos.push({ caminho, corpo });
        if (caminho.endsWith('/propostas')) return json(r, { id: 21, versao: 1, numero: 'PA-1' }, 201);
        if (caminho === '/propostas/21/situacao') {
          situacaoProposta = String(corpo['para']);
          versaoProposta += 1;
          return json(r, { id: 21, versao: versaoProposta });
        }
        if (caminho.endsWith('/comissoes'))
          return json(r, { id: 31, versao: 1, numero: 'CV-1', liquido: 197 }, 201);
        if (caminho === '/comissoes/31/situacao') {
          situacaoLote = String(corpo['para']);
          return json(r, { id: 31, versao: 2 });
        }
        return json(r, { id: 4, versao: 1 }, 201);
      }
      if (caminho === '/propostas/21') return json(r, proposta());
      if (caminho === '/comissoes/31/itens')
        return json(r, [
          {
            id: 1,
            sequencia: 1,
            tipo: 'comissao',
            contrato: 'CT-SINT',
            parcela: 1,
            competencia: '2026-10',
            base: 300,
            percentual: 100,
            valor: 300,
            pendente: false,
            cancelado: false,
            diasPermanencia: null,
            observacao: null,
          },
          {
            id: 2,
            sequencia: 2,
            tipo: 'estorno',
            contrato: 'CT-SINT-2',
            parcela: null,
            competencia: null,
            base: 100,
            percentual: null,
            valor: -100,
            pendente: false,
            cancelado: false,
            diasPermanencia: 70,
            observacao: 'Inadimplência acima de 60 dias',
          },
        ]);
      return json(r, painel());
    });

    // A lista de operadoras vem da tela da cobrança (banco próprio): simulada com duas operadoras SINTÉTICAS, para que
    // a escolha no combo seja feita pela pessoa (com uma só, a tela já a escolhe).
    await page.route('**/api/operadora/cobranca/tela', (r) =>
      json(r, {
        liberacao: { ligada: true, motivo: null },
        acoes: { gerar: true, motivo: null },
        operadoras: [
          { id: 7, razaoSocial: 'OPERADORA SINTETICA', registroAns: '410361' },
          { id: 8, razaoSocial: 'OPERADORA SINTETICA DOIS', registroAns: '410362' },
        ],
        hoje: '2026-11-25',
        mensagens: { enviar: false, motivo: 'fora de produção' },
        parametros: {
          multaPercentual: 2,
          jurosPercentualMes: 1,
          diasLimiteNotificacao: 50,
          diasInadimplencia: 60,
          diasPrazoNotificacao: 10,
          parcelasMaximas: 12,
        },
      }),
    );
    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/cobranca');
    await page.getByTestId('link-comercial').click();
    await expect(page).toHaveURL(/\/operadora\/comercial/);
    await expect(page.getByTestId('tela-comercial-operadora')).toBeVisible();
    await escolher(page.getByTestId('comercial-operadora'), { indice: 0 });
    await expect(page.getByTestId('painel-propostas')).toBeVisible();

    // Força de venda: a corretora sem nome é cobrada na hora.
    await page.getByTestId('aba-forca').click();
    await page.getByTestId('cor-codigo').locator('input').fill('COR-SINT');
    await expect(page.getByTestId('cor-falta')).toContainText('nome');
    await page.getByTestId('cor-nome').locator('input').fill('Corretora sintética');
    await expect(page.getByTestId('cor-falta')).toHaveCount(0);
    await page.getByTestId('cor-salvar').click();
    await expect(page.getByTestId('comercial-aviso')).toContainText('Corretora cadastrada');
    await expect(page.getByTestId('corretora-COR-SINT')).toBeVisible();

    // Proposta: titular e dependente; o dependente sem parentesco fica como pendência de envio.
    await page.getByTestId('aba-propostas').click();
    await escolher(page.getByTestId('prop-plano'), { rotulo: /PL-SINT/ });
    await escolher(page.getByTestId('prop-vendedor'), { rotulo: /V1/ });
    await page.getByTestId('prop-dia').locator('input').fill('10');
    await page.getByTestId('pp-nome-1').locator('input').fill('Titular sintético');
    await page.getByTestId('pp-nascimento-1').locator('input').fill('1980-01-01');
    await escolher(page.getByTestId('pp-sexo-1'), { rotulo: 'Feminino' });
    await page.getByTestId('pp-mae-1').locator('input').fill('Mãe sintética');
    await page.getByTestId('pp-cpf-1').locator('input').fill('11111111111');
    await expect(page.getByTestId('prop-falta')).toBeVisible();
    await expect(page.getByTestId('prop-salvar')).toBeDisabled();
    // CPF de exemplo com dígitos verificadores válidos (sintético).
    await page.getByTestId('pp-cpf-1').locator('input').fill('52998224725');
    await page.getByTestId('pp-dependente').click();
    await page.getByTestId('pp-nome-2').locator('input').fill('Dependente sintético');
    await page.getByTestId('pp-nascimento-2').locator('input').fill('2015-01-01');
    await escolher(page.getByTestId('pp-sexo-2'), { rotulo: 'Masculino' });
    await page.getByTestId('pp-mae-2').locator('input').fill('Mãe sintética');
    await expect(page.getByTestId('prop-pendencias')).toBeVisible();
    await escolher(page.getByTestId('pp-parentesco-2'), { rotulo: /Filho/ });
    await expect(page.getByTestId('prop-pendencias')).toHaveCount(0);
    await expect(page.getByTestId('prop-falta')).toHaveCount(0);
    await page.getByTestId('prop-salvar').click();
    await expect(page.getByTestId('comercial-aviso')).toContainText('PA-1');
    await expect(page.getByTestId('proposta-aberta')).toContainText('Rascunho');
    // Do rascunho só se envia ou cancela; cancelar exige o motivo.
    await expect(page.getByTestId('prop-para-aprovada')).toHaveCount(0);
    await expect(page.getByTestId('prop-para-cancelada')).toBeDisabled();
    await page.getByTestId('prop-para-enviada').click();
    await expect(page.getByTestId('proposta-situacao-21')).toHaveText('Enviada');

    // Lote de comissão: apura sobre as parcelas pagas, mostra o estorno e fecha.
    await page.getByTestId('aba-lotes').click();
    await escolher(page.getByTestId('lote-regra'), { rotulo: /COM-1/ });
    await page.getByTestId('lote-inicio').locator('input').fill('2026-10-01');
    await expect(page.getByTestId('lote-falta')).toContainText('período');
    await page.getByTestId('lote-fim').locator('input').fill('2026-10-31');
    await expect(page.getByTestId('lote-falta')).toHaveCount(0);
    await page.getByTestId('lote-apurar').click();
    await expect(page.getByTestId('comercial-aviso')).toContainText('CV-1');
    await expect(page.getByTestId('item-lote-2')).toContainText('Estorno');
    await page.getByTestId('lote-para-fechada').click();
    await expect(page.getByTestId('lote-situacao-31')).toHaveText('Fechada');

    const caminhos = pedidos.map((p) => p.caminho);
    expect(caminhos).toEqual([
      expect.stringMatching(/^\/\d+\/corretoras$/),
      expect.stringMatching(/^\/\d+\/propostas$/),
      '/propostas/21/situacao',
      expect.stringMatching(/^\/\d+\/comissoes$/),
      '/comissoes/31/situacao',
    ]);
    const prop = pedidos[1]!.corpo;
    expect(prop['plano']).toBe(2);
    expect(prop['proponentes']).toMatchObject([
      { sequencia: 1, tipo: 'titular', titularSequencia: null, cpf: '52998224725' },
      { sequencia: 2, tipo: 'dependente', titularSequencia: 1, parentesco: 8 },
    ]);
    expect(pedidos[3]!.corpo).toMatchObject({
      regra: 3,
      pagamentoInicio: '2026-10-01',
      prazoEstornoDias: 365,
    });
    await semViolacaoAxe(page, 'comercial da operadora');
  });
});
