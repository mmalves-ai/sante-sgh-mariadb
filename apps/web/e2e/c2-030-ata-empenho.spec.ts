// E2E @C2-030 (05-SUP linha 26): ata de registro de preços e empenho sobre a porta própria (MariaDB). A autoridade entra
// pelo menu (Suprimentos > Compras > Ata de registro de preços e empenho), escolhe o processo homologado (os itens
// adjudicados vêm prontos), vê a vigência máxima de 1 ano recusada na hora, registra a ata, empenha parte do saldo (a
// regra recusa na hora o que passa do saldo e o empenho sem fonte de recurso), confere o saldo que caiu, anula o
// empenho com motivo e vê o saldo voltar. axe sem violação séria. Precisa de um processo homologado com item adjudicado
// no cliente do E2E (o fluxo @M55.4 deixa a dispensa homologada); sem ele, o teste é pulado com o motivo dito.
// Massa SINTÉTICA, nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const MARCA = Date.now().toString(36).toUpperCase();
const EMPENHO = `NE${MARCA}`.slice(0, 20);

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

function dia(deslocamentoDias: number, deslocamentoAnos = 0): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + deslocamentoAnos);
  d.setDate(d.getDate() + deslocamentoDias);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test.describe('Ata de registro de preços e empenho @C2-030', () => {
  test.setTimeout(180_000);

  test('ata do processo homologado, empenho sobre o saldo e anulação que devolve o saldo', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.AUTORIDADE');

    // Pelo menu.
    await page.getByRole('link', { name: 'Ata de registro de preços e empenho' }).first().click();
    await expect(page).toHaveURL(/\/suprimentos\/atas-registro-preco/);
    await expect(page.getByTestId('tela-atas-registro-preco')).toBeVisible();
    await semViolacaoAxe(page, '/suprimentos/atas-registro-preco');

    const processos = (await (
      await page.request.get('/api/suprimentos/atas-registro-preco/processos')
    ).json()) as {
      numero: string;
      itens: { quantidade: number }[];
    }[];
    const processo = processos.find((p) => p.itens.length > 0);
    test.skip(!processo, 'Sem processo homologado com item adjudicado no cliente do E2E.');

    // A ata nasce do processo: os itens adjudicados vêm prontos; a vigência acima de 1 ano é recusada na hora.
    await escolher(page.getByTestId('arp-processo'), { rotulo: new RegExp(processo!.numero) });
    await expect(page.getByTestId('arp-itens-novos').locator('tbody tr')).toHaveCount(processo!.itens.length);
    await page.getByTestId('arp-numero').fill(`ARP${MARCA}`);
    await page.getByTestId('arp-fim').fill(dia(0, 1));
    await expect(page.getByTestId('arp-recusa')).toContainText('até 1 ano');
    await expect(page.getByTestId('arp-registrar')).toBeDisabled();
    await page.getByTestId('arp-fim').fill(dia(-1, 1));
    await expect(page.getByTestId('arp-recusa')).toHaveCount(0);
    await page.getByTestId('arp-registrar').click();
    await expect(page.getByTestId('arp-mensagem')).toContainText(`ARP${MARCA}`);

    // O empenho de 1 unidade do primeiro item: acima do saldo e sem fonte são recusados na hora.
    const ata = page.getByTestId(`arp-ata-ARP${MARCA}`);
    await expect(ata.getByTestId('arp-ata-situacao')).toHaveAttribute('data-situacao', 'vigente');
    const registrada = processo!.itens[0]!.quantidade;
    await ata.getByTestId('arp-empenhar').click();
    await ata.getByTestId('emp-qtd-1').fill(String(registrada + 1));
    await ata.getByTestId('emp-numero').fill(EMPENHO);
    await expect(ata.getByTestId('emp-recusa')).toBeVisible();
    await expect(ata.getByTestId('emp-emitir')).toBeDisabled();
    await ata.getByTestId('emp-qtd-1').fill('1');
    await expect(ata.getByTestId('emp-recusa')).toContainText('fonte de recurso');
    await ata.getByTestId('emp-fonte').fill('1.500.1002');
    await expect(ata.getByTestId('emp-recusa')).toHaveCount(0);
    await ata.getByTestId('emp-emitir').click();
    await expect(page.getByTestId('arp-mensagem')).toContainText(EMPENHO);
    await expect(ata.getByTestId('arp-saldo-1')).not.toHaveText(String(registrada));

    // A anulação pede o motivo e devolve o saldo.
    const linha = page.getByTestId(`emp-${EMPENHO}`);
    await expect(linha.getByTestId('emp-situacao')).toHaveAttribute('data-situacao', 'emitido');
    await linha.getByTestId('emp-anular').click();
    await expect(linha.getByTestId('emp-confirmar-anulacao')).toBeDisabled();
    await linha.getByTestId('emp-motivo').fill('Dotação remanejada no orçamento');
    await linha.getByTestId('emp-confirmar-anulacao').click();
    await expect(page.getByTestId('arp-mensagem')).toContainText('saldo voltou');
    await expect(linha.getByTestId('emp-situacao')).toHaveAttribute('data-situacao', 'anulado');
    await semViolacaoAxe(page, '/suprimentos/atas-registro-preco (empenho anulado)');
    expect(externas).toEqual([]);
  });
});
