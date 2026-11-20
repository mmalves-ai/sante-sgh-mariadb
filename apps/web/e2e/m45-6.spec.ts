// E2E @M45.6 (ficha do M45, seções 7, 10 e 11; etapa 6; DP-32): as especialidades sob demanda e o lactário, construídos
// e desligados (a sessão sintética liga as chaves): pela busca das internações, a oftalmologia com o exame (a
// acuidade pelo cadastro, a pressão alta e o alerta); a oncologia com o protocolo publicado, o ciclo com a dose
// calculada e as parcelas, a prescrição geral ligada ao ciclo e a validação pelo farmacêutico com a dupla checagem (a divergente recusada); a obstetrícia
// com o partograma (a fase ativa, o gráfico e o alerta da linha de ação) e o recém-nascido com as classificações; o
// lactário com a ordem, a conferência por outra pessoa e as etiquetas em ZPL. axe sem violação séria nas telas. Sessão
// real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { type Browser, expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function novaAba(browser: Browser, login: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: ORIGEM, timezoneId: 'America/Sao_Paulo' });
  const p = await ctx.newPage();
  await entrar(p, login);
  return p;
}

/** O instante civil "AAAA-MM-DDTHH:MM" `horas` antes de `agora` (o relógio do estabelecimento, lido da API). */
const antes = (agora: string, horas: number) =>
  new Date(Date.parse(`${agora}:00Z`) - horas * 3_600_000).toISOString().slice(0, 16);
const agoraDe = async (page: Page, url: string, campo: string): Promise<string> =>
  ((await (await page.request.get(url)).json()) as Record<string, string>)[campo]!;

