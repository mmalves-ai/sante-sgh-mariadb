// Contrato de efeito da comunicação de internação e alta recebida pela operadora (04-INT linha 80, C1-108) contra o
// MariaDB real (cliente f22_o2). Massa sintética "L0209". Prova o que fica no banco: a carteira não identificada fica
// 'recebida'; a central identifica a carteira digitada com pontuação (normalizada) e aceita (situação, beneficiário e
// respondido_em); a outra pendente é recusada com o motivo da terminologia de glosas; a respondida não muda (409); a
// carteira desconhecida e a recusa sem motivo são recusadas sem gravar; a lista traz a pendente primeiro; trilha de
// cada gravação. SGH_NUCLEO_SEM_BANCO=1 pula.
import { lerCabecalhoTroca } from '@sgh/dominio-operadora';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contexto,
  limparNegocio,
  type MassaOperadora,
  P,
  prepararMassa,
  SEM_BANCO,
  trilhaTela,
} from './infra/massa-operadora.spec-util.js';
import { PortaTrocaTissPropria, type TrocaRecebida } from './troca-tiss-propria.js';

describe.skipIf(SEM_BANCO)('comunicação recebida pela operadora (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaTrocaTissPropria;
  let m: MassaOperadora;
  let registroAns = '';
  let motivo = 0;
  let motivoCriado = false;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't1108' }, (l) => l.consultar(sql, p));
  const T = (ev: string) => trilhaTela(m, 'comunicacao_internacao_recebida', ev);

  async function limpar() {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-t1108' }, async (e) => {
      const est = [m.est, m.outroEst];
      await e.executar('DELETE FROM comunicacao_internacao_recebida WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar(
        "DELETE FROM troca_tiss_operadora WHERE estabelecimento_id IN (?, ?) AND sequencial_transacao LIKE '1108%'",
        est,
      );
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limpar();
    porta = new PortaTrocaTissPropria(nucleo, CLIENTE);
    const [o] = await ler('SELECT registro_ans FROM operadora_saude WHERE id = ?', [m.operadora]);
    registroAns = String(o!['registro_ans']);
    const [g] = await ler(
      'SELECT id FROM motivo_glosa WHERE vigencia_inicio <= CURRENT_DATE() AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE()) ORDER BY id LIMIT 1',
    );
    if (g) motivo = Number(g['id']);
    else
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'massa-t1108' }, async (e) => {
        await e.executar(
          "INSERT INTO motivo_glosa (codigo_tuss, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES ('L01081', 'Motivo sintético L0108', '2020-01-01', 'teste', NOW(3))",
        );
        const [x] = await e.consultar("SELECT id FROM motivo_glosa WHERE codigo_tuss = 'L01081'");
        motivo = Number(x!['id']);
        motivoCriado = true;
      });
  }, 120_000);
  afterAll(async () => {
    if (m) {
      await limpar();
      await limparNegocio(nucleo, m);
      if (motivoCriado)
        await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-t1108' }, (e) =>
          e.executar("DELETE FROM motivo_glosa WHERE codigo_tuss = 'L01081'"),
        );
    }
    await nucleo?.encerrar();
  });

  const troca = (seq: string): TrocaRecebida => ({
    cabecalho: lerCabecalhoTroca(
      `<ans:cabecalho><ans:identificacaoTransacao><ans:tipoTransacao>COMUNICACAO_BENEFICIARIO</ans:tipoTransacao><ans:sequencialTransacao>${seq}</ans:sequencialTransacao><ans:dataRegistroTransacao>2026-11-20</ans:dataRegistroTransacao><ans:horaRegistroTransacao>09:30:00</ans:horaRegistroTransacao></ans:identificacaoTransacao><ans:origem><ans:identificacaoPrestador><ans:codigoPrestadorNaOperadora>${P}-PR</ans:codigoPrestadorNaOperadora></ans:identificacaoPrestador></ans:origem><ans:destino><ans:registroANS>${registroAns}</ans:registroANS></ans:destino><ans:Padrao>4.03.00</ans:Padrao></ans:cabecalho>`,
    ),
    canal: 'webservice',
    hash: `h${seq}`,
    operadora: m.operadora,
    prestador: m.prestador,
  });
  const receber = (seq: string, carteira: string) =>
    porta.receberComunicacao(
      contexto(m),
      troca(seq),
      {
        carteira,
        recemNascido: false,
        dataEvento: '2026-11-19',
        tipoEvento: 'internacao',
        tipoInternacao: 'clinica',
        motivoEncerramento: null,
      },
      T('x'),
    );
  const codigo = (p: Promise<unknown>) =>
    p.then(
      () => 'gravou',
      (e: { problema?: { codigo?: string } }) => e.problema?.codigo ?? String(e),
    );

  it('identifica a carteira digitada com pontuação e aceita; a outra é recusada com motivo; a respondida não muda', async () => {
    const a = await receber('110801', 'DIGITADA-ERRADA');
    const b = await receber('110802', '0000-NAO-EXISTE');
    expect(a).toMatchObject({ situacao: 'recebida', beneficiarioIdentificado: false });

    // A lista traz as pendentes, com a carteira como chegou.
    const pend = await porta.comunicacoes(contexto(m), { situacao: 'recebida' });
    expect(pend.map((x) => x.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(pend.find((x) => x.id === a.id)).toMatchObject({
      numeroCarteira: 'DIGITADA-ERRADA',
      beneficiario: null,
    });

    // Aceitar sem identificar, carteira desconhecida e recusa sem motivo: recusados, nada gravado.
    expect(await codigo(porta.responderComunicacao(contexto(m), a.id, 1, { acao: 'aceitar' }, T('x')))).toBe(
      'carteira-nao-identificada',
    );
    expect(await codigo(porta.identificarComunicacao(contexto(m), a.id, 1, 'ZZ-999', T('x')))).toBe(
      'carteira-nao-identificada',
    );
    expect(
      await codigo(
        porta.responderComunicacao(contexto(m), b.id, 1, { acao: 'recusar', motivoRecusa: null }, T('x')),
      ),
    ).toBe('recusa-sem-motivo');

    // Identifica pela carteira com pontuação e minúsculas, e aceita.
    const id = await porta.identificarComunicacao(
      contexto(m),
      a.id,
      1,
      ` ${P.toLowerCase()}.0001 `,
      T('operadora.troca-tiss.comunicacao.identificar'),
    );
    expect(id).toMatchObject({ id: a.id, versao: 2, beneficiario: m.beneficiario });
    const ac = await porta.responderComunicacao(
      contexto(m),
      a.id,
      2,
      { acao: 'aceitar' },
      T('operadora.troca-tiss.comunicacao.aceitar'),
    );
    expect(ac).toMatchObject({ situacao: 'aceita', versao: 3 });

    // Recusa com motivo.
    const rc = await porta.responderComunicacao(
      contexto(m),
      b.id,
      1,
      { acao: 'recusar', motivoRecusa: motivo },
      T('operadora.troca-tiss.comunicacao.recusar'),
    );
    expect(rc).toMatchObject({ situacao: 'recusada' });

    // A respondida não muda.
    expect(await codigo(porta.responderComunicacao(contexto(m), b.id, 2, { acao: 'aceitar' }, T('x')))).toBe(
      'comunicacao-ja-respondida',
    );

    const linhas = await ler(
      'SELECT id, situacao, beneficiario_plano_id, motivo_glosa_id, numero_carteira, respondido_em IS NOT NULL AS respondida FROM comunicacao_internacao_recebida WHERE id IN (?, ?) ORDER BY id',
      [a.id, b.id],
    );
    expect(linhas).toEqual([
      expect.objectContaining({
        situacao: 'aceita',
        beneficiario_plano_id: m.beneficiario,
        motivo_glosa_id: null,
        numero_carteira: 'DIGITADA-ERRADA',
        respondida: 1,
      }),
      expect.objectContaining({
        situacao: 'recusada',
        beneficiario_plano_id: null,
        motivo_glosa_id: motivo,
        respondida: 1,
      }),
    ]);
    const trilha = await ler(
      "SELECT entidade_id FROM trilha_auditoria WHERE entidade = 'comunicacao_internacao_recebida' AND entidade_id IN (?, ?)",
      [String(a.id), String(b.id)],
    );
    // Recebimento (2), identificação, aceite e recusa: as recusadas sem gravar não deixam trilha.
    expect(trilha.length).toBe(5);

    const todas = await porta.comunicacoes(contexto(m));
    expect(todas.find((x) => x.id === b.id)?.motivoRecusa?.id).toBe(motivo);
    expect(await porta.motivosRecusaComunicacao(contexto(m))).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: motivo })]),
    );
  });
});
