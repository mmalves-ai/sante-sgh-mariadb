// E2E @C1-118 (F8, 05-SUP linha 4): endereçamento do armazém e reserva do saldo para a separação, pelo caminho da tela.
// O almoxarife abre "Endereçamento do armazém" pelo atalho dos locais, escolhe o local, vê a árvore na ordem do caminho,
// cria a prateleira dentro da área (o endereço completo aparece enquanto digita; código com espaço é recusado na hora),
// liga o item com preferencial já marcado e torna outro endereço preferencial. Na lista de separação da requisição,
// reserva o saldo (o aviso mostra a reserva e a falta do item sem saldo livre), vê a tabela de reservas por endereço e
// lote e libera a reserva.
// O endereçamento grava só no banco próprio, que a fonte sintética do E2E não tem: as respostas de
// `/api/suprimentos/enderecamento/*` e da lista de separação são simuladas pelo Playwright com massa SINTÉTICA no mesmo
// formato do servidor. A regra está em packages/dominio-suprimentos/src/enderecamento.spec.ts e o que fica no banco em
// apps/api/src/modulos/suprimentos/enderecamento.int.spec.ts.
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
  rota.fulfill({
    status,
    contentType: status >= 400 ? 'application/problem+json' : 'application/json',
    body: JSON.stringify(corpo),
  });

const B = '/api/suprimentos/enderecamento';
const LOCAL = { id: 10, codigo: 'ALMOX-SINT', nome: 'ALMOXARIFADO SINTETICO' };
const item = (vinculo: number, insumo: number, nome: string, preferencial: boolean) => ({
  vinculo,
  versao: 1,
  insumo,
  codigo: `SINT${insumo}`,
  nome,
  preferencial,
  quantidadeMaxima: null,
});
const endereco = (
  id: number,
  superior: number | null,
  nivel: number,
  tipoNivel: string,
  completo: string,
  itens: unknown[] = [],
) => ({
  id,
  versao: 1,
  superior,
  nivel,
  tipoNivel,
  codigo: completo.split('-').pop(),
  codigoCompleto: completo,
  descricao: null,
  capacidade: null,
  bloqueado: false,
  ativo: true,
  itens,
});

