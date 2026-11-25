// E2E @C2-110 (03-PEP L145): doação e transplante de órgãos no prontuário, no que a fonte sintética permite.
// 1) Sessão real: o médico abre o prontuário do paciente sintético, segue o atalho "Transplante" e chega à tela; na
//    fonte sintética (sem cliente padrão) a leitura GET /api/pep/transplante/paciente/:id responde 503 e a tela mostra
//    o erro sem inventar doação nem inscrição.
// 2) API simulada (massa sintética): a doação em aberto mostra a pendência de notificar a central; o formulário do
//    doador valida na hora (autorização sem quem respondeu trava o gravar); a oferta do rim ao receptor da lista vai
//    com o corpo e a chave de idempotência; o passo do destino; o acompanhamento do receptor transplantado com D+n e a
//    suspeita de rejeição em destaque. O que fica no banco está provado no contrato de efeito
//    apps/api/src/modulos/pep/transplante-clinico-propria.int.spec.ts (MariaDB) e as regras em
//    packages/dominio-pep/src/transplante.spec.ts. axe sem violação séria.
import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

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

const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const OPCOES = {
  orgaos: [
    { id: 1, codigo: 'rim', descricao: 'Rim', tipo: 'orgao', quantidadePorDoador: 2 },
    { id: 2, codigo: 'figado', descricao: 'Fígado', tipo: 'orgao', quantidadePorDoador: 1 },
  ],
  parentescos: [{ id: 5, descricao: 'Cônjuge' }],
};
const nulos = (campos: string[]) => Object.fromEntries(campos.map((c) => [c, null]));
const DOACAO = {
  id: 40,
  versao: 2,
  tipo: 'falecido',
  situacao: 'apto',
  encerrada: false,
  consentimento: 'autorizado',
  consentimentoEm: '2026-11-24T10:00:00.000Z',
  responsavelConsentimento: 'Familiar sintético',
  parentesco: { id: 5, descricao: 'Cônjuge' },
  morteEncefalicaEm: '2026-11-24T08:00:00.000Z',
  teveParadaCardiaca: false,
  ...nulos([
    'registroCentral',
    'causaInternacao',
    'causaMorte',
    'internadoEm',
    'diasTerapiaIntensiva',
    'pesoKg',
    'alturaCm',
    'pressaoArterial',
    'frequenciaCardiaca',
    'saturacao',
    'paradaDescricao',
    'aminasVasoativas',
    'cirurgiasPrevias',
    'nutricao',
    'diagnosticoDiferencial',
    'captacaoEm',
    'meioLocomocao',
    'procedimentoInicioEm',
    'procedimentoFimEm',
    'clampeamentoEm',
    'tipoPerfusao',
    'observacao',
    'fechadoEm',
  ]),
  pendencias: [
    {
      codigo: 'notificar-central',
      mensagem:
        'Morte encefálica confirmada: a notificação à central estadual é compulsória (Decreto 9.175/2017).',
    },
  ],
  antibioticos: [
    { id: 1, versao: 1, sequencia: 1, descricao: 'Antibiótico sintético', inicio: '2026-11-20', fim: null },
  ],
  preservacoes: [],
  destinos: [
    {
      id: 70,
      versao: 1,
      doador: 40,
      receptor: 81,
      prontuarioReceptor: '900002',
      prontuarioDoador: '900001',
      orgao: { id: 2, descricao: 'Fígado' },
      situacao: 'ofertado',
      doadorVivoParente: false,
      observacao: null,
    },
  ],
};
const INSCRICAO = {
  id: 60,
  versao: 3,
  orgao: { id: 1, descricao: 'Rim' },
  cadastradoEm: '2026-01-10',
  situacao: 'transplantado',
  naLista: false,
  apto: true,
  motivoAptidao: null,
  aptidaoAlteradaEm: null,
  urgencia: false,
  numeroRegistroCentral: null,
  numeroCadastroNacional: null,
  transplantadoEm: '2026-11-15',
  doador: 33,
  centroHemodialise: null,
  tipoDialise: 'hemodialise',
  tipoAcessoDialise: null,
  outrosResultados: null,
  acompanhamentos: [
    {
      id: 1,
      sequencia: 1,
      observadoEm: '2026-11-20',
      dias: 5,
      tipo: 'suspeita_rejeicao',
      descricao: 'Achado sintético',
      destaque: true,
      profissional: null,
    },
  ],
  destinos: [],
};

