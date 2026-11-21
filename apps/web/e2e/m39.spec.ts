// E2E @M39 (ficha, seção 10; regras 1, 2, 3, 5 e 6): a jornada da recepção ambulatorial da onda 1 com o outro sistema
// gravando ao mesmo tempo — cadastro do homônimo com o CNS vazio (outro prontuário, nunca unificado; nada inventado),
// marcação da consulta DESSE paciente com o horário ocupado por outro terminal entre a leitura e a gravação (recusa e
// oferece o próximo), senha emitida no balcão com a primeira da fila chamada pelo outro sistema (o guichê do novo chama
// a seguinte), abertura do atendimento DESSE paciente pela senha, a pulseira (ZPL) na fila da impressora e o
// encerramento (o check-in da própria marcação não entra aqui: ela é de um dia útil futuro e a chegada só vale no dia;
// D-JORNADA-39); a inclusão do solicitante externo (campo 7); o painel de
// TV que perde a conexão e recupera a chamada feita por fora; e o painel de migração com a lista para ligar o setor e
// a disputa do dia (a recusa da jornada contada, com a conta). Sessão real sobre a fonte sintética de dev e as portas
// em MEMÓRIA (nada vai à cópia); o "outro sistema" grava pelos arquivos de E2E (agenda e recepção). axe em cada tela.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const AGENDA_POR_FORA = resolve(import.meta.dirname, '../../../.tmp/e2e-agenda-por-fora.json');
const RECEPCAO_POR_FORA = resolve(import.meta.dirname, '../../../.tmp/e2e-recepcao-por-fora.json');
const FERIADOS = ['01-01', '04-21', '09-07', '11-02', '11-15', '12-25'];

