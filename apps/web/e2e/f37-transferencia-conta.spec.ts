// F3.7 (06-FAT linha 14): transferência da conta inteira para a nova fonte pagadora, pelo painel da tela
// `/faturamento/contas/:id/movimentos`. Os movimentos exigem o banco próprio, e o E2E roda com a fonte sintética (sem
// núcleo): as respostas da API destas rotas são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a
// tela: a troca de convênio da internação vira sugestão (um clique preenche fonte, plano e dia; nada é disparado), a
// prévia mostra a cobertura de cada item no destino, o item sem cobertura trava a transferência até o aceite com
// justificativa (validação na hora), a outra conta aberta do paciente vai junto no lote, e a transferência é estornada
// com motivo. O efeito no banco está no contrato de efeito
// (apps/api/src/modulos/faturamento/conta-transferencia-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const CONTA = 7401;
const OUTRA = 7403;

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

type Estado = { estornada: boolean };

const movimentos = {
  contaId: CONTA,
  numero: 'F749-SINT-1',
  situacao: 'aberta',
  editavel: true,
  fontePagadoraId: 61,
  fonte: 'Convênio Sintético A',
  itens: [
    {
      id: 801,
      sequencia: 1,
      codigo: '87490001',
      descricao: 'Procedimento sintético',
      quantidade: 1,
      valorTotal: 100,
      honorario: 0,
      situacao: 'lancado',
      kitId: null,
      equipe: [],
    },
    {
      id: 802,
      sequencia: 2,
      codigo: '87490002',
      descricao: 'Curativo sintético',
      quantidade: 1,
      valorTotal: 100,
      honorario: 0,
      situacao: 'lancado',
      kitId: null,
      equipe: [],
    },
  ],
  funcoes: [],
  kits: [],
  destinos: [],
  transferencias: [],
};

function painel(e: Estado, url: URL) {
  const comDestino = url.searchParams.get('fontePagadoraId') === '62';
  return {
    contaId: CONTA,
    numero: 'F749-SINT-1',
    situacao: 'aberta',
    editavel: true,
    fontePagadoraId: 61,
    planoId: null,
    fontes: [
      { id: 61, nome: 'Convênio Sintético A' },
      { id: 62, nome: 'Convênio Sintético B' },
    ],
    planos: [{ id: 91, fonteId: 62, descricao: 'Plano sintético B' }],
    outrasContas: [
      { id: OUTRA, numero: 'F749-SINT-3', fonte: 'Convênio Sintético A', aberta: true, transferiveis: 1 },
    ],
    transferiveis: 2,
    sugestao: {
      fontePagadora: 62,
      plano: 91,
      desde: '2026-01-24',
      itens: [801, 802],
      fonte: 'Convênio Sintético B',
    },
    transferencias: [
      {
        id: 5,
        numero: '5',
        tipo: 'fonte_pagadora',
        situacao: e.estornada ? 'estornada' : 'efetivada',
        saiu: true,
        origem: 'F749-SINT-1',
        destino: 'F749-SINT-2',
        em: '2026-11-24T10:00:00.000',
        motivo: 'Troca sintética anterior',
        motivoEstorno: e.estornada ? 'Convênio informado errado' : null,
      },
    ],
    previa: comDestino
      ? [
          { id: 801, precoNoDestino: true, valorDestino: 150, valorOrigem: 100, realizado: '2026-01-25' },
          { id: 802, precoNoDestino: false, valorDestino: null, valorOrigem: 100, realizado: '2026-01-25' },
        ]
      : [],
  };
}

async function simular(page: Page, e: Estado, enviados: Record<string, unknown>[]): Promise<void> {
  await page.route(`**/api/faturamento/contas/${CONTA}/movimentos`, (r) => json(r, movimentos));
  await page.route(`**/api/faturamento/contas/${CONTA}/transferencia-painel**`, (r) =>
    json(r, painel(e, new URL(r.request().url()))),
  );
  await page.route('**/api/faturamento/transferencias/lote', (r) => {
    enviados.push({ lote: r.request().postDataJSON() });
    return json(
      r,
      {
        id: 6,
        contas: 2,
        itens: 3,
        transferencias: '6, 7',
        contaDestinoNumero: 'F749-SINT-1-2, F749-SINT-3-2',
      },
      201,
    );
  });
  await page.route('**/api/faturamento/transferencias/5/estorno', (r) => {
    enviados.push({ estorno: r.request().postDataJSON() });
    e.estornada = true;
    return json(r, { id: 5, numero: '5', itens: 2 });
  });
}

