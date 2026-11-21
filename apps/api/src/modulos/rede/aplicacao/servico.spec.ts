// Serviço do MPI da Rede (M57, etapa 1) sobre a porta em memória (dois bancos SINTÉTICOS): o ciclo de pareamento
// (automático, fila por faixa, duplicado local à fila do cadastro, idempotência e marca d'água), a fila mascarada, a
// decisão (mesma pessoa e outra pessoa, nos dois bancos), o desfazer (só a ligação; volta à fila), a queda de um
// banco entre as duas gravações (pendente → divergência → reparo → 0; regra 4) e o isolamento da rede (regra 12).
import { describe, expect, it } from 'vitest';
import { PortaRedeMemoria } from '../porta-memoria.js';
import type { TrilhaRede } from '../tipos-indice.js';
import { ServicoMpiRede, type SessaoRede } from './servico.js';

const REDE = 'rede-teste';

function montar() {
  const porta = new PortaRedeMemoria({
    rede: REDE,
    estabelecimentos: [
      { codigo: 'pc', nome: 'Estabelecimento sintético A' },
      { codigo: 'sx', nome: 'Estabelecimento sintético B' },
    ],
  });
  let n = 0;
  const servico = new ServicoMpiRede(porta, {
    agora: () => new Date('2026-10-24T12:00:00.000Z'),
    novaPessoa: () => `pessoa-sintetica-${++n}`,
  });
  return { porta, servico };
}

function sessao(
  hospital = 'pc',
  rede = REDE,
  login = 'SINT.GESTOR',
  extra: Pick<SessaoRede, 'liberados' | 'como'> = {},
): SessaoRede {
  return {
    rede,
    hospital,
    login,
    ...extra,
    trilha: (evento, operacao, alvo): TrilhaRede => ({
      estabelecimento: null,
      usuario: null,
      acao: 'operacao',
      entidade: 'suspeita_duplicidade',
      entidadeId: null,
      dadosDepois: { evento, recurso: 'rede.mpi', operacao, chave: alvo.chave, login, estabelecimento: hospital },
      correlacao: 'teste',
    }),
  };
}

const FILA = { situacao: 'aberto' as const, pagina: 1, porPagina: 20 };

