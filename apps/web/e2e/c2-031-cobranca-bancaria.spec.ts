// E2E @C2-031 (F7, 07-FIN linha 78): cobrança bancária com boleto. As rotas `/api/financeiro/cobranca-bancaria/*` só
// existem no banco do cliente (na fonte sintética respondem 503), então este E2E simula essas rotas com um estado em
// memória que segue a regra do servidor. O que fica no banco (carteira, boletos com código de barras, remessa CNAB 240,
// retorno que liquida a parcela e lança a tarifa) está no contrato de efeito
// apps/api/src/modulos/financeiro/cobranca-bancaria.int.spec.ts. Aqui se prova o fluxo da tela: cadastrar a carteira
// com a validação na hora, emitir os boletos de duas parcelas do mesmo pagador de uma vez (o documento que falta no
// cadastro é informado na hora), imprimir com o código de barras, gerar a remessa, processar o retorno do simulador e
// ver o boleto liquidado com a tarifa. Axe na tela. Massa SINTÉTICA.
import { montarRetornoCobranca240 } from '@sgh/dominio-financeiro';
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const P = '/api/financeiro/cobranca-bancaria';

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

const CODIGO = '0019' + '1' + '0000' + '0000010000' + '0'.repeat(25); // 44 dígitos fictícios

