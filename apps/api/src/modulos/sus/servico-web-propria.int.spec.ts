// F7, 08-INTG linha 131: contrato de efeito da troca por serviço web com o SUS contra o MariaDB real (cliente de
// teste; massa SINTÉTICA "sws1", nenhuma pessoa real; cartões fictícios que passam no algoritmo). Prova o que fica no
// banco: o registro do rastreamento grava o envio pendente ligado ao paciente, ao atendimento e ao exame, com o cartão
// informado e o conteúdo como vai ao serviço; o repetido é recusado; o envio pelo simulador grava o protocolo, o cartão
// confirmado, a tentativa e a resposta (sucesso) em envio_webservice_sus_retorno; o aceito não vai de novo; o cadastro
// de prestador sem ocupação volta rejeitado com a crítica por campo; a falha de transporte fica "erro" com o motivo e
// pode ir de novo (sequência das respostas continua); a versão velha é recusada; o cancelamento exige motivo, não apaga
// a linha e libera um novo envio; o cartão inválido e o exame de outro estabelecimento não gravam nada.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { enviadorServicoWebSusSimulado } from './servico-web-enviador.js';
import {
  envioParaTransmitir,
  OPERACOES_SERVICO_WEB_SUS,
  painelServicoWebSus,
} from './servico-web-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'sws1';
const CNS_PAC = '199000177110002';
const CNS_PRO = '299000177220009';
const CNS_PRO2 = '199000177330002';

