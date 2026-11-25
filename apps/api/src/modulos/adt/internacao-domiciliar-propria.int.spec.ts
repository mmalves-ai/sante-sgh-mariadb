// Contrato de efeito da internação domiciliar (C2-079, 04-INT linha 84) contra o MariaDB real (cliente de teste).
// Massa SINTÉTICA: estabelecimento com o código do teste, duas pessoas e pacientes sintéticos com endereço, tipo e
// motivo de chamado, tipo de custo e motivo de transferência; usuário e profissionais são ids já existentes do cliente
// (só lidos). Prova o que fica em `orcamento_internacao_domiciliar`, `orcamento_internacao_domiciliar_item`,
// `internacao_domiciliar`, `chamado_domiciliar` e `visita_domiciliar`: o orçamento numerado com os totais do domínio,
// os itens antigos marcados como excluídos ao salvar de novo, o ciclo enviar/aprovar, a transferência com o orçamento
// aprovado (fonte dele), o ciclo da internação (início, suspensão com o motivo na observação, encerramento), o chamado
// com o endereço da internação, a visita do chamado, a conclusão com desfecho e as recusas sem gravar nada.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaInternacaoDomiciliarPropria } from './internacao-domiciliar-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2079dom';
const NOMES = [`PESSOA SINTETICA ${P} UM`, `PESSOA SINTETICA ${P} DOIS`];

