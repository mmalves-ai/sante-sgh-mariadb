// E2E @C2-036 (03-PEP L131): cópia do prontuário no balcão e cabeçalho da impressão por tipo de documento, no que a
// fonte sintética permite. A fila e a visão por paciente moram só no banco do cliente; para provar o fluxo da tela
// (pedido com validação na hora, próximo passo por situação, entrega com quem recebeu, documento conferido e folhas,
// e a regra de cabeçalho com prévia) a API é simulada por page.route com dados SINTÉTICOS. O que fica no banco
// (pedido, transições, entrega em entrega_copia_prontuario, regra de cabeçalho sem apagar) é provado no contrato de
// efeito apps/api/src/modulos/pep/copia-prontuario-balcao-propria.int.spec.ts e as regras em
// packages/dominio-documento/src/impressao/copia-balcao.spec.ts e src/pdf/cabecalho.spec.ts. axe sem violação séria.
import { expect, test, type Page, type Route } from '@playwright/test';
import { escolher } from './combos.js';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const opcoes = { tiposDocumento: [{ id: 1, rotulo: 'Documento de identidade (sintético)' }] };
const base = {
  id: 91,
  numero: 7001,
  paciente: PACIENTE,
  pacienteNome: 'Paciente Sintético',
  prontuario: '900001',
  solicitanteTipo: 'familiar',
  solicitanteNome: 'Familiar Sintético',
  motivo: 'Segunda opinião (sintético)',
  periodoInicio: null,
  periodoFim: null,
  solicitadaEm: '2026-11-25T09:00:00',
  prazo: '2026-12-10',
  atrasada: false,
  temAutorizacao: true,
  temProcuracao: false,
  motivoNegativa: null,
  portal: false,
};

function pedido(estado: { situacao: string | null; versao: number }) {
  if (!estado.situacao) return [];
  return [
    {
      ...base,
      versao: estado.versao,
      situacao: estado.situacao,
      entrega:
        estado.situacao === 'entregue'
          ? {
              entregueEm: '2026-11-25T11:00:00',
              entregador: 'SINT.SAME.COPIA',
              recebedorNome: 'Familiar Sintético',
              vinculo: 'irmao',
              tipoDocumento: 'Documento de identidade (sintético)',
              quantidadeFolhas: 12,
            }
          : null,
    },
  ];
}

const PROXIMA: Record<string, string> = {
  analisar: 'em_analise',
  autorizar: 'autorizada',
  produzir: 'em_producao',
  pronta: 'pronta',
};

