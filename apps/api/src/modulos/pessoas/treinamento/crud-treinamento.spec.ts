// W0-06, parte 2 (programa CRUD completo): as correções do treinamento, com motivo.
//   - alterar a turma ABERTA (o valor anterior fica na trilha da gestão de pessoas); a encerrada recusa;
//   - retirar a inscrição feita por engano; com presença lançada, 409 `inscricao-com-presenca`, que oferece a correção
//     da presença (aceite 3); a retirada guarda o retrato antes de apagar;
//   - corrigir a presença e o aproveitamento já lançados, também na turma encerrada, com o valor anterior na trilha.
// Portas EM MEMÓRIA; dados SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import type { ChaveLiberacao, PrerequisitoRecurso } from '../../config/configuracao-fonte.js';
import { PortaPessoasMemoria } from '../porta-memoria.js';
import { PortaTreinamentoMemoria } from './porta-treinamento-memoria.js';
import { ServicoTreinamento } from './servico-treinamento.js';

const chave = (c: string): ChaveLiberacao => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoRecurso => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});

const ctx = { cliente: 'teste', estabelecimento: 1, usuario: null, correlacao: 'crud-treinamento' };
let k = 0;
const sessao = (login: string, pode: (c: string) => boolean = () => true): SessaoCadastro =>
  ({
    req: { headers: { 'idempotency-key': `w006-trein-${++k}` }, ip: '127.0.0.1', sgh: undefined },
    hospital: 'aa',
    rede: '',
    login,
    porta: ctx,
    pode,
  }) as unknown as SessaoCadastro;

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ErroProblema) return String(e.extras?.['codigo'] ?? e.tipo);
    return `outro: ${(e as Error).message}`;
  }
}

const MOTIVO = 'Lançado por engano na reunião de equipe';

async function montar() {
  const trilha = new RegistradorTrilhaMemoria();
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => [chave('pessoas.treinamento')],
    prerequisitosIniciais: () => [cumprido('pessoas.treinamento')],
  });
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-11-25';
  const porta = new PortaTreinamentoMemoria(pessoas);
  porta.agoraFixo = '2026-11-25T10:00';
  // Os vínculos sintéticos 901 e 902 (admitidos em 2025), sem passar pelo cadastro.
  porta.vinculos = async (...[, ids]) =>
    ids.map((id) => ({
      id,
      nome: `COLABORADOR SINTETICO ${id}`,
      matricula: null,
      cargo: 'Técnico de enfermagem',
      funcao: null,
      unidade: 1,
      admissao: '2025-01-10',
      desligamento: null,
    }));
  const servico = new ServicoTreinamento(porta, pessoas, trilha, config, null);
  const turma = await porta.gravarSgh(ctx, {} as never, async (g) => {
    const curso = await g.incluirCurso({
      codigo: 'NR32',
      titulo: 'NR 32 sintético',
      conteudo: 'Conteúdo sintético',
      categoria: 'nr32',
      cargaMinimaMin: 60,
      validadeMeses: 12,
      obrigatorio: true,
      alvos: [{ tipo: 'funcao', valor: 'tecnico-de-enfermagem' }],
      por: 'SINT.TREIN',
    });
    const t = await g.incluirTurma({
      curso,
      inicio: '2026-11-20',
      fim: '2026-11-21',
      cargaMin: 120,
      instrutor: 'INSTRUTORA SINTETICA',
      modalidade: 'presencial',
      local: 'Auditório',
      pop: null,
      observacao: null,
      por: 'SINT.TREIN',
    });
    await g.incluirParticipante({ treinamento: t, vinculo: 901, por: 'SINT.TREIN' });
    await g.incluirParticipante({ treinamento: t, vinculo: 902, por: 'SINT.TREIN' });
    return t;
  });
  const participante = async (vinculo: number) =>
    (await porta.gravarSgh(ctx, {} as never, async (g) => g.participantes(turma))).find(
      (p) => p.vinculo === vinculo,
    )!;
  const versaoTurma = async () =>
    (await porta.gravarSgh(ctx, {} as never, async (g) => g.turma(turma)))!.versao;
  return { servico, porta, turma, participante, versaoTurma };
}