test.describe('@C1-118 endereçamento do armazém e reserva para a separação', () => {
  test('cria o endereço, liga o item e troca o preferencial; axe', async ({ page }) => {
    const enderecos = [
      endereco(1, null, 1, 'area', 'A'),
      endereco(2, 1, 2, 'prateleira', 'A-01', [item(50, 5001, 'GAZE SINTETICA', true)]),
    ];
    const gravados: { url: string; corpo: unknown; chave: string | null }[] = [];
    await page.route(new RegExp(`${B}/.*`), async (rota) => {
      const req = rota.request();
      const url = new URL(req.url()).pathname;
      if (req.method() !== 'GET')
        gravados.push({ url, corpo: req.postDataJSON(), chave: req.headers()['idempotency-key'] ?? null });
      if (url === `${B}/locais`) return json(rota, [LOCAL]);
      if (url === `${B}/locais/10`) return json(rota, { local: LOCAL, enderecos });
      if (url === `${B}/itens`)
        return json(rota, [{ id: 5002, codigo: 'SINT5002', nome: 'SERINGA SINTETICA 10 ML' }]);
      if (url === `${B}/enderecos`) {
        enderecos.push(endereco(3, 1, 2, 'prateleira', 'A-02'));
        return json(rota, { id: 3 }, 201);
      }
      if (url === `${B}/enderecos/3/itens`) {
        enderecos[2] = { ...enderecos[2]!, itens: [item(51, 5002, 'SERINGA SINTETICA 10 ML', true)] };
        return json(rota, { id: 51 }, 201);
      }
      if (url === `${B}/enderecos/2/itens`) {
        enderecos[1] = {
          ...enderecos[1]!,
          itens: [...enderecos[1]!.itens, item(52, 5002, 'SERINGA SINTETICA 10 ML', false)],
        };
        return json(rota, { id: 52 }, 201);
      }
      if (url === `${B}/vinculos/52/preferencial`) {
        enderecos[1] = {
          ...enderecos[1]!,
          itens: [item(50, 5001, 'GAZE SINTETICA', true), item(52, 5002, 'SERINGA SINTETICA 10 ML', true)],
        };
        enderecos[2] = { ...enderecos[2]!, itens: [item(51, 5002, 'SERINGA SINTETICA 10 ML', false)] };
        return json(rota, { id: 52 });
      }
      return json(rota, { title: 'não simulado', status: 404 }, 404);
    });
    await entrar(page, 'SINT.ALMOXARIFE');
    await page.goto('/suprimentos/locais');
    await page.getByTestId('locais-enderecamento').click();
    await expect(page).toHaveURL(/\/suprimentos\/enderecamento$/);
    const tela = page.getByTestId('tela-suprimentos-enderecamento');
    await escolher(tela.getByTestId('end-local'), { rotulo: /ALMOX-SINT/ });
    const arvore = tela.getByTestId('end-arvore');
    await expect(arvore.locator('tbody tr')).toHaveCount(2);
    await expect(tela.getByTestId('end-linha-A-01')).toContainText('GAZE SINTETICA');

    // Novo endereço: dentro de A, prateleira; o completo aparece enquanto digita e o código inválido trava o botão.
    await escolher(tela.getByTestId('end-superior'), { rotulo: 'A' });
    await escolher(tela.getByTestId('end-tipo'), { rotulo: 'Prateleira' });
    await tela.getByTestId('end-codigo').fill('0 2');
    await expect(tela.getByTestId('end-completo')).toContainText('Use só letras e números');
    await expect(tela.getByTestId('end-criar')).toBeDisabled();
    await tela.getByTestId('end-codigo').fill('02');
    await expect(tela.getByTestId('end-completo')).toContainText('A-02');
    await tela.getByTestId('end-criar').click();
    await expect(tela.getByTestId('end-aviso')).toContainText('A-02');
    await expect(arvore.locator('tbody tr')).toHaveCount(3);
    const criado = gravados.find((g) => g.url === `${B}/enderecos`);
    expect(criado?.corpo).toMatchObject({ local: 10, superior: 1, tipoNivel: 'prateleira', codigo: '02' });
    expect(criado?.chave).toBeTruthy();

    // O endereço criado fica escolhido: a seringa, sem endereço no local, entra com preferencial já marcado.
    const painel = tela.getByTestId('end-escolhido');
    await expect(painel).toContainText('A-02');
    await painel.getByTestId('end-busca-item').fill('ser');
    await painel.getByTestId('end-achado-5002').click();
    await expect(painel.getByTestId('end-preferencial')).toBeChecked();
    await painel.getByTestId('end-ligar-botao').click();
    await expect(painel.getByTestId('end-item-5002')).toContainText('Preferencial');
    expect(gravados.find((g) => g.url === `${B}/enderecos/3/itens`)?.corpo).toEqual({
      insumo: 5002,
      preferencial: true,
      quantidadeMaxima: null,
    });

    // Em A-01 a seringa entra como segundo endereço (preferencial desmarcado) e depois vira a preferencial.
    await tela.getByTestId('end-linha-A-01').getByRole('button', { name: 'A-01' }).click();
    await painel.getByTestId('end-busca-item').fill('ser');
    await painel.getByTestId('end-achado-5002').click();
    await expect(painel.getByTestId('end-preferencial')).not.toBeChecked();
    await painel.getByTestId('end-ligar-botao').click();
    await painel.getByTestId('end-preferencial-5002').click();
    await expect(painel.getByTestId('end-item-5002')).toContainText('Preferencial');
    await expect(tela.getByTestId('end-linha-A-02')).not.toContainText('Preferencial');
    await semViolacaoAxe(page, '/suprimentos/enderecamento');
  });

  test('na lista de separação reserva o saldo, mostra a falta e libera; axe', async ({ page }) => {
    const REQ = 990118;
    let reservas: unknown[] = [];
    await page.route(/\/api\/suprimentos\/cadastro\/requisicoes\/\d+\/separacao$/, (rota) =>
      json(rota, {
        requisicao: REQ,
        numero: 4118,
        situacao: 'autorizada',
        tipo: 'setor',
        local: LOCAL,
        destino: 'POSTO SINTETICO 2',
        solicitadoEm: '2026-03-15T08:05:00',
        urgente: false,
        geradaEm: '2026-03-15T08:10:00',
        linhas: [
          {
            sequencia: 1,
            item: 5002,
            nome: 'SERINGA SINTETICA 10 ML',
            unidade: 'UN',
            aSeparar: 6,
            endereco: 'A-01',
            outrosEnderecos: [],
            lotes: [{ lote: 'LSINT1', validade: '2027-03-31', quantidade: 6 }],
            saldo: 10,
            falta: 0,
          },
          {
            sequencia: 2,
            item: 5003,
            nome: 'LUVA SINTETICA',
            unidade: 'PR',
            aSeparar: 4,
            endereco: null,
            outrosEnderecos: [],
            lotes: [],
            saldo: 1,
            falta: 3,
          },
        ],
        totalFalta: 1,
      }),
    );
    const reserva = (situacao: string, liberada: number) => [
      {
        id: 1,
        itemRequisicao: 11,
        insumo: 5002,
        nome: 'SERINGA SINTETICA 10 ML',
        lote: 'LSINT1',
        validade: '2027-03-31',
        endereco: 'A-01',
        reservada: 6,
        atendida: 0,
        liberada,
        situacao,
      },
    ];
    await page.route(new RegExp(`${B}/requisicoes/${REQ}/.*`), (rota) => {
      const url = new URL(rota.request().url()).pathname;
      if (url.endsWith('/reservas')) return json(rota, reservas);
      if (url.endsWith('/reservar')) {
        reservas = reserva('ativa', 0);
        return json(rota, { id: REQ, reservas: 1, faltas: [{ itemRequisicao: 12, insumo: 5003, falta: 3 }] });
      }
      if (url.endsWith('/liberar')) {
        reservas = reserva('liberada', 6);
        return json(rota, { id: REQ, liberadas: 1 });
      }
      return json(rota, { title: 'não simulado', status: 404 }, 404);
    });
    await entrar(page, 'SINT.ALMOXARIFE');
    await page.goto(`/suprimentos/requisicoes/${REQ}/separacao`);
    const bloco = page.getByTestId('separacao-reserva');
    await expect(bloco).toContainText('Nenhuma reserva');
    await bloco.getByTestId('separacao-reservar').click();
    await expect(bloco.getByTestId('separacao-reserva-aviso').first()).toContainText('1 reserva');
    await expect(bloco.getByTestId('separacao-reserva-aviso').nth(1)).toContainText('LUVA SINTETICA');
    const linha = bloco.getByTestId('separacao-reserva-5002');
    await expect(linha).toContainText('A-01');
    await expect(linha).toContainText('LSINT1');
    await expect(linha).toContainText('Ativa');
    await semViolacaoAxe(page, '/suprimentos/requisicoes/:id/separacao (reserva)');
    await bloco.getByTestId('separacao-liberar').click();
    // Enquanto a liberação está a caminho, os avisos da reserva ainda estão na tela: espera o aviso único da liberação.
    await expect(bloco.getByTestId('separacao-reserva-aviso')).toHaveText([/Reserva liberada/]);
    await expect(linha).toContainText('Liberada');
    await expect(bloco.getByTestId('separacao-liberar')).toHaveCount(0);
  });
});