async function simular(page: Page, enviados: Enviado[], doacao: typeof DOACAO = DOACAO): Promise<void> {
  await page.route(
    (u) => u.pathname.startsWith('/api/pep/transplante'),
    (rota) => {
      const r = rota.request();
      const u = new URL(r.url());
      const caminho = u.pathname.replace('/api/pep/transplante', '');
      if (r.method() === 'GET') {
        if (caminho === '/opcoes') return json(rota, OPCOES);
        if (caminho === `/paciente/${PACIENTE}`)
          return json(rota, { doacoes: [doacao], inscricoes: [INSCRICAO] });
        // A lista de receptores só vem a partir da doação (o doador vai na consulta).
        if (caminho === '/receptores' && u.searchParams.get('doador') === String(doacao.id))
          return json(rota, [
            {
              id: 80,
              paciente: 2002,
              prontuario: '900003',
              cadastradoEm: '2026-02-01',
              situacao: 'ativo',
              apto: true,
              urgencia: true,
              numeroRegistroCentral: null,
            },
          ]);
        return json(rota, { codigo: 'nao-encontrado' }, 404);
      }
      enviados.push(enviadoDe(caminho.slice(1), r));
      return json(rota, {
        ok: true,
        resultado: { id: 99, versao: 1 },
        repetida: false,
        mensagem: 'Gravado.',
      });
    },
  );
}

