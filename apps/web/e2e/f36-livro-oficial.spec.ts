// E2E @F3.6-05 (F3.6, 05-SUP linha 10): fechamento oficial do livro de controlados pela tela (/farmacia/livro). O
// farmacêutico responsável vê o livro do período em modo conferência com os termos montados; o período maior que a
// semana é recusado na hora (sem ir ao servidor) e trava os dois fechamentos; o fechamento oficial pede confirmação
// com o período e as páginas (desistir não grava); a recusa do servidor (estabelecimento sem CNPJ) aparece com o
// texto e nada muda; confirmado, a tela relê e mostra o livro como oficial, com os termos de abertura e de
// encerramento GRAVADOS (emitente com CNPJ, responsável, emissão; o de encerramento cita o conteúdo guardado), a
// guarda legal e os fechamentos travados. O fechamento oficial exige a chave do livro oficial ligada (aprovação
// prévia da Vigilância Sanitária) e a raiz de arquivos do banco próprio; o E2E roda com a fonte sintética, por isso
// as rotas /api/farmacia/gravacao e /api/farmacia/livro são simuladas pelo Playwright com massa SINTÉTICA. O efeito
// no banco (livro oficial com o arquivo e o hash, os dois termos, as recusas e a leitura dos termos gravados) está em
// apps/api/src/modulos/farmacia/porta-propria-dispensacao.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

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

const LIGADA = { ligada: true, motivo: null };
const EMITENTE = 'HOSPITAL SINTETICO LTDA, CNPJ 92.400.000/0001-55';
const termo = (tipo: 'abertura' | 'encerramento') => ({
  tipo,
  paginaInicial: 1,
  paginaFinal: 2,
  razaoSocial: 'HOSPITAL SINTETICO LTDA',
  cnpj: '92400000000155',
  responsavel: 'FARMACEUTICA SINTETICA',
  emitidoEm: '2026-11-15T08:30',
  conteudoGuardado: tipo === 'encerramento',
  texto:
    tipo === 'abertura'
      ? `Termo de abertura: este livro contém 2 página(s), numeradas de 1 a 2, e destina-se à escrituração de livro sintetico de ${EMITENTE}, no período de 08/11/2026 a 14/11/2026. Responsável técnico: FARMACEUTICA SINTETICA. Emitido em 15/11/2026.`
      : `Termo de encerramento: este livro, de ${EMITENTE}, contém 2 página(s), numeradas de 1 a 2, escrituradas de 08/11/2026 a 14/11/2026. O conteúdo fechado está guardado no arquivo do livro. Responsável técnico: FARMACEUTICA SINTETICA. Emitido em 15/11/2026.`,
});
const pagina = (n: number, nome: string) => ({
  pagina: n,
  item: 7000 + n,
  nome,
  lista: 'A1',
  anterior: 10,
  entradas: 5,
  saidas: 3,
  final: 12,
  movimentos: [
    { data: '2026-11-09', tipo: 'entrada', quantidade: 5, documento: `N-${n}` },
    { data: '2026-11-10', tipo: 'saida', quantidade: 3, documento: `S-${n}` },
  ],
});