function simular(page: Page) {
  const corpos: Record<string, unknown>[] = [];
  const carteiras: Record<string, unknown>[] = [];
  const parcelas = [
    { parcela: 501, titulo: 'TR-FIC-1', sequencia: 1, vencimento: '2030-04-10', saldo: 100 },
    { parcela: 502, titulo: 'TR-FIC-1', sequencia: 2, vencimento: '2030-05-10', saldo: 150 },
  ].map((p) => ({
    ...p,
    devedor: 'particular',
    pagador: 'PAGADOR FICTICIO',
    temDocumento: false,
    temBoleto: false,
  }));
  const boletos: Record<string, unknown>[] = [];
  const remessas: Record<string, unknown>[] = [];
  const retornos: Record<string, unknown>[] = [];
  // O retorno do simulador, montado pela mesma regra do servidor (o simulador da API usa montarRetornoCobranca240):
  // liquidação de cada boleto enviado, com a tarifa.
  const retornoSimulado = () =>
    montarRetornoCobranca240(
      1,
      1,
      '2030-04-10',
      boletos.map((b) => ({
        codigo: '06',
        nossoNumero: String(b['nossoNumero']),
        valorTitulo: Number(b['valor']),
        valorPago: Number(b['valor']),
        tarifa: 2.5,
        vencimento: String(b['vencimento']),
        dataOcorrencia: '2030-04-10',
      })),
    );
  return {
    corpos,
    async ligar() {
      await page.route('**/api/financeiro/gravacao', (rota) =>
        json(rota, { funcionalidades: {}, operacoes: {}, ambiente: 'dev', destinoExterno: 'simulador' }),
      );
      await page.route('**/api/financeiro/apoio', (rota) =>
        json(rota, {
          contas: [{ id: 7, banco: 1, agencia: 1234, codigo: 5678, descricao: 'CONTA FICTICIA' }],
        }),
      );
      await page.route(`**${P}/carteiras`, async (rota) => {
        if (rota.request().method() === 'GET') return json(rota, carteiras);
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        carteiras.push({
          id: 31,
          descricao: c['descricao'],
          carteira: c['codigoCarteira'],
          beneficiario: c['codigoBeneficiario'],
          conta: c['conta'],
          contaNome: 'CONTA FICTICIA',
          ativo: true,
          faixa: `${String(c['nossoNumeroInicial'])} a ${String(c['nossoNumeroFinal'])}`,
          disponiveis: Number(c['nossoNumeroFinal']) - Number(c['nossoNumeroInicial']),
          diasCompensacao: c['diasCompensacao'],
          tarifa: c['valorTarifa'],
          aguardandoRemessa: 0,
          emAberto: 0,
        });
        return json(rota, {
          mensagem: 'Carteira de cobrança cadastrada.',
          repetida: false,
          dados: { carteira: 31 },
        });
      });
      await page.route(/\/api\/financeiro\/cobranca-bancaria\/parcelas/, (rota) => json(rota, parcelas));
      await page.route(/\/api\/financeiro\/cobranca-bancaria\/boletos\/impressao/, (rota) => {
        const id = Number(new URL(rota.request().url()).searchParams.get('boleto'));
        const b = boletos.find((x) => x['id'] === id)!;
        return json(rota, {
          id,
          banco: '001',
          bancoNome: 'BANCO FICTICIO',
          beneficiario: 'HOSPITAL FICTICIO',
          beneficiarioDocumento: '00000000000191',
          agenciaCodigo: '1234 / 998877',
          carteira: '17',
          localPagamento: 'Pagável em qualquer banco até o vencimento',
          nossoNumero: b['nossoNumero'],
          documento: b['documento'],
          pagador: b['pagador'],
          pagadorDocumento: '***.***.***-91',
          emissao: '2030-04-01',
          vencimento: b['vencimento'],
          valor: b['valor'],
          linhaDigitavel: b['linhaDigitavel'],
          codigoBarras: CODIGO,
          situacao: b['situacao'],
          instrucoes: ['Após o vencimento, multa de 2.00%.'],
        });
      });
      await page.route(/\/api\/financeiro\/cobranca-bancaria\/boletos(\?|$)/, async (rota) => {
        if (rota.request().method() === 'GET') return json(rota, boletos);
        const c = rota.request().postDataJSON() as { parcelas: number[] } & Record<string, unknown>;
        corpos.push(c);
        for (const id of c.parcelas) {
          const p = parcelas.find((x) => x.parcela === id)!;
          p.temBoleto = true;
          boletos.push({
            id: 800 + boletos.length,
            carteira: 31,
            nossoNumero: `1700000000${boletos.length + 1}`,
            documento: `${p.titulo}/${p.sequencia}`,
            linhaDigitavel: '00190000090000000000000000000000400000000010000',
            pagador: 'PAGADOR FICTICIO',
            emissao: '2030-04-01',
            vencimento: p.vencimento,
            valor: p.saldo,
            valorPago: null,
            dataPagamento: null,
            situacao: 'emitido',
            enviado: false,
            motivoCancelamento: null,
          });
        }
        const c0 = carteiras[0]!;
        c0['aguardandoRemessa'] = boletos.length;
        return json(rota, {
          mensagem: `${c.parcelas.length} boleto(s) emitido(s), total de R$ 250,00.`,
          repetida: false,
          dados: {},
        });
      });
      await page.route(/\/api\/financeiro\/cobranca-bancaria\/remessas\/arquivo/, (rota) =>
        json(rota, { nomeArquivo: 'cobranca-31-1.rem', conteudo: 'x', conferido: true }),
      );
      await page.route(/\/api\/financeiro\/cobranca-bancaria\/remessas(\?|$)/, async (rota) => {
        if (rota.request().method() === 'GET') return json(rota, remessas);
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        for (const b of boletos) b['enviado'] = true;
        carteiras[0]!['aguardandoRemessa'] = 0;
        remessas.push({
          id: 61,
          numero: 'REM-1',
          sequencial: 1,
          geradaEm: '2030-04-01T10:00:00.000Z',
          por: 'SINT.ADMIN',
          titulos: boletos.length,
          valor: 250,
          situacao: 'gerada',
          mensagem: c['mensagem'],
          rejeitados: 0,
        });
        return json(rota, {
          mensagem: 'Remessa 1 gerada: 2 registro(s) e 0 pedido(s) de baixa, total de R$ 250,00.',
          repetida: false,
          dados: {},
        });
      });
      await page.route(/\/api\/financeiro\/cobranca-bancaria\/retorno-simulado/, (rota) =>
        json(rota, { nomeArquivo: 'retorno-cobranca-simulado-31.ret', conteudo: retornoSimulado() }),
      );
      await page.route(/\/api\/financeiro\/cobranca-bancaria\/retornos(\?|$)/, async (rota) => {
        if (rota.request().method() === 'GET') return json(rota, retornos);
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push({ carteira: c['carteira'], nomeArquivo: c['nomeArquivo'] });
        for (const b of boletos) {
          b['situacao'] = 'pago';
          b['valorPago'] = b['valor'];
          b['dataPagamento'] = '2030-04-10';
        }
        retornos.push({
          id: 71,
          arquivo: c['nomeArquivo'],
          importadoEm: '2030-04-10T09:00:00.000Z',
          por: 'SINT.ADMIN',
          situacao: 'processado',
          registros: 2,
          liquidados: 2,
          rejeitados: 0,
          total: 250,
          tarifas: 5,
          itens: boletos.map((b, n) => ({
            sequencia: n + 1,
            ocorrencia: '06',
            descricao: 'Liquidação',
            nossoNumero: b['nossoNumero'],
            pagador: b['pagador'],
            situacao: 'liquidado',
            valorTitulo: b['valor'],
            valorPago: b['valor'],
            tarifa: 2.5,
            dataPagamento: '2030-04-10',
            motivo: null,
          })),
        });
        return json(rota, {
          mensagem:
            'Retorno processado: 2 liquidado(s) (R$ 250,00), 0 registro(s) confirmado(s), 0 rejeitado(s), 0 não localizado(s); tarifas de R$ 5,00.',
          repetida: false,
          dados: {},
        });
      });
    },
  };
}