describe('MPI da Rede: ciclo de pareamento', () => {
  it("automático, fila por faixa, duplicado local à fila do cadastro e marca d'água por banco", async () => {
    const { porta, servico } = montar();
    const r = await servico.ciclo(sessao());
    expect(r).toMatchObject({ automaticos: 1, naFila: 3, duplicadosLocais: 1 });
    expect(r.marcas).toEqual([
      { estabelecimento: 'pc', ultimoId: 7, ultimaAtualizacao: '2026-10-01T10:00:00.000Z' },
      { estabelecimento: 'sx', ultimoId: 107, ultimaAtualizacao: '2026-10-01T10:00:00.000Z' },
    ]);
    // O par automático: vínculo ativo nos DOIS bancos com a mesma pessoa; candidato vinculado (origem automática).
    const pc = porta.estado('pc')!;
    const sx = porta.estado('sx')!;
    expect(pc.vinculos.get('pc:1|sx:101')).toMatchObject({
      situacao: 'ativo',
      origem: 'automatico',
      idLocal: 1,
    });
    expect(sx.vinculos.get('pc:1|sx:101')).toMatchObject({ situacao: 'ativo', idLocal: 101, idRemoto: 1 });
    expect(pc.vinculos.get('pc:1|sx:101')?.pessoa).toBe(sx.vinculos.get('pc:1|sx:101')?.pessoa);
    expect(pc.candidatos.get('pc:1|sx:101')).toMatchObject({ situacao: 'vinculado', origem: 'automatico' });
    // Regra 5: o CPF repetido no mesmo banco foi à fila do cadastro, nunca à da Rede.
    expect(pc.duplicidades.size).toBe(1);
    expect([...pc.candidatos.keys()].some((k) => k.includes('pc:6'))).toBe(false);
    // O inativo não pareia (regra 2: só cadastros ativos e não absorvidos).
    expect([...pc.candidatos.keys()].some((k) => k.includes('pc:7'))).toBe(false);
    // Trilha em cada banco, só contagens.
    expect(pc.trilha.at(-1)).toMatchObject({ dadosDepois: { evento: 'rede.fila.atualizada' }, estabelecimentoDoBanco: 'pc' });
    expect(sx.trilha.at(-1)).toMatchObject({ dadosDepois: { evento: 'rede.fila.atualizada' }, estabelecimentoDoBanco: 'sx' });
    // Repetir: nada é duplicado (a mesma chave nos dois lados) e o par já vinculado não é refeito.
    const de = await servico.ciclo(sessao());
    expect(de.automaticos).toBe(0);
    expect(porta.estado('pc')!.candidatos.size).toBe(4);
    expect(porta.estado('pc')!.vinculos.size).toBe(1);
    expect(porta.estado('sx')!.vinculos.size).toBe(1);
  });

  it('fila mascarada, CPF primeiro, contagem por faixa e filtro', async () => {
    const { servico } = montar();
    await servico.ciclo(sessao());
    const f = await servico.fila(sessao(), FILA);
    expect(f.total).toBe(3);
    expect(f.porFaixa).toEqual({ alta: 1, media: 1, baixa: 1 });
    expect(f.itens.map((i) => i.chave)).toEqual(['pc:4|sx:104', 'pc:2|sx:102', 'pc:3|sx:103']);
    const [x] = f.itens;
    expect(x!.local.cpfMascarado).toMatch(/^\*\*\*\.\*\*\*\.\d{3}-\d{2}$/);
    expect(x!.local.maeMascarada).toBe('M*** S*** Q***');
    expect(x!.remoto).toMatchObject({
      estabelecimento: 'sx',
      estabelecimentoNome: 'Estabelecimento sintético B',
      disponivel: true,
    });
    expect(x!.divergencias).toEqual(['sexo_diferente']);
    expect(f.estabelecimentos.map((e) => e.codigo)).toEqual(['pc', 'sx']);
    const alta = await servico.fila(sessao(), { ...FILA, faixa: 'alta' });
    expect(alta.itens.map((i) => i.chave)).toEqual(['pc:4|sx:104']);
    // Do outro estabelecimento, a mesma fila (o par é espelhado com a mesma chave).
    const doOutro = await servico.fila(sessao('sx'), FILA);
    expect(doOutro.itens.map((i) => i.chave).sort()).toEqual(f.itens.map((i) => i.chave).sort());
    expect(doOutro.itens[0]!.local.estabelecimento).toBe('sx');
  });
});

