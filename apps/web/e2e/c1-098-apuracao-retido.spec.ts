// F7, 07-FIN linha 110 (C1-098): apuração do retido pelo hospital e DARF pela tela. No painel fiscal da EFD-Reinf, o
// recolhimento do IRRF da competência é gerado no painel das retenções; a apuração aparece na hora com a guia, o título
// e as parcelas por código de receita (com a soma), o DARF abre na tela com os campos 01 a 10 e o batimento mostra o
// retido contra a Reinf com a diferença. Axe em cada passo.
// As rotas `financeiro/contabil-fiscal/retencao` dependem do banco do cliente, que a fonte sintética do E2E não tem:
// aqui a API é simulada (page.route) com o mesmo formato e estado. O que fica gravado (título, guia DARF, apuração e
// itens) é provado contra o MariaDB em `apuracao-retido.int.spec.ts`.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (r: Route, corpo: unknown, status = 200) =>
  r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const CAMPOS = [
  ['01', 'Nome', 'HOSPITAL SINTETICO'],
  ['02', 'Período de apuração', '31/10/2026'],
  ['03', 'Número do CPF ou CNPJ', '00.000.000/0001-91'],
  ['04', 'Código da receita', '1708'],
  ['05', 'Número de referência', ''],
  ['06', 'Data de vencimento', '20/11/2026'],
  ['07', 'Valor do principal', '45,00'],
  ['08', 'Valor da multa', '0,00'],
  ['09', 'Valor dos juros e encargos', '0,00'],
  ['10', 'Valor total', '45,00'],
].map(([numero, rotulo, valor]) => ({ numero, rotulo, valor }));

/** A API das retenções do contábil-fiscal, simulada com estado: o recolhimento cria a apuração e a guia. */
function simularApi(page: Page): string[] {
  const enviados: string[] = [];
  let recolhido = false;
  void page.route('**/api/financeiro/retencao-sofrida/**', (r) => json(r, []));
  void page.route('**/api/financeiro/contabil-fiscal/fornecedores**', (r) =>
    json(r, [{ id: 41, nome: 'Fazenda Sintética Arrecadadora', documento: '00000000000191' }]),
  );
  void page.route('**/api/financeiro/contabil-fiscal/retencao/**', async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const caminho = url.pathname.replace('/api/financeiro/contabil-fiscal/retencao', '');
    if (req.method() === 'POST') {
      enviados.push(caminho);
      if (caminho === '/recolhimento') {
        recolhido = true;
        return json(r, {
          mensagem: 'Título do recolhimento gerado; as retenções da competência ficam ligadas a ele.',
          repetida: false,
          avisos: [],
        });
      }
      return json(r, { title: 'Não encontrado' }, 404);
    }
    if (caminho === '/apoio')
      return json(r, {
        tributos: [
          { id: 5, sigla: 'IRRF', descricao: 'Imposto de renda retido na fonte', codigoReceita: '1708' },
        ],
        naturezas: [{ id: 9, codigo: '2.1', descricao: 'Tributos a recolher' }],
      });
    if (caminho === '/em-aberto')
      return json(
        r,
        recolhido ? [] : [{ tributo: 5, sigla: 'IRRF', codigoReceita: '1708', retencoes: 2, valor: 45 }],
      );
    if (caminho === '/apuracoes')
      return json(
        r,
        recolhido
          ? [
              {
                id: 7,
                numero: 'RT-2026-10-5-1',
                sigla: 'IRRF',
                codigoReceita: '1708',
                situacao: 'recolhida',
                vencimento: '2026-11-20',
                base: 3000,
                total: 45,
                parcelas: [{ codigoReceita: '1708', retencoes: 2, base: 3000, valor: 45 }],
                somaParcelas: 45,
                guia: 31,
                guiaNumero: 12,
                guiaSituacao: 'emitida',
                titulo: 'TP-88',
              },
            ]
          : [],
      );
    if (caminho === '/darf') {
      enviados.push(`/darf?guia=${url.searchParams.get('guia')}`);
      return json(r, {
        guia: 31,
        numero: 12,
        competencia: '2026-10',
        situacao: 'emitida',
        campos: CAMPOS,
        total: 45,
      });
    }
    if (caminho === '/batimento-reinf')
      return json(r, {
        competencia: '2026-10',
        porTributo: [{ sigla: 'IRRF', valor: 45 }],
        eventosReinf: 1,
        linhas: [{ grupo: 'irrf', apurado: 45, reinf: 40, diferenca: 5, confere: false }],
        foraDaReinf: [],
        confere: false,
      });
    return json(r, []);
  });
  return enviados;
}

test.describe('financeiro: apuração do retido e DARF @C1-098', () => {
  test('recolher o IRRF → apuração com parcelas por código → DARF 01 a 10 → batimento com a Reinf; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const enviados = simularApi(page);
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/fiscal/reinf');
    await expect(page.getByTestId('tela-fin-reinf')).toBeVisible();
    await page.getByTestId('dc-periodo').fill('2026-10');
    await expect(page.getByTestId('ar-painel')).toBeVisible();
    await expect(page.getByTestId('ar-nada')).toBeVisible();
    await expect(page.getByTestId('ar-batimento-irrf')).toContainText('Não confere');
    await semViolacaoAxe(page, '/financeiro/fiscal/reinf (apuração vazia e batimento)');
    // O recolhimento no painel das retenções: credor pelo nome e um clique.
    await page.getByTestId('rt-credor-busca').fill('Fazenda');
    await page.getByTestId('rt-credor-achados').getByRole('button').first().click();
    await page.getByTestId('rt-gerar-IRRF').click();
    await expect(page.getByTestId('rt-ok')).toContainText('Título do recolhimento gerado');
    expect(enviados).toContain('/recolhimento');
    // A apuração aparece sem recarregar, com a parcela por código e a soma.
    const linha = page.getByTestId('ar-apuracao-7');
    await expect(linha).toContainText('1708: 45,00 (2)');
    await expect(linha).toContainText('soma 45,00');
    await expect(linha).toContainText('TP-88');
    await semViolacaoAxe(page, '/financeiro/fiscal/reinf (apuração do retido)');
    // O DARF abre na tela com os dez campos do modelo.
    await page.getByTestId('ar-darf-7').click();
    await expect(page.getByTestId('ar-darf')).toBeVisible();
    await expect(page.getByTestId('ar-darf-campos').locator('tr')).toHaveCount(10);
    await expect(page.getByTestId('ar-darf-04')).toContainText('1708');
    await expect(page.getByTestId('ar-darf-10')).toContainText('45,00');
    expect(enviados).toContain('/darf?guia=31');
    await semViolacaoAxe(page, '/financeiro/fiscal/reinf (DARF da guia)');
    await page.getByTestId('ar-fechar').click();
    await expect(page.getByTestId('ar-darf')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
