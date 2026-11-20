// Regra 3 do M46 (etapa 1; ficha, seção 8: `ficha.autorizacao.int-spec`): a ficha anestésica é assinada só pelo médico com
// o papel de anestesista NA CIRURGIA (Lei 12.842/2013; CFM 2.174/2017). Pela HTTP, com as portas em memória (dados
// SINTÉTICOS): o cirurgião tem a opção da ficha no perfil, lê e lança, mas a assinatura é recusada com 403
// (`ficha-nao-e-anestesista`) e a negação vai à trilha; a enfermagem do bloco não lança nem assina (sem a opção); a
// passagem só pelo responsável do momento e para outro profissional, que entra na linha de responsabilidade; o anestesista que abriu a ficha assina com a senha.
import { EVENTOS_AUDITAVEIS, PERMISSOES_ANESTESIA_CODIGOS } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppAnestesia, HOJE, montarAppAnestesia, SENHA, sinais } from '../anestesia.spec-util.js';

let a: AppAnestesia;
beforeAll(async () => {
  a = await montarAppAnestesia();
});
afterAll(async () => {
  await a.fechar();
});

const AG = 702;
const D = HOJE;

describe('regra 3: só o anestesista da cirurgia assina', () => {
  it('o cirurgião é recusado com a negação na trilha; a passagem dá a assinatura a quem recebeu', async () => {
    const anest = await a.entrar('SINT.ANESTESISTA');
    const cir = await a.entrar('SINT.CIRURGIAO');
    const enf = await a.entrar('SINT.ENF.BLOCO');
    const outro = await a.entrar('SINT.ANESTESISTA2');
    // O anestesista abre a ficha (o primeiro responsável) e registra a anestesia inteira.
    for (const [marco, h] of [
      ['entradaSala', '08:00'],
      ['inicioAnestesia', '08:05'],
    ] as const)
      expect(
        (await a.post(anest, `/${AG}/ficha/marcos`, { agendamento: AG, marco, momento: `${D}T${h}` }))
          .statusCode,
      ).toBe(201);
    expect(
      (
        await a.post(anest, `/${AG}/ficha/lancamentos`, {
          agendamento: AG,
          lancamentos: [...sinais(`${D}T08:05`), ...sinais(`${D}T08:10`)],
        })
      ).statusCode,
    ).toBe(201);
    // O cirurgião (com a opção da ficha) lança; a enfermagem do bloco não tem a opção.
    expect(
      (
        await a.post(cir, `/${AG}/ficha/lancamentos`, {
          agendamento: AG,
          lancamentos: [{ parte: 'evento', momento: `${D}T08:11`, evento: 'intubacao' }],
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await a.post(enf, `/${AG}/ficha/lancamentos`, { agendamento: AG, lancamentos: sinais(`${D}T08:12`) }))
        .statusCode,
    ).toBe(403);
    // A passagem: só o responsável do momento; nunca para si mesmo.
    const passar = (s: typeof anest, para: { id: number; cod: number }, momento: string) =>
      a.post(s, `/${AG}/ficha/passagem`, {
        agendamento: AG,
        momento: `${D}T${momento}`,
        para,
        resumo: 'Paciente estável, sevoflurano a 2%, sem intercorrências.',
      });
    expect((await passar(cir, { id: 5005, cod: 9005 }, '08:12')).json().codigo).toBe(
      'ficha-passagem-nao-responsavel',
    );
    expect((await passar(anest, { id: 5002, cod: 9002 }, '08:12')).json().codigo).toBe(
      'ficha-passagem-mesmo-anestesista',
    );
    expect((await passar(anest, { id: 5002, cod: 1 }, '08:12')).statusCode).toBe(400);
    // Revisão do M46.1: só médico recebe a anestesia (o instrumentador 5004 não é); na equipe, idem com a função de
    // anestesista (com outra função, entra).
    const naoMedico = await passar(anest, { id: 5004, cod: 9004 }, '08:12');
    expect(naoMedico.statusCode).toBe(400);
    expect(naoMedico.json().codigo).toBe('ficha-anestesista-nao-medico');
    const equipe = (funcao: number) =>
      a.post(anest, `/${AG}/ficha/lancamentos`, {
        agendamento: AG,
        lancamentos: [
          { parte: 'equipe', momento: `${D}T08:12`, profissional: { id: 5004, cod: 9004 }, funcao },
        ],
      });
    expect((await equipe(6)).json().codigo).toBe('ficha-anestesista-nao-medico');
    expect((await equipe(2)).statusCode).toBe(201);
    expect((await passar(anest, { id: 5005, cod: 9005 }, '08:12')).statusCode).toBe(201);
    expect(
      (
        await a.post(anest, `/${AG}/ficha/marcos`, {
          agendamento: AG,
          marco: 'fimAnestesia',
          momento: `${D}T08:15`,
        })
      ).statusCode,
    ).toBe(201);
    const t = (await a.get(anest, `/${AG}/ficha`)).json();
    expect(t.ficha.responsaveis.map((r: { anestesista: number }) => r.anestesista)).toEqual([5002, 5005]);
    expect(t.ficha.pendenciasAssinatura).toEqual([]);
    // Uma passagem para quem não é médico gravada por outro caminho (sem a conferência da API): mesmo na linha de
    // responsabilidade, o instrumentador (com a opção de assinar no perfil) é recusado com 403 e a tela diz por quê.
    a.anestesia.semearPassagem(AG, 5005, 5004, `${D}T08:13`);
    const instr = await a.entrar('SINT.INSTRUMENTADOR');
    expect((await a.get(instr, `/${AG}/ficha`)).json().ficha.pendenciasAssinatura).toEqual([
      'ficha-nao-e-anestesista',
    ]);
    const ri = await a.post(instr, `/${AG}/ficha/assinatura`, {
      agendamento: AG,
      versao: t.ficha.versao,
      senha: SENHA,
    });
    expect(ri.statusCode).toBe(403);
    expect(ri.json().codigo).toBe('ficha-nao-e-anestesista');
    // O cirurgião não é anestesista da cirurgia: 403 e a negação na trilha (o recurso da assinatura).
    const antes = a.trilha.eventos.length;
    const r = await a.post(cir, `/${AG}/ficha/assinatura`, {
      agendamento: AG,
      versao: t.ficha.versao,
      senha: SENHA,
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('ficha-nao-e-anestesista');
    const negacao = a.trilha.eventos
      .slice(antes)
      .find((e) => e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo);
    expect(negacao).toMatchObject({
      recurso: PERMISSOES_ANESTESIA_CODIGOS.fichaAssinar,
      resultado: 'falha',
      usuario: 'SINT.CIRURGIAO',
    });
    // Para a sessão do cirurgião a tela diz por quê; o anestesista sem registro na cirurgia também não assina.
    expect((await a.get(cir, `/${AG}/ficha`)).json().ficha.pendenciasAssinatura).toEqual([
      'ficha-nao-e-anestesista',
    ]);
    expect(
      (
        await a.post(outro, `/${AG}/ficha/assinatura`, {
          agendamento: AG,
          versao: t.ficha.versao,
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(403);
    // A enfermagem não tem a permissão de assinar (a guarda nega antes).
    expect(
      (
        await a.post(enf, `/${AG}/ficha/assinatura`, {
          agendamento: AG,
          versao: t.ficha.versao,
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(403);
    // A senha errada não assina; o anestesista que abriu (e teve a responsabilidade) assina com a senha.
    expect(
      (
        await a.post(anest, `/${AG}/ficha/assinatura`, {
          agendamento: AG,
          versao: t.ficha.versao,
          senha: 'errada',
        })
      ).statusCode,
    ).toBe(401);
    const ok = await a.post(anest, `/${AG}/ficha/assinatura`, {
      agendamento: AG,
      versao: t.ficha.versao,
      senha: SENHA,
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(
      a.trilha.eventos.some(
        (e) =>
          e.evento === EVENTOS_AUDITAVEIS.fichaAnestesicaAssinada.codigo && e.usuario === 'SINT.ANESTESISTA',
      ),
    ).toBe(true);
  });
});