test.describe('Doação e transplante de órgãos @C2-110 @fase8', () => {
  test.setTimeout(120_000);

  test('atalho do prontuário leva à tela; sem o banco do cliente, a tela mostra o erro e não grava; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');
    await page.goto(`/pep/paciente/${PACIENTE}/linha-do-tempo`);
    await expect(page.getByTestId('tela-prontuario-paciente')).toBeVisible();
    const leitura = page.waitForResponse((r) =>
      r.url().includes(`/api/pep/transplante/paciente/${PACIENTE}`),
    );
    await page.getByTestId('atalho-transplante').click();
    await expect(page).toHaveURL(new RegExp(`/pep/paciente/${PACIENTE}/transplante$`));
    expect((await leitura).status()).toBe(503);
    const tela = page.getByTestId('transplante-tela');
    await expect(tela).toBeVisible();
    await expect(tela.getByTestId('mensagem-erro').first()).toBeVisible();
    await expect(page.locator('article[data-testid^="transplante-doacao-"]')).toHaveCount(0);
    await expect(page.locator('article[data-testid^="transplante-inscricao-"]')).toHaveCount(0);
    await semViolacaoAxe(page, '/pep/paciente/:id/transplante (sem o banco do cliente)');
    expect(externas).toEqual([]);
  });

  test('pendência, validação na hora, oferta do órgão, passo do destino e acompanhamento (API simulada); axe', async ({
    page,
  }) => {
    const enviados: Enviado[] = [];
    await entrar(page, 'SINT.MEDICO');
    await simular(page, enviados);
    await page.goto(`/pep/paciente/${PACIENTE}/transplante`);
    const tela = page.getByTestId('transplante-tela');
    await expect(tela.getByTestId('transplante-doacao-40')).toBeVisible();
    await esperarSemSelectNativo(tela);
    await expect(tela.getByTestId('transplante-pendencia-notificar-central')).toBeVisible();

    // Formulário do doador: autorização sem quem respondeu trava o gravar (regra do domínio, na hora).
    await tela.getByTestId('transplante-editar-40').click();
    const form = tela.getByTestId('transplante-form-doador');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('transplante-falhas-doador')).toHaveCount(0);
    await form.getByLabel('Quem respondeu pela família').fill('');
    await expect(form.getByTestId('transplante-falhas-doador')).toContainText('quem respondeu pela família');
    await expect(form.getByTestId('transplante-gravar-doador')).toBeDisabled();
    await form.getByLabel('Quem respondeu pela família').fill('Familiar sintético');
    await form.getByLabel('Número na central estadual').fill('CET-SINT-9');
    await form.getByTestId('transplante-gravar-doador').click();
    await expect.poll(() => enviados.filter((e) => e.rota === 'doador').length).toBe(1);
    const doador = enviados.find((e) => e.rota === 'doador')!;
    expect(doador.corpo).toMatchObject({
      id: 40,
      versao: 2,
      registroCentral: 'CET-SINT-9',
      situacao: 'apto',
    });
    expect(doador.chave).toBeTruthy();

    // Oferta do rim ao receptor da lista (urgência primeiro).
    const oferta = tela.getByTestId('transplante-form-oferta');
    await escolher(oferta.getByTestId('transplante-oferta-orgao'), { rotulo: 'Rim' });
    await escolher(oferta.getByTestId('transplante-oferta-receptor'), { rotulo: /900003/ });
    await oferta.getByTestId('transplante-ofertar').click();
    await expect.poll(() => enviados.filter((e) => e.rota === 'destino').length).toBe(1);
    expect(enviados.find((e) => e.rota === 'destino')!.corpo).toMatchObject({
      doador: 40,
      receptor: 80,
      orgao: 1,
      doadorVivoParente: false,
    });

    // Passo do destino: o ofertado pode ser aceito; o transplante só depois do aceite.
    await expect(tela.getByTestId('transplante-destino-70-transplantado')).toHaveCount(0);
    await tela.getByTestId('transplante-destino-70-aceito').click();
    await expect.poll(() => enviados.filter((e) => e.rota === 'destino').length).toBe(2);
    expect(enviados.filter((e) => e.rota === 'destino')[1]!.corpo).toEqual({
      id: 70,
      versao: 1,
      situacao: 'aceito',
    });

    // Receptor transplantado: D+n, suspeita de rejeição em destaque e o acompanhamento novo.
    const inscricao = tela.getByTestId('transplante-inscricao-60');
    await expect(inscricao.getByTestId('transplante-acompanhamento-1')).toContainText('D+5');
    await expect(inscricao.getByTestId('transplante-acompanhamento-1')).toHaveClass(/tx__destaque/);
    const acomp = inscricao.getByTestId('transplante-form-acompanhamento');
    await expect(acomp.getByTestId('transplante-incluir-acompanhamento')).toBeDisabled();
    await acomp.getByLabel('Descrição').fill('Febre baixa sintética');
    await acomp.getByTestId('transplante-incluir-acompanhamento').click();
    await expect.poll(() => enviados.filter((e) => e.rota === 'acompanhamento').length).toBe(1);
    expect(enviados.find((e) => e.rota === 'acompanhamento')!.corpo).toMatchObject({
      receptor: 60,
      observadoEm: hoje,
      tipo: 'sintoma',
      descricao: 'Febre baixa sintética',
    });
    await semViolacaoAxe(page, '/pep/paciente/:id/transplante (API simulada)');
  });

  test('o fígado do doador já aceito em outro receptor não pode ser aceito de novo (API simulada)', async ({
    page,
  }) => {
    const enviados: Enviado[] = [];
    const outro = {
      ...DOACAO.destinos[0]!,
      id: 71,
      receptor: 82,
      prontuarioReceptor: '900004',
      situacao: 'aceito',
    };
    await entrar(page, 'SINT.MEDICO');
    await simular(page, enviados, { ...DOACAO, destinos: [...DOACAO.destinos, outro] });
    await page.goto(`/pep/paciente/${PACIENTE}/transplante`);
    const tela = page.getByTestId('transplante-tela');
    await expect(tela.getByTestId('transplante-destino-70')).toBeVisible();
    // Fígado: quantidade 1 por doador; o ofertado só pode ser recusado ou descartado.
    await expect(tela.getByTestId('transplante-destino-70-aceito')).toHaveCount(0);
    await expect(tela.getByTestId('transplante-destino-70-recusado')).toBeVisible();
    expect(enviados).toEqual([]);
  });
});
