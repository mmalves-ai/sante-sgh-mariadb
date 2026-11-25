// Contrato de efeito do registro geral de envio de e-mail (01-ADM L77) sobre o MariaDB real: a tentativa aceita fora
// de produção fica "capturada" (envio e destinatário, com o identificador da mensagem e a hora); a falha fica
// "falhou" com o erro resumido (sem endereço) e a tentativa seguinte da mesma entrega atualiza a mesma linha e soma a
// tentativa (em produção: "enviado" e "entregue"); estabelecimento desconhecido fica sem estabelecimento. Massa
// sintética (assunto com prefixo L77W), apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  SEM_BANCO,
} from './importadores/integracao.spec-util.js';
import { ENTIDADE_FILA_EMAIL, RegistroEnvioProprio } from './registro-envio-proprio.js';
import { limparTrilhaDaMassa } from './teste/limpar-trilha.spec-util.js';

const P = 'L77W';
const T0 = new Date('2026-11-24T10:00:00.000');

describe.skipIf(SEM_BANCO)('registro geral de envio de e-mail sobre o banco próprio', () => {
  let nucleo: NucleoProprio;
  let est = 0;
  let agora = T0;
  const base = (n: number, extra: Record<string, unknown> = {}) => ({
    estabelecimento: 'l77w',
    remetente: 'nao-responda@sintetico.invalid',
    destinatario: 'destino@sintetico.invalid',
    assunto: `${P} ALERTA ${n}`,
    corpo: 'TEXTO SINTETICO',
    identificador: `<${P}.${n}.1@sintetico.invalid>`,
    aceito: true,
    ...extra,
  });
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l77w' }, (l) => l.consultar(sql, p));

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      const envios = `SELECT id FROM envio_email WHERE assunto LIKE '${P}%'`;
      await e.executar(`DELETE FROM envio_email_destinatario WHERE envio_email_id IN (${envios})`, []);
      await e.executar(`DELETE FROM envio_email WHERE assunto LIKE '${P}%'`, []);
      await limparTrilhaDaMassa(e, { ids: [est] });
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    est = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'l77w'));
    await limpar();
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('fora de produção, o aceite fica capturado no envio e no destinatário, com identificador e hora', async () => {
    const registro = new RegistroEnvioProprio(nucleo, CLIENTE, false, undefined, () => agora);
    const r = await registro.registrar(base(1));
    expect(r).toMatchObject({ situacao: 'capturado', tentativas: 1 });
    const [e] = await ler('SELECT * FROM envio_email WHERE id = ?', [r.envio]);
    expect(e).toMatchObject({
      estabelecimento_id: est,
      remetente: 'nao-responda@sintetico.invalid',
      assunto: `${P} ALERTA 1`,
      corpo: 'TEXTO SINTETICO',
      entidade: ENTIDADE_FILA_EMAIL,
      situacao: 'capturado',
      tentativas: 1,
      identificador_mensagem: `<${P}.1.1@sintetico.invalid>`,
      erro: null,
      servidor_email_id: null,
      usuario_id: null,
      versao: 1,
    });
    expect((e?.['enviado_em'] as Date).getTime()).toBe(T0.getTime());
    expect((e?.['ocorrido_em'] as Date).getTime()).toBe(T0.getTime());
    const d = await ler('SELECT * FROM envio_email_destinatario WHERE envio_email_id = ?', [r.envio]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      sequencia: 1,
      tipo_destinatario: 'para',
      email: 'destino@sintetico.invalid',
      situacao: 'capturado',
      erro: null,
    });
  });

  it('a falha fica registrada sem endereço no erro; a nova tentativa atualiza a mesma linha e soma a tentativa', async () => {
    const producao = new RegistroEnvioProprio(nucleo, CLIENTE, true, undefined, () => agora);
    const erro = new Error('connect ECONNREFUSED 10.9.8.7:25 para destino@sintetico.invalid');
    const f1 = await producao.registrar(base(2, { aceito: false, erro }));
    expect(f1).toMatchObject({ situacao: 'falhou', tentativas: 1 });
    let [e] = await ler('SELECT situacao, tentativas, erro, enviado_em FROM envio_email WHERE id = ?', [
      f1.envio,
    ]);
    expect(e).toMatchObject({
      situacao: 'falhou',
      tentativas: 1,
      erro: 'Error: conexão recusada',
      enviado_em: null,
    });
    let [d] = await ler('SELECT situacao, erro FROM envio_email_destinatario WHERE envio_email_id = ?', [
      f1.envio,
    ]);
    expect(d).toMatchObject({ situacao: 'rejeitado', erro: 'Error: conexão recusada' });

    const f2 = await producao.registrar(
      base(2, { aceito: false, erro: new Error('SMTP: resposta 451 inesperada') }),
    );
    expect(f2).toMatchObject({ envio: f1.envio, situacao: 'falhou', tentativas: 2 });

    agora = new Date(T0.getTime() + 300_000);
    const ok = await producao.registrar(base(2));
    expect(ok).toMatchObject({ envio: f1.envio, situacao: 'enviado', tentativas: 3 });
    const todas = await ler(
      'SELECT id, situacao, tentativas, erro, enviado_em, versao FROM envio_email WHERE identificador_mensagem = ?',
      [`<${P}.2.1@sintetico.invalid>`],
    );
    expect(todas).toHaveLength(1);
    [e] = todas;
    expect(e).toMatchObject({ situacao: 'enviado', tentativas: 3, erro: null, versao: 3 });
    expect((e?.['enviado_em'] as Date).getTime()).toBe(agora.getTime());
    [d] = await ler('SELECT situacao, erro FROM envio_email_destinatario WHERE envio_email_id = ?', [
      f1.envio,
    ]);
    expect(d).toMatchObject({ situacao: 'entregue', erro: null });
    expect(
      await ler('SELECT COUNT(*) AS n FROM envio_email_destinatario WHERE envio_email_id = ?', [f1.envio]),
    ).toEqual([{ n: 1 }]);
  });

  it('estabelecimento desconhecido (ou ausente) fica sem estabelecimento', async () => {
    const registro = new RegistroEnvioProprio(nucleo, CLIENTE, false, undefined, () => agora);
    const a = await registro.registrar(base(3, { estabelecimento: 'nao-existe-l77w' }));
    const b = await registro.registrar(base(4, { estabelecimento: null }));
    const l = await ler('SELECT estabelecimento_id FROM envio_email WHERE id IN (?, ?)', [a.envio, b.envio]);
    expect(l).toEqual([{ estabelecimento_id: null }, { estabelecimento_id: null }]);
  });
});
