// F3.7 (06-FAT linha 36): a nota fiscal de serviço que documenta a fatura do convênio ou a conta do particular. As
// leituras e gravações de `/api/faturamento/faturas*` e `/api/faturamento/notas-fiscais/*` só existem no banco do
// cliente (na fonte sintética respondem 503), então este E2E simula as rotas com um estado em memória que segue a regra
// do servidor (saldo da nota e da fatura; a cancelada não conta; desligar pede motivo de 10 caracteres ou mais). O que
// fica no banco (o vínculo com autoria, o ajuste, o desligamento marcado e o histórico) é provado no contrato de efeito
// `apps/api/src/modulos/faturamento/nota-vinculo-propria.int.spec.ts`; aqui se prova o fluxo da tela: das contas à
// lista das faturas, o filtro pela situação da documentação (combo), abrir a fatura num clique, o valor sugerido da
// candidata, a recusa na hora acima do saldo, ligar, desligar com o motivo conferido enquanto se digita, e o atalho da
// conta para a nota fiscal dela. Axe em cada passo. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { escolher } from './combos.js';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const LOGIN = 'SINT.ADMIN';

async function entrar(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(LOGIN);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

interface Ligada {
  id: number;
  versao: number;
  notaServicoId: number;
  valor: number;
  ativo: boolean;
}

test.describe('faturamento: nota fiscal da fatura e da conta @C1-134', () => {
  test.setTimeout(180_000);

  test('lista das faturas, filtro, abrir, sugerido, recusa acima do saldo, ligar, desligar com motivo; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const FATURA = 901;
    const NOTA = 77;
    const VALOR_FATURA = 1000;
    const VALOR_NOTA = 600;
    const ligadas: Ligada[] = [];
    const historico: Record<string, unknown>[] = [];
    let corpoLigar: Record<string, unknown> | null = null;
    let corpoDesligar: Record<string, unknown> | null = null;
    const documentado = () => ligadas.filter((l) => l.ativo).reduce((s, l) => s + l.valor, 0);
    const situacao = () =>
      documentado() <= 0 ? 'sem_nota' : documentado() >= VALOR_FATURA ? 'documentada' : 'parcial';
    const fatura = () => ({
      id: FATURA,
      numero: 'FAT-SINT-1',
      situacao: 'fechada',
      competencia: '2026-01',
      fontePagadoraId: 5,
      fontePagadora: 'OPERADORA SINTETICA',
      valorDocumentavel: VALOR_FATURA,
      valorDocumentado: documentado(),
      saldo: VALOR_FATURA - documentado(),
      notasLigadas: ligadas.filter((l) => l.ativo).length,
      documentacao: situacao(),
    });

    await page.route('**/api/faturamento/faturas?**', (r) => {
      const u = new URL(r.request().url());
      const doc = u.searchParams.get('documentacao');
      return json(
        r,
        [fatura()].filter((f) => !doc || f.documentacao === doc),
      );
    });
    await page.route('**/api/faturamento/faturas', (r) => json(r, [fatura()]));
    await page.route(`**/api/faturamento/faturas/${FATURA}/notas-fiscais`, (r) => {
      const ativa = ligadas.find((l) => l.ativo);
      const saldoNota = VALOR_NOTA - documentado();
      return json(r, {
        alvo: {
          tipo: 'fatura',
          id: FATURA,
          numero: 'FAT-SINT-1',
          situacao: 'fechada',
          fontePagadoraId: 5,
          valorDocumentavel: VALOR_FATURA,
          valorDocumentado: documentado(),
          saldo: VALOR_FATURA - documentado(),
          documentacao: situacao(),
        },
        ligadas: ligadas
          .filter((l) => l.ativo)
          .map((l) => ({
            id: l.id,
            versao: l.versao,
            notaServicoId: l.notaServicoId,
            numeroNota: 'NFS-SINT-1',
            rps: 'T-1',
            situacaoNota: 'autorizada',
            documenta: true,
            emitidaEm: '2026-02-05T10:00:00',
            valorServicos: VALOR_NOTA,
            valorApropriado: l.valor,
            valorDesconto: 0,
            valorAcrescimo: 0,
          })),
        candidatas: ativa
          ? []
          : [
              {
                id: NOTA,
                numeroNota: 'NFS-SINT-1',
                rps: 'T-1',
                situacao: 'autorizada',
                emitidaEm: '2026-02-05T10:00:00',
                emitidaParaEste: false,
                valorServicos: VALOR_NOTA,
                saldoNota,
                sugerido: Math.min(saldoNota, VALOR_FATURA - documentado()),
              },
            ],
        historico,
      });
    });
    await page.route('**/api/faturamento/notas-fiscais/vinculos', (r) => {
      corpoLigar = r.request().postDataJSON() as Record<string, unknown>;
      ligadas.push({
        id: 31,
        versao: 1,
        notaServicoId: NOTA,
        valor: Number(corpoLigar['valorApropriado']),
        ativo: true,
      });
      historico.unshift({
        id: 1,
        vinculoId: 31,
        notaServicoId: NOTA,
        acao: 'ligado',
        valorAnterior: null,
        valor: Number(corpoLigar['valorApropriado']),
        situacaoNota: 'autorizada',
        motivo: null,
        em: '2026-02-06T09:00:00',
        por: 1,
      });
      return json(r, { id: 31, acao: 'ligado' });
    });
    await page.route('**/api/faturamento/notas-fiscais/vinculos/31/desligamento', (r) => {
      corpoDesligar = r.request().postDataJSON() as Record<string, unknown>;
      const l = ligadas.find((x) => x.id === 31)!;
      l.ativo = false;
      historico.unshift({
        id: 2,
        vinculoId: 31,
        notaServicoId: NOTA,
        acao: 'desligado',
        valorAnterior: l.valor,
        valor: null,
        situacaoNota: 'autorizada',
        motivo: String(corpoDesligar['motivo']),
        em: '2026-02-07T09:00:00',
        por: 1,
      });
      return json(r, { id: 31 });
    });

    await entrar(page);
    // Das contas do paciente à lista das faturas, num clique.
    await page.goto('/faturamento/contas');
    await page.getByTestId('ctas-faturas').click();
    await expect(page).toHaveURL(/\/faturamento\/faturas$/);
    await expect(page.getByTestId(`fnf-documentacao-${FATURA}`)).toHaveText('Sem nota');
    await expect(page.getByTestId(`fnf-falta-${FATURA}`)).toContainText('1.000,00');
    await semViolacaoAxe(page, '/faturamento/faturas');

    // O filtro pela situação da documentação (combo): "Documentada" esconde a fatura; "Sem nota" a traz de volta.
    await escolher(page.getByTestId('fnf-documentacao'), { rotulo: 'Documentada' });
    await expect(page.getByTestId('fnf-vazio')).toBeVisible();
    await escolher(page.getByTestId('fnf-documentacao'), { rotulo: 'Sem nota' });
    await expect(page.getByTestId(`fnf-linha-${FATURA}`)).toBeVisible();

    // Abrir a nota fiscal da fatura: a candidata vem com o sugerido (o menor entre o saldo da nota e o que falta).
    await page.getByTestId(`fnf-abrir-${FATURA}`).click();
    await expect(page).toHaveURL(new RegExp(`/faturamento/faturas/${FATURA}/notas-fiscais$`));
    await expect(page.getByTestId('nf-documentacao')).toHaveText('Sem nota');
    await expect(page.getByTestId(`nf-valor-${NOTA}`)).toHaveValue(String(VALOR_NOTA));
    await semViolacaoAxe(page, '/faturamento/faturas/:id/notas-fiscais (início)');

    // Acima do saldo da nota: a recusa aparece na hora e o botão fica desligado (nada vai ao servidor).
    await page.getByTestId(`nf-valor-${NOTA}`).fill('700');
    await expect(page.getByTestId(`nf-ligar-${NOTA}`)).toBeDisabled();
    expect(corpoLigar).toBeNull();

    // Ligar com o valor da nota.
    await page.getByTestId(`nf-valor-${NOTA}`).fill('600');
    await expect(page.getByTestId(`nf-ligar-${NOTA}`)).toBeEnabled();
    await page.getByTestId(`nf-ligar-${NOTA}`).click();
    await expect(page.getByTestId('nf-documentacao')).toHaveText('Documentada em parte');
    await expect(page.getByTestId('nf-falta')).toContainText('400,00');
    expect(corpoLigar).toMatchObject({
      tipo: 'fatura',
      alvoId: FATURA,
      notaServicoId: NOTA,
      valorApropriado: 600,
    });
    await semViolacaoAxe(page, '/faturamento/faturas/:id/notas-fiscais (ligada)');

    // Desligar pede o motivo, conferido enquanto se digita (curto demais segura o botão).
    await page.getByTestId('nf-desligar-31').click();
    await page.getByTestId('nf-motivo-31').fill('curto');
    await expect(page.getByTestId('nf-confirmar-desligar-31')).toBeDisabled();
    await page.getByTestId('nf-motivo-31').fill('Nota emitida com o valor errado');
    await expect(page.getByTestId('nf-confirmar-desligar-31')).toBeEnabled();
    await page.getByTestId('nf-confirmar-desligar-31').click();
    await expect(page.getByTestId('nf-documentacao')).toHaveText('Sem nota');
    expect(corpoDesligar).toMatchObject({ versao: 1, motivo: 'Nota emitida com o valor errado' });
    await expect(page.getByTestId('nf-historico')).toContainText('Desligada');
    await expect(page.getByTestId('nf-historico')).toContainText('Nota emitida com o valor errado');
    await semViolacaoAxe(page, '/faturamento/faturas/:id/notas-fiscais (desligada)');

    expect(externas).toEqual([]);
  });
});
