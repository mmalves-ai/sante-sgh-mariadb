// F8 (07-FIN linha 69): a tela do encontro de contas. As leituras e gravações de `/api/financeiro/compensacao` só
// existem no banco do cliente (na fonte sintética respondem 503), então este E2E simula as rotas com um estado em
// memória que segue a regra do servidor (quem propôs não efetiva; motivo com 5 caracteres ou mais; efetivado não se
// cancela, só se estorna). O que fica no banco (baixa "encontro_contas" no a pagar, recebimento de meio e forma
// "encontro_contas" sem conta no a receber, estorno dos dois) é provado no contrato de efeito
// `compensacao-previsao.int.spec.ts`; aqui se prova o fluxo da tela: o parceiro escolhido na lista com os dois saldos,
// as parcelas dos dois lados já marcadas (menos a que está noutro encontro), o compensado e o saldo líquido mudando na
// hora a cada marcação, propor com o corpo certo, aprovar e efetivar por outra pessoa, cancelar o pendente e estornar o
// efetivado com o motivo conferido enquanto se digita, e o item no menu. Axe em cada passo. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { escolher } from './combos.js';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const OPERACOES = [
  'financeiro.proporEncontroContas',
  'financeiro.efetivarEncontroContas',
  'financeiro.cancelarEncontroContas',
  'financeiro.estornarEncontroContas',
] as const;

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

interface Encontro {
  id: number;
  numero: string;
  data: string;
  situacao: 'aguardando_aprovacao' | 'aprovado' | 'efetivado' | 'cancelado';
  parceiro: string;
  totalPagar: number;
  totalReceber: number;
  saldoLiquido: number;
  compensado: number;
  propostoPor: number | null;
  motivo: string | null;
  login: string;
}

