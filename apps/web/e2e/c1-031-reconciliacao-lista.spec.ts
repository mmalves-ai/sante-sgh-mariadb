// E2E @C1-031 (03-PEP L104): a reconciliação medicamentosa parte da lista de uso contínuo do paciente. O médico
// inclui dois medicamentos na lista (tela de reações adversas e uso contínuo), abre a reconciliação, escolhe o momento
// (admissão), decide a conduta de cada medicamento ativo; a conduta diferente de manter pede justificativa na hora
// (botão bloqueado até preencher); registra e vê o lote nas reconciliações do atendimento; a lista se atualiza (o
// suspenso sai dos ativos). Na alta, a mesma lista volta só com o que continua ativo. Sessão real sobre a fonte
// sintética de dev (pacientes e medicamentos SINTÉTICOS; nada vai à cópia). axe sem violação séria.
// A lista de uso contínuo mora só no banco do cliente: sem ele (fonte sintética), /api/pep/farmacovigilancia responde
// 503. Por isso as rotas da farmacovigilância e a leitura das reconciliações do atendimento são simuladas (page.route
// com massa sintética, no formato de api-farmacovigilancia.ts e de esquemaReconciliacaoLida), e o corpo enviado em
// cada inclusão e na reconciliação é conferido. O contexto do paciente e a liberação são as rotas reais. O que fica no
// banco é provado pelo contrato de efeito farmacovigilancia-propria.int.spec.ts.
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function incluirNaLista(page: Page, nome: string, posologia: string): Promise<void> {
  const form = page.getByTestId('farmaco-uso-novo');
  await form.getByTestId('farmaco-uso-nome').fill(nome);
  await form.getByRole('textbox', { name: /Posologia/ }).fill(posologia);
  await form.getByTestId('farmaco-uso-incluir').click();
  await expect(page.getByTestId('farmaco-ok')).toBeVisible();
  await expect(page.locator('[data-testid^="farmaco-uso-"]').filter({ hasText: nome }).first()).toBeVisible();
}

type Uso = {
  id: number;
  versao: number;
  medicamento: string;
  posologia: string | null;
  fonte: string;
  conduta: string | null;
  suspenso: boolean;
  justificativaSuspensao: string | null;
};
type Decisao = { usoContinuo: number; conduta: string; justificativa: string | null };
type Lote = {
  id: number;
  momento: string;
  registradoEm: string;
  registradoPor: string;
  medicamentos: unknown[];
};

/** Simula a farmacovigilância do paciente (lista de uso contínuo) e a leitura das reconciliações do atendimento. */
async function simularLista(page: Page) {
  const usos: Uso[] = [];
  const lotes: Lote[] = [];
  const corpos: Record<string, unknown>[] = [];
  const json = (r: Route, corpo: unknown, status = 200) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
  await page.route(`**/api/pep/farmacovigilancia/paciente/${PACIENTE}`, (r) =>
    json(r, {
      reacoes: [],
      usoContinuo: usos,
      itensPrescritos: [],
      gravidades: [{ id: 1, descricao: 'Leve', nivel: 1 }],
      causalidades: [],
      nivelGrave: 3,
    }),
  );
  await page.route('**/api/pep/farmacovigilancia/uso-continuo', async (r) => {
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    corpos.push(corpo);
    if (corpo['acao'] === 'incluir') {
      usos.push({
        id: 500 + usos.length,
        versao: 1,
        medicamento: String(corpo['descricaoLivre']),
        posologia: (corpo['posologia'] as string | null) ?? null,
        fonte: String(corpo['fonte']),
        conduta: null,
        suspenso: false,
        justificativaSuspensao: null,
      });
      return json(r, { ok: true }, 201);
    }
    if (corpo['acao'] === 'reconciliar') {
      const decisoes = corpo['decisoes'] as Decisao[];
      const medicamentos = decisoes.map((d) => {
        const u = usos.find((x) => x.id === d.usoContinuo)!;
        u.conduta = d.conduta;
        if (d.conduta === 'suspender') {
          u.suspenso = true;
          u.justificativaSuspensao = d.justificativa;
        }
        return {
          descricao: u.medicamento,
          fonte: 'paciente',
          conduta: d.conduta,
          ...(d.justificativa ? { justificativa: d.justificativa } : {}),
        };
      });
      lotes.push({
        id: 9100 + lotes.length,
        momento: String(corpo['momento']),
        registradoEm: new Date().toISOString(),
        registradoPor: 'MEDICO SINTETICO',
        medicamentos,
      });
      return json(r, { ok: true }, 201);
    }
    return json(r, { type: 'urn:sgh:problema:recusa-de-negocio', title: 'Ação não simulada' }, 422);
  });
  await page.route(`**/api/pep/prescricao/${PACIENTE}/reconciliacao?*`, (r) =>
    r.request().method() === 'GET' ? json(r, lotes) : r.fallback(),
  );
  return corpos;
}

