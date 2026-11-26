// E2E @C2-067 (F8, 02-AGE linha 50): agenda de grupos e turmas pelo caminho da tela (`/agenda/turmas`). O gestor cria a
// turma (validação na hora: idade invertida recusada antes de gravar), abre a turma, grava a escala semanal, gera os
// encontros, inscreve o paciente pela busca (vendo na hora as turmas de que ele já participa), registra a presença de
// todos numa lista (falta justificada sem justificativa recusada na hora) e encerra a participação com o motivo. As
// turmas só existem no banco do cliente (na fonte sintética a API responde 503): as respostas são simuladas pelo
// Playwright com massa SINTÉTICA, no contrato do servidor. O efeito no banco está em
// apps/api/src/modulos/agenda/turma-atividade.int.spec.ts.
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

const OPCOES = {
  tipo: [{ id: 6701, nome: 'GRUPO TERAPEUTICO SINTETICO' }],
  itemAgendavel: [{ id: 6711, nome: 'SESSAO DE GRUPO SINTETICA' }],
  setorFuncional: [{ id: 6721, nome: 'AMBULATORIO SINTETICO' }],
  profissional: [{ id: 6731, nome: 'PROFISSIONAL SINTETICO C2067' }],
  fontePagadora: [{ id: 6741, nome: 'CONVENIO SINTETICO C2067' }],
  plano: [
    { id: 6745, nome: 'PLANO SINTETICO C2067', fontePagadora: 6741 },
    { id: 6746, nome: 'PLANO DE OUTRA FONTE', fontePagadora: 6742 },
  ],
  sexo: [{ id: 6751, nome: 'Feminino sintético' }],
};
const PACIENTE = {
  id: 6761,
  prontuario: 920671,
  nome: 'PACIENTE SINTETICO C2067',
  nomeSocial: null,
  nascimento: '1960-01-15',
  sexo: 'F',
  maeMascarada: null,
  cpfMascarado: null,
  telefoneMascarado: null,
  situacao: 'ativo',
  obito: false,
  homonimo: false,
};

function simular(page: Page) {
  const st = {
    turma: null as Record<string, unknown> | null,
    escalas: [] as Record<string, unknown>[],
    encontros: [] as Record<string, unknown>[],
    participantes: [] as Record<string, unknown>[],
    corpos: [] as { url: string; corpo: Record<string, unknown> }[],
  };
  const resumo = () =>
    st.turma
      ? [
          {
            id: 6801,
            versao: 1,
            codigo: st.turma['codigo'],
            descricao: st.turma['descricao'],
            tipo: 'GRUPO TERAPEUTICO SINTETICO',
            dataInicio: st.turma['dataInicio'],
            dataFim: st.turma['dataFim'],
            vagas: st.turma['vagas'],
            vagasEncaixe: st.turma['vagasEncaixe'],
            ocupadas: st.participantes.filter((p) => p['situacao'] !== 'em_espera').length,
            espera: 0,
            proximoEncontro: st.encontros.length ? '2030-03-05 14:00' : null,
            ativo: true,
          },
        ]
      : [];
  const ok = (r: Route, resultado: Record<string, unknown>, mensagem: string) =>
    json(r, { ok: true, resultado, repetida: false, mensagem });
  void page.route('**/api/cadastros/pacientes?**', (r) =>
    json(r, { tipo: 'nome', itens: [PACIENTE], sugestoes: [], truncado: false, duracaoMs: 3 }),
  );
  void page.route('**/api/agenda/turmas**', (r) => {
    const url = new URL(r.request().url());
    const caminho = url.pathname.replace('/api/agenda/turmas', '');
    if (r.request().method() === 'GET') {
      if (caminho === '/opcoes') return json(r, OPCOES);
      if (caminho === '') return json(r, resumo());
      if (caminho.startsWith('/paciente/')) return json(r, []);
      if (caminho.startsWith('/encontros/'))
        return json(r, {
          encontro: st.encontros[0],
          participantes: st.participantes.map((p) => ({
            participante: p['id'],
            nome: p['nome'],
            situacao: null,
            justificativa: null,
            acompanhante: false,
          })),
        });
      return json(r, {
        turma: { id: 6801, versao: 1, ...st.turma },
        escalas: st.escalas,
        encontros: st.encontros,
        participantes: st.participantes,
      });
    }
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    st.corpos.push({ url: url.pathname, corpo });
    if (caminho === '') {
      st.turma = corpo;
      return ok(r, { turma: 6801 }, 'Turma criada.');
    }
    if (caminho === '/6801') {
      st.turma = corpo;
      return ok(r, { turma: 6801 }, 'Turma gravada.');
    }
    if (caminho.endsWith('/escalas')) {
      st.escalas.push({ ...corpo, id: 6811, versao: 1, turma: 6801 });
      return ok(r, { escala: 6811 }, 'Escala da turma gravada.');
    }
    if (caminho.endsWith('/encontros/gerar')) {
      st.encontros = ['2030-03-05', '2030-03-19'].map((data, i) => ({
        id: 6821 + i,
        versao: 1,
        data,
        horaInicio: '14:00',
        horaFim: '15:30',
        situacao: 'previsto',
        motivoCancelamento: null,
        presencas: 0,
      }));
      return ok(r, { turma: 6801, gerados: 2, existentes: 0, feriados: 1 }, '2 encontro(s) gerado(s).');
    }
    if (caminho.endsWith('/participantes')) {
      st.participantes.push({
        id: 6831,
        versao: 1,
        paciente: PACIENTE.id,
        nome: PACIENTE.nome,
        prontuario: PACIENTE.prontuario,
        fontePagadora: 'CONVENIO SINTETICO C2067',
        situacao: 'inscrito',
        posicaoEspera: null,
        inscritoEm: '2030-03-01',
        desligadoEm: null,
        motivoDesligamento: null,
        frequencia: null,
      });
      return ok(
        r,
        { participante: 6831, situacao: 'inscrito', posicaoEspera: null, aviso: null },
        'Paciente inscrito.',
      );
    }
    if (caminho.endsWith('/presencas')) {
      st.encontros[0] = { ...st.encontros[0], situacao: 'realizado', presencas: 1 };
      st.participantes[0] = { ...st.participantes[0], situacao: 'ativo', frequencia: 100 };
      return ok(r, { encontro: 6821, registradas: 1 }, 'Presença registrada.');
    }
    if (caminho.endsWith('/sair')) {
      st.participantes[0] = {
        ...st.participantes[0],
        situacao: 'desistente',
        desligadoEm: '2030-03-20',
        motivoDesligamento: corpo['motivo'],
      };
      return ok(r, { participante: 6831, promovido: null, promovidos: 0 }, 'Participação encerrada.');
    }
    return json(r, { title: 'não simulado' }, 404);
  });
  return st;
}