test.describe('@C2-036 cópia do prontuário no balcão', () => {
  test('pedido com validação na hora, passos até a cópia pronta, entrega com documento e folhas; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const estado: { situacao: string | null; versao: number } = { situacao: null, versao: 1 };
    const posts: { url: string; corpo: Record<string, unknown> }[] = [];
    // O balcão do arquivo (lê e exporta o prontuário); o administrador não tem permissão clínica.
    await entrar(page, 'SINT.SAME.COPIA');
    await page.route('**/api/pep/copias-prontuario**', async (route: Route) => {
      const req = route.request();
      const url = req.url();
      if (req.method() === 'GET')
        return route.fulfill({ json: { hoje: '2026-11-25', pedidos: pedido(estado), opcoes } });
      const corpo = req.postDataJSON() as Record<string, unknown>;
      posts.push({ url, corpo });
      if (url.endsWith('/entrega')) estado.situacao = 'entregue';
      else if (url.endsWith('/acao')) estado.situacao = PROXIMA[String(corpo['acao'])] ?? estado.situacao;
      else estado.situacao = 'solicitada';
      estado.versao += 1;
      return route.fulfill({ json: { ok: true } });
    });

    await page.goto(`/pep/paciente/${PACIENTE}/copias-prontuario`);
    await expect(page.getByTestId('copias-prontuario')).toBeVisible();

    // Pedido do familiar: CPF e parentesco pedidos na hora; o botão só libera com tudo certo.
    await escolher(page.getByTestId('copias-solicitante'), { rotulo: /amiliar/ });
    await page.getByTestId('copias-nome').fill('Familiar Sintético');
    await page.getByTestId('copias-motivo').fill('Segunda opinião (sintético)');
    await expect(page.getByTestId('copias-faltas')).toBeVisible();
    await expect(page.getByTestId('copias-pedir')).toBeDisabled();
    await page.getByTestId('copias-cpf').fill('529.982.247-25');
    await page.getByTestId('copias-parentesco').fill('Irmão');
    await expect(page.getByTestId('copias-faltas')).toHaveCount(0);
    await page.getByTestId('copias-pedir').click();
    await expect(page.getByTestId(`copia-${base.numero}`)).toBeVisible();

    // Só o próximo passo possível aparece em cada situação.
    await page.getByTestId(`copia-autorizar-${base.numero}`).click();
    await expect(page.getByTestId(`copia-analisar-${base.numero}`)).toHaveCount(0);
    await page.getByTestId(`copia-pronta-${base.numero}`).click();
    await expect(page.getByTestId(`copia-autorizar-${base.numero}`)).toHaveCount(0);

    // Entrega: quem recebeu, vínculo, documento conferido e folhas.
    const card = page.getByTestId(`copia-${base.numero}`);
    await expect(page.getByTestId(`copia-entregar-${base.numero}`)).toBeDisabled();
    await card.getByTestId('entrega-nome').fill('Familiar Sintético');
    await escolher(card.getByTestId('entrega-vinculo'), { rotulo: 'Irmão ou irmã' });
    await escolher(card.getByTestId('entrega-tipo-documento'), { rotulo: /sintético/ });
    await card.getByTestId('entrega-documento').fill('SINT1234');
    await card.getByTestId('entrega-folhas').fill('12');
    await expect(page.getByTestId(`copia-entregar-${base.numero}`)).toBeEnabled();
    await page.getByTestId(`copia-entregar-${base.numero}`).click();
    await expect(card.getByTestId('copia-situacao')).toHaveText('Entregue');
    await expect(card.getByTestId('copia-entrega')).toContainText('Familiar Sintético');

    expect(posts.map((x) => new URL(x.url).pathname.replace('/api/pep/copias-prontuario', ''))).toEqual([
      '',
      `/${base.id}/acao`,
      `/${base.id}/acao`,
      `/${base.id}/entrega`,
    ]);
    const entrega = posts[3]?.corpo ?? {};
    expect(entrega['vinculo']).toBe('irmao');
    expect(entrega['tipoDocumento']).toBe(1);
    expect(entrega['quantidadeFolhas']).toBe(12);
    await semViolacaoAxe(page, '/pep/paciente/:id/copias-prontuario');
    expect(externas).toEqual([]);
  });

  test('cabeçalho por tipo de documento: texto próprio validado na hora, inclusão e prévia', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const regras: Record<string, unknown>[] = [];
    const posts: Record<string, unknown>[] = [];
    await entrar(page, 'SINT.ADMIN');
    await page.route('**/api/pep/cabecalhos-impressao**', async (route: Route) => {
      const req = route.request();
      if (req.method() === 'GET' && req.url().includes('/previa'))
        return route.fulfill({
          json: {
            regra: regras.length ? 1 : null,
            linhas: regras.length ? ['Serviço de arquivo sintético'] : ['Hospital Sintético'],
            rodape: [],
            exibeDadosPaciente: true,
            exibeAssinatura: true,
          },
        });
      if (req.method() === 'GET') return route.fulfill({ json: { regras, opcoes } });
      const corpo = req.postDataJSON() as Record<string, unknown>;
      posts.push(corpo);
      regras.push({
        id: 1,
        versao: 1,
        estabelecimento: 1,
        tipoDocumento: null,
        tipoDocumentoNome: null,
        fonte: corpo['fonte'],
        cabecalho: corpo['cabecalho'],
        rodape: corpo['rodape'],
        exibeDadosPaciente: true,
        exibeAssinatura: true,
        gerenciavel: true,
        ativo: true,
      });
      return route.fulfill({ json: { ok: true } });
    });

    await page.goto('/pep/admin/impressao');
    await page.getByTestId('link-cabecalhos-impressao').click();
    await expect(page.getByTestId('cabecalhos-impressao')).toBeVisible();
    await expect(page.getByTestId('cabecalhos-previa')).toContainText('Hospital Sintético');

    await escolher(page.getByTestId('cabecalhos-fonte'), { rotulo: 'Texto próprio' });
    await expect(page.getByTestId('cabecalhos-salvar')).toBeDisabled();
    await page.getByTestId('cabecalhos-texto').fill('<b>marcação</b>');
    await expect(page.getByTestId('cabecalhos-faltas')).toBeVisible();
    await page.getByTestId('cabecalhos-texto').fill('Serviço de arquivo sintético');
    await expect(page.getByTestId('cabecalhos-faltas')).toHaveCount(0);
    await page.getByTestId('cabecalhos-salvar').click();
    await expect(page.getByTestId('cabecalho-regra-1')).toBeVisible();
    await expect(page.getByTestId('cabecalhos-previa')).toContainText('Serviço de arquivo sintético');
    expect(posts[0]?.['fonte']).toBe('personalizado');
    await semViolacaoAxe(page, '/pep/admin/impressao/cabecalhos');
    expect(externas).toEqual([]);
  });
});
