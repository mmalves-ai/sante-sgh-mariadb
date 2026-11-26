// E2E @C1-100 (F7, 08-SGO linha 105): regras de crítica das contas médicas recebidas.
// Da tela das contas médicas para /operadora/regras-critica-conta: a operadora única já escolhida, a regra em uso na
// lista, a nova regra com a validação do domínio na hora (código repetido, procedimento relacionado igual ao principal,
// glosa automática sem motivo e sem percentual), a gravação com o corpo esperado, tirar de uso (só a versão e a
// situação vão ao servidor; a regra continua na lista, fora de uso) e axe sem violação séria.
// Fonte sintética: as respostas da API são simuladas pela rota (o contrato de efeito no banco está em
// conta-conferencia-propria.int.spec; a lista da conferência na ficha, em ConferenciaConta.spec). Nenhum dado de pessoa.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const OP = 8101;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const PROC_A = { id: 9101, codigo: '40301010', descricao: 'EXAME SINTETICO A' };
const PROC_B = { id: 9102, codigo: '40301020', descricao: 'EXAME SINTETICO B' };
const MOTIVO = { id: 9201, codigo: '1801', descricao: 'MOTIVO SINTETICO' };
const EM_USO = {
  id: 701,
  versao: 1,
  codigo: 'AUTO-1',
  descricao: 'EXAMES SINTETICOS EXCLUDENTES',
  tipo: 'auto_excludente',
  principal: PROC_A,
  relacionado: PROC_B,
  prestador: null,
  motivoGlosa: MOTIVO,
  percentual: null,
  glosaAutomatica: true,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
};

interface Estado {
  regras: Record<string, unknown>[];
  gravados: { url: string; corpo: Record<string, unknown> }[];
}

async function simular(page: Page, est: Estado): Promise<void> {
  const json = (r: Route, corpo: unknown, status = 200) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
  await page.route('**/api/operadora/regras-critica-conta/**', async (r) => {
    const caminho = new URL(r.request().url()).pathname;
    if (r.request().method() === 'POST') {
      const corpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>;
      est.gravados.push({ url: caminho, corpo });
      if (caminho.endsWith('/situacao')) {
        est.regras = est.regras.map((x) =>
          x['id'] === 701 ? { ...x, versao: 2, ativo: corpo['ativo'] } : x,
        );
        return json(r, { id: 701, versao: 2 });
      }
      est.regras.push({
        ...EM_USO,
        ...corpo,
        id: 702,
        principal: PROC_A,
        relacionado: null,
        motivoGlosa: MOTIVO,
      });
      return json(r, { id: 702, versao: 1 }, 201);
    }
    if (caminho.endsWith('/apoio'))
      return json(r, { procedimentos: [PROC_A, PROC_B], motivos: [MOTIVO], prestadores: [] });
    return json(r, est.regras);
  });
}

test.describe('regras de crítica das contas recebidas @C1-100', () => {
  test.describe.configure({ mode: 'serial' });

  test('nova regra com validação na hora, gravação e tirar de uso sem apagar; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const est: Estado = { regras: [{ ...EM_USO }], gravados: [] };
    await simular(page, est);
    // A operadora sintética das contas (o apoio real traz a lista; aqui a única, já escolhida).
    await page.route('**/api/operadora/contas/apoio', async (r) => {
      const real = await r.fetch();
      const corpo = (await real.json()) as Record<string, unknown>;
      await r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...corpo,
          operadoras: [{ id: OP, nome: 'OPERADORA SINTETICA', registroAns: '999999' }],
        }),
      });
    });
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/operadora/contas');
    await page.getByTestId('link-regras-critica-conta').click();
    await expect(page).toHaveURL(/\/operadora\/regras-critica-conta$/);
    await expect(page.getByTestId('tela-regras-critica-conta')).toBeVisible();
    await expect(page.getByTestId('regras-critica-AUTO-1')).toHaveAttribute('data-ativa', 'sim');

    // Validação na hora: código repetido (normalizado), relacionado igual ao principal.
    await page.getByTestId('regras-critica-codigo').locator('input').fill('auto 1');
    await page.getByTestId('regras-critica-descricao').locator('input').fill('GLOSA SINTETICA DE REFERENCIA');
    await escolher(page.getByTestId('regras-critica-principal'), { rotulo: /EXAME SINTETICO A/ });
    await escolher(page.getByTestId('regras-critica-relacionado'), { rotulo: /EXAME SINTETICO A/ });
    const falta = page.getByTestId('regras-critica-falta');
    await expect(falta).toContainText('código diferente das regras já cadastradas');
    await expect(falta).toContainText('procedimento relacionado diferente do principal');
    await expect(page.getByTestId('regras-critica-salvar')).toBeDisabled();

    // Glosa de referência: sem relacionado; exige motivo e percentual.
    await page.getByTestId('regras-critica-codigo').locator('input').fill('REF-1');
    await escolher(page.getByTestId('regras-critica-tipo'), {
      rotulo: 'Glosa de referência do procedimento',
    });
    await expect(page.getByTestId('regras-critica-relacionado')).toHaveCount(0);
    await expect(falta).toContainText('o motivo de glosa');
    await expect(falta).toContainText('o percentual de glosa');
    await escolher(page.getByTestId('regras-critica-motivo'), { rotulo: /1801/ });
    await page.getByTestId('regras-critica-percentual').locator('input').fill('150');
    await expect(falta).toContainText('percentual maior que 0 e até 100');
    await page.getByTestId('regras-critica-percentual').locator('input').fill('30');
    await expect(falta).toHaveCount(0);
    await semViolacaoAxe(page, 'regras de crítica das contas (formulário)');

    await page.getByTestId('regras-critica-salvar').click();
    await expect(page.getByTestId('regras-critica-aviso')).toContainText('Regra cadastrada');
    const inclusao = est.gravados.find((g) => g.url.endsWith(`/regras-critica-conta/${OP}`));
    expect(inclusao?.corpo).toMatchObject({
      codigo: 'REF-1',
      tipo: 'glosa_referencia',
      principal: PROC_A.id,
      relacionado: null,
      motivoGlosa: MOTIVO.id,
      percentual: 30,
      glosaAutomatica: false,
      vigenciaFim: null,
    });
    await expect(page.getByTestId('regras-critica-REF-1')).toBeVisible();

    // Tirar de uso: só versão e situação; a regra continua na lista, fora de uso.
    await page.getByTestId('regras-critica-alternar-AUTO-1').click();
    await expect(page.getByTestId('regras-critica-aviso')).toContainText('Situação da regra alterada');
    const situacao = est.gravados.find((g) => g.url.endsWith('/regra/701/situacao'));
    expect(situacao?.corpo).toEqual({ versao: 1, ativo: false });
    await expect(page.getByTestId('regras-critica-AUTO-1')).toHaveAttribute('data-ativa', 'nao');
    await semViolacaoAxe(page, 'regras de crítica das contas (lista)');
    expect(externas).toEqual([]);
  });
});
