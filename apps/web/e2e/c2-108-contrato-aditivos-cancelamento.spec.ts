// E2E @C2-108 (08-SGO linha 94, F7): aditivos e cancelamento do contrato de plano. O gestor da operadora abre
// "Aditivos e cancelamento de contratos", acha o contrato pelo número → vê os planos ofertados com as vidas → escolhe a
// troca de plano: a prévia mostra na hora o que encerra na véspera e o que abre no efeito; exclusão do plano com vidas é
// recusada na hora (botão desligado) → registra a troca assinada → pede o cancelamento com motivo sem baixa ligada (o
// aviso aparece) e com crédito inválido (recusa na hora) → pede com crédito válido; axe sem violação séria. As rotas
// `/api/operadora/complementar/contratos*` só existem no banco do cliente, então este E2E as simula em memória com as
// mesmas regras do domínio (efeitoDoAditivo, creditoDoCancelamento). O que fica no banco está no contrato de efeito
// cadastro-complementar.int.spec.ts. Fonte sintética; nenhuma saída externa (vigiarExternas).
import { expect, test, type Page, type Route } from '@playwright/test';
import { creditoDoCancelamento, efeitoDoAditivo } from '@sgh/dominio-operadora';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

function simular(page: Page) {
  const estado = {
    contrato: {
      id: 71,
      numero: 'SINT-0108',
      situacao: 'ativo',
      inicio: '2024-01-01',
      fim: null,
      contratacao: 'coletivo_empresarial',
    },
    ofertas: [
      {
        id: 1,
        plano: 10,
        nomePlano: 'Plano Sintético A',
        tabela: 100,
        nomeTabela: 'Tabela Sintética 1',
        inicio: '2024-01-01',
        fim: null as string | null,
        vidas: 3,
      },
    ],
    planos: [
      { id: 10, nome: 'Plano Sintético A' },
      { id: 20, nome: 'Plano Sintético B' },
    ],
    tabelas: [
      { id: 100, nome: 'Tabela Sintética 1' },
      { id: 200, nome: 'Tabela Sintética 2' },
    ],
    motivos: [
      { id: 1, descricao: 'Pedido do contratante (sintético)', exigeNotificacao: false, temBaixa: true },
      { id: 2, descricao: 'Motivo sem baixa (sintético)', exigeNotificacao: false, temBaixa: false },
    ],
    aditivos: [] as {
      id: number;
      sequencia: number;
      tipo: string;
      efeito: string;
      assinatura: string | null;
      situacao: string;
      descricao: string;
    }[],
    cancelamentos: [] as {
      id: number;
      protocolo: string;
      solicitante: string;
      dataEfeito: string;
      situacao: string;
    }[],
  };
  const json = (r: Route, corpo: unknown, status = 200) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
  const recusa = (r: Route, detail: string) =>
    r.fulfill({
      status: 422,
      contentType: 'application/problem+json',
      body: JSON.stringify({ title: 'Recusado', detail, status: 422 }),
    });
  return page.route('**/api/operadora/complementar/**', async (r) => {
    const u = new URL(r.request().url());
    const m = r.request().method();
    const p = u.pathname.replace('/api/operadora/complementar', '');
    if (m === 'GET' && p === '/contratos') return json(r, [estado.contrato]);
    if (m === 'GET' && p.endsWith('/painel'))
      return json(r, {
        contrato: estado.contrato,
        ofertas: estado.ofertas,
        planos: estado.planos,
        tabelas: estado.tabelas,
        motivos: estado.motivos,
      });
    if (m === 'GET' && p.endsWith('/aditivos')) return json(r, estado.aditivos);
    if (m === 'GET' && p.endsWith('/cancelamentos')) return json(r, estado.cancelamentos);
    const b = r.request().postDataJSON() as Record<string, unknown>;
    if (m === 'POST' && p.endsWith('/aditivos')) {
      const ef = efeitoDoAditivo(
        {
          tipo: String(b['tipo']),
          efeito: String(b['efeito']),
          planoAnterior: b['planoAnterior'] as number | null,
          planoNovo: b['planoNovo'] as number | null,
          tabelaPreco: b['tabelaPreco'] as number | null,
        },
        estado.ofertas,
        (pl) =>
          estado.ofertas.filter((o) => o.plano === pl && o.fim === null).reduce((s, o) => s + o.vidas, 0),
      );
      if (ef.problemas[0]) return recusa(r, ef.problemas[0].detalhe);
      for (const f of ef.fechar) estado.ofertas.find((o) => o.id === f.oferta)!.fim = f.fim;
      for (const o of ef.abrir)
        estado.ofertas.push({
          id: estado.ofertas.length + 1,
          plano: o.plano,
          nomePlano: estado.planos.find((x) => x.id === o.plano)!.nome,
          tabela: o.tabela,
          nomeTabela: estado.tabelas.find((x) => x.id === o.tabela)!.nome,
          inicio: o.inicio,
          fim: null,
          vidas: ef.mover ? 3 : 0,
        });
      const id = estado.aditivos.length + 1;
      estado.aditivos.push({
        id,
        sequencia: id,
        tipo: String(b['tipo']),
        efeito: String(b['efeito']),
        assinatura: (b['assinatura'] as string | null) ?? null,
        situacao: b['assinatura'] ? 'vigente' : 'rascunho',
        descricao: String(b['descricao']),
      });
      return json(r, { id }, 201);
    }
    if (m === 'POST' && p.endsWith('/cancelamentos')) {
      const c = creditoDoCancelamento((b['valorCredito'] as number | null) ?? null);
      if (c.problema) return recusa(r, c.problema.detalhe);
      const id = estado.cancelamentos.length + 1;
      estado.cancelamentos.push({
        id,
        protocolo: `CC-${id}`,
        solicitante: String(b['solicitante']),
        dataEfeito: '2026-12-31',
        situacao: 'agendado',
      });
      estado.contrato.situacao = 'em_cancelamento';
      return json(r, { id }, 201);
    }
    return r.fulfill({ status: 404, body: '' });
  });
}

