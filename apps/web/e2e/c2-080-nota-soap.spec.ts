// E2E @C2-080 (03-PEP L98): nota clínica em quatro partes (subjetivo, objetivo, avaliação e plano) codificada, e a
// configuração dela na administração do PEP. Atendimentos, configuração, termos (CID-10 e CIAP-2) e notas moram só no
// banco do cliente; o E2E roda sobre a fonte sintética, então:
// 1. sem simulação, a leitura GET /api/pep/nota-soap/paciente/:id responde 503 e a tela mostra o erro sem inventar
//    formulário (o atalho do prontuário leva à tela);
// 2. com as respostas da API simuladas pelo Playwright (massa SINTÉTICA), prova-se a tela: as partes obrigatórias e o
//    CID-10 da avaliação travam a assinatura na hora; a CIAP-2 escolhida sugere o CID-10 pela correspondência e um
//    clique completa o código; no pré-natal, a idade gestacional e a data provável do parto saem da data da última
//    menstruação; "Assinar" guarda e assina num clique (corpo e chave de idempotência conferidos); o rascunho volta à
//    edição; a nota assinada só fica sem efeito com justificativa;
// 3. a configuração por estabelecimento e especialidade (SINT.ADMIN): combos, combinação repetida e regra do domínio
//    travam o gravar na hora; incluir e alterar (com a versão) enviam o corpo conferido.
// O efeito no banco está no contrato de efeito apps/api/src/modulos/pep/nota-soap-propria.int.spec.ts e a regra em
// packages/dominio-pep/src/nota-soap.spec.ts. axe sem violação séria.
import { expect, type Page, type Request, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;

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

interface Enviado {
  rota: string;
  corpo: Record<string, unknown>;
  chave: string | null;
}
const enviadoDe = (rota: string, r: Request): Enviado => ({
  rota,
  corpo: r.postDataJSON() as Record<string, unknown>,
  chave: r.headers()['idempotency-key'] ?? null,
});

const CONFIG = {
  id: 9,
  estabelecimentoId: 3,
  especialidadeId: null,
  ativo: true,
  exigeSubjetivo: false,
  exigeObjetivo: false,
  exigeAvaliacao: true,
  exigePlano: true,
  usaCiap: true,
  exigeCidAvaliacao: true,
};
const K86 = { id: 701, sistema: 'ciap2', codigo: 'K86', descricao: 'HIPERTENSAO SINTETICA SEM COMPLICACAO' };
const I10 = { id: 702, sistema: 'cid10', codigo: 'I10', descricao: 'HIPERTENSAO ESSENCIAL SINTETICA' };
const I15 = { id: 703, sistema: 'cid10', codigo: 'I15', descricao: 'HIPERTENSAO SECUNDARIA SINTETICA' };
const notaBase = {
  atendimento: 801,
  criticidade: null,
  dataUltimaMenstruacao: null,
  dataProvavelParto: null,
  idadeGestacionalDias: null,
  edema: null,
  objetivo: null,
};
const PAINEL = {
  atendimentos: [
    {
      id: 801,
      numero: 'AT-SINT-801',
      entradaEm: '2026-11-20T10:00:00Z',
      situacao: 'aberto',
      configuracao: CONFIG,
    },
  ],
  notas: [
    {
      ...notaBase,
      id: 51,
      versao: 2,
      tipo: 'consulta',
      situacao: 'assinada',
      registradaEm: '2026-11-20T10:30:00Z',
      assinadaEm: '2026-11-20T10:40:00Z',
      autor: 'MEDICO SINTETICO B',
      podeEditar: false,
      subjetivo: 'Cefaleia sintética.',
      avaliacao: 'Hipertensão sintética.',
      plano: 'Retorno sintético.',
      codigos: [
        {
          sequencia: 1,
          parte: 'avaliacao',
          ciap: K86,
          cid: I10,
          nota: null,
          incluirListaProblemas: true,
          problema: 91,
        },
      ],
    },
    {
      ...notaBase,
      id: 52,
      versao: 1,
      tipo: 'retorno',
      situacao: 'rascunho',
      registradaEm: '2026-11-21T09:00:00Z',
      assinadaEm: null,
      autor: 'MEDICO SINTETICO',
      podeEditar: true,
      subjetivo: 'Rascunho sintético.',
      avaliacao: null,
      plano: null,
      codigos: [],
    },
  ],
};

async function simularNota(page: Page, enviados: Enviado[]): Promise<void> {
  await page.route(
    (u) => u.pathname.startsWith('/api/pep/nota-soap'),
    (rota) => {
      const r = rota.request();
      const u = new URL(r.url());
      const caminho = u.pathname.replace('/api/pep/nota-soap', '');
      if (r.method() === 'GET') {
        if (caminho === `/paciente/${PACIENTE}`) return json(rota, PAINEL);
        if (caminho === '/termos') {
          const sistema = u.searchParams.get('sistema');
          return json(rota, sistema === 'ciap2' ? [K86] : [I10, I15]);
        }
        if (caminho === `/correspondencia/${K86.id}`) return json(rota, [I10, I15]);
        return json(rota, { title: 'não simulado' }, 404);
      }
      if (caminho === '') {
        enviados.push(enviadoDe('criar', r));
        return json(rota, { ok: true, resultado: { nota: 61, versao: 1, avisos: '' } });
      }
      if (caminho === '/assinar') {
        enviados.push(enviadoDe('assinar', r));
        return json(rota, { ok: true, resultado: { nota: 61, versao: 2, avisos: '' } });
      }
      if (caminho === '/sem-efeito') {
        enviados.push(enviadoDe('sem-efeito', r));
        return json(rota, { ok: true, resultado: { nota: 51, versao: 3, avisos: '' } });
      }
      return json(rota, { title: 'não simulado' }, 404);
    },
  );
}

const OPCOES = {
  estabelecimentos: [
    { id: 3, nome: 'HOSPITAL SINTETICO A' },
    { id: 4, nome: 'HOSPITAL SINTETICO B' },
  ],
  especialidades: [{ id: 12, nome: 'CLINICA SINTETICA' }],
};
const LISTA_CONFIG = [{ ...CONFIG, descricao: 'Ambulatório sintético A', versao: 2 }];

async function simularConfiguracao(page: Page, enviados: Enviado[]): Promise<void> {
  await page.route('**/api/pep/nota-soap/configuracoes/opcoes', (r) => json(r, OPCOES));
  await page.route('**/api/pep/nota-soap/configuracoes', (rota) => {
    const r = rota.request();
    if (r.method() === 'GET') return json(rota, LISTA_CONFIG);
    enviados.push(enviadoDe('configurar', r));
    const id = (r.postDataJSON() as { id: number | null }).id;
    return json(rota, {
      ok: true,
      resultado: { id: id ?? 10, versao: id ? 3 : 1 },
      mensagem: 'Configuração da nota gravada.',
    });
  });
}

test.describe('Nota clínica S.O.A.P. codificada @C2-080 @fase8', () => {
  test.setTimeout(120_000);

  test('atalho do prontuário leva à nota; sem o banco do cliente, a tela mostra o erro e não grava; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');

    await page.goto(`/pep/paciente/${PACIENTE}/linha-do-tempo`);
    await expect(page.getByTestId('tela-prontuario-paciente')).toBeVisible();

    const leitura = page.waitForResponse((r) => r.url().includes(`/api/pep/nota-soap/paciente/${PACIENTE}`));
    await page.getByTestId('atalho-nota-soap').click();
    await expect(page).toHaveURL(new RegExp(`/pep/paciente/${PACIENTE}/nota-soap$`));
    expect((await leitura).status()).toBe(503);

    const tela = page.getByTestId('nota-soap-tela');
    await expect(tela).toBeVisible();
    await expect(tela.getByTestId('mensagem-erro').first()).toBeVisible();
    await expect(page.getByTestId('nota-soap-form')).toHaveCount(0);
    await expect(page.locator('article[data-testid^="nota-soap-registrada-"]')).toHaveCount(0);
    await expect(page.getByTestId('nota-soap-ok')).toHaveCount(0);

    await semViolacaoAxe(page, '/pep/paciente/:id/nota-soap (sem o banco do cliente)');
    expect(externas).toEqual([]);
  });

  test('assinatura travada na hora, CIAP-2 com CID sugerido, gestação pela DUM, assinar num clique e sem efeito', async ({
    page,
  }) => {
    const enviados: Enviado[] = [];
    await entrar(page, 'SINT.MEDICO');
    await simularNota(page, enviados);
    await page.goto(`/pep/paciente/${PACIENTE}/nota-soap`);

    const form = page.getByTestId('nota-soap-form');
    await expect(form).toBeVisible();
    await expect(page.getByTestId('nota-soap-registrada-51')).toContainText('K86 → I10');
    // Avaliação e plano obrigatórios (marcados) e nada escrito: guardar e assinar travados.
    await expect(page.getByTestId('nota-soap-parte-avaliacao')).toContainText('obrigatória');
    await expect(page.getByTestId('nota-soap-parte-subjetivo')).not.toContainText('obrigatória');
    await expect(page.getByTestId('nota-soap-assinar')).toBeDisabled();
    await expect(page.getByTestId('nota-soap-guardar')).toBeDisabled();

    await page.getByTestId('nota-soap-texto-subjetivo').fill('Cefaleia há dois dias (sintético).');
    await page.getByTestId('nota-soap-texto-avaliacao').fill('Pressão alta sintética.');
    await page.getByTestId('nota-soap-texto-plano').fill('Retorno em 30 dias (sintético).');
    // O rascunho já pode ser guardado; a assinatura espera o CID-10 da avaliação.
    await expect(page.getByTestId('nota-soap-guardar')).toBeEnabled();
    await expect(page.getByTestId('nota-soap-pendencias')).toBeVisible();
    await expect(page.getByTestId('nota-soap-assinar')).toBeDisabled();

    // CIAP-2 ligada pela configuração: busca ao lado, um clique no termo e outro no CID sugerido.
    await escolher(page.getByTestId('nota-soap-sistema'), { rotulo: 'CIAP-2' });
    await page.getByTestId('nota-soap-buscar').fill('K86');
    await page.getByTestId('nota-soap-termo-K86').click();
    const sugeridos = page.getByTestId('nota-soap-sugeridos');
    await expect(sugeridos).toContainText('I10');
    await expect(sugeridos).toContainText('I15');
    await page.getByTestId('nota-soap-sugerido-I10').click();
    await expect(page.getByTestId('nota-soap-codigo-avaliacao-I10')).toContainText('K86');
    await expect(page.getByTestId('nota-soap-sugeridos')).toHaveCount(0);
    await expect(page.getByTestId('nota-soap-pendencias')).toHaveCount(0);
    await expect(page.getByTestId('nota-soap-assinar')).toBeEnabled();

    // Pré-natal: a assinatura pede a data da última menstruação; IG e DPP saem dela na hora.
    await escolher(page.getByTestId('nota-soap-tipo'), { rotulo: 'Pré-natal' });
    await expect(page.getByTestId('nota-soap-assinar')).toBeDisabled();
    const dum = new Date(Date.now() - 70 * 86_400_000).toISOString().slice(0, 10);
    const dpp = new Date(Date.parse(`${dum}T00:00:00Z`) + 280 * 86_400_000).toISOString().slice(0, 10);
    await page.getByTestId('nota-soap-dum').fill(dum);
    const ig = page.getByTestId('nota-soap-ig');
    await expect(ig).toContainText('10s 0d');
    await expect(ig).toContainText(dpp.split('-').reverse().join('/'));
    await expect(page.getByTestId('nota-soap-assinar')).toBeEnabled();

    // Guardar e assinar num clique: cria no atendimento escolhido e assina a versão devolvida.
    await page.getByTestId('nota-soap-assinar').click();
    await expect(page.getByTestId('nota-soap-ok')).toContainText('Nota assinada.');
    expect(enviados.map((e) => e.rota)).toEqual(['criar', 'assinar']);
    expect(enviados[0]!.corpo).toMatchObject({
      atendimento: 801,
      tipo: 'pre_natal',
      subjetivo: 'Cefaleia há dois dias (sintético).',
      objetivo: null,
      avaliacao: 'Pressão alta sintética.',
      plano: 'Retorno em 30 dias (sintético).',
      dataUltimaMenstruacao: dum,
      codigos: [{ parte: 'avaliacao', ciap: K86.id, cid: I10.id, incluirListaProblemas: true }],
    });
    expect(enviados[1]!.corpo).toEqual({ nota: 61, versao: 1 });
    expect(enviados[0]!.chave).toBeTruthy();
    expect(enviados[1]!.chave).toBeTruthy();
    expect(enviados[0]!.chave).not.toBe(enviados[1]!.chave);
    // Depois de assinar, o formulário volta limpo.
    await expect(page.getByTestId('nota-soap-texto-avaliacao')).toHaveValue('');

    // O rascunho do autor volta à edição.
    await page.getByTestId('nota-soap-editar-52').click();
    await expect(page.getByTestId('nota-soap-texto-subjetivo')).toHaveValue('Rascunho sintético.');
    await page.getByTestId('nota-soap-nova').click();

    // A nota assinada só fica sem efeito com justificativa (mínimo de 10 caracteres).
    await page.getByTestId('nota-soap-sem-efeito-51').click();
    const confirmar = page.getByTestId('nota-soap-confirmar-sem-efeito-51');
    await expect(confirmar).toBeDisabled();
    await page.getByTestId('nota-soap-justificativa-51').fill('curta');
    await expect(confirmar).toBeDisabled();
    await page.getByTestId('nota-soap-justificativa-51').fill('Registrada no paciente errado (sintético).');
    await expect(confirmar).toBeEnabled();
    await confirmar.click();
    await expect(page.getByTestId('nota-soap-ok')).toContainText('sem efeito');
    expect(enviados[2]).toMatchObject({
      rota: 'sem-efeito',
      corpo: { nota: 51, versao: 2, justificativa: 'Registrada no paciente errado (sintético).' },
    });
    expect(enviados[2]!.chave).toBeTruthy();

    await semViolacaoAxe(page, '/pep/paciente/:id/nota-soap (simulada)');
  });

  test('configuração por estabelecimento e especialidade: repetida e regra travam na hora; incluir e alterar', async ({
    page,
  }) => {
    const enviados: Enviado[] = [];
    await entrar(page, 'SINT.ADMIN');
    await simularConfiguracao(page, enviados);
    await page.goto('/pep/admin/nota-soap');

    await expect(page.getByTestId('nota-soap-config-tela')).toBeVisible();
    await expect(page.getByTestId('nota-soap-config-9')).toContainText('HOSPITAL SINTETICO A');
    const form = page.getByTestId('nota-soap-config-form');
    await expect(form).toBeVisible();
    const gravar = page.getByTestId('nota-soap-config-gravar');

    await page.getByTestId('nota-soap-config-descricao').fill('Clínica sintética do hospital A');
    // Mesma combinação da configuração 9 (hospital A, todas as especialidades): repetida, gravar travado.
    await escolher(page.getByTestId('nota-soap-config-estabelecimento'), { rotulo: 'HOSPITAL SINTETICO A' });
    await expect(page.getByTestId('nota-soap-config-falhas')).toContainText('Já existe configuração');
    await expect(gravar).toBeDisabled();
    await escolher(page.getByTestId('nota-soap-config-especialidade'), { rotulo: 'CLINICA SINTETICA' });
    await expect(page.getByTestId('nota-soap-config-falhas')).toHaveCount(0);
    await expect(gravar).toBeEnabled();

    // Regra do domínio: o CID-10 obrigatório fica na avaliação.
    await page.getByTestId('nota-soap-config-exige-avaliacao').uncheck();
    await expect(page.getByTestId('nota-soap-config-falhas')).toContainText('CID-10');
    await expect(gravar).toBeDisabled();
    await page.getByTestId('nota-soap-config-exige-avaliacao').check();
    await page.getByTestId('nota-soap-config-usa-ciap').check();
    await expect(gravar).toBeEnabled();

    await gravar.click();
    await expect(page.getByTestId('nota-soap-config-ok')).toContainText('Configuração gravada.');
    expect(enviados[0]!.corpo).toEqual({
      id: null,
      versao: null,
      estabelecimento: 3,
      especialidade: 12,
      descricao: 'Clínica sintética do hospital A',
      exigeSubjetivo: false,
      exigeObjetivo: false,
      exigeAvaliacao: true,
      exigePlano: true,
      usaCiap: true,
      exigeCidAvaliacao: true,
      ativo: true,
    });
    expect(enviados[0]!.chave).toBeTruthy();

    // Alterar a existente: leva o id e a versão; desligar a CIAP-2 na unidade.
    await page.getByTestId('nota-soap-config-editar-9').click();
    await expect(page.getByTestId('nota-soap-config-descricao')).toHaveValue('Ambulatório sintético A');
    await page.getByTestId('nota-soap-config-usa-ciap').uncheck();
    await gravar.click();
    await expect(page.getByTestId('nota-soap-config-ok')).toBeVisible();
    expect(enviados[1]!.corpo).toMatchObject({
      id: 9,
      versao: 2,
      estabelecimento: 3,
      especialidade: null,
      usaCiap: false,
    });

    await semViolacaoAxe(page, '/pep/admin/nota-soap (simulada)');
  });
});