function cartaoDoUso(page: Page, nome: string) {
  return page
    .locator('[data-testid^="recon-uso-"]')
    .filter({ has: page.locator('legend', { hasText: nome }) });
}

test.describe('Reconciliação pela lista de uso contínuo @C1-031 @fase7', () => {
  test.setTimeout(180_000);
  test('admissão decide cada medicamento ativo com justificativa na hora; alta volta só com os ativos', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const corpos = await simularLista(page);
    await entrar(page, 'SINT.MEDICO');
    const marca = Date.now().toString(36).slice(-5).toUpperCase();
    const manter = `ENALAPRIL SINTETICO ${marca}`;
    const suspender = `SINVASTATINA SINTETICA ${marca}`;

    await page.goto(`/pep/paciente/${PACIENTE}/farmacovigilancia`);
    await expect(page.getByTestId('farmaco-tela')).toBeVisible();
    await incluirNaLista(page, manter, '10 mg de 12 em 12 horas');
    await incluirNaLista(page, suspender, '20 mg à noite');
    expect(corpos.map((c) => [c['acao'], c['paciente'], c['descricaoLivre'], c['posologia']])).toEqual([
      ['incluir', PACIENTE, manter, '10 mg de 12 em 12 horas'],
      ['incluir', PACIENTE, suspender, '20 mg à noite'],
    ]);

    await page.goto(`/pep/paciente/${PACIENTE}/reconciliacao`);
    await expect(page.getByTestId('tela-reconciliacao')).toBeVisible();
    await escolher(page.getByTestId('recon-momento'), 'admissao');
    const lista = page.getByTestId('recon-lista');
    await expect(lista.getByTestId('form-recon-lista')).toBeVisible();
    await expect(cartaoDoUso(page, manter)).toBeVisible();
    const cartaoSusp = cartaoDoUso(page, suspender);
    await expect(cartaoSusp).toBeVisible();
    await semViolacaoAxe(page, 'reconciliação pela lista');

    // Suspender sem justificativa: a regra do domínio bloqueia na hora, sem ida ao servidor.
    await escolher(cartaoSusp.locator('[data-testid^="recon-uso-conduta-"]'), 'suspender');
    const just = cartaoSusp.locator('[data-testid^="recon-uso-justificativa-"]');
    await expect(just).toHaveAttribute('aria-invalid', 'true');
    await expect(lista.getByTestId('recon-lista-registrar')).toBeDisabled();
    // O aviso da justificativa em falta tem de ser legível (contraste) enquanto está na tela.
    await expect(cartaoSusp.locator('[id^="recon-uso-just-msg-"]')).toBeVisible();
    await semViolacaoAxe(page, 'reconciliação com justificativa em falta');
    await just.fill('Mialgia SINTETICA na admissão.');
    await expect(just).toHaveAttribute('aria-invalid', 'false');
    await expect(lista.getByTestId('recon-lista-registrar')).toBeEnabled();
    await lista.getByTestId('recon-lista-registrar').click();
    await expect(lista.getByTestId('recon-lista-ok')).toBeVisible();
    // O corpo enviado: uma decisão por medicamento ativo, a justificativa só na conduta diferente de manter.
    const rec = corpos.find((c) => c['acao'] === 'reconciliar')!;
    expect(rec['paciente']).toBe(PACIENTE);
    expect(rec['momento']).toBe('admissao');
    expect(Number(rec['atendimento'])).toBeGreaterThan(0);
    expect(rec['decisoes']).toEqual([
      { usoContinuo: 500, conduta: 'manter', justificativa: null },
      { usoContinuo: 501, conduta: 'suspender', justificativa: 'Mialgia SINTETICA na admissão.' },
    ]);

    // O lote aparece nas reconciliações do atendimento, com a conduta e a justificativa.
    const lote = page.locator('[data-testid^="reconciliacao-"]').filter({ hasText: suspender }).last();
    await expect(lote).toContainText('Admissão');
    await expect(lote).toContainText('Suspender');
    await expect(lote).toContainText('Mialgia SINTETICA');
    await expect(lote).toContainText(manter);

    // A lista se atualizou: o suspenso sai dos ativos; na alta decide-se só o que continua.
    await expect(cartaoDoUso(page, suspender)).toHaveCount(0);
    await expect(cartaoDoUso(page, manter)).toBeVisible();
    await escolher(page.getByTestId('recon-momento'), 'alta');
    await expect(lista.getByTestId('recon-lista-registrar')).toBeEnabled();
    await semViolacaoAxe(page, 'reconciliação na alta');
    expect(externas).toEqual([]);
  });
});
