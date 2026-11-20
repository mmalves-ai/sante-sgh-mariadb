// E2E @M46.1 (ficha do M46, seções 7, 10 e 11; etapa 1: APA, ficha anestésica e SRPA): o anestesista escolhe a cirurgia
// do dia seguinte pelo menu da APA, confere as alergias, registra a avaliação (a conclusão "apto" com jejum curto é
// barrada na tela) e a pendência do agendamento fica resolvida; abre a ficha anestésica, marca a entrada na sala e o
// início da anestesia, lança os sinais e o fármaco, marca o fim, justifica a lacuna se houver e assina com a senha (o
// botão fica desabilitado enquanto falta algo); a enfermagem do bloco admite o paciente na recuperação, vê o quadro e
// a avaliação vencida e a alta impedida, as avaliações a cada 15 minutos e a alta pela regra v1. axe sem violação séria. Sessão real sobre a fonte sintética e as
// portas em MEMÓRIA (dados SINTÉTICOS).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Hoje em São Paulo (o relógio do estabelecimento sintético) e o próximo dia útil (o da cirurgia sintética 701). */
function dias(): { hoje: string; proximoUtil: string } {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return { hoje, proximoUtil: d.toISOString().slice(0, 10) };
}

/** Agora em São Paulo mais n minutos, AAAA-MM-DDTHH:mm (o campo de data e hora da tela). */
function instanteDaqui(n: number, base = Date.now()): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(base + n * 60_000));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
}