describe('MPI da Rede: decisão e desfazer (regras 1 e 4)', () => {
  it('"é a mesma pessoa" grava nos dois bancos; desfazer devolve à fila e não apaga nada', async () => {
    const { porta, servico } = montar();
    await servico.ciclo(sessao());
    const r = await servico.decidir(sessao(), 'pc:4|sx:104', { decisao: 'mesma_pessoa' });
    expect(r.bancos).toEqual([
      { estabelecimento: 'pc', situacao: 'gravado' },
      { estabelecimento: 'sx', situacao: 'gravado' },
    ]);
    expect(porta.estado('sx')!.candidatos.get('pc:4|sx:104')).toMatchObject({
      situacao: 'vinculado',
      origem: 'humano',
    });
    const v = await servico.vinculosDoCadastro(sessao(), 'sx', 104);
    expect(v.pessoa).toBe(r.pessoa);
    expect(v.vinculos[0]).toMatchObject({
      estabelecimento: 'pc',
      idRemoto: 4,
      origem: 'humano',
      situacao: 'ativo',
    });
    expect((await servico.divergencias(sessao())).total).toBe(0);
    // Segunda decisão do mesmo par: recusada (o estado relido).
    await expect(servico.decidir(sessao(), 'pc:4|sx:104', { decisao: 'mesma_pessoa' })).rejects.toMatchObject(
      {
        extras: { codigo: 'par-decidido' },
      },
    );
    const d = await servico.desfazer(sessao(), 'pc:4|sx:104', {
      justificativa: 'Revisão: pessoas diferentes',
      reabrir: true,
    });
    expect(d.bancos.every((b) => b.situacao === 'gravado')).toBe(true);
    for (const est of ['pc', 'sx']) {
      expect(porta.estado(est)!.vinculos.get('pc:4|sx:104')).toMatchObject({
        situacao: 'desfeito',
        desfeitoPor: 'SINT.GESTOR',
      });
      expect(porta.estado(est)!.candidatos.get('pc:4|sx:104')?.situacao).toBe('aberto');
      expect(porta.estado(est)!.pessoas.has(r.pessoa!)).toBe(true);
    }
    // Os cadastros não mudam (regra 1).
    expect(porta.estado('pc')!.cadastros.get(4)).toMatchObject({ ativo: true, idUnificado: 4 });
    await expect(
      servico.desfazer(sessao(), 'pc:4|sx:104', { justificativa: 'De novo, sem efeito', reabrir: false }),
    ).rejects.toMatchObject({ extras: { codigo: 'vinculo-desfeito' } });
    await expect(
      servico.desfazer(sessao(), 'pc:2|sx:102', { justificativa: 'Sem vínculo nenhum', reabrir: false }),
    ).rejects.toMatchObject({ tipo: 'nao-encontrado' });
  });

  it('desfazer o automático com "devolver à fila": o cadastro alterado e o ciclo seguinte não religam o par', async () => {
    const { porta, servico } = montar();
    await servico.ciclo(sessao());
    expect(porta.estado('pc')!.candidatos.get('pc:1|sx:101')).toMatchObject({ situacao: 'vinculado' });
    await servico.desfazer(sessao(), 'pc:1|sx:101', {
      justificativa: 'Vínculo errado conferido',
      reabrir: true,
    });
    for (const est of ['pc', 'sx'])
      expect(porta.estado(est)!.candidatos.get('pc:1|sx:101')).toMatchObject({
        situacao: 'aberto',
        origem: 'humano',
      });
    // A recepção atualiza os dois cadastros (o carimbo anda) e o ciclo roda de novo; e ainda com as marcas zeradas.
    for (const [est, id] of [
      ['pc', 1],
      ['sx', 101],
    ] as const) {
      const c = porta.estado(est)!.cadastros;
      c.set(id, { ...c.get(id)!, atualizadoEm: '2026-10-25T08:00:00.000' });
    }
    const r = await servico.ciclo(sessao());
    expect(r.automaticos).toBe(0);
    porta.estado('pc')!.marca = null;
    porta.estado('sx')!.marca = null;
    expect((await servico.ciclo(sessao())).automaticos).toBe(0);
    for (const est of ['pc', 'sx']) {
      expect(porta.estado(est)!.candidatos.get('pc:1|sx:101')).toMatchObject({
        situacao: 'aberto',
        origem: 'humano',
      });
      expect(porta.estado(est)!.vinculos.get('pc:1|sx:101')).toMatchObject({
        situacao: 'desfeito',
        origem: 'automatico',
      });
    }
    // Continua na fila para uma pessoa decidir.
    expect((await servico.fila(sessao(), FILA)).itens.map((i) => i.chave)).toContain('pc:1|sx:101');
    const m = await servico.decidir(sessao(), 'pc:1|sx:101', { decisao: 'mesma_pessoa' });
    expect(m.bancos.every((b) => b.situacao === 'gravado')).toBe(true);
    expect(porta.estado('sx')!.vinculos.get('pc:1|sx:101')).toMatchObject({
      situacao: 'ativo',
      origem: 'humano',
    });
  });

  it('busca por paciente: a fila pelo prontuário do cadastro deste estabelecimento, em qualquer situação', async () => {
    const { servico } = montar();
    await servico.ciclo(sessao());
    const todos = await servico.fila(sessao(), { ...FILA, situacao: 'vinculado' });
    const alvo = todos.itens[0]!;
    const r = await servico.fila(sessao(), {
      ...FILA,
      situacao: 'vinculado',
      prontuario: alvo.local.prontuario,
    });
    expect(r.itens.map((i) => i.chave)).toEqual([alvo.chave]);
    expect(r.total).toBe(1);
    expect(
      (await servico.fila(sessao(), { ...FILA, situacao: 'vinculado', prontuario: 999_999 })).total,
    ).toBe(0);
  });

  it('chave rede.mpi ligada no pc e desligada no sx: a fila não mostra o sx; o par e o ciclo recusam', async () => {
    const { porta, servico } = montar();
    await servico.ciclo(sessao());
    const s = sessao('pc', REDE, 'SINT.GESTOR', { liberados: new Set(['pc']) });
    const f = await servico.fila(s, FILA);
    expect(f.total).toBe(0);
    expect(f.itens).toEqual([]);
    expect(f.porFaixa).toEqual({ alta: 0, media: 0, baixa: 0 });
    expect(f.estabelecimentos.map((e) => e.codigo)).toEqual(['pc']);
    const desligado = { tipo: 'recurso-desligado', status: 403, extras: { codigo: 'recurso-desligado' } };
    await expect(servico.fila(s, { ...FILA, outroEstabelecimento: 'sx' })).rejects.toMatchObject(desligado);
    await expect(servico.candidato(s, 'pc:4|sx:104')).rejects.toMatchObject(desligado);
    await expect(servico.decidir(s, 'pc:4|sx:104', { decisao: 'mesma_pessoa' })).rejects.toMatchObject(
      desligado,
    );
    await expect(
      servico.desfazer(s, 'pc:1|sx:101', { justificativa: 'Vínculo errado conferido', reabrir: true }),
    ).rejects.toMatchObject(desligado);
    await expect(servico.vinculosDoCadastro(s, 'sx', 101)).rejects.toMatchObject(desligado);
    const antes = porta.estado('sx')!;
    const c = await servico.ciclo(s);
    expect(c).toMatchObject({ lidos: 0, automaticos: 0, marcas: [] });
    expect(porta.estado('sx')).toBe(antes);
    expect((await servico.divergencias(s)).estabelecimentos).toEqual(['pc']);
    // Com o sx liberado, tudo volta.
    expect(
      (await servico.fila(sessao('pc', REDE, 'SINT.GESTOR', { liberados: new Set(['pc', 'sx']) }), FILA))
        .total,
    ).toBe(3);
  });

  it('sessão "como" do suporte: o MPI consulta, mas não grava entre os bancos (o Corrigir só alcança o da sessão)', async () => {
    const { porta, servico } = montar();
    await servico.ciclo(sessao());
    const s = sessao('pc', REDE, 'SINT.GESTOR', { como: true });
    expect((await servico.fila(s, FILA)).total).toBe(3);
    const recusa = { status: 403, extras: { codigo: 'como-entre-bancos' } };
    const antes = { pc: porta.estado('pc')!, sx: porta.estado('sx')! };
    await expect(servico.decidir(s, 'pc:4|sx:104', { decisao: 'mesma_pessoa' })).rejects.toMatchObject(
      recusa,
    );
    await expect(
      servico.desfazer(s, 'pc:1|sx:101', { justificativa: 'Vínculo errado conferido', reabrir: true }),
    ).rejects.toMatchObject(recusa);
    await expect(servico.ciclo(s)).rejects.toMatchObject(recusa);
    await expect(servico.reparar(s)).rejects.toMatchObject(recusa);
    expect(porta.estado('pc')).toBe(antes.pc);
    expect(porta.estado('sx')).toBe(antes.sx);
  });

  it('"é outra pessoa" tira o par da fila nos dois bancos e o ciclo não o religa', async () => {
    const { porta, servico } = montar();
    await servico.ciclo(sessao());
    await servico.decidir(sessao('sx'), 'pc:2|sx:102', {
      decisao: 'outra_pessoa',
      justificativa: 'Nascimentos diferentes conferidos',
    });
    for (const est of ['pc', 'sx'])
      expect(porta.estado(est)!.candidatos.get('pc:2|sx:102')).toMatchObject({
        situacao: 'outra_pessoa',
        origem: 'humano',
      });
    expect(porta.estado('pc')!.vinculos.has('pc:2|sx:102')).toBe(false);
    porta.estado('pc')!.marca = null;
    porta.estado('sx')!.marca = null;
    await servico.ciclo(sessao());
    expect(porta.estado('pc')!.candidatos.get('pc:2|sx:102')?.situacao).toBe('outra_pessoa');
    expect((await servico.fila(sessao(), FILA)).total).toBe(2);
  });

  it('cadastro que ficou inativo depois do pareamento não é vinculado', async () => {
    const { porta, servico } = montar();
    await servico.ciclo(sessao());
    const c = porta.estado('sx')!.cadastros;
    c.set(103, { ...c.get(103)!, ativo: false });
    await expect(servico.decidir(sessao(), 'pc:3|sx:103', { decisao: 'mesma_pessoa' })).rejects.toMatchObject(
      {
        extras: { codigo: 'cadastro-indisponivel' },
      },
    );
    const f = await servico.fila(sessao(), FILA);
    expect(f.itens.find((i) => i.chave === 'pc:3|sx:103')?.remoto.disponivel).toBe(false);
  });

  it('os dois lados já em pessoas diferentes: conflito (desfazer antes)', async () => {
    const { porta, servico } = montar();
    await servico.ciclo(sessao());
    for (const [est, id, p] of [
      ['pc', 3, 'pessoa-x-aaaaaaaa'],
      ['sx', 103, 'pessoa-y-bbbbbbbb'],
    ] as const) {
      const b = porta.estado(est)!;
      b.pessoas.add(p);
      b.vinculos.set(`outra-${id}`, {
        estabelecimento: est,
        chave: `outra-${id}`,
        pessoa: p,
        idLocal: id,
        prontuarioLocal: 1,
        estabelecimentoRemoto: 'zz',
        idRemoto: 9,
        prontuarioRemoto: 9,
        origem: 'humano',
        situacao: 'ativo',
        criadoPor: 'X',
        criadoEm: '2026-01-01T00:00:00.000Z',
        desfeitoPor: null,
        desfeitoEm: null,
        justificativa: null,
        id: 999,
      });
    }
    await expect(servico.decidir(sessao(), 'pc:3|sx:103', { decisao: 'mesma_pessoa' })).rejects.toMatchObject(
      {
        extras: { codigo: 'pessoas-diferentes' },
      },
    );
  });
});