describe.skipIf(SEM_BANCO)('serviço web do SUS no banco próprio (cliente de teste)', () => {
  let nucleo: NucleoProprio;
  let est = 0;
  let usuario = 0;
  let paciente = 0;
  let pacienteSemCns = 0;
  let atendimento = 0;
  let item = 0;
  let itemSemCns = 0;
  let itemOutroEst = 0;
  let comCbo = 0;
  let semCbo = 0;
  const pessoas: number[] = [];
  const profissionais: number[] = [];
  let exame = 0;
  let ocupacao = 0;
  let ocupacaoCriada = false;
  const requisicoes: number[] = [];

  const executar = (nome: keyof typeof OPERACOES_SERVICO_WEB_SUS, entrada: unknown) =>
    nucleo.criarExecutor().executar(OPERACOES_SERVICO_WEB_SUS[nome] as never, CLIENTE, entrada, {
      cliente: CLIENTE,
      estabelecimento: est,
      usuario,
      correlacao: 'sws-gravar',
      chaveIdempotencia: `sws:${randomUUID()}`,
    });
  const recusaDe = (p: Promise<unknown>) =>
    p.then(
      () => 'gravou',
      // A recusa do executor chega como "codigo: mensagem".
      (e: unknown) => String((e as { codigo?: string }).codigo ?? (e as Error).message).split(':')[0],
    );
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'sws-ler' }, (l) => l.uma(sql, p));
  const envio = (id: number) =>
    um(
      `SELECT situacao, tentativas, protocolo, cns_informado, cns_confirmado, paciente_id, atendimento_id,
              exame_item_id, profissional_id, conteudo_enviado, versao, excluido_em
         FROM envio_webservice_sus WHERE id = ?`,
      [id],
    );
  const retornos = (id: number) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'sws-ler' }, (l) =>
      l.consultar(
        `SELECT sequencia, tipo, codigo_retorno, campo FROM envio_webservice_sus_retorno
          WHERE envio_webservice_sus_id = ? ORDER BY sequencia`,
        [id],
      ),
    );
  /** O caminho do controlador: lê o envio, chama o enviador e grava a resposta pela operação. */
  const enviarPeloSimulador = async (id: number) => {
    const atual = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'sws-ler' }, (l) =>
      envioParaTransmitir(l, est, id),
    );
    if (!atual) throw new Error('sem envio');
    const resposta = await enviadorServicoWebSusSimulado().enviar(atual.servico, atual.conteudo);
    return executar('faturamento.susServicoWebResposta', { envio: id, versao: atual.versao, resposta });
  };

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'sws-limpa' }, async (e) => {
      const ests = await e.consultar<{ id: number }>(
        'SELECT id FROM estabelecimento WHERE codigo IN (?, ?)',
        [EST, `${EST}b`],
      );
      const ids = ests.map((x) => Number(x.id));
      if (ids.length === 0) return;
      const em = ids.map(() => '?').join(', ');
      await limparTrilhaDaMassa(e, { ids });
      await e.executar(
        `DELETE r FROM envio_webservice_sus_retorno r JOIN envio_webservice_sus w ON w.id = r.envio_webservice_sus_id
          WHERE w.estabelecimento_id IN (${em})`,
        ids,
      );
      await e.executar(`DELETE FROM envio_webservice_sus WHERE estabelecimento_id IN (${em})`, ids);
      await e.executar(`DELETE FROM idempotencia_operacao WHERE estabelecimento_id IN (${em})`, ids);
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'sws-massa' }, async (e) => {
      const agora = new Date();
      const id = async (sql: string, p: unknown[] = []) =>
        Number((await e.uma<{ id: number }>(sql, p))?.id ?? 0);
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const estab = async (codigo: string, cnes: string) =>
        (await id('SELECT id FROM estabelecimento WHERE codigo = ?', [codigo])) ||
        (await e.inserir(
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, criado_em) VALUES (?, ?, ?, ?, ?)',
          [codigo, 'Hospital fictício SWS', 'Hospital fictício SWS (teste)', cnes, agora],
        ));
      est = await estab(EST, '9039772');
      const outroEst = await estab(`${EST}b`, '9039773');
      const pessoa = async (nome: string, cns: string | null) => {
        const p = await e.inserir('INSERT INTO pessoa_fisica (nome, cns, criado_em) VALUES (?, ?, ?)', [
          nome,
          cns,
          agora,
        ]);
        pessoas.push(p);
        return p;
      };
      const pac = async (nome: string, cns: string | null, prontuario: number) =>
        e.inserir(
          "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
          [await pessoa(nome, cns), prontuario, agora],
        );
      paciente = await pac('Paciente fictícia SWS', CNS_PAC, 978001);
      pacienteSemCns = await pac('Paciente fictícia SWS sem cartão', null, 978002);
      atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, unidade_assistencial_id, situacao,
           entrada_em, criado_em) VALUES (?, '978001', ?, 1, 1, 77, 1, 55, 'aberto', ?, ?)`,
        [est, paciente, agora, agora],
      );
      exame = await e.inserir(
        `INSERT INTO exame (codigo, sigla, nome, tipo_servico, criado_em)
         VALUES (?, 'SWSC', 'Citopatológico fictício SWS', 'laboratorio', ?)`,
        [`SWS-${Date.now()}`, agora],
      );
      const req = async (estabelecimento: number, pacienteId: number, numero: string) => {
        const r = await e.inserir(
          `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, setor_diagnostico_id,
             solicitante_profissional_id, fonte_pagadora_id, solicitado_em, criado_em)
           VALUES (?, ?, ?, ?, 1, 1, 77, '2026-11-20 10:00:00', ?)`,
          [estabelecimento, numero, pacienteId, atendimento, agora],
        );
        requisicoes.push(r);
        return e.inserir(
          'INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, criado_em) VALUES (?, 1, ?, ?)',
          [r, exame, agora],
        );
      };
      item = await req(est, paciente, 'SWS-R1');
      itemSemCns = await req(est, pacienteSemCns, 'SWS-R2');
      itemOutroEst = await req(outroEst, paciente, 'SWS-R3');
      const prof = async (nome: string, cns: string) => {
        const p = await e.inserir(
          "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'corpo_clinico', 'teste', ?)",
          [await pessoa(nome, cns), agora],
        );
        profissionais.push(p);
        return p;
      };
      comCbo = await prof('Médica fictícia SWS', CNS_PRO);
      semCbo = await prof('Médico fictício SWS', CNS_PRO2);
      ocupacao = await id("SELECT id FROM ocupacao_cbo WHERE codigo_cbo = '225125'");
      if (!ocupacao) {
        ocupacao = await e.inserir(
          "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES ('225125', 'Médico clínico (teste)', ?)",
          [agora],
        );
        ocupacaoCriada = true;
      }
      await e.inserir(
        'INSERT INTO profissional_ocupacao (profissional_id, ocupacao_cbo_id, principal, criado_em) VALUES (?, ?, 1, ?)',
        [comCbo, ocupacao, agora],
      );
      usuario = await id('SELECT MIN(id) AS id FROM usuario');
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
    expect(usuario).toBeGreaterThan(0);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'sws-limpa' }, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const em = (xs: number[]) => xs.map(() => '?').join(', ') || 'NULL';
      await e.executar(
        `DELETE FROM profissional_ocupacao WHERE profissional_id IN (${em(profissionais)})`,
        profissionais,
      );
      await e.executar(`DELETE FROM profissional WHERE id IN (${em(profissionais)})`, profissionais);
      await e.executar(
        `DELETE FROM exame_item WHERE requisicao_exame_id IN (${em(requisicoes)})`,
        requisicoes,
      );
      await e.executar(`DELETE FROM requisicao_exame WHERE id IN (${em(requisicoes)})`, requisicoes);
      await e.executar('DELETE FROM exame WHERE id = ?', [exame]);
      await e.executar('DELETE FROM atendimento WHERE id = ?', [atendimento]);
      await e.executar('DELETE FROM paciente WHERE id IN (?, ?)', [paciente, pacienteSemCns]);
      await e.executar(`DELETE FROM pessoa_fisica WHERE id IN (${em(pessoas)})`, pessoas);
      if (ocupacaoCriada) await e.executar('DELETE FROM ocupacao_cbo WHERE id = ?', [ocupacao]);
      await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [EST, `${EST}b`]);
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  });

  it('rastreamento: registra pendente, envia pelo simulador, grava protocolo e resposta; o aceito não vai de novo', async () => {
    const r = await executar('faturamento.susServicoWebRegistrar', {
      servico: 'rastreamento_cancer',
      exameItem: item,
      linha: 'colo_utero',
    });
    const id = Number((r.resultado as Record<string, unknown>)['envio']);
    const antes = await envio(id);
    expect(antes).toMatchObject({
      situacao: 'pendente',
      tentativas: 0,
      cns_informado: CNS_PAC,
      paciente_id: paciente,
      atendimento_id: atendimento,
      exame_item_id: item,
      excluido_em: null,
    });
    const conteudo = antes?.['conteudo_enviado'];
    expect(typeof conteudo === 'string' ? JSON.parse(conteudo) : conteudo).toMatchObject({
      servico: 'rastreamento_cancer',
      cnes: '9039772',
      linha: 'colo_utero',
      cnsPaciente: CNS_PAC,
      exame: { requisicao: 'SWS-R1', sequencia: 1, solicitadoEm: '2026-11-20' },
    });
    expect(
      await recusaDe(
        executar('faturamento.susServicoWebRegistrar', {
          servico: 'rastreamento_cancer',
          exameItem: item,
          linha: 'mama',
        }),
      ),
    ).toBe('envio-repetido');

    await enviarPeloSimulador(id);
    const depois = await envio(id);
    expect(depois).toMatchObject({ situacao: 'aceito', tentativas: 1, cns_confirmado: CNS_PAC });
    expect(String(depois?.['protocolo'])).toMatch(/^SIM-RC-[0-9a-f]{12}$/);
    expect(await retornos(id)).toEqual([
      { sequencia: 1, tipo: 'sucesso', codigo_retorno: null, campo: null },
    ]);
    expect(await recusaDe(enviarPeloSimulador(id))).toBe('envio-nao-pendente');
    expect(
      await recusaDe(
        executar('faturamento.susServicoWebCancelar', {
          envio: id,
          versao: Number(depois?.['versao']),
          motivo: 'teste x',
        }),
      ),
    ).toBe('cancelamento-invalido');

    const painel = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'sws-ler' }, (l) =>
      painelServicoWebSus(l, est, { paciente }),
    );
    expect(painel.itens.map((x) => [x.id, x.situacao, x.retornos.length])).toEqual([[id, 'aceito', 1]]);
  });

  it('cartão ausente e exame de outro estabelecimento não gravam nada', async () => {
    const conta = async () =>
      Number(
        (await um('SELECT COUNT(*) AS n FROM envio_webservice_sus WHERE estabelecimento_id = ?', [est]))?.[
          'n'
        ],
      );
    const n0 = await conta();
    expect(
      await recusaDe(
        executar('faturamento.susServicoWebRegistrar', {
          servico: 'rastreamento_cancer',
          exameItem: itemSemCns,
          linha: 'mama',
        }),
      ),
    ).toBe('cns-ausente');
    expect(
      await recusaDe(
        executar('faturamento.susServicoWebRegistrar', {
          servico: 'rastreamento_cancer',
          exameItem: itemOutroEst,
          linha: 'mama',
        }),
      ),
    ).toBe('exame-inexistente');
    expect(await conta()).toBe(n0);
  });

  it('prestador sem ocupação: rejeitado com a crítica do campo; cancelado com motivo, sem apagar, libera outro', async () => {
    const r = await executar('faturamento.susServicoWebRegistrar', {
      servico: 'cadastro_prestador',
      profissional: semCbo,
    });
    const id = Number((r.resultado as Record<string, unknown>)['envio']);
    await enviarPeloSimulador(id);
    const rej = await envio(id);
    expect(rej).toMatchObject({
      situacao: 'rejeitado',
      tentativas: 1,
      profissional_id: semCbo,
      cns_confirmado: null,
    });
    expect(await retornos(id)).toEqual([
      { sequencia: 1, tipo: 'erro', codigo_retorno: 'cbo-ausente', campo: 'cbo' },
    ]);
    const v = Number(rej?.['versao']);
    expect(
      await recusaDe(executar('faturamento.susServicoWebCancelar', { envio: id, versao: v, motivo: 'ab' })),
    ).toBe('motivo-obrigatorio');
    await executar('faturamento.susServicoWebCancelar', {
      envio: id,
      versao: v,
      motivo: 'ocupação cadastrada',
    });
    expect(await envio(id)).toMatchObject({ situacao: 'cancelado', excluido_em: null });
    const novo = await executar('faturamento.susServicoWebRegistrar', {
      servico: 'cadastro_prestador',
      profissional: semCbo,
    });
    expect(Number((novo.resultado as Record<string, unknown>)['envio'])).toBeGreaterThan(id);
  });

  it('falha de transporte fica erro com o motivo e vai de novo; versão velha é recusada', async () => {
    const r = await executar('faturamento.susServicoWebRegistrar', {
      servico: 'cadastro_prestador',
      profissional: comCbo,
    });
    const id = Number((r.resultado as Record<string, unknown>)['envio']);
    const v1 = Number((await envio(id))?.['versao']);
    await executar('faturamento.susServicoWebResposta', {
      envio: id,
      versao: v1,
      resposta: { chegou: false, mensagem: 'tempo esgotado' },
    });
    expect(await envio(id)).toMatchObject({ situacao: 'erro', tentativas: 1, protocolo: null });
    expect(
      await recusaDe(
        executar('faturamento.susServicoWebResposta', {
          envio: id,
          versao: v1,
          resposta: { chegou: false, mensagem: 'de novo' },
        }),
      ),
    ).toBe('envio-alterado');
    await enviarPeloSimulador(id);
    const ok = await envio(id);
    expect(ok).toMatchObject({ situacao: 'aceito', tentativas: 2, cns_confirmado: CNS_PRO });
    const c = ok?.['conteudo_enviado'];
    expect(typeof c === 'string' ? JSON.parse(c) : c).toMatchObject({ cbo: '225125' });
    expect(await retornos(id)).toEqual([
      { sequencia: 1, tipo: 'erro', codigo_retorno: 'transporte', campo: null },
      { sequencia: 2, tipo: 'sucesso', codigo_retorno: null, campo: null },
    ]);
  });
});
