// E2E @C1-101 (02-AGE linha 42, ficha F3.2): a central marca para HOJE duas consultas de quem ainda não tem prontuário
// pelo bloco "sem prontuário" da tela de marcação (o mínimo da pessoa; horário, convênio e canal são os de cima); o
// painel do dia mostra o selo "Sem prontuário" e converte o primeiro pré-cadastro ali mesmo, ligando ao paciente
// escolhido na busca (mesmo nome e nascimento); no guichê, a chegada lista os marcados de hoje sem prontuário, a
// recepção converte o segundo escolhendo o paciente na busca (divergência só com motivo) e a marcação passa à lista de
// agendados para ligar a senha; axe sem violação séria.
// Sessão real sobre a fonte sintética de dev, sem nenhuma rota simulada: a agenda, o cadastro e a recepção em MEMÓRIA
// (agendas, horários, pacientes e pré-cadastros SINTÉTICOS). A conversão em memória (cadastro/pre-cadastro-memoria.ts)
// usa a mesma regra do domínio (decidirConversao) e liga a marcação ao paciente; a recepção em memória lista as
// marcações de hoje que já têm paciente. O fecho é a leitura real do dia: as duas marcações com paciente e sem
// pré-cadastro a converter. O efeito no banco próprio está nos contratos de efeito
// apps/api/src/modulos/recepcao/chegada-pre-cadastro.int.spec.ts e
// apps/api/src/modulos/cadastro/paciente-vinculos-proprio.int.spec.ts.
// Permissões: as dos perfis sintéticos, sem nada injetado na sessão. SINT.AGENDA converte no painel do dia com o
// cadastro de pacientes da recepção externa (cadastro.paciente.criar); SINT.SENHAS lista os marcados de hoje pela
// consulta da agenda (agenda.marcacao.ler) e converte com a mesma permissão do cadastro.
// Hoje precisa ser dia útil com vaga ainda por vir na grade sintética da agenda 901 (8h às 12h): fora disso o teste
// é pulado com o motivo.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FERIADOS = ['01-01', '04-21', '09-07', '11-02', '11-15', '12-25'];
const PACIENTE = 1003;