test('@C2-108 aditivo de troca de plano com prévia e pedido de cancelamento com crédito', async ({
  page,
}) => {
  const externas = vigiarExternas(page);
  await entrar(page, 'SINT.OPERADORA');
  await simular(page);
  await page.goto('/operadora/contratos');
  await page.locator('#ctr-numero').fill('SINT-0108');
  await page.getByTestId('ctr-buscar').click();
  await expect(page.getByTestId('ctr-ofertas')).toContainText('Plano Sintético A');
  await expect(page.getByTestId('ctr-ofertas')).toContainText('3');
  await semViolacaoAxe(page, 'contrato');

  // Exclusão do único plano com vidas: o problema aparece na hora e o botão fica desligado.
  await escolher(page.getByTestId('ctr-ad-tipo'), { rotulo: 'Exclusão de plano' });
  await escolher(page.getByTestId('ctr-ad-plano-anterior'), { rotulo: /Plano Sintético A/ });
  await page.locator('#ctr-ad-descricao').fill('Exclusão (sintética)');
  await expect(page.getByTestId('ctr-ad-problemas')).toContainText('beneficiários vigentes');
  await expect(page.getByTestId('ctr-ad-gravar')).toBeDisabled();

  // Troca de plano: a prévia diz o que encerra na véspera e o que abre no efeito.
  await escolher(page.getByTestId('ctr-ad-tipo'), { rotulo: 'Troca de plano' });
  await escolher(page.getByTestId('ctr-ad-plano-anterior'), { rotulo: /Plano Sintético A/ });
  await escolher(page.getByTestId('ctr-ad-plano-novo'), { rotulo: 'Plano Sintético B' });
  await page.locator('#ctr-ad-descricao').fill('Troca acordada (sintética)');
  await expect(page.getByTestId('ctr-ad-previa')).toContainText('Encerra Plano Sintético A');
  await expect(page.getByTestId('ctr-ad-previa')).toContainText('Abre Plano Sintético B');
  await expect(page.getByTestId('ctr-ad-previa')).toContainText('passam ao plano novo');
  await page.getByTestId('ctr-ad-gravar').click();
  await expect(page.getByTestId('ctr-mensagem')).toContainText('Aditivo registrado');
  await expect(page.getByTestId('ctr-aditivo-1')).toContainText('vigente');
  await expect(page.getByTestId('ctr-ofertas')).toContainText('Plano Sintético B');

  // Cancelamento: o motivo sem baixa ligada avisa; crédito com três casas é recusado na hora; o válido grava.
  await escolher(page.getByTestId('ctr-ca-motivo'), { rotulo: 'Motivo sem baixa (sintético)' });
  await expect(page.getByTestId('ctr-ca-sem-baixa')).toBeVisible();
  await escolher(page.getByTestId('ctr-ca-motivo'), { rotulo: 'Pedido do contratante (sintético)' });
  await expect(page.getByTestId('ctr-ca-sem-baixa')).toHaveCount(0);
  await page.locator('#ctr-ca-credito').fill('10,005');
  await expect(page.getByTestId('ctr-ca-gravar')).toBeDisabled();
  await page.locator('#ctr-ca-credito').fill('120,50');
  await page.getByTestId('ctr-ca-gravar').click();
  await expect(page.getByTestId('ctr-mensagem')).toContainText('Pedido de cancelamento registrado');
  await expect(page.getByTestId('ctr-cancel-CC-1')).toContainText('agendado');
  await semViolacaoAxe(page, 'cancelamento');
  expect(externas).toEqual([]);
});
