// E2E @C1-102 (F3.4, 04-CC linha 92): a grade de funcionamento da sala cirúrgica pelo caminho da tela
// (`/cirurgia/salas` > Usuários e grade da sala). Quem mantém as tabelas do bloco (SINT.BLOCO: cirurgia.sala.ler e
// .editar) inclui a mesma faixa de segunda a sexta num clique, vê a validação na hora pela regra do domínio (fim antes
// do início, faixa que cruza com outra ativa, reserva sem a especialidade escolhida), edita com a versão e inativa com
// confirmação (a linha fica no histórico). O mapa cirúrgico pinta a grade aberta do dia. Os combos são SanteSelecao
// (nenhum <select> nativo). A grade só existe no banco do cliente (na fonte sintética a API responde 503): as respostas
// são simuladas pelo Playwright com massa SINTÉTICA, no contrato do servidor. O que fica no banco e a trava na agenda
// estão no contrato de efeito (apps/api/src/modulos/cirurgia/porta-propria.int.spec.ts, caso "grade da sala").
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

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

interface Faixa {
  id: number;
  diaSemana: number;
  inicio: string;
  fim: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  valeFeriado: boolean;
  especialidade: number | null;
  profissional: number | null;
  ativo: boolean;
  versao: number;
}

function simular(page: Page) {
  const st = { faixas: [] as Faixa[], corpos: [] as { url: string; corpo: Record<string, unknown> }[] };
  let proximo = 9601;
  void page.route(/\/api\/cirurgia\/salas\/\d+\/grade$/, async (r) => {
    const sala = Number(/salas\/(\d+)\/grade/.exec(r.request().url())?.[1]);
    if (r.request().method() === 'GET') return json(r, { sala, faixas: st.faixas });
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    st.corpos.push({ url: r.request().url(), corpo });
    if (typeof corpo['faixa'] === 'number') {
      const f = st.faixas.find((x) => x.id === corpo['faixa']);
      if (!f || f.versao !== corpo['versao'])
        return json(r, { codigo: 'versao-desatualizada', title: 'Conflito', status: 409 }, 409);
      Object.assign(f, corpo, { id: f.id, versao: f.versao + 1 });
      return json(r, { ok: true, resultado: { faixa: f.id }, repetida: false });
    }
    const nova: Faixa = {
      id: proximo++,
      diaSemana: Number(corpo['diaSemana']),
      inicio: String(corpo['inicio']),
      fim: String(corpo['fim']),
      vigenciaInicio: String(corpo['vigenciaInicio']),
      vigenciaFim: (corpo['vigenciaFim'] as string | null) ?? null,
      valeFeriado: Boolean(corpo['valeFeriado']),
      especialidade: (corpo['especialidade'] as number | null) ?? null,
      profissional: (corpo['profissional'] as number | null) ?? null,
      ativo: true,
      versao: 1,
    };
    st.faixas.push(nova);
    return json(r, { ok: true, resultado: { faixa: nova.id }, repetida: false });
  });
  void page.route(/\/api\/cirurgia\/grade-sala\/\d+\/inativar$/, async (r) => {
    const id = Number(/grade-sala\/(\d+)\/inativar/.exec(r.request().url())?.[1]);
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    st.corpos.push({ url: r.request().url(), corpo });
    const f = st.faixas.find((x) => x.id === id);
    if (!f) return json(r, { codigo: 'faixa-inexistente', title: 'Recusada', status: 409 }, 409);
    f.ativo = false;
    f.versao += 1;
    return json(r, { ok: true, resultado: { faixa: id }, repetida: false });
  });
  void page.route(/\/api\/cirurgia\/grade-sala\/aberta/, async (r) => {
    const u = new URL(r.request().url());
    const inicio = u.searchParams.get('inicio') ?? '';
    return json(r, {
      dias: [
        {
          dia: inicio,
          feriado: false,
          salas: [
            { sala: 1, faixas: [{ inicio: '07:00', fim: '13:00', especialidade: null, profissional: null }] },
          ],
        },
      ],
    });
  });
  return st;
}

