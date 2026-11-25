// F8 (07-FIN linha 70): a tela das notas de crédito e de débito. As leituras e gravações de
// `/api/financeiro/nota-cessao` só existem no banco do cliente (na fonte sintética respondem 503), então este E2E simula
// as rotas com um estado em memória que segue a regra do servidor (motivo do cancelamento e justificativa com 5
// caracteres ou mais; só a emitida se aplica; a cancelada não volta). O que fica no banco (a nota com os tributos, o
// abatimento ou o acréscimo na parcela e no título, o cancelamento que desfaz o ajuste e guarda a nota) é provado no
// contrato de efeito `aplicacao/nota-cessao.int.spec.ts`; aqui se prova o fluxo da tela: o lado e a parcela escolhidos
// na lista com a contraparte e o saldo, a prévia pela regra do domínio mudando na hora (abate ou acresce, total,
// tributos destacados e retidos, saldo depois), a recusa antes de gravar (nota maior que o saldo, parcela com
// portador), emitir com o corpo certo, aplicar a só emitida e cancelar com o motivo e a justificativa, e o item no
// menu. Axe em cada passo. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { escolher } from './combos.js';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
// Quem gere o financeiro com o perfil de administrador do sistema (que dá financeiro.notaCreditoDebito.*).
const LOGIN = 'SINT.FIN.GESTOR';
const TELA = '/financeiro/notas-credito-debito';

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
const recusa = (rota: Route, codigo: string, detail: string) =>
  rota.fulfill({
    status: 409,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: `urn:sgh:erro:${codigo}`, title: detail, status: 409, detail, codigo }),
  });

interface Nota {
  nota: number;
  numero: number;
  direcao: 'emitida' | 'recebida';
  natureza: 'credito' | 'debito';
  efeito: 'abate' | 'acresce';
  lado: 'pagar' | 'receber';
  dataEmissao: string;
  valorTotal: number;
  valorImpostos: number;
  valorAjuste: number;
  situacao: 'emitida' | 'aplicada' | 'cancelada';
  motivo: string;
  contraparte: string;
}

