// E2E @M45.4 (ficha do M45, seções 7, 10 e 11; etapa 4, SAE e prescrição de enfermagem, receita do enfermeiro e vacina
// aplicada): a enfermeira abre o processo do paciente da UTI, registra a avaliação, o diagnóstico de risco com o fator,
// o resultado com a meta e a intervenção; prescreve duas atividades (uma aprazada perto de agora e uma "se
// necessário"); o técnico checa as duas no turno (uma feita, outra não feita com o motivo) pela linha do tempo; a
// enfermeira registra a evolução e as cinco etapas ficam feitas; na consulta de enfermagem, emite a receita pelo
// protocolo com a prévia e a senha; e, pela entrada do menu, registra a vacina no atendimento externo do dia com o prazo
// do envio e a prévia do registro de envio. axe sem violação séria nas telas e nos diálogos. Sessão real sobre a fonte
// sintética e as portas em MEMÓRIA (dados SINTÉTICOS).
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

/** Agora em São Paulo (o relógio do estabelecimento sintético) mais n minutos, HH:mm. */
function horaDaqui(n: number): { hhmm: string; minutos: number } {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + n * 60_000));
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? 0);
  const m = Number(p.find((x) => x.type === 'minute')?.value ?? 0);
  return { hhmm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, minutos: h * 60 + m };
}