test.describe('@C2-031 cobrança bancária com boleto', () => {
  test.setTimeout(180_000);

  test('carteira validada na hora, emissão em lote, impressão, remessa e retorno com liquidação e tarifa', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page);
    await api.ligar();
    await entrar(page, 'SINT.ADMIN');

    await page.goto('/financeiro/receber/cobranca-bancaria');
    await expect(page.getByTestId('tela-fin-cobranca-bancaria')).toBeVisible();
    await expect(page.getByTestId('cb-sem-carteira')).toBeVisible();

    // Carteira: a faixa invertida do nosso número é recusada na hora; corrigida, grava.
    await page.getByTestId('cb-aba-carteiras').click();
    await escolher(page.getByTestId('cb-carteira-conta'), '7');
    await page.getByTestId('cb-c-descricao').fill('CARTEIRA FICTICIA');
    await page.getByTestId('cb-c-codigo').fill('17');
    await page.getByTestId('cb-c-beneficiario').fill('998877');
    await page.getByTestId('cb-c-inicio').fill('1000');
    await page.getByTestId('cb-c-fim').fill('10');
    await expect(page.getByTestId('cb-recusa-carteira')).toContainText('faixa do nosso número');
    await expect(page.getByTestId('cb-incluir-carteira')).toBeDisabled();
    await page.getByTestId('cb-c-fim').fill('99999');
    await page.getByTestId('cb-c-tarifa').fill('2,50');
    await expect(page.getByTestId('cb-recusa-carteira')).toHaveCount(0);
    await page.getByTestId('cb-incluir-carteira').click();
    await expect(page.getByTestId('cb-mensagem')).toContainText('Carteira de cobrança cadastrada');
    expect(api.corpos.at(-1)).toMatchObject({
      acao: 'incluir',
      conta: 7,
      codigoCarteira: '17',
      codigoBeneficiario: '998877',
      nossoNumeroInicial: 1000,
      nossoNumeroFinal: 99999,
      valorTarifa: 2.5,
    });
    await expect(page.getByTestId('cb-carteira-31')).toHaveAttribute('data-ativo', 'true');

    // Boletos: duas parcelas do mesmo pagador, sem documento no cadastro: o CPF é informado na hora.
    await page.getByTestId('cb-aba-boletos').click();
    await page.getByTestId('cb-marcar-501').check();
    await page.getByTestId('cb-marcar-502').check();
    await expect(page.getByTestId('cb-total-marcado')).toContainText('2 parcela(s)');
    await expect(page.getByTestId('cb-falta-documento')).toBeVisible();
    await page.getByTestId('cb-pagador-documento').fill('123');
    await expect(page.getByTestId('cb-recusa-emissao')).toContainText('CPF (11 dígitos)');
    await expect(page.getByTestId('cb-emitir')).toBeDisabled();
    await page.getByTestId('cb-pagador-documento').fill('000.000.001-91');
    await expect(page.getByTestId('cb-recusa-emissao')).toHaveCount(0);
    await page.getByTestId('cb-emitir').click();
    await expect(page.getByTestId('cb-mensagem')).toContainText('2 boleto(s) emitido(s)');
    expect(api.corpos.at(-1)).toEqual({
      carteira: 31,
      parcelas: [501, 502],
      pagadorDocumento: '00000000191',
      pagadorNome: null,
    });
    await expect(page.getByTestId('cb-boleto-800')).toHaveAttribute('data-situacao', 'emitido');
    await expect(page.getByTestId('cb-boleto-801')).toHaveAttribute('data-situacao', 'emitido');

    // Impressão: a ficha com a linha digitável em blocos e o código de barras desenhado.
    await page.getByTestId('cb-imprimir-800').click();
    await expect(page.getByTestId('cb-impressao-linha')).toContainText('00190.00009');
    await expect(page.getByTestId('cb-codigo-barras').locator('rect')).toHaveCount(2 + 22 * 5 + 2);
    await semViolacaoAxe(page, '/financeiro/receber/cobranca-bancaria (boletos)');
    await page.getByTestId('cb-fechar-impressao').click();

    // Remessa: um clique, com a mensagem ao pagador.
    await page.getByTestId('cb-aba-remessa').click();
    await expect(page.getByTestId('cb-aguardando')).toContainText('2 boleto(s)');
    await page.getByTestId('cb-mensagem-remessa').fill('Mensagem ficticia');
    await page.getByTestId('cb-gerar-remessa').click();
    await expect(page.getByTestId('cb-mensagem')).toContainText('Remessa 1 gerada');
    expect(api.corpos.at(-1)).toEqual({ carteira: 31, mensagem: 'Mensagem ficticia' });
    await expect(page.getByTestId('cb-remessa-61')).toBeVisible();

    // Retorno: quem baixa é a tesouraria (segregação: quem cobra não baixa). Arquivo torto recusado na hora; o do
    // simulador é conferido e processado.
    await entrar(page, 'SINT.FIN.PAGA');
    await page.goto('/financeiro/receber/cobranca-bancaria');
    await expect(page.getByTestId('tela-fin-cobranca-bancaria')).toBeVisible();
    await page.getByTestId('cb-aba-retorno').click();
    await page.getByTestId('cb-arquivo').setInputFiles({
      name: 'nao-e-retorno.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('linha curta\r\noutra\r\nmais\r\numa\r\n'),
    });
    await expect(page.getByTestId('cb-arquivo-recusado')).toContainText('240 posições');
    await expect(page.getByTestId('cb-processar')).toBeDisabled();
    await page.getByTestId('cb-usar-simulador').click();
    await expect(page.getByTestId('cb-arquivo-ok')).toContainText('2 título(s)');
    await page.getByTestId('cb-processar').click();
    await expect(page.getByTestId('cb-mensagem')).toContainText('2 liquidado(s)');
    await expect(page.getByTestId('cb-retorno-resumo')).toContainText('tarifas R$ 5,00');
    await expect(page.getByTestId('cb-retorno-71').locator('tr[data-situacao="liquidado"]')).toHaveCount(2);
    await semViolacaoAxe(page, '/financeiro/receber/cobranca-bancaria (retorno)');

    // Os boletos aparecem pagos na lista.
    await page.getByTestId('cb-aba-boletos').click();
    await escolher(page.getByTestId('cb-filtro-situacao'), 'pago');
    await expect(page.getByTestId('cb-boleto-800')).toHaveAttribute('data-situacao', 'pago');
    expect(externas).toEqual([]);
  });
});
