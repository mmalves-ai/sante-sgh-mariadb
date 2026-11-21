// W0-06, parte 5b (programa CRUD completo, M2 de mercado): avaliação de desempenho pelo serviço da API. Competência com
// alteração por motivo e o valor anterior, inativação e exclusão só da nunca usada (409 com a contagem); ciclo com a
// escala de notas; avaliação com as competências do cargo, nota até a escala, finalização, ciência só do próprio (ou
// registrada pelo RH), correção por versão nova (a anterior intacta); alerta de experiência de 45 e 90 dias; PDI ligado
// ao curso com o histórico. Portas em memória (nada conecta a banco); dados sintéticos.
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { PortaCargosMemoria } from '../cargos/porta-cargos-memoria.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import type { PortaPonto } from '../ponto/porta-ponto.js';
import { ServicoPessoas } from '../servico.js';
import type { PortaTreinamento } from '../treinamento/porta-treinamento.js';
import { PortaAvaliacaoMemoria } from './porta-avaliacao-memoria.js';
import { PERMISSOES_AVALIACAO, ServicoAvaliacao } from './servico-avaliacao.js';

type OpcoesConfiguracao = NonNullable<Parameters<typeof fonteConfiguracaoMemoria>[1]>;
type ChaveGravada = ReturnType<NonNullable<OpcoesConfiguracao['chavesIniciais']>>[number];
type PrerequisitoGravado = ReturnType<NonNullable<OpcoesConfiguracao['prerequisitosIniciais']>>[number];
type CursoTreinamento = Awaited<ReturnType<PortaTreinamento['cursos']>>[number];

const C = PESSOAS_SINTETICAS_M52;
const chave = (c: string): ChaveGravada => ({
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
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const CTX = {
  cliente: 'sintetico',
  estabelecimento: 1,
  usuario: null,
  correlacao: 'teste-l0302',
  rede: 'rede-sintetica',
  hospital: 'pc',
};
let k = 0;
const sessao = (login = 'SINT.RH', pode: (p: string) => boolean = () => true): SessaoCadastro => ({
  req: {
    headers: { 'idempotency-key': `w006-aval-${++k}` },
    ip: '127.0.0.1',
    sgh: { sessao: { unidadeAtiva: null } },
  } as never,
  hospital: 'pc',
  rede: 'rede-sintetica',
  login,
  porta: CTX,
  pode,
});

async function erro(p: Promise<unknown>): Promise<ErroProblema> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return e as ErroProblema;
}
const codigo = async (p: Promise<unknown>) => {
  const e = await erro(p);
  return e.extras['codigo'] ?? e.tipo;
};

const MOTIVO = 'Lançado com o dado errado na implantação';
const CURSO = { id: 7001, titulo: 'Comunicação com o paciente', ativo: true } as CursoTreinamento;
/** Curso que só a porta dos treinamentos conhece (o PDI em memória o lê por `porta.treinamento`). */
const CURSO2 = { id: 7002, titulo: 'Passagem de plantão segura', ativo: true } as CursoTreinamento;

async function montar() {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-11-18';
  const trilha = new RegistradorTrilhaMemoria();
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => [chave('pessoas.colaborador')],
    prerequisitosIniciais: () => [cumprido('pessoas.colaborador')],
  });
  const rh = new ServicoPessoas(pessoas, trilha, config, null, new CifraCpf(Buffer.alloc(32, 7)));
  const vinculo = (
    await rh.admitir(sessao(), {
      cpf: C.nova.cpf,
      nome: 'PESSOA NOVA SINTETICA',
      profissional: null,
      tipo: 'clt',
      admissao: '2026-10-01',
      cargo: 'Técnico de enfermagem',
      funcao: null,
      cargaSemanalHoras: 44,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 3' },
      matricula: null,
      usuario: null,
    })
  ).id;
  const cargos = new PortaCargosMemoria();
  const cargo = await cargos.gravarSgh(CTX, {} as never, (g) =>
    g.incluirCargo({
      nome: 'Técnico de enfermagem',
      cbo: '322205',
      descricao: null,
      requisitos: null,
      conselho: 'COREN',
      por: 'SINT.RH',
    }),
  );
  const porta = new PortaAvaliacaoMemoria(pessoas);
  porta.agoraFixo = '2026-11-18T10:00';
  porta.ligarCargo('pc', vinculo, cargo);
  porta.ligarCurso('pc', { id: CURSO.id, titulo: CURSO.titulo, conclusoes: { [vinculo]: '2026-11-10' } });
  // O colaborador SINT.COLAB é o dono do vínculo (o vínculo sai do login).
  const ponto = {
    vinculosDoLogin: async (_c: unknown, login: string) => (login === 'SINT.COLAB' ? [vinculo] : []),
  } as unknown as PortaPonto;
  const treinamento = {
    cursos: async () => [CURSO],
    curso: async (_c: unknown, id: number) => [CURSO, CURSO2].find((x) => x.id === id) ?? null,
  } as unknown as PortaTreinamento;
  const svc = new ServicoAvaliacao(porta, pessoas, cargos, treinamento, ponto, trilha, config, null);
  return { svc, porta, cargo, vinculo };
}