test.describe('Livro de controlados: fechamento oficial @F3.6-05 @fase3', () => {
  test.setTimeout(180_000);

  test('período conferido na hora, confirmação do oficial, recusa do servidor e termos gravados na leitura; axe', async ({
    page,
  }) => {
    const fechamentos: Record<string, unknown>[] = [];
    let fechado = false;
    let comCnpj = false;
    await page.route('**/api/farmacia/gravacao', (rota) =>
      json(rota, {
        funcionalidades: { controlados: LIGADA, livroOficial: LIGADA },
        operacoes: { fecharLivro: LIGADA, fecharLivroOficial: LIGADA },
      }),
    );
    await page.route('**/api/farmacia/livro**', (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      if (req.method() === 'GET' && url.pathname.endsWith('/livro')) {
        const inicio = url.searchParams.get('inicio') ?? '2026-11-08';
        const fim = url.searchParams.get('fim') ?? '2026-11-14';
        const doPeriodo = fechado && inicio === '2026-11-08' && fim === '2026-11-14';
        return json(rota, {
          livro: 1,
          titulo: 'LIVRO SINTETICO',
          inicio,
          fim,
          modo: doPeriodo ? 'oficial' : 'conferencia',
          termoAbertura: 'TERMO DE ABERTURA MONTADO SINTETICO',
          termoEncerramento: 'TERMO DE ENCERRAMENTO MONTADO SINTETICO',
          paginas: [pagina(1, 'SUBSTANCIA ALFA SINTETICA'), pagina(2, 'SUBSTANCIA BETA SINTETICA')],
          fechado: doPeriodo
            ? {
                em: '2026-11-15T08:30',
                por: 'SINT.FARMACEUTICO',
                guardaAte: '2028-11-14',
                hash: 'a'.repeat(64),
                modo: 'oficial',
                termos: [termo('abertura'), termo('encerramento')],
              }
            : null,
        });
      }
      if (req.method() === 'POST' && url.pathname.endsWith('/livro/fechar')) {
        fechamentos.push((req.postDataJSON() ?? {}) as Record<string, unknown>);
        if (!comCnpj)
          return rota.fulfill({
            status: 422,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              type: 'about:blank',
              title: 'Operação recusada',
              status: 422,
              codigo: 'estabelecimento-sem-cnpj',
              detail:
                'O livro oficial leva nos termos a razão social e o CNPJ do estabelecimento: complete o cadastro do estabelecimento.',
            }),
          });
        fechado = true;
        return json(rota, {
          mensagem: 'Livro fechado (oficial); guarda até 2028-11-14.',
          repetida: false,
          ids: { livro: 91, hash: 'a'.repeat(64) },
          avisos: [],
        });
      }
      return json(rota, { title: 'rota não simulada' }, 404);
    });

    await entrar(page, 'SINT.FARMACEUTICO');
    await page.goto('/farmacia/livro');
    await expect(page.getByTestId('tela-farmacia-livro')).toBeVisible();

    // O período aberto: modo conferência, termos montados na hora (ainda não gravados) e os dois fechamentos livres.
    await expect(page.getByTestId('livro-modo')).toContainText('Modo conferência');
    await expect(page.getByTestId('livro-termo-abertura')).toHaveAttribute('data-gravado', 'nao');
    await expect(page.getByTestId('livro-termo-abertura')).toContainText('MONTADO SINTETICO');
    await expect(page.getByTestId('livro-fechado')).toHaveCount(0);
    await expect(page.getByTestId('livro-fechar')).toBeEnabled();
    await expect(page.getByTestId('livro-fechar-oficial')).toBeEnabled();
    await semViolacaoAxe(page, '/farmacia/livro aberto');

    // Período maior que a semana: recusado na hora, sem ir ao servidor, e os dois fechamentos travam.
    await page.locator('#lv-ini').fill('2026-11-08');
    await page.locator('#lv-fim').fill('2026-11-20');
    await expect(page.getByTestId('livro-periodo')).toContainText('até 7 dias');
    await expect(page.getByTestId('livro-fechar')).toBeDisabled();
    await expect(page.getByTestId('livro-fechar-oficial')).toBeDisabled();
    await page.locator('#lv-fim').fill('2026-11-14');
    await expect(page.getByTestId('livro-periodo')).toHaveCount(0);
    await expect(page.getByTestId('livro-fechar-oficial')).toBeEnabled();

    // O oficial pede confirmação com o período e as páginas; desistir não grava nada.
    await page.getByTestId('livro-fechar-oficial').click();
    const confirmacao = page.getByTestId('livro-confirmar-oficial');
    await expect(confirmacao).toContainText('de 08/11/2026 a 14/11/2026, com 2 página(s)');
    await expect(confirmacao).toContainText('não pode ser refeito');
    await semViolacaoAxe(page, '/farmacia/livro confirmação');
    await page.getByTestId('livro-desistir').click();
    await expect(confirmacao).toHaveCount(0);
    expect(fechamentos).toEqual([]);

    // O servidor recusa (cadastro do estabelecimento sem CNPJ): o texto aparece e o livro continua aberto.
    await page.getByTestId('livro-fechar-oficial').click();
    await page.getByTestId('livro-confirmar').click();
    await expect(page.getByTestId('recusa-farmacia')).toContainText('CNPJ do estabelecimento');
    await expect(page.getByTestId('livro-fechado')).toHaveCount(0);
    await expect(page.getByTestId('livro-modo')).toContainText('Modo conferência');
    expect(fechamentos).toEqual([{ livro: 1, inicio: '2026-11-08', fim: '2026-11-14', oficial: true }]);

    // Com o cadastro completo o fechamento oficial grava; a tela relê e mostra os termos GRAVADOS.
    comCnpj = true;
    await page.getByTestId('livro-fechar-oficial').click();
    await page.getByTestId('livro-confirmar').click();
    await expect(page.getByTestId('livro-mensagem')).toContainText('Livro fechado (oficial)');
    await expect(page.getByTestId('recusa-farmacia')).toHaveCount(0);
    await expect(page.getByTestId('livro-modo')).toHaveText('Livro oficial');
    const abertura = page.getByTestId('livro-termo-abertura');
    await expect(abertura).toHaveAttribute('data-gravado', 'sim');
    await expect(abertura).toContainText(EMITENTE);
    await expect(abertura).toContainText('Responsável técnico: FARMACEUTICA SINTETICA');
    const encerramento = page.getByTestId('livro-termo-encerramento');
    await expect(encerramento).toHaveAttribute('data-gravado', 'sim');
    await expect(encerramento).toContainText('guardado no arquivo do livro');
    await expect(page.getByTestId('livro-termos-situacao')).toContainText('gravados no fechamento');
    await expect(page.getByTestId('livro-fechado')).toContainText('SINT.FARMACEUTICO');
    await expect(page.getByTestId('livro-fechado')).toContainText('14/11/2028');
    expect(fechamentos).toHaveLength(2);

    // O período fechado como oficial não fecha de novo, nem em conferência.
    await expect(page.getByTestId('livro-fechar')).toBeDisabled();
    await expect(page.getByTestId('livro-fechar-oficial')).toBeDisabled();
    await expect(page.getByTestId('livro-pdf')).toHaveAttribute('href', /livro\/pdf\?livro=1/);
    await semViolacaoAxe(page, '/farmacia/livro fechado oficial');

    // Outro período continua aberto: os termos voltam a ser os montados e o fechamento libera.
    await page.locator('#lv-ini').fill('2026-11-15');
    await page.locator('#lv-fim').fill('2026-11-21');
    await expect(page.getByTestId('livro-modo')).toContainText('Modo conferência');
    await expect(page.getByTestId('livro-termo-abertura')).toHaveAttribute('data-gravado', 'nao');
    await expect(page.getByTestId('livro-fechar-oficial')).toBeEnabled();
  });
});
