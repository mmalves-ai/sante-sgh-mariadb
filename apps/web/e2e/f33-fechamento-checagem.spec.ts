// F3.3 (03-PEP L113): fechamento da checagem do turno pelo caminho da tela, na linha do tempo do turno.
// O fechamento grava só no banco próprio, e o E2E roda com a fonte sintética (sem núcleo, a rota responde 501). Por isso
// as respostas das rotas do fechamento são simuladas pelo Playwright com massa SINTÉTICA; a linha do tempo do turno
// vem da fonte sintética. O que se prova é a tela: os pendentes recebidos do turno anterior aparecem antes de fechar,
// a justificativa é pedida na hora, o fechamento por paciente envia o atendimento escolhido, o histórico mostra o
// paciente, os pendentes passados adiante e a justificativa, e a reabertura pede o motivo e fica no histórico. O efeito
// no banco (trava, composição, pendente que volta no turno seguinte, recusa da checagem do horário travado) está no
// contrato de efeito apps/api/src/modulos/enfermagem/fechamento-checagem.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
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

interface Fechamento {
  id: number;
  atendimento: number | null;
  inicio: string;
  fim: string;
  horarios: number;
  situacao: 'fechado' | 'reaberto';
  fechadoEm: string;
  fechadoPor: string | null;
  reabertoEm: string | null;
  motivoReabertura: string | null;
  justificativaPendencias: string | null;
  anterior: boolean;
  travados: number[];
  pendentes: { horario: number; atendimento: number; previsto: string; anterior: boolean }[];
}

test.describe('fechamento da checagem do turno (03-PEP L113) @F33', () => {
  test('recebidos do turno anterior, fechamento por paciente com justificativa, histórico e reabertura com motivo', async ({
    page,
  }) => {
    const anterior: Fechamento = {
      id: 801,
      atendimento: null,
      inicio: '2026-11-23T19:00',
      fim: '2026-11-24T07:00',
      horarios: 3,
      situacao: 'fechado',
      fechadoEm: '2026-11-24T06:55',
      fechadoPor: 'sint.enf.noite',
      reabertoEm: null,
      motivoReabertura: null,
      justificativaPendencias: 'Paciente no centro de imagem, dose passada ao plantão seguinte',
      anterior: true,
      travados: [9001, 9002, 9003],
      pendentes: [{ horario: 9004, atendimento: 0, previsto: '2026-11-24T06:00', anterior: false }],
    };
    const fechamentos: Fechamento[] = [anterior];
    const pedidos: Record<string, unknown>[] = [];
    await page.route('**/api/enfermagem/fechamento-checagem**', async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') return json(rota, { itens: fechamentos });
      const corpo = req.postDataJSON() as Record<string, unknown>;
      const reabrir = /\/(\d+)\/reabertura$/.exec(url.pathname);
      if (reabrir) {
        const f = fechamentos.find((x) => x.id === Number(reabrir[1]))!;
        Object.assign(f, {
          situacao: 'reaberto',
          reabertoEm: '2026-11-24T10:05',
          motivoReabertura: String(corpo['motivo']),
        });
        return json(rota, { ok: true, id: f.id, horarios: f.horarios, mensagem: 'Fechamento reaberto.' });
      }
      pedidos.push(corpo);
      const atendimento = (corpo['atendimento'] as number | null) ?? null;
      fechamentos.unshift({
        id: 802,
        atendimento,
        inicio: '2026-11-24T07:00',
        fim: '2026-11-24T19:00',
        horarios: 2,
        situacao: 'fechado',
        fechadoEm: '2026-11-24T10:00',
        fechadoPor: 'sint.enf.plantao',
        reabertoEm: null,
        motivoReabertura: null,
        justificativaPendencias: String(corpo['justificativa'] ?? ''),
        anterior: false,
        travados: [9010, 9011],
        pendentes: [
          { horario: 9004, atendimento: atendimento ?? 0, previsto: '2026-11-24T06:00', anterior: true },
        ],
      });
      return json(
        rota,
        {
          ok: true,
          id: 802,
          travados: 2,
          pendentes: [9004],
          pendentesAnteriores: [9004],
          mensagem: 'Turno fechado.',
        },
        201,
      );
    });

    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto('/enfermagem/turno');
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    const bloco = page.getByTestId('turno-fechamento');
    await expect(bloco).toBeVisible();
    // Os pendentes passados pelo turno anterior aparecem antes de fechar.
    await expect(page.getByTestId('turno-fechamento-recebidos')).toBeVisible();
    await expect(page.getByTestId('turno-fechamento-recebido-9004')).toContainText('06:00');

    // Fechamento por paciente: o primeiro paciente do turno (a opção 0 é o setor inteiro).
    await escolher(page.getByTestId('turno-fechamento-escopo'), { indice: 1 });
    const justificativa = page.getByTestId('turno-fechamento-justificativa');
    await justificativa.fill('curta');
    await expect(bloco.getByText('Escreva ao menos 10 caracteres.')).toBeVisible();
    await justificativa.fill('Dose das 06:00 segue pendente, paciente no exame de imagem');
    await page.getByTestId('turno-fechamento-fechar').click();
    await expect.poll(() => pedidos.length).toBe(1);
    expect(pedidos[0]).toMatchObject({
      unidade: 'UTI',
      justificativa: 'Dose das 06:00 segue pendente, paciente no exame de imagem',
      atendimento: expect.any(Number),
    });

    // O histórico mostra o paciente, o pendente passado adiante e a justificativa.
    const novo = page.getByTestId('turno-fechamento-802');
    await expect(novo).toContainText('Paciente:');
    await expect(page.getByTestId('turno-fechamento-passados-802')).toContainText('06:00');
    await expect(novo).toContainText('Dose das 06:00 segue pendente');
    await semViolacaoAxe(page, '/enfermagem/turno (fechamento)');

    // A reabertura pede o motivo (mínimo de 10 caracteres) e fica no histórico.
    await page.getByTestId('turno-fechamento-reabrir-802').click();
    await page.getByTestId('turno-fechamento-motivo').fill('curto');
    await expect(page.getByTestId('turno-fechamento-confirmar-reabertura')).toBeDisabled();
    await page.getByTestId('turno-fechamento-motivo').fill('Checagem lançada no paciente errado');
    await page.getByTestId('turno-fechamento-confirmar-reabertura').click();
    await expect(novo).toHaveAttribute('data-situacao', 'reaberto');
    await expect(novo).toContainText('Checagem lançada no paciente errado');
  });
});
