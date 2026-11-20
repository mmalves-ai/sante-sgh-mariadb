// E2E @W0-04 (programa CRUD completo: qualidade e CCIH, correção e cancelamento). Cada operação abre o diálogo com a
// justificativa obrigatória (o botão só libera com 10 caracteres) e, nas críticas, a senha de novo:
// - CCIH (SINT.CCIH): na ficha do internado, o cancelamento do cateter que é critério de ficha de IRAS confirmada fica
//   impedido com a lista; a sonda é corrigida (histórico com a versão inativa) e cancelada com a senha (fica inativa);
//   a ficha de IRAS e a precaução são alteradas; a sessão de higiene das mãos é corrigida e estornada; a competência
//   anterior é fechada e reaberta com motivo e senha;
// - gestão (SINT.QUALIDADE): a auditoria é alterada e cancelada; a ata é retificada e assinada, e a reunião de ata
//   assinada não oferece o cancelamento (a outra é cancelada); a ata assinada retificada pede a senha, fica aguardando
//   nova assinatura e é assinada de novo (revisão do W0-04); a não conformidade duplicada é cancelada apontando a
//   original;
// - ouvidoria (SINT.OUVIDORIA): a manifestação é corrigida antes do encaminhamento e cancelada (fica inativa).
// axe sem violação séria nos diálogos. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS;
// nada vai à cópia). Os registros de partida entram pela API da própria sessão (o que se testa aqui é a correção).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
/** A internação sintética em pós-operatório (porta em memória da CCIH), longe da 4801 do E2E do M48.3. */
const INTERNACAO = 4803;

/** A data de n dias atrás no relógio do estabelecimento sintético (America/Sao_Paulo), AAAA-MM-DD. */
function dia(n: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - n * 86_400_000));
}
function competenciaAnterior(): string {
  const [a, m] = dia(0).split('-').map(Number) as [number, number];
  return m === 1 ? `${String(a - 1)}-12` : `${String(a)}-${String(m - 1).padStart(2, '0')}`;
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** POST pela sessão do navegador (CSRF do cookie e uma Idempotency-Key), devolvendo o JSON. */
async function postar<T = { id: number }>(page: Page, url: string, corpo: unknown): Promise<T> {
  const r = await page.evaluate(
    async ([u, c]) => {
      const csrf = /(?:^|;\s*)sgh_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '';
      const resp = await fetch(u as string, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-csrf': csrf,
          'idempotency-key': `e2e.w004.${Math.random().toString(36).slice(2)}`,
        },
        body: JSON.stringify(c),
      });
      return { status: resp.status, corpo: (await resp.json()) as unknown };
    },
    [url, corpo] as const,
  );
  expect(r.status, `${url}: ${JSON.stringify(r.corpo)}`).toBeLessThan(300);
  return r.corpo as T;
}

/** Preenche a justificativa (e a senha, na crítica) e confirma o diálogo aberto. */
async function confirmarDialogo(page: Page, justificativa: string | null, senha = false): Promise<void> {
  const d = page.getByTestId('dialogo-correcao');
  await expect(d).toBeVisible();
  if (justificativa !== null) {
    await d.getByTestId('correcao-justificativa').fill('curta');
    await expect(d.getByTestId('correcao-confirmar')).toBeDisabled();
    await d.getByTestId('correcao-justificativa').fill(justificativa);
  }
  if (senha) {
    await expect(d.getByTestId('correcao-confirmar')).toBeDisabled();
    await d.getByTestId('correcao-senha').fill(SENHA);
  }
  await d.getByTestId('correcao-confirmar').click();
  await expect(d).toBeHidden();
}