test.describe('Especialidades sob demanda e lactário @M45 @M45.6 @fase5', () => {
  test.setTimeout(300_000);

  test('oftalmologia pela busca e oncologia: protocolo, ciclo com a dose calculada e a validação com a dupla checagem; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ESPECIALISTA');
    await page.goto('/pep/especialidades/oftalmologia');
    await expect(page.getByTestId('tela-especialidade-busca')).toBeVisible();
    await page.getByLabel('Buscar por nome, prontuário ou número da internação').fill('ROSA');
    await page.getByTestId('esp-busca-pesquisar').click();
    await semViolacaoAxe(page, '/pep/especialidades/oftalmologia');
    await page.getByTestId('esp-abrir-950103').click();
    await expect(page.getByTestId('tela-oftalmologia')).toBeVisible();
    await expect(page.getByTestId('esp-cabecalho')).toContainText('ROSA SINTETICA OFTALMO');
    const f = page.getByTestId('form-oftalmo');
    await escolher(f.getByLabel('Acuidade com correção (OD)'), '4');
    await escolher(f.getByLabel('Acuidade sem correção (OE)'), '6');
    await f.getByLabel('Pressão intraocular em mmHg (OD)').fill('25');
    await f.getByLabel('Pressão intraocular em mmHg (OE)').fill('18');
    await escolher(f.getByLabel('Método da tonometria'), 'aplanacao');
    await f.getByTestId('oftalmo-adicionar').click();
    await escolher(f.getByLabel('Exame 1', { exact: true }), { rotulo: 'Gonioscopia' });
    await f.getByLabel('Resultado do exame 1').fill('Ângulo aberto nos quatro quadrantes');
    await semViolacaoAxe(page, '/pep/especialidades/oftalmologia/950103 (exame)');
    await f.getByTestId('oftalmo-gravar').click();
    await expect(page.getByTestId('oftalmo-mensagem')).toContainText('visão sem deficiência');
    await expect(page.getByTestId('oftalmo-alertas')).toContainText('hipertensão ocular');
    await expect(page.locator('[data-testid^="oftalmo-exame-"]').first()).toContainText('20/40 (0,5)');

    // Oncologia: o protocolo publicado pela tela, a versão 1 vigente e íntegra.
    await page.goto('/pep/especialidades/oncologia/protocolos');
    // W0-05 (revisão): a publicação fica na aba "Publicar"; publicada, a tela volta aos oferecidos.
    await page.getByTestId('protocolos-aba-publicar').click();
    const p = page.getByTestId('form-protocolo');
    await p.getByLabel('Código do protocolo').fill('E2E-PC');
    await p.getByLabel('Nome do protocolo').fill('Paclitaxel e carboplatina — SINTÉTICO');
    await escolher(p.getByLabel('Tipo de protocolo'), '3');
    await p.getByLabel('Fármaco 1 (nome genérico)').fill('Paclitaxel');
    await p.getByLabel('Dose do fármaco 1').fill('175');
    await p.getByTestId('protocolo-adicionar-farmaco').click();
    await p.getByLabel('Fármaco 2 (nome genérico)').fill('Carboplatina');
    await p.getByLabel('Dose do fármaco 2').fill('5');
    await escolher(p.getByLabel('Unidade da dose 2'), 'auc');
    await p.getByLabel('Referência', { exact: true }).fill('Protocolo institucional SINTÉTICO');
    await semViolacaoAxe(page, '/pep/especialidades/oncologia/protocolos');
    await p.getByTestId('protocolo-publicar').click();
    await expect(page.getByTestId('protocolo-mensagem')).toContainText('versão 1');
    await expect(page.getByTestId('protocolo-E2E-PC-v1')).toContainText('vigente');

    // O ciclo 1 do paciente da oncologia, com a dose calculada no servidor e as parcelas impressas.
    await page.goto('/pep/especialidades/oncologia/950102');
    // W0-05 (revisão): o ciclo novo fica na aba "Novo ciclo"; registrado, a tela volta à lista dos ciclos.
    await page.getByTestId('onco-aba-novo').click();
    const c = page.getByTestId('form-ciclo');
    await escolher(page.getByTestId('ciclo-protocolo'), { rotulo: /E2E-PC v1/ });
    const amanha = await page.evaluate(() => {
      const d = new Date(Date.now() + 86_400_000);
      const p2 = (n: number) => String(n).padStart(2, '0');
      return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
    });
    const data = c.locator('.sgh-data input').first();
    await data.fill(amanha);
    await data.press('Tab');
    await c.getByLabel('Peso do dia (kg)').fill('70');
    await c.getByLabel('Altura (cm)').fill('170');
    await c.getByLabel(/Creatinina do dia/).fill('1');
    await c.getByTestId('ciclo-gravar').click();
    await expect(page.getByTestId('ciclo-mensagem')).toContainText('superfície 1.82 m²');
    const ciclo = page.locator('[data-testid^="ciclo-"][data-situacao="prescrito"]').first();
    await expect(ciclo).toContainText('175,0 mg/m² × 1,82 m² = 318,5 mg');
    await expect(ciclo).toContainText('AUC 5,0 × (TFG');
    await semViolacaoAxe(page, '/pep/especialidades/oncologia/950102');
    // O médico liga a prescrição geral da internação que vale no dia previsto (a suspensa não se liga).
    await expect(ciclo).toContainText('Nenhuma prescrição dos medicamentos ligada');
    await ciclo.getByRole('button', { name: 'Ligar a prescrição dos medicamentos' }).click();
    await expect(ciclo.locator('li', { hasText: 'Prescrição 990202' })).toContainText('suspensa');
    await semViolacaoAxe(page, '/pep/especialidades/oncologia/950102 (prescrições do dia)');
    await ciclo.locator('[data-testid$="-990201"]').click();
    await expect(page.getByTestId('ciclo-mensagem')).toContainText('Prescrição 990201 ligada ao ciclo 1');
    await expect(ciclo).toContainText('Prescrições dos medicamentos ligadas: 990201');

    // O farmacêutico valida pela dupla checagem: a dose divergente é recusada com as parcelas; a conferida valida.
    const farma = await novaAba(browser, 'SINT.FARMA.ONCO');
    await farma.goto('/pep/especialidades/oncologia/validacao');
    const item = farma
      .locator('[data-testid^="validar-"]')
      .filter({ hasText: 'CARLOS SINTETICO ONCOLOGIA' })
      .first();
    await expect(item).toBeVisible();
    await expect(item).toContainText('Prescrições dos medicamentos ligadas: 990201');
    await item.getByLabel('Dose de Paclitaxel que você calculou (mg)').fill('318');
    await item.getByLabel('Dose de Carboplatina que você calculou (mg)').fill('700');
    await item.getByRole('button', { name: 'Validar ciclo' }).click();
    await expect(item.getByTestId('recusa-especialidade')).toContainText('difere da do sistema');
    await expect(item.getByTestId('recusa-especialidade')).toContainText('Carboplatina');
    await semViolacaoAxe(farma, '/pep/especialidades/oncologia/validacao');
    const auc = await farma.evaluate(async () => {
      const r = await fetch('/api/especialidades/oncologia/validacao');
      const j = await r.json();
      return j.itens[0].ciclo.doses[1].final as number;
    });
    await item.getByLabel('Dose de Carboplatina que você calculou (mg)').fill(String(auc).replace('.', ','));
    await item.getByRole('button', { name: 'Validar ciclo' }).click();
    await expect(farma.getByTestId('validacao-mensagem')).toContainText('validado com a dupla checagem');
    expect(externas).toEqual([]);
  });

  test('obstetrícia: partograma com a fase ativa, o gráfico e a linha de ação; recém-nascido; lactário com a conferência por outra pessoa e as etiquetas; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ESPECIALISTA');
    await page.goto('/pep/especialidades/obstetricia/950101');
    await expect(page.getByTestId('tela-obstetricia')).toBeVisible();
    const agora = await agoraDe(page, '/api/especialidades/obstetricia/internacoes/950101', 'agora');
    const f = page.getByTestId('form-partograma');
    await f.getByLabel('Data e hora', { exact: true }).fill(antes(agora, 5));
    await f.getByLabel('Dilatação (cm)').fill('4');
    await f.getByLabel('Batimentos cardíacos fetais (bpm)').fill('140');
    await f.getByLabel('Contrações em 10 minutos').fill('3');
    await escolher(f.getByLabel('Bolsa'), 'integra');
    await f.getByTestId('partograma-gravar').click();
    await expect(page.getByTestId('partograma-mensagem')).toContainText('Registro do partograma salvo');
    await expect(page.getByTestId('partograma-fase-ativa')).toContainText('Fase ativa desde');
    await expect(page.getByTestId('partograma-grafico')).toBeVisible();
    await f.getByLabel('Data e hora', { exact: true }).fill(antes(agora, 0));
    await f.getByLabel('Dilatação (cm)').fill('4');
    await f.getByLabel('Batimentos cardíacos fetais (bpm)').fill('100');
    await escolher(f.getByLabel('Bolsa'), 'rota');
    await escolher(f.getByLabel('Líquido amniótico'), 'meconial');
    await f.getByTestId('partograma-gravar').click();
    await expect(page.getByTestId('partograma-alertas')).toContainText('bradicardia fetal');
    await expect(page.getByTestId('partograma-alertas')).toContainText('linha de ação');
    await expect(page.getByTestId('partograma-tabela')).toContainText('Líquido amniótico meconial.');
    await semViolacaoAxe(page, '/pep/especialidades/obstetricia/950101');
    const rn = page.getByTestId('form-rn');
    await rn.getByLabel('Data e hora do nascimento').fill(antes(agora, 0));
    await rn.getByLabel('Peso ao nascer (g)').fill('2300');
    await rn.getByLabel('Apgar do 1º minuto').fill('6');
    await rn.getByLabel('Apgar do 5º minuto').fill('6');
    await rn.getByLabel(/Apgar do 10º minuto/).fill('8');
    await rn.getByLabel('Idade gestacional (semanas)').fill('36');
    await escolher(page.getByTestId('rn-tipo-parto'), '2');
    await rn.getByTestId('rn-gravar').click();
    await expect(page.getByTestId('rn-mensagem')).toContainText('Pré-termo moderado a tardio');
    await expect(page.locator('[data-testid^="rn-"]').filter({ hasText: 'CESÁRIA' }).first()).toContainText(
      'Baixo peso',
    );

    // Lactário: a ordem preparada por uma pessoa, conferida por outra e só então as etiquetas.
    const lact = await novaAba(browser, 'SINT.LACTARIO');
    await lact.goto('/nutricao/lactario');
    await expect(lact.getByTestId('tela-lactario')).toBeVisible();
    const o = lact.getByTestId('form-lactario');
    await escolher(lact.getByTestId('lactario-internacao'), { rotulo: /BEBE SINTETICO LACTARIO/ });
    await o.getByLabel('Fórmula').fill('Fórmula infantil de partida');
    await o.getByLabel('Volume por porção (mL)').fill('90');
    const agoraLact = await agoraDe(lact, '/api/nutricao/lactario', 'lidoEm');
    await o
      .getByLabel(/Horários das porções/)
      .fill(`${antes(agoraLact, -1).slice(11, 16)}, ${antes(agoraLact, -4).slice(11, 16)}`);
    await o.getByLabel('Preparo').fill(antes(agoraLact, 0.2));
    await o.getByLabel('Lote (opcional)').fill('L-77');
    await o.getByTestId('lactario-gravar').click();
    await expect(lact.getByTestId('lactario-mensagem')).toContainText('2 porção(ões) de 90 mL');
    const linha = lact.locator('[data-testid^="ordem-"][data-situacao="preparada"]').first();
    await expect(linha).toContainText('Aguarda a conferência de outra pessoa');
    await semViolacaoAxe(lact, '/nutricao/lactario');
    const lact2 = await novaAba(browser, 'SINT.LACTARIO2');
    await lact2.goto('/nutricao/lactario');
    await lact2.locator('[data-testid^="ordem-conferir-"]').first().click();
    await expect(lact2.getByTestId('lactario-mensagem')).toContainText('Ordem conferida');
    await lact2.locator('[data-testid^="ordem-etiquetas-"]').first().click();
    await expect(lact2.getByTestId('lactario-mensagem')).toContainText('2 etiqueta(s)');
    await expect(lact2.getByTestId('lactario-zpl')).toContainText('BEBE SINTETICO LACTARIO');
    await expect(lact2.getByTestId('lactario-zpl')).toContainText('CONF. SINT.LACTARIO2');
    await semViolacaoAxe(lact2, '/nutricao/lactario (etiquetas)');
    expect(externas).toEqual([]);
  });
});
