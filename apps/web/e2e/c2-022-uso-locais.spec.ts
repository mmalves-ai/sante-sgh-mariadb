// C2-022 (02-REC linha 34): a fila do consultório USA a configuração dos locais de atendimento, pelo caminho da tela.
// O uso da configuração exige o banco próprio e o E2E roda com a fonte sintética (sem núcleo); por isso a resposta de
// /api/atendimento/fila é simulada pelo Playwright com massa SINTÉTICA. O que se prova é a tela: o combo de locais traz
// só os que o usuário vê (os dele e os que eles consultam), o local fora do horário mostra o aviso com a hora em que
// abre (aviso, não trava), o que não abre mais hoje diz isso, e o local aberto mostra até quando. O efeito no banco
// (vínculo e visibilidade gravados pela manutenção, semana de funcionamento, destinos de encaminhamento da recepção e
// a conferência na gravação do encaminhamento) está no contrato de efeito
// (apps/api/src/modulos/atendimento/uso-locais.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { abrirCombo, escolher, fecharCombo } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown) =>
  rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });

type Horario = { aberto: boolean; semHorario: boolean; abreAs: string | null; fechaAs: string | null };

// Locais que o usuário vê: os consultórios dele (3 e 14) e a observação que ele consulta (13). O consultório 02 (12)
// não é dele nem é consultado, e não vem. O 14 já fechou e não abre mais hoje. Cada situação de horário fica num local
// próprio: a tela guarda a fila lida por 15 s (staleTime do cliente), e trocar a resposta do mesmo local no meio do
// teste provaria o cache, não o aviso.
const LOCAIS = [
  { id: 3, descricao: 'CONSULTORIO SINTETICO 01' },
  { id: 13, descricao: 'OBSERVACAO SINTETICA' },
  { id: 14, descricao: 'CONSULTORIO SINTETICO 03' },
];
const HORARIO: Record<number, Horario> = {
  3: { aberto: false, semHorario: false, abreAs: '13:00', fechaAs: null },
  13: { aberto: true, semHorario: false, abreAs: null, fechaAs: '18:00' },
  14: { aberto: false, semHorario: false, abreAs: null, fechaAs: null },
};

test.describe('C2-022 fila do consultório com a configuração dos locais @C2-022 @F3.2', () => {
  test('locais visíveis, aviso de fora do horário e horário de fechamento; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await page.route(/\/api\/atendimento\/fila(\?.*)?$/, (rota) => {
      const local = Number(new URL(rota.request().url()).searchParams.get('local') ?? 0);
      const doLocal = LOCAIS.find((l) => l.id === local) ?? null;
      const horario = HORARIO[local] ?? null;
      return json(rota, {
        local: doLocal ? { ...doLocal, horario } : null,
        locais: LOCAIS,
        profissional: null,
        itens: [],
        cortada: false,
        atualizadoEm: '2026-11-25T12:30:00',
      });
    });
    await entrar(page, 'SINT.ATENDIMENTO');

    await page.goto('/consultorio/fila?local=3');
    await expect(page.getByTestId('tela-fila-consultorio')).toBeVisible();
    // O combo traz só os locais que o usuário vê, depois da opção vazia "Escolha…" (sem local escolhido).
    const combo = page.getByTestId('fila-local');
    const lista = await abrirCombo(combo);
    await expect(lista.getByRole('option')).toHaveText([
      /^Escolha…$/,
      /CONSULTORIO SINTETICO 01/,
      /OBSERVACAO SINTETICA/,
      /CONSULTORIO SINTETICO 03/,
    ]);
    await fecharCombo(combo, lista);
    // Fora do horário: aviso com a hora em que abre; a fila continua utilizável (aviso, não trava).
    await expect(page.getByTestId('fila-local-fechado')).toContainText('abre às 13:00');
    await expect(page.getByTestId('fila-local-aberto')).toHaveCount(0);
    await semViolacaoAxe(page, '/consultorio/fila (local fechado)');

    // Local aberto: mostra até quando.
    await escolher(combo, '13');
    await expect(page.getByTestId('fila-local-aberto')).toContainText('Aberto até 18:00');
    await expect(page.getByTestId('fila-local-fechado')).toHaveCount(0);

    // O local que não abre mais hoje diz isso.
    await escolher(combo, '14');
    await expect(page.getByTestId('fila-local-fechado')).toContainText('não abre mais hoje');
    expect(externas).toEqual([]);
  });
});