describe('correções do treinamento (W0-06, parte 2)', () => {
  it('o cadastro de cursos aceita unidade, todo o estabelecimento, POP e público não obrigatório', async () => {
    const porta = new PortaTreinamentoMemoria(new PortaPessoasMemoria());
    const base = {
      codigo: 'NR32X',
      titulo: 'NR 32 sintético',
      conteudo: 'Conteúdo sintético',
      categoria: 'nr32' as const,
      cargaMinimaMin: 60,
      validadeMeses: 12,
      obrigatorio: true,
      alvos: [{ tipo: 'funcao' as const, valor: 'tecnico-de-enfermagem' }],
      por: 'SINT.TREIN',
    };
    const incluir = (x: Partial<typeof base> & Record<string, unknown>) =>
      porta.gravarSgh(ctx, {} as never, (g) => g.incluirCurso({ ...base, ...x } as never));
    const cod = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: { problema?: { codigo?: string } }) => e.problema?.codigo ?? 'outro',
      );
    expect(await cod(incluir({ codigo: 'NR32A', alvos: [] }))).toBe('ok');
    expect(await cod(incluir({ codigo: 'NR32B', alvos: [{ tipo: 'unidade', valor: '1' }] as never }))).toBe(
      'ok',
    );
    expect(await cod(incluir({ codigo: 'NR32C', categoria: 'pop' as never }))).toBe('ok');
    expect(await cod(incluir({ codigo: 'NR32D', obrigatorio: false }))).toBe('ok');
    expect(await cod(incluir({}))).toBe('ok');
  });

  it('altera a turma aberta com motivo; o valor anterior aparece no histórico da turma', async () => {
    const { servico, turma, versaoTurma } = await montar();
    const s = sessao('SINT.TREIN');
    const r = await servico.alterarTurma(s, {
      treinamento: turma,
      inicio: '2026-11-22',
      fim: '2026-11-22',
      cargaMin: 180,
      instrutor: 'OUTRA INSTRUTORA',
      modalidade: 'em-servico',
      local: null,
      pop: null,
      observacao: null,
      motivo: MOTIVO,
      versao: await versaoTurma(),
    });
    expect(r.id).toBe(turma);
    const t = await servico.turma(s, turma);
    expect(t.inicio).toBe('2026-11-22');
    expect(t.correcoes ?? []).toHaveLength(1);
    expect(t.correcoes?.[0]).toMatchObject({
      operacao: 'pessoas.turma.alterada',
      motivo: MOTIVO,
      por: 'SINT.TREIN',
      antes: { inicio: '2026-11-20', cargaMin: 120, instrutor: 'INSTRUTORA SINTETICA' },
      depois: { inicio: '2026-11-22', cargaMin: 180, instrutor: 'OUTRA INSTRUTORA' },
    });
  });

  it('retira a inscrição feita por engano (sem presença); o retrato fica guardado', async () => {
    const { servico, porta, turma, participante } = await montar();
    const p = await participante(902);
    await servico.retirarInscricao(sessao('SINT.TREIN'), {
      treinamento: turma,
      vinculo: 902,
      motivo: MOTIVO,
      versao: p.versao,
    });
    const t = await servico.turma(sessao('SINT.TREIN'), turma);
    expect(t.lista.map((x) => x.vinculo)).toEqual([901]);
    expect(porta.retratos(ctx)).toEqual([expect.objectContaining({ vinculo: 902, motivo: MOTIVO })]);
  });

  it('inscrição com presença lançada: 409 que oferece a correção da presença; nada é apagado', async () => {
    const { servico, turma, participante } = await montar();
    const s = sessao('SINT.TREIN');
    await servico.registrarParticipacao(s, {
      treinamento: turma,
      vinculo: 901,
      presenca: 'ausente',
      aproveitamento: null,
      conclusao: null,
      observacao: null,
      versao: (await participante(901)).versao,
    });
    let erro: ErroProblema | null = null;
    try {
      await servico.retirarInscricao(s, {
        treinamento: turma,
        vinculo: 901,
        motivo: MOTIVO,
        versao: (await participante(901)).versao,
      });
    } catch (e) {
      erro = e as ErroProblema;
    }
    expect(erro?.getStatus()).toBe(409);
    expect(erro?.extras).toMatchObject({
      codigo: 'inscricao-com-presenca',
      avisos: ['Correção da presença'],
    });
    expect((await servico.turma(s, turma)).lista).toHaveLength(2);
  });

  it('corrige a presença e o aproveitamento na turma encerrada, com motivo e o valor anterior', async () => {
    const { servico, turma, participante, versaoTurma } = await montar();
    const s = sessao('SINT.TREIN');
    await servico.registrarParticipacao(s, {
      treinamento: turma,
      vinculo: 901,
      presenca: 'ausente',
      aproveitamento: null,
      conclusao: null,
      observacao: null,
      versao: (await participante(901)).versao,
    });
    // Sem presença lançada não há o que corrigir.
    expect(
      await codigo(
        servico.corrigirParticipacao(s, {
          treinamento: turma,
          vinculo: 902,
          presenca: 'presente',
          aproveitamento: null,
          conclusao: null,
          observacao: null,
          motivo: MOTIVO,
          versao: (await participante(902)).versao,
        }),
      ),
    ).toBe('sem-presenca');
    await servico.registrarParticipacao(s, {
      treinamento: turma,
      vinculo: 902,
      presenca: 'ausente',
      aproveitamento: null,
      conclusao: null,
      observacao: null,
      versao: (await participante(902)).versao,
    });
    await servico.encerrarTurma(s, { treinamento: turma, versao: await versaoTurma() });
    // A encerrada não se altera nem perde inscrição.
    expect(
      await codigo(
        servico.alterarTurma(s, {
          treinamento: turma,
          inicio: '2026-11-20',
          fim: '2026-11-21',
          cargaMin: 120,
          instrutor: 'INSTRUTORA SINTETICA',
          modalidade: 'presencial',
          local: null,
          pop: null,
          observacao: null,
          motivo: MOTIVO,
          versao: await versaoTurma(),
        }),
      ),
    ).toBe('turma-encerrada');
    expect(
      await codigo(
        servico.retirarInscricao(s, {
          treinamento: turma,
          vinculo: 902,
          motivo: MOTIVO,
          versao: (await participante(902)).versao,
        }),
      ),
    ).toBe('turma-encerrada');
    // A correção vale na encerrada.
    await servico.corrigirParticipacao(s, {
      treinamento: turma,
      vinculo: 901,
      presenca: 'presente',
      aproveitamento: 'aprovado',
      conclusao: '2026-11-21',
      observacao: null,
      motivo: MOTIVO,
      versao: (await participante(901)).versao,
    });
    const p = await participante(901);
    expect(p).toMatchObject({ presenca: 'presente', aproveitamento: 'aprovado', conclusao: '2026-11-21' });
    expect(p.validoAte).not.toBeNull();
    const t = await servico.turma(s, turma);
    expect(t.correcoes?.[0]).toMatchObject({
      operacao: 'pessoas.participacao.corrigida',
      antes: { presenca: 'ausente', aproveitamento: null },
      depois: { presenca: 'presente', aproveitamento: 'aprovado' },
      motivo: MOTIVO,
    });
  });

  it('sem a permissão de registrar, as três correções são recusadas', async () => {
    const { servico, turma, participante, versaoTurma } = await montar();
    const sem = sessao('SINT.SEM', () => false);
    const p = await participante(902);
    expect(
      await codigo(
        servico.retirarInscricao(sem, { treinamento: turma, vinculo: 902, motivo: MOTIVO, versao: p.versao }),
      ),
    ).toBe('sem-permissao');
    expect(
      await codigo(
        servico.corrigirParticipacao(sem, {
          treinamento: turma,
          vinculo: 902,
          presenca: 'ausente',
          aproveitamento: null,
          conclusao: null,
          observacao: null,
          motivo: MOTIVO,
          versao: p.versao,
        }),
      ),
    ).toBe('sem-permissao');
    expect(
      await codigo(
        servico.alterarTurma(sem, {
          treinamento: turma,
          inicio: '2026-11-20',
          fim: '2026-11-21',
          cargaMin: 120,
          instrutor: 'INSTRUTORA SINTETICA',
          modalidade: 'presencial',
          local: null,
          pop: null,
          observacao: null,
          motivo: MOTIVO,
          versao: await versaoTurma(),
        }),
      ),
    ).toBe('sem-permissao');
  });
});
