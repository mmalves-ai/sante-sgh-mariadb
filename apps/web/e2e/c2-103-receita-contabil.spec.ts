// F3 (06-FAT L37) @C2-103: integração contábil da receita pelo caminho da tela. As rotas exigem o banco próprio e o
// E2E roda com a fonte sintética, então as respostas da API são simuladas pelo Playwright com massa SINTÉTICA. O que
// se prova é a tela: pendência e divergência abertas aparecem primeiro, com o motivo; o código de conta inválido trava
// o filtro e o apurar na hora; clicar no número da conta filtra por ela; "Apurar a conta" envia a conta num clique,
// com Idempotency-Key, e mostra o resultado em contagens; o filtro de situação vai na consulta. O efeito no banco está
// no contrato de efeito apps/api/src/modulos/faturamento/receita-contabil-propria.int.spec.ts.
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
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const evento = (id: number, conta: number, tipoAcao: string, valor: number, situacao: string) => ({
  id,
  chave: `conta:${conta}:c1:${tipoAcao}:${id}`,
  tipoAcao,
  dataReferencia: '2026-10-31',
  dataLancamento: '2026-11-25',
  valor,
  situacao,
  contaId: conta,
  contaNumero: `SINT-${conta}`,
  itemId: null,
  debito: '1.1.2.01 CONVENIOS A RECEBER SINTETICO',
  credito: '3.1.1.01 RECEITA DE SERVICOS SINTETICA',
});

const ocorrencia = (id: number, conta: number, tipo: string, fato: string, situacao = 'aberta') => ({
  id,
  tipo,
  chave: `conta:${conta}:c1:${fato}`,
  fato,
  motivo: tipo === 'pendencia' ? 'sem regra contábil para o fato' : 'contabilizado difere do apurado',
  valor: 50,
  dataReferencia: '2026-10-31',
  situacao,
  resolvidaEm: situacao === 'aberta' ? null : '2026-11-20',
  contaId: conta,
  contaNumero: `SINT-${conta}`,
  itemId: null,
});

function painel(conta: number | null, apurado: boolean) {
  const eventos = [evento(1, 11, 'receita', 390, 'contabilizado'), evento(2, 12, 'glosa', 40, 'pendente')];
  const ocorrencias = [
    ocorrencia(5, 11, 'pendencia', 'glosa_aceita'),
    ocorrencia(6, 12, 'divergencia', 'fechamento'),
    ocorrencia(7, 11, 'pendencia', 'desconto', 'resolvida'),
  ];
  if (apurado) eventos.unshift(evento(3, 11, 'previsao', 120, 'pendente'));
  return {
    regrasAtivas: 3,
    eventos: conta ? eventos.filter((e) => e.contaId === conta) : eventos,
    ocorrencias: conta ? ocorrencias.filter((o) => o.contaId === conta) : ocorrencias,
  };
}

async function simular(page: Page, consultas: URL[], apuracoes: { corpo: unknown; chave: string | null }[]) {
  await page.route(/\/api\/faturamento\/receita-contabil(\?.*)?$/, (r) => {
    const u = new URL(r.request().url());
    consultas.push(u);
    const conta = u.searchParams.get('conta');
    return json(r, painel(conta ? Number(conta) : null, apuracoes.length > 0));
  });
  await page.route('**/api/faturamento/receita-contabil/apurar', (r) => {
    apuracoes.push({
      corpo: r.request().postDataJSON(),
      chave: r.request().headers()['idempotency-key'] ?? null,
    });
    return json(r, { conta: 11, incluidos: 1, cancelados: 0, pendencias: 1, divergencias: 0 });
  });
}

test.describe('@C2-103 integração contábil da receita (06-FAT L37)', () => {
  test('abertas primeiro, visão por conta num clique, apurar com contagens e filtro de situação', async ({
    page,
  }) => {
    const consultas: URL[] = [];
    const apuracoes: { corpo: unknown; chave: string | null }[] = [];
    await simular(page, consultas, apuracoes);
    await entrar(page, 'SINT.CONTAS');

    await page.goto('/faturamento/receita-contabil');
    await expect(page.getByTestId('tela-receita-contabil')).toBeVisible();
    await expect(page.getByTestId('rc-regras')).toContainText('3');
    await expect(page.getByTestId('rc-resumo')).toContainText(
      '2 evento(s), 1 pendência(s) aberta(s) e 1 divergência(s)',
    );
    await expect(page.getByTestId('rc-ocorrencia-5')).toContainText('sem regra contábil para o fato');
    await expect(page.getByTestId('rc-ocorrencia-6')).toContainText('Divergência');
    await expect(page.getByTestId('rc-ocorrencia-7')).toHaveCount(0);
    await expect(page.getByTestId('rc-resolvidas')).toContainText('(1)');
    await expect(page.getByTestId('rc-evento-1')).toContainText('RECEITA DE SERVICOS SINTETICA');
    await semViolacaoAxe(page, 'receita contábil');

    // Código de conta inválido: o erro aparece enquanto se digita e nada é enviado.
    await expect(page.getByTestId('rc-apurar')).toBeDisabled();
    await page.getByTestId('rc-conta').fill('12a');
    await expect(page.getByTestId('rc-erro-conta')).toBeVisible();
    await expect(page.getByTestId('rc-filtrar')).toBeDisabled();
    await expect(page.getByTestId('rc-apurar')).toBeDisabled();
    expect(apuracoes).toHaveLength(0);

    // Visão por conta: um clique no número da conta filtra a tela por ela.
    await page.getByTestId('rc-conta').fill('');
    await page
      .getByTestId('rc-evento-1')
      .getByRole('button', { name: /SINT-11/ })
      .click();
    await expect(page.getByTestId('rc-conta')).toHaveValue('11');
    await expect(page.getByTestId('rc-evento-2')).toHaveCount(0);
    await expect(page.getByTestId('rc-ocorrencia-6')).toHaveCount(0);
    expect(consultas.some((u) => u.searchParams.get('conta') === '11')).toBe(true);

    // Apurar a conta num clique: a conta vai no corpo, com a chave de idempotência, e o resultado vem em contagens.
    await page.getByTestId('rc-apurar').click();
    await expect(
      page.getByText(/Conta 11 apurada: 1 evento\(s\) incluído\(s\), 0 cancelado\(s\), 1 pendência/),
    ).toBeVisible();
    expect(apuracoes).toHaveLength(1);
    expect(apuracoes[0]?.corpo).toEqual({ conta: 11 });
    expect(apuracoes[0]?.chave).toBeTruthy();
    await expect(page.getByTestId('rc-evento-3')).toContainText('Previsão');

    // Filtro de situação vai na consulta; "Ver todas as contas" tira o filtro de conta.
    await escolher(page.getByTestId('rc-situacao'), { rotulo: 'Pendente' });
    await expect.poll(() => consultas.some((u) => u.searchParams.get('situacao') === 'pendente')).toBe(true);
    await page.getByTestId('rc-limpar').click();
    await expect(page.getByTestId('rc-conta')).toHaveValue('');
    await expect(page.getByTestId('rc-ocorrencia-6')).toBeVisible();
    await semViolacaoAxe(page, 'receita contábil');
  });
});