test.describe('Processo de enfermagem, cuidados no turno, receita do enfermeiro e vacina @M45 @M45.4 @fase5', () => {
  test.setTimeout(300_000);

  test('SAE → duas atividades → checadas no turno pelo técnico → evolução → receita na consulta → vacina; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto('/enfermagem/sae');
    await expect(page.getByTestId('tela-sae')).toBeVisible();
    await escolher(page.getByTestId('sae-unidade'), 'UTI');
    await escolher(page.getByTestId('sae-paciente'), '25103');
    await semViolacaoAxe(page, '/enfermagem/sae (escolha)');
    await page.getByTestId('sae-abrir').click();
    await expect(page).toHaveURL(/\/enfermagem\/sae\/25103$/);
    await expect(page.getByTestId('sae-sintetica')).toBeVisible();
    await expect(page.locator('[data-etapa="avaliacao"]')).toHaveAttribute('data-feita', 'false');

    // O processo: avaliação, o diagnóstico de risco com o fator, o resultado com a meta e a intervenção.
    await page.getByTestId('sae-editar').click();
    await page
      .locator('#sae-avaliacao-campo')
      .fill('Paciente sintético acamado, pele íntegra, mobilidade reduzida no leito.');
    await escolher(page.getByTestId('sae-novo-diagnostico'), 'S-D01');
    await page.getByTestId('sae-adicionar-diagnostico').click();
    await page.getByTestId('sae-fator-S-F011').check();
    await escolher(page.getByTestId('sae-resultado-0-0'), 'S-R01');
    await escolher(page.getByTestId('sae-escala-atual-0-0'), '3');
    await escolher(page.getByTestId('sae-meta-0-0'), '1');
    await escolher(page.getByTestId('sae-escala-meta-0-0'), '5');
    await page.getByTestId('sae-intervencao-0-S-I01').check();
    await semViolacaoAxe(page, '/enfermagem/sae/:reg (registrar o processo)');
    await page.getByTestId('sae-registrar').click();
    await expect(page.getByTestId('sae-mensagem')).toContainText('Processo de enfermagem registrado');
    await expect(page.getByTestId('sae-diagnostico-S-D01')).toContainText('Mobilidade reduzida no leito');
    await expect(page.locator('[data-etapa="planejamento"]')).toHaveAttribute('data-feita', 'true');

    // Duas atividades: uma aprazada para daqui a até 20 minutos (sem passar da virada do turno) e uma "se necessário".
    let agora = horaDaqui(0).minutos;
    const virada = (m: number) => [7 * 60, 19 * 60, 31 * 60].find((v) => v > m)!;
    if (virada(agora) - agora < 3) {
      await page.waitForTimeout(4 * 60_000);
      agora = horaDaqui(0).minutos;
    }
    const daqui = horaDaqui(Math.min(20, virada(agora) - agora - 1));
    // O caminho ao prontuário fica dito na tela: o registro-resumo aguarda (DP-27); a prescrição do período leva o cuidado.
    await expect(page.getByTestId('sae-cuidados-prontuario')).toContainText('registro-resumo');
    await page.getByTestId('sae-cuidado-adicionar').click();
    await escolher(page.getByTestId('sae-cuidado-intervencao-0'), { indice: 1 });
    await escolher(page.getByTestId('sae-cuidado-atividade-0'), 'S-A011');
    await escolher(page.getByTestId('sae-cuidado-frequencia-0'), '1');
    await page.getByTestId('sae-cuidado-horarios-0').fill(daqui.hhmm);
    await page.getByTestId('sae-cuidado-adicionar').click();
    await escolher(page.getByTestId('sae-cuidado-intervencao-1'), { indice: 1 });
    await escolher(page.getByTestId('sae-cuidado-atividade-1'), 'S-A013');
    await escolher(page.getByTestId('sae-cuidado-frequencia-1'), '0');
    await page.getByTestId('sae-prescrever').click();
    await expect(page.getByTestId('sae-mensagem')).toContainText('2 cuidados prescritos');
    await expect(page.getByTestId('sae-cuidados').locator('tbody tr')).toHaveCount(2);
    await expect(page.locator('[data-etapa="implementacao"]')).toHaveAttribute('data-feita', 'true');

    // O técnico checa os dois cuidados na linha do tempo do turno (o item do menu abre a seção dos cuidados).
    await entrar(page, 'SINT.TECNICO.ENF');
    await page.goto('/enfermagem/turno?secao=cuidados');
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    const secao = page.getByTestId('secao-cuidados');
    await expect(secao).toBeVisible();
    const linhas = secao.locator('tbody tr');
    await expect(linhas).toHaveCount(2);
    // O aprazado: não feito, com o motivo obrigatório.
    await secao.locator('tr[data-sn="nao"] [data-testid^="turno-nao-feita-"]').click();
    await expect(page.getByTestId('turno-motivo-confirmar')).toBeDisabled();
    await page.getByTestId('turno-motivo-cuidado').fill('Paciente no exame de imagem');
    await semViolacaoAxe(page, '/enfermagem/turno (não feito)');
    await page.getByTestId('turno-motivo-confirmar').click();
    await expect(page.getByTestId('cuidados-mensagem')).toContainText('não feito, com o motivo');
    // O "se necessário": feito agora.
    await secao.locator('tr[data-sn="sim"] [data-testid^="turno-feita-"]').first().click();
    await expect(page.getByTestId('cuidados-mensagem')).toContainText('Cuidado checado como feito');
    await expect(secao.locator('tr[data-estado="feita"]')).toHaveCount(1);
    await expect(secao.locator('tr[data-estado="naoFeita"]')).toHaveCount(1);
    await expect(page.getByTestId('cuidados-resumo-feita')).toHaveText('1');
    await expect(page.getByTestId('cuidados-resumo-naoFeita')).toHaveText('1');
    await semViolacaoAxe(page, '/enfermagem/turno (cuidados)');
    // A linha do tempo do turno (item do menu) também leva às vacinas aplicadas.
    await expect(page.getByTestId('cuidados-vacinas')).toHaveAttribute('href', '/enfermagem/vacinas');

    // A enfermeira registra a evolução: as cinco etapas ficam feitas.
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto('/enfermagem/sae/25103');
    await expect(page.getByTestId('sae-cuidados').locator('tbody tr[data-estado="feita"]')).toHaveCount(1);
    await escolher(page.locator('[data-testid^="sae-evolucao-escala-"]').first(), '4');
    await page
      .locator('#sae-evolucao-nota')
      .fill('Evolução sintética: pele íntegra, decúbito mudado no horário.');
    await page.getByTestId('sae-evoluir').click();
    await expect(page.getByTestId('sae-mensagem')).toContainText('Evolução registrada');
    for (const e of ['avaliacao', 'diagnostico', 'planejamento', 'implementacao', 'evolucao'])
      await expect(page.locator(`[data-etapa="${e}"]`)).toHaveAttribute('data-feita', 'true');
    await expect(page.getByTestId('sae-evolucoes')).toContainText('decúbito mudado no horário');
    await semViolacaoAxe(page, '/enfermagem/sae/:reg (processo completo)');

    // A receita do enfermeiro na consulta de enfermagem, pelo protocolo publicado, com a prévia e a senha.
    await page.goto('/enfermagem/prescricao-medicamento');
    await expect(page.getByTestId('tela-receita')).toBeVisible();
    await page.getByTestId('receita-abrir-45401').click();
    await escolher(page.getByTestId('receita-protocolo'), 'PROT-SINT-DOR/2026');
    await page.getByTestId('receita-adicionar').click();
    await escolher(page.getByTestId('receita-medicamento-0'), 'paracetamol');
    await page.locator('#receita-posologia-0').fill('500 mg de 6 em 6 horas se dor');
    await page.locator('#receita-quantidade-0').fill('20 comprimidos');
    await page.getByTestId('receita-previa').click();
    await expect(page.getByTestId('receita-texto')).toContainText(
      'Protocolo institucional: PROT-SINT-DOR, de 2026',
    );
    await expect(page.getByTestId('receita-texto')).toContainText(
      '1. paracetamol · via oral · 20 comprimidos',
    );
    await expect(page.getByTestId('receita-texto')).toContainText('COREN-RJ 000000');
    await semViolacaoAxe(page, '/enfermagem/prescricao-medicamento/:reg (prévia)');
    await page.getByTestId('receita-senha').fill(SENHA);
    await page.getByTestId('receita-assinar').click();
    await expect(page.getByTestId('receita-mensagem')).toContainText('Receita assinada');
    await expect(page.locator('[data-testid^="receita-"] pre.receita').first()).toContainText(
      'Assinatura eletrônica do prescritor',
    );

    // A vacina aplicada na sala de vacina da consulta, pela entrada do item do menu do processo de enfermagem: a
    // escolha oferece o atendimento externo do dia; o prazo do envio em 24 horas; o envio aguarda o conector; a prévia
    // do registro de envio.
    await page.goto('/enfermagem/sae');
    await page.getByTestId('sae-vacinas-escolha').click();
    await expect(page).toHaveURL(/\/enfermagem\/vacinas$/);
    await escolher(page.getByTestId('vac-externo'), '45401');
    await semViolacaoAxe(page, '/enfermagem/vacinas (escolha)');
    await page.getByTestId('vac-abrir-externo').click();
    await expect(page).toHaveURL(/\/enfermagem\/vacinas\/45401$/);
    await expect(page.getByTestId('tela-vacinas')).toBeVisible();
    await expect(page.getByTestId('vac-conector')).toBeVisible();
    await escolher(page.getByTestId('vac-imuno'), '99');
    await page.locator('#vac-lote').fill('LOTE-SINT-1');
    await page.getByTestId('vac-validade').fill('2027-01-31');
    await semViolacaoAxe(page, '/enfermagem/vacinas/:reg');
    await page.getByTestId('vac-registrar').click();
    await expect(page.getByTestId('vac-mensagem')).toContainText('O envio à RNDS vence em');
    const vacina = page.locator('[data-testid^="vac-"][data-envio]').first();
    await expect(vacina).toHaveAttribute('data-envio', 'aguardandoConector');
    await vacina.locator('[data-testid^="vac-ria-"]').click();
    await expect(page.getByTestId('vac-ria-situacao')).toContainText('conferido no perfil nacional');
    await expect(page.getByTestId('vac-ria')).toContainText('"resourceType": "Immunization"');
    expect(externas).toEqual([]);
  });
});