test.describe('APA, ficha anestésica e recuperação pós-anestésica @M46 @M46.1 @fase5', () => {
  test.setTimeout(300_000);

  test('APA → ficha com sinais, fármaco e assinatura → SRPA com a série e a alta; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const { proximoUtil } = dias();
    await entrar(page, 'SINT.ANESTESISTA');

    // A APA pela escolha do dia.
    await page.goto('/bloco/apa');
    await expect(page.getByTestId('tela-apa')).toBeVisible();
    await page.getByTestId('anest-data').fill(proximoUtil);
    await expect(page.getByTestId('cirurgia-701')).toBeVisible();
    await semViolacaoAxe(page, '/bloco/apa (escolha)');
    await page.getByTestId('abrir-701').click();
    await expect(page).toHaveURL(/\/bloco\/apa\/701$/);
    await expect(page.getByTestId('anest-alergias')).toBeVisible();
    // Jejum curto de líquido claro (1 h antes) com "apto": a tela barra antes de gravar.
    await page.getByTestId('apa-jejum-liquidosClaros').fill(`${proximoUtil}T07:00`);
    await page.getByTestId('apa-alergias').check();
    await expect(page.getByTestId('apa-recusas')).toContainText('jejum');
    await expect(page.getByTestId('apa-registrar')).toBeDisabled();
    await page.getByTestId('apa-jejum-liquidosClaros').fill(`${proximoUtil}T04:00`);
    await escolher(page.getByTestId('apa-asa'), '2');
    await escolher(page.getByTestId('apa-tipo'), '1');
    await semViolacaoAxe(page, '/bloco/apa/:agenda (formulário)');
    await page.getByTestId('apa-registrar').click();
    await expect(page.getByTestId('apa-mensagem')).toContainText(
      'Avaliação pré-anestésica registrada (versão 1)',
    );
    await expect(page.getByTestId('apa-vigente')).toContainText('ASA II');

    // A ficha anestésica: tempos, sinais, fármaco, fim da anestesia e assinatura.
    await page.goto('/bloco/ficha-anestesica/701');
    await expect(page.getByTestId('tela-ficha-anestesica')).toBeVisible();
    await page.getByTestId('fa-marcar-entradaSala').click();
    await expect(page.getByTestId('fa-marco-entradaSala')).not.toContainText('Marcar agora');
    await page.getByTestId('fa-marcar-inicioAnestesia').click();
    await expect(page.getByTestId('fa-marco-inicioAnestesia')).not.toContainText('Marcar agora');
    await page.reload();
    for (const [s, v] of [
      ['pas', '120'],
      ['pad', '70'],
      ['fc', '80'],
      ['spo2', '98'],
    ] as const)
      await page.getByTestId(`fa-sinal-${s}`).fill(v);
    await page.getByTestId('fa-lancar-sinais').click();
    await expect(page.getByTestId('fa-mensagem')).toContainText('lançamentos registrados na ficha');
    await expect(page.getByTestId('tabela-sinais')).toContainText('120');
    await escolher(page.getByTestId('fa-parte'), 'evento');
    await escolher(page.getByTestId('fa-evento'), 'intubacao');
    await page.getByTestId('fa-lancar').click();
    await expect(page.getByTestId('fa-lanc-evento')).toContainText('Intubação');
    await semViolacaoAxe(page, '/bloco/ficha-anestesica/:agenda (lançamentos)');
    await page.getByTestId('fa-marcar-fimAnestesia').click();
    await expect(page.getByTestId('fa-situacao')).toHaveAttribute('data-situacao', 'encerrada');
    // Se o relógio virou a fatia de 5 minutos no meio, a lacuna aparece e é justificada antes de assinar.
    if (await page.getByTestId('fa-justificar').count()) {
      await page.getByTestId('fa-motivo-lacuna').first().fill('Troca do monitor da sala sintética');
      await page.getByTestId('fa-justificar').first().click();
      await expect(page.getByTestId('fa-mensagem')).toContainText('Intervalo justificado');
    }
    await expect(page.getByTestId('fa-assinar')).toBeDisabled();
    await page.getByTestId('fa-senha').fill(SENHA);
    await expect(page.getByTestId('fa-assinar')).toBeEnabled();
    await page.getByTestId('fa-assinar').click();
    await expect(page.getByTestId('fa-assinada')).toBeVisible();
    await expect(page.getByTestId('fa-situacao')).toHaveAttribute('data-situacao', 'assinada');
    await page.getByTestId('fa-texto-adendo').fill('Adendo sintético do teste de ponta a ponta.');
    await page.getByTestId('fa-adendo').click();
    await expect(page.getByTestId('fa-adendos')).toContainText('Adendo sintético');
    await semViolacaoAxe(page, '/bloco/ficha-anestesica/:agenda (assinada)');

    // A recuperação: a enfermagem do bloco admite pela escolha do dia, vê o quadro e a alta impedida.
    await entrar(page, 'SINT.ENF.BLOCO');
    await page.goto('/bloco/srpa');
    await expect(page.getByTestId('srpa-quadro')).toBeVisible();
    await page.getByTestId('anest-data').fill(proximoUtil);
    await page.getByTestId('abrir-701').click();
    await expect(page).toHaveURL(/\/bloco\/srpa\?agenda=701$/);
    await semViolacaoAxe(page, '/bloco/srpa?agenda (admissão)');
    // A admissão há 34 minutos (registrada agora com o horário real da chegada); as avaliações a cada 14 minutos a partir
    // dela (os horários fixos desde já: o tempo que o teste leva não abre buraco na série).
    const base = Date.now();
    await page.getByTestId('srpa-em').fill(instanteDaqui(-34, base));
    await page.getByTestId('srpa-registrar').click();
    await expect(page.getByTestId('srpa-mensagem')).toContainText('Admissão na recuperação registrada');
    await expect(page.getByTestId('srpa-vencida')).toBeVisible();
    // A alta agora é impedida: a série tem um intervalo acima de 15 minutos.
    await escolher(page.getByTestId('srpa-momento'), 'alta');
    await expect(page.getByTestId('srpa-impedimentos')).toContainText('15 minutos');
    await expect(page.getByTestId('srpa-registrar')).toBeDisabled();
    await page.getByTestId('srpa-voltar').click();
    await expect(page.getByTestId('srpa-linha-701')).toHaveAttribute('data-estado', 'atrasada');
    await semViolacaoAxe(page, '/bloco/srpa (quadro)');
    // As avaliações a cada 15 minutos e a alta pela regra v1.
    await page.getByTestId('srpa-abrir-701').click();
    for (const n of [-20, -6]) {
      await escolher(page.getByTestId('srpa-momento'), 'avaliacao');
      await page.getByTestId('srpa-em').fill(instanteDaqui(n, base));
      await page.getByTestId('srpa-registrar').click();
      await expect(page.getByTestId('srpa-mensagem')).toContainText('Avaliação registrada');
    }
    await escolher(page.getByTestId('srpa-momento'), 'alta');
    await page.getByTestId('srpa-em').fill(instanteDaqui(0));
    await expect(page.getByTestId('srpa-pode-alta')).toBeVisible();
    await page.getByTestId('srpa-registrar').click();
    await expect(page.getByTestId('srpa-mensagem')).toContainText('Alta da recuperação registrada');
    await expect(page.getByTestId('srpa-alta')).toContainText('Unidade de internação');
    await page.getByTestId('srpa-voltar').click();
    await expect(page.getByTestId('srpa-linha-701')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