test.describe('financeiro: notas de crédito e de débito @C1-052', () => {
  test.setTimeout(180_000);

  test('parcela da lista, prévia na hora, recusa antes de gravar, emite, aplica e cancela com motivo; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const corpos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const notas: Nota[] = [];
    const apoios = {
      motivos: [
        { id: 1, rotulo: 'DEVOLUCAO SINTETICA', natureza: 'credito' },
        { id: 2, rotulo: 'COBRANCA COMPLEMENTAR SINTETICA', natureza: 'debito' },
        { id: 3, rotulo: 'AJUSTE SINTETICO', natureza: 'ambos' },
      ],
      motivosCancelamento: [{ id: 7, rotulo: 'ERRO DE EMISSAO SINTETICO' }],
      tributos: [
        { id: 31, rotulo: 'ISS · Imposto sobre serviços' },
        { id: 32, rotulo: 'IRRF · Imposto de renda retido' },
      ],
      contas: [],
      pessoas: [],
    };
    const parcelas = {
      pagar: [
        {
          parcela: 11,
          sequencia: 1,
          vencimento: '',
          saldo: 500,
          situacao: 'aberta',
          titulo: 101,
          numero: 'TP-SINT-101',
          documento: 'NF 101',
          contraparte: 'FORNECEDOR SINTETICO',
          portador: null,
        },
      ],
      receber: [
        {
          parcela: 21,
          sequencia: 1,
          vencimento: '',
          saldo: 300,
          situacao: 'aberta',
          titulo: 201,
          numero: 'TR-SINT-201',
          documento: 'FAT 201',
          contraparte: 'CLIENTE SINTETICO',
          portador: null,
        },
        {
          parcela: 22,
          sequencia: 2,
          vencimento: '',
          saldo: 300,
          situacao: 'aberta',
          titulo: 201,
          numero: 'TR-SINT-201',
          documento: 'FAT 201',
          contraparte: 'CLIENTE SINTETICO',
          portador: 'BANCO SINTETICO',
        },
      ],
    };
    await page.route('**/api/financeiro/nota-cessao/**', async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      const caminho = url.pathname.replace(/^.*\/nota-cessao/, '');
      if (req.method() === 'GET') {
        if (caminho === '/apoios') return json(rota, apoios);
        if (caminho === '/parcelas')
          return json(rota, url.searchParams.get('lado') === 'receber' ? parcelas.receber : parcelas.pagar);
        if (caminho === '/notas') return json(rota, notas);
        return json(rota, []);
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      corpos.push({ caminho, corpo });
      const ok = (mensagem: string) => json(rota, { mensagem, repetida: false, ids: {}, avisos: [] });
      if (caminho === '/notas/pagar' || caminho === '/notas/receber') {
        const lado = caminho === '/notas/pagar' ? 'pagar' : 'receber';
        const p = parcelas[lado].find((x) => x.parcela === corpo['parcela']);
        if (!p) return recusa(rota, 'parcela-inexistente', 'A parcela não existe.');
        const tributos = corpo['tributos'] as { base: number; aliquota: number; retido: boolean }[];
        const valor = (r: boolean) =>
          tributos.filter((x) => x.retido === r).reduce((s, x) => s + (x.base * x.aliquota) / 100, 0);
        const total =
          Number(corpo['valorItens']) -
          Number(corpo['valorDesconto']) +
          Number(corpo['valorOutros']) +
          valor(false);
        const aFavor = (corpo['direcao'] === 'emitida') === (corpo['natureza'] === 'debito');
        const efeito = (lado === 'receber') === aFavor ? 'acresce' : 'abate';
        const id = notas.length + 1;
        const aplicar = corpo['aplicar'] === true;
        notas.unshift({
          nota: id,
          numero: id,
          direcao: corpo['direcao'] as Nota['direcao'],
          natureza: corpo['natureza'] as Nota['natureza'],
          efeito,
          lado,
          dataEmissao: String(corpo['dataEmissao']),
          valorTotal: total,
          valorImpostos: valor(false),
          valorAjuste: total - valor(true),
          situacao: aplicar ? 'aplicada' : 'emitida',
          motivo: apoios.motivos.find((m) => m.id === corpo['motivo'])?.rotulo ?? '',
          contraparte: p.contraparte,
        });
        return ok(
          aplicar ? `Nota ${id} emitida e aplicada.` : `Nota ${id} emitida; aplique-a quando confirmar.`,
        );
      }
      const n = notas.find((x) => x.nota === Number(corpo['nota']));
      if (!n) return recusa(rota, 'nota-inexistente', 'A nota não existe neste estabelecimento.');
      if (caminho === '/notas/aplicar') {
        if (n.situacao !== 'emitida')
          return recusa(rota, 'nota-nao-emitida', 'Só a nota emitida e ainda não aplicada vai ao título.');
        n.situacao = 'aplicada';
        return ok('Nota aplicada ao título.');
      }
      if (caminho === '/notas/cancelar') {
        if (String(corpo['observacao'] ?? '').trim().length < 5 || !corpo['motivoCancelamento'])
          return recusa(rota, 'motivo-obrigatorio', 'Escolha o motivo do cancelamento.');
        if (n.situacao === 'cancelada') return recusa(rota, 'nota-cancelada', 'A nota já está cancelada.');
        const desfeito = n.situacao === 'aplicada';
        n.situacao = 'cancelada';
        return ok(desfeito ? 'Nota cancelada; o ajuste no título foi desfeito.' : 'Nota cancelada.');
      }
      return recusa(rota, 'rota-inexistente', 'Rota não simulada.');
    });

    await entrar(page, LOGIN);
    const hoje = ((await (await page.request.get('/api/financeiro/apoio')).json()) as { hoje: string }).hoje;
    for (const p of [...parcelas.pagar, ...parcelas.receber]) p.vencimento = hoje;
    await page.goto(TELA);
    await expect(page.getByTestId('tela-fin-nota-cd')).toBeVisible();
    await semViolacaoAxe(page, `${TELA} (início)`);

    // A pagar: a parcela vem da lista com a contraparte e o saldo; a prévia calcula na hora pela regra do domínio.
    await escolher(page.getByTestId('ncd-parcela'), { rotulo: /FORNECEDOR SINTETICO/ });
    await escolher(page.getByTestId('ncd-motivo'), { rotulo: /DEVOLUCAO SINTETICA/ });
    await page.getByTestId('ncd-itens').fill('100');
    await expect(page.getByTestId('ncd-previa-texto')).toContainText('abate R$ 100,00');
    await expect(page.getByTestId('ncd-previa-texto')).toContainText('saldo da parcela depois R$ 400,00');
    // Um tributo destacado e um retido mudam o total e o ajuste na hora.
    await page.getByTestId('ncd-incluir-tributo').click();
    await escolher(page.getByTestId('ncd-tributo-codigo-1'), { rotulo: /ISS/ });
    await page.getByTestId('ncd-tributo-aliquota-1').fill('5');
    await page.getByTestId('ncd-incluir-tributo').click();
    await escolher(page.getByTestId('ncd-tributo-codigo-2'), { rotulo: /IRRF/ });
    await page.getByTestId('ncd-tributo-aliquota-2').fill('1.5');
    await page.getByTestId('ncd-tributo-retido-2').check();
    await expect(page.getByTestId('ncd-previa-texto')).toContainText('total R$ 105,00');
    await expect(page.getByTestId('ncd-previa-texto')).toContainText('retidos R$ 1,50');
    await expect(page.getByTestId('ncd-previa-texto')).toContainText('abate R$ 103,50');
    // A nota que abate mais que o saldo é recusada antes de gravar e desliga o botão.
    await page.getByTestId('ncd-itens').fill('900');
    await expect(page.getByTestId('ncd-recusa-previa')).toContainText('mais que o saldo em aberto');
    await expect(page.getByTestId('ncd-emitir')).toBeDisabled();
    await page.getByTestId('ncd-itens').fill('100');
    await page.getByTestId('ncd-documento').fill('NC-SINT-1');
    await semViolacaoAxe(page, `${TELA} (nota a pagar)`);
    await page.getByTestId('ncd-emitir').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Nota 1 emitida e aplicada');
    expect(corpos.at(-1)).toEqual({
      caminho: '/notas/pagar',
      corpo: {
        parcela: 11,
        direcao: 'recebida',
        natureza: 'credito',
        motivo: 1,
        dataEmissao: hoje,
        numeroDocumento: 'NC-SINT-1',
        valorItens: 100,
        valorDesconto: 0,
        valorOutros: 0,
        tributos: [
          { tributo: 31, base: 100, aliquota: 5, retido: false },
          { tributo: 32, base: 100, aliquota: 1.5, retido: true },
        ],
        aplicar: true,
      },
    });
    await expect(page.getByTestId('ncd-situacao-1')).toContainText('Aplicada');

    // A receber: o motivo só de crédito some ao escolher débito; a parcela com portador é recusada na prévia.
    await escolher(page.getByTestId('ncd-lado'), { rotulo: /A receber/ });
    await escolher(page.getByTestId('ncd-parcela'), { rotulo: /BANCO SINTETICO/ });
    await escolher(page.getByTestId('ncd-direcao'), { rotulo: /O hospital emite/ });
    await escolher(page.getByTestId('ncd-natureza'), { rotulo: /Débito/ });
    await escolher(page.getByTestId('ncd-motivo'), { rotulo: /COBRANCA COMPLEMENTAR/ });
    await page.getByTestId('ncd-itens').fill('50');
    await expect(page.getByTestId('ncd-recusa-previa')).toBeVisible();
    await expect(page.getByTestId('ncd-emitir')).toBeDisabled();
    await escolher(page.getByTestId('ncd-parcela'), { rotulo: /parcela 1 ·/ });
    await escolher(page.getByTestId('ncd-direcao'), { rotulo: /O hospital emite/ });
    await escolher(page.getByTestId('ncd-natureza'), { rotulo: /Débito/ });
    await escolher(page.getByTestId('ncd-motivo'), { rotulo: /COBRANCA COMPLEMENTAR/ });
    await page.getByTestId('ncd-itens').fill('50');
    await expect(page.getByTestId('ncd-previa-texto')).toContainText('acresce R$ 50,00');
    await expect(page.getByTestId('ncd-previa-texto')).toContainText('saldo da parcela depois R$ 350,00');
    // Só emitida, para aplicar depois.
    await page.getByTestId('ncd-aplicar-agora').uncheck();
    await page.getByTestId('ncd-emitir').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('aplique-a quando confirmar');
    expect(corpos.at(-1)?.caminho).toBe('/notas/receber');
    expect(corpos.at(-1)?.corpo).toMatchObject({
      parcela: 21,
      direcao: 'emitida',
      natureza: 'debito',
      motivo: 2,
      valorItens: 50,
      aplicar: false,
    });
    await expect(page.getByTestId('ncd-situacao-2')).toContainText('Emitida');
    await page.getByTestId('ncd-aplicar-2').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Nota aplicada ao título');
    expect(corpos.at(-1)).toEqual({ caminho: '/notas/aplicar', corpo: { nota: 2 } });
    await expect(page.getByTestId('ncd-situacao-2')).toContainText('Aplicada');
    await expect(page.getByTestId('ncd-aplicar-2')).toHaveCount(0);

    // Cancelar a aplicada: avisa que desfaz o ajuste; motivo do cadastro e justificativa conferida na hora.
    await page.getByTestId('ncd-cancelar-1').click();
    await expect(page.getByTestId('ncd-desfaz')).toContainText('R$ 103,50');
    await escolher(page.getByTestId('ncd-motivo-cancelamento'), { rotulo: /ERRO DE EMISSAO/ });
    await page.getByTestId('ncd-justificativa').fill('erro');
    await expect(page.getByTestId('ncd-confirmar-cancelamento')).toBeDisabled();
    await expect(page.getByTestId('ncd-cancelamento')).toContainText('Faltam 1 caracteres');
    await page.getByTestId('ncd-justificativa').fill('valor digitado errado');
    await semViolacaoAxe(page, `${TELA} (cancelar)`);
    await page.getByTestId('ncd-confirmar-cancelamento').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('o ajuste no título foi desfeito');
    expect(corpos.at(-1)).toEqual({
      caminho: '/notas/cancelar',
      corpo: { nota: 1, motivoCancelamento: 7, observacao: 'valor digitado errado' },
    });
    // A cancelada fica na lista, sem ações.
    await expect(page.getByTestId('ncd-situacao-1')).toContainText('Cancelada');
    await expect(page.getByTestId('ncd-cancelar-1')).toHaveCount(0);

    // O item está no menu.
    await page.goto('/inicio');
    await (await itemDoMenu(page, 'Notas de crédito e de débito')).click();
    await expect(page).toHaveURL(/\/financeiro\/notas-credito-debito/);
    await expect(page.getByTestId('tela-fin-nota-cd')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
