// F3.3 (03-PEP L128): grupos comparativos de resultados pelo caminho da tela. O cadastro do grupo e o comparativo
// gravam e leem só o banco próprio, e o E2E roda com a fonte sintética (sem núcleo, as rotas respondem 503). Por isso as
// rotas dos grupos, dos filtros e do comparativo são simuladas pelo Playwright com massa SINTÉTICA; o cabeçalho do
// paciente vem da fonte sintética. O que se prova é a tela: o item do menu leva ao cadastro, o grupo é montado pela
// busca e gravado, aparece na aba de resultados do paciente, a aba manda o atendimento em curso do cabeçalho (o recorte
// "só o atendimento atual") e avisa quando não há atendimento, e o valor preliminar fica marcado. O efeito no banco está
// no contrato de efeito apps/api/src/modulos/pep/resultados-grupos-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe } from './ajuda.js';

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

test.describe('grupos comparativos de resultados (03-PEP L128) @F33 @C1-059', () => {
  test('cadastra o grupo pelo menu, vê lado a lado na aba de resultados com o recorte do atendimento', async ({
    page,
  }) => {
    const grupos: Record<string, unknown>[] = [];
    const gravados: Record<string, unknown>[] = [];
    const pedidosComparativo: URLSearchParams[] = [];
    await page.route('**/api/pep/resultados/grupos', (r) => {
      if (r.request().method() === 'PUT') {
        const corpo = r.request().postDataJSON() as Record<string, unknown>;
        gravados.push(corpo);
        grupos.push({ ...corpo, id: 7001, ordem: 0, versao: 1, ativo: true });
        return json(r, { id: 7001 });
      }
      return json(r, { itens: grupos });
    });
    await page.route('**/api/pep/resultados/exames?*', (r) =>
      json(r, {
        itens: [
          {
            id: 501,
            codigo: 'SINT01',
            nome: 'Função renal sintética',
            analitos: [{ id: 9, nome: 'Creatinina' }],
          },
        ],
      }),
    );
    await page.route('**/api/pep/resultados/filtros', (r) => json(r, { itens: [] }));
    await page.route('**/api/pep/paciente/*/resultados/comparativo?*', (r) => {
      const q = new URL(r.request().url()).searchParams;
      pedidosComparativo.push(q);
      const atendimento = q.get('atendimento') ? Number(q.get('atendimento')) : null;
      return json(r, {
        colunas: ['2026-11-22T08:00', '2026-11-23T08:00'],
        linhas: [
          {
            exame: 501,
            analito: 9,
            rotulo: 'Creatinina',
            unidade: 'mg/dL',
            faixa: '0.6 a 1.2 mg/dL',
            celulas: [
              {
                coluna: '2026-11-22T08:00',
                resultado: 1,
                valor: '1',
                numero: 1,
                situacao: 'normal',
                preliminar: false,
              },
              {
                coluna: '2026-11-23T08:00',
                resultado: 2,
                valor: '1.8',
                numero: 1.8,
                situacao: 'acima',
                preliminar: true,
              },
            ],
            tendencia: null,
            variacao: null,
          },
        ],
        foraDaFaixa: 0,
        criticos: 0,
        filtroAplicado: null,
        grupos: [7001],
        periodoDias: null,
        pendentes: [],
        recorte: atendimento ? 'atendimento' : 'sem-atendimento',
        atendimento,
      });
    });

    await entrar(page, 'SINT.ADMIN');
    // O item do menu (PEP › Administração do PEP) leva ao cadastro.
    await (await itemDoMenu(page, 'Grupos comparativos de resultados')).click();
    await expect(page).toHaveURL(/\/pep\/resultados\/grupos/);
    await page.getByTestId('grupo-novo').click();
    await page.getByTestId('grupo-nome').fill('Função renal');
    await page.getByTestId('grupo-busca').fill('renal');
    await page.getByTestId('grupo-buscar').click();
    await page.getByTestId('grupo-add-501').click();
    await expect(page.getByTestId('grupo-itens')).toContainText('Função renal sintética');
    await page.getByTestId('grupo-gravar').click();
    await expect(page.getByTestId('grupos-lista')).toContainText('Função renal');
    expect(gravados).toHaveLength(1);
    expect(gravados[0]).toMatchObject({ nome: 'Função renal', itens: [{ exame: 501, exameAnalito: null }] });
    await semViolacaoAxe(page, '/pep/resultados/grupos');

    // A aba de resultados do paciente mostra o grupo lado a lado e manda o atendimento em curso do cabeçalho.
    const cabecalho = page.waitForResponse((r) => /\/pep\/paciente\/1001\/cabecalho/.test(r.url()));
    await page.goto('/pep/paciente/1001/resultados');
    const atual = ((await (await cabecalho).json()) as { atendimentoAtual: number | null }).atendimentoAtual;
    await expect(page.getByTestId('comparativo-tabela')).toContainText('Creatinina');
    expect(pedidosComparativo.at(-1)!.get('atendimento')).toBe(atual === null ? null : String(atual));
    if (atual === null) await expect(page.getByTestId('comparativo-recorte-sem-atendimento')).toBeVisible();
    else await expect(page.getByTestId('comparativo-recorte')).toHaveAttribute('data-recorte', 'atendimento');
    await expect(page.getByTestId('comparativo-nota-preliminar')).toContainText('não entra na tendência');
    await semViolacaoAxe(page, '/pep/paciente/1001/resultados (comparativo)');
  });
});
