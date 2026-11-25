// E2E @F3.9-03 (01-ADM L75, ficha F3.9): a manutenção das regras de alerta em `/administracao/alertas`. A leitura e a
// gravação das regras só existem no banco do cliente (na fonte sintética respondem 503 e a manutenção some), então
// este E2E simula `/api/administracao/notificacao-regras*` com um estado em memória que segue a regra do servidor
// (código único, versão que sobe a cada gravação, regra de todos os estabelecimentos sem mudança de conteúdo). O que
// fica no banco é provado nos contratos de efeito `notificacao-regra-painel.int.spec.ts` e
// `notificacao-regra-propria.int.spec.ts`; aqui se prova o fluxo da tela: a regra conferida enquanto se digita (a
// mesma função do domínio), perfis por marcação e usuário por login, gravar, desativar num clique na linha com a regra
// voltando inteira, e a regra global com o conteúdo travado. Dados sintéticos. Axe em cada passo.
import { expect, type Page, type Route, test } from '@playwright/test';
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

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
const recusa = (rota: Route, codigo: string, detail: string) =>
  rota.fulfill({
    status: 409,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: `urn:sgh:erro:${codigo}`, title: detail, status: 409, detail, codigo }),
  });

interface Regra {
  id: number;
  versao: number;
  codigo: string;
  nome: string;
  cenario: string;
  mensagem: string;
  gravidade: string;
  repeticao: string;
  ativo: boolean;
  editavel: boolean;
  consolidacao: string | null;
  numeroVersao: number;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  notifica: { tela: boolean; email: boolean; sms: boolean; aplicativo: boolean };
  destinatarios: { tipo: string; codigo: string }[];
  descricao: string | null;
  bloqueante: boolean;
  exigeJustificativa: boolean;
  sexo: string;
  idadeMinima: number | null;
  idadeMaxima: number | null;
  intervaloMinutos: number | null;
  global: boolean;
  conteudoEditavel: boolean;
}

