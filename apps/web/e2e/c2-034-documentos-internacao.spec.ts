// E2E @C2-034 (F3.4, 04-INT linha 69): os documentos da internação conforme o convênio. A partir da internação admitida
// no convênio sintético 901, a tela de impressos lista os documentos configurados para o momento (combo do tema, nada
// de <select> cru), emite o termo do convênio em PDF (endereço blob:) com as cópias da regra dentro do mesmo PDF e marca o
// documento como emitido; trocar o momento relê a lista; o atalho abre a configuração dos documentos com a internação
// na prévia, e a prévia acha a internação pelo nome do paciente. O efeito no banco (linha na trilha com o modelo, o momento e as cópias; o obrigatório emitido lido da
// trilha) é provado no contrato de efeito apps/api/src/modulos/adt/documentos-internacao.int.spec.ts. Sessão real sobre
// a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia). Axe sem violação séria.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

/** Admite o paciente sintético num leito livre do bloco 1 e devolve o número da internação. */
async function admitir(page: Page): Promise<number> {
  await page.goto('/leitos/mapa');
  // Qualquer leito livre do bloco 1 (enfermaria ou apartamento): os outros arquivos do lote ocupam a enfermaria.
  const cartoes = page.locator('[data-testid^="leito-1|"][data-situacao="livre"]');
  await expect(cartoes.first()).toBeVisible();
  const origem = ((await cartoes.first().getAttribute('data-testid')) ?? '').replace(/^leito-/, '');
  await page.getByTestId(`admitir-${origem}`).click();
  await expect(page.getByTestId('tela-admissao')).toBeVisible();
  await page.getByTestId('admissao-termo').locator('input').fill('JOSE DA SILVA');
  await page.getByTestId('admissao-buscar').click();
  await page.getByTestId('admissao-paciente-1001').click();
  await escolher(page.getByTestId('admissao-leito'), origem);
  await escolher(page.getByTestId('admissao-convenio'), '901');
  await escolher(page.getByTestId('admissao-especialidade'), '11');
  await page.getByTestId('admissao-termo-medico').locator('input').fill('ANA');
  await page.getByTestId('admissao-buscar-medico').click();
  await escolher(page.getByTestId('admissao-assistente'), '7101');
  await escolher(page.getByTestId('admissao-solicitante'), '7101');
  await page.getByTestId('admissao-termo-cid').locator('input').fill('I21');
  await page.getByTestId('admissao-buscar-cid').click();
  await escolher(page.getByTestId('admissao-cid'), '50001');
  await page.getByTestId('admissao-procedimento').locator('input').fill('303010037');
  await page.getByTestId('admissao-gravar').click();
  await expect(page.getByTestId('admissao-feita')).toBeVisible();
  await page.getByTestId('admissao-abrir').click();
  await expect(page).toHaveURL(/\/internacao\/\d+\/guias/);
  return Number(/\/internacao\/(\d+)\//.exec(page.url())?.[1]);
}

test.describe('@C2-034 documentos da internação conforme o convênio', () => {
  test.setTimeout(180_000);

  test('lista do momento, emissão em PDF com as cópias da regra e configuração com a prévia; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // A configuração dos documentos só tem porta própria (sem banco ela responde 503): as duas leituras da tela de
    // configuração são simuladas pelo contrato da API (massa SINTÉTICA); a gravação e a prévia sobre o banco estão no
    // contrato de efeito apps/api/src/modulos/adt/documentos-internacao.int.spec.ts.
    const modelo = {
      id: 2,
      codigo: 'TERMO-CONV',
      titulo: 'TERMO DO CONVENIO',
      ativo: true,
      especialidade: null,
      idadeMinima: null,
      idadeMaxima: null,
      conteudo: '<p>Termo sintético</p>',
      momento: 'admissao',
      copias: 2,
      todosEstabelecimentos: false,
      versao: 1,
    };
    await page.route(/\/api\/documentos-internacao(\?.*)?$/, (rota) =>
      rota.request().method() !== 'GET'
        ? rota.fallback()
        : rota.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              modelos: [modelo],
              regras: [
                {
                  id: 1,
                  modelo: 2,
                  momento: 'admissao',
                  convenio: 901,
                  especialidade: null,
                  modalidade: null,
                  obrigatorio: true,
                  selecionadoPorPadrao: true,
                  copias: 2,
                  ordem: 1,
                  ativo: true,
                  versao: 1,
                },
              ],
              modalidades: [{ codigo: 1, nome: 'CLINICA' }],
              podeEditar: false,
              podeModeloComum: false,
            }),
          }),
    );
    await page.route(/\/api\/documentos-internacao\/internacao\/\d+(\?.*)?$/, (rota) =>
      rota.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          momento: 'admissao',
          documentos: [
            {
              modelo: 2,
              titulo: 'TERMO DO CONVENIO',
              regra: 1,
              copias: 2,
              obrigatorio: true,
              selecionado: true,
              sobDemanda: false,
              texto: 'Termo sintético',
            },
          ],
        }),
      }),
    );
    await entrar(page, 'SINT.INTERNACAO');
    const reg = await admitir(page);
    expect(reg).toBeGreaterThan(0);

    await page.goto(`/internacao/${reg}/impressos`);
    const tela = page.getByTestId('tela-impressos-internacao');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(page.locator('body'));
    await expect(page.locator('[data-testid="tela-impressos-internacao"] select')).toHaveCount(0);

    // Os documentos do momento: a ficha comum e o termo que a regra do convênio 901 manda (2 cópias).
    const lista = page.getByTestId('imp-fichas');
    await expect(lista).toBeVisible();
    await expect(page.getByTestId('imp-ficha-1')).toBeVisible();
    await expect(lista).toContainText('TERMO DO CONVENIO');
    await semViolacaoAxe(page, '/internacao/:reg/impressos');

    // Emite o termo: o PDF abre por blob:, com o aviso das cópias da regra, e o documento fica marcado como emitido.
    await page.getByTestId('imp-ficha-2').click();
    const pdfs = page.getByTestId('imp-pdfs');
    await expect(pdfs).toContainText('TERMO DO CONVENIO');
    await expect(pdfs).toContainText('2 cópias no mesmo PDF');
    await expect(pdfs.locator('a').first()).toHaveAttribute('href', /^blob:/);
    await expect(page.getByTestId('imp-emitido-2')).toBeVisible();
    await expect(page.getByTestId('imp-mensagem')).toBeVisible();

    // Outro momento: a lista é relida pelo combo do tema.
    await escolher(page.getByTestId('imp-momento'), 'alta');
    await expect(lista).toBeVisible();

    // A configuração dos documentos abre com a internação na prévia.
    await page.getByTestId('imp-configurar-documentos').click();
    await expect(page).toHaveURL(new RegExp(`/internacao/documentos\\?reg=${reg}$`));
    await expect(page.getByTestId('tela-documentos-internacao')).toBeVisible();
    await esperarSemSelectNativo(page.locator('body'));
    await semViolacaoAxe(page, '/internacao/documentos');

    // Visão por paciente: a prévia acha a internação pelo nome, sem o número.
    await page.goto('/internacao/documentos');
    await expect(page.getByTestId('tela-documentos-internacao')).toBeVisible();
    await expect(page.getByTestId('doc-buscar-paciente')).toBeDisabled();
    await page.getByTestId('doc-busca-paciente').fill('JOSE');
    await page.getByTestId('doc-buscar-paciente').click();
    await expect(page.locator('section[aria-labelledby="doc-previa"]')).toContainText(`${reg}`);
    await page.getByTestId(`doc-paciente-${reg}`).click();
    await expect(page.getByTestId('doc-reg')).toHaveValue(String(reg));
    await expect(page.getByTestId('doc-previa-lista')).toContainText('TERMO DO CONVENIO');

    expect(externas).toEqual([]);
  });

  test('passo 3: a guia TISS de solicitação de internação nasce da internação e o pedido traz o PDF da guia', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // A visão do paciente na autorização prévia é simulada (massa SINTÉTICA); o efeito está no contrato de efeito
    // apps/api/src/modulos/tiss/autorizacao-previa-propria.int.spec.ts (guia da internação a partir do pedido gravado).
    await page.route('**/api/tiss/autorizacoes/pacientes/1001', (rota) =>
      rota.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          coberturas: [
            { id: 5, fontePagadora: 'Operadora sintética', carteira: '0000555566667777', validade: null },
          ],
          pedidos: [
            {
              id: 91,
              numero: 'SA000091',
              tipo: 'internacao',
              situacao: 'rascunho',
              canal: 'webservice',
              fontePagadora: 'Operadora sintética',
              carteira: '0000555566667777',
              conta: null,
              solicitadaEm: '2026-11-27T10:00:00.000Z',
              enviadaEm: null,
              observacao: null,
              xmlGuardado: false,
              versao: 1,
              diagnosticos: [
                { sequencia: 1, principal: true, cid: 'I21', descricao: 'Diagnóstico sintético' },
              ],
              itens: [
                {
                  sequencia: 1,
                  codigoTabela: '22',
                  codigoProcedimento: '303010037',
                  descricao: 'Procedimento sintético',
                  quantidade: 1,
                  quantidadeAutorizada: null,
                  opme: false,
                },
              ],
              respostas: [],
              consultas: [],
            },
          ],
        }),
      }),
    );
    await entrar(page, 'SINT.FIN.GESTOR');
    await page.goto(
      '/faturamento/autorizacoes?paciente=1001&tipo=internacao&internacao=77&regime=hospitalar&admissao=2026-11-27&procedimento=303010037&cid=I21',
    );
    const tela = page.getByTestId('autorizacao-previa');
    await expect(tela).toBeVisible();
    await expect(page.getByTestId('aut-da-internacao')).toContainText('internação 77');
    await expect(page.getByTestId('aut-novo')).toBeVisible();
    await expect(page.getByTestId('aut-tipo')).toContainText('Internação');
    await expect(page.getByTestId('aut-cid-0').locator('input')).toHaveValue('I21');
    await expect(page.getByTestId('aut-item-codigo').locator('input')).toHaveValue('303010037');
    await expect(page.getByTestId('aut-guia-pdf')).toHaveAttribute('href', '/api/tiss/autorizacoes/91/guia');
    await esperarSemSelectNativo(tela);
    await semViolacaoAxe(page, '/faturamento/autorizacoes (da internação)');
    expect(externas).toEqual([]);
  });
});