test.describe('centro cirúrgico: grade de funcionamento da sala @C1-102 @F34', () => {
  test.setTimeout(180_000);

  test('inclui de segunda a sexta num clique, valida na hora, edita com versão, inativa com confirmação; o mapa pinta a grade; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st = simular(page);
    await entrar(page, 'SINT.BLOCO');
    await page.goto('/cirurgia/salas');
    await page.getByTestId('sala-1').click();
    const grade = page.getByTestId('grade-da-sala');
    await expect(grade).toBeVisible();
    await expect(page.getByTestId('grade-sem-grade')).toBeVisible();
    await esperarSemSelectNativo(grade);
    await semViolacaoAxe(page, 'grade da sala: sem grade');

    // Validação na hora: sem dia, o botão fica travado; fim antes do início, a regra do domínio avisa.
    const gravar = page.getByTestId('grade-gravar');
    await expect(page.getByTestId('grade-pendencia')).toContainText('ao menos um dia');
    await expect(gravar).toBeDisabled();
    await page.getByTestId('grade-dias-uteis').click();
    await expect(gravar).toContainText('Incluir em 5 dia(s)');
    await page.getByTestId('grade-inicio').fill('13:00');
    await page.getByTestId('grade-fim').fill('07:00');
    await expect(page.getByTestId('grade-pendencia')).toContainText(
      'fim da faixa tem de ser depois do início',
    );
    await expect(gravar).toBeDisabled();
    await page.getByTestId('grade-inicio').fill('07:00');
    await page.getByTestId('grade-fim').fill('13:00');
    // Reserva a uma especialidade sem escolher qual: pendência; voltando a livre, libera.
    await escolher(grade.getByTestId('grade-reserva'), { rotulo: 'Reservada a uma especialidade' });
    await expect(page.getByTestId('grade-pendencia')).toContainText('a quem a faixa fica reservada');
    await escolher(grade.getByTestId('grade-reserva'), { rotulo: 'Livre para todos' });
    await expect(page.getByTestId('grade-pendencia')).toHaveCount(0);
    await semViolacaoAxe(page, 'grade da sala: formulário preenchido');
    await gravar.click();
    await expect(page.getByTestId('grade-mensagem')).toContainText('5 faixa(s) gravada(s)');
    expect(
      st.corpos.filter((c) => /\/salas\/1\/grade$/.test(c.url)).map((c) => c.corpo['diaSemana']),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(st.corpos[0]?.corpo).toMatchObject({
      inicio: '07:00',
      fim: '13:00',
      especialidade: null,
      profissional: null,
    });
    await expect(page.getByTestId('grade-tabela').locator('tbody tr')).toHaveCount(5);

    // Faixa que cruza com outra ativa no mesmo dia: a regra do domínio recusa antes de gravar.
    await page.getByTestId('grade-dia-1').check();
    await page.getByTestId('grade-inicio').fill('12:00');
    await page.getByTestId('grade-fim').fill('18:00');
    await expect(page.getByTestId('grade-pendencia')).toContainText('cruza com a de 07:00 às 13:00');
    await expect(gravar).toBeDisabled();

    // Editar a de segunda com a versão: vai a 07:00–12:00.
    const segunda = st.faixas[0]!;
    await page.getByTestId(`grade-editar-${segunda.id}`).click();
    await page.getByTestId('grade-fim').fill('12:00');
    await expect(gravar).toContainText('Salvar alteração');
    await gravar.click();
    await expect(page.getByTestId('grade-mensagem')).toContainText('Faixa gravada');
    expect(st.corpos.at(-1)?.corpo).toMatchObject({
      faixa: segunda.id,
      versao: 1,
      diaSemana: 1,
      fim: '12:00',
    });
    await expect(page.getByTestId(`grade-faixa-${segunda.id}`)).toContainText('07:00–12:00');

    // Inativar com confirmação: a linha some das ativas e fica no histórico.
    const sexta = st.faixas[4]!;
    await page.getByTestId(`grade-inativar-${sexta.id}`).click();
    const confirma = page.getByTestId('confirmacao');
    await expect(confirma).toContainText('A linha fica no histórico');
    await confirma.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('grade-mensagem')).toContainText('Faixa inativada');
    expect(st.corpos.at(-1)).toMatchObject({ corpo: { versao: 1 } });
    expect(st.corpos.at(-1)?.url).toMatch(new RegExp(`/grade-sala/${sexta.id}/inativar$`));
    await expect(page.getByTestId(`grade-faixa-${sexta.id}`)).toHaveCount(0);
    await page.getByTestId('grade-mostrar-inativas').check();
    await expect(page.getByTestId(`grade-faixa-${sexta.id}`)).toContainText('inativa');
    await semViolacaoAxe(page, 'grade da sala: histórico');

    // O mapa pinta a grade aberta do dia na sala.
    await page.goto('/cirurgia/mapa');
    await expect(page.getByTestId('tela-mapa-cirurgico')).toBeVisible();
    await expect(page.locator('[data-testid^="mapa-grade-"]').first()).toContainText('Grade: 07:00–13:00');
    await semViolacaoAxe(page, 'mapa com a grade');
    expect(externas).toEqual([]);
  });
});