test.describe('@C2-067 agenda de grupos e turmas', () => {
  test('cria a turma, gera os encontros, inscreve, registra a presença e encerra a participação', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const externas = vigiarExternas(page);
    const st = simular(page);
    await entrar(page, 'SINT.AGENDA');
    await page.goto('/agenda/turmas');
    await expect(page.getByTestId('turmas-vazio')).toBeVisible();

    // Cadastro: idade invertida é recusada na hora; corrigida, grava.
    await page.getByTestId('turma-nova').click();
    const edicao = page.getByTestId('turma-edicao');
    await page.getByTestId('turma-codigo').locator('input, textarea').first().fill('GRP-HAS');
    await page.getByTestId('turma-descricao').locator('input, textarea').first().fill('GRUPO SINTETICO');
    await escolher(edicao.getByLabel('Tipo de turma'), '6701');
    await escolher(edicao.getByLabel('Item marcado para o participante'), '6711');
    await escolher(edicao.getByLabel('Setor', { exact: true }), '6721');
    await page.getByTestId('turma-vagas').locator('input, textarea').first().fill('2');
    await page.getByTestId('turma-add-prof').click();
    await escolher(edicao.getByLabel('Profissional', { exact: true }), '6731');
    // Fonte aceita só por um plano dela, com limite: o combo de plano mostra só os planos da fonte escolhida.
    await page.getByTestId('turma-add-fonte').click();
    await escolher(edicao.getByLabel('Fonte pagadora'), '6741');
    await escolher(edicao.getByLabel('Plano'), '6745');
    await page.getByTestId('turma-idade-min').locator('input, textarea').first().fill('60');
    await page.getByTestId('turma-idade-max').locator('input, textarea').first().fill('18');
    await expect(page.getByTestId('turma-recusa')).toContainText('idade máxima');
    await expect(page.getByTestId('turma-gravar')).toBeDisabled();
    await page.getByTestId('turma-idade-min').locator('input, textarea').first().fill('18');
    await page.getByTestId('turma-idade-max').locator('input, textarea').first().fill('90');
    await expect(page.getByTestId('turma-recusa')).toHaveCount(0);
    await page.getByTestId('turma-gravar').click();
    await expect(page.getByTestId('turmas-mensagem')).toHaveText('Turma criada.');
    expect(st.corpos[0]).toMatchObject({
      url: '/api/agenda/turmas',
      corpo: {
        codigo: 'GRP-HAS',
        tipo: 6701,
        itemAgendavel: 6711,
        setorFuncional: 6721,
        vagas: 2,
        idadeMinimaAnos: 18,
        idadeMaximaAnos: 90,
        profissionais: [{ profissional: 6731, principal: true }],
        fontes: [{ fontePagadora: 6741, plano: 6745, limite: null }],
      },
    });

    // Escala e geração dos encontros.
    await page.getByTestId('turma-abrir-6801').click();
    await expect(page.getByTestId('turma-detalhe')).toBeVisible();
    // Editar e gravar de novo preserva o plano da fonte aceita (nada de fonte retirada e recriada sem plano).
    await page.getByTestId('turma-editar').click();
    await page.getByTestId('turma-gravar').click();
    await expect(page.getByTestId('turmas-mensagem')).toHaveText('Turma gravada.');
    expect(st.corpos.at(-1)).toMatchObject({
      url: '/api/agenda/turmas/6801',
      corpo: { versao: 1, fontes: [{ fontePagadora: 6741, plano: 6745, limite: null }] },
    });
    await page.getByTestId('escala-fim').locator('input, textarea').first().fill('13:00');
    await expect(page.getByTestId('escala-recusa')).toContainText('depois do início');
    await page.getByTestId('escala-fim').locator('input, textarea').first().fill('15:30');
    await page.getByTestId('escala-gravar').click();
    await expect(page.getByTestId('turmas-mensagem')).toHaveText('Escala da turma gravada.');
    await expect(page.getByTestId('turma-escalas')).toContainText('14:00–15:30');
    const datas = page
      .getByTestId('turma-detalhe')
      .locator('.filtros')
      .filter({ has: page.getByTestId('encontros-gerar') });
    await datas.getByLabel('De').fill('01/03/2030');
    await datas.getByLabel('Até').fill('31/03/2030');
    // A data confirma ao sair do campo (blur): sem isso o botão segue desabilitado.
    await datas.getByLabel('Até').press('Tab');
    await page.getByTestId('encontros-gerar').click();
    await expect(page.getByTestId('turmas-mensagem')).toHaveText('2 encontro(s) gerado(s).');
    await expect(page.getByTestId('turma-encontros')).toContainText('05/03/2030');

    // Inscrição pela busca do paciente.
    await page.getByTestId('inscricao-busca').locator('input, textarea').first().fill('SINTETICO');
    await page.getByTestId('inscricao-buscar').click();
    await page.getByTestId(`inscricao-paciente-${PACIENTE.id}`).click();
    await expect(page.getByTestId('turmas-do-paciente')).toContainText('não participa');
    await escolher(page.getByTestId('turma-inscricao').getByLabel('Fonte pagadora'), '6741');
    await escolher(page.getByTestId('turma-inscricao').getByLabel('Plano'), '6745');
    await page.getByTestId('inscricao-confirmar').click();
    await expect(page.getByTestId('turmas-mensagem')).toHaveText('Paciente inscrito.');
    expect(st.corpos.at(-1)).toMatchObject({
      url: '/api/agenda/turmas/6801/participantes',
      corpo: { paciente: PACIENTE.id, fontePagadora: 6741, plano: 6745, encaixe: false },
    });

    // Presença: falta justificada sem justificativa é recusada na hora; todos presentes grava.
    await page.getByTestId('encontro-presenca-6821').click();
    const linha = page.getByTestId('presenca-linha-6831');
    await escolher(linha.getByLabel('Presença'), 'falta_justificada');
    await expect(page.getByTestId('presenca-gravar')).toBeDisabled();
    await page.getByTestId('presenca-todos').click();
    await page.getByTestId('presenca-gravar').click();
    await expect(page.getByTestId('turmas-mensagem')).toHaveText('Presença registrada.');
    expect(st.corpos.at(-1)).toMatchObject({
      url: '/api/agenda/turmas/encontros/6821/presencas',
      corpo: { registros: [{ participante: 6831, situacao: 'presente', justificativa: null }] },
    });
    await expect(page.getByTestId('participante-6831')).toContainText('100%');

    // Saída com motivo.
    await page.getByTestId('participante-sair-6831').click();
    await expect(page.getByTestId('saida-confirmar')).toBeDisabled();
    await page.getByTestId('saida-motivo').locator('input, textarea').first().fill('Mudou de cidade');
    await page.getByTestId('saida-confirmar').click();
    await expect(page.getByTestId('turmas-mensagem')).toHaveText('Participação encerrada.');
    expect(st.corpos.at(-1)).toMatchObject({
      url: '/api/agenda/turmas/participantes/6831/sair',
      corpo: { versao: 1, saida: 'desistente', motivo: 'Mudou de cidade' },
    });
    await expect(page.getByTestId('participante-6831')).toContainText('saiu em 20/03/2030');

    await semViolacaoAxe(page, 'agenda de grupos e turmas');
    expect(externas).toEqual([]);
  });
});