type Massa = Record<string, number>;

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM visita_domiciliar WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM chamado_domiciliar WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM internacao_domiciliar WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE i FROM orcamento_internacao_domiciliar_item i
         JOIN orcamento_internacao_domiciliar o ON o.id = i.orcamento_internacao_domiciliar_id
        WHERE o.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM orcamento_internacao_domiciliar WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM sequencia_negocio WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE en FROM endereco_pessoa en JOIN pessoa_fisica pf ON pf.id = en.pessoa_fisica_id WHERE pf.nome IN (?, ?)`,
      NOMES,
    );
    await e.executar(
      'DELETE p FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE pf.nome IN (?, ?)',
      NOMES,
    );
    await e.executar('DELETE FROM pessoa_fisica WHERE nome IN (?, ?)', NOMES);
    await e.executar('DELETE FROM motivo_chamado_domiciliar WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM tipo_chamado_domiciliar WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM motivo_transferencia_domicilio WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM tipo_custo WHERE codigo LIKE ?', [`${P}-%`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

const recusa = { problema: { codigo: 'regra-violada' } };
const item = (n: number) => ({
  tipoItem: 'visita',
  tipoCusto: n,
  descricao: 'Visita de enfermagem',
  quantidade: 2,
  dias: 30,
  valorUnitario: 80,
  valorCustoUnitario: 50,
});

describe.skipIf(SEM_BANCO)('PortaInternacaoDomiciliarPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaInternacaoDomiciliarPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m['usuario']!, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const linha = async (tabela: string, id: number) =>
    (
      await ler(
        `SELECT * FROM ${
          {
            o: 'orcamento_internacao_domiciliar',
            d: 'internacao_domiciliar',
            c: 'chamado_domiciliar',
            v: 'visita_domiciliar',
          }[tabela]
        } WHERE id = ?`,
        [id],
      )
    )[0]!;
  const contar = async () =>
    Number(
      (
        await ler(
          `SELECT (SELECT COUNT(*) FROM orcamento_internacao_domiciliar WHERE estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM internacao_domiciliar WHERE estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM chamado_domiciliar WHERE estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM visita_domiciliar WHERE estabelecimento_id = ?) AS n`,
          [m['est'], m['est'], m['est'], m['est']],
        )
      )[0]!['n'],
    );
  // Trilha de auditoria gravada pelo executor: as operações, em ordem, de cada registro da massa, todas com o
  // usuário da sessão e o estabelecimento do teste (as recusas não deixam linha).
  const trilha = async (tabela: string, id: number) => {
    const r = await ler(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(dados_depois, '$.operacao')) AS operacao, usuario_id, estabelecimento_id
         FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ? ORDER BY id`,
      [tabela, id],
    );
    for (const x of r) {
      expect(Number(x['usuario_id'])).toBe(m['usuario']);
      expect(Number(x['estabelecimento_id'])).toBe(m['est']);
    }
    return r.map((x) => String(x['operacao']));
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const um = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const fonte = await um('SELECT MIN(id) AS id FROM fonte_pagadora');
      const tipoEnd = await um('SELECT MIN(id) AS id FROM tipo_endereco');
      const municipio = await um('SELECT MIN(id) AS id FROM municipio_ibge');
      const profs = (
        await e.consultar('SELECT id FROM profissional WHERE excluido_em IS NULL ORDER BY id LIMIT 2')
      ).map((x) => Number(x['id']));
      if (!usuario || !fonte || !tipoEnd || !municipio || profs.length < 2)
        throw new Error(
          'O cliente de teste precisa de usuário, fonte pagadora, tipo de endereço e 2 profissionais.',
        );
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const pac = async (nome: string, prontuario: number) => {
        const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
          nome,
          agora,
        ]);
        const id = await e.inserir(
          'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
          [pf, prontuario, agora],
        );
        const end = await e.inserir(
          `INSERT INTO endereco_pessoa (pessoa_fisica_id, sequencia, tipo_endereco_id, cep, logradouro, numero,
             bairro_nome, municipio_ibge_id, principal, criado_em)
           VALUES (?, 1, ?, '01000000', 'Rua Sintética', '10', 'Bairro Fictício', ?, TRUE, ?)`,
          [pf, tipoEnd, municipio, agora],
        );
        return { id, end };
      };
      const a = await pac(NOMES[0]!, 902_079_001);
      const b = await pac(NOMES[1]!, 902_079_002);
      const tipo = await e.inserir(
        'INSERT INTO tipo_chamado_domiciliar (codigo, descricao, coparticipacao, criado_em) VALUES (?, ?, TRUE, ?)',
        [`${P}-INT`, 'Intercorrência sintética', agora],
      );
      const tipo2 = await e.inserir(
        'INSERT INTO tipo_chamado_domiciliar (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-REP`, 'Reposição sintética', agora],
      );
      const motivo2 = await e.inserir(
        'INSERT INTO motivo_chamado_domiciliar (codigo, descricao, tipo_chamado_domiciliar_id, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}-M2`, 'Motivo sintético da reposição', tipo2, agora],
      );
      const motivoTr = await e.inserir(
        'INSERT INTO motivo_transferencia_domicilio (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-DES`, 'Desospitalização sintética', agora],
      );
      const custo = await e.inserir(
        'INSERT INTO tipo_custo (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-VIS`, 'Custo sintético de visita', agora],
      );
      return {
        usuario,
        fonte,
        est,
        pacA: a.id,
        endA: a.end,
        pacB: b.id,
        endB: b.end,
        tipo,
        tipo2,
        motivo2,
        motivoTr,
        custo,
        prof0: profs[0]!,
        prof1: profs[1]!,
      };
    });
    porta = new PortaInternacaoDomiciliarPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  }, 60_000);

  it('orçamento: rascunho numerado com totais; salvar de novo guarda os itens antigos excluídos; enviar e aprovar', async () => {
    const antes = await contar();
    await expect(
      porta.salvarOrcamento(ctx(), null, {
        paciente: m['pacA'],
        tipo: 'operadora',
        itens: [item(m['custo']!)],
      }),
    ).rejects.toMatchObject(recusa);
    expect(await contar()).toBe(antes);
    const base = { paciente: m['pacA'], tipo: 'operadora', fontePagadora: m['fonte'], percentualImpostos: 5 };
    const o = await porta.salvarOrcamento(ctx(), null, { ...base, itens: [item(m['custo']!)] });
    expect(o.numero).toMatch(/^ORD-/);
    let row = await linha('o', o.id as never);
    expect(row).toMatchObject({ situacao: 'rascunho', tipo_orcamento: 'operadora' });
    expect(Number(row['valor_total'])).toBe(5040);
    expect(Number(row['valor_custo_total'])).toBe(3000);
    await porta.salvarOrcamento(ctx(), o.id as never, {
      ...base,
      percentualImpostos: 0,
      versao: Number(row['versao']),
      itens: [item(m['custo']!), { ...item(m['custo']!), quantidade: 1, dias: null, valorUnitario: 300 }],
    });
    const itens = await ler(
      'SELECT sequencia, excluido_em, valor_total FROM orcamento_internacao_domiciliar_item WHERE orcamento_internacao_domiciliar_id = ? ORDER BY sequencia',
      [o.id],
    );
    expect(
      itens.map((x) => [Number(x['sequencia']), x['excluido_em'] !== null, Number(x['valor_total'])]),
    ).toEqual([
      [1, true, 4800],
      [2, false, 4800],
      [3, false, 300],
    ]);
    row = await linha('o', o.id as never);
    expect(Number(row['valor_total'])).toBe(5100);
    // Aprovar direto do rascunho é recusado; enviar e aprovar gravam a resposta.
    await expect(
      porta.acaoOrcamento(ctx(), o.id as never, 'aprovar', { versao: Number(row['versao']) }),
    ).rejects.toMatchObject(recusa);
    await porta.acaoOrcamento(ctx(), o.id as never, 'enviar', { versao: Number(row['versao']) });
    row = await linha('o', o.id as never);
    await porta.acaoOrcamento(ctx(), o.id as never, 'aprovar', { versao: Number(row['versao']) });
    row = await linha('o', o.id as never);
    expect(row['situacao']).toBe('aprovado');
    expect(row['data_hora_resposta']).not.toBeNull();
    await expect(
      porta.salvarOrcamento(ctx(), o.id as never, {
        ...base,
        versao: Number(row['versao']),
        itens: [item(m['custo']!)],
      }),
    ).rejects.toMatchObject(recusa);
    m['orc'] = o.id as never;
    expect(await trilha('orcamento_internacao_domiciliar', o.id as never)).toEqual([
      'internacao.domiciliar.orcamento.criar',
      'internacao.domiciliar.orcamento.alterar',
      'internacao.domiciliar.orcamento.enviar',
      'internacao.domiciliar.orcamento.aprovar',
    ]);
  });

  it('transferência para casa e ciclo da internação domiciliar', async () => {
    const antes = await contar();
    // Endereço de outro paciente, orçamento de outro paciente: nada se grava.
    await expect(
      porta.transferir(ctx(), { paciente: m['pacB'], endereco: m['endA'], orcamento: m['orc'] }),
    ).rejects.toMatchObject(recusa);
    await expect(porta.transferir(ctx(), { paciente: m['pacB'], endereco: m['endB'] })).rejects.toMatchObject(
      recusa,
    );
    expect(await contar()).toBe(antes);
    const t = await porta.transferir(ctx(), {
      paciente: m['pacA'],
      endereco: m['endA'],
      orcamento: m['orc'],
      motivo: m['motivoTr'],
    });
    expect(t.numero).toMatch(/^ID-/);
    let d = await linha('d', t.id as never);
    expect(d).toMatchObject({ situacao: 'solicitada', orcamento_internacao_domiciliar_id: m['orc'] });
    expect(Number(d['fonte_pagadora_id'])).toBe(m['fonte']);
    // Uma internação domiciliar aberta por paciente.
    await expect(
      porta.transferir(ctx(), { paciente: m['pacA'], endereco: m['endA'], orcamento: m['orc'] }),
    ).rejects.toMatchObject(recusa);
    // Liminar sem orçamento para o outro paciente.
    const tb = await porta.transferir(ctx(), {
      paciente: m['pacB'],
      endereco: m['endB'],
      liminarNumero: '0001234-56',
      liminarData: '2026-11-01',
    });
    expect(await linha('d', tb.id as never)).toMatchObject({
      por_liminar_judicial: 1,
      numero_liminar: '0001234-56',
    });
    // Iniciar sem médico é recusado; com médico, ativa.
    await expect(
      porta.acaoInternacao(ctx(), t.id as never, 'iniciar', { versao: Number(d['versao']) }),
    ).rejects.toMatchObject(recusa);
    await porta.acaoInternacao(ctx(), t.id as never, 'iniciar', {
      versao: Number(d['versao']),
      medico: m['prof0'],
      quando: new Date(Date.now() - 3_600_000).toISOString(),
    });
    d = await linha('d', t.id as never);
    expect(d['situacao']).toBe('ativa');
    expect(d['data_hora_inicio']).not.toBeNull();
    expect(Number(d['medico_responsavel_profissional_id'])).toBe(m['prof0']);
    await porta.acaoInternacao(ctx(), t.id as never, 'suspender', {
      versao: Number(d['versao']),
      motivo: 'Reinternação hospitalar sintética',
    });
    d = await linha('d', t.id as never);
    expect(d['situacao']).toBe('suspensa');
    expect(String(d['observacao'])).toContain('suspensão] Reinternação hospitalar sintética');
    await porta.acaoInternacao(ctx(), t.id as never, 'retomar', { versao: Number(d['versao']) });
    m['dom'] = t.id as never;
    m['domB'] = tb.id as never;
    expect(await trilha('internacao_domiciliar', t.id as never)).toEqual([
      'internacao.domiciliar.transferir',
      'internacao.domiciliar.iniciar',
      'internacao.domiciliar.suspender',
      'internacao.domiciliar.retomar',
    ]);
    expect(await trilha('internacao_domiciliar', tb.id as never)).toEqual([
      'internacao.domiciliar.transferir',
    ]);
  });

  it('chamado com o endereço da internação, visita do chamado, conclusão com desfecho e encerramento', async () => {
    // Motivo de outro tipo: recusado.
    await expect(
      porta.abrirChamado(ctx(), { paciente: m['pacA'], tipo: m['tipo'], motivo: m['motivo2'] }),
    ).rejects.toMatchObject(recusa);
    const ch = await porta.abrirChamado(ctx(), {
      paciente: m['pacA'],
      tipo: m['tipo'],
      sintoma: 'Febre sintética',
    });
    let c = await linha('c', ch.id as never);
    expect(c).toMatchObject({
      situacao: 'aberto',
      internacao_domiciliar_id: m['dom'],
      logradouro: 'Rua Sintética',
      numero_endereco: '10',
    });
    expect(String(c['numero'])).toMatch(/^CHD-/);
    await porta.acaoChamado(ctx(), ch.id as never, 'triar', {
      versao: Number(c['versao']),
      prioridade: 'urgente',
    });
    c = await linha('c', ch.id as never);
    const r = await porta.acaoChamado(ctx(), ch.id as never, 'atribuir', {
      versao: Number(c['versao']),
      profissional: m['prof1'],
    });
    c = await linha('c', ch.id as never);
    expect(c).toMatchObject({ situacao: 'atribuido' });
    expect(Number(c['atribuido_profissional_id'])).toBe(m['prof1']);
    let v = await linha('v', r.visita as never);
    expect(v).toMatchObject({ situacao: 'agendada', extra: 1, chamado_domiciliar_id: ch.id });
    // Atendido no domicílio sem a visita realizada: recusado.
    await expect(
      porta.acaoChamado(ctx(), ch.id as never, 'concluir', {
        versao: Number(c['versao']),
        desfecho: 'atendido_domicilio',
      }),
    ).rejects.toMatchObject(recusa);
    await porta.acaoVisita(ctx(), v['id'] as never, 'iniciar', { versao: Number(v['versao']) });
    expect((await linha('c', ch.id as never))['situacao']).toBe('em_atendimento');
    v = await linha('v', r.visita as never);
    // Encerrar a internação com visita em andamento e chamado aberto: recusado.
    const d = await linha('d', m['dom']!);
    await expect(
      porta.acaoInternacao(ctx(), m['dom']!, 'encerrar', { versao: Number(d['versao']) }),
    ).rejects.toMatchObject(recusa);
    await porta.acaoVisita(ctx(), v['id'] as never, 'realizar', { versao: Number(v['versao']) });
    v = await linha('v', r.visita as never);
    expect(v['situacao']).toBe('realizada');
    expect(v['encerrada_em']).not.toBeNull();
    c = await linha('c', ch.id as never);
    await porta.acaoChamado(ctx(), ch.id as never, 'concluir', {
      versao: Number(c['versao']),
      desfecho: 'atendido_domicilio',
      coparticipacao: 25,
    });
    c = await linha('c', ch.id as never);
    expect(c).toMatchObject({ situacao: 'concluido', desfecho: 'atendido_domicilio' });
    expect(Number(c['valor_coparticipacao'])).toBe(25);
    // Visita agendada fica cancelada no encerramento.
    const ag = await porta.agendarVisita(ctx(), {
      internacao: m['dom'],
      profissional: m['prof0'],
      tipo: m['tipo2'],
      quando: new Date(Date.now() + 86_400_000).toISOString(),
      duracao: 45,
    });
    await expect(
      porta.agendarVisita(ctx(), {
        internacao: m['dom'],
        profissional: m['prof0'],
        tipo: m['tipo2'],
        quando: new Date(Date.now() + 86_400_000 + 600_000).toISOString(),
        duracao: 30,
      }),
    ).rejects.toMatchObject(recusa);
    const d2 = await linha('d', m['dom']!);
    const fim = await porta.acaoInternacao(ctx(), m['dom']!, 'encerrar', { versao: Number(d2['versao']) });
    expect(fim).toMatchObject({ situacao: 'encerrada', visitasCanceladas: 1 });
    expect(await linha('v', ag.id as never)).toMatchObject({ situacao: 'cancelada' });
    expect((await linha('d', m['dom']!))['data_hora_fim']).not.toBeNull();
    // Chamado do paciente sem internação aberta precisa de endereço; anulado com motivo.
    await expect(porta.abrirChamado(ctx(), { paciente: m['pacA'], tipo: m['tipo2'] })).rejects.toMatchObject(
      recusa,
    );
    const avulso = await porta.abrirChamado(ctx(), {
      paciente: m['pacA'],
      tipo: m['tipo2'],
      logradouro: 'Rua Avulsa Sintética',
    });
    const a = await linha('c', avulso.id as never);
    expect(a['internacao_domiciliar_id']).toBeNull();
    await porta.acaoChamado(ctx(), avulso.id as never, 'anular', {
      versao: Number(a['versao']),
      motivo: 'Chamado aberto por engano',
    });
    expect(await linha('c', avulso.id as never)).toMatchObject({ situacao: 'anulado' });
    // Trilha: o chamado com o ciclo inteiro (a visita extra nasce na atribuição, sob o chamado), a visita do chamado
    // com início e realização, a visita agendada, o avulso anulado e o encerramento da internação.
    expect(await trilha('chamado_domiciliar', ch.id as never)).toEqual([
      'internacao.domiciliar.chamado.abrir',
      'internacao.domiciliar.chamado.triar',
      'internacao.domiciliar.chamado.atribuir',
      'internacao.domiciliar.chamado.concluir',
    ]);
    expect(await trilha('visita_domiciliar', v['id'] as never)).toEqual([
      'internacao.domiciliar.visita.iniciar',
      'internacao.domiciliar.visita.realizar',
    ]);
    expect(await trilha('visita_domiciliar', ag.id as never)).toEqual([
      'internacao.domiciliar.visita.agendar',
    ]);
    expect(await trilha('chamado_domiciliar', avulso.id as never)).toEqual([
      'internacao.domiciliar.chamado.abrir',
      'internacao.domiciliar.chamado.anular',
    ]);
    expect((await trilha('internacao_domiciliar', m['dom']!)).at(-1)).toBe('internacao.domiciliar.encerrar');

    // Visão do paciente e painel.
    const visao = await porta.paciente(ctx(), m['pacA']!);
    expect(visao.enderecos.map((x) => x.id)).toEqual([m['endA']]);
    expect(visao.orcamentos[0]!.itens).toHaveLength(2);
    expect(visao.chamados).toHaveLength(2);
    expect(visao.visitas).toHaveLength(2);
    const painel = await porta.painel(ctx());
    expect(painel.internacoes.map((x) => x.id)).toEqual([m['domB']]);
  });
});