describe('MPI da Rede: queda entre as duas gravações (regra 4)', () => {
  it('um banco pendente → divergência → "completar o que faltou" → 0 divergência (idempotente)', async () => {
    const { porta, servico } = montar();
    await servico.ciclo(sessao());
    porta.falharEm.add('sx');
    const r = await servico.decidir(sessao(), 'pc:4|sx:104', { decisao: 'mesma_pessoa' });
    expect(r.bancos).toEqual([
      { estabelecimento: 'pc', situacao: 'gravado' },
      { estabelecimento: 'sx', situacao: 'pendente' },
    ]);
    porta.falharEm.clear();
    const d = await servico.divergencias(sessao());
    expect(d.total).toBe(1);
    expect(d.itens[0]).toMatchObject({ chave: 'pc:4|sx:104', tipo: 'ausente_em_um_banco' });
    expect(await servico.reparar(sessao())).toEqual({ reparados: 1, pendentes: 0, manuais: [] });
    expect((await servico.divergencias(sessao())).total).toBe(0);
    expect(porta.estado('sx')!.vinculos.get('pc:4|sx:104')).toMatchObject({
      pessoa: r.pessoa,
      situacao: 'ativo',
    });
    expect(porta.estado('sx')!.candidatos.get('pc:4|sx:104')?.situacao).toBe('vinculado');
    expect(await servico.reparar(sessao())).toEqual({ reparados: 0, pendentes: 0, manuais: [] });
    // Os dois bancos fora: nada gravado e 503.
    porta.falharEm.add('pc');
    porta.falharEm.add('sx');
    await expect(servico.decidir(sessao(), 'pc:2|sx:102', { decisao: 'mesma_pessoa' })).rejects.toMatchObject(
      {
        tipo: 'indisponivel',
      },
    );
  });

  it('o ciclo com um banco fora não avança a marca dele', async () => {
    const { porta, servico } = montar();
    porta.falharEm.add('sx');
    const r = await servico.ciclo(sessao());
    expect(r.marcas.find((m) => m.estabelecimento === 'sx')).toMatchObject({ ultimoId: 0 });
    expect(porta.estado('sx')!.marca).toBeNull();
    expect(porta.estado('pc')!.marca).toMatchObject({ ultimoId: 7 });
  });
});

