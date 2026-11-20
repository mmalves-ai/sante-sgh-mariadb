// E2E @W0-03 (programa CRUD completo; enfermagem): cada correção pela tela, com o motivo no diálogo único:
//   - cancelar a passagem de plantão antes do aceite (a cancelada fica legível com o motivo);
//   - alterar o aparelho (nome e unidade, com o motivo); excluir o cadastrado por engano; a recusa do aparelho com
//     leituras mostra a contagem e oferece retirá-lo do modo beira do leito;
//   - estornar o escore (inativo, tachado, com o motivo; o alerta do NEWS2 reavaliado) e exportar o histórico;
//   - estornar a classificação e o índice de UTI;
//   - suspender ou cancelar a receita do enfermeiro com a senha (a original legível e inativa) e reemiti-la;
//   - retificar e estornar a vacina (o registro original visível; a correção com a situação do envio).
// axe sem violação séria nas telas. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada
// vai à cópia nem sai do servidor).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
// Paciente sintético da UTI só deste spec (os outros usam o 25001 e o 25002).
const P3 = { paciente: 25003, atendimento: 25103, reg: 25203, unidade: 'UTI' };
const CONSULTA = 45_401;

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Chamada à API na sessão do navegador (CSRF do cookie e Idempotency-Key própria), para preparar a massa. */
async function api<T = Record<string, unknown>>(page: Page, url: string, corpo?: unknown): Promise<T> {
  return page.evaluate(
    async ([u, c]) => {
      const csrf =
        document.cookie
          .split(';')
          .map((x) => x.trim())
          .find((x) => x.startsWith('sgh_csrf='))
          ?.slice(9) ?? '';
      const r = await fetch(`/api${u}`, {
        method: c === undefined ? 'GET' : 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-csrf': csrf,
          'idempotency-key': `e2e-w003-${Math.random().toString(36).slice(2)}`,
        },
        ...(c === undefined ? {} : { body: JSON.stringify(c) }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(`${String(r.status)} ${t}`);
      return JSON.parse(t) as never;
    },
    [url, corpo] as const,
  );
}

test.describe('Correções da enfermagem @W0-03 @crud', () => {
  test.setTimeout(300_000);

  test('passagem de plantão cancelada antes do aceite, com o motivo', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto('/enfermagem/plantao');
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    await expect(page.getByTestId(`pl-paciente-${P3.atendimento}`)).toBeVisible();
    await page.getByTestId(`sbar-${P3.atendimento}-situacao`).fill('Estável.');
    await page.getByTestId('pl-recebedor').fill('SINT.ENF.APOIO');
    await page.getByTestId('pl-passar').click();
    await expect(page.getByTestId('pl-mensagem')).toBeVisible();
    const cancelar = page.locator('[data-testid^="pl-cancelar-"]').first();
    await expect(cancelar).toBeVisible();
    const id = (await cancelar.getAttribute('data-testid'))!.replace('pl-cancelar-', '');
    await cancelar.click();
    await expect(page.getByTestId('pl-dialogo-cancelar')).toBeVisible();
    // Motivo curto: o botão não confirma.
    await page.getByTestId('pl-dialogo-cancelar-motivo').fill('curto');
    await expect(page.getByTestId('pl-dialogo-cancelar-confirmar')).toBeDisabled();
    await page.getByTestId('pl-dialogo-cancelar-motivo').fill('Paciente errado na passagem');
    await semViolacaoAxe(page, '/enfermagem/plantao (cancelar)');
    await page.getByTestId('pl-dialogo-cancelar-confirmar').click();
    await expect(page.getByTestId('pl-mensagem')).toContainText('cancelada');
    await expect(page.getByTestId(`passagem-${id}`)).toHaveAttribute('data-situacao', 'cancelada');
    await expect(page.getByTestId(`pl-cancelamento-${id}`)).toContainText('Paciente errado na passagem');
    await expect(page.getByTestId(`pl-cancelar-${id}`)).toHaveCount(0);
    expect(externas).toEqual([]);
  });

  test('aparelho alterado e excluído; o que tem leituras é recusado com a contagem e retirado', async ({
    page,
  }) => {
    await entrar(page, 'SINT.SUPERVISOR.ENF');
    await page.goto('/enfermagem/aparelhos');
    await expect(page.getByTestId('tela-aparelhos')).toBeVisible();
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    await page.locator('#ap-nome').fill('Tablet E2E errado');
    await page.getByRole('button', { name: 'Autorizar o aparelho' }).click();
    await expect(page.getByTestId('ap-identificador')).toBeVisible();
    const linha = page.locator('[data-testid^="ap-linha-"][data-nome="Tablet E2E errado"]');
    await expect(linha).toBeVisible();
    const id = (await linha.getAttribute('data-testid'))!.replace('ap-linha-', '');

    // Alterar: o nome com o motivo.
    await page.getByTestId(`ap-alterar-${id}`).click();
    await expect(page.getByTestId('ap-dialogo-alterar')).toBeVisible();
    await page.getByTestId('ap-novo-nome').fill('Tablet E2E leito 3');
    await page.getByTestId('ap-dialogo-alterar-motivo').fill('Nome digitado errado no cadastro');
    await semViolacaoAxe(page, '/enfermagem/aparelhos (alterar)');
    await page.getByTestId('ap-dialogo-alterar-confirmar').click();
    await expect(page.locator(`[data-testid="ap-linha-${id}"]`)).toHaveAttribute(
      'data-nome',
      'Tablet E2E leito 3',
    );

    // Excluir o cadastrado por engano (sem leituras).
    await page.getByTestId(`ap-excluir-${id}`).click();
    await page.getByTestId('ap-dialogo-excluir-motivo').fill('Cadastrado por engano no teste');
    await page.getByTestId('ap-dialogo-excluir-confirmar').click();
    await expect(page.locator(`[data-testid="ap-linha-${id}"]`)).toHaveCount(0);

    // O aparelho com leituras: a recusa com a contagem e a saída "retirar".
    const posto = page.locator('[data-testid^="ap-linha-"][data-nome="Tablet do posto da UTI"]');
    const idPosto = (await posto.getAttribute('data-testid'))!.replace('ap-linha-', '');
    await page.getByTestId(`ap-excluir-${idPosto}`).click();
    await page.getByTestId('ap-dialogo-excluir-motivo').fill('Aparelho cadastrado em duplicidade');
    await page.getByTestId('ap-dialogo-excluir-confirmar').click();
    const recusa = page.getByTestId('ap-recusa-exclusao');
    await expect(recusa).toContainText('3 leitura(s) vinculada(s)');
    await semViolacaoAxe(page, '/enfermagem/aparelhos (recusa)');
    await page.getByTestId('ap-retirar-em-vez').click();
    // Revisão W0-03: retirar também pede o motivo; a situação anterior fica nas versões do aparelho.
    await expect(page.getByTestId('ap-dialogo-alternar')).toBeVisible();
    await page
      .getByTestId('ap-dialogo-alternar-motivo')
      .fill('Aparelho com leituras: retirado em vez de excluído');
    await page.getByTestId('ap-dialogo-alternar-confirmar').click();
    await expect(posto).toHaveAttribute('data-ativo', 'nao');
    await expect(page.getByTestId(`ap-versoes-${idPosto}`)).toBeVisible();
  });

  test('escore estornado tachado, com o motivo e o alerta reavaliado; a exportação traz o inativo', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ENF.PLANTAO');
    const r = await api<{ id: number }>(page, '/enfermagem/escores/afericao', {
      ...P3,
      sinais: { fr: 26, spo2: 93, o2: 2, pas: 120, fc: 72, acvpu: 0, temperatura: 36.8 },
      confirmadoForaDaFaixa: true,
    });
    await page.goto(`/enfermagem/escores?atendimento=${P3.atendimento}`);
    await expect(page.getByTestId(`es-hist-${r.id}`)).toHaveAttribute('data-inativo', 'nao');
    await page.getByTestId(`es-estornar-${r.id}`).click();
    await expect(page.getByTestId('es-dialogo-estorno')).toBeVisible();
    await page.getByTestId('es-dialogo-estorno-motivo').fill('Frequência respiratória de outro paciente');
    await semViolacaoAxe(page, '/enfermagem/escores (estornar)');
    await page.getByTestId('es-dialogo-estorno-confirmar').click();
    await expect(page.getByTestId('es-mensagem')).toContainText('estornado');
    await expect(page.getByTestId(`es-hist-${r.id}`)).toHaveAttribute('data-inativo', 'sim');
    await expect(page.getByTestId(`es-hist-${r.id}`).locator('s').first()).toBeVisible();
    await expect(page.getByTestId(`es-hist-estorno-${r.id}`)).toContainText(
      'Frequência respiratória de outro paciente',
    );
    await expect(page.getByTestId(`es-hist-estorno-${r.id}`)).toContainText('Alerta do NEWS2');
    const baixa = page.waitForEvent('download');
    await page.getByTestId('es-exportar').click();
    const arquivo = await baixa;
    expect(arquivo.suggestedFilename()).toBe(`escores-${P3.atendimento}.csv`);
    const csv = await (await arquivo.createReadStream()).toArray();
    const texto = Buffer.concat(csv as Buffer[]).toString('utf8');
    expect(texto).toContain('"estornado"');
    expect(texto).toContain('Frequência respiratória de outro paciente');
  });

  test('classificação e índice de UTI estornados ficam inativos e visíveis', async ({ page, browser }) => {
    await entrar(page, 'SINT.ENF.PLANTAO');
    const carga = await api<{ data: string; turno: string }>(page, '/enfermagem/classificacao?unidade=UTI');
    const c = await api<{ id: number }>(page, '/enfermagem/classificacao', {
      ...P3,
      data: carga.data,
      turno: carga.turno,
      instrumento: 'fugulin',
      itens: Object.fromEntries(
        [
          'estadoMental',
          'oxigenacao',
          'sinaisVitais',
          'motilidade',
          'deambulacao',
          'alimentacao',
          'cuidadoCorporal',
          'eliminacao',
          'terapeutica',
          'integridadeCutanea',
          'curativo',
          'tempoCurativo',
        ].map((k) => [k, 2]),
      ),
    });
    await page.goto('/enfermagem/classificacao');
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    await page.getByTestId(`cl-estornar-${c.id}`).click();
    await page.getByTestId('cl-dialogo-estorno-motivo').fill('Itens marcados no paciente errado');
    await semViolacaoAxe(page, '/enfermagem/classificacao (estornar)');
    await page.getByTestId('cl-dialogo-estorno-confirmar').click();
    await expect(page.getByTestId(`cl-classif-${c.id}`)).toHaveAttribute('data-inativo', 'sim');
    await expect(page.getByTestId(`cl-classif-${c.id}`)).toContainText('Itens marcados no paciente errado');
    await expect(page.getByTestId(`cl-classificar-${P3.paciente}`)).toBeEnabled();

    const ctx = await browser.newContext({ timezoneId: 'America/Sao_Paulo' });
    const med = await ctx.newPage();
    await entrar(med, 'SINT.MEDICO.UTI');
    const agora = new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 16);
    const i = await api<{ id: number }>(med, '/pep/uti/indices', {
      ...P3,
      indice: 'sofa',
      coletadoEm: agora,
      variaveis: {
        PAO2: 80,
        FIO2: 0.5,
        PLAQUETAS: 90,
        BILIRRUBINA: 2.5,
        PAM: 65,
        EPI_NORA: 0.2,
        CREATININA: 3.6,
        DEBURINARIO: 400,
      },
      glasgow: { ocular: 17, verbal: 22, motora: 27 },
    });
    await med.goto(`/pep/uti/indices/${P3.atendimento}`);
    await med.getByTestId(`ui-estornar-${i.id}`).click();
    await med.getByTestId('ui-dialogo-estorno-motivo').fill('Plaquetas de outro exame');
    await semViolacaoAxe(med, '/pep/uti/indices (estornar)');
    await med.getByTestId('ui-dialogo-estorno-confirmar').click();
    await expect(med.getByTestId(`ui-ind-${i.id}`)).toHaveAttribute('data-inativo', 'sim');
    await expect(med.getByTestId(`ui-ind-${i.id}`)).toContainText('Plaquetas de outro exame');
    await ctx.close();
  });

  test('receita suspensa com a senha, legível e inativa, e reemitida com o vínculo', async ({ page }) => {
    await entrar(page, 'SINT.ENF.PLANTAO');
    const receita = {
      protocolo: 'PROT-SINT-DOR/2026',
      modelo: 'simples',
      segundoIdentificador: 'nascimento',
      itens: [
        {
          medicamento: 'Paracetamol',
          via: 'oral',
          posologia: '500 mg de 6/6 h se dor',
          quantidade: '20 comprimidos',
        },
      ],
    };
    const pv = await api<{ impressao: string }>(
      page,
      `/enfermagem/prescricao-medicamento/${CONSULTA}/previa`,
      receita,
    );
    const r = await api<{ id: number }>(page, `/enfermagem/prescricao-medicamento/${CONSULTA}`, {
      ...receita,
      impressaoVista: pv.impressao,
      senha: SENHA,
    });
    await page.goto(`/enfermagem/prescricao-medicamento/${CONSULTA}`);
    await expect(page.getByTestId(`receita-${r.id}`)).toHaveAttribute('data-inativa', 'nao');
    const textoAntes = await page.getByTestId(`receita-${r.id}`).locator('pre').textContent();
    await page.getByTestId(`receita-inativar-${r.id}`).click();
    await expect(page.getByTestId('receita-dialogo-inativar')).toBeVisible();
    await page.getByTestId('receita-dialogo-inativar-motivo').fill('Tratamento trocado na reavaliação');
    // A senha errada recusa e mantém o diálogo.
    await page.getByTestId('receita-dialogo-inativar-senha').fill('errada');
    await page.getByTestId('receita-dialogo-inativar-confirmar').click();
    await expect(page.getByTestId('receita-dialogo-inativar')).toBeVisible();
    await page.getByTestId('receita-dialogo-inativar-motivo').fill('Tratamento trocado na reavaliação');
    await page.getByTestId('receita-dialogo-inativar-senha').fill(SENHA);
    await semViolacaoAxe(page, '/enfermagem/prescricao-medicamento (suspender)');
    await page.getByTestId('receita-dialogo-inativar-confirmar').click();
    await expect(page.getByTestId('receita-mensagem')).toContainText('suspensa');
    await expect(page.getByTestId(`receita-${r.id}`)).toHaveAttribute('data-inativa', 'sim');
    await expect(page.getByTestId(`receita-inativacao-${r.id}`)).toContainText(
      'Tratamento trocado na reavaliação',
    );
    // A original não é regerada: o mesmo texto assinado.
    await expect(page.getByTestId(`receita-${r.id}`).locator('pre')).toHaveText(textoAntes!);

    // Reemitir: o formulário vem preenchido e a receita nova cita a substituída.
    await page.getByTestId(`receita-reemitir-${r.id}`).click();
    await expect(page.getByTestId('receita-reemitindo')).toContainText(String(r.id));
    await page.getByTestId('receita-previa').click();
    await expect(page.getByTestId('receita-texto')).toContainText(
      `Reemissão: substitui a receita nº ${r.id}`,
    );
    await page.getByTestId('receita-senha').fill(SENHA);
    await page.getByTestId('receita-assinar').click();
    await expect(page.getByTestId('receita-mensagem')).toContainText('reemitida');
    await expect(page.locator('[data-testid^="receita-anterior-"]').first()).toContainText(String(r.id));
    await expect(page.getByTestId(`receita-reemitir-${r.id}`)).toHaveCount(0);
  });

  test('vacina retificada (o original visível) e estornada, com a situação do envio', async ({ page }) => {
    await entrar(page, 'SINT.ENF.PLANTAO');
    const v = await api<{ id: number }>(page, `/enfermagem/vacinas/${P3.atendimento}`, {
      imunobiologico: '99',
      lote: 'LOTE-E2E-1',
      fabricante: null,
      validadeLote: '2030-01-31',
      dose: 'REF',
      via: 'IM',
      local: 'DD',
    });
    await page.goto(`/enfermagem/vacinas/${P3.atendimento}`);
    await expect(page.getByTestId(`vac-${v.id}`)).toHaveAttribute('data-situacao', 'ativa');
    await page.getByTestId(`vac-corrigir-${v.id}`).click();
    await expect(page.getByTestId('vac-dialogo-corrigir')).toBeVisible();
    await page.locator('#vac-ret-lote').fill('LOTE-E2E-2');
    await page.getByTestId('vac-dialogo-corrigir-motivo').fill('Lote digitado errado na aplicação');
    await semViolacaoAxe(page, '/enfermagem/vacinas (retificar)');
    await page.getByTestId('vac-dialogo-corrigir-confirmar').click();
    await expect(page.getByTestId(`vac-${v.id}`)).toHaveAttribute('data-situacao', 'retificada');
    await expect(page.getByTestId(`vac-${v.id}`)).toContainText('LOTE-E2E-2');
    await expect(page.getByTestId(`vac-original-${v.id}`)).toContainText('LOTE-E2E-1');
    await expect(page.getByTestId(`vac-correcoes-${v.id}`)).toContainText(
      'Lote digitado errado na aplicação',
    );

    await page.getByTestId(`vac-corrigir-${v.id}`).click();
    await page.getByLabel('Estornar (registrada por engano)').check();
    await page.getByTestId('vac-dialogo-corrigir-motivo').fill('Registrada no paciente errado');
    await page.getByTestId('vac-dialogo-corrigir-confirmar').click();
    await expect(page.getByTestId(`vac-${v.id}`)).toHaveAttribute('data-situacao', 'estornada');
    await expect(page.getByTestId(`vac-corrigir-${v.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`vac-correcoes-${v.id}`)).toContainText('Registrada no paciente errado');
    // M6: o monitor de recusas do RIA mostra o destino (no dev, sempre o simulador) e leva ao tratamento.
    await expect(page.getByTestId('vac-ria-destino')).toContainText('simulador local');
    await expect(page.getByTestId('vac-ria-vazio')).toBeVisible();
    await expect(page.getByTestId('vac-ria-monitor')).toHaveAttribute('href', '/admin/integracoes/monitor');
    await semViolacaoAxe(page, '/enfermagem/vacinas (monitor de recusas)');
  });
});
