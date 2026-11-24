// E2E @M47.3 (ficha do M47, seção 10, etapa 3): o médico pede o raio X no prontuário; o exame de imagem aparece na lista
// de trabalho DICOM "a enviar" e o técnico já pode enviar: sem chave de liberação (05-SADT linha 20; tudo ligado, só a
// permissão do cargo e o destino configurado); o administrador configura o endereço do visualizador; o técnico de imagem envia o exame (número de acesso, entregue ao simulador), reenvia com o
// mesmo número, e o simulador de modalidade manda "em andamento" e "concluído"; o link das imagens aparece na lista e no
// prontuário do paciente; o item do menu leva à tela; uma chave antiga recolhida não desliga a função. axe sem violação séria em cada estado.
// Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { abrirMenuInteiro, menuPrincipal, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PESSOAS = ['SINT.TEC.IMAGEM', 'SINT.MEDICO'];
const VISUALIZADOR = 'https://visualizador.exemplo/estudo?uid={estudo}&acc={acesso}';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const cabecalhos = async (page: Page, k: string) => ({
  'x-csrf': (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '',
  'idempotency-key': `e2e-m47-3-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});

async function chave(page: Page, ligar: boolean): Promise<void> {
  const r = await page.request.post('/api/administracao/liberacao', {
    headers: await cabecalhos(page, `chave-${ligar}`),
    data: {
      chave: 'imagem.worklist',
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: PESSOAS,
      ligar,
      justificativa: 'Lista de trabalho DICOM sintética (E2E da etapa 3)',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

test.describe('Lista de trabalho DICOM e PACS @M47 @M47.3 @fase5', () => {
  test.setTimeout(300_000);

  test('pedido de imagem → lista de trabalho → envio → reenvio → status do simulador → link na lista e no prontuário; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // O médico pede o raio X de tórax no prontuário.
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1001/exames');
    await page.getByTestId('incluir-exame-505').click();
    await page.getByTestId('enviar-pedido').click();
    await expect(page.getByTestId('aba-exames-conteudo')).toContainText('Pedido enviado.');

    // Sem chave de liberação: o técnico vê o exame "a enviar" e já pode selecioná-lo para enviar.
    await entrar(page, 'SINT.TEC.IMAGEM');
    await page.goto('/sadt/imagem/worklist');
    await expect(page.getByRole('heading', { level: 1, name: 'Lista de trabalho DICOM' })).toBeVisible();
    await expect(page.getByTestId('worklist-motivo')).toHaveCount(0);
    const linhaRx = page
      .locator('[data-testid^="worklist-exame-"]')
      .filter({ hasText: 'RAIO X DE TÓRAX' })
      .filter({ hasText: 'A enviar' })
      .first();
    await expect(linhaRx).toBeVisible();
    const exame = Number((await linhaRx.getAttribute('data-testid'))!.replace('worklist-exame-', ''));
    await expect(page.getByTestId(`worklist-selecionar-${exame}`)).toBeVisible();
    await semViolacaoAxe(page, '/sadt/imagem/worklist (a enviar)');

    // O administrador configura o visualizador (nenhuma chave de liberação a ligar).
    await entrar(page, 'SINT.ADMIN');
    const p = await page.request.put('/api/administracao/parametros/pacs.visualizadorUrl', {
      headers: await cabecalhos(page, 'visualizador'),
      data: {
        nivel: 'estabelecimento',
        alvo: 'pc',
        valor: VISUALIZADOR,
        justificativa: 'Visualizador sintético do E2E da etapa 3',
        senha: SENHA,
      },
    });
    expect(p.status(), await p.text()).toBe(200);

    {
      // O técnico envia o exame; o item nasce com o número de acesso e é entregue ao simulador.
      await entrar(page, 'SINT.TEC.IMAGEM');
      await page.goto('/sadt/imagem/worklist');
      await expect(page.getByTestId('worklist-destino')).toContainText('simulados');
      await page.getByTestId(`worklist-selecionar-${exame}`).check();
      await page.getByTestId('worklist-enviar').click();
      await expect(page.getByTestId('worklist-mensagem')).toContainText('enviado(s) à lista de trabalho');
      await expect(page.getByTestId(`worklist-situacao-${exame}`)).toContainText('Entregue ao PACS');
      const acesso = (await page.getByTestId(`worklist-acesso-${exame}`).textContent())!.trim();
      expect(acesso).toMatch(/^PC\d{9,}$/);
      await semViolacaoAxe(page, '/sadt/imagem/worklist (enviado)');

      // O reenvio usa o mesmo número de acesso.
      await page.getByTestId(`worklist-reenviar-${exame}`).click();
      await expect(page.getByTestId('worklist-mensagem')).toContainText(
        `${acesso} reenviado com o mesmo número`,
      );
      await expect(page.getByTestId(`worklist-situacao-${exame}`)).toContainText('2 envio(s)');
      await expect(page.getByTestId(`worklist-acesso-${exame}`)).toHaveText(acesso);

      // A busca pelo número de acesso (o que a modalidade e o PACS mostram) acha o item; o que não existe, nada.
      await page.getByTestId('worklist-termo').fill(acesso);
      await page.getByTestId('worklist-buscar').click();
      await expect(page.getByTestId(`worklist-acesso-${exame}`)).toHaveText(acesso);
      await page.getByTestId('worklist-termo').fill('ZZ999999999');
      await page.getByTestId('worklist-buscar').click();
      await expect(page.getByTestId(`worklist-acesso-${exame}`)).toHaveCount(0);
      await page.getByTestId('worklist-termo').fill('');
      await page.getByTestId('worklist-buscar').click();
      await expect(page.getByTestId(`worklist-acesso-${exame}`)).toHaveText(acesso);

      // O simulador de modalidade: em andamento e concluído; o link das imagens na lista.
      await expect(page.getByTestId('worklist-simulador')).toBeVisible();
      await escolher(page.getByTestId('simulador-item'), { rotulo: new RegExp(acesso) });
      await page.getByTestId('simulador-em-andamento').click();
      await expect(page.getByTestId('worklist-mensagem')).toContainText('Em andamento na modalidade');
      await expect(page.getByTestId(`worklist-status-${exame}`)).toContainText('Em andamento');
      await page.getByTestId('simulador-concluido').click();
      await expect(page.getByTestId('worklist-mensagem')).toContainText('Status recebido: Concluído');
      const link = page.getByTestId(`worklist-link-${exame}`);
      await expect(link).toHaveAttribute(
        'href',
        new RegExp(`^https://visualizador\\.exemplo/estudo\\?uid=2\\.25\\.\\d+&acc=${acesso}$`),
      );
      await semViolacaoAxe(page, '/sadt/imagem/worklist (concluído)');

      // O item do menu leva à tela.
      await abrirMenuInteiro(page);
      await expect(
        menuPrincipal(page).getByRole('link', { name: 'Lista de trabalho DICOM e integração PACS/RIS' }),
      ).toHaveAttribute('href', '/sadt/imagem/worklist');

      // O link no prontuário do paciente (aba de resultados).
      await entrar(page, 'SINT.MEDICO');
      await page.goto('/pep/paciente/1001/resultados');
      await expect(page.getByTestId('imagens-paciente')).toBeVisible();
      await expect(page.getByTestId(`imagem-${exame}`)).toContainText(acesso);
      await expect(page.getByTestId(`imagem-${exame}`)).toContainText('Concluído');
      await expect(page.getByTestId(`imagem-link-${exame}`)).toHaveAttribute(
        'href',
        /^https:\/\/visualizador\.exemplo\//,
      );
      await semViolacaoAxe(page, '/pep/paciente/1001/resultados (imagens)');
    }
    // Uma chave antiga recolhida para as pessoas não desliga a função: só a permissão do cargo e o destino valem.
    await entrar(page, 'SINT.ADMIN');
    await chave(page, false);
    await entrar(page, 'SINT.TEC.IMAGEM');
    await page.goto('/sadt/imagem/worklist');
    await expect(page.getByTestId('worklist-motivo')).toHaveCount(0);
    await expect(page.getByTestId(`worklist-reenviar-${exame}`)).toBeVisible();
    expect(externas).toEqual([]);
  });
});
