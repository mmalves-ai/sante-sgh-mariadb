// Integração da porta própria do atendimento ao beneficiário e do portal do prestador contra o MariaDB real (cliente
// f22_o2). Massa sintética "L0209"; o protocolo e a conta do portal são semeados por SQL (o registro do protocolo e a
// criação da conta respondem 501 até o modelo e a identidade chegarem). Contrato de efeito: análise, resposta
// conclusiva (protocolo_beneficiario_resposta), encerramento e cancelamento com os andamentos; consulta de
// elegibilidade do portal; encerramento da conta do portal; versão, trilha e outbox; e as recusas (conflito de versão,
// protocolo encerrado, outro estabelecimento). SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaAtendimentoOperadoraPropria } from './atendimento-porta-propria.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  limparNegocio,
  type MassaOperadora,
  prepararMassa,
  SEM_BANCO,
  trilhaTela,
} from './infra/massa-operadora.spec-util.js';

describe.skipIf(SEM_BANCO)('porta própria do atendimento ao beneficiário (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAtendimentoOperadoraPropria;
  let m: MassaOperadora;
  let n = 0;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't0209' }, (l) => l.consultar(sql, p));
  const T = (ev: string, est?: number) => trilhaTela(m, 'protocolo_beneficiario', ev, est);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe('cliente_f22_o2');
    m = await prepararMassa(nucleo);
    await limparNegocio(nucleo, m);
    porta = new PortaAtendimentoOperadoraPropria(
      nucleo,
      CLIENTE,
      { elegibilidade: async () => null, vias: async () => [] },
      { prestador: async () => null },
    );
  }, 120_000);
  afterAll(async () => {
    if (m) await limparNegocio(nucleo, m);
    await nucleo?.encerrar();
  });

  const semear = () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 't0209' }, (e) =>
      e.inserir(
        `INSERT INTO protocolo_beneficiario (estabelecimento_id, numero_protocolo, origem_protocolo_id, beneficiario_plano_id,
           motivo_contato_beneficiario_id, aberto_em, prazo_em, detalhe, criado_em, versao)
         VALUES (?, ?, ?, ?, ?, NOW(3), NOW(3) + INTERVAL 5 DAY, 'Relato sintético', NOW(3), 1)`,
        [m.est, `L0209-P${++n}-${Date.now()}`, m.origemProtocolo, m.beneficiario, m.motivoContato],
      ),
    );

  it('analisa, responde e encerra: resposta, andamentos, trilha e outbox; recusa versão velha e protocolo encerrado', async () => {
    const id = await semear();
    await porta.gravar(contexto(m), T('operadora.atendimento.analise'), (g) => g.analisar({ id, versao: 1, usuario: 'x' }));
    const velha = await porta
      .gravar(contexto(m), T('x'), (g) => g.encerrar({ id, versao: 1, usuario: 'x' }))
      .catch((e: unknown) => codigoDe(e));
    expect(velha).toBe('conflito-versao');
    await porta.gravar(contexto(m), T('operadora.atendimento.resposta'), (g) =>
      g.responder({ id, versao: 2, usuario: 'x', conclusao: 'atendido', resposta: 'Resposta conclusiva sintética', fundamento: 'Contrato', meio: 'portal', respondidoEm: new Date().toISOString(), escritaPrazoEm: null }),
    );
    const p = await porta.protocolo(contexto(m), id);
    expect(p).toMatchObject({ situacao: 'respondido', resposta: 'Resposta conclusiva sintética', meio: 'portal', respondidoPor: 'l0209.teste', relato: 'Relato sintético' });
    await porta.gravar(contexto(m), T('x'), (g) => g.encerrar({ id, versao: 3, usuario: 'x' }));
    const [x] = await ler('SELECT situacao, encerrado_em FROM protocolo_beneficiario WHERE id = ?', [id]);
    expect(x!['situacao']).toBe('encerrado');
    expect(x!['encerrado_em']).not.toBeNull();
    const encerrado = await porta
      .gravar(contexto(m), T('x'), (g) => g.cancelar({ id, versao: 4, usuario: 'x', motivo: 'x' }))
      .catch((e: unknown) => codigoDe(e));
    expect(encerrado).toBe('protocolo-encerrado');
    expect((await porta.eventos(contexto(m), id)).map((e) => e.evento)).toEqual(['analise', 'resposta', 'encerramento']);
    expect((await ler("SELECT id FROM trilha_auditoria WHERE entidade = 'protocolo_beneficiario' AND entidade_id = ?", [id])).length).toBe(3);
    expect(await ler("SELECT id FROM integracao_mensagem WHERE ponto = 'operadora.atendimento.gravacao' AND entidade_id = ?", [id])).toHaveLength(3);
  });

  it('cancela; lista, totais e consulta pelo número; recusa outro estabelecimento', async () => {
    const id = await semear();
    const fora = await porta
      .gravar(contexto(m, m.outroEst), T('x', m.outroEst), (g) => g.cancelar({ id, versao: 1, usuario: 'x', motivo: 'x' }))
      .catch((e: unknown) => codigoDe(e));
    expect(fora).toBe('registro-inexistente');
    expect((await porta.protocolos(contexto(m), { situacao: 'aberto' })).itens.map((p) => p.id)).toContain(id);
    expect((await porta.totais(contexto(m))).abertos).toBeGreaterThanOrEqual(1);
    const numero = (await porta.protocolo(contexto(m), id))!.protocolo;
    expect(await porta.consulta(contexto(m), numero)).toMatchObject({ tipo: 'atendimento', id });
    expect(await porta.consulta(contexto(m, m.outroEst), numero)).toBeNull();
    await porta.gravar(contexto(m), T('x'), (g) => g.cancelar({ id, versao: 1, usuario: 'x', motivo: 'Aberto por engano' }));
    expect(await porta.protocolo(contexto(m), id)).toMatchObject({ situacao: 'cancelado', motivoCancelamento: 'Aberto por engano' });
  });

  it('consulta de elegibilidade do portal e conta do portal; o que falta responde 501', async () => {
    const r = await porta.gravar(contexto(m), trilhaTela(m, 'consulta_elegibilidade_recebida', 'x'), (g) =>
      g.registrarElegibilidade({ operadora: m.operadora, prestador: m.prestador, acesso: 0, carteirinha: 'L02090001', data: '2026-11-21', elegivel: true, motivos: [], beneficiario: m.beneficiario, usuario: 'x' }),
    );
    expect((await porta.consultasElegibilidade(contexto(m), m.prestador))[0]).toMatchObject({ id: r.id, elegivel: true, carteirinha: 'L02090001' });
    const conta = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't0209' }, (e) =>
      e.inserir(
        `INSERT INTO conta_portal_prestador (operadora_saude_id, prestador_rede_id, login, situacao, ativada_em, criado_em, versao)
         VALUES (?, ?, 'portal.l0209', 'ativa', NOW(3), NOW(3), 1)`,
        [m.operadora, m.prestador],
      ),
    );
    expect(await porta.acesso(contexto(m), conta)).toMatchObject({ login: 'portal.l0209', situacao: 'ativo', prestador: m.prestador });
    expect(await porta.acesso(contexto(m, m.outroEst), conta)).toBeNull();
    await porta.gravar(contexto(m), trilhaTela(m, 'conta_portal_prestador', 'x'), (g) =>
      g.encerrarAcesso({ id: conta, versao: 1, usuario: 'x', motivo: 'Desligado da clínica' }),
    );
    expect(await porta.acesso(contexto(m), conta)).toMatchObject({ situacao: 'encerrado', motivoEncerramento: 'Desligado da clínica' });
    expect((await porta.dominios(contexto(m))).origem.map((x) => x.id)).toContain(m.origemProtocolo);
    const pend = await porta
      .gravar(contexto(m), T('x'), (g) => g.registrar({} as never))
      .catch((e: unknown) => codigoDe(e));
    expect(pend).toBe('modelo-pendente');
  });
});