/** Competências ligadas ao cargo e um ciclo aberto (escala 1 a 5). */
async function preparar(tipo: 'periodico' | 'experiencia' = 'periodico') {
  const m = await montar();
  const s = sessao();
  const k1 = (await m.svc.incluirCompetencia(s, { nome: 'Comunicação', descricao: null })).id;
  const k2 = (await m.svc.incluirCompetencia(s, { nome: 'Trabalho em equipe', descricao: null })).id;
  for (const competencia of [k1, k2]) await m.svc.ligarCompetenciaCargo(s, { cargo: m.cargo, competencia });
  const ciclo = (
    await m.svc.incluirCiclo(s, {
      nome: tipo === 'periodico' ? 'Ciclo 2026' : 'Experiência 2026',
      tipo,
      inicio: '2026-01-01',
      fim: '2026-12-31',
      prazo: '2027-01-31',
      notaMax: 5,
    })
  ).id;
  return { ...m, s, k1, k2, ciclo };
}

describe('W0-06 parte 5b: competências', () => {
  it('altera com motivo e o valor anterior; a usada recusa a exclusão com a contagem e oferece a inativação', async () => {
    const { svc, s, k1, cargo } = await preparar();
    const a = (await svc.competencias(s)).competencias.find((x) => x.id === k1);
    expect(a?.cargos).toEqual([cargo]);
    expect(
      await codigo(
        svc.alterarCompetencia(s, {
          competencia: k1,
          versao: 0,
          nome: 'Comunicação',
          descricao: null,
          motivo: MOTIVO,
        }),
      ),
    ).toBe('nada-a-alterar');
    await svc.alterarCompetencia(s, {
      competencia: k1,
      versao: 0,
      nome: 'Comunicação efetiva',
      descricao: null,
      motivo: MOTIVO,
    });
    const l = await svc.competencias(s);
    expect(l.correcoes[0]).toMatchObject({
      antes: { nome: 'Comunicação' },
      depois: { nome: 'Comunicação efetiva' },
      motivo: MOTIVO,
    });
    const e = await erro(svc.excluirCompetencia(s, { competencia: k1, versao: 1, motivo: MOTIVO }));
    expect(e.getStatus()).toBe(409);
    expect(e.extras['codigo']).toBe('competencia-com-vinculos');
    expect(e.extras['bloqueios']).toEqual(['Cargos com a competência: 1']);
    expect(e.detalhe).toMatch(/inative/);
    await svc.situacaoCompetencia(s, { competencia: k1, versao: 1, ativo: false, motivo: MOTIVO });
    expect((await svc.competencias(s)).competencias.find((x) => x.id === k1)?.ativo).toBe(false);
  });

  it('a nunca usada se exclui com o retrato; desligar do cargo leva o retrato', async () => {
    const { svc, porta, s, k2, cargo } = await preparar();
    const k3 = (await svc.incluirCompetencia(s, { nome: 'Pontualidade', descricao: null })).id;
    await svc.excluirCompetencia(s, { competencia: k3, versao: 0, motivo: MOTIVO });
    await svc.desligarCompetenciaCargo(s, { cargo, competencia: k2, motivo: MOTIVO });
    expect((await svc.competenciasDoCargo(s, cargo)).map((x) => x.competencia)).not.toContain(k2);
    expect(porta.exclusoes('pc').map((x) => x.tabela)).toEqual([
      'competencia_avaliacao',
      'cargo_competencia',
    ]);
  });
});

