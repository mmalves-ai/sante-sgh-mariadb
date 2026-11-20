// E2E @W0-06 (programa CRUD completo; parte 5d-3-3: avaliação de desempenho, M2 de mercado; aceite 8): liga o cadastro
// de colaboradores e os treinamentos → o RH admite um colaborador CLT com admissão há 40 dias (o marco de 45 dias do
// contrato de experiência vence em 4 dias) → inclui o cargo com o CBO e um curso → liga o cargo do quadro na ficha do
// colaborador, com motivo → na avaliação de desempenho, inclui duas competências e as liga ao cargo → inclui o ciclo de
// experiência (escala de 1 a 5) → o alerta do marco de 45 dias aparece e abre a avaliação em rascunho com as
// competências do cargo → notas e parecer, finalizar, ciência colhida em papel e registrada pelo RH (com o motivo) →
// correção por versão nova com a justificativa (a versão 1 continua visível, substituída) → nova nota, finalizar →
// o alerta do marco some → "Minhas avaliações" do RH não mostra a avaliação de outro (ciência própria só do avaliado)
// → na ficha do colaborador, as avaliações e o PDI ligado à competência, ao curso e à avaliação: incluir, alterar com
// motivo (histórico com o valor anterior), concluir com a data → recolher. Axe sem violação séria nas telas e nos
// diálogos. Sessão real sobre a fonte sintética; gestão de pessoas, cargos, avaliação e treinamentos em MEMÓRIA (nada vai
// à cópia); CPF SINTÉTICO.
import { expect, type Locator, type Page, test } from '@playwright/test';
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
const dias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const entrada = (l: Locator) => l.locator('input, textarea').first();
async function preencher(l: Locator, valor: string): Promise<void> {
  const e = entrada(l);
  await e.fill(valor);
  await e.press('Tab');
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
async function ligar(page: Page, recurso: string, evidencia: string): Promise<void> {
  if ((await page.getByTestId(`recurso-${recurso}`).innerText()).includes('Ligada')) return;
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible();
  await chave(page, recurso, true, evidencia);
}
async function abrirLiberacao(page: Page): Promise<void> {
  await entrar(page, 'SINT.ADMIN');
  await page.goto('/administracao/liberacao');
  await expect(page.getByTestId('recurso-pessoas.colaborador')).toBeVisible({ timeout: 30_000 });
}

/** O diálogo do motivo: confirmar fica desabilitado com menos de 10 caracteres; a variante destrutiva pergunta. */
async function confirmarComMotivo(
  page: Page,
  testid: string,
  motivo: string,
  destrutivo = false,
): Promise<void> {
  const d = page.getByTestId(testid);
  await expect(d).toBeVisible();
  await d.getByLabel('Motivo').fill('curto');
  await expect(page.getByTestId(`${testid}-confirmar`)).toBeDisabled();
  await d.getByLabel('Motivo').fill(motivo);
  await semViolacaoAxe(page, `diálogo ${testid}`);
  await page.getByTestId(`${testid}-confirmar`).click();
  if (destrutivo) await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
}

async function novaCompetencia(page: Page, nome: string, descricao: string, cargo: RegExp): Promise<void> {
  await page.getByTestId('nova-competencia').click();
  const f = page.getByTestId('form-competencia');
  await preencher(f.getByTestId('competencia-nome'), nome);
  await preencher(f.getByTestId('competencia-descricao'), descricao);
  await page.getByTestId('gravar-competencia').click();
  await expect(page.getByTestId('competencia-cargos')).toBeVisible();
  await escolher(page.getByTestId('competencia-ligar-cargo'), { rotulo: cargo });
  await page.getByTestId('ligar-cargo').click();
  await expect(page.getByTestId('competencia-cargos').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('tabela-competencias')).toContainText(nome);
}

/** Dá nota a cada competência da ficha (na ordem), grava e finaliza. */
async function notasEFinalizar(page: Page, notas: readonly string[], parecer: string): Promise<void> {
  const fa = page.getByTestId('ficha-avaliacao');
  const campos = fa.locator('[data-testid^="nota-"][data-testid$="-valor"]');
  await expect(campos).toHaveCount(notas.length);
  for (const [i, n] of notas.entries()) await escolher(campos.nth(i), n);
  await preencher(fa.getByTestId('avaliacao-parecer'), parecer);
  await page.getByTestId('gravar-notas').click();
  await expect(page.getByTestId('avaliacao-resultado')).toBeVisible();
  await expect(page.getByTestId('finalizar-avaliacao')).toBeEnabled();
  await page.getByTestId('finalizar-avaliacao').click();
  await expect(page.getByTestId('dialogo-finalizar')).toBeVisible();
  await semViolacaoAxe(page, 'diálogo da finalização');
  await page.getByTestId('dialogo-finalizar-confirmar').click();
  await expect(page.getByTestId('avaliacao-situacao')).toContainText('Finalizada');
}

test.describe('W0-06 (parte 5d-3-3): avaliação de desempenho com ciência, alerta de experiência e PDI @W0-06', () => {
  test.setTimeout(480_000);

  test('ligar → admitir → cargo, curso, competências → ciclo de experiência → alerta abre a avaliação → finalizar, ciência, correção por versão → PDI na ficha → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const agora = new Date();
    const admissao = dias(agora, -40);
    const sufixo = Date.now().toString(36).slice(-5).toUpperCase();
    const nome = `TECNICA W006 AVAL ${sufixo}`;
    const cargo = `Técnico de enfermagem W006 ${sufixo}`;
    const comp1 = `Segurança do paciente ${sufixo}`;
    const comp2 = `Comunicação com a equipe ${sufixo}`;
    const ciclo = `Experiência W006 ${sufixo}`;
    const CURSO = `W6A-${sufixo}`;
    const tituloCurso = `Curso sintético da avaliação ${sufixo}`;
    const fim2 = String(Date.now() % 100).padStart(2, '0');

    await abrirLiberacao(page);
    await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E W0-06 avaliação)');
    await ligar(
      page,
      'pessoas.treinamento',
      'Conferência sintética da educação permanente (E2E W0-06 avaliação)',
    );

    // O colaborador CLT em experiência (admitido há 40 dias).
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores/admitir');
    await expect(page.getByTestId('tela-admissao')).toBeVisible();
    await page.getByLabel('CPF', { exact: true }).fill(cpf(`9006068${fim2}`));
    await page.getByTestId('consultar-cpf').click();
    await page.getByTestId('admissao-continuar').click();
    await page.getByLabel('Nome completo').fill(nome);
    await page.getByLabel('Data de admissão').fill(br(admissao));
    await page.getByLabel('Data de admissão').press('Tab');
    await page.getByLabel('Cargo', { exact: true }).fill('Técnico de enfermagem');
    await page.getByLabel('Carga semanal (horas)').fill('36');
    await escolher(page.getByTestId('admissao-centro-custo'), { indice: 0 });
    await page.getByLabel('Matrícula').fill(`W6A-${sufixo}`);
    await page.getByTestId('admissao-revisar').click();
    await page.getByTestId('admissao-gravar').click();
    await expect(page.getByTestId('admissao-concluida')).toBeVisible();
    await page.getByTestId('abrir-ficha-admitido').click();
    await expect(page.getByTestId('tela-ficha-colaborador')).toBeVisible();
    const urlFicha = page.url();

    // O cargo do quadro (CBO pela busca) e o curso que o PDI vai indicar.
    await page.goto('/pessoas/cargos');
    await expect(page.getByTestId('tela-cargos')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('novo-cargo').click();
    const fcg = page.getByTestId('form-cargo');
    await fcg.getByLabel('Nome do cargo').fill(cargo);
    await fcg.getByLabel('Buscar a ocupação (código ou nome)').fill('322205');
    await page.getByTestId('cargo-cbo-buscar').click();
    await escolher(fcg.getByTestId('cargo-cbo'), { rotulo: /322205/ });
    await page.getByTestId('gravar-cargo').click();
    await expect(page.getByTestId('tabela-cargos')).toContainText(cargo);

    await page.goto('/pessoas/treinamentos');
    await page.getByTestId('treino-aba-cursos').click();
    await page.getByTestId('novo-curso').click();
    const fc = page.getByTestId('form-curso');
    await preencher(fc.getByTestId('curso-codigo'), CURSO);
    await preencher(fc.getByTestId('curso-titulo'), tituloCurso);
    await preencher(fc.getByTestId('curso-carga'), '8');
    await preencher(fc.getByTestId('curso-validade'), '12');
    await preencher(
      fc.getByTestId('curso-conteudo'),
      'Conteúdo sintético do E2E da avaliação de desempenho.',
    );
    await fc.getByTestId('curso-gravar').click();
    await expect(page.getByTestId(`curso-${CURSO}`)).toBeVisible({ timeout: 30_000 });

    // O cargo do quadro na ficha do colaborador, com motivo.
    await page.goto(urlFicha);
    await expect(page.getByTestId('tela-ficha-colaborador')).toBeVisible();
    await page.getByTestId('abrir-cargo-quadro').click();
    const fq = page.getByTestId('form-cargo-quadro');
    await escolher(fq.getByTestId('cargo-quadro-cargo'), { rotulo: new RegExp(cargo) });
    await preencher(fq.getByTestId('cargo-quadro-motivo'), 'Enquadramento no plano de cargos (E2E W0-06)');
    await page.getByTestId('cargo-quadro-gravar').click();
    await expect(page.getByTestId('ficha-cargo-quadro')).toContainText(cargo);

    // As competências do cargo (o modelo é do estabelecimento: a tela nasce vazia).
    await page.goto('/pessoas/avaliacoes');
    await expect(page.getByTestId('tela-avaliacao')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/pessoas/avaliacoes');
    await page.getByTestId('avaliacao-aba-competencias').click();
    const reCargo = new RegExp(cargo);
    await novaCompetencia(page, comp1, 'Identificação do paciente e checagem antes do procedimento', reCargo);
    await novaCompetencia(page, comp2, 'Passagem de plantão clara e completa', reCargo);
    await semViolacaoAxe(page, '/pessoas/avaliacoes (competências)');

    // O ciclo do período de experiência, escala de 1 a 5.
    await page.getByTestId('avaliacao-aba-ciclos').click();
    await page.getByTestId('novo-ciclo').click();
    const fci = page.getByTestId('form-ciclo');
    await preencher(fci.getByTestId('ciclo-nome'), ciclo);
    await escolher(fci.getByTestId('ciclo-tipo'), 'experiencia');
    await preencher(fci.getByTestId('ciclo-inicio'), br(admissao));
    await preencher(fci.getByTestId('ciclo-fim'), br(dias(admissao, 89)));
    await preencher(fci.getByTestId('ciclo-prazo'), br(dias(admissao, 89)));
    await preencher(fci.getByTestId('ciclo-nota-max'), '5');
    await page.getByTestId('gravar-ciclo').click();
    await expect(page.getByTestId('tabela-ciclos')).toContainText(ciclo);
    await expect(page.getByTestId('ciclo-avaliacoes')).toBeVisible();

    // O alerta do marco de 45 dias abre a avaliação daquele marco.
    await page.getByTestId('avaliacao-aba-alertas').click();
    const alerta = page.getByTestId('tabela-alertas').locator('tr', { hasText: nome });
    await expect(alerta).toHaveCount(1);
    await expect(alerta).toContainText('45');
    await expect(alerta).toContainText('Faltam');
    await semViolacaoAxe(page, '/pessoas/avaliacoes (alertas de experiência)');
    await alerta.locator('[data-testid^="avaliar-"][data-testid$="-45"]').click();
    const da = page.getByTestId('dialogo-abrir-avaliacao');
    await expect(da).toBeVisible();
    await expect(da.getByTestId('abrir-colaborador')).toContainText(nome);
    await escolher(da.getByTestId('abrir-ciclo'), { rotulo: new RegExp(ciclo) });
    await semViolacaoAxe(page, 'diálogo da abertura da avaliação');
    await page.getByTestId('abrir-avaliacao-confirmar').click();
    const fa = page.getByTestId('ficha-avaliacao');
    await expect(fa).toBeVisible();
    await expect(page.getByTestId('avaliacao-situacao')).toContainText('Rascunho');
    await expect(fa).toContainText(comp1);
    await expect(fa).toContainText(comp2);

    // Notas até a escala do ciclo, parecer e finalização.
    await notasEFinalizar(page, ['4', '3'], 'Boa adaptação; reforçar a passagem de plantão.');
    await semViolacaoAxe(page, 'ficha da avaliação finalizada');

    // A ciência colhida em papel, registrada pelo RH com como e quando foi colhida.
    await page.getByTestId('registrar-ciencia').click();
    await confirmarComMotivo(
      page,
      'dialogo-ciencia',
      'Ciência colhida em papel na reunião de experiência (E2E)',
    );
    await expect(page.getByTestId('avaliacao-situacao')).toContainText('Ciente');
    await expect(page.getByTestId('avaliacao-ciencia')).toContainText(
      'colhida em papel e registrada pelo RH',
    );

    // Correção por versão nova: a versão 1 fica guardada e visível, substituída.
    await page.getByTestId('corrigir-avaliacao').click();
    await confirmarComMotivo(
      page,
      'dialogo-corrigir-avaliacao',
      'Nota de comunicação lançada trocada pelo avaliador (E2E)',
    );
    await expect(fa.getByRole('heading', { level: 2 })).toContainText('versão 2');
    await expect(page.getByTestId('avaliacao-situacao')).toContainText('Rascunho');
    await expect(page.getByTestId('avaliacao-motivo-correcao')).toContainText(
      'Nota de comunicação lançada trocada pelo avaliador',
    );
    await expect(page.getByTestId('avaliacao-versao-1')).toContainText('Ciente');
    await expect(page.getByTestId('avaliacao-versao-1')).toContainText('substituída pela correção');
    await notasEFinalizar(page, ['4', '4'], 'Boa adaptação; comunicação adequada após a correção.');

    // Feita a avaliação do marco, o alerta some.
    await page.getByTestId('avaliacao-aba-alertas').click();
    await expect(page.getByTestId('aval-alertas')).toBeVisible();
    await expect(page.getByTestId('aval-alertas').locator('tr', { hasText: nome })).toHaveCount(0);

    // A ciência própria é só do avaliado: o RH não vê esta avaliação em "Minhas avaliações".
    await page.goto('/pessoas/avaliacoes/minhas');
    await expect(page.getByTestId('tela-minhas-avaliacoes')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('tela-minhas-avaliacoes')).not.toContainText(ciclo);
    await semViolacaoAxe(page, '/pessoas/avaliacoes/minhas');

    // Na ficha do colaborador: as avaliações (as duas versões) e o PDI ligado à competência, ao curso e à avaliação.
    await page.goto(urlFicha);
    const fd = page.getByTestId('ficha-desempenho');
    await expect(fd).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('desempenho-avaliacoes').locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('pdi-vazio')).toBeVisible();
    await page.getByTestId('pdi-nova').click();
    const fp = page.getByTestId('form-pdi');
    await preencher(fp.getByTestId('pdi-acao'), 'Fazer o curso de comunicação na passagem de plantão');
    await escolher(fp.getByTestId('pdi-competencia'), { rotulo: comp2 });
    await escolher(fp.getByTestId('pdi-curso'), { rotulo: tituloCurso });
    await escolher(fp.getByTestId('pdi-avaliacao'), { indice: 1 });
    await preencher(fp.getByTestId('pdi-prazo'), br(dias(agora, 60)));
    await semViolacaoAxe(page, 'diálogo do PDI');
    await page.getByTestId('pdi-gravar').click();
    const linha = page.getByTestId('tabela-pdi').locator('tbody tr').first();
    await expect(linha).toHaveAttribute('data-situacao', 'aberta');
    await expect(linha).toContainText(tituloCurso);
    await expect(linha).toContainText('curso ainda não concluído');

    // Alterar a ação aberta com motivo: o valor anterior fica no histórico do PDI.
    await linha.locator('[data-testid^="pdi-alterar-"]').click();
    await preencher(fp.getByTestId('pdi-prazo'), br(dias(agora, 90)));
    await preencher(fp.getByTestId('pdi-motivo'), 'curto');
    await expect(page.getByTestId('pdi-gravar')).toBeDisabled();
    await preencher(fp.getByTestId('pdi-motivo'), 'Turma do curso só no mês seguinte (E2E W0-06)');
    await page.getByTestId('pdi-gravar').click();
    const hp = page.getByTestId('pdi-historico');
    await expect(hp).toContainText('Ação do PDI alterada');
    await expect(hp).toContainText('Turma do curso só no mês seguinte (E2E W0-06)');
    await expect(hp).toContainText(br(dias(agora, 60)));

    // Concluir com a data.
    await linha.locator('[data-testid^="pdi-concluir-"]').click();
    const dc = page.getByTestId('dialogo-pdi-situacao');
    await expect(dc).toBeVisible();
    await preencher(dc.getByTestId('pdi-concluida-em'), br(agora));
    await confirmarComMotivo(
      page,
      'dialogo-pdi-situacao',
      'Ação cumprida com acompanhamento do gestor (E2E)',
    );
    await expect(linha).toHaveAttribute('data-situacao', 'concluida');
    await expect(hp).toContainText('Ação do PDI concluída');
    await semViolacaoAxe(page, 'ficha do colaborador com desempenho e PDI');

    // Recolher.
    await abrirLiberacao(page);
    await chave(page, 'pessoas.treinamento', false, 'Recolher o E2E W0-06 avaliação');
    await chave(page, 'pessoas.colaborador', false, 'Recolher o E2E W0-06 avaliação');
    expect(externas).toEqual([]);
  });
});
