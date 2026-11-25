// C1-113 (02-AGE linha 44) @C1-113: marcação de exame para quem ainda não tem prontuário, na própria tela de marcação.
//  1. A central de exames busca a vaga (leitura real da fonte sintética), escolhe o horário, o convênio e o exame.
//  2. No bloco "Marcação sem prontuário", a validação é na hora: nascimento no futuro e telefone curto mostram o
//     motivo e seguram o botão; corrigidos, o botão libera.
//  3. O servidor recusa por paciente de mesmo nome e nascimento (`paciente-possivelmente-cadastrado`, com o candidato):
//     a tela oferece buscar o existente (leva o nome para a busca do paciente) ou confirmar que é outra pessoa.
//  4. Conferido, a nova tentativa vai com `cadastroConferido` e outra chave de idempotência; a marcação gravada leva à
//     ficha da marcação.
// As duas gravações são respostas simuladas pelo Playwright (nada fica na base do E2E: a vaga sintética é usada pelo
// vizinho m18). O que fica no banco (pré-cadastro e marcação na mesma transação, recusa do homônimo, devolução da
// vaga ao cancelar) está no contrato de efeito apps/api/src/modulos/exames/porta-propria.int.spec.ts, caso
// "02-AGE 44". Massa SINTÉTICA, como no vizinho m18.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FERIADOS = ['01-01', '04-21', '09-07', '11-02', '11-15', '12-25'];
const MARCACAO = 9_113_001;
const CANDIDATO = 1003;
const NOME = 'PESSOA SINTETICA SEM PRONTUARIO';

function hojeSp(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/** Próximo dia útil a partir de depois de amanhã (relógio de São Paulo), fora dos feriados fixos (como no m18). */
function diaUtil(): string {
  const d = new Date(`${hojeSp()}T12:00:00Z`);
  for (let i = 2; i < 20; i++) {
    const x = new Date(d.getTime() + i * 86_400_000);
    const iso = x.toISOString().slice(0, 10);
    const sem = x.getUTCDay();
    if (sem !== 0 && sem !== 6 && !FERIADOS.includes(iso.slice(5))) return iso;
  }
  throw new Error('sem dia útil');
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  const campo = page.getByTestId('campo-login');
  await campo.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => page.reload());
  await campo.fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

test.describe('@C1-113 marcação de exame sem prontuário', () => {
  test.describe.configure({ timeout: 180_000 });

  test('validação na hora, recusa do homônimo com as duas saídas e marcação conferida; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const dia = diaUtil();
    await entrar(page, 'SINT.EXAME');

    const pedidos: { corpo: Record<string, unknown>; chave: string | undefined }[] = [];
    await page.route('**/api/agenda/exames/marcacoes/sem-prontuario', (rota) => {
      if (rota.request().method() !== 'POST') return rota.fallback();
      const corpo = rota.request().postDataJSON() as Record<string, unknown>;
      pedidos.push({ corpo, chave: rota.request().headers()['idempotency-key'] });
      if (corpo['cadastroConferido'] !== true)
        return json(
          rota,
          {
            type: 'https://sgh.local/problemas/paciente-possivelmente-cadastrado',
            title: 'Operação recusada',
            status: 409,
            detail: 'Já existe paciente com este nome e nascimento.',
            codigo: 'paciente-possivelmente-cadastrado',
            dependentes: [{ rotulo: 'paciente', total: 1, amostra: [CANDIDATO] }],
          },
          409,
        );
      return json(rota, {
        ok: true,
        resultado: { marcacao: MARCACAO, preCadastro: 9_113_002 },
        repetida: false,
        mensagem: 'Exame marcado com o pré-cadastro.',
      });
    });

    await page.goto('/agenda/exames/marcar');
    await expect(page.getByTestId('tela-marcar-exame')).toBeVisible();

    // 1. Vaga, convênio e exame (os mesmos da marcação com prontuário).
    const busca = page.getByRole('region', { name: 'Buscar vagas' });
    await escolher(busca.getByLabel('Agenda'), '951');
    await page.getByTestId('vagas-exame-de').fill(dia);
    await page.getByTestId('vagas-exame-ate').fill(dia);
    await busca.getByRole('button', { name: 'Buscar vagas' }).click();
    await expect(page.getByTestId('tabela-vagas-exame')).toBeVisible();
    await page.getByTestId(`vaga-exame-951-${dia}-0700`).click();
    await expect(page.getByTestId('vaga-exame-escolhida')).toContainText('07:00');
    const dados = page.getByRole('region', { name: 'Marcar exame' });
    await escolher(dados.getByLabel('Convênio', { exact: true }), '10');
    await escolher(dados.getByLabel('Exame escolhido'), '7001');

    // 2. Validação na hora no bloco sem prontuário.
    const sp = page.getByRole('region', { name: 'Marcação sem prontuário' });
    const botao = page.getByTestId('botao-marcar-exame-sem-prontuario');
    await expect(botao).toBeDisabled();
    await sp.getByLabel('Nome completo').fill(NOME);
    await page.getByTestId('sp-nascimento').fill('2999-01-01');
    await page.getByTestId('sp-telefone').fill('1234');
    await expect(
      sp.getByRole('alert').filter({ hasText: 'A data de nascimento está no futuro.' }),
    ).toBeVisible();
    await expect(sp.getByRole('alert').filter({ hasText: 'Telefone só com dígitos' })).toBeVisible();
    await expect(page.getByTestId('sp-nascimento')).toHaveAttribute('aria-invalid', 'true');
    await expect(botao).toBeDisabled();
    await page.getByTestId('sp-nascimento').fill('1980-05-10');
    await page.getByTestId('sp-telefone').fill('(11) 99999-0000');
    await expect(sp.getByRole('alert')).toHaveCount(0);
    await expect(botao).toBeEnabled();
    await semViolacaoAxe(page, 'marcação sem prontuário preenchida');

    // 3. Recusa do homônimo: buscar o existente ou confirmar outra pessoa.
    await botao.click();
    await expect(page.getByTestId('sp-homonimo')).toContainText(
      'Já existe paciente com este nome e nascimento (1)',
    );
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.corpo).toMatchObject({
      agenda: 951,
      data: dia,
      nome: NOME,
      nascimento: '1980-05-10',
      telefone: '11999990000',
      cadastroConferido: false,
      convenio: 10,
      exame: 7001,
    });
    await semViolacaoAxe(page, 'recusa do homônimo na marcação sem prontuário');
    await page.getByTestId('sp-buscar-existente').click();
    await expect(page.getByTestId('marcar-exame-termo')).toHaveValue(NOME);
    await page.getByTestId('sp-outra-pessoa').check();

    // 4. Nova tentativa conferida, com outra chave; a marcação gravada abre a ficha.
    await botao.click();
    await expect(page).toHaveURL(new RegExp(`/agenda/exames/marcacoes/${MARCACAO}$`));
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]?.corpo).toMatchObject({ nome: NOME, cadastroConferido: true });
    expect(pedidos[1]?.chave).toBeTruthy();
    expect(pedidos[1]?.chave).not.toBe(pedidos[0]?.chave);
    expect(externas).toEqual([]);
  });
});
