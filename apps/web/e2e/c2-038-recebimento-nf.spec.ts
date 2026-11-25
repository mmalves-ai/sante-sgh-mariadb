// E2E @C2-038 (05-SUP linha 21): recebimento por nota fiscal com a conferência física e os impostos por item, sobre a
// porta PRÓPRIA (MariaDB, cliente de teste). O almoxarife abre "Entrada por nota fiscal" pelo menu, segue o atalho da
// conferência física, registra a entrega de um item com avaria (a divergência aparece na hora, pela regra do domínio) e
// grava: a conferência fica "Divergente". Outra pessoa (o comprador) valida: sem justificativa, a regra avisa e trava o
// botão; com a justificativa, fica "Validada". Depois a nota entra pelo XML SINTÉTICO com ICMS e IPI no item: o item do
// estoque é ligado à linha do XML (quantidade, unitário e impostos vêm dela), o custo de entrada aparece na hora (produtos
// + IPI, sem crédito de ICMS, padrão do hospital) e a conferência validada é escolhida. A API depois mostra a
// conferência ligada à nota: o que prova que ficou no banco. axe sem violação séria. Precisa de um fornecedor ativo, um
// item sem lote e um local de entrada no cliente do E2E; sem isso, o teste é pulado com o motivo dito. A sessão
// sintética sem banco próprio responde 503 e também pula. Massa SINTÉTICA; nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const C = '/api/suprimentos/conferencias-recebimento';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** NF-e sintética de um item: 10 unidades a R$ 12,00; ICMS 18% e IPI 5% (por fora). */
function xmlSintetico(numero: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe Id="NFe35261100000000000191550010000${String(numero).padStart(5, '0')}1000000010">
<ide><nNF>${numero}</nNF><serie>1</serie><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>00000000000191</CNPJ><xNome>Distribuidora sintética</xNome></emit>
<det nItem="1"><prod><cProd>SINT-001</cProd><xProd>Insumo sintético</xProd><uCom>UN</uCom><qCom>10.0000</qCom>
<vUnCom>12.0000</vUnCom><vProd>120.00</vProd></prod>
<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>120.00</vBC><pICMS>18.00</pICMS><vICMS>21.60</vICMS></ICMS00></ICMS>
<IPI><IPITrib><CST>50</CST><vBC>120.00</vBC><pIPI>5.00</pIPI><vIPI>6.00</vIPI></IPITrib></IPI></imposto></det>
<total><ICMSTot><vBC>120.00</vBC><vICMS>21.60</vICMS><vProd>120.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg>
<vDesc>0.00</vDesc><vIPI>6.00</vIPI><vOutro>0.00</vOutro><vNF>126.00</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`;
}

test.describe('Recebimento por nota fiscal com conferência física e impostos @C2-038', () => {
  test.setTimeout(240_000);

  test('conferência com avaria, validada por outra pessoa, e a nota do XML com impostos usa a conferência', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ALMOXARIFE');

    const sonda = await page.request.get(C);
    test.skip(sonda.status() === 503, 'Sessão sem banco próprio: a conferência grava só no MariaDB.');
    const fornecedores = (await (await page.request.get('/api/suprimentos/fornecedores?termo=a')).json()) as
      { itens?: { codigo?: number; id?: number }[] } | { codigo?: number; id?: number }[];
    const lista = Array.isArray(fornecedores) ? fornecedores : (fornecedores.itens ?? []);
    const fornecedor = lista[0]?.codigo ?? lista[0]?.id ?? null;
    test.skip(fornecedor === null, 'Sem fornecedor ativo no cliente do E2E.');

    // ── Conferência física pela tela ──
    await page.getByRole('link', { name: 'Entrada por nota fiscal' }).first().click();
    await expect(page).toHaveURL(/\/suprimentos\/notas-fiscais$/);
    await page.getByTestId('nf-conferencias').click();
    const tela = page.getByTestId('tela-conferencia-recebimento');
    await expect(tela).toBeVisible();
    await semViolacaoAxe(page, '/suprimentos/notas-fiscais/conferencias');

    await tela.getByTestId('conf-fornecedor').fill(String(fornecedor));
    await escolher(tela.getByTestId('conf-local'), { indice: 1 });
    await tela.getByTestId('conf-busca-termo').fill('a');
    await tela.getByTestId('conf-busca-buscar').click();
    const opcoes = tela.locator('[data-testid^="conf-busca-opcao-"]');
    test.skip((await opcoes.count()) === 0, 'Sem item de estoque na busca do cliente do E2E.');
    const testid = (await opcoes.first().getAttribute('data-testid'))!;
    const item = Number(testid.replace('conf-busca-opcao-', ''));
    await opcoes.first().click();
    const linha = tela.getByTestId(`conf-linha-${item}`);
    await expect(linha).toBeVisible();
    await tela.getByTestId(`conf-qtde-${item}`).fill('10');
    const comLote = (await tela.getByTestId(`conf-lote-${item}`).count()) > 0;
    if (comLote) {
      await tela.getByTestId(`conf-lote-${item}`).fill('LOTE-SINT-38');
      await tela.getByTestId(`conf-validade-${item}`).fill('2029-12-31');
    }
    // Apontamento sem descrição: a regra do domínio avisa na hora e o botão fica travado.
    await escolher(tela.getByTestId(`conf-apontamento-${item}`), { rotulo: 'Avaria' });
    await expect(tela.getByTestId('conf-aviso')).toBeVisible();
    await expect(tela.getByTestId('conf-registrar')).toBeDisabled();
    await tela.getByTestId(`conf-observacao-${item}`).fill('Caixa externa amassada, conteúdo íntegro');
    await expect(tela.getByTestId('conf-aviso')).toHaveCount(0);
    await expect(tela.getByTestId(`conf-divergencia-${item}`)).toHaveText('Avaria');
    await tela.getByTestId('conf-registrar').click();
    await expect(tela.getByTestId('conf-mensagem')).toContainText('Divergente');
    const detalhe = tela.getByTestId('conf-detalhe');
    await expect(detalhe).toBeVisible();
    const conferencia = Number(
      ((await detalhe.getByRole('heading').first().textContent()) ?? '').replace(/\D+/g, ''),
    );
    expect(conferencia).toBeGreaterThan(0);

    // ── Validação por outra pessoa ──
    await entrar(page, 'SINT.COMPRADOR');
    await page.goto('/suprimentos/notas-fiscais/conferencias');
    await escolher(tela.getByTestId('conf-filtro'), { rotulo: 'Divergente' });
    await tela.getByTestId(`conf-abrir-${conferencia}`).click();
    await expect(tela.getByTestId('conf-aviso-validar')).toBeVisible();
    await expect(tela.getByTestId('conf-validar')).toBeDisabled();
    await tela.getByTestId('conf-justificativa').fill('Avaria só na caixa externa; produto aceito');
    await expect(tela.getByTestId('conf-validar')).toBeEnabled();
    await tela.getByTestId('conf-validar').click();
    await expect(tela.getByTestId('conf-mensagem')).toContainText('validada');
    await semViolacaoAxe(page, '/suprimentos/notas-fiscais/conferencias');

    // ── A nota pelo XML sintético, com os impostos e a conferência ligada ──
    await entrar(page, 'SINT.ALMOXARIFE');
    await page.goto('/suprimentos/notas-fiscais');
    const nf = page.getByTestId('tela-suprimentos-notas');
    const numeroNota = 38_000 + (Date.now() % 900);
    await nf.getByTestId('nf-xml').setInputFiles({
      name: 'nfe-sintetica.xml',
      mimeType: 'text/xml',
      buffer: Buffer.from(xmlSintetico(numeroNota)),
    });
    await expect(nf.getByTestId('nf-numero')).toHaveValue(String(numeroNota));
    await nf.getByTestId('nf-fornecedor').fill(String(fornecedor));
    await escolher(nf.getByTestId('nf-local'), { indice: 1 });
    await nf.getByTestId('nf-busca-termo').fill(String(item));
    await nf.getByTestId('nf-busca-buscar').click();
    await nf.getByTestId(`nf-busca-opcao-${item}`).click();
    await escolher(nf.getByTestId(`nf-xml-linha-${item}`), { indice: 1 });
    await expect(nf.getByTestId(`nf-qtde-${item}`)).toHaveValue('10');
    await expect(nf.getByTestId(`nf-impostos-${item}`)).toContainText('ICMS');
    await expect(nf.getByTestId(`nf-impostos-${item}`)).toContainText('IPI');
    // Custo de entrada: 120,00 + IPI 6,00 (o ICMS próprio já está no preço e o hospital não toma crédito).
    await expect(nf.getByTestId('nf-custo-entrada')).toContainText('126,00');
    if (comLote) {
      await nf.getByTestId(`nf-lote-${item}-0`).fill('LOTE-SINT-38');
      await nf.getByTestId(`nf-validade-${item}-0`).fill('2029-12-31');
      await nf.getByTestId(`nf-lote-qtde-${item}-0`).fill('10');
    }
    await escolher(nf.getByTestId('nf-conferencia'), { rotulo: new RegExp(`^${conferencia} `) });
    await semViolacaoAxe(page, '/suprimentos/notas-fiscais');
    await nf.getByTestId('nf-gravar').click();
    await expect(page.getByTestId('nf-mensagem')).toBeVisible();

    // A conferência ficou ligada à nota no banco.
    const depois = (await (await page.request.get(`${C}/${conferencia}`)).json()) as {
      situacao: string;
      nota: number | null;
    };
    expect(depois.situacao).toBe('validada');
    expect(depois.nota).not.toBeNull();
    expect(externas).toEqual([]);
  });
});