test.describe('administração: regras de alerta @F3.9-03 @fase3', () => {
  test.setTimeout(180_000);

  test('regra nova conferida na hora, gravada com perfil e usuário; desativar na linha; regra global travada; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const base = {
      consolidacao: null,
      vigenciaFim: null,
      notifica: { tela: true, email: false, sms: false, aplicativo: false },
      editavel: true,
    };
    const regras: Regra[] = [
      {
        ...base,
        id: 1,
        versao: 4,
        codigo: 'SINT.QUEDA',
        nome: 'RISCO DE QUEDA SINTETICO',
        cenario: 'SINT_INTERNACAO',
        mensagem: 'PACIENTE SINTETICO COM RISCO DE QUEDA',
        gravidade: 'critico',
        repeticao: 'intervalo',
        ativo: true,
        numeroVersao: 2,
        vigenciaInicio: '2026-01-01',
        destinatarios: [{ tipo: 'perfil', codigo: 'SINT_ENFERMAGEM' }],
        descricao: 'DESCRICAO SINTETICA',
        bloqueante: true,
        exigeJustificativa: true,
        sexo: 'todos',
        idadeMinima: 65,
        idadeMaxima: null,
        intervaloMinutos: 120,
        global: false,
        conteudoEditavel: true,
      },
      {
        ...base,
        id: 2,
        versao: 1,
        codigo: 'SINT.GLOBAL',
        nome: 'REGRA SINTETICA DE TODOS',
        cenario: 'SINT_FATURA',
        mensagem: 'AVISO SINTETICO GERAL',
        gravidade: 'atencao',
        repeticao: 'sempre',
        ativo: true,
        numeroVersao: 1,
        vigenciaInicio: '2026-01-01',
        destinatarios: [],
        descricao: null,
        bloqueante: false,
        exigeJustificativa: false,
        sexo: 'todos',
        idadeMinima: null,
        idadeMaxima: null,
        intervaloMinutos: null,
        global: true,
        conteudoEditavel: false,
      },
    ];
    const painel = () => ({
      regras: [...regras].sort((a, b) => a.nome.localeCompare(b.nome)),
      consolidacoes: [],
      cenarios: [
        { codigo: 'SINT_FATURA', descricao: 'Fechamento da fatura (sintético)' },
        { codigo: 'SINT_INTERNACAO', descricao: 'Internação (sintético)' },
      ],
      canais: [{ codigo: 'CENTRAL', descricao: 'Central de avisos', tipo: 'central', externo: false }],
      perfis: [
        { codigo: 'SINT_ENFERMAGEM', nome: 'Enfermagem (sintético)' },
        { codigo: 'SINT_FATURAMENTO', nome: 'Faturamento (sintético)' },
      ],
    });
    const corpos: Record<string, unknown>[] = [];
    const chaves: string[] = [];

    await page.route('**/api/administracao/notificacao-regras', (rota) => json(rota, painel()));
    await page.route('**/api/administracao/notificacao-regras/regras-alerta', async (rota) => {
      const pedido = rota.request();
      const c = pedido.postDataJSON() as Record<string, unknown>;
      corpos.push(c);
      chaves.push(pedido.headers()['idempotency-key'] ?? '');
      const destinatarios = c['destinatarios'] as { tipo: string; codigo: string }[];
      const conteudo = {
        codigo: String(c['codigo']),
        nome: String(c['nome']),
        cenario: String(c['cenario']),
        mensagem: String(c['mensagem']),
        gravidade: String(c['gravidade']),
        repeticao: String(c['repeticao']),
        consolidacao: (c['consolidacao'] as string | null) ?? null,
        vigenciaInicio: String(c['vigenciaInicio']),
        vigenciaFim: (c['vigenciaFim'] as string | null) ?? null,
        notifica: {
          tela: c['notificaTela'] === true,
          email: c['notificaEmail'] === true,
          sms: c['notificaSms'] === true,
          aplicativo: c['notificaAplicativo'] === true,
        },
        descricao: (c['descricao'] as string | null) ?? null,
        bloqueante: c['bloqueante'] === true,
        exigeJustificativa: c['exigeJustificativa'] === true,
        sexo: String(c['sexo']),
        idadeMinima: (c['idadeMinima'] as number | null) ?? null,
        idadeMaxima: (c['idadeMaxima'] as number | null) ?? null,
        intervaloMinutos: (c['intervaloMinutos'] as number | null) ?? null,
      };
      if (c['ativo'] === true && destinatarios.length === 0)
        return recusa(rota, 'regra-sem-destinatario', 'A regra ativa precisa de ao menos um destinatário.');
      if (typeof c['id'] === 'number') {
        const r = regras.find((x) => x.id === c['id']);
        if (!r) return recusa(rota, 'regra-inexistente', 'Regra de alerta não encontrada.');
        if (r.versao !== c['versao']) return recusa(rota, 'versao-divergente', 'A regra mudou; recarregue.');
        const mudou = (Object.keys(conteudo) as (keyof typeof conteudo)[]).some(
          (k) => JSON.stringify(conteudo[k]) !== JSON.stringify(r[k]),
        );
        if (r.global) {
          if (mudou) return recusa(rota, 'regra-global', 'Esta regra vale para todos os estabelecimentos.');
          // Só o registro do estabelecimento: situação e destinatários; a regra não ganha versão.
          Object.assign(r, { ativo: c['ativo'] === true, destinatarios });
          return json(rota, { resultado: { regra: r.id, numeroVersao: r.numeroVersao }, repetida: false });
        }
        Object.assign(r, conteudo, {
          ativo: c['ativo'] === true,
          destinatarios,
          versao: r.versao + 1,
          numeroVersao: r.numeroVersao + 1,
        });
        return json(rota, { resultado: { regra: r.id, numeroVersao: r.numeroVersao }, repetida: false });
      }
      if (regras.some((x) => x.codigo === conteudo.codigo))
        return recusa(rota, 'codigo-duplicado', 'Já existe regra de alerta com este código.');
      const nova: Regra = {
        ...conteudo,
        id: regras.length + 1,
        versao: 1,
        ativo: c['ativo'] === true,
        editavel: true,
        numeroVersao: 1,
        destinatarios,
        global: false,
        conteudoEditavel: true,
      };
      regras.push(nova);
      return json(rota, { resultado: { regra: nova.id, numeroVersao: 1 }, repetida: false });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/alertas');
    await expect(page.getByTestId('regras-tabela')).toBeVisible();
    await expect(page.getByTestId('regra-situacao-SINT.QUEDA')).toHaveText('Ativa');
    await expect(page.getByTestId('regra-SINT.QUEDA')).toContainText('Internação (sintético)');
    await expect(page.getByTestId('regra-SINT.QUEDA')).toContainText('1 perfil(is), 0 usuário(s)');
    await semViolacaoAxe(page, '/administracao/alertas (lista de regras)');

    // Regra nova: a pendência aparece enquanto se digita e o botão só libera sem pendência.
    await page.getByTestId('regra-nova').click();
    const pendencia = page.getByTestId('regra-pendencia');
    const gravar = page.getByTestId('regra-gravar');
    await expect(pendencia).toContainText('O código usa letras');
    await expect(gravar).toBeDisabled();
    await page.getByTestId('regra-codigo').fill('SINT.QUEDA');
    await expect(pendencia).toContainText('Informe o nome.');
    await page.getByTestId('regra-nome').fill('ALTA SINTETICA PENDENTE');
    await expect(pendencia).toContainText('Escolha onde o alerta dispara.');
    await escolher(page.getByTestId('regra-cenario'), 'SINT_FATURA');
    await expect(pendencia).toContainText('Informe a mensagem do alerta.');
    await page.getByTestId('regra-mensagem').fill('CONTA SINTETICA SEM FECHAMENTO');
    await expect(pendencia).toContainText('ao menos um destinatário');
    await page.getByTestId('regra-perfil-SINT_FATURAMENTO').check();
    await expect(pendencia).toHaveCount(0);
    await escolher(page.getByTestId('regra-repeticao'), 'intervalo');
    await expect(pendencia).toContainText('precisa dos minutos do intervalo');
    await page.getByTestId('regra-intervalo').fill('30');
    await expect(pendencia).toHaveCount(0);
    await page.getByTestId('regra-idade-minima').fill('40');
    await page.getByTestId('regra-idade-maxima').fill('18');
    await expect(pendencia).toContainText('A idade máxima não pode ser menor que a mínima.');
    await page.getByTestId('regra-idade-maxima').fill('');
    await page.getByTestId('regra-idade-minima').fill('');
    await page.getByTestId('regra-usuario').fill('com espaco');
    await page.getByTestId('regra-usuario-incluir').click();
    await expect(page.getByText('Login inválido.')).toBeVisible();
    await page.getByTestId('regra-usuario').fill('sint.medico');
    await page.getByTestId('regra-usuario').press('Enter');
    await expect(page.getByTestId('regra-usuarios')).toContainText('SINT.MEDICO');
    await page.getByTestId('regra-canal-email').check();
    await semViolacaoAxe(page, '/administracao/alertas (regra nova preenchida)');

    // O código já existe: o servidor recusa, o formulário fica aberto com o que foi digitado.
    await expect(gravar).toBeEnabled();
    await gravar.click();
    await expect(page.getByText('Já existe regra de alerta com este código.')).toBeVisible();
    await expect(page.getByTestId('regra-nome')).toHaveValue('ALTA SINTETICA PENDENTE');
    await page.getByTestId('regra-codigo').fill('SINT.ALTA');
    await gravar.click();
    await expect(page.getByTestId('regras-aviso')).toContainText(
      'Regra ALTA SINTETICA PENDENTE gravada (versão 1).',
    );
    await expect(page.getByTestId('form-regra-alerta')).toHaveCount(0);
    const linha = page.getByTestId('regra-SINT.ALTA');
    await expect(linha).toContainText('Fechamento da fatura (sintético)');
    await expect(linha).toContainText('Central de avisos, E-mail');
    await expect(linha).toContainText('1 perfil(is), 1 usuário(s)');
    expect(corpos[1]).toEqual({
      codigo: 'SINT.ALTA',
      nome: 'ALTA SINTETICA PENDENTE',
      cenario: 'SINT_FATURA',
      descricao: null,
      mensagem: 'CONTA SINTETICA SEM FECHAMENTO',
      gravidade: 'atencao',
      bloqueante: false,
      exigeJustificativa: false,
      sexo: 'todos',
      idadeMinima: null,
      idadeMaxima: null,
      repeticao: 'intervalo',
      intervaloMinutos: 30,
      notificaTela: true,
      notificaEmail: true,
      notificaSms: false,
      notificaAplicativo: false,
      consolidacao: null,
      vigenciaInicio: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      vigenciaFim: null,
      ativo: true,
      destinatarios: [
        { tipo: 'perfil', codigo: 'SINT_FATURAMENTO' },
        { tipo: 'usuario', codigo: 'SINT.MEDICO' },
      ],
    });
    // Cada envio tem a própria chave de idempotência.
    expect(new Set(chaves).size).toBe(chaves.length);

    // Desativar num clique na linha: a regra volta inteira como foi lida, só a situação muda.
    await page.getByTestId('regra-situacao-trocar-SINT.QUEDA').click();
    await expect(page.getByTestId('regras-aviso')).toContainText(
      'Regra RISCO DE QUEDA SINTETICO desativada.',
    );
    await expect(page.getByTestId('regra-situacao-SINT.QUEDA')).toHaveText('Inativa');
    expect(corpos[2]).toEqual({
      id: 1,
      versao: 4,
      codigo: 'SINT.QUEDA',
      nome: 'RISCO DE QUEDA SINTETICO',
      cenario: 'SINT_INTERNACAO',
      descricao: 'DESCRICAO SINTETICA',
      mensagem: 'PACIENTE SINTETICO COM RISCO DE QUEDA',
      gravidade: 'critico',
      bloqueante: true,
      exigeJustificativa: true,
      sexo: 'todos',
      idadeMinima: 65,
      idadeMaxima: null,
      repeticao: 'intervalo',
      intervaloMinutos: 120,
      notificaTela: true,
      notificaEmail: false,
      notificaSms: false,
      notificaAplicativo: false,
      consolidacao: null,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      ativo: false,
      destinatarios: [{ tipo: 'perfil', codigo: 'SINT_ENFERMAGEM' }],
    });

    // Alterar: a mensagem muda com motivo; a versão sobe.
    await page.getByTestId('regra-alterar-SINT.QUEDA').click();
    await expect(page.getByTestId('regra-codigo')).toBeDisabled();
    await page.getByTestId('regra-mensagem').fill('RISCO DE QUEDA: REAVALIAR (SINTETICO)');
    await page.getByTestId('regra-ativa').check();
    await page.getByTestId('regra-motivo').fill('Texto revisto (sintético)');
    await gravar.click();
    await expect(page.getByTestId('regras-aviso')).toContainText('gravada (versão 4).');
    expect(corpos[3]).toMatchObject({
      id: 1,
      versao: 5,
      mensagem: 'RISCO DE QUEDA: REAVALIAR (SINTETICO)',
      ativo: true,
      motivo: 'Texto revisto (sintético)',
      idadeMinima: 65,
      bloqueante: true,
    });

    // Regra de todos os estabelecimentos: o conteúdo fica travado; aqui se escolhe quem recebe e a situação.
    await page.getByTestId('regra-alterar-SINT.GLOBAL').click();
    await expect(page.getByTestId('regra-travada')).toContainText('vale para todos os estabelecimentos');
    await expect(page.getByTestId('regra-nome')).toBeDisabled();
    await expect(page.getByTestId('regra-mensagem')).toBeDisabled();
    await expect(page.getByTestId('regra-motivo')).toHaveCount(0);
    await expect(pendencia).toContainText('ao menos um destinatário');
    await page.getByTestId('regra-perfil-SINT_ENFERMAGEM').check();
    await semViolacaoAxe(page, '/administracao/alertas (regra global travada)');
    await gravar.click();
    await expect(page.getByTestId('regras-aviso')).toContainText('Regra REGRA SINTETICA DE TODOS gravada');
    await expect(page.getByTestId('regra-SINT.GLOBAL')).toContainText('1 perfil(is), 0 usuário(s)');
    expect(corpos[4]).toMatchObject({
      id: 2,
      versao: 1,
      mensagem: 'AVISO SINTETICO GERAL',
      destinatarios: [{ tipo: 'perfil', codigo: 'SINT_ENFERMAGEM' }],
    });
    expect(corpos).toHaveLength(5);
    expect(externas).toEqual([]);
  });
});