describe('W0-06 parte 5b: ciclo e avaliação', () => {
  it('abre com as competências do cargo, nota até a escala, finaliza; a finalizada é imutável', async () => {
    const { svc, s, ciclo, vinculo, k1, k2 } = await preparar();
    const id = (await svc.abrir(s, { ciclo, vinculo, marco: null, avaliador: null })).id;
    expect(await codigo(svc.abrir(s, { ciclo, vinculo, marco: null, avaliador: null }))).toBe(
      'avaliacao-em-vigor',
    );
    let f = await svc.ficha(s, id);
    expect(f.notas.map((n) => n.competencia).sort()).toEqual([k1, k2].sort());
    expect(f.avaliacao.avaliador).toBe('SINT.RH');
    expect(await codigo(svc.finalizar(s, { avaliacao: id, versao: f.avaliacao.versao }))).toBe(
      'avaliacao-incompleta',
    );
    expect(
      await codigo(
        svc.lancarNotas(s, {
          avaliacao: id,
          versao: f.avaliacao.versao,
          parecer: null,
          notas: [{ competencia: k1, nota: 6, comentario: null }],
        }),
      ),
    ).toBe('nota-fora-da-escala');
    await svc.lancarNotas(s, {
      avaliacao: id,
      versao: f.avaliacao.versao,
      parecer: 'Bom desempenho no período.',
      notas: [
        { competencia: k1, nota: 4, comentario: null },
        { competencia: k2, nota: 5, comentario: 'Referência no setor' },
      ],
    });
    f = await svc.ficha(s, id);
    await svc.finalizar(s, { avaliacao: id, versao: f.avaliacao.versao });
    f = await svc.ficha(s, id);
    expect(f.avaliacao.situacao).toBe('finalizada');
    expect(f.acoes).toMatchObject({
      lancar: false,
      corrigir: true,
      cienciaRegistrada: true,
      cienciaPropria: false,
    });
    expect(
      await codigo(
        svc.lancarNotas(s, { avaliacao: id, versao: f.avaliacao.versao, parecer: null, notas: [] }),
      ),
    ).toBe('avaliacao-finalizada');
    expect(await codigo(svc.excluir(s, { avaliacao: id, versao: f.avaliacao.versao, motivo: MOTIVO }))).toBe(
      'avaliacao-finalizada',
    );
    // O ciclo com avaliação não se exclui: 409 com a contagem e o caminho (encerrar ou cancelar).
    const c = (await svc.ciclos(s))[0];
    expect(c?.avaliacoes.finalizada).toBe(1);
    const e = await erro(svc.excluirCiclo(s, { ciclo, versao: c?.versao ?? 0, motivo: MOTIVO }));
    expect(e.extras['codigo']).toBe('ciclo-avaliacao-com-vinculos');
    expect(e.extras['bloqueios']).toEqual(['Avaliações do ciclo: 1']);
  });

  it('ciência só do próprio (outro login: 404) ou registrada pelo RH; correção por versão nova com a anterior intacta', async () => {
    const { svc, s, ciclo, vinculo, k1, k2 } = await preparar();
    const id = (await svc.abrir(s, { ciclo, vinculo, marco: null, avaliador: 'sint.gestor' })).id;
    let f = await svc.ficha(s, id);
    await svc.lancarNotas(s, {
      avaliacao: id,
      versao: f.avaliacao.versao,
      parecer: null,
      notas: [
        { competencia: k1, nota: 2, comentario: null },
        { competencia: k2, nota: 3, comentario: null },
      ],
    });
    f = await svc.ficha(s, id);
    await svc.finalizar(s, { avaliacao: id, versao: f.avaliacao.versao });
    f = await svc.ficha(s, id);
    const versao = f.avaliacao.versao;
    // Outro login não vê nem dá ciência na avaliação de outra pessoa.
    expect(
      (
        await erro(svc.cienciaPropria(sessao('SINT.MEDICO'), { avaliacao: id, versao, observacao: null }))
      ).getStatus(),
    ).toBe(404);
    expect((await erro(svc.ficha(sessao('SINT.MEDICO'), id, true))).getStatus()).toBe(404);
    // O próprio colaborador vê as suas e dá ciência (com a discordância).
    const colab = sessao('SINT.COLAB', (p) => p === PERMISSOES_AVALIACAO.ciencia);
    expect((await svc.minhas(colab)).map((a) => a.id)).toEqual([id]);
    expect((await svc.ficha(colab, id, true)).acoes).toMatchObject({ cienciaPropria: true, corrigir: false });
    await svc.cienciaPropria(colab, {
      avaliacao: id,
      versao,
      observacao: 'Discordo da nota de comunicação.',
    });
    f = await svc.ficha(s, id);
    expect(f.avaliacao).toMatchObject({
      situacao: 'ciente',
      cienciaModo: 'proprio',
      cienciaPor: 'SINT.COLAB',
    });
    expect(
      await codigo(
        svc.cienciaRegistrada(s, {
          avaliacao: id,
          versao: f.avaliacao.versao,
          observacao: 'Colhida em papel em 18/11',
        }),
      ),
    ).toBe('ciencia-ja-dada');
    // A correção: versão 2 em rascunho com as notas copiadas; a 1 continua guardada e visível.
    const v2 = (await svc.corrigir(s, { avaliacao: id, versao: f.avaliacao.versao, motivo: MOTIVO })).id;
    const f2 = await svc.ficha(s, v2);
    expect(f2.avaliacao).toMatchObject({
      numero: 2,
      anterior: id,
      motivoCorrecao: MOTIVO,
      situacao: 'rascunho',
    });
    expect(f2.versoes.map((x) => x.avaliacao.numero)).toEqual([2, 1]);
    expect(f2.versoes[1]?.avaliacao).toMatchObject({ situacao: 'ciente', substituida: true });
    expect(f2.notas.map((n) => n.nota).sort()).toEqual([2, 3]);
    const f1 = await svc.ficha(s, id);
    expect(f1.acoes.corrigir).toBe(false);
    expect(
      await codigo(svc.corrigir(s, { avaliacao: id, versao: f1.avaliacao.versao, motivo: MOTIVO })),
    ).toBe('avaliacao-substituida');
    // A versão nova finalizada recebe a ciência registrada pelo RH; a anterior não muda.
    await svc.lancarNotas(s, {
      avaliacao: v2,
      versao: f2.avaliacao.versao,
      parecer: 'Revisada após a ciência.',
      notas: [{ competencia: k1, nota: 3, comentario: null }],
    });
    await svc.finalizar(s, { avaliacao: v2, versao: (await svc.ficha(s, v2)).avaliacao.versao });
    await svc.cienciaRegistrada(s, {
      avaliacao: v2,
      versao: (await svc.ficha(s, v2)).avaliacao.versao,
      observacao: 'Colhida em papel na reunião de 18/11.',
    });
    expect((await svc.ficha(s, v2)).avaliacao.cienciaModo).toBe('registrada');
    expect((await svc.ficha(s, id)).notas.find((n) => n.competencia === k1)?.nota).toBe(2);
  });

  it('o rascunho se exclui com o retrato das notas; o ciclo aberto se altera com motivo e o valor anterior', async () => {
    const { svc, porta, s, ciclo, vinculo } = await preparar();
    const id = (await svc.abrir(s, { ciclo, vinculo, marco: null, avaliador: null })).id;
    await svc.excluir(s, { avaliacao: id, versao: 0, motivo: MOTIVO });
    expect(porta.exclusoes('pc').filter((x) => x.tabela === 'avaliacao_desempenho_item')).toHaveLength(2);
    expect(await codigo(svc.abrir(s, { ciclo, vinculo, marco: 45, avaliador: null }))).toBe(
      'marco-so-experiencia',
    );
    await svc.alterarCiclo(s, {
      ciclo,
      versao: 0,
      nome: 'Ciclo 2026',
      tipo: 'periodico',
      inicio: '2026-01-01',
      fim: '2026-12-31',
      prazo: '2027-02-28',
      notaMax: 4,
      motivo: MOTIVO,
    });
    const fc = await svc.fichaCiclo(s, ciclo);
    expect(fc.correcoes[0]).toMatchObject({
      antes: { prazo: '2027-01-31', notaMax: 5 },
      depois: { prazo: '2027-02-28', notaMax: 4 },
    });
    await svc.situacaoCiclo(s, { ciclo, versao: 1, situacao: 'encerrado', motivo: MOTIVO });
    expect(await codigo(svc.abrir(s, { ciclo, vinculo, marco: null, avaliador: null }))).toBe(
      'ciclo-fechado',
    );
    await svc.excluirCiclo(s, { ciclo, versao: 2, motivo: MOTIVO });
    expect(await svc.ciclos(s)).toHaveLength(0);
  });

  it('sem cargo ou sem competência ativa no cargo, a avaliação não abre', async () => {
    const { svc, porta, s, ciclo, vinculo, k1, k2, cargo } = await preparar();
    for (const competencia of [k1, k2])
      await svc.desligarCompetenciaCargo(s, { cargo, competencia, motivo: MOTIVO });
    expect(await codigo(svc.abrir(s, { ciclo, vinculo, marco: null, avaliador: null }))).toBe(
      'avaliacao-sem-competencias',
    );
    porta.ligarCargo('pc', vinculo, 0);
    expect(await codigo(svc.abrir(s, { ciclo, vinculo, marco: null, avaliador: null }))).toBe(
      'avaliacao-sem-competencias',
    );
  });
});