test.describe('financeiro: encontro de contas @C1-034', () => {
  test.setTimeout(180_000);

  test('parceiro, marcação com o saldo na hora, propõe, efetiva por outra pessoa, cancela e estorna; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const corpos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const encontros: Encontro[] = [];
    let quem = 'SINT.FIN.PAGA';
    const parcelas = {
      pagar: [
        {
          id: 11,
          titulo: 'TP-SINT-11',
          documento: 'NF 11',
          parcela: 1,
          vencimento: '',
          saldo: 300,
          emOutroEncontro: false,
        },
        {
          id: 12,
          titulo: 'TP-SINT-11',
          documento: 'NF 11',
          parcela: 2,
          vencimento: '',
          saldo: 200,
          emOutroEncontro: false,
        },
        {
          id: 13,
          titulo: 'TP-SINT-13',
          documento: 'NF 13',
          parcela: 1,
          vencimento: '',
          saldo: 90,
          emOutroEncontro: true,
        },
      ],
      receber: [
        {
          id: 21,
          titulo: 'TR-SINT-21',
          documento: 'FAT 21',
          parcela: 1,
          vencimento: '',
          saldo: 350,
          emOutroEncontro: false,
        },
      ],
    };
    // A leitura pode ser cortada por uma navegação (entrar, goto) com a resposta ainda a caminho: aí a resposta é
    // descartada e não há o que cumprir.
    await page.route('**/api/financeiro/gravacao', async (rota) => {
      let corpo: { operacoes: Record<string, unknown> };
      try {
        corpo = (await (await rota.fetch()).json()) as { operacoes: Record<string, unknown> };
      } catch {
        return rota.abort().catch(() => undefined);
      }
      for (const op of OPERACOES) corpo.operacoes[op] = { ligada: true, motivo: null };
      return json(rota, corpo).catch(() => undefined);
    });
    await page.route('**/api/financeiro/compensacao/**', async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      const caminho = url.pathname.replace(/^.*\/compensacao/, '');
      if (req.method() === 'GET') {
        if (caminho === '/parceiros')
          return json(rota, [{ id: 81, nome: 'PARCEIRO SINTETICO', pagar: 590, receber: 350 }]);
        if (caminho === '/parcelas')
          return json(
            rota,
            url.searchParams.get('fornecedor') === '81' ? parcelas : { pagar: [], receber: [] },
          );
        if (caminho === '/encontros')
          return json(
            rota,
            encontros.map((e) => ({ ...e, login: undefined })),
          );
        return json(rota, []);
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      corpos.push({ caminho, corpo });
      const ok = (mensagem: string) => json(rota, { mensagem, repetida: false, ids: {}, avisos: [] });
      const e = encontros.find((x) => x.id === Number(corpo['encontro']));
      if (caminho === '/encontros') {
        const soma = (ids: unknown, lado: 'pagar' | 'receber') =>
          parcelas[lado].filter((p) => (ids as number[]).includes(p.id)).reduce((s, p) => s + p.saldo, 0);
        const totalPagar = soma(corpo['parcelasPagar'], 'pagar');
        const totalReceber = soma(corpo['parcelasReceber'], 'receber');
        const id = encontros.length + 1;
        encontros.unshift({
          id,
          numero: `EC-${id}`,
          data: String(corpo['data']),
          situacao: 'aguardando_aprovacao',
          parceiro: 'PARCEIRO SINTETICO',
          totalPagar,
          totalReceber,
          saldoLiquido: totalReceber - totalPagar,
          compensado: Math.min(totalPagar, totalReceber),
          propostoPor: 1,
          motivo: null,
          login: quem,
        });
        return ok('Encontro de contas proposto; aguarda a aprovação de outra pessoa.');
      }
      if (!e) return recusa(rota, 'encontro-inexistente', 'O encontro de contas não existe.');
      const motivo = String(corpo['motivo'] ?? '').trim();
      if (caminho === '/encontros/efetivar') {
        if (e.login === quem)
          return recusa(rota, 'aprovador-igual-proponente', 'Quem propôs o encontro não o efetiva.');
        e.situacao = 'efetivado';
        return ok('Encontro de contas aprovado e efetivado; as parcelas dos dois lados foram baixadas.');
      }
      if (caminho === '/encontros/cancelar') {
        if (motivo.length < 5) return recusa(rota, 'motivo-obrigatorio', 'Diga o motivo.');
        if (e.situacao === 'efetivado') return recusa(rota, 'encontro-fechado', 'Efetivado não se cancela.');
        Object.assign(e, { situacao: 'cancelado', motivo });
        return ok('Encontro de contas cancelado; a proposta fica no histórico.');
      }
      if (caminho === '/encontros/estornar') {
        if (motivo.length < 5) return recusa(rota, 'motivo-obrigatorio', 'Diga o motivo.');
        Object.assign(e, { situacao: 'cancelado', motivo: `Estorno: ${motivo}` });
        return ok('Encontro de contas estornado; as baixas dos dois lados voltaram e ficam no histórico.');
      }
      return recusa(rota, 'rota-inexistente', 'Rota não simulada.');
    });

    await entrar(page, quem);
    const hoje = ((await (await page.request.get('/api/financeiro/apoio')).json()) as { hoje: string }).hoje;
    for (const lado of [parcelas.pagar, parcelas.receber]) for (const p of lado) p.vencimento = hoje;
    await page.goto('/financeiro/tesouraria/encontro-contas');
    await expect(page.getByTestId('tela-fin-encontro')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/tesouraria/encontro-contas (início)');

    // O parceiro vem da lista com os dois saldos; as parcelas livres já chegam marcadas, a ocupada fica de fora.
    await escolher(page.getByTestId('ec-parceiro'), { rotulo: /PARCEIRO SINTETICO/ });
    await expect(page.getByTestId('ec-lado-pagar')).toContainText('TP-SINT-11');
    await expect(page.getByTestId('ec-marca-pagar-11')).toBeChecked();
    await expect(page.getByTestId('ec-marca-pagar-12')).toBeChecked();
    await expect(page.getByTestId('ec-marca-pagar-13')).toBeDisabled();
    await expect(page.getByTestId('ec-marca-pagar-13')).not.toBeChecked();
    await expect(page.getByTestId('ec-pagar-13')).toContainText('Em outro encontro pendente');
    await expect(page.getByTestId('ec-resumo')).toContainText('Compensado R$ 350,00');
    await expect(page.getByTestId('ec-frase-saldo')).toContainText('o hospital ainda deve R$ 150,00');
    await semViolacaoAxe(page, '/financeiro/tesouraria/encontro-contas (marcação)');
    // Desmarcar o receber deixa o botão desligado e aponta o lado que falta, na hora.
    await page.getByTestId('ec-marca-receber-21').uncheck();
    await expect(page.getByTestId('ec-falta-lado')).toBeVisible();
    await expect(page.getByTestId('ec-propor')).toBeDisabled();
    await page.getByTestId('ec-marca-receber-21').check();
    // Desmarcar a segunda parcela a pagar muda o saldo líquido na hora.
    await page.getByTestId('ec-marca-pagar-12').uncheck();
    await expect(page.getByTestId('ec-resumo')).toContainText('Compensado R$ 300,00');
    await expect(page.getByTestId('ec-frase-saldo')).toContainText('o parceiro ainda deve R$ 50,00');
    await page.getByTestId('ec-marca-pagar-12').check();
    await page.getByTestId('ec-observacao').fill('acerto mensal sintetico');
    await page.getByTestId('ec-propor').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Encontro de contas proposto');
    expect(corpos.at(-1)).toEqual({
      caminho: '/encontros',
      corpo: {
        fornecedor: 81,
        data: hoje,
        parcelasPagar: [11, 12],
        parcelasReceber: [21],
        observacao: 'acerto mensal sintetico',
      },
    });
    await expect(page.getByTestId('ec-situacao-1')).toContainText('Aguarda outra pessoa');
    await expect(page.getByTestId('ec-linha-1')).toContainText('150,00');

    // Uma segunda proposta, para cancelar com motivo.
    await page.getByTestId('ec-propor').click();
    await expect(page.getByTestId('ec-linha-2')).toBeVisible();
    await page.getByTestId('ec-cancelar-2').click();
    await page.getByTestId('ec-motivo').fill('erro');
    await expect(page.getByTestId('ec-confirmar')).toBeDisabled();
    await expect(page.getByTestId('ec-acao')).toContainText('Faltam 1 caracteres');
    await page.getByTestId('ec-motivo').fill('parceiro pediu pagamento à parte');
    await semViolacaoAxe(page, '/financeiro/tesouraria/encontro-contas (cancelar)');
    await page.getByTestId('ec-confirmar').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Encontro de contas cancelado');
    expect(corpos.at(-1)).toEqual({
      caminho: '/encontros/cancelar',
      corpo: { encontro: 2, motivo: 'parceiro pediu pagamento à parte' },
    });
    await expect(page.getByTestId('ec-situacao-2')).toContainText('parceiro pediu pagamento à parte');
    await expect(page.getByTestId('ec-cancelar-2')).toHaveCount(0);

    // Quem propôs não efetiva: o SINT.FIN.PAGA baixa, mas não tem financeiro.tituloPagar.aprovar, então o botão de
    // efetivar fica desligado para ele (a recusa do servidor a quem tem as duas permissões e propôs, o
    // 'aprovador-igual-proponente', é provada no contrato de efeito).
    await expect(page.getByTestId('ec-efetivar-1')).toBeDisabled();

    // Outra pessoa aprova e efetiva; depois estorna com o motivo.
    quem = 'SINT.FIN.APROVA';
    await entrar(page, quem);
    await page.goto('/financeiro/tesouraria/encontro-contas');
    await page.getByTestId('ec-efetivar-1').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('efetivado');
    expect(corpos.at(-1)).toEqual({ caminho: '/encontros/efetivar', corpo: { encontro: 1 } });
    await expect(page.getByTestId('ec-situacao-1')).toContainText('Efetivado');
    await expect(page.getByTestId('ec-cancelar-1')).toHaveCount(0);
    await page.getByTestId('ec-estornar-1').click();
    await page.getByTestId('ec-motivo').fill('valor contestado pelo parceiro');
    await semViolacaoAxe(page, '/financeiro/tesouraria/encontro-contas (estornar)');
    await page.getByTestId('ec-confirmar').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('estornado');
    expect(corpos.at(-1)).toEqual({
      caminho: '/encontros/estornar',
      corpo: { encontro: 1, motivo: 'valor contestado pelo parceiro' },
    });
    await expect(page.getByTestId('ec-situacao-1')).toContainText('Estorno: valor contestado pelo parceiro');
    await expect(page.getByTestId('ec-estornar-1')).toHaveCount(0);

    // O item está no menu.
    await page.goto('/inicio');
    await (await itemDoMenu(page, 'Encontro de contas')).click();
    await expect(page).toHaveURL(/\/financeiro\/tesouraria\/encontro-contas/);
    await expect(page.getByTestId('tela-fin-encontro')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