/** Hoje (relógio de São Paulo), se for dia útil antes das 11h30 (ainda há vaga na grade sintética da 901). */
function hojeComVaga(): string | null {
  const agora = new Date();
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
  const hora = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(agora);
  const sem = new Date(`${hoje}T12:00:00Z`).getUTCDay();
  if (sem === 0 || sem === 6 || FERIADOS.includes(hoje.slice(5)) || hora >= '11:30') return null;
  return hoje;
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Marca pelo bloco "sem prontuário" a última vaga livre de hoje na agenda 901; devolve o id da marcação. */
async function marcarSemProntuario(
  page: Page,
  dia: string,
  nome: string,
  nascimento: string,
): Promise<number> {
  await page.goto('/agenda/consultas/marcar');
  await expect(page.getByTestId('tela-marcar')).toBeVisible();
  const busca = page.getByRole('region', { name: 'Buscar vagas' });
  await escolher(busca.getByLabel('Agenda'), '901');
  await page.getByTestId('vagas-de').fill(dia);
  await page.getByTestId('vagas-ate').fill(dia);
  await busca.getByRole('button', { name: 'Buscar vagas' }).click();
  await expect(page.getByTestId('tabela-vagas')).toBeVisible();
  await page
    .getByTestId(new RegExp(`^vaga-901-${dia}-\\d{4}$`))
    .last()
    .click();
  await expect(page.getByTestId('vaga-escolhida')).toBeVisible();
  await escolher(page.getByRole('region', { name: 'Marcar consulta' }).getByLabel('Convênio'), '10');
  await expect(page.getByTestId('sem-prontuario')).toBeVisible();
  const botao = page.getByTestId('botao-marcar-sem-prontuario');
  await expect(botao).toBeDisabled();
  await page.getByTestId('sp-nome').locator('input').fill(nome);
  await page.getByTestId('sp-nascimento').fill(nascimento);
  await page.getByTestId('sp-telefone').fill('31999990101');
  await expect(botao).toBeEnabled();
  await semViolacaoAxe(page, 'marcação sem prontuário');
  await botao.click();
  await expect(page).toHaveURL(/\/agenda\/consultas\/marcacoes\/\d+/);
  return Number(/\/marcacoes\/(\d+)/.exec(page.url())?.[1]);
}

interface MarcacaoDoDia {
  id: number;
  idPaciente: number | null;
  preCadastroAConverter?: number | null;
}

test.describe('Marcação sem prontuário e conversão ali mesmo @C1-101 @F3.2', () => {
  test.setTimeout(240_000);
  test('marcar sem prontuário hoje; converter no painel do dia e na chegada; axe', async ({ page }) => {
    const dia = hojeComVaga();
    test.skip(dia === null, 'hoje não é dia útil com vaga por vir na grade sintética (8h às 12h)');
    if (!dia) return;
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.AGENDA');
    const primeira = await marcarSemProntuario(page, dia, 'CINTHYA SINTETICA SEM PRONTUARIO', '1992-07-01');
    const segunda = await marcarSemProntuario(page, dia, 'PESSOA SINTETICA SEM PRONTUARIO', '1991-03-14');

    // Painel do dia: selo "Sem prontuário" e conversão ali mesmo da primeira, ligando ao paciente escolhido na busca.
    await page.goto('/agenda/consultas/dia');
    await page.getByTestId('dia-data').fill(dia);
    const leitura = page.waitForResponse(
      (r) => r.url().includes('/api/agenda/consultas/dia') && r.url().includes(`data=${dia}`) && r.ok(),
    );
    await escolher(page.getByLabel('Agenda'), '901');
    const resposta = await leitura;
    const urlDia = resposta.url();
    const painel = (await resposta.json()) as { marcacoes: MarcacaoDoDia[] };
    await expect(page.getByTestId('tabela-dia')).toBeVisible();
    const pre1 = painel.marcacoes.find((m) => m.id === primeira)?.preCadastroAConverter ?? 0;
    const pre2 = painel.marcacoes.find((m) => m.id === segunda)?.preCadastroAConverter ?? 0;
    expect(pre1).toBeGreaterThan(0);
    expect(pre2).toBeGreaterThan(0);
    await expect(page.getByTestId(`dia-sem-prontuario-${primeira}`)).toContainText('Sem prontuário');
    await page.getByTestId(`dia-converter-${primeira}`).click();
    await expect(page.getByTestId(`converter-pre-${pre1}`)).toBeVisible();
    await expect(page.getByTestId('converter-cadastrar')).toBeVisible();
    await page.getByTestId('converter-termo').fill('cinthya');
    await page.getByTestId('converter-termo').press('Enter');
    await page.getByTestId(`converter-escolher-${PACIENTE}`).click();
    await semViolacaoAxe(page, 'conversão no painel do dia');
    const converter1 = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith(`/api/cadastros/pre-cadastros/${pre1}/converter`),
    );
    await page.getByTestId('converter-ligar').click();
    expect((await converter1).postDataJSON()).toEqual({ paciente: PACIENTE });
    await expect(page.getByTestId('dia-resultado-conversao')).toContainText('convertido');

    // Guichê: os marcados de hoje sem prontuário (só a segunda, a primeira já tem paciente); conversão pela busca,
    // com o motivo da divergência, e a marcação passa à lista de agendados para ligar a senha.
    await entrar(page, 'SINT.SENHAS');
    await page.goto('/recepcao/guiche');
    await expect(page.getByTestId('tela-guiche')).toBeVisible();
    await page.getByTestId('guiche-numero').fill('5');
    await page.getByTestId('guiche-abrir').click();
    await expect(page.getByTestId('guiche-situacao')).toContainText('Guichê 5 aberto');
    await page.getByTestId('guiche-emitir').click();
    await escolher(page.getByTestId('emissao-servico'), '1');
    await page.getByTestId('confirmar-emissao').click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Senha emitida');
    await page
      .getByTestId('tabela-aguardando')
      .getByRole('row')
      .filter({ hasText: 'Balcão' })
      .last()
      .getByRole('button')
      .click();
    await expect(page.getByTestId('senha-atual')).toHaveText(/^BL \d{3}$/);
    await page.getByTestId('evento-checkin').click();

    const chegada = page.getByTestId('chegada-sem-prontuario');
    await expect(chegada).toBeVisible();
    await expect(page.getByTestId(`chegada-converter-${primeira}`)).toHaveCount(0);
    await expect(page.getByTestId(`ligar-consulta-${segunda}`)).toHaveCount(0);
    await page.getByTestId(`chegada-converter-${segunda}`).click();
    await expect(page.getByTestId(`converter-pre-${pre2}`)).toBeVisible();
    await expect(page.getByTestId('converter-cadastrar')).toBeVisible();
    await page.getByTestId('converter-termo').fill('cinthya');
    await page.getByTestId('converter-termo').press('Enter');
    await page.getByTestId(`converter-escolher-${PACIENTE}`).click();
    const ligarEscolhido = page.getByTestId('converter-ligar-escolhido');
    await expect(ligarEscolhido).toBeDisabled();
    await page
      .getByTestId('converter-motivo')
      .fill('Nascimento SINTETICO corrigido na conferência do documento');
    await expect(ligarEscolhido).toBeEnabled();
    await semViolacaoAxe(page, 'conversão na chegada');
    const converter2 = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith(`/api/cadastros/pre-cadastros/${pre2}/converter`),
    );
    await ligarEscolhido.click();
    expect((await converter2).postDataJSON()).toEqual({
      paciente: PACIENTE,
      motivoDivergencia: 'Nascimento SINTETICO corrigido na conferência do documento',
    });
    await expect(page.getByTestId('chegada-sem-prontuario-aviso')).toContainText('convertido');
    // A marcação convertida já tem paciente: aparece entre os agendados, pronta para ligar a senha.
    await expect(page.getByTestId(`ligar-consulta-${segunda}`)).toBeVisible();
    await expect(page.getByTestId(`chegada-converter-${segunda}`)).toHaveCount(0);

    // Leitura real do dia: as duas marcações com o paciente e sem pré-cadastro a converter (pré-cadastros convertidos).
    const lido = await page.request.get(urlDia);
    expect(lido.ok()).toBe(true);
    const fim = ((await lido.json()) as { marcacoes: MarcacaoDoDia[] }).marcacoes;
    for (const id of [primeira, segunda])
      expect(fim.find((m) => m.id === id)).toMatchObject({
        idPaciente: PACIENTE,
        preCadastroAConverter: null,
      });
    expect(externas).toEqual([]);
  });
});