describe('W0-06 parte 5b: alerta de experiência e PDI', () => {
  it('o marco de 45 dias vencido aparece até a avaliação daquele marco', async () => {
    const { svc, s, ciclo, vinculo } = await preparar('experiencia');
    // Admitido em 01/10: o 45º dia é 14/11 (vencido há 4 dias em 18/11); o de 90 (29/12) ainda está longe.
    expect(await svc.alertasExperiencia(s)).toEqual([
      expect.objectContaining({ vinculo, marco: 45, data: '2026-11-14', dias: -4, situacao: 'vencido' }),
    ]);
    expect(await codigo(svc.abrir(s, { ciclo, vinculo, marco: null, avaliador: null }))).toBe(
      'marco-obrigatorio',
    );
    await svc.abrir(s, { ciclo, vinculo, marco: 45, avaliador: null });
    expect(await svc.alertasExperiencia(s)).toEqual([]);
  });

  it('PDI ligado à competência e ao curso (com a conclusão), alterado com motivo, concluído e cancelado', async () => {
    const { svc, s, vinculo, k1 } = await preparar();
    expect((await svc.apoioTela(s)).cursos).toEqual([{ codigo: CURSO.id, rotulo: CURSO.titulo }]);
    const p = (
      await svc.incluirPdi(s, {
        vinculo,
        avaliacao: null,
        competencia: k1,
        curso: CURSO.id,
        acao: 'Fazer o curso de comunicação',
        prazo: '2026-12-31',
      })
    ).id;
    expect(
      await codigo(
        svc.incluirPdi(s, {
          vinculo,
          avaliacao: null,
          competencia: null,
          curso: 9999,
          acao: 'Curso inexistente',
          prazo: '2026-12-31',
        }),
      ),
    ).toBe('nao-encontrado');
    await svc.alterarPdi(s, {
      pdi: p,
      versao: 0,
      avaliacao: null,
      competencia: k1,
      curso: CURSO.id,
      acao: 'Fazer o curso de comunicação',
      prazo: '2027-01-31',
      motivo: MOTIVO,
    });
    let d = await svc.doColaborador(s, vinculo);
    expect(d.pdi[0]).toMatchObject({
      cursoTitulo: CURSO.titulo,
      cursoConcluidoEm: '2026-11-10',
      prazo: '2027-01-31',
    });
    expect(d.correcoes[0]).toMatchObject({ antes: { prazo: '2026-12-31' }, depois: { prazo: '2027-01-31' } });
    expect(
      await codigo(
        svc.situacaoPdi(s, {
          pdi: p,
          versao: 1,
          situacao: 'concluida',
          concluidaEm: '2026-12-01',
          motivo: MOTIVO,
        }),
      ),
    ).toBe('conclusao-futura');
    await svc.situacaoPdi(s, {
      pdi: p,
      versao: 1,
      situacao: 'concluida',
      concluidaEm: '2026-11-10',
      motivo: MOTIVO,
    });
    d = await svc.doColaborador(s, vinculo);
    expect(d.pdi[0]).toMatchObject({ situacao: 'concluida', concluidaEm: '2026-11-10' });
    expect(
      await codigo(
        svc.situacaoPdi(s, { pdi: p, versao: 2, situacao: 'cancelada', concluidaEm: null, motivo: MOTIVO }),
      ),
    ).toBe('pdi-fechado');
    // A competência usada no PDI não se exclui.
    const e = await erro(svc.excluirCompetencia(s, { competencia: k1, versao: 0, motivo: MOTIVO }));
    expect(e.extras['bloqueios']).toContain('Ações do PDI: 1');
  });

  it('em memória, o PDI lê o curso e a última conclusão (aprovado ou sem avaliação) dos treinamentos ligados', async () => {
    const { svc, porta, s, vinculo } = await preparar();
    porta.treinamento = {
      cursos: async () => [CURSO2],
      conclusoes: async () => [
        { vinculo, curso: CURSO2.id, conclusao: '2026-10-01', validoAte: null },
        { vinculo, curso: CURSO2.id, conclusao: '2026-11-05T00:00', validoAte: null },
        { vinculo: vinculo + 1, curso: CURSO2.id, conclusao: '2026-11-17', validoAte: null },
      ],
    };
    await svc.incluirPdi(s, {
      vinculo,
      avaliacao: null,
      competencia: null,
      curso: CURSO2.id,
      acao: 'Fazer o curso de passagem de plantão',
      prazo: '2026-12-31',
    });
    const d = await svc.doColaborador(s, vinculo);
    expect(d.pdi[0]).toMatchObject({ cursoTitulo: CURSO2.titulo, cursoConcluidoEm: '2026-11-05' });
  });
});