test.describe('transferência da conta inteira, lote e estorno @C2-049', () => {
  test.setTimeout(180_000);

  test('sugestão pela troca de convênio, prévia da cobertura, aceite justificado, lote e estorno; axe', async ({
    page,
  }) => {
    const e: Estado = { estornada: false };
    const enviados: Record<string, unknown>[] = [];
    await entrar(page, 'SINT.CONTAS');
    await simular(page, e, enviados);
    await page.goto(`/faturamento/contas/${CONTA}/movimentos`);
    const p = page.getByTestId('transferencia-conta');
    await expect(p).toBeVisible();
    await semViolacaoAxe(page, '/faturamento/contas/:id/movimentos (transferência da conta)');

    // A troca de convênio da internação só sugere: um clique preenche fonte, plano e o dia.
    await expect(p.getByTestId('tc-sugestao')).toContainText('Convênio Sintético B');
    await expect(p.getByTestId('tc-sugestao')).toContainText('24/01/2026');
    await p.getByTestId('tc-usar-sugestao').click();
    await expect(p.getByTestId('tc-desde')).toHaveValue('2026-01-24');

    // Prévia da cobertura: o item sem preço no destino trava até o aceite com justificativa.
    await expect(p.getByTestId('tc-previa-801')).toContainText('150,00');
    await expect(p.getByTestId('tc-previa-802')).toContainText('sem preço');
    await p.getByTestId('tc-motivo').fill('Troca de convênio sintética');
    await expect(p.getByTestId('tc-erro-cobertura')).toBeVisible();
    await expect(p.getByTestId('tc-transferir')).toBeDisabled();
    await p.getByTestId('tc-aceitar').check();
    await p.getByTestId('tc-justificativa').fill('ok');
    await expect(p.getByTestId('tc-erro-cobertura')).toContainText('Justifique');
    await expect(p.getByTestId('tc-transferir')).toBeDisabled();
    await p.getByTestId('tc-justificativa').fill('Cobrado por pacote do plano');
    await expect(p.getByTestId('tc-erro-cobertura')).toHaveCount(0);

    // A outra conta aberta do paciente vai junto no lote.
    await p.getByTestId(`tc-lote-${OUTRA}`).check();
    await expect(p.getByTestId('tc-transferir')).toContainText('2 contas');
    await p.getByTestId('tc-transferir').click();
    await expect.poll(() => enviados.find((x) => 'lote' in x)).toBeTruthy();
    expect(enviados.find((x) => 'lote' in x)?.['lote']).toEqual({
      destinoNovo: { fontePagadoraId: 62, planoId: 91 },
      desde: '2026-01-24',
      motivo: 'Troca de convênio sintética',
      aceitarSemCobertura: true,
      justificativaCobertura: 'Cobrado por pacote do plano',
      contas: [{ contaOrigemId: CONTA }, { contaOrigemId: OUTRA }],
    });
    await expect(p.getByTestId('tc-aviso')).toContainText('F749-SINT-1-2');

    // Estorno com motivo: nada se apaga, a linha fica marcada como estornada.
    await p.getByTestId('tc-estornar-5').click();
    await expect(p.getByTestId('tc-confirmar-estorno')).toBeDisabled();
    await p.getByTestId('tc-motivo-estorno').fill('Convênio informado errado');
    await p.getByTestId('tc-confirmar-estorno').click();
    await expect.poll(() => enviados.find((x) => 'estorno' in x)).toBeTruthy();
    expect(enviados.find((x) => 'estorno' in x)?.['estorno']).toEqual({
      motivo: 'Convênio informado errado',
    });
    await expect(p.getByTestId('tc-transf-5')).toContainText('estornada');
    await semViolacaoAxe(page, '/faturamento/contas/:id/movimentos (transferência, depois)');
  });

  test('a mesma fonte e o mesmo plano não é destino: aviso na hora', async ({ page }) => {
    const e: Estado = { estornada: false };
    await entrar(page, 'SINT.CONTAS');
    await simular(page, e, []);
    await page.goto(`/faturamento/contas/${CONTA}/movimentos`);
    const p = page.getByTestId('transferencia-conta');
    await escolher(p.getByTestId('tc-fonte'), { rotulo: 'Convênio Sintético A' });
    await expect(p.getByTestId('tc-erro-destino')).toContainText('já é desta fonte');
    await expect(p.getByTestId('tc-transferir')).toBeDisabled();
  });
});