describe('MPI da Rede: isolamento (regra 12)', () => {
  it('sem rede, outra rede, par fora da rede, estabelecimento fora da rede: recusados antes de ler', async () => {
    const { servico } = montar();
    await expect(servico.fila(sessao('pc', ''), FILA)).rejects.toMatchObject({
      extras: { codigo: 'rede-ausente' },
    });
    await expect(servico.fila(sessao('pc', 'outra-rede'), FILA)).rejects.toMatchObject({
      extras: { codigo: 'rede-diferente' },
    });
    await expect(servico.fila(sessao('zz'), FILA)).rejects.toMatchObject({
      extras: { codigo: 'fora-da-rede' },
    });
    await expect(servico.fila(sessao(), { ...FILA, outroEstabelecimento: 'zz' })).rejects.toMatchObject({
      extras: { codigo: 'fora-da-rede' },
    });
    await expect(servico.candidato(sessao(), 'pc:1|zz:2')).rejects.toMatchObject({
      extras: { codigo: 'fora-da-rede' },
    });
    await expect(servico.candidato(sessao(), 'sx:1|zz:2')).rejects.toMatchObject({ tipo: 'sem-permissao' });
    await expect(servico.candidato(sessao(), 'malformada')).rejects.toMatchObject({ tipo: 'nao-encontrado' });
    await expect(servico.vinculosDoCadastro(sessao(), 'zz', 1)).rejects.toMatchObject({
      tipo: 'sem-permissao',
    });
    expect(await servico.candidato(sessao(), 'pc:1|sx:2')).toBeNull();
  });
});

