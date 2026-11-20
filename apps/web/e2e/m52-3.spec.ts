// E2E @M52.3 (ficha do M52, fatia F3; seções 7, 8 e 10 na parte da F3): o administrador liga a escala, o cadastro de
// colaboradores e o dimensionamento → o RH admite a enfermeira com login (UM) e a sem acesso (TRES) → a gestora de escala
// publica a escala do mês seguinte (UM no dia 5, TRES no dia 6) e a do mês atual com o sobreaviso da TRES hoje → a UM
// pede a troca do dia 5 pelo dia 6 → a gestora registra o aceite da TRES (sem acesso) e a outra gestora aprova (regra 8,
// quatro olhos) → "quem está de plantão" no dia 5 às 8 h mostra a TRES → o sobreaviso de hoje é acionado e a chegada registrada (regra 10) → o
// dimensionamento com as parcelas da conta é calculado e registrado (regra 9) → recolher. Axe sem violação séria.
// Sessão real sobre a fonte sintética de dev; gestão de pessoas e escala em MEMÓRIA (nada vai à cópia); CPF SINTÉTICO.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

function dv11(base: string, pesos: readonly number[]): number {
  let s = 0;
  pesos.forEach((p, i) => (s += Number(base[i]) * p));
  const r = s % 11;
  return r < 2 ? 0 : 11 - r;
}
function cpf(base9: string): string {
  const d1 = dv11(base9, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv11(`${base9}${d1}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base9}${d1}${d2}`;
}
const p2 = (x: number) => String(x).padStart(2, '0');
const br = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
/** Agora em Brasília: o dia (dd/mm/aaaa) e a hora (HH:MM). */
function agoraBrasilia(): { dia: string; hora: string; comp: string } {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const v = (t: string) => f.find((x) => x.type === t)?.value ?? '00';
  return {
    dia: `${v('day')}/${v('month')}/${v('year')}`,
    hora: `${v('hour')}:${v('minute')}`,
    comp: `${v('year')}-${v('month')}`,
  };
}

async function liberar(page: Page, recurso: string, evidencia: string, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible();
  await chave(page, recurso, true, motivo);
}
async function chave(page: Page, recurso: string, ligar: boolean, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId(ligar ? 'opcao-ligar' : 'opcao-desligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)');
}
async function abrirLiberacao(page: Page): Promise<void> {
  await entrar(page, 'SINT.ADMIN');
  await page.goto('/administracao/liberacao');
  await expect(page.getByTestId('recurso-pessoas.escala')).toBeVisible({ timeout: 30_000 });
}

async function admitir(page: Page, base9: string, nome: string, cargo: string): Promise<void> {
  await page.goto('/pessoas/colaboradores/admitir');
  await expect(page.getByTestId('tela-admissao')).toBeVisible();
  await page.getByLabel('CPF', { exact: true }).fill(cpf(base9));
  await page.getByTestId('consultar-cpf').click();
  await expect(page.getByTestId('previa-profissional')).toContainText(nome);
  await page.getByTestId('admissao-continuar').click();
  await page.getByLabel('Data de admissão').fill(br(new Date()));
  await page.getByLabel('Data de admissão').press('Tab');
  await page.getByLabel('Cargo', { exact: true }).fill(cargo);
  await page.getByLabel('Carga semanal (horas)').fill('36');
  await escolher(page.getByTestId('admissao-centro-custo'), { rotulo: /Enfermagem da clínica médica/ });
  await page.getByTestId('admissao-revisar').click();
  await page.getByTestId('admissao-gravar').click();
  await expect(page.getByTestId('admissao-concluida')).toBeVisible();
}

async function novaEscala(page: Page, competencia: string, setor: string): Promise<void> {
  await page.goto('/pessoas/escala');
  const fe = page.getByTestId('form-nova-escala');
  await expect(fe).toBeVisible({ timeout: 30_000 });
  await escolher(fe.getByTestId('nova-unidade'), { rotulo: 'Unidade sintética' });
  await fe.getByLabel('Setor (opcional)').fill(setor);
  await fe.getByLabel('Competência (AAAA-MM)').fill(competencia);
  await page.getByTestId('criar-escala').click();
  await expect(page.getByTestId('tela-grade-escala')).toBeVisible({ timeout: 30_000 });
}
async function incluir(
  page: Page,
  quem: string,
  dia: string,
  extra?: (fi: ReturnType<Page['getByTestId']>) => Promise<void>,
) {
  const fi = page.getByTestId('form-incluir-plantao');
  await fi.getByLabel('Buscar colaborador (nome ou matrícula)').fill(quem);
  await fi.getByRole('button', { name: 'Buscar' }).click();
  await escolher(fi.getByTestId('incluir-colaborador'), { indice: 0 });
  await fi.getByLabel('Dia do início').fill(dia);
  await fi.getByLabel('Dia do início').press('Tab');
  if (extra) await extra(fi);
  await page.getByTestId('incluir-plantao').click();
  await expect(page.getByTestId('escala-resultado')).toContainText('Plantão incluído.');
}
async function publicar(page: Page): Promise<void> {
  await page.getByTestId('publicar-escala').click();
  await expect(page.getByTestId('escala-resultado')).toContainText('Escala publicada.');
}

test.describe('gestão de pessoas, fatia F3: troca de plantão, plantão agora, sobreaviso e dimensionamento @M52.3', () => {
  test.setTimeout(480_000);

  test('ligar → admitir → escalas publicadas → pedir troca → aceite registrado → aprovar → plantão agora → acionar sobreaviso → dimensionamento → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = new Date();
    const prox = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
    const comp = `${prox.getFullYear()}-${p2(prox.getMonth() + 1)}`;
    const dia = (d: number) => `${p2(d)}/${p2(prox.getMonth() + 1)}/${prox.getFullYear()}`;
    const marca = Date.now().toString(36);
    const ag = agoraBrasilia();

    // O administrador liga a escala, o cadastro de colaboradores e o dimensionamento (com as conferências).
    await abrirLiberacao(page);
    await liberar(
      page,
      'pessoas.escala',
      'Conferência sintética da coordenação (E2E M52.3)',
      'Escala do E2E M52.3',
    );
    await liberar(
      page,
      'pessoas.colaborador',
      'Conferência sintética do RH (E2E M52.3)',
      'Colaboradoras do E2E M52.3',
    );
    await liberar(
      page,
      'pessoas.dimensionamento',
      'Conferência sintética do dimensionamento (E2E M52.3)',
      'Dimensionamento do E2E M52.3',
    );

    // O RH admite a enfermeira com login (UM) e a sem acesso (TRES).
    await entrar(page, 'SINT.RH');
    await admitir(page, '900520001', 'ENFERMEIRA SINTETICA UM', 'Enfermeira assistencial');
    await admitir(page, '900520004', 'ENFERMEIRA SINTETICA TRES', 'Enfermeira plantonista');

    // A gestora publica a escala do mês seguinte (UM no dia 5, TRES no dia 6) e a do mês atual com o sobreaviso de hoje.
    await entrar(page, 'SINT.ESCALA');
    await novaEscala(page, comp, `Posto troca ${marca}`);
    await incluir(page, 'UM', dia(5));
    await incluir(page, 'TRES', dia(6));
    await publicar(page);
    await novaEscala(page, ag.comp, `Posto sobreaviso ${marca}`);
    await incluir(page, 'TRES', ag.dia, async (fi) => {
      await escolher(fi.getByTestId('incluir-hora'), { rotulo: '00:00' });
      await escolher(fi.getByTestId('incluir-duracao'), { rotulo: '24 h' });
      await escolher(fi.getByTestId('incluir-tipo'), { rotulo: 'Sobreaviso' });
      await fi.getByLabel('Tempo de chegada do sobreaviso (minutos)').fill('30');
    });
    await publicar(page);

    // A UM pede a troca do dia 5 pelo dia 6 da TRES (só vê o próprio plantão; não aprova).
    await entrar(page, 'SINT.COLAB');
    await page.goto('/pessoas/escala/trocas');
    await expect(page.getByRole('heading', { level: 1, name: 'Trocas de plantão' })).toBeVisible();
    const fp = page.getByTestId('form-pedir-troca');
    await expect(fp).toBeVisible({ timeout: 30_000 });
    await escolher(fp.getByTestId('troca-escala'), { rotulo: new RegExp(`${comp}.*Posto troca ${marca}`) });
    await escolher(fp.getByTestId('troca-plantao'), { rotulo: /ENFERMEIRA SINTETICA UM/ });
    await escolher(fp.getByTestId('troca-colega'), { rotulo: 'ENFERMEIRA SINTETICA TRES' });
    await escolher(fp.getByTestId('troca-plantao-colega'), { rotulo: /ENFERMEIRA SINTETICA TRES/ });
    await fp.getByLabel('Motivo do pedido').fill('Compromisso familiar no dia (E2E)');
    await semViolacaoAxe(page, '/pessoas/escala/trocas (pedido)');
    await page.getByTestId('pedir-troca').click();
    await expect(page.getByTestId('trocas-resultado')).toContainText('enviado a ENFERMEIRA SINTETICA TRES');
    await expect(page.getByTestId('tabela-trocas')).toContainText('Aguardando o aceite do colega');
    await expect(page.locator('[data-testid^="decidir-troca-"]')).toHaveCount(0);

    // A gestora registra o aceite da TRES (sem acesso); a outra gestora aprova; a escala muda (regra 8).
    await entrar(page, 'SINT.ESCALA');
    await page.goto('/pessoas/escala/trocas');
    await page.locator('[data-testid^="registrar-resposta-"]').first().click();
    const dlg = page.getByTestId('dialogo-troca');
    await dlg
      .getByLabel('Como o colega confirmou (telefone, pessoalmente…)')
      .fill('Confirmou por telefone (E2E)');
    await semViolacaoAxe(page, 'diálogo da troca');
    await page.getByTestId('confirmar-acao-troca').click();
    await expect(page.getByTestId('trocas-resultado')).toContainText('Troca aceita');
    await expect(page.getByTestId('dialogo-troca')).toHaveCount(0);
    // Quatro olhos: quem registrou o aceite não aprova; a outra pessoa da coordenação aprova.
    await expect(page.locator('[data-testid^="decidir-troca-"]')).toHaveCount(0);
    await entrar(page, 'SINT.ESCALA.APROVA');
    await page.goto('/pessoas/escala/trocas');
    await page.locator('[data-testid^="decidir-troca-"]').first().click();
    await page.getByTestId('confirmar-aprovacao').click();
    await expect(page.getByTestId('trocas-resultado')).toContainText('Troca aprovada');
    await expect(page.getByTestId('tabela-trocas')).toContainText('Aprovada pela coordenação');

    // Quem está de plantão no dia 5 às 8 h: a TRES, depois da troca.
    await page.goto('/pessoas/plantao-agora');
    await expect(page.getByRole('heading', { level: 1, name: 'Quem está de plantão agora' })).toBeVisible();
    await page.getByLabel('Dia', { exact: true }).fill(dia(5));
    await page.getByLabel('Dia', { exact: true }).press('Tab');
    await page.getByLabel('Hora', { exact: true }).fill('08:00');
    await page.getByLabel('Hora', { exact: true }).press('Tab');
    await page.getByTestId('consultar-plantao').click();
    await expect(page.getByTestId('tabela-plantao-agora')).toContainText('ENFERMEIRA SINTETICA TRES');
    await expect(page.getByTestId('tabela-plantao-agora')).not.toContainText('ENFERMEIRA SINTETICA UM');
    await semViolacaoAxe(page, '/pessoas/plantao-agora (instante)');

    // Agora: o sobreaviso da TRES com 30 min para chegar; acionar e registrar a chegada (regra 10).
    await page.getByTestId('agora').click();
    const linha = page
      .getByTestId('tabela-plantao-agora')
      .getByRole('row', { name: /ENFERMEIRA SINTETICA TRES/ });
    await expect(linha).toContainText('chega em até 30 min');
    await linha.getByRole('button', { name: 'Acionar' }).click();
    await page
      .getByTestId('dialogo-sobreaviso')
      .getByLabel('Motivo do acionamento')
      .fill('Paciente grave na emergência (E2E)');
    await semViolacaoAxe(page, 'diálogo do sobreaviso');
    await page.getByTestId('confirmar-sobreaviso').click();
    await expect(page.getByTestId('agora-resultado')).toContainText('chegada prevista até');
    await expect(page.getByTestId('dialogo-sobreaviso')).toHaveCount(0);
    await expect(linha).toContainText('Acionado às');
    await linha.getByRole('button', { name: 'Registrar chegada' }).click();
    const agoraChegada = agoraBrasilia().hora;
    await page.getByTestId('dialogo-sobreaviso').getByLabel('Hora da chegada').fill(agoraChegada);
    await page.getByTestId('dialogo-sobreaviso').getByLabel('Hora da chegada').press('Tab');
    await page.getByTestId('confirmar-sobreaviso').click();
    await expect(page.getByTestId('agora-resultado')).toContainText('Chegada registrada.');
    await expect(linha).toContainText('Chegou às');

    // Dimensionamento: 10 mínimos, 8 intermediários e 2 de alta dependência, 36 h, IST 15% → 25 profissionais, 9
    // enfermeiros e a cobertura de 5; registrado com as parcelas (regra 9).
    await page.goto('/pessoas/dimensionamento');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Dimensionamento de enfermagem' }),
    ).toBeVisible();
    const fd = page.getByTestId('form-dimensionamento');
    await expect(fd).toBeVisible({ timeout: 30_000 });
    await escolher(fd.getByTestId('dim-unidade'), { rotulo: 'Unidade sintética' });
    await fd.getByLabel('Cuidados mínimos (4 h)').fill('10');
    await fd.getByLabel('Cuidados intermediários (6 h)').fill('8');
    await fd.getByLabel('Alta dependência (10 h)').fill('2');
    await semViolacaoAxe(page, '/pessoas/dimensionamento (formulário)');
    await page.getByTestId('calcular-dimensionamento').click();
    await expect(page.getByTestId('dim-total')).toHaveText('25');
    await expect(page.getByTestId('dim-cobertura')).toHaveText('5');
    await expect(page.getByTestId('dim-parcelas')).toContainText(
      'THE (total de horas de enfermagem em 24 h) = 40 + 48 + 20 = 108 h',
    );
    await semViolacaoAxe(page, '/pessoas/dimensionamento (resultado)');
    await page.getByTestId('registrar-dimensionamento').click();
    await expect(page.getByTestId('dim-registrado')).toContainText('Dimensionamento registrado');
    await expect(page.getByTestId('tabela-dimensionamentos')).toContainText('25 (9 + 16)');

    // Recolher: desligar as chaves (as telas voltam à consulta; os dados ficam).
    await abrirLiberacao(page);
    await chave(page, 'pessoas.dimensionamento', false, 'Recolher o E2E M52.3');
    await chave(page, 'pessoas.escala', false, 'Recolher o E2E M52.3');
    await chave(page, 'pessoas.colaborador', false, 'Recolher o E2E M52.3');
    expect(externas).toEqual([]);
  });
});