test.describe('Qualidade e CCIH: correção por versão e cancelamento com motivo @W0-04 @crud', () => {
  test.setTimeout(360_000);

  test('CCIH: órfão recusado, dispositivo corrigido e cancelado, IRAS, precaução, mãos e competência; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.CCIH');
    // Os registros de partida: o cateter (há 5 dias), a sonda (ontem), a ficha de IPCS de hoje associada ao cateter,
    // a precaução de contato por MRSA e uma sessão de observação das mãos.
    const cvc = await postar(page, '/api/qualidade/ccih/dispositivos', {
      internacao: INTERNACAO,
      tipo: 'cvc',
      sitio: 'JUGULAR',
      inseridoEm: `${dia(5)}T08:00`,
      itemPrescricao: null,
      observacao: null,
    });
    const svd = await postar(page, '/api/qualidade/ccih/dispositivos', {
      internacao: INTERNACAO,
      tipo: 'sondaVesical',
      sitio: null,
      inseridoEm: `${dia(1)}T10:00`,
      itemPrescricao: null,
      observacao: null,
    });
    const iras = await postar<{ id: number; dispositivoAssociado: number | null }>(
      page,
      '/api/qualidade/ccih/iras',
      {
        internacao: INTERNACAO,
        sitio: 'ipcs',
        dataInfeccao: dia(0),
        criterios: ['hemoculturaPatogeno', 'febre'],
        nivelIsc: null,
        cirurgia: null,
        implante: false,
        exame: null,
        microrganismo: 'Klebsiella pneumoniae',
        multirresistente: false,
        descricao: null,
      },
    );
    expect(iras.dispositivoAssociado).toBe(cvc.id);
    const prec = await postar(page, '/api/qualidade/ccih/precaucoes', {
      internacao: INTERNACAO,
      motivo: 'mrsa',
      motivoOutro: null,
      tipo: 'contato',
      origem: 'manual',
      exame: null,
      bloquearVizinhos: false,
      observacao: null,
    });
    const sessao = await postar(page, '/api/qualidade/ccih/maos/observacoes', {
      unidade: 1,
      setor: 'CM',
      observadoEm: `${dia(1)}T07:30`,
      categoria: 'enfermeiro',
      oportunidades: [
        { momento: 'antesContato', acao: 'friccao', luvas: false },
        { momento: 'aposContato', acao: 'naoRealizada', luvas: false },
      ],
      observacao: null,
    });

    // ── A ficha do internado ──
    await page.goto('/qualidade/ccih/vigilancia');
    await expect(page.getByTestId('tela-ccih-vigilancia')).toBeVisible();
    await page.getByTestId(`abrir-${INTERNACAO}`).click();
    const ficha = page.getByTestId('ficha-internado');
    await expect(ficha.getByTestId(`dispositivo-${cvc.id}`)).toBeVisible();

    // Recusa de órfão: o cateter é critério da ficha de IRAS confirmada; o cancelamento fica impedido com a lista.
    await ficha.getByTestId(`cancelar-dispositivo-${cvc.id}`).click();
    const dialogo = page.getByTestId('dialogo-correcao');
    await expect(dialogo.getByTestId('correcao-alerta')).toContainText(`nº ${String(iras.id)}`);
    await dialogo.getByTestId('correcao-justificativa').fill('Cateter lançado no paciente errado');
    await dialogo.getByTestId('correcao-senha').fill(SENHA);
    await expect(dialogo.getByTestId('correcao-confirmar')).toBeDisabled();
    await semViolacaoAxe(page, '/qualidade/ccih/vigilancia (cancelar dispositivo com dependentes)');
    await page.keyboard.press('Escape');
    await expect(dialogo).toBeHidden();

    // Corrigir a sonda (sítio), com o histórico da versão anterior inativa.
    await ficha.getByTestId(`corrigir-dispositivo-${svd.id}`).click();
    await expect(page.getByTestId('correcao-dispositivo')).toBeVisible();
    await page.getByTestId('correcao-dispositivo').getByLabel('Sítio de inserção').fill('URETRAL');
    await semViolacaoAxe(page, '/qualidade/ccih/vigilancia (corrigir dispositivo)');
    await confirmarDialogo(page, 'Sítio da sonda não informado no lançamento');
    await expect(ficha.getByTestId('ficha-aviso')).toContainText('versão anterior');
    await expect(ficha.getByTestId(`dispositivo-${svd.id}`)).toContainText('URETRAL');
    await ficha.getByTestId(`historico-dispositivo-${svd.id}`).first().click();
    const historico = page.getByTestId('historico-versoes');
    await expect(historico.getByTestId('versao-1')).toContainText('Inativo');
    await expect(historico.getByTestId('versao-1')).toContainText('Sítio da sonda não informado');
    await semViolacaoAxe(page, '/qualidade/ccih/vigilancia (histórico de versões)');
    await page.keyboard.press('Escape');
    await expect(historico).toBeHidden();

    // Cancelar a sonda (crítica: senha); ela fica visível como inativa.
    await ficha.getByTestId(`cancelar-dispositivo-${svd.id}`).click();
    await expect(page.getByTestId('correcao-alerta')).toHaveCount(0);
    await confirmarDialogo(page, 'Sonda lançada na internação errada', true);
    await expect(ficha.getByTestId(`dispositivo-inativo-${svd.id}`)).toBeVisible();
    await expect(ficha.getByTestId(`dispositivo-${svd.id}`)).toContainText(
      'Sonda lançada na internação errada',
    );

    // Alterar a ficha de IRAS (microrganismo).
    await ficha.getByTestId(`alterar-iras-${iras.id}`).click();
    await page.getByTestId('correcao-iras-microrganismo').locator('input').fill('Klebsiella oxytoca');
    await confirmarDialogo(page, 'Identificação do laboratório corrigida');
    await expect(ficha.getByTestId('ficha-aviso')).toContainText('versão anterior');

    // Alterar a precaução (o motivo).
    await ficha.getByTestId(`alterar-precaucao-${prec.id}`).click();
    await escolher(page.getByTestId('correcao-precaucao-motivo'), 'vre');
    await semViolacaoAxe(page, '/qualidade/ccih/vigilancia (alterar precaução)');
    await confirmarDialogo(page, 'Cultura mostrou VRE e não MRSA');
    await expect(ficha.getByTestId('ficha-precaucoes')).toContainText('VRE');

    // ── Higiene das mãos: corrigir e estornar a sessão ──
    await page.goto('/qualidade/ccih/maos-surtos');
    await page.locator('input[name="secao-maos"][value="sessoes"]').check();
    const sessoes = page.getByTestId('maos-sessoes');
    await expect(sessoes.getByTestId(`sessao-maos-${sessao.id}`)).toBeVisible();
    await sessoes.getByTestId(`corrigir-sessao-${sessao.id}`).click();
    await escolher(page.getByTestId('correcao-sessao-categoria'), 'tecnicoEnfermagem');
    await semViolacaoAxe(page, '/qualidade/ccih/maos-surtos (corrigir sessão)');
    await confirmarDialogo(page, 'Categoria observada lançada errada');
    await expect(sessoes.getByTestId(`sessao-maos-${sessao.id}`)).toContainText('Técnico');
    await sessoes.getByTestId(`estornar-sessao-${sessao.id}`).click();
    await confirmarDialogo(page, 'Sessão lançada em duplicidade', true);
    await expect(sessoes.getByTestId(`sessao-inativa-${sessao.id}`)).toBeVisible();
    await expect(page.getByTestId('maos-aviso')).toContainText('estornada');

    // ── Competência: fechar a anterior e reabrir com motivo e senha ──
    const anterior = competenciaAnterior();
    await page.goto('/qualidade/ccih/iras');
    await expect(page.getByTestId('tela-ccih-iras')).toBeVisible();
    await escolher(page.getByTestId('filtro-competencia'), anterior);
    const comp = page.getByTestId('competencias-ccih');
    await comp.getByTestId('competencia-fechar').click();
    await confirmarDialogo(page, null);
    await expect(comp.getByTestId(`competencia-${anterior}`)).toContainText('Fechada');
    await semViolacaoAxe(page, '/qualidade/ccih/iras (competência fechada)');
    await comp.getByTestId(`competencia-reabrir-${anterior}`).click();
    await confirmarDialogo(page, 'Ficha de IRAS do mês chegou depois do fechamento', true);
    await expect(comp.getByTestId(`competencia-${anterior}`)).toContainText('Reaberta');
    await expect(comp.getByTestId(`competencia-${anterior}`)).toContainText('chegou depois do fechamento');

    expect(externas).toEqual([]);
  });

  test('gestão e ouvidoria: auditoria, ata, reunião, não conformidade e manifestação; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.QUALIDADE');
    const aud = await postar(page, '/api/qualidade/gestao/auditorias', {
      titulo: 'Auditoria de identificação do paciente (E2E)',
      area: 'UTI',
      referencial: 'interno',
      realizadaEm: dia(2),
      auditores: 'Equipe da qualidade (sintético)',
      itens: [{ requisito: 'Pulseira no paciente', secao: 'Meta 1', resultado: 'conforme', evidencia: null }],
      conclusao: 'Identificação conforme na amostra (sintético).',
    });
    const com = await postar(page, '/api/qualidade/gestao/comissoes', {
      comissao: null,
      versao: null,
      tipo: 'ccih',
      nome: 'Comissão de controle de infecção (E2E W0-04)',
      periodicidade: 'mensal',
      membros: [
        { nome: 'Médica infectologista', funcao: 'Presidente', login: null },
        { nome: 'Enfermeira da CCIH', funcao: 'Secretária', login: 'SINT.CCIH' },
      ],
      ativa: true,
    });
    const reuniao = (d: number) => ({
      tipo: 'ordinaria',
      realizadaEm: `${dia(d)}T14:00`,
      pauta: 'Indicadores do mês (sintético)',
      ata: 'Apresentada a densidade de IPCS; aprovado o reforço do bundle (sintético).',
      versaoComissao: 1,
      presentes: [0],
      convidados: null,
      deliberacoes: null,
    });
    const r1 = await postar(page, `/api/qualidade/gestao/comissoes/${String(com.id)}/reunioes`, reuniao(3));
    const r2 = await postar(page, `/api/qualidade/gestao/comissoes/${String(com.id)}/reunioes`, reuniao(1));
    const nc = {
      naoConformidade: null,
      versao: null,
      origem: 'externa',
      idOrigem: null,
      descricao: 'Dupla checagem não realizada na UTI (sintético E2E).',
      area: 'UTI',
      classificacao: 'maior',
      acaoImediata: null,
      causa: null,
      plano: null,
      responsavel: null,
      prazo: null,
      situacao: 'aberta',
      eficacia: null,
      eficaciaTexto: null,
    };
    const original = await postar(page, '/api/qualidade/gestao/nao-conformidades', nc);
    const duplicada = await postar(page, '/api/qualidade/gestao/nao-conformidades', nc);

    // ── Auditoria: alterar com versão e cancelar com senha ──
    await page.goto('/qualidade/gestao/auditorias');
    await page.getByTestId(`abrir-auditoria-${aud.id}`).click();
    const det = page.getByTestId('auditoria-detalhe');
    await det.getByTestId('aud-alterar').click();
    await page
      .getByTestId('correcao-aud-titulo')
      .locator('input')
      .fill('Auditoria de identificação (E2E, corrigida)');
    await semViolacaoAxe(page, '/qualidade/gestao/auditorias (alterar)');
    await confirmarDialogo(page, 'Título lançado incompleto');
    await expect(det).toContainText('corrigida');
    await expect(det).toContainText('Versão 2');
    await det.getByTestId('aud-cancelar').click();
    await confirmarDialogo(page, 'Auditoria lançada em duplicidade', true);
    await expect(det.getByTestId('aud-inativa')).toBeVisible();
    await expect(det.getByTestId('aud-alterar')).toHaveCount(0);

    // ── Comissão: retificar e assinar a ata; a de ata assinada não cancela; a outra é cancelada ──
    await page.goto('/qualidade/gestao/comissoes');
    await page.getByTestId(`abrir-comissao-${com.id}`).click();
    const reunioes = page.getByTestId('reunioes');
    await reunioes.getByTestId(`retificar-ata-${r1.id}`).click();
    await page
      .getByTestId('correcao-ata-texto')
      .locator('textarea')
      .fill(
        'Apresentada a densidade de IPCS e de PAV; aprovado o reforço do bundle (sintético, retificada).',
      );
    await confirmarDialogo(page, 'A densidade de PAV ficou fora da ata');
    await expect(reunioes.getByTestId(`reuniao-${r1.id}`)).toContainText('retificada');
    await reunioes.getByTestId(`assinar-ata-${r1.id}`).click();
    await semViolacaoAxe(page, '/qualidade/gestao/comissoes (assinar ata)');
    await confirmarDialogo(page, null, true);
    await expect(reunioes.getByTestId(`ata-assinada-${r1.id}`)).toBeVisible();
    await reunioes.getByTestId(`historico-reuniao-${r1.id}`).first().click();
    await expect(page.getByTestId('historico-versoes')).toContainText('Retificação');
    await page.keyboard.press('Escape');
    // A reunião com ata assinada não oferece o cancelamento (o servidor também recusa: ata-assinada).
    await expect(reunioes.getByTestId(`cancelar-reuniao-${r1.id}`)).toHaveCount(0);
    // Revisão do W0-04: retificar a ata assinada pede a senha; a assinatura sai do texto novo, que fica aguardando
    // nova assinatura; assinada de novo, volta a mostrar quem assinou.
    await reunioes.getByTestId(`retificar-ata-${r1.id}`).click();
    await page
      .getByTestId('correcao-ata-texto')
      .locator('textarea')
      .fill('Apresentada a densidade de IPCS e de PAV; aprovado o reforço do bundle e a compra (sintético).');
    await confirmarDialogo(page, 'Faltou a deliberação da compra na ata', true);
    await expect(reunioes.getByTestId(`ata-aguardando-${r1.id}`)).toContainText('aguarda nova assinatura');
    await expect(reunioes.getByTestId(`ata-assinada-${r1.id}`)).toHaveCount(0);
    await expect(reunioes.getByTestId(`cancelar-reuniao-${r1.id}`)).toHaveCount(0);
    await reunioes.getByTestId(`assinar-ata-${r1.id}`).click();
    await confirmarDialogo(page, null, true);
    await expect(reunioes.getByTestId(`ata-assinada-${r1.id}`)).toBeVisible();
    await reunioes.getByTestId(`cancelar-reuniao-${r2.id}`).click();
    await confirmarDialogo(page, 'Reunião lançada na comissão errada', true);
    await expect(reunioes.getByTestId(`reuniao-inativa-${r2.id}`)).toBeVisible();

    // ── Não conformidade duplicada, apontando a original ──
    await page.goto('/qualidade/gestao/riscos?aba=naoConformidades');
    await page.getByTestId(`cancelar-nc-${duplicada.id}`).click();
    await page.getByTestId('correcao-nc-duplicada').check();
    await escolher(page.getByTestId('correcao-nc-original'), String(original.id));
    await semViolacaoAxe(page, '/qualidade/gestao/riscos (cancelar não conformidade)');
    await confirmarDialogo(page, 'Mesma ocorrência aberta duas vezes', true);
    await expect(page.getByTestId(`nc-inativa-${duplicada.id}`)).toBeVisible();
    await expect(page.getByTestId(`nc-${duplicada.id}`)).toContainText(
      `Duplicada da nº ${String(original.id)}`,
    );

    // ── Ouvidoria: corrigir antes do encaminhamento e cancelar ──
    await entrar(page, 'SINT.OUVIDORIA');
    const man = await postar<{ id: number; protocolo: string }>(
      page,
      '/api/qualidade/ouvidoria/manifestacoes',
      {
        canal: 'telefone',
        tipo: 'reclamacao',
        identificada: false,
        paciente: null,
        manifestante: null,
        contato: null,
        area: 'Recepção',
        relato: 'Demora de 2 horas na recepção (texto sintético E2E).',
        recebidaEm: `${dia(1)}T08:00`,
        pesquisa: null,
      },
    );
    await page.goto('/qualidade/ouvidoria');
    await page.getByTestId('man-busca').locator('input').fill(man.protocolo);
    await page.getByTestId('man-buscar').click();
    await page.getByTestId(`abrir-manifestacao-${man.id}`).click();
    const md = page.getByTestId('manifestacao-detalhe');
    await md.getByTestId('man-corrigir').click();
    await escolher(page.getByTestId('correcao-man-tipo'), 'sugestao');
    await page.getByTestId('correcao-man-area').locator('input').fill('Faturamento');
    await semViolacaoAxe(page, '/qualidade/ouvidoria (corrigir manifestação)');
    await confirmarDialogo(page, 'Tipo e área lançados errados no protocolo');
    await expect(md).toContainText('Faturamento');
    await expect(md).toContainText('Sugestão');
    await md.getByTestId('man-cancelar').click();
    await confirmarDialogo(page, 'Manifestação registrada em duplicidade', true);
    await expect(md.getByTestId('man-inativa')).toBeVisible();
    await expect(md.getByTestId('man-cancelada')).toContainText('duplicidade');
    await expect(md.getByTestId('man-encaminhar')).toHaveCount(0);

    expect(externas).toEqual([]);
  });

  test('M1: a aba de dispositivos do prontuário (enfermagem): sonda com alerta, bundle do turno e retirada; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENF.UTI');
    await page.goto('/pep/paciente/1003/dispositivos');
    const aba = page.getByTestId('aba-dispositivos-conteudo');
    await expect(aba).toBeVisible();
    await semViolacaoAxe(page, '/pep/paciente/:id/dispositivos');

    // A sonda vesical inserida há 3 dias (o mesmo registro da CCIH).
    await aba.getByTestId('aba-novo-dispositivo').click();
    const form = page.getByTestId('aba-form-novo');
    await escolher(form.getByTestId('aba-novo-tipo'), 'sondaVesical');
    const [a, m, d] = dia(3).split('-');
    const data = form.getByRole('textbox', { name: 'Data da inserção' });
    await data.fill(`${d}/${m}/${a}`);
    await data.blur();
    const hora = form.getByRole('textbox', { name: 'Hora da inserção' });
    await hora.fill('08:00');
    await hora.blur();
    await page.getByTestId('correcao-confirmar').click();
    await expect(page.getByTestId('dialogo-correcao')).toBeHidden();
    await expect(aba.getByTestId('aba-aviso')).toContainText('registrado');

    // Acima de 48 h sem a indicação revisada: o alerta de permanência longa.
    const alerta = aba.locator('[data-testid^="aba-alerta-"]').first();
    await expect(alerta).toContainText('Permanência longa');
    const id = ((await alerta.getAttribute('data-testid')) ?? '').replace('aba-alerta-', '');
    await expect(aba.getByTestId(`aba-bundle-situacao-${id}`)).toContainText('pendente');
    await semViolacaoAxe(page, '/pep/paciente/:id/dispositivos (alerta de permanência)');

    // O bundle do turno lançado SEM a indicação revisada: o alerta continua.
    await aba.getByTestId(`aba-bundle-${id}`).click();
    const bundle = page.getByTestId('aba-form-bundle');
    for (const k of ['sistemaFechado', 'bolsaAbaixo', 'higieneMeato', 'fixacao'])
      await bundle.getByTestId(`aba-bundle-item-${k}`).check();
    await semViolacaoAxe(page, '/pep/paciente/:id/dispositivos (bundle do turno)');
    await page.getByTestId('correcao-confirmar').click();
    await expect(page.getByTestId('dialogo-correcao')).toBeHidden();
    await expect(aba.getByTestId(`aba-alerta-${id}`)).toBeVisible();
    await expect(aba.getByTestId(`aba-bundle-situacao-${id}`)).toContainText('registrado');
    // Revisão do W0-04: a autora corrige o checklist por versão (a indicação revisada tira o alerta)...
    const cartao = aba.getByTestId(`aba-dispositivo-${id}`);
    const abrirChecklists = () =>
      cartao.locator('details').evaluate((e) => {
        (e as HTMLDetailsElement).open = true;
      });
    await abrirChecklists();
    const corrigir = cartao.locator('[data-testid^="aba-corrigir-checklist-"]').first();
    const bid = ((await corrigir.getAttribute('data-testid')) ?? '').replace('aba-corrigir-checklist-', '');
    await corrigir.click();
    await page.getByTestId('aba-form-bundle').getByTestId('aba-bundle-item-indicacao').check();
    await semViolacaoAxe(page, '/pep/paciente/:id/dispositivos (corrigir checklist)');
    await confirmarDialogo(page, 'Indicação revisada esquecida no turno');
    await expect(aba.getByTestId(`aba-alerta-${id}`)).toHaveCount(0);
    // ... e o estorna com motivo e senha: fica inativo, o alerta volta e o turno se registra de novo.
    await abrirChecklists();
    await cartao.getByTestId(`aba-estornar-checklist-${bid}`).click();
    await confirmarDialogo(page, 'Checklist lançado no dispositivo errado', true);
    await expect(aba.getByTestId(`aba-alerta-${id}`)).toBeVisible();
    await expect(aba.getByTestId(`aba-bundle-situacao-${id}`)).toContainText('pendente');
    await aba.getByTestId(`aba-bundle-${id}`).click();
    for (const k of ['indicacao', 'sistemaFechado', 'bolsaAbaixo', 'higieneMeato', 'fixacao'])
      await page.getByTestId('aba-form-bundle').getByTestId(`aba-bundle-item-${k}`).check();
    await page.getByTestId('correcao-confirmar').click();
    await expect(page.getByTestId('dialogo-correcao')).toBeHidden();
    await expect(aba.getByTestId(`aba-alerta-${id}`)).toHaveCount(0);
    await expect(aba.getByTestId(`aba-bundle-${id}`)).toHaveCount(0);
    await abrirChecklists();
    await expect(cartao.getByTestId(`aba-checklist-${bid}`)).toContainText('Inativo');

    // Revisão do W0-04: a autora corrige o próprio dispositivo pela aba, com o responsável pela inserção.
    await aba.getByTestId(`aba-corrigir-${id}`).click();
    const fc = page.getByTestId('aba-form-corrigir');
    await fc.getByTestId('aba-corrigir-sitio').locator('input').fill('Uretral');
    await fc.getByTestId('aba-corrigir-resp-termo').locator('input').fill('intensiv');
    await fc.getByTestId('aba-corrigir-resp-buscar').click();
    await escolher(fc.getByTestId('aba-corrigir-responsavel'), '9103');
    await semViolacaoAxe(page, '/pep/paciente/:id/dispositivos (corrigir dispositivo)');
    await confirmarDialogo(page, 'Sítio e responsável esquecidos no registro');
    await expect(aba.getByTestId(`aba-responsavel-${id}`)).toContainText('SINT MEDICO INTENSIVISTA');

    // A retirada pela aba: o dispositivo vai para o histórico.
    await aba.getByTestId(`aba-retirar-${id}`).click();
    const ret = page.getByTestId('aba-form-retirada');
    const [ra, rm, rd] = dia(1).split('-');
    const dr = ret.getByRole('textbox', { name: 'Data da retirada' });
    await dr.fill(`${rd}/${rm}/${ra}`);
    await dr.blur();
    const hr = ret.getByRole('textbox', { name: 'Hora da retirada' });
    await hr.fill('12:00');
    await hr.blur();
    await page.getByTestId('correcao-confirmar').click();
    await expect(page.getByTestId('dialogo-correcao')).toBeHidden();
    await expect(aba.getByTestId(`aba-historico-${id}`)).toBeVisible();

    // A CCIH vê o mesmo registro na ficha do internado.
    await entrar(page, 'SINT.CCIH');
    await page.goto('/qualidade/ccih/vigilancia');
    await page.getByTestId('abrir-4801').click();
    await expect(page.getByTestId('ficha-internado').getByTestId(`dispositivo-${id}`)).toBeVisible();

    expect(externas).toEqual([]);
  });

  test('M5: comissão de revisão de prontuários: checklist, sorteio com semente, revisão, pendência ao médico e aval; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.QUALIDADE');
    const nome = `Revisão de prontuários E2E ${String(Date.now())}`;
    await postar(page, '/api/qualidade/gestao/comissoes', {
      comissao: null,
      versao: null,
      tipo: 'prontuario',
      nome,
      periodicidade: 'mensal',
      membros: [{ nome: 'Médico revisor sintético', funcao: 'Presidente', login: null }],
      ativa: true,
    });
    await page.goto('/qualidade/gestao/revisao-prontuarios');
    const tela = page.getByTestId('tela-revisao-prontuarios');
    await expect(tela).toBeVisible();
    await escolher(page.getByTestId('revisao-comissao'), { rotulo: nome });

    // Checklist: o modelo sugerido, publicado (revisão 1).
    await page.getByTestId('revisao-aba-checklist').click();
    await page.getByTestId('checklist-editar').click();
    await expect(page.getByTestId('checklist-item-0')).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/gestao/revisao-prontuarios (checklist)');
    await page.getByTestId('checklist-publicar').click();
    await expect(page.getByTestId('revisao-aviso')).toContainText('revisão 1');
    await expect(page.getByTestId('checklist-vigente')).toContainText('Sumário de alta');

    // Sorteio com a semente informada (reproduzível); a conferência refaz e confirma.
    await page.getByTestId('revisao-aba-sorteios').click();
    await expect(page.getByTestId('revisao-universo')).toContainText('Altas na competência: 24');
    await page.getByTestId('revisao-quantidade').getByRole('textbox').fill('4');
    await page.getByTestId('revisao-semente').getByRole('textbox').fill('E2E-W004');
    await page.getByTestId('revisao-sortear').click();
    await expect(page.getByTestId('revisao-aviso')).toContainText('semente E2E-W004: 4 de 24');
    const linhaSorteio = page.getByTestId('tabela-sorteios').locator('tbody tr').first();
    await linhaSorteio.locator('[data-testid^="conferir-sorteio-"]').click();
    await expect(page.getByTestId('revisao-aviso')).toContainText('amostra igual; universo de altas igual');
    await semViolacaoAxe(page, '/qualidade/gestao/revisao-prontuarios (sorteio)');

    // Revisão: o primeiro prontuário do médico SINT.MEDICO (registro 501) com o sumário não conforme.
    const prontuarios = page.getByTestId('tabela-prontuarios');
    await expect(prontuarios.locator('tbody tr')).toHaveCount(4);
    const linha = prontuarios.locator('tbody tr', { hasText: 'MEDICO SINTETICO' }).first();
    const reg = (await linha.locator('td').nth(1).innerText()).trim();
    await linha.getByTestId(`revisar-${reg}`).click();
    const d = page.getByTestId('dialogo-correcao');
    await expect(d.getByTestId('correcao-confirmar')).toBeDisabled();
    for (const item of [
      'identificacao',
      'anamnese',
      'evolucao-diaria',
      'prescricao',
      'exames',
      'consentimento',
      'assinatura',
    ])
      await d.getByTestId(`resultado-${item}-conforme`).check();
    await d.getByTestId('resultado-sumario-alta-naoConforme').check();
    await d.getByTestId('observacao-sumario-alta').getByRole('textbox').fill('Sem as orientações de alta.');
    await semViolacaoAxe(page, '/qualidade/gestao/revisao-prontuarios (revisar)');
    await d.getByTestId('correcao-confirmar').click();
    await expect(d).toBeHidden();
    await expect(linha).toContainText('Não conforme');
    await expect(linha).toContainText('Item não conforme: Sumário de alta');
    await expect(linha.getByTestId(`dar-aval-${reg}`)).toHaveCount(0);

    // O médico responde a própria pendência.
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/qualidade/revisao-prontuarios/minhas-pendencias');
    const minhas = page.getByTestId('minhas-lista');
    await expect(minhas).toContainText(reg);
    await minhas.locator('[data-testid^="responder-"]').first().click();
    await page
      .getByTestId('resposta-texto')
      .getByRole('textbox')
      .fill('Orientações de alta incluídas no sumário.');
    await semViolacaoAxe(page, '/qualidade/revisao-prontuarios/minhas-pendencias (responder)');
    await page.getByTestId('resposta-enviar').click();
    await expect(page.getByTestId('minhas-aviso')).toContainText('Resposta enviada');

    // A comissão dá o aval com a senha; depois dele a revisão não se corrige mais.
    await entrar(page, 'SINT.QUALIDADE');
    await page.goto('/qualidade/gestao/revisao-prontuarios');
    await escolher(page.getByTestId('revisao-comissao'), { rotulo: nome });
    await page
      .getByTestId('tabela-sorteios')
      .locator('tbody tr')
      .first()
      .locator('[data-testid^="abrir-sorteio-"]')
      .click();
    const l2 = page.getByTestId(`prontuario-${reg}`);
    await expect(l2).toContainText('Respondida');
    await l2.getByTestId(`dar-aval-${reg}`).click();
    await confirmarDialogo(page, null, true);
    await expect(page.getByTestId(`aval-${reg}`)).toContainText('SINT.QUALIDADE');
    await expect(l2.getByTestId(`revisar-${reg}`)).toHaveCount(0);

    // A conformidade por clínica com a conta.
    await page.getByTestId('revisao-aba-indicador').click();
    await expect(page.getByTestId('conformidade-total')).toContainText('0 ÷ 1 × 100 = 0%');
    await semViolacaoAxe(page, '/qualidade/gestao/revisao-prontuarios (conformidade)');
    expect(externas).toEqual([]);
  });
});