describe('MPI da Rede, etapa 2: aviso de atendimentos em outro estabelecimento', () => {
  const pode = async () => ({ pode: true, motivo: null });
  const naoPode = async () => ({ pode: false, motivo: 'regra de compartilhamento não registrada' });

  it('sem vínculo: sem-vinculo, nenhuma leitura no outro banco', async () => {
    const { porta, servico } = montar();
    porta.falharLeituraEm.add('sx');
    const a = await servico.avisoDoPaciente(sessao(), 1, pode);
    expect(a).toEqual({
      situacao: 'sem-vinculo',
      estabelecimentos: [],
      acessoCruzado: { pode: false, motivo: null },
    });
  });

  it('vinculado: só contagens e datas do outro estabelecimento, nos dois sentidos; acesso conforme quem chama', async () => {
    const { servico } = montar();
    await servico.ciclo(sessao());
    const a = await servico.avisoDoPaciente(sessao(), 1, naoPode);
    expect(a.situacao).toBe('com-atendimentos');
    expect(a.estabelecimentos).toEqual([
      {
        estabelecimento: 'sx',
        estabelecimentoNome: 'Estabelecimento sintético B',
        idRemoto: 101,
        disponivel: true,
        atendimentos: 3,
        ultimoAtendimento: '2026-09-14',
        internacoes: 1,
        ultimaInternacao: '2026-08-02',
        podeAbrir: false,
      },
    ]);
    expect(a.acessoCruzado).toEqual({ pode: false, motivo: 'regra de compartilhamento não registrada' });
    // Nada clínico: só as chaves do contrato.
    expect(Object.keys(a.estabelecimentos[0]!).sort()).toEqual(
      [
        'atendimentos',
        'disponivel',
        'estabelecimento',
        'estabelecimentoNome',
        'idRemoto',
        'internacoes',
        'podeAbrir',
        'ultimaInternacao',
        'ultimoAtendimento',
      ].sort(),
    );
    const comAcesso = await servico.avisoDoPaciente(sessao(), 1, pode);
    expect(comAcesso.acessoCruzado).toEqual({ pode: true, motivo: null });
    expect(comAcesso.estabelecimentos[0]?.podeAbrir).toBe(true);
    // Do outro lado (sessão em sx, cadastro 101): o pc não tem atendimento sintético → sem-atendimentos.
    const volta = await servico.avisoDoPaciente(sessao('sx'), 101, pode);
    expect(volta.situacao).toBe('sem-atendimentos');
    expect(volta.estabelecimentos[0]).toMatchObject({ estabelecimento: 'pc', idRemoto: 1, atendimentos: 0 });
  });

  it('o banco do outro estabelecimento sem resposta não derruba o aviso; desfeito, o aviso some', async () => {
    const { porta, servico } = montar();
    await servico.ciclo(sessao());
    porta.falharLeituraEm.add('sx');
    const a = await servico.avisoDoPaciente(sessao(), 1, pode);
    expect(a.situacao).toBe('com-atendimentos');
    expect(a.estabelecimentos[0]).toMatchObject({ disponivel: false, atendimentos: 0, podeAbrir: false });
    porta.falharLeituraEm.clear();
    await servico.desfazer(sessao(), 'pc:1|sx:101', { justificativa: 'Teste do aviso', reabrir: false });
    expect((await servico.avisoDoPaciente(sessao(), 1, pode)).situacao).toBe('sem-vinculo');
  });

  it('o estabelecimento fora dos liberados não aparece (D-LIB-EST-57)', async () => {
    const { servico } = montar();
    await servico.ciclo(sessao());
    const a = await servico.avisoDoPaciente(
      sessao('pc', REDE, 'SINT.GESTOR', { liberados: new Set(['pc']) }),
      1,
      pode,
    );
    expect(a.situacao).toBe('sem-vinculo');
  });
});
