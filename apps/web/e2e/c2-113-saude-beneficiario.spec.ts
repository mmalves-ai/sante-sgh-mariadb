// E2E @C2-113 (F7, 08-SGO L95): declaração de saúde, doença ou lesão preexistente com a cobertura parcial temporária
// (CPT) e portabilidade de carências do beneficiário pela tela /operadora/beneficiarios/saude (RN ANS 162/2007 e
// 438/2018). A equipe da operadora abre o beneficiário pela matrícula, vê as carências, registra a declaração (a
// resposta "sim" sem detalhe e sem CID-10 é apontada na hora), decide a doença com CPT (o fim previsto aparece antes de
// gravar), registra o pedido de portabilidade (o registro ANS inválido é apontado na hora), dá o passo da análise e
// pede a segunda via do cartão. As rotas /api/operadora/saude-beneficiario e /api/operadora/complementar exigem o banco
// próprio e o E2E roda com a fonte sintética: as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito
// no banco está em apps/api/src/modulos/operadora/beneficiario-saude-propria.int.spec.ts.
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

test.describe('Declaração de saúde, CPT e portabilidade de carências @C2-113 @fase7', () => {
  test.setTimeout(180_000);
  test('carências, declaração com CID-10, decisão com CPT, portabilidade, passo da análise e cartão; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const doencas: Record<string, unknown>[] = [];
    const cpts: Record<string, unknown>[] = [];
    const portabilidades: Record<string, unknown>[] = [];
    const cartoes: Record<string, unknown>[] = [
      { id: 61, numero: '0000000000000501', situacao: 'entregue', solicitadoEm: '2026-06-01', viaEmitida: 1 },
    ];
    const painel = () => ({
      beneficiario: {
        id: 501,
        matricula: '0000000000000501',
        situacao: 'ativo',
        adesao: '2026-06-01',
        tipoContratacao: 'individual_familiar',
        participantesNoContrato: 1,
      },
      carencias: [
        {
          id: 1,
          categoria: 'parto',
          dias: 300,
          aproveitados: 0,
          cumpridaEm: '2027-03-28',
          cumprida: false,
          portabilidade: null,
        },
      ],
      declaracoes: pedidos.some((p) => p.caminho === '/501/declaracoes')
        ? [
            {
              id: 71,
              versao: 1,
              preenchidaEm: '2026-06-01',
              situacao: 'em_analise',
              entrevistaQualificada: false,
              imc: null,
              respostasSim: 1,
            },
          ]
        : [],
      doencas,
      cpts,
      portabilidades,
      cartoes,
    });
    await page.route('**/api/operadora/saude-beneficiario**', async (r) => {
      const u = new URL(r.request().url());
      const caminho = u.pathname.replace('/api/operadora/saude-beneficiario', '');
      if (r.request().method() === 'POST') {
        const corpo = r.request().postDataJSON() as Record<string, unknown>;
        pedidos.push({ caminho, corpo });
        if (caminho === '/501/declaracoes')
          doencas.push({
            id: 81,
            versao: 1,
            declaracao: 71,
            cid: 'E11',
            descricao: 'DOENCA SINTETICA',
            inicio: '2020-01-10',
            forma: 'declarada',
            decisao: 'em_analise',
            percentualAgravo: null,
            cpt: null,
          });
        if (caminho === '/doencas/81/decisao') {
          doencas[0] = { ...doencas[0], versao: 2, decisao: 'cobertura_parcial_temporaria', cpt: 91 };
          cpts.push({
            id: 91,
            versao: 1,
            cid: 'E11',
            inicio: '2026-06-01',
            fimPrevisto: '2028-05-31',
            prazoMeses: 24,
            situacao: 'vigente',
            encerradaEm: null,
            vigenteHoje: true,
          });
        }
        if (caminho === '/501/portabilidades')
          portabilidades.push({
            id: 95,
            versao: 1,
            numero: 'PT-1',
            direcao: 'recebida',
            modalidade: 'ordinaria',
            registroAnsOrigem: '123456',
            nomeOperadoraOrigem: 'OPERADORA SINTETICA',
            solicitadoEm: '2026-11-20',
            prazoResposta: '2026-11-30',
            situacao: 'recebida',
            motivoRecusa: null,
            vencida: false,
          });
        if (caminho === '/portabilidades/95/decisao')
          portabilidades[0] = { ...portabilidades[0], versao: 2, situacao: 'em_analise' };
        return json(r, { id: 1, versao: 2 });
      }
      if (caminho === '' || caminho === '/')
        return json(r, [{ id: 501, matricula: '0000000000000501', situacao: 'ativo' }]);
      if (caminho === '/questionarios')
        return json(r, [
          {
            id: 5,
            codigo: 'DS1',
            nome: 'DECLARACAO SINTETICA',
            perguntas: [
              {
                id: 51,
                sequencia: 1,
                enunciado: 'PERGUNTA SINTETICA',
                tipoResposta: 'sim_nao',
                obrigatoria: true,
              },
            ],
          },
        ]);
      if (caminho === '/cids') return json(r, [{ id: 300, codigo: 'E11', descricao: 'DOENCA SINTETICA' }]);
      if (caminho === '/501') return json(r, painel());
      return json(r, []);
    });
    await page.route('**/api/operadora/complementar/**', async (r) => {
      const u = new URL(r.request().url());
      const caminho = u.pathname.replace('/api/operadora/complementar', '');
      if (r.request().method() === 'POST') {
        pedidos.push({ caminho, corpo: r.request().postDataJSON() as Record<string, unknown> });
        if (caminho === '/beneficiarios/501/cartoes')
          cartoes.push({
            id: 62,
            numero: '0000000000000501',
            situacao: 'solicitado',
            solicitadoEm: '2026-11-26',
            viaEmitida: null,
          });
        return json(r, { id: 62, versao: 1 });
      }
      return json(r, []);
    });

    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/beneficiarios/saude');
    await page.getByTestId('saude-matricula').locator('input').fill('0000000000000501');
    await page.getByTestId('saude-abrir').click();
    await expect(page.getByTestId('saude-resumo')).toContainText('0000000000000501');

    await page.getByTestId('aba-carencias').click();
    await expect(page.getByTestId('carencia-1')).toBeVisible();

    // Declaração: "sim" sem detalhe e sem CID-10 é apontado; o CID-10 vem da busca.
    await page.getByTestId('aba-declaracao').click();
    await escolher(page.getByTestId('dec-questionario'), { rotulo: /DECLARACAO SINTETICA/ });
    await escolher(page.getByTestId('resp-1'), { rotulo: /^Sim$/ });
    await expect(page.getByTestId('dec-falta')).toContainText('Detalhe a resposta "sim" da pergunta 1.');
    await expect(page.getByTestId('dec-falta')).toContainText('ao menos uma doença com o CID-10');
    await expect(page.getByTestId('dec-salvar')).toBeDisabled();
    await page.getByTestId('resp-1-detalhe').locator('input').fill('DETALHE SINTETICO');
    await page.getByTestId('dec-busca-cid').locator('input').fill('E11');
    await page.getByTestId('dec-procurar-cid').click();
    await page.getByTestId('cid-E11').click();
    const inicio = page.getByTestId('doenca-inicio-E11').locator('input');
    await inicio.fill('10/01/2020');
    await inicio.press('Tab');
    await expect(page.getByTestId('dec-falta')).toHaveCount(0);
    await semViolacaoAxe(page, '/operadora/beneficiarios/saude (declaração)');
    await page.getByTestId('dec-salvar').click();
    await expect(page.getByTestId('saude-aviso')).toContainText('Declaração registrada');
    expect(pedidos.find((p) => p.caminho === '/501/declaracoes')!.corpo).toMatchObject({
      questionario: 5,
      respostas: [{ pergunta: 51, afirmativa: true, complemento: 'DETALHE SINTETICO' }],
      doencas: [{ termo: 300, inicio: '2020-01-10', forma: 'declarada' }],
    });

    // Decisão da doença preexistente com CPT de 24 meses contados da adesão.
    await expect(page.getByTestId('painel-cpt')).toBeVisible();
    await escolher(page.getByTestId('decisao-E11'), { rotulo: /CPT/ });
    await page.getByTestId('prazo-E11').locator('input').fill('24');
    await expect(page.getByTestId('fim-cpt-E11')).toContainText('31/05/2028');
    await page.getByTestId('decisao-salvar-E11').click();
    await expect(page.getByTestId('saude-aviso')).toContainText('Decisão da doença registrada');
    expect(pedidos.find((p) => p.caminho === '/doencas/81/decisao')!.corpo).toMatchObject({
      versao: 1,
      decisao: 'cobertura_parcial_temporaria',
      prazoMeses: 24,
    });
    await expect(page.getByTestId('cpt-E11')).toBeVisible();
    await semViolacaoAxe(page, '/operadora/beneficiarios/saude (CPT)');

    // Portabilidade de carências: registro ANS de 6 dígitos apontado na hora; depois o passo da análise.
    await page.getByTestId('aba-portabilidade').click();
    await page.getByTestId('port-registro').locator('input').fill('12345');
    await expect(page.getByTestId('port-falta')).toContainText('6 dígitos');
    await expect(page.getByTestId('port-salvar')).toBeDisabled();
    await page.getByTestId('port-registro').locator('input').fill('123456');
    await page.getByTestId('port-nome').locator('input').fill('OPERADORA SINTETICA');
    await expect(page.getByTestId('port-falta')).toHaveCount(0);
    await page.getByTestId('port-salvar').click();
    await expect(page.getByTestId('saude-aviso')).toContainText('Pedido de portabilidade registrado');
    expect(pedidos.find((p) => p.caminho === '/501/portabilidades')!.corpo).toMatchObject({
      direcao: 'recebida',
      modalidade: 'ordinaria',
      registroAnsOrigem: '123456',
      nomeOperadoraOrigem: 'OPERADORA SINTETICA',
    });
    await escolher(page.getByTestId('passo-PT-1'), { rotulo: /Em análise/ });
    await page.getByTestId('passo-salvar-PT-1').click();
    await expect(page.getByTestId('saude-aviso')).toBeVisible();
    expect(pedidos.find((p) => p.caminho === '/portabilidades/95/decisao')!.corpo).toMatchObject({
      versao: 1,
      situacao: 'em_analise',
    });
    await semViolacaoAxe(page, '/operadora/beneficiarios/saude (portabilidade)');

    // Segunda via do cartão.
    await page.getByTestId('aba-cartao').click();
    await page.getByTestId('cartao-pedir').click();
    await expect(page.getByTestId('saude-aviso')).toContainText('Pedido de cartão registrado');
    expect(pedidos.find((p) => p.caminho === '/beneficiarios/501/cartoes')!.corpo).toMatchObject({
      primeiraVia: false,
      canal: 'balcao',
    });
    await expect(page.getByTestId('cartao-62')).toBeVisible();
  });
});