/** Um dia útil daqui a 3 a 20 dias (relógio de São Paulo), fora dos feriados fixos (outro dia que o do M17). */
function diaUtil(): string {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  for (let i = 3; i < 20; i++) {
    const x = new Date(d.getTime() + i * 86_400_000);
    const iso = x.toISOString().slice(0, 10);
    const sem = x.getUTCDay();
    if (sem !== 0 && sem !== 6 && !FERIADOS.includes(iso.slice(5))) return iso;
  }
  throw new Error('sem dia útil');
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

function porFora(arquivo: string, conteudo: unknown): void {
  mkdirSync(dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, JSON.stringify(conteudo));
}

test.describe('Onda 1: recepção ambulatorial com o outro sistema ao lado @M39 @fase4', () => {
  test.setTimeout(240_000);
  test.beforeAll(() => {
    rmSync(AGENDA_POR_FORA, { force: true });
    rmSync(RECEPCAO_POR_FORA, { force: true });
  });
  test.afterAll(() => {
    rmSync(AGENDA_POR_FORA, { force: true });
    rmSync(RECEPCAO_POR_FORA, { force: true });
  });

  test('jornada: homônimo com CNS vazio, o mesmo paciente marcado com o horário ocupado por fora, senha disputada, abertura dele, pulseira e encerramento; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // Regra 6: o cadastro do homônimo é outro prontuário (nunca unificado) e o CNS não informado fica vazio.
    await entrar(page, 'SINT.RECEPCAO');
    await page.goto('/cadastros/pacientes/novo');
    await expect(page.getByTestId('form-paciente')).toBeVisible();
    await page.getByTestId('campo-cpf').fill('529.982.247-25');
    await page.getByLabel('Nome', { exact: true }).fill('JOSE DA SILVA');
    await page.getByLabel('Nascimento (DD/MM/AAAA)').fill('10/05/1980');
    await page.getByLabel('Nascimento (DD/MM/AAAA)').blur();
    await escolher(page.getByTestId('campo-sexo'), 'M');
    await page.getByLabel('Naturalidade', { exact: true }).fill('BELO HORIZONTE');
    await page.getByLabel('UF de naturalidade').fill('MG');
    await page.getByTestId('campo-cep').fill('30130-000');
    await page.getByTestId('campo-cep').blur();
    await expect(page.getByTestId('cep-cidade')).toContainText('BELO HORIZONTE / MG');
    await semViolacaoAxe(page, 'cadastro do homônimo');
    await page.getByTestId('botao-salvar-paciente').click();
    await expect(page).toHaveURL(/\/cadastros\/pacientes\/\d+$/);
    const novo = Number(/\/cadastros\/pacientes\/(\d+)$/.exec(page.url())?.[1]);
    expect(novo).toBeGreaterThan(1001);
    await expect(page.getByText('Paciente cadastrado com o prontuário')).toBeVisible();
    const cns = page.locator('dt', { hasText: /^CNS$/ }).locator('xpath=following-sibling::dd[1]');
    await expect(cns).toHaveText('');
    await page.goto('/cadastros/pacientes');
    await page.getByTestId('termo-paciente').fill('JOSE DA SILVA');
    await page.getByTestId('botao-buscar').click();
    await expect(page.getByTestId('paciente-1001')).toBeVisible();
    await expect(page.getByTestId(`paciente-${novo}`)).toBeVisible();
    await semViolacaoAxe(page, 'busca com o homônimo');

    // Regra 2: a central escolhe 08:00; outro terminal ocupa o horário antes da gravação; o novo recusa e oferece
    // o próximo livre, que grava.
    const dia = diaUtil();
    await entrar(page, 'SINT.AGENDA');
    await page.goto('/agenda/consultas/marcar');
    const busca = page.getByRole('region', { name: 'Buscar vagas' });
    await escolher(busca.getByLabel('Agenda'), '901');
    await page.getByTestId('vagas-de').fill(dia);
    await page.getByTestId('vagas-ate').fill(dia);
    await busca.getByRole('button', { name: 'Buscar vagas' }).click();
    await page.getByTestId(`vaga-901-${dia}-0800`).click();
    // Revisão do M39: a marcação é do paciente que a jornada acabou de cadastrar (o homônimo novo, não o 1001).
    await page.getByTestId('marcar-termo').fill('jose da silva');
    await page.getByTestId('marcar-termo').press('Enter');
    await page.getByTestId(`paciente-${novo}`).click();
    const dados = page.getByRole('region', { name: 'Marcar consulta' });
    await escolher(dados.getByLabel('Convênio'), '10');
    porFora(AGENDA_POR_FORA, { ocupar: [{ id: `m39-${Date.now()}`, agenda: 901, data: dia, hora: '0800' }] });
    await page.getByTestId('botao-marcar').click();
    await expect(page.getByTestId('sugestao-proximo')).toBeVisible();
    await expect(page.getByRole('alert').or(page.getByRole('status')).first()).toBeVisible();
    await semViolacaoAxe(page, 'horário ocupado por outro terminal');
    await page.getByTestId('sugestao-proximo').getByRole('button').click();
    await page.getByTestId('botao-marcar').click();
    await expect(page).toHaveURL(/\/agenda\/consultas\/marcacoes\/\d+/);
    await expect(page.getByTestId('marcacao-estado')).toHaveText('Marcada');
    await expect(page.getByText('JOSE DA SILVA').first()).toBeVisible();
    rmSync(AGENDA_POR_FORA, { force: true });

    // Regra 3: fila única. A fila da recepção mostra as senhas do dia; o outro sistema chama a primeira e ela sai da
    // fila daqui ao vivo (o vigia de 1 s do E2E); no guichê do novo, a senha emitida no balcão é chamada em seguida.
    await entrar(page, 'SINT.SENHAS');
    await page.goto('/inicio/recepcao');
    const fila = page.getByTestId('tabela-wl-senhas').locator('tbody tr');
    await expect(fila.first()).toBeVisible();
    const antes = await fila.count();
    porFora(RECEPCAO_POR_FORA, { chamadas: [{ id: `m39-fila-${Date.now()}`, guiche: 2 }] });
    await expect(fila).toHaveCount(antes - 1, { timeout: 5_000 });
    await semViolacaoAxe(page, 'fila da recepção depois da chamada do outro sistema');
    await page.goto('/recepcao/guiche');
    await expect(page.getByTestId('tela-guiche')).toBeVisible();
    await page.getByTestId('guiche-numero').fill('6');
    await page.getByTestId('guiche-abrir').click();
    await expect(page.getByTestId('guiche-situacao')).toContainText('Guichê 6 aberto');
    await page.getByTestId('guiche-emitir').click();
    await escolher(page.getByTestId('emissao-servico'), '1');
    await page.getByTestId('confirmar-emissao').click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Senha emitida');
    await page
      .getByTestId('tabela-aguardando')
      .getByRole('row')
      .filter({ hasText: 'Balcão' })
      .first()
      .getByRole('button')
      .click();
    await expect(page.getByTestId('senha-atual')).toHaveText(/^BL \d{3}$/);
    await semViolacaoAxe(page, 'guichê com a fila disputada');

    // Regra 5: a abertura grava como o outro sistema; a conta nasce no banco (o novo não cria conta).
    await page.getByTestId('abrir-atendimento-atual').click();
    await expect(page.getByTestId('tela-abrir-atendimento')).toBeVisible();
    await page.getByTestId('abrir-atd-termo').fill('JOSE DA SILVA');
    await page.getByTestId('abrir-atd-buscar').click();
    // O mesmo paciente da jornada (cadastrado e marcado acima).
    await page.getByTestId(`abrir-atd-paciente-${novo}`).click();
    const ficha = page.getByRole('region', { name: 'Dados do atendimento' });
    await escolher(ficha.getByLabel('Tipo', { exact: true }), 'consulta');
    await escolher(ficha.getByLabel('Convênio', { exact: true }), '306');
    await escolher(ficha.getByLabel('Especialidade', { exact: true }), '15');
    await escolher(ficha.getByLabel('Profissional', { exact: true }), '7101');
    await escolher(ficha.getByLabel('Unidade', { exact: true }), '1');
    await escolher(ficha.getByLabel('Centro de custo', { exact: true }), '300600');
    await page.getByTestId('abrir-atd-cid').fill('febre');
    await page.getByTestId('abrir-atd-cid-buscar').click();
    await page.getByTestId('abrir-atd-cid-1').click();
    await page.getByTestId('botao-abrir-atendimento').click();
    await expect(page.getByTestId('tela-impressos')).toBeVisible();
    const reg = Number(/\/recepcao\/atendimento\/(\d+)\//.exec(page.url())?.[1]);
    expect(reg).toBeGreaterThan(0);
    // A etiqueta: a pulseira em ZPL na fila da impressora da estação.
    await page.getByTestId('emitir-pulseira').click();
    await expect(page.getByTestId('impresso-emitido')).toContainText('impressora da estação');
    await semViolacaoAxe(page, 'impressos do atendimento');

    // Alta: o encerramento administrativo pela recepção.
    await entrar(page, 'SINT.ATENDIMENTO');
    await page.goto('/consultorio/fila?local=3');
    await expect(page.getByTestId(`fila-situacao-${reg}`)).toContainText('Aguardando');
    await page.getByTestId(`fila-encerrar-${reg}`).click();
    await expect(page.getByTestId('tela-encerrar')).toBeVisible();
    await page.getByLabel('Encerramento administrativo').check();
    await page.getByTestId('botao-encerrar').click();
    await expect(page.getByTestId('encerrado')).toContainText('Atendimento encerrado');
    await semViolacaoAxe(page, 'encerramento');
    expect(externas).toEqual([]);
  });

  test('solicitante externo: inclusão pela tela do cadastro, a busca acha, o repetido é recusado; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/solicitantes');
    await expect(page.getByTestId('tela-solicitantes')).toBeVisible();
    const inc = page.getByTestId('incluir-solicitante');
    await expect(inc).toBeVisible();
    const numero = String(800_000 + (Date.now() % 100_000));
    await inc.getByLabel('Nome completo').fill('DRA SOLICITANTE ONDA UM');
    await inc.getByLabel('Conselho (sigla, ex.: CRM)').fill('CRM');
    await inc.getByLabel('UF').fill('SP');
    await inc.getByLabel('Número no conselho').fill(numero);
    await semViolacaoAxe(page, 'inclusão do solicitante');
    await page.getByTestId('gravar-solicitante').click();
    await expect(page.getByTestId('solicitante-incluido')).toContainText('DRA SOLICITANTE ONDA UM');
    await page.getByTestId('termo-solicitante').fill('solicitante onda');
    await page.getByTestId('termo-solicitante').press('Enter');
    await expect(page.getByTestId('tabela-solicitantes')).toContainText(`CRM ${numero} SP`);
    // Regra 12 do M11: o mesmo conselho, UF e número não entra duas vezes.
    await inc.getByLabel('Nome completo').fill('OUTRO NOME SINTETICO');
    await inc.getByLabel('Conselho (sigla, ex.: CRM)').fill('CRM');
    await inc.getByLabel('UF').fill('SP');
    await inc.getByLabel('Número no conselho').fill(numero);
    await page.getByTestId('gravar-solicitante').click();
    await expect(inc.getByTestId('recusa-solicitante')).toContainText('já está no cadastro de solicitantes');
    await semViolacaoAxe(page, 'solicitante repetido');
  });

  test('painel de TV: perde a conexão e recupera a chamada feita por fora; a chamada de lá chega em até 2 s', async ({
    page,
    browser,
  }) => {
    await entrar(page, 'SINT.SENHAS');
    await page.goto('/recepcao/senhas/paineis');
    await expect(page.getByTestId('tela-paineis-chamada')).toBeVisible();
    await page.getByTestId('novo-painel').click();
    const dialogo = page.getByRole('dialog', { name: 'Cadastrar aparelho' });
    await dialogo.getByLabel('Nome do aparelho').fill('TV da onda 1');
    // A recepção do ambulatório, escolhida (a lista pode chegar depois de abrir o diálogo).
    await escolher(dialogo.getByLabel('Recepção', { exact: true }), '2');
    await page.getByTestId('gravar-painel').click();
    const texto = (await page.getByTestId('endereco-aparelho').textContent())!.trim();
    await page.getByTestId('fechar-token').click();
    // O guichê aberto na recepção (como no setor: a fila e os painéis acompanham as senhas do dia).
    await page.goto('/recepcao/guiche');
    await expect(page.getByTestId('tela-guiche')).toBeVisible();
    const tv = await (await browser.newContext()).newPage();
    await tv.goto(new URL(texto).pathname + new URL(texto).hash);
    await expect(tv.getByTestId('painel-chamada')).toBeVisible();
    // Uma chamada do outro sistema com a TV no ar: em até 2 s.
    const t0 = Date.now();
    porFora(RECEPCAO_POR_FORA, { chamadas: [{ id: `m39-tv-${Date.now()}`, guiche: 4 }] });
    await expect(tv.getByTestId('painel-destino')).toContainText('4', { timeout: 2_000 });
    console.log(`[M39] chamada do outro sistema no painel em ${Date.now() - t0} ms`);
    // A TV perde a rede; o outro sistema chama de novo; a rede volta e o painel recupera a chamada perdida.
    await tv.context().setOffline(true);
    porFora(RECEPCAO_POR_FORA, { chamadas: [{ id: `m39-tv-fora-${Date.now()}`, guiche: 5 }] });
    await tv.waitForTimeout(2_500);
    await tv.context().setOffline(false);
    await expect(tv.getByTestId('painel-destino')).toContainText('5', { timeout: 15_000 });
    await expect(tv.locator('main')).not.toContainText('SINTETICO');
    await semViolacaoAxe(tv, 'painel de TV depois da reconexão');
    rmSync(RECEPCAO_POR_FORA, { force: true });
  });
});
