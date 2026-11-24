// Integração da porta PRÓPRIA do atendimento contra o MariaDB real (cliente f22_o1 da onda 1). Contrato de efeito:
// abertura (número pela sequência do estabelecimento, histórico da situação, cobertura, procedimento principal, trilha e
// saída), condução no consultório, desfecho, exclusão lógica com motivo e a ocupação do leito de observação; recusas
// (encerrado, exclusão sem reautenticação, leito ocupado, outro estabelecimento). Massa SINTÉTICA, limpa no fim.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CEP_TESTE,
  CLIENTE_F22,
  CODIGO_ESTAB_OUTRO,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from '../cadastro/massa.spec-util.js';
import { PortaCadastroPropria } from '../cadastro/porta-propria.js';
import { PortaAtendimentoPropria } from './porta-propria.js';

describe.skipIf(SEM_BANCO)('porta própria do atendimento contra o MariaDB (cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAtendimentoPropria;
  let m: Massa | null = null;
  let paciente = 0;
  let gerador = 0;
  let senhas = { hoje: 0, ontem: 0 };
  let comSenha = 0;

  const contar = (sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f22-0102-conta' }, async (l) =>
      Number((await l.uma<{ n: unknown }>(sql, p))?.n ?? 0),
    );
  const ler = (sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f22-0102-conta' }, (l) => l.uma(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparMassa(nucleo, m);
    porta = new PortaAtendimentoPropria(nucleo, CLIENTE_F22);
    const cad = new PortaCadastroPropria(nucleo, CLIENTE_F22);
    const r = await cad.cadastrar(
      contextoPorta(m),
      {
        nome: `PACIENTE ATENDIDO ${MARCA}`,
        nascimento: '1975-02-03',
        sexo: 'M',
        cpf: cpfSintetico('990102101'),
        naturalidade: 'BELO HORIZONTE',
        ufNaturalidade: 'MG',
        cep: CEP_TESTE,
      },
      contextoGravacao(m),
    );
    paciente = r.resultado.idPaciente;
  });

  afterAll(async () => {
    if (gerador)
      await nucleo
        .escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-senha' }, async (w) => {
          const doGerador = 'SELECT id FROM senha_emitida WHERE gerador_senha_id = ?';
          for (const t of ['atendimento_senha', 'chamada_painel'])
            await w.executar(`DELETE FROM ${t} WHERE senha_emitida_id IN (SELECT id FROM (${doGerador}) x)`, [
              gerador,
            ]);
          await w.executar('DELETE FROM senha_emitida WHERE gerador_senha_id = ?', [gerador]);
          await w.executar('DELETE FROM gerador_senha WHERE id = ?', [gerador]);
        })
        .catch(() => undefined);
    // As etapas do PA (só de acréscimo) saem antes dos atendimentos da massa (a chave estrangeira).
    if (m)
      await nucleo
        .escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-etapas' }, (w) =>
          w.executar(
            'DELETE e FROM atendimento_etapa_pa e JOIN atendimento a ON a.id = e.atendimento_id WHERE a.estabelecimento_id = ?',
            [m!.estabelecimento],
          ),
        )
        .catch(() => undefined);
    await limparMassa(nucleo, m).catch(() => undefined);
    await nucleo?.encerrar();
  });

  const abertura = (mm: Massa) => ({
    tipo: 'consulta',
    paciente,
    convenio: mm.fonte,
    matricula: '123456',
    profissional: mm.profissional,
    especialidade: mm.especialidade,
    unidade: mm.unidade,
    centroCusto: mm.centroCusto,
    procedimento: mm.procedimento,
    cidPrincipal: mm.cid,
    carater: 'eletivo',
    local: mm.local,
  });

  let reg = 0;

  it('abre o atendimento: número da sequência, histórico, cobertura, procedimento principal, trilha e saída', async () => {
    const mm = m!;
    const r = await porta.executar(
      contextoPorta(mm),
      'atendimento.abrirAtendimento',
      abertura(mm),
      contextoGravacao(mm),
    );
    reg = Number(r.resultado['reg']);
    expect(reg).toBeGreaterThan(0);
    expect(String(r.resultado['cabecalho'])).toMatch(/^AT-\d+$/);
    expect(r.repetida).toBe(false);
    expect(
      await ler('SELECT situacao, estabelecimento_id, versao FROM atendimento WHERE id = ?', [reg]),
    ).toMatchObject({
      situacao: 'aberto',
      versao: 1,
    });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM atendimento_situacao_historico WHERE atendimento_id = ? AND situacao_nova = 'aberto'",
        [reg],
      ),
    ).toBe(1);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM cobertura_atendimento WHERE atendimento_id = ? AND numero_carteira = '123456'",
        [reg],
      ),
    ).toBe(1);
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM atendimento_procedimento WHERE atendimento_id = ? AND principal',
        [reg],
      ),
    ).toBe(1);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE id = ? AND entidade = 'atendimento' AND entidade_id = ?",
        [r.trilha, reg],
      ),
    ).toBe(1);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'atendimento.aberto' AND entidade_id = ?",
        [reg],
      ),
    ).toBe(1);
  });

  it('o dia, o detalhe e o histórico do paciente leem o atendimento; outro estabelecimento não o vê', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const { hoje } = await porta.relogio(c);
    const dia = await porta.atendimentosDoDia(c, { data: hoje });
    expect(dia.itens.map((x) => x.reg)).toContain(reg);
    const d = await porta.detalhe(c, reg);
    expect(d).toMatchObject({
      reg,
      tipo: 'consulta',
      carater: 'eletivo',
      paciente: { id: paciente },
      convenio: { codigo: mm.fonte },
      profissional: { crm: 990102 },
      matricula: '123456',
      procedimento: { codigo: mm.procedimento },
      versao: 'v1',
    });
    expect((await porta.historico(c, paciente)).historico.map((x) => x.reg)).toContain(reg);
    const outro = { ...c, estabelecimento: mm.outroEstabelecimento, hospital: CODIGO_ESTAB_OUTRO };
    expect(await porta.detalhe(outro, reg)).toBeNull();
    expect((await porta.atendimentosDoDia(outro, { data: hoje })).itens).toEqual([]);
  });

  it('consultório: atender exige a chamada; a chamada fica registrada; local de outro estabelecimento recusa', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    await expect(
      porta.executar(
        c,
        'atendimento.conduzirNoConsultorio',
        { atendimento: reg, local: mm.local, evento: 'atender' },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'paciente-nao-chamado' } });
    await expect(
      porta.executar(
        c,
        'atendimento.conduzirNoConsultorio',
        { atendimento: reg, local: mm.localOutro, evento: 'chamar' },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'local-inexistente' } });
    await porta.executar(
      c,
      'atendimento.conduzirNoConsultorio',
      { atendimento: reg, local: mm.local, evento: 'chamar' },
      contextoGravacao(mm),
    );
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM chamada_painel WHERE atendimento_id = ? AND local_atendimento_id = ? AND repeticao = 0',
        [reg, mm.local],
      ),
    ).toBe(1);
    const { hoje } = await porta.relogio(c);
    const fila = await porta.fila(c, { local: mm.local, hoje });
    expect(fila.itens.find((x) => x.reg === reg)).toMatchObject({
      situacaoNovo: 'chamado',
      chamadas: 1,
      prioridade: '2',
    });
    await porta.executar(
      c,
      'atendimento.conduzirNoConsultorio',
      { atendimento: reg, local: mm.local, evento: 'atender' },
      contextoGravacao(mm),
    );
    expect(await ler('SELECT situacao, versao FROM atendimento WHERE id = ?', [reg])).toMatchObject({
      situacao: 'em_atendimento',
      versao: 2,
    });
  });

  it('desfecho clínico só por médico (CBO 225 ou CRM ativo): a enfermagem é recusada; o encerrado recusa novo desfecho e a exclusão', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    await expect(
      porta.executar(
        c,
        'atendimento.encerrarAtendimento',
        { atendimento: reg, desfecho: 'alta', profissional: mm.enfermeira },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'categoria-nao-permitida' } });
    const fim = await porta.executar(
      c,
      'atendimento.encerrarAtendimento',
      { atendimento: reg, desfecho: 'alta', profissional: mm.profissional },
      contextoGravacao(mm),
    );
    expect(fim.resultado).toMatchObject({ reg, desfecho: 'alta' });
    const a = await ler('SELECT situacao, desfecho, saida_em, versao FROM atendimento WHERE id = ?', [reg]);
    expect(a).toMatchObject({ situacao: 'encerrado', desfecho: 'alta', versao: 3 });
    expect(a?.['saida_em']).toBeTruthy();
    expect(
      await contar('SELECT COUNT(*) AS n FROM atendimento_situacao_historico WHERE atendimento_id = ?', [
        reg,
      ]),
    ).toBe(3);
    await expect(
      porta.executar(
        c,
        'atendimento.encerrarAtendimento',
        { atendimento: reg, desfecho: 'evasao' },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'atendimento-encerrado' } });
    expect(await porta.previaCancelamento(c, reg)).toMatchObject({ pode: false });
    await expect(
      porta.executar(
        c,
        'atendimento.cancelarAtendimento',
        { atendimento: reg, motivo: mm.motivoCancelamento, justificativa: 'Teste de exclusão do encerrado' },
        contextoGravacao(mm, { reautenticadoEm: Date.now() }),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'exclusao-recusada' } });
  });

  it('abertura: senha do dia na fila abre e não serve a outro atendimento; senha de outro dia, marcação inexistente e local de outro estabelecimento recusam', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const { hoje } = await porta.relogio(c);
    const ontem = new Date(Date.parse(`${hoje}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    senhas = await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-senha' }, async (w) => {
      const agora = new Date();
      const ponto = await w.uma<{ id: unknown }>(
        'SELECT id FROM ponto_recepcao WHERE estabelecimento_id = ? AND codigo = ?',
        [mm.estabelecimento, MARCA],
      );
      gerador = await w.inserir(
        'INSERT INTO gerador_senha (ponto_recepcao_id, descricao, prefixo, criado_em) VALUES (?, ?, ?, ?)',
        [Number(ponto?.id), `GERADOR ${MARCA}`, 'T', agora],
      );
      const sql =
        'INSERT INTO senha_emitida (estabelecimento_id, gerador_senha_id, data_referencia, numero, codigo_exibicao, emitida_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)';
      return {
        hoje: await w.inserir(sql, [mm.estabelecimento, gerador, hoje, 1, 'T001', agora, agora]),
        ontem: await w.inserir(sql, [
          mm.estabelecimento,
          gerador,
          ontem,
          1,
          'T001',
          new Date(agora.getTime() - 86_400_000),
          agora,
        ]),
      };
    });
    await expect(
      porta.executar(
        c,
        'atendimento.abrirAtendimento',
        { ...abertura(mm), senha: senhas.ontem },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'senha-de-outro-dia' } });
    await expect(
      porta.executar(
        c,
        'atendimento.abrirAtendimento',
        { ...abertura(mm), marcacao: 999_999_999 },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'marcacao-inexistente' } });
    await expect(
      porta.executar(
        c,
        'atendimento.abrirAtendimento',
        { ...abertura(mm), local: mm.localOutro },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'local-inexistente' } });
    const r = await porta.executar(
      c,
      'atendimento.abrirAtendimento',
      {
        ...abertura(mm),
        senha: senhas.hoje,
        local: mm.local,
        responsavel: { nome: `RESPONSAVEL ${MARCA}`, parentesco: 1, telefone: '31988887777' },
      },
      contextoGravacao(mm),
    );
    comSenha = Number(r.resultado['reg']);
    expect(
      await ler(
        'SELECT responsavel_nome, responsavel_telefone, local_atendimento_id FROM atendimento WHERE id = ?',
        [comSenha],
      ),
    ).toMatchObject({
      responsavel_nome: `RESPONSAVEL ${MARCA}`,
      responsavel_telefone: '31988887777',
      local_atendimento_id: mm.local,
    });
    expect(
      await ler('SELECT situacao, paciente_id, versao FROM senha_emitida WHERE id = ?', [senhas.hoje]),
    ).toMatchObject({
      situacao: 'em_atendimento',
      paciente_id: paciente,
      versao: 2,
    });
    await expect(
      porta.executar(
        c,
        'atendimento.abrirAtendimento',
        { ...abertura(mm), senha: senhas.hoje },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'senha-ja-atendida' } });
  });

  it('exclui com motivo e reautenticação: registro do cancelamento, a senha do dia volta à fila; sem reautenticação, recusa', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const entrada = {
      atendimento: comSenha,
      motivo: mm.motivoCancelamento,
      justificativa: 'Aberto por engano no teste',
    };
    await expect(
      porta.executar(c, 'atendimento.cancelarAtendimento', entrada, contextoGravacao(mm)),
    ).rejects.toMatchObject({
      problema: { codigo: 'reautenticacao-necessaria' },
    });
    await porta.executar(
      c,
      'atendimento.cancelarAtendimento',
      entrada,
      contextoGravacao(mm, { reautenticadoEm: Date.now() }),
    );
    expect(await ler('SELECT situacao, excluido_em FROM atendimento WHERE id = ?', [comSenha])).toMatchObject(
      { situacao: 'cancelado', excluido_em: null },
    );
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM cancelamento_atendimento WHERE atendimento_id = ? AND motivo_cancelamento_operacao_id = ?',
        [comSenha, mm.motivoCancelamento],
      ),
    ).toBe(1);
    expect(await ler('SELECT situacao FROM senha_emitida WHERE id = ?', [senhas.hoje])).toMatchObject({
      situacao: 'aguardando',
    });
    expect(await porta.previaCancelamento(c, comSenha)).toMatchObject({ pode: false });
  });

  it('etapas manuais do PA: fato só de acréscimo com a hora e a conta; a ficha lê na ordem; etapa fora do vocabulário recusa', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const a = await porta.executar(c, 'atendimento.abrirAtendimento', abertura(mm), contextoGravacao(mm));
    const cab = String(a.resultado['cabecalho']);
    const r = Number(a.resultado['reg']);
    const trilha = {
      estabelecimento: mm.estabelecimento,
      usuario: mm.usuario,
      acao: 'operacao' as const,
      entidade: 'atendimento',
      entidadeId: r,
      correlacao: 'f22-0102-etapa',
    };
    const etapa = (e: string) =>
      porta.gravarSgh(c, trilha, (g) =>
        g.registrarEtapa({ cabecalho: cab, reg: r, senha: null, etapa: e, usuario: mm.login }),
      );
    const i1 = await etapa('atendimentoMedico');
    const i2 = await etapa('exames');
    expect(i2).toBeGreaterThan(i1);
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM atendimento_etapa_pa WHERE atendimento_id = ? AND usuario_id = ?',
        [r, mm.usuario],
      ),
    ).toBe(2);
    await expect(etapa('inexistente')).rejects.toMatchObject({ problema: { codigo: 'etapa-invalida' } });
    const d = await porta.detalhe(c, r);
    expect(d?.etapas.map((x) => x.etapa)).toEqual(['atendimentoMedico', 'exames']);
    expect(d?.etapas[0]).toMatchObject({ rotulo: 'Em atendimento médico' });
    expect(d?.etapas[0]?.em).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('etapas automáticas do PA (como a memória): abertura, chamada, atendimento médico, observação, decisão e saída; a consulta não ganha etapa automática', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const etapasDe = async (r: number) => (await porta.detalhe(c, r))?.etapas.map((x) => x.etapa);
    const consulta = Number(
      (await porta.executar(c, 'atendimento.abrirAtendimento', abertura(mm), contextoGravacao(mm))).resultado[
        'reg'
      ],
    );
    expect(await etapasDe(consulta)).toEqual([]);
    const a = await porta.executar(
      c,
      'atendimento.abrirAtendimento',
      { ...abertura(mm), tipo: 'pa' },
      contextoGravacao(mm),
    );
    const r = Number(a.resultado['reg']);
    const cab = String(a.resultado['cabecalho']);
    expect(await etapasDe(r)).toEqual(['abertura']);
    for (const evento of ['chamar', 'atender'] as const)
      await porta.executar(
        c,
        'atendimento.conduzirNoConsultorio',
        { atendimento: r, local: mm.local, evento },
        contextoGravacao(mm),
      );
    const trilha = {
      estabelecimento: mm.estabelecimento,
      usuario: mm.usuario,
      acao: 'operacao' as const,
      entidade: 'atendimento',
      entidadeId: r,
      correlacao: 'f22-0102-etapa-auto',
    };
    const ocupacao = await porta.gravarSgh(c, trilha, async (g) => {
      const n = await g.alocarObservacao({
        cabecalho: cab,
        reg: r,
        leito: mm.leitos[2] ?? mm.leitos[0]!,
        usuario: mm.login,
      });
      expect(
        await g.registrarEtapa({
          cabecalho: cab,
          reg: r,
          senha: null,
          etapa: 'observacao',
          usuario: mm.login,
        }),
      ).toBe(n);
      return n;
    });
    expect(ocupacao).toBeGreaterThan(0);
    await porta.executar(
      c,
      'atendimento.encerrarAtendimento',
      { atendimento: r, desfecho: 'alta', profissional: mm.profissional },
      contextoGravacao(mm),
    );
    const d = await porta.detalhe(c, r);
    expect(d?.etapas.map((x) => x.etapa)).toEqual([
      'abertura',
      'chamada',
      'atendimentoMedico',
      'observacao',
      'decisao',
      'saida',
    ]);
    // Divergência intencional registrada: o rótulo é o legível do vocabulário do produto (a memória devolve o código).
    expect(d?.etapas[0]).toMatchObject({ rotulo: 'Ficha aberta' });
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM atendimento_etapa_pa WHERE atendimento_id = ? AND usuario_id = ?',
        [r, mm.usuario],
      ),
    ).toBe(6);
  });

  it('observação pela mesma sequência da rota (alocar + etapa): um leito por paciente, transferência mantém a entrada, saída volta a em atendimento, exclusão fecha o leito', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const a1 = await porta.executar(c, 'atendimento.abrirAtendimento', abertura(mm), contextoGravacao(mm));
    const a2 = await porta.executar(c, 'atendimento.abrirAtendimento', abertura(mm), contextoGravacao(mm));
    const [l1, l2] = [mm.leitos[0]!, mm.leitos[1]!];
    const cab1 = String(a1.resultado['cabecalho']);
    const reg1 = Number(a1.resultado['reg']);
    const trilha = {
      estabelecimento: mm.estabelecimento,
      usuario: mm.usuario,
      acao: 'operacao' as const,
      entidade: 'atendimento',
      entidadeId: reg1,
      correlacao: 'f22-0102-obs',
    };
    const id = await porta.gravarSgh(c, trilha, async (g) => {
      const n = await g.alocarObservacao({ cabecalho: cab1, reg: reg1, leito: l1, usuario: mm.login });
      expect(
        await g.registrarEtapa({
          cabecalho: cab1,
          reg: reg1,
          senha: null,
          etapa: 'observacao',
          usuario: mm.login,
        }),
      ).toBe(n);
      return n;
    });
    expect(id).toBeGreaterThan(0);
    expect((await ler('SELECT situacao FROM atendimento WHERE id = ?', [reg1]))?.['situacao']).toBe(
      'em_observacao',
    );
    await expect(
      porta.gravarSgh(c, trilha, (g) =>
        g.alocarObservacao({ cabecalho: cab1, reg: reg1, leito: l2, usuario: mm.login }),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'ja-em-observacao' } });
    await expect(
      porta.gravarSgh(c, trilha, (g) =>
        g.alocarObservacao({
          cabecalho: String(a2.resultado['cabecalho']),
          reg: Number(a2.resultado['reg']),
          leito: l1,
          usuario: mm.login,
        }),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'leito-ocupado' } });
    const entrada1 = (
      await ler('SELECT data_hora_entrada AS e FROM ocupacao_leito_observacao WHERE id = ?', [id])
    )?.['e'];
    const novo = await porta.gravarSgh(c, trilha, async (g) => {
      const saida = await g.liberarObservacao({
        cabecalho: cab1,
        usuario: mm.login,
        justificativa: 'Transferência de leito: teste',
        limiteHoras: 24,
        transferencia: true,
      });
      return g.alocarObservacao({
        cabecalho: cab1,
        reg: reg1,
        leito: l2,
        usuario: mm.login,
        anterior: saida.id,
        motivoTransferencia: 'teste',
      });
    });
    expect(
      (await ler('SELECT data_hora_entrada AS e FROM ocupacao_leito_observacao WHERE id = ?', [novo]))?.['e'],
    ).toEqual(entrada1);
    const mapa = await porta.observacao(c);
    expect(mapa.leitos.find((x) => x.id === l2)?.ocupacao?.reg).toBe(reg1);
    const lib = await porta.gravarSgh(c, trilha, (g) =>
      g.liberarObservacao({ cabecalho: cab1, usuario: mm.login, justificativa: null, limiteHoras: 24 }),
    );
    expect(lib).toEqual({ horas: 0, id: novo });
    expect((await ler('SELECT situacao FROM atendimento WHERE id = ?', [reg1]))?.['situacao']).toBe(
      'em_atendimento',
    );
    expect((await porta.observacao(c)).leitos.find((x) => x.id === l2)?.ocupacao).toBeNull();
    // A exclusão do atendimento em observação fecha a ocupação (o leito não fica preso).
    const reg2 = Number(a2.resultado['reg']);
    await porta.gravarSgh(c, { ...trilha, entidadeId: reg2 }, (g) =>
      g.alocarObservacao({
        cabecalho: String(a2.resultado['cabecalho']),
        reg: reg2,
        leito: l1,
        usuario: mm.login,
      }),
    );
    await porta.executar(
      c,
      'atendimento.cancelarAtendimento',
      { atendimento: reg2, motivo: mm.motivoCancelamento, justificativa: 'Aberto por engano no teste' },
      contextoGravacao(mm, { reautenticadoEm: Date.now() }),
    );
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM ocupacao_leito_observacao WHERE atendimento_id = ? AND situacao = 'cancelada' AND data_hora_saida IS NOT NULL",
        [reg2],
      ),
    ).toBe(1);
    expect((await porta.observacao(c)).leitos.find((x) => x.id === l1)?.ocupacao).toBeNull();
  });

  it('ADR 0009, decisão 25 na abertura: alerta sem credenciamento; bloqueio recusa sem gravar; credenciado no plano superior abre o subplano', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const escrever = <T>(fn: (w: Parameters<Parameters<NucleoProprio['escrever']>[1]>[0]) => Promise<T>) =>
      nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-cred' }, fn);
    const op = await escrever(async (w) => {
      const um = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await w.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : w.inserir(ins, pi);
      };
      const fonte = await um(
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${MARCA}-OP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, ?, 'operadora', 'ativa', CURRENT_TIMESTAMP(3))",
        [`${MARCA}-OP`, `OPERADORA ${MARCA}`],
      );
      const plano = (codigo: string, sup: number | null) =>
        um(
          'SELECT id FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ? AND codigo = ?',
          [fonte, codigo],
          'INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, plano_superior_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))',
          [fonte, sup, codigo, codigo],
        );
      const raiz = await plano(`${MARCA}-PR`, null);
      await plano(`${MARCA}-PS`, raiz);
      await w.executar('DELETE FROM profissional_fonte_pagadora WHERE fonte_pagadora_id = ?', [fonte]);
      await w.executar('UPDATE fonte_pagadora SET bloqueia_sem_credenciamento = 0 WHERE id = ?', [fonte]);
      return { fonte, raiz };
    });
    const atendimentos = () =>
      contar('SELECT COUNT(*) AS n FROM atendimento WHERE fonte_pagadora_id = ? AND excluido_em IS NULL', [
        op.fonte,
      ]);
    const abrir = (extra: Record<string, unknown> = {}) =>
      porta.executar(
        c,
        'atendimento.abrirAtendimento',
        { ...abertura(mm), convenio: op.fonte, ...extra },
        contextoGravacao(mm),
      );
    try {
      // Sem credenciamento e sem bloqueio: abre, com o alerta no resultado.
      const a = await abrir();
      expect(a.resultado).toMatchObject({ alerta: 'profissional-nao-credenciado' });
      expect(String(a.resultado['alertaMotivo'])).toMatch(/credenciamento/);
      // Com o bloqueio do convênio: recusa antes do INSERT (nenhum atendimento novo).
      await escrever((w) =>
        w.executar('UPDATE fonte_pagadora SET bloqueia_sem_credenciamento = 1 WHERE id = ?', [op.fonte]),
      );
      const antes = await atendimentos();
      await expect(abrir({ plano: `${MARCA}-PS` })).rejects.toMatchObject({
        problema: { codigo: 'profissional-nao-credenciado' },
      });
      expect(await atendimentos()).toBe(antes);
      // Credenciado no plano superior: o subplano do paciente abre sem alerta, mesmo com o bloqueio ligado.
      await escrever((w) =>
        w.executar(
          `INSERT INTO profissional_fonte_pagadora (profissional_id, fonte_pagadora_id, plano_fonte_pagadora_id, vigencia_inicio,
             credenciado, criado_em) VALUES (?, ?, ?, '2020-01-01', TRUE, CURRENT_TIMESTAMP(3))`,
          [mm.profissional, op.fonte, op.raiz],
        ),
      );
      const b = await abrir({ plano: `${MARCA}-PS` });
      expect(b.resultado['alerta']).toBeUndefined();
      expect(await atendimentos()).toBe(antes + 1);
    } finally {
      await escrever(async (w) => {
        await w.executar('DELETE FROM profissional_fonte_pagadora WHERE fonte_pagadora_id = ?', [op.fonte]);
        await w.executar('UPDATE fonte_pagadora SET bloqueia_sem_credenciamento = 0 WHERE id = ?', [
          op.fonte,
        ]);
      });
    }
  });

  it('as operações ainda sem regra no banco respondem 501 (nada gravado)', async () => {
    const mm = m!;
    await expect(
      porta.executar(contextoPorta(mm), 'atendimento.alterarHeranca', {}, contextoGravacao(mm)),
    ).rejects.toMatchObject({ problema: { status: 501 } });
    await expect(porta.indicadores()).rejects.toMatchObject({ status: 501 });
  });
});
